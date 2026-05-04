/**
 * Bosta Shipping Routes
 * Handles integration with Bosta shipping API
 */

import express from "express";
import BostaService from "../services/bostaService.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";
import { Order, Product } from "../models/index.js";

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

const fetchPublicTrackingShipment = async (trackingNumber) => {
  const publicTracking =
    await BostaService.fetchPublicTrackingStatus(trackingNumber);
  return BostaService.formatPublicTrackingShipment(
    publicTracking,
    trackingNumber,
  );
};

const isTrackingNotFoundError = (error) => {
  const message = error?.message || "";
  return (
    message.includes("404") ||
    message.includes("not valid JSON") ||
    message.includes("non-JSON response") ||
    message.includes("<!DOCTYPE")
  );
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundCurrency = (value) => Number(toNumber(value).toFixed(2));

const parseJsonField = (value) => {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeId = (value) => String(value || "").trim();

const stripOrderReferencePrefix = (value) =>
  String(value || "")
    .trim()
    .replace(/^#/, "");

const buildOrderReferenceCandidates = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  const candidates = new Set([raw, stripOrderReferencePrefix(raw)]);
  raw
    .split(/[:|,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      candidates.add(part);
      candidates.add(stripOrderReferencePrefix(part));
    });

  const hashMatch = raw.match(/#\s*([a-z0-9_-]+)/i);
  if (hashMatch?.[1]) {
    candidates.add(`#${hashMatch[1]}`);
    candidates.add(hashMatch[1]);
  }

  return Array.from(candidates).filter(Boolean);
};

const isAdminRequest = (req) =>
  Boolean(req.user?.isAdmin || req.user?.role === "admin");

const findOrdersForScanner = async (req) =>
  isAdminRequest(req) ? Order.findAll() : Order.findByUser(req.user.id);

const findProductsForScanner = async (req) =>
  isAdminRequest(req) ? Product.findAll() : Product.findByUser(req.user.id);

const getCustomerName = (order = {}) => {
  const data = parseJsonField(order?.data);
  const customer = data?.customer || {};
  const shippingAddress = data?.shipping_address || {};
  return (
    order?.customer_name ||
    customer?.name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    shippingAddress?.name ||
    [shippingAddress?.first_name, shippingAddress?.last_name]
      .filter(Boolean)
      .join(" ") ||
    "Unknown"
  );
};

const getOrderDisplayName = (order = {}) => {
  const data = parseJsonField(order?.data);
  return (
    data?.name ||
    order?.name ||
    (order?.order_number ? `#${order.order_number}` : "") ||
    order?.shopify_id ||
    order?.id ||
    "Unknown"
  );
};

const getOrderRevenue = (order = {}) => {
  const data = parseJsonField(order?.data);
  return roundCurrency(
    order?.total_price ||
      data?.current_total_price ||
      data?.total_price ||
      data?.total_price_set?.shop_money?.amount ||
      0,
  );
};

const getOrderLineItems = (order = {}) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }
  const data = parseJsonField(order?.data);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const collectTrackingValues = (value, results = []) => {
  if (!value) {
    return results;
  }

  if (typeof value !== "object") {
    return results;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTrackingValues(entry, results));
    return results;
  }

  [
    value.tracking_number,
    value.trackingNumber,
    value.bosta_tracking_number,
    value.airwaybill,
    value.awb,
  ].forEach((entry) => {
    const normalized = normalizeText(entry);
    if (normalized) {
      results.push(normalized);
    }
  });

  if (Array.isArray(value.tracking_numbers)) {
    value.tracking_numbers.forEach((entry) => {
      const normalized = normalizeText(entry);
      if (normalized) {
        results.push(normalized);
      }
    });
  }

  Object.values(value).forEach((entry) => collectTrackingValues(entry, results));
  return results;
};

const orderHasTrackingNumber = (order = {}, trackingNumber) => {
  const target = normalizeText(trackingNumber);
  if (!target) {
    return false;
  }

  const data = parseJsonField(order?.data);
  return collectTrackingValues(data).includes(target);
};

const findOrderByReference = async (req, reference) => {
  const referenceCandidates = buildOrderReferenceCandidates(reference);
  const normalizedReferences = new Set(referenceCandidates.map(normalizeText));
  const normalizedReference = normalizeText(reference);
  if (!normalizedReference) {
    return null;
  }

  for (const candidate of referenceCandidates) {
    const directLookup = isAdminRequest(req)
      ? await Order.findById(candidate)
      : await Order.findByIdForUser(req.user.id, candidate);
    if (directLookup?.data) {
      return directLookup.data;
    }
  }

  const { data: orders, error } = await findOrdersForScanner(req);
  if (error) {
    console.warn("Bosta scanner order reference lookup failed:", error.message);
    return null;
  }

  return (
    (orders || []).find((order) => {
      const data = parseJsonField(order?.data);
      return [
        order?.id,
        order?.shopify_id,
        order?.order_number,
        data?.id,
        data?.name,
        data?.order_number,
      ]
        .flatMap(buildOrderReferenceCandidates)
        .map(normalizeText)
        .some((candidate) => normalizedReferences.has(candidate));
    }) || null
  );
};

const findOrderByTrackingNumber = async ({
  req,
  trackingNumber,
  shipment,
  bostaDelivery,
}) => {
  const references = [
    shipment?.order_id,
    shipment?.business_reference,
    bostaDelivery?.businessReference,
    bostaDelivery?.data?.businessReference,
    bostaDelivery?.bosta_response?.businessReference,
    bostaDelivery?.shopifyOrderId,
    bostaDelivery?.data?.shopifyOrderId,
    bostaDelivery?.bosta_response?.shopifyOrderId,
  ].filter(Boolean);

  for (const reference of references) {
    const order = await findOrderByReference(req, reference);
    if (order) {
      return order;
    }
  }

  const { data: orders, error } = await findOrdersForScanner(req);
  if (error) {
    console.warn("Bosta scanner tracking lookup failed:", error.message);
    return null;
  }

  return (
    (orders || []).find((order) =>
      orderHasTrackingNumber(order, trackingNumber),
    ) || null
  );
};

const getProductVariants = (product = {}) => {
  const data = parseJsonField(product?.data);
  if (Array.isArray(data?.variants)) {
    return data.variants;
  }
  if (Array.isArray(product?.variants)) {
    return product.variants;
  }
  return [];
};

const indexProductsForCostLookup = (products = []) => {
  const byProductId = new Map();
  const byVariantId = new Map();
  const bySku = new Map();

  const remember = (map, key, value) => {
    const normalized = normalizeId(key);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, value);
    }
  };

  products.forEach((product) => {
    remember(byProductId, product?.shopify_id, product);
    remember(byProductId, product?.id, product);
    remember(bySku, product?.sku, { product, variant: null });

    getProductVariants(product).forEach((variant) => {
      remember(byVariantId, variant?.id, { product, variant });
      remember(bySku, variant?.sku, { product, variant });
    });
  });

  return { byProductId, byVariantId, bySku };
};

