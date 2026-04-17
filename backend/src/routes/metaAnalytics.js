import express from "express";
import { supabase } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { getAccessibleStoreIds } from "../models/index.js";
import {
  PAID_LIKE_STATUSES,
  getLineItemBookedAmount,
  getOrderFinancialStatus,
  getOrderGrossAmount,
  getOrderRefundedAmount,
  isCancelledOrder,
  parseOrderData,
} from "../helpers/orderAnalytics.js";
import { emitRealtimeEvent } from "../services/realtimeEventService.js";
import {
  DEFAULT_META_LOOKBACK_DAYS,
  DEFAULT_OPENROUTER_MODEL,
  buildMetaDecisionBoard,
  buildMetaEntityCatalogRows,
  buildMetaInsightSnapshots,
  buildMetaQuestionSuggestions,
  buildMetaOverview,
  fetchMetaAdAccounts,
  fetchMetaAdSets,
  fetchMetaAds,
  fetchMetaCampaigns,
  fetchMetaInsightsForAccount,
  fetchOpenRouterModels,
  generateOpenRouterMetaAnalysis,
  generateOpenRouterStoreAssistantReply,
} from "../services/metaAnalyticsService.js";
import { isProductLowStockAlertsSuppressed } from "../helpers/productLocalMetadata.js";

const router = express.Router();
const SCHEMA_ERROR_CODES = new Set([
  "42P01",
  "42P10",
  "42703",
  "PGRST204",
  "PGRST205",
]);

const META_SCHEMA_ERROR = {
  code: "META_ANALYTICS_SCHEMA_MISSING",
  error:
    "Meta Analytics tables are missing. Run ADD_META_ANALYTICS_MODULE.sql first.",
};
const PAID_STATUSES = new Set(["paid", "partially_paid"]);
const REFUNDED_STATUSES = new Set(["refunded", "partially_refunded"]);
const PENDING_STATUSES = new Set(["pending", "authorized"]);
const LOW_STOCK_THRESHOLD = 10;
const STORE_CONTEXT_LOOKBACK_DAYS = 180;
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
  "data",
].join(",");
const PRODUCTS_SELECTS = [
  PRODUCTS_SELECT,
  [
    "id",
    "store_id",
    "title",
    "vendor",
    "price",
    "inventory_quantity",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  ["id", "store_id", "title", "inventory_quantity", "updated_at", "data"].join(","),
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
const CUSTOMERS_SELECTS = [
  [
    "id",
    "store_id",
    "email",
    "name",
    "customer_name",
    "total_spent",
    "orders_count",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  [
    "id",
    "store_id",
    "email",
    "name",
    "created_at",
    "updated_at",
    "data",
  ].join(","),
  ["id", "store_id", "email", "created_at", "updated_at"].join(","),
];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value) => String(value || "").trim();

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const isSchemaCompatibilityError = (error) => {
  if (!error) {
    return false;
  }

  const code = normalizeText(error.code).toUpperCase();
  if (SCHEMA_ERROR_CODES.has(code)) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();

  return (
    text.includes("does not exist") ||
    text.includes("relation") ||
    text.includes("column") ||
    text.includes("schema cache") ||
    text.includes("on conflict") ||
    text.includes("unique or exclusion constraint") ||
    text.includes("permission denied") ||
    text.includes("row-level security")
  );
};

const getRequestedStoreId = (req) => {
  const headerStoreId =
    typeof req.headers["x-store-id"] === "string"
      ? req.headers["x-store-id"].trim()
      : "";
  const queryStoreId =
    typeof req.query?.store_id === "string" ? req.query.store_id.trim() : "";

  return queryStoreId || headerStoreId || "";
};

const resolveStoreScope = async (req) => {
  const requestedStoreId = getRequestedStoreId(req);
  if (requestedStoreId) {
    if (req.user?.role === "admin") {
      return requestedStoreId;
    }

    const accessibleStoreIds = await getAccessibleStoreIds(req.user.id);
    if (accessibleStoreIds.includes(requestedStoreId)) {
      return requestedStoreId;
    }

    return "";
  }

  const accessibleStoreIds = await getAccessibleStoreIds(req.user.id);
  return accessibleStoreIds.length === 1 ? accessibleStoreIds[0] : "";
};

const parseCommaList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const maskSecret = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 8) {
    return "********";
  }
  return normalized.slice(0, 4) + "****" + normalized.slice(-4);
};

const normalizeIntegrationPayload = (row = null) => ({
  connected: Boolean(row),
  meta: {
    configured: Boolean(normalizeText(row?.meta_access_token)),
    connected: Boolean(row?.is_meta_connected),
    business_id: normalizeText(row?.meta_business_id),
    ad_account_ids: normalizeArray(row?.meta_ad_account_ids),
    page_id: normalizeText(row?.meta_page_id),
    pixel_id: normalizeText(row?.meta_pixel_id),
    masked_access_token: maskSecret(row?.meta_access_token),
    last_sync_at: row?.last_meta_sync_at || null,
    last_sync_status: normalizeText(row?.last_meta_sync_status) || "idle",
    last_sync_error: normalizeText(row?.last_meta_sync_error),
  },
  openrouter: {
    configured: Boolean(normalizeText(row?.openrouter_api_key)),
    connected: Boolean(row?.is_openrouter_connected),
    model: normalizeText(row?.openrouter_model) || DEFAULT_OPENROUTER_MODEL,
    site_url: normalizeText(row?.openrouter_site_url),
    site_name: normalizeText(row?.openrouter_site_name),
    masked_api_key: maskSecret(row?.openrouter_api_key),
    last_analysis_at: row?.last_ai_analysis_at || null,
  },
});

