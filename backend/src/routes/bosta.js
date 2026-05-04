/**
 * Bosta Shipping Routes
 * Handles integration with Bosta shipping API
 */

import express from "express";
import BostaService from "../services/bostaService.js";
import { ShopifyService } from "../services/shopifyService.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";
import { Order, Product, getAccessibleStoreIds } from "../models/index.js";
import {
  getTrackingNumberValidationError,
  isDemoTrackingNumber,
  normalizeTrackingNumber,
} from "../helpers/bostaTracking.js";

const router = express.Router();

const extractBostaList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  return payload;
};

let environmentBostaService = null;
let environmentBostaServiceKey = "";

const SCHEMA_ERROR_CODES = new Set([
  "42P01",
  "42P10",
  "42703",
  "PGRST204",
  "PGRST205",
]);

const fetchPublicTrackingShipment = async (trackingNumber) => {
  const publicTracking =
    await BostaService.fetchPublicTrackingStatus(trackingNumber);
  return BostaService.formatPublicTrackingShipment(
    publicTracking,
    trackingNumber,
  );
};

const isTrackingNotFoundError = (error) => {
  const message = error?.message || "";
  return (
    message.includes("404") ||
    message.includes("not valid JSON") ||
    message.includes("non-JSON response") ||
    message.includes("<!DOCTYPE")
  );
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundCurrency = (value) => Number(toNumber(value).toFixed(2));

const parseJsonField = (value) => {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeId = (value) => String(value || "").trim();
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_REGEX.test(String(value || "").trim());

const normalizeSecret = (value) => String(value || "").trim();

const getTrackingValidationResponse = (value, options) => {
  const trackingNumber = normalizeTrackingNumber(value);
  const validationError = getTrackingNumberValidationError(
    trackingNumber,
    options,
  );

  if (!validationError) {
    return {
      trackingNumber,
      status: 200,
      error: "",
      message: "",
    };
  }

  return {
    trackingNumber,
    status: isDemoTrackingNumber(trackingNumber) ? 410 : 400,
    error: trackingNumber ? "Demo tracking disabled" : "Tracking number is required",
    message: validationError,
  };
};

const maskSecret = (value) => {
  const normalized = normalizeSecret(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 8) {
    return "********";
  }
  return normalized.slice(0, 4) + "****" + normalized.slice(-4);
};

const isSchemaCompatibilityError = (error) => {
  if (!error) {
    return false;
  }

  const code = String(error.code || "").trim().toUpperCase();
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
    if (req.user?.role === "admin" || req.user?.isAdmin) {
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

const loadBostaIntegration = async (storeId) => {
  if (!storeId) {
    return null;
  }

  const { data, error } = await supabase
    .from("bosta_integrations")
    .select("*")
    .eq("store_id", storeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const saveBostaIntegration = async ({
  storeId,
  userId,
  apiKey,
  existingIntegration = undefined,
}) => {
  const currentIntegration =
    existingIntegration === undefined
      ? await loadBostaIntegration(storeId)
      : existingIntegration;

  const query = currentIntegration?.id
    ? supabase
        .from("bosta_integrations")
        .update({
          api_key: apiKey,
          is_active: true,
          updated_by: userId,
        })
        .eq("id", currentIntegration.id)
    : supabase.from("bosta_integrations").insert({
        store_id: storeId,
        api_key: apiKey,
        is_active: true,
        created_by: userId,
        updated_by: userId,
      });

  const { data, error } = await query.select().single();
  if (error) {
    throw error;
  }

  return data;
};

const getEnvironmentBostaService = () => {
  const apiKey = normalizeSecret(process.env.BOSTA_API_KEY);
  if (!apiKey) {
    environmentBostaService = null;
    environmentBostaServiceKey = "";
    return null;
  }

  if (environmentBostaService && environmentBostaServiceKey === apiKey) {
    return environmentBostaService;
  }

  try {
    environmentBostaService = new BostaService({ apiKey });
    environmentBostaServiceKey = apiKey;
    return environmentBostaService;
  } catch (error) {
    console.warn(
      "Bosta service initialization from environment failed:",
      error.message,
    );
    environmentBostaService = null;
    environmentBostaServiceKey = "";
    return null;
  }
};

const resolveBostaServiceForRequest = async (req) => {
  const storeId = await resolveStoreScope(req);
  let integration = null;

  if (storeId) {
    try {
      integration = await loadBostaIntegration(storeId);
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }
      console.warn(
        "Bosta integrations table is unavailable, falling back to env key.",
      );
    }
  }

  const integrationApiKey = normalizeSecret(integration?.api_key);
  const environmentService = getEnvironmentBostaService();
  const environmentApiKey = normalizeSecret(process.env.BOSTA_API_KEY);
  const resolvedApiKey = integrationApiKey || environmentApiKey;

  if (!resolvedApiKey) {
    return { storeId, integration, service: null, source: null };
  }

  if (integrationApiKey) {
    return {
      storeId,
      integration,
      service: new BostaService({ apiKey: integrationApiKey }),
      source: "settings",
    };
  }

  return {
    storeId,
    integration,
    service: environmentService,
    source: environmentService ? "environment" : null,
  };
};

/**
 * Middleware to check if Bosta service is available
 */
const requireBostaService = async (req, res, next) => {
  try {
    const resolved = await resolveBostaServiceForRequest(req);
    if (!resolved?.service) {
      return res.status(503).json({
        error:
          "Bosta service is not configured. Save Bosta API key from Settings first.",
      });
    }
    req.bostaService = resolved.service;
    req.bostaIntegration = resolved.integration;
    req.bostaStoreId = resolved.storeId;
    req.bostaConfigSource = resolved.source;
    return next();
  } catch (error) {
    console.error("Failed to resolve Bosta configuration:", error);
    return res.status(500).json({
      error: "Failed to resolve Bosta configuration",
      message: error.message,
    });
  }
};

const stripOrderReferencePrefix = (value) =>
  String(value || "")
    .trim()
    .replace(/^#/, "");

const buildOrderReferenceCandidates = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const candidates = new Set([raw, stripOrderReferencePrefix(raw)]);
  raw
    .split(/[:|,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      candidates.add(part);
      candidates.add(stripOrderReferencePrefix(part));
    });

  const hashMatch = raw.match(/#\s*([a-z0-9_-]+)/i);
  if (hashMatch?.[1]) {
    candidates.add(`#${hashMatch[1]}`);
    candidates.add(hashMatch[1]);
  }

  return Array.from(candidates).filter(Boolean);
};

const isAdminRequest = (req) =>
  Boolean(req.user?.isAdmin || req.user?.role === "admin");

const findOrdersForScanner = async (req) =>
  isAdminRequest(req) ? Order.findAll() : Order.findByUser(req.user.id);

const findProductsForScanner = async (req) =>
  isAdminRequest(req) ? Product.findAll() : Product.findByUser(req.user.id);

const getCustomerName = (order = {}) => {
  const data = parseJsonField(order?.data);
  const customer = data?.customer || {};
  const shippingAddress = data?.shipping_address || {};
  return (
    order?.customer_name ||
    customer?.name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    shippingAddress?.name ||
    [shippingAddress?.first_name, shippingAddress?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "Unknown"
  );
};

const getOrderDisplayName = (order = {}) => {
  const data = parseJsonField(order?.data);
  return (
    data?.name ||
    order?.name ||
    (order?.order_number ? `#${order.order_number}` : "") ||
    order?.shopify_id ||
    order?.id ||
    "Unknown"
  );
};

const getOrderRevenue = (order = {}) => {
  const data = parseJsonField(order?.data);
  return roundCurrency(
    order?.total_price ||
      data?.current_total_price ||
      data?.total_price ||
      data?.total_price_set?.shop_money?.amount ||
      0,
  );
};

const getOrderLineItems = (order = {}) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }
  const data = parseJsonField(order?.data);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const collectTrackingValues = (value, results = []) => {
  if (!value) {
    return results;
  }

  if (typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTrackingValues(entry, results));
    return results;
  }

  [
    value.tracking_number,
    value.trackingNumber,
    value.bosta_tracking_number,
    value.airwaybill,
    value.awb,
  ].forEach((entry) => {
    const normalized = normalizeText(entry);
    if (normalized) {
      results.push(normalized);
    }
  });

  if (Array.isArray(value.tracking_numbers)) {
    value.tracking_numbers.forEach((entry) => {
      const normalized = normalizeText(entry);
      if (normalized) {
        results.push(normalized);
      }
    });
  }

  Object.values(value).forEach((entry) => collectTrackingValues(entry, results));
  return results;
};

const orderHasTrackingNumber = (order = {}, trackingNumber) => {
  const target = normalizeText(trackingNumber);
  if (!target) {
    return false;
  }

  const data = parseJsonField(order?.data);
  return collectTrackingValues(data).includes(target);
};

const findOrderByReference = async (req, reference) => {
  const referenceCandidates = buildOrderReferenceCandidates(reference);
  const normalizedReferences = new Set(referenceCandidates.map(normalizeText));
  const normalizedReference = normalizeText(reference);
  if (!normalizedReference) {
    return null;
  }

  for (const candidate of referenceCandidates) {
    const directLookup = isAdminRequest(req)
      ? await Order.findById(candidate)
      : await Order.findByIdForUser(req.user.id, candidate);
    if (directLookup?.data) {
      return directLookup.data;
    }
  }

  const { data: orders, error } = await findOrdersForScanner(req);
  if (error) {
    console.warn("Bosta scanner order reference lookup failed:", error.message);
    return null;
  }

  return (
    (orders || []).find((order) => {
      const data = parseJsonField(order?.data);
      return [
        order?.id,
        order?.shopify_id,
        order?.order_number,
        data?.id,
        data?.name,
        data?.order_number,
      ]
        .flatMap(buildOrderReferenceCandidates)
        .map(normalizeText)
        .some((candidate) => normalizedReferences.has(candidate));
    }) || null
  );
};

const findOrderByTrackingNumber = async ({
  req,
  trackingNumber,
  shipment,
  bostaDelivery,
}) => {
  const references = [
    shipment?.order_id,
    shipment?.business_reference,
    bostaDelivery?.businessReference,
    bostaDelivery?.data?.businessReference,
    bostaDelivery?.bosta_response?.businessReference,
    bostaDelivery?.shopifyOrderId,
    bostaDelivery?.data?.shopifyOrderId,
    bostaDelivery?.bosta_response?.shopifyOrderId,
  ].filter(Boolean);

  for (const reference of references) {
    const order = await findOrderByReference(req, reference);
    if (order) {
      return order;
    }
  }

  const { data: orders, error } = await findOrdersForScanner(req);
  if (error) {
    console.warn("Bosta scanner tracking lookup failed:", error.message);
    return null;
  }

  return (
    (orders || []).find((order) =>
      orderHasTrackingNumber(order, trackingNumber),
    ) || null
  );
};

const getShopifyTokenCandidates = async (req) => {
  const requestedStoreId = getRequestedStoreId(req);
  const normalizedRequestedStoreId = normalizeId(requestedStoreId);
  const isAdmin = isAdminRequest(req);
  const accessibleStoreIds = isAdmin ? [] : await getAccessibleStoreIds(req.user.id);
  const scopedStoreIds = normalizedRequestedStoreId
    ? [normalizedRequestedStoreId]
    : accessibleStoreIds;

  let query = supabase.from("shopify_tokens").select("*");

  if (isAdmin) {
    if (normalizedRequestedStoreId) {
      query = query.eq("store_id", normalizedRequestedStoreId);
    }
  } else if (scopedStoreIds.length > 0) {
    query = query.in("store_id", scopedStoreIds);
  } else {
    query = query.eq("user_id", req.user.id);
  }

  query = query.order("updated_at", { ascending: false }).limit(5);
  const { data, error } = await query;
  if (error) {
    console.warn("Bosta scanner Shopify token lookup failed:", error.message);
    return [];
  }

  return (data || []).filter(
    (token) =>
      normalizeText(token?.shop) &&
      normalizeSecret(token?.access_token) &&
      (isAdmin || normalizeId(token?.user_id) === normalizeId(req.user.id)),
  );
};

const fetchShopifyOrderByReference = async ({
  req,
  references = [],
  trackingNumber = "",
}) => {
  const rawCandidates = [
    ...references,
    trackingNumber,
    trackingNumber ? `tracking_number:${trackingNumber}` : "",
    trackingNumber ? `fulfillment_tracking_number:${trackingNumber}` : "",
  ].filter(Boolean);
  const referenceCandidates = Array.from(
    new Set(rawCandidates.flatMap(buildOrderReferenceCandidates).filter(Boolean)),
  );
  if (referenceCandidates.length === 0) {
    return null;
  }

  const tokenCandidates = await getShopifyTokenCandidates(req);
  if (tokenCandidates.length === 0) {
    return null;
  }

  for (const token of tokenCandidates) {
    const accessToken = normalizeSecret(token?.access_token);
    const shop = normalizeText(token?.shop);
    if (!accessToken || !shop) {
      continue;
    }

    for (const reference of referenceCandidates) {
      try {
        const matchedOrders = await ShopifyService.searchOrdersFromShopify(
          accessToken,
          shop,
          reference,
          { limit: 1 },
        );
        if (matchedOrders?.[0]) {
          return matchedOrders[0];
        }
      } catch (error) {
        console.warn(
          `Bosta scanner Shopify search failed for ${reference}:`,
          error.message,
        );
      }
    }
  }

  return null;
};

const getProductVariants = (product = {}) => {
  const data = parseJsonField(product?.data);
  if (Array.isArray(data?.variants)) {
    return data.variants;
  }
  if (Array.isArray(product?.variants)) {
    return product.variants;
  }
  return [];
};

const indexProductsForCostLookup = (products = []) => {
  const byProductId = new Map();
  const byVariantId = new Map();
  const bySku = new Map();

  const remember = (map, key, value) => {
    const normalized = normalizeId(key);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, value);
    }
  };

  products.forEach((product) => {
    remember(byProductId, product?.shopify_id, product);
    remember(byProductId, product?.id, product);
    remember(bySku, product?.sku, { product, variant: null });

    getProductVariants(product).forEach((variant) => {
      remember(byVariantId, variant?.id, { product, variant });
      remember(bySku, variant?.sku, { product, variant });
    });
  });

  return { byProductId, byVariantId, bySku };
};

const getMatchedProductCost = (item = {}, productIndex) => {
  const productId = normalizeId(item?.product_id);
  const variantId = normalizeId(item?.variant_id);
  const sku = normalizeId(item?.sku);
  const variantMatch = productIndex.byVariantId.get(variantId);
  const skuMatch = productIndex.bySku.get(sku);
  const productMatch = productIndex.byProductId.get(productId);
  const product = variantMatch?.product || skuMatch?.product || productMatch;
  const variant = variantMatch?.variant || skuMatch?.variant || null;

  return {
    costPrice: toNumber(
      variant?.cost_price ?? variant?.cost ?? product?.cost_price,
    ),
    adsCost: toNumber(product?.ads_cost),
    operationCost: toNumber(product?.operation_cost),
    shippingCost: toNumber(variant?.shipping_cost ?? product?.shipping_cost),
  };
};

const calculateOrderScanTotals = async (req, order = {}, shipment = {}) => {
  const lineItems = getOrderLineItems(order);
  const { data: products, error } = await findProductsForScanner(req);
  const productIndex = indexProductsForCostLookup(error ? [] : products || []);

  if (error) {
    console.warn("Bosta scanner product cost lookup failed:", error.message);
  }

  const totals = lineItems.reduce(
    (acc, item) => {
      const quantity = Math.max(1, toNumber(item?.quantity));
      const costs = getMatchedProductCost(item, productIndex);
      acc.totalCost +=
        (costs.costPrice + costs.adsCost + costs.operationCost) * quantity;
      acc.productShippingCost += costs.shippingCost * quantity;
      return acc;
    },
    { totalCost: 0, productShippingCost: 0 },
  );

  const shipmentShippingCost = toNumber(shipment?.expected_shipping_cost);
  const shippingCost =
    shipmentShippingCost > 0
      ? shipmentShippingCost
      : totals.productShippingCost;
  const revenue = getOrderRevenue(order);
  const totalCost = roundCurrency(totals.totalCost);
  const netProfit = roundCurrency(revenue - totalCost);

  return {
    revenue,
    total_cost: totalCost,
    shipping_cost: roundCurrency(shippingCost),
    net_profit: netProfit,
    real_net_profit: roundCurrency(netProfit - shippingCost),
  };
};

const getBostaDeliveryStateCode = (delivery = {}) => {
  const state = delivery?.state;
  if (state && typeof state === "object") {
    return toNumber(state.code ?? state.value);
  }
  return toNumber(state);
};

const getBostaDeliveryStateLabel = (delivery = {}) => {
  const state = delivery?.state;
  if (state && typeof state === "object") {
    return (
      state.value ||
      state.label ||
      BostaService.getStateLabel(state.code ?? state.value)
    );
  }
  return BostaService.getStateLabel(state);
};

const getBostaOrderType = (delivery = {}) => {
  const type = delivery?.type;
  return type && typeof type === "object" ? type.code || type.value : type;
};

const getPricingAmount = (pricing = {}) => {
  if (!pricing || typeof pricing !== "object") {
    return 0;
  }

  const candidates = [
    pricing?.priceAfterVat,
    pricing?.totalAfterVat,
    pricing?.totalWithVat,
    pricing?.amountAfterVat,
    pricing?.total,
    pricing?.priceBeforeVat,
    pricing?.shippingFee,
  ].map(toNumber);

  return candidates.find((value) => value > 0) || 0;
};

const getPricingAmountFromLogs = (delivery = {}) => {
  const logs = Array.isArray(delivery?.log) ? delivery.log : [];

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const pricing = logs[index]?.actionsList?.pricing;
    if (!pricing || typeof pricing !== "object") {
      continue;
    }

    const amount =
      getPricingAmount(pricing?.after) ||
      getPricingAmount(pricing?.before) ||
      getPricingAmount(pricing);

    if (amount > 0) {
      return amount;
    }
  }

  return 0;
};

const SHIPPING_AMOUNT_KEY_HINTS = [
  "shipping",
  "shipmentfees",
  "shipment_fees",
  "deliveryfees",
  "delivery_fees",
  "dues",
  "estimateddues",
  "feesaftervat",
  "netfees",
  "priceaftervat",
  "totalaftervat",
];

const SHIPPING_AMOUNT_EXCLUDED_KEY_HINTS = [
  "cod",
  "cash",
  "collect",
  "collection",
  "amounttobecollected",
  "wallet",
  "discount",
  "refund",
  "returned",
];

const getDeepShippingAmount = (payload = {}) => {
  const seen = new Set();
  const candidates = [];

  const visit = (value, path = []) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      const normalizedPath = nextPath.join(".").toLowerCase();
      const flatPath = normalizedPath.replace(/[^a-z0-9]/g, "");
      const numericValue = toNumber(child);
      const hasShippingHint = SHIPPING_AMOUNT_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );
      const hasExcludedHint = SHIPPING_AMOUNT_EXCLUDED_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );

      if (numericValue > 0 && hasShippingHint && !hasExcludedHint) {
        candidates.push(numericValue);
      }

      if (child && typeof child === "object") {
        visit(child, nextPath);
      }
    }
  };

  visit(payload);
  if (candidates.length === 0) {
    return 0;
  }

  return candidates.reduce(
    (lowestPositive, amount) =>
      amount > 0 && amount < lowestPositive ? amount : lowestPositive,
    candidates[0],
  );
};