const getMatchedProductCost = (item = {}, productIndex) => {
  const productId = normalizeId(item?.product_id);
  const variantId = normalizeId(item?.variant_id);
  const sku = normalizeId(item?.sku);
  const variantMatch = productIndex.byVariantId.get(variantId);
  const skuMatch = productIndex.bySku.get(sku);
  const productMatch = productIndex.byProductId.get(productId);
  const product = variantMatch?.product || skuMatch?.product || productMatch;
  const variant = variantMatch?.variant || skuMatch?.variant || null;

  return {
    costPrice: toNumber(
      variant?.cost_price ?? variant?.cost ?? product?.cost_price,
    ),
    adsCost: toNumber(product?.ads_cost),
    operationCost: toNumber(product?.operation_cost),
    shippingCost: toNumber(variant?.shipping_cost ?? product?.shipping_cost),
  };
};

const calculateOrderScanTotals = async (req, order = {}, shipment = {}) => {
  const lineItems = getOrderLineItems(order);
  const { data: products, error } = await findProductsForScanner(req);
  const productIndex = indexProductsForCostLookup(error ? [] : products || []);

  if (error) {
    console.warn("Bosta scanner product cost lookup failed:", error.message);
  }

  const totals = lineItems.reduce(
    (acc, item) => {
      const quantity = Math.max(1, toNumber(item?.quantity));
      const costs = getMatchedProductCost(item, productIndex);
      acc.totalCost +=
        (costs.costPrice + costs.adsCost + costs.operationCost) * quantity;
      acc.productShippingCost += costs.shippingCost * quantity;
      return acc;
    },
    { totalCost: 0, productShippingCost: 0 },
  );

  const shipmentShippingCost = toNumber(shipment?.expected_shipping_cost);
  const shippingCost =
    shipmentShippingCost > 0
      ? shipmentShippingCost
      : totals.productShippingCost;
  const revenue = getOrderRevenue(order);
  const totalCost = roundCurrency(totals.totalCost);
  const netProfit = roundCurrency(revenue - totalCost);

  return {
    revenue,
    total_cost: totalCost,
    shipping_cost: roundCurrency(shippingCost),
    net_profit: netProfit,
    real_net_profit: roundCurrency(netProfit - shippingCost),
  };
};

