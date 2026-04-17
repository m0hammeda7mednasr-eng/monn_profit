const PAID_LIKE_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
]);

const CANCELLED_STATUSES = new Set(["voided", "cancelled"]);
const MOON_PROFIT_STATUS_TAG_PREFIXES = ["moon_profit_status:"];
const MOON_PROFIT_STATUS_NOTE_ATTRIBUTE_NAMES = ["moon_profit_status", "status"];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getMoneyAmount = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "object") {
    return Math.max(
      toNumber(value?.amount),
      toNumber(value?.shop_money?.amount),
      toNumber(value?.presentment_money?.amount),
    );
  }

  return toNumber(value);
};

const getMaxMoneyAmount = (...values) =>
  values.reduce((max, value) => Math.max(max, getMoneyAmount(value)), 0);

export const parseOrderData = (order) => {
  if (!order) {
    return {};
  }

  if (typeof order.data === "string") {
    try {
      return JSON.parse(order.data);
    } catch {
      return {};
    }
  }

  return order.data || {};
};

export const parseTagList = (tagsValue) => {
  if (Array.isArray(tagsValue)) {
    return tagsValue.map((tag) => String(tag || "").trim()).filter(Boolean);
  }

  return String(tagsValue || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

export const extractTagValueByPrefixes = (tags, prefixes = []) => {
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

export const getNoteAttributeValue = (data, keys = []) => {
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

export const resolveOrderStatusFromData = (data = {}) => {
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
    extractTagValueByPrefixes(parseTagList(data?.tags), MOON_PROFIT_STATUS_TAG_PREFIXES),
  )
    .toLowerCase()
    .trim();
};

export const getOrderFinancialStatus = (order) => {
  const data = parseOrderData(order);
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

export const getOrderFulfillmentStatus = (order) => {
  const data = parseOrderData(order);
  return String(order?.fulfillment_status || data?.fulfillment_status || "")
    .toLowerCase()
    .trim();
};

export const getOrderGrossAmount = (order) => {
  const data = parseOrderData(order);
  return getMaxMoneyAmount(
    order?.total_price,
    order?.total_price_set,
    data?.total_price,
    data?.total_price_set,
  );
};

export const getOrderCurrentAmount = (order) => {
  const data = parseOrderData(order);
  return getMaxMoneyAmount(
    order?.current_total_price,
    order?.current_total_price_set,
    data?.current_total_price,
    data?.current_total_price_set,
  );
};

export const getRefundedAmountFromTransactions = (order) => {
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
          transactionSum +
          getMaxMoneyAmount(transaction?.amount, transaction?.amount_set),
        0,
      )
    );
  }, 0);
};

export const getOrderRefundedAmount = (order) => {
  const financialStatus = getOrderFinancialStatus(order);
  const grossAmount = getOrderGrossAmount(order);
  const currentAmount = getOrderCurrentAmount(order);
  const data = parseOrderData(order);
  const refundedFromColumn = getMaxMoneyAmount(
    order?.total_refunded,
    order?.total_refunded_set,
    data?.total_refunded,
    data?.total_refunded_set,
  );
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

  if (financialStatus === "refunded" && refundedAmount <= 0 && grossAmount > 0) {
    refundedAmount = grossAmount;
  }

  return Math.min(grossAmount, Math.max(0, refundedAmount));
};

export const isCancelledOrder = (order) => {
  const data = parseOrderData(order);
  const financialStatus = getOrderFinancialStatus(order);

  return (
    Boolean(order?.cancelled_at) ||
    Boolean(data?.cancelled_at) ||
    CANCELLED_STATUSES.has(financialStatus)
  );
};

const getDiscountAllocationsAmount = (item) => {
  const allocations = Array.isArray(item?.discount_allocations)
    ? item.discount_allocations
    : [];

  return allocations.reduce(
    (sum, allocation) =>
      sum +
      getMaxMoneyAmount(
        allocation?.amount,
        allocation?.amount_set,
        allocation?.discounted_amount,
        allocation?.discounted_amount_set,
      ),
    0,
  );
};

const getLineItemOrderedQuantity = (item) => Math.max(0, toNumber(item?.quantity));

const getLineItemGrossTotal = (item) => {
  const quantity = getLineItemOrderedQuantity(item);
  const explicitGrossTotal = getMaxMoneyAmount(
    item?.original_total_price,
    item?.original_total_price_set,
    item?.original_line_price,
    item?.original_line_price_set,
    item?.line_price,
    item?.line_price_set,
  );
  if (explicitGrossTotal > 0) {
    return explicitGrossTotal;
  }

  const unitPrice = getMaxMoneyAmount(
    item?.original_price,
    item?.original_price_set,
    item?.price,
    item?.price_set,
  );

  return quantity > 0 ? unitPrice * quantity : 0;
};

export const getLineItemBookedAmount = (item) => {
  const quantity = getLineItemOrderedQuantity(item);
  if (quantity <= 0) {
    return 0;
  }

  const explicitBookedAmount = getMaxMoneyAmount(
    item?.discounted_total,
    item?.discounted_total_set,
    item?.discounted_total_price,
    item?.discounted_total_price_set,
    item?.final_line_price,
    item?.final_line_price_set,
  );
  if (explicitBookedAmount > 0) {
    return explicitBookedAmount;
  }

  const discountedUnitPrice = getMaxMoneyAmount(
    item?.discounted_price,
    item?.discounted_price_set,
    item?.final_price,
    item?.final_price_set,
  );
  if (discountedUnitPrice > 0) {
    return discountedUnitPrice * quantity;
  }

  const grossAmount = getLineItemGrossTotal(item);
  if (grossAmount <= 0) {
    return 0;
  }

  const discountAmount = Math.max(
    getMaxMoneyAmount(item?.total_discount, item?.total_discount_set),
    getDiscountAllocationsAmount(item),
  );

  return Math.max(0, grossAmount - discountAmount);
};

export const getLineItemBookedUnitAmount = (item) => {
  const quantity = getLineItemOrderedQuantity(item);
  if (quantity <= 0) {
    return 0;
  }

  return getLineItemBookedAmount(item) / quantity;
};

export { CANCELLED_STATUSES, PAID_LIKE_STATUSES };
