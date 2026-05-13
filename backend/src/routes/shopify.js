import express from "express";
import axios from "axios";
import {
  ShopifyToken,
  Product,
  Order,
  Customer,
  getAccessibleStoreIds,
} from "../models/index.js";
import { ShopifyService } from "../services/shopifyService.js";
import { ProductUpdateService } from "../services/productUpdateService.js";
import { OrderManagementService } from "../services/orderManagementService.js";
import { ProductManagementService } from "../services/productManagementService.js";
import {
  ensureWebhooksRegistered,
  getWebhookAddress,
  removeManagedWebhooks,
} from "../services/shopifyWebhookService.js";
import { queueShopifyBackgroundSync } from "../services/shopifyBackgroundSyncService.js";
import { emitRealtimeEvent } from "../services/realtimeEventService.js";
import {
  requireAdminRole,
  requirePermission,
  requireAnyPermission,
} from "../middleware/permissions.js";
import { authenticateToken } from "../middleware/auth.js";
import { supabase as db } from "../supabaseClient.js";
import { extractCustomerPhone } from "../helpers/customerContact.js";
import { buildProductsSummaryExportPayload } from "../helpers/orderExport.js";
import { hasActiveOrderScopeFilters } from "../helpers/orderScope.js";
import { buildProductSourcingDetail } from "../helpers/suppliers.js";
import {
  extractProductLocalMetadata,
  extractWarehouseInventorySnapshot,
  isProductLowStockAlertsSuppressed,
} from "../helpers/productLocalMetadata.js";
import {
  DAY_MS,
  buildMissingOrdersFromStock,
  MISSING_ORDER_GRACE_MS,
  MISSING_ORDER_REASON_NO_ACTION,
  MISSING_ORDER_REASON_STOCK_SHORTAGE,
} from "../helpers/missingOrders.js";
import { extractOrderLocalMetadata } from "../helpers/orderLocalMetadata.js";
import {
  applyShippingIssueRecoveryPlan,
  applyShippingIssueRecoveryPlanToRows,
  buildShippingIssueRecoveryPlan,
  recoverShippingIssuesFromHistory,
} from "../helpers/shippingIssueRecovery.js";
import {
  clearHeavyCacheByPrefix,
  clearHeavyCacheNamespace,
  getHeavyCacheInFlight,
  normalizeCacheQuery,
  readHeavyCacheEntry,
  setHeavyCacheInFlight,
  shouldBypassHeavyCache,
  stableCacheStringify,
  writeHeavyCacheEntry,
} from "../helpers/heavyRouteCache.js";
import { loadWarehouseAvailabilityByStoreIds } from "../services/warehouseAvailabilityService.js";

