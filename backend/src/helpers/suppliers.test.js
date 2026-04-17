import { describe, expect, it } from "@jest/globals";

import {
  buildProductSourcingDetail,
  buildSupplierDetail,
  buildSupplierList,
  sanitizeDeliveryPayload,
  sanitizeFabricPayload,
  sanitizePaymentPayload,
  sanitizeSupplierPayload,
} from "./suppliers.js";

describe("helpers/suppliers", () => {
  it("normalizes supplier fields and opening balance", () => {
    expect(
      sanitizeSupplierPayload({
        name: "  Modern Supplier  ",
        code: "  MOD-1 ",
        opening_balance: "125.456",
      }),
    ).toEqual(
      expect.objectContaining({
        supplier_type: "factory",
        name: "Modern Supplier",
        code: "MOD-1",
        opening_balance: 125.46,
      }),
    );
  });

  it("builds delivery payload items and amount from line totals", () => {
    expect(
      sanitizeDeliveryPayload({
        items: [
          {
            product_name: "Black Dress",
            sku: "BLK-01",
            material: "Cotton",
            quantity: 2,
            unit_cost: 150,
          },
          {
            product_name: "Red Dress",
            sku: "RED-02",
            material: "Linen",
            quantity: 1,
            unit_cost: 90,
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        amount: 390,
        items: [
          expect.objectContaining({ total_cost: 300 }),
          expect.objectContaining({ total_cost: 90 }),
        ],
      }),
    );
  });

  it("keeps extended model and fabric cost details in delivery items", () => {
    expect(
      sanitizeDeliveryPayload({
        items: [
          {
            item_type: "model",
            product_name: "Winter Hoodie",
            color: "Black",
            fabric_code: "CF-100",
            fabric_name: "Cotton Fleece",
            measurement_unit: "meter",
            pieces_per_unit: 4,
            price_per_meter: 200,
            manufacturing_cost: 15,
            factory_service_cost: 5,
            quantity: 8,
          },
          {
            item_type: "fabric",
            product_name: "Rib Fabric",
            measurement_unit: "kilo",
            price_per_kilo: 120,
            quantity: 3,
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        amount: 920,
        items: [
          expect.objectContaining({
            item_type: "model",
            measurement_unit: "meter",
            fabric_code: "CF-100",
            piece_cost: 50,
            unit_cost: 70,
            total_cost: 560,
            color: "Black",
            fabric_name: "Cotton Fleece",
          }),
          expect.objectContaining({
            item_type: "fabric",
            measurement_unit: "kilo",
            price_per_kilo: 120,
            unit_cost: 120,
            total_cost: 360,
          }),
        ],
      }),
    );
  });

  it("normalizes supplier fabric payload", () => {
    expect(
      sanitizeFabricPayload({
        code: "  CF-100 ",
        name: "  Cotton Fleece ",
        notes: "  Main factory fabric ",
      }),
    ).toEqual(
      expect.objectContaining({
        code: "CF-100",
        name: "Cotton Fleece",
        notes: "Main factory fabric",
        is_active: true,
      }),
    );
  });

  it("normalizes payment payload amount and method", () => {
    expect(
      sanitizePaymentPayload({
        amount: "500",
        payment_method: " wallet ",
      }),
    ).toEqual(
      expect.objectContaining({
        amount: 500,
        payment_method: "wallet",
      }),
    );
  });

  it("computes supplier balances, payments, and received items", () => {
    const supplier = {
      id: "supplier-1",
      name: "Modern Supplier",
      opening_balance: 100,
      is_active: true,
    };
    const entries = [
      {
        id: "delivery-1",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-05",
        amount: 300,
        items: [
          {
            product_name: "Black Dress",
            sku: "BLK-01",
            material: "Cotton",
            quantity: 2,
            unit_cost: 150,
            total_cost: 300,
            item_type: "model",
            measurement_unit: "piece",
          },
        ],
      },
      {
        id: "payment-1",
        supplier_id: "supplier-1",
        entry_type: "payment",
        entry_date: "2026-03-06",
        amount: 180,
      },
    ];

    const detail = buildSupplierDetail(supplier, entries);

    expect(detail.total_deliveries).toBe(300);
    expect(detail.total_payments).toBe(180);
    expect(detail.outstanding_balance).toBe(220);
    expect(detail.received_items_count).toBe(1);
    expect(detail.received_quantity).toBe(2);
    expect(detail.last_payment_at).toBe("2026-03-06");
    expect(detail.products_count).toBe(1);
    expect(detail.fabrics_count).toBe(1);
  });

  it("builds a sorted supplier list with summaries", () => {
    const suppliers = [
      {
        id: "supplier-2",
        name: "Beta",
        supplier_type: "factory",
        is_active: false,
        opening_balance: 0,
      },
      {
        id: "supplier-1",
        name: "Alpha",
        supplier_type: "factory",
        is_active: true,
        opening_balance: 0,
      },
    ];
    const entries = [
      {
        id: "payment-1",
        supplier_id: "supplier-1",
        entry_type: "payment",
        entry_date: "2026-03-06",
        amount: 80,
      },
    ];

    const list = buildSupplierList(suppliers, entries);

    expect(list[0].name).toBe("Alpha");
    expect(list[0].supplier_type).toBe("factory");
    expect(list[0].payments_count).toBe(1);
    expect(list[1].name).toBe("Beta");
  });

  it("groups supplier received items into products and fabrics", () => {
    const supplier = {
      id: "supplier-1",
      name: "Modern Supplier",
      opening_balance: 0,
      is_active: true,
    };
    const entries = [
      {
        id: "delivery-1",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-05",
        amount: 560,
        items: [
          {
            product_id: "product-1",
            variant_id: "variant-1",
            product_name: "Winter Hoodie",
            variant_title: "Black / XL",
            sku: "HD-01",
            fabric_name: "Cotton Fleece",
            material: "Cotton",
            item_type: "model",
            quantity: 8,
            unit_cost: 70,
            total_cost: 560,
          },
        ],
      },
      {
        id: "delivery-2",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-06",
        amount: 360,
        items: [
          {
            product_name: "Rib Fabric",
            fabric_name: "Cotton Fleece",
            item_type: "fabric",
            measurement_unit: "kilo",
            quantity: 3,
            unit_cost: 120,
            total_cost: 360,
          },
        ],
      },
    ];

    const detail = buildSupplierDetail(supplier, entries);

    expect(detail.product_catalog).toHaveLength(2);
    expect(detail.fabric_catalog).toHaveLength(1);
    expect(detail.fabric_catalog[0]).toEqual(
      expect.objectContaining({
        fabric_name: "Cotton Fleece",
        deliveries_count: 2,
      }),
    );
    expect(detail.product_catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          product_id: "product-1",
          sku: "HD-01",
        }),
      ]),
    );
  });

  it("merges registered fabric codes into supplier detail and received items", () => {
    const supplier = {
      id: "supplier-1",
      name: "Modern Supplier",
      supplier_type: "factory",
      opening_balance: 0,
      is_active: true,
    };
    const entries = [
      {
        id: "delivery-1",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-05",
        amount: 560,
        items: [
          {
            product_id: "product-1",
            product_name: "Winter Hoodie",
            sku: "HD-01",
            fabric_code: "CF-100",
            item_type: "model",
            quantity: 8,
            unit_cost: 70,
            total_cost: 560,
          },
        ],
      },
    ];
    const fabricRecords = [
      {
        id: "fabric-1",
        supplier_id: "supplier-1",
        fabric_supplier_id: "supplier-2",
        code: "CF-100",
        name: "Cotton Fleece",
        is_active: true,
      },
    ];
    const suppliers = [
      supplier,
      {
        id: "supplier-2",
        name: "Cotton Hub",
        supplier_type: "fabric",
        code: "FAB-1",
        is_active: true,
      },
    ];

    const detail = buildSupplierDetail(supplier, entries, fabricRecords, suppliers);

    expect(detail.registered_fabrics_count).toBe(1);
    expect(detail.linked_fabric_suppliers_count).toBe(1);
    expect(detail.received_items[0]).toEqual(
      expect.objectContaining({
        fabric_id: "fabric-1",
        fabric_code: "CF-100",
        fabric_name: "Cotton Fleece",
        fabric_supplier_id: "supplier-2",
        fabric_supplier_name: "Cotton Hub",
      }),
    );
    expect(detail.fabric_catalog[0]).toEqual(
      expect.objectContaining({
        fabric_id: "fabric-1",
        fabric_code: "CF-100",
        fabric_name: "Cotton Fleece",
        fabric_supplier_id: "supplier-2",
        deliveries_count: 1,
      }),
    );
  });

  it("builds a fabric supplier detail from linked factory fabric codes", () => {
    const suppliers = [
      {
        id: "supplier-1",
        name: "Modern Factory",
        supplier_type: "factory",
        is_active: true,
      },
      {
        id: "supplier-2",
        name: "Cotton Hub",
        supplier_type: "fabric",
        code: "FAB-1",
        is_active: true,
      },
    ];
    const entries = [
      {
        id: "delivery-1",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-05",
        amount: 560,
        items: [
          {
            product_name: "Winter Hoodie",
            sku: "HD-01",
            fabric_code: "CF-100",
            quantity: 8,
            unit_cost: 70,
            total_cost: 560,
          },
        ],
      },
    ];
    const fabricRecords = [
      {
        id: "fabric-1",
        supplier_id: "supplier-1",
        fabric_supplier_id: "supplier-2",
        code: "CF-100",
        name: "Cotton Fleece",
        is_active: true,
      },
    ];

    const detail = buildSupplierDetail(
      suppliers[1],
      entries,
      fabricRecords,
      suppliers,
    );

    expect(detail.supplier_type).toBe("fabric");
    expect(detail.linked_factories_count).toBe(1);
    expect(detail.registered_fabrics_count).toBe(1);
    expect(detail.linked_factory_suppliers[0]).toEqual(
      expect.objectContaining({
        id: "supplier-1",
        name: "Modern Factory",
      }),
    );
    expect(detail.linked_fabric_records[0]).toEqual(
      expect.objectContaining({
        code: "CF-100",
        name: "Cotton Fleece",
        supplier_id: "supplier-1",
      }),
    );
  });

  it("keeps registered fabrics visible even before any deliveries", () => {
    const supplier = {
      id: "supplier-1",
      name: "Modern Supplier",
      opening_balance: 0,
      is_active: true,
    };
    const fabricRecords = [
      {
        id: "fabric-1",
        supplier_id: "supplier-1",
        code: "RB-200",
        name: "Rib",
        is_active: true,
      },
    ];

    const detail = buildSupplierDetail(supplier, [], fabricRecords);

    expect(detail.fabric_catalog).toHaveLength(1);
    expect(detail.fabric_catalog[0]).toEqual(
      expect.objectContaining({
        fabric_id: "fabric-1",
        fabric_code: "RB-200",
        fabric_name: "Rib",
        total_quantity: 0,
        deliveries_count: 0,
      }),
    );
  });

  it("builds product sourcing detail across suppliers", () => {
    const product = {
      id: "product-1",
      title: "Winter Hoodie",
      sku: "HD-01",
      variants: [{ id: "variant-1", sku: "HD-01-BLK-XL" }],
    };
    const suppliers = [
      {
        id: "supplier-1",
        name: "Modern Supplier",
        supplier_type: "factory",
        code: "MOD-1",
        phone: "0100",
        is_active: true,
      },
      {
        id: "supplier-2",
        name: "Delta Factory",
        supplier_type: "factory",
        code: "DEL-2",
        phone: "0200",
        is_active: true,
      },
      {
        id: "supplier-3",
        name: "Cotton Hub",
        supplier_type: "fabric",
        code: "FAB-1",
        is_active: true,
      },
    ];
    const entries = [
      {
        id: "delivery-1",
        supplier_id: "supplier-1",
        entry_type: "delivery",
        entry_date: "2026-03-05",
        amount: 560,
        items: [
          {
            product_id: "product-1",
            variant_id: "variant-1",
            product_name: "Winter Hoodie",
            variant_title: "Black / XL",
            sku: "HD-01-BLK-XL",
            fabric_name: "Cotton Fleece",
            material: "Cotton",
            item_type: "model",
            quantity: 8,
            unit_cost: 70,
            total_cost: 560,
          },
        ],
      },
      {
        id: "delivery-2",
        supplier_id: "supplier-2",
        entry_type: "delivery",
        entry_date: "2026-03-07",
        amount: 180,
        items: [
          {
            product_id: "product-1",
            product_name: "Winter Hoodie",
            sku: "HD-01",
            fabric_name: "Rib",
            material: "Rib Cotton",
            item_type: "model",
            quantity: 2,
            unit_cost: 90,
            total_cost: 180,
          },
        ],
      },
    ];
    const fabricRecords = [
      {
        id: "fabric-1",
        supplier_id: "supplier-1",
        fabric_supplier_id: "supplier-3",
        code: "CF-100",
        name: "Cotton Fleece",
        is_active: true,
      },
      {
        id: "fabric-2",
        supplier_id: "supplier-2",
        fabric_supplier_id: "supplier-3",
        code: "RB-200",
        name: "Rib",
        is_active: true,
      },
    ];

    const sourcing = buildProductSourcingDetail(
      product,
      suppliers,
      entries,
      fabricRecords,
    );

    expect(sourcing.supplier_count).toBe(2);
    expect(sourcing.fabric_supplier_count).toBe(1);
    expect(sourcing.deliveries_count).toBe(2);
    expect(sourcing.total_quantity).toBe(10);
    expect(sourcing.suppliers[0]).toEqual(
      expect.objectContaining({
        supplier_id: "supplier-2",
        name: "Delta Factory",
      }),
    );
    expect(sourcing.fabric_suppliers[0]).toEqual(
      expect.objectContaining({
        supplier_id: "supplier-3",
        name: "Cotton Hub",
      }),
    );
    expect(sourcing.fabrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fabric_name: "Cotton Fleece" }),
        expect.objectContaining({ fabric_name: "Rib" }),
      ]),
    );
  });
});