const loadIntegration = async (storeId) => {
  const { data, error } = await supabase
    .from("meta_integrations")
    .select("*")
    .eq("store_id", storeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const saveIntegration = async ({
  storeId,
  userId,
  updates,
  existingIntegration = undefined,
}) => {
  const currentIntegration =
    existingIntegration === undefined
      ? await loadIntegration(storeId)
      : existingIntegration;
  const query = currentIntegration?.id
    ? supabase
        .from("meta_integrations")
        .update({
          updated_by: userId,
          ...updates,
        })
        .eq("id", currentIntegration.id)
    : supabase.from("meta_integrations").insert({
        store_id: storeId,
        created_by: userId,
        updated_by: userId,
        ...updates,
      });
  const { data, error } = await query.select().single();

  if (error) {
    throw error;
  }

  return data;
};

const splitMetaEntities = (rows = []) => ({
  accounts: normalizeArray(rows).filter(
    (row) => normalizeText(row?.object_type).toLowerCase() === "account",
  ),
  campaigns: normalizeArray(rows).filter(
    (row) => normalizeText(row?.object_type).toLowerCase() === "campaign",
  ),
  adsets: normalizeArray(rows).filter(
    (row) => normalizeText(row?.object_type).toLowerCase() === "adset",
  ),
  ads: normalizeArray(rows).filter(
    (row) => normalizeText(row?.object_type).toLowerCase() === "ad",
  ),
});

const loadMetaEntities = async (storeId) => {
  const { data, error } = await supabase
    .from("meta_entities")
    .select("*")
    .eq("store_id", storeId)
    .order("is_active", { ascending: false })
    .order("updated_time", { ascending: false })
    .limit(5000);

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return [];
    }

    throw error;
  }

  return normalizeArray(data);
};

const loadOverviewData = async ({ storeId, days }) => {
  const normalizedDays = Math.max(1, toNumber(days) || DEFAULT_META_LOOKBACK_DAYS);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - normalizedDays + 1);
  const since = startDate.toISOString().slice(0, 10);

  const [
    integrationResult,
    snapshotsResult,
    syncRunsResult,
    analysesResult,
    entities,
  ] =
    await Promise.all([
      supabase
        .from("meta_integrations")
        .select("*")
        .eq("store_id", storeId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("meta_insight_snapshots")
        .select("*")
        .eq("store_id", storeId)
        .gte("date_start", since)
        .order("date_start", { ascending: true }),
      supabase
        .from("meta_sync_runs")
        .select("*")
        .eq("store_id", storeId)
        .order("started_at", { ascending: false })
        .limit(8),
      supabase
        .from("meta_ai_analyses")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(8),
      loadMetaEntities(storeId),
    ]);

  for (const result of [
    integrationResult,
    snapshotsResult,
    syncRunsResult,
    analysesResult,
  ]) {
    if (result.error) {
      throw result.error;
    }
  }

  const entityCollections = splitMetaEntities(entities);

  return {
    integration: integrationResult.data || null,
    snapshots: normalizeArray(snapshotsResult.data),
    syncRuns: normalizeArray(syncRunsResult.data),
    analyses: normalizeArray(analysesResult.data),
    ...entityCollections,
    days: normalizedDays,
  };
};