const router = express.Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_BACKGROUND_SYNC_COOLDOWN_MS = 45 * 1000;
const ORDER_BACKGROUND_SYNC_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const SHIPPING_ISSUE_HISTORY_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const SHIPPING_ISSUE_ORDERS_CACHE_TTL_MS = 5 * 60 * 1000;
const MISSING_ORDERS_CACHE_TTL_MS = 5 * 60 * 1000;
const SCOPED_ENTITY_PAGE_CACHE_NAMESPACE = "shopify:scoped-entity-page";
const PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE = "shopify:product-supplier-links";
const SCOPED_ENTITY_PAGE_CACHE_MAX_ENTRIES = 250;
const PRODUCT_SUPPLIER_LINKS_CACHE_TTL_MS = 10 * 60 * 1000;
const toPositiveIntegerEnv = (
  name,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) => {
  const parsed = parseInt(process.env[name], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
};
const DEFAULT_LIST_LIMIT = toPositiveIntegerEnv("API_DEFAULT_LIST_LIMIT", 100, {
  max: 200,
});
const MAX_LIST_LIMIT = toPositiveIntegerEnv("API_MAX_LIST_LIMIT", 100, {
  max: 200,
});
const ORDER_LIST_PAGE_LIMIT = toPositiveIntegerEnv(
  "ORDER_API_PAGE_LIMIT",
  300,
  { max: 1000 },
);
const ORDER_LIST_MAX_VISIBLE = toPositiveIntegerEnv(
  "ORDER_API_MAX_VISIBLE",
  600,
  { max: 1500 },
);
const ORDER_SEARCH_SHOPIFY_FALLBACK_LIMIT = 10;
const MISSING_ORDER_NOTIFICATION_WINDOW_MS = DAY_MS;
const ORDER_ACTION_LOOKUP_CHUNK_SIZE = 250;
const MISSING_ORDER_NOTIFICATION_TYPES = new Set([
  "order_missing",
  "order_missing_escalated",
]);
const MISSING_ORDER_SOURCE_MAX_ROWS = 500;
const SHIPPING_ISSUE_FAST_PATH_BATCH_SIZE = 1000;
const SHIPPING_ISSUE_FAST_PATH_MAX_ORDERS = 1000;
const SHIPPING_ISSUE_LOCAL_FAST_PATH_MAX_ORDERS = ORDER_LIST_MAX_VISIBLE;
const SHIPPING_ISSUE_OPERATION_BATCH_SIZE = 1000;
const MAX_EXPORT_ORDER_IDS = 10000;
const PAID_LIKE_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
]);
const PRODUCT_LIST_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "title",
  "vendor",
  "product_type",
  "price",
  "cost_price",
  "ads_cost",
  "operation_cost",
  "shipping_cost",
  "sku",
  "inventory_quantity",
  "last_synced_at",
  "local_updated_at",
  "pending_sync",
  "sync_error",
  "created_at",
  "updated_at",
  "data",
].join(",");
const PRODUCT_LIST_SELECTS = [
  PRODUCT_LIST_SELECT,
  [
    "id",
    "shopify_id",
    "store_id",
    "title",
    "vendor",
    "product_type",
    "price",
    "cost_price",
    "ads_cost",
    "operation_cost",
    "shipping_cost",
    "sku",
    "inventory_quantity",
    "last_synced_at",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
];
const PRODUCT_SUPPLIER_LINK_SELECT = [
  "id",
  "supplier_id",
  "store_id",
  "product_id",
  "variant_id",
  "product_shopify_id",
  "product_name",
  "variant_title",
  "sku",
  "notes",
  "is_active",
  "created_at",
  "updated_at",
].join(",");
const PRODUCT_SUPPLIER_SELECT = [
  "id",
  "store_id",
  "supplier_type",
  "code",
  "name",
  "phone",
  "is_active",
].join(",");
const ORDER_LIST_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "order_number",
  "customer_name",
  "customer_email",
  "customer_phone",
  "total_price",
  "total_refunded",
  "financial_status",
  "fulfillment_status",
  "payment_method",
  "manual_payment_method",
  "status",
  "items_count",
  "cancelled_at",
  "local_updated_at",
  "created_at",
  "updated_at",
  "data",
].join(",");
const ORDER_LIST_SELECTS = [
  ORDER_LIST_SELECT,
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "status",
    "fulfillment_status",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "status",
    "fulfillment_status",
    "created_at",
    "updated_at",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "total_refunded",
    "financial_status",
    "fulfillment_status",
    "cancelled_at",
    "created_at",
    "updated_at",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "financial_status",
    "fulfillment_status",
    "cancelled_at",
    "created_at",
    "updated_at",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "total_refunded",
    "financial_status",
    "fulfillment_status",
    "payment_method",
    "manual_payment_method",
    "cancelled_at",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  "*",
];
const MISSING_ORDER_SOURCE_SELECTS = [
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "status",
    "fulfillment_status",
    "created_at",
    "updated_at",
    "data",
    "notes",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "order_number",
    "customer_name",
    "customer_email",
    "total_price",
    "status",
    "fulfillment_status",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  "*",
];
const CUSTOMER_LIST_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "name",
  "email",
  "phone",
  "city",
  "country",
  "orders_count",
  "total_spent",
  "default_address",
  "created_at",
  "updated_at",
].join(",");
const CUSTOMER_LIST_SELECTS = [
  [
    "id",
    "shopify_id",
    "store_id",
    "name",
    "email",
    "phone",
    "city",
    "country",
    "orders_count",
    "total_spent",
    "default_address",
    "created_at",
    "updated_at",
  ].join(","),
  [
    "id",
    "shopify_id",
    "store_id",
    "name",
    "email",
    "phone",
    "city",
    "country",
    "orders_count",
    "total_spent",
    "default_address",
    "created_at",
    "updated_at",
  ].join(","),
  CUSTOMER_LIST_SELECT,
];
const CUSTOMER_DETAIL_SELECTS = [
  [
    "id",
    "shopify_id",
    "store_id",
    "name",
    "email",
    "orders_count",
    "total_spent",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
];
const SHIPPING_ISSUE_ORDER_SELECTS = [
  ORDER_LIST_SELECT,
  ...ORDER_LIST_SELECTS.slice(1),
];
const PRODUCT_SOURCING_SUPPLIER_SELECT = [
  "id",
  "supplier_type",
  "name",
  "code",
  "phone",
  "is_active",
].join(",");
const PRODUCT_SOURCING_ENTRY_SELECT = [
  "id",
  "supplier_id",
  "entry_type",
  "entry_date",
  "reference_code",
  "description",
  "amount",
  "items",
  "created_at",
].join(",");
const PRODUCT_SOURCING_FABRIC_SELECT = [
  "id",
  "supplier_id",
  "fabric_supplier_id",
  "code",
  "name",
  "notes",
  "is_active",
  "created_at",
  "updated_at",
].join(",");
const PRODUCT_SORT_FIELDS = new Set([
  "created_at",
  "updated_at",
  "price",
  "inventory_quantity",
  "title",
]);
const ORDER_SORT_FIELDS = new Set([
  "created_at",
  "updated_at",
  "total_price",
  "order_number",
]);
const CUSTOMER_SORT_FIELDS = new Set([
  "created_at",
  "updated_at",
  "total_spent",
  "orders_count",
  "name",
  "email",
]);
const orderBackgroundSyncState = new Map();
const shippingIssueHistoryRecoveryState = new Map();
const shippingIssueOrdersCache = new Map();
const shippingIssueOrdersInFlight = new Map();
const missingOrdersCache = new Map();
const missingOrdersInFlight = new Map();
const normalizeBaseUrl = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");
const SHOP_DOMAIN_REGEX = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

const normalizeShopDomain = (value) => {
  let raw = String(value || "")
    .trim()
    .toLowerCase();

  if (!raw) {
    return "";
  }

  raw = raw.replace(/^https?:\/\//, "").replace(/^www\./, "");

  if (raw.startsWith("admin.shopify.com/store/")) {
    const parts = raw.split("/");
    const storeSlug = String(parts[2] || "")
      .trim()
      .toLowerCase();
    if (storeSlug) {
      return `${storeSlug}.myshopify.com`;
    }
  }

  raw = raw.split(/[/?#]/)[0];
  if (raw.endsWith(".myshopify.com")) {
    return raw;
  }

  const normalizedSlug = raw.replace(/[^a-z0-9-]/g, "");
  if (!normalizedSlug) {
    return "";
  }

  return `${normalizedSlug}.myshopify.com`;
};

const getEmergencyShopifyToken = ({ userId, requestedStoreId } = {}) => {
  const accessToken = String(
    process.env.SHOPIFY_EMERGENCY_ACCESS_TOKEN ||
      process.env.SHOPIFY_ACCESS_TOKEN ||
      "",
  ).trim();
  const shop = normalizeShopDomain(
    process.env.SHOPIFY_EMERGENCY_SHOP || process.env.SHOPIFY_SHOP || "",
  );

  if (!accessToken || !shop || !SHOP_DOMAIN_REGEX.test(shop)) {
    return null;
  }

  return {
    user_id: process.env.SHOPIFY_EMERGENCY_USER_ID || userId || null,
    store_id:
      requestedStoreId || process.env.SHOPIFY_EMERGENCY_STORE_ID || null,
    shop,
    access_token: accessToken,
    source: "env_emergency",
  };
};

// Helper to get user-specific shopify credentials
const getShopifyCredentials = async (userId) => {
  const { supabase } = await import("../supabaseClient.js");
  const { data, error } = await supabase
    .from("shopify_credentials")
    .select("api_key, api_secret")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("Shopify credentials not found for this user.");
  }
  return { apiKey: data.api_key, apiSecret: data.api_secret };
};

// Helper to construct the redirect URI
const getRedirectUri = (req) => {
  if (process.env.BACKEND_URL) {
    return `${normalizeBaseUrl(process.env.BACKEND_URL)}/api/shopify/callback`;
  }
  // Fallback for local development
  const protocol = req.protocol;
  const host = req.get("host");
  return `${protocol}://${host}/api/shopify/callback`;
};

const verifyToken = authenticateToken;

const resolveIsAdmin = async (req) => {
  return Boolean(req.user?.isAdmin || req.user?.role === "admin");
};

const getRequestedStoreId = (req) => {
  const fromHeader = req.headers["x-store-id"];
  const fromBody = req.body?.store_id;
  const fromQuery = req.query?.store_id;

  const value = fromHeader || fromBody || fromQuery;
  if (!value) return null;

  const normalized = String(value).trim();
  if (!UUID_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
};

const getAuthorizedRequestedStoreId = ({
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
} = {}) => {
  if (!requestedStoreId) {
    return null;
  }

  if (isAdmin) {
    return requestedStoreId;
  }

  return accessibleStoreIds.includes(requestedStoreId)
    ? requestedStoreId
    : null;
};

const buildShippingIssueHistoryRecoveryKey = ({
  userId,
  requestedStoreId,
  searchAllHistory = false,
}) =>
  `${String(userId || "").trim()}::${String(requestedStoreId || "all").trim()}::${searchAllHistory ? "search_all" : "page"}`;

const shouldRecoverShippingIssuesFromHistory = ({
  query = {},
  pagination,
  searchAllHistory = false,
}) => {
  const hasShippingIssueFilter =
    (query.shipping_issue && query.shipping_issue !== "all") ||
    (query.shipping_issue_reason && query.shipping_issue_reason !== "all");

  if (searchAllHistory) {
    return Boolean(hasShippingIssueFilter);
  }

  return toNonNegativeInteger(pagination?.offset, 0) === 0;
};

const maybeRecoverShippingIssuesFromHistory = async ({
  req,
  orders = [],
  requestedStoreId,
  pagination,
  searchAllHistory = false,
} = {}) => {
  if (
    !shouldRecoverShippingIssuesFromHistory({
      query: req?.query || {},
      pagination,
      searchAllHistory,
    }) ||
    !Array.isArray(orders) ||
    orders.length === 0
  ) {
    return {
      orders: Array.isArray(orders) ? orders : [],
      repairedCount: 0,
    };
  }

  const scopeKey = buildShippingIssueHistoryRecoveryKey({
    userId: req?.user?.id,
    requestedStoreId,
    searchAllHistory,
  });
  const nowMs = Date.now();
  const state = shippingIssueHistoryRecoveryState.get(scopeKey);

  if (
    state?.inFlight ||
    (state?.lastRunMs &&
      nowMs - state.lastRunMs < SHIPPING_ISSUE_HISTORY_RECOVERY_COOLDOWN_MS)
  ) {
    return {
      orders,
      repairedCount: 0,
    };
  }

  shippingIssueHistoryRecoveryState.set(scopeKey, {
    inFlight: true,
    lastRunMs: state?.lastRunMs || 0,
  });

  try {
    const recoveryResult = await recoverShippingIssuesFromHistory({
      supabaseClient: db,
      orders,
      persist: true,
    });

    shippingIssueHistoryRecoveryState.set(scopeKey, {
      inFlight: false,
      lastRunMs: nowMs,
    });

    return recoveryResult;
  } catch (error) {
    console.error(
      "Shipping issue history recovery failed:",
      error?.message || error,
    );
    shippingIssueHistoryRecoveryState.set(scopeKey, {
      inFlight: false,
      lastRunMs: state?.lastRunMs || 0,
    });

    return {
      orders,
      repairedCount: 0,
    };
  }
};

const filterRowsByStoreId = (rows, requestedStoreId) => {
  if (!requestedStoreId) {
    return rows || [];
  }

  return (rows || []).filter(
    (row) => row?.store_id && String(row.store_id) === requestedStoreId,
  );
};

const dedupeRowsById = (rows = []) => {
  const uniqueRows = [];
  const seenIds = new Set();

  for (const row of rows || []) {
    const rowId = String(row?.id || "").trim();
    if (!rowId || seenIds.has(rowId)) {
      continue;
    }

    seenIds.add(rowId);
    uniqueRows.push(row);
  }

  return uniqueRows;
};

const toNonNegativeInteger = (value, fallback = 0) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const toBooleanQueryFlag = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const withRouteTimeout = async (label, operation, timeoutMs = 20 * 1000) => {
  let timeout = null;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`${label} timed out after ${timeoutMs}ms`);
          error.code = "ETIMEDOUT";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const getListPagination = (
  query = {},
  defaultLimit = DEFAULT_LIST_LIMIT,
  maxLimit = MAX_LIST_LIMIT,
) => {
  const requestedLimit = parseInt(query.limit, 10);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, maxLimit)
      : defaultLimit;

  return {
    limit,
    offset: toNonNegativeInteger(query.offset, 0),
  };
};

const getListSortOptions = (
  query = {},
  allowedFields = new Set(),
  defaultField = "created_at",
  defaultDirection = "desc",
) => {
  const requestedField = String(query.sort_by || "")
    .trim()
    .toLowerCase();
  const sortBy = allowedFields.has(requestedField)
    ? requestedField
    : defaultField;
  const sortDir = String(query.sort_dir || defaultDirection)
    .trim()
    .toLowerCase();

  return {
    sortBy,
    ascending: sortDir === "asc",
  };
};

const applyOrdersAccessScope = ({
  query,
  req,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
} = {}) => {
  if (requestedStoreId) {
    return query.eq("store_id", requestedStoreId);
  }

  if (isAdmin) {
    return query;
  }

  if (accessibleStoreIds.length > 0) {
    return query.in("store_id", accessibleStoreIds);
  }

  return query.eq("user_id", req.user.id);
};

const buildScopedOrdersByIdsQuery = ({
  req,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
  orderIds = [],
} = {}) => {
  const query = db.from("orders").select("*").in("id", orderIds);
  return applyOrdersAccessScope({
    query,
    req,
    requestedStoreId,
    isAdmin,
    accessibleStoreIds,
  });
};

const fetchScopedOrdersByIds = async ({
  req,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
  orderIds = [],
} = {}) => {
  const normalizedIds = Array.from(
    new Set(
      (orderIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

  if (normalizedIds.length === 0) {
    return [];
  }

  const rows = [];
  const chunkSize = 200;

  for (let index = 0; index < normalizedIds.length; index += chunkSize) {
    const chunk = normalizedIds.slice(index, index + chunkSize);
    const query = buildScopedOrdersByIdsQuery({
      req,
      requestedStoreId,
      isAdmin,
      accessibleStoreIds,
      orderIds: chunk,
    });

    if (!query) {
      return [];
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    rows.push(...(data || []));
  }

  return rows;
};

const getShippingIssueOrdersCacheKey = ({
  userId,
  requestedStoreId,
  isAdmin,
} = {}) =>
  `${String(userId || "").trim()}::${isAdmin ? "admin" : "user"}::${String(
    requestedStoreId || "all",
  ).trim()}`;

const readShippingIssueOrdersCache = (cacheKey) => {
  const cached = shippingIssueOrdersCache.get(cacheKey);
  if (
    !cached ||
    !cached.updatedAtMs ||
    Date.now() - cached.updatedAtMs > SHIPPING_ISSUE_ORDERS_CACHE_TTL_MS
  ) {
    shippingIssueOrdersCache.delete(cacheKey);
    return null;
  }

  return {
    rows: Array.isArray(cached.rows) ? cached.rows : [],
    repairedCount: Number(cached.repairedCount || 0),
  };
};

const writeShippingIssueOrdersCache = (cacheKey, value = {}) => {
  shippingIssueOrdersCache.set(cacheKey, {
    rows: Array.isArray(value.rows) ? value.rows : [],
    repairedCount: Number(value.repairedCount || 0),
    updatedAtMs: Date.now(),
  });
};

const getRequestScopedCacheKey = ({
  userId,
  requestedStoreId,
  isAdmin,
  scope,
} = {}) =>
  `${String(scope || "scope").trim()}::${String(userId || "").trim()}::${
    isAdmin ? "admin" : "user"
  }::${String(requestedStoreId || "all").trim()}`;

const readTimedRowsCache = (cache, cacheKey, ttlMs) => {
  const cached = cache.get(cacheKey);
  if (
    !cached ||
    !cached.updatedAtMs ||
    Date.now() - cached.updatedAtMs > ttlMs
  ) {
    cache.delete(cacheKey);
    return null;
  }

  return {
    rows: Array.isArray(cached.rows) ? cached.rows : [],
  };
};

const writeTimedRowsCache = (cache, cacheKey, rows = []) => {
  cache.set(cacheKey, {
    rows: Array.isArray(rows) ? rows : [],
    updatedAtMs: Date.now(),
  });
};

const getScopedEntityPageCacheTtlMs = (tableName) => {
  if (tableName === "products") {
    return 15 * 60 * 1000;
  }

  if (tableName === "customers") {
    return 15 * 60 * 1000;
  }

  if (tableName === "orders") {
    return 2 * 60 * 1000;
  }

  return 0;
};

const buildScopedEntityPageCacheKey = ({
  req,
  tableName,
  selectedColumns,
  pagination,
  sortOptions,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
}) =>
  `${String(tableName || "table").trim()}::${stableCacheStringify({
    user_id: req?.user?.id || "",
    role: isAdmin ? "admin" : "user",
    requested_store_id: requestedStoreId || "",
    accessible_store_ids: [...accessibleStoreIds].sort(),
    selected_columns: selectedColumns,
    pagination,
    sort_options: sortOptions,
    query: normalizeCacheQuery(req?.query || {}),
  })}`;

const clearScopedEntityPageCache = (tableNames = []) => {
  const names = Array.isArray(tableNames) ? tableNames : [tableNames];
  for (const tableName of names) {
    const normalizedTable = String(tableName || "").trim();
    if (normalizedTable) {
      clearHeavyCacheByPrefix(
        SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
        `${normalizedTable}::`,
      );
    }
  }
};

const clearOrderDerivedCaches = () => {
  shippingIssueOrdersCache.clear();
  shippingIssueOrdersInFlight.clear();
  missingOrdersCache.clear();
  missingOrdersInFlight.clear();
};

const invalidateShopifyReadCaches = (
  tableNames = ["products", "orders", "customers"],
) => {
  clearScopedEntityPageCache(tableNames);

  if (tableNames.includes("products")) {
    clearHeavyCacheNamespace(PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE);
  }

  if (tableNames.includes("orders")) {
    clearOrderDerivedCaches();
  }
};

router.use((req, res, next) => {
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    return next();
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      invalidateShopifyReadCaches();
    }
  });

  return next();
});

const loadScopedOrdersFastPath = async ({
  req,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
  selectedColumnsList = ORDER_LIST_SELECTS,
  orderField = "updated_at",
  maxOrders = SHIPPING_ISSUE_FAST_PATH_MAX_ORDERS,
  requireNotNullField = null,
} = {}) => {
  let lastError = null;
  const safeMaxOrders = Math.max(
    0,
    Math.min(ORDER_LIST_MAX_VISIBLE, Number(maxOrders) || 0),
  );

  for (const selectedColumns of selectedColumnsList) {
    const rows = [];

    for (
      let offset = 0;
      offset < safeMaxOrders;
      offset += SHIPPING_ISSUE_FAST_PATH_BATCH_SIZE
    ) {
      let query = db
        .from("orders")
        .select(selectedColumns)
        .order(orderField, { ascending: false })
        .range(
          offset,
          Math.min(
            offset + SHIPPING_ISSUE_FAST_PATH_BATCH_SIZE - 1,
            safeMaxOrders - 1,
          ),
        );

      if (requireNotNullField) {
        query = query.not(requireNotNullField, "is", null);
      }

      query = applyOrdersAccessScope({
        query,
        req,
        requestedStoreId,
        isAdmin,
        accessibleStoreIds,
      });

      const { data, error } = await query;
      if (error) {
        lastError = error;
        rows.length = 0;
        break;
      }

      const batch = Array.isArray(data) ? data : [];
      rows.push(...batch);

      if (batch.length < SHIPPING_ISSUE_FAST_PATH_BATCH_SIZE) {
        return dedupeRowsById(rows);
      }
    }

    if (rows.length > 0) {
      return dedupeRowsById(rows);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

const normalizeShippingIssueRows = (rows = []) =>
  dedupeRowsById(
    (rows || []).map((order) =>
      order?.shipping_issue || order?.shipping_issue_reason
        ? order
        : buildOrderListItem(order),
    ),
  ).filter((order) => order?.shipping_issue || order?.shipping_issue_reason);

const loadShippingIssueOrdersForRequest = async (req) => {
  const isAdmin = await resolveIsAdmin(req);
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const requestedStoreId = getAuthorizedRequestedStoreId({
    requestedStoreId: getRequestedStoreId(req),
    isAdmin,
    accessibleStoreIds,
  });
  const cacheKey = getShippingIssueOrdersCacheKey({
    userId: req.user.id,
    requestedStoreId,
    isAdmin,
  });
  const bypassCache = shouldBypassHeavyCache(req);
  if (!bypassCache) {
    const cachedResult = readShippingIssueOrdersCache(cacheKey);
    if (cachedResult) {
      return {
        ...cachedResult,
        cacheHit: true,
      };
    }
  }

  if (!bypassCache) {
    const pendingResult = shippingIssueOrdersInFlight.get(cacheKey);
    if (pendingResult) {
      const result = await pendingResult;
      return {
        ...result,
        cacheHit: true,
      };
    }
  }

  const requestPromise = (async () => {
    let fastPathMatches = [];
    try {
      const fastPathResults = await Promise.allSettled([
        loadScopedOrdersFastPath({
          req,
          requestedStoreId,
          isAdmin,
          accessibleStoreIds,
          selectedColumnsList: ORDER_LIST_SELECTS,
          orderField: "updated_at",
          maxOrders: SHIPPING_ISSUE_FAST_PATH_MAX_ORDERS,
        }),
        loadScopedOrdersFastPath({
          req,
          requestedStoreId,
          isAdmin,
          accessibleStoreIds,
          selectedColumnsList: SHIPPING_ISSUE_ORDER_SELECTS,
          orderField: "local_updated_at",
          maxOrders: SHIPPING_ISSUE_LOCAL_FAST_PATH_MAX_ORDERS,
          requireNotNullField: "local_updated_at",
        }),
      ]);

      const fastPathRows = [];
      for (const result of fastPathResults) {
        if (result.status === "fulfilled") {
          fastPathRows.push(...(result.value || []));
          continue;
        }

        if (!isQueryRetryableError(result.reason)) {
          throw result.reason;
        }
      }

      fastPathMatches = normalizeShippingIssueRows(fastPathRows);
    } catch (fastPathError) {
      if (!isQueryRetryableError(fastPathError)) {
        throw fastPathError;
      }
    }

    if (!toBooleanQueryFlag(req.query?.recover_history, false)) {
      writeShippingIssueOrdersCache(cacheKey, {
        rows: fastPathMatches,
        repairedCount: 0,
      });

      return {
        rows: fastPathMatches,
        repairedCount: 0,
        fastPathOnly: true,
      };
    }

    const latestOperationByOrderId = new Map();

    for (let offset = 0; ; offset += SHIPPING_ISSUE_OPERATION_BATCH_SIZE) {
      const { data, error } = await db
        .from("sync_operations")
        .select("entity_id, created_at, request_data")
        .eq("operation_type", "order_shipping_issue_update")
        .order("created_at", { ascending: false })
        .range(offset, offset + SHIPPING_ISSUE_OPERATION_BATCH_SIZE - 1);

      if (error) {
        throw error;
      }

      const batch = Array.isArray(data) ? data : [];
      for (const row of batch) {
        const entityId = String(row?.entity_id || "").trim();
        if (!entityId || latestOperationByOrderId.has(entityId)) {
          continue;
        }

        latestOperationByOrderId.set(entityId, row);
      }

      if (batch.length < SHIPPING_ISSUE_OPERATION_BATCH_SIZE) {
        break;
      }
    }

    const activeHistoryOrderIds = Array.from(latestOperationByOrderId.entries())
      .filter(([, operation]) =>
        Boolean(operation?.request_data?.new_shipping_issue),
      )
      .map(([orderId]) => orderId);
    const scopedOrders = await fetchScopedOrdersByIds({
      req,
      requestedStoreId,
      isAdmin,
      accessibleStoreIds,
      orderIds: activeHistoryOrderIds,
    });

    const recoveryPlan = buildShippingIssueRecoveryPlan(
      scopedOrders,
      latestOperationByOrderId,
    );

    if (recoveryPlan.length > 0) {
      await applyShippingIssueRecoveryPlan(db, recoveryPlan);
    }

    const historyMatches = normalizeShippingIssueRows(
      applyShippingIssueRecoveryPlanToRows(scopedOrders, recoveryPlan),
    );
    const rows = dedupeRowsById([...historyMatches, ...fastPathMatches]);

    writeShippingIssueOrdersCache(cacheKey, {
      rows,
      repairedCount: recoveryPlan.length,
    });

    return {
      rows,
      repairedCount: recoveryPlan.length,
    };
  })();

  shippingIssueOrdersInFlight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (shippingIssueOrdersInFlight.get(cacheKey) === requestPromise) {
      shippingIssueOrdersInFlight.delete(cacheKey);
    }
  }
};

const buildPaginatedCollection = (rows, { limit, offset }) => {
  const items = Array.isArray(rows) ? rows : [];
  const count = items.length;

  return {
    data: items,
    pagination: {
      limit,
      offset,
      count,
      has_more: count === limit,
      next_offset: offset + count,
    },
  };
};

const buildLimitedPaginatedCollection = (
  rows,
  { limit, offset },
  maxVisible,
) => {
  const items = Array.isArray(rows) ? rows : [];
  const count = items.length;
  const nextOffset = offset + count;
  const effectiveMaxVisible = Math.max(0, toNonNegativeInteger(maxVisible, 0));

  return {
    data: items,
    pagination: {
      limit,
      offset,
      count,
      max_visible: effectiveMaxVisible,
      has_more:
        count > 0 && count === limit && nextOffset < effectiveMaxVisible,
      next_offset: Math.min(nextOffset, effectiveMaxVisible),
    },
  };
};

const buildSlicedPaginatedCollection = (
  rows,
  { limit, offset },
  extra = {},
) => {
  const items = Array.isArray(rows) ? rows : [];
  const total = items.length;
  const pageItems = items.slice(offset, offset + limit);
  const count = pageItems.length;

  return {
    data: pageItems,
    pagination: {
      limit,
      offset,
      count,
      total,
      has_more: offset + count < total,
      next_offset: offset + count,
    },
    ...extra,
  };
};

const QUERY_RETRYABLE_ERROR_CODES = new Set(["57014"]);
const MISSING_ORDER_SOURCE_BATCH_SIZE = 500;

const isQueryRetryableError = (error) => {
  if (!error) {
    return false;
  }

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

const getScopedEntityPage = async ({
  req,
  tableName,
  select,
  selects,
  pagination,
  sortOptions,
}) => {
  const isAdmin = await resolveIsAdmin(req);
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const requestedStoreId = getAuthorizedRequestedStoreId({
    requestedStoreId: getRequestedStoreId(req),
    isAdmin,
    accessibleStoreIds,
  });

  const { limit, offset } = pagination;
  const { sortBy, ascending } = sortOptions;

  const buildQuery = (
    selectedColumns,
    orderField,
    useLegacyUserScope = false,
  ) => {
    let query = db.from(tableName).select(selectedColumns);

    if (orderField) {
      query = query.order(orderField, { ascending });
    }

    query = query.range(offset, offset + limit - 1);

    if (requestedStoreId) {
      return query.eq("store_id", requestedStoreId);
    }

    if (isAdmin) {
      return query;
    }

    if (!useLegacyUserScope && accessibleStoreIds.length > 0) {
      return query.in("store_id", accessibleStoreIds);
    }

    return query.eq("user_id", req.user.id);
  };

  const selectCandidates = [
    ...(Array.isArray(selects) ? selects : []),
    ...(select ? [select] : []),
  ].filter(Boolean);
  const orderFieldCandidates = getOrderFieldFallbacks(sortBy, {
    allowUnordered: true,
  });

  const loadPage = async () => {
    let lastError = null;

    for (const selectedColumns of selectCandidates) {
      for (const orderField of orderFieldCandidates) {
        let result = await buildQuery(selectedColumns, orderField, false);

        if (
          !isAdmin &&
          !requestedStoreId &&
          accessibleStoreIds.length > 0 &&
          offset === 0 &&
          !result.error &&
          (!Array.isArray(result.data) || result.data.length === 0)
        ) {
          result = await buildQuery(selectedColumns, orderField, true);
        }

        if (!result?.error) {
          return {
            data: result?.data || [],
            error: null,
            isAdmin,
            requestedStoreId,
          };
        }

        lastError = result.error;
        if (isSchemaCompatibilityError(result.error)) {
          break;
        }

        console.error("Error executing query:", result.error);

        if (isQueryRetryableError(result.error)) {
          continue;
        }

        return {
          data: [],
          error: result.error,
          isAdmin,
          requestedStoreId,
        };
      }
    }

    return {
      data: [],
      error: lastError,
      isAdmin,
      requestedStoreId,
    };
  };

  const cacheTtlMs = getScopedEntityPageCacheTtlMs(tableName);
  const shouldUseCache = cacheTtlMs > 0 && !shouldBypassHeavyCache(req);
  const cacheKey = shouldUseCache
    ? buildScopedEntityPageCacheKey({
        req,
        tableName,
        selectedColumns: selectCandidates,
        pagination,
        sortOptions,
        requestedStoreId,
        isAdmin,
        accessibleStoreIds,
      })
    : "";

  if (shouldUseCache) {
    const cachedEntry = readHeavyCacheEntry(
      SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
      cacheKey,
      cacheTtlMs,
    );

    if (cachedEntry) {
      return {
        ...cachedEntry.value,
        cacheStatus: "hit",
      };
    }

    const pending = getHeavyCacheInFlight(
      SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
      cacheKey,
    );

    if (pending) {
      const result = await pending;
      return {
        ...result,
        cacheStatus: "coalesced",
      };
    }
  }

  if (!shouldUseCache) {
    return await loadPage();
  }

  const requestPromise = loadPage().then((result) => {
    if (!result?.error) {
      writeHeavyCacheEntry(
        SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
        cacheKey,
        result,
        { maxEntries: SCOPED_ENTITY_PAGE_CACHE_MAX_ENTRIES },
      );
    }

    return result;
  });

  setHeavyCacheInFlight(
    SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
    cacheKey,
    requestPromise,
  );

  const result = await requestPromise;
  return {
    ...result,
    cacheStatus: "miss",
  };
};

const getScopedEntityRows = async (req, entityModel) => {
  const requestedStoreId = getRequestedStoreId(req);
  const isAdmin = await resolveIsAdmin(req);
  const sourceResult = isAdmin
    ? await entityModel.findAll()
    : await entityModel.findByUser(req.user.id);

  if (sourceResult?.error) {
    return {
      data: [],
      error: sourceResult.error,
      isAdmin,
      requestedStoreId,
    };
  }

  return {
    data: filterRowsByStoreId(sourceResult?.data || [], requestedStoreId),
    error: null,
    isAdmin,
    requestedStoreId,
  };
};

const getMissingOrdersSourceCutoffIso = (nowTimestamp = Date.now()) =>
  new Date(nowTimestamp - MISSING_ORDER_GRACE_MS).toISOString();

const buildScopedMissingOrdersSourceQuery = ({
  req,
  selectedColumns,
  rangeStart,
  rangeEnd,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
  useLegacyUserScope = false,
  cutoffIso,
} = {}) => {
  let query = db
    .from("orders")
    .select(selectedColumns)
    .lt("created_at", cutoffIso)
    .or("fulfillment_status.is.null,fulfillment_status.neq.fulfilled")
    .order("created_at", { ascending: false })
    .range(rangeStart, rangeEnd);

  if (requestedStoreId) {
    return query.eq("store_id", requestedStoreId);
  }

  if (isAdmin) {
    return query;
  }

  if (!useLegacyUserScope && accessibleStoreIds.length > 0) {
    return query.in("store_id", accessibleStoreIds);
  }

  return query.eq("user_id", req.user.id);
};

const executeScopedMissingOrdersSourceQuery = async ({
  req,
  selectedColumns,
  requestedStoreId,
  isAdmin,
  accessibleStoreIds = [],
  useLegacyUserScope = false,
  cutoffIso,
} = {}) => {
  const rows = [];

  for (
    let offset = 0;
    offset < MISSING_ORDER_SOURCE_MAX_ROWS;
    offset += MISSING_ORDER_SOURCE_BATCH_SIZE
  ) {
    const rangeEnd = Math.min(
      offset + MISSING_ORDER_SOURCE_BATCH_SIZE - 1,
      MISSING_ORDER_SOURCE_MAX_ROWS - 1,
    );
    const { data, error } = await buildScopedMissingOrdersSourceQuery({
      req,
      selectedColumns,
      rangeStart: offset,
      rangeEnd,
      requestedStoreId,
      isAdmin,
      accessibleStoreIds,
      useLegacyUserScope,
      cutoffIso,
    });

    if (error) {
      return {
        data: rows,
        error,
      };
    }

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < MISSING_ORDER_SOURCE_BATCH_SIZE) {
      break;
    }
  }

  return {
    data: rows,
    error: null,
  };
};

const loadMissingOrdersSourceRows = async (req) => {
  const isAdmin = await resolveIsAdmin(req);
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const requestedStoreId = getAuthorizedRequestedStoreId({
    requestedStoreId: getRequestedStoreId(req),
    isAdmin,
    accessibleStoreIds,
  });

  const cutoffIso = getMissingOrdersSourceCutoffIso();
  let lastError = null;

  for (const selectedColumns of MISSING_ORDER_SOURCE_SELECTS) {
    let queryResult = await executeScopedMissingOrdersSourceQuery({
      req,
      selectedColumns,
      requestedStoreId,
      isAdmin,
      accessibleStoreIds,
      useLegacyUserScope: false,
      cutoffIso,
    });

    if (
      !queryResult.error &&
      !isAdmin &&
      !requestedStoreId &&
      accessibleStoreIds.length > 0 &&
      queryResult.data.length === 0
    ) {
      queryResult = await executeScopedMissingOrdersSourceQuery({
        req,
        selectedColumns,
        requestedStoreId,
        isAdmin,
        accessibleStoreIds,
        useLegacyUserScope: true,
        cutoffIso,
      });
    }

    if (!queryResult.error) {
      return {
        data: dedupeRowsById(queryResult.data || []),
        error: null,
        isAdmin,
        requestedStoreId,
      };
    }

    lastError = queryResult.error;
    if (isSchemaCompatibilityError(queryResult.error)) {
      continue;
    }

    if (isQueryRetryableError(queryResult.error)) {
      continue;
    }

    return {
      data: [],
      error: queryResult.error,
      isAdmin,
      requestedStoreId,
    };
  }

  return {
    data: [],
    error: lastError,
    isAdmin,
    requestedStoreId,
  };
};

const resolveSyncToken = async ({ userId, requestedStoreId, isAdmin }) => {
  const emergencyToken = getEmergencyShopifyToken({ userId, requestedStoreId });
  if (emergencyToken) {
    return emergencyToken;
  }

  const { supabase } = await import("../supabaseClient.js");

  let accessibleStoreIds = [];
  if (!isAdmin) {
    accessibleStoreIds = await getAccessibleStoreIds(userId);
  }

  const scopedRequestedStoreId = getAuthorizedRequestedStoreId({
    requestedStoreId,
    isAdmin,
    accessibleStoreIds,
  });

  if (scopedRequestedStoreId) {
    const { data: tokenByRequestedStore } = await supabase
      .from("shopify_tokens")
      .select("*")
      .eq("store_id", scopedRequestedStoreId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenByRequestedStore) {
      return tokenByRequestedStore;
    }
  }

  const { data: tokenByUser } = await ShopifyToken.findByUser(
    userId,
    scopedRequestedStoreId,
  );
  if (tokenByUser) {
    return tokenByUser;
  }

  if (accessibleStoreIds.length > 0) {
    const { data: tokenByAccessibleStores } = await supabase
      .from("shopify_tokens")
      .select("*")
      .in("store_id", accessibleStoreIds)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenByAccessibleStores) {
      return tokenByAccessibleStores;
    }
  }

  if (isAdmin) {
    const { data: fallbackAdminToken } = await supabase
      .from("shopify_tokens")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return fallbackAdminToken || null;
  }

  return null;
};

const isSchemaCompatibilityError = (error) => {
  if (!error) return false;

  const code = String(error.code || "");
  if (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205"
  ) {
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

const getSchemaErrorMessage = (error) =>
  String(
    error?.message ||
      error?.details ||
      error?.hint ||
      "Database schema mismatch",
  ).trim();

const attachProductSourcingDetail = async (product) => {
  const storeId = String(product?.store_id || "").trim();
  if (!product || !storeId) {
    return product;
  }

  try {
    const [
      { data: suppliers, error: suppliersError },
      { data: entries, error: entriesError },
      { data: fabricRecords, error: fabricRecordsError },
    ] = await Promise.all([
      db
        .from("suppliers")
        .select(PRODUCT_SOURCING_SUPPLIER_SELECT)
        .eq("store_id", storeId),
      db
        .from("supplier_entries")
        .select(PRODUCT_SOURCING_ENTRY_SELECT)
        .eq("store_id", storeId)
        .eq("entry_type", "delivery"),
      db
        .from("supplier_fabrics")
        .select(PRODUCT_SOURCING_FABRIC_SELECT)
        .eq("store_id", storeId),
    ]);

    if (suppliersError) {
      throw suppliersError;
    }
    if (entriesError) {
      throw entriesError;
    }
    if (fabricRecordsError) {
      throw fabricRecordsError;
    }

    return {
      ...product,
      supply_chain: buildProductSourcingDetail(
        product,
        suppliers || [],
        entries || [],
        fabricRecords || [],
      ),
    };
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      console.error("Product sourcing detail error:", error);
    }

    return product;
  }
};

const getReadableShopifyError = (error) => {
  const responseData = error?.response?.data;

  if (typeof responseData === "string" && responseData.trim()) {
    return responseData.trim();
  }

  if (responseData && typeof responseData === "object") {
    const candidates = [
      responseData.error_description,
      responseData.error,
      responseData.message,
      responseData.errors,
    ];

    for (const value of candidates) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (Array.isArray(value) && value.length > 0) {
        return value
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .join(", ");
      }
      if (value && typeof value === "object") {
        const flattened = Object.values(value)
          .flatMap((item) => (Array.isArray(item) ? item : [item]))
          .map((item) => String(item || "").trim())
          .filter(Boolean);
        if (flattened.length > 0) {
          return flattened.join(", ");
        }
      }
    }
  }

  return String(error?.message || "Unknown Shopify OAuth error").trim();
};

const parseBooleanFlag = (value, fieldName) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "false" ||
    normalized === "0" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  throw new Error(`${fieldName} must be a boolean value`);
};

const isShopifyCredentialError = (error) => {
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 403) {
    return true;
  }

  const text = `${getReadableShopifyError(error)} ${error?.message || ""}`
    .toLowerCase()
    .trim();

  return (
    text.includes("invalid api key") ||
    text.includes("invalid access token") ||
    text.includes("unrecognized login") ||
    text.includes("reauthoriz") ||
    text.includes("access token") ||
    text.includes("forbidden")
  );
};

const validateShopifyConnection = async ({ shop, accessToken }) => {
  if (!shop || !accessToken) {
    return {
      valid: false,
      requiresReconnect: false,
      message: "Missing Shopify connection details",
    };
  }

  try {
    await axios.get(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    return { valid: true, requiresReconnect: false, message: null };
  } catch (error) {
    return {
      valid: false,
      requiresReconnect: isShopifyCredentialError(error),
      message: getReadableShopifyError(error),
    };
  }
};

const validateShopifyOrdersReadAccess = async ({ shop, accessToken }) => {
  if (!shop || !accessToken) {
    return {
      readable: false,
      message: "Missing Shopify connection details",
    };
  }

  try {
    await axios.get(`https://${shop}/admin/api/2024-01/orders.json`, {
      params: {
        limit: 1,
        status: "any",
      },
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    return { readable: true, message: null };
  } catch (error) {
    return {
      readable: false,
      message: getReadableShopifyError(error),
    };
  }
};

const findOrCreateStoreConnection = async ({ supabase, shop, userId }) => {
  const lookup = await supabase
    .from("stores")
    .select("id,name")
    .eq("name", shop)
    .maybeSingle();

  if (lookup.error && !isSchemaCompatibilityError(lookup.error)) {
    throw lookup.error;
  }

  if (lookup.data?.id) {
    return lookup.data;
  }

  if (lookup.error && isSchemaCompatibilityError(lookup.error)) {
    return null;
  }

  const create = await supabase
    .from("stores")
    .insert({ name: shop, created_by: userId })
    .select("id,name")
    .single();

  if (create.error && !isSchemaCompatibilityError(create.error)) {
    throw create.error;
  }

  return create.data || null;
};

const grantUserStoreAccess = async ({ supabase, userId, storeId }) => {
  if (!storeId) {
    return { skipped: true };
  }

  const result = await supabase.from("user_stores").upsert(
    {
      user_id: userId,
      store_id: storeId,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,store_id",
    },
  );

  if (result.error && !isSchemaCompatibilityError(result.error)) {
    throw result.error;
  }

  return { skipped: false, error: result.error || null };
};

const findExistingStoreIdByShop = async ({ supabase, shop }) => {
  if (!shop) {
    return null;
  }

  const result = await supabase
    .from("stores")
    .select("id")
    .eq("name", shop)
    .maybeSingle();

  if (result.error && !isSchemaCompatibilityError(result.error)) {
    throw result.error;
  }

  return result.data?.id || null;
};

const resolveUpdateErrorStatusCode = (errorMessage) => {
  const message = String(errorMessage || "").toLowerCase();
  if (
    message.includes("required") ||
    message.includes("invalid") ||
    message.includes("cannot") ||
    message.includes("no updates")
  ) {
    return 400;
  }
  if (message.includes("shopify")) {
    return 502;
  }
  return 500;
};

const sanitizeVariantForRole = (variant, isAdmin) => {
  if (!variant || isAdmin) {
    return variant;
  }

  const {
    cost,
    cost_price,
    ads_cost,
    operation_cost,
    shipping_cost,
    ...safeVariant
  } = variant;
  return safeVariant;
};

const sanitizeProductForRole = (product, isAdmin) => {
  if (!product || isAdmin) {
    return product;
  }

  const {
    cost_price,
    ads_cost,
    operation_cost,
    shipping_cost,
    data,
    ...safeProduct
  } = product;

  if (Array.isArray(safeProduct.variants)) {
    safeProduct.variants = safeProduct.variants.map((variant) =>
      sanitizeVariantForRole(variant, false),
    );
  }

  return safeProduct;
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

const getProductVariantRows = (product) => {
  const parsedData = parseJsonField(product?.data);
  return Array.isArray(parsedData?.variants) ? parsedData.variants : [];
};

const getProductImageRows = (product) => {
  const parsedData = parseJsonField(product?.data);
  const images = Array.isArray(parsedData?.images) ? parsedData.images : [];

  return images.map((image) => ({
    id: image?.id || null,
    src: image?.src || "",
    alt: image?.alt || "",
    position: image?.position || null,
    variant_ids: Array.isArray(image?.variant_ids) ? image.variant_ids : [],
  }));
};

const getProductTotalInventory = (product) => {
  const variants = getProductVariantRows(product);
  if (variants.length === 0) {
    return toNumber(product?.inventory_quantity);
  }

  return variants.reduce(
    (sum, variant) => sum + toNumber(variant?.inventory_quantity),
    0,
  );
};

const getProductTotalWarehouseInventory = (product) => {
  const variants = getProductVariantRows(product);
  if (variants.length === 0) {
    return extractWarehouseInventorySnapshot(parseJsonField(product?.data))
      .quantity;
  }

  return variants.reduce(
    (sum, variant) =>
      sum + extractWarehouseInventorySnapshot(parseJsonField(variant)).quantity,
    0,
  );
};

const getProductPrimarySku = (product) => {
  const currentSku = String(product?.sku || "").trim();
  if (currentSku) {
    return currentSku;
  }

  const variants = getProductVariantRows(product);
  const firstVariantWithSku = variants.find((variant) =>
    String(variant?.sku || "").trim(),
  );

  return String(firstVariantWithSku?.sku || "").trim();
};

const getProductPrimaryImageUrl = (product) => {
  const currentImageUrl = String(product?.image_url || "").trim();
  if (currentImageUrl) {
    return currentImageUrl;
  }

  const imageRows = getProductImageRows(product);
  const firstImageUrl = String(imageRows[0]?.src || "").trim();
  if (firstImageUrl) {
    return firstImageUrl;
  }

  const parsedData = parseJsonField(product?.data);
  return String(parsedData?.image?.src || "").trim();
};

const normalizeSupplierLinkRow = (link = {}, supplier = null) => ({
  id: String(link?.id || "").trim(),
  supplier_id: String(link?.supplier_id || supplier?.id || "").trim(),
  product_id: String(link?.product_id || "").trim(),
  variant_id: String(link?.variant_id || "").trim(),
  product_shopify_id: String(link?.product_shopify_id || "").trim(),
  product_name: String(link?.product_name || "").trim(),
  variant_title: String(link?.variant_title || "").trim(),
  sku: String(link?.sku || "").trim(),
  notes: String(link?.notes || "").trim(),
  is_active: link?.is_active !== false && supplier?.is_active !== false,
  supplier: supplier
    ? {
        id: supplier.id,
        code: String(supplier.code || "").trim(),
        name: String(supplier.name || "").trim(),
        phone: String(supplier.phone || "").trim(),
        supplier_type: supplier.supplier_type || "factory",
        is_active: supplier.is_active !== false,
      }
    : null,
});

const getProductSupplierLinks = (product = {}) =>
  Array.isArray(product?.supplier_links)
    ? product.supplier_links.filter((link) => link?.is_active !== false)
    : [];

const getSupplierLinksForVariant = (product = {}, variant = {}) => {
  const variantId = String(variant?.id || "").trim();
  const links = getProductSupplierLinks(product).filter((link) => {
    const linkVariantId = String(link?.variant_id || "").trim();
    return !linkVariantId || (variantId && linkVariantId === variantId);
  });
  const seenKeys = new Set();

  return links.filter((link) => {
    const key = `${String(link?.supplier_id || "").trim()}::${String(
      link?.variant_id || "",
    ).trim()}`;
    if (!key.trim() || seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
};

const attachSupplierLinksToProducts = async (products = []) => {
  const rows = Array.isArray(products) ? products : [];
  const productIds = Array.from(
    new Set(
      rows.map((product) => String(product?.id || "").trim()).filter(Boolean),
    ),
  );

  if (productIds.length === 0) {
    return rows;
  }

  try {
    const cacheKey = stableCacheStringify([...productIds].sort());
    const cachedLinks = readHeavyCacheEntry(
      PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE,
      cacheKey,
      PRODUCT_SUPPLIER_LINKS_CACHE_TTL_MS,
    );

    if (cachedLinks) {
      const cachedLinksByProductId = new Map(cachedLinks.value || []);
      return rows.map((product) => ({
        ...product,
        supplier_links:
          cachedLinksByProductId.get(String(product?.id || "")) || [],
      }));
    }

    const { data: links, error: linksError } = await db
      .from("supplier_products")
      .select(PRODUCT_SUPPLIER_LINK_SELECT)
      .in("product_id", productIds)
      .eq("is_active", true);

    if (linksError) {
      throw linksError;
    }

    const supplierIds = Array.from(
      new Set(
        (links || [])
          .map((link) => String(link?.supplier_id || "").trim())
          .filter(Boolean),
      ),
    );
    let suppliersById = new Map();

    if (supplierIds.length > 0) {
      const { data: suppliers, error: suppliersError } = await db
        .from("suppliers")
        .select(PRODUCT_SUPPLIER_SELECT)
        .in("id", supplierIds);

      if (suppliersError) {
        throw suppliersError;
      }

      suppliersById = new Map(
        (suppliers || []).map((supplier) => [
          String(supplier?.id || ""),
          supplier,
        ]),
      );
    }

    const linksByProductId = new Map();
    for (const link of links || []) {
      const productId = String(link?.product_id || "").trim();
      if (!productId) {
        continue;
      }

      const supplier =
        suppliersById.get(String(link?.supplier_id || "")) || null;
      const nextLink = normalizeSupplierLinkRow(link, supplier);
      const currentLinks = linksByProductId.get(productId) || [];
      currentLinks.push(nextLink);
      linksByProductId.set(productId, currentLinks);
    }

    writeHeavyCacheEntry(
      PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE,
      cacheKey,
      Array.from(linksByProductId.entries()),
      { maxEntries: SCOPED_ENTITY_PAGE_CACHE_MAX_ENTRIES },
    );

    return rows.map((product) => ({
      ...product,
      supplier_links: linksByProductId.get(String(product?.id || "")) || [],
    }));
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      console.error("Product supplier links enrichment failed:", error);
    }

    return rows;
  }
};

const resolveVariantImageUrl = (
  variant,
  imageRows = [],
  fallbackImageUrl = "",
) => {
  const variantId = String(variant?.id || "").trim();
  const variantImageId = String(variant?.image_id || "").trim();

  if (variantImageId) {
    const directImage = imageRows.find(
      (image) => String(image?.id || "").trim() === variantImageId,
    );
    if (directImage?.src) {
      return directImage.src;
    }
  }

  if (variantId) {
    const linkedImage = imageRows.find(
      (image) =>
        Array.isArray(image?.variant_ids) &&
        image.variant_ids.some(
          (value) => String(value || "").trim() === variantId,
        ),
    );
    if (linkedImage?.src) {
      return linkedImage.src;
    }
  }

  return fallbackImageUrl;
};

const buildProductVariantSummaries = (product) => {
  const variants = getProductVariantRows(product);
  const imageRows = getProductImageRows(product);
  const primaryImageUrl = getProductPrimaryImageUrl(product);

  if (variants.length === 0) {
    const warehouseSnapshot = extractWarehouseInventorySnapshot(
      parseJsonField(product?.data),
    );

    return [
      {
        id: product?.shopify_id || product?.id || null,
        product_id: product?.shopify_id || product?.id || null,
        title: product?.title || "Default",
        price: product?.price ?? 0,
        cost: product?.cost_price ?? 0,
        cost_price: product?.cost_price ?? 0,
        sku: getProductPrimarySku(product),
        position: 1,
        compare_at_price: null,
        option1: null,
        option2: null,
        option3: null,
        barcode: null,
        image_id: null,
        weight: null,
        weight_unit: null,
        inventory_quantity: toNumber(product?.inventory_quantity),
        shopify_inventory_quantity: toNumber(product?.inventory_quantity),
        warehouse_inventory_quantity: warehouseSnapshot.quantity,
        supplier_links: getSupplierLinksForVariant(product, {
          id: product?.shopify_id || product?.id || null,
        }),
        requires_shipping: true,
        taxable: true,
        created_at: product?.created_at || null,
        updated_at: product?.updated_at || null,
      },
    ];
  }

  return variants.map((variant, index) => {
    const warehouseSnapshot = extractWarehouseInventorySnapshot(
      parseJsonField(variant),
    );

    return {
      id: variant?.id || null,
      product_id:
        variant?.product_id || product?.shopify_id || product?.id || null,
      title: variant?.title || `Variant ${index + 1}`,
      price: variant?.price ?? product?.price ?? 0,
      cost: variant?.cost ?? variant?.cost_price ?? product?.cost_price ?? 0,
      cost_price:
        variant?.cost_price ?? variant?.cost ?? product?.cost_price ?? 0,
      sku: String(variant?.sku || "").trim(),
      position: variant?.position ?? index + 1,
      compare_at_price: variant?.compare_at_price ?? null,
      option1: variant?.option1 ?? null,
      option2: variant?.option2 ?? null,
      option3: variant?.option3 ?? null,
      barcode: variant?.barcode ?? null,
      weight: variant?.weight ?? null,
      weight_unit: variant?.weight_unit ?? null,
      inventory_quantity: toNumber(variant?.inventory_quantity),
      shopify_inventory_quantity: toNumber(variant?.inventory_quantity),
      warehouse_inventory_quantity: warehouseSnapshot.quantity,
      supplier_links: getSupplierLinksForVariant(product, variant),
      requires_shipping: Boolean(variant?.requires_shipping),
      taxable: Boolean(variant?.taxable),
      created_at: variant?.created_at || null,
      updated_at: variant?.updated_at || null,
    };
  });
};

const buildBasicProductVariantSummaries = (product) => {
  const variants = getProductVariantRows(product);
  const imageRows = getProductImageRows(product);
  const primaryImageUrl = getProductPrimaryImageUrl(product);

  if (variants.length === 0) {
    return [
      {
        id: product?.shopify_id || product?.id || null,
        product_id: product?.shopify_id || product?.id || null,
        title: product?.title || "Default",
        price: product?.price ?? 0,
        cost: product?.cost_price ?? 0,
        cost_price: product?.cost_price ?? 0,
        sku: getProductPrimarySku(product),
        position: 1,
        option1: null,
        option2: null,
        option3: null,
        barcode: null,
        inventory_quantity: toNumber(product?.inventory_quantity),
        shopify_inventory_quantity: toNumber(product?.inventory_quantity),
        created_at: product?.created_at || null,
        updated_at: product?.updated_at || null,
      },
    ];
  }

  return variants.map((variant, index) => ({
    id: variant?.id || null,
    product_id:
      variant?.product_id || product?.shopify_id || product?.id || null,
    title: variant?.title || `Variant ${index + 1}`,
    price: variant?.price ?? product?.price ?? 0,
    cost: variant?.cost ?? variant?.cost_price ?? product?.cost_price ?? 0,
    cost_price:
      variant?.cost_price ?? variant?.cost ?? product?.cost_price ?? 0,
    sku: String(variant?.sku || "").trim(),
    position: variant?.position ?? index + 1,
    option1: variant?.option1 ?? null,
    option2: variant?.option2 ?? null,
    option3: variant?.option3 ?? null,
    barcode: variant?.barcode ?? null,
    inventory_quantity: toNumber(variant?.inventory_quantity),
    shopify_inventory_quantity: toNumber(variant?.inventory_quantity),
    created_at: variant?.created_at || null,
    updated_at: variant?.updated_at || null,
  }));
};

const buildProductSummary = (product) => {
  const variants = buildProductVariantSummaries(product);
  const images = getProductImageRows(product);
  const totalInventory = getProductTotalInventory(product);
  const totalWarehouseInventory = getProductTotalWarehouseInventory(product);
  const primaryImageUrl = getProductPrimaryImageUrl(product);
  const localMetadata = extractProductLocalMetadata(product?.data);

  return {
    ...product,
    inventory_quantity: totalInventory,
    shopify_inventory_quantity: totalInventory,
    warehouse_inventory_quantity: totalWarehouseInventory,
    total_inventory: totalInventory,
    total_shopify_inventory: totalInventory,
    total_warehouse_inventory: totalWarehouseInventory,
    sku: getProductPrimarySku(product),
    image_url: primaryImageUrl,
    images,
    variants,
    variants_count: variants.length,
    has_multiple_variants: variants.length > 1,
    suppress_low_stock_alerts: Boolean(
      localMetadata?.suppress_low_stock_alerts,
    ),
  };
};

const buildProductListItem = (product, isAdmin) => {
  const { data, ...summary } = buildProductSummary(product);
  return sanitizeProductForRole(summary, isAdmin);
};

const buildBasicProductSummary = (product) => {
  const variants = buildBasicProductVariantSummaries(product);
  const totalInventory = getProductTotalInventory(product);
  const primaryImageUrl = getProductPrimaryImageUrl(product);

  return {
    ...product,
    inventory_quantity: totalInventory,
    shopify_inventory_quantity: totalInventory,
    total_inventory: totalInventory,
    total_shopify_inventory: totalInventory,
    sku: getProductPrimarySku(product),
    image_url: primaryImageUrl,
    variants,
    variants_count: variants.length,
    has_multiple_variants: variants.length > 1,
  };
};

const buildBasicProductListItem = (product, isAdmin) => {
  const { data, ...summary } = buildBasicProductSummary(product);
  return sanitizeProductForRole(summary, isAdmin);
};

const isBasicProductsListRequest = (query = {}) => {
  const view = String(query?.view || query?.mode || "")
    .trim()
    .toLowerCase();
  return view === "basic" || String(query?.light || "").trim() === "1";
};

const MOON_PROFIT_PAYMENT_TAG_PREFIXES = [
  "moon_profit_payment_method:",
  "moon_profit_pm:",
];
const MOON_PROFIT_PAYMENT_NOTE_ATTRIBUTE_NAMES = [
  "moon_profit_payment_method",
  "moon_profit_pm",
  "payment_method",
];
const MOON_PROFIT_STATUS_TAG_PREFIXES = ["moon_profit_status:"];
const MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES = [
  "moon_profit_status",
  "status",
];

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();
  if (
    normalized === "none" ||
    normalized === "shopify" ||
    normalized === "instapay" ||
    normalized === "wallet"
  ) {
    return normalized;
  }
  return "";
};

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
      if (lowerTag.startsWith(normalizedPrefix)) {
        const rawValue = tag.slice(prefix.length).trim();
        if (rawValue) {
          return rawValue;
        }
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

const resolveManualPaymentMethodFromData = (data = {}) => {
  const fromData = normalizePaymentMethod(data?.moon_profit_payment_method);
  if (fromData) {
    return fromData;
  }

  const fromAttributes = normalizePaymentMethod(
    getNoteAttributeValue(data, MOON_PROFIT_PAYMENT_NOTE_ATTRIBUTE_NAMES),
  );
  if (fromAttributes) {
    return fromAttributes;
  }

  const tags = parseTagList(data?.tags);
  return normalizePaymentMethod(
    extractTagValueByPrefixes(tags, MOON_PROFIT_PAYMENT_TAG_PREFIXES),
  );
};

const resolveOrderStatusFromData = (data = {}) => {
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

const normalizeOrderReference = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeSearchValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizePhoneSearch = (value) => String(value || "").replace(/\D/g, "");

const splitSearchTokens = (value) =>
  Array.from(new Set(normalizeSearchValue(value).split(/\s+/).filter(Boolean)));

const findOrderByReferenceForUser = async (userId, orderReference) => {
  const normalizedReference = String(orderReference || "").trim();
  if (!normalizedReference) {
    return { data: null, error: null };
  }

  const directLookup = await Order.findByIdForUser(userId, normalizedReference);
  if (directLookup?.error || directLookup?.data) {
    return directLookup;
  }

  const { data: orders, error } = await Order.findByUser(userId);
  if (error) {
    return { data: null, error };
  }

  const referenceLower = normalizeOrderReference(normalizedReference);
  const matchedOrder = (orders || []).find((order) => {
    const orderId = normalizeOrderReference(order?.id);
    const shopifyId = normalizeOrderReference(order?.shopify_id);
    const orderNumber = normalizeOrderReference(order?.order_number);
    return (
      orderId === referenceLower ||
      shopifyId === referenceLower ||
      orderNumber === referenceLower
    );
  });

  return { data: matchedOrder || null, error: null };
};

const getOrderFinancialStatus = (order) => {
  const data = parseJsonField(order?.data);
  return String(
    resolveOrderStatusFromData(data) ||
      data?.financial_status ||
      order?.financial_status ||
      order?.status ||
      "",
  )
    .toLowerCase()
    .trim();
};

const isShopifyPaidOrder = (order) => {
  const status = getOrderFinancialStatus(order);
  return status === "paid" || status === "partially_paid";
};

const getOrderGrossAmount = (order) => {
  const data = parseJsonField(order?.data);
  return toNumber(order?.total_price ?? data?.total_price);
};

const getOrderCurrentAmount = (order) => {
  const data = parseJsonField(order?.data);
  return toNumber(order?.current_total_price ?? data?.current_total_price);
};

const getRefundedAmountFromTransactions = (order) => {
  const data = parseJsonField(order?.data);
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
  const financialStatus = getOrderFinancialStatus(order);
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

  if (
    financialStatus === "refunded" &&
    refundedAmount <= 0 &&
    grossAmount > 0
  ) {
    refundedAmount = grossAmount;
  }

  return Math.min(grossAmount, Math.max(0, refundedAmount));
};

const isCancelledOrder = (order) => {
  const data = parseJsonField(order?.data);
  const financialStatus = getOrderFinancialStatus(order);

  return (
    Boolean(order?.cancelled_at) ||
    Boolean(data?.cancelled_at) ||
    financialStatus === "voided" ||
    financialStatus === "cancelled"
  );
};

const getOrderNetSalesAmount = (order) => {
  const grossAmount = getOrderGrossAmount(order);
  if (grossAmount <= 0 || isCancelledOrder(order)) {
    return 0;
  }

  if (!PAID_LIKE_STATUSES.has(getOrderFinancialStatus(order))) {
    return 0;
  }

  return Math.max(0, grossAmount - getOrderRefundedAmount(order));
};

const resolveOrderPaymentMethod = (order) => {
  const explicitPaymentMethod = normalizePaymentMethod(order?.payment_method);
  if (
    explicitPaymentMethod === "shopify" ||
    explicitPaymentMethod === "instapay" ||
    explicitPaymentMethod === "wallet"
  ) {
    return explicitPaymentMethod;
  }

  if (explicitPaymentMethod === "none" && !isShopifyPaidOrder(order)) {
    return "none";
  }

  if (isShopifyPaidOrder(order)) {
    return "shopify";
  }

  const data = parseJsonField(order?.data);
  const manualMethod =
    normalizePaymentMethod(order?.manual_payment_method) ||
    resolveManualPaymentMethodFromData(data);

  if (manualMethod === "instapay" || manualMethod === "wallet") {
    return manualMethod;
  }

  return "none";
};

const getOrderCustomerShopifyId = (order) => {
  const data = parseJsonField(order?.data);
  return String(order?.customer_id || data?.customer?.id || "").trim();
};

const getOrderLineItems = (order) => {
  const parsedData = parseJsonField(order?.data);
  return Array.isArray(parsedData?.line_items) ? parsedData.line_items : [];
};

const buildOrderSearchIndex = (order) => {
  const parsedData = parseJsonField(order?.data);
  const lineItems = getOrderLineItems(order);
  const previewTitles = buildOrderItemPreviews(order).map(
    (item) => item?.title,
  );
  const searchValues = [
    order?.customer_name,
    order?.customer_email,
    getOrderCustomerPhone(order),
    order?.order_number,
    order?.shopify_id,
    order?.financial_status,
    order?.fulfillment_status,
    order?.payment_method,
    order?.manual_payment_method,
    resolveOrderPaymentMethod(order),
    order?.status,
    order?.tags,
    order?.customer_note,
    parsedData?.name,
    parsedData?.tags,
    parsedData?.note,
    parsedData?.customer?.first_name,
    parsedData?.customer?.last_name,
    parsedData?.customer?.email,
    parsedData?.customer?.phone,
    parsedData?.shipping_address?.name,
    parsedData?.shipping_address?.phone,
    parsedData?.shipping_address?.address1,
    parsedData?.shipping_address?.address2,
    parsedData?.shipping_address?.city,
    parsedData?.shipping_address?.province,
    parsedData?.shipping_address?.country,
    parsedData?.shipping_address?.zip,
    parsedData?.billing_address?.name,
    parsedData?.billing_address?.phone,
    parsedData?.billing_address?.address1,
    parsedData?.billing_address?.address2,
    parsedData?.billing_address?.city,
    parsedData?.billing_address?.province,
    parsedData?.billing_address?.country,
    parsedData?.billing_address?.zip,
    ...previewTitles,
    ...lineItems.flatMap((item) => [
      item?.title,
      item?.name,
      item?.variant_title,
      item?.sku,
      item?.vendor,
      item?.fulfillment_status,
    ]),
  ]
    .map(normalizeSearchValue)
    .filter(Boolean);

  return {
    textValues: searchValues,
    numericValues: Array.from(
      new Set(searchValues.map(normalizePhoneSearch).filter(Boolean)),
    ),
  };
};

const matchesOrderSearch = (order, searchTerm) => {
  const tokens = splitSearchTokens(searchTerm);
  if (tokens.length === 0) {
    return true;
  }

  const searchIndex = buildOrderSearchIndex(order);
  return tokens.every((token) => {
    const normalizedPhoneToken = normalizePhoneSearch(token);
    return (
      searchIndex.textValues.some((value) => value.includes(token)) ||
      (normalizedPhoneToken &&
        searchIndex.numericValues.some((value) =>
          value.includes(normalizedPhoneToken),
        ))
    );
  });
};

const getOrderLineItemImageUrl = (item) => {
  const propertyImageUrl = Array.isArray(item?.properties)
    ? item.properties.find(
        (entry) => String(entry?.name || "").trim() === "_image_url",
      )?.value
    : "";

  return String(
    propertyImageUrl ||
      item?.image_url ||
      item?.image?.src ||
      item?.image?.url ||
      item?.featured_image?.src ||
      item?.featured_image?.url ||
      "",
  ).trim();
};

const buildOrderItemPreviews = (order) =>
  getOrderLineItems(order)
    .slice(0, 4)
    .map((item) => ({
      id: item?.id || null,
      title: item?.title || item?.name || "",
      quantity: toNumber(item?.quantity),
      image_url: getOrderLineItemImageUrl(item),
    }));

const buildOrderListItem = (order) => {
  const parsedData = parseJsonField(order?.data);
  const localOrderMetadata = extractOrderLocalMetadata(parsedData);
  const shippingIssue = localOrderMetadata?.shipping_issue || null;
  const financialStatus = getOrderFinancialStatus(order);
  const totalPrice = getOrderGrossAmount(order);
  const refundedAmount = getOrderRefundedAmount(order);
  const fulfillmentStatus = String(
    order?.fulfillment_status || parsedData?.fulfillment_status || "",
  )
    .toLowerCase()
    .trim();
  const itemsCount =
    order?.items_count !== undefined &&
    order?.items_count !== null &&
    String(order.items_count).trim() !== ""
      ? toNumber(order.items_count)
      : Array.isArray(parsedData?.line_items)
        ? parsedData.line_items.length
        : 0;
  const hasAnyRefund =
    refundedAmount > 0 ||
    financialStatus === "refunded" ||
    financialStatus === "partially_refunded";
  const isPartialRefund =
    financialStatus === "partially_refunded" ||
    (hasAnyRefund && refundedAmount > 0 && refundedAmount < totalPrice);
  const isFullRefund =
    financialStatus === "refunded" ||
    (hasAnyRefund && totalPrice > 0 && refundedAmount >= totalPrice);

  return {
    id: order?.id || null,
    shopify_id: order?.shopify_id || null,
    store_id: order?.store_id || null,
    order_number: order?.order_number || null,
    customer_name: order?.customer_name || "",
    customer_email: order?.customer_email || "",
    customer_phone: getOrderCustomerPhone(order),
    status: order?.status || "",
    total_price: order?.total_price ?? 0,
    total_refunded: order?.total_refunded ?? 0,
    cancelled_at: order?.cancelled_at || null,
    created_at: order?.created_at || null,
    local_updated_at: order?.local_updated_at || null,
    updated_at: order?.updated_at || null,
    last_synced_at: order?.last_synced_at || null,
    pending_sync: Boolean(order?.pending_sync),
    sync_error: order?.sync_error || "",
    items_count: itemsCount,
    customer_shopify_id: getOrderCustomerShopifyId(order),
    item_previews: buildOrderItemPreviews(order),
    financial_status: financialStatus,
    fulfillment_status: fulfillmentStatus,
    payment_method: resolveOrderPaymentMethod(order),
    refunded_amount: refundedAmount,
    has_any_refund: hasAnyRefund,
    is_partial_refund: isPartialRefund,
    is_full_refund: isFullRefund,
    is_cancelled: isCancelledOrder(order),
    is_paid: isShopifyPaidOrder(order),
    is_paid_like: PAID_LIKE_STATUSES.has(financialStatus),
    is_fulfilled: fulfillmentStatus === "fulfilled",
    net_sales_amount: getOrderNetSalesAmount(order),
    shipping_issue: shippingIssue,
    shipping_issue_reason: shippingIssue?.reason || null,
  };
};

const getOrdersListPagination = (query = {}) => {
  const requestedLimit = parseInt(query.limit, 10);
  const pagination = {
    limit:
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, ORDER_LIST_PAGE_LIMIT)
        : DEFAULT_LIST_LIMIT,
    offset: toNonNegativeInteger(query.offset, 0),
  };
  const offset = Math.max(
    0,
    Math.min(
      toNonNegativeInteger(pagination.offset, 0),
      ORDER_LIST_MAX_VISIBLE,
    ),
  );
  const remaining = Math.max(0, ORDER_LIST_MAX_VISIBLE - offset);

  return {
    limit: Math.min(pagination.limit, remaining),
    offset,
  };
};

const getFallbackOrdersPage = async (req) => {
  const scopedRowsResult = await getScopedEntityRows(req, Order);
  if (scopedRowsResult?.error) {
    throw scopedRowsResult.error;
  }

  return applyOrdersQueryFilters(scopedRowsResult?.data || [], req.query).map(
    (order) => buildOrderListItem(order),
  );
};

const searchOrdersFromShopifyFallback = async ({
  req,
  requestedStoreId,
  isAdmin,
  searchTerm,
}) => {
  const normalizedSearchTerm = String(searchTerm || "").trim();
  if (!normalizedSearchTerm) {
    return [];
  }

  const tokenData = await resolveSyncToken({
    userId: req.user.id,
    requestedStoreId,
    isAdmin,
  });

  if (!tokenData?.access_token || !tokenData?.shop) {
    return [];
  }

  const fallbackOrders = await ShopifyService.searchOrdersFromShopify(
    tokenData.access_token,
    tokenData.shop,
    normalizedSearchTerm,
    {
      limit: ORDER_SEARCH_SHOPIFY_FALLBACK_LIMIT,
    },
  );

  if (fallbackOrders.length === 0) {
    return [];
  }

  const ordersWithScope = fallbackOrders.map((order) => ({
    ...order,
    user_id: tokenData.user_id || req.user.id,
    store_id: requestedStoreId || tokenData.store_id || null,
  }));

  if (tokenData.source === "env_emergency") {
    return ordersWithScope.map((order) =>
      normalizeLiveShopifyOrderRow(order, tokenData),
    );
  }

  const persistedResult = await Order.updateMultiple(ordersWithScope);
  if (persistedResult?.error) {
    console.warn(
      "Shopify fallback order persistence warning:",
      persistedResult.error?.message || persistedResult.error,
    );
  }

  return ordersWithScope;
};

const normalizeLiveShopifyOrderRow = (order, tokenData = {}) => ({
  ...order,
  id: order?.id || order?.shopify_id || null,
  user_id: tokenData.user_id || null,
  store_id: tokenData.store_id || null,
  live_source: "shopify",
});

const getLiveShopifyOrdersPage = async ({
  req,
  pagination,
  requestedStoreId,
}) => {
  const tokenData = getEmergencyShopifyToken({
    userId: req.user?.id,
    requestedStoreId,
  });

  if (!tokenData) {
    return null;
  }

  const fetchLimit = Math.min(
    250,
    Math.max(1, pagination.offset + pagination.limit),
  );
  const result = await ShopifyService.getOrdersPageFromShopify(
    tokenData.access_token,
    tokenData.shop,
    { limit: fetchLimit },
  );
  const rows = (result.orders || []).map((order) =>
    normalizeLiveShopifyOrderRow(order, tokenData),
  );
  const filteredRows = applyOrdersQueryFilters(rows, req.query, {
    maxVisible: 250,
    paginate: false,
  });

  return {
    rows: filteredRows.map((order) => buildOrderListItem(order)),
    meta: {
      source: "shopify_live_fallback",
      fetched_count: result.fetchedCount || rows.length,
      limited_to: fetchLimit,
      database_available: false,
      read_only: true,
    },
  };
};

const buildLiveShopifyOrderDetails = (order) => {
  const parsedData = parseJsonField(order?.data);
  const customer = parsedData?.customer || {};
  const refunds = Array.isArray(parsedData?.refunds) ? parsedData.refunds : [];

  return {
    ...order,
    id: order?.id || order?.shopify_id || null,
    order_number: order?.order_number || parsedData?.order_number || null,
    customer_name:
      order?.customer_name ||
      `${customer?.first_name || ""} ${customer?.last_name || ""}`.trim(),
    customer_email: order?.customer_email || customer?.email || "",
    customer_phone: getOrderCustomerPhone(order),
    line_items: Array.isArray(parsedData?.line_items)
      ? parsedData.line_items
      : [],
    shipping_address: parsedData?.shipping_address || null,
    billing_address: parsedData?.billing_address || null,
    customer_info: parsedData?.customer
      ? {
          id: customer.id,
          email: customer.email,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          orders_count: customer.orders_count,
          total_spent: customer.total_spent,
          verified_email: customer.verified_email,
          accepts_marketing: customer.accepts_marketing,
          tags: customer.tags,
          note: customer.note,
          state: customer.state,
        }
      : null,
    contact_edits: {
      customer_phone: null,
      shipping_address: null,
    },
    shipping_issue: null,
    shipping_lines: Array.isArray(parsedData?.shipping_lines)
      ? parsedData.shipping_lines
      : [],
    discount_codes: Array.isArray(parsedData?.discount_codes)
      ? parsedData.discount_codes
      : [],
    discount_applications: Array.isArray(parsedData?.discount_applications)
      ? parsedData.discount_applications
      : [],
    tax_lines: Array.isArray(parsedData?.tax_lines) ? parsedData.tax_lines : [],
    refunds,
    total_refunded: getOrderRefundedAmount(order),
    fulfillments: Array.isArray(parsedData?.fulfillments)
      ? parsedData.fulfillments
      : [],
    payment_details: parsedData?.payment_details || null,
    payment_gateway_names: Array.isArray(parsedData?.payment_gateway_names)
      ? parsedData.payment_gateway_names
      : [],
    processing_method: parsedData?.processing_method || null,
    financial_status:
      parsedData?.financial_status || order?.financial_status || order?.status,
    payment_method: resolveOrderPaymentMethod(order),
    tags: parsedData?.tags || "",
    customer_note: parsedData?.note || "",
    note_attributes: Array.isArray(parsedData?.note_attributes)
      ? parsedData.note_attributes
      : [],
    source_name: parsedData?.source_name || "",
    source_identifier: parsedData?.source_identifier || "",
    source_url: parsedData?.source_url || "",
    browser_ip: parsedData?.browser_ip || null,
    client_details: parsedData?.client_details || null,
    total_shipping:
      parsedData?.total_shipping_price_set?.shop_money?.amount ||
      (Array.isArray(parsedData?.shipping_lines)
        ? parsedData.shipping_lines.reduce(
            (sum, line) => sum + toNumber(line?.price),
            0,
          )
        : 0),
    subtotal_price: parsedData?.subtotal_price || order?.subtotal_price || 0,
    total_line_items_price:
      parsedData?.total_line_items_price || order?.total_price || 0,
    total_discounts: parsedData?.total_discounts || 0,
    total_tax: parsedData?.total_tax || 0,
    total_tip_received: parsedData?.total_tip_received || 0,
    total_weight: parsedData?.total_weight || 0,
    presentment_currency: parsedData?.presentment_currency || null,
    total_price_set: parsedData?.total_price_set || null,
    order_status_url: parsedData?.order_status_url || null,
    cancelled_at: parsedData?.cancelled_at || order?.cancelled_at || null,
    cancel_reason: parsedData?.cancel_reason || null,
    void_reason: null,
    closed_at: parsedData?.closed_at || null,
    test: parsedData?.test || false,
    buyer_accepts_marketing: parsedData?.buyer_accepts_marketing || false,
    referring_site: parsedData?.referring_site || null,
    landing_site: parsedData?.landing_site || null,
    checkout_id: parsedData?.checkout_id || null,
    checkout_token: parsedData?.checkout_token || null,
    cart_token: parsedData?.cart_token || null,
    location_id: parsedData?.location_id || null,
    user_id_shopify: parsedData?.user_id || null,
    app_id: parsedData?.app_id || null,
    notes: [],
    live_source: "shopify",
    read_only: true,
  };
};

const getLiveShopifyOrderDetails = async ({
  req,
  orderId,
  requestedStoreId,
}) => {
  const tokenData = getEmergencyShopifyToken({
    userId: req.user?.id,
    requestedStoreId,
  });

  if (!tokenData) {
    return null;
  }

  const liveOrder = await ShopifyService.getOrderByIdFromShopify(
    tokenData.access_token,
    tokenData.shop,
    orderId,
  );

  if (!liveOrder) {
    return null;
  }

  return buildLiveShopifyOrderDetails(
    normalizeLiveShopifyOrderRow(liveOrder, tokenData),
  );
};

const getFallbackProductsPage = async (req) => {
  const scopedRowsResult = await getScopedEntityRows(req, Product);
  if (scopedRowsResult?.error) {
    throw scopedRowsResult.error;
  }

  const filteredProducts = applyProductsQueryFilters(
    scopedRowsResult?.data || [],
    req.query,
  );
  const productsWithSupplierLinks =
    await attachSupplierLinksToProducts(filteredProducts);

  return productsWithSupplierLinks.map((product) =>
    buildProductListItem(product, Boolean(req.user?.isAdmin)),
  );
};

const applyCustomersQueryFilters = (rows, query = {}) => {
  const sortBy = String(query.sort_by || "created_at").toLowerCase();
  const sortDir =
    String(query.sort_dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const limitValue = parseInt(query.limit, 10);
  const limit =
    Number.isFinite(limitValue) && limitValue > 0 ? limitValue : null;

  const sorted = [...(rows || [])].sort((a, b) => {
    if (sortBy === "total_spent") {
      return (toNumber(a.total_spent) - toNumber(b.total_spent)) * sortDir;
    }
    if (sortBy === "orders_count") {
      return (toNumber(a.orders_count) - toNumber(b.orders_count)) * sortDir;
    }
    if (sortBy === "name") {
      return String(a.name || "").localeCompare(String(b.name || "")) * sortDir;
    }
    if (sortBy === "email") {
      return (
        String(a.email || "").localeCompare(String(b.email || "")) * sortDir
      );
    }

    return (
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
      sortDir
    );
  });

  if (limit === null) {
    return sorted;
  }

  return sorted.slice(offset, offset + limit);
};

const getFallbackCustomersPage = async (req) => {
  const scopedRowsResult = await getScopedEntityRows(req, Customer);
  if (scopedRowsResult?.error) {
    throw scopedRowsResult.error;
  }

  const normalizedCustomers = applyCustomersQueryFilters(
    scopedRowsResult?.data || [],
    req.query,
  ).map((customer) => buildCustomerListItem(customer));

  return await enrichCustomersWithOrderPhones(req, normalizedCustomers);
};

const parseLocalDateInput = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const parseOrderDate = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const startOfLocalDay = (value) => {
  const date = parseLocalDateInput(value);
  if (!date) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfLocalDay = (value) => {
  const date = parseLocalDateInput(value);
  if (!date) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
};

const getNormalizedQueryDateRange = (dateFrom, dateTo) => {
  const from = dateFrom ? startOfLocalDay(dateFrom) : null;
  const to = dateTo ? endOfLocalDay(dateTo) : null;

  if (from && to && from.getTime() > to.getTime()) {
    return {
      from: startOfLocalDay(dateTo),
      to: endOfLocalDay(dateFrom),
    };
  }

  return {
    from,
    to,
  };
};

const applyOrdersQueryFilters = (
  rows,
  query = {},
  { maxVisible = ORDER_LIST_MAX_VISIBLE, paginate = true } = {},
) => {
  let filtered = [...(rows || [])];
  const normalizedDateRange = getNormalizedQueryDateRange(
    query.date_from,
    query.date_to,
  );

  if (query.search) {
    filtered = filtered.filter((order) =>
      matchesOrderSearch(order, query.search),
    );
  }

  if (normalizedDateRange.from) {
    filtered = filtered.filter((order) => {
      const orderDate = parseOrderDate(order.created_at);
      return orderDate && orderDate >= normalizedDateRange.from;
    });
  }

  if (normalizedDateRange.to) {
    filtered = filtered.filter((order) => {
      const orderDate = parseOrderDate(order.created_at);
      return orderDate && orderDate <= normalizedDateRange.to;
    });
  }

  if (query.order_number_from !== undefined) {
    const minOrderNumber = toNumber(query.order_number_from);
    filtered = filtered.filter(
      (order) => toNumber(order.order_number) >= minOrderNumber,
    );
  }

  if (query.order_number_to !== undefined) {
    const maxOrderNumber = toNumber(query.order_number_to);
    filtered = filtered.filter(
      (order) => toNumber(order.order_number) <= maxOrderNumber,
    );
  }

  if (query.min_total !== undefined) {
    const minTotal = toNumber(query.min_total);
    filtered = filtered.filter(
      (order) => toNumber(order.total_price) >= minTotal,
    );
  }

  if (query.max_total !== undefined) {
    const maxTotal = toNumber(query.max_total);
    filtered = filtered.filter(
      (order) => toNumber(order.total_price) <= maxTotal,
    );
  }

  if (query.payment_status && query.payment_status !== "all") {
    const paymentStatus = String(query.payment_status).toLowerCase();
    filtered = filtered.filter((order) => {
      const status = getOrderFinancialStatus(order);
      if (paymentStatus === "paid_or_partial") {
        return status === "paid" || status === "partially_paid";
      }
      if (paymentStatus === "pending_or_authorized") {
        return status === "pending" || status === "authorized";
      }
      return status === paymentStatus;
    });
  }

  if (query.payment_method && query.payment_method !== "all") {
    const paymentMethod = String(query.payment_method).toLowerCase().trim();
    filtered = filtered.filter(
      (order) => resolveOrderPaymentMethod(order) === paymentMethod,
    );
  }

  if (query.shipping_issue && query.shipping_issue !== "all") {
    const shippingIssueFilter = String(query.shipping_issue)
      .toLowerCase()
      .trim();
    filtered = filtered.filter((order) => {
      const shippingIssue =
        extractOrderLocalMetadata(parseJsonField(order?.data))
          ?.shipping_issue || null;

      if (shippingIssueFilter === "active") {
        return Boolean(shippingIssue);
      }

      if (shippingIssueFilter === "none") {
        return !shippingIssue;
      }

      return true;
    });
  }

  if (query.shipping_issue_reason && query.shipping_issue_reason !== "all") {
    const shippingIssueReason = String(query.shipping_issue_reason)
      .toLowerCase()
      .trim();
    filtered = filtered.filter((order) => {
      const shippingIssue =
        extractOrderLocalMetadata(parseJsonField(order?.data))
          ?.shipping_issue || null;
      return shippingIssue?.reason === shippingIssueReason;
    });
  }

  if (query.fulfillment_status && query.fulfillment_status !== "all") {
    const fulfillmentStatus = String(query.fulfillment_status).toLowerCase();
    filtered = filtered.filter((order) => {
      const status = String(order.fulfillment_status || "")
        .toLowerCase()
        .trim();
      if (fulfillmentStatus === "unfulfilled") {
        return !status || status === "unfulfilled" || status === "null";
      }
      return status === fulfillmentStatus;
    });
  }

  if (query.refund_filter && query.refund_filter !== "all") {
    const refundFilter = String(query.refund_filter).toLowerCase().trim();
    filtered = filtered.filter((order) => {
      const status = getOrderFinancialStatus(order);
      const data = parseJsonField(order.data);
      const refunds = Array.isArray(data?.refunds) ? data.refunds : [];
      const refundedFromTransactions = refunds.reduce((sum, refund) => {
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
      const totalPrice = toNumber(order.total_price);
      const refundedAmount = Math.max(
        toNumber(order.total_refunded),
        refundedFromTransactions,
      );
      const hasAnyRefund =
        refundedAmount > 0 ||
        status === "refunded" ||
        status === "partially_refunded";
      const isPartialRefund =
        status === "partially_refunded" ||
        (hasAnyRefund && refundedAmount > 0 && refundedAmount < totalPrice);
      const isFullRefund =
        status === "refunded" ||
        (hasAnyRefund && totalPrice > 0 && refundedAmount >= totalPrice);

      if (refundFilter === "any") return hasAnyRefund;
      if (refundFilter === "partial") return isPartialRefund;
      if (refundFilter === "full") return isFullRefund;
      if (refundFilter === "none") return !hasAnyRefund;
      return true;
    });
  }

  if (String(query.cancelled_only || "").toLowerCase() === "true") {
    filtered = filtered.filter((order) => {
      const data = parseJsonField(order.data);
      const status = String(
        getOrderFinancialStatus(order) || order.status || "",
      )
        .toLowerCase()
        .trim();
      return (
        Boolean(order.cancelled_at) ||
        Boolean(data?.cancelled_at) ||
        status === "voided" ||
        status === "cancelled"
      );
    });
  }

  const sortBy = String(query.sort_by || "created_at").toLowerCase();
  const sortDir =
    String(query.sort_dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (sortBy === "total_price") {
      return (toNumber(a.total_price) - toNumber(b.total_price)) * sortDir;
    }
    if (sortBy === "order_number") {
      return (toNumber(a.order_number) - toNumber(b.order_number)) * sortDir;
    }
    return (
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
      sortDir
    );
  });

  if (Number.isFinite(maxVisible) && maxVisible > 0) {
    filtered = filtered.slice(0, maxVisible);
  }

  if (!paginate) {
    return filtered;
  }

  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const limitValue = parseInt(query.limit, 10);
  const limit =
    Number.isFinite(limitValue) && limitValue > 0 ? limitValue : null;
  if (limit === null) return filtered;
  return filtered.slice(offset, offset + limit);
};

const parseTimestampValue = (value) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildCustomerListItem = (
  customer,
  { includeData = false, includeDetails = false } = {},
) => {
  const parsedData = parseJsonField(customer?.data);
  const tags = Array.isArray(parsedData?.tags)
    ? parsedData.tags
    : String(parsedData?.tags || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const result = {
    ...customer,
    phone: extractCustomerPhone(customer),
    default_address:
      customer?.default_address || parsedData?.default_address?.address1 || "",
    city: customer?.city || parsedData?.default_address?.city || "",
    country: customer?.country || parsedData?.default_address?.country || "",
  };

  if (!includeData) {
    delete result.data;
  }

  if (includeDetails) {
    result.tags = tags;
    result.last_order_name =
      parsedData?.last_order_name || parsedData?.last_order?.name || "";
    result.default_address_details = parsedData?.default_address || {};
  }

  return result;
};

const getOrderCustomerPhone = (order) => {
  const parsedData = parseJsonField(order?.data);

  return String(
    order?.customer_phone ||
      parsedData?.customer?.phone ||
      parsedData?.shipping_address?.phone ||
      parsedData?.billing_address?.phone ||
      "",
  ).trim();
};

const enrichCustomersWithOrderPhones = async (req, customers = []) => {
  const baseCustomers = Array.isArray(customers) ? customers : [];
  const unresolvedEmails = Array.from(
    new Set(
      baseCustomers
        .filter((customer) => !String(customer?.phone || "").trim())
        .map((customer) => String(customer?.email || "").trim())
        .filter(Boolean),
    ),
  );

  if (unresolvedEmails.length === 0) {
    return baseCustomers;
  }

  try {
    const requestedStoreId = getRequestedStoreId(req);
    const isAdmin = await resolveIsAdmin(req);
    const selectCandidates = [
      "customer_email,data,customer_phone,store_id,user_id,updated_at",
      "customer_email,data,store_id,user_id,updated_at",
    ];
    let orderRows = [];
    let lastError = null;

    for (const selectedColumns of selectCandidates) {
      let query = db
        .from("orders")
        .select(selectedColumns)
        .in("customer_email", unresolvedEmails)
        .order("updated_at", { ascending: false });

      if (requestedStoreId) {
        query = query.eq("store_id", requestedStoreId);
      } else if (!isAdmin) {
        const accessibleStoreIds = await getAccessibleStoreIds(req.user.id);
        if (accessibleStoreIds.length > 0) {
          query = query.in("store_id", accessibleStoreIds);
        } else {
          query = query.eq("user_id", req.user.id);
        }
      }

      const { data, error } = await query;
      if (!error) {
        orderRows = data || [];
        lastError = null;
        break;
      }

      lastError = error;
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }
    }

    if (lastError) {
      throw lastError;
    }

    const phoneByEmail = new Map();
    for (const order of orderRows) {
      const email = String(order?.customer_email || "").trim();
      if (!email || phoneByEmail.has(email)) {
        continue;
      }

      const phone = getOrderCustomerPhone(order);
      if (phone) {
        phoneByEmail.set(email, phone);
      }
    }

    return baseCustomers.map((customer) => ({
      ...customer,
      phone:
        String(customer?.phone || "").trim() ||
        phoneByEmail.get(String(customer?.email || "").trim()) ||
        "",
    }));
  } catch (error) {
    console.warn("Customer phone order fallback failed:", error.message);
    return baseCustomers;
  }
};

const parseJsonArrayField = (value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const setLatestActionTimestamp = (map, lookupKey, timestamp) => {
  const normalizedKey = String(lookupKey || "").trim();
  if (!normalizedKey || !Number.isFinite(timestamp) || timestamp <= 0) {
    return;
  }

  map.set(normalizedKey, Math.max(timestamp, toNumber(map.get(normalizedKey))));
};

const getLatestLegacyOrderActionTimestamp = (order) => {
  const notes = parseJsonArrayField(order?.notes);

  return notes.reduce((latestTimestamp, note) => {
    const nextTimestamp = Math.max(
      parseTimestampValue(note?.edited_at),
      parseTimestampValue(note?.updated_at),
      parseTimestampValue(note?.created_at),
      parseTimestampValue(note?.createdAt),
    );

    return Math.max(latestTimestamp, nextTimestamp);
  }, 0);
};

const loadLatestOrderActionTimestampsByKey = async (orders = []) => {
  const rows = Array.isArray(orders) ? orders : [];
  const actionTimestampsByKey = new Map();

  for (const order of rows) {
    const latestLegacyActionTimestamp =
      getLatestLegacyOrderActionTimestamp(order);
    setLatestActionTimestamp(
      actionTimestampsByKey,
      order?.id,
      latestLegacyActionTimestamp,
    );
    setLatestActionTimestamp(
      actionTimestampsByKey,
      order?.shopify_id,
      latestLegacyActionTimestamp,
    );
  }

  const shopifyOrderIds = Array.from(
    new Set(
      rows
        .map((order) => String(order?.shopify_id || "").trim())
        .filter(Boolean),
    ),
  );

  for (
    let startIndex = 0;
    startIndex < shopifyOrderIds.length;
    startIndex += ORDER_ACTION_LOOKUP_CHUNK_SIZE
  ) {
    const chunk = shopifyOrderIds.slice(
      startIndex,
      startIndex + ORDER_ACTION_LOOKUP_CHUNK_SIZE,
    );

    if (chunk.length === 0) {
      continue;
    }

    try {
      const { data, error } = await db
        .from("order_comments")
        .select("order_id, created_at, updated_at, edited_at")
        .in("order_id", chunk);

      if (error) {
        console.warn(
          "Order action lookup skipped for missing orders:",
          error.message || error,
        );
        break;
      }

      for (const comment of data || []) {
        const latestCommentTimestamp = Math.max(
          parseTimestampValue(comment?.edited_at),
          parseTimestampValue(comment?.updated_at),
          parseTimestampValue(comment?.created_at),
        );

        setLatestActionTimestamp(
          actionTimestampsByKey,
          comment?.order_id,
          latestCommentTimestamp,
        );
      }
    } catch (error) {
      console.warn(
        "Order action lookup failed for missing orders:",
        error?.message || error,
      );
      break;
    }
  }

  return actionTimestampsByKey;
};

const getMissingOrdersForRows = async (rows = []) => {
  const rawRows = Array.isArray(rows) ? rows : [];
  const storeIds = Array.from(
    new Set(
      rawRows
        .map((order) => String(order?.store_id || "").trim())
        .filter(Boolean),
    ),
  );

  const warehouseRowsByStoreId =
    await loadWarehouseAvailabilityByStoreIds(storeIds);
  const orderActionTimestampsByKey =
    await loadLatestOrderActionTimestampsByKey(rawRows);

  return buildMissingOrdersFromStock({
    orders: rawRows,
    warehouseRowsByStoreId,
    orderActionTimestampsByKey,
    buildOrderListItem,
  });
};

const getMissingOrdersForRequest = async (req) => {
  const isAdmin = await resolveIsAdmin(req);
  const accessibleStoreIds = isAdmin
    ? []
    : await getAccessibleStoreIds(req.user.id);
  const requestedStoreId = getAuthorizedRequestedStoreId({
    requestedStoreId: getRequestedStoreId(req),
    isAdmin,
    accessibleStoreIds,
  });
  const cacheKey = getRequestScopedCacheKey({
    scope: "missing-orders",
    userId: req.user.id,
    requestedStoreId,
    isAdmin,
  });
  const bypassCache = shouldBypassHeavyCache(req);
  if (!bypassCache) {
    const cachedResult = readTimedRowsCache(
      missingOrdersCache,
      cacheKey,
      MISSING_ORDERS_CACHE_TTL_MS,
    );
    if (cachedResult) {
      return {
        orders: cachedResult.rows,
        cacheHit: true,
      };
    }
  }

  if (!bypassCache) {
    const pendingResult = missingOrdersInFlight.get(cacheKey);
    if (pendingResult) {
      const result = await pendingResult;
      return {
        ...result,
        cacheHit: true,
      };
    }
  }

  const requestPromise = (async () => {
    const scopedRowsResult = await loadMissingOrdersSourceRows(req);
    if (scopedRowsResult?.error) {
      throw scopedRowsResult.error;
    }

    const orders = await getMissingOrdersForRows(scopedRowsResult?.data || []);
    writeTimedRowsCache(missingOrdersCache, cacheKey, orders);

    return {
      orders,
      cacheHit: false,
    };
  })();

  missingOrdersInFlight.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    if (missingOrdersInFlight.get(cacheKey) === requestPromise) {
      missingOrdersInFlight.delete(cacheKey);
    }
  }
};

const getMissingOrderRecipients = async () => {
  const { data: users, error } = await db
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
  const nonAdminIds = activeUsers
    .filter((user) => !Boolean(user?.role === "admin"))
    .map((user) => user.id);

  let permissionByUserId = new Map();
  if (nonAdminIds.length > 0) {
    const { data: permissionRows, error: permissionError } = await db
      .from("permissions")
      .select("user_id, can_view_orders")
      .in("user_id", nonAdminIds);

    if (permissionError && !isSchemaCompatibilityError(permissionError)) {
      throw permissionError;
    }

    permissionByUserId = new Map(
      (permissionRows || []).map((row) => [
        String(row?.user_id || "").trim(),
        Boolean(row?.can_view_orders),
      ]),
    );
  }

  return activeUsers
    .filter((user) => {
      if (
        String(user?.role || "")
          .trim()
          .toLowerCase() === "admin"
      ) {
        return true;
      }

      const explicitPermission = permissionByUserId.get(
        String(user?.id || "").trim(),
      );
      return explicitPermission !== false;
    })
    .map((user) => String(user.id || "").trim())
    .filter(Boolean);
};

const shouldNotifyForMissingStage = (order, nowTimestamp = Date.now()) => {
  const transitionTimestamp = parseTimestampValue(
    order?.missing_state === "escalated"
      ? order?.escalated_since
      : order?.missing_since,
  );

  return (
    transitionTimestamp > 0 &&
    nowTimestamp - transitionTimestamp <= MISSING_ORDER_NOTIFICATION_WINDOW_MS
  );
};

const buildWarehouseMissingOrderNotificationDraft = (order, userId) => {
  const isEscalated = order?.missing_state === "escalated";
  const isInStockNoAction =
    order?.missing_reason === MISSING_ORDER_REASON_NO_ACTION;
  const notificationType = isEscalated
    ? "order_missing_escalated"
    : "order_missing";
  const orderLabel =
    order?.order_number || order?.shopify_id || order?.id || "Unknown";
  const daysWithoutAttention =
    order?.days_without_action || order?.days_without_stock || 0;
  const shortageQuantity = toNumber(order?.warehouse_shortage_quantity);
  const shortageItemsCount = toNumber(order?.warehouse_shortage_items_count);
  let title = `Ø·Ù„Ø¨ #${orderLabel} Ø¯Ø®Ù„ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø®Ø§Ø±Ø¬Ø© Ø¹Ù† Ø§Ù„Ù…Ø®Ø²ÙˆÙ†`;
  let message = `Ø§Ù„Ø·Ù„Ø¨ ØºÙŠØ± Ù…ØªØºØ·Ù‰ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ù…Ù† Ù…Ø®Ø²ÙˆÙ† Ø§Ù„Ù…Ø®Ø²Ù† Ù…Ù†Ø° ${daysWithoutAttention || 3} Ø£ÙŠØ§Ù… ÙˆØªÙ… Ù†Ù‚Ù„Ù‡ Ø¥Ù„Ù‰ ØµÙØ­Ø© Ø§Ù„Ø·Ù„Ø¨Ø§Øª Ø§Ù„Ø®Ø§Ø±Ø¬Ø© Ø¹Ù† Ø§Ù„Ù…Ø®Ø²ÙˆÙ†.`;

  if (isEscalated && isInStockNoAction) {
    title = `Ø·Ù„Ø¨ #${orderLabel} Ø¨Ø¯ÙˆÙ† Ù…ØªØ§Ø¨Ø¹Ø© Ø¨Ø´ÙƒÙ„ Ø­Ø±Ø¬`;
    message = `Ø¬Ù…ÙŠØ¹ Ø£ØµÙ†Ø§Ù Ø§Ù„Ø·Ù„Ø¨ Ù…ØºØ·Ø§Ø© Ù…Ù† Ø§Ù„Ù…Ø®Ø²Ù†ØŒ Ù„ÙƒÙ† Ù„Ù… ÙŠØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø£ÙŠ Ù…ØªØ§Ø¨Ø¹Ø© Ø¹Ù„ÙŠÙ‡ Ù…Ù†Ø° ${daysWithoutAttention || 6} Ø£ÙŠØ§Ù….`;
  } else if (isEscalated) {
    title = `Ø·Ù„Ø¨ #${orderLabel} Ø®Ø§Ø±Ø¬ Ø§Ù„Ù…Ø®Ø²ÙˆÙ† Ø¨Ø´ÙƒÙ„ Ø­Ø±Ø¬`;
    message = `Ø§Ù„Ø·Ù„Ø¨ ØºÙŠØ± Ù…ØªØºØ·Ù‰ Ù…Ù† Ù…Ø®Ø²ÙˆÙ† Ø§Ù„Ù…Ø®Ø²Ù† Ù…Ù†Ø° ${daysWithoutAttention || 6} Ø£ÙŠØ§Ù…ØŒ ÙˆØ§Ù„Ø¹Ø¬Ø² Ø§Ù„Ø­Ø§Ù„ÙŠ ${shortageQuantity} Ù‚Ø·Ø¹Ø© Ø¹Ø¨Ø± ${shortageItemsCount || 1} ØµÙ†Ù.`;
  } else if (isInStockNoAction) {
    title = `Ø·Ù„Ø¨ #${orderLabel} Ø¯Ø®Ù„ Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø© Ø¨Ø¯ÙˆÙ† Ø¥Ø¬Ø±Ø§Ø¡`;
    message = `Ø¬Ù…ÙŠØ¹ Ø£ØµÙ†Ø§Ù Ø§Ù„Ø·Ù„Ø¨ Ù…ØªØ§Ø­Ø© ÙÙŠ Ø§Ù„Ù…Ø®Ø²Ù†ØŒ Ù„ÙƒÙ† Ù„Ù… ÙŠØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø£ÙŠ ØªØ¹Ù„ÙŠÙ‚ Ø£Ùˆ Ù…ØªØ§Ø¨Ø¹Ø© Ø¹Ù„ÙŠÙ‡ Ù…Ù†Ø° ${daysWithoutAttention || 3} Ø£ÙŠØ§Ù…ØŒ ÙØªÙ… Ù†Ù‚Ù„Ù‡ Ù„Ù‚Ø§Ø¦Ù…Ø© Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©.`;
  }

  let notificationTitle = `Order #${orderLabel} moved to out-of-stock follow-up`;
  let notificationMessage = `Warehouse stock still does not fully cover this order after ${daysWithoutAttention || 3} days.`;

  if (isEscalated && isInStockNoAction) {
    notificationTitle = `Order #${orderLabel} is critical without follow-up`;
    notificationMessage = `Warehouse stock fully covers this order, but no action or comment has been recorded for ${daysWithoutAttention || 6} days.`;
  } else if (isEscalated) {
    notificationTitle = `Order #${orderLabel} is critically out of stock`;
    notificationMessage = `Warehouse stock still does not fully cover this order after ${daysWithoutAttention || 6} days. Current shortage: ${shortageQuantity} unit(s) across ${shortageItemsCount || 1} item(s).`;
  } else if (isInStockNoAction) {
    notificationTitle = `Order #${orderLabel} moved to no-action follow-up`;
    notificationMessage = `Warehouse stock fully covers this order, but no action or comment has been recorded for ${daysWithoutAttention || 3} days.`;
  }

  return {
    user_id: userId,
    type: notificationType,
    title: notificationTitle,
    message: notificationMessage,
    entity_type: "order",
    entity_id: order?.id || null,
    metadata: {
      route: "/orders/missing",
      order_id: order?.id || null,
      order_number: order?.order_number || null,
      missing_reason:
        order?.missing_reason || MISSING_ORDER_REASON_STOCK_SHORTAGE,
      missing_state: order?.missing_state || "missing",
      days_without_stock: order?.days_without_stock || 0,
      days_without_action: daysWithoutAttention,
      warehouse_coverable: Boolean(order?.warehouse_coverable),
      warehouse_shortage_quantity: shortageQuantity,
      warehouse_shortage_items_count: shortageItemsCount,
    },
  };

  return {
    user_id: userId,
    type: notificationType,
    title: isEscalated
      ? `طلب #${orderLabel} خارج المخزون بشكل حرج`
      : `طلب #${orderLabel} دخل قائمة الطلبات الخارجة عن المخزون`,
    message: isEscalated
      ? `الطلب غير متغطى من مخزون المخزن منذ ${daysWithoutStock || 6} أيام، والعجز الحالي ${shortageQuantity} قطعة عبر ${shortageItemsCount || 1} صنف.`
      : `الطلب غير متغطى بالكامل من مخزون المخزن منذ ${daysWithoutStock || 3} أيام وتم نقله إلى صفحة الطلبات الخارجة عن المخزون.`,
    entity_type: "order",
    entity_id: order?.id || null,
    metadata: {
      route: "/orders/missing",
      order_id: order?.id || null,
      order_number: order?.order_number || null,
      missing_state: order?.missing_state || "missing",
      days_without_stock: daysWithoutStock,
      days_without_action: daysWithoutStock,
      warehouse_shortage_quantity: shortageQuantity,
      warehouse_shortage_items_count: shortageItemsCount,
    },
  };
};

const ensureMissingOrderNotifications = async (missingOrders = []) => {
  const recentOrders = (missingOrders || []).filter((order) =>
    shouldNotifyForMissingStage(order),
  );
  if (recentOrders.length === 0) {
    return 0;
  }

  const recipientIds = await getMissingOrderRecipients();
  if (recipientIds.length === 0) {
    return 0;
  }

  const notificationTypes = Array.from(MISSING_ORDER_NOTIFICATION_TYPES);
  const entityIds = recentOrders
    .map((order) => String(order?.id || "").trim())
    .filter(Boolean);

  const { data: existingNotifications, error: existingError } = await db
    .from("notifications")
    .select("user_id, entity_id, type")
    .in("user_id", recipientIds)
    .in("entity_id", entityIds)
    .in("type", notificationTypes);

  if (existingError) {
    if (isSchemaCompatibilityError(existingError)) {
      return 0;
    }
    throw existingError;
  }

  const existingKeys = new Set(
    (existingNotifications || []).map(
      (row) =>
        `${String(row?.user_id || "").trim()}::${String(row?.entity_id || "").trim()}::${String(row?.type || "").trim()}`,
    ),
  );

  const drafts = [];
  for (const order of recentOrders) {
    for (const userId of recipientIds) {
      const draft = buildWarehouseMissingOrderNotificationDraft(order, userId);
      const key = `${draft.user_id}::${draft.entity_id}::${draft.type}`;
      if (existingKeys.has(key)) {
        continue;
      }
      drafts.push(draft);
      existingKeys.add(key);
    }
  }

  if (drafts.length === 0) {
    return 0;
  }

  const { error: insertError } = await db.from("notifications").insert(drafts);
  if (insertError) {
    if (isSchemaCompatibilityError(insertError)) {
      return 0;
    }
    throw insertError;
  }

  emitRealtimeEvent({
    userIds: recipientIds,
    payload: {
      resource: "notifications",
      context: "missing_orders",
    },
  });

  return drafts.length;
};

const getLatestOrderTimestamp = (orders = []) => {
  const latest = (orders || []).reduce((maxValue, order) => {
    const candidate = Math.max(
      parseTimestampValue(order?.shopify_updated_at),
      parseTimestampValue(order?.updated_at),
      parseTimestampValue(order?.created_at),
    );
    return candidate > maxValue ? candidate : maxValue;
  }, 0);

  return latest > 0 ? new Date(latest) : null;
};

const buildBackgroundSyncKey = ({ userId, storeId, shop }) =>
  `${String(userId || "").trim()}::${String(storeId || "all").trim()}::${String(
    shop || "",
  ).trim()}`;

const syncRecentOrdersWithCooldown = async ({
  userId,
  requestedStoreId,
  isAdmin,
  latestKnownOrderAt,
  waitForCompletion = false,
  forceRun = false,
}) => {
  try {
    const tokenData = await resolveSyncToken({
      userId,
      requestedStoreId,
      isAdmin,
    });

    if (!tokenData?.access_token || !tokenData?.shop) {
      return { triggered: false, reason: "not_connected" };
    }

    const syncOwnerUserId = tokenData.user_id || userId;
    const { supabase } = await import("../supabaseClient.js");
    let syncStoreId =
      requestedStoreId ||
      tokenData.store_id ||
      (await findExistingStoreIdByShop({
        supabase,
        shop: tokenData.shop,
      }));

    if (!syncStoreId) {
      const storeConnection = await findOrCreateStoreConnection({
        supabase,
        shop: tokenData.shop,
        userId: syncOwnerUserId,
      });
      syncStoreId = storeConnection?.id || null;
    }

    if (syncStoreId) {
      await grantUserStoreAccess({
        supabase,
        userId: syncOwnerUserId,
        storeId: syncStoreId,
      });
    }
    const key = buildBackgroundSyncKey({
      userId: syncOwnerUserId,
      storeId: syncStoreId,
      shop: tokenData.shop,
    });
    const nowMs = Date.now();
    const state = orderBackgroundSyncState.get(key);
    if (state?.inFlight) {
      return { triggered: false, reason: "in_flight" };
    }
    if (
      !forceRun &&
      state?.lastRunMs &&
      nowMs - state.lastRunMs < ORDER_BACKGROUND_SYNC_COOLDOWN_MS
    ) {
      return { triggered: false, reason: "cooldown" };
    }

    const latestKnownMs = parseTimestampValue(latestKnownOrderAt);
    const fallbackStart = nowMs - ORDER_BACKGROUND_SYNC_LOOKBACK_MS;
    const updatedAtMin = new Date(
      latestKnownMs > 0
        ? Math.max(fallbackStart, latestKnownMs - 60 * 60 * 1000)
        : fallbackStart,
    ).toISOString();

    const runSync = async () => {
      orderBackgroundSyncState.set(key, {
        inFlight: true,
        lastRunMs: state?.lastRunMs || 0,
      });

      try {
        const result = await ShopifyService.syncRecentOrders(
          syncOwnerUserId,
          tokenData.shop,
          tokenData.access_token,
          syncStoreId,
          { updatedAtMin },
        );

        orderBackgroundSyncState.set(key, {
          inFlight: false,
          lastRunMs: Date.now(),
        });

        return result;
      } catch (syncError) {
        orderBackgroundSyncState.set(key, {
          inFlight: false,
          lastRunMs: Date.now(),
        });
        throw syncError;
      }
    };

    if (waitForCompletion) {
      await runSync();
      return { triggered: true, reason: "performed" };
    }

    runSync().catch((syncError) => {
      console.error("Background recent orders sync failed:", syncError);
    });
    return { triggered: true, reason: "started_background" };
  } catch (error) {
    console.error("Recent orders sync failed:", error);
    return {
      triggered: false,
      reason: "failed",
      error: error?.message || String(error),
    };
  }
};

const applyProductsQueryFilters = (rows, query = {}) => {
  let filtered = [...(rows || [])];
  const parseLocalDateInput = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return null;
    }

    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      const parsed = new Date(normalized);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }

    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  };
  const startOfLocalDay = (value) => {
    const date = parseLocalDateInput(value);
    if (!date) {
      return null;
    }

    date.setHours(0, 0, 0, 0);
    return date;
  };
  const endOfLocalDay = (value) => {
    const date = parseLocalDateInput(value);
    if (!date) {
      return null;
    }

    date.setHours(23, 59, 59, 999);
    return date;
  };
  const getNormalizedUpdatedDateRange = (dateFrom, dateTo) => {
    const from = dateFrom ? startOfLocalDay(dateFrom) : null;
    const to = dateTo ? endOfLocalDay(dateTo) : null;

    if (from && to && from.getTime() > to.getTime()) {
      return {
        from: startOfLocalDay(dateTo),
        to: endOfLocalDay(dateFrom),
      };
    }

    return {
      from,
      to,
    };
  };
  const parseUpdatedAtValue = (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const normalizedUpdatedDateRange = getNormalizedUpdatedDateRange(
    query.updated_from,
    query.updated_to,
  );

  if (query.search) {
    const keyword = String(query.search).toLowerCase().trim();
    filtered = filtered.filter((product) => {
      const title = String(product.title || "").toLowerCase();
      const vendor = String(product.vendor || "").toLowerCase();
      const sku = String(product.sku || "").toLowerCase();
      const type = String(product.product_type || "").toLowerCase();
      return (
        title.includes(keyword) ||
        vendor.includes(keyword) ||
        sku.includes(keyword) ||
        type.includes(keyword)
      );
    });
  }

  if (query.vendor && query.vendor !== "all") {
    filtered = filtered.filter(
      (product) =>
        String(product.vendor || "").toLowerCase() ===
        String(query.vendor).toLowerCase(),
    );
  }

  if (query.product_type && query.product_type !== "all") {
    filtered = filtered.filter(
      (product) =>
        String(product.product_type || "").toLowerCase() ===
        String(query.product_type).toLowerCase(),
    );
  }

  if (query.stock_status && query.stock_status !== "all") {
    const stockStatus = String(query.stock_status).toLowerCase().trim();
    filtered = filtered.filter((product) => {
      const quantity = toNumber(product.inventory_quantity);
      const actualStockState =
        quantity <= 0
          ? "out_of_stock"
          : quantity < 10
            ? "low_stock"
            : "in_stock";
      const effectiveStockState =
        isProductLowStockAlertsSuppressed(product) &&
        actualStockState !== "in_stock"
          ? "suppressed"
          : actualStockState;
      if (stockStatus === "out_of_stock") {
        return effectiveStockState === "out_of_stock";
      }
      if (stockStatus === "low_stock") {
        return effectiveStockState === "low_stock";
      }
      if (stockStatus === "in_stock") {
        return effectiveStockState === "in_stock";
      }
      return true;
    });
  }

  if (query.sync_status && query.sync_status !== "all") {
    const syncStatus = String(query.sync_status).toLowerCase().trim();
    filtered = filtered.filter((product) => {
      if (syncStatus === "pending") return Boolean(product.pending_sync);
      if (syncStatus === "failed") return Boolean(product.sync_error);
      if (syncStatus === "synced") return Boolean(product.last_synced_at);
      if (syncStatus === "never")
        return (
          !product.pending_sync &&
          !product.sync_error &&
          !product.last_synced_at
        );
      return true;
    });
  }

  if (query.min_price !== undefined) {
    const minPrice = toNumber(query.min_price);
    filtered = filtered.filter(
      (product) => toNumber(product.price) >= minPrice,
    );
  }

  if (query.max_price !== undefined) {
    const maxPrice = toNumber(query.max_price);
    filtered = filtered.filter(
      (product) => toNumber(product.price) <= maxPrice,
    );
  }

  if (query.min_inventory !== undefined) {
    const minInventory = toNumber(query.min_inventory);
    filtered = filtered.filter(
      (product) => toNumber(product.inventory_quantity) >= minInventory,
    );
  }

  if (query.max_inventory !== undefined) {
    const maxInventory = toNumber(query.max_inventory);
    filtered = filtered.filter(
      (product) => toNumber(product.inventory_quantity) <= maxInventory,
    );
  }

  if (normalizedUpdatedDateRange.from) {
    filtered = filtered.filter((product) => {
      const updatedAt = parseUpdatedAtValue(product.updated_at);
      return updatedAt && updatedAt >= normalizedUpdatedDateRange.from;
    });
  }

  if (normalizedUpdatedDateRange.to) {
    filtered = filtered.filter((product) => {
      const updatedAt = parseUpdatedAtValue(product.updated_at);
      return updatedAt && updatedAt <= normalizedUpdatedDateRange.to;
    });
  }

  const sortBy = String(query.sort_by || "updated_at").toLowerCase();
  const sortDir =
    String(query.sort_dir || "desc").toLowerCase() === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (sortBy === "price")
      return (toNumber(a.price) - toNumber(b.price)) * sortDir;
    if (sortBy === "inventory_quantity") {
      return (
        (toNumber(a.inventory_quantity) - toNumber(b.inventory_quantity)) *
        sortDir
      );
    }
    if (sortBy === "title") {
      return (
        String(a.title || "").localeCompare(String(b.title || "")) * sortDir
      );
    }
    return (
      (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) *
      sortDir
    );
  });

  const offset = Math.max(0, parseInt(query.offset, 10) || 0);
  const limitValue = parseInt(query.limit, 10);
  const limit =
    Number.isFinite(limitValue) && limitValue > 0 ? limitValue : null;
  if (limit === null) return filtered;
  return filtered.slice(offset, offset + limit);
};

// 1. Get Shopify Authorization URL
router.post(
  "/auth-url",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const inputShop = normalizeShopDomain(req.body?.shop);
      const userId = req.user.id; // Changed from req.user.userId

      if (!inputShop || !SHOP_DOMAIN_REGEX.test(inputShop)) {
        return res.status(400).json({
          error: "Invalid shop domain. Use format: your-store.myshopify.com",
        });
      }

      const { apiKey } = await getShopifyCredentials(userId);
      const scopes =
        "read_products,write_products,read_orders,read_customers,write_orders";
      const redirectUri = getRedirectUri(req);

      const authParams = new URLSearchParams({
        client_id: apiKey,
        scope: scopes,
        redirect_uri: redirectUri,
        state: String(userId || ""),
      });
      const authUrl = `https://${inputShop}/admin/oauth/authorize?${authParams.toString()}`;

      res.json({ authUrl });
    } catch (error) {
      console.error("Error getting auth URL:", error);
      res
        .status(500)
        .json({ error: "Failed to create Shopify authorization URL." });
    }
  },
);

// 2. OAuth Callback
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;
  const shop = String(req.query?.shop || "")
    .trim()
    .toLowerCase();
  const userId = state;
  const frontendUrl = normalizeBaseUrl(
    process.env.FRONTEND_URL || "http://localhost:3000",
  );

  if (!code || !shop || !userId) {
    return res.redirect(`${frontendUrl}/settings?error=invalid_callback`);
  }

  try {
    const { apiKey, apiSecret } = await getShopifyCredentials(userId);

    const response = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: apiKey,
        client_secret: apiSecret,
        code: code,
      },
    );

    const accessToken = response.data.access_token;
    const { supabase } = await import("../supabaseClient.js");

    const store = await findOrCreateStoreConnection({
      supabase,
      shop,
      userId,
    });
    const storeId = store?.id || null;

    await grantUserStoreAccess({
      supabase,
      userId,
      storeId,
    });

    const saveTokenResult = await ShopifyToken.save(
      userId,
      shop,
      accessToken,
      storeId,
    );
    if (saveTokenResult?.error) {
      throw new Error(
        `Failed to save Shopify connection: ${getSchemaErrorMessage(saveTokenResult.error)}`,
      );
    }

    queueShopifyBackgroundSync(
      {
        user_id: userId,
        store_id: storeId,
        shop,
        access_token: accessToken,
      },
      ["orders", "products", "customers"],
    );
    const initialSyncStatus = "queued";
    const initialSyncCounts = null;

    ensureWebhooksRegistered({
      shop,
      accessToken,
      webhookAddress: getWebhookAddress(req),
    }).catch((webhookError) => {
      console.error("Webhook registration error after callback:", webhookError);
    });

    const callbackParams = new URLSearchParams({
      connected: "true",
      shop,
      sync_status: initialSyncStatus,
    });
    if (storeId) {
      callbackParams.set("store_id", storeId);
    }
    if (initialSyncCounts) {
      callbackParams.set("sync_counts", JSON.stringify(initialSyncCounts));
    }

    res.redirect(`${frontendUrl}/settings?${callbackParams.toString()}`);
  } catch (error) {
    const readableError = getReadableShopifyError(error);
    console.error(
      "Shopify OAuth Callback Error:",
      error.response?.data || error.message,
    );
    const callbackErrorParams = new URLSearchParams({
      error: "callback_failed",
      error_message: readableError,
    });
    res.redirect(`${frontendUrl}/settings?${callbackErrorParams.toString()}`);
  }
});

// 3. Sync data from Shopify
router.post(
  "/sync",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      console.log("🔄 Starting Shopify sync process...");

      const userId = req.user.id;
      const requestedStoreId = getRequestedStoreId(req);
      const isAdmin = await resolveIsAdmin(req);

      console.log(
        `👤 User ID: ${userId}, Store ID: ${requestedStoreId}, Admin: ${isAdmin}`,
      );

      // Try to get token data with better error handling
      let tokenData;
      try {
        tokenData = await resolveSyncToken({
          userId,
          requestedStoreId,
          isAdmin,
        });
      } catch (tokenError) {
        console.error("❌ Error resolving sync token:", tokenError);
        return res.status(500).json({
          error: "Failed to resolve Shopify connection",
          details: tokenError.message,
        });
      }

      if (!tokenData) {
        console.log("❌ No Shopify token found");
        return res.status(400).json({
          error: "Shopify is not connected for this account/store.",
          code: "SHOPIFY_NOT_CONNECTED",
        });
      }

      console.log(`🏪 Found Shopify connection: ${tokenData.shop}`);

      const syncOwnerUserId = tokenData.user_id || userId;

      // Force store ID to ensure data linking
      const { supabase } = await import("../supabaseClient.js");
      let syncStoreId =
        requestedStoreId ||
        tokenData.store_id ||
        (await findExistingStoreIdByShop({
          supabase,
          shop: tokenData.shop,
        }));

      if (!syncStoreId) {
        const storeConnection = await findOrCreateStoreConnection({
          supabase,
          shop: tokenData.shop,
          userId: syncOwnerUserId,
        });
        syncStoreId = storeConnection?.id || null;
      }

      // Legacy fallback if store mapping could not be resolved dynamically
      if (!syncStoreId) {
        syncStoreId = null;
        console.warn(
          "Sync continuing without resolved store_id; rows stay user-scoped until store mapping exists.",
        );
        console.log("🏪 Using default store ID for sync:", syncStoreId);
      }

      console.log(
        `🔄 Starting sync for user: ${syncOwnerUserId}, store: ${syncStoreId}`,
      );

      if (syncStoreId) {
        await grantUserStoreAccess({
          supabase,
          userId: syncOwnerUserId,
          storeId: syncStoreId,
        });

        if (userId !== syncOwnerUserId) {
          await grantUserStoreAccess({
            supabase,
            userId,
            storeId: syncStoreId,
          });
        }

        if (tokenData.id && tokenData.store_id !== syncStoreId) {
          const { error: tokenStoreUpdateError } = await supabase
            .from("shopify_tokens")
            .update({
              store_id: syncStoreId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", tokenData.id);

          if (tokenStoreUpdateError) {
            console.warn(
              "Failed to persist resolved store_id on Shopify token:",
              tokenStoreUpdateError.message,
            );
          } else {
            tokenData.store_id = syncStoreId;
          }
        }
      }

      queueShopifyBackgroundSync(
        {
          user_id: syncOwnerUserId,
          store_id: syncStoreId,
          shop: tokenData.shop,
          access_token: tokenData.access_token,
        },
        ["orders", "products", "customers"],
      );

      // Try webhook registration (optional, don't fail if it doesn't work)
      let webhookSync = null;
      try {
        webhookSync = await ensureWebhooksRegistered({
          shop: tokenData.shop,
          accessToken: tokenData.access_token,
          webhookAddress: getWebhookAddress(req),
        });
      } catch (webhookError) {
        console.error(
          "⚠️ Webhook registration failed (non-critical):",
          webhookError,
        );
        webhookSync = {
          error: "Webhook registration failed",
        };
      }

      const response = {
        success: true,
        mode: "background",
        message: "Background Shopify sync started",
        store_id: syncStoreId,
        webhook_sync: webhookSync,
        counts: null,
        persisted_counts: null,
        latest_order: null,
      };

      console.log("Queued Shopify background sync:", {
        store_id: syncStoreId,
        shop: tokenData.shop,
      });
      res.json(response);
    } catch (error) {
      console.error("💥 Critical error in sync endpoint:", error);
      res.status(500).json({
        error: "Internal server error during sync",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  },
);

// 4. Check Shopify connection status
router.get(
  "/status",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const requestedStoreId = getRequestedStoreId(req);
      const isAdmin = await resolveIsAdmin(req);
      const { supabase } = await import("../supabaseClient.js");
      const tokenData = await resolveSyncToken({
        userId: req.user.id,
        requestedStoreId,
        isAdmin,
      });

      const redirectUri = getRedirectUri(req);
      const resolvedStoreId =
        tokenData?.store_id ||
        requestedStoreId ||
        (await findExistingStoreIdByShop({
          supabase,
          shop: tokenData?.shop || "",
        }));

      const validation = tokenData?.access_token
        ? await validateShopifyConnection({
            shop: tokenData.shop,
            accessToken: tokenData.access_token,
          })
        : {
            valid: false,
            requiresReconnect: false,
            message: null,
          };
      const ordersReadAccess = tokenData?.access_token
        ? await validateShopifyOrdersReadAccess({
            shop: tokenData.shop,
            accessToken: tokenData.access_token,
          })
        : {
            readable: false,
            message: null,
          };

      res.json({
        connected: Boolean(tokenData?.access_token && validation.valid),
        shop: tokenData?.shop || null,
        store_id: resolvedStoreId || null,
        source: tokenData?.source || "database",
        emergency_fallback: tokenData?.source === "env_emergency",
        orders_readable: Boolean(ordersReadAccess.readable),
        orders_read_error: ordersReadAccess.readable
          ? null
          : ordersReadAccess.message,
        redirectUri: redirectUri,
        webhookAddress: getWebhookAddress(req),
        requires_reconnect: validation.requiresReconnect,
        connection_error: validation.valid ? null : validation.message,
      });
    } catch (error) {
      res.json({
        connected: false,
        shop: null,
        redirectUri: getRedirectUri(req),
        webhookAddress: getWebhookAddress(req),
      });
    }
  },
);

router.post(
  "/disconnect",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const requestedStoreId = getRequestedStoreId(req);
      const isAdmin = await resolveIsAdmin(req);
      const userId = req.user.id;

      const tokenData = await resolveSyncToken({
        userId,
        requestedStoreId,
        isAdmin,
      });

      if (!tokenData) {
        return res.status(400).json({
          error: "Shopify is not connected for this account/store.",
          code: "SHOPIFY_NOT_CONNECTED",
        });
      }

      const isConnectionOwner =
        String(tokenData.user_id || "") === String(userId || "");
      const webhookAddress = getWebhookAddress(req);
      if (isConnectionOwner && webhookAddress) {
        try {
          await removeManagedWebhooks({
            shop: tokenData.shop,
            accessToken: tokenData.access_token,
            webhookAddress,
          });
        } catch (webhookError) {
          console.error(
            "Failed to remove Shopify webhooks during disconnect:",
            webhookError,
          );
        }
      }

      const { supabase } = await import("../supabaseClient.js");
      const storeId = requestedStoreId || tokenData.store_id || null;

      if (isConnectionOwner) {
        let deleteTokensQuery = supabase
          .from("shopify_tokens")
          .delete()
          .eq("user_id", userId)
          .eq("shop", tokenData.shop);
        if (storeId) {
          deleteTokensQuery = deleteTokensQuery.eq("store_id", storeId);
        }
        const { error: deleteTokensError } = await deleteTokensQuery;
        if (deleteTokensError) {
          return res.status(500).json({ error: deleteTokensError.message });
        }
      }

      if (storeId) {
        await supabase
          .from("user_stores")
          .delete()
          .eq("user_id", userId)
          .eq("store_id", storeId);
      }

      res.json({
        success: true,
        message: isConnectionOwner
          ? "Shopify disconnected successfully."
          : "Your access to this Shopify store has been removed.",
        shop: tokenData.shop,
        store_id: storeId,
        disconnected_scope: isConnectionOwner
          ? "store_connection"
          : "user_access",
      });
    } catch (error) {
      console.error("Disconnect Shopify error:", error);
      res.status(500).json({ error: "Failed to disconnect Shopify." });
    }
  },
);

// 5. Save Shopify API credentials
router.post(
  "/save-credentials",
  verifyToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const userId = req.user.id; // Changed from req.user.userId
      const { apiKey, apiSecret } = req.body;

      if (!apiKey || !apiSecret) {
        return res
          .status(400)
          .json({ error: "API Key and API Secret are required." });
      }

      const { supabase } = await import("../supabaseClient.js");
      const { data: existing } = await supabase
        .from("shopify_credentials")
        .select("id")
        .eq("user_id", userId)
        .single();

      const payload = {
        user_id: userId,
        api_key: apiKey,
        api_secret: apiSecret,
      };
      let error;

      if (existing) {
        const result = await supabase
          .from("shopify_credentials")
          .update({ api_key: apiKey, api_secret: apiSecret })
          .eq("user_id", userId);
        error = result.error;
      } else {
        const result = await supabase
          .from("shopify_credentials")
          .insert([payload]);
        error = result.error;
      }

      if (error) throw error;

      res.json({ success: true, message: "Credentials saved successfully." });
    } catch (error) {
      console.error("Save credentials error:", error);
      res.status(500).json({ error: "Failed to save credentials." });
    }
  },
);

