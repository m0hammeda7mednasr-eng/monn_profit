import { describe, expect, it } from "@jest/globals";

import { computeNetProfitMetrics } from "./netProfit.js";

const buildProduct = () => ({
  id: "product-local-1",
  shopify_id: "shopify-product-1",
  sku: "SKU-1",
  title: "Printed Pullover",
  price: 200,
  cost_price: 100,
  ads_cost: 10,
  operation_cost: 5,
  shipping_cost: 15,
});

const buildTrackedCosts = () => [
  {
    product_id: "product-local-1",
    amount: 2,
    apply_to: "per_unit",
  },
  {
    product_id: "product-local-1",
    amount: 7,
    apply_to: "per_order",
  },
];

describe("helpers/netProfit", () => {
  it("keeps return costs when a refunded fulfilled order disappears from net sales", () => {
    const { paginated, summary } = computeNetProfitMetrics({
      products: [buildProduct()],
      productCosts: buildTrackedCosts(),
      orders: [
        {
          id: "order-kept",
          financial_status: "paid",
          fulfillment_status: "fulfilled",
          total_price: 200,
          data: {
            line_items: [
              {
                id: "line-kept",
                product_id: "shopify-product-1",
                sku: "SKU-1",
                quantity: 1,
                price: 200,
              },
            ],
            fulfillments: [
              {
                line_items: [{ id: "line-kept", quantity: 1 }],
              },
            ],
          },
        },
        {
          id: "order-returned",
          financial_status: "refunded",
          fulfillment_status: "fulfilled",
          total_price: 200,
          total_refunded: 200,
          data: {
            current_total_price: 0,
            line_items: [
              {
                id: "line-returned",
                product_id: "shopify-product-1",
                sku: "SKU-1",
                quantity: 1,
                price: 200,
              },
            ],
            refunds: [
              {
                refund_line_items: [
                  {
                    line_item_id: "line-returned",
                    quantity: 1,
                    subtotal: 200,
                  },
                ],
              },
            ],
            fulfillments: [
              {
                line_items: [{ id: "line-returned", quantity: 1 }],
              },
            ],
          },
        },
      ],
    });

    expect(paginated).toHaveLength(1);
    expect(paginated[0].sold_quantity).toBe(1);
    expect(paginated[0].orders_count).toBe(1);
    expect(paginated[0].returned_quantity).toBe(1);
    expect(paginated[0].returned_only_orders_count).toBe(1);
    expect(paginated[0].total_revenue).toBe(200);
    expect(paginated[0].total_cost).toBe(130);
    expect(paginated[0].operational_costs_total).toBe(9);
    expect(paginated[0].return_cost_total).toBe(39);
    expect(paginated[0].net_profit).toBe(22);

    expect(summary.total_return_cost).toBe(39);
    expect(summary.total_net_profit).toBe(22);
    expect(summary.total_returned_units).toBe(1);
  });

  it("does not double count per-order tracked costs on partially returned orders", () => {
    const { paginated, summary } = computeNetProfitMetrics({
      products: [buildProduct()],
      productCosts: buildTrackedCosts(),
      orders: [
        {
          id: "order-partial-return",
          financial_status: "partially_refunded",
          fulfillment_status: "fulfilled",
          total_price: 400,
          total_refunded: 200,
          data: {
            current_total_price: 200,
            line_items: [
              {
                id: "line-partial",
                product_id: "shopify-product-1",
                sku: "SKU-1",
                quantity: 2,
                price: 200,
              },
            ],
            refunds: [
              {
                refund_line_items: [
                  {
                    line_item_id: "line-partial",
                    quantity: 1,
                    subtotal: 200,
                  },
                ],
              },
            ],
            fulfillments: [
              {
                line_items: [{ id: "line-partial", quantity: 2 }],
              },
            ],
          },
        },
      ],
    });

    expect(paginated).toHaveLength(1);
    expect(paginated[0].sold_quantity).toBe(1);
    expect(paginated[0].orders_count).toBe(1);
    expect(paginated[0].returned_quantity).toBe(1);
    expect(paginated[0].returned_only_orders_count).toBe(0);
    expect(paginated[0].total_revenue).toBe(200);
    expect(paginated[0].total_cost).toBe(130);
    expect(paginated[0].operational_costs_total).toBe(9);
    expect(paginated[0].return_cost_total).toBe(32);
    expect(paginated[0].net_profit).toBe(29);

    expect(summary.total_return_cost).toBe(32);
    expect(summary.total_net_profit).toBe(29);
    expect(summary.total_returned_orders).toBe(1);
  });
});
