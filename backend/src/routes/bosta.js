/**
 * Bosta Shipping Routes
 * Handles integration with Bosta shipping API
 */

import express from "express";
import BostaService from "../services/bostaService.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

const extractBostaList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.list)) return payload.list;
  return payload;
};

// Initialize Bosta service
let bostaService;
try {
  if (process.env.BOSTA_API_KEY) {
    bostaService = new BostaService();
  }
} catch (error) {
  console.warn("Bosta service initialization failed:", error.message);
}

/**
 * Middleware to check if Bosta service is available
 */
const requireBostaService = (req, res, next) => {
  if (!bostaService) {
    return res.status(503).json({
      error:
        "Bosta service is not configured. Please configure Bosta API Key in Settings.",
    });
  }
  next();
};

/**
 * GET /api/bosta/config
 * Get Bosta configuration status
 */
router.get("/config", authenticateToken, async (req, res) => {
  try {
    const hasConfig = Boolean(process.env.BOSTA_API_KEY);
    const config = {
      hasConfig,
      apiKey: hasConfig ? "********" : "",
    };
    res.json(config);
  } catch (error) {
    console.error("Failed to get Bosta config:", error);
    res.status(500).json({
      error: "Failed to get Bosta configuration",
      message: error.message,
    });
  }
});

/**
 * POST /api/bosta/config
 * Save Bosta configuration
 */
