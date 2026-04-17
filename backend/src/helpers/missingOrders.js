import {
  getOrderFinancialStatus,
  getOrderFulfillmentStatus,
  isCancelledOrder,
} from "./orderAnalytics.js";
import { getOrderLineItems } from "./orderExport.js";
import { normalizeWarehouseCode } from "./warehouseCatalog.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MISSING_ORDER_GRACE_MS = 3 * DAY_MS;
export const MISSING_ORDER_ESCALATION_MS = 6 * DAY_MS;
export const MISSING_ORDER_REASON_STOCK_SHORTAGE =
  "warehouse_stock_shortage";
export const MISSING_ORDER_REASON_NO_ACTION = "in_stock_without_action";

const normalizeText = (value) => String(value || "").trim();

const normalizeId = (value) => normalizeText(value);

const normalizeSku = (value) => normalizeWarehouseCode(value);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseTimestampValue = (value) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeVariantTitle = (value) => {
  const normalized = normalizeText(value);
  if (!normalized || normalized.toLowerCase() === "default title") {
    return "";
  }

  return normalized;
};

const buildDemandDisplayTitle = (item) => {
  const title = normalizeText(
    item?.title || item?.product_title || item?.name || item?.sku || "Unknown product",
  );
  const variantTitle = normalizeVariantTitle(
    item?.variant_title || item?.variant_name,
  );

  return variantTitle ? `${title} / ${variantTitle}` : title;
};

export const getOutstandingLineItemQuantity = (item) => {
  const orderedQuantity = Math.max(0, toNumber(item?.quantity));
  if (orderedQuantity <= 0) {
    return 0;
  }

  const explicitRemainingQuantity = Math.max(
    0,
    toNumber(item?.remaining_quantity),
    toNumber(item?.fulfillable_quantity),
  );
  if (explicitRemainingQuantity > 0) {
    return explicitRemainingQuantity;
  }

  const fulfillmentStatus = String(item?.fulfillment_status || "")
    .toLowerCase()
    .trim();
  if (fulfillmentStatus === "fulfilled") {
    return 0;
  }

  const currentQuantity = Math.max(0, toNumber(item?.current_quantity));
  if (currentQuantity > 0) {
    const fulfilledQuantity = Math.max(0, toNumber(item?.fulfilled_quantity));
    return Math.max(0, currentQuantity - fulfilledQuantity) || currentQuantity;
  }

  const fulfilledQuantity = Math.max(0, toNumber(item?.fulfilled_quantity));
  if (fulfilledQuantity > 0) {
    return Math.max(0, orderedQuantity - fulfilledQuantity);
  }

  return orderedQuantity;
};

export const isOrderOperationallyHandled = (order) => {
  const financialStatus = getOrderFinancialStatus(order);
  const fulfillmentStatus = getOrderFulfillmentStatus(order);

  return (
    isCancelledOrder(order) ||
    fulfillmentStatus === "fulfilled" ||
    financialStatus === "refunded" ||
    financialStatus === "voided" ||
    financialStatus === "cancelled"
  );
};

const buildOutstandingDemandLines = (order) =>
  getOrderLineItems(order)
    .map((item) => {
      const requiredQuantity = getOutstandingLineItemQuantity(item);
      if (requiredQuantity <= 0) {
        return null;
      }

      return {
        line_item_id: normalizeId(item?.id || item?.line_item_id),
        product_shopify_id: normalizeId(item?.product_id),
        variant_id: normalizeId(item?.variant_id),
        sku: normalizeSku(item?.sku),
        title: normalizeText(
          item?.title || item?.product_title || item?.name || "Unknown product",
        ),
        variant_title: normalizeVariantTitle(
          item?.variant_title || item?.variant_name,
        ),
        display_title: buildDemandDisplayTitle(item),
        required_quantity: requiredQuantity,
      };
    })
    .filter(Boolean);

const buildWarehouseAvailabilityIndex = (rows = []) => {
  const slots = [];
  const byVariantId = new Map();
  const bySku = new Map();
  const byProductShopifyId = new Map();

  for (const row of rows || []) {
    const slot = {
      key:
        normalizeId(row?.key) ||
        normalizeId(row?.variant_id) ||
        normalizeSku(row?.warehouse_code || row?.sku),
      store_id: normalizeId(row?.store_id),
      variant_id: normalizeId(row?.variant_id),
      product_shopify_id: normalizeId(row?.shopify_id),
      sku: normalizeSku(row?.sku || row?.warehouse_code),
      warehouse_code: normalizeSku(row?.warehouse_code || row?.sku),
      display_title: normalizeText(
        row?.display_title || row?.product_title || row?.title || row?.sku,
      ),
      available_quantity: Math.max(0, toNumber(row?.warehouse_quantity)),
    };

    slots.push(slot);

    if (slot.variant_id && !byVariantId.has(slot.variant_id)) {
      byVariantId.set(slot.variant_id, slot);
    }

    if (slot.sku) {
      const existingSkuRows = bySku.get(slot.sku) || [];
      existingSkuRows.push(slot);
      bySku.set(slot.sku, existingSkuRows);
    }

    if (slot.product_shopify_id) {
      const existingProductRows = byProductShopifyId.get(slot.product_shopify_id) || [];
      existingProductRows.push(slot);
      byProductShopifyId.set(slot.product_shopify_id, existingProductRows);
    }
  }

  return {
    slots,
    byVariantId,
    bySku,
    byProductShopifyId,
  };
};

