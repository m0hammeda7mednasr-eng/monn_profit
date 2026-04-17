import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const orderModelMock = {
  findByIdForUser: jest.fn(),
};

const shopifyServiceMock = {
  getOrderByIdFromShopify: jest.fn(),
};

const shopifyTokenRows = [];
const persistedOrderUpdates = [];

const createSupabaseBuilder = (table) => {
  const state = {
    filters: [],
    action: "select",
    payload: null,
  };

  const resolveSingleRow = () => {
    if (table !== "shopify_tokens") {
      return null;
    }

    return (
      shopifyTokenRows.find((row) =>
        state.filters.every((filter) => row?.[filter.column] === filter.value),
      ) || null
    );
  };

  const execute = async () => {
    if (state.action === "update") {
      persistedOrderUpdates.push({
        table,
        filters: [...state.filters],
        payload: state.payload,
      });
      return { data: null, error: null };
    }

    return {
      data: resolveSingleRow(),
      error: null,
    };
  };

  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn((column, value) => {
      state.filters.push({ column, value });
      return builder;
    }),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    update: jest.fn((payload) => {
      state.action = "update";
      state.payload = payload;
      return builder;
    }),
    maybeSingle: jest.fn(async () => execute()),
    single: jest.fn(async () => execute()),
    then: (resolve, reject) => Promise.resolve(execute()).then(resolve, reject),
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => createSupabaseBuilder(table)),
};

jest.unstable_mockModule("../models/index.js", () => ({
  Order: orderModelMock,
}));

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

jest.unstable_mockModule("./shopifyService.js", () => ({
  ShopifyService: shopifyServiceMock,
}));

const { OrderManagementService } = await import("./orderManagementService.js");

describe("OrderManagementService.getOrderDetails", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    orderModelMock.findByIdForUser.mockReset();
    shopifyServiceMock.getOrderByIdFromShopify.mockReset();
    shopifyTokenRows.length = 0;
    persistedOrderUpdates.length = 0;
    supabaseMock.from.mockClear();

    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("hydrates incomplete migrated order payloads from Shopify and preserves local metadata", async () => {
    shopifyTokenRows.push({
      user_id: "user-1",
      store_id: "store-1",
      shop: "demo-store.myshopify.com",
      access_token: "token-1",
    });

    orderModelMock.findByIdForUser.mockResolvedValue({
      data: {
        id: "order-1",
        shopify_id: "101",
        store_id: "store-1",
        order_number: 1001,
        customer_name: "Legacy User",
        customer_email: "legacy@example.com",
        customer_phone: "01000000000",
        items_count: 1,
        total_price: "150.00",
        notes: [],
        data: {
          id: 101,
          name: "#1001",
          _moon_profit_local_order: {
            shipping_issue: {
              reason: "part_with_phone",
              shipping_company_note: "Keep courier note",
              customer_service_note: "Customer asked for a callback",
              updated_by_name: "Ops",
            },
          },
        },
      },
      error: null,
    });

    shopifyServiceMock.getOrderByIdFromShopify.mockResolvedValue({
      shopify_id: "101",
      order_number: 1001,
      customer_name: "Fresh User",
      customer_email: "fresh@example.com",
      total_price: "150.00",
      subtotal_price: "140.00",
      total_tax: "10.00",
      total_discounts: "0.00",
      currency: "USD",
      status: "paid",
      fulfillment_status: "unfulfilled",
      items_count: 1,
      updated_at: "2026-04-15T08:00:00.000Z",
      data: {
        id: 101,
        name: "#1001",
        financial_status: "paid",
        line_items: [
          {
            id: "li-1",
            title: "Order item",
            quantity: 1,
            price: "150.00",
            properties: [],
          },
        ],
        customer: {
          id: "customer-1",
          email: "fresh@example.com",
          first_name: "Fresh",
          last_name: "User",
          phone: "01234567890",
        },
        shipping_address: {
          first_name: "Fresh",
          last_name: "User",
          address1: "Nasr City",
          city: "Cairo",
          country: "Egypt",
          phone: "01234567890",
          name: "Fresh User",
        },
        billing_address: {
          first_name: "Fresh",
          last_name: "User",
          address1: "Heliopolis",
          city: "Cairo",
          country: "Egypt",
          name: "Fresh User",
        },
        shipping_lines: [],
        discount_codes: [],
        discount_applications: [],
        tax_lines: [],
        refunds: [],
        fulfillments: [],
        note_attributes: [],
        payment_gateway_names: [],
      },
    });

    const result = await OrderManagementService.getOrderDetails(
      "user-1",
      "order-1",
    );

    expect(shopifyServiceMock.getOrderByIdFromShopify).toHaveBeenCalledWith(
      "token-1",
      "demo-store.myshopify.com",
      "101",
    );
    expect(result.line_items).toHaveLength(1);
    expect(result.shipping_address).toEqual(
      expect.objectContaining({
        address1: "Nasr City",
        city: "Cairo",
      }),
    );
    expect(result.customer_info).toEqual(
      expect.objectContaining({
        email: "fresh@example.com",
        phone: "01234567890",
      }),
    );
    expect(result.shipping_issue).toEqual(
      expect.objectContaining({
        reason: "part_with_phone",
        updated_by_name: "Ops",
      }),
    );
    expect(persistedOrderUpdates).toHaveLength(1);
    expect(persistedOrderUpdates[0]).toEqual(
      expect.objectContaining({
        table: "orders",
        filters: [{ column: "id", value: "order-1" }],
        payload: expect.objectContaining({
          customer_phone: "01234567890",
          status: "paid",
          financial_status: "paid",
          data: expect.objectContaining({
            line_items: expect.any(Array),
            _moon_profit_local_order: expect.objectContaining({
              shipping_issue: expect.objectContaining({
                reason: "part_with_phone",
                shipping_company_note: "Keep courier note",
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("uses the local payload as-is when order details data is already complete", async () => {
    orderModelMock.findByIdForUser.mockResolvedValue({
      data: {
        id: "order-2",
        shopify_id: "202",
        store_id: "store-1",
        order_number: 1002,
        customer_name: "Complete User",
        customer_email: "complete@example.com",
        customer_phone: "01111111111",
        items_count: 1,
        total_price: "90.00",
        notes: "[]",
        data: {
          id: 202,
          name: "#1002",
          financial_status: "paid",
          line_items: [
            {
              id: "li-2",
              title: "Ready item",
              quantity: 1,
              price: "90.00",
              properties: [],
            },
          ],
          customer: {
            id: "customer-2",
            email: "complete@example.com",
            first_name: "Complete",
            last_name: "User",
            phone: "01111111111",
          },
          shipping_address: {
            address1: "Dokki",
            city: "Giza",
            country: "Egypt",
            phone: "01111111111",
            name: "Complete User",
          },
          billing_address: {
            address1: "Dokki",
            city: "Giza",
            country: "Egypt",
            name: "Complete User",
          },
          shipping_lines: [],
          discount_codes: [],
          discount_applications: [],
          tax_lines: [],
          refunds: [],
          fulfillments: [],
          note_attributes: [],
          payment_gateway_names: [],
        },
      },
      error: null,
    });

    const result = await OrderManagementService.getOrderDetails(
      "user-1",
      "order-2",
    );

    expect(shopifyServiceMock.getOrderByIdFromShopify).not.toHaveBeenCalled();
    expect(persistedOrderUpdates).toHaveLength(0);
    expect(result.line_items).toHaveLength(1);
    expect(result.shipping_address).toEqual(
      expect.objectContaining({
        address1: "Dokki",
        city: "Giza",
      }),
    );
  });
});
