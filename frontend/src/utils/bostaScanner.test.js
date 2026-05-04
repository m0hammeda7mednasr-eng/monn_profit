import {
  getBostaFinancialDetails,
  isScannerItemFinanciallyResolved,
  resolveBostaScannerFallback,
} from "./bostaScanner";

describe("bostaScanner", () => {
  test("getBostaFinancialDetails extracts nested Bosta financial values", () => {
    const result = getBostaFinancialDetails({
      bosta_response: {
        wallet: {
          cashCycle: {
            shipping_fees: 73,
            bosta_fees: 81,
            deposited_amt: 540,
            vat: 11,
          },
        },
        pricing: {
          openingPackageFee: {
            amount: 9,
          },
        },
        TrackingURL: "bosta.co/tracking/123",
        PromisedDate: "2026-05-05T00:00:00.000Z",
        CurrentStatus: {
          timestamp: "2026-05-04T12:00:00.000Z",
        },
        SupportPhoneNumbers: ["19043"],
      },
    });

    expect(result.shippingFee).toBe(73);
    expect(result.bostaDues).toBe(81);
    expect(result.depositedAmount).toBe(540);
    expect(result.vatAmount).toBe(11);
    expect(result.openingPackageFees).toBe(9);
    expect(result.trackingUrl).toBe("bosta.co/tracking/123");
    expect(result.supportPhoneNumbers).toEqual(["19043"]);
  });

  test("resolveBostaScannerFallback uses Bosta reference and receiver when no order match exists", () => {
    const result = resolveBostaScannerFallback(
      {
        business_reference: "#1045",
        receiver: {
          firstName: "Mona",
          lastName: "Ali",
        },
        scan_data_source: "bosta_business",
      },
      (arabicText) => arabicText,
    );

    expect(result.orderName).toBe("#1045");
    expect(result.customerName).toBe("Mona Ali");
    expect(result.hasOrderMatch).toBe(false);
    expect(result.isBostaOnly).toBe(true);
    expect(result.scanResolutionMessage).toContain("#1045");
  });

  test("isScannerItemFinanciallyResolved only returns true for matched internal orders", () => {
    expect(
      isScannerItemFinanciallyResolved({
        has_order_match: true,
      }),
    ).toBe(true);

    expect(
      isScannerItemFinanciallyResolved({
        order_id: "shopify-order-1",
      }),
    ).toBe(true);

    expect(
      isScannerItemFinanciallyResolved({
        scan_data_source: "public_tracking",
      }),
    ).toBe(false);
  });
});
