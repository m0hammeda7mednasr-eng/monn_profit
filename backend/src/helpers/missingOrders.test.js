import { describe, expect, it } from "@jest/globals";

import {
  buildMissingOrdersFromStock,
  MISSING_ORDER_REASON_NO_ACTION,
  MISSING_ORDER_REASON_STOCK_SHORTAGE,
} from "./missingOrders.js";

const buildOrder = ({
  id,
  storeId = "store-1",
  createdAt,
  orderNumber,
  fulfillmentStatus = "unfulfilled",
  financialStatus = "paid",
  lineItems = [],
} = {}) => ({
  id,
  store_id: storeId,
  order_number: orderNumber || id,
  created_at: createdAt,
  fulfillment_status: fulfillmentStatus,
  financial_status: financialStatus,
  customer_name: `Customer ${id}`,
  data: {
    line_items: lineItems,
  },
});

const buildLineItem = ({
  id,
  productId = "product-1",
  variantId = "variant-1",
  sku = "SKU-1",
  quantity = 1,
  fulfillableQuantity,
  currentQuantity,
  fulfilledQuantity,
  fulfillmentStatus = "unfulfilled",
} = {}) => ({
  id,
  product_id: productId,
  variant_id: variantId,
  sku,
  title: `Product ${id}`,
  variant_title: "Default Title",
  quantity,
  fulfillable_quantity: fulfillableQuantity,
  current_quantity: currentQuantity,
  fulfilled_quantity: fulfilledQuantity,
  fulfillment_status: fulfillmentStatus,
});

const buildWarehouseRow = ({
  storeId = "store-1",
  productId = "local-product-1",
  shopifyId = "product-1",
  variantId = "variant-1",
  sku = "SKU-1",
  quantity = 0,
} = {}) => ({
  key: `${storeId}:${variantId || sku}`,
  store_id: storeId,
  product_id: productId,
  shopify_id: shopifyId,
  variant_id: variantId,
  warehouse_code: sku,
  sku,
  warehouse_quantity: quantity,
});

const buildOrderListItem = (order) => ({
  id: order.id,
  store_id: order.store_id,
  order_number: order.order_number,
  customer_name: order.customer_name,
  created_at: order.created_at,
  fulfillment_status: order.fulfillment_status,
  financial_status: order.financial_status,
});

