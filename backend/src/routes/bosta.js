/**
 * Bosta Shipping Routes
 * Handles integration with Bosta shipping API
 */

import express from "express";
import BostaService from "../services/bostaService.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermissions } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

// Initialize Bosta service
let bostaService;
try {
  bostaService = new BostaService();
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
        "Bosta service is not configured. Please set BOSTA_API_KEY environment variable.",
    });
  }
  next();
};

/**
 * GET /api/bosta/cities
 * Get list of available cities
 */
router.get("/cities", requireAuth, requireBostaService, async (req, res) => {
  try {
    const cities = await bostaService.getCities();
    res.json(cities);
  } catch (error) {
    console.error("Failed to fetch cities:", error);
    res.status(500).json({
      error: "Failed to fetch cities from Bosta",
      message: error.message,
    });
  }
});

/**
 * GET /api/bosta/cities/:cityId/zones
 * Get zones for a specific city
 */
router.get(
  "/cities/:cityId/zones",
  requireAuth,
  requireBostaService,
  async (req, res) => {
    try {
      const { cityId } = req.params;
      const zones = await bostaService.getZones(cityId);
      res.json(zones);
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
  requireAuth,
  requireBostaService,
  async (req, res) => {
    try {
      const { zoneId } = req.params;
      const districts = await bostaService.getDistricts(zoneId);
      res.json(districts);
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
router.post("/pricing", requireAuth, requireBostaService, async (req, res) => {
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
});

/**
 * POST /api/bosta/deliveries
 * Create a single delivery
 */
router.post(
  "/deliveries",
  requireAuth,
  requirePermissions(["can_edit_orders"]),
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
  requireAuth,
  requirePermissions(["can_edit_orders"]),
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
  requireAuth,
  requirePermissions(["can_view_orders"]),
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
 * GET /api/bosta/shipments/:trackingNumber
 * Get shipment from database (includes expected_shipping_cost)
 */
router.get(
  "/shipments/:trackingNumber",
  requireAuth,
  requirePermissions(["can_view_orders"]),
  async (req, res) => {
    try {
      const { trackingNumber } = req.params;

      const db = supabase;
      const { data: shipment, error } = await db
        .from("bosta_shipments")
        .select("*")
        .eq("tracking_number", trackingNumber)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return res.status(404).json({
            error: "Shipment not found",
          });
        }
        throw error;
      }

      res.json(shipment);
    } catch (error) {
      console.error("Failed to get shipment:", error);
      res.status(500).json({
        error: "Failed to get shipment from database",
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
  requireAuth,
  requirePermissions(["can_edit_orders"]),
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
  requireAuth,
  requirePermissions(["can_edit_orders"]),
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
  requireAuth,
  requirePermissions(["can_edit_orders"]),
  requireBostaService,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { businessLocationId, packageType, allowOpenPackage, flexShip } =
        req.body;

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
          businessLocationId,
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