const dedupeRowsById = (rows = []) => {
  const seen = new Set();
  const uniqueRows = [];

  for (const row of rows) {
    const key = normalizeText(row?.id);
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

const isOutOfStockProduct = (product) =>
  !isProductLowStockAlertsSuppressed(product) &&
  toNumber(product?.inventory_quantity) <= 0;

const isPaidOrder = (order) => PAID_STATUSES.has(getOrderFinancialStatus(order));

const isRefundedOrder = (order) => {
  const status = getOrderFinancialStatus(order);
  return REFUNDED_STATUSES.has(status) || getOrderRefundedAmount(order) > 0;
};

const isPendingOrder = (order) => PENDING_STATUSES.has(getOrderFinancialStatus(order));

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

  return Math.max(0, grossAmount - getOrderRefundedAmount(order));
};

const getLineItems = (order) => {
  const parsed = parseOrderData(order);
  return Array.isArray(parsed?.line_items) ? parsed.line_items : [];
};

const normalizeLocationLabel = (value) =>
  normalizeText(value).replace(/\s+/g, " ").slice(0, 80);

const resolveOrderLocation = (order) => {
  const parsed = parseOrderData(order);
  const shippingAddress = parsed?.shipping_address || order?.shipping_address || {};
  const billingAddress = parsed?.billing_address || order?.billing_address || {};

  return {
    city: normalizeLocationLabel(
      shippingAddress?.city || billingAddress?.city,
    ),
    province: normalizeLocationLabel(
      shippingAddress?.province ||
        shippingAddress?.province_code ||
        billingAddress?.province ||
        billingAddress?.province_code,
    ),
    country: normalizeLocationLabel(
      shippingAddress?.country ||
        shippingAddress?.country_code ||
        billingAddress?.country ||
        billingAddress?.country_code,
    ),
  };
};

const incrementLocationMetrics = (map, labelKey, label, revenue) => {
  const normalizedLabel = normalizeLocationLabel(label);
  if (!normalizedLabel) {
    return;
  }

  const current = map.get(normalizedLabel) || {
    [labelKey]: normalizedLabel,
    orders_count: 0,
    revenue: 0,
  };
  current.orders_count += 1;
  current.revenue += Math.max(0, toNumber(revenue));
  map.set(normalizedLabel, current);
};

const buildTopLocationRows = (map, labelKey, limit = 5) => {
  const rows = Array.from(map.values());
  const totalOrders = rows.reduce(
    (sum, row) => sum + toNumber(row?.orders_count),
    0,
  );
  const totalRevenue = rows.reduce((sum, row) => sum + toNumber(row?.revenue), 0);

  return rows
    .sort((left, right) => {
      const revenueDiff = toNumber(right?.revenue) - toNumber(left?.revenue);
      if (revenueDiff !== 0) {
        return revenueDiff;
      }

      return toNumber(right?.orders_count) - toNumber(left?.orders_count);
    })
    .slice(0, limit)
    .map((row) => ({
      [labelKey]: normalizeText(row?.[labelKey]),
      orders_count: toNumber(row?.orders_count),
      revenue: Number(toNumber(row?.revenue).toFixed(2)),
      share_of_orders:
        totalOrders > 0
          ? Number(
              ((toNumber(row?.orders_count) / Math.max(1, totalOrders)) * 100).toFixed(
                2,
              ),
            )
          : 0,
      share_of_revenue:
        totalRevenue > 0
          ? Number(
              ((toNumber(row?.revenue) / Math.max(0.01, totalRevenue)) * 100).toFixed(
                2,
              ),
            )
          : 0,
    }));
};

const loadScopedRowsWithFallback = async ({
  tableName,
  selectCandidates,
  storeId,
  orderBy,
  ascending,
  afterDate = "",
}) => {
  let lastError = null;

  for (const selectColumns of selectCandidates) {
    let query = supabase.from(tableName).select(selectColumns).eq("store_id", storeId);

    if (afterDate) {
      query = query.gte("created_at", afterDate);
    }

    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }

    const { data, error } = await query;
    if (!error) {
      return normalizeArray(data);
    }

    lastError = error;
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return [];
};

const buildStoreSnapshot = async ({ storeId, days = STORE_CONTEXT_LOOKBACK_DAYS }) => {
  const normalizedDays = Math.max(30, toNumber(days) || STORE_CONTEXT_LOOKBACK_DAYS);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - normalizedDays + 1);
  const since = startDate.toISOString().slice(0, 10);

  const [products, orders, customers] = await Promise.all([
    loadScopedRowsWithFallback({
      tableName: "products",
      selectCandidates: PRODUCTS_SELECTS,
      storeId,
      orderBy: "updated_at",
      ascending: false,
    }),
    loadScopedRowsWithFallback({
      tableName: "orders",
      selectCandidates: ORDERS_SELECTS,
      storeId,
      orderBy: "created_at",
      ascending: false,
      afterDate: since,
    }),
    loadScopedRowsWithFallback({
      tableName: "customers",
      selectCandidates: CUSTOMERS_SELECTS,
      storeId,
      orderBy: "updated_at",
      ascending: false,
    }),
  ]);

  const uniqueProducts = dedupeRowsById(products);
  const lowStockProducts = uniqueProducts
    .filter((product) => isLowStockProduct(product))
    .sort((left, right) => {
      const quantityDiff =
        toNumber(left?.inventory_quantity) - toNumber(right?.inventory_quantity);
      if (quantityDiff !== 0) {
        return quantityDiff;
      }

      return (
        new Date(right?.updated_at || 0).getTime() -
        new Date(left?.updated_at || 0).getTime()
      );
    })
    .slice(0, 6)
    .map((product) => ({
      id: product.id,
      title: normalizeText(product.title) || "Untitled product",
      vendor: normalizeText(product.vendor),
      inventory_quantity: toNumber(product.inventory_quantity),
    }));

  const ordersByStatus = {
    total: orders.length,
    paid: orders.filter((order) => isPaidOrder(order)).length,
    pending: orders.filter((order) => isPendingOrder(order)).length,
    refunded: orders.filter((order) => isRefundedOrder(order)).length,
    cancelled: orders.filter((order) => isCancelledOrder(order)).length,
    fulfilled: orders.filter((order) => {
      const status = normalizeText(order?.fulfillment_status).toLowerCase();
      return status === "fulfilled";
    }).length,
    unfulfilled: orders.filter((order) => {
      const status = normalizeText(order?.fulfillment_status).toLowerCase();
      return !status || status === "unfulfilled" || status === "null";
    }).length,
  };

  const totalRevenue = orders.reduce(
    (sum, order) => sum + getOrderGrossSalesAmount(order),
    0,
  );
  const refundedAmount = orders.reduce(
    (sum, order) => sum + getOrderRefundedAmount(order),
    0,
  );
  const pendingAmount = orders
    .filter((order) => isPendingOrder(order))
    .reduce((sum, order) => sum + getOrderGrossAmount(order), 0);
  const netRevenue = Math.max(0, totalRevenue - refundedAmount);
  const paidOrders = orders.filter((order) => getOrderNetSalesAmount(order) > 0);

  const productRevenueMap = new Map();
  for (const order of paidOrders) {
    const grossOrderAmount = getOrderGrossSalesAmount(order);
    const netOrderAmount = getOrderNetSalesAmount(order);
    const netRatio =
      grossOrderAmount > 0
        ? Math.min(1, Math.max(0, netOrderAmount / grossOrderAmount))
        : 0;

    if (netRatio <= 0) {
      continue;
    }

    for (const item of getLineItems(order)) {
      const productKey = normalizeText(
        item?.product_id || item?.id || item?.sku || item?.title,
      );
      if (!productKey) {
        continue;
      }

      const quantity = Math.max(0, toNumber(item?.quantity));
      const lineRevenue = getLineItemBookedAmount(item) * netRatio;
      const current = productRevenueMap.get(productKey) || {
        product_id: item?.product_id || null,
        title: normalizeText(item?.title || item?.name) || "Unknown product",
        total_revenue: 0,
        total_quantity: 0,
        orders_count: 0,
      };

      current.total_revenue += lineRevenue;
      current.total_quantity += quantity;
      current.orders_count += 1;
      productRevenueMap.set(productKey, current);
    }
  }

  const topProducts = Array.from(productRevenueMap.values())
    .sort((left, right) => right.total_revenue - left.total_revenue)
    .slice(0, 6)
    .map((product) => ({
      ...product,
      total_revenue: Number(product.total_revenue.toFixed(2)),
      total_quantity: toNumber(product.total_quantity),
      orders_count: toNumber(product.orders_count),
    }));

  const customerSpendMap = new Map();
  const cityMetrics = new Map();
  const provinceMetrics = new Map();
  const countryMetrics = new Map();
  for (const order of paidOrders) {
    const key = normalizeText(order?.customer_email || order?.customer_name || order?.id);
    if (!key) {
      // Even anonymous paid orders can still contribute to demand geography.
    } else {
      const current = customerSpendMap.get(key) || {
        email: normalizeText(order?.customer_email),
        name: normalizeText(order?.customer_name),
        orders_count: 0,
        total_spent: 0,
      };

      current.orders_count += 1;
      current.total_spent += getOrderNetSalesAmount(order);
      customerSpendMap.set(key, current);
    }

    const netOrderAmount = getOrderNetSalesAmount(order);
    const location = resolveOrderLocation(order);
    incrementLocationMetrics(cityMetrics, "city", location.city, netOrderAmount);
    incrementLocationMetrics(
      provinceMetrics,
      "province",
      location.province,
      netOrderAmount,
    );
    incrementLocationMetrics(
      countryMetrics,
      "country",
      location.country,
      netOrderAmount,
    );
  }

  const topCustomers = Array.from(customerSpendMap.values())
    .sort((left, right) => right.total_spent - left.total_spent)
    .slice(0, 5)
    .map((customer) => ({
      ...customer,
      total_spent: Number(customer.total_spent.toFixed(2)),
    }));
  const repeatCustomersLookback = Array.from(customerSpendMap.values()).filter(
    (customer) => toNumber(customer?.orders_count) >= 2,
  ).length;
  const activeCustomersLookback = customerSpendMap.size;
  const topCities = buildTopLocationRows(cityMetrics, "city");
  const topProvinces = buildTopLocationRows(provinceMetrics, "province");
  const topCountries = buildTopLocationRows(countryMetrics, "country");

  return {
    lookback_days: normalizedDays,
    since,
    financial: {
      total_revenue: Number(totalRevenue.toFixed(2)),
      refunded_amount: Number(refundedAmount.toFixed(2)),
      pending_amount: Number(pendingAmount.toFixed(2)),
      net_revenue: Number(netRevenue.toFixed(2)),
      average_order_value:
        paidOrders.length > 0 ? Number((netRevenue / paidOrders.length).toFixed(2)) : 0,
    },
    orders: {
      ...ordersByStatus,
      success_rate:
        ordersByStatus.total > 0
          ? Number(((ordersByStatus.paid / ordersByStatus.total) * 100).toFixed(2))
          : 0,
      cancellation_rate:
        ordersByStatus.total > 0
          ? Number(((ordersByStatus.cancelled / ordersByStatus.total) * 100).toFixed(2))
          : 0,
      refund_rate:
        ordersByStatus.total > 0
          ? Number(((ordersByStatus.refunded / ordersByStatus.total) * 100).toFixed(2))
          : 0,
    },
    catalog: {
      total_products: uniqueProducts.length,
      low_stock_count: uniqueProducts.filter((product) => isLowStockProduct(product)).length,
      out_of_stock_count: uniqueProducts.filter((product) => isOutOfStockProduct(product)).length,
    },
    customers: {
      total_customers: customers.length,
      active_customers_lookback: activeCustomersLookback,
      repeat_customers_lookback: repeatCustomersLookback,
      repeat_customer_rate:
        activeCustomersLookback > 0
          ? Number(
              ((repeatCustomersLookback / activeCustomersLookback) * 100).toFixed(
                2,
              ),
            )
          : 0,
    },
    top_products: topProducts,
    top_customers: topCustomers,
    low_stock_products: lowStockProducts,
    geography: {
      top_cities: topCities,
      top_provinces: topProvinces,
      top_countries: topCountries,
    },
  };
};

