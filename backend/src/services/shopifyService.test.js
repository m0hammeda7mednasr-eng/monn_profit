import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import axios from "axios";
import { ShopifyService } from "./shopifyService.js";
import { Product, Order, Customer } from "../models/index.js";

// Mock the server
jest.mock("../server.js", () => ({}));

describe("ShopifyService", () => {
  const accessToken = "test-token";
  const shop = "test-shop.myshopify.com";
  const userId = "test-user-id";

  beforeEach(() => {
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Spy on model methods
    jest.spyOn(Product, 'updateMultiple').mockImplementation(async () => ({ data: [] }));
    jest.spyOn(Order, 'updateMultiple').mockImplementation(async () => ({ data: [] }));
    jest.spyOn(Customer, 'updateMultiple').mockImplementation(async () => ({ data: [] }));
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });
  
  describe("syncAllData", () => {
    it("should sync all data correctly with pagination", async () => {
      // --- MOCK API RESPONSES ---
      const getSpy = jest.spyOn(axios, 'get');

      // Products
      getSpy.mockImplementation((url) => {
        if (url.includes("products.json?page_info=next_page_products")) {
          // Products - Page 2 (last page)
          return Promise.resolve({
            data: { products: [{ id: "p2", title: "Product 2", variants: [{}] }] },
            headers: {
              link: `<https://${shop}/admin/api/2024-01/products.json?page_info=prev_page_products>; rel="previous"`,
            },
          });
        }
        if (url.includes("products.json")) {
          // Products - Page 1
          return Promise.resolve({
            data: { products: [{ id: "p1", title: "Product 1", variants: [{}] }] },
            headers: {
              link: `<https://${shop}/admin/api/2024-01/products.json?page_info=next_page_products>; rel="next"`,
            },
          });
        }
        if (url.includes("orders.json")) {
          // Orders - Single Page
          return Promise.resolve({
            data: { orders: [{ id: "o1", order_number: 1001, line_items: [] }] },
            headers: {},
          });
        }
        if (url.includes("customers.json")) {
          // Customers - Single Page
          return Promise.resolve({
            data: { customers: [{ id: "c1", email: "test@example.com" }] },
            headers: {},
          });
        }
        return Promise.resolve({ data: {} });
      });

      // --- RUN THE SYNC ---
      const result = await ShopifyService.syncAllData(userId, shop, accessToken);

      // --- ASSERTIONS ---
      
      // Check if data was fetched correctly
      expect(axios.get).toHaveBeenCalledWith(
        `https://${shop}/admin/api/2024-01/products.json?limit=250`,
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenCalledWith(
        `https://${shop}/admin/api/2024-01/products.json?page_info=next_page_products`,
        expect.any(Object)
      );
      expect(axios.get).toHaveBeenCalledWith(
        `https://${shop}/admin/api/2024-01/orders.json?limit=250&status=any`,
        expect.any(Object)
      );
       expect(axios.get).toHaveBeenCalledWith(
        `https://${shop}/admin/api/2024-01/customers.json?limit=250`,
        expect.any(Object)
      );

      // Check if DB updates were called with the correct, combined data
      expect(Product.updateMultiple).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ shopify_id: "p1" }),
          expect.objectContaining({ shopify_id: "p2" }),
        ])
      );
      expect(Product.updateMultiple).toHaveBeenCalledTimes(1);

      expect(Order.updateMultiple).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ shopify_id: "o1" })
        ])
      );
      expect(Order.updateMultiple).toHaveBeenCalledTimes(1);
      
      expect(Customer.updateMultiple).toHaveBeenCalledWith(
        expect.arrayContaining([
            expect.objectContaining({ shopify_id: "c1" })
        ])
      );
      expect(Customer.updateMultiple).toHaveBeenCalledTimes(1);

      expect(result).toMatchObject({
        counts: {
          products: 2,
          orders: 1,
          customers: 1,
        },
        persisted: {
          products: 0,
          orders: 0,
          customers: 0,
        },
        latestOrder: expect.objectContaining({
          shopify_id: "o1",
        }),
      });
    });

    it("should throw an error if API fetch fails", async () => {
      // Mock a failed API call
      jest.spyOn(axios, 'get').mockRejectedValue(new Error("API is down"));

      // Expect the sync function to throw an error
      await expect(ShopifyService.syncAllData(userId, shop, accessToken))
        .rejects
        .toThrow("Shopify connection failed: API is down");
      
      // Ensure no database calls were made
      expect(Product.updateMultiple).not.toHaveBeenCalled();
      expect(Order.updateMultiple).not.toHaveBeenCalled();
      expect(Customer.updateMultiple).not.toHaveBeenCalled();
    });
    
    it("should handle empty responses from Shopify", async () => {
      // Mock empty responses
      jest.spyOn(axios, 'get').mockResolvedValue({ data: { products: [] }, headers: {} });
      
      await ShopifyService.syncAllData(userId, shop, accessToken);

      // Ensure no database calls were made
      expect(Product.updateMultiple).not.toHaveBeenCalled();
      expect(Order.updateMultiple).not.toHaveBeenCalled();
      expect(Customer.updateMultiple).not.toHaveBeenCalled();
    });

    it("should throw when database persistence returns an error", async () => {
      const getSpy = jest.spyOn(axios, 'get');
      getSpy.mockImplementation((url) => {
        if (url.includes("products.json")) {
          return Promise.resolve({
            data: { products: [{ id: "p1", title: "Product 1", variants: [{}] }] },
            headers: {},
          });
        }
        if (url.includes("orders.json")) {
          return Promise.resolve({
            data: { orders: [] },
            headers: {},
          });
        }
        if (url.includes("customers.json")) {
          return Promise.resolve({
            data: { customers: [] },
            headers: {},
          });
        }
        return Promise.resolve({ data: {} });
      });

      Product.updateMultiple.mockResolvedValue({
        data: [],
        error: { message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" },
      });

      await expect(
        ShopifyService.syncAllData(userId, shop, accessToken),
      ).rejects.toThrow(
        "Failed to persist Shopify products: there is no unique or exclusion constraint matching the ON CONFLICT specification",
      );
    });
  });

  describe("searchOrdersFromShopify", () => {
    it("falls back from hash-prefixed order search terms and hydrates the full Shopify order", async () => {
      const postSpy = jest.spyOn(axios, "post").mockImplementation((url, body) => {
        if (!url.includes("/graphql.json")) {
          return Promise.resolve({ data: { data: { orders: { edges: [] } } } });
        }

        if (body?.variables?.query === "#1001") {
          return Promise.resolve({
            data: {
              data: {
                orders: {
                  edges: [],
                },
              },
            },
          });
        }

        if (body?.variables?.query === "1001") {
          return Promise.resolve({
            data: {
              data: {
                orders: {
                  edges: [
                    {
                      node: {
                        legacyResourceId: "12345",
                      },
                    },
                  ],
                },
              },
            },
          });
        }

        return Promise.resolve({
          data: {
            data: {
              orders: {
                edges: [],
              },
            },
          },
        });
      });
      const getSpy = jest.spyOn(axios, "get").mockResolvedValue({
        data: {
          order: {
            id: "12345",
            order_number: 1001,
            line_items: [],
            customer: {
              email: "order@test.com",
            },
          },
        },
      });

      const result = await ShopifyService.searchOrdersFromShopify(
        accessToken,
        shop,
        "#1001",
      );

      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(postSpy.mock.calls[0][1]?.variables?.query).toBe("#1001");
      expect(postSpy.mock.calls[1][1]?.variables?.query).toBe("1001");
      expect(getSpy).toHaveBeenCalledWith(
        `https://${shop}/admin/api/2024-01/orders/12345.json?status=any`,
        expect.any(Object),
      );
      expect(result).toEqual([
        expect.objectContaining({
          shopify_id: "12345",
          order_number: 1001,
          customer_email: "order@test.com",
        }),
      ]);
    });

    it("returns an empty array when Shopify search finds no matching orders", async () => {
      jest.spyOn(axios, "post").mockResolvedValue({
        data: {
          data: {
            orders: {
              edges: [],
            },
          },
        },
      });
      const getSpy = jest.spyOn(axios, "get");

      const result = await ShopifyService.searchOrdersFromShopify(
        accessToken,
        shop,
        "missing-order",
      );

      expect(result).toEqual([]);
      expect(getSpy).not.toHaveBeenCalled();
    });
  });
});
