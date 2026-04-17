import { describe, expect, it } from "@jest/globals";

import {
  buildProductsSummaryExportPayload,
  getOrderLineItems,
} from "./orderExport.js";

describe("helpers/orderExport", () => {
  it("reads line items from the stored order data payload", () => {
    const order = {
      data: JSON.stringify({
        line_items: [
          { product_id: "product-1", quantity: 2 },
        ],
      }),
    };

    expect(getOrderLineItems(order)).toEqual([
      { product_id: "product-1", quantity: 2 },
    ]);
  });

  it("aggregates product totals and counts each order only once per product", () => {
    const payload = buildProductsSummaryExportPayload([
      {
        id: "order-1",
        data: {
          line_items: [
            {
              product_id: "product-1",
              variant_id: "variant-1",
              title: "Crew Neck Tee",
              variant_title: "Black / L",
              sku: "TEE-BLK-L",
              quantity: 2,
              price: "100",
              total_discount: "10",
            },
            {
              product_id: "product-1",
              variant_id: "variant-1",
              title: "Crew Neck Tee",
              variant_title: "Black / L",
              sku: "TEE-BLK-L",
              quantity: 1,
              price: "100",
            },
          ],
        },
      },
      {
        id: "order-2",
        data: {
          line_items: [
            {
              product_id: "product-1",
              variant_id: "variant-1",
              title: "Crew Neck Tee",
              variant_title: "Black / L",
              sku: "TEE-BLK-L",
              quantity: 1,
              price: "100",
            },
            {
              product_id: "product-2",
              title: "Canvas Tote",
              sku: "TOTE-01",
              quantity: 3,
              price: "50",
            },
          ],
        },
      },
    ]);

    expect(payload.summary).toEqual({
      orders_count: 2,
      products_count: 2,
      total_units_sold: 7,
      gross_sales: 540,
    });

    expect(payload.products[0]).toEqual({
      key: "variant:variant-1",
      product_id: "product-1",
      variant_id: "variant-1",
      sku: "TEE-BLK-L",
      product_title: "Crew Neck Tee",
      variant_title: "Black / L",
      orders_count: 2,
      quantity_sold: 4,
      gross_sales: 390,
    });

    expect(payload.products[1]).toEqual({
      key: "product:product-2",
      product_id: "product-2",
      variant_id: "",
      sku: "TOTE-01",
      product_title: "Canvas Tote",
      variant_title: "",
      orders_count: 1,
      quantity_sold: 3,
      gross_sales: 150,
    });
  });
});