const safeBuildStoreSnapshot = async ({ storeId, days = STORE_CONTEXT_LOOKBACK_DAYS }) => {
  try {
    return await buildStoreSnapshot({ storeId, days });
  } catch (error) {
    console.warn("Meta analytics store snapshot fallback activated", error);
    return {
      lookback_days: Math.max(30, toNumber(days) || STORE_CONTEXT_LOOKBACK_DAYS),
      since: null,
      financial: {
        total_revenue: 0,
        refunded_amount: 0,
        pending_amount: 0,
        net_revenue: 0,
        average_order_value: 0,
      },
      orders: {
        total: 0,
        paid: 0,
        pending: 0,
        refunded: 0,
        cancelled: 0,
        fulfilled: 0,
        unfulfilled: 0,
        success_rate: 0,
        cancellation_rate: 0,
        refund_rate: 0,
      },
      catalog: {
        total_products: 0,
        low_stock_count: 0,
        out_of_stock_count: 0,
      },
      customers: {
        total_customers: 0,
        active_customers_lookback: 0,
        repeat_customers_lookback: 0,
        repeat_customer_rate: 0,
      },
      top_products: [],
      top_customers: [],
      low_stock_products: [],
      geography: {
        top_cities: [],
        top_provinces: [],
        top_countries: [],
      },
    };
  }
};