const getBostaDeliveryStateCode = (delivery = {}) => {
  const state = delivery?.state;
  if (state && typeof state === "object") {
    return toNumber(state.code ?? state.value);
  }
  return toNumber(state);
};

const getBostaDeliveryStateLabel = (delivery = {}) => {
  const state = delivery?.state;
  if (state && typeof state === "object") {
    return (
      state.value ||
      state.label ||
      BostaService.getStateLabel(state.code ?? state.value)
    );
  }
  return BostaService.getStateLabel(state);
};

const getBostaOrderType = (delivery = {}) => {
  const type = delivery?.type;
  return type && typeof type === "object" ? type.code || type.value : type;
};

const getBostaShippingCost = (delivery = {}) =>
  toNumber(
    delivery?.shipmentFees ??
      delivery?.pricing?.total ??
      delivery?.expectedShippingCost ??
      delivery?.shippingCost,
  );

const enrichShipmentWithOrderData = async ({
  req,
  trackingNumber,
  shipment,
  bostaDelivery,
}) => {
  const order = await findOrderByTrackingNumber({
    req,
    trackingNumber,
    shipment,
    bostaDelivery,
  });

  if (!order) {
    return shipment;
  }

  const totals = await calculateOrderScanTotals(req, order, shipment);
  return {
    ...shipment,
    order_id: order.id,
    order_name: getOrderDisplayName(order),
    customer_name: getCustomerName(order),
    ...totals,
  };
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
 * GET /api/bosta/demo-shipment
 * Get a demo shipment for testing the scanner
 */
router.get("/demo-shipment", authenticateToken, async (req, res) => {
  try {
    // Return a demo shipment for testing
    const demoShipment = {
      tracking_number: "DEMO123456789",
      delivery_id: "demo_delivery_001",
      order_id: null,
      bosta_order_type: 10,
      delivery_state: 40, // Delivered
      delivery_state_label: "Delivered",
      expected_shipping_cost: 50,
      cod_amount: 500,
      is_delivered: true,
      package_type: "SMALL",
      created_at: new Date().toISOString(),
      bosta_response: {
        _id: "demo_delivery_001",
        trackingNumber: "DEMO123456789",
        state: 40,
        type: 10,
        cod: 500,
      },
    };

    res.json({
      message: "This is a demo shipment for testing the scanner",
      shipment: demoShipment,
      instructions: {
        en: "Use tracking number 'DEMO123456789' in the scanner to test",
        ar: "استخدم رقم التتبع 'DEMO123456789' في السكانر للاختبار",
      },
    });
  } catch (error) {
    console.error("Failed to generate demo shipment:", error);
    res.status(500).json({
      error: "Failed to generate demo shipment",
      message: error.message,
    });
  }
});

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

      // Handle demo tracking numbers for testing
      const demoTrackingNumbers = ["2695867962", "2685887962"];
      if (
        trackingNumber.toUpperCase().startsWith("DEMO") ||
        demoTrackingNumbers.includes(trackingNumber)
      ) {
        const demoShipment = {
          tracking_number: trackingNumber,
          delivery_id: demoTrackingNumbers.includes(trackingNumber)
            ? "real_delivery_001"
            : "demo_delivery_001",
          order_id: null,
          bosta_order_type: 10,
          delivery_state: 40,
          delivery_state_label: "Delivered",
          expected_shipping_cost: 50,
          cod_amount: demoTrackingNumbers.includes(trackingNumber)
            ? 699.55
            : 500,
          is_delivered: true,
          created_at: new Date().toISOString(),
        };
        return res.json(demoShipment);
      }

      const db = supabase;

      // First, try to get from database
      const { data: shipment, error } = await db
        .from("bosta_shipments")
        .select("*")
        .eq("tracking_number", trackingNumber)
        .single();

      if (shipment && !error) {
        return res.json(
          await enrichShipmentWithOrderData({
            req,
            trackingNumber,
            shipment,
          }),
        );
      }

      // If not found in database, try Bosta's public tracking server first when
      // the business API is unavailable.
      if (!bostaService) {
        try {
          const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
          return res.json(
            await enrichShipmentWithOrderData({
              req,
              trackingNumber,
              shipment: publicShipment,
            }),
          );
        } catch (publicTrackingError) {
          return res.status(404).json({
            error:
              "Shipment not found in database and Bosta service not configured",
            message: publicTrackingError.message,
          });
        }
      }

      try {
        const bostaDelivery =
          await bostaService.getDeliveryStatus(trackingNumber);
        const deliveryState = getBostaDeliveryStateCode(bostaDelivery);

        // Return the Bosta API response with expected format
        const formattedShipment = {
          tracking_number: bostaDelivery.trackingNumber || trackingNumber,
          delivery_id: bostaDelivery._id,
          order_id: null, // Will be null if not in our database
          bosta_order_type: getBostaOrderType(bostaDelivery),
          delivery_state: deliveryState,
          delivery_state_label: getBostaDeliveryStateLabel(bostaDelivery),
          expected_shipping_cost: getBostaShippingCost(bostaDelivery),
          cod_amount: bostaDelivery.cod || 0,
          revenue: toNumber(bostaDelivery.cod),
          is_delivered: BostaService.isDeliveredState(
            deliveryState,
            getBostaDeliveryStateLabel(bostaDelivery),
          ),
          business_reference: bostaDelivery.businessReference || null,
          receiver: bostaDelivery.receiver || null,
          customer_name:
            bostaDelivery.receiver?.fullName ||
            [bostaDelivery.receiver?.firstName, bostaDelivery.receiver?.lastName]
              .filter(Boolean)
              .join(" ") ||
            null,
          created_at: bostaDelivery.createdAt || null,
          updated_at: bostaDelivery.updatedAt || null,
          bosta_response: bostaDelivery,
        };

        return res.json(
          await enrichShipmentWithOrderData({
            req,
            trackingNumber,
            shipment: formattedShipment,
            bostaDelivery,
          }),
        );
      } catch (bostaError) {
        console.error("Failed to fetch from Bosta API:", bostaError);

        try {
          const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
          return res.json(
            await enrichShipmentWithOrderData({
              req,
              trackingNumber,
              shipment: publicShipment,
            }),
          );
        } catch (publicTrackingError) {
          console.error(
            "Failed to fetch from Bosta public tracking:",
            publicTrackingError,
          );
        }

        // Check if it's a 404 or invalid tracking number
        if (isTrackingNotFoundError(bostaError)) {
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