const resolveWarehouseSlotForDemand = (demand, availabilityIndex) => {
  if (demand?.variant_id && availabilityIndex.byVariantId.has(demand.variant_id)) {
    return {
      slot: availabilityIndex.byVariantId.get(demand.variant_id),
      matched_by: "variant_id",
    };
  }

  if (demand?.sku) {
    const skuMatches = availabilityIndex.bySku.get(demand.sku) || [];
    if (skuMatches.length === 1) {
      return {
        slot: skuMatches[0],
        matched_by: "sku",
      };
    }
  }

  if (demand?.product_shopify_id) {
    const productMatches =
      availabilityIndex.byProductShopifyId.get(demand.product_shopify_id) || [];
    if (productMatches.length === 1) {
      return {
        slot: productMatches[0],
        matched_by: "product_id",
      };
    }
  }

  return {
    slot: null,
    matched_by: null,
  };
};

const compareOrdersForAllocation = (left, right) => {
  const timestampGap =
    parseTimestampValue(left?.created_at) - parseTimestampValue(right?.created_at);
  if (timestampGap !== 0) {
    return timestampGap;
  }

  const orderNumberGap = toNumber(left?.order_number) - toNumber(right?.order_number);
  if (orderNumberGap !== 0) {
    return orderNumberGap;
  }

  return normalizeId(left?.id).localeCompare(normalizeId(right?.id));
};

const buildShortagePreview = (shortageLines = []) =>
  shortageLines
    .slice(0, 2)
    .map((line) => line?.display_title)
    .filter(Boolean)
    .join(", ");

const getMissingReasonRank = (order) => {
  if (order?.missing_reason === MISSING_ORDER_REASON_STOCK_SHORTAGE) {
    return 0;
  }

  if (order?.missing_reason === MISSING_ORDER_REASON_NO_ACTION) {
    return 1;
  }

  return 2;
};

const resolveLatestActionTimestamp = (order, actionTimestampByOrderKey) => {
  const orderId = normalizeId(order?.id);
  const shopifyOrderId = normalizeId(order?.shopify_id);

  return Math.max(
    orderId ? toNumber(actionTimestampByOrderKey.get(orderId)) : 0,
    shopifyOrderId ? toNumber(actionTimestampByOrderKey.get(shopifyOrderId)) : 0,
  );
};

export const sortMissingOrders = (orders = []) =>
  [...(orders || [])].sort((left, right) => {
    const leftRank = left?.missing_state === "escalated" ? 0 : 1;
    const rightRank = right?.missing_state === "escalated" ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftReasonRank = getMissingReasonRank(left);
    const rightReasonRank = getMissingReasonRank(right);
    if (leftReasonRank !== rightReasonRank) {
      return leftReasonRank - rightReasonRank;
    }

    const dayGap =
      toNumber(right?.days_without_stock || right?.days_without_action) -
      toNumber(left?.days_without_stock || left?.days_without_action);
    if (dayGap !== 0) {
      return dayGap;
    }

    return parseTimestampValue(left?.created_at) - parseTimestampValue(right?.created_at);
  });