const buildOperationalRecommendations = ({
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
}) => {
  {
    const recommendations = [];
    const orders = storeSnapshot?.orders || {};
    const financial = storeSnapshot?.financial || {};
    const catalog = storeSnapshot?.catalog || {};
    const topProducts = normalizeArray(storeSnapshot?.top_products);
    const lowStockProducts = normalizeArray(storeSnapshot?.low_stock_products);
    const metaSummary = metaOverview?.summary || {};
    const scaleNow = normalizeArray(decisionBoard?.scale_now);
    const pauseNow = normalizeArray(decisionBoard?.pause_now);
    const testNext = normalizeArray(decisionBoard?.test_next);
    const creativeDiagnostics = normalizeArray(
      decisionBoard?.creative_diagnostics,
    );

    if (toNumber(orders.pending) >= 8) {
      recommendations.push({
        priority: "high",
        category: "operations",
        title: "Close pending orders before pushing spend",
        action:
          "Work the unconfirmed and unpaid orders queue before increasing campaign budgets.",
        reason: `${orders.pending} pending orders are still open inside the current store snapshot.`,
      });
    }

    if (toNumber(orders.cancellation_rate) >= 10) {
      recommendations.push({
        priority: "high",
        category: "retention",
        title: "Fix cancellation leakage before scaling sales",
        action:
          "Review cancellation reasons, confirmation flow, shipping promises, and payment handling before adding more traffic.",
        reason: `Current cancellation rate is ${toNumber(
          orders.cancellation_rate,
        ).toFixed(2)}%.`,
      });
    }

    if (toNumber(catalog.low_stock_count) > 0) {
      const productNames = lowStockProducts
        .slice(0, 3)
        .map((product) => product.title)
        .filter(Boolean)
        .join(", ");

      recommendations.push({
        priority: toNumber(catalog.low_stock_count) >= 5 ? "high" : "medium",
        category: "inventory",
        title: "Secure stock before pushing harder on ads",
        action: productNames
          ? `Start with ${productNames}.`
          : "Review low-stock items and prioritize the next replenishment batch.",
        reason: `${catalog.low_stock_count} products are low on stock and ${catalog.out_of_stock_count} are already out of stock.`,
      });
    }

    if (topProducts.length > 0 && toNumber(financial.net_revenue) > 0) {
      const leadProduct = topProducts[0];
      const revenueShare =
        toNumber(financial.net_revenue) > 0
          ? (toNumber(leadProduct.total_revenue) /
              toNumber(financial.net_revenue)) *
            100
          : 0;

      if (revenueShare >= 25) {
        recommendations.push({
          priority: "medium",
          category: "merchandising",
          title: "Protect the top seller while reducing store dependence",
          action: `Hold pricing, stock, and creative consistency for ${leadProduct.title}, while building two adjacent products behind it.`,
          reason: `${leadProduct.title} drives ${revenueShare.toFixed(
            1,
          )}% of net revenue.`,
        });
      }
    }

    if (toNumber(metaSummary.rows_count) === 0) {
      recommendations.push({
        priority: "medium",
        category: "ads",
        title: "Run Meta sync before making ad decisions",
        action:
          "Sync Meta data first, then review spend, ROAS, CTR, conversion rate, and creative diagnostics together.",
        reason:
          "There are no stored Meta insight rows inside the current analysis window.",
      });
    } else {
      const scalableCampaign = scaleNow[0];
      const weakCampaign = pauseNow[0];
      const testCampaign = testNext[0];
      const creativeIssue = creativeDiagnostics.find(
        (item) => item.diagnosis && item.diagnosis !== "winner",
      );

      if (scalableCampaign) {
        recommendations.push({
          priority: "medium",
          category: "ads",
          title: "Scale the strongest campaign carefully",
          action: `${scalableCampaign.action} Focus on ${
            scalableCampaign.name || scalableCampaign.id
          }.`,
          reason: `${scalableCampaign.name || scalableCampaign.id} is clearing ROAS ${toNumber(
            scalableCampaign.roas,
          ).toFixed(2)}x with ${toNumber(scalableCampaign.purchases)} purchases.`,
        });
      }

      if (weakCampaign) {
        recommendations.push({
          priority: "high",
          category: "ads",
          title: "Cut waste from the weakest campaign",
          action: `${weakCampaign.action} Start with ${
            weakCampaign.name || weakCampaign.id
          }.`,
          reason: `Spend is ${toNumber(weakCampaign.spend).toFixed(
            2,
          )} with ROAS only ${toNumber(weakCampaign.roas).toFixed(2)}x.`,
        });
      }

      if (testCampaign) {
        recommendations.push({
          priority: "medium",
          category: "ads",
          title: "Launch one focused test on the mixed campaign",
          action: `${testCampaign.action} Start with ${
            testCampaign.name || testCampaign.id
          }.`,
          reason:
            normalizeArray(testCampaign.why)[0] ||
            "Performance is mixed, so a controlled test is better than an immediate scale or pause.",
        });
      }

      if (creativeIssue) {
        recommendations.push({
          priority: "medium",
          category: "creative",
          title: creativeIssue.headline || "Creative needs a rebuild",
          action: creativeIssue.action,
          reason: `${creativeIssue.name || creativeIssue.id} shows ${
            creativeIssue.diagnosis
          } signals with ROAS ${toNumber(creativeIssue.roas).toFixed(2)}x.`,
        });
      }
    }

    return recommendations.slice(0, 8);
  }
  /*
  const recommendations = [];
  const orders = storeSnapshot?.orders || {};
  const financial = storeSnapshot?.financial || {};
  const catalog = storeSnapshot?.catalog || {};
  const topProducts = normalizeArray(storeSnapshot?.top_products);
  const lowStockProducts = normalizeArray(storeSnapshot?.low_stock_products);
  const metaSummary = metaOverview?.summary || {};
  const topCampaigns = normalizeArray(metaOverview?.campaigns);

  if (toNumber(orders.pending) >= 8) {
    recommendations.push({
      priority: "high",
      category: "operations",
      title: "اقفل الطلبات المعلقة أولًا",
      action: "ابدأ متابعة الطلبات غير المحسومة والدفع/التأكيد قبل توسيع أي spend.",
      reason: `${orders.pending} طلبات معلقة ما زالت مفتوحة داخل فترة التحليل الحالية.`,
    });
  }

  if (toNumber(orders.cancellation_rate) >= 10) {
    recommendations.push({
      priority: "high",
      category: "retention",
      title: "راجع سبب الإلغاء قبل زيادة المبيعات",
      action: "حلل أسباب الإلغاء والشحن والتأكيد الهاتفي وسياسة الدفع قبل ضخ traffic إضافي.",
      reason: `معدل الإلغاء الحالي ${toNumber(orders.cancellation_rate).toFixed(2)}%.`,
    });
  }

  if (toNumber(catalog.low_stock_count) > 0) {
    const productNames = lowStockProducts
      .slice(0, 3)
      .map((product) => product.title)
      .filter(Boolean)
      .join("، ");

    recommendations.push({
      priority: toNumber(catalog.low_stock_count) >= 5 ? "high" : "medium",
      category: "inventory",
      title: "أمّن المخزون قبل أي push على المبيعات",
      action: productNames
        ? `ابدأ بإعادة تموين: ${productNames}.`
        : "راجع الأصناف منخفضة المخزون وحدد أولويات إعادة التوريد.",
      reason: `${catalog.low_stock_count} منتجات منخفضة المخزون و${catalog.out_of_stock_count} نافدة.`,
    });
  }

  if (topProducts.length > 0 && toNumber(financial.net_revenue) > 0) {
    const leadProduct = topProducts[0];
    const revenueShare =
      toNumber(financial.net_revenue) > 0
        ? (toNumber(leadProduct.total_revenue) / toNumber(financial.net_revenue)) * 100
        : 0;

    if (revenueShare >= 25) {
      recommendations.push({
        priority: "medium",
        category: "merchandising",
        title: "وسّع المنتج المتصدر لكن احمِ اعتمادية الستور",
        action: `ثبت مخزون وتسعير وكريتيف المنتج ${leadProduct.title}، وفي نفس الوقت ادفع منتجين بديلين معه.`,
        reason: `${leadProduct.title} مسؤول عن ${revenueShare.toFixed(1)}% من صافي المبيعات.`,
      });
    }
  }

  if (toNumber(metaSummary.rows_count) === 0) {
    recommendations.push({
      priority: "medium",
      category: "ads",
      title: "فعّل مزامنة Meta قبل الاعتماد على قرارات الإعلانات",
      action: "اعمل sync لبيانات Meta من الإعدادات ثم راقب الحملات الأعلى spend والأقل ROAS.",
      reason: "لا توجد rows محفوظة من Meta داخل فترة التحليل الحالية.",
    });
  } else {
    const scalableCampaign = topCampaigns.find(
      (campaign) => toNumber(campaign.purchases) >= 2 && toNumber(campaign.roas) >= 2,
    );
    const weakCampaign = topCampaigns.find(
      (campaign) => toNumber(campaign.spend) > 0 && toNumber(campaign.roas) < 1,
    );

    if (scalableCampaign) {
      recommendations.push({
        priority: "medium",
        category: "ads",
        title: "فيه حملة تستحق التوسيع",
        action: `اختبر رفع الميزانية تدريجيًا على ${scalableCampaign.name || scalableCampaign.id} مع الحفاظ على نفس الزاوية الإعلانية.`,
        reason: `ROAS ${toNumber(scalableCampaign.roas).toFixed(2)}x مع ${toNumber(scalableCampaign.purchases)} مشتريات.`,
      });
    }

    if (weakCampaign) {
      recommendations.push({
        priority: "high",
        category: "ads",
        title: "فيه spend لازم يتراجع أو يتوقف",
        action: `راجع أو أوقف ${weakCampaign.name || weakCampaign.id} إذا استمر نفس الأداء بعد اختبار كريتيف/أودينس جديد.`,
        reason: `Spend ${toNumber(weakCampaign.spend).toFixed(2)} مقابل ROAS ${toNumber(weakCampaign.roas).toFixed(2)}x.`,
      });
    }
  }

  return recommendations.slice(0, 6);
  */
};

