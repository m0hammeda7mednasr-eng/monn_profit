import { describe, expect, it } from "@jest/globals";

import {
  calculateDashboardOrderStats,
  getOrderGrossSalesAmount,
  getOrderNetSalesAmount,
} from "./dashboardStats.js";

describe("helpers/dashboardStats", () => {
  it("excludes pending and cancelled orders from gross order value while keeping pending value separate", () => {
    const orders = [
      {
        id: "paid-1",
        total_price: 100,
        financial_status: "paid",
      },
      {
        id: "partial-refund-1",
        total_price: 200,
        financial_status: "partially_refunded",
        data: {
          current_total_price: 150,
        },
      },
      {
        id: "pending-1",
        total_price: 300,
        financial_status: "pending",
      },
      {
        id: "cancelled-1",
        total_price: 400,
        financial_status: "paid",
        cancelled_at: "2026-03-20T10:00:00.000Z",
      },
    ];

    const stats = calculateDashboardOrderStats(orders);

    expect(stats.totalOrderValue).toBe(300);
    expect(stats.totalSales).toBe(250);
    expect(stats.pendingOrderValue).toBe(300);
    expect(stats.saleOrders).toHaveLength(2);
  });

  it("keeps refunded orders in gross value before refunds but removes them from net sales", () => {
    const refundedOrder = {
      id: "refund-1",
      total_price: 180,
      financial_status: "refunded",
      data: {},
    };

    expect(getOrderGrossSalesAmount(refundedOrder)).toBe(180);
    expect(getOrderNetSalesAmount(refundedOrder)).toBe(0);
  });
});
