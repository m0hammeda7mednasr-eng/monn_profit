/**
 * Bosta Shipping Service
 * Integration with Bosta API for shipping management
 * Documentation: https://docs.bosta.co/api/
 */

import { supabase } from "../supabaseClient.js";

const BOSTA_API_BASE_URL =
  process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2";
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const DEFAULT_BUSINESS_LOCATION_ID = process.env.BOSTA_BUSINESS_LOCATION_ID;

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
  constructor() {
    if (!BOSTA_API_KEY) {
      throw new Error("BOSTA_API_KEY environment variable is required");
    }
    this.apiKey = BOSTA_API_KEY;
    this.baseUrl = BOSTA_API_BASE_URL;
  }

  /**
   * Make authenticated request to Bosta API
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      Authorization: this.apiKey,
      "Content-Type": "application/json",
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          `Bosta API Error: ${response.status} - ${data.message || "Unknown error"}`,
        );
      }

      return data;
    } catch (error) {
      console.error("Bosta API Request Failed:", {
        endpoint,
        error: error.message,
        url,
      });
      throw error;
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
      businessLocationId: orderData.businessLocationId,
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

    return await this.makeRequest(endpoint, {
      method: "GET",
    });
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
      businessLocationId,
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
      businessLocationId,
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
      isDelivered: isConfirmedDelivery,
      deliveryPromiseDate,
      exceptionReason,
      exceptionCode,
      businessReference,
      numberOfAttempts,
      // Helper flags
      isDelivered: state === BOSTA_DELIVERY_STATES.DELIVERED,
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
      business_reference: orderData.businessReference,
      business_location_id:
        orderData.businessLocationId || DEFAULT_BUSINESS_LOCATION_ID,
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
    const labels = {
      [BOSTA_DELIVERY_STATES.PENDING]: "Pending",
      [BOSTA_DELIVERY_STATES.PICKED_UP]: "Picked Up",
      [BOSTA_DELIVERY_STATES.IN_TRANSIT]: "In Transit",
      [BOSTA_DELIVERY_STATES.OUT_FOR_DELIVERY]: "Out for Delivery",
      [BOSTA_DELIVERY_STATES.DELIVERED]: "Delivered",
      [BOSTA_DELIVERY_STATES.EXCEPTION]: "Exception",
      [BOSTA_DELIVERY_STATES.CANCELLED]: "Cancelled",
      [BOSTA_DELIVERY_STATES.RETURNED]: "Returned",
    };

    return labels[state] || "Unknown";
  }
}

export default BostaService;