const handleSchemaAwareError = (res, error, fallbackMessage) => {
  if (isSchemaCompatibilityError(error)) {
    return res.status(503).json(META_SCHEMA_ERROR);
  }

  console.error(fallbackMessage, error);
  if (error?.status && error?.publicMessage) {
    return res.status(error.status).json({
      error: error.publicMessage,
    });
  }

  return res.status(500).json({
    error: fallbackMessage,
  });
};

router.use(authenticateToken, requirePermission("can_manage_settings"));

router.get("/status", async (req, res) => {
  let storeId = null;
  try {
    storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error:
          "Select a store first before configuring Meta & Analytics integrations.",
      });
    }

    // Test schema availability by trying to access meta_integrations table
    const integration = await loadIntegration(storeId);

    return res.json({
      schemaReady: true,
      store_id: storeId,
      integration: normalizeIntegrationPayload(integration),
    });
  } catch (error) {
    if (isSchemaCompatibilityError(error)) {
      return res.json({
        schemaReady: false,
        store_id: storeId,
        integration: null,
        ...META_SCHEMA_ERROR,
      });
    }

    console.error("Meta analytics status error:", error);
    return res.status(500).json({
      error: "Failed to check Meta analytics status",
    });
  }
});

router.put("/config/meta", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before saving Meta configuration.",
      });
    }

    const existingIntegration = await loadIntegration(storeId);
    const nextAccessToken = normalizeText(req.body?.access_token)
      ? normalizeText(req.body?.access_token)
      : normalizeText(existingIntegration?.meta_access_token);

    const nextIntegration = await saveIntegration({
      storeId,
      userId: req.user.id,
      existingIntegration,
      updates: {
        meta_access_token: nextAccessToken,
        meta_business_id: normalizeText(req.body?.business_id),
        meta_ad_account_ids: normalizeArray(
          Array.isArray(req.body?.ad_account_ids)
            ? req.body.ad_account_ids
            : parseCommaList(req.body?.ad_account_ids),
        ),
        meta_page_id: normalizeText(req.body?.page_id),
        meta_pixel_id: normalizeText(req.body?.pixel_id),
        is_meta_connected:
          existingIntegration?.is_meta_connected &&
          Boolean(nextAccessToken),
        last_meta_sync_error: "",
      },
    });

    emitRealtimeEvent({
      userIds: [req.user.id],
      storeIds: [storeId],
      payload: {
        resource: "meta_analytics",
        context: "meta_config_saved",
      },
    });

    return res.json({
      success: true,
      integration: normalizeIntegrationPayload(nextIntegration),
    });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to save Meta configuration",
    );
  }
});

router.put("/config/openrouter", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before saving OpenRouter configuration.",
      });
    }

    const existingIntegration = await loadIntegration(storeId);
    const nextApiKey = normalizeText(req.body?.api_key)
      ? normalizeText(req.body?.api_key)
      : normalizeText(existingIntegration?.openrouter_api_key);

    const nextIntegration = await saveIntegration({
      storeId,
      userId: req.user.id,
      existingIntegration,
      updates: {
        openrouter_api_key: nextApiKey,
        openrouter_model:
          normalizeText(req.body?.model) || DEFAULT_OPENROUTER_MODEL,
        openrouter_site_url: normalizeText(req.body?.site_url),
        openrouter_site_name: normalizeText(req.body?.site_name),
        is_openrouter_connected:
          existingIntegration?.is_openrouter_connected &&
          Boolean(nextApiKey),
      },
    });

    emitRealtimeEvent({
      userIds: [req.user.id],
      storeIds: [storeId],
      payload: {
        resource: "meta_analytics",
        context: "openrouter_config_saved",
      },
    });

    return res.json({
      success: true,
      integration: normalizeIntegrationPayload(nextIntegration),
    });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to save OpenRouter configuration",
    );
  }
});

router.get("/models", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.json({ data: [] });
    }

    const integration = await loadIntegration(storeId);
    const apiKey =
      normalizeText(req.query?.api_key) ||
      normalizeText(integration?.openrouter_api_key) ||
      normalizeText(process.env.OPENROUTER_API_KEY);

    if (!apiKey) {
      return res.json({ data: [] });
    }

    const models = await fetchOpenRouterModels({ apiKey });

    if (integration?.id) {
      await saveIntegration({
        storeId,
        userId: req.user.id,
        existingIntegration: integration,
        updates: {
          is_openrouter_connected: true,
        },
      });
    }

    return res.json({ data: models });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to load OpenRouter models",
    );
  }
});