router.post(
  "/config",
  authenticateToken,
  requirePermission("can_manage_settings"),
  async (req, res) => {
    try {
      const { apiKey } = req.body;
      const submittedApiKey = String(apiKey || "").trim();
      const existingApiKey = String(process.env.BOSTA_API_KEY || "").trim();
      const nextApiKey =
        /^\*+$/.test(submittedApiKey) && existingApiKey
          ? existingApiKey
          : submittedApiKey;

      if (!nextApiKey) {
        return res.status(400).json({
          error: "Bosta API Key is required",
        });
      }

      // Test the API key by fetching cities
      const testService = new BostaService({
        apiKey: nextApiKey,
      });

      await testService.getCities();

      try {
        const db = supabase;
        await db.from("activity_log").insert({
          user_id: req.user.id,
          action: "bosta_config_saved",
          entity_type: "settings",
          entity_id: "bosta",
          details: {
            configured: true,
          },
        });
      } catch (logError) {
        console.warn("Bosta config activity log skipped:", logError.message);
      }

      process.env.BOSTA_API_KEY = nextApiKey;
      bostaService = testService;

      res.json({
        success: true,
        message: "Bosta configuration validated and activated successfully.",
      });
    } catch (error) {
      console.error("Failed to save Bosta config:", error);
      res.status(500).json({
        error: "Failed to save Bosta configuration. Please check your API key.",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/cities
 * Get list of available cities
 */
router.get(
  "/cities",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const cities = await bostaService.getCities();
      res.json(extractBostaList(cities));
    } catch (error) {
      console.error("Failed to fetch cities:", error);
      res.status(500).json({
        error: "Failed to fetch cities from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/cities/:cityId/zones
 * Get zones for a specific city
 */
router.get(
  "/cities/:cityId/zones",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const { cityId } = req.params;
      const zones = await bostaService.getZones(cityId);
      res.json(extractBostaList(zones));
    } catch (error) {
      console.error("Failed to fetch zones:", error);
      res.status(500).json({
        error: "Failed to fetch zones from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/zones/:zoneId/districts
 * Get districts for a specific zone
 */
router.get(
  "/zones/:zoneId/districts",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const { zoneId } = req.params;
      const districts = await bostaService.getDistricts(zoneId);
      res.json(extractBostaList(districts));
    } catch (error) {
      console.error("Failed to fetch districts:", error);
      res.status(500).json({
        error: "Failed to fetch districts from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/pricing
 * Get pricing for delivery
 */
router.post(
  "/pricing",
  authenticateToken,
  requireBostaService,
  async (req, res) => {
    try {
      const pricing = await bostaService.getPricing(req.body);
      res.json(pricing);
    } catch (error) {
      console.error("Failed to get pricing:", error);
      res.status(500).json({
        error: "Failed to get pricing from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries
 * Create a single delivery
 */
router.post(
  "/deliveries",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const delivery = await bostaService.createDelivery(req.body);

      // Log the delivery creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_delivery_created",
        entity_type: "delivery",
        entity_id: delivery.trackingNumber || delivery._id,
        details: {
          trackingNumber: delivery.trackingNumber,
          businessReference: req.body.businessReference,
        },
      });

      res.json(delivery);
    } catch (error) {
      console.error("Failed to create delivery:", error);
      res.status(500).json({
        error: "Failed to create delivery with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries/bulk
 * Create multiple deliveries
 */
router.post(
  "/deliveries/bulk",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { deliveries } = req.body;
      if (!Array.isArray(deliveries) || deliveries.length === 0) {
        return res.status(400).json({
          error: "deliveries array is required and must not be empty",
        });
      }

      const result = await bostaService.createBulkDeliveries(deliveries);

      // Log bulk delivery creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_bulk_deliveries_created",
        entity_type: "bulk_delivery",
        entity_id: `bulk_${Date.now()}`,
        details: {
          count: deliveries.length,
          businessReferences: deliveries
            .map((d) => d.businessReference)
            .filter(Boolean),
        },
      });

      res.json(result);
    } catch (error) {
      console.error("Failed to create bulk deliveries:", error);
      res.status(500).json({
        error: "Failed to create bulk deliveries with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/deliveries/:trackingNumber
 * Get delivery status
 */
router.get(
  "/deliveries/:trackingNumber",
  authenticateToken,
  requirePermission("can_view_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { trackingNumber } = req.params;
      const delivery = await bostaService.getDeliveryStatus(trackingNumber);
      res.json(delivery);
    } catch (error) {
      console.error("Failed to get delivery status:", error);
      res.status(500).json({
        error: "Failed to get delivery status from Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/shipments
 * Get all shipments from database (for testing)
 */
router.get(
  "/shipments",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const db = supabase;
      const { data: shipments, error } = await db
        .from("bosta_shipments")
        .select(
          "tracking_number, order_id, delivery_state, delivery_state_label, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) {
        throw error;
      }

      res.json({
        count: shipments?.length || 0,
        shipments: shipments || [],
      });
    } catch (error) {
      console.error("Failed to get shipments:", error);
      res.status(500).json({
        error: "Failed to get shipments",
        message: error.message,
      });
    }
  },
);

/**
 * GET /api/bosta/shipments/:trackingNumber
 * Get shipment from database or fetch from Bosta API
 */
router.get(
  "/shipments/:trackingNumber",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
    try {
      const { trackingNumber } = req.params;

      const db = supabase;

      // First, try to get from database
      const { data: shipment, error } = await db
        .from("bosta_shipments")
        .select("*")
        .eq("tracking_number", trackingNumber)
        .single();

      if (shipment && !error) {
        return res.json(shipment);
      }

      // If not found in database, try to fetch from Bosta API
      if (!bostaService) {
        return res.status(404).json({
          error:
            "Shipment not found in database and Bosta service not configured",
        });
      }

      try {
        const bostaDelivery =
          await bostaService.getDeliveryStatus(trackingNumber);

        // Return the Bosta API response with expected format
        const formattedShipment = {
          tracking_number: trackingNumber,
          delivery_id: bostaDelivery._id,
          order_id: null, // Will be null if not in our database
          bosta_order_type: bostaDelivery.type,
          delivery_state: bostaDelivery.state,
          delivery_state_label: bostaService.getStateLabel(bostaDelivery.state),
          expected_shipping_cost: 0, // Default to 0 if not in database
          cod_amount: bostaDelivery.cod || 0,
          is_delivered: bostaDelivery.state === 40,
          bosta_response: bostaDelivery,
        };

        return res.json(formattedShipment);
      } catch (bostaError) {
        console.error("Failed to fetch from Bosta API:", bostaError);

        // Check if it's a 404 or invalid tracking number
        const errorMessage = bostaError.message || "";
        if (
          errorMessage.includes("404") ||
          errorMessage.includes("not valid JSON") ||
          errorMessage.includes("<!DOCTYPE")
        ) {
          return res.status(404).json({
            error: "Tracking number not found",
            message:
              "This tracking number does not exist in Bosta system. Please check the number and try again.",
          });
        }

        return res.status(500).json({
          error: "Failed to fetch shipment from Bosta API",
          message: bostaError.message,
        });
      }
    } catch (error) {
      console.error("Failed to get shipment:", error);
      res.status(500).json({
        error: "Failed to get shipment",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/deliveries/:trackingNumber/cancel
 * Cancel delivery
 */
router.post(
  "/deliveries/:trackingNumber/cancel",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { trackingNumber } = req.params;
      const result = await bostaService.cancelDelivery(trackingNumber);

      // Log delivery cancellation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_delivery_cancelled",
        entity_type: "delivery",
        entity_id: trackingNumber,
        details: {
          trackingNumber,
          reason: req.body.reason || "Manual cancellation",
        },
      });

      res.json(result);
    } catch (error) {
      console.error("Failed to cancel delivery:", error);
      res.status(500).json({
        error: "Failed to cancel delivery with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/pickup-requests
 * Create pickup request
 */
router.post(
  "/pickup-requests",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const pickup = await bostaService.createPickupRequest(req.body);

      // Log pickup request creation
      const db = supabase;
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "bosta_pickup_created",
        entity_type: "pickup",
        entity_id: pickup._id || pickup.id,
        details: pickup,
      });

      res.json(pickup);
    } catch (error) {
      console.error("Failed to create pickup request:", error);
      res.status(500).json({
        error: "Failed to create pickup request with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/orders/:orderId/ship
 * Ship a Shopify order with Bosta
 */
router.post(
  "/orders/:orderId/ship",
  authenticateToken,
  requirePermission("can_edit_orders"),
  requireBostaService,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { packageType, allowOpenPackage, flexShip } = req.body;

      const db = supabase;

      // Get the order from database
      const { data: order, error: orderError } = await db
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({
          error: "Order not found",
        });
      }

      // Parse order data
      const orderData =
        typeof order.data === "string" ? JSON.parse(order.data) : order.data;

      // Convert Shopify order to Bosta format
      const bostaOrderData = bostaService.convertShopifyOrderToBosta(
        orderData,
        {
          packageType,
          allowOpenPackage,
          flexShip,
        },
      );

      // Create delivery with Bosta
      const delivery = await bostaService.createDelivery(bostaOrderData);

      // Save shipment to database
      await bostaService.saveShipment(orderId, delivery, bostaOrderData, {
        notes: `Shipped by user ${req.user.id}`,
      });

      // Update order with Bosta tracking info
      const updatedOrderData = {
        ...orderData,
        bosta_tracking_number: delivery.trackingNumber,
        bosta_delivery_id: delivery._id,
        bosta_status: "shipped",
        bosta_shipped_at: new Date().toISOString(),
      };

      await db
        .from("orders")
        .update({
          data: updatedOrderData,
          local_updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      // Log the shipping action
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "order_shipped_with_bosta",
        entity_type: "order",
        entity_id: orderId,
        details: {
          trackingNumber: delivery.trackingNumber,
          deliveryId: delivery._id,
          orderNumber: order.order_number,
        },
      });

      res.json({
        success: true,
        delivery,
        trackingNumber: delivery.trackingNumber,
        orderId,
      });
    } catch (error) {
      console.error("Failed to ship order with Bosta:", error);
      res.status(500).json({
        error: "Failed to ship order with Bosta",
        message: error.message,
      });
    }
  },
);

/**
 * POST /api/bosta/webhook
 * Handle Bosta webhooks for delivery status updates
 */
router.post("/webhook", async (req, res) => {
  try {
    if (!bostaService) {
      console.warn("Bosta webhook received but service not configured");
      return res.status(200).json({ received: true });
    }

    const webhookData = bostaService.processWebhookData(req.body);

    // Update shipment in database
    await bostaService.updateShipmentFromWebhook(req.body);

    const db = supabase;

    // Find order by business reference (order number or ID)
    const { data: orders, error: orderError } = await db
      .from("orders")
      .select("*")
      .or(
        `order_number.eq.${webhookData.businessReference},id.eq.${webhookData.businessReference}`,
      )
      .limit(1);

    if (orderError) {
      console.error("Error finding order for webhook:", orderError);
      return res.status(200).json({ received: true });
    }

    if (!orders || orders.length === 0) {
      console.warn(
        "No order found for business reference:",
        webhookData.businessReference,
      );
      return res.status(200).json({ received: true });
    }

    const order = orders[0];
    const orderData =
      typeof order.data === "string" ? JSON.parse(order.data) : order.data;

    // Update order with new Bosta status
    const updatedOrderData = {
      ...orderData,
      bosta_status: webhookData.state,
      bosta_last_update: webhookData.timestamp.toISOString(),
      bosta_delivery_attempts: webhookData.numberOfAttempts,
    };

    // Add specific status information
    if (webhookData.isDelivered) {
      updatedOrderData.bosta_delivered_at = webhookData.timestamp.toISOString();
      updatedOrderData.bosta_cod_collected = webhookData.codAmount;
    }

    if (webhookData.isException) {
      updatedOrderData.bosta_exception_reason = webhookData.exceptionReason;
      updatedOrderData.bosta_exception_code = webhookData.exceptionCode;
    }

    // Update order in database
    await db
      .from("orders")
      .update({
        data: updatedOrderData,
        local_updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Log webhook processing
    await db.from("activity_log").insert({
      user_id: null, // System action
      action: "bosta_webhook_processed",
      entity_type: "order",
      entity_id: order.id,
      details: {
        trackingNumber: webhookData.trackingNumber,
        state: webhookData.state,
        businessReference: webhookData.businessReference,
        isDelivered: webhookData.isDelivered,
        isException: webhookData.isException,
      },
    });

    console.log("Bosta webhook processed successfully:", {
      orderId: order.id,
      trackingNumber: webhookData.trackingNumber,
      state: webhookData.state,
    });

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Failed to process Bosta webhook:", error);
    res.status(500).json({
      error: "Failed to process webhook",
      message: error.message,
    });
  }
});

export default router;
