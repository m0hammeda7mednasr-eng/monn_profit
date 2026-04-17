import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let tableData = {};

const matchesFilters = (row, filters = []) =>
  filters.every((filter) => {
    if (filter.type === "eq") {
      return row?.[filter.column] === filter.value;
    }

    return true;
  });

const createQueryBuilder = (table) => {
  const state = {
    table,
    filters: [],
    orderBy: null,
  };

  const builder = {
    select: jest.fn(() => builder),
    order: jest.fn((column, options) => {
      state.orderBy = { column, ascending: options?.ascending !== false };
      return builder;
    }),
    eq: jest.fn((column, value) => {
      state.filters.push({ type: "eq", column, value });
      return builder;
    }),
    then: (resolve, reject) => {
      let rows = (tableData[state.table] || []).filter((row) =>
        matchesFilters(row, state.filters),
      );

      if (state.orderBy?.column) {
        const { column, ascending } = state.orderBy;
        rows = [...rows].sort((left, right) => {
          const leftValue = String(left?.[column] || "");
          const rightValue = String(right?.[column] || "");
          return ascending
            ? leftValue.localeCompare(rightValue)
            : rightValue.localeCompare(leftValue);
        });
      }

      return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
    },
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => createQueryBuilder(table)),
};

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

jest.unstable_mockModule("../middleware/auth.js", () => ({
  authenticateToken: jest.fn((req, res, next) => next()),
}));

jest.unstable_mockModule("../middleware/permissions.js", () => ({
  requirePermission: jest.fn(() => (req, res, next) => next()),
}));

jest.unstable_mockModule("../models/index.js", () => ({
  getAccessibleStoreIds: jest.fn(async () => []),
}));

jest.unstable_mockModule("../helpers/dataFilter.js", () => ({
  applyUserFilter: jest.fn((query, userId) => query.eq("assigned_to", userId)),
}));

const { buildAnalyticsPayload } = await import("./productAnalysis.js");

