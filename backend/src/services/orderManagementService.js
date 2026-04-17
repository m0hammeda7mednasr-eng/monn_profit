import { Order } from "../models/index.js";
import axios from "axios";
import { ShopifyService } from "./shopifyService.js";
import {
  DEFAULT_SHIPPING_ISSUE_REASON,
  applyOrderLocalMetadata,
  extractOrderLocalMetadata,
  getEditableShippingAddressFromOrderData,
  mergeOrderLocalMetadata,
  normalizeShippingIssueReason,
  preserveOrderLocalMetadata,
} from "../helpers/orderLocalMetadata.js";

const getShopifyTokenForStore = async (storeId, fallbackUserId) => {
  const { supabase } = await import("../supabaseClient.js");

  if (storeId) {
    const { data: tokenByStore } = await supabase
      .from("shopify_tokens")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenByStore) {
      return tokenByStore;
    }
  }

  const { data: tokenByUser } = await supabase
    .from("shopify_tokens")
    .select("*")
    .eq("user_id", fallbackUserId)
    .single();

  return tokenByUser || null;
};

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";
const MOON_PROFIT_PAYMENT_TAG_PREFIXES = [
  "moon_profit_payment_method:",
  "moon_profit_pm:",
];
const MOON_PROFIT_STATUS_TAG_PREFIX = "moon_profit_status:";
const MOON_PROFIT_PAYMENT_NOTE_ATTRIBUTE_NAMES = [
  "moon_profit_payment_method",
  "moon_profit_pm",
];
const MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES = ["moon_profit_status"];
const MOON_PROFIT_VOID_REASON_NOTE_ATTRIBUTE_NAMES = ["moon_profit_void_reason"];
const VALID_PAYMENT_METHODS = new Set(["none", "shopify", "instapay", "wallet"]);
const VALID_ORDER_STATUSES = new Set([
  "pending",
  "authorized",
  "paid",
  "partially_paid",
  "refunded",
  "voided",
  "partially_refunded",
]);
const VALID_FULFILLMENT_ACTIONS = new Set(["fulfilled", "unfulfilled"]);
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

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

