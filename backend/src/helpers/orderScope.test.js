import { describe, expect, it } from "@jest/globals";
import {
  getOrderScopeMeta,
  hasActiveOrderScopeFilters,
  matchesOrderScopeFilters,
  resolveOrderPaymentMethod,
} from "./orderScope.js";

describe("helpers/orderScope", () => {
  it("resolves payment method from MoonProfit metadata for manual payments", () => {
    const order = {
      financial_status: "pending",
      data: {
        note_attributes: [
          {
            name: "moon_profit_payment_method",
            value: "instapay",
          },
        ],
      },
    };

    expect(resolveOrderPaymentMethod(order)).toBe("instapay");
  });

  it("matches paid refunded orders using shared scope filters", () => {
    const order = {
      order_number: 1501,
      financial_status: "partially_refunded",
      fulfillment_status: "fulfilled",
      total_price: 200,
      total_refunded: 50,
      created_at: "2026-03-04T10:00:00.000Z",
    };

    const meta = getOrderScopeMeta(order);

    expect(meta.paymentStatus).toBe("partially_refunded");
    expect(meta.isPartialRefund).toBe(true);
    expect(meta.isFulfilled).toBe(true);
    expect(
      matchesOrderScopeFilters(order, {
        date_from: "2026-03-01",
        date_to: "2026-03-31",
        refund_filter: "partial",
        fulfillment_status: "fulfilled",
      }),
    ).toBe(true);
    expect(
      matchesOrderScopeFilters(order, {
        payment_status: "pending_or_authorized",
      }),
    ).toBe(false);
  });

  it("detects when any scoped filter is active", () => {
    expect(hasActiveOrderScopeFilters({})).toBe(false);
    expect(hasActiveOrderScopeFilters({ search: "1001" })).toBe(true);
    expect(hasActiveOrderScopeFilters({ date_from: "2026-03-01" })).toBe(true);
    expect(hasActiveOrderScopeFilters({ payment_status: "paid" })).toBe(true);
    expect(hasActiveOrderScopeFilters({ shipping_issue: "active" })).toBe(true);
    expect(
      hasActiveOrderScopeFilters({ shipping_issue_reason: "confirm_return" }),
    ).toBe(true);
    expect(hasActiveOrderScopeFilters({ refund_filter: "all" })).toBe(false);
  });
});