describe("routes/productAnalysis buildAnalyticsPayload", () => {
  beforeEach(() => {
    tableData = {
      products: [],
      orders: [],
      tasks: [],
    };
    supabaseMock.from.mockClear();
  });

  it("counts only tasks from the selected store", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-product-1",
        store_id: "store-1",
        title: "Product One",
        sku: "SKU-1",
        inventory_quantity: 5,
        data: {
          variants: [
            {
              id: "variant-1",
              title: "Default",
              sku: "SKU-1",
              inventory_quantity: 5,
            },
          ],
        },
      },
    ];
    tableData.tasks = [
      {
        id: "task-1",
        store_id: "store-1",
        title: "Follow up SKU-1",
        description: "",
        status: "pending",
        created_at: "2026-03-01T10:00:00.000Z",
        updated_at: "2026-03-01T10:00:00.000Z",
      },
      {
        id: "task-2",
        store_id: "store-2",
        title: "Old store SKU-1",
        description: "",
        status: "completed",
        created_at: "2026-03-02T10:00:00.000Z",
        updated_at: "2026-03-02T10:00:00.000Z",
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.meta.task_metrics_available).toBe(true);
    expect(payload.summary.related_tasks_count).toBe(1);
    expect(payload.data[0].related_tasks_count).toBe(1);
    expect(payload.data[0].completed_tasks_count).toBe(0);
  });

  it("uses MoonProfit status and refund math to compute product revenue accurately", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-product-1",
        store_id: "store-1",
        title: "Product One",
        sku: "SKU-1",
        inventory_quantity: 5,
        data: {
          variants: [
            {
              id: "variant-1",
              title: "Default",
              sku: "SKU-1",
              inventory_quantity: 5,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-1",
        store_id: "store-1",
        financial_status: "pending",
        fulfillment_status: "fulfilled",
        total_price: 200,
        created_at: "2026-03-01T09:00:00.000Z",
        updated_at: "2026-03-01T12:00:00.000Z",
        data: {
          current_total_price: 110,
          note_attributes: [
            {
              name: "moon_profit_status",
              value: "partially_refunded",
            },
          ],
          line_items: [
            {
              id: "line-1",
              product_id: "shopify-product-1",
              variant_id: "variant-1",
              sku: "SKU-1",
              quantity: 2,
              current_quantity: 1,
              price: "100",
              total_discount: "20",
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    const product = payload.data[0];
    const variant = product.variants[0];

    expect(product.ordered_quantity).toBe(2);
    expect(product.delivered_quantity).toBe(2);
    expect(product.returned_quantity).toBe(1);
    expect(product.net_delivered_quantity).toBe(1);
    expect(product.gross_sales).toBe(180);
    expect(product.net_sales).toBe(90);
    expect(product.paid_orders_count).toBe(1);
    expect(variant.gross_sales).toBe(180);
    expect(variant.net_sales).toBe(90);
    expect(payload.summary.gross_sales).toBe(180);
    expect(payload.summary.net_sales).toBe(90);
  });

  it("does not mark an item as delivered just because fulfillable_quantity is missing", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-product-1",
        store_id: "store-1",
        title: "Product One",
        sku: "SKU-1",
        inventory_quantity: 5,
        data: {
          variants: [
            {
              id: "variant-1",
              title: "Default",
              sku: "SKU-1",
              inventory_quantity: 5,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-2",
        store_id: "store-1",
        financial_status: "paid",
        fulfillment_status: "",
        total_price: 100,
        created_at: "2026-03-03T09:00:00.000Z",
        updated_at: "2026-03-03T12:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-2",
              product_id: "shopify-product-1",
              variant_id: "variant-1",
              sku: "SKU-1",
              quantity: 1,
              price: "100",
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.data[0].delivered_quantity).toBe(0);
    expect(payload.data[0].pending_quantity).toBe(1);
    expect(payload.data[0].net_delivered_quantity).toBe(0);
  });

  it("includes booked sales from pending orders inside the default all-orders scope", async () => {
    tableData.products = [
      {
        id: "product-pending",
        shopify_id: "shopify-product-pending",
        store_id: "store-1",
        title: "Pending Sales Product",
        sku: "SKU-PENDING-SALES",
        inventory_quantity: 8,
        data: {
          variants: [
            {
              id: "variant-pending",
              title: "Default",
              sku: "SKU-PENDING-SALES",
              inventory_quantity: 8,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-pending-sales",
        store_id: "store-1",
        financial_status: "pending",
        fulfillment_status: "",
        total_price: 150,
        created_at: "2026-03-04T09:00:00.000Z",
        updated_at: "2026-03-04T10:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-pending-sales",
              product_id: "shopify-product-pending",
              variant_id: "variant-pending",
              sku: "SKU-PENDING-SALES",
              quantity: 1,
              price: "150",
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].ordered_quantity).toBe(1);
    expect(payload.data[0].pending_quantity).toBe(1);
    expect(payload.data[0].gross_sales).toBe(150);
    expect(payload.data[0].net_sales).toBe(150);
    expect(payload.data[0].paid_orders_count).toBe(0);
    expect(payload.summary.gross_sales).toBe(150);
    expect(payload.summary.net_sales).toBe(150);
  });

  it("treats restocked orders as fully returned even when Shopify refund totals are missing", async () => {
    tableData.products = [
      {
        id: "product-restocked",
        shopify_id: "shopify-product-restocked",
        store_id: "store-1",
        title: "Restocked Product",
        sku: "SKU-RESTOCKED",
        inventory_quantity: 6,
        data: {
          variants: [
            {
              id: "variant-restocked",
              title: "Default",
              sku: "SKU-RESTOCKED",
              inventory_quantity: 6,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-restocked",
        store_id: "store-1",
        financial_status: "paid",
        fulfillment_status: "restocked",
        total_price: 120,
        created_at: "2026-03-05T09:00:00.000Z",
        updated_at: "2026-03-05T10:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-restocked",
              product_id: "shopify-product-restocked",
              variant_id: "variant-restocked",
              sku: "SKU-RESTOCKED",
              quantity: 1,
              price: "120",
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].delivered_quantity).toBe(1);
    expect(payload.data[0].returned_quantity).toBe(1);
    expect(payload.data[0].net_delivered_quantity).toBe(0);
    expect(payload.data[0].gross_sales).toBe(120);
    expect(payload.data[0].net_sales).toBe(0);
    expect(payload.summary.returned_quantity).toBe(1);
    expect(payload.summary.net_sales).toBe(0);
  });

  it("matches variants by line item variant title before falling back to the first product variant", async () => {
    tableData.products = [
      {
        id: "product-variants",
        shopify_id: "shopify-product-variants",
        store_id: "store-1",
        title: "Variant Match Product",
        sku: "",
        inventory_quantity: 10,
        data: {
          variants: [
            {
              id: "variant-red",
              title: "Red",
              sku: "",
              inventory_quantity: 5,
            },
            {
              id: "variant-blue",
              title: "Blue",
              sku: "",
              inventory_quantity: 5,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-variant-title",
        store_id: "store-1",
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        total_price: 90,
        created_at: "2026-03-06T09:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-variant-title",
              product_id: "shopify-product-variants",
              quantity: 1,
              price: "90",
              title: "Variant Match Product",
              name: "Variant Match Product - Blue",
              variant_title: "Blue",
            },
          ],
          fulfillments: [
            {
              created_at: "2026-03-06T09:30:00.000Z",
              line_items: [{ id: "line-variant-title", quantity: 1 }],
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].ordered_quantity).toBe(1);
    expect(payload.data[0].variants[0].ordered_quantity).toBe(0);
    expect(payload.data[0].variants[1].ordered_quantity).toBe(1);
    expect(payload.data[0].variants[1].gross_sales).toBe(90);
    expect(payload.data[0].variants[1].net_sales).toBe(90);
  });

  it("matches Shopify GIDs to numeric product ids and keeps money-set line totals", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "123456789",
        store_id: "store-1",
        title: "Money Set Product",
        sku: "SKU-MONEY",
        inventory_quantity: 3,
        data: {
          variants: [
            {
              id: "987654321",
              title: "Default",
              sku: "SKU-MONEY",
              inventory_quantity: 3,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-money-set",
        store_id: "store-1",
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        total_price: 88.5,
        created_at: "2026-03-04T09:00:00.000Z",
        updated_at: "2026-03-04T10:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-money-set",
              product_id: "gid://shopify/Product/123456789",
              variant_id: "gid://shopify/ProductVariant/987654321",
              sku: "SKU-MONEY",
              quantity: 1,
              discounted_total_set: {
                shop_money: {
                  amount: "88.50",
                },
              },
            },
          ],
          fulfillments: [
            {
              created_at: "2026-03-04T09:30:00.000Z",
              line_items: [{ id: "line-money-set", quantity: 1 }],
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
    );

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].gross_sales).toBe(88.5);
    expect(payload.data[0].net_sales).toBe(88.5);
    expect(payload.data[0].variants[0].gross_sales).toBe(88.5);
    expect(payload.summary.net_sales).toBe(88.5);
  });

  it("applies scoped order filters and removes products with no matching order activity", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-product-1",
        store_id: "store-1",
        title: "Paid Product",
        sku: "SKU-PAID",
        inventory_quantity: 5,
        data: {
          variants: [
            {
              id: "variant-1",
              title: "Default",
              sku: "SKU-PAID",
              inventory_quantity: 5,
            },
          ],
        },
      },
      {
        id: "product-2",
        shopify_id: "shopify-product-2",
        store_id: "store-1",
        title: "Pending Product",
        sku: "SKU-PENDING",
        inventory_quantity: 4,
        data: {
          variants: [
            {
              id: "variant-2",
              title: "Default",
              sku: "SKU-PENDING",
              inventory_quantity: 4,
            },
          ],
        },
      },
    ];
    tableData.orders = [
      {
        id: "order-paid",
        store_id: "store-1",
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        total_price: 100,
        created_at: "2026-03-01T09:00:00.000Z",
        updated_at: "2026-03-01T12:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-paid",
              product_id: "shopify-product-1",
              variant_id: "variant-1",
              sku: "SKU-PAID",
              quantity: 1,
              price: "100",
            },
          ],
          fulfillments: [
            {
              created_at: "2026-03-01T10:00:00.000Z",
              line_items: [{ id: "line-paid", quantity: 1 }],
            },
          ],
        },
      },
      {
        id: "order-pending",
        store_id: "store-1",
        financial_status: "pending",
        fulfillment_status: "",
        total_price: 200,
        created_at: "2026-03-02T09:00:00.000Z",
        updated_at: "2026-03-02T12:00:00.000Z",
        data: {
          line_items: [
            {
              id: "line-pending",
              product_id: "shopify-product-2",
              variant_id: "variant-2",
              sku: "SKU-PENDING",
              quantity: 2,
              price: "100",
            },
          ],
        },
      },
    ];

    const payload = await buildAnalyticsPayload(
      {
        user: {
          id: "admin-1",
          role: "admin",
          isAdmin: true,
        },
      },
      "store-1",
      {
        payment_status: "paid",
      },
    );

    expect(payload.meta.order_scope_active).toBe(true);
    expect(payload.meta.filtered_orders_count).toBe(1);
    expect(payload.summary.total_products).toBe(1);
    expect(payload.summary.ordered_quantity).toBe(1);
    expect(payload.summary.net_sales).toBe(100);
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].title).toBe("Paid Product");
  });
});
