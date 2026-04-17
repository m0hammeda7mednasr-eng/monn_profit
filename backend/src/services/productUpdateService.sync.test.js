import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const axiosMock = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
};

const productModelMock = {
  findByIdForUser: jest.fn(),
  update: jest.fn(),
};

const shopifyTokenRows = [];

const createSupabaseBuilder = (table) => {
  const filters = [];

  const resolveSingleRow = () => {
    if (table !== "shopify_tokens") {
      return null;
    }

    return (
      shopifyTokenRows.find((row) =>
        filters.every((filter) => row?.[filter.column] === filter.value),
      ) || null
    );
  };

  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn((column, value) => {
      filters.push({ column, value });
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({
      data: resolveSingleRow(),
      error: null,
    })),
    single: jest.fn(async () => ({
      data: resolveSingleRow(),
      error: null,
    })),
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => createSupabaseBuilder(table)),
};

jest.unstable_mockModule("axios", () => ({
  default: axiosMock,
}));

jest.unstable_mockModule("../models/index.js", () => ({
  Product: productModelMock,
}));

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

const { ProductUpdateService } = await import("./productUpdateService.js");

describe("ProductUpdateService syncToShopify", () => {
  beforeEach(() => {
    axiosMock.get.mockReset();
    axiosMock.post.mockReset();
    axiosMock.put.mockReset();
    productModelMock.findByIdForUser.mockReset();
    productModelMock.update.mockReset();
    shopifyTokenRows.length = 0;
    supabaseMock.from.mockClear();

    jest
      .spyOn(ProductUpdateService, "updateSyncOperationStatus")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("preserves the local warehouse snapshot when Shopify refreshes product data", async () => {
    shopifyTokenRows.push({
      user_id: "user-1",
      store_id: "store-1",
      shop: "demo-store.myshopify.com",
      access_token: "token-1",
    });

    productModelMock.findByIdForUser.mockResolvedValue({
      data: {
        id: "product-1",
        shopify_id: "100",
        store_id: "store-1",
        price: 150,
        sku: "SKU-1",
        inventory_quantity: 4,
        data: {
          variants: [
            {
              id: "101",
              inventory_item_id: "1001",
              price: "150",
              sku: "SKU-1",
              inventory_quantity: 4,
              _moon_profit_warehouse_quantity: 11,
              _moon_profit_warehouse_last_scanned_at: "2026-03-25T10:00:00.000Z",
            },
          ],
          _moon_profit_local_product: {
            supplier_phone: "01012345678",
          },
        },
      },
      error: null,
    });
    productModelMock.update.mockResolvedValue({ error: null });

    const syncedProduct = {
      id: 100,
      updated_at: "2026-03-26T01:00:00.000Z",
      variants: [
        {
          id: 101,
          inventory_item_id: 1001,
          price: "175",
          sku: "SKU-1",
          inventory_quantity: 4,
        },
      ],
    };

    axiosMock.put.mockResolvedValue({
      data: {
        product: syncedProduct,
      },
    });
    axiosMock.get.mockResolvedValue({
      data: {
        product: syncedProduct,
      },
    });

    const result = await ProductUpdateService.syncToShopify(
      "user-1",
      "product-1",
      { price: 175 },
    );

    expect(result).toEqual({ success: true });
    expect(productModelMock.update).toHaveBeenCalledWith(
      "product-1",
      expect.objectContaining({
        pending_sync: false,
        data: expect.objectContaining({
          variants: [
            expect.objectContaining({
              id: 101,
              price: "175",
              _moon_profit_warehouse_quantity: 11,
              _moon_profit_warehouse_last_scanned_at: "2026-03-25T10:00:00.000Z",
            }),
          ],
          _moon_profit_local_product: expect.objectContaining({
            supplier_phone: "01012345678",
          }),
        }),
      }),
    );
  });
});
