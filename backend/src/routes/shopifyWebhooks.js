import express from "express";
import {
  getWebhookSecretForShop,
  handleShopifyWebhook,
  verifyWebhookHmac,
} from "../services/shopifyWebhookService.js";
import { emitRealtimeEvent } from "../services/realtimeEventService.js";

const router = express.Router();

router.post("/", async (req, res) => {
  const topic = req.get("x-shopify-topic");
  const shopDomain = req.get("x-shopify-shop-domain");
  const hmacHeader = req.get("x-shopify-hmac-sha256");
  const webhookId = req.get("x-shopify-webhook-id");

  if (!topic || !shopDomain || !hmacHeader) {
    return res.status(400).json({ error: "Missing Shopify webhook headers" });
  }

  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(req.body || "", "utf8");

    const secret = await getWebhookSecretForShop(shopDomain);
    const validSignature = verifyWebhookHmac(rawBody, hmacHeader, secret);
    if (!validSignature) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }

    let payload = {};
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }

    const result = await handleShopifyWebhook({
      topic,
      shopDomain,
      payload,
    });

    if (!result.handled) {
      return res.status(200).json({
        success: true,
        ignored: true,
        reason: result.reason || "ignored",
      });
    }

    const topicText = String(result.topic || "").toLowerCase();
    const eventType = topicText.startsWith("orders/")
      ? "orders.updated"
      : topicText.startsWith("products/")
        ? "products.updated"
        : topicText.startsWith("inventory_levels/")
          ? "products.updated"
          : topicText.startsWith("customers/")
            ? "customers.updated"
          : "data.updated";
    emitRealtimeEvent({
      type: eventType,
      source: "shopify.webhook",
      userIds: result.affectedUserIds || [],
      storeIds: result.affectedStoreIds || [],
      payload: {
        topic: result.topic,
        webhookId: webhookId || null,
      },
    });

    return res.status(200).json({
      success: true,
      topic: result.topic,
      webhookId: webhookId || null,
    });
  } catch (error) {
    console.error("Shopify webhook processing error:", error);
    return res.status(500).json({ error: "Failed to process webhook" });
  }
});

export default router;
