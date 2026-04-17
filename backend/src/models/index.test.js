import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let tableData = {};
let executedQueries = [];
let queryFailures = [];

const matchesFilters = (row, filters = []) =>
  filters.every((filter) => {
    if (filter.type === "eq") {
      return row?.[filter.column] === filter.value;
    }

    if (filter.type === "in") {
      return filter.values.includes(row?.[filter.column]);
    }

    if (filter.type === "not") {
      if (filter.operator === "is" && filter.value === null) {
        return row?.[filter.column] !== null && row?.[filter.column] !== undefined;
      }
    }

    return true;
  });

const resolveRows = (table, filters = []) => {
  const rows = tableData[table] || [];
  return rows.filter((row) => matchesFilters(row, filters));
};

const applyOrderingAndBounds = (rows, state) => {
  let nextRows = [...rows];

  if (state.orderBy?.column) {
    const { column, options } = state.orderBy;
    const ascending = options?.ascending !== false;
    nextRows.sort((left, right) => {
      const leftValue = left?.[column];
      const rightValue = right?.[column];
      if (leftValue === rightValue) return 0;
      if (leftValue === undefined || leftValue === null) return ascending ? -1 : 1;
      if (rightValue === undefined || rightValue === null) return ascending ? 1 : -1;
      return leftValue > rightValue === ascending ? 1 : -1;
    });
  }

  if (Array.isArray(state.rangeValues)) {
    const [from, to] = state.rangeValues;
    nextRows = nextRows.slice(from, to + 1);
  } else if (typeof state.limitCount === "number") {
    nextRows = nextRows.slice(0, state.limitCount);
  }

  return nextRows;
};

