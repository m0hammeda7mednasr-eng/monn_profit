import { describe, expect, it } from "@jest/globals";

import {
  buildWarehouseVariantCatalog,
  normalizeWarehouseCode,
} from "./warehouseCatalog.js";

describe("helpers/warehouseCatalog", () => {
  it("keeps SKU as the primary warehouse code and allows scanning by barcode too", () => {
    const catalog = buildWarehouseVariantCatalog([
      {
        id: "product-1",
        title: "Core Tee",
        data: {
          variants: [
            {
              id: "variant-1",
              title: "Black / L",
              sku: " tee-001 ",
              barcode: "1234567890",
            },
          ],
        },
      },
    ]);

    expect(catalog.rows[0].warehouse_code).toBe("TEE-001");
    expect(catalog.rows[0].warehouse_code_source).toBe("sku");
    expect(catalog.rowsByAnyCode.get("TEE-001")?.variant_id).toBe("variant-1");
    expect(catalog.rowsByAnyCode.get("1234567890")?.variant_id).toBe("variant-1");
  });

  it("falls back to barcode when SKU is missing", () => {
    const catalog = buildWarehouseVariantCatalog([
      {
        id: "product-2",
        title: "Canvas Tote",
        data: {
          variants: [
            {
              id: "variant-2",
              title: "Default Title",
              barcode: "99887766",
            },
          ],
        },
      },
    ]);

    expect(catalog.rows[0].warehouse_code).toBe("99887766");
    expect(catalog.rows[0].warehouse_code_source).toBe("barcode");
  });

  it("creates a stable internal code when both SKU and barcode are missing", () => {
    const catalog = buildWarehouseVariantCatalog([
      {
        id: "product-3",
        title: "No Code Product",
        data: {
          variants: [
            {
              id: "variant-3",
              title: "Blue",
            },
          ],
        },
      },
    ]);

    expect(catalog.rows[0].warehouse_code).toBe("INT-VARIANT-3");
    expect(catalog.rows[0].warehouse_code_source).toBe("internal");
    expect(catalog.rowsByAnyCode.get("INT-VARIANT-3")?.variant_id).toBe("variant-3");
  });

  it("marks duplicate scan codes when two variants share the same code", () => {
    const catalog = buildWarehouseVariantCatalog([
      {
        id: "product-4",
        title: "Product A",
        data: {
          variants: [{ id: "variant-4a", sku: "SKU-1" }],
        },
      },
      {
        id: "product-5",
        title: "Product B",
        data: {
          variants: [{ id: "variant-5a", barcode: normalizeWarehouseCode("sku-1") }],
        },
      },
    ]);

    expect(catalog.duplicateScanCodes.has("SKU-1")).toBe(true);
  });
});
