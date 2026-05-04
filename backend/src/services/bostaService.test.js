/**
 * Bosta Service Tests
 */

// Set environment variables before importing anything
process.env.BOSTA_API_KEY = "test-api-key";

import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import BostaService, {
  BOSTA_ORDER_TYPES,
  BOSTA_PACKAGE_TYPES,
  BOSTA_DELIVERY_STATES,
} from "./bostaService.js";

// Mock fetch
global.fetch = jest.fn();

// Mock Supabase client
jest.mock("../supabaseClient.js", () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => ({ data: { id: "test-id" }, error: null })),
        })),
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => ({ data: { id: "test-id" }, error: null })),
          })),
        })),
      })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => ({ data: { id: "test-id" }, error: null })),
        })),
      })),
    })),
  },
}));

describe("BostaService", () => {
  let bostaService;

  beforeEach(() => {
    bostaService = new BostaService();
    fetch.mockClear();
  });

  describe("Constructor", () => {
    test("should initialize with API key", () => {
      expect(bostaService.apiKey).toBe("test-api-key");
    });
  });

  describe("makeRequest", () => {
    test("should make successful API request", async () => {
      const mockResponse = { success: true, data: "test" };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await bostaService.makeRequest("/test");

      expect(fetch).toHaveBeenCalledWith(
        "https://app.bosta.co/api/v2/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "test-api-key",
            "Content-Type": "application/json",
          }),
        }),
      );
      expect(result).toEqual(mockResponse);
    });

    test("should handle API errors", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: "Bad Request" }),
      });

      await expect(bostaService.makeRequest("/test")).rejects.toThrow(
        "Bosta API Error: 400 - Bad Request",
      );
    });
  });

  describe("convertShopifyOrderToBosta", () => {
    const mockShopifyOrder = {
      id: "order-123",
      order_number: "ORD-001",
      total_price: "100.00",
      financial_status: "pending",
      shipping_address: {
        first_name: "أحمد",
        last_name: "محمد",
        address1: "شارع التحرير",
        address2: "الدور الثالث",
        city: "القاهرة",
        province: "القاهرة",
        phone: "+201234567890",
      },
      line_items: [
        {
          name: "تيشيرت قطني",
          title: "تيشيرت قطني",
          quantity: 2,
          price: "50.00",
        },
      ],
    };

    test("should convert Shopify order to Bosta format", () => {
      const result = bostaService.convertShopifyOrderToBosta(mockShopifyOrder);

      expect(result).toEqual(
        expect.objectContaining({
          type: BOSTA_ORDER_TYPES.CASH_COLLECTION, // Because financial_status is pending
          cod: 100,
          businessReference: "ORD-001",
          description: "2x تيشيرت قطني",
          itemsCount: 2,
          packageType: BOSTA_PACKAGE_TYPES.SMALL,
          dropOffAddress: expect.objectContaining({
            firstLine: "شارع التحرير",
            secondLine: "الدور الثالث",
            city: "القاهرة",
            zone: "القاهرة",
          }),
          receiver: expect.objectContaining({
            firstName: "أحمد",
            lastName: "محمد",
            phone: "+201234567890",
          }),
        }),
      );
    });

    test("should throw error if shipping address is missing", () => {
      const orderWithoutAddress = { ...mockShopifyOrder };
      delete orderWithoutAddress.shipping_address;

      expect(() =>
        bostaService.convertShopifyOrderToBosta(orderWithoutAddress),
      ).toThrow("Shipping address is required");
    });

    test("should handle paid orders (non-COD)", () => {
      const paidOrder = {
        ...mockShopifyOrder,
        financial_status: "paid",
      };

      const result = bostaService.convertShopifyOrderToBosta(paidOrder);

      expect(result.type).toBe(BOSTA_ORDER_TYPES.DELIVER);
      expect(result.cod).toBe(0);
    });
  });

  describe("processWebhookData", () => {
    const mockWebhookData = {
      _id: "delivery-123",
      trackingNumber: "TRK-456",
      state: BOSTA_DELIVERY_STATES.DELIVERED,
      type: "SEND",
      cod: 100,
      timeStamp: 1640995200000, // 2022-01-01 00:00:00
      isConfirmedDelivery: true,
      businessReference: "ORD-001",
      numberOfAttempts: 1,
    };

    test("should process webhook data correctly", () => {
      const result = bostaService.processWebhookData(mockWebhookData);

      expect(result).toEqual(
        expect.objectContaining({
          orderId: "delivery-123",
          trackingNumber: "TRK-456",
          state: BOSTA_DELIVERY_STATES.DELIVERED,
          codAmount: 100,
          timestamp: new Date(1640995200000),
          isDelivered: true,
          businessReference: "ORD-001",
          numberOfAttempts: 1,
        }),
      );
    });

    test("should set helper flags correctly", () => {
      const deliveredData = bostaService.processWebhookData({
        ...mockWebhookData,
        state: BOSTA_DELIVERY_STATES.DELIVERED,
      });
      expect(deliveredData.isDelivered).toBe(true);

      const exceptionData = bostaService.processWebhookData({
        ...mockWebhookData,
        state: BOSTA_DELIVERY_STATES.EXCEPTION,
      });
      expect(exceptionData.isException).toBe(true);

      const cancelledData = bostaService.processWebhookData({
        ...mockWebhookData,
        state: BOSTA_DELIVERY_STATES.CANCELLED,
      });
      expect(cancelledData.isCancelled).toBe(true);
    });
  });

  describe("getStateLabel", () => {
    test("should return correct labels for states", () => {
      expect(bostaService.getStateLabel(BOSTA_DELIVERY_STATES.PENDING)).toBe(
        "Pending",
      );
      expect(bostaService.getStateLabel(BOSTA_DELIVERY_STATES.DELIVERED)).toBe(
        "Delivered",
      );
      expect(bostaService.getStateLabel(BOSTA_DELIVERY_STATES.EXCEPTION)).toBe(
        "Exception",
      );
      expect(bostaService.getStateLabel(999)).toBe("Unknown");
    });

    test("should use public tracking state names when provided", () => {
      expect(BostaService.getStateLabel(41, "OUT_FOR_DELIVERY")).toBe(
        "Out for Delivery",
      );
    });
  });

  describe("Public Tracking", () => {
    test("fetchPublicTrackingStatus should call Bosta tracking server", async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              TrackingNumber: "6825760892",
              CurrentStatus: {
                state: "OUT_FOR_DELIVERY",
                code: 41,
              },
            }),
          ),
      });

      const result =
        await BostaService.fetchPublicTrackingStatus("6825760892");

      expect(fetch).toHaveBeenCalledWith(
        "https://tracking.bosta.co/shipments/track/6825760892",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
          }),
        }),
      );
      expect(result.TrackingNumber).toBe("6825760892");
    });

    test("formatPublicTrackingShipment should match scanner schema", () => {
      const shipment = BostaService.formatPublicTrackingShipment(
        {
          provider: "Bosta",
          TrackingNumber: "6825760892",
          CurrentStatus: {
            state: "OUT_FOR_DELIVERY",
            code: 41,
            timestamp: "2026-05-04T06:45:07.989Z",
          },
          PromisedDate: "2026-05-04T20:59:59.999Z",
          TransitEvents: [
            {
              state: "TICKET_CREATED",
              code: 10,
              timestamp: "2026-05-01T14:49:17.990Z",
            },
          ],
        },
        "6825760892",
      );

      expect(shipment).toEqual(
        expect.objectContaining({
          tracking_number: "6825760892",
          delivery_state: 41,
          delivery_state_label: "Out for Delivery",
          is_delivered: false,
          order_id: null,
        }),
      );
      expect(shipment.tracking_events).toHaveLength(1);
    });
  });

  describe("API Methods", () => {
    beforeEach(() => {
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    test("createDelivery should call correct endpoint", async () => {
      const orderData = {
        type: BOSTA_ORDER_TYPES.DELIVER,
        description: "Test order",
        dropOffAddress: { city: "Cairo" },
      };

      await bostaService.createDelivery(orderData);

      expect(fetch).toHaveBeenCalledWith(
        "https://app.bosta.co/api/v2/deliveries?apiVersion=1",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"type":10'),
        }),
      );
    });

    test("getDeliveryStatus should call correct endpoint", async () => {
      await bostaService.getDeliveryStatus("TRK-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://app.bosta.co/api/v2/deliveries/TRK-123",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });

    test("getDeliveryStatus should fall back to legacy Bosta API", async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                trackingNumber: "TRK-123",
                businessReference: "#1001",
              }),
            ),
        });

      const result = await bostaService.getDeliveryStatus("TRK-123");

      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://app.bosta.co/api/v0/deliveries/TRK-123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "test-api-key",
            "X-Requested-By": "nodejs-sdk",
          }),
        }),
      );
      expect(result.businessReference).toBe("#1001");
    });

    test("cancelDelivery should call correct endpoint", async () => {
      await bostaService.cancelDelivery("TRK-123");

      expect(fetch).toHaveBeenCalledWith(
        "https://app.bosta.co/api/v2/deliveries/TRK-123/cancel",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    test("getCities should call correct endpoint", async () => {
      await bostaService.getCities();

      expect(fetch).toHaveBeenCalledWith(
        "https://app.bosta.co/api/v2/cities",
        expect.objectContaining({
          method: "GET",
        }),
      );
    });
  });
});