const parseConflictColumns = (onConflict) =>
  String(onConflict || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

const findMatchingFailure = (table, filters = [], mode, payload = null, options = null) =>
  queryFailures.find((failure) => {
    if (failure.table !== table) {
      return false;
    }

    if (failure.mode && failure.mode !== mode) {
      return false;
    }

    if (
      failure.onConflict &&
      failure.onConflict !== String(options?.onConflict || "")
    ) {
      return false;
    }

    if (failure.payloadHasField) {
      const payloadRows = Array.isArray(payload) ? payload : [payload];
      const hasMatchingField = payloadRows.some(
        (row) =>
          row &&
          typeof row === "object" &&
          Object.prototype.hasOwnProperty.call(row, failure.payloadHasField),
      );

      if (!hasMatchingField) {
        return false;
      }
    }

    return (failure.filters || []).every((expectedFilter) =>
      filters.some(
        (actualFilter) =>
          actualFilter.type === expectedFilter.type &&
          actualFilter.column === expectedFilter.column,
      ),
    );
  });

const createQueryBuilder = (table) => {
  const state = {
    table,
    filters: [],
    orderBy: null,
    limitCount: null,
    rangeValues: null,
    action: "select",
    payload: null,
    options: null,
  };

  const commitMutation = (rows) => {
    tableData[state.table] = rows;
  };

  const execute = async (finalMode) => {
    const mode = state.action === "select" ? finalMode : state.action;

    executedQueries.push({
      table: state.table,
      filters: [...state.filters],
      orderBy: state.orderBy,
      rangeValues: state.rangeValues,
      limitCount: state.limitCount,
      mode,
      payload: state.payload,
      options: state.options,
    });

    const failure = findMatchingFailure(
      state.table,
      state.filters,
      mode,
      state.payload,
      state.options,
    );
    if (failure) {
      return { data: null, error: failure.error };
    }

    if (state.action === "upsert") {
      const conflictColumns = parseConflictColumns(state.options?.onConflict);
      const nextRows = [...(tableData[state.table] || [])];
      const payloadRows = Array.isArray(state.payload) ? state.payload : [state.payload];
      const persistedRows = payloadRows.map((row) => {
        const existingIndex =
          conflictColumns.length > 0
            ? nextRows.findIndex((existingRow) =>
                conflictColumns.every(
                  (column) => existingRow?.[column] === row?.[column],
                ),
              )
            : -1;

        const nextRow =
          existingIndex >= 0
            ? { ...nextRows[existingIndex], ...row }
            : { ...row };

        if (existingIndex >= 0) {
          nextRows[existingIndex] = nextRow;
        } else {
          nextRows.push(nextRow);
        }

        return nextRow;
      });

      commitMutation(nextRows);
      return { data: persistedRows, error: null };
    }

    if (state.action === "insert") {
      const payloadRows = Array.isArray(state.payload) ? state.payload : [state.payload];
      const persistedRows = payloadRows.map((row) => ({ ...row }));
      commitMutation([...(tableData[state.table] || []), ...persistedRows]);
      return {
        data: finalMode === "single" ? persistedRows[0] || null : persistedRows,
        error: null,
      };
    }

    if (state.action === "update") {
      const updatedRows = [];
      const nextRows = (tableData[state.table] || []).map((row) => {
        if (!matchesFilters(row, state.filters)) {
          return row;
        }

        const nextRow = { ...row, ...state.payload };
        updatedRows.push(nextRow);
        return nextRow;
      });

      commitMutation(nextRows);
      return {
        data: finalMode === "single" ? updatedRows[0] || null : updatedRows,
        error: null,
      };
    }

    const rows = applyOrderingAndBounds(resolveRows(state.table, state.filters), state);
    return {
      data:
        finalMode === "maybeSingle" || finalMode === "single"
          ? rows[0] || null
          : rows,
      error: null,
    };
  };

  const builder = {
    select: jest.fn(() => builder),
    order: jest.fn((column, options) => {
      state.orderBy = { column, options };
      return builder;
    }),
    limit: jest.fn((count) => {
      state.limitCount = count;
      return builder;
    }),
    range: jest.fn((from, to) => {
      state.rangeValues = [from, to];
      return builder;
    }),
    eq: jest.fn((column, value) => {
      state.filters.push({ type: "eq", column, value });
      return builder;
    }),
    in: jest.fn((column, values) => {
      state.filters.push({ type: "in", column, values });
      return builder;
    }),
    not: jest.fn((column, operator, value) => {
      state.filters.push({ type: "not", column, operator, value });
      return builder;
    }),
    upsert: jest.fn((payload, options = {}) => {
      state.action = "upsert";
      state.payload = payload;
      state.options = options;
      return builder;
    }),
    insert: jest.fn((payload) => {
      state.action = "insert";
      state.payload = payload;
      return builder;
    }),
    update: jest.fn((payload) => {
      state.action = "update";
      state.payload = payload;
      return builder;
    }),
    maybeSingle: jest.fn(async () => execute("maybeSingle")),
    single: jest.fn(async () => execute("single")),
    then: (resolve, reject) =>
      Promise.resolve(execute("list")).then(resolve, reject),
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => createQueryBuilder(table)),
};

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

const { Product, Customer, ShopifyToken, getAccessibleStoreIds } = await import("./index.js");

describe("models/index Shopify scoping", () => {
  beforeEach(() => {
    tableData = {
      stores: [],
      users: [],
      user_stores: [],
      shopify_tokens: [],
      products: [],
      orders: [],
      customers: [],
    };
    executedQueries = [];
    queryFailures = [];
    supabaseMock.from.mockClear();
  });

  it("falls back to user-scoped product lists only when no shared store scope can be discovered", async () => {
    tableData.products = [
      { id: "product-1", shopify_id: "shopify-1", user_id: "owner-1" },
      { id: "product-2", shopify_id: "shopify-2", user_id: "owner-2" },
    ];

    const result = await Product.findByUser("employee-1");

    expect(result).toEqual({ data: [], error: null });

    const productQueries = executedQueries.filter(
      (query) => query.table === "products",
    );

    expect(productQueries.length).toBeGreaterThan(0);
    expect(
      productQueries.some((query) =>
        query.filters.some(
          (filter) =>
            filter.type === "eq" &&
            filter.column === "user_id" &&
            filter.value === "employee-1",
        ),
      ),
    ).toBe(true);
    expect(
      productQueries.some((query) => query.filters.length === 0),
    ).toBe(false);
  });

  it("does not fall back to unscoped Shopify product lookup by id", async () => {
    tableData.products = [
      { id: "product-1", shopify_id: "shopify-1", user_id: "owner-1" },
    ];

    const result = await Product.findByIdForUser("employee-1", "product-1");

    expect(result).toEqual({ data: null, error: null });

    const productQueries = executedQueries.filter(
      (query) => query.table === "products",
    );

    const lookupQuery = productQueries.find(
      (query) => query.mode === "maybeSingle",
    );

    expect(lookupQuery).toBeDefined();
    expect(lookupQuery.filters).toEqual(
      expect.arrayContaining([
        { type: "eq", column: "id", value: "product-1" },
        { type: "eq", column: "user_id", value: "employee-1" },
      ]),
    );
    expect(
      productQueries.some(
        (query) =>
          query.mode === "maybeSingle" &&
          query.filters.length === 1 &&
          query.filters[0].column === "id",
      ),
    ).toBe(false);
  });

  it("falls back to legacy user-scoped product lists when store-scoped queries fail", async () => {
    tableData.user_stores = [
      { user_id: "employee-1", store_id: "store-1" },
    ];
    tableData.products = [
      { id: "legacy-product", shopify_id: "legacy-1", user_id: "employee-1" },
    ];
    queryFailures = [
      {
        table: "products",
        mode: "list",
        filters: [{ type: "in", column: "store_id" }],
        error: { message: "statement timeout" },
      },
    ];

    const result = await Product.findByUser("employee-1");

    expect(result).toEqual({
      data: [
        { id: "legacy-product", shopify_id: "legacy-1", user_id: "employee-1" },
      ],
      error: null,
    });
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "list" &&
          query.filters.some(
            (filter) =>
              filter.type === "in" && filter.column === "store_id",
          ),
      ),
    ).toBe(true);
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "list" &&
          query.filters.some(
            (filter) =>
              filter.type === "eq" &&
              filter.column === "user_id" &&
              filter.value === "employee-1",
          ),
      ),
    ).toBe(true);
  });

  it("falls back to legacy user-scoped product lookup when store-scoped lookup fails", async () => {
    tableData.user_stores = [
      { user_id: "employee-1", store_id: "store-1" },
    ];
    tableData.products = [
      { id: "legacy-product", shopify_id: "legacy-1", user_id: "employee-1" },
    ];
    queryFailures = [
      {
        table: "products",
        mode: "maybeSingle",
        filters: [{ type: "in", column: "store_id" }],
        error: { message: "statement timeout" },
      },
    ];

    const result = await Product.findByIdForUser("employee-1", "legacy-product");

    expect(result).toEqual({
      data: { id: "legacy-product", shopify_id: "legacy-1", user_id: "employee-1" },
      error: null,
    });
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "maybeSingle" &&
          query.filters.some(
            (filter) =>
              filter.type === "eq" &&
              filter.column === "user_id" &&
              filter.value === "employee-1",
          ),
      ),
    ).toBe(true);
  });

  it("inherits store access from the creator account when explicit user-store mappings are missing", async () => {
    tableData.users = [
      { id: "employee-1", created_by: "admin-1" },
      { id: "admin-1", created_by: null },
    ];
    tableData.user_stores = [{ user_id: "admin-1", store_id: "store-1" }];

    const storeIds = await getAccessibleStoreIds("employee-1");

    expect(storeIds).toEqual(["store-1"]);
  });

  it("falls back to the single shared store when no explicit mapping exists", async () => {
    tableData.stores = [{ id: "store-1" }];

    const storeIds = await getAccessibleStoreIds("shared-store-user");

    expect(storeIds).toEqual(["store-1"]);
  });

  it("does not guess a store when multiple shared stores exist", async () => {
    tableData.stores = [{ id: "store-1" }, { id: "store-2" }];

    const storeIds = await getAccessibleStoreIds("multi-store-user");

    expect(storeIds).toEqual([]);
  });

  it("returns creator store products for employees without leaking unrelated legacy rows", async () => {
    tableData.users = [
      { id: "employee-1", created_by: "admin-1" },
      { id: "admin-1", created_by: null },
    ];
    tableData.user_stores = [{ user_id: "admin-1", store_id: "store-1" }];
    tableData.products = [
      {
        id: "shared-product",
        shopify_id: "shared-1",
        store_id: "store-1",
        user_id: "owner-1",
      },
      {
        id: "legacy-product",
        shopify_id: "legacy-1",
        user_id: "employee-1",
      },
    ];

    const result = await Product.findByUser("employee-1");

    expect(result).toEqual({
      data: [
        {
          id: "shared-product",
          shopify_id: "shared-1",
          store_id: "store-1",
          user_id: "owner-1",
        },
      ],
      error: null,
    });
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "list" &&
          query.filters.some(
            (filter) =>
              filter.type === "in" &&
              filter.column === "store_id" &&
              filter.values.includes("store-1"),
          ),
      ),
    ).toBe(true);
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "list" &&
          query.filters.some(
            (filter) =>
              filter.type === "eq" &&
              filter.column === "user_id" &&
              filter.value === "employee-1",
          ),
      ),
    ).toBe(false);
  });

  it("returns shared-store products for unmapped users when the deployment has exactly one store", async () => {
    tableData.stores = [{ id: "store-1" }];
    tableData.products = [
      {
        id: "shared-product",
        shopify_id: "shared-1",
        store_id: "store-1",
        user_id: "owner-1",
      },
    ];

    const result = await Product.findByUser("shared-store-products-user");

    expect(result).toEqual({
      data: [
        {
          id: "shared-product",
          shopify_id: "shared-1",
          store_id: "store-1",
          user_id: "owner-1",
        },
      ],
      error: null,
    });
  });

  it("loads batched product rows beyond the first 1000 shared-store records", async () => {
    tableData.stores = [{ id: "store-1" }];
    tableData.products = Array.from({ length: 1205 }, (_, index) => ({
      id: `shared-product-${index + 1}`,
      shopify_id: `shared-shopify-${index + 1}`,
      store_id: "store-1",
      user_id: "owner-1",
    }));

    const result = await Product.findByUser("shared-store-products-user");

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1205);

    const scopedQueries = executedQueries.filter(
      (query) =>
        query.table === "products" &&
        query.mode === "list" &&
        query.filters.some(
          (filter) =>
            filter.type === "in" &&
            filter.column === "store_id" &&
            filter.values.includes("store-1"),
        ),
    );

    expect(scopedQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rangeValues: [0, 999] }),
        expect.objectContaining({ rangeValues: [1000, 1999] }),
      ]),
    );
  });

  it("does not fall back to legacy user-scoped rows when store access exists but the store has no matching products", async () => {
    tableData.users = [
      { id: "employee-1", created_by: "admin-1" },
      { id: "admin-1", created_by: null },
    ];
    tableData.user_stores = [{ user_id: "admin-1", store_id: "store-1" }];
    tableData.products = [
      {
        id: "legacy-product",
        shopify_id: "legacy-1",
        user_id: "employee-1",
      },
    ];

    const result = await Product.findByUser("employee-1");

    expect(result).toEqual({ data: [], error: null });
    expect(
      executedQueries.some(
        (query) =>
          query.table === "products" &&
          query.mode === "list" &&
          query.filters.some(
            (filter) =>
              filter.type === "eq" &&
              filter.column === "user_id" &&
              filter.value === "employee-1",
          ),
      ),
    ).toBe(false);
  });

  it("uses store-scoped conflict keys for Shopify product upserts", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-1",
        store_id: "store-1",
        title: "Before",
      },
    ];

    const result = await Product.updateMultiple([
      {
        id: "product-1",
        shopify_id: "shopify-1",
        store_id: "store-1",
        title: "After",
      },
    ]);

    expect(result.error).toBeNull();
    expect(
      executedQueries.find(
        (query) => query.table === "products" && query.mode === "upsert",
      ),
    ).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          onConflict: "shopify_id,store_id",
        }),
      }),
    );
    expect(tableData.products[0].title).toBe("After");
  });

  it("falls back to update existing Shopify tokens when upsert conflict support is missing", async () => {
    tableData.shopify_tokens = [
      {
        id: "token-row-1",
        user_id: "user-1",
        shop: "store-a.myshopify.com",
        access_token: "old-token",
        store_id: "store-old",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    queryFailures = [
      {
        table: "shopify_tokens",
        mode: "upsert",
        onConflict: "user_id,shop",
        error: {
          message:
            "there is no unique or exclusion constraint matching the ON CONFLICT specification",
        },
      },
    ];

    const result = await ShopifyToken.save(
      "user-1",
      "store-a.myshopify.com",
      "new-token",
      "store-new",
    );

    expect(result.error).toBeNull();
    expect(tableData.shopify_tokens).toEqual([
      expect.objectContaining({
        id: "token-row-1",
        user_id: "user-1",
        shop: "store-a.myshopify.com",
        access_token: "new-token",
        store_id: "store-new",
      }),
    ]);
    expect(
      executedQueries.some(
        (query) =>
          query.table === "shopify_tokens" &&
          query.mode === "update" &&
          query.filters.some(
            (filter) =>
              filter.type === "eq" &&
              filter.column === "id" &&
              filter.value === "token-row-1",
          ),
      ),
    ).toBe(true);
  });

  it("preserves local cost fields and warehouse metadata during Shopify product upserts", async () => {
    tableData.products = [
      {
        id: "product-1",
        shopify_id: "shopify-1",
        store_id: "store-1",
        title: "Before",
        cost_price: 180,
        ads_cost: 14,
        operation_cost: 9,
        shipping_cost: 11,
        data: {
          variants: [
            {
              id: "variant-1",
              sku: "SKU-1",
              inventory_quantity: 4,
              _moon_profit_warehouse_quantity: 12,
            },
          ],
          _moon_profit_local_product: {
            supplier_phone: "01012345678",
          },
        },
      },
    ];

    const result = await Product.updateMultiple([
      {
        id: "product-1",
        shopify_id: "shopify-1",
        store_id: "store-1",
        title: "After",
        cost_price: 25,
        data: {
          variants: [
            {
              id: "variant-1",
              sku: "SKU-1",
              inventory_quantity: 7,
            },
          ],
        },
      },
    ]);

    expect(result.error).toBeNull();
    expect(tableData.products[0]).toEqual(
      expect.objectContaining({
        title: "After",
        cost_price: 180,
        ads_cost: 14,
        operation_cost: 9,
        shipping_cost: 11,
        data: expect.objectContaining({
          variants: [
            expect.objectContaining({
              id: "variant-1",
              inventory_quantity: 7,
              _moon_profit_warehouse_quantity: 12,
            }),
          ],
          _moon_profit_local_product: expect.objectContaining({
            supplier_phone: "01012345678",
          }),
        }),
      }),
    );
  });

  it("does not reset local cost price to zero when Shopify product sync sends zero cost", async () => {
    tableData.products = [
      {
        id: "product-2",
        shopify_id: "shopify-2",
        store_id: "store-1",
        title: "Saved Product",
        cost_price: 245,
        ads_cost: 20,
        operation_cost: 12,
        shipping_cost: 18,
        data: {
          variants: [
            {
              id: "variant-2",
              sku: "SKU-2",
              inventory_quantity: 3,
            },
          ],
        },
      },
    ];

    const result = await Product.updateMultiple([
      {
        id: "product-2",
        shopify_id: "shopify-2",
        store_id: "store-1",
        title: "Saved Product",
        cost_price: 0,
        data: {
          variants: [
            {
              id: "variant-2",
              sku: "SKU-2",
              inventory_quantity: 6,
            },
          ],
        },
      },
    ]);

    expect(result.error).toBeNull();
    expect(tableData.products[0]).toEqual(
      expect.objectContaining({
        cost_price: 245,
        ads_cost: 20,
        operation_cost: 12,
        shipping_cost: 18,
        data: expect.objectContaining({
          variants: [
            expect.objectContaining({
              id: "variant-2",
              inventory_quantity: 6,
            }),
          ],
        }),
      }),
    );
  });

  it("drops unsupported sync columns and retries customer upserts", async () => {
    queryFailures = [
      {
        table: "customers",
        mode: "upsert",
        onConflict: "shopify_id,store_id",
        payloadHasField: "last_synced_at",
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'last_synced_at' column of 'customers' in the schema cache",
        },
      },
    ];

    const result = await Customer.updateMultiple([
      {
        shopify_id: "customer-1",
        store_id: "store-1",
        name: "Alice",
        last_synced_at: "2026-03-25T00:00:00.000Z",
      },
    ]);

    expect(result.error).toBeNull();

    const upsertQueries = executedQueries.filter(
      (query) => query.table === "customers" && query.mode === "upsert",
    );

    expect(upsertQueries).toHaveLength(2);
    expect(upsertQueries[0].payload[0]).toHaveProperty("last_synced_at");
    expect(upsertQueries[1].payload[0]).not.toHaveProperty("last_synced_at");
    expect(tableData.customers[0]).not.toHaveProperty("last_synced_at");
  });

  it("skips bulk Shopify upserts for legacy rows without store scope", async () => {
    const result = await Customer.updateMultiple([
      {
        shopify_id: "legacy-customer-1",
        user_id: "user-1",
        name: "Legacy Customer",
      },
    ]);

    expect(result.error).toBeNull();
    expect(
      executedQueries.some(
        (query) => query.table === "customers" && query.mode === "upsert",
      ),
    ).toBe(false);
    expect(
      executedQueries.some(
        (query) => query.table === "customers" && query.mode === "insert",
      ),
    ).toBe(true);
  });
});
