import {
  BOSTA_VAT_RATE,
  buildBostaScannerExportRows,
  calculateScannerProfitSnapshot,
  canReuseScannedItem,
  filterBostaScannerItems,
  FIXED_OPENING_PACKAGE_FEE,
  getBostaFinancialDetails,
  getEstimatedBostaDues,
  getBostaScannerStatusKey,
  getBostaScannerTimeRange,
  normalizeScannedItem,
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

  test("getEstimatedBostaDues recalculates dues from shipping with fixed opening fee and VAT", () => {
    const estimatedDues = getEstimatedBostaDues({
      shipping_fee: 87,
      opening_package_fees: 7,
      vat_amount: 13.16,
      bosta_dues: 107.2,
    });

    expect(estimatedDues).toBe(107.84);
  });

  test("calculateScannerProfitSnapshot subtracts Bosta dues and product cost from order total", () => {
    const snapshot = calculateScannerProfitSnapshot({
      orderTotal: 345,
      productCost: 120,
      shipment: {
        shipping_fee: 87,
        opening_package_fees: 7,
        vat_amount: 13.16,
      },
    });

    expect(snapshot.openingPackageFees).toBe(FIXED_OPENING_PACKAGE_FEE);
    expect(snapshot.vatAmount).toBe(
      Number(((87 + FIXED_OPENING_PACKAGE_FEE) * BOSTA_VAT_RATE).toFixed(2)),
    );
    expect(snapshot.estimatedBostaDues).toBe(107.84);
    expect(snapshot.netProfit).toBe(117.16);
  });

  test("normalizeScannedItem upgrades cached rows to the new net-profit formula", () => {
    const normalized = normalizeScannedItem({
      revenue: 345,
      total_cost: 120,
      shipping_cost: 87,
      opening_package_fees: 7,
      vat_amount: 13.16,
    });

    expect(normalized.order_total).toBe(345);
    expect(normalized.product_cost).toBe(120);
    expect(normalized.opening_package_fees).toBe(FIXED_OPENING_PACKAGE_FEE);
    expect(normalized.estimated_bosta_dues).toBe(107.84);
    expect(normalized.net_profit).toBe(117.16);
    expect(normalized.real_net_profit).toBe(117.16);
  });

  test("canReuseScannedItem only returns true for completed cached rows", () => {
    expect(
      canReuseScannedItem({
        tracking_number: "2695867962",
        delivery_state_label: "Delivered",
      }),
    ).toBe(true);

    expect(
      canReuseScannedItem({
        tracking_number: "2695867962",
        is_pending: true,
      }),
    ).toBe(false);

    expect(
      canReuseScannedItem({
        tracking_number: "2695867962",
        has_error: true,
      }),
    ).toBe(false);
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

  test("getBostaScannerStatusKey normalizes scanner and delivery states", () => {
    expect(getBostaScannerStatusKey({ is_pending: true })).toBe("pending");
    expect(getBostaScannerStatusKey({ has_error: true })).toBe("failed");
    expect(getBostaScannerStatusKey({ delivery_state: 40 })).toBe("delivered");
    expect(getBostaScannerStatusKey({ delivery_state: 30 })).toBe("in_transit");
    expect(getBostaScannerStatusKey({ delivery_state: 101 })).toBe("exception");
    expect(getBostaScannerStatusKey({ delivery_state: 50 })).toBe("cancelled");
    expect(getBostaScannerStatusKey({ delivery_state: 12 })).toBe("other");
  });

  test("filterBostaScannerItems matches by search term and status", () => {
    const items = [
      {
        tracking_number: "ABC123",
        order_name: "#1001",
        customer_name: "Mona Ali",
        delivery_state: 40,
        delivery_state_label: "Delivered",
      },
      {
        tracking_number: "XYZ789",
        order_name: "#1002",
        customer_name: "Omar Sameh",
        has_error: true,
        delivery_state_label: "Failed",
      },
    ];

    expect(
      filterBostaScannerItems(items, {
        searchTerm: "mona",
        status: "all",
      }),
    ).toHaveLength(1);

    expect(
      filterBostaScannerItems(items, {
        searchTerm: "",
        status: "failed",
      }),
    ).toEqual([items[1]]);

    expect(
      filterBostaScannerItems(items, {
        searchTerm: "abc123",
        status: "delivered",
      }),
    ).toEqual([items[0]]);
  });

  test("getBostaScannerTimeRange builds daily, monthly, and custom windows", () => {
    const now = new Date(2026, 4, 5, 13, 30, 0, 0);

    expect(
      getBostaScannerTimeRange({ timePreset: "daily" }, now),
    ).toMatchObject({
      preset: "daily",
      start: new Date(2026, 4, 5, 0, 0, 0, 0),
      end: new Date(2026, 4, 5, 23, 59, 59, 999),
    });

    expect(
      getBostaScannerTimeRange({ timePreset: "monthly" }, now),
    ).toMatchObject({
      preset: "monthly",
      start: new Date(2026, 4, 1, 0, 0, 0, 0),
      end: new Date(2026, 4, 31, 23, 59, 59, 999),
    });

    expect(
      getBostaScannerTimeRange(
        {
          timePreset: "custom",
          customFrom: "2026-05-07",
          customTo: "2026-05-02",
        },
        now,
      ),
    ).toMatchObject({
      preset: "custom",
      start: new Date(2026, 4, 2, 0, 0, 0, 0),
      end: new Date(2026, 4, 7, 23, 59, 59, 999),
    });
  });

  test("filterBostaScannerItems respects time presets and custom ranges", () => {
    const items = [
      {
        tracking_number: "TODAY-1",
        scanned_at: "2026-05-05T10:15:00",
        delivery_state: 40,
        delivery_state_label: "Delivered",
      },
      {
        tracking_number: "MONTH-1",
        scanned_at: "2026-05-02T09:00:00",
        delivery_state: 30,
        delivery_state_label: "In transit",
      },
      {
        tracking_number: "OLD-1",
        scanned_at: "2026-04-28T16:20:00",
        delivery_state: 47,
        delivery_state_label: "Exception",
      },
    ];

    expect(
      filterBostaScannerItems(items, {
        timePreset: "daily",
        now: new Date(2026, 4, 5, 12, 0, 0, 0),
      }),
    ).toEqual([items[0]]);

    expect(
      filterBostaScannerItems(items, {
        timePreset: "monthly",
        now: new Date(2026, 4, 5, 12, 0, 0, 0),
      }),
    ).toEqual([items[0], items[1]]);

    expect(
      filterBostaScannerItems(items, {
        timePreset: "custom",
        customFrom: "2026-05-01",
        customTo: "2026-05-03",
      }),
    ).toEqual([items[1]]);
  });

  test("buildBostaScannerExportRows creates spreadsheet-ready rows", () => {
    const rows = buildBostaScannerExportRows([
      {
        tracking_number: "ABC123",
        delivery_state: 40,
        delivery_state_label: "Delivered",
        order_name: "#1001",
        business_reference: "REF-1",
        customer_name: "Mona Ali",
        cod_amount: 250,
        order_total: 300,
        product_cost: 120,
        estimated_bosta_dues: 45.6,
        shipping_fee: 30,
        opening_package_fees: 7.6,
        vat_amount: 5.26,
        net_profit: 134.4,
        scanned_at: "2026-05-05T10:30:00.000Z",
        last_status_update: "2026-05-05T12:00:00.000Z",
        promised_date: "2026-05-06T12:00:00.000Z",
        scan_data_source: "shopify_lookup",
        scan_resolution_message: "Matched order",
        tracking_url: "https://bosta.co/tracking/ABC123",
      },
    ]);

    expect(rows).toEqual([
      [
        "ABC123",
        "delivered",
        "Delivered",
        "#1001",
        "REF-1",
        "Mona Ali",
        "250.00",
        "300.00",
        "120.00",
        "45.60",
        "30.00",
        "7.60",
        "5.26",
        "134.40",
        "2026-05-05T10:30:00.000Z",
        "2026-05-05T12:00:00.000Z",
        "2026-05-06T12:00:00.000Z",
        "shopify_lookup",
        "Matched order",
        "https://bosta.co/tracking/ABC123",
      ],
    ]);
  });
});
