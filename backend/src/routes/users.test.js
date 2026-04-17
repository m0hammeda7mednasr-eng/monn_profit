import { beforeEach, describe, expect, it, jest } from "@jest/globals";

let tableData = {};

const matchesFilters = (row, filters = []) =>
  filters.every((filter) => {
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

const createQueryBuilder = (table) => {
  const state = {
    table,
    filters: [],
    orderBy: null,
    limit: null,
  };

  const builder = {
    select: jest.fn(() => builder),
    order: jest.fn((column, options) => {
      state.orderBy = { column, ascending: options?.ascending !== false };
      return builder;
    }),
    limit: jest.fn((value) => {
      state.limit = value;
      return builder;
    }),
    not: jest.fn((column, operator, value) => {
      state.filters.push({ type: "not", column, operator, value });
      return builder;
    }),
    then: (resolve, reject) => {
      let rows = resolveRows(state.table, state.filters);

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

      if (Number.isFinite(state.limit)) {
        rows = rows.slice(0, state.limit);
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
  buildPermissionsForRole: jest.fn(() => ({})),
  clearUserAccessContextCache: jest.fn(),
  requirePermission: jest.fn(() => (req, res, next) => next()),
  DEFAULT_PERMISSIONS: {},
  PERMISSION_KEYS: [],
  normalizePermissions: jest.fn((value) => value || {}),
  normalizeRole: jest.fn((value) => value || "user"),
  primeUserAccessContext: jest.fn(),
}));

jest.unstable_mockModule("../helpers/supabaseRetry.js", () => ({
  isTransientSupabaseError: jest.fn(() => false),
  withSupabaseRetry: jest.fn((callback) => callback()),
}));

jest.unstable_mockModule("../models/index.js", () => ({
  getAccessibleStoreIds: jest.fn(async () => []),
}));

const { getAdminVisibleStores } = await import("./users.js");

describe("routes/users getAdminVisibleStores", () => {
  beforeEach(() => {
    tableData = {
      stores: [],
      shopify_tokens: [],
      products: [],
      orders: [],
      customers: [],
    };
    supabaseMock.from.mockClear();
  });

  it("falls back to Shopify token store mappings when the stores table is empty", async () => {
    tableData.shopify_tokens = [
      {
        store_id: "store-b",
        shop: "beta.myshopify.com",
      },
      {
        store_id: "store-a",
        shop: "alpha.myshopify.com",
      },
    ];

    const stores = await getAdminVisibleStores();

    expect(stores).toEqual([
      { id: "store-a", name: "alpha.myshopify.com" },
      { id: "store-b", name: "beta.myshopify.com" },
    ]);
  });

  it("keeps inferred stores available even without metadata rows", async () => {
    tableData.products = [{ store_id: "12345678-abcd" }];

    const stores = await getAdminVisibleStores();

    expect(stores).toEqual([
      { id: "12345678-abcd", name: "Store 12345678" },
    ]);
  });
});
