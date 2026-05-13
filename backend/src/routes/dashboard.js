import express from "express";
import {
  Product,
  Order,
  Customer,
  getAccessibleStoreIds,
} from "../models/index.js";
import { authenticateToken } from "../middleware/auth.js";
import {
  requireAdminRole,
  requirePermission,
} from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";
import {
  filterOrdersByScope,
  getOrderScopeFiltersCacheKey,
  hasActiveOrderScopeFilters,
  normalizeOrderScopeFilters,
} from "../helpers/orderScope.js";
import { calculateDashboardOrderStats } from "../helpers/dashboardStats.js";
import { emitRealtimeEvent } from "../services/realtimeEventService.js";
import { ProductUpdateService } from "../services/productUpdateService.js";
import {
  getRequestProfiler,
  measureAsync,
  measureSync,
} from "../helpers/requestProfiler.js";
import { computeNetProfitMetrics } from "../helpers/netProfit.js";
import { isProductLowStockAlertsSuppressed } from "../helpers/productLocalMetadata.js";

const router = express.Router();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_STATUSES = new Set(["paid", "partially_paid"]);
const PAID_LIKE_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
]);
const REFUNDED_STATUSES = new Set(["refunded", "partially_refunded"]);
const PENDING_STATUSES = new Set(["pending", "authorized"]);
const CANCELLED_STATUSES = new Set(["voided", "cancelled"]);
const DASHBOARD_BATCH_SIZE = 1000;
const DASHBOARD_LARGE_BATCH_SIZE = 5000;
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_ORDER_VISIBLE_LIMIT = 4500;
const DASHBOARD_STATS_ORDER_SCAN_LIMIT = 500;
const LOW_STOCK_THRESHOLD = 10;
const LOW_STOCK_NOTIFICATION_TYPE = "low_stock";
const LOW_STOCK_NOTIFICATION_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK_NOTIFICATION_MAX_PRODUCTS = 8;
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const QUERY_RETRYABLE_ERROR_CODES = new Set(["57014"]);
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const dashboardStatsCache = new Map();
const dashboardAnalyticsCache = new Map();
const dashboardGrowthCenterCache = new Map();
const DASHBOARD_PRODUCT_COUNT_SELECT = [
  "id",
  "store_id",
  "user_id",
  "title",
  "inventory_quantity",
  "updated_at",
  "data",
].join(",");
const DASHBOARD_PRODUCT_COUNT_SELECTS = [
  DASHBOARD_PRODUCT_COUNT_SELECT,
  ["id", "store_id", "user_id", "title", "inventory_quantity", "data"].join(
    ",",
  ),
  ["id", "store_id", "user_id", "inventory_quantity", "data"].join(","),
  "id,store_id,user_id",
];
const DASHBOARD_CUSTOMER_COUNT_SELECT = "id,store_id,user_id";
const DASHBOARD_ORDER_STATS_SELECT = [
  "id",
  "store_id",
  "user_id",
  "total_price",
  "total_refunded",
  "financial_status",
  "status",
  "cancelled_at",
  "created_at",
].join(",");
const DASHBOARD_ORDER_STATS_SELECTS = [
  ["id", "store_id", "user_id", "total_price", "status", "created_at"].join(
    ",",
  ),
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "status",
    "created_at",
    "data",
  ].join(","),
  DASHBOARD_ORDER_STATS_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "financial_status",
    "status",
    "cancelled_at",
    "created_at",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "total_refunded",
    "financial_status",
    "status",
    "cancelled_at",
    "created_at",
    "data",
  ].join(","),
];
const DASHBOARD_ORDER_ANALYTICS_SELECT = [
  "id",
  "store_id",
  "user_id",
  "customer_name",
  "customer_email",
  "fulfillment_status",
  "total_price",
  "total_refunded",
  "financial_status",
  "status",
  "cancelled_at",
  "created_at",
  "data",
].join(",");
const DASHBOARD_ORDER_ANALYTICS_SELECTS = [
  [
    "id",
    "store_id",
    "user_id",
    "customer_name",
    "customer_email",
    "fulfillment_status",
    "total_price",
    "status",
    "created_at",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "customer_name",
    "customer_email",
    "fulfillment_status",
    "total_price",
    "status",
    "created_at",
  ].join(","),
  DASHBOARD_ORDER_ANALYTICS_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "customer_name",
    "customer_email",
    "fulfillment_status",
    "total_price",
    "financial_status",
    "status",
    "cancelled_at",
    "created_at",
    "data",
  ].join(","),
];
const DASHBOARD_ORDER_FILTERED_STATS_SELECTS = [
  DASHBOARD_ORDER_ANALYTICS_SELECT,
  ...DASHBOARD_ORDER_ANALYTICS_SELECTS,
];
const DASHBOARD_PRODUCT_PROFITABILITY_SELECT = [
  "id",
  "store_id",
  "user_id",
  "title",
  "shopify_id",
  "sku",
  "price",
  "cost_price",
  "ads_cost",
  "operation_cost",
  "shipping_cost",
].join(",");
const DASHBOARD_PRODUCT_PROFITABILITY_SELECTS = [
  DASHBOARD_PRODUCT_PROFITABILITY_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "title",
    "shopify_id",
    "sku",
    "price",
    "cost_price",
    "ads_cost",
    "operation_cost",
    "shipping_cost",
  ].join(","),
  ["id", "store_id", "user_id", "title", "shopify_id", "sku", "price"].join(
    ",",
  ),
];
const DASHBOARD_PRODUCT_FULFILLED_PROFIT_SELECTS = [
  [DASHBOARD_PRODUCT_PROFITABILITY_SELECT, "data"].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "title",
    "shopify_id",
    "sku",
    "price",
    "cost_price",
    "ads_cost",
    "operation_cost",
    "shipping_cost",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "title",
    "shopify_id",
    "sku",
    "price",
    "data",
  ].join(","),
];
const DASHBOARD_ORDER_PROFITABILITY_SELECT = [
  "id",
  "store_id",
  "user_id",
  "total_price",
  "current_total_price",
  "total_refunded",
  "financial_status",
  "status",
  "cancelled_at",
  "data",
].join(",");
const DASHBOARD_ORDER_PROFITABILITY_SELECTS = [
  DASHBOARD_ORDER_PROFITABILITY_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "total_refunded",
    "financial_status",
    "status",
    "cancelled_at",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "status",
    "cancelled_at",
    "data",
  ].join(","),
];
const DASHBOARD_ORDER_FULFILLED_PROFIT_SELECTS = [
  [DASHBOARD_ORDER_PROFITABILITY_SELECT, "fulfillment_status"].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "total_refunded",
    "financial_status",
    "status",
    "cancelled_at",
    "fulfillment_status",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "total_price",
    "status",
    "fulfillment_status",
    "data",
  ].join(","),
];
const DASHBOARD_OPERATIONAL_COST_SELECT = [
  "product_id",
  "amount",
  "apply_to",
].join(",");
const GROWTH_CENTER_DEFAULT_LOOKBACK_DAYS = 30;
const GROWTH_CENTER_ORDERS_HISTORY_DAYS = 365;
const GROWTH_CENTER_REORDER_TARGET_DAYS = 30;
const GROWTH_CENTER_REPEAT_ACTIVE_WINDOW_DAYS = 90;
const GROWTH_CENTER_SECOND_ORDER_WINDOW_DAYS = 45;
const GROWTH_CENTER_WIN_BACK_WINDOW_DAYS = 90;
const GROWTH_CENTER_DORMANT_WINDOW_DAYS = 120;
const GROWTH_CENTER_SCALE_MARGIN_THRESHOLD = 28;
const GROWTH_CENTER_LEAK_MARGIN_THRESHOLD = 12;
const GROWTH_CENTER_PRODUCT_SELECT = [
  "id",
  "store_id",
  "user_id",
  "title",
  "image_url",
  "shopify_id",
  "sku",
  "price",
  "cost_price",
  "ads_cost",
  "operation_cost",
  "shipping_cost",
  "inventory_quantity",
  "updated_at",
  "data",
].join(",");
const GROWTH_CENTER_PRODUCT_SELECTS = [
  GROWTH_CENTER_PRODUCT_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "title",
    "shopify_id",
    "sku",
    "price",
    "cost_price",
    "ads_cost",
    "operation_cost",
    "shipping_cost",
    "inventory_quantity",
    "updated_at",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "title",
    "inventory_quantity",
    "updated_at",
    "data",
  ].join(","),
  ["id", "store_id", "user_id", "title", "inventory_quantity", "data"].join(
    ",",
  ),
];
const GROWTH_CENTER_ORDER_SELECT = [
  "id",
  "store_id",
  "user_id",
  "customer_id",
  "customer_name",
  "customer_email",
  "fulfillment_status",
  "total_price",
  "current_total_price",
  "total_refunded",
  "financial_status",
  "status",
  "cancelled_at",
  "created_at",
  "updated_at",
  "line_items",
  "data",
].join(",");
const GROWTH_CENTER_ORDER_SELECTS = [
  GROWTH_CENTER_ORDER_SELECT,
  [
    "id",
    "store_id",
    "user_id",
    "customer_name",
    "customer_email",
    "fulfillment_status",
    "total_price",
    "total_refunded",
    "financial_status",
    "status",
    "cancelled_at",
    "created_at",
    "line_items",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "user_id",
    "customer_name",
    "customer_email",
    "fulfillment_status",
    "total_price",
    "status",
    "created_at",
    "line_items",
    "data",
  ].join(","),
];
const GROWTH_CENTER_CUSTOMER_SELECTS = [
  ["id", "store_id", "user_id", "created_at", "updated_at"].join(","),
  ["id", "store_id", "user_id", "created_at"].join(","),
  "id,store_id,user_id",
];

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value)
    .trim()
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseEditableCostField = (value, label) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} is invalid`);
  }
  if (parsed < 0) {
    throw new Error(`${label} cannot be negative`);
  }
  if (parsed > 1000000) {
    throw new Error(`${label} exceeds maximum allowed value`);
  }

  return parsed;
};

const isSchemaCompatibilityError = (error) => {
  if (!error) return false;

  const code = String(error.code || "");
  if (SCHEMA_ERROR_CODES.has(code)) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    text.includes("does not exist") ||
    text.includes("could not find the") ||
    text.includes("relation") ||
    text.includes("column")
  );
};

const isQueryRetryableError = (error) => {
  if (!error) return false;
  if (isSchemaCompatibilityError(error)) {
    return true;
  }

  const code = String(error.code || "");
  if (QUERY_RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("timeout");
};

const getOrderFieldFallbacks = (
  primaryField,
  { allowUnordered = false } = {},
) => {
  const candidates = [
    primaryField,
    primaryField !== "created_at" ? "created_at" : null,
    primaryField !== "updated_at" ? "updated_at" : null,
    allowUnordered ? null : undefined,
    primaryField !== "id" ? "id" : null,
  ];

  return candidates.filter(
    (candidate, index) =>
      candidate !== undefined && candidates.indexOf(candidate) === index,
  );
};

const getDashboardCacheKey = (req) =>
  [
    String(req.user?.id || "").trim(),
    String(getRequestedStoreId(req) || "all").trim(),
    getOrderScopeFiltersCacheKey(req.query || {}),
  ].join("::");

const getOrderDateRangeFilters = (rawFilters = {}) => {
  const filters = normalizeOrderScopeFilters(rawFilters);
  const from = filters.dateFrom ? startOfDateDay(filters.dateFrom) : null;
  const to = filters.dateTo ? endOfDateDay(filters.dateTo) : null;

  return {
    from: from ? from.toISOString() : "",
    to: to ? to.toISOString() : "",
  };
};

const applyOrderDateRangeFilters = (query, rawFilters = {}) => {
  const { from, to } = getOrderDateRangeFilters(rawFilters);
  let scopedQuery = query;

  if (from) {
    scopedQuery = scopedQuery.gte("created_at", from);
  }

  if (to) {
    scopedQuery = scopedQuery.lte("created_at", to);
  }

  return scopedQuery;
};

const sortOrdersByCreatedAtDesc = (orders = []) =>
  [...(orders || [])].sort(
    (left, right) =>
      new Date(right?.created_at || 0) - new Date(left?.created_at || 0),
  );

const cloneDate = (value) => new Date(value.getTime());

const startOfDateDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDateDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
};

const addDays = (value, amount) => {
  const date = cloneDate(value);
  date.setDate(date.getDate() + amount);
  return date;
};

const addMonths = (value, amount) => {
  const date = cloneDate(value);
  date.setMonth(date.getMonth() + amount);
  return date;
};

const startOfMonth = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), 1);
};

const endOfMonth = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
};

const resolveAnalyticsDateRange = (orders = [], rawFilters = {}) => {
  const filters = normalizeOrderScopeFilters(rawFilters);
  const orderDates = orders
    .map((order) => new Date(order?.created_at || ""))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());
  const latestOrderDate = orderDates[orderDates.length - 1] || new Date();

  let from = filters.dateFrom ? startOfDateDay(filters.dateFrom) : null;
  let to = filters.dateTo ? endOfDateDay(filters.dateTo) : null;

  if (!to) {
    to = endOfDateDay(latestOrderDate) || endOfDateDay(new Date());
  }

  if (!from) {
    from = startOfDateDay(addMonths(to, -5)) || startOfDateDay(to);
  }

  if (from.getTime() > to.getTime()) {
    return {
      from: startOfDateDay(to),
      to: endOfDateDay(from),
    };
  }

  return { from, to };
};

const getAnalyticsTrendGranularity = (from, to) => {
  const spanInDays = Math.max(
    1,
    Math.ceil((to.getTime() - from.getTime()) / DAY_IN_MS) + 1,
  );

  return spanInDays <= 31 ? "day" : "month";
};

const buildAnalyticsTrends = (orders = [], rawFilters = {}) => {
  const { from, to } = resolveAnalyticsDateRange(orders, rawFilters);
  const granularity = getAnalyticsTrendGranularity(from, to);
  const buckets = [];

  let cursor =
    granularity === "day" ? startOfDateDay(from) : startOfMonth(from);
  const lastBucketStart =
    granularity === "day" ? startOfDateDay(to) : startOfMonth(to);

  while (
    cursor &&
    lastBucketStart &&
    cursor.getTime() <= lastBucketStart.getTime()
  ) {
    const bucketStart = cloneDate(cursor);
    const rawBucketEnd =
      granularity === "day"
        ? endOfDateDay(bucketStart)
        : endOfMonth(bucketStart);
    const bucketRangeStart =
      bucketStart.getTime() < from.getTime() ? from : bucketStart;
    const bucketRangeEnd =
      rawBucketEnd.getTime() > to.getTime() ? to : rawBucketEnd;

    const bucketOrders = orders.filter((order) => {
      const createdAt = new Date(order?.created_at || "");
      if (Number.isNaN(createdAt.getTime())) {
        return false;
      }

      return (
        createdAt.getTime() >= bucketRangeStart.getTime() &&
        createdAt.getTime() <= bucketRangeEnd.getTime()
      );
    });

    const bucketRevenue = bucketOrders.reduce(
      (sum, order) => sum + getOrderNetSalesAmount(order),
      0,
    );

    buckets.push({
      label:
        granularity === "day"
          ? bucketStart.toISOString().slice(0, 10)
          : bucketStart.toISOString().slice(0, 7),
      period_start: bucketStart.toISOString(),
      period_end: rawBucketEnd.toISOString(),
      orders: bucketOrders.length,
      revenue: parseFloat(bucketRevenue.toFixed(2)),
      cancelled: bucketOrders.filter((order) => isCancelledOrder(order)).length,
      refunded: bucketOrders.filter((order) => isRefundedOrder(order)).length,
    });

    cursor = granularity === "day" ? addDays(cursor, 1) : addMonths(cursor, 1);
  }

  return {
    trends: buckets,
    granularity,
    range: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
};

const getFreshCacheEntry = (cache, key) => {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > DASHBOARD_CACHE_TTL_MS) {
    return null;
  }

  return entry;
};

const rememberCacheEntry = (cache, key, payload) => {
  cache.set(key, {
    payload,
    updatedAt: Date.now(),
  });
};

const dedupeRowsById = (rows = []) => {
  const seen = new Set();
  const uniqueRows = [];

  for (const row of rows || []) {
    const key = String(row?.id || "");
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueRows.push(row);
  }

  return uniqueRows;
};

const isLowStockProduct = (product) => {
  if (isProductLowStockAlertsSuppressed(product)) {
    return false;
  }

  const quantity = toNumber(product?.inventory_quantity);
  return quantity > 0 && quantity < LOW_STOCK_THRESHOLD;
};

const getLowStockProducts = (products = []) =>
  dedupeRowsById(products)
    .filter((product) => product?.id && isLowStockProduct(product))
    .sort((left, right) => {
      const quantityDiff =
        toNumber(left?.inventory_quantity) -
        toNumber(right?.inventory_quantity);
      if (quantityDiff !== 0) {
        return quantityDiff;
      }

      return (
        new Date(right?.updated_at || 0).getTime() -
        new Date(left?.updated_at || 0).getTime()
      );
    })
    .slice(0, LOW_STOCK_NOTIFICATION_MAX_PRODUCTS);

const countLowStockProducts = (products = []) =>
  dedupeRowsById(products).filter((product) => isLowStockProduct(product))
    .length;

const buildLowStockNotificationDraft = (product, userId) => {
  const productTitle =
    String(product?.title || "").trim() || "Untitled product";
  const quantity = toNumber(product?.inventory_quantity);

  return {
    user_id: userId,
    type: LOW_STOCK_NOTIFICATION_TYPE,
    title: `Low stock: ${productTitle}`,
    message: `${productTitle} is down to ${quantity} units and needs replenishment.`,
    entity_type: "product",
    entity_id: product?.id || null,
    metadata: {
      route: product?.id
        ? `/products/${product.id}`
        : "/products?stockStatus=low_stock",
      product_id: product?.id || null,
      product_title: productTitle,
      inventory_quantity: quantity,
      threshold: LOW_STOCK_THRESHOLD,
      store_id: product?.store_id || null,
    },
  };
};

const getLowStockNotificationRecipients = async () => {
  const { data: users, error } = await supabase
    .from("users")
    .select("id, role, is_active");

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return [];
    }
    throw error;
  }

  const activeUsers = (users || []).filter(
    (user) => user?.id && user?.is_active !== false,
  );
  if (activeUsers.length === 0) {
    return [];
  }

  const nonAdminIds = activeUsers
    .filter(
      (user) =>
        String(user?.role || "")
          .trim()
          .toLowerCase() !== "admin",
    )
    .map((user) => user.id);

  let permissionByUserId = new Map();
  if (nonAdminIds.length > 0) {
    const { data: permissionRows, error: permissionError } = await supabase
      .from("permissions")
      .select("user_id, can_view_products, can_edit_products")
      .in("user_id", nonAdminIds);

    if (permissionError && !isSchemaCompatibilityError(permissionError)) {
      throw permissionError;
    }

    permissionByUserId = new Map(
      (permissionRows || []).map((row) => [
        String(row?.user_id || "").trim(),
        {
          canViewProducts: Boolean(row?.can_view_products),
          canEditProducts: Boolean(row?.can_edit_products),
        },
      ]),
    );
  }

  const recipients = [];
  for (const user of activeUsers) {
    const userId = String(user?.id || "").trim();
    if (!userId) {
      continue;
    }

    const isAdmin =
      String(user?.role || "")
        .trim()
        .toLowerCase() === "admin";
    if (!isAdmin) {
      const permissions = permissionByUserId.get(userId);
      if (!permissions?.canViewProducts && !permissions?.canEditProducts) {
        continue;
      }
    }

    let storeIds = [];
    if (!isAdmin) {
      try {
        storeIds = await getAccessibleStoreIds(userId);
      } catch (storeScopeError) {
        console.error(
          "Low-stock recipient store scope resolution failed:",
          storeScopeError,
        );
      }
    }

    recipients.push({
      userId,
      isAdmin,
      storeIds: new Set(
        (storeIds || [])
          .map((storeId) => String(storeId || "").trim())
          .filter(Boolean),
      ),
    });
  }

  return recipients;
};

const canRecipientAccessProduct = (recipient, product) => {
  if (!recipient || !product) {
    return false;
  }

  if (recipient.isAdmin) {
    return true;
  }

  const normalizedStoreId = String(product?.store_id || "").trim();
  if (recipient.storeIds.size > 0 && normalizedStoreId) {
    return recipient.storeIds.has(normalizedStoreId);
  }

  return String(product?.user_id || "").trim() === recipient.userId;
};

const ensureLowStockNotifications = async (products = []) => {
  const lowStockProducts = getLowStockProducts(products);
  if (lowStockProducts.length === 0) {
    return 0;
  }

  const recipients = await getLowStockNotificationRecipients();
  if (recipients.length === 0) {
    return 0;
  }

  const recipientIds = recipients.map((recipient) => recipient.userId);
  const productIds = lowStockProducts
    .map((product) => String(product?.id || "").trim())
    .filter(Boolean);

  if (productIds.length === 0) {
    return 0;
  }

  const { data: existingNotifications, error: existingError } = await supabase
    .from("notifications")
    .select("user_id, entity_id")
    .eq("type", LOW_STOCK_NOTIFICATION_TYPE)
    .in("user_id", recipientIds)
    .in("entity_id", productIds)
    .gte(
      "created_at",
      new Date(Date.now() - LOW_STOCK_NOTIFICATION_LOOKBACK_MS).toISOString(),
    );

  if (existingError) {
    if (isSchemaCompatibilityError(existingError)) {
      return 0;
    }
    throw existingError;
  }

  const existingKeys = new Set(
    (existingNotifications || []).map(
      (row) =>
        `${String(row?.user_id || "").trim()}::${String(row?.entity_id || "").trim()}`,
    ),
  );

  const drafts = [];
  const draftRecipientIds = new Set();

  for (const product of lowStockProducts) {
    for (const recipient of recipients) {
      if (!canRecipientAccessProduct(recipient, product)) {
        continue;
      }

      const key = `${recipient.userId}::${String(product?.id || "").trim()}`;
      if (existingKeys.has(key)) {
        continue;
      }

      drafts.push(buildLowStockNotificationDraft(product, recipient.userId));
      draftRecipientIds.add(recipient.userId);
      existingKeys.add(key);
    }
  }

  if (drafts.length === 0) {
    return 0;
  }

  const { error: insertError } = await supabase
    .from("notifications")
    .insert(drafts);

  if (insertError) {
    if (isSchemaCompatibilityError(insertError)) {
      return 0;
    }
    throw insertError;
  }

  emitRealtimeEvent({
    userIds: Array.from(draftRecipientIds),
    payload: {
      resource: "notifications",
      context: "low_stock",
    },
  });

  return drafts.length;
};

const parseOrderData = (order) => {
  if (!order) return {};

  if (typeof order.data === "string") {
    try {
      return JSON.parse(order.data);
    } catch {
      return {};
    }
  }

  return order.data || {};
};

const MOON_PROFIT_STATUS_TAG_PREFIXES = ["moon_profit_status:"];
const MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES = [
  "moon_profit_status",
  "status",
];

const parseTagList = (tagsValue) => {
  if (Array.isArray(tagsValue)) {
    return tagsValue.map((tag) => String(tag || "").trim()).filter(Boolean);
  }

  return String(tagsValue || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const extractTagValueByPrefixes = (tags, prefixes = []) => {
  for (const rawTag of tags || []) {
    const tag = String(rawTag || "").trim();
    const lowerTag = tag.toLowerCase();

    for (const prefix of prefixes) {
      const normalizedPrefix = String(prefix || "").toLowerCase();
      if (!lowerTag.startsWith(normalizedPrefix)) {
        continue;
      }

      const rawValue = tag.slice(prefix.length).trim();
      if (rawValue) {
        return rawValue;
      }
    }
  }

  return "";
};

const getNoteAttributeValue = (data, keys = []) => {
  const normalizedKeys = new Set(
    (keys || [])
      .map((key) =>
        String(key || "")
          .toLowerCase()
          .trim(),
      )
      .filter(Boolean),
  );
  const attributes = Array.isArray(data?.note_attributes)
    ? data.note_attributes
    : [];

  for (const attribute of attributes) {
    const name = String(attribute?.name || "")
      .toLowerCase()
      .trim();
    if (!normalizedKeys.has(name)) {
      continue;
    }

    const value = String(attribute?.value || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
};

const getMoonProfitStatus = (data = {}) => {
  const directStatus = String(data?.moon_profit_status || "")
    .toLowerCase()
    .trim();
  if (directStatus) {
    return directStatus;
  }

  const noteAttributeStatus = String(
    getNoteAttributeValue(data, MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES),
  )
    .toLowerCase()
    .trim();
  if (noteAttributeStatus) {
    return noteAttributeStatus;
  }

  return String(
    extractTagValueByPrefixes(
      parseTagList(data?.tags),
      MOON_PROFIT_STATUS_TAG_PREFIXES,
    ),
  )
    .toLowerCase()
    .trim();
};

const parseLineItems = (order) => {
  if (Array.isArray(order?.line_items)) return order.line_items;

  if (typeof order?.line_items === "string") {
    try {
      const parsed = JSON.parse(order.line_items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const data = parseOrderData(order);
  if (Array.isArray(data?.line_items)) {
    return data.line_items;
  }

  return [];
};

const parseProductData = (value) => {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return typeof value === "object" ? value : {};
};

const getOrderFulfillmentStatus = (order) => {
  const data = parseOrderData(order);
  return String(order?.fulfillment_status || data?.fulfillment_status || "")
    .toLowerCase()
    .trim();
};

const buildProductOrderMatchKeys = (product) => {
  const keys = new Set();
  const addKey = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      keys.add(normalized);
    }
  };

  addKey(product?.id);
  addKey(product?.shopify_id);
  addKey(product?.sku);

  const parsedProductData = parseProductData(product?.data);
  const variants = Array.isArray(parsedProductData?.variants)
    ? parsedProductData.variants
    : [];

  variants.forEach((variant) => {
    addKey(variant?.id);
    addKey(variant?.product_id);
    addKey(variant?.sku);
  });

  return keys;
};

const getOrderCustomerKey = (order) => {
  const data = parseOrderData(order);
  const directCustomerId = String(
    order?.customer_id || data?.customer?.id || "",
  ).trim();
  if (directCustomerId) {
    return `id:${directCustomerId}`;
  }

  const email = String(
    order?.customer_email || data?.email || data?.customer?.email || "",
  )
    .trim()
    .toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  const name = String(order?.customer_name || data?.customer?.name || "")
    .trim()
    .toLowerCase();
  return name ? `name:${name}` : "";
};

const buildFilteredOrderEntitySummary = (orders = []) => {
  const productKeys = new Set();
  const customerKeys = new Set();

  for (const order of orders || []) {
    const customerKey = getOrderCustomerKey(order);
    if (customerKey) {
      customerKeys.add(customerKey);
    }

    for (const item of parseLineItems(order)) {
      const productKey = String(
        item?.product_id || item?.sku || item?.id || "",
      ).trim();
      if (productKey) {
        productKeys.add(productKey);
      }
    }
  }

  return {
    totalProducts: productKeys.size,
    totalCustomers: customerKeys.size,
  };
};

const getOrderFinancialStatus = (order) => {
  const data = parseOrderData(order);
  return String(
    getMoonProfitStatus(data) ||
      data?.financial_status ||
      order?.financial_status ||
      order?.status ||
      "",
  )
    .toLowerCase()
    .trim();
};

const getOrderGrossAmount = (order) => {
  const data = parseOrderData(order);
  return toNumber(order?.total_price ?? data?.total_price);
};

const getOrderCurrentAmount = (order) => {
  const data = parseOrderData(order);
  return toNumber(order?.current_total_price ?? data?.current_total_price);
};

const getRefundedAmountFromTransactions = (order) => {
  const data = parseOrderData(order);
  const refunds = Array.isArray(data?.refunds) ? data.refunds : [];
  return refunds.reduce((sum, refund) => {
    const transactions = Array.isArray(refund?.transactions)
      ? refund.transactions
      : [];
    return (
      sum +
      transactions.reduce(
        (transactionSum, transaction) =>
          transactionSum + toNumber(transaction?.amount),
        0,
      )
    );
  }, 0);
};

const getOrderRefundedAmount = (order) => {
  const status = getOrderFinancialStatus(order);
  const grossAmount = getOrderGrossAmount(order);
  const currentAmount = getOrderCurrentAmount(order);

  const refundedFromColumn = toNumber(order?.total_refunded);
  const refundedFromTransactions = getRefundedAmountFromTransactions(order);
  const refundedFromCurrentAmount =
    grossAmount > 0 && currentAmount > 0 && currentAmount <= grossAmount
      ? grossAmount - currentAmount
      : 0;

  let refundedAmount = Math.max(
    refundedFromColumn,
    refundedFromTransactions,
    refundedFromCurrentAmount,
  );

  // Full refund status without refund breakdown should still zero out revenue.
  if (status === "refunded" && refundedAmount <= 0 && grossAmount > 0) {
    refundedAmount = grossAmount;
  }

  return Math.min(grossAmount, Math.max(0, refundedAmount));
};

const isCancelledOrder = (order) => {
  const data = parseOrderData(order);
  const status = getOrderFinancialStatus(order);
  return (
    Boolean(order?.cancelled_at) ||
    Boolean(data?.cancelled_at) ||
    CANCELLED_STATUSES.has(status)
  );
};

const isPaidOrder = (order) =>
  PAID_STATUSES.has(getOrderFinancialStatus(order));

const isRefundedOrder = (order) => {
  const status = getOrderFinancialStatus(order);
  return REFUNDED_STATUSES.has(status) || getOrderRefundedAmount(order) > 0;
};

const isPendingOrder = (order) =>
  PENDING_STATUSES.has(getOrderFinancialStatus(order));

const getOrderGrossSalesAmount = (order) => {
  const status = getOrderFinancialStatus(order);
  if (isCancelledOrder(order) || !PAID_LIKE_STATUSES.has(status)) {
    return 0;
  }
  return getOrderGrossAmount(order);
};

const getOrderNetSalesAmount = (order) => {
  const grossAmount = getOrderGrossSalesAmount(order);
  if (grossAmount <= 0) {
    return 0;
  }

  const refundedAmount = getOrderRefundedAmount(order);
  return Math.max(0, grossAmount - refundedAmount);
};

const getOrderBookedGrossAmount = (order) => {
  if (isCancelledOrder(order)) {
    return 0;
  }

  return getOrderGrossAmount(order);
};

const getOrderBookedNetAmount = (order) => {
  const grossAmount = getOrderBookedGrossAmount(order);
  if (grossAmount <= 0) {
    return 0;
  }

  return Math.max(0, grossAmount - getOrderRefundedAmount(order));
};

const roundMetric = (value, digits = 2) =>
  parseFloat(toNumber(value).toFixed(digits));

const clampNumber = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, toNumber(value)));

const getParsedDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getIsoStringOrNull = (value) => {
  const parsedDate = getParsedDate(value);
  return parsedDate ? parsedDate.toISOString() : null;
};

const getDaysSince = (value, referenceDate = new Date()) => {
  const parsedDate = getParsedDate(value);
  if (!parsedDate) {
    return null;
  }

  return Math.max(
    0,
    Math.floor((referenceDate.getTime() - parsedDate.getTime()) / DAY_IN_MS),
  );
};

const isWithinDays = (value, days, referenceDate = new Date()) => {
  const ageInDays = getDaysSince(value, referenceDate);
  return ageInDays !== null && ageInDays <= days;
};

const normalizeGrowthLookbackDays = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return GROWTH_CENTER_DEFAULT_LOOKBACK_DAYS;
  }

  return Math.min(120, Math.max(7, parsed));
};

const getFreshestTimestamp = (...sources) => {
  let freshestDate = null;

  for (const source of sources) {
    for (const value of source || []) {
      const parsedDate = getParsedDate(value);
      if (!parsedDate) {
        continue;
      }

      if (!freshestDate || parsedDate.getTime() > freshestDate.getTime()) {
        freshestDate = parsedDate;
      }
    }
  }

  return freshestDate ? freshestDate.toISOString() : null;
};

const getPriorityRank = (priority) => {
  switch (
    String(priority || "")
      .trim()
      .toLowerCase()
  ) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "growth":
      return 3;
    default:
      return 4;
  }
};

const getScoreStatus = (score) => {
  const normalizedScore = clampNumber(score);
  if (normalizedScore >= 80) {
    return "good";
  }
  if (normalizedScore >= 60) {
    return "watch";
  }
  return "critical";
};

const buildGrowthCustomerProfiles = (
  orders = [],
  referenceDate = new Date(),
) => {
  const profileByCustomerKey = new Map();

  for (const order of orders || []) {
    const customerKey = getOrderCustomerKey(order);
    if (!customerKey) {
      continue;
    }

    const parsedOrderDate = getParsedDate(order?.created_at);
    const orderAmount = getOrderNetSalesAmount(order);
    const orderData = parseOrderData(order);
    const existingProfile = profileByCustomerKey.get(customerKey) || {
      id: customerKey,
      customer_key: customerKey,
      name: String(
        order?.customer_name ||
          orderData?.customer?.name ||
          orderData?.shipping_address?.name ||
          "",
      ).trim(),
      email: String(
        order?.customer_email ||
          orderData?.customer?.email ||
          orderData?.email ||
          "",
      )
        .trim()
        .toLowerCase(),
      first_order_at: null,
      last_order_at: null,
      orders_count: 0,
      total_spent: 0,
      revenue_30d: 0,
      paid_orders_count: 0,
    };

    existingProfile.orders_count += 1;
    existingProfile.total_spent += orderAmount;
    if (orderAmount > 0) {
      existingProfile.paid_orders_count += 1;
    }

    if (parsedOrderDate && isWithinDays(parsedOrderDate, 30, referenceDate)) {
      existingProfile.revenue_30d += orderAmount;
    }

    const orderTimestamp = parsedOrderDate?.getTime() || null;
    const firstTimestamp = getParsedDate(
      existingProfile.first_order_at,
    )?.getTime();
    const lastTimestamp = getParsedDate(
      existingProfile.last_order_at,
    )?.getTime();

    if (
      orderTimestamp &&
      (!firstTimestamp || orderTimestamp < firstTimestamp)
    ) {
      existingProfile.first_order_at = parsedOrderDate.toISOString();
    }

    if (orderTimestamp && (!lastTimestamp || orderTimestamp > lastTimestamp)) {
      existingProfile.last_order_at = parsedOrderDate.toISOString();
    }

    if (!existingProfile.name) {
      existingProfile.name = String(
        order?.customer_name ||
          orderData?.customer?.name ||
          orderData?.shipping_address?.name ||
          "",
      ).trim();
    }

    if (!existingProfile.email) {
      existingProfile.email = String(
        order?.customer_email ||
          orderData?.customer?.email ||
          orderData?.email ||
          "",
      )
        .trim()
        .toLowerCase();
    }

    profileByCustomerKey.set(customerKey, existingProfile);
  }

  return Array.from(profileByCustomerKey.values())
    .map((profile) => ({
      ...profile,
      total_spent: roundMetric(profile.total_spent),
      revenue_30d: roundMetric(profile.revenue_30d),
      average_order_value:
        profile.orders_count > 0
          ? roundMetric(profile.total_spent / profile.orders_count)
          : 0,
      days_since_first_order: getDaysSince(
        profile.first_order_at,
        referenceDate,
      ),
      days_since_last_order: getDaysSince(profile.last_order_at, referenceDate),
    }))
    .sort((left, right) => right.total_spent - left.total_spent);
};

const getVipSpendThreshold = (profiles = []) => {
  const spendValues = (profiles || [])
    .filter((profile) => toNumber(profile?.total_spent) > 0)
    .map((profile) => toNumber(profile.total_spent))
    .sort((left, right) => left - right);

  if (spendValues.length === 0) {
    return 0;
  }

  const thresholdIndex = Math.max(0, Math.ceil(spendValues.length * 0.8) - 1);
  return spendValues[thresholdIndex] || 0;
};

const buildGrowthRetentionSnapshot = (
  customerProfiles = [],
  referenceDate = new Date(),
) => {
  const profiles = Array.isArray(customerProfiles) ? customerProfiles : [];
  const vipSpendThreshold = getVipSpendThreshold(
    profiles.filter((profile) => toNumber(profile?.orders_count) >= 2),
  );
  const trackedRevenue = profiles.reduce(
    (sum, profile) => sum + toNumber(profile?.total_spent),
    0,
  );

  const newCustomers = profiles.filter(
    (profile) =>
      toNumber(profile?.orders_count) === 1 &&
      toNumber(profile?.days_since_first_order) <= 30,
  );
  const needsSecondOrder = profiles.filter((profile) => {
    const lastOrderAge = toNumber(profile?.days_since_last_order);
    return (
      toNumber(profile?.orders_count) === 1 &&
      lastOrderAge > 30 &&
      lastOrderAge <= GROWTH_CENTER_WIN_BACK_WINDOW_DAYS
    );
  });
  const repeatCustomers = profiles.filter((profile) => {
    const lastOrderAge = toNumber(profile?.days_since_last_order);
    return (
      toNumber(profile?.orders_count) >= 2 &&
      lastOrderAge <= GROWTH_CENTER_REPEAT_ACTIVE_WINDOW_DAYS
    );
  });
  const vipCustomers = profiles.filter((profile) => {
    const lastOrderAge = toNumber(profile?.days_since_last_order);
    return (
      toNumber(profile?.orders_count) >= 3 &&
      toNumber(profile?.total_spent) >= vipSpendThreshold &&
      lastOrderAge <= GROWTH_CENTER_REPEAT_ACTIVE_WINDOW_DAYS
    );
  });
  const winBackReady = profiles.filter((profile) => {
    const lastOrderAge = toNumber(profile?.days_since_last_order);
    return (
      lastOrderAge > GROWTH_CENTER_SECOND_ORDER_WINDOW_DAYS &&
      lastOrderAge <= GROWTH_CENTER_DORMANT_WINDOW_DAYS
    );
  });
  const dormantCustomers = profiles.filter(
    (profile) =>
      toNumber(profile?.days_since_last_order) >
      GROWTH_CENTER_DORMANT_WINDOW_DAYS,
  );
  const activeCustomers = profiles.filter(
    (profile) =>
      toNumber(profile?.days_since_last_order) <=
      GROWTH_CENTER_REPEAT_ACTIVE_WINDOW_DAYS,
  );

  const buildSegmentRow = (id, title, rows, note, action, tone = "slate") => {
    const revenue = rows.reduce(
      (sum, profile) => sum + toNumber(profile?.total_spent),
      0,
    );

    return {
      id,
      title,
      count: rows.length,
      revenue: roundMetric(revenue),
      share_of_customers:
        profiles.length > 0
          ? roundMetric((rows.length / profiles.length) * 100)
          : 0,
      note,
      action,
      tone,
      route: "/customers",
    };
  };

  const repeatCustomerRate =
    activeCustomers.length > 0
      ? roundMetric((repeatCustomers.length / activeCustomers.length) * 100)
      : 0;
  const vipRevenue =
    vipCustomers.reduce(
      (sum, profile) => sum + toNumber(profile?.total_spent),
      0,
    ) || 0;

  const winBackCandidates = [...winBackReady, ...dormantCustomers]
    .sort((left, right) => {
      const spendDiff =
        toNumber(right?.total_spent) - toNumber(left?.total_spent);
      if (spendDiff !== 0) {
        return spendDiff;
      }
      return toNumber(right?.orders_count) - toNumber(left?.orders_count);
    })
    .slice(0, 6)
    .map((profile) => {
      const lastOrderAge = toNumber(profile?.days_since_last_order);
      const isDormant = lastOrderAge > GROWTH_CENTER_DORMANT_WINDOW_DAYS;
      const isVipProfile =
        toNumber(profile?.orders_count) >= 3 &&
        toNumber(profile?.total_spent) >= vipSpendThreshold;

      return {
        id: profile.id,
        name: profile.name || profile.email || "Customer",
        email: profile.email || "",
        orders_count: toNumber(profile.orders_count),
        total_spent: roundMetric(profile.total_spent),
        last_order_at: profile.last_order_at,
        last_order_days_ago: lastOrderAge,
        segment: isDormant ? "dormant" : "win_back",
        priority: isDormant || isVipProfile ? "high" : "medium",
        suggested_action: isVipProfile
          ? "Reach out with a VIP recovery offer and manual follow-up."
          : isDormant
            ? "Bring this customer back with a stronger comeback campaign."
            : "Use a timed reminder or bundle to restart the buying cycle.",
      };
    });

  return {
    summary: {
      tracked_customers: profiles.length,
      active_customers: activeCustomers.length,
      repeat_customer_rate: repeatCustomerRate,
      vip_customer_count: vipCustomers.length,
      vip_revenue_share:
        trackedRevenue > 0
          ? roundMetric((vipRevenue / trackedRevenue) * 100)
          : 0,
      win_back_count: winBackReady.length,
      dormant_count: dormantCustomers.length,
      one_time_customer_count: profiles.filter(
        (profile) => toNumber(profile?.orders_count) === 1,
      ).length,
      vip_spend_threshold: roundMetric(vipSpendThreshold),
      generated_at: referenceDate.toISOString(),
    },
    segments: [
      buildSegmentRow(
        "new_customers",
        "New customers",
        newCustomers,
        "First-order customers from the last 30 days.",
        "Protect the first experience and move them quickly to order two.",
        "sky",
      ),
      buildSegmentRow(
        "needs_second_order",
        "Needs second order",
        needsSecondOrder,
        "One-time buyers who are cooling off after the first purchase.",
        "Send a second-order incentive or a simple bundle reminder.",
        "amber",
      ),
      buildSegmentRow(
        "repeat_customers",
        "Repeat customers",
        repeatCustomers,
        "Customers with 2+ orders and activity in the last 90 days.",
        "Feed them with restock timing, bundles, and loyalty messaging.",
        "emerald",
      ),
      buildSegmentRow(
        "vip_customers",
        "VIP customers",
        vipCustomers,
        "High-value buyers worth special retention treatment.",
        "Give them priority service and exclusive launches.",
        "violet",
      ),
      buildSegmentRow(
        "win_back_ready",
        "Win-back ready",
        winBackReady,
        "Customers who have been quiet for 45 to 120 days.",
        "Launch a comeback sequence before they fully churn.",
        "rose",
      ),
      buildSegmentRow(
        "dormant_customers",
        "Dormant customers",
        dormantCustomers,
        "Customers inactive for more than 120 days.",
        "Use stronger offers or suppress them from high-frequency spend.",
        "slate",
      ),
    ],
    win_back_candidates: winBackCandidates,
  };
};

const createSalesAccumulator = () => ({
  sold_units: 0,
  revenue: 0,
  orders_count: 0,
  last_sold_at: null,
});

const getSalesAccumulator = (salesByKey, key) => {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) {
    return null;
  }

  const existing = salesByKey.get(normalizedKey) || createSalesAccumulator();
  salesByKey.set(normalizedKey, existing);
  return existing;
};

const addSalesToAccumulators = ({
  order,
  salesAllTimeByKey,
  salesPrimaryWindowByKey,
  salesSecondaryWindowByKey,
  primaryWindowDays,
  secondaryWindowDays,
  referenceDate,
}) => {
  const orderGrossAmount = getOrderBookedGrossAmount(order);
  const orderNetAmount = getOrderBookedNetAmount(order);
  const parsedOrderDate = getParsedDate(order?.created_at);
  const netRatio =
    orderGrossAmount > 0
      ? Math.min(1, Math.max(0, orderNetAmount / orderGrossAmount))
      : 0;

  if (!parsedOrderDate || netRatio <= 0) {
    return;
  }

  const orderAgeInDays = getDaysSince(parsedOrderDate, referenceDate);
  const primaryOrderKeys = new Set();
  const secondaryOrderKeys = new Set();
  const allOrderKeys = new Set();

  parseLineItems(order).forEach((item) => {
    const quantity = toNumber(item?.quantity) * netRatio;
    const revenue = quantity * toNumber(item?.price);
    if (quantity <= 0 && revenue <= 0) {
      return;
    }

    const itemKeys = [item?.product_id, item?.variant_id, item?.sku, item?.id]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    for (const key of itemKeys) {
      const allTimeAccumulator = getSalesAccumulator(salesAllTimeByKey, key);
      if (allTimeAccumulator) {
        allTimeAccumulator.sold_units += quantity;
        allTimeAccumulator.revenue += revenue;
        allTimeAccumulator.last_sold_at = parsedOrderDate.toISOString();
        allOrderKeys.add(key);
      }

      if (orderAgeInDays !== null && orderAgeInDays <= primaryWindowDays) {
        const primaryAccumulator = getSalesAccumulator(
          salesPrimaryWindowByKey,
          key,
        );
        if (primaryAccumulator) {
          primaryAccumulator.sold_units += quantity;
          primaryAccumulator.revenue += revenue;
          primaryAccumulator.last_sold_at = parsedOrderDate.toISOString();
          primaryOrderKeys.add(key);
        }
      }

      if (orderAgeInDays !== null && orderAgeInDays <= secondaryWindowDays) {
        const secondaryAccumulator = getSalesAccumulator(
          salesSecondaryWindowByKey,
          key,
        );
        if (secondaryAccumulator) {
          secondaryAccumulator.sold_units += quantity;
          secondaryAccumulator.revenue += revenue;
          secondaryAccumulator.last_sold_at = parsedOrderDate.toISOString();
          secondaryOrderKeys.add(key);
        }
      }
    }
  });

  for (const key of allOrderKeys) {
    const accumulator = salesAllTimeByKey.get(key);
    if (accumulator) {
      accumulator.orders_count += 1;
    }
  }

  for (const key of primaryOrderKeys) {
    const accumulator = salesPrimaryWindowByKey.get(key);
    if (accumulator) {
      accumulator.orders_count += 1;
    }
  }

  for (const key of secondaryOrderKeys) {
    const accumulator = salesSecondaryWindowByKey.get(key);
    if (accumulator) {
      accumulator.orders_count += 1;
    }
  }
};

const mergeSalesSnapshots = (...snapshots) =>
  snapshots.reduce((merged, snapshot) => {
    if (!snapshot) {
      return merged;
    }

    merged.sold_units += toNumber(snapshot?.sold_units);
    merged.revenue += toNumber(snapshot?.revenue);
    merged.orders_count += toNumber(snapshot?.orders_count);

    const currentLastSoldAt =
      getParsedDate(merged.last_sold_at)?.getTime() || 0;
    const snapshotLastSoldAt =
      getParsedDate(snapshot?.last_sold_at)?.getTime() || 0;
    if (snapshotLastSoldAt > currentLastSoldAt) {
      merged.last_sold_at = snapshot.last_sold_at;
    }

    return merged;
  }, createSalesAccumulator());

const readSalesSnapshotForProduct = (product, salesByKey) => {
  const directKeys = [product?.shopify_id, product?.id]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const key of directKeys) {
    const snapshot = salesByKey.get(key);
    if (snapshot) {
      return {
        sold_units: roundMetric(snapshot.sold_units),
        revenue: roundMetric(snapshot.revenue),
        orders_count: toNumber(snapshot.orders_count),
        last_sold_at: snapshot.last_sold_at,
      };
    }
  }

  const parsedProductData = parseProductData(product?.data);
  const variantKeys = new Set();
  const addVariantKey = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      variantKeys.add(normalized);
    }
  };

  addVariantKey(product?.sku);
  for (const variant of Array.isArray(parsedProductData?.variants)
    ? parsedProductData.variants
    : []) {
    addVariantKey(variant?.id);
    addVariantKey(variant?.sku);
  }

  const merged = mergeSalesSnapshots(
    ...Array.from(variantKeys).map((key) => salesByKey.get(key)),
  );

  return {
    sold_units: roundMetric(merged.sold_units),
    revenue: roundMetric(merged.revenue),
    orders_count: toNumber(merged.orders_count),
    last_sold_at: merged.last_sold_at,
  };
};

const buildGrowthProductMetrics = ({
  products = [],
  orders = [],
  referenceDate = new Date(),
  primaryWindowDays = GROWTH_CENTER_DEFAULT_LOOKBACK_DAYS,
}) => {
  const secondaryWindowDays = Math.max(90, primaryWindowDays * 2);
  const salesAllTimeByKey = new Map();
  const salesPrimaryWindowByKey = new Map();
  const salesSecondaryWindowByKey = new Map();

  for (const order of orders || []) {
    if (isCancelledOrder(order)) {
      continue;
    }

    addSalesToAccumulators({
      order,
      salesAllTimeByKey,
      salesPrimaryWindowByKey,
      salesSecondaryWindowByKey,
      primaryWindowDays,
      secondaryWindowDays,
      referenceDate,
    });
  }

  return dedupeRowsById(products).map((product) => {
    const suppressLowStockAlerts = isProductLowStockAlertsSuppressed(product);
    const allTimeSnapshot = readSalesSnapshotForProduct(
      product,
      salesAllTimeByKey,
    );
    const primarySnapshot = readSalesSnapshotForProduct(
      product,
      salesPrimaryWindowByKey,
    );
    const secondarySnapshot = readSalesSnapshotForProduct(
      product,
      salesSecondaryWindowByKey,
    );
    const inventoryQuantity = Math.max(
      0,
      toNumber(product?.inventory_quantity),
    );
    const costPrice = toNumber(product?.cost_price);
    const adsCost = toNumber(product?.ads_cost);
    const operationCost = toNumber(product?.operation_cost);
    const shippingCost = toNumber(product?.shipping_cost);
    const totalUnitCost = costPrice + adsCost + operationCost + shippingCost;
    const primaryDailyVelocity =
      primarySnapshot.sold_units > 0
        ? primarySnapshot.sold_units / primaryWindowDays
        : secondarySnapshot.sold_units > 0
          ? secondarySnapshot.sold_units / secondaryWindowDays
          : 0;
    const daysOfCover =
      primaryDailyVelocity > 0
        ? inventoryQuantity / primaryDailyVelocity
        : null;
    const suggestedReorderUnits =
      primaryDailyVelocity > 0
        ? Math.max(
            0,
            Math.ceil(
              primaryDailyVelocity * GROWTH_CENTER_REORDER_TARGET_DAYS -
                inventoryQuantity,
            ),
          )
        : 0;
    const recentProfit =
      primarySnapshot.revenue - totalUnitCost * primarySnapshot.sold_units;
    const recentMargin =
      primarySnapshot.revenue > 0
        ? (recentProfit / primarySnapshot.revenue) * 100
        : 0;

    let stockStatus = "healthy";
    if (inventoryQuantity <= 0) {
      stockStatus = "out_of_stock";
    } else if (daysOfCover !== null && daysOfCover < 7) {
      stockStatus = "critical";
    } else if (
      inventoryQuantity < LOW_STOCK_THRESHOLD ||
      (daysOfCover !== null && daysOfCover < 14)
    ) {
      stockStatus = "warning";
    } else if (daysOfCover !== null && daysOfCover < 30) {
      stockStatus = "watch";
    }

    if (suppressLowStockAlerts && stockStatus !== "healthy") {
      stockStatus = "healthy";
    }

    return {
      id: product?.id || null,
      route: product?.id ? `/products/${product.id}` : "/products",
      title: String(product?.title || "Untitled product").trim(),
      inventory_quantity: inventoryQuantity,
      cost_price: roundMetric(costPrice),
      total_unit_cost: roundMetric(totalUnitCost),
      sold_units_lookback: roundMetric(primarySnapshot.sold_units),
      sold_units_secondary_window: roundMetric(secondarySnapshot.sold_units),
      sold_units_total: roundMetric(allTimeSnapshot.sold_units),
      recent_revenue: roundMetric(primarySnapshot.revenue),
      recent_profit: roundMetric(recentProfit),
      recent_margin: roundMetric(recentMargin),
      recent_orders_count: toNumber(primarySnapshot.orders_count),
      total_orders_count: toNumber(allTimeSnapshot.orders_count),
      last_sold_at:
        primarySnapshot.last_sold_at ||
        secondarySnapshot.last_sold_at ||
        allTimeSnapshot.last_sold_at,
      daily_velocity: roundMetric(primaryDailyVelocity, 3),
      days_of_cover: daysOfCover === null ? null : roundMetric(daysOfCover, 1),
      suggested_reorder_units: suggestedReorderUnits,
      stock_status: stockStatus,
      suppress_low_stock_alerts: suppressLowStockAlerts,
      missing_saved_costs:
        primarySnapshot.sold_units > 0 &&
        (costPrice <= 0 || totalUnitCost <= 0),
      has_margin_leak:
        primarySnapshot.revenue > 0 &&
        recentMargin < GROWTH_CENTER_LEAK_MARGIN_THRESHOLD,
      can_scale_now:
        primarySnapshot.sold_units >= 2 &&
        recentMargin >= GROWTH_CENTER_SCALE_MARGIN_THRESHOLD &&
        inventoryQuantity >=
          Math.max(8, Math.ceil(primarySnapshot.sold_units * 1.4)) &&
        (daysOfCover === null || daysOfCover >= 14),
      updated_at: getIsoStringOrNull(product?.updated_at),
    };
  });
};

const buildGrowthReplenishmentSnapshot = (productMetrics = []) => {
  const priorities = (productMetrics || [])
    .filter(
      (product) =>
        !product?.suppress_low_stock_alerts &&
        (product?.stock_status !== "healthy" ||
          toNumber(product?.sold_units_lookback) > 0),
    )
    .sort((left, right) => {
      const leftUrgency =
        left?.stock_status === "out_of_stock"
          ? 0
          : left?.stock_status === "critical"
            ? 1
            : left?.stock_status === "warning"
              ? 2
              : 3;
      const rightUrgency =
        right?.stock_status === "out_of_stock"
          ? 0
          : right?.stock_status === "critical"
            ? 1
            : right?.stock_status === "warning"
              ? 2
              : 3;

      if (leftUrgency !== rightUrgency) {
        return leftUrgency - rightUrgency;
      }

      const leftCover = left?.days_of_cover ?? Number.POSITIVE_INFINITY;
      const rightCover = right?.days_of_cover ?? Number.POSITIVE_INFINITY;
      if (leftCover !== rightCover) {
        return leftCover - rightCover;
      }

      return toNumber(right?.recent_revenue) - toNumber(left?.recent_revenue);
    })
    .slice(0, 8)
    .map((product) => ({
      id: product.id,
      title: product.title,
      route: product.route,
      inventory_quantity: product.inventory_quantity,
      sold_units_lookback: product.sold_units_lookback,
      daily_velocity: product.daily_velocity,
      days_of_cover: product.days_of_cover,
      suggested_reorder_units: product.suggested_reorder_units,
      recent_revenue: product.recent_revenue,
      stock_status: product.stock_status,
      note:
        product.stock_status === "out_of_stock"
          ? "Already out of stock while demand exists."
          : product.stock_status === "critical"
            ? "Likely to run out within days at the current sell-through pace."
            : product.stock_status === "warning"
              ? "Stock is low relative to recent demand."
              : "Demand exists; keep an eye on this SKU.",
    }));

  return {
    summary: {
      tracked_products: productMetrics.length,
      out_of_stock_count: productMetrics.filter(
        (product) => product?.stock_status === "out_of_stock",
      ).length,
      urgent_replenishment_count: productMetrics.filter((product) =>
        ["out_of_stock", "critical"].includes(product?.stock_status),
      ).length,
      low_stock_count: productMetrics.filter((product) =>
        ["out_of_stock", "critical", "warning"].includes(product?.stock_status),
      ).length,
      estimated_reorder_units: priorities.reduce(
        (sum, product) => sum + toNumber(product?.suggested_reorder_units),
        0,
      ),
    },
    priorities,
  };
};

const buildGrowthProfitabilitySnapshot = (productMetrics = []) => {
  const productsWithDemand = (productMetrics || []).filter(
    (product) => toNumber(product?.sold_units_lookback) > 0,
  );

  return {
    summary: {
      tracked_products: productMetrics.length,
      active_products: productsWithDemand.length,
      scale_now_count: productsWithDemand.filter(
        (product) => product?.can_scale_now,
      ).length,
      margin_leak_count: productsWithDemand.filter(
        (product) => product?.has_margin_leak,
      ).length,
      missing_cost_count: productsWithDemand.filter(
        (product) => product?.missing_saved_costs,
      ).length,
      profitable_product_count: productsWithDemand.filter(
        (product) => toNumber(product?.recent_profit) > 0,
      ).length,
    },
    scale_now: productsWithDemand
      .filter((product) => product?.can_scale_now)
      .sort(
        (left, right) =>
          toNumber(right?.recent_profit) - toNumber(left?.recent_profit),
      )
      .slice(0, 5),
    margin_leaks: productsWithDemand
      .filter((product) => product?.has_margin_leak)
      .sort(
        (left, right) =>
          toNumber(right?.recent_revenue) - toNumber(left?.recent_revenue),
      )
      .slice(0, 5),
    missing_cost_products: productsWithDemand
      .filter((product) => product?.missing_saved_costs)
      .sort(
        (left, right) =>
          toNumber(right?.recent_revenue) - toNumber(left?.recent_revenue),
      )
      .slice(0, 5),
  };
};

const buildGrowthOrderSummary = (
  orders = [],
  referenceDate = new Date(),
  lookbackDays = GROWTH_CENTER_DEFAULT_LOOKBACK_DAYS,
) => {
  const recentOrders = (orders || []).filter((order) =>
    isWithinDays(order?.created_at, lookbackDays, referenceDate),
  );
  const netRevenue = recentOrders.reduce(
    (sum, order) => sum + getOrderNetSalesAmount(order),
    0,
  );
  const paidOrders = recentOrders.filter(
    (order) => getOrderNetSalesAmount(order) > 0,
  );
  const cancelledOrders = recentOrders.filter((order) =>
    isCancelledOrder(order),
  );
  const refundedOrders = recentOrders.filter((order) => isRefundedOrder(order));
  const pendingOrders = recentOrders.filter((order) => isPendingOrder(order));
  const unfulfilledOrders = recentOrders.filter(
    (order) => getOrderFulfillmentStatus(order) !== "fulfilled",
  );

  return {
    lookback_days: lookbackDays,
    orders_count: recentOrders.length,
    paid_orders_count: paidOrders.length,
    cancelled_orders_count: cancelledOrders.length,
    refunded_orders_count: refundedOrders.length,
    pending_orders_count: pendingOrders.length,
    unfulfilled_orders_count: unfulfilledOrders.length,
    recent_revenue: roundMetric(netRevenue),
    average_order_value:
      paidOrders.length > 0 ? roundMetric(netRevenue / paidOrders.length) : 0,
    cancellation_rate:
      recentOrders.length > 0
        ? roundMetric((cancelledOrders.length / recentOrders.length) * 100)
        : 0,
    refund_rate:
      recentOrders.length > 0
        ? roundMetric((refundedOrders.length / recentOrders.length) * 100)
        : 0,
    pending_order_share:
      recentOrders.length > 0
        ? roundMetric((pendingOrders.length / recentOrders.length) * 100)
        : 0,
  };
};

const buildGrowthHealthSnapshot = ({
  products = [],
  customers = [],
  trackedCustomersCount = null,
  productMetrics = [],
  replenishment = {},
  retention = {},
  profitability = {},
  orderSummary = {},
  freshestActivityAt = null,
  referenceDate = new Date(),
}) => {
  const trackedProducts =
    productMetrics.length || dedupeRowsById(products).length;
  const trackedCustomers = Math.max(
    toNumber(trackedCustomersCount),
    dedupeRowsById(customers).length,
    toNumber(retention?.summary?.tracked_customers),
  );
  const costReadyProducts = productMetrics.filter(
    (product) => toNumber(product?.total_unit_cost) > 0,
  ).length;
  const costCoverageRate =
    trackedProducts > 0
      ? roundMetric((costReadyProducts / trackedProducts) * 100)
      : 100;
  const freshnessDays = getDaysSince(freshestActivityAt, referenceDate);
  const inventoryScore = clampNumber(
    100 -
      toNumber(replenishment?.summary?.urgent_replenishment_count) * 18 -
      toNumber(replenishment?.summary?.low_stock_count) * 4,
  );
  const costScore = clampNumber(
    costCoverageRate -
      toNumber(profitability?.summary?.missing_cost_count) * 8 -
      Math.max(0, toNumber(profitability?.summary?.margin_leak_count) - 1) * 4,
  );
  const retentionScore = clampNumber(
    toNumber(retention?.summary?.repeat_customer_rate) * 1.45 -
      toNumber(retention?.summary?.dormant_count) * 0.8,
  );
  const orderScore = clampNumber(
    100 -
      toNumber(orderSummary?.cancellation_rate) * 1.8 -
      toNumber(orderSummary?.refund_rate) * 1.25 -
      toNumber(orderSummary?.pending_order_share) * 0.8,
  );
  const freshnessScore =
    freshnessDays === null
      ? 45
      : freshnessDays <= 1
        ? 100
        : freshnessDays <= 3
          ? 82
          : freshnessDays <= 7
            ? 62
            : 35;
  const healthScore = roundMetric(
    inventoryScore * 0.25 +
      costScore * 0.2 +
      retentionScore * 0.2 +
      orderScore * 0.2 +
      freshnessScore * 0.15,
    0,
  );
  const healthLabel =
    healthScore >= 85
      ? "Excellent"
      : healthScore >= 72
        ? "Strong"
        : healthScore >= 58
          ? "Watch"
          : "Critical";

  return {
    summary: {
      health_score: healthScore,
      health_label: healthLabel,
      tracked_products: trackedProducts,
      tracked_customers: trackedCustomers,
      recent_revenue: toNumber(orderSummary?.recent_revenue),
      repeat_customer_rate: toNumber(retention?.summary?.repeat_customer_rate),
      cost_coverage_rate: costCoverageRate,
      low_stock_count: toNumber(replenishment?.summary?.low_stock_count),
      urgent_actions_count:
        toNumber(replenishment?.summary?.urgent_replenishment_count) +
        toNumber(profitability?.summary?.missing_cost_count) +
        Math.min(3, toNumber(retention?.summary?.win_back_count)),
      freshness_days: freshnessDays,
      freshest_activity_at: freshestActivityAt,
    },
    health_checks: [
      {
        id: "inventory",
        title: "Inventory pressure",
        score: roundMetric(inventoryScore, 0),
        status: getScoreStatus(inventoryScore),
        metric: `${toNumber(replenishment?.summary?.urgent_replenishment_count)} urgent / ${toNumber(replenishment?.summary?.low_stock_count)} low`,
        detail:
          "Measures whether the current stock can support the SKUs already selling.",
        route: "/products?stockStatus=low_stock",
      },
      {
        id: "costs",
        title: "Cost coverage",
        score: roundMetric(costScore, 0),
        status: getScoreStatus(costScore),
        metric: `${costCoverageRate}% covered`,
        detail:
          "Checks whether saved unit costs are filled in well enough to trust margin decisions.",
        route: "/net-profit",
      },
      {
        id: "retention",
        title: "Retention engine",
        score: roundMetric(retentionScore, 0),
        status: getScoreStatus(retentionScore),
        metric: `${toNumber(retention?.summary?.repeat_customer_rate)}% repeat`,
        detail:
          "Tracks whether current buyers are becoming repeat and high-value customers.",
        route: "/customers",
      },
      {
        id: "orders",
        title: "Order quality",
        score: roundMetric(orderScore, 0),
        status: getScoreStatus(orderScore),
        metric: `${toNumber(orderSummary?.cancellation_rate)}% cancelled / ${toNumber(orderSummary?.refund_rate)}% refunded`,
        detail:
          "Highlights whether the sales coming in are clean enough to scale confidently.",
        route: "/orders",
      },
      {
        id: "freshness",
        title: "Data freshness",
        score: roundMetric(freshnessScore, 0),
        status: getScoreStatus(freshnessScore),
        metric:
          freshnessDays === null
            ? "No recent activity"
            : freshnessDays === 0
              ? "Updated today"
              : `${freshnessDays} day(s) old`,
        detail:
          "Checks how fresh the store activity is before the system issues growth recommendations.",
        route: "/dashboard",
      },
    ],
  };
};

const buildGrowthActions = ({
  replenishment = {},
  profitability = {},
  retention = {},
  orderSummary = {},
}) => {
  const actions = [];
  const urgentReplenishmentCount = toNumber(
    replenishment?.summary?.urgent_replenishment_count,
  );
  const missingCostCount = toNumber(profitability?.summary?.missing_cost_count);
  const marginLeakCount = toNumber(profitability?.summary?.margin_leak_count);
  const scaleNowCount = toNumber(profitability?.summary?.scale_now_count);
  const winBackCount = toNumber(retention?.summary?.win_back_count);
  const dormantCount = toNumber(retention?.summary?.dormant_count);
  const pendingOrderShare = toNumber(orderSummary?.pending_order_share);

  if (urgentReplenishmentCount > 0) {
    actions.push({
      id: "restock-critical-skus",
      priority: "critical",
      title: "Restock fast-moving SKUs before they block growth",
      reason: `${urgentReplenishmentCount} products are already out of stock or close to running out.`,
      action:
        "Approve replenishment quantities for the urgent list and protect best sellers before pushing more traffic.",
      route: "/products?stockStatus=low_stock",
      metric: urgentReplenishmentCount,
    });
  }

  if (missingCostCount > 0) {
    actions.push({
      id: "fill-missing-costs",
      priority: "high",
      title: "Complete saved product costs before trusting margin decisions",
      reason: `${missingCostCount} active products are selling without complete saved cost coverage.`,
      action:
        "Update saved product costs so the system can separate true winners from fake winners.",
      route: "/net-profit",
      metric: missingCostCount,
    });
  }

  if (marginLeakCount > 0) {
    actions.push({
      id: "fix-margin-leaks",
      priority: "high",
      title: "Fix products that are converting but leaking margin",
      reason: `${marginLeakCount} recent products have weak or negative saved margin.`,
      action:
        "Review pricing, saved costs, bundle structure, or fulfillment leakage before scaling them further.",
      route: "/net-profit",
      metric: marginLeakCount,
    });
  }

  if (winBackCount > 0 || dormantCount > 0) {
    actions.push({
      id: "launch-win-back",
      priority: dormantCount > 0 ? "high" : "medium",
      title: "Start a win-back cycle from the existing customer base",
      reason: `${winBackCount} customers are ready for win-back and ${dormantCount} are already dormant.`,
      action:
        "Build a comeback campaign for quiet customers instead of relying only on acquisition spend.",
      route: "/customers",
      metric: winBackCount + dormantCount,
    });
  }

  if (pendingOrderShare >= 20) {
    actions.push({
      id: "reduce-pending-load",
      priority: "medium",
      title: "Reduce pending order exposure",
      reason: `${pendingOrderShare}% of recent orders are still pending.`,
      action:
        "Tighten follow-up and payment confirmation before those orders turn into cancellations.",
      route: "/orders",
      metric: pendingOrderShare,
    });
  }

  if (scaleNowCount > 0) {
    actions.push({
      id: "scale-healthy-skus",
      priority: "growth",
      title: "Push the products that already have margin and stock room",
      reason: `${scaleNowCount} products have healthy saved margin and enough stock to support more demand.`,
      action:
        "Use them in campaigns, bundles, or homepage placement before testing colder ideas.",
      route: "/products",
      metric: scaleNowCount,
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "system-healthy",
      priority: "growth",
      title: "The current store loop is stable",
      reason:
        "No major growth blockers were detected in stock, retention, or saved margin coverage.",
      action:
        "Use the scale candidates and retention segments to push controlled growth.",
      route: "/dashboard",
      metric: 0,
    });
  }

  return actions
    .sort(
      (left, right) =>
        getPriorityRank(left.priority) - getPriorityRank(right.priority),
    )
    .slice(0, 6);
};

const getRequestedStoreId = (req) => {
  const value = req.headers["x-store-id"] || req.query.store_id;
  if (!value) return null;

  const normalized = String(value).trim();
  if (!UUID_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
};

const discoverSingleDashboardStoreId = async () => {
  const discoveredStoreIds = new Set();
  const rememberStoreId = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return;
    }

    discoveredStoreIds.add(normalized);
  };

  const strategies = [
    async () => {
      const { data, error } = await supabase
        .from("stores")
        .select("id")
        .limit(2);
      if (error) {
        throw error;
      }
      return data || [];
    },
    async () => {
      const { data, error } = await supabase
        .from("shopify_tokens")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(2);
      if (error) {
        throw error;
      }
      return data || [];
    },
  ];

  for (const strategy of strategies) {
    try {
      const rows = await strategy();
      for (const row of rows) {
        rememberStoreId(row?.id || row?.store_id);
        if (discoveredStoreIds.size > 1) {
          return null;
        }
      }
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }
    }
  }

  return discoveredStoreIds.size === 1
    ? Array.from(discoveredStoreIds)[0]
    : null;
};

const resolveDashboardScopedStoreId = async ({
  req,
  isAdmin = false,
  accessibleStoreIds = [],
} = {}) => {
  const requestedStoreId = getRequestedStoreId(req);
  if (requestedStoreId) {
    if (isAdmin) {
      return requestedStoreId;
    }

    return accessibleStoreIds.includes(requestedStoreId)
      ? requestedStoreId
      : null;
  }

  if (!isAdmin) {
    return null;
  }

  return await discoverSingleDashboardStoreId();
};

const applyStoreFilter = (rows, storeId) => {
  if (!storeId) return rows;

  const filtered = (rows || []).filter(
    (row) => row?.store_id !== undefined && String(row.store_id) === storeId,
  );

  // Legacy compatibility: if historical rows don't have store_id yet,
  // keep data visible instead of returning an empty dashboard.
  if (filtered.length === 0) {
    const hasOnlyNullStoreIds = (rows || []).every((row) => !row?.store_id);
    if (hasOnlyNullStoreIds) {
      return rows || [];
    }
  }

  return filtered;
};

const getScopedRows = async (req, entityModel) => {
  const isAdmin = req.user?.role === "admin";
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const requestedStoreId = await resolveDashboardScopedStoreId({
    req,
    isAdmin,
    accessibleStoreIds,
  });

  let sourceResult;

  if (isAdmin) {
    // Admin gets all data
    sourceResult = await entityModel.findAll();
  } else {
    // Regular users get only their accessible data — no fallback to all data
    sourceResult = await entityModel.findByUser(req.user.id);
  }

  return applyStoreFilter(sourceResult.data || [], requestedStoreId);
};

const getScopedEntityCount = async (
  req,
  tableName,
  { applyQuery = null } = {},
) => {
  const isAdmin = req.user?.role === "admin";
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const scopedStoreId = await resolveDashboardScopedStoreId({
    req,
    isAdmin,
    accessibleStoreIds,
  });
  let useLegacyUserScope = false;

  while (true) {
    let query = supabase
      .from(tableName)
      .select("id", { count: "exact", head: true });

    if (scopedStoreId) {
      query = query.eq("store_id", scopedStoreId);
    } else if (!isAdmin) {
      if (!useLegacyUserScope && accessibleStoreIds.length > 0) {
        query = query.in("store_id", accessibleStoreIds);
      } else {
        query = query.eq("user_id", req.user.id);
      }
    }

    if (typeof applyQuery === "function") {
      query = applyQuery(query) || query;
    }

    const { count, error } = await measureAsync(
      `dashboard.${tableName}.count`,
      () => query,
      {
        category: "db",
        serverTimingKey: "db",
        serverTimingDescription: "Database queries",
      },
    );

    if (!error) {
      return Number.isFinite(Number(count)) ? Number(count) : 0;
    }

    if (
      !isAdmin &&
      accessibleStoreIds.length > 0 &&
      !scopedStoreId &&
      !useLegacyUserScope
    ) {
      useLegacyUserScope = true;
      continue;
    }

    throw error;
  }
};

const getScopedRowsBatched = async (
  req,
  entityModel,
  {
    select = "*",
    selects = null,
    orderField = "created_at",
    allowUnorderedFallback = false,
    scopeFilters = null,
    maxRows = null,
    applyQuery = null,
    batchSize = DASHBOARD_BATCH_SIZE,
  } = {},
) => {
  const tableName =
    entityModel === Product
      ? "products"
      : entityModel === Order
        ? "orders"
        : entityModel === Customer
          ? "customers"
          : null;

  if (!tableName) {
    throw new Error("Unsupported dashboard entity model");
  }

  const requestedStoreId = getRequestedStoreId(req);
  const isAdmin = req.user?.role === "admin";
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const scopedStoreId = await resolveDashboardScopedStoreId({
    req,
    isAdmin,
    accessibleStoreIds,
  });
  const rows = [];
  const resolvedBatchSize = Number.isFinite(Number(batchSize))
    ? Math.max(1, Math.floor(Number(batchSize)))
    : DASHBOARD_BATCH_SIZE;

  const loadBatch = async (
    selectedColumns,
    currentOrderField,
    offset,
    useLegacyUserScope,
    batchSize,
  ) => {
    const profiler = getRequestProfiler();
    let query = supabase.from(tableName).select(selectedColumns);

    if (currentOrderField) {
      query = query.order(currentOrderField, { ascending: false });
    }

    if (scopedStoreId) {
      query = query.eq("store_id", scopedStoreId);
    } else if (!isAdmin) {
      if (!useLegacyUserScope && accessibleStoreIds.length > 0) {
        query = query.in("store_id", accessibleStoreIds);
      } else {
        query = query.eq("user_id", req.user.id);
      }
    }

    if (tableName === "orders") {
      query = applyOrderDateRangeFilters(query, scopeFilters);
    }

    if (typeof applyQuery === "function") {
      query = applyQuery(query) || query;
    }

    const supportsRange = typeof query?.range === "function";
    if (supportsRange) {
      query = query.range(offset, offset + batchSize - 1);
    }

    const { data, error } = await measureAsync(
      `dashboard.${tableName}.batch`,
      () => query,
      {
        category: "db",
        serverTimingKey: "db",
        serverTimingDescription: "Database queries",
      },
    );
    if (error) {
      throw error;
    }

    profiler.incrementCounter(`${tableName}_batches`, 1);
    profiler.incrementCounter(
      `${tableName}_rows`,
      Array.isArray(data) ? data.length : 0,
    );

    return {
      rows: data || [],
      supportsRange,
    };
  };

  const selectCandidates = [
    ...(Array.isArray(selects) ? selects : []),
    ...(select ? [select] : []),
  ].filter(Boolean);
  const orderFieldCandidates = getOrderFieldFallbacks(orderField, {
    allowUnordered: allowUnorderedFallback,
  });

  let lastError = null;

  for (const selectedColumns of selectCandidates) {
    for (const currentOrderField of orderFieldCandidates) {
      rows.length = 0;
      let offset = 0;
      let useLegacyUserScope = false;

      try {
        while (true) {
          const currentBatchSize =
            Number.isFinite(maxRows) && maxRows > 0
              ? Math.max(1, Math.min(resolvedBatchSize, maxRows - offset))
              : resolvedBatchSize;
          const batch = await loadBatch(
            selectedColumns,
            currentOrderField,
            offset,
            useLegacyUserScope,
            currentBatchSize,
          );

          if (
            !isAdmin &&
            accessibleStoreIds.length > 0 &&
            offset === 0 &&
            batch.rows.length === 0 &&
            !useLegacyUserScope
          ) {
            useLegacyUserScope = true;
            continue;
          }

          rows.push(...batch.rows);

          if (
            Number.isFinite(maxRows) &&
            maxRows > 0 &&
            rows.length >= maxRows
          ) {
            return applyStoreFilter(
              dedupeRowsById(rows.slice(0, maxRows)),
              scopedStoreId,
            );
          }

          if (!batch.supportsRange || batch.rows.length < currentBatchSize) {
            return applyStoreFilter(dedupeRowsById(rows), scopedStoreId);
          }

          offset += batch.rows.length;
        }
      } catch (error) {
        lastError = error;
        if (isSchemaCompatibilityError(error)) {
          continue;
        }

        if (isQueryRetryableError(error)) {
          continue;
        }

        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return applyStoreFilter(dedupeRowsById(rows), scopedStoreId);
};

const getSingleScopedProduct = async (
  req,
  productId,
  selectCandidates = [],
) => {
  const requestedStoreId = getRequestedStoreId(req);
  let lastError = null;

  for (const selectedColumns of (selectCandidates || []).filter(Boolean)) {
    const { data, error } = await measureAsync(
      "dashboard.products.single",
      () =>
        supabase
          .from("products")
          .select(selectedColumns)
          .eq("id", productId)
          .maybeSingle(),
      {
        category: "db",
        serverTimingKey: "db",
        serverTimingDescription: "Database queries",
      },
    );

    if (!error) {
      const filteredRows = applyStoreFilter(
        data ? [data] : [],
        requestedStoreId,
      );
      return filteredRows[0] || null;
    }

    lastError = error;
    if (isSchemaCompatibilityError(error)) {
      continue;
    }

    throw error;
  }

  if (lastError) {
    throw lastError;
  }

  return null;
};

const getOperationalCostsByProduct = async (productIds, userId) => {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    return [];
  }

  let query = supabase
    .from("operational_costs")
    .select(DASHBOARD_OPERATIONAL_COST_SELECT)
    .in("product_id", productIds)
    .eq("is_active", true);

  // Keep non-admin costs scoped to their own rows for compatibility.
  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await measureAsync(
    "dashboard.operational-costs.load",
    () => query,
    {
      category: "db",
      serverTimingKey: "db",
      serverTimingDescription: "Database queries",
    },
  );
  if (error) {
    throw error;
  }

  return data || [];
};

// Dashboard summary cards
router.get("/stats", authenticateToken, async (req, res) => {
  const cacheKey = getDashboardCacheKey(req);
  const profiler = getRequestProfiler();
  const cachedEntry = getFreshCacheEntry(dashboardStatsCache, cacheKey);
  if (cachedEntry) {
    profiler.setMeta("dashboard.stats.cache", "hit");
    res.setHeader("X-Dashboard-Cache", "hit");
    return res.json(cachedEntry.payload);
  }

  try {
    profiler.setMeta("dashboard.stats.cache", "miss");
    const hasScopedOrderFilters = hasActiveOrderScopeFilters(req.query || {});
    const [
      lowStockProductsResult,
      ordersResult,
      totalProductsResult,
      totalCustomersResult,
    ] = await Promise.allSettled([
      getScopedRowsBatched(req, Product, {
        selects: DASHBOARD_PRODUCT_COUNT_SELECTS,
        allowUnorderedFallback: true,
        orderField: "updated_at",
        applyQuery: (query) =>
          query
            .gt("inventory_quantity", 0)
            .lt("inventory_quantity", LOW_STOCK_THRESHOLD),
      }),
      getScopedRowsBatched(req, Order, {
        selects: hasScopedOrderFilters
          ? DASHBOARD_ORDER_FILTERED_STATS_SELECTS
          : DASHBOARD_ORDER_STATS_SELECTS,
        allowUnorderedFallback: true,
        scopeFilters: req.query || {},
        maxRows: DASHBOARD_STATS_ORDER_SCAN_LIMIT,
      }),
      hasScopedOrderFilters
        ? Promise.resolve(null)
        : getScopedEntityCount(req, "products"),
      hasScopedOrderFilters
        ? Promise.resolve(null)
        : getScopedEntityCount(req, "customers"),
    ]);
    const lowStockProducts =
      lowStockProductsResult.status === "fulfilled"
        ? lowStockProductsResult.value
        : [];
    const orders =
      ordersResult.status === "fulfilled" ? ordersResult.value : [];
    const totalProducts =
      totalProductsResult.status === "fulfilled"
        ? Number(totalProductsResult.value || 0)
        : null;
    const totalCustomers =
      totalCustomersResult.status === "fulfilled"
        ? Number(totalCustomersResult.value || 0)
        : null;
    const dataGaps = [];

    if (lowStockProductsResult.status === "rejected") {
      console.error(
        "Dashboard low-stock stats query failed:",
        lowStockProductsResult.reason,
      );
      dataGaps.push("low_stock_products");
    }
    if (ordersResult.status === "rejected") {
      console.error(
        "Dashboard orders stats query failed:",
        ordersResult.reason,
      );
      dataGaps.push("orders");
    }
    if (totalProductsResult.status === "rejected") {
      console.error(
        "Dashboard products count query failed:",
        totalProductsResult.reason,
      );
      dataGaps.push("products");
    }
    if (totalCustomersResult.status === "rejected") {
      console.error(
        "Dashboard customers count query failed:",
        totalCustomersResult.reason,
      );
      dataGaps.push("customers");
    }

    const payload = measureSync(
      "dashboard.stats.compute",
      () => {
        const filteredOrders = filterOrdersByScope(orders, req.query || {});
        const { saleOrders, totalOrderValue, totalSales, pendingOrderValue } =
          calculateDashboardOrderStats(filteredOrders);
        const lowStockProductsCount = countLowStockProducts(lowStockProducts);
        const filteredEntitySummary = hasScopedOrderFilters
          ? buildFilteredOrderEntitySummary(filteredOrders)
          : {
              totalProducts: Number.isFinite(totalProducts) ? totalProducts : 0,
              totalCustomers: Number.isFinite(totalCustomers)
                ? totalCustomers
                : new Set(
                    filteredOrders
                      .map((order) => getOrderCustomerKey(order))
                      .filter(Boolean),
                  ).size,
            };

        return {
          total_sales: parseFloat(totalSales.toFixed(2)),
          total_order_value: parseFloat(totalOrderValue.toFixed(2)),
          pending_order_value: parseFloat(pendingOrderValue.toFixed(2)),
          total_orders: filteredOrders.length,
          total_products: filteredEntitySummary.totalProducts,
          total_customers: filteredEntitySummary.totalCustomers,
          low_stock_products: lowStockProductsCount,
          orders_window_limit: DASHBOARD_STATS_ORDER_SCAN_LIMIT,
          paid_orders_count: saleOrders.length,
          avg_order_value:
            saleOrders.length > 0
              ? parseFloat((totalSales / saleOrders.length).toFixed(2))
              : 0,
          degraded: dataGaps.length > 0,
          data_gaps: dataGaps,
        };
      },
      {
        category: "app",
        serverTimingKey: "app",
        serverTimingDescription: "Server processing",
      },
    );

    rememberCacheEntry(dashboardStatsCache, cacheKey, payload);
    ensureLowStockNotifications(lowStockProducts).catch((notificationError) => {
      console.error(
        "Low-stock notification dispatch failed:",
        notificationError,
      );
    });
    res.json(payload);
  } catch (error) {
    console.error("Dashboard stats error:", error);
    const staleEntry = dashboardStatsCache.get(cacheKey);
    if (staleEntry?.payload) {
      res.setHeader("X-Dashboard-Cache", "stale");
      return res.json(staleEntry.payload);
    }
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

router.get(
  "/growth-center",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    const lookbackDays = normalizeGrowthLookbackDays(req.query?.days);
    const cacheKey = `${getDashboardCacheKey(req)}::growth-center::${lookbackDays}`;
    const profiler = getRequestProfiler();
    const cachedEntry = getFreshCacheEntry(
      dashboardGrowthCenterCache,
      cacheKey,
    );
    if (cachedEntry) {
      profiler.setMeta("dashboard.growth-center.cache", "hit");
      res.setHeader("X-Dashboard-Cache", "hit");
      return res.json(cachedEntry.payload);
    }

    try {
      profiler.setMeta("dashboard.growth-center.cache", "miss");

      const referenceDate = new Date();
      const historyWindowStart = addDays(
        referenceDate,
        -GROWTH_CENTER_ORDERS_HISTORY_DAYS,
      );
      const orderScopeFilters = {
        date_from: historyWindowStart.toISOString().slice(0, 10),
        date_to: referenceDate.toISOString().slice(0, 10),
      };

      const [products, orders, recentCustomers, trackedCustomersCount] =
        await Promise.all([
          getScopedRowsBatched(req, Product, {
            selects: GROWTH_CENTER_PRODUCT_SELECTS,
            allowUnorderedFallback: true,
            batchSize: DASHBOARD_LARGE_BATCH_SIZE,
          }),
          getScopedRowsBatched(req, Order, {
            selects: GROWTH_CENTER_ORDER_SELECTS,
            allowUnorderedFallback: true,
            scopeFilters: orderScopeFilters,
            batchSize: DASHBOARD_LARGE_BATCH_SIZE,
          }),
          getScopedRowsBatched(req, Customer, {
            selects: GROWTH_CENTER_CUSTOMER_SELECTS,
            allowUnorderedFallback: true,
            orderField: "updated_at",
            maxRows: 1,
            batchSize: 1,
          }),
          getScopedEntityCount(req, "customers"),
        ]);

      const payload = measureSync(
        "dashboard.growth-center.compute",
        () => {
          const customerProfiles = buildGrowthCustomerProfiles(
            orders,
            referenceDate,
          );
          const retention = buildGrowthRetentionSnapshot(
            customerProfiles,
            referenceDate,
          );
          const productMetrics = buildGrowthProductMetrics({
            products,
            orders,
            referenceDate,
            primaryWindowDays: lookbackDays,
          });
          const replenishment =
            buildGrowthReplenishmentSnapshot(productMetrics);
          const profitability =
            buildGrowthProfitabilitySnapshot(productMetrics);
          const orderSummary = buildGrowthOrderSummary(
            orders,
            referenceDate,
            lookbackDays,
          );
          const freshestActivityAt = getFreshestTimestamp(
            products.map((product) => product?.updated_at),
            recentCustomers.flatMap((customer) => [
              customer?.updated_at,
              customer?.created_at,
            ]),
            orders.flatMap((order) => [order?.updated_at, order?.created_at]),
          );
          const health = buildGrowthHealthSnapshot({
            products,
            customers: recentCustomers,
            trackedCustomersCount,
            productMetrics,
            replenishment,
            retention,
            profitability,
            orderSummary,
            freshestActivityAt,
            referenceDate,
          });
          const recommendedActions = buildGrowthActions({
            replenishment,
            profitability,
            retention,
            orderSummary,
          });

          return {
            generated_at: referenceDate.toISOString(),
            lookback_days: lookbackDays,
            summary: {
              ...health.summary,
              recent_revenue: roundMetric(orderSummary.recent_revenue),
              active_customers: toNumber(retention?.summary?.active_customers),
              scale_now_count: toNumber(
                profitability?.summary?.scale_now_count,
              ),
              win_back_count: toNumber(retention?.summary?.win_back_count),
            },
            health_checks: health.health_checks,
            recommended_actions: recommendedActions,
            replenishment,
            retention,
            profitability,
            order_summary: orderSummary,
          };
        },
        {
          category: "app",
          serverTimingKey: "app",
          serverTimingDescription: "Server processing",
        },
      );

      rememberCacheEntry(dashboardGrowthCenterCache, cacheKey, payload);
      res.json(payload);
    } catch (error) {
      console.error("Growth center error:", error);
      const staleEntry = dashboardGrowthCenterCache.get(cacheKey);
      if (staleEntry?.payload) {
        res.setHeader("X-Dashboard-Cache", "stale");
        return res.json(staleEntry.payload);
      }
      res.status(500).json({ error: "Failed to build growth center" });
    }
  },
);

// Advanced analytics (admin only)
router.get(
  "/analytics",
  authenticateToken,
  requireAdminRole,
  async (req, res) => {
    const cacheKey = getDashboardCacheKey(req);
    const profiler = getRequestProfiler();
    const cachedEntry = getFreshCacheEntry(dashboardAnalyticsCache, cacheKey);
    if (cachedEntry) {
      profiler.setMeta("dashboard.analytics.cache", "hit");
      res.setHeader("X-Dashboard-Cache", "hit");
      return res.json(cachedEntry.payload);
    }

    try {
      profiler.setMeta("dashboard.analytics.cache", "miss");
      const orderScopeFilters = normalizeOrderScopeFilters(req.query || {});
      const orders = await getScopedRowsBatched(req, Order, {
        selects: DASHBOARD_ORDER_ANALYTICS_SELECTS,
        allowUnorderedFallback: true,
        scopeFilters: orderScopeFilters,
        batchSize: DASHBOARD_LARGE_BATCH_SIZE,
      });

      const payload = measureSync(
        "dashboard.analytics.compute",
        () => {
          const allOrders = filterOrdersByScope(
            orders || [],
            orderScopeFilters,
          );
          const paidOrders = allOrders.filter((order) => isPaidOrder(order));
          const refundedOrders = allOrders.filter((order) =>
            isRefundedOrder(order),
          );
          const cancelledOrders = allOrders.filter((order) =>
            isCancelledOrder(order),
          );

          const ordersByStatus = {
            pending: allOrders.filter((order) => isPendingOrder(order)).length,
            paid: paidOrders.length,
            refunded: refundedOrders.length,
            cancelled: cancelledOrders.length,
            fulfilled: allOrders.filter((o) => {
              const s = String(o.fulfillment_status || "")
                .toLowerCase()
                .trim();
              return s === "fulfilled";
            }).length,
            unfulfilled: allOrders.filter((o) => {
              const s = String(o.fulfillment_status || "")
                .toLowerCase()
                .trim();
              return s === "" || s === "unfulfilled" || s === "null";
            }).length,
          };

          const totalRevenue = allOrders.reduce(
            (sum, order) => sum + getOrderGrossSalesAmount(order),
            0,
          );
          const refundedAmount = allOrders.reduce(
            (sum, order) => sum + getOrderRefundedAmount(order),
            0,
          );
          const netRevenue = Math.max(0, totalRevenue - refundedAmount);
          const revenueOrders = allOrders.filter(
            (order) => getOrderGrossSalesAmount(order) > 0,
          );
          const pendingAmount = allOrders
            .filter((order) => isPendingOrder(order))
            .reduce((sum, order) => sum + getOrderGrossAmount(order), 0);
          const timeline = buildAnalyticsTrends(allOrders, orderScopeFilters);

          const productRevenueMap = new Map();
          revenueOrders.forEach((order) => {
            const grossOrderAmount = getOrderGrossSalesAmount(order);
            const netOrderAmount = getOrderNetSalesAmount(order);
            const netRatio =
              grossOrderAmount > 0
                ? Math.min(1, Math.max(0, netOrderAmount / grossOrderAmount))
                : 0;
            if (netRatio <= 0) {
              return;
            }

            parseLineItems(order).forEach((item) => {
              const productKey = String(
                item.product_id || item.id || item.sku || "",
              );
              if (!productKey) return;

              const quantity = toNumber(item.quantity || 0);
              const lineRevenue =
                toNumber(item.price || 0) * quantity * netRatio;
              const current = productRevenueMap.get(productKey) || {
                product_id: item.product_id || null,
                title: item.title || item.name || "Unknown product",
                total_revenue: 0,
                total_quantity: 0,
                orders_count: 0,
              };

              current.total_revenue += lineRevenue;
              current.total_quantity += quantity;
              current.orders_count += 1;
              productRevenueMap.set(productKey, current);
            });
          });

          const topProducts = Array.from(productRevenueMap.values())
            .sort((a, b) => b.total_revenue - a.total_revenue)
            .slice(0, 10)
            .map((item) => ({
              ...item,
              total_revenue: parseFloat(item.total_revenue.toFixed(2)),
            }));

          const customerSpendMap = new Map();
          allOrders.forEach((order) => {
            const data = parseOrderData(order);
            const key = getOrderCustomerKey(order);
            if (!key) return;

            const current = customerSpendMap.get(key) || {
              customer_id: null,
              email:
                order.customer_email ||
                order.email ||
                data?.email ||
                data?.customer?.email ||
                "",
              name: order.customer_name || data?.customer?.name || "",
              orders_count: 0,
              total_spent: 0,
            };

            current.orders_count += 1;
            current.total_spent += getOrderNetSalesAmount(order);
            customerSpendMap.set(key, current);
          });

          const topCustomers = Array.from(customerSpendMap.values())
            .sort((a, b) => b.total_spent - a.total_spent)
            .slice(0, 10)
            .map((entry) => ({
              ...entry,
              name: entry.name || entry.email || "",
              total_spent: parseFloat(entry.total_spent.toFixed(2)),
            }));

          const totalOrders = allOrders.length;
          return {
            ordersByStatus,
            financial: {
              totalRevenue: parseFloat(totalRevenue.toFixed(2)),
              refundedAmount: parseFloat(refundedAmount.toFixed(2)),
              pendingAmount: parseFloat(pendingAmount.toFixed(2)),
              netRevenue: parseFloat(netRevenue.toFixed(2)),
            },
            topProducts,
            topCustomers,
            summary: {
              totalOrders,
              successRate:
                totalOrders > 0
                  ? parseFloat(
                      ((ordersByStatus.paid / totalOrders) * 100).toFixed(2),
                    )
                  : 0,
              cancellationRate:
                totalOrders > 0
                  ? parseFloat(
                      ((ordersByStatus.cancelled / totalOrders) * 100).toFixed(
                        2,
                      ),
                    )
                  : 0,
              refundRate:
                totalOrders > 0
                  ? parseFloat(
                      ((ordersByStatus.refunded / totalOrders) * 100).toFixed(
                        2,
                      ),
                    )
                  : 0,
            },
            meta: {
              filters: orderScopeFilters,
              trendGranularity: timeline.granularity,
              dateRange: timeline.range,
            },
            monthlyTrends: timeline.trends,
          };
        },
        {
          category: "app",
          serverTimingKey: "app",
          serverTimingDescription: "Server processing",
        },
      );

      rememberCacheEntry(dashboardAnalyticsCache, cacheKey, payload);
      res.json(payload);
    } catch (error) {
      console.error("Analytics error:", error);
      const staleEntry = dashboardAnalyticsCache.get(cacheKey);
      if (staleEntry?.payload) {
        res.setHeader("X-Dashboard-Cache", "stale");
        return res.json(staleEntry.payload);
      }
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  },
);

// Customers list
router.get(
  "/customers",
  authenticateToken,
  requirePermission("can_view_customers"),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const offset = parseInt(req.query.offset, 10) || 0;

      const customers = await getScopedRowsBatched(req, Customer);
      const sorted = [...customers].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      const paginated = sorted.slice(offset, offset + limit);

      res.json({
        data: paginated,
        total: sorted.length,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Dashboard customers error:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  },
);

// Products list with profitability metrics (admin only)
router.get(
  "/products",
  authenticateToken,
  requireAdminRole,
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const offset = parseInt(req.query.offset, 10) || 0;

      const [products, orders] = await Promise.all([
        getScopedRowsBatched(req, Product, {
          selects: DASHBOARD_PRODUCT_PROFITABILITY_SELECTS,
          allowUnorderedFallback: true,
        }),
        getScopedRowsBatched(req, Order, {
          selects: DASHBOARD_ORDER_PROFITABILITY_SELECTS,
          allowUnorderedFallback: true,
          scopeFilters: req.query,
        }),
      ]);

      const productIds = products.map((p) => p.id);
      const scopedUserId = req.user?.role === "admin" ? null : req.user?.id;
      const productCosts = await getOperationalCostsByProduct(
        productIds,
        scopedUserId,
      );

      const { paginated, total, summary } = measureSync(
        "dashboard.products.compute",
        () =>
          computeNetProfitMetrics({
            products,
            orders,
            productCosts,
            limit,
            offset,
          }),
        {
          category: "app",
          serverTimingKey: "app",
          serverTimingDescription: "Server processing",
        },
      );

      res.json({
        data: paginated,
        total,
        limit,
        offset,
        summary: {
          total_revenue: parseFloat(summary.total_revenue.toFixed(2)),
          total_cost: parseFloat(summary.total_cost.toFixed(2)),
          total_gross_profit: parseFloat(summary.total_gross_profit.toFixed(2)),
          total_operational_costs: parseFloat(
            summary.total_operational_costs.toFixed(2),
          ),
          total_return_cost: parseFloat(summary.total_return_cost.toFixed(2)),
          total_net_profit: parseFloat(summary.total_net_profit.toFixed(2)),
          total_sold_units: parseFloat(summary.total_sold_units.toFixed(2)),
          total_returned_units: parseFloat(
            summary.total_returned_units.toFixed(2),
          ),
          total_returned_orders: parseFloat(
            summary.total_returned_orders.toFixed(2),
          ),
          profit_margin: summary.profit_margin,
        },
      });
    } catch (error) {
      console.error("Dashboard products error:", error);
      res.status(500).json({ error: "Failed to fetch products profitability" });
    }
  },
);

router.get(
  "/products/:id/fulfilled-profit",
  authenticateToken,
  requireAdminRole,
  async (req, res) => {
    try {
      const { id } = req.params;

      const product = await getSingleScopedProduct(
        req,
        id,
        DASHBOARD_PRODUCT_FULFILLED_PROFIT_SELECTS,
      );

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      const [orders, productOperationalCosts] = await Promise.all([
        getScopedRowsBatched(req, Order, {
          selects: DASHBOARD_ORDER_FULFILLED_PROFIT_SELECTS,
          allowUnorderedFallback: true,
        }),
        getOperationalCostsByProduct([product.id], null),
      ]);

      const payload = measureSync(
        "dashboard.fulfilled-profit.compute",
        () => {
          const productMatchKeys = buildProductOrderMatchKeys(product);
          let fulfilledUnits = 0;
          let successfulOrdersCount = 0;
          let totalRevenue = 0;

          orders
            .filter(
              (order) =>
                !isCancelledOrder(order) &&
                getOrderFulfillmentStatus(order) === "fulfilled" &&
                getOrderBookedNetAmount(order) > 0,
            )
            .forEach((order) => {
              const grossOrderAmount = getOrderBookedGrossAmount(order);
              const netOrderAmount = getOrderBookedNetAmount(order);
              const netRatio =
                grossOrderAmount > 0
                  ? Math.min(1, Math.max(0, netOrderAmount / grossOrderAmount))
                  : 0;

              if (netRatio <= 0) {
                return;
              }

              let orderMatched = false;
              parseLineItems(order).forEach((item) => {
                const itemKeys = [
                  String(item?.product_id || ""),
                  String(item?.variant_id || ""),
                  String(item?.id || ""),
                  String(item?.sku || ""),
                ].filter(Boolean);

                if (!itemKeys.some((key) => productMatchKeys.has(key))) {
                  return;
                }

                const quantity = toNumber(item?.quantity || 0) * netRatio;
                const unitPrice = toNumber(item?.price || 0);

                fulfilledUnits += quantity;
                totalRevenue += quantity * unitPrice;
                orderMatched = true;
              });

              if (orderMatched) {
                successfulOrdersCount += 1;
              }
            });

          const unitCost = toNumber(product.cost_price);
          const adsCost = toNumber(product.ads_cost);
          const operationCost = toNumber(product.operation_cost);
          const shippingCost = toNumber(product.shipping_cost);
          const totalUnitCost =
            unitCost + adsCost + operationCost + shippingCost;
          const savedProductCostsTotal = totalUnitCost * fulfilledUnits;
          const grossProfit = totalRevenue - savedProductCostsTotal;

          const perUnitCosts = productOperationalCosts
            .filter((cost) => String(cost?.apply_to || "") === "per_unit")
            .reduce((sum, cost) => sum + toNumber(cost.amount), 0);
          const perOrderCosts = productOperationalCosts
            .filter((cost) => String(cost?.apply_to || "") === "per_order")
            .reduce((sum, cost) => sum + toNumber(cost.amount), 0);
          const fixedCosts = productOperationalCosts
            .filter((cost) => String(cost?.apply_to || "") === "fixed")
            .reduce((sum, cost) => sum + toNumber(cost.amount), 0);

          const totalOperationalCosts =
            perUnitCosts * fulfilledUnits +
            perOrderCosts * successfulOrdersCount +
            fixedCosts;
          const netProfit = grossProfit - totalOperationalCosts;
          const profitMargin =
            totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

          return {
            successful_orders_count: successfulOrdersCount,
            fulfilled_units: parseFloat(fulfilledUnits.toFixed(2)),
            total_revenue: parseFloat(totalRevenue.toFixed(2)),
            total_unit_cost: parseFloat(totalUnitCost.toFixed(2)),
            saved_product_costs_total: parseFloat(
              savedProductCostsTotal.toFixed(2),
            ),
            total_operational_costs: parseFloat(
              totalOperationalCosts.toFixed(2),
            ),
            gross_profit: parseFloat(grossProfit.toFixed(2)),
            net_profit: parseFloat(netProfit.toFixed(2)),
            profit_margin: parseFloat(profitMargin.toFixed(2)),
          };
        },
        {
          category: "app",
          serverTimingKey: "app",
          serverTimingDescription: "Server processing",
        },
      );

      res.json(payload);
    } catch (error) {
      console.error("Dashboard product fulfilled profit error:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch product fulfilled profitability" });
    }
  },
);

// Orders list
router.get(
  "/orders",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const offset = parseInt(req.query.offset, 10) || 0;

      const orders = await getScopedRowsBatched(req, Order);
      const sorted = [...orders].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      const paginated = sorted.slice(offset, offset + limit);

      res.json({
        data: paginated,
        total: sorted.length,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Dashboard orders error:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  },
);

// Update product cost price (admin only)
router.put(
  "/products/:id",
  authenticateToken,
  requireAdminRole,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { cost_price, ads_cost, operation_cost, shipping_cost } = req.body;

      const updates = {};

      if (cost_price !== undefined) {
        updates.cost_price = parseEditableCostField(cost_price, "Cost price");
      }
      if (ads_cost !== undefined) {
        updates.ads_cost = parseEditableCostField(ads_cost, "Ads cost");
      }
      if (operation_cost !== undefined) {
        updates.operation_cost = parseEditableCostField(
          operation_cost,
          "Operation cost",
        );
      }
      if (shipping_cost !== undefined) {
        updates.shipping_cost = parseEditableCostField(
          shipping_cost,
          "Shipping cost",
        );
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No cost updates provided" });
      }

      const result = await ProductUpdateService.updateProduct(
        req.user.id,
        id,
        updates,
      );

      res.json(result);
    } catch (error) {
      console.error("Update product cost fields error:", error);
      res
        .status(
          /invalid|negative|maximum allowed|not found/i.test(error.message)
            ? 400
            : 500,
        )
        .json({ error: error.message || "Failed to update cost fields" });
    }
  },
);

export default router;