describe("helpers/missingOrders", () => {
  it("keeps under-age shortage orders in the regular orders list", () => {
    const orders = [
      buildOrder({
        id: "order-young",
        createdAt: "2026-03-23T12:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-1",
            quantity: 2,
            fulfillableQuantity: 2,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 0 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T11:00:00.000Z").getTime(),
    });

    expect(result).toEqual([]);
  });

  it("moves an order after 3 days when even one piece is missing", () => {
    const orders = [
      buildOrder({
        id: "order-short",
        createdAt: "2026-03-21T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-1",
            quantity: 2,
            fulfillableQuantity: 2,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 1 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-25T09:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "order-short",
      missing_reason: MISSING_ORDER_REASON_STOCK_SHORTAGE,
      missing_state: "missing",
      days_without_stock: 4,
      warehouse_required_quantity: 2,
      warehouse_reserved_quantity: 1,
      warehouse_shortage_quantity: 1,
      warehouse_shortage_items_count: 1,
    });
    expect(result[0].warehouse_shortage_lines[0]).toMatchObject({
      line_item_id: "line-1",
      requested_quantity: 2,
      reserved_quantity: 1,
      missing_quantity: 1,
      matched_by: "variant_id",
    });
  });

  it("moves a fully coverable order after 3 days when no action was recorded", () => {
    const orders = [
      buildOrder({
        id: "order-no-action",
        createdAt: "2026-03-21T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-stocked",
            quantity: 2,
            fulfillableQuantity: 2,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 2 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-25T09:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "order-no-action",
      missing_reason: MISSING_ORDER_REASON_NO_ACTION,
      missing_state: "missing",
      warehouse_coverable: true,
      warehouse_required_quantity: 2,
      warehouse_reserved_quantity: 2,
      warehouse_shortage_quantity: 0,
      days_without_action: 4,
    });
  });

  it("keeps fully coverable orders in the main list when an action was recorded", () => {
    const orders = [
      buildOrder({
        id: "order-with-action",
        createdAt: "2026-03-21T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-acted",
            quantity: 1,
            fulfillableQuantity: 1,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 1 })]],
      ]),
      orderActionTimestampsByKey: new Map([
        ["order-with-action", new Date("2026-03-24T12:00:00.000Z").getTime()],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-25T09:00:00.000Z").getTime(),
    });

    expect(result).toEqual([]);
  });

  it("allocates warehouse stock to older orders before newer ones", () => {
    const orders = [
      buildOrder({
        id: "order-oldest",
        orderNumber: "1001",
        createdAt: "2026-03-20T10:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-oldest",
            quantity: 3,
            fulfillableQuantity: 3,
          }),
        ],
      }),
      buildOrder({
        id: "order-newer",
        orderNumber: "1002",
        createdAt: "2026-03-21T10:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-newer",
            quantity: 3,
            fulfillableQuantity: 3,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 5 })]],
      ]),
      orderActionTimestampsByKey: new Map([
        ["order-oldest", new Date("2026-03-24T08:00:00.000Z").getTime()],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T10:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("order-newer");
    expect(result[0].warehouse_shortage_quantity).toBe(1);
  });

  it("uses the remaining fulfillable quantity instead of the original ordered quantity", () => {
    const orders = [
      buildOrder({
        id: "order-partial",
        createdAt: "2026-03-21T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-partial",
            quantity: 5,
            fulfillableQuantity: 1,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 1 })]],
      ]),
      orderActionTimestampsByKey: new Map([
        ["order-partial", new Date("2026-03-24T08:00:00.000Z").getTime()],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-25T09:00:00.000Z").getTime(),
    });

    expect(result).toEqual([]);
  });

  it("ignores fulfilled and refunded orders", () => {
    const orders = [
      buildOrder({
        id: "order-fulfilled",
        createdAt: "2026-03-18T09:00:00.000Z",
        fulfillmentStatus: "fulfilled",
        lineItems: [buildLineItem({ id: "line-fulfilled", quantity: 2 })],
      }),
      buildOrder({
        id: "order-refunded",
        createdAt: "2026-03-18T09:00:00.000Z",
        financialStatus: "refunded",
        lineItems: [buildLineItem({ id: "line-refunded", quantity: 2 })],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 0 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T09:00:00.000Z").getTime(),
    });

    expect(result).toEqual([]);
  });

  it("keeps stock scoped to each store", () => {
    const orders = [
      buildOrder({
        id: "order-store-1",
        storeId: "store-1",
        createdAt: "2026-03-20T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-store-1",
            productId: "product-a",
            variantId: "variant-a",
            sku: "SKU-A",
            quantity: 2,
            fulfillableQuantity: 2,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ shopifyId: "product-a", variantId: "variant-a", sku: "SKU-A", quantity: 0 })]],
        ["store-2", [buildWarehouseRow({ storeId: "store-2", shopifyId: "product-a", variantId: "variant-a", sku: "SKU-A", quantity: 10 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T09:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("order-store-1");
    expect(result[0].warehouse_shortage_quantity).toBe(2);
  });

  it("escalates unmatched orders after 6 days", () => {
    const orders = [
      buildOrder({
        id: "order-escalated",
        createdAt: "2026-03-18T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-escalated",
            productId: "product-missing",
            variantId: "variant-missing",
            sku: "SKU-MISSING",
            quantity: 1,
            fulfillableQuantity: 1,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([["store-1", []]]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T09:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "order-escalated",
      missing_reason: MISSING_ORDER_REASON_STOCK_SHORTAGE,
      missing_state: "escalated",
      warehouse_shortage_quantity: 1,
      warehouse_shortage_items_count: 1,
    });
    expect(result[0].warehouse_shortage_lines[0]).toMatchObject({
      line_item_id: "line-escalated",
      matched_by: null,
      missing_quantity: 1,
    });
  });

  it("escalates fully coverable orders when no action was recorded for 6 days", () => {
    const orders = [
      buildOrder({
        id: "order-coverable-escalated",
        createdAt: "2026-03-18T09:00:00.000Z",
        lineItems: [
          buildLineItem({
            id: "line-coverable",
            quantity: 1,
            fulfillableQuantity: 1,
          }),
        ],
      }),
    ];

    const result = buildMissingOrdersFromStock({
      orders,
      warehouseRowsByStoreId: new Map([
        ["store-1", [buildWarehouseRow({ quantity: 1 })]],
      ]),
      buildOrderListItem,
      nowTimestamp: new Date("2026-03-26T09:00:00.000Z").getTime(),
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "order-coverable-escalated",
      missing_reason: MISSING_ORDER_REASON_NO_ACTION,
      missing_state: "escalated",
      warehouse_coverable: true,
      warehouse_shortage_quantity: 0,
      days_without_action: 8,
    });
  });
});
