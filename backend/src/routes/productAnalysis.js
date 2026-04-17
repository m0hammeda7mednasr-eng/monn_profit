import express from "express";
import { supabase as db } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { getAccessibleStoreIds } from "../models/index.js";
import { applyUserFilter } from "../helpers/dataFilter.js";
import {
  PAID_LIKE_STATUSES,
  getLineItemBookedAmount,
  getOrderFinancialStatus,
  getOrderFulfillmentStatus,
  getOrderGrossAmount,
  getOrderRefundedAmount,
  isCancelledOrder,
  parseOrderData,
} from "../helpers/orderAnalytics.js";
import {
  filterOrdersByScope,
  getOrderScopeFiltersCacheKey,
  hasActiveOrderScopeFilters,
  normalizeOrderScopeFilters,
} from "../helpers/orderScope.js";

const router = express.Router();
const RETURNED_ORDER_STATUSES = new Set(["restocked"]);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 3 * 60 * 1000;
const SCOPED_ROWS_BATCH_SIZE = 1000;
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const PRODUCTS_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "title",
  "vendor",
  "product_type",
  "sku",
  "price",
  "inventory_quantity",
  "created_at",
  "updated_at",
  "last_synced_at",
  "data",
].join(",");
const PRODUCTS_SELECTS = [
  PRODUCTS_SELECT,
  [
    "id",
    "shopify_id",
    "store_id",
    "title",
    "vendor",
    "product_type",
    "sku",
    "price",
    "inventory_quantity",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
];
const ORDERS_SELECT = [
  "id",
  "store_id",
  "order_number",
  "customer_name",
  "customer_email",
  "financial_status",
  "status",
  "fulfillment_status",
  "total_price",
  "total_refunded",
  "cancelled_at",
  "created_at",
  "updated_at",
  "data",
].join(",");
const ORDERS_SELECTS = [
  ORDERS_SELECT,
  [
    "id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "financial_status",
    "status",
    "fulfillment_status",
    "total_price",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "status",
    "fulfillment_status",
    "total_price",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
];
const TASKS_SELECT = "id,title,description,status,due_date,created_at,updated_at";

const analyticsCache = new Map();

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseJsonField = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
};

const normalizeKey = (value) => String(value || "").trim();

const normalizeIdentifier = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeSku = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

const normalizeVariantTitle = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "default title") {
    return "";
  }

  return normalized.toLowerCase();
};