const getBostaShippingCost = (delivery = {}) => {
  const prioritizedCost =
    getPricingAmount(delivery?.pricing) ||
    getPricingAmount(delivery?.pricing?.after) ||
    getPricingAmount(delivery?.pricing?.before) ||
    getPricingAmountFromLogs(delivery) ||
    getDeepShippingAmount(delivery);

  if (prioritizedCost > 0) {
    return prioritizedCost;
  }

  return toNumber(
    delivery?.estimatedDues ??
      delivery?.amountToBeCollected ??
      delivery?.dues ??
      delivery?.shipmentFees ??
      delivery?.expectedShippingCost ??
      delivery?.shippingCost,
  );
};

const enrichShipmentWithOrderData = async ({
  req,
  trackingNumber,
  shipment,
  bostaDelivery,
}) => {
  const order = await findOrderByTrackingNumber({
    req,
    trackingNumber,
    shipment,
    bostaDelivery,
  });

  if (!order) {
    const references = [
      shipment?.order_id,
      shipment?.business_reference,
      bostaDelivery?.businessReference,
      bostaDelivery?.data?.businessReference,
      bostaDelivery?.bosta_response?.businessReference,
      bostaDelivery?.shopifyOrderId,
      bostaDelivery?.data?.shopifyOrderId,
      bostaDelivery?.bosta_response?.shopifyOrderId,
    ].filter(Boolean);

    const liveShopifyOrder = await fetchShopifyOrderByReference({
      req,
      references,
      trackingNumber,
    });

    if (!liveShopifyOrder) {
      return shipment;
    }

    const totals = await calculateOrderScanTotals(req, liveShopifyOrder, shipment);
    return {
      ...shipment,
      order_id:
        liveShopifyOrder?.id ||
        liveShopifyOrder?.shopify_id ||
        shipment?.order_id ||
        null,
      order_name: getOrderDisplayName(liveShopifyOrder),
      customer_name: getCustomerName(liveShopifyOrder),
      ...totals,
    };
  }

  const totals = await calculateOrderScanTotals(req, order, shipment);
  return {
    ...shipment,
    order_id: order.id,
    order_name: getOrderDisplayName(order),
    customer_name: getCustomerName(order),
    ...totals,
  };
};