router.post("/sync", async (req, res) => {
  const startedAt = new Date().toISOString();
  let syncRunId = null;
  let storeId = "";

  try {
    storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before syncing Meta data.",
      });
    }

    const integration = await loadIntegration(storeId);
    if (!integration) {
      return res.status(400).json({
        error: "Save Meta configuration first before syncing data.",
      });
    }

    const accessToken = normalizeText(integration.meta_access_token);
    if (!accessToken) {
      return res.status(400).json({
        error: "Meta access token is required before syncing data.",
      });
    }

    const { since, until } = req.body?.since && req.body?.until
      ? { since: normalizeText(req.body.since), until: normalizeText(req.body.until) }
      : (() => {
          const days = Math.max(
            1,
            toNumber(req.body?.days) || DEFAULT_META_LOOKBACK_DAYS,
          );
          const endDate = new Date();
          const startDate = new Date(endDate);
          startDate.setDate(endDate.getDate() - days + 1);
          return {
            since: startDate.toISOString().slice(0, 10),
            until: endDate.toISOString().slice(0, 10),
          };
        })();

    const syncRunResult = await supabase
      .from("meta_sync_runs")
      .insert({
        integration_id: integration.id,
        store_id: storeId,
        triggered_by: req.user.id,
        sync_type: "manual",
        status: "running",
        started_at: startedAt,
        date_start: since,
        date_stop: until,
      })
      .select()
      .single();

    if (syncRunResult.error) {
      throw syncRunResult.error;
    }

    syncRunId = syncRunResult.data?.id || null;

    const adAccounts = await fetchMetaAdAccounts({
      accessToken,
      businessId: integration.meta_business_id,
      adAccountIds: integration.meta_ad_account_ids,
    });

    const syncPayloads = await Promise.all(
      adAccounts.map(async (account) => {
        const [campaigns, adsets, ads, insights] = await Promise.all([
          fetchMetaCampaigns({ accessToken, adAccountId: account.id }),
          fetchMetaAdSets({ accessToken, adAccountId: account.id }),
          fetchMetaAds({ accessToken, adAccountId: account.id }),
          fetchMetaInsightsForAccount({
            accessToken,
            adAccountId: account.id,
            since,
            until,
          }),
        ]);

        return {
          account,
          campaigns,
          adsets,
          ads,
          entities: buildMetaEntityCatalogRows({
            integrationId: integration.id,
            storeId,
            account,
            campaigns,
            adsets,
            ads,
          }),
          snapshots: buildMetaInsightSnapshots({
            integrationId: integration.id,
            storeId,
            account,
            insightRows: insights,
            campaigns,
            adsets,
            ads,
          }),
        };
      }),
    );

    const snapshots = syncPayloads.flatMap((item) => item.snapshots);
    const entities = syncPayloads.flatMap((item) => item.entities);
    const campaigns = syncPayloads.flatMap((item) => item.campaigns);
    const adsets = syncPayloads.flatMap((item) => item.adsets);
    const ads = syncPayloads.flatMap((item) => item.ads);

    if (snapshots.length > 0) {
      const { error: snapshotError } = await supabase
        .from("meta_insight_snapshots")
        .upsert(snapshots, {
          onConflict:
            "integration_id,object_type,object_id,date_start,date_stop",
        });

      if (snapshotError) {
        throw snapshotError;
      }
    }

    if (entities.length > 0) {
      const { error: entityError } = await supabase
        .from("meta_entities")
        .upsert(entities, {
          onConflict: "integration_id,object_type,object_id",
        });

      if (entityError && !isSchemaCompatibilityError(entityError)) {
        throw entityError;
      }
    }
    const entityCollections = splitMetaEntities(entities);

    const overview = buildMetaOverview({
      snapshots,
      accounts:
        entityCollections.accounts.length > 0
          ? entityCollections.accounts
          : adAccounts,
      campaigns:
        entityCollections.campaigns.length > 0
          ? entityCollections.campaigns
          : campaigns,
      adsets:
        entityCollections.adsets.length > 0
          ? entityCollections.adsets
          : adsets,
      ads: entityCollections.ads.length > 0 ? entityCollections.ads : ads,
    });
    const storeSnapshot = await safeBuildStoreSnapshot({
      storeId,
    });
    const decisionBoard = buildMetaDecisionBoard({
      overview,
      storeSnapshot,
    });
    const overviewPayload = {
      ...overview,
      decision_board: decisionBoard,
    };

    const completedAt = new Date().toISOString();
    const updateIntegrationResult = await supabase
      .from("meta_integrations")
      .update({
        is_meta_connected: true,
        last_meta_sync_at: completedAt,
        last_meta_sync_status: "completed",
        last_meta_sync_error: "",
        updated_by: req.user.id,
      })
      .eq("id", integration.id);

    if (updateIntegrationResult.error) {
      throw updateIntegrationResult.error;
    }

    if (syncRunId) {
      const syncRunUpdateResult = await supabase
        .from("meta_sync_runs")
        .update({
          status: "completed",
          completed_at: completedAt,
          payload_summary: {
            accounts_count: adAccounts.length,
            campaigns_count: campaigns.length,
            adsets_count: adsets.length,
            ads_count: ads.length,
            snapshots_count: snapshots.length,
            summary: overview.summary,
            decision_summary: decisionBoard.summary,
          },
        })
        .eq("id", syncRunId);

      if (syncRunUpdateResult.error) {
        throw syncRunUpdateResult.error;
      }
    }

    emitRealtimeEvent({
      userIds: [req.user.id],
      storeIds: [storeId],
      payload: {
        resource: "meta_analytics",
        context: "sync_completed",
      },
    });

    return res.json({
      success: true,
      sync: {
        started_at: startedAt,
        completed_at: completedAt,
        since,
        until,
        accounts_count: adAccounts.length,
        snapshots_count: snapshots.length,
      },
      overview: overviewPayload,
    });
  } catch (error) {
    if (syncRunId) {
      await supabase
        .from("meta_sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_message: normalizeText(error.message || error),
        })
        .eq("id", syncRunId);
    }

    if (storeId) {
      await supabase
        .from("meta_integrations")
        .update({
          is_meta_connected: false,
          last_meta_sync_status: "failed",
          last_meta_sync_error: normalizeText(error.message || error),
          updated_by: req.user.id,
        })
        .eq("store_id", storeId);
    }

    return handleSchemaAwareError(
      res,
      error,
      "Failed to sync Meta Business data",
    );
  }
});

router.get("/overview", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before opening Meta analytics.",
      });
    }

    const [data, storeSnapshot] = await Promise.all([
      loadOverviewData({
        storeId,
        days: req.query?.days,
      }),
      safeBuildStoreSnapshot({
        storeId,
      }),
    ]);

    const metaOverview = buildMetaOverview({
      snapshots: data.snapshots,
      accounts: data.accounts,
      campaigns: data.campaigns,
      adsets: data.adsets,
      ads: data.ads,
    });
    const decisionBoard = buildMetaDecisionBoard({
      overview: metaOverview,
      storeSnapshot,
    });
    const recommendations = buildOperationalRecommendations({
      storeSnapshot,
      metaOverview,
      decisionBoard,
    });
    const assistantQuestions = buildMetaQuestionSuggestions({
      storeSnapshot,
      metaOverview,
      decisionBoard,
    });

    return res.json({
      store_id: storeId,
      days: data.days,
      integration: normalizeIntegrationPayload(data.integration),
      overview: {
        ...metaOverview,
        decision_board: decisionBoard,
      },
      store_snapshot: storeSnapshot,
      recommendations,
      assistant_questions: assistantQuestions,
      sync_runs: data.syncRuns,
      analyses: data.analyses,
    });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to load Meta analytics overview",
    );
  }
});

