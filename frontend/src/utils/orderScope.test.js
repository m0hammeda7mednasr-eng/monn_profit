import {
  buildOrdersListApiParams,
  hasActiveOrdersListFilters,
} from "./orderScope";

describe("orderScope orders list helpers", () => {
  test("detects when orders list filters require full-history loading", () => {
    expect(hasActiveOrdersListFilters({})).toBe(false);
    expect(hasActiveOrdersListFilters({ sortBy: "oldest" })).toBe(false);
    expect(hasActiveOrdersListFilters({ searchTerm: "1001" })).toBe(true);
    expect(hasActiveOrdersListFilters({ dateFrom: "2026-03-01" })).toBe(true);
    expect(hasActiveOrdersListFilters({ paymentFilter: "paid" })).toBe(true);
    expect(hasActiveOrdersListFilters({ cancelledOnly: true })).toBe(true);
  });

  test("builds API params for full-history orders requests", () => {
    expect(
      buildOrdersListApiParams({
        searchTerm: " #1001 ",
        dateFrom: "2026-03-01",
        dateTo: "2026-03-21",
        orderNumberFrom: "#1000",
        orderNumberTo: "1009",
        amountMin: "50",
        amountMax: "120.5",
        paymentFilter: "paid",
        paymentMethodFilter: "shopify",
        fulfillmentFilter: "fulfilled",
        refundFilter: "partial",
        cancelledOnly: true,
        fulfilledOnly: true,
        paidOnly: true,
      }),
    ).toEqual({
      search: "#1001",
      date_from: "2026-03-01",
      date_to: "2026-03-21",
      order_number_from: "1000",
      order_number_to: "1009",
      min_total: "50",
      max_total: "120.5",
      payment_status: "paid",
      payment_method: "shopify",
      fulfillment_status: "fulfilled",
      refund_filter: "partial",
      cancelled_only: "true",
      fulfilled_only: "true",
      paid_only: "true",
    });
  });
});