// 6. Get Shopify credentials for current user
router.get(
  "/get-credentials",
  verifyToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const { apiKey } = await getShopifyCredentials(req.user.id); // Changed from req.user.userId
      res.json({ hasCredentials: true, apiKey });
    } catch (error) {
      res.json({ hasCredentials: false });
    }
  },
);

// Other data-fetching routes remain unchanged...
router.get(
  "/products",
  verifyToken,
  requirePermission("can_view_products"),
  async (req, res) => {
    try {
      const isBasicView = isBasicProductsListRequest(req.query);
      const pagination = getListPagination(req.query);
      const sortOptions = getListSortOptions(
        req.query,
        PRODUCT_SORT_FIELDS,
        "updated_at",
        "desc",
      );
      const { data, error, isAdmin, cacheStatus } = await getScopedEntityPage({
        req,
        tableName: "products",
        selects: PRODUCT_LIST_SELECTS,
        pagination,
        sortOptions,
      });
      if (cacheStatus) {
        res.setHeader("X-Moon-Profit-Products-Db-Cache", cacheStatus);
      }
      if (error) {
        console.error("Error fetching products:", error);
        try {
          const fallbackProducts = await getFallbackProductsPage(req);
          res.setHeader("X-Products-Fallback", "scoped_rows");
          return res.json(
            buildPaginatedCollection(fallbackProducts, pagination),
          );
        } catch (fallbackError) {
          console.error("Fallback products query failed:", fallbackError);
        }

        return res.status(500).json({ error: error.message });
      }
      console.log(
        `Returning ${data?.length || 0} products for user ${req.user.id}`,
      );
      const sourceProducts = isBasicView
        ? data || []
        : await attachSupplierLinksToProducts(data || []);
      const sanitizedProducts = sourceProducts.map((product) =>
        isBasicView
          ? buildBasicProductListItem(product, isAdmin)
          : buildProductListItem(product, isAdmin),
      );
      if (isBasicView) {
        res.setHeader("X-Moon-Profit-Products-View", "basic");
      }
      res.json(buildPaginatedCollection(sanitizedProducts, pagination));
    } catch (e) {
      console.error("Exception fetching products:", e);
      res.status(500).json({ error: e.message });
    }
  },
);
router.get(
  "/orders/shipping-issues",
  verifyToken,
  requireAnyPermission(["can_view_orders", "can_edit_orders"]),
  async (req, res) => {
    try {
      const pagination = getListPagination(
        req.query,
        DEFAULT_LIST_LIMIT,
        ORDER_LIST_PAGE_LIMIT,
      );
      const reasonFilter = String(
        req.query.reason || req.query.shipping_issue_reason || "",
      )
        .trim()
        .toLowerCase();

      const { rows, repairedCount, cacheHit } =
        await loadShippingIssueOrdersForRequest(req);
      let normalizedOrders = normalizeShippingIssueRows(rows || []);

      if (reasonFilter && reasonFilter !== "all") {
        normalizedOrders = normalizedOrders.filter(
          (order) =>
            String(order?.shipping_issue_reason || "")
              .trim()
              .toLowerCase() === reasonFilter,
        );
      }

      normalizedOrders.sort((left, right) => {
        const leftTimestamp = Date.parse(
          left?.shipping_issue?.updated_at ||
            left?.local_updated_at ||
            left?.updated_at ||
            left?.created_at ||
            "",
        );
        const rightTimestamp = Date.parse(
          right?.shipping_issue?.updated_at ||
            right?.local_updated_at ||
            right?.updated_at ||
            right?.created_at ||
            "",
        );

        if (Number.isNaN(leftTimestamp) && Number.isNaN(rightTimestamp)) {
          return 0;
        }
        if (Number.isNaN(leftTimestamp)) {
          return 1;
        }
        if (Number.isNaN(rightTimestamp)) {
          return -1;
        }

        return rightTimestamp - leftTimestamp;
      });

      if (repairedCount > 0) {
        res.setHeader(
          "X-Orders-Shipping-Issue-Recovery",
          String(repairedCount),
        );
      }
      if (cacheHit) {
        res.setHeader("X-Orders-Shipping-Issues-Cache", "hit");
      }

      return res.json(
        buildSlicedPaginatedCollection(normalizedOrders, pagination, {
          summary: {
            total_shipping_issues: normalizedOrders.length,
          },
        }),
      );
    } catch (error) {
      console.error("Error fetching shipping issues orders:", error);
      return res.status(500).json({
        error: error.message || "Failed to fetch shipping issues",
      });
    }
  },
);
router.get(
  "/orders",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const searchAllHistoryRequested =
        String(req.query.search_all || "")
          .toLowerCase()
          .trim() === "true";
      const searchAllHistory =
        searchAllHistoryRequested && hasActiveOrderScopeFilters(req.query);
      const pagination = searchAllHistory
        ? getListPagination(
            req.query,
            DEFAULT_LIST_LIMIT,
            ORDER_LIST_PAGE_LIMIT,
          )
        : getOrdersListPagination(req.query);
      pagination.limit = Math.min(pagination.limit, ORDER_LIST_PAGE_LIMIT);
      const sortOptions = getListSortOptions(
        req.query,
        ORDER_SORT_FIELDS,
        "created_at",
        "desc",
      );
      if (pagination.limit <= 0) {
        return res.json(
          buildLimitedPaginatedCollection(
            [],
            pagination,
            ORDER_LIST_MAX_VISIBLE,
          ),
        );
      }
      const requestedStoreId = getRequestedStoreId(req);
      const isAdmin = await resolveIsAdmin(req);

      const syncRecentParam = String(req.query.sync_recent || "")
        .toLowerCase()
        .trim();
      const forceSyncRecent = syncRecentParam === "force";
      let liveSyncResult = null;

      if (forceSyncRecent && pagination.offset === 0) {
        const tokenData = await resolveSyncToken({
          userId: req.user.id,
          requestedStoreId,
          isAdmin,
        });

        if (tokenData?.access_token && tokenData?.shop) {
          queueShopifyBackgroundSync(
            {
              user_id: tokenData.user_id || req.user.id,
              store_id: requestedStoreId || tokenData.store_id || null,
              shop: tokenData.shop,
              access_token: tokenData.access_token,
            },
            ["orders"],
          );
          liveSyncResult = { triggered: true, reason: "queued_background" };
        }
      }

      if (searchAllHistory) {
        const scopedRowsResult = await getScopedEntityRows(req, Order);
        if (scopedRowsResult?.error) {
          console.error(
            "Error fetching full-history orders search:",
            scopedRowsResult.error,
          );
          return res.status(500).json({
            error: scopedRowsResult.error.message || "Failed to search orders",
          });
        }

        const recoveryResult = await maybeRecoverShippingIssuesFromHistory({
          req,
          orders: scopedRowsResult?.data || [],
          requestedStoreId,
          pagination,
          searchAllHistory: true,
        });

        let matchedOrders = applyOrdersQueryFilters(
          recoveryResult.orders || [],
          req.query,
          {
            maxVisible: null,
            paginate: false,
          },
        ).map((order) => buildOrderListItem(order));
        let searchScope = "full_history";

        if (
          matchedOrders.length === 0 &&
          String(req.query.search || "").trim()
        ) {
          try {
            const shopifyFallbackOrders = await searchOrdersFromShopifyFallback(
              {
                req,
                requestedStoreId,
                isAdmin,
                searchTerm: req.query.search,
              },
            );

            if (shopifyFallbackOrders.length > 0) {
              matchedOrders = applyOrdersQueryFilters(
                shopifyFallbackOrders,
                req.query,
                {
                  maxVisible: null,
                  paginate: false,
                },
              ).map((order) => buildOrderListItem(order));
              searchScope = "shopify_fallback";
            }
          } catch (fallbackError) {
            console.error(
              "Error fetching on-demand Shopify order search fallback:",
              fallbackError,
            );
          }
        }

        if (liveSyncResult) {
          res.setHeader(
            "X-Orders-Live-Sync",
            liveSyncResult.reason || "attempted",
          );
        }
        if (recoveryResult.repairedCount > 0) {
          res.setHeader(
            "X-Orders-Shipping-Issue-Recovery",
            String(recoveryResult.repairedCount),
          );
        }

        res.setHeader("X-Orders-Search-Scope", searchScope);
        return res.json(
          buildSlicedPaginatedCollection(matchedOrders, pagination, {
            meta: {
              search_scope: searchScope,
            },
          }),
        );
      }

      let data = [];
      let error = null;

      try {
        const scopedPageResult = await withRouteTimeout(
          "Orders query",
          getScopedEntityPage({
            req,
            tableName: "orders",
            selects: ORDER_LIST_SELECTS,
            pagination,
            sortOptions,
          }),
          18 * 1000,
        );
        data = scopedPageResult?.data || [];
        error = scopedPageResult?.error || null;
        if (scopedPageResult?.cacheStatus) {
          res.setHeader(
            "X-Moon-Profit-Orders-Db-Cache",
            scopedPageResult.cacheStatus,
          );
        }
      } catch (queryError) {
        error = queryError;
      }

      if (error) {
        console.error("Error fetching orders:", error);
        if (isQueryRetryableError(error) || error?.code === "ETIMEDOUT") {
          try {
            const liveFallback = await getLiveShopifyOrdersPage({
              req,
              pagination,
              requestedStoreId,
            });

            if (liveFallback) {
              if (liveSyncResult) {
                res.setHeader(
                  "X-Orders-Live-Sync",
                  liveSyncResult.reason || "attempted",
                );
              }
              res.setHeader("X-Orders-Fallback", "shopify_live");
              return res.json(
                buildSlicedPaginatedCollection(liveFallback.rows, pagination, {
                  meta: liveFallback.meta,
                }),
              );
            }
          } catch (liveFallbackError) {
            console.error(
              "Live Shopify orders fallback failed:",
              liveFallbackError?.message || liveFallbackError,
            );
          }

          return res.status(503).json({
            error:
              "Orders are temporarily unavailable while the database finishes maintenance",
          });
        }

        try {
          const fallbackOrders = await getFallbackOrdersPage(req);
          if (liveSyncResult) {
            res.setHeader(
              "X-Orders-Live-Sync",
              liveSyncResult.reason || "attempted",
            );
          }
          res.setHeader("X-Orders-Fallback", "scoped_rows");
          return res.json(
            buildLimitedPaginatedCollection(
              fallbackOrders,
              pagination,
              ORDER_LIST_MAX_VISIBLE,
            ),
          );
        } catch (fallbackError) {
          console.error("Fallback orders query failed:", fallbackError);
        }

        return res.status(500).json({ error: error.message });
      }

      console.log(
        `Returning ${data?.length || 0} orders for user ${req.user.id}`,
      );
      const waitForRecovery = toBooleanQueryFlag(
        req.query?.recover_history,
        false,
      );
      let ordersForResponse = data || [];
      let repairedCount = 0;

      if (waitForRecovery) {
        const recoveryResult = await maybeRecoverShippingIssuesFromHistory({
          req,
          orders: data || [],
          requestedStoreId,
          pagination,
        });
        ordersForResponse = recoveryResult.orders || [];
        repairedCount = recoveryResult.repairedCount || 0;
      } else {
        void maybeRecoverShippingIssuesFromHistory({
          req,
          orders: data || [],
          requestedStoreId,
          pagination,
        }).catch((recoveryError) => {
          console.error(
            "Background shipping issue recovery failed:",
            recoveryError?.message || recoveryError,
          );
        });
      }

      const normalizedOrders = ordersForResponse.map((order) =>
        buildOrderListItem(order),
      );
      if (liveSyncResult) {
        res.setHeader(
          "X-Orders-Live-Sync",
          liveSyncResult.reason || "attempted",
        );
      }
      if (repairedCount > 0) {
        res.setHeader(
          "X-Orders-Shipping-Issue-Recovery",
          String(repairedCount),
        );
      }
      res.json(
        buildLimitedPaginatedCollection(
          normalizedOrders,
          pagination,
          ORDER_LIST_MAX_VISIBLE,
        ),
      );
    } catch (e) {
      console.error("Exception fetching orders:", e);
      res.status(500).json({ error: e.message });
    }
  },
);
router.get(
  "/orders/missing",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const pagination = getListPagination(
        req.query,
        DEFAULT_LIST_LIMIT,
        ORDER_LIST_PAGE_LIMIT,
      );

      const { orders: missingOrders, cacheHit } =
        await getMissingOrdersForRequest(req);

      if (pagination.offset === 0) {
        void ensureMissingOrderNotifications(missingOrders).catch(
          (notificationError) => {
            console.error(
              "Missing orders notification error (non-blocking):",
              notificationError,
            );
          },
        );
      }

      const summary = {
        total_missing: missingOrders.length,
        escalated_count: missingOrders.filter(
          (order) => order?.missing_state === "escalated",
        ).length,
        warning_count: missingOrders.filter(
          (order) => order?.missing_state !== "escalated",
        ).length,
        stock_shortage_count: missingOrders.filter(
          (order) =>
            order?.missing_reason === MISSING_ORDER_REASON_STOCK_SHORTAGE,
        ).length,
        no_action_count: missingOrders.filter(
          (order) => order?.missing_reason === MISSING_ORDER_REASON_NO_ACTION,
        ).length,
      };

      if (cacheHit) {
        res.setHeader("X-Orders-Missing-Cache", "hit");
      }

      res.json(
        buildSlicedPaginatedCollection(missingOrders, pagination, { summary }),
      );
    } catch (error) {
      console.error("Error fetching missing orders:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to fetch missing orders" });
    }
  },
);
router.get(
  "/customers",
  verifyToken,
  requirePermission("can_view_customers"),
  async (req, res) => {
    try {
      const pagination = getListPagination(req.query);
      const includeData = toBooleanQueryFlag(req.query.include_data, false);
      const includeOrderPhoneFallback = toBooleanQueryFlag(
        req.query.include_order_phone_fallback,
        false,
      );
      const sortOptions = getListSortOptions(
        req.query,
        CUSTOMER_SORT_FIELDS,
        "created_at",
        "desc",
      );
      const { data, error, cacheStatus } = await getScopedEntityPage({
        req,
        tableName: "customers",
        selects: includeData ? CUSTOMER_DETAIL_SELECTS : CUSTOMER_LIST_SELECTS,
        pagination,
        sortOptions,
      });
      if (cacheStatus) {
        res.setHeader("X-Moon-Profit-Customers-Db-Cache", cacheStatus);
      }
      if (error) {
        console.error("Error fetching customers:", error);
        try {
          const fallbackCustomers = await getFallbackCustomersPage(req);
          res.setHeader("X-Customers-Fallback", "scoped_rows");
          return res.json(
            buildPaginatedCollection(fallbackCustomers, pagination),
          );
        } catch (fallbackError) {
          console.error("Fallback customers query failed:", fallbackError);
        }

        return res.status(500).json({ error: error.message });
      }
      console.log(
        `Returning ${data?.length || 0} customers for user ${req.user.id}`,
      );
      const normalizedCustomers = (data || []).map((customer) =>
        buildCustomerListItem(customer, { includeData }),
      );
      const finalCustomers = includeOrderPhoneFallback
        ? await enrichCustomersWithOrderPhones(req, normalizedCustomers)
        : normalizedCustomers;
      res.json(buildPaginatedCollection(finalCustomers, pagination));
    } catch (e) {
      console.error("Exception fetching customers:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

router.get(
  "/customers/:id",
  verifyToken,
  requirePermission("can_view_customers"),
  async (req, res) => {
    try {
      const { data, error } = await Customer.findByIdForUser(
        req.user.id,
        req.params.id,
      );

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      if (!data) {
        return res.status(404).json({ error: "Customer not found" });
      }

      res.json(buildCustomerListItem(data, { includeDetails: true }));
    } catch (e) {
      console.error("Exception fetching customer details:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

router.get(
  "/products/:id",
  verifyToken,
  requirePermission("can_view_products"),
  async (req, res) => {
    try {
      const isAdmin = await resolveIsAdmin(req);
      const { data, error } = await Product.findByIdForUser(
        req.user.id,
        req.params.id,
      );
      if (error) return res.status(500).json({ error: error.message });
      if (!data) {
        return res.status(404).json({ error: "Product not found" });
      }
      const [productWithSupplierLinks] = await attachSupplierLinksToProducts([
        data,
      ]);
      res.json(
        sanitizeProductForRole(
          buildProductSummary(productWithSupplierLinks || data),
          isAdmin,
        ),
      );
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.get(
  "/products/:id/details",
  verifyToken,
  requirePermission("can_view_products"),
  async (req, res) => {
    try {
      const productId = req.params.id;
      const userId = req.user.id;
      const isAdmin = await resolveIsAdmin(req);

      const product = await ProductManagementService.getProductDetails(
        userId,
        productId,
      );
      const [productWithSupplierLinks] = await attachSupplierLinksToProducts([
        product,
      ]);
      const productWithSourcing = await attachProductSourcingDetail(
        productWithSupplierLinks || product,
      );

      res.json(sanitizeProductForRole(productWithSourcing, isAdmin));
    } catch (error) {
      console.error("Get product details error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);
router.get(
  "/orders/:id",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const { data, error } = await Order.findByIdForUser(
        req.user.id,
        req.params.id,
      );
      if (error) return res.status(500).json({ error: error.message });
      if (!data) {
        return res.status(404).json({ error: "Order not found" });
      }
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
);

router.post(
  "/orders/products-summary",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const requestedOrderIds = Array.isArray(req.body?.order_ids)
        ? req.body.order_ids
        : [];
      const orderIds = Array.from(
        new Set(
          requestedOrderIds
            .map((value) => String(value || "").trim())
            .filter(Boolean),
        ),
      );

      if (orderIds.length === 0) {
        return res.status(400).json({ error: "order_ids is required" });
      }

      if (orderIds.length > MAX_EXPORT_ORDER_IDS) {
        return res.status(400).json({
          error: `A maximum of ${MAX_EXPORT_ORDER_IDS} order IDs can be exported at once`,
        });
      }

      const scopedRowsResult = await getScopedEntityRows(req, Order);
      if (scopedRowsResult?.error) {
        return res.status(500).json({
          error: scopedRowsResult.error.message || "Failed to load orders",
        });
      }

      const orderMap = new Map(
        (scopedRowsResult?.data || []).map((order) => [
          String(order?.id || "").trim(),
          order,
        ]),
      );
      const matchedOrders = orderIds
        .map((orderId) => orderMap.get(orderId))
        .filter(Boolean);
      const missingOrderIds = orderIds.filter(
        (orderId) => !orderMap.has(orderId),
      );

      if (matchedOrders.length === 0) {
        return res.status(404).json({
          error: "No matching orders found for export",
        });
      }

      const payload = buildProductsSummaryExportPayload(matchedOrders);
      res.json({
        ...payload,
        meta: {
          requested_order_count: orderIds.length,
          matched_order_count: matchedOrders.length,
          missing_order_ids: missingOrderIds,
        },
      });
    } catch (error) {
      console.error("Orders products summary export error:", error);
      res
        .status(500)
        .json({ error: error.message || "Failed to export orders" });
    }
  },
);

// MVP: Product Update Endpoints

router.post(
  "/products/:id/update-price",
  verifyToken,
  requirePermission("can_edit_products"),
  async (req, res) => {
    try {
      const { price } = req.body;
      const productId = req.params.id;
      const userId = req.user.id;

      if (price === undefined || price === null) {
        return res.status(400).json({ error: "Price is required" });
      }

      const result = await ProductUpdateService.updatePrice(
        userId,
        productId,
        parseFloat(price),
      );
      res.json(result);
    } catch (error) {
      console.error("Update price error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/products/:id/update-inventory",
  verifyToken,
  requirePermission("can_edit_products"),
  async (req, res) => {
    try {
      const { inventory } = req.body;
      const productId = req.params.id;
      const userId = req.user.id;

      if (inventory === undefined || inventory === null) {
        return res.status(400).json({ error: "Inventory is required" });
      }

      const result = await ProductUpdateService.updateInventory(
        userId,
        productId,
        parseInt(inventory, 10),
      );
      res.json(result);
    } catch (error) {
      console.error("Update inventory error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/products/:id/update",
  verifyToken,
  requirePermission("can_edit_products"),
  async (req, res) => {
    try {
      const isAdmin = await resolveIsAdmin(req);
      const {
        price,
        cost_price,
        ads_cost,
        operation_cost,
        shipping_cost,
        inventory,
        sku,
        supplier_phone,
        supplier_location,
        suppress_low_stock_alerts,
        variant_updates,
      } = req.body;
      const productId = req.params.id;
      const userId = req.user.id;

      if (cost_price !== undefined && cost_price !== null && !isAdmin) {
        return res.status(403).json({
          error: "Access denied: admin access required for cost price updates",
        });
      }

      if (ads_cost !== undefined && ads_cost !== null && !isAdmin) {
        return res.status(403).json({
          error: "Access denied: admin access required for ads cost updates",
        });
      }

      if (operation_cost !== undefined && operation_cost !== null && !isAdmin) {
        return res.status(403).json({
          error:
            "Access denied: admin access required for operation cost updates",
        });
      }

      if (shipping_cost !== undefined && shipping_cost !== null && !isAdmin) {
        return res.status(403).json({
          error:
            "Access denied: admin access required for shipping cost updates",
        });
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "suppress_low_stock_alerts",
        ) &&
        !isAdmin
      ) {
        return res.status(403).json({
          error:
            "Access denied: admin access required for low-stock alert preference updates",
        });
      }

      const updates = {};
      if (price !== undefined && price !== null)
        updates.price = parseFloat(price);
      if (cost_price !== undefined && cost_price !== null)
        updates.cost_price = parseFloat(cost_price);
      if (ads_cost !== undefined && ads_cost !== null)
        updates.ads_cost = parseFloat(ads_cost);
      if (operation_cost !== undefined && operation_cost !== null)
        updates.operation_cost = parseFloat(operation_cost);
      if (shipping_cost !== undefined && shipping_cost !== null)
        updates.shipping_cost = parseFloat(shipping_cost);
      if (inventory !== undefined && inventory !== null)
        updates.inventory = parseInt(inventory, 10);
      if (Object.prototype.hasOwnProperty.call(req.body, "sku")) {
        updates.sku = String(sku ?? "").trim();
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "supplier_phone")) {
        updates.supplier_phone = String(supplier_phone ?? "").trim();
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "supplier_location")) {
        updates.supplier_location = String(supplier_location ?? "").trim();
      }
      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "suppress_low_stock_alerts",
        )
      ) {
        updates.suppress_low_stock_alerts = parseBooleanFlag(
          suppress_low_stock_alerts,
          "suppress_low_stock_alerts",
        );
      }
      if (Array.isArray(variant_updates) && variant_updates.length > 0) {
        updates.variant_updates = variant_updates.map((variantUpdate) => {
          const nextVariantUpdate = {
            id: variantUpdate?.id,
          };

          if (
            Object.prototype.hasOwnProperty.call(
              variantUpdate || {},
              "inventory_quantity",
            )
          ) {
            nextVariantUpdate.inventory_quantity = parseInt(
              variantUpdate?.inventory_quantity,
              10,
            );
          }

          if (
            Object.prototype.hasOwnProperty.call(variantUpdate || {}, "price")
          ) {
            nextVariantUpdate.price = parseFloat(variantUpdate?.price);
          }

          if (
            Object.prototype.hasOwnProperty.call(variantUpdate || {}, "sku")
          ) {
            nextVariantUpdate.sku = String(variantUpdate?.sku ?? "").trim();
          }

          return nextVariantUpdate;
        });
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      const result = await ProductUpdateService.updateProduct(
        userId,
        productId,
        updates,
      );
      res.json(result);
    } catch (error) {
      console.error("Update product error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

// Order Management Endpoints

router.get(
  "/orders/:id/details",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const userId = req.user.id;

      const order = await withRouteTimeout(
        "Order details query",
        OrderManagementService.getOrderDetails(userId, orderId),
        18 * 1000,
      );

      res.json(order);
    } catch (error) {
      console.error("Get order details error:", error);
      if (isQueryRetryableError(error) || error?.code === "ETIMEDOUT") {
        try {
          const liveOrder = await getLiveShopifyOrderDetails({
            req,
            orderId: req.params.id,
            requestedStoreId: getRequestedStoreId(req),
          });

          if (liveOrder) {
            res.setHeader("X-Order-Details-Fallback", "shopify_live");
            return res.json(liveOrder);
          }
        } catch (liveFallbackError) {
          console.error(
            "Live Shopify order details fallback failed:",
            liveFallbackError?.message || liveFallbackError,
          );
        }

        return res.status(503).json({
          error:
            "Order details are temporarily unavailable while the database finishes maintenance",
        });
      }

      res.status(500).json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/notes",
  verifyToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const { content } = req.body;
      const orderId = req.params.id;
      const userId = req.user.id;

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Note content is required" });
      }

      // Get user info for author name
      const { supabase } = await import("../supabaseClient.js");
      const { data: userData } = await supabase
        .from("users")
        .select("name, email")
        .eq("id", userId)
        .single();

      const author = userData?.name || userData?.email || "مستخدم";

      const result = await OrderManagementService.addOrderNote(
        userId,
        orderId,
        content,
        author,
      );
      res.json(result);
    } catch (error) {
      console.error("Add order note error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/payment-method",
  verifyToken,
  requirePermission("can_edit_orders"),
  async (req, res) => {
    try {
      const allowedMethods = new Set(["none", "shopify", "instapay", "wallet"]);
      const requestedMethod = String(req.body?.payment_method || "")
        .toLowerCase()
        .trim();
      const orderId = req.params.id;
      const userId = req.user.id;

      if (!allowedMethods.has(requestedMethod)) {
        return res.status(400).json({
          error:
            "payment_method must be one of: none, shopify, instapay, wallet",
        });
      }

      const { data: order, error } = await findOrderByReferenceForUser(
        userId,
        orderId,
      );
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const isShopifyPaid = isShopifyPaidOrder(order);
      if (isShopifyPaid && requestedMethod !== "shopify") {
        return res.status(400).json({
          error:
            "This order is already paid on Shopify and must stay on Shopify payment method",
        });
      }
      if (!isShopifyPaid && requestedMethod === "shopify") {
        return res.status(400).json({
          error:
            "Shopify payment method can only be selected for paid Shopify orders",
        });
      }

      const currentData = parseJsonField(order.data);
      const updatedData = { ...currentData };
      if (requestedMethod === "none") {
        delete updatedData.moon_profit_payment_method;
      } else {
        updatedData.moon_profit_payment_method = requestedMethod;
      }

      const { supabase } = await import("../supabaseClient.js");
      const previousPaymentMethod = resolveOrderPaymentMethod(order);
      const { data: updatedOrder, error: updateError } = await supabase
        .from("orders")
        .update({
          data: updatedData,
          pending_sync: true,
          sync_error: null,
          local_updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .select()
        .single();

      if (updateError) {
        return res.status(500).json({ error: updateError.message });
      }

      await OrderManagementService.logSyncOperation(
        userId,
        order.id,
        "order_payment_method_update",
        {
          old_payment_method: previousPaymentMethod,
          new_payment_method: requestedMethod,
        },
      );

      try {
        await OrderManagementService.syncPaymentMethodToShopify(
          userId,
          order.id,
          requestedMethod,
          {
            previousMethod: previousPaymentMethod,
          },
        );
      } catch (syncError) {
        await supabase
          .from("orders")
          .update({
            data: currentData,
            pending_sync: false,
            sync_error: syncError.message,
            local_updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        return res.status(502).json({
          error: `Shopify sync failed. Payment method rolled back: ${syncError.message}`,
        });
      }

      const { data: refreshedOrder } = await supabase
        .from("orders")
        .select("*")
        .eq("id", order.id)
        .maybeSingle();

      const finalOrder = refreshedOrder || updatedOrder;
      const paymentMethod = resolveOrderPaymentMethod(finalOrder);
      res.json({
        success: true,
        payment_method: paymentMethod,
        order: {
          ...finalOrder,
          payment_method: paymentMethod,
        },
      });
    } catch (error) {
      console.error("Update order payment method error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/update-status",
  verifyToken,
  requirePermission("can_edit_orders"),
  async (req, res) => {
    try {
      const { status, void_reason } = req.body;
      const orderId = req.params.id;
      const userId = req.user.id;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }
      if (status === "voided" && !String(void_reason || "").trim()) {
        return res.status(400).json({ error: "Void reason is required" });
      }

      const result = await OrderManagementService.updateOrderStatus(
        userId,
        orderId,
        status,
        {
          voidReason: void_reason,
        },
      );
      res.json(result);
    } catch (error) {
      console.error("Update order status error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/update-fulfillment",
  verifyToken,
  requirePermission("can_edit_orders"),
  async (req, res) => {
    try {
      const { fulfillment_status, line_items } = req.body;
      const orderId = req.params.id;
      const userId = req.user.id;

      if (!fulfillment_status) {
        return res
          .status(400)
          .json({ error: "Fulfillment status is required" });
      }

      const result = await OrderManagementService.updateOrderFulfillment(
        userId,
        orderId,
        fulfillment_status,
        {
          lineItems: Array.isArray(line_items)
            ? line_items.map((item) => ({
                id: item?.id ?? item?.line_item_id,
                quantity: item?.quantity,
              }))
            : [],
        },
      );
      res.json(result);
    } catch (error) {
      console.error("Update order fulfillment error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/shipping-issue",
  verifyToken,
  requirePermission("can_edit_orders"),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const userId = req.user.id;
      const result = await OrderManagementService.updateOrderShippingIssue(
        userId,
        orderId,
        {
          active: req.body?.active !== false,
          reason: Object.prototype.hasOwnProperty.call(req.body || {}, "reason")
            ? String(req.body?.reason ?? "").trim()
            : undefined,
          shipping_company_note: Object.prototype.hasOwnProperty.call(
            req.body || {},
            "shipping_company_note",
          )
            ? String(req.body?.shipping_company_note ?? "").trim()
            : undefined,
          customer_service_note: Object.prototype.hasOwnProperty.call(
            req.body || {},
            "customer_service_note",
          )
            ? String(req.body?.customer_service_note ?? "").trim()
            : undefined,
        },
      );

      shippingIssueOrdersCache.clear();
      shippingIssueOrdersInFlight.clear();
      res.json(result);
    } catch (error) {
      console.error("Update order shipping issue error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.post(
  "/orders/:id/update-contact",
  verifyToken,
  requirePermission("can_edit_orders"),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const userId = req.user.id;
      const updates = {};

      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, "customer_phone")
      ) {
        updates.customer_phone = String(req.body?.customer_phone ?? "").trim();
      }

      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, "shipping_address")
      ) {
        updates.shipping_address =
          req.body?.shipping_address &&
          typeof req.body.shipping_address === "object" &&
          !Array.isArray(req.body.shipping_address)
            ? req.body.shipping_address
            : {};
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No contact updates provided" });
      }

      const result = await OrderManagementService.updateOrderContactDetails(
        userId,
        orderId,
        updates,
      );
      res.json(result);
    } catch (error) {
      console.error("Update order contact error:", error);
      res
        .status(resolveUpdateErrorStatusCode(error.message))
        .json({ error: error.message });
    }
  },
);

router.get(
  "/orders/:id/profit",
  verifyToken,
  requireAdminRole,
  async (req, res) => {
    try {
      const orderId = req.params.id;

      // Get order
      const { data: order } = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Calculate profit using the database function (includes operational costs)
      const { supabase } = await import("../supabaseClient.js");
      const { data: profitData, error } = await supabase.rpc(
        "calculate_order_net_profit",
        { order_id_param: orderId },
      );

      if (error) {
        console.error("Calculate profit error:", error);
        return res.status(500).json({ error: "Failed to calculate profit" });
      }

      const result =
        profitData && profitData.length > 0
          ? profitData[0]
          : {
              total_revenue: 0,
              total_cost: 0,
              total_operational_costs: 0,
              gross_profit: 0,
              net_profit: 0,
              profit_margin: 0,
            };

      res.json({
        total_revenue: result.total_revenue || 0,
        total_cost: result.total_cost || 0,
        total_operational_costs: result.total_operational_costs || 0,
        gross_profit: result.gross_profit || 0,
        net_profit: result.net_profit || 0,
        profit_margin: result.profit_margin || 0,
      });
    } catch (error) {
      console.error("Get order profit error:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
