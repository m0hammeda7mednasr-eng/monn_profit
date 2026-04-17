import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_SHIPPING_ISSUE_REASON,
  applyOrderLocalMetadata,
  extractOrderLocalMetadata,
  mergeOrderLocalMetadata,
  preserveOrderLocalMetadata,
} from "./orderLocalMetadata.js";

describe("helpers/orderLocalMetadata", () => {
  it("extracts and preserves shipping issue metadata", () => {
    const orderData = {
      _moon_profit_local_order: {
        shipping_issue: {
          reason: "confirm_return",
          shipping_company_note: "Courier confirmed a return pickup window.",
          customer_service_note: "Customer agreed to keep the phone available.",
          updated_by_name: "Ops",
        },
      },
    };

    const metadata = extractOrderLocalMetadata(orderData);
    const applied = applyOrderLocalMetadata(orderData);

    expect(metadata.shipping_issue).toEqual(
      expect.objectContaining({
        reason: "confirm_return",
        shipping_company_note: "Courier confirmed a return pickup window.",
        customer_service_note: "Customer agreed to keep the phone available.",
        updated_by_name: "Ops",
      }),
    );
    expect(applied._moon_profit_local_order.shipping_issue.reason).toBe(
      "confirm_return",
    );
  });

  it("normalizes invalid shipping issue reasons to the default bucket", () => {
    const updated = mergeOrderLocalMetadata(
      {},
      {
        shipping_issue: {
          reason: "unknown_reason",
        },
      },
      {
        updatedAt: "2026-03-28T10:00:00.000Z",
        updatedBy: "user-1",
        updatedByName: "Ops",
      },
    );

    expect(extractOrderLocalMetadata(updated).shipping_issue).toEqual(
      expect.objectContaining({
        reason: DEFAULT_SHIPPING_ISSUE_REASON,
        shipping_company_note: "",
        customer_service_note: "",
        updated_at: "2026-03-28T10:00:00.000Z",
        updated_by: "user-1",
        updated_by_name: "Ops",
      }),
    );
  });

  it("stores follow-up notes inside shipping issue metadata", () => {
    const updated = mergeOrderLocalMetadata(
      {},
      {
        shipping_issue: {
          reason: "part_with_phone",
          shipping_company_note: "Driver requested a reachable phone number.",
          customer_service_note: "CS confirmed the customer will answer today.",
        },
      },
      {
        updatedAt: "2026-03-28T11:30:00.000Z",
        updatedBy: "user-2",
        updatedByName: "Customer Service",
      },
    );

    expect(extractOrderLocalMetadata(updated).shipping_issue).toEqual(
      expect.objectContaining({
        reason: "part_with_phone",
        shipping_company_note: "Driver requested a reachable phone number.",
        customer_service_note: "CS confirmed the customer will answer today.",
        updated_at: "2026-03-28T11:30:00.000Z",
        updated_by: "user-2",
        updated_by_name: "Customer Service",
      }),
    );
  });

  it("clears shipping issue metadata when requested", () => {
    const withIssue = mergeOrderLocalMetadata({}, {
      shipping_issue: {
        reason: "issue",
      },
    });
    const cleared = mergeOrderLocalMetadata(withIssue, {
      shipping_issue: null,
    });

    expect(extractOrderLocalMetadata(cleared).shipping_issue).toBeNull();
    expect(cleared._moon_profit_local_order).toBeUndefined();
  });

  it("preserves local shipping notes when a fresh Shopify payload replaces order data", () => {
    const existingOrderData = {
      id: 101,
      note: "Existing order note",
      _moon_profit_local_order: {
        shipping_issue: {
          reason: "part_with_phone",
          shipping_company_note: "Courier asked for a reachable phone number.",
          customer_service_note: "Customer confirmed availability tonight.",
          updated_at: "2026-04-07T14:00:00.000Z",
          updated_by: "user-9",
          updated_by_name: "Ops",
        },
      },
    };

    const incomingShopifyPayload = {
      id: 101,
      note: "Fresh Shopify note",
      fulfillment_status: "fulfilled",
    };

    const preserved = preserveOrderLocalMetadata(
      incomingShopifyPayload,
      existingOrderData,
    );

    expect(preserved.fulfillment_status).toBe("fulfilled");
    expect(extractOrderLocalMetadata(preserved).shipping_issue).toEqual(
      expect.objectContaining({
        reason: "part_with_phone",
        shipping_company_note: "Courier asked for a reachable phone number.",
        customer_service_note: "Customer confirmed availability tonight.",
        updated_by_name: "Ops",
      }),
    );
  });
});
