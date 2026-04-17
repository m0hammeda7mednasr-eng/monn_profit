import {
  getLineItemBookedAmount,
  getOrderFinancialStatus,
  getOrderFulfillmentStatus,
  getOrderGrossAmount,
  getOrderRefundedAmount,
  isCancelledOrder,
  parseOrderData,
} from "./orderAnalytics.js";

const RETURNED_ORDER_STATUSES = new Set(["restocked"]);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundAmount = (value) => parseFloat(toNumber(value).toFixed(2));

const normalizeKey = (value) => String(value || "").trim();

const parseLineItems = (order) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }

  if (typeof order?.line_items === "string") {
    try {
      const parsed = JSON.parse(order.line_items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const data = parseOrderData(order);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const isRestockedOrder = (order) => {
  const financialStatus = getOrderFinancialStatus(order);
  const fulfillmentStatus = getOrderFulfillmentStatus(order);

  return (
    RETURNED_ORDER_STATUSES.has(financialStatus) ||
    RETURNED_ORDER_STATUSES.has(fulfillmentStatus)
  );
};

const getOrderBookedGrossAmount = (order) => {
  if (isCancelledOrder(order) || isRestockedOrder(order)) {
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

const buildRefundDetails = (order) => {
  const data = parseOrderData(order);
  const refunds = Array.isArray(data?.refunds) ? data.refunds : [];
  const quantityByLineItemId = new Map();

  for (const refund of refunds) {
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
    }
  }

  return {
    quantityByLineItemId,
    isFullyRefunded:
      isRestockedOrder(order) ||
      (getOrderGrossAmount(order) > 0 &&
        getOrderRefundedAmount(order) >= getOrderGrossAmount(order)),
  };
};

const buildFulfillmentDetails = (order) => {
  const data = parseOrderData(order);
  const fulfillments = Array.isArray(data?.fulfillments) ? data.fulfillments : [];
  const quantityByLineItemId = new Map();

  for (const fulfillment of fulfillments) {
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
    }
  }

  return {
    quantityByLineItemId,
  };
};

const getItemRefundedQuantity = (item, refundDetails, order) => {
  const lineItemId = normalizeKey(item?.id || item?.line_item_id);
  const orderedQuantity = toNumber(item?.quantity);
  const explicitRefundQuantity = toNumber(
    refundDetails.quantityByLineItemId.get(lineItemId),
  );

  if (explicitRefundQuantity > 0) {
    return explicitRefundQuantity;
  }

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

  const fulfillmentStatus = getOrderFulfillmentStatus(order);
  if (fulfillmentStatus === "fulfilled" || isRestockedOrder(order)) {
    return orderedQuantity;
  }

  return 0;
};

const addSetMetric = (map, key, value) => {
  if (!key || !value) {
    return;
  }

  const current = map.get(key) || new Set();
  current.add(value);
  map.set(key, current);
};

const getLargestMappedNumber = (map, keys = []) =>
  keys.reduce(
    (largest, key) => Math.max(largest, toNumber(map.get(key))),
    0,
  );

const getLargestMappedSetSize = (map, keys = []) =>
  keys.reduce((largest, key) => {
    const value = map.get(key);
    return Math.max(largest, value instanceof Set ? value.size : 0);
  }, 0);

const getLargestReturnedOnlySetSize = (returnedMap, countedMap, keys = []) =>
  keys.reduce((largest, key) => {
    const returnedSet = returnedMap.get(key);
    if (!(returnedSet instanceof Set)) {
      return largest;
    }

    const countedSet = countedMap.get(key);
    let returnedOnlyCount = 0;
    returnedSet.forEach((orderId) => {
      if (!(countedSet instanceof Set) || !countedSet.has(orderId)) {
        returnedOnlyCount += 1;
      }
    });

    return Math.max(largest, returnedOnlyCount);
  }, 0);

export const computeNetProfitMetrics = ({
  products = [],
  orders = [],
  productCosts = [],
  limit = 50,
  offset = 0,
} = {}) => {
  const profitabilityOrders = (Array.isArray(orders) ? orders : []).filter(
    (order) => getOrderBookedNetAmount(order) > 0,
  );
  const salesByProduct = new Map();
  const countedOrderIdsByProduct = new Map();

  profitabilityOrders.forEach((order) => {
    const grossOrderAmount = getOrderBookedGrossAmount(order);
    const netOrderAmount = getOrderBookedNetAmount(order);
    const netRatio =
      grossOrderAmount > 0
        ? Math.min(1, Math.max(0, netOrderAmount / grossOrderAmount))
        : 0;
    if (netRatio <= 0) {
      return;
    }

    const orderId = normalizeKey(order?.id);
    const orderProductSet = new Set();

    parseLineItems(order).forEach((item) => {
      const qty = toNumber(item?.quantity) * netRatio;
      const unitPrice = getLineItemBookedAmount(item) / Math.max(1, toNumber(item?.quantity));
      const revenue = qty * unitPrice;
      const keys = [
        normalizeKey(item?.product_id),
        normalizeKey(item?.id || item?.line_item_id),
        normalizeKey(item?.sku),
      ].filter(Boolean);

      keys.forEach((key) => {
        const current = salesByProduct.get(key) || {
          soldQuantity: 0,
          totalRevenue: 0,
        };
        current.soldQuantity += qty;
        current.totalRevenue += revenue;
        salesByProduct.set(key, current);
        orderProductSet.add(key);
      });
    });

    orderProductSet.forEach((key) => {
      addSetMetric(countedOrderIdsByProduct, key, orderId);
    });
  });

  const returnedQuantityByProduct = new Map();
  const returnedOrderIdsByProduct = new Map();

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!isRestockedOrder(order) && getOrderRefundedAmount(order) <= 0) {
      return;
    }

    const refundDetails = buildRefundDetails(order);
    const fulfillmentDetails = buildFulfillmentDetails(order);
    const orderId = normalizeKey(order?.id);

    parseLineItems(order).forEach((item) => {
      const orderedQuantity = toNumber(item?.quantity);
      if (orderedQuantity <= 0) {
        return;
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

      if (returnedQuantity <= 0) {
        return;
      }

      const keys = [
        normalizeKey(item?.product_id),
        normalizeKey(item?.id || item?.line_item_id),
        normalizeKey(item?.sku),
      ].filter(Boolean);

      keys.forEach((key) => {
        returnedQuantityByProduct.set(
          key,
          toNumber(returnedQuantityByProduct.get(key)) + returnedQuantity,
        );
        addSetMetric(returnedOrderIdsByProduct, key, orderId);
      });
    });
  });

  const costsByProductId = new Map();
  (Array.isArray(productCosts) ? productCosts : []).forEach((cost) => {
    const productId = normalizeKey(cost?.product_id);
    if (!productId) {
      return;
    }

    const list = costsByProductId.get(productId) || [];
    list.push(cost);
    costsByProductId.set(productId, list);
  });

  const metrics = (Array.isArray(products) ? products : []).map((product) => {
    const productKeys = [
      normalizeKey(product?.id),
      normalizeKey(product?.shopify_id),
      normalizeKey(product?.sku),
    ].filter(Boolean);

    let soldQuantity = 0;
    let totalRevenue = 0;

    productKeys.forEach((key) => {
      const sales = salesByProduct.get(key);
      if (!sales) {
        return;
      }

      soldQuantity = Math.max(soldQuantity, toNumber(sales.soldQuantity));
      totalRevenue = Math.max(totalRevenue, toNumber(sales.totalRevenue));
    });

    const ordersCount = getLargestMappedSetSize(
      countedOrderIdsByProduct,
      productKeys,
    );
    const returnedQuantity = getLargestMappedNumber(
      returnedQuantityByProduct,
      productKeys,
    );
    const returnedOrdersCount = getLargestMappedSetSize(
      returnedOrderIdsByProduct,
      productKeys,
    );
    const returnedOnlyOrdersCount = getLargestReturnedOnlySetSize(
      returnedOrderIdsByProduct,
      countedOrderIdsByProduct,
      productKeys,
    );

    const unitCost = toNumber(product?.cost_price);
    const adsCost = toNumber(product?.ads_cost);
    const operationCost = toNumber(product?.operation_cost);
    const shippingCost = toNumber(product?.shipping_cost);
    const totalUnitCost = unitCost + adsCost + operationCost + shippingCost;
    const totalCost = totalUnitCost * soldQuantity;
    const grossProfit = totalRevenue - totalCost;

    const operationalCosts = costsByProductId.get(normalizeKey(product?.id)) || [];
    const perUnitCosts = operationalCosts
      .filter((cost) => String(cost?.apply_to || "") === "per_unit")
      .reduce((sum, cost) => sum + toNumber(cost?.amount), 0);
    const perOrderCosts = operationalCosts
      .filter((cost) => String(cost?.apply_to || "") === "per_order")
      .reduce((sum, cost) => sum + toNumber(cost?.amount), 0);
    const fixedProductCosts = operationalCosts
      .filter((cost) => String(cost?.apply_to || "") === "fixed")
      .reduce((sum, cost) => sum + toNumber(cost?.amount), 0);

    const operationalCostsTotal =
      perUnitCosts * soldQuantity +
      perOrderCosts * ordersCount +
      fixedProductCosts;
    const savedReturnCostPerUnit = adsCost + operationCost + shippingCost;
    const returnSavedCostsTotal = savedReturnCostPerUnit * returnedQuantity;
    const returnTrackedPerUnitTotal = perUnitCosts * returnedQuantity;
    const returnTrackedPerOrderTotal =
      perOrderCosts * returnedOnlyOrdersCount;
    const returnTrackedCostsTotal =
      returnTrackedPerUnitTotal + returnTrackedPerOrderTotal;
    const returnCostTotal =
      returnSavedCostsTotal + returnTrackedCostsTotal;
    const netProfit = grossProfit - operationalCostsTotal - returnCostTotal;
    const profitPerUnit =
      soldQuantity > 0 ? netProfit / soldQuantity : 0;
    const avgSellingPrice =
      soldQuantity > 0
        ? totalRevenue / soldQuantity
        : toNumber(product?.price);
    const profitMargin =
      totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return {
      ...product,
      sold_quantity: roundAmount(soldQuantity),
      orders_count: ordersCount,
      returned_quantity: roundAmount(returnedQuantity),
      returned_orders_count: returnedOrdersCount,
      returned_only_orders_count: returnedOnlyOrdersCount,
      total_revenue: roundAmount(totalRevenue),
      total_cost: roundAmount(totalCost),
      gross_profit: roundAmount(grossProfit),
      operational_costs_total: roundAmount(operationalCostsTotal),
      fixed_cost_share: 0,
      return_cost_total: roundAmount(returnCostTotal),
      return_cost_saved_total: roundAmount(returnSavedCostsTotal),
      return_cost_tracked_total: roundAmount(returnTrackedCostsTotal),
      net_profit: roundAmount(netProfit),
      profit_per_unit: roundAmount(profitPerUnit),
      avg_selling_price: roundAmount(avgSellingPrice),
      profit_margin: roundAmount(profitMargin),
    };
  });

  const sorted = metrics.sort(
    (left, right) =>
      toNumber(right?.total_revenue) - toNumber(left?.total_revenue),
  );
  const summary = sorted.reduce(
    (acc, item) => {
      acc.total_revenue += toNumber(item?.total_revenue);
      acc.total_cost += toNumber(item?.total_cost);
      acc.total_gross_profit += toNumber(item?.gross_profit);
      acc.total_operational_costs += toNumber(item?.operational_costs_total);
      acc.total_return_cost += toNumber(item?.return_cost_total);
      acc.total_net_profit += toNumber(item?.net_profit);
      acc.total_sold_units += toNumber(item?.sold_quantity);
      acc.total_returned_units += toNumber(item?.returned_quantity);
      acc.total_returned_orders += toNumber(item?.returned_orders_count);
      return acc;
    },
    {
      total_revenue: 0,
      total_cost: 0,
      total_gross_profit: 0,
      total_operational_costs: 0,
      total_return_cost: 0,
      total_net_profit: 0,
      total_sold_units: 0,
      total_returned_units: 0,
      total_returned_orders: 0,
    },
  );

  summary.profit_margin =
    summary.total_revenue > 0
      ? roundAmount((summary.total_net_profit / summary.total_revenue) * 100)
      : 0;

  return {
    paginated: sorted.slice(offset, offset + limit),
    total: sorted.length,
    summary: {
      total_revenue: roundAmount(summary.total_revenue),
      total_cost: roundAmount(summary.total_cost),
      total_gross_profit: roundAmount(summary.total_gross_profit),
      total_operational_costs: roundAmount(summary.total_operational_costs),
      total_return_cost: roundAmount(summary.total_return_cost),
      total_net_profit: roundAmount(summary.total_net_profit),
      total_sold_units: roundAmount(summary.total_sold_units),
      total_returned_units: roundAmount(summary.total_returned_units),
      total_returned_orders: roundAmount(summary.total_returned_orders),
      profit_margin: roundAmount(summary.profit_margin),
    },
  };
};