const extractIdentifierVariants = (value) => {
  const normalized = normalizeKey(value);
  if (!normalized) {
    return [];
  }

  const candidates = new Set([normalizeIdentifier(normalized)]);
  const numericIdMatch = normalized.match(/(?:^|\/)(\d+)(?:[/?#].*)?$/);
  if (numericIdMatch?.[1]) {
    candidates.add(numericIdMatch[1]);
  }

  return Array.from(candidates).filter(Boolean);
};

const rememberIdentifier = (map, value, entry) => {
  for (const candidate of extractIdentifierVariants(value)) {
    map.set(candidate, entry);
  }
};

const resolveIdentifierMatch = (map, values = []) => {
  for (const value of values) {
    for (const candidate of extractIdentifierVariants(value)) {
      if (map.has(candidate)) {
        return map.get(candidate);
      }
    }
  }

  return null;
};

const rememberSku = (map, value, entry) => {
  const normalizedSku = normalizeSku(value);
  if (normalizedSku) {
    map.set(normalizedSku, entry);
  }
};

const resolveSkuMatch = (map, values = []) => {
  for (const value of values) {
    const normalizedSku = normalizeSku(value);
    if (normalizedSku && map.has(normalizedSku)) {
      return map.get(normalizedSku);
    }
  }

  return null;
};

const isRestockedOrder = (order) => {
  const financialStatus = getOrderFinancialStatus(order);
  const fulfillmentStatus = getOrderFulfillmentStatus(order);

  return (
    RETURNED_ORDER_STATUSES.has(financialStatus) ||
    RETURNED_ORDER_STATUSES.has(fulfillmentStatus)
  );
};

const isSchemaCompatibilityError = (error) => {
  if (!error) {
    return false;
  }

  if (SCHEMA_ERROR_CODES.has(String(error.code || ""))) {
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

const getRequestedStoreId = (req) => {
  const candidates = [req.headers["x-store-id"], req.query?.store_id];

  for (const value of candidates) {
    const normalized = normalizeKey(value);
    if (UUID_REGEX.test(normalized)) {
      return normalized;
    }
  }

  return null;
};

const resolveIsAdmin = (req) =>
  Boolean(req.user?.isAdmin || String(req.user?.role || "").toLowerCase() === "admin");

const getAdminStoreIds = async () => {
  const strategies = [
    async () => {
      const { data, error } = await db.from("stores").select("id");
      if (error) {
        throw error;
      }
      return (data || []).map((row) => normalizeKey(row?.id)).filter(Boolean);
    },
    async () => {
      const { data, error } = await db
        .from("products")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(200);
      if (error) {
        throw error;
      }
      return Array.from(
        new Set(
          (data || [])
            .map((row) => normalizeKey(row?.store_id))
            .filter(Boolean),
        ),
      );
    },
  ];

  for (const strategy of strategies) {
    try {
      const storeIds = await strategy();
      if (storeIds.length > 0) {
        return storeIds;
      }
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }
    }
  }

  return [];
};

const resolveStoreContext = async (req) => {
  const requestedStoreId = getRequestedStoreId(req);
  const isAdmin = resolveIsAdmin(req);

  if (isAdmin) {
    if (requestedStoreId) {
      return {
        isAdmin,
        storeId: requestedStoreId,
      };
    }

    const adminStoreIds = await getAdminStoreIds();
    if (adminStoreIds.length === 1) {
      return {
        isAdmin,
        storeId: adminStoreIds[0],
      };
    }

    if (adminStoreIds.length === 0) {
      throw createHttpError(400, "No connected store is available yet");
    }

    throw createHttpError(400, "Select a store first before opening product analysis");
  }

  const accessibleStoreIds = await getAccessibleStoreIds(req.user?.id);

  if (requestedStoreId) {
    if (
      accessibleStoreIds.length === 0 ||
      !accessibleStoreIds.includes(requestedStoreId)
    ) {
      throw createHttpError(403, "Access denied for the selected store");
    }

    return {
      isAdmin,
      storeId: requestedStoreId,
    };
  }

  if (accessibleStoreIds.length === 1) {
    return {
      isAdmin,
      storeId: accessibleStoreIds[0],
    };
  }

  if (accessibleStoreIds.length === 0) {
    throw createHttpError(400, "No store is connected to this account yet");
  }

  throw createHttpError(400, "Select a store first before opening product analysis");
};

const getProductVariants = (product) => {
  const parsedData = parseJsonField(product?.data);
  return Array.isArray(parsedData?.variants) ? parsedData.variants : [];
};

const getProductImageUrl = (product) => {
  const parsedData = parseJsonField(product?.data);
  return (
    parsedData?.image?.src ||
    parsedData?.image?.url ||
    parsedData?.featured_image?.src ||
    product?.image_url ||
    null
  );
};

const buildSyntheticVariant = (product) => ({
  id: product?.shopify_id || product?.id || null,
  title: product?.title || "Default",
  sku: product?.sku || "",
  barcode: "",
  price: product?.price ?? null,
  inventory_quantity: product?.inventory_quantity ?? 0,
});

const getLineItems = (order) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }

  const data = parseOrderData(order);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const buildRefundDetails = (order) => {
  const data = parseOrderData(order);
  const refunds = Array.isArray(data?.refunds) ? data.refunds : [];
  const quantityByLineItemId = new Map();
  const amountByLineItemId = new Map();
  const latestAtByLineItemId = new Map();

  for (const refund of refunds) {
    const refundAt = refund?.created_at || order?.updated_at || order?.created_at || null;
    const refundLineItems = Array.isArray(refund?.refund_line_items)
      ? refund.refund_line_items
      : [];

    for (const entry of refundLineItems) {
      const lineItemId = normalizeKey(
        entry?.line_item_id || entry?.line_item?.id || entry?.line_item?.line_item_id,
      );
      if (!lineItemId) {
        continue;
      }

      quantityByLineItemId.set(
        lineItemId,
        toNumber(quantityByLineItemId.get(lineItemId)) + toNumber(entry?.quantity),
      );
      amountByLineItemId.set(
        lineItemId,
        toNumber(amountByLineItemId.get(lineItemId)) +
          Math.max(
            toNumber(entry?.subtotal),
            toNumber(entry?.line_item?.price) * toNumber(entry?.quantity),
          ),
      );

      if (refundAt) {
        const previous = latestAtByLineItemId.get(lineItemId);
        if (!previous || new Date(refundAt).getTime() > new Date(previous).getTime()) {
          latestAtByLineItemId.set(lineItemId, refundAt);
        }
      }
    }
  }

  return {
    quantityByLineItemId,
    amountByLineItemId,
    latestAtByLineItemId,
    isFullyRefunded:
      isRestockedOrder(order) ||
      getOrderGrossAmount(order) > 0 &&
      getOrderRefundedAmount(order) >= getOrderGrossAmount(order),
  };
};

const buildFulfillmentDetails = (order) => {
  const data = parseOrderData(order);
  const fulfillments = Array.isArray(data?.fulfillments) ? data.fulfillments : [];
  const quantityByLineItemId = new Map();
  const latestAtByLineItemId = new Map();

  for (const fulfillment of fulfillments) {
    const fulfillmentAt =
      fulfillment?.created_at || fulfillment?.updated_at || order?.updated_at || order?.created_at || null;
    const lineItems = Array.isArray(fulfillment?.line_items)
      ? fulfillment.line_items
      : [];

    for (const item of lineItems) {
      const lineItemId = normalizeKey(
        item?.id || item?.line_item_id || item?.line_item?.id,
      );
      if (!lineItemId) {
        continue;
      }

      quantityByLineItemId.set(
        lineItemId,
        toNumber(quantityByLineItemId.get(lineItemId)) + toNumber(item?.quantity),
      );

      if (fulfillmentAt) {
        const previous = latestAtByLineItemId.get(lineItemId);
        if (!previous || new Date(fulfillmentAt).getTime() > new Date(previous).getTime()) {
          latestAtByLineItemId.set(lineItemId, fulfillmentAt);
        }
      }
    }
  }

  return {
    quantityByLineItemId,
    latestAtByLineItemId,
  };
};

const getItemRefundedQuantity = (item, refundDetails, order) => {
  const lineItemId = normalizeKey(item?.id || item?.line_item_id);
  const explicitRefundQuantity = toNumber(
    refundDetails.quantityByLineItemId.get(lineItemId),
  );
  if (explicitRefundQuantity > 0) {
    return explicitRefundQuantity;
  }

  const orderedQuantity = toNumber(item?.quantity);
  const currentQuantity = toNumber(item?.current_quantity);
  const hasCurrentQuantity =
    item?.current_quantity !== undefined &&
    item?.current_quantity !== null &&
    String(item.current_quantity).trim() !== "";
  if (
    orderedQuantity > 0 &&
    hasCurrentQuantity &&
    currentQuantity < orderedQuantity
  ) {
    return orderedQuantity - currentQuantity;
  }

  if (refundDetails.isFullyRefunded || isRestockedOrder(order)) {
    return orderedQuantity;
  }

  return 0;
};

const getItemDeliveredQuantity = (order, item, fulfillmentDetails) => {
  const orderedQuantity = toNumber(item?.quantity);
  const lineItemId = normalizeKey(item?.id || item?.line_item_id);
  const explicitQuantity = toNumber(
    fulfillmentDetails.quantityByLineItemId.get(lineItemId),
  );
  if (explicitQuantity > 0) {
    return Math.min(orderedQuantity, explicitQuantity);
  }

  const fulfillableQuantity = toNumber(item?.fulfillable_quantity);
  const hasFulfillableQuantity =
    item?.fulfillable_quantity !== undefined &&
    item?.fulfillable_quantity !== null &&
    String(item.fulfillable_quantity).trim() !== "";
  if (
    orderedQuantity > 0 &&
    hasFulfillableQuantity &&
    fulfillableQuantity >= 0 &&
    fulfillableQuantity < orderedQuantity
  ) {
    return Math.min(orderedQuantity, orderedQuantity - fulfillableQuantity);
  }

  if (
    getOrderFulfillmentStatus(order) === "fulfilled" ||
    isRestockedOrder(order)
  ) {
    return orderedQuantity;
  }

  return 0;
};

const createSetTracker = () => ({
  orderIds: new Set(),
  paidOrderIds: new Set(),
  deliveredOrderIds: new Set(),
  returnedOrderIds: new Set(),
  pendingOrderIds: new Set(),
  cancelledOrderIds: new Set(),
  taskIds: new Set(),
  pendingTaskIds: new Set(),
  inProgressTaskIds: new Set(),
  completedTaskIds: new Set(),
});

const createVariantAnalyticsRecord = (product, variant) => ({
  id: normalizeKey(variant?.id || product?.shopify_id || product?.id),
  title: variant?.title || product?.title || "Default",
  sku: variant?.sku || "",
  barcode: variant?.barcode || "",
  price: variant?.price ?? product?.price ?? null,
  inventory_quantity: toNumber(variant?.inventory_quantity),
  ordered_quantity: 0,
  delivered_quantity: 0,
  returned_quantity: 0,
  net_delivered_quantity: 0,
  pending_quantity: 0,
  cancelled_quantity: 0,
  gross_sales: 0,
  net_sales: 0,
  last_order_at: null,
  last_fulfillment_at: null,
  last_return_at: null,
  last_task_at: null,
  ...createSetTracker(),
});

const createProductAnalyticsRecord = (product) => {
  const variants = getProductVariants(product);
  const normalizedVariants = variants.length > 0 ? variants : [buildSyntheticVariant(product)];
  const variantRows = normalizedVariants.map((variant) =>
    createVariantAnalyticsRecord(product, variant),
  );
  const primarySku =
    normalizeKey(product?.sku) ||
    normalizeKey(variantRows.find((row) => normalizeKey(row.sku))?.sku);

  return {
    id: product?.id || null,
    shopify_id: normalizeKey(product?.shopify_id),
    store_id: product?.store_id || null,
    title: product?.title || "Untitled product",
    vendor: product?.vendor || "",
    product_type: product?.product_type || "",
    sku: primarySku,
    price: product?.price ?? null,
    inventory_quantity:
      variantRows.reduce((sum, variant) => sum + toNumber(variant.inventory_quantity), 0) ||
      toNumber(product?.inventory_quantity),
    variants_count: variantRows.length,
    image_url: getProductImageUrl(product),
    last_synced_at: product?.last_synced_at || null,
    created_at: product?.created_at || null,
    updated_at: product?.updated_at || null,
    ordered_quantity: 0,
    delivered_quantity: 0,
    returned_quantity: 0,
    net_delivered_quantity: 0,
    pending_quantity: 0,
    cancelled_quantity: 0,
    gross_sales: 0,
    net_sales: 0,
    last_order_at: null,
    last_fulfillment_at: null,
    last_return_at: null,
    last_task_at: null,
    variants: variantRows,
    ...createSetTracker(),
  };
};

const updateLatestTimestamp = (entry, fieldName, candidate) => {
  if (!candidate) {
    return;
  }

  const previous = entry[fieldName];
  if (!previous || new Date(candidate).getTime() > new Date(previous).getTime()) {
    entry[fieldName] = candidate;
  }
};

const getLineItemVariantTitleCandidates = (item = {}) => {
  const candidates = new Set();
  const directVariantTitle = normalizeVariantTitle(
    item?.variant_title || item?.variant_name,
  );
  if (directVariantTitle) {
    candidates.add(directVariantTitle);
  }

  const compositeName = String(item?.name || "").trim();
  const productTitle = String(
    item?.title || item?.product_title || "",
  ).trim();
  if (compositeName && productTitle && compositeName.startsWith(productTitle)) {
    const suffix = compositeName
      .slice(productTitle.length)
      .replace(/^[\s\-–—/|:]+/, "")
      .trim();
    const normalizedSuffix = normalizeVariantTitle(suffix);
    if (normalizedSuffix) {
      candidates.add(normalizedSuffix);
    }
  }

  return Array.from(candidates);
};

const resolveVariantEntryForProduct = (productEntry, item, matchedVariantEntry) => {
  if (matchedVariantEntry) {
    return matchedVariantEntry;
  }

  const variants = Array.isArray(productEntry?.variants) ? productEntry.variants : [];
  if (variants.length === 0) {
    return null;
  }

  const itemVariantId = normalizeKey(item?.variant_id);
  if (itemVariantId) {
    const variantById = variants.find((variant) =>
      extractIdentifierVariants(variant?.id).includes(
        normalizeIdentifier(itemVariantId),
      ),
    );
    if (variantById) {
      return variantById;
    }
  }

  const itemSku = normalizeSku(item?.sku);
  if (itemSku) {
    const variantBySku = variants.find(
      (variant) => normalizeSku(variant?.sku) === itemSku,
    );
    if (variantBySku) {
      return variantBySku;
    }
  }

  const titleCandidates = getLineItemVariantTitleCandidates(item);
  if (titleCandidates.length > 0) {
    const variantByTitle = variants.find((variant) =>
      titleCandidates.includes(normalizeVariantTitle(variant?.title)),
    );
    if (variantByTitle) {
      return variantByTitle;
    }
  }

  return variants.length === 1 ? variants[0] : null;
};

const getTaskStatusKey = (status) => {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "completed") {
    return "completedTaskIds";
  }
  if (normalized === "in_progress") {
    return "inProgressTaskIds";
  }
  return "pendingTaskIds";
};

const serializeTrackerEntry = (entry) => {
  const variants = Array.isArray(entry?.variants)
    ? entry.variants.map((variant) => serializeTrackerEntry(variant))
    : undefined;

  const payload = {
    ...entry,
    orders_count: entry.orderIds.size,
    paid_orders_count: entry.paidOrderIds.size,
    delivered_orders_count: entry.deliveredOrderIds.size,
    returned_orders_count: entry.returnedOrderIds.size,
    pending_orders_count: entry.pendingOrderIds.size,
    cancelled_orders_count: entry.cancelledOrderIds.size,
    related_tasks_count: entry.taskIds.size,
    pending_tasks_count: entry.pendingTaskIds.size,
    in_progress_tasks_count: entry.inProgressTaskIds.size,
    completed_tasks_count: entry.completedTaskIds.size,
    gross_sales: parseFloat(entry.gross_sales.toFixed(2)),
    net_sales: parseFloat(entry.net_sales.toFixed(2)),
    variants,
  };

  delete payload.orderIds;
  delete payload.paidOrderIds;
  delete payload.deliveredOrderIds;
  delete payload.returnedOrderIds;
  delete payload.pendingOrderIds;
  delete payload.cancelledOrderIds;
  delete payload.taskIds;
  delete payload.pendingTaskIds;
  delete payload.inProgressTaskIds;
  delete payload.completedTaskIds;

  return payload;
};

const hasScopedOrderActivity = (entry) =>
  toNumber(entry?.ordered_quantity) > 0 ||
  toNumber(entry?.delivered_quantity) > 0 ||
  toNumber(entry?.returned_quantity) > 0 ||
  toNumber(entry?.net_delivered_quantity) > 0 ||
  toNumber(entry?.pending_quantity) > 0 ||
  toNumber(entry?.cancelled_quantity) > 0 ||
  toNumber(entry?.gross_sales) > 0 ||
  toNumber(entry?.net_sales) > 0 ||
  toNumber(entry?.orders_count) > 0;

const hasVariantResult = (entry) =>
  hasScopedOrderActivity(entry) || toNumber(entry?.related_tasks_count) > 0;

const countRelevantVariants = (variants = []) => {
  const rows = Array.isArray(variants) ? variants : [];
  if (rows.length === 0) {
    return 0;
  }

  const activeCount = rows.filter((variant) => hasVariantResult(variant)).length;
  return activeCount > 0 ? activeCount : rows.length;
};

const getFreshCacheEntry = (key) => {
  const entry = analyticsCache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > CACHE_TTL_MS) {
    analyticsCache.delete(key);
    return null;
  }

  return entry.payload;
};

const rememberCacheEntry = (key, payload) => {
  analyticsCache.set(key, {
    updatedAt: Date.now(),
    payload,
  });
};

const parseScopeDateBoundary = (value, endOfDay = false) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return date.toISOString();
};