const extractMissingColumn = (error) => {
  const text = String(
    error?.message || error?.details || error?.hint || "",
  ).trim();
  const patterns = [
    /column ['"]?([a-zA-Z0-9_]+)['"]? does not exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /"([a-zA-Z0-9_]+)" of relation/i,
    /has no field ['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

const parseOrderData = (order) => {
  const value = order?.data;
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

const hasNonEmptyObject = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );

// Legacy/migrated rows can keep only summary fields in `data`, which breaks
// the order details view that expects the full Shopify payload.
const isOrderDetailsDataIncomplete = (order, orderData = {}) => {
  if (!order?.shopify_id) {
    return false;
  }

  if (
    !orderData ||
    typeof orderData !== "object" ||
    Array.isArray(orderData) ||
    Object.keys(orderData).length === 0
  ) {
    return true;
  }

  if (!Array.isArray(orderData.line_items)) {
    return true;
  }

  const expectedLineItems = Number(order?.items_count || 0);
  if (expectedLineItems > 0 && orderData.line_items.length === 0) {
    return true;
  }

  const hasOrderIdentity = Boolean(
    orderData?.id ||
      orderData?.admin_graphql_api_id ||
      orderData?.order_number ||
      orderData?.name,
  );
  if (!hasOrderIdentity) {
    return true;
  }

  return !(
    hasNonEmptyObject(orderData.customer) ||
    hasNonEmptyObject(orderData.shipping_address) ||
    hasNonEmptyObject(orderData.billing_address) ||
    Array.isArray(orderData.shipping_lines) ||
    Array.isArray(orderData.fulfillments) ||
    Array.isArray(orderData.refunds) ||
    Array.isArray(orderData.note_attributes)
  );
};

const resolveOrderCustomerPhone = (orderData = {}, order = {}) =>
  String(
    orderData?.customer?.phone ||
      orderData?.shipping_address?.phone ||
      orderData?.billing_address?.phone ||
      order?.customer_phone ||
      "",
  ).trim();

const hydrateOrderDetailsFromShopify = async ({
  userId,
  order,
  orderData,
}) => {
  if (!isOrderDetailsDataIncomplete(order, orderData)) {
    return { order, orderData };
  }

  const tokenData = await getShopifyTokenForStore(order?.store_id, userId);
  if (!tokenData?.access_token || !tokenData?.shop) {
    return { order, orderData };
  }

  const refreshedOrder = await ShopifyService.getOrderByIdFromShopify(
    tokenData.access_token,
    tokenData.shop,
    order.shopify_id,
  );
  if (!refreshedOrder?.data) {
    return { order, orderData };
  }

  const nextOrderData = preserveOrderLocalMetadata(
    refreshedOrder.data,
    order.data,
  );
  const nextStatus =
    refreshedOrder.status ||
    order.status ||
    refreshedOrder.data?.financial_status ||
    null;
  const nextFinancialStatus =
    refreshedOrder.data?.financial_status ||
    refreshedOrder.status ||
    order.financial_status ||
    null;
  const nextCustomerPhone = resolveOrderCustomerPhone(nextOrderData, order);
  const nowIso = new Date().toISOString();
  const updatePayload = {
    order_number: refreshedOrder.order_number ?? order.order_number,
    customer_name: refreshedOrder.customer_name ?? order.customer_name,
    customer_email: refreshedOrder.customer_email ?? order.customer_email,
    customer_phone: nextCustomerPhone || null,
    total_price: refreshedOrder.total_price ?? order.total_price,
    subtotal_price: refreshedOrder.subtotal_price ?? order.subtotal_price,
    total_tax: refreshedOrder.total_tax ?? order.total_tax,
    total_discounts: refreshedOrder.total_discounts ?? order.total_discounts,
    currency: refreshedOrder.currency ?? order.currency,
    status: nextStatus,
    financial_status: nextFinancialStatus,
    fulfillment_status:
      refreshedOrder.fulfillment_status ?? order.fulfillment_status,
    items_count: refreshedOrder.items_count ?? order.items_count,
    data: nextOrderData,
    pending_sync: false,
    last_synced_at: nowIso,
    shopify_updated_at: refreshedOrder.updated_at || nowIso,
    sync_error: null,
  };

  try {
    const { supabase } = await import("../supabaseClient.js");
    const { error } = await supabase
      .from("orders")
      .update(updatePayload)
      .eq("id", order.id);

    if (error) {
      console.warn(
        "Order details hydration persistence warning:",
        error?.message || error,
      );
    }
  } catch (error) {
    console.warn(
      "Order details hydration persistence warning:",
      error?.message || error,
    );
  }

  return {
    order: {
      ...order,
      ...refreshedOrder,
      customer_phone: nextCustomerPhone || order.customer_phone || "",
      status: nextStatus,
      financial_status: nextFinancialStatus,
      data: nextOrderData,
    },
    orderData: nextOrderData,
  };
};

const normalizeAttributeName = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();

const normalizePaymentMethod = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();
  if (VALID_PAYMENT_METHODS.has(normalized)) {
    return normalized;
  }
  return "";
};

const normalizeOrderStatus = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();
  if (VALID_ORDER_STATUSES.has(normalized)) {
    return normalized;
  }
  return "";
};

const normalizeFulfillmentStatus = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();

  if (!normalized || normalized === "null") {
    return "unfulfilled";
  }

  return normalized;
};

const parseTagList = (tagsValue) => {
  if (Array.isArray(tagsValue)) {
    return tagsValue
      .map((tag) => String(tag || "").trim())
      .filter(Boolean);
  }

  return String(tagsValue || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const serializeTagList = (tags) =>
  Array.from(new Set((tags || []).map((tag) => String(tag || "").trim()).filter(Boolean))).join(", ");

const stripMoonProfitControlTags = (orderData) => {
  const existingTags = parseTagList(orderData?.tags);
  const filtered = existingTags.filter((tag) => {
    const normalized = String(tag || "")
      .toLowerCase()
      .trim();
    if (normalized.startsWith(MOON_PROFIT_STATUS_TAG_PREFIX)) {
      return false;
    }
    return !MOON_PROFIT_PAYMENT_TAG_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    );
  });

  return serializeTagList(filtered);
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

const getNoteAttributeValue = (orderData, keys = []) => {
  const normalizedKeys = new Set(
    (keys || []).map((key) => normalizeAttributeName(key)),
  );
  const attrs = Array.isArray(orderData?.note_attributes)
    ? orderData.note_attributes
    : [];
  for (const attr of attrs) {
    const name = normalizeAttributeName(attr?.name);
    if (!normalizedKeys.has(name)) {
      continue;
    }
    const value = String(attr?.value || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
};

const extractPaymentMethodFromOrderData = (orderData) => {
  const fromData = normalizePaymentMethod(orderData?.moon_profit_payment_method);
  if (fromData) {
    return fromData;
  }

  const fromAttributes = normalizePaymentMethod(
    getNoteAttributeValue(orderData, [
      "moon_profit_payment_method",
      "moon_profit_pm",
      "payment_method",
    ]),
  );
  if (fromAttributes) {
    return fromAttributes;
  }

  const tags = parseTagList(orderData?.tags);
  return normalizePaymentMethod(
    extractTagValueByPrefixes(tags, MOON_PROFIT_PAYMENT_TAG_PREFIXES),
  );
};

const extractStatusFromOrderData = (orderData) => {
  const fromData = normalizeOrderStatus(orderData?.moon_profit_status);
  if (fromData) {
    return fromData;
  }

  const fromAttributes = normalizeOrderStatus(
    getNoteAttributeValue(orderData, ["moon_profit_status", "status"]),
  );
  if (fromAttributes) {
    return fromAttributes;
  }

  const tags = parseTagList(orderData?.tags);
  return normalizeOrderStatus(extractTagValueByPrefixes(tags, [MOON_PROFIT_STATUS_TAG_PREFIX]));
};

const extractVoidReasonFromOrderData = (orderData) => {
  const directReason = String(orderData?.moon_profit_void_reason || "").trim();
  if (directReason) {
    return directReason;
  }

  return String(
    getNoteAttributeValue(orderData, MOON_PROFIT_VOID_REASON_NOTE_ATTRIBUTE_NAMES),
  ).trim();
};

const mergeMoonProfitControlTags = (orderData, { status = "", paymentMethod = "" } = {}) => {
  return stripMoonProfitControlTags(orderData);
};

const mergeMoonProfitControlNoteAttributes = (
  orderData,
  { status = "", paymentMethod = "", voidReason = "" } = {},
) => {
  const existingAttributes = Array.isArray(orderData?.note_attributes)
    ? orderData.note_attributes
    : [];

  const filtered = existingAttributes.filter((attribute) => {
    const name = normalizeAttributeName(attribute?.name);
    if (!name) {
      return true;
    }
    if (MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES.includes(name)) {
      return false;
    }
    if (MOON_PROFIT_VOID_REASON_NOTE_ATTRIBUTE_NAMES.includes(name)) {
      return false;
    }
    return !MOON_PROFIT_PAYMENT_NOTE_ATTRIBUTE_NAMES.includes(name);
  });

  const normalizedStatus = normalizeOrderStatus(status);
  if (normalizedStatus) {
    filtered.push({
      name: "moon_profit_status",
      value: normalizedStatus,
    });
  }

  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  if (normalizedPaymentMethod && normalizedPaymentMethod !== "none") {
    filtered.push({
      name: "moon_profit_payment_method",
      value: normalizedPaymentMethod,
    });
  }

  const normalizedVoidReason = String(voidReason || "").trim();
  if (normalizedStatus === "voided" && normalizedVoidReason) {
    filtered.push({
      name: "moon_profit_void_reason",
      value: normalizedVoidReason,
    });
  }

  return filtered;
};

const applyMoonProfitControlValuesToOrderData = (
  orderData,
  { status = "", paymentMethod = "", voidReason = "" } = {},
) => {
  const next = {
    ...(orderData && typeof orderData === "object" ? orderData : {}),
  };

  const normalizedStatus = normalizeOrderStatus(status);
  if (normalizedStatus) {
    next.moon_profit_status = normalizedStatus;
  } else {
    delete next.moon_profit_status;
  }

  const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
  if (normalizedPaymentMethod && normalizedPaymentMethod !== "none") {
    next.moon_profit_payment_method = normalizedPaymentMethod;
  } else {
    delete next.moon_profit_payment_method;
  }

  const normalizedVoidReason = String(voidReason || "").trim();
  if (normalizedStatus === "voided" && normalizedVoidReason) {
    next.moon_profit_void_reason = normalizedVoidReason;
  } else {
    delete next.moon_profit_void_reason;
  }

  next.tags = mergeMoonProfitControlTags(next, {
    status: normalizedStatus,
    paymentMethod: normalizedPaymentMethod,
  });
  next.note_attributes = mergeMoonProfitControlNoteAttributes(next, {
    status: normalizedStatus,
    paymentMethod: normalizedPaymentMethod,
    voidReason: normalizedVoidReason,
  });

  return next;
};

const getShopifyOrderPayload = (responseData) => {
  const payload = responseData?.order || responseData;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  return payload;
};

const appendLogLineToNote = (existingNote, line) => {
  const base = String(existingNote || "").trim();
  const nextLine = String(line || "").trim();
  if (!nextLine) {
    return base;
  }
  return base ? `${base}\n${nextLine}` : nextLine;
};

const buildShopifyHeaders = (accessToken) => ({
  "X-Shopify-Access-Token": accessToken,
  "Content-Type": "application/json",
});

const getOrderNumericShopifyId = (order) => {
  const numericShopifyId = Number.parseInt(String(order?.shopify_id || ""), 10);
  if (!Number.isFinite(numericShopifyId)) {
    throw new Error("Invalid Shopify order id");
  }
  return numericShopifyId;
};

const toMoneyString = (value) => parseFloat(value || 0).toFixed(2);

const getOrderFulfillmentStatus = (order) =>
  normalizeFulfillmentStatus(
    parseOrderData(order)?.fulfillment_status || order?.fulfillment_status,
  );

const getOrderFulfillments = (order) => {
  const fulfillments = parseOrderData(order)?.fulfillments;
  return Array.isArray(fulfillments) ? fulfillments : [];
};

const getOrderLineItems = (order) => {
  const lineItems = parseOrderData(order)?.line_items;
  return Array.isArray(lineItems) ? lineItems : [];
};

const getLineItemId = (item) =>
  String(item?.line_item_id || item?.id || "").trim();

const parsePositiveQuantity = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getFulfillableQuantity = (order) => {
  const lineItems = getOrderLineItems(order);

  return lineItems.reduce((sum, item) => {
    const quantity = parseFloat(item?.fulfillable_quantity || 0);
    return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
};

const buildAvailableQuantityByLineItemId = (items = [], quantityResolver) => {
  const quantities = new Map();

  for (const item of items || []) {
    const lineItemId = getLineItemId(item);
    if (!lineItemId) {
      continue;
    }

    const quantity = parsePositiveQuantity(quantityResolver(item));
    if (quantity <= 0) {
      continue;
    }

    quantities.set(lineItemId, (quantities.get(lineItemId) || 0) + quantity);
  }

  return quantities;
};

const buildOrderFulfillableQuantityByLineItemId = (order) =>
  buildAvailableQuantityByLineItemId(
    getOrderLineItems(order),
    (item) => item?.fulfillable_quantity,
  );

const buildOrderFulfilledQuantityByLineItemId = (order) =>
  buildAvailableQuantityByLineItemId(
    getOrderFulfillments(order).flatMap((fulfillment) =>
      Array.isArray(fulfillment?.line_items) ? fulfillment.line_items : [],
    ),
    (item) => item?.quantity,
  );

const buildRequestedLineItemQuantities = (
  availableQuantitiesByLineItemId,
  requestedLineItems = [],
  actionLabel,
) => {
  const items = Array.isArray(requestedLineItems) ? requestedLineItems : [];
  if (items.length === 0) {
    return null;
  }

  const requestedQuantities = new Map();

  for (const item of items) {
    const lineItemId = getLineItemId(item);
    if (!lineItemId) {
      throw new Error("Each selected line item must include an id");
    }

    const availableQuantity =
      parsePositiveQuantity(availableQuantitiesByLineItemId.get(lineItemId)) || 0;
    if (availableQuantity <= 0) {
      throw new Error(
        `Line item ${lineItemId} has no ${actionLabel} quantity available`,
      );
    }

    const requestedQuantity = parsePositiveQuantity(item?.quantity) || availableQuantity;
    const existingRequested = requestedQuantities.get(lineItemId) || 0;
    const nextRequestedQuantity = existingRequested + requestedQuantity;

    if (nextRequestedQuantity > availableQuantity) {
      throw new Error(
        `Line item ${lineItemId} exceeds the available ${actionLabel} quantity`,
      );
    }

    requestedQuantities.set(lineItemId, nextRequestedQuantity);
  }

  return requestedQuantities;
};

const getRemainingRequestedLineItemIds = (requestedQuantitiesByLineItemId) =>
  Array.from((requestedQuantitiesByLineItemId || new Map()).entries())
    .filter(([, quantity]) => parsePositiveQuantity(quantity) > 0)
    .map(([lineItemId]) => lineItemId);

const getOrderCurrency = (order, orderData = {}) =>
  String(orderData?.currency || order?.currency || "USD").trim() || "USD";

const getOrderOutstandingAmount = (order, orderData = {}) => {
  const outstanding = parseFloat(orderData?.total_outstanding || 0);
  if (Number.isFinite(outstanding) && outstanding > 0) {
    return outstanding;
  }

  const total = parseFloat(
    orderData?.current_total_price || orderData?.total_price || order?.total_price || 0,
  );
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const getRefundableAmount = (order, orderData = {}) => {
  const currentTotal = parseFloat(
    orderData?.current_total_price || orderData?.total_price || order?.total_price || 0,
  );
  const refundedAmount = parseFloat(order?.total_refunded || 0);
  const refundable = currentTotal - refundedAmount;
  return Number.isFinite(refundable) && refundable > 0 ? refundable : 0;
};

const fetchShopifyOrderById = async ({ tokenData, order }) => {
  const response = await axios.get(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}.json`,
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return getShopifyOrderPayload(response?.data);
};

const fetchShopifyOrderTransactions = async ({ tokenData, order }) => {
  const response = await axios.get(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}/transactions.json`,
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return Array.isArray(response?.data?.transactions)
    ? response.data.transactions
    : [];
};

const fetchShopifyFulfillmentOrders = async ({ tokenData, order }) => {
  const response = await axios.get(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}/fulfillment_orders.json`,
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return Array.isArray(response?.data?.fulfillment_orders)
    ? response.data.fulfillment_orders
    : [];
};

const createShopifyFulfillment = async ({
  tokenData,
  order,
  fulfillment,
}) => {
  const response = await axios.post(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json`,
    { fulfillment },
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return response?.data || null;
};

const cancelShopifyFulfillment = async ({
  tokenData,
  fulfillmentId,
}) => {
  const response = await axios.post(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/fulfillments/${fulfillmentId}/cancel.json`,
    {},
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return response?.data || null;
};

const isMissingOrderCommentsTableError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    String(error?.code || "") === "42P01" ||
    message.includes("order_comments") ||
    message.includes("order_comments_with_user")
  );
};

const getUserDisplayInfo = async (userId) => {
  const { supabase } = await import("../supabaseClient.js");
  const { data } = await supabase
    .from("users")
    .select("name, email, role")
    .eq("id", userId)
    .maybeSingle();

  return {
    name: data?.name || data?.email || "User",
    role: data?.role || "user",
  };
};

const createShopifyOrderTransaction = async ({
  tokenData,
  order,
  transaction,
}) => {
  const response = await axios.post(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}/transactions.json`,
    { transaction },
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return response?.data || null;
};

const pickReferenceTransaction = (transactions = []) =>
  [...(transactions || [])]
    .filter((transaction) => {
      const kind = String(transaction?.kind || "")
        .toLowerCase()
        .trim();
      return kind === "sale" || kind === "capture";
    })
    .sort(
      (a, b) =>
        new Date(b?.processed_at || b?.created_at || 0).getTime() -
        new Date(a?.processed_at || a?.created_at || 0).getTime(),
    )[0] || null;

const syncOrderMetadataToShopify = async ({
  tokenData,
  order,
  logLine,
  status = "",
  paymentMethod = "",
  voidReason = "",
}) => {
  const orderData = parseOrderData(order);
  const mirroredControlData = applyMoonProfitControlValuesToOrderData(orderData, {
    status,
    paymentMethod,
    voidReason,
  });

  return await updateShopifyOrderNote({
    tokenData,
    order,
    logLine,
    extraOrderFields: {
      tags: mirroredControlData.tags,
      note_attributes: mirroredControlData.note_attributes,
    },
  });
};

const updateShopifyOrderNote = async ({
  tokenData,
  order,
  logLine,
  extraOrderFields = {},
}) => {
  if (!tokenData?.shop || !tokenData?.access_token) {
    throw new Error("Shopify token is missing");
  }
  if (!order?.shopify_id) {
    throw new Error("Order not found or missing Shopify ID");
  }

  const parsedOrderData = parseOrderData(order);
  const existingNote = String(parsedOrderData?.note || order?.note || "").trim();
  const nextNote = appendLogLineToNote(existingNote, logLine);
  const numericShopifyId = getOrderNumericShopifyId(order);

  const response = await axios.put(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}.json`,
    {
      order: {
        id: numericShopifyId,
        note: nextNote,
        ...extraOrderFields,
      },
    },
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return response?.data || null;
};

export class OrderManagementService {
  static async recordVoidReasonComment(userId, orderId, voidReason) {
    const trimmedReason = String(voidReason || "").trim();
    if (!trimmedReason) {
      return;
    }

    const { data: order, error } = await Order.findByIdForUser(userId, orderId);
    if (error || !order) {
      throw new Error("Order not found");
    }

    const { supabase } = await import("../supabaseClient.js");
    const userInfo = await getUserDisplayInfo(userId);
    const commentText = `Order was voided on Shopify. Reason: ${trimmedReason}`;
    const normalizedShopifyOrderId = String(order.shopify_id || "").trim();

    if (normalizedShopifyOrderId) {
      const { error: insertError } = await supabase.from("order_comments").insert([
        {
          order_id: normalizedShopifyOrderId,
          user_id: userId,
          comment_text: commentText,
          comment_type: "status_change",
          is_internal: false,
          is_pinned: true,
        },
      ]);

      if (!insertError) {
        return;
      }

      if (!isMissingOrderCommentsTableError(insertError)) {
        throw insertError;
      }
    }

    let existingNotes = [];
    if (typeof order.notes === "string") {
      try {
        existingNotes = JSON.parse(order.notes) || [];
      } catch {
        existingNotes = [];
      }
    } else if (Array.isArray(order.notes)) {
      existingNotes = order.notes;
    }

    const nextNotes = [
      {
        id: `legacy-void-${Date.now()}`,
        content: commentText,
        author: userInfo.name,
        user_id: userId,
        role: userInfo.role,
        created_at: new Date().toISOString(),
        is_pinned: true,
        synced_to_shopify: true,
        source: "void_reason",
      },
      ...existingNotes,
    ];

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        notes: JSON.stringify(nextNotes),
        local_updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (updateError) {
      throw updateError;
    }
  }

  /**
   * Get complete order details with all related data
   */
  static async getOrderDetails(userId, orderId) {
    try {
      console.log("OrderManagementService.getOrderDetails called:", {
        userId,
        orderId,
      });

      const { data: order, error } = await Order.findByIdForUser(
        userId,
        orderId,
      );

      console.log("Order query result:", { found: !!order, error: error });

      if (error || !order) {
        console.error("Order not found or error:", error);
        throw new Error("Order not found");
      }

      // Access already validated through store scope (findByIdForUser)

      // Parse the data field if it's a string
      let orderData = order.data;
      if (typeof orderData === "string") {
        try {
          orderData = JSON.parse(orderData);
        } catch (e) {
          orderData = {};
        }
      }

      try {
        const hydratedOrderResult = await hydrateOrderDetailsFromShopify({
          userId,
          order,
          orderData,
        });
        orderData = hydratedOrderResult.orderData;
        Object.assign(order, hydratedOrderResult.order);
      } catch (hydrationError) {
        console.warn(
          "Order details hydration skipped:",
          hydrationError?.message || hydrationError,
        );
      }

      const localOrderMetadata = extractOrderLocalMetadata(orderData);
      orderData = applyOrderLocalMetadata(orderData, localOrderMetadata);
      order.data = orderData;

      // Extract ALL line items details from data
      const lineItems = orderData?.line_items || [];
      order.line_items = lineItems.map((item) => ({
        id: item.id,
        title: item.title,
        variant_title: item.variant_title,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        product_id: item.product_id,
        variant_id: item.variant_id,
        vendor: item.vendor,
        fulfillment_status: item.fulfillment_status,
        fulfillable_quantity: item.fulfillable_quantity,
        grams: item.grams,
        requires_shipping: item.requires_shipping,
        taxable: item.taxable,
        gift_card: item.gift_card,
        name: item.name,
        properties: item.properties || [],
        product_exists: item.product_exists,
        total_discount: item.total_discount,
        image_url:
          item.properties?.find((p) => p.name === "_image_url")?.value || null,
      }));

      // Extract COMPLETE shipping address from data
      order.shipping_address = orderData?.shipping_address
        ? {
            first_name: orderData.shipping_address.first_name,
            last_name: orderData.shipping_address.last_name,
            address1: orderData.shipping_address.address1,
            address2: orderData.shipping_address.address2,
            city: orderData.shipping_address.city,
            province: orderData.shipping_address.province,
            province_code: orderData.shipping_address.province_code,
            country: orderData.shipping_address.country,
            country_code: orderData.shipping_address.country_code,
            zip: orderData.shipping_address.zip,
            phone: orderData.shipping_address.phone,
            name: orderData.shipping_address.name,
            company: orderData.shipping_address.company,
            latitude: orderData.shipping_address.latitude,
            longitude: orderData.shipping_address.longitude,
          }
        : null;

      // Extract COMPLETE billing address from data
      order.billing_address = orderData?.billing_address
        ? {
            first_name: orderData.billing_address.first_name,
            last_name: orderData.billing_address.last_name,
            address1: orderData.billing_address.address1,
            address2: orderData.billing_address.address2,
            city: orderData.billing_address.city,
            province: orderData.billing_address.province,
            province_code: orderData.billing_address.province_code,
            country: orderData.billing_address.country,
            country_code: orderData.billing_address.country_code,
            zip: orderData.billing_address.zip,
            phone: orderData.billing_address.phone,
            name: orderData.billing_address.name,
            company: orderData.billing_address.company,
          }
        : null;

      // Extract COMPLETE customer info from data
      if (orderData?.customer) {
        order.customer_info = {
          id: orderData.customer.id,
          email: orderData.customer.email,
          first_name: orderData.customer.first_name,
          last_name: orderData.customer.last_name,
          phone: orderData.customer.phone,
          orders_count: orderData.customer.orders_count,
          total_spent: orderData.customer.total_spent,
          verified_email: orderData.customer.verified_email,
          accepts_marketing: orderData.customer.accepts_marketing,
          tags: orderData.customer.tags,
          note: orderData.customer.note,
          state: orderData.customer.state,
        };
        order.customer_phone = orderData.customer.phone || order.customer_phone;
      }

      order.contact_edits = {
        customer_phone:
          localOrderMetadata?.contact_overrides?.customer_phone || null,
        shipping_address:
          localOrderMetadata?.contact_overrides?.shipping_address || null,
      };
      order.shipping_issue = localOrderMetadata?.shipping_issue || null;

      // Extract shipping lines (shipping methods)
      order.shipping_lines = orderData?.shipping_lines || [];

      // Extract discount codes
      order.discount_codes = orderData?.discount_codes || [];

      // Extract discount applications
      order.discount_applications = orderData?.discount_applications || [];

      // Extract tax lines
      order.tax_lines = orderData?.tax_lines || [];

      // Extract refunds (المرتجعات)
      order.refunds = orderData?.refunds || [];

      // Calculate total refunded amount
      order.total_refunded = order.refunds.reduce((sum, refund) => {
        const refundTransactions = refund.transactions || [];
        return (
          sum +
          refundTransactions.reduce(
            (tSum, t) => tSum + parseFloat(t.amount || 0),
            0,
          )
        );
      }, 0);

      // Extract fulfillments
      order.fulfillments = orderData?.fulfillments || [];

      // Extract payment details
      order.payment_details = orderData?.payment_details || null;
      order.payment_gateway_names = orderData?.payment_gateway_names || [];
      order.processing_method = orderData?.processing_method || null;

      // Extract financial status
      order.financial_status = orderData?.financial_status || null;
      const mirroredStatus = extractStatusFromOrderData(orderData);
      if (mirroredStatus) {
        order.status = mirroredStatus;
      }
      const normalizedFinancialStatus = String(order.financial_status || "")
        .toLowerCase()
        .trim();
      const manualPaymentMethod = extractPaymentMethodFromOrderData(orderData);
      order.payment_method =
        normalizedFinancialStatus === "paid" ||
        normalizedFinancialStatus === "partially_paid"
          ? "shopify"
          : manualPaymentMethod === "instapay" || manualPaymentMethod === "wallet"
            ? manualPaymentMethod
            : "none";

      // Extract tags
      order.tags = orderData?.tags || "";

      // Extract note (customer note)
      order.customer_note = orderData?.note || "";

      // Extract note attributes
      order.note_attributes = orderData?.note_attributes || [];

      // Extract source information
      order.source_name = orderData?.source_name || "";
      order.source_identifier = orderData?.source_identifier || "";
      order.source_url = orderData?.source_url || "";

      // Extract browser and device info
      order.browser_ip = orderData?.browser_ip || null;
      order.client_details = orderData?.client_details || null;

      // Extract totals from data
      order.total_shipping =
        orderData?.total_shipping_price_set?.shop_money?.amount ||
        orderData?.shipping_lines?.reduce(
          (sum, line) => sum + parseFloat(line.price || 0),
          0,
        ) ||
        0;

      // Extract all price breakdowns
      order.subtotal_price = orderData?.subtotal_price || order.subtotal_price;
      order.total_line_items_price =
        orderData?.total_line_items_price || order.total_price;
      order.total_discounts = orderData?.total_discounts || 0;
      order.total_tax = orderData?.total_tax || 0;
      order.total_tip_received = orderData?.total_tip_received || 0;
      order.total_weight = orderData?.total_weight || 0;

      // Extract presentment currency (for multi-currency)
      order.presentment_currency = orderData?.presentment_currency || null;
      order.total_price_set = orderData?.total_price_set || null;

      // Extract order status URL
      order.order_status_url = orderData?.order_status_url || null;

      // Extract cancel information
      order.cancelled_at = orderData?.cancelled_at || null;
      order.cancel_reason = orderData?.cancel_reason || null;
      order.void_reason = extractVoidReasonFromOrderData(orderData) || null;

      // Extract closed information
      order.closed_at = orderData?.closed_at || null;

      // Extract test order flag
      order.test = orderData?.test || false;

      // Extract buyer accepts marketing
      order.buyer_accepts_marketing =
        orderData?.buyer_accepts_marketing || false;

      // Extract referring site
      order.referring_site = orderData?.referring_site || null;

      // Extract landing site
      order.landing_site = orderData?.landing_site || null;

      // Extract checkout information
      order.checkout_id = orderData?.checkout_id || null;
      order.checkout_token = orderData?.checkout_token || null;

      // Extract cart token
      order.cart_token = orderData?.cart_token || null;

      // Extract location information
      order.location_id = orderData?.location_id || null;

      // Extract user information
      order.user_id_shopify = orderData?.user_id || null;

      // Extract app information
      order.app_id = orderData?.app_id || null;

      // Parse notes if it's a string
      if (typeof order.notes === "string") {
        try {
          order.notes = JSON.parse(order.notes);
        } catch (e) {
          order.notes = [];
        }
      }

      // Ensure notes is an array
      if (!Array.isArray(order.notes)) {
        order.notes = [];
      }

      // Sort notes by created_at (newest first)
      order.notes.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );

      return order;
    } catch (error) {
      console.error("Get order details error:", error);
      throw error;
    }
  }

  /**
   * Add a note/comment to an order
   */
  static async addOrderNote(userId, orderId, content, author) {
    try {
      // Get current order
      const { data: order, error } = await Order.findByIdForUser(
        userId,
        orderId,
      );

      if (error || !order) {
        throw new Error("Order not found");
      }

      // Sanitize content (remove HTML tags)
      const sanitizedContent = content.replace(/<[^>]*>/g, "");

      if (!sanitizedContent.trim()) {
        throw new Error("Note content cannot be empty");
      }

      // Parse existing notes
      let notes = [];
      if (order.notes) {
        if (typeof order.notes === "string") {
          try {
            notes = JSON.parse(order.notes);
          } catch (e) {
            notes = [];
          }
        } else if (Array.isArray(order.notes)) {
          notes = order.notes;
        }
      }

      // Create new note
      const newNote = {
        content: sanitizedContent,
        author: author || "مستخدم",
        created_at: new Date().toISOString(),
        synced_to_shopify: false,
      };

      // Add to notes array
      notes.unshift(newNote); // Add to beginning

      // Update order
      const { supabase } = await import("../supabaseClient.js");
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          notes: JSON.stringify(notes),
          pending_sync: true,
          local_updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updateError) {
        throw updateError;
      }

      // Log operation
      await this.logSyncOperation(userId, orderId, "order_note_add", {
        note: newNote,
      });

      try {
        await this.syncNoteToShopify(userId, orderId, newNote);
      } catch (syncError) {
        const rollbackNotes = notes.filter(
          (item) =>
            !(
              item?.created_at === newNote.created_at &&
              String(item?.content || "") === String(newNote.content || "")
            ),
        );

        await supabase
          .from("orders")
          .update({
            notes: JSON.stringify(rollbackNotes),
            pending_sync: false,
            sync_error: syncError.message,
            local_updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);

        throw new Error(
          `Shopify sync failed. Note was rolled back: ${syncError.message}`,
        );
      }

      return {
        success: true,
        note: newNote,
      };
    } catch (error) {
      console.error("Add order note error:", error);
      throw error;
    }
  }

  static async updateOrderContactDetails(userId, orderId, updates = {}) {
    try {
      const { data: order, error } = await Order.findByIdForUser(
        userId,
        orderId,
      );

      if (error || !order) {
        throw new Error("Order not found");
      }

      const currentOrderData = applyOrderLocalMetadata(parseOrderData(order));
      const nextCustomerPhone = Object.prototype.hasOwnProperty.call(
        updates || {},
        "customer_phone",
      )
        ? String(updates?.customer_phone ?? "").trim()
        : String(
            currentOrderData?.customer?.phone ||
              currentOrderData?.shipping_address?.phone ||
              "",
          ).trim();
      const nextShippingAddress = Object.prototype.hasOwnProperty.call(
        updates || {},
        "shipping_address",
      )
        ? updates?.shipping_address || {}
        : getEditableShippingAddressFromOrderData(currentOrderData);

      const currentCustomerPhone = String(
        currentOrderData?.customer?.phone ||
          currentOrderData?.shipping_address?.phone ||
          "",
      ).trim();
      const currentShippingAddress =
        getEditableShippingAddressFromOrderData(currentOrderData);

      const shippingAddressChanged =
        JSON.stringify(currentShippingAddress) !==
        JSON.stringify(getEditableShippingAddressFromOrderData({
          shipping_address: nextShippingAddress,
        }));

      if (
        nextCustomerPhone === currentCustomerPhone &&
        !shippingAddressChanged
      ) {
        return {
          success: true,
          localOnly: true,
          order: await this.getOrderDetails(userId, order.id),
        };
      }

      const { supabase } = await import("../supabaseClient.js");
      const { data: userInfo } = await supabase
        .from("users")
        .select("name,email")
        .eq("id", userId)
        .maybeSingle();

      const nextOrderData = mergeOrderLocalMetadata(
        currentOrderData,
        {
          customer_phone: nextCustomerPhone,
          shipping_address: nextShippingAddress,
        },
        {
          updatedBy: userId,
          updatedByName:
            String(userInfo?.name || "").trim() ||
            String(userInfo?.email || "").trim(),
        },
      );

      const persistedCustomerPhone = String(
        nextOrderData?.customer?.phone ||
          nextOrderData?.shipping_address?.phone ||
          "",
      ).trim();

      const updatePayload = {
        customer_phone: persistedCustomerPhone || null,
        data: nextOrderData,
        local_updated_at: new Date().toISOString(),
      };
      let { error: updateError } = await supabase
        .from("orders")
        .update(updatePayload)
        .eq("id", order.id);

      if (updateError && isSchemaCompatibilityError(updateError)) {
        const missingColumn = extractMissingColumn(updateError);
        if (
          missingColumn &&
          Object.prototype.hasOwnProperty.call(updatePayload, missingColumn)
        ) {
          const retryPayload = { ...updatePayload };
          delete retryPayload[missingColumn];
          ({ error: updateError } = await supabase
            .from("orders")
            .update(retryPayload)
            .eq("id", order.id));
        }
      }

      if (updateError) {
        throw updateError;
      }

      await this.logSyncOperation(userId, order.id, "order_contact_update", {
        local_only: true,
        old_customer_phone: currentCustomerPhone,
        new_customer_phone: persistedCustomerPhone,
        old_shipping_address: currentShippingAddress,
        new_shipping_address: getEditableShippingAddressFromOrderData(
          nextOrderData,
        ),
      });

      return {
        success: true,
        localOnly: true,
        order: await this.getOrderDetails(userId, order.id),
      };
    } catch (error) {
      console.error("Update order contact details error:", error);
      throw error;
    }
  }

  static async updateOrderShippingIssue(userId, orderId, update = {}) {
    try {
      const { data: order, error } = await Order.findByIdForUser(
        userId,
        orderId,
      );

      if (error || !order) {
        throw new Error("Order not found");
      }

      const currentOrderData = applyOrderLocalMetadata(parseOrderData(order));
      const currentMetadata = extractOrderLocalMetadata(currentOrderData);
      const currentShippingIssue = currentMetadata?.shipping_issue || null;
      const shouldActivate = update?.active !== false;
      const hasUpdateField = (field) =>
        Object.prototype.hasOwnProperty.call(update || {}, field);
      const currentShippingCompanyNote = String(
        currentShippingIssue?.shipping_company_note || "",
      ).trim();
      const currentCustomerServiceNote = String(
        currentShippingIssue?.customer_service_note || "",
      ).trim();
      const nextReason = shouldActivate
        ? normalizeShippingIssueReason(
            hasUpdateField("reason")
              ? update?.reason
              : currentShippingIssue?.reason || DEFAULT_SHIPPING_ISSUE_REASON,
            currentShippingIssue?.reason || DEFAULT_SHIPPING_ISSUE_REASON,
          )
        : null;
      const nextShippingCompanyNote = shouldActivate
        ? hasUpdateField("shipping_company_note")
          ? String(update?.shipping_company_note ?? "").trim()
          : currentShippingCompanyNote
        : "";
      const nextCustomerServiceNote = shouldActivate
        ? hasUpdateField("customer_service_note")
          ? String(update?.customer_service_note ?? "").trim()
          : currentCustomerServiceNote
        : "";
      const currentReason =
        currentShippingIssue?.reason || DEFAULT_SHIPPING_ISSUE_REASON;

      if (
        (shouldActivate &&
          currentShippingIssue &&
          currentReason === nextReason &&
          currentShippingCompanyNote === nextShippingCompanyNote &&
          currentCustomerServiceNote === nextCustomerServiceNote) ||
        (!shouldActivate && !currentShippingIssue)
      ) {
        return {
          success: true,
          localOnly: true,
          order: await this.getOrderDetails(userId, order.id),
        };
      }

      const { supabase } = await import("../supabaseClient.js");
      const { data: userInfo } = await supabase
        .from("users")
        .select("name,email")
        .eq("id", userId)
        .maybeSingle();

      const nextOrderData = mergeOrderLocalMetadata(
        currentOrderData,
        {
          shipping_issue: shouldActivate
            ? {
                reason: nextReason,
                shipping_company_note: nextShippingCompanyNote,
                customer_service_note: nextCustomerServiceNote,
              }
            : null,
        },
        {
          updatedBy: userId,
          updatedByName:
            String(userInfo?.name || "").trim() ||
            String(userInfo?.email || "").trim(),
        },
      );

      const updatePayload = {
        data: nextOrderData,
        local_updated_at: new Date().toISOString(),
      };
      let { error: updateError } = await supabase
        .from("orders")
        .update(updatePayload)
        .eq("id", order.id);

      if (updateError && isSchemaCompatibilityError(updateError)) {
        const missingColumn = extractMissingColumn(updateError);
        if (
          missingColumn &&
          Object.prototype.hasOwnProperty.call(updatePayload, missingColumn)
        ) {
          const retryPayload = { ...updatePayload };
          delete retryPayload[missingColumn];
          ({ error: updateError } = await supabase
            .from("orders")
            .update(retryPayload)
            .eq("id", order.id));
        }
      }

      if (updateError) {
        throw updateError;
      }

      await this.logSyncOperation(userId, order.id, "order_shipping_issue_update", {
        local_only: true,
        old_shipping_issue: currentShippingIssue,
        new_shipping_issue:
          extractOrderLocalMetadata(nextOrderData)?.shipping_issue || null,
      });

      return {
        success: true,
        localOnly: true,
        order: await this.getOrderDetails(userId, order.id),
      };
    } catch (error) {
      console.error("Update order shipping issue error:", error);
      throw error;
    }
  }

  /**
   * Update order status
   */
  static async updateOrderStatus(userId, orderId, newStatus, options = {}) {
    // Validate status
    const validStatuses = [
      "pending",
      "authorized",
      "paid",
      "partially_paid",
      "refunded",
      "voided",
      "partially_refunded",
    ];

    if (!validStatuses.includes(newStatus)) {
      throw new Error("Invalid status");
    }

    const voidReason = String(options?.voidReason || "").trim();
    if (newStatus === "voided") {
      if (!voidReason) {
        throw new Error("Void reason is required");
      }
      if (voidReason.length < 3) {
        throw new Error("Void reason must be at least 3 characters long");
      }
    }

    try {
      // Get current order
      const { data: order, error } = await Order.findByIdForUser(
        userId,
        orderId,
      );

      if (error || !order) {
        throw new Error("Order not found");
      }

      // Access already validated through store scope (findByIdForUser)

      // Save old status
      const oldStatus = order.status;
      if (String(oldStatus || "") === String(newStatus || "")) {
        return {
          success: true,
          localUpdate: false,
          shopifySync: "not_needed",
        };
      }

      // Update order
      const { supabase } = await import("../supabaseClient.js");
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: newStatus,
          pending_sync: true,
          local_updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (updateError) {
        throw updateError;
      }

      // Log operation
      await this.logSyncOperation(userId, orderId, "order_status_update", {
        old_status: oldStatus,
        new_status: newStatus,
        void_reason: newStatus === "voided" ? voidReason : null,
      });

      try {
        await this.syncStatusToShopify(userId, orderId, newStatus, {
          voidReason,
        });
      } catch (syncError) {
        await supabase
          .from("orders")
          .update({
            status: oldStatus,
            pending_sync: false,
            sync_error: syncError.message,
            local_updated_at: new Date().toISOString(),
          })
          .eq("id", orderId);

        throw new Error(
          `Shopify sync failed. Status rolled back: ${syncError.message}`,
        );
      }

      if (newStatus === "voided") {
        try {
          await this.recordVoidReasonComment(userId, orderId, voidReason);
        } catch (commentError) {
          console.error("Void reason comment error:", commentError);
        }
      }

      return {
        success: true,
        localUpdate: true,
        shopifySync: "synced",
      };
    } catch (error) {
      console.error("Update order status error:", error);
      throw error;
    }
  }

  /**
   * Sync note to Shopify
   */
  static async syncNoteToShopify(userId, orderId, note) {
    try {
      const { data: order } = await Order.findByIdForUser(userId, orderId);
      if (!order || !order.shopify_id) {
        throw new Error("Order not found or missing Shopify ID");
      }

      const tokenData = await getShopifyTokenForStore(order.store_id, userId);

      if (!tokenData) {
        throw new Error("Shopify not connected");
      }

      const noteContent = String(note?.content || "").replace(/\s+/g, " ").trim();
      const noteAuthor = String(note?.author || "User").replace(/\s+/g, " ").trim();
      const noteLine = `[Moon Profit] Note by "${noteAuthor}" at ${new Date().toISOString()}: ${noteContent}`;

      const responseData = await updateShopifyOrderNote({
        tokenData,
        order,
        logLine: noteLine,
      });

      // Update note sync status
      let notes = [];
      if (order.notes) {
        if (typeof order.notes === "string") {
          notes = JSON.parse(order.notes);
        } else if (Array.isArray(order.notes)) {
          notes = order.notes;
        }
      }

      // Find and update the note
      const noteIndex = notes.findIndex(
        (n) => n.created_at === note.created_at && n.content === note.content,
      );
      if (noteIndex !== -1) {
        notes[noteIndex].synced_to_shopify = true;
      }

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          notes: JSON.stringify(notes),
          pending_sync: false,
          last_synced_at: new Date().toISOString(),
          shopify_updated_at:
            responseData?.order?.updated_at ||
            responseData?.updated_at ||
            new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(userId, orderId, "success", responseData);

      return { success: true };
    } catch (error) {
      console.error("Shopify note sync error:", error);
      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          pending_sync: false,
          sync_error: error.message,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(
        userId,
        orderId,
        "failed",
        null,
        error.message,
      );
      throw error;
    }
  }

  static async syncPaymentMethodToShopify(
    userId,
    orderId,
    nextMethod,
    options = {},
  ) {
    try {
      const { data: order } = await Order.findByIdForUser(userId, orderId);
      if (!order || !order.shopify_id) {
        throw new Error("Order not found or missing Shopify ID");
      }

      const tokenData = await getShopifyTokenForStore(order.store_id, userId);
      if (!tokenData) {
        throw new Error("Shopify not connected");
      }

      const orderData = parseOrderData(order);
      const previousMethod = String(options?.previousMethod || "none")
        .toLowerCase()
        .trim();
      const methodValue = normalizePaymentMethod(nextMethod);
      if (!methodValue) {
        throw new Error("Invalid payment method");
      }
      const statusForMirror =
        normalizeOrderStatus(order.status) ||
        extractStatusFromOrderData(orderData) ||
        normalizeOrderStatus(orderData?.financial_status);
      const paymentMethodLine = `[Moon Profit] Payment method changed from "${previousMethod}" to "${methodValue}" at ${new Date().toISOString()}`;

      const responseData = await syncOrderMetadataToShopify({
        tokenData,
        order,
        logLine: paymentMethodLine,
        status: statusForMirror,
        paymentMethod: methodValue,
      });

      const responseOrderPayload = getShopifyOrderPayload(responseData);
      const nextOrderData = preserveOrderLocalMetadata(
        applyMoonProfitControlValuesToOrderData(responseOrderPayload || orderData, {
          status: statusForMirror,
          paymentMethod: methodValue,
        }),
        order.data,
      );

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          data: nextOrderData,
          pending_sync: false,
          last_synced_at: new Date().toISOString(),
          shopify_updated_at:
            responseData?.order?.updated_at ||
            responseData?.updated_at ||
            new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(userId, orderId, "success", responseData);
      return { success: true };
    } catch (error) {
      console.error("Shopify payment method sync error:", error);

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          pending_sync: false,
          sync_error: error.message,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(
        userId,
        orderId,
        "failed",
        null,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Sync status to Shopify
   */
  static async syncStatusToShopify(userId, orderId, newStatus, options = {}) {
    try {
      const { data: order } = await Order.findByIdForUser(userId, orderId);
      if (!order || !order.shopify_id) {
        throw new Error("Order not found or missing Shopify ID");
      }

      const tokenData = await getShopifyTokenForStore(order.store_id, userId);

      if (!tokenData) {
        throw new Error("Shopify not connected");
      }

      const normalizedStatus = normalizeOrderStatus(newStatus);
      if (!normalizedStatus) {
        throw new Error("Invalid status");
      }

      if (normalizedStatus === "partially_paid") {
        throw new Error(
          "Partial payment needs an exact amount and is not supported from this screen yet",
        );
      }

      if (normalizedStatus === "partially_refunded") {
        throw new Error(
          "Partial refund needs an exact amount and is not supported from this screen yet",
        );
      }

      if (normalizedStatus === "pending") {
        throw new Error(
          "Moving an order back to pending is not supported by Shopify from this screen",
        );
      }

      const orderData = parseOrderData(order);
      const paymentMethodForMirror = extractPaymentMethodFromOrderData(orderData);
      const statusLogLine = `[Moon Profit] Status changed to "${normalizedStatus}" at ${new Date().toISOString()}${options?.voidReason ? ` (Reason: ${options.voidReason})` : ""}`;

      let responseData = null;
      if (normalizedStatus === "voided") {
        const cancelResponse = await axios.post(
          `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/orders/${order.shopify_id}/cancel.json`,
          {
            reason: "other",
            email: false,
          },
          { headers: buildShopifyHeaders(tokenData.access_token) },
        );
        responseData = cancelResponse.data;

        try {
          const metadataSyncResponse = await syncOrderMetadataToShopify({
            tokenData,
            order,
            logLine: statusLogLine,
            status: normalizedStatus,
            paymentMethod: paymentMethodForMirror,
            voidReason: options?.voidReason,
          });
          if (metadataSyncResponse) {
            responseData = metadataSyncResponse;
          }
        } catch (metadataSyncError) {
          console.warn(
            "Status metadata sync warning after cancel:",
            metadataSyncError?.message || metadataSyncError,
          );
        }
      } else if (normalizedStatus === "paid") {
        const outstandingAmount = getOrderOutstandingAmount(order, orderData);
        if (outstandingAmount <= 0) {
          responseData = await syncOrderMetadataToShopify({
            tokenData,
            order,
            logLine: statusLogLine,
            status: normalizedStatus,
            paymentMethod: paymentMethodForMirror,
          });
        } else {
          const transactions = await fetchShopifyOrderTransactions({
            tokenData,
            order,
          });
          const authorizationTransaction = [...transactions]
            .filter((transaction) => {
              const kind = String(transaction?.kind || "")
                .toLowerCase()
                .trim();
              return kind === "authorization";
            })
            .sort(
              (a, b) =>
                new Date(b?.processed_at || b?.created_at || 0).getTime() -
                new Date(a?.processed_at || a?.created_at || 0).getTime(),
            )[0];

          if (authorizationTransaction?.id) {
            await createShopifyOrderTransaction({
              tokenData,
              order,
              transaction: {
                kind: "capture",
                parent_id: authorizationTransaction.id,
                amount: toMoneyString(outstandingAmount),
                currency: getOrderCurrency(order, orderData),
              },
            });
          } else {
            const preferredGateway = String(
              orderData?.payment_gateway_names?.[0] || "manual",
            ).trim();
            await createShopifyOrderTransaction({
              tokenData,
              order,
              transaction: {
                kind: "sale",
                amount: toMoneyString(outstandingAmount),
                currency: getOrderCurrency(order, orderData),
                gateway: preferredGateway,
                source: "external",
              },
            });
          }

          responseData = await syncOrderMetadataToShopify({
            tokenData,
            order,
            logLine: statusLogLine,
            status: normalizedStatus,
            paymentMethod: paymentMethodForMirror,
          });
        }
      } else if (normalizedStatus === "authorized") {
        const outstandingAmount = getOrderOutstandingAmount(order, orderData);
        if (outstandingAmount <= 0) {
          throw new Error("This order does not have any outstanding amount to authorize");
        }

        const preferredGateway = String(
          orderData?.payment_gateway_names?.[0] || "manual",
        ).trim();
        await createShopifyOrderTransaction({
          tokenData,
          order,
          transaction: {
            kind: "authorization",
            amount: toMoneyString(outstandingAmount),
            currency: getOrderCurrency(order, orderData),
            gateway: preferredGateway,
            source: "external",
          },
        });

        responseData = await syncOrderMetadataToShopify({
          tokenData,
          order,
          logLine: statusLogLine,
          status: normalizedStatus,
          paymentMethod: paymentMethodForMirror,
        });
      } else if (normalizedStatus === "refunded") {
        const refundableAmount = getRefundableAmount(order, orderData);
        if (refundableAmount <= 0) {
          throw new Error("This order does not have any refundable amount left");
        }

        const transactions = await fetchShopifyOrderTransactions({
          tokenData,
          order,
        });
        const referenceTransaction = pickReferenceTransaction(transactions);
        if (!referenceTransaction?.id) {
          throw new Error("No captured or sale transaction was found to refund");
        }

        await createShopifyOrderTransaction({
          tokenData,
          order,
          transaction: {
            kind: "refund",
            parent_id: referenceTransaction.id,
            amount: toMoneyString(refundableAmount),
            currency: getOrderCurrency(order, orderData),
            gateway: String(referenceTransaction.gateway || "").trim() || undefined,
          },
        });

        responseData = await syncOrderMetadataToShopify({
          tokenData,
          order,
          logLine: statusLogLine,
          status: normalizedStatus,
          paymentMethod: paymentMethodForMirror,
        });
      } else {
        responseData = await syncOrderMetadataToShopify({
          tokenData,
          order,
          logLine: statusLogLine,
          status: normalizedStatus,
          paymentMethod: paymentMethodForMirror,
        });
      }

      let responseOrderPayload = getShopifyOrderPayload(responseData);
      if (!responseOrderPayload) {
        responseOrderPayload = await fetchShopifyOrderById({ tokenData, order });
      }

      const resolvedStatus =
        normalizeOrderStatus(responseOrderPayload?.financial_status) ||
        extractStatusFromOrderData(responseOrderPayload) ||
        normalizedStatus;
      const nextOrderData = preserveOrderLocalMetadata(
        applyMoonProfitControlValuesToOrderData(responseOrderPayload || orderData, {
          status: resolvedStatus,
          paymentMethod: paymentMethodForMirror,
          voidReason: options?.voidReason,
        }),
        order.data,
      );

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          status: resolvedStatus,
          data: nextOrderData,
          pending_sync: false,
          last_synced_at: new Date().toISOString(),
          shopify_updated_at:
            responseData?.order?.updated_at ||
            responseData?.updated_at ||
            new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(userId, orderId, "success", responseData);

      return { success: true };
    } catch (error) {
      console.error("Shopify status sync error:", error);

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          pending_sync: false,
          sync_error: error.message,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(
        userId,
        orderId,
        "failed",
        null,
        error.message,
      );

      throw error;
    }
  }

  static async updateOrderFulfillment(
    userId,
    orderId,
    requestedStatus,
    options = {},
  ) {
    try {
      const { data: order } = await Order.findByIdForUser(userId, orderId);
      if (!order || !order.shopify_id) {
        throw new Error("Order not found or missing Shopify ID");
      }

      const tokenData = await getShopifyTokenForStore(order.store_id, userId);
      if (!tokenData) {
        throw new Error("Shopify not connected");
      }

      const normalizedRequestedStatus = normalizeFulfillmentStatus(
        requestedStatus,
      );
      if (!VALID_FULFILLMENT_ACTIONS.has(normalizedRequestedStatus)) {
        throw new Error("Invalid fulfillment status");
      }

      const currentFulfillmentStatus = getOrderFulfillmentStatus(order);
      if (normalizedRequestedStatus === currentFulfillmentStatus) {
        return {
          success: true,
          fulfillment_status: currentFulfillmentStatus,
        };
      }

      const selectedLineItems = Array.isArray(options?.lineItems)
        ? options.lineItems
        : [];

      await this.logSyncOperation(userId, orderId, "update_fulfillment_status", {
        fulfillment_status: normalizedRequestedStatus,
        line_items: selectedLineItems,
      });

      let responseData = null;

      if (normalizedRequestedStatus === "fulfilled") {
        const requestedQuantitiesByLineItemId = buildRequestedLineItemQuantities(
          buildOrderFulfillableQuantityByLineItemId(order),
          selectedLineItems,
          "fulfillable",
        );
        const fulfillmentOrders = await fetchShopifyFulfillmentOrders({
          tokenData,
          order,
        });

        const remainingRequestedQuantities = requestedQuantitiesByLineItemId
          ? new Map(requestedQuantitiesByLineItemId)
          : null;
        const lineItemsByFulfillmentOrder = fulfillmentOrders
          .map((fulfillmentOrder) => {
            const lineItems = Array.isArray(fulfillmentOrder?.line_items)
              ? fulfillmentOrder.line_items
              : [];
            const fulfillmentOrderLineItems = lineItems
              .map((item) => {
                const remainingQuantity = parseInt(
                  item?.remaining_quantity ??
                    item?.fulfillable_quantity ??
                    item?.quantity ??
                    0,
                  10,
                );

                if (!Number.isFinite(remainingQuantity) || remainingQuantity <= 0) {
                  return null;
                }

                const lineItemId = getLineItemId(item);
                if (remainingRequestedQuantities) {
                  const requestedQuantity = parsePositiveQuantity(
                    remainingRequestedQuantities.get(lineItemId),
                  );
                  if (requestedQuantity <= 0) {
                    return null;
                  }

                  const quantityToFulfill = Math.min(
                    remainingQuantity,
                    requestedQuantity,
                  );
                  remainingRequestedQuantities.set(
                    lineItemId,
                    Math.max(0, requestedQuantity - quantityToFulfill),
                  );

                  return {
                    id: item.id,
                    quantity: quantityToFulfill,
                  };
                }

                return {
                  id: item.id,
                  quantity: remainingQuantity,
                };
              })
              .filter(Boolean);

            if (fulfillmentOrderLineItems.length === 0) {
              return null;
            }

            return {
              fulfillment_order_id: fulfillmentOrder.id,
              fulfillment_order_line_items: fulfillmentOrderLineItems,
            };
          })
          .filter(Boolean);

        if (lineItemsByFulfillmentOrder.length === 0) {
          const remainingQuantity = getFulfillableQuantity(order);
          if (remainingQuantity <= 0) {
            throw new Error("This order has no fulfillable items left on Shopify");
          }
          throw new Error(
            "Shopify did not return any open fulfillment orders for this order",
          );
        }

        const unresolvedLineItemIds = getRemainingRequestedLineItemIds(
          remainingRequestedQuantities,
        );
        if (unresolvedLineItemIds.length > 0) {
          throw new Error(
            `Some selected items cannot be fulfilled from Shopify right now: ${unresolvedLineItemIds.join(", ")}`,
          );
        }

        responseData = await createShopifyFulfillment({
          tokenData,
          order,
          fulfillment: {
            notify_customer: false,
            line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
          },
        });
      }

      if (normalizedRequestedStatus === "unfulfilled") {
        const fulfillments = getOrderFulfillments(order).filter(
          (fulfillment) => fulfillment?.id,
        );

        if (fulfillments.length === 0) {
          throw new Error("This order does not have any Shopify fulfillment to cancel");
        }

        const requestedQuantitiesByLineItemId = buildRequestedLineItemQuantities(
          buildOrderFulfilledQuantityByLineItemId(order),
          selectedLineItems,
          "fulfilled",
        );
        let fulfillmentsToCancel = fulfillments;

        if (requestedQuantitiesByLineItemId) {
          const remainingRequestedQuantities = new Map(requestedQuantitiesByLineItemId);

          fulfillmentsToCancel = fulfillments.filter((fulfillment) => {
            const lineItems = Array.isArray(fulfillment?.line_items)
              ? fulfillment.line_items
              : [];

            if (lineItems.length === 0) {
              return false;
            }

            const normalizedLineItems = lineItems
              .map((lineItem) => ({
                lineItemId: getLineItemId(lineItem),
                quantity: parsePositiveQuantity(lineItem?.quantity),
              }))
              .filter(
                (lineItem) =>
                  lineItem.lineItemId && lineItem.quantity > 0,
              );

            if (normalizedLineItems.length === 0) {
              return false;
            }

            const canCancelFulfillment = normalizedLineItems.every(
              ({ lineItemId, quantity }) =>
                parsePositiveQuantity(remainingRequestedQuantities.get(lineItemId)) >=
                quantity,
            );

            if (!canCancelFulfillment) {
              return false;
            }

            for (const { lineItemId, quantity } of normalizedLineItems) {
              remainingRequestedQuantities.set(
                lineItemId,
                Math.max(
                  0,
                  parsePositiveQuantity(
                    remainingRequestedQuantities.get(lineItemId),
                  ) - quantity,
                ),
              );
            }

            return true;
          });

          const unresolvedLineItemIds = getRemainingRequestedLineItemIds(
            remainingRequestedQuantities,
          );
          if (
            fulfillmentsToCancel.length === 0 ||
            unresolvedLineItemIds.length > 0
          ) {
            throw new Error(
              "Selected items cannot be restocked separately because they are grouped with other items in existing Shopify fulfillments",
            );
          }
        }

        responseData = [];
        for (const fulfillment of fulfillmentsToCancel) {
          const cancellationResult = await cancelShopifyFulfillment({
            tokenData,
            fulfillmentId: fulfillment.id,
          });
          responseData.push(cancellationResult);
        }
      }

      const refreshedOrderPayload = await fetchShopifyOrderById({
        tokenData,
        order,
      });
      const resolvedFulfillmentStatus = normalizeFulfillmentStatus(
        refreshedOrderPayload?.fulfillment_status || currentFulfillmentStatus,
      );

      const nextOrderData = preserveOrderLocalMetadata(
        refreshedOrderPayload,
        order.data,
      );
      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          fulfillment_status: refreshedOrderPayload?.fulfillment_status || null,
          data: nextOrderData,
          pending_sync: false,
          last_synced_at: new Date().toISOString(),
          shopify_updated_at:
            refreshedOrderPayload?.updated_at || new Date().toISOString(),
          sync_error: null,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(userId, orderId, "success", responseData);

      return {
        success: true,
        fulfillment_status: resolvedFulfillmentStatus,
        order: {
          ...order,
          fulfillment_status: refreshedOrderPayload?.fulfillment_status || null,
          data: nextOrderData,
        },
      };
    } catch (error) {
      console.error("Shopify fulfillment sync error:", error);

      const { supabase } = await import("../supabaseClient.js");
      await supabase
        .from("orders")
        .update({
          pending_sync: false,
          sync_error: error.message,
        })
        .eq("id", orderId);

      await this.updateSyncOperationStatus(
        userId,
        orderId,
        "failed",
        null,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Log sync operation
   */
  static async logSyncOperation(userId, entityId, operationType, requestData) {
    try {
      const { supabase } = await import("../supabaseClient.js");
      await supabase.from("sync_operations").insert([
        {
          user_id: userId,
          operation_type: operationType,
          entity_type: "order",
          entity_id: entityId,
          direction: "to_shopify",
          status: "pending",
          request_data: requestData,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error("Failed to log sync operation:", error);
    }
  }

  /**
   * Update sync operation status
   */
  static async updateSyncOperationStatus(
    userId,
    entityId,
    status,
    responseData = null,
    errorMessage = null,
  ) {
    try {
      const { supabase } = await import("../supabaseClient.js");

      // Find the most recent pending operation
      const { data: operations } = await supabase
        .from("sync_operations")
        .select("*")
        .eq("user_id", userId)
        .eq("entity_id", entityId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);

      if (operations && operations.length > 0) {
        await supabase
          .from("sync_operations")
          .update({
            status,
            response_data: responseData,
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", operations[0].id);
      }
    } catch (error) {
      console.error("Failed to update sync operation status:", error);
    }
  }
}
