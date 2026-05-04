/**
 * Bosta Shipping Service
 * Integration with Bosta API for shipping management
 * Documentation: https://docs.bosta.co/api/
 */

import { supabase } from "../supabaseClient.js";

const DEFAULT_BOSTA_API_BASE_URL = "https://app.bosta.co/api/v2";
const DEFAULT_BOSTA_LEGACY_API_BASE_URL = "https://app.bosta.co/api/v0";
const DEFAULT_BOSTA_TRACKING_BASE_URL = "https://tracking.bosta.co";

const normalizeBaseUrl = (value) =>
  String(value || DEFAULT_BOSTA_API_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

const parsePositiveInteger = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Order Types & Codes from Bosta documentation
export const BOSTA_ORDER_TYPES = {
  DELIVER: 10, // Standard delivery
  CASH_COLLECTION: 15, // Collect cash from customer
  EXCHANGE: 30, // Exchange package
  CRP: 25, // Customer Return Pickup
};

// Package Types
export const BOSTA_PACKAGE_TYPES = {
  SMALL: "SMALL",
  MEDIUM: "MEDIUM",
  LARGE: "LARGE",
  LIGHT_BULKY: "Light Bulky",
  HEAVY_BULKY: "Heavy Bulky",
};

// Delivery States from webhook documentation
export const BOSTA_DELIVERY_STATES = {
  PENDING: 0,
  PICKED_UP: 10,
  IN_TRANSIT: 20,
  OUT_FOR_DELIVERY: 30,
  DELIVERED: 40,
  EXCEPTION: 47,
  CANCELLED: 50,
  RETURNED: 60,
};

class BostaService {
  constructor({
    apiKey = process.env.BOSTA_API_KEY,
    baseUrl = process.env.BOSTA_API_BASE_URL,
    legacyBaseUrl = process.env.BOSTA_LEGACY_API_BASE_URL,
  } = {}) {
    const normalizedApiKey = String(apiKey || "").trim();
    if (!normalizedApiKey) {
      throw new Error("BOSTA_API_KEY environment variable is required");
    }
    this.apiKey = normalizedApiKey;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.legacyBaseUrl = normalizeBaseUrl(
      legacyBaseUrl || DEFAULT_BOSTA_LEGACY_API_BASE_URL,
    );
  }

  /**
   * Make authenticated request to Bosta API
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const timeoutMs = parsePositiveInteger(
      options.timeoutMs || process.env.BOSTA_API_TIMEOUT_MS,
      20000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions = { ...options };
    const signal = fetchOptions.signal;
    delete fetchOptions.timeoutMs;
    delete fetchOptions.signal;
    const headers = {
      Authorization: this.apiKey,
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    };

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: signal || controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          `Bosta API Error: ${response.status} - ${data.message || "Unknown error"}`,
        );
      }

      return data;
    } catch (error) {
      const message =
        error.name === "AbortError"
          ? `Bosta API request timed out after ${timeoutMs}ms`
          : error.message;
      console.error("Bosta API Request Failed:", {
        endpoint,
        error: message,
        url,
      });
      if (error.name === "AbortError") {
        throw new Error(message);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async makeLegacyRequest(endpoint, options = {}) {
    const url = `${this.legacyBaseUrl}${endpoint}`;
    const timeoutMs = parsePositiveInteger(
      options.timeoutMs || process.env.BOSTA_API_TIMEOUT_MS,
      20000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOptions = { ...options };
    const signal = fetchOptions.signal;
    delete fetchOptions.timeoutMs;
    delete fetchOptions.signal;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
          "X-Requested-By": "nodejs-sdk",
          ...fetchOptions.headers,
        },
        signal: signal || controller.signal,
      });
      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Bosta legacy API returned a non-JSON response (${response.status})`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Bosta legacy API Error: ${response.status} - ${
            data?.message || "Unknown error"
          }`,
        );
      }

      return data;
    } catch (error) {
      const message =
        error.name === "AbortError"
          ? `Bosta legacy API request timed out after ${timeoutMs}ms`
          : error.message;
      console.error("Bosta Legacy API Request Failed:", {
        endpoint,
        error: message,
        url,
      });
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Create a single delivery order
   */
  async createDelivery(orderData) {
    const endpoint = "/deliveries?apiVersion=1";

    const payload = {
      type: orderData.type || BOSTA_ORDER_TYPES.DELIVER,
      specs: {
        packageDetails: {
          description: orderData.description || "E-commerce order",
          itemsCount: orderData.itemsCount || 1,
        },
        packageType: orderData.packageType || BOSTA_PACKAGE_TYPES.SMALL,
      },
      dropOffAddress: orderData.dropOffAddress,
      pickupAddress: orderData.pickupAddress,
      cod: orderData.cod || 0,
      businessReference: orderData.businessReference,
      goodsInfo: orderData.goodsInfo,
      allowOpenPackage: orderData.allowOpenPackage || false,
      flexShip: orderData.flexShip || false,
    };

    // Remove undefined fields
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    return await this.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  /**
   * Create bulk delivery orders
   */
  async createBulkDeliveries(ordersData) {
    const endpoint = "/deliveries/bulk?apiVersion=1";

    return await this.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({ deliveries: ordersData }),
    });
  }

  /**
   * Get delivery status by tracking number
   */
  async getDeliveryStatus(trackingNumber) {
    const endpoint = `/deliveries/${trackingNumber}`;

    try {
      return await this.makeRequest(endpoint, {
        method: "GET",
      });
    } catch {
      return await this.makeLegacyRequest(endpoint, {
        method: "GET",
      });
    }
  }

  /**
   * Get public shipment tracking from Bosta's tracking server.
   * This endpoint is what Bosta's public tracking page uses and does not require
   * a business API key, so it is a useful fallback for customer-facing scans.
   */
  static async fetchPublicTrackingStatus(
    trackingNumber,
    {
      baseUrl = process.env.BOSTA_TRACKING_BASE_URL,
      timeoutMs = process.env.BOSTA_TRACKING_TIMEOUT_MS,
    } = {},
  ) {
    const normalizedTrackingNumber = String(trackingNumber || "").trim();
    if (!normalizedTrackingNumber) {
      throw new Error("Tracking number is required");
    }

    const parsedTimeoutMs = parsePositiveInteger(timeoutMs, 15000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), parsedTimeoutMs);
    const trackingBaseUrl = normalizeBaseUrl(
      baseUrl || DEFAULT_BOSTA_TRACKING_BASE_URL,
    );
    const url = `${trackingBaseUrl}/shipments/track/${encodeURIComponent(
      normalizedTrackingNumber,
    )}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(
          `Bosta tracking returned a non-JSON response (${response.status})`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `Bosta tracking error: ${response.status} - ${
            data?.message || data?.error || "Unknown error"
          }`,
        );
      }

      return data;
    } catch (error) {
      const message =
        error.name === "AbortError"
          ? `Bosta tracking request timed out after ${parsedTimeoutMs}ms`
          : error.message;
      throw new Error(message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getPublicTrackingStatus(trackingNumber) {
    return BostaService.fetchPublicTrackingStatus(trackingNumber);
  }

  /**
   * Cancel delivery
   */
  async cancelDelivery(trackingNumber) {
    const endpoint = `/deliveries/${trackingNumber}/cancel`;

    return await this.makeRequest(endpoint, {
      method: "POST",
    });
  }

  /**
   * Get cities list
   */
  async getCities() {
    const endpoint = "/cities";

    return await this.makeRequest(endpoint, {
      method: "GET",
    });
  }

  /**
   * Get zones for a specific city
   */
  async getZones(cityId) {
    const endpoint = `/cities/${cityId}/zones`;

    return await this.makeRequest(endpoint, {
      method: "GET",
    });
  }

  /**
   * Get districts for a specific zone
   */
  async getDistricts(zoneId) {
    const endpoint = `/zones/${zoneId}/districts`;

    return await this.makeRequest(endpoint, {
      method: "GET",
    });
  }

  /**
   * Create pickup request
   */
  async createPickupRequest(pickupData) {
    const endpoint = "/pickup-requests";

    return await this.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(pickupData),
    });
  }

  /**
   * Get pricing for delivery
   */
  async getPricing(pricingData) {
    const endpoint = "/pricing";

    return await this.makeRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(pricingData),
    });
  }

  /**
   * Convert Shopify order to Bosta delivery format
   */
  convertShopifyOrderToBosta(shopifyOrder, options = {}) {
    const {
      packageType = BOSTA_PACKAGE_TYPES.SMALL,
      allowOpenPackage = false,
      flexShip = false,
    } = options;

    // Extract shipping address
    const shippingAddress = shopifyOrder.shipping_address;
    if (!shippingAddress) {
      throw new Error("Shipping address is required");
    }

    // Calculate COD amount (for cash on delivery orders)
    const isCOD =
      shopifyOrder.financial_status === "pending" ||
      shopifyOrder.gateway === "cash_on_delivery";
    const codAmount = isCOD ? parseFloat(shopifyOrder.total_price) : 0;

    // Build drop-off address
    const dropOffAddress = {
      firstLine: shippingAddress.address1,
      secondLine: shippingAddress.address2 || "",
      city: shippingAddress.city,
      zone: shippingAddress.province,
      district: shippingAddress.city, // May need mapping
      buildingNumber: "",
      floor: "",
      apartment: "",
      geoLocation: {
        latitude: 0,
        longitude: 0,
      },
    };

    // Build goods info for insurance
    const goodsInfo = shopifyOrder.line_items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      value: parseFloat(item.price),
      description: item.title,
    }));

    // Calculate total items count
    const itemsCount = shopifyOrder.line_items.reduce(
      (total, item) => total + item.quantity,
      0,
    );

    // Build description
    const description = shopifyOrder.line_items
      .map((item) => `${item.quantity}x ${item.name}`)
      .join(", ");

    return {
      type: isCOD
        ? BOSTA_ORDER_TYPES.CASH_COLLECTION
        : BOSTA_ORDER_TYPES.DELIVER,
      dropOffAddress,
      cod: codAmount,
      businessReference: shopifyOrder.order_number || shopifyOrder.id,
      description: description.substring(0, 200), // Bosta limit
      itemsCount,
      packageType,
      goodsInfo,
      allowOpenPackage,
      flexShip,
      // Customer info
      receiver: {
        firstName: shippingAddress.first_name,
        lastName: shippingAddress.last_name,
        phone: shippingAddress.phone || shopifyOrder.phone,
      },
    };
  }

  /**
   * Process webhook data from Bosta
   */
  processWebhookData(webhookData) {
    const {
      _id,
      trackingNumber,
      state,
      type,
      cod,
      timeStamp,
      isConfirmedDelivery,
      deliveryPromiseDate,
      exceptionReason,
      exceptionCode,
      businessReference,
      numberOfAttempts,
    } = webhookData;

    return {
      orderId: _id,
      trackingNumber,
      state,
      type,
      codAmount: cod,
      timestamp: new Date(timeStamp),
      deliveryPromiseDate,
      exceptionReason,
      exceptionCode,
      businessReference,
      numberOfAttempts,
      // Helper flags
      isDelivered:
        state === BOSTA_DELIVERY_STATES.DELIVERED || isConfirmedDelivery,
      isException: state === BOSTA_DELIVERY_STATES.EXCEPTION,
      isCancelled: state === BOSTA_DELIVERY_STATES.CANCELLED,
      isReturned: state === BOSTA_DELIVERY_STATES.RETURNED,
    };
  }

  /**
   * Save shipment to database
   */
  async saveShipment(orderId, bostaResponse, orderData, options = {}) {
    const db = supabase;

    const shipmentData = {
      order_id: orderId,
      tracking_number: bostaResponse.trackingNumber,
      delivery_id: bostaResponse._id,
      bosta_order_type: orderData.type || BOSTA_ORDER_TYPES.DELIVER,
      package_type: orderData.packageType || BOSTA_PACKAGE_TYPES.SMALL,
      cod_amount: orderData.cod || 0,
      expected_shipping_cost: options.expectedShippingCost || 0,
      business_reference: orderData.businessReference,
      delivery_state: 0, // PENDING
      delivery_state_label: "Pending",
      delivery_address: orderData.dropOffAddress,
      pickup_address: orderData.pickupAddress,
      bosta_response: bostaResponse,
      notes: options.notes,
    };

    const { data, error } = await db
      .from("bosta_shipments")
      .insert(shipmentData)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save shipment: ${error.message}`);
    }

    return data;
  }

  /**
   * Update shipment status from webhook
   */
  async updateShipmentFromWebhook(webhookData) {
    const db = supabase;
    const processedData = this.processWebhookData(webhookData);

    // Log webhook for debugging
    await db.from("bosta_webhook_logs").insert({
      tracking_number: processedData.trackingNumber,
      delivery_id: processedData.orderId,
      delivery_state: processedData.state,
      webhook_type: processedData.type,
      payload: webhookData,
      processed: false,
    });

    // Update shipment record
    const updateData = {
      delivery_state: processedData.state,
      delivery_state_label: this.getStateLabel(processedData.state),
      last_status_update: processedData.timestamp.toISOString(),
      delivery_attempts: processedData.numberOfAttempts,
      is_delivered: processedData.isDelivered,
      is_cancelled: processedData.isCancelled,
      is_returned: processedData.isReturned,
      webhook_data: webhookData,
    };

    if (processedData.isDelivered) {
      updateData.delivered_at = processedData.timestamp.toISOString();
      updateData.cod_collected = processedData.codAmount;
    }

    if (processedData.isException) {
      updateData.exception_reason = processedData.exceptionReason;
      updateData.exception_code = processedData.exceptionCode;
    }

    const { data, error } = await db
      .from("bosta_shipments")
      .update(updateData)
      .eq("tracking_number", processedData.trackingNumber)
      .select()
      .single();

    if (error) {
      console.error("Failed to update shipment:", error);
      // Mark webhook as failed
      await db
        .from("bosta_webhook_logs")
        .update({
          processed: false,
          processing_error: error.message,
        })
        .eq("tracking_number", processedData.trackingNumber)
        .eq("processed", false);

      throw new Error(`Failed to update shipment: ${error.message}`);
    }

    // Mark webhook as processed
    await db
      .from("bosta_webhook_logs")
      .update({
        processed: true,
        processed_at: new Date().toISOString(),
      })
      .eq("tracking_number", processedData.trackingNumber)
      .eq("processed", false);

    return data;
  }

  /**
   * Get shipment by tracking number
   */
  async getShipment(trackingNumber) {
    const db = supabase;

    const { data, error } = await db
      .from("bosta_shipments")
      .select("*")
      .eq("tracking_number", trackingNumber)
      .single();

    if (error && error.code !== "PGRST116") {
      // Not found is ok
      throw new Error(`Failed to get shipment: ${error.message}`);
    }

    return data;
  }

  /**
   * Get shipments for an order
   */
  async getOrderShipments(orderId) {
    const db = supabase;

    const { data, error } = await db
      .from("bosta_shipments")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to get order shipments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get state label for delivery state
   */
  getStateLabel(state) {
    return BostaService.getStateLabel(state);
  }

  static formatStateName(stateName) {
    const smallWords = new Set(["at", "for", "in", "of", "to"]);
    return String(stateName || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((word, index) =>
        index > 0 && smallWords.has(word)
          ? word
          : word.charAt(0).toUpperCase() + word.slice(1),
      )
      .join(" ");
  }

  static getStateLabel(state, fallbackStateName) {
    if (fallbackStateName) {
      return BostaService.formatStateName(fallbackStateName);
    }

    const normalizedState = Number(state);
    const labels = {
      [BOSTA_DELIVERY_STATES.PENDING]: "Pending",
      [BOSTA_DELIVERY_STATES.PICKED_UP]: "Picked Up",
      [BOSTA_DELIVERY_STATES.IN_TRANSIT]: "In Transit",
      [BOSTA_DELIVERY_STATES.OUT_FOR_DELIVERY]: "Out for Delivery",
      [BOSTA_DELIVERY_STATES.DELIVERED]: "Delivered",
      [BOSTA_DELIVERY_STATES.EXCEPTION]: "Exception",
      [BOSTA_DELIVERY_STATES.CANCELLED]: "Cancelled",
      [BOSTA_DELIVERY_STATES.RETURNED]: "Returned",
      21: "Picked Up",
      22: "Heading to Customer",
      23: "Picked Up",
      24: "Received at Warehouse",
      25: "Fulfilled",
      41: "Out for Delivery",
      45: "Delivered",
      46: "Returned to Business",
      48: "Terminated",
      49: "Cancelled",
      100: "Lost",
      101: "Damaged",
      102: "Investigation",
      103: "Awaiting Your Action",
      104: "Archived",
      105: "On Hold",
    };

    return labels[normalizedState] || "Unknown";
  }

  static isDeliveredState(state, stateName) {
    const normalizedState = Number(state);
    const normalizedStateName = String(stateName || "").toUpperCase();
    return (
      normalizedState === BOSTA_DELIVERY_STATES.DELIVERED ||
      normalizedState === 45 ||
      normalizedStateName === "DELIVERED"
    );
  }

  static isCancelledState(state, stateName) {
    const normalizedState = Number(state);
    const normalizedStateName = String(stateName || "").toUpperCase();
    return (
      normalizedState === BOSTA_DELIVERY_STATES.CANCELLED ||
      normalizedState === 49 ||
      normalizedState === 48 ||
      normalizedStateName === "CANCELLED" ||
      normalizedStateName === "CANCELED" ||
      normalizedStateName === "TERMINATED"
    );
  }

  static isReturnedState(state, stateName) {
    const normalizedState = Number(state);
    const normalizedStateName = String(stateName || "").toUpperCase();
    return (
      normalizedState === BOSTA_DELIVERY_STATES.RETURNED ||
      normalizedState === 46 ||
      normalizedStateName.includes("RETURNED")
    );
  }

  static formatPublicTrackingShipment(publicTracking, trackingNumber) {
    const currentStatus = publicTracking?.CurrentStatus || {};
    const transitEvents = Array.isArray(publicTracking?.TransitEvents)
      ? publicTracking.TransitEvents
      : [];
    const currentCode = Number(currentStatus.code || 0);
    const currentState = currentStatus.state;
    const trackingEvents = transitEvents.map((event) => ({
      state: event.state,
      code: event.code,
      label: BostaService.getStateLabel(event.code, event.state),
      timestamp: event.timestamp,
    }));

    return {
      tracking_number: publicTracking?.TrackingNumber || trackingNumber,
      delivery_id: publicTracking?._id || null,
      order_id: null,
      bosta_order_type: publicTracking?.type || null,
      delivery_state: currentCode,
      delivery_state_label: BostaService.getStateLabel(
        currentCode,
        currentState,
      ),
      expected_shipping_cost: 0,
      cod_amount: Number(publicTracking?.cod || 0),
      is_delivered: BostaService.isDeliveredState(currentCode, currentState),
      is_cancelled: BostaService.isCancelledState(currentCode, currentState),
      is_returned: BostaService.isReturnedState(currentCode, currentState),
      created_at: transitEvents[0]?.timestamp || null,
      updated_at: currentStatus.timestamp || null,
      last_status_update: currentStatus.timestamp || null,
      delivery_promise_date: publicTracking?.PromisedDate || null,
      tracking_url: publicTracking?.TrackingURL || null,
      support_phone_numbers: publicTracking?.SupportPhoneNumbers || [],
      tracking_events: trackingEvents,
      bosta_response: publicTracking,
    };
  }
}

export default BostaService;