export const buildMissingOrdersFromStock = ({
  orders = [],
  warehouseRowsByStoreId = new Map(),
  orderActionTimestampsByKey = new Map(),
  buildOrderListItem = (order) => ({ ...order }),
  nowTimestamp = Date.now(),
} = {}) => {
  const rawOrders = Array.isArray(orders) ? orders : [];
  const rowsByStoreMap =
    warehouseRowsByStoreId instanceof Map
      ? warehouseRowsByStoreId
      : new Map(Object.entries(warehouseRowsByStoreId || {}));
  const actionTimestampByOrderKey =
    orderActionTimestampsByKey instanceof Map
      ? orderActionTimestampsByKey
      : new Map(Object.entries(orderActionTimestampsByKey || {}));
  const availabilityByStoreId = new Map();

  for (const [storeId, rows] of rowsByStoreMap.entries()) {
    availabilityByStoreId.set(
      normalizeId(storeId),
      buildWarehouseAvailabilityIndex(rows),
    );
  }

  const emptyAvailability = buildWarehouseAvailabilityIndex([]);
  const missingOrders = [];
  const sortedOrders = [...rawOrders].sort(compareOrdersForAllocation);

  for (const order of sortedOrders) {
    if (!order || isOrderOperationallyHandled(order)) {
      continue;
    }

    const outstandingDemandLines = buildOutstandingDemandLines(order);
    if (outstandingDemandLines.length === 0) {
      continue;
    }

    const createdTimestamp = parseTimestampValue(order?.created_at);
    if (createdTimestamp <= 0) {
      continue;
    }

    const storeId = normalizeId(order?.store_id);
    const availabilityIndex =
      availabilityByStoreId.get(storeId) || emptyAvailability;

    let requiredQuantity = 0;
    let reservedQuantity = 0;
    let shortageQuantity = 0;
    const shortageLines = [];

    for (const demandLine of outstandingDemandLines) {
      requiredQuantity += demandLine.required_quantity;

      const { slot, matched_by: matchedBy } = resolveWarehouseSlotForDemand(
        demandLine,
        availabilityIndex,
      );

      const availableBefore = slot ? Math.max(0, toNumber(slot.available_quantity)) : 0;
      const reservedLineQuantity = Math.min(
        availableBefore,
        demandLine.required_quantity,
      );
      const missingLineQuantity = Math.max(
        0,
        demandLine.required_quantity - reservedLineQuantity,
      );

      if (slot) {
        slot.available_quantity = Math.max(0, availableBefore - reservedLineQuantity);
      }

      reservedQuantity += reservedLineQuantity;
      shortageQuantity += missingLineQuantity;

      if (missingLineQuantity > 0) {
        shortageLines.push({
          ...demandLine,
          requested_quantity: demandLine.required_quantity,
          reserved_quantity: reservedLineQuantity,
          missing_quantity: missingLineQuantity,
          warehouse_available_before: availableBefore,
          warehouse_available_after: slot ? slot.available_quantity : 0,
          warehouse_code: slot?.warehouse_code || demandLine.sku || "",
          matched_by: matchedBy,
        });
      }
    }

    const elapsedMs = nowTimestamp - createdTimestamp;
    if (elapsedMs < MISSING_ORDER_GRACE_MS) {
      continue;
    }

    const isEscalated = elapsedMs >= MISSING_ORDER_ESCALATION_MS;
    const missingSince = new Date(
      createdTimestamp + MISSING_ORDER_GRACE_MS,
    ).toISOString();
    const escalatedSince = isEscalated
      ? new Date(createdTimestamp + MISSING_ORDER_ESCALATION_MS).toISOString()
      : null;
    const orderAgeDays = Math.max(0, Math.floor(elapsedMs / DAY_MS));
    const latestActionAtTimestamp = resolveLatestActionTimestamp(
      order,
      actionTimestampByOrderKey,
    );

    if (shortageQuantity > 0) {
      const daysWithoutStock = Math.max(3, Math.floor(elapsedMs / DAY_MS));

      missingOrders.push({
        ...buildOrderListItem(order),
        missing_reason: MISSING_ORDER_REASON_STOCK_SHORTAGE,
        missing_state: isEscalated ? "escalated" : "missing",
        missing_since: missingSince,
        escalated_since: escalatedSince,
        requires_attention: true,
        days_without_stock: daysWithoutStock,
        days_without_action: daysWithoutStock,
        order_age_days: orderAgeDays,
        latest_action_at:
          latestActionAtTimestamp > 0
            ? new Date(latestActionAtTimestamp).toISOString()
            : null,
        warehouse_coverable: false,
        warehouse_required_quantity: requiredQuantity,
        warehouse_reserved_quantity: reservedQuantity,
        warehouse_shortage_quantity: shortageQuantity,
        warehouse_shortage_items_count: shortageLines.length,
        warehouse_shortage_preview: buildShortagePreview(shortageLines),
        warehouse_shortage_lines: shortageLines,
      });
      continue;
    }

    const hasRecordedAction =
      latestActionAtTimestamp > 0 && latestActionAtTimestamp >= createdTimestamp;
    if (hasRecordedAction) {
      continue;
    }

    const daysWithoutAction = Math.max(3, Math.floor(elapsedMs / DAY_MS));

    missingOrders.push({
      ...buildOrderListItem(order),
      missing_reason: MISSING_ORDER_REASON_NO_ACTION,
      missing_state: isEscalated ? "escalated" : "missing",
      missing_since: missingSince,
      escalated_since: escalatedSince,
      requires_attention: true,
      days_without_stock: 0,
      days_without_action: daysWithoutAction,
      order_age_days: orderAgeDays,
      latest_action_at: null,
      warehouse_coverable: true,
      warehouse_required_quantity: requiredQuantity,
      warehouse_reserved_quantity: requiredQuantity,
      warehouse_shortage_quantity: 0,
      warehouse_shortage_items_count: 0,
      warehouse_shortage_preview: "",
      warehouse_shortage_lines: [],
    });
  }

  return sortMissingOrders(missingOrders);
};