router.post("/analyze", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before generating AI analysis.",
      });
    }

    const integration = await loadIntegration(storeId);
    if (!integration) {
      return res.status(400).json({
        error: "Save Meta & OpenRouter configuration first.",
      });
    }

    const openRouterApiKey =
      normalizeText(integration.openrouter_api_key) ||
      normalizeText(process.env.OPENROUTER_API_KEY);
    if (!openRouterApiKey) {
      return res.status(400).json({
        error: "OpenRouter API key is required before generating analysis.",
      });
    }

    const [data, storeSnapshot] = await Promise.all([
      loadOverviewData({
        storeId,
        days: req.body?.days || req.query?.days,
      }),
      safeBuildStoreSnapshot({
        storeId,
      }),
    ]);

    const overview = buildMetaOverview({
      snapshots: data.snapshots,
      accounts: data.accounts,
      campaigns: data.campaigns,
      adsets: data.adsets,
      ads: data.ads,
    });
    const decisionBoard = buildMetaDecisionBoard({
      overview,
      storeSnapshot,
    });

    if (overview.summary.rows_count === 0) {
      return res.status(400).json({
        error: "Sync Meta data first. No advertising data is available yet.",
      });
    }

    const analysis = await generateOpenRouterMetaAnalysis({
      apiKey: openRouterApiKey,
      model:
        normalizeText(req.body?.model) ||
        normalizeText(integration.openrouter_model) ||
        DEFAULT_OPENROUTER_MODEL,
      siteUrl:
        normalizeText(req.body?.site_url) ||
        normalizeText(integration.openrouter_site_url),
      siteName:
        normalizeText(req.body?.site_name) ||
        normalizeText(integration.openrouter_site_name),
      overview,
      decisionBoard,
      storeSnapshot,
      focus: normalizeText(req.body?.focus),
    });

    const insertResult = await supabase
      .from("meta_ai_analyses")
      .insert({
        integration_id: integration.id,
        store_id: storeId,
        user_id: req.user.id,
        model: analysis.model,
        focus_area: normalizeText(req.body?.focus),
        prompt_payload: analysis.prompt,
        response_payload: analysis.raw,
        summary_json: analysis.parsed || {},
        recommendation_text: analysis.content,
      })
      .select()
      .single();

    if (insertResult.error) {
      throw insertResult.error;
    }

    const updateResult = await supabase
      .from("meta_integrations")
      .update({
        is_openrouter_connected: true,
        last_ai_analysis_at: new Date().toISOString(),
        updated_by: req.user.id,
      })
      .eq("id", integration.id);

    if (updateResult.error) {
      throw updateResult.error;
    }

    emitRealtimeEvent({
      userIds: [req.user.id],
      storeIds: [storeId],
      payload: {
        resource: "meta_analytics",
        context: "analysis_created",
      },
    });

    return res.json({
      success: true,
      analysis: insertResult.data,
    });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to generate Meta AI analysis",
    );
  }
});

router.post("/assistant/chat", async (req, res) => {
  try {
    const storeId = await resolveStoreScope(req);
    if (!storeId) {
      return res.status(400).json({
        error: "Select a store first before opening the AI assistant.",
      });
    }

    const integration = await loadIntegration(storeId);
    const openRouterApiKey =
      normalizeText(integration?.openrouter_api_key) ||
      normalizeText(process.env.OPENROUTER_API_KEY);

    if (!openRouterApiKey) {
      return res.status(400).json({
        error: "Save OpenRouter configuration in Settings first.",
      });
    }

    const message = normalizeText(req.body?.message);
    if (!message) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    const [overviewData, storeSnapshot] = await Promise.all([
      loadOverviewData({
        storeId,
        days: req.body?.days || req.query?.days,
      }),
      safeBuildStoreSnapshot({
        storeId,
      }),
    ]);

    const metaOverview = buildMetaOverview({
      snapshots: overviewData.snapshots,
      accounts: overviewData.accounts,
      campaigns: overviewData.campaigns,
      adsets: overviewData.adsets,
      ads: overviewData.ads,
    });
    const decisionBoard = buildMetaDecisionBoard({
      overview: metaOverview,
      storeSnapshot,
    });
    const recommendations = buildOperationalRecommendations({
      storeSnapshot,
      metaOverview,
      decisionBoard,
    });
    const assistantQuestions = buildMetaQuestionSuggestions({
      storeSnapshot,
      metaOverview,
      decisionBoard,
    });

    const reply = await generateOpenRouterStoreAssistantReply({
      apiKey: openRouterApiKey,
      model:
        normalizeText(req.body?.model) ||
        normalizeText(integration?.openrouter_model) ||
        DEFAULT_OPENROUTER_MODEL,
      siteUrl:
        normalizeText(req.body?.site_url) ||
        normalizeText(integration?.openrouter_site_url),
      siteName:
        normalizeText(req.body?.site_name) ||
        normalizeText(integration?.openrouter_site_name),
      message,
      history: normalizeArray(req.body?.history),
      storeSnapshot,
      metaOverview,
      decisionBoard,
      recommendations,
      assistantQuestions,
    });

    if (integration?.id) {
      await supabase
        .from("meta_integrations")
        .update({
          is_openrouter_connected: true,
          updated_by: req.user.id,
        })
        .eq("id", integration.id);
    }

    emitRealtimeEvent({
      userIds: [req.user.id],
      storeIds: [storeId],
      payload: {
        resource: "meta_analytics",
        context: "assistant_replied",
      },
    });

    return res.json({
      success: true,
      reply: {
        model: reply.model,
        content: reply.content,
      },
      decision_board: decisionBoard,
      store_snapshot: storeSnapshot,
      recommendations,
      assistant_questions: assistantQuestions,
    });
  } catch (error) {
    return handleSchemaAwareError(
      res,
      error,
      "Failed to generate AI assistant reply",
    );
  }
});

export default router;