const persistShipmentSnapshot = async ({
  trackingNumber,
  shipment = {},
}) => {
  if (!trackingNumber) {
    return;
  }

  const updatePayload = {
    expected_shipping_cost: roundCurrency(
      toNumber(shipment?.expected_shipping_cost || shipment?.shipping_cost),
    ),
    delivery_state: toNumber(shipment?.delivery_state),
    delivery_state_label: shipment?.delivery_state_label || null,
    business_reference: shipment?.business_reference || null,
    updated_at: new Date().toISOString(),
  };

  if (isUuid(shipment?.order_id)) {
    updatePayload.order_id = shipment.order_id;
  }

  // Keep data lean and avoid writing undefined values
  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  const { error } = await supabase
    .from("bosta_shipments")
    .update(updatePayload)
    .eq("tracking_number", trackingNumber);

  if (error) {
    console.warn("Failed to persist shipment snapshot:", error.message);
  }
};

/**
 * GET /api/bosta/config
 * Get Bosta configuration status
 */
router.get("/config", authenticateToken, async (req, res) => {
  try {
    const resolved = await resolveBostaServiceForRequest(req);
    const hasConfig = Boolean(resolved?.service);
    const config = {
      hasConfig,
      apiKey: hasConfig
        ? maskSecret(
            resolved?.integration?.api_key || process.env.BOSTA_API_KEY || "",
          )
        : "",
      source: resolved?.source || null,
      storeId: resolved?.storeId || "",
    };
    res.json(config);
  } catch (error) {
    console.error("Failed to get Bosta config:", error);
    res.status(500).json({
      error: "Failed to get Bosta configuration",
      message: error.message,
    });
  }
});

