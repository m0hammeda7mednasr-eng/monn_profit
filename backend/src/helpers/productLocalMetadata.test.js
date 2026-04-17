import { describe, expect, it } from "@jest/globals";

import {
  applyProductWarehouseInventorySnapshot,
  extractProductLocalMetadata,
  getProductWarehouseInventorySnapshot,
  isProductLowStockAlertsSuppressed,
  mergeProductLocalMetadata,
  preserveProductLocalMetadata,
  preserveProductWarehouseData,
} from "./productLocalMetadata.js";

describe("helpers/productLocalMetadata warehouse separation", () => {
  it("keeps Shopify inventory as received while initializing local warehouse stock to zero", () => {
    const result = preserveProductWarehouseData(
      {
        inventory_quantity: 14,
        variants: [
          { id: "v-1", inventory_quantity: 9 },
          { id: "v-2", inventory_quantity: 5 },
        ],
      },
      {},
    );

    expect(result.inventory_quantity).toBe(14);
    expect(result.variants).toEqual([
      expect.objectContaining({
        id: "v-1",
        inventory_quantity: 9,
        _moon_profit_warehouse_quantity: 0,
      }),
      expect.objectContaining({
        id: "v-2",
        inventory_quantity: 5,
        _moon_profit_warehouse_quantity: 0,
      }),
    ]);
  });

  it("preserves local warehouse quantities when Shopify product data refreshes", () => {
    const result = preserveProductWarehouseData(
      {
        inventory_quantity: 99,
        variants: [
          { id: "v-1", inventory_quantity: 40, sku: "SKU-1" },
          { id: "v-2", inventory_quantity: 59, sku: "SKU-2" },
          { id: "v-3", inventory_quantity: 10, sku: "SKU-3" },
        ],
      },
      {
        inventory_quantity: 7,
        variants: [
          {
            id: "v-1",
            inventory_quantity: 2,
            sku: "SKU-1",
            _moon_profit_warehouse_quantity: 12,
          },
          {
            id: "v-2",
            inventory_quantity: 5,
            sku: "SKU-2",
            _moon_profit_warehouse_quantity: 4,
          },
        ],
      },
    );

    expect(result.inventory_quantity).toBe(99);
    expect(result.variants).toEqual([
      expect.objectContaining({
        id: "v-1",
        inventory_quantity: 40,
        _moon_profit_warehouse_quantity: 12,
      }),
      expect.objectContaining({
        id: "v-2",
        inventory_quantity: 59,
        _moon_profit_warehouse_quantity: 4,
      }),
      expect.objectContaining({
        id: "v-3",
        inventory_quantity: 10,
        _moon_profit_warehouse_quantity: 0,
      }),
    ]);
  });

  it("updates only the selected variant local warehouse stock", () => {
    const nextData = applyProductWarehouseInventorySnapshot(
      {
        variants: [
          { id: "v-1", sku: "SKU-1", inventory_quantity: 9 },
          { id: "v-2", sku: "SKU-2", inventory_quantity: 5 },
        ],
      },
      { variantId: "v-2", sku: "SKU-2" },
      {
        quantity: 7,
        last_scanned_at: "2026-03-23T10:00:00.000Z",
        last_movement_type: "in",
        last_movement_quantity: 3,
      },
    );

    expect(nextData.variants[0]).toEqual(
      expect.objectContaining({
        id: "v-1",
        inventory_quantity: 9,
      }),
    );
    expect(nextData.variants[0]).not.toHaveProperty("_moon_profit_warehouse_quantity");
    expect(nextData.variants[1]).toEqual(
      expect.objectContaining({
        id: "v-2",
        inventory_quantity: 5,
        _moon_profit_warehouse_quantity: 7,
        _moon_profit_warehouse_last_scanned_at: "2026-03-23T10:00:00.000Z",
        _moon_profit_warehouse_last_movement_type: "in",
        _moon_profit_warehouse_last_movement_quantity: 3,
      }),
    );

    expect(
      getProductWarehouseInventorySnapshot(nextData, { variantId: "v-2" }),
    ).toEqual({
      quantity: 7,
      last_scanned_at: "2026-03-23T10:00:00.000Z",
      last_movement_type: "in",
      last_movement_quantity: 3,
      created_at: null,
      updated_at: "2026-03-23T10:00:00.000Z",
    });
  });

  it("stores and reads the low-stock suppression flag in local product metadata", () => {
    const nextData = mergeProductLocalMetadata(
      {
        title: "Seasonal item",
      },
      {
        suppress_low_stock_alerts: true,
      },
    );

    expect(extractProductLocalMetadata(nextData)).toEqual({
      supplier_phone: "",
      supplier_location: "",
      suppress_low_stock_alerts: true,
    });
    expect(isProductLowStockAlertsSuppressed(nextData)).toBe(true);
  });

  it("preserves the low-stock suppression flag during product data refresh", () => {
    const result = preserveProductLocalMetadata(
      {
        title: "Updated from Shopify",
        inventory_quantity: 3,
      },
      {
        _moon_profit_local_product: {
          suppress_low_stock_alerts: true,
        },
      },
    );

    expect(isProductLowStockAlertsSuppressed(result)).toBe(true);
    expect(extractProductLocalMetadata(result)).toEqual({
      supplier_phone: "",
      supplier_location: "",
      suppress_low_stock_alerts: true,
    });
  });
});
