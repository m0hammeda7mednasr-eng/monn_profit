const COST_TYPE_GROUPS = {
  ads: "ads",
  shipping: "shipping",
  workshop: "operations",
  operations: "operations",
  packaging: "other",
  other: "other",
};

export const toAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundAmount = (value) =>
  parseFloat(toAmount(value).toFixed(2));

export const hasCostPrice = (value) => toAmount(value) > 0;

export const toDraftAmount = (value, { allowBlank = false } = {}) => {
  const parsed = toAmount(value);

  if (allowBlank && parsed <= 0) {
    return "";
  }

  return String(parsed);
};

export const buildSavedUnitCostSnapshot = (
  productLike,
  { quantity = 0, sellingPrice = null } = {},
) => {
  const resolvedSellingPrice =
    sellingPrice === null
      ? toAmount(productLike?.price ?? productLike?.avg_selling_price)
      : toAmount(sellingPrice);
  const costPrice = toAmount(productLike?.cost_price);
  const adsCost = toAmount(productLike?.ads_cost);
  const operationCost = toAmount(productLike?.operation_cost);
  const shippingCost = toAmount(productLike?.shipping_cost);
  const normalizedQuantity = toAmount(quantity);
  const totalUnitCost = roundAmount(
    costPrice + adsCost + operationCost + shippingCost,
  );
  const unitProfit = roundAmount(resolvedSellingPrice - totalUnitCost);
  const profitMargin =
    resolvedSellingPrice > 0
      ? roundAmount((unitProfit / resolvedSellingPrice) * 100)
      : 0;

  return {
    price: resolvedSellingPrice,
    costPrice,
    adsCost,
    operationCost,
    shippingCost,
    totalUnitCost,
    totalPerUnit: totalUnitCost,
    unitProfit,
    profitMargin,
    quantity: normalizedQuantity,
    soldQuantity: normalizedQuantity,
    savedTotal: roundAmount(totalUnitCost * normalizedQuantity),
    potentialProfit: roundAmount(unitProfit * normalizedQuantity),
    hasValues:
      resolvedSellingPrice > 0 ||
      costPrice > 0 ||
      adsCost > 0 ||
      operationCost > 0 ||
      shippingCost > 0,
  };
};

export const getCostGroupKey = (costType) =>
  COST_TYPE_GROUPS[String(costType || "").toLowerCase()] || "other";

export const getAppliedCostTotal = (cost, soldQuantity, ordersCount) => {
  const amount = toAmount(cost?.amount);

  if (String(cost?.apply_to || "") === "per_order") {
    return amount * toAmount(ordersCount);
  }

  if (String(cost?.apply_to || "") === "fixed") {
    return amount;
  }

  return amount * toAmount(soldQuantity);
};

export const buildProductCostBreakdown = (product, costs = []) => {
  const soldQuantity = toAmount(product?.sold_quantity);
  const ordersCount = toAmount(product?.orders_count);
  const returnedQuantity = toAmount(product?.returned_quantity);
  const savedSnapshot = buildSavedUnitCostSnapshot(product, {
    quantity: soldQuantity,
    sellingPrice: product?.avg_selling_price,
  });
  const saved = {
    ...savedSnapshot,
    soldQuantity,
    ordersCount,
    productUnit: savedSnapshot.costPrice,
    adsUnit: savedSnapshot.adsCost,
    operationsUnit: savedSnapshot.operationCost,
    shippingUnit: savedSnapshot.shippingCost,
    productTotal: roundAmount(savedSnapshot.costPrice * soldQuantity),
    adsTotal: roundAmount(savedSnapshot.adsCost * soldQuantity),
    operationsTotal: roundAmount(savedSnapshot.operationCost * soldQuantity),
    shippingTotal: roundAmount(savedSnapshot.shippingCost * soldQuantity),
    total: savedSnapshot.savedTotal,
  };
  const tracked = {
    ads: 0,
    shipping: 0,
    operations: 0,
    other: 0,
  };

  costs.forEach((cost) => {
    const bucket = getCostGroupKey(cost?.cost_type);
    tracked[bucket] += getAppliedCostTotal(cost, soldQuantity, ordersCount);
  });

  const trackedTotals = {
    ads: roundAmount(tracked.ads),
    shipping: roundAmount(tracked.shipping),
    operations: roundAmount(tracked.operations),
    other: roundAmount(tracked.other),
  };
  const perUnitTrackedTotal = roundAmount(
    costs
      .filter((cost) => String(cost?.apply_to || "") === "per_unit")
      .reduce((sum, cost) => sum + toAmount(cost?.amount), 0),
  );
  const trackedTotal = roundAmount(
    trackedTotals.ads +
      trackedTotals.shipping +
      trackedTotals.operations +
      trackedTotals.other,
  );
  const returnSavedPerUnit = roundAmount(
    saved.adsUnit + saved.operationsUnit + saved.shippingUnit,
  );
  const returnSavedTotal =
    product?.return_cost_saved_total !== undefined
      ? roundAmount(product.return_cost_saved_total)
      : roundAmount(returnSavedPerUnit * returnedQuantity);
  const returnTrackedTotal =
    product?.return_cost_tracked_total !== undefined
      ? roundAmount(product.return_cost_tracked_total)
      : roundAmount(perUnitTrackedTotal * returnedQuantity);
  const returnCostTotal =
    product?.return_cost_total !== undefined
      ? roundAmount(product.return_cost_total)
      : roundAmount(returnSavedTotal + returnTrackedTotal);

  return {
    saved,
    tracked: {
      ...trackedTotals,
      total: trackedTotal,
    },
    returns: {
      quantity: roundAmount(returnedQuantity),
      savedPerUnit: returnSavedPerUnit,
      savedTotal: returnSavedTotal,
      trackedPerUnit: perUnitTrackedTotal,
      trackedTotal: returnTrackedTotal,
      total: returnCostTotal,
    },
    combined: {
      ads: roundAmount(saved.adsTotal + trackedTotals.ads),
      shipping: roundAmount(saved.shippingTotal + trackedTotals.shipping),
      operations: roundAmount(
        saved.operationsTotal + trackedTotals.operations,
      ),
      other: trackedTotals.other,
    },
    totalCosts: roundAmount(saved.total + trackedTotal + returnCostTotal),
  };
};

export const buildRealizedOrdersProfitability = (
  summary,
  totalUnitCost,
) => {
  const successfulOrdersCount = toAmount(summary?.successful_orders_count);
  const fulfilledUnits = toAmount(summary?.fulfilled_units);
  const totalRevenue = toAmount(summary?.total_revenue);
  const savedProductCostsTotal = roundAmount(
    toAmount(summary?.saved_product_costs_total) ||
      toAmount(totalUnitCost) * fulfilledUnits,
  );
  const totalOperationalCosts = roundAmount(summary?.total_operational_costs);
  const grossProfit = roundAmount(totalRevenue - savedProductCostsTotal);
  const netProfit = roundAmount(grossProfit - totalOperationalCosts);
  const profitMargin =
    totalRevenue > 0 ? roundAmount((netProfit / totalRevenue) * 100) : 0;

  return {
    successfulOrdersCount,
    fulfilledUnits,
    totalRevenue,
    totalOperationalCosts,
    savedProductCostsTotal,
    grossProfit,
    netProfit,
    profitMargin,
    hasData:
      successfulOrdersCount > 0 || fulfilledUnits > 0 || totalRevenue > 0,
  };
};