/**
 * POST /api/bosta/config
 * Save Bosta configuration
 */
router.post(
  "/config",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const storeId = await resolveStoreScope(req);
      if (!storeId) {
        return res.status(400).json({
          error: "Select a store first before saving Bosta configuration.",
        });
      }

      const { apiKey } = req.body;
      const submittedApiKey = normalizeSecret(apiKey);
      const existingIntegration = await (async () => {
        try {
          return await loadBostaIntegration(storeId);
        } catch (error) {
          if (isSchemaCompatibilityError(error)) {
            return null;
          }
          throw error;
        }
      })();
      const existingApiKey =
        normalizeSecret(existingIntegration?.api_key) ||
        normalizeSecret(process.env.BOSTA_API_KEY);
      const nextApiKey =
        /^\*+$/.test(submittedApiKey) && existingApiKey
          ? existingApiKey
          : submittedApiKey;

      if (!nextApiKey) {
        return res.status(400).json({
          error: "Bosta API Key is required",
        });
      }

      // Test the API key by fetching cities
      const testService = new BostaService({
        apiKey: nextApiKey,
      });

      await testService.getCities();

      let persistedInDb = false;
      try {
        await saveBostaIntegration({
          storeId,
          userId: req.user.id,
          apiKey: nextApiKey,
          existingIntegration,
        });
        persistedInDb = true;
      } catch (saveError) {
        if (!isSchemaCompatibilityError(saveError)) {
          throw saveError;
        }
        console.warn(
          "bosta_integrations table missing, using environment fallback only.",
        );
      }

      try {
        const db = supabase;
        await db.from("activity_log").insert({
          user_id: req.user.id,
          action: "bosta_config_saved",
          entity_type: "settings",
          entity_id: "bosta",
          details: {
            configured: true,
            source: persistedInDb ? "settings" : "environment",
            store_id: storeId,
          },
        });
      } catch (logError) {
        console.warn("Bosta config activity log skipped:", logError.message);
      }

      process.env.BOSTA_API_KEY = nextApiKey;
      environmentBostaService = testService;
      environmentBostaServiceKey = nextApiKey;

      res.json({
        success: true,
        message: persistedInDb
          ? "Bosta configuration saved and activated successfully."
          : "Bosta configuration activated. Run migrations to persist it in database.",
        persisted: persistedInDb,
        storeId,
      });
    } catch (error) {
      console.error("Failed to save Bosta config:", error);
      res.status(500).json({
        error: "Failed to save Bosta configuration. Please check your API key.",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/cities
 * Get list of available cities
 */
router.get(
  "/cities",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const cities = await req.bostaService.getCities();
      res.json(extractBostaList(cities));
    } catch (error) {
      console.error("Failed to fetch cities:", error);
      res.status(500).json({
        error: "Failed to fetch cities from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/cities/:cityId/zones
 * Get zones for a specific city
 */
router.get(
  "/cities/:cityId/zones",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const { cityId } = req.params;
      const zones = await req.bostaService.getZones(cityId);
      res.json(extractBostaList(zones));
    } catch (error) {
      console.error("Failed to fetch zones:", error);
      res.status(500).json({
        error: "Failed to fetch zones from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/zones/:zoneId/districts
 * Get districts for a specific zone
 */
router.get(
  "/zones/:zoneId/districts",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const { zoneId } = req.params;
      const districts = await req.bostaService.getDistricts(zoneId);
      res.json(extractBostaList(districts));
    } catch (error) {
      console.error("Failed to fetch districts:", error);
      res.status(500).json({
        error: "Failed to fetch districts from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/pricing
 * Get pricing for delivery
 */
router.post(
  "/pricing",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const pricing = await req.bostaService.getPricing(req.body);
      res.json(pricing);
    } catch (error) {
      console.error("Failed to get pricing:", error);
      res.status(500).json({
        error: "Failed to get pricing from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries
 * Create a single delivery
 */
router.post(
  "/deliveries",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const delivery = await req.bostaService.createDelivery(req.body);

      // Log the delivery creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_delivery_created",
        entity_type: "delivery",
        entity_id: delivery.trackingNumber || delivery._id,
        details: {
          trackingNumber: delivery.trackingNumber,
          businessReference: req.body.businessReference,
        },
      });

      res.json(delivery);
    } catch (error) {
      console.error("Failed to create delivery:", error);
      res.status(500).json({
        error: "Failed to create delivery with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries/bulk
 * Create multiple deliveries
 */
router.post(
  "/deliveries/bulk",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { deliveries } = req.body;
      if (!Array.isArray(deliveries) || deliveries.length === 0) {
        return res.status(400).json({
          error: "deliveries array is required and must not be empty",
        });
      }

      const result = await req.bostaService.createBulkDeliveries(deliveries);

      // Log bulk delivery creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_bulk_deliveries_created",
        entity_type: "bulk_delivery",
        entity_id: `bulk_${Date.now()}`,
        details: {
          count: deliveries.length,
          businessReferences: deliveries
            .map((d) => d.businessReference)
            .filter(Boolean),
        },
      });

      res.json(result);
    } catch (error) {
      console.error("Failed to create bulk deliveries:", error);
      res.status(500).json({
        error: "Failed to create bulk deliveries with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/deliveries/:trackingNumber
 * Get delivery status
 */
router.get(
  "/deliveries/:trackingNumber",
  authenticateToken,
  requirePermission("can_view_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const validation = getTrackingValidationResponse(
        req.params?.trackingNumber,
      );
      if (validation.status !== 200) {
        return res.status(validation.status).json({
          error: validation.error,
          message: validation.message,
        });
      }

      const { trackingNumber } = validation;
      const delivery = await req.bostaService.getDeliveryStatus(trackingNumber);
      res.json(delivery);
    } catch (error) {
      console.error("Failed to get delivery status:", error);
      res.status(500).json({
        error: "Failed to get delivery status from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/demo-shipment
 * Legacy disabled demo endpoint kept for compatibility.
 */
router.get("/demo-shipment", authenticateToken, async (req, res) => {
  return res.status(410).json({
    error: "Demo shipment endpoint disabled",
    message:
      "Use a real Bosta tracking number or an existing shipment from the database.",
  });
});

/**
 * GET /api/bosta/shipments
 * Get all shipments from database (for testing)
 */
router.get(
  "/shipments",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const db = supabase;
      const { data: shipments, error } = await db
        .from("bosta_shipments")
        .select(
          "tracking_number, order_id, delivery_state, delivery_state_label, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        throw error;
      }

      res.json({
        count: shipments?.length || 0,
        shipments: shipments || [],
      });
    } catch (error) {
      console.error("Failed to get shipments:", error);
      res.status(500).json({
        error: "Failed to get shipments",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/shipments/:trackingNumber
 * Get shipment from database or fetch from Bosta API
 */
router.get(
  "/shipments/:trackingNumber",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const validation = getTrackingValidationResponse(
        req.params?.trackingNumber,
      );
      if (validation.status !== 200) {
        return res.status(validation.status).json({
          error: validation.error,
          message: validation.message,
        });
      }

      const { trackingNumber } = validation;

      const db = supabase;

      // First, try to get from database
      const { data: shipment, error } = await db
        .from("bosta_shipments")
        .select("*")
        .eq("tracking_number", trackingNumber)
        .single();

      if (shipment && !error) {
        const parsedStoredResponse = parseJsonField(shipment?.bosta_response);
        const refreshedShipment = { ...shipment };

        if (toNumber(refreshedShipment.expected_shipping_cost) <= 0) {
          const derivedShippingCost = getBostaShippingCost(parsedStoredResponse);
          if (derivedShippingCost > 0) {
            refreshedShipment.expected_shipping_cost =
              roundCurrency(derivedShippingCost);
          }
        }

        const enrichedShipment = await enrichShipmentWithOrderData({
          req,
          trackingNumber,
          shipment: refreshedShipment,
          bostaDelivery: parsedStoredResponse,
        });

        await persistShipmentSnapshot({
          trackingNumber,
          shipment: enrichedShipment,
        });

        return res.json(enrichedShipment);
      }

      const resolvedBosta = await resolveBostaServiceForRequest(req);

      // If not found in database, try Bosta's public tracking server first when
      // the business API is unavailable.
      if (!resolvedBosta?.service) {
        try {
          const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
          return res.json(
            await enrichShipmentWithOrderData({
              req,
              trackingNumber,
              shipment: publicShipment,
            }),
          );
        } catch (publicTrackingError) {
          return res.status(404).json({
            error:
              "Shipment not found in database and Bosta service not configured",
            message: publicTrackingError.message,
          });
        }
      }

      try {
        const bostaDelivery =
          await resolvedBosta.service.getDeliveryStatus(trackingNumber);
        const deliveryState = getBostaDeliveryStateCode(bostaDelivery);

        // Return the Bosta API response with expected format
        const formattedShipment = {
          tracking_number: bostaDelivery.trackingNumber || trackingNumber,
          delivery_id: bostaDelivery._id,
          order_id: null, // Will be null if not in our database
          bosta_order_type: getBostaOrderType(bostaDelivery),
          delivery_state: deliveryState,
          delivery_state_label: getBostaDeliveryStateLabel(bostaDelivery),
          expected_shipping_cost: getBostaShippingCost(bostaDelivery),
          cod_amount: bostaDelivery.cod || 0,
          revenue: toNumber(bostaDelivery.cod),
          is_delivered: BostaService.isDeliveredState(
            deliveryState,
            getBostaDeliveryStateLabel(bostaDelivery),
          ),
          business_reference: bostaDelivery.businessReference || null,
          receiver: bostaDelivery.receiver || null,
          customer_name:
            bostaDelivery.receiver?.fullName ||
            [bostaDelivery.receiver?.firstName, bostaDelivery.receiver?.lastName]
              .filter(Boolean)
              .join(" ") ||
            null,
          created_at: bostaDelivery.createdAt || null,
          updated_at: bostaDelivery.updatedAt || null,
          bosta_response: bostaDelivery,
        };

        return res.json(
          await enrichShipmentWithOrderData({
            req,
            trackingNumber,
            shipment: formattedShipment,
            bostaDelivery,
          }),
        );
      } catch (bostaError) {
        console.error("Failed to fetch from Bosta API:", bostaError);

        try {
          const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
          return res.json(
            await enrichShipmentWithOrderData({
              req,
              trackingNumber,
              shipment: publicShipment,
            }),
          );
        } catch (publicTrackingError) {
          console.error(
            "Failed to fetch from Bosta public tracking:",
            publicTrackingError,
          );
        }

        // Check if it's a 404 or invalid tracking number
        if (isTrackingNotFoundError(bostaError)) {
          return res.status(404).json({
            error: "Tracking number not found",
            message:
              "This tracking number does not exist in Bosta system. Please check the number and try again.",
          });
        }

        return res.status(500).json({
          error: "Failed to fetch shipment from Bosta API",
          message: bostaError.message,
        });
      }
    } catch (error) {
      console.error("Failed to get shipment:", error);
      res.status(500).json({
        error: "Failed to get shipment",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries/:trackingNumber/cancel
 * Cancel delivery
 */
router.post(
  "/deliveries/:trackingNumber/cancel",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const validation = getTrackingValidationResponse(
        req.params?.trackingNumber,
      );
      if (validation.status !== 200) {
        return res.status(validation.status).json({
          error: validation.error,
          message: validation.message,
        });
      }

      const { trackingNumber } = validation;
      const result = await req.bostaService.cancelDelivery(trackingNumber);

      // Log delivery cancellation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_delivery_cancelled",
        entity_type: "delivery",
        entity_id: trackingNumber,
        details: {
          trackingNumber,
          reason: req.body.reason || "Manual cancellation",
        },
      });

      res.json(result);
    } catch (error) {
      console.error("Failed to cancel delivery:", error);
      res.status(500).json({
        error: "Failed to cancel delivery with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/pickup-requests
 * Create pickup request
 */
router.post(
  "/pickup-requests",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const pickup = await req.bostaService.createPickupRequest(req.body);

      // Log pickup request creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_pickup_created",
        entity_type: "pickup",
        entity_id: pickup._id || pickup.id,
        details: pickup,
      });

      res.json(pickup);
    } catch (error) {
      console.error("Failed to create pickup request:", error);
      res.status(500).json({
        error: "Failed to create pickup request with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/orders/:orderId/ship
 * Ship a Shopify order with Bosta
 */
router.post(
  "/orders/:orderId/ship",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { packageType, allowOpenPackage, flexShip } = req.body;

      const db = supabase;

      // Get the order from database
      const { data: order, error: orderError } = await db
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({
          error: "Order not found",
        });
      }

      // Parse order data
      const orderData =
        typeof order.data === "string" ? JSON.parse(order.data) : order.data;

      // Convert Shopify order to Bosta format
      const bostaOrderData = req.bostaService.convertShopifyOrderToBosta(
        orderData,
        {
          packageType,
          allowOpenPackage,
          flexShip,
        },
      );

      // Create delivery with Bosta
      const delivery = await req.bostaService.createDelivery(bostaOrderData);

      // Save shipment to database
      await req.bostaService.saveShipment(orderId, delivery, bostaOrderData, {
        notes: `Shipped by user ${req.user.id}`,
      });

      // Update order with Bosta tracking info
      const updatedOrderData = {
        ...orderData,
        bosta_tracking_number: delivery.trackingNumber,
        bosta_delivery_id: delivery._id,
        bosta_status: "shipped",
        bosta_shipped_at: new Date().toISOString(),
      };

      await db
        .from("orders")
        .update({
          data: updatedOrderData,
          local_updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      // Log the shipping action
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "order_shipped_with_bosta",
        entity_type: "order",
        entity_id: orderId,
        details: {
          trackingNumber: delivery.trackingNumber,
          deliveryId: delivery._id,
          orderNumber: order.order_number,
        },
      });

      res.json({
        success: true,
        delivery,
        trackingNumber: delivery.trackingNumber,
        orderId,
      });
    } catch (error) {
      console.error("Failed to ship order with Bosta:", error);
      res.status(500).json({
        error: "Failed to ship order with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/webhook
 * Handle Bosta webhooks for delivery status updates
 */
router.post("/webhook", async (req, res) => {
  try {
    const webhookService = getEnvironmentBostaService();
    if (!webhookService) {
      console.warn("Bosta webhook received but service not configured");
      return res.status(200).json({ received: true });
    }

    const webhookData = webhookService.processWebhookData(req.body);

    // Update shipment in database
    await webhookService.updateShipmentFromWebhook(req.body);

    const db = supabase;

    // Find order by business reference (order number or ID)
    const { data: orders, error: orderError } = await db
      .from("orders")
      .select("*")
      .or(
        `order_number.eq.${webhookData.businessReference},id.eq.${webhookData.businessReference}`,
      )
      .limit(1);

    if (orderError) {
      console.error("Error finding order for webhook:", orderError);
      return res.status(200).json({ received: true });
    }

    if (!orders || orders.length === 0) {
      console.warn(
        "No order found for business reference:",
        webhookData.businessReference,
      );
      return res.status(200).json({ received: true });
    }

    const order = orders[0];
    const orderData =
      typeof order.data === "string" ? JSON.parse(order.data) : order.data;

    // Update order with new Bosta status
    const updatedOrderData = {
      ...orderData,
      bosta_status: webhookData.state,
      bosta_last_update: webhookData.timestamp.toISOString(),
      bosta_delivery_attempts: webhookData.numberOfAttempts,
    };

    // Add specific status information
    if (webhookData.isDelivered) {
      updatedOrderData.bosta_delivered_at = webhookData.timestamp.toISOString();
      updatedOrderData.bosta_cod_collected = webhookData.codAmount;
    }

    if (webhookData.isException) {
      updatedOrderData.bosta_exception_reason = webhookData.exceptionReason;
      updatedOrderData.bosta_exception_code = webhookData.exceptionCode;
    }

    // Update order in database
    await db
      .from("orders")
      .update({
        data: updatedOrderData,
        local_updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Log webhook processing
    await db.from("activity_log").insert({
      user_id: null, // System action
      action: "bosta_webhook_processed",
      entity_type: "order",
      entity_id: order.id,
      details: {
        trackingNumber: webhookData.trackingNumber,
        state: webhookData.state,
        businessReference: webhookData.businessReference,
        isDelivered: webhookData.isDelivered,
        isException: webhookData.isException,
      },
    });

    console.log("Bosta webhook processed successfully:", {
      orderId: order.id,
      trackingNumber: webhookData.trackingNumber,
      state: webhookData.state,
    });

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Failed to process Bosta webhook:", error);
    res.status(500).json({
      error: "Failed to process webhook",
      message: error.message,
    });
  }
});

export default router;