const loadScopedRowsWithFallback = async ({
  tableName,
  selectCandidates,
  storeId,
  orderBy,
  ascending,
  maxRows = null,
  applyQuery = null,
}) => {
  let lastError = null;

  for (const selectColumns of selectCandidates) {
    const rows = [];

    for (let offset = 0; ; offset += SCOPED_ROWS_BATCH_SIZE) {
      const remainingRows =
        Number.isFinite(maxRows) && maxRows > 0
          ? Math.max(0, maxRows - rows.length)
          : SCOPED_ROWS_BATCH_SIZE;

      if (remainingRows === 0) {
        return rows;
      }

      const batchSize = Math.max(
        1,
        Math.min(SCOPED_ROWS_BATCH_SIZE, remainingRows),
      );

      let query = db
        .from(tableName)
        .select(selectColumns)
        .eq("store_id", storeId);

      if (typeof applyQuery === "function") {
        query = applyQuery(query) || query;
      }

      if (orderBy) {
        query = query.order(orderBy, { ascending });
      }

      const supportsRange = typeof query?.range === "function";
      if (supportsRange) {
        query = query.range(offset, offset + batchSize - 1);
      }

      const { data, error } = await query;
      if (error) {
        lastError = error;
        if (!isSchemaCompatibilityError(error)) {
          throw error;
        }
        break;
      }

      const batch = data || [];
      rows.push(...batch);

      if (!supportsRange) {
        return Number.isFinite(maxRows) && maxRows > 0
          ? rows.slice(0, maxRows)
          : rows;
      }

      if (batch.length < batchSize) {
        return rows;
      }

      if (Number.isFinite(maxRows) && maxRows > 0 && rows.length >= maxRows) {
        return rows.slice(0, maxRows);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

const loadScopedProducts = async (storeId) =>
  loadScopedRowsWithFallback({
    tableName: "products",
    selectCandidates: PRODUCTS_SELECTS,
    storeId,
    orderBy: "title",
    ascending: true,
  });

const loadScopedOrders = async (storeId, rawOrderFilters = {}) => {
  const normalizedOrderFilters = normalizeOrderScopeFilters(rawOrderFilters);
  const maxRows = Math.max(
    0,
    parseInt(normalizedOrderFilters.ordersLimit, 10) || 0,
  );
  const fromIso = parseScopeDateBoundary(normalizedOrderFilters.dateFrom, false);
  const toIso = parseScopeDateBoundary(normalizedOrderFilters.dateTo, true);

  return loadScopedRowsWithFallback({
    tableName: "orders",
    selectCandidates: ORDERS_SELECTS,
    storeId,
    orderBy: "created_at",
    ascending: false,
    maxRows: maxRows > 0 ? maxRows : null,
    applyQuery: (query) => {
      let scopedQuery = query;

      if (fromIso) {
        scopedQuery = scopedQuery.gte("created_at", fromIso);
      }

      if (toIso) {
        scopedQuery = scopedQuery.lte("created_at", toIso);
      }

      return scopedQuery;
    },
  });
};

const loadScopedTasks = async (req, storeId) => {
  let query = db.from("tasks").select(TASKS_SELECT).order("updated_at", {
    ascending: false,
  });

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  if (!resolveIsAdmin(req)) {
    query = applyUserFilter(query, req.user?.id, req.user?.role || "user", "tasks");
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return data || [];
};

const buildOrderLineEntries = (order, refundDetails, fulfillmentDetails) => {
  const orderCancelled = isCancelledOrder(order);
  const orderRefundedAmount = getOrderRefundedAmount(order);
  const orderRestocked = isRestockedOrder(order);
  const lineContexts = [];
  let explicitRefundAmountTotal = 0;
  let refundableBaseTotal = 0;

  for (const item of getLineItems(order)) {
    const orderedQuantity = toNumber(item?.quantity);
    if (orderedQuantity <= 0) {
      continue;
    }

    const refundedQuantity = Math.min(
      orderedQuantity,
      getItemRefundedQuantity(item, refundDetails, order),
    );
    const deliveredQuantity = Math.min(
      orderedQuantity,
      getItemDeliveredQuantity(order, item, fulfillmentDetails),
    );
    const returnedQuantity = Math.min(deliveredQuantity, refundedQuantity);
    const refundedUndeliveredQuantity = Math.max(
      0,
      refundedQuantity - returnedQuantity,
    );
    const explicitCancelledQuantity = orderCancelled
      ? Math.max(0, orderedQuantity - deliveredQuantity)
      : 0;
    const cancelledQuantity = Math.min(
      Math.max(0, orderedQuantity - deliveredQuantity),
      Math.max(explicitCancelledQuantity, refundedUndeliveredQuantity),
    );
    const pendingQuantity = Math.max(
      0,
      orderedQuantity - deliveredQuantity - cancelledQuantity,
    );
    const netDeliveredQuantity = Math.max(
      0,
      deliveredQuantity - returnedQuantity,
    );
    const saleableQuantity = Math.max(
      0,
      orderedQuantity - explicitCancelledQuantity,
    );
    const orderLineAmount = getLineItemBookedAmount(item);
    const grossSales =
      !orderCancelled && orderedQuantity > 0
        ? (orderLineAmount * saleableQuantity) / orderedQuantity
        : 0;
    const explicitRefundAmount = Math.min(
      grossSales,
      Math.max(
        0,
        toNumber(
          refundDetails.amountByLineItemId.get(
            normalizeKey(item?.id || item?.line_item_id),
          ),
        ),
      ),
    );

    explicitRefundAmountTotal += explicitRefundAmount;
    if (grossSales > explicitRefundAmount) {
      refundableBaseTotal += grossSales - explicitRefundAmount;
    }

    lineContexts.push({
      item,
      orderedQuantity,
      refundedQuantity,
      returnedQuantity,
      deliveredQuantity,
      cancelledQuantity,
      pendingQuantity,
      netDeliveredQuantity,
      saleableQuantity,
      grossSales,
      explicitRefundAmount,
    });
  }

  const effectiveRefundedAmount =
    orderRestocked && orderRefundedAmount <= 0
      ? lineContexts.reduce((sum, line) => sum + line.grossSales, 0)
      : orderRefundedAmount;
  const remainingRefundAmount = Math.max(
    0,
    Math.min(
      effectiveRefundedAmount,
      lineContexts.reduce((sum, line) => sum + line.grossSales, 0),
    ) -
      explicitRefundAmountTotal,
  );

  for (const lineContext of lineContexts) {
    const allocatableBase = Math.max(
      0,
      lineContext.grossSales - lineContext.explicitRefundAmount,
    );
    const proportionalRefundAmount =
      remainingRefundAmount > 0 && refundableBaseTotal > 0 && allocatableBase > 0
        ? (remainingRefundAmount * allocatableBase) / refundableBaseTotal
        : 0;

    lineContext.refundedAmount = Math.min(
      lineContext.grossSales,
      lineContext.explicitRefundAmount + proportionalRefundAmount,
    );
    lineContext.netSales = Math.max(
      0,
      lineContext.grossSales - lineContext.refundedAmount,
    );
  }

  return lineContexts;
};

export const buildAnalyticsPayload = async (req, storeId, rawOrderFilters = {}) => {
  const normalizedOrderFilters = normalizeOrderScopeFilters(rawOrderFilters);
  const [products, orders] = await Promise.all([
    loadScopedProducts(storeId),
    loadScopedOrders(storeId, normalizedOrderFilters),
  ]);
  const scopedOrderFiltersActive = hasActiveOrderScopeFilters(rawOrderFilters);
  const ordersInScope = filterOrdersByScope(orders, {
    ...normalizedOrderFilters,
    ordersLimit: "",
  });
  const filteredOrders = filterOrdersByScope(ordersInScope, normalizedOrderFilters);

  let tasks = [];
  let taskMetricsAvailable = true;
  try {
    tasks = await loadScopedTasks(req, storeId);
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      console.warn("Product analysis tasks fallback:", error.message);
    }
    taskMetricsAvailable = false;
    tasks = [];
  }

  const productEntries = products.map((product) =>
    createProductAnalyticsRecord(product),
  );
  const productByShopifyId = new Map();
  const productBySku = new Map();
  const variantById = new Map();
  const variantBySku = new Map();
  const variantToProductById = new Map();
  const variantToProductBySku = new Map();

  for (const productEntry of productEntries) {
    rememberIdentifier(productByShopifyId, productEntry.shopify_id, productEntry);
    rememberIdentifier(productByShopifyId, productEntry.id, productEntry);
    rememberSku(productBySku, productEntry.sku, productEntry);

    for (const variantEntry of productEntry.variants) {
      rememberIdentifier(variantById, variantEntry.id, variantEntry);
      rememberIdentifier(variantToProductById, variantEntry.id, productEntry);
      rememberSku(variantBySku, variantEntry.sku, variantEntry);
      rememberSku(variantToProductBySku, variantEntry.sku, productEntry);
    }
  }

  for (const order of filteredOrders) {
    const orderId = normalizeKey(order?.id);
    const orderFinancialStatus = getOrderFinancialStatus(order);
    const refundDetails = buildRefundDetails(order);
    const fulfillmentDetails = buildFulfillmentDetails(order);
    const lineEntries = buildOrderLineEntries(order, refundDetails, fulfillmentDetails);

    for (const lineEntry of lineEntries) {
      const {
        item,
        orderedQuantity,
        refundedQuantity,
        returnedQuantity,
        deliveredQuantity,
        cancelledQuantity,
        pendingQuantity,
        netDeliveredQuantity,
        grossSales,
        netSales,
      } = lineEntry;
      const itemProductId = normalizeKey(item?.product_id);
      const itemVariantId = normalizeKey(item?.variant_id);
      const itemSku = normalizeSku(item?.sku);

      const variantEntry =
        resolveIdentifierMatch(variantById, [itemVariantId]) ||
        resolveSkuMatch(variantBySku, [itemSku]) ||
        null;
      const productEntry =
        resolveIdentifierMatch(productByShopifyId, [itemProductId]) ||
        resolveIdentifierMatch(variantToProductById, [itemVariantId]) ||
        resolveSkuMatch(productBySku, [itemSku]) ||
        resolveSkuMatch(variantToProductBySku, [itemSku]) ||
        null;
      if (!productEntry) {
        continue;
      }

      const resolvedVariantEntry = resolveVariantEntryForProduct(
        productEntry,
        item,
        variantEntry,
      );
      const targets = resolvedVariantEntry
        ? [productEntry, resolvedVariantEntry]
        : [productEntry];
      if (targets.length === 0) {
        continue;
      }
      const orderCreatedAt = order?.created_at || null;
      const lineItemId = normalizeKey(item?.id || item?.line_item_id);
      const lineFulfillmentAt =
        fulfillmentDetails.latestAtByLineItemId.get(lineItemId) ||
        (deliveredQuantity > 0 ? order?.updated_at || order?.created_at : null);
      const lineReturnAt =
        returnedQuantity > 0
          ? refundDetails.latestAtByLineItemId.get(lineItemId) ||
            order?.updated_at ||
            order?.created_at ||
            null
          : null;

      for (const target of targets) {
        target.ordered_quantity += orderedQuantity;
        target.delivered_quantity += deliveredQuantity;
        target.returned_quantity += returnedQuantity;
        target.net_delivered_quantity += netDeliveredQuantity;
        target.pending_quantity += pendingQuantity;
        target.cancelled_quantity += cancelledQuantity;
        target.gross_sales += grossSales;
        target.net_sales += netSales;
        target.orderIds.add(orderId);

        if (PAID_LIKE_STATUSES.has(orderFinancialStatus) && grossSales > 0) {
          target.paidOrderIds.add(orderId);
        }
        if (deliveredQuantity > 0) {
          target.deliveredOrderIds.add(orderId);
        }
        if (returnedQuantity > 0) {
          target.returnedOrderIds.add(orderId);
        }
        if (pendingQuantity > 0) {
          target.pendingOrderIds.add(orderId);
        }
        if (cancelledQuantity > 0) {
          target.cancelledOrderIds.add(orderId);
        }

        updateLatestTimestamp(target, "last_order_at", orderCreatedAt);
        updateLatestTimestamp(target, "last_fulfillment_at", lineFulfillmentAt);
        updateLatestTimestamp(target, "last_return_at", lineReturnAt);
      }
    }
  }

  if (taskMetricsAvailable && tasks.length > 0) {
    for (const task of tasks) {
      const searchableText = `${String(task?.title || "")} ${String(task?.description || "")}`
        .toLowerCase()
        .trim();
      if (!searchableText) {
        continue;
      }

      const matchedVariants = [];
      for (const productEntry of productEntries) {
        for (const variantEntry of productEntry.variants) {
          const normalizedVariantSku = normalizeSku(variantEntry?.sku);
          if (!normalizedVariantSku || normalizedVariantSku.length < 3) {
            continue;
          }

          if (searchableText.includes(normalizedVariantSku.toLowerCase())) {
            matchedVariants.push([productEntry, variantEntry]);
          }
        }
      }

      if (matchedVariants.length === 0) {
        continue;
      }

      const taskId = normalizeKey(task?.id);
      const taskStatusKey = getTaskStatusKey(task?.status);
      const taskUpdatedAt = task?.updated_at || task?.created_at || null;

      for (const [productEntry, variantEntry] of matchedVariants) {
        for (const target of [productEntry, variantEntry]) {
          target.taskIds.add(taskId);
          target[taskStatusKey].add(taskId);
          updateLatestTimestamp(target, "last_task_at", taskUpdatedAt);
        }
      }
    }
  }

  const serializedProducts = productEntries
    .map((entry) => serializeTrackerEntry(entry))
    .filter((entry) => !scopedOrderFiltersActive || hasScopedOrderActivity(entry))
    .sort((left, right) => {
      const rightActivity =
        new Date(right.last_order_at || right.updated_at || 0).getTime() || 0;
      const leftActivity =
        new Date(left.last_order_at || left.updated_at || 0).getTime() || 0;
      return rightActivity - leftActivity;
    });

  const summary = serializedProducts.reduce(
    (acc, product) => {
      acc.total_products += 1;
      acc.total_variants += countRelevantVariants(product?.variants);
      acc.ordered_quantity += toNumber(product?.ordered_quantity);
      acc.delivered_quantity += toNumber(product?.delivered_quantity);
      acc.net_delivered_quantity += toNumber(product?.net_delivered_quantity);
      acc.returned_quantity += toNumber(product?.returned_quantity);
      acc.pending_quantity += toNumber(product?.pending_quantity);
      acc.cancelled_quantity += toNumber(product?.cancelled_quantity);
      acc.gross_sales += toNumber(product?.gross_sales);
      acc.net_sales += toNumber(product?.net_sales);
      acc.related_tasks_count += toNumber(product?.related_tasks_count);
      return acc;
    },
    {
      total_products: 0,
      total_variants: 0,
      ordered_quantity: 0,
      delivered_quantity: 0,
      net_delivered_quantity: 0,
      returned_quantity: 0,
      pending_quantity: 0,
      cancelled_quantity: 0,
      gross_sales: 0,
      net_sales: 0,
      related_tasks_count: 0,
    },
  );

  summary.gross_sales = parseFloat(summary.gross_sales.toFixed(2));
  summary.net_sales = parseFloat(summary.net_sales.toFixed(2));

  return {
    data: serializedProducts,
    summary,
    meta: {
      generated_at: new Date().toISOString(),
      store_id: storeId,
      task_metrics_available: taskMetricsAvailable,
      task_match_basis: taskMetricsAvailable ? "sku" : "unavailable",
      order_scope_active: scopedOrderFiltersActive,
      filtered_orders_count: filteredOrders.length,
      total_orders_in_scope: ordersInScope.length,
      applied_orders_limit: normalizedOrderFilters.ordersLimit
        ? parseInt(normalizedOrderFilters.ordersLimit, 10) || null
        : null,
      filters_key: getOrderScopeFiltersCacheKey(rawOrderFilters),
    },
  };
};

router.use(authenticateToken, requirePermission("can_view_products"));

router.get("/", async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const forceRefresh =
      String(req.query.refresh || "").trim().toLowerCase() === "true";
    const orderFilters = req.query || {};
    const cacheKey = [
      String(req.user?.id || "").trim(),
      storeId,
      getOrderScopeFiltersCacheKey(orderFilters),
    ].join("::");

    let payload = !forceRefresh ? getFreshCacheEntry(cacheKey) : null;
    if (!payload) {
      payload = await buildAnalyticsPayload(req, storeId, orderFilters);
      rememberCacheEntry(cacheKey, payload);
    }

    res.json(payload);
  } catch (error) {
    console.error("Error fetching product analysis:", error);

    if (isSchemaCompatibilityError(error)) {
      return res.status(503).json({
        error: "Product analysis is temporarily unavailable because the schema is outdated",
      });
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to fetch product analysis",
    });
  }
});

export default router;
