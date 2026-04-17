import {
  getOrderFinancialStatus,
  getOrderGrossAmount,
  getOrderRefundedAmount,
  isCancelledOrder,
} from "./orderAnalytics.js";

const PAID_LIKE_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
]);

const PENDING_STATUSES = new Set(["pending", "authorized"]);

export const getOrderGrossSalesAmount = (order) => {
  const status = getOrderFinancialStatus(order);
  if (isCancelledOrder(order) || !PAID_LIKE_STATUSES.has(status)) {
    return 0;
  }

  return getOrderGrossAmount(order);
};

export const getOrderNetSalesAmount = (order) => {
  const grossAmount = getOrderGrossSalesAmount(order);
  if (grossAmount <= 0) {
    return 0;
  }

  return Math.max(0, grossAmount - getOrderRefundedAmount(order));
};

export const isPendingDashboardOrder = (order) =>
  PENDING_STATUSES.has(getOrderFinancialStatus(order));

export const calculateDashboardOrderStats = (orders = []) => {
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  const saleOrders = normalizedOrders.filter(
    (order) => getOrderNetSalesAmount(order) > 0,
  );
  const totalOrderValue = normalizedOrders.reduce(
    (sum, order) => sum + getOrderGrossSalesAmount(order),
    0,
  );
  const totalSales = saleOrders.reduce(
    (sum, order) => sum + getOrderNetSalesAmount(order),
    0,
  );
  const pendingOrderValue = normalizedOrders
    .filter((order) => isPendingDashboardOrder(order))
    .reduce((sum, order) => sum + getOrderGrossAmount(order), 0);

  return {
    saleOrders,
    totalOrderValue,
    totalSales,
    pendingOrderValue,
  };
};
