import axios from "axios";
import { Product } from "../models/index.js";
import {
  extractProductLocalMetadata,
  mergeProductLocalMetadata,
  preserveProductLocalMetadata,
  preserveProductWarehouseData,
} from "../helpers/productLocalMetadata.js";
import { insertActivityLog } from "./activityLogService.js";

const SHOPIFY_API_VERSION = "2024-01";

const getShopifyTokenForStore = async (storeId, fallbackUserId) => {
  const { supabase } = await import("../supabaseClient.js");

  if (storeId) {
    const { data: tokenByStore } = await supabase
      .from("shopify_tokens")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenByStore) {
      return tokenByStore;
    }
  }

  const { data: tokenByUser } = await supabase
    .from("shopify_tokens")
    .select("*")
    .eq("user_id", fallbackUserId)
    .single();

  return tokenByUser || null;
};

const parseNumeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSku = (value) => String(value ?? "").trim();
const normalizeText = (value) => String(value ?? "").trim();

const hasOwn = (value, key) =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

const parseProductData = (value) => {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return value;
};

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value || {}));

const getProductVariants = (productData = {}) =>
  Array.isArray(productData?.variants) ? productData.variants : [];

const buildShopifyHeaders = (accessToken) => ({
  "X-Shopify-Access-Token": accessToken,
  "Content-Type": "application/json",
});

const getTotalInventory = (variants = [], fallbackInventory = 0) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return parseNumeric(fallbackInventory);
  }

  return variants.reduce(
    (sum, variant) => sum + parseNumeric(variant?.inventory_quantity),
    0,
  );
};

const applyPrimaryVariantUpdates = (productData, updates = {}) => {
  const variants = getProductVariants(productData);
  if (variants.length === 0) {
    return productData;
  }

  const [firstVariant, ...restVariants] = variants;
  const updatedFirstVariant = { ...firstVariant };

  if (updates.price !== undefined) {
    updatedFirstVariant.price = updates.price?.toString();
  }

  if (updates.inventory_quantity !== undefined) {
    updatedFirstVariant.inventory_quantity = updates.inventory_quantity;
  }

  if (updates.sku !== undefined) {
    updatedFirstVariant.sku = normalizeSku(updates.sku);
  }

  updatedFirstVariant.updated_at = new Date().toISOString();

  return {
    ...productData,
    variants: [updatedFirstVariant, ...restVariants],
  };
};

const applyVariantUpdates = (productData, variantUpdates = []) => {
  const variants = getProductVariants(productData);
  if (variantUpdates.length === 0) {
    return productData;
  }

  if (variants.length === 0) {
    throw new Error("No variants found for this product.");
  }

  const updatesById = new Map(
    variantUpdates.map((variantUpdate) => [
      String(variantUpdate.id),
      variantUpdate,
    ]),
  );

  const seenVariantIds = new Set();
  const updatedVariants = variants.map((variant) => {
    const variantId = String(variant?.id || "");
    const requestedUpdate = updatesById.get(variantId);

    if (!requestedUpdate) {
      return variant;
    }

    seenVariantIds.add(variantId);

    const updatedVariant = {
      ...variant,
      updated_at: new Date().toISOString(),
    };

    if (requestedUpdate.inventory_quantity !== undefined) {
      updatedVariant.inventory_quantity = requestedUpdate.inventory_quantity;
    }
    if (requestedUpdate.price !== undefined) {
      updatedVariant.price = requestedUpdate.price?.toString();
    }
    if (requestedUpdate.sku !== undefined) {
      updatedVariant.sku = normalizeSku(requestedUpdate.sku);
    }

    return updatedVariant;
  });

  for (const variantUpdate of variantUpdates) {
    const variantId = String(variantUpdate.id || "");
    if (!seenVariantIds.has(variantId)) {
      throw new Error(`Variant ${variantId} was not found for this product.`);
    }
  }

  return {
    ...productData,
    variants: updatedVariants,
  };
};

export const buildShopifyVariantPayloads = (
  parsedProductData = {},
  updates = {},
) => {
  const variants = getProductVariants(parsedProductData);
  if (variants.length === 0) {
    throw new Error("Variant ID not found for this product.");
  }

  const requestedVariantUpdates = Array.isArray(updates?.variant_updates)
    ? updates.variant_updates
    : [];
  const updatesById = new Map(
    requestedVariantUpdates.map((variantUpdate) => [
      String(variantUpdate?.id || ""),
      variantUpdate,
    ]),
  );
  const seenVariantIds = new Set();

  const variantPayloads = variants.map((variant, index) => {
    const variantId = String(variant?.id || "");
    if (!variantId) {
      throw new Error("Variant ID not found for this product.");
    }

    const requestedUpdate = updatesById.get(variantId);
    if (requestedUpdate) {
      seenVariantIds.add(variantId);
    }

    const isPrimaryVariant = index === 0;
    const payload = {
      id: parseInt(variantId, 10),
    };

    const resolvedPrice =
      requestedUpdate?.price !== undefined
        ? requestedUpdate.price
        : isPrimaryVariant && updates.price !== undefined
          ? updates.price
          : variant?.price;
    if (
      resolvedPrice !== undefined &&
      resolvedPrice !== null &&
      String(resolvedPrice).trim() !== ""
    ) {
      payload.price = resolvedPrice.toString();
    }

    const resolvedSku =
      requestedUpdate?.sku !== undefined
        ? normalizeSku(requestedUpdate.sku)
        : isPrimaryVariant && updates.sku !== undefined
          ? normalizeSku(updates.sku)
          : normalizeSku(variant?.sku);
    if (resolvedSku) {
      payload.sku = resolvedSku;
    }

    return payload;
  });

  for (const variantUpdate of requestedVariantUpdates) {
    const variantId = String(variantUpdate?.id || "");
    if (!seenVariantIds.has(variantId)) {
      throw new Error(`Variant ${variantId} was not found for this product.`);
    }
  }

  return variantPayloads;
};

export const buildShopifyInventoryLevelPayloads = (
  parsedProductData = {},
  updates = {},
) => {
  const variants = getProductVariants(parsedProductData);
  if (variants.length === 0) {
    return [];
  }

  const variantUpdates = Array.isArray(updates?.variant_updates)
    ? updates.variant_updates
    : [];
  const inventoryUpdatesById = new Map(
    variantUpdates
      .filter((variantUpdate) => variantUpdate?.inventory_quantity !== undefined)
      .map((variantUpdate) => [String(variantUpdate?.id || ""), variantUpdate]),
  );
  const seenVariantIds = new Set();
  const payloads = [];

  for (const [index, variant] of variants.entries()) {
    const variantId = String(variant?.id || "");
    const requestedUpdate = inventoryUpdatesById.get(variantId);
    const isPrimaryVariant = index === 0;
    const resolvedInventory =
      requestedUpdate?.inventory_quantity !== undefined
        ? requestedUpdate.inventory_quantity
        : isPrimaryVariant && updates.inventory_quantity !== undefined
          ? updates.inventory_quantity
          : undefined;

    if (resolvedInventory === undefined) {
      continue;
    }

    if (!variantId) {
      throw new Error("Variant ID not found for this product.");
    }
    if (!variant?.inventory_item_id) {
      throw new Error(
        `Variant ${variantId} is missing Shopify inventory_item_id.`,
      );
    }

    seenVariantIds.add(variantId);
    payloads.push({
      variant_id: variantId,
      inventory_item_id: String(variant.inventory_item_id),
      available: resolvedInventory,
    });
  }

  for (const [variantId] of inventoryUpdatesById.entries()) {
    if (!seenVariantIds.has(variantId)) {
      throw new Error(`Variant ${variantId} was not found for this product.`);
    }
  }

  return payloads;
};

const fetchPrimaryShopifyLocationId = async (tokenData) => {
  const response = await axios.get(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/locations.json`,
    {
      headers: buildShopifyHeaders(tokenData.access_token),
      params: { limit: 20 },
    },
  );

  const locations = Array.isArray(response?.data?.locations)
    ? response.data.locations
    : [];
  const activeLocation =
    locations.find((location) => location?.active !== false) || locations[0];

  if (!activeLocation?.id) {
    throw new Error("No active Shopify location was found for inventory updates");
  }

  return activeLocation.id;
};

const fetchShopifyProductById = async (tokenData, shopifyProductId) => {
  const response = await axios.get(
    `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${shopifyProductId}.json`,
    {
      headers: buildShopifyHeaders(tokenData.access_token),
    },
  );

  return response?.data?.product || null;
};

const hasVariantProductFieldUpdates = (updates = {}) =>
  Array.isArray(updates?.variant_updates) &&
  updates.variant_updates.some(
    (variantUpdate) =>
      variantUpdate?.price !== undefined || variantUpdate?.sku !== undefined,
  );

const applyShopifyUpdateFallback = (parsedProductData = {}, updates = {}) => {
  let nextProductData = parsedProductData;

  if (
    updates?.price !== undefined ||
    updates?.sku !== undefined ||
    updates?.inventory_quantity !== undefined
  ) {
    nextProductData = applyPrimaryVariantUpdates(nextProductData, {
      price: updates.price,
      sku: updates.sku,
      inventory_quantity: updates.inventory_quantity,
    });
  }

  if (Array.isArray(updates?.variant_updates) && updates.variant_updates.length > 0) {
    nextProductData = applyVariantUpdates(nextProductData, updates.variant_updates);
  }

  return nextProductData;
};

export class ProductUpdateService {
  /**
   * Update product (price, costs, inventory, sku) locally and sync with Shopify
   */
  static async updateProduct(userId, productId, updates) {
    const {
      price,
      cost_price,
      ads_cost,
      operation_cost,
      shipping_cost,
      inventory,
      sku,
      supplier_phone,
      supplier_location,
      suppress_low_stock_alerts,
    } = updates;
    const variantUpdates = Array.isArray(updates?.variant_updates)
      ? updates.variant_updates
      : [];
    const localFieldUpdates = {};
    if (hasOwn(updates, "supplier_phone")) {
      localFieldUpdates.supplier_phone = normalizeText(supplier_phone);
    }
    if (hasOwn(updates, "supplier_location")) {
      localFieldUpdates.supplier_location = normalizeText(supplier_location);
    }
    if (hasOwn(updates, "suppress_low_stock_alerts")) {
      localFieldUpdates.suppress_low_stock_alerts = Boolean(
        suppress_low_stock_alerts,
      );
    }
    const localOnlyFields = [];
    if (cost_price !== undefined) {
      localOnlyFields.push("cost_price");
    }
    if (ads_cost !== undefined) {
      localOnlyFields.push("ads_cost");
    }
    if (operation_cost !== undefined) {
      localOnlyFields.push("operation_cost");
    }
    if (shipping_cost !== undefined) {
      localOnlyFields.push("shipping_cost");
    }
    if (hasOwn(localFieldUpdates, "supplier_phone")) {
      localOnlyFields.push("supplier_phone");
    }
    if (hasOwn(localFieldUpdates, "supplier_location")) {
      localOnlyFields.push("supplier_location");
    }
    if (hasOwn(localFieldUpdates, "suppress_low_stock_alerts")) {
      localOnlyFields.push("suppress_low_stock_alerts");
    }
    const shopifyFields = [];
    if (price !== undefined) {
      shopifyFields.push("price");
    }
    if (inventory !== undefined) {
      shopifyFields.push("inventory");
    }
    if (sku !== undefined) {
      shopifyFields.push("sku");
    }
    if (variantUpdates.length > 0) {
      shopifyFields.push("variants");
    }
    const requiresShopifySync = shopifyFields.length > 0;

    // Validation
    if (price !== undefined) {
      if (!Number.isFinite(price)) throw new Error("Price is invalid");
      if (price < 0) throw new Error("Price cannot be negative");
      if (price > 1000000)
        throw new Error("Price exceeds maximum allowed value");
    }
    if (cost_price !== undefined) {
      if (!Number.isFinite(cost_price))
        throw new Error("Cost price is invalid");
      if (cost_price < 0) throw new Error("Cost price cannot be negative");
      if (cost_price > 1000000)
        throw new Error("Cost price exceeds maximum allowed value");
    }
    if (ads_cost !== undefined) {
      if (!Number.isFinite(ads_cost)) throw new Error("Ads cost is invalid");
      if (ads_cost < 0) throw new Error("Ads cost cannot be negative");
      if (ads_cost > 1000000)
        throw new Error("Ads cost exceeds maximum allowed value");
    }
    if (operation_cost !== undefined) {
      if (!Number.isFinite(operation_cost))
        throw new Error("Operation cost is invalid");
      if (operation_cost < 0)
        throw new Error("Operation cost cannot be negative");
      if (operation_cost > 1000000)
        throw new Error("Operation cost exceeds maximum allowed value");
    }
    if (shipping_cost !== undefined) {
      if (!Number.isFinite(shipping_cost))
        throw new Error("Shipping cost is invalid");
      if (shipping_cost < 0)
        throw new Error("Shipping cost cannot be negative");
      if (shipping_cost > 1000000)
        throw new Error("Shipping cost exceeds maximum allowed value");
    }
    if (inventory !== undefined) {
      if (!Number.isFinite(inventory)) throw new Error("Inventory is invalid");
      if (inventory < 0) throw new Error("Inventory cannot be negative");
      if (inventory > 1000000)
        throw new Error("Inventory exceeds maximum allowed value");
    }
    if (sku !== undefined && normalizeSku(sku).length > 255) {
      throw new Error("SKU exceeds maximum allowed length");
    }
    if (
      hasOwn(localFieldUpdates, "supplier_phone") &&
      localFieldUpdates.supplier_phone.length > 100
    ) {
      throw new Error("Supplier phone exceeds maximum allowed length");
    }
    if (
      hasOwn(localFieldUpdates, "supplier_location") &&
      localFieldUpdates.supplier_location.length > 255
    ) {
      throw new Error("Supplier location exceeds maximum allowed length");
    }
    for (const variantUpdate of variantUpdates) {
      if (!variantUpdate?.id) {
        throw new Error("Variant ID is required");
      }
      if (
        variantUpdate?.inventory_quantity === undefined &&
        variantUpdate?.price === undefined &&
        variantUpdate?.sku === undefined
      ) {
        throw new Error("Variant update must include inventory, price, or SKU");
      }

      const inventoryQuantity = variantUpdate?.inventory_quantity;
      if (inventoryQuantity !== undefined) {
        if (!Number.isFinite(inventoryQuantity)) {
          throw new Error("Variant inventory is invalid");
        }
        if (inventoryQuantity < 0) {
          throw new Error("Variant inventory cannot be negative");
        }
        if (inventoryQuantity > 1000000) {
          throw new Error("Variant inventory exceeds maximum allowed value");
        }
      }

      const variantPrice = variantUpdate?.price;
      if (variantPrice !== undefined) {
        if (!Number.isFinite(variantPrice)) {
          throw new Error("Variant price is invalid");
        }
        if (variantPrice < 0) {
          throw new Error("Variant price cannot be negative");
        }
        if (variantPrice > 1000000) {
          throw new Error("Variant price exceeds maximum allowed value");
        }
      }

      if (
        variantUpdate?.sku !== undefined &&
        normalizeSku(variantUpdate.sku).length > 255
      ) {
        throw new Error("Variant SKU exceeds maximum allowed length");
      }
    }

    try {
      // Get current product
      const { data: product, error } = await Product.findByIdForUser(
        userId,
        productId,
      );
      if (error || !product) {
        throw new Error("Product not found");
      }

      const currentProductData = parseProductData(product.data);
      let nextProductData = cloneJsonValue(currentProductData);

      const oldValues = {};
      const currentLocalMetadata =
        extractProductLocalMetadata(currentProductData);

      if (
        hasOwn(localFieldUpdates, "supplier_phone") &&
        localFieldUpdates.supplier_phone !== currentLocalMetadata.supplier_phone
      ) {
        oldValues.supplier_phone = currentLocalMetadata.supplier_phone;
      }
      if (
        hasOwn(localFieldUpdates, "supplier_location") &&
        localFieldUpdates.supplier_location !==
          currentLocalMetadata.supplier_location
      ) {
        oldValues.supplier_location = currentLocalMetadata.supplier_location;
      }
      if (
        hasOwn(localFieldUpdates, "suppress_low_stock_alerts") &&
        Boolean(localFieldUpdates.suppress_low_stock_alerts) !==
          Boolean(currentLocalMetadata.suppress_low_stock_alerts)
      ) {
        oldValues.suppress_low_stock_alerts = Boolean(
          currentLocalMetadata.suppress_low_stock_alerts,
        );
      }

      if (Object.keys(localFieldUpdates).length > 0) {
        nextProductData = mergeProductLocalMetadata(
          nextProductData,
          localFieldUpdates,
        );
      }

      // Build update object
      const updateData = {
        pending_sync: requiresShopifySync,
        sync_error: null,
        local_updated_at: new Date().toISOString(),
      };

      if (price !== undefined) {
        updateData.price = price;
        oldValues.price = product.price;
      }
      if (sku !== undefined) {
        updateData.sku = normalizeSku(sku);
        oldValues.sku = product.sku;
      }
      if (cost_price !== undefined) {
        updateData.cost_price = cost_price;
        oldValues.cost_price = product.cost_price;
      }
      if (ads_cost !== undefined) {
        updateData.ads_cost = ads_cost;
        oldValues.ads_cost = product.ads_cost;
      }
      if (operation_cost !== undefined) {
        updateData.operation_cost = operation_cost;
        oldValues.operation_cost = product.operation_cost;
      }
      if (shipping_cost !== undefined) {
        updateData.shipping_cost = shipping_cost;
        oldValues.shipping_cost = product.shipping_cost;
      }
      if (inventory !== undefined || variantUpdates.length > 0) {
        oldValues.inventory_quantity = product.inventory_quantity;
      }
      if (variantUpdates.length > 0) {
        if (!hasOwn(oldValues, "price")) {
          oldValues.price = product.price;
        }
        if (!hasOwn(oldValues, "sku")) {
          oldValues.sku = product.sku;
        }
      }

      if (price !== undefined || inventory !== undefined || sku !== undefined) {
        nextProductData = applyPrimaryVariantUpdates(nextProductData, {
          price,
          inventory_quantity: inventory,
          sku,
        });
      }

      if (variantUpdates.length > 0) {
        nextProductData = applyVariantUpdates(nextProductData, variantUpdates);
      }

      const hasVariantBackedData =
        getProductVariants(nextProductData).length > 0;
      const primaryVariant = hasVariantBackedData
        ? getProductVariants(nextProductData)[0] || null
        : null;
      if (
        price !== undefined ||
        inventory !== undefined ||
        sku !== undefined ||
        variantUpdates.length > 0
      ) {
        oldValues.data = cloneJsonValue(currentProductData);
        updateData.data = nextProductData;
      }

      if (primaryVariant) {
        if (price !== undefined || variantUpdates.length > 0) {
          updateData.price =
            primaryVariant.price !== undefined &&
            primaryVariant.price !== null &&
            String(primaryVariant.price).trim() !== ""
              ? parseNumeric(primaryVariant.price)
              : product.price;
        }
        if (sku !== undefined || variantUpdates.length > 0) {
          updateData.sku = normalizeSku(primaryVariant.sku);
        }
      }

      if (inventory !== undefined || variantUpdates.length > 0) {
        updateData.inventory_quantity = hasVariantBackedData
          ? getTotalInventory(getProductVariants(nextProductData), inventory)
          : inventory;
      }
      if (
        Object.keys(localFieldUpdates).length > 0 &&
        !Object.prototype.hasOwnProperty.call(oldValues, "data")
      ) {
        oldValues.data = cloneJsonValue(currentProductData);
        updateData.data = nextProductData;
      }

      // Update locally
      const { error: updateError } = await Product.update(
        productId,
        updateData,
      );
      if (updateError) {
        throw updateError;
      }

      // Log operation
      this.logActivity(userId, "product_update", productId, product.title, {
        updates,
        old_values: oldValues,
      });
      if (requiresShopifySync) {
        await this.logSyncOperation(userId, productId, "product_update", {
          updates,
          old_values: oldValues,
        });
      }

      // Sync to Shopify asynchronously (only price, inventory, and sku; not cost_price)
      const shopifyUpdates = {};
      if (price !== undefined) shopifyUpdates.price = price;
      if (inventory !== undefined)
        shopifyUpdates.inventory_quantity = inventory;
      if (sku !== undefined) {
        shopifyUpdates.sku = normalizeSku(sku);
      }
      if (variantUpdates.length > 0) {
        shopifyUpdates.variant_updates = variantUpdates;
      }

      if (requiresShopifySync) {
        try {
          await this.syncToShopify(userId, productId, shopifyUpdates);
        } catch (syncError) {
          const rollbackData = {
            pending_sync: false,
            sync_error: syncError.message,
            local_updated_at: new Date().toISOString(),
          };

          if (Object.prototype.hasOwnProperty.call(oldValues, "price")) {
            rollbackData.price = oldValues.price;
          }
          if (
            Object.prototype.hasOwnProperty.call(
              oldValues,
              "inventory_quantity",
            )
          ) {
            rollbackData.inventory_quantity = oldValues.inventory_quantity;
          }
          if (Object.prototype.hasOwnProperty.call(oldValues, "sku")) {
            rollbackData.sku = oldValues.sku;
          }
          if (Object.prototype.hasOwnProperty.call(oldValues, "data")) {
            rollbackData.data =
              Object.keys(localFieldUpdates).length > 0
                ? mergeProductLocalMetadata(oldValues.data, localFieldUpdates)
                : oldValues.data;
          }

          const { error: rollbackError } = await Product.update(
            productId,
            rollbackData,
          );
          if (rollbackError) {
            console.error(
              "Rollback failed after Shopify sync failure:",
              rollbackError,
            );
          }
          throw new Error(
            `Shopify sync failed. Local changes were reverted: ${syncError.message}`,
          );
        }
      }

      return {
        success: true,
        localUpdate: true,
        shopifySync: requiresShopifySync ? "synced" : "not_needed",
        shopifyFields,
        localOnlyFields,
      };
    } catch (error) {
      console.error("Update product error:", error);
      throw error;
    }
  }

  /**
   * Update product price locally and sync with Shopify
   */
  static async updatePrice(userId, productId, newPrice) {
    // Validation
    if (newPrice < 0) {
      throw new Error("Price cannot be negative");
    }
    if (newPrice > 1000000) {
      throw new Error("Price exceeds maximum allowed value");
    }

    return this.updateProduct(userId, productId, { price: newPrice });
  }

  /**
   * Update product inventory locally and sync with Shopify
   */
  static async updateInventory(userId, productId, newQuantity) {
    // Validation
    if (newQuantity < 0) {
      throw new Error("Inventory cannot be negative");
    }
    if (newQuantity > 1000000) {
      throw new Error("Inventory exceeds maximum allowed value");
    }

    return this.updateProduct(userId, productId, { inventory: newQuantity });
  }

  /**
   * Sync product updates to Shopify
   */
  static async syncToShopify(userId, productId, updates) {
    try {
      // Get product and Shopify token
      const { data: product } = await Product.findByIdForUser(
        userId,
        productId,
      );
      if (!product || !product.shopify_id) {
        throw new Error("Product not found or missing Shopify ID");
      }

      const tokenData = await getShopifyTokenForStore(product.store_id, userId);

      if (!tokenData) {
        throw new Error("Shopify not connected");
      }

      // Build Shopify API payload
      const parsedProductData = parseProductData(product.data);
      const inventoryLevelPayloads = buildShopifyInventoryLevelPayloads(
        parsedProductData,
        updates,
      );
      const requiresProductUpdate =
        updates.price !== undefined ||
        updates.sku !== undefined ||
        hasVariantProductFieldUpdates(updates);
      let latestShopifyProduct = null;

      if (requiresProductUpdate) {
        const variantPayloads = buildShopifyVariantPayloads(
          parsedProductData,
          updates,
        );
        const shopifyPayload = {
          product: {
            id: parseInt(product.shopify_id),
            variants: variantPayloads,
          },
        };

        const response = await axios.put(
          `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/products/${product.shopify_id}.json`,
          shopifyPayload,
          {
            headers: buildShopifyHeaders(tokenData.access_token),
          },
        );

        latestShopifyProduct = response?.data?.product || null;
      }

      if (inventoryLevelPayloads.length > 0) {
        const locationId = await fetchPrimaryShopifyLocationId(tokenData);

        await Promise.all(
          inventoryLevelPayloads.map((inventoryLevelPayload) =>
            axios.post(
              `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`,
              {
                location_id: locationId,
                inventory_item_id: inventoryLevelPayload.inventory_item_id,
                available: inventoryLevelPayload.available,
              },
              {
                headers: buildShopifyHeaders(tokenData.access_token),
              },
            ),
          ),
        );
      }

      if (requiresProductUpdate || inventoryLevelPayloads.length > 0) {
        try {
          latestShopifyProduct =
            (await fetchShopifyProductById(tokenData, product.shopify_id)) ||
            latestShopifyProduct;
        } catch (refreshError) {
          console.warn(
            "Failed to refresh Shopify product after sync; using local fallback snapshot.",
            refreshError,
          );
        }
      }

      // Update sync status
      const syncedProductData =
        latestShopifyProduct || applyShopifyUpdateFallback(parsedProductData, updates);
      const mergedSyncedProductData = preserveProductLocalMetadata(
        preserveProductWarehouseData(syncedProductData, product.data),
        product.data,
      );
      const syncedVariants = getProductVariants(syncedProductData);
      const syncedPrimaryVariant = syncedVariants[0] || {};
      const requestedPrimaryVariantUpdate = Array.isArray(
        updates.variant_updates,
      )
        ? updates.variant_updates.find(
            (variantUpdate) =>
              String(variantUpdate?.id || "") ===
              String(
                syncedPrimaryVariant?.id ||
                  parsedProductData?.variants?.[0]?.id ||
                  "",
              ),
          ) || null
        : null;
      const resolvedPrimaryPrice =
        syncedPrimaryVariant.price !== undefined &&
        syncedPrimaryVariant.price !== null &&
        String(syncedPrimaryVariant.price).trim() !== ""
          ? parseNumeric(syncedPrimaryVariant.price)
          : requestedPrimaryVariantUpdate?.price !== undefined
            ? requestedPrimaryVariantUpdate.price
            : updates.price !== undefined
              ? updates.price
              : product.price;
      const resolvedPrimarySku = hasOwn(syncedPrimaryVariant, "sku")
        ? normalizeSku(syncedPrimaryVariant.sku)
        : requestedPrimaryVariantUpdate &&
            hasOwn(requestedPrimaryVariantUpdate, "sku")
          ? normalizeSku(requestedPrimaryVariantUpdate.sku)
          : updates.sku !== undefined
            ? normalizeSku(updates.sku)
            : normalizeSku(product.sku);

      await Product.update(productId, {
        pending_sync: false,
        last_synced_at: new Date().toISOString(),
        shopify_updated_at:
          syncedProductData?.updated_at || new Date().toISOString(),
        sync_error: null,
        data: mergedSyncedProductData,
        inventory_quantity: getTotalInventory(
          syncedVariants,
          product.inventory_quantity,
        ),
        price: resolvedPrimaryPrice,
        sku: resolvedPrimarySku,
      });

      // Update sync operation log
      await this.updateSyncOperationStatus(
        userId,
        productId,
        "success",
        {
          product: syncedProductData,
          inventory_level_updates: inventoryLevelPayloads,
        },
      );

      console.log(`Product ${productId} synced successfully to Shopify`);
      return { success: true };
    } catch (error) {
      console.error("Shopify sync error:", error);

      // Save error
      await Product.update(productId, {
        pending_sync: true,
        sync_error: error.message,
      });

      // Update sync operation log
      await this.updateSyncOperationStatus(
        userId,
        productId,
        "failed",
        null,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Log sync operation
   */
  static async logSyncOperation(userId, entityId, operationType, requestData) {
    try {
      const { supabase } = await import("../supabaseClient.js");
      await supabase.from("sync_operations").insert([
        {
          user_id: userId,
          operation_type: operationType,
          entity_type: "product",
          entity_id: entityId,
          direction: "to_shopify",
          status: "pending",
          request_data: requestData,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error("Failed to log sync operation:", error);
    }
  }

  /**
   * Update sync operation status
   */
  static async updateSyncOperationStatus(
    userId,
    entityId,
    status,
    responseData = null,
    errorMessage = null,
  ) {
    try {
      const { supabase } = await import("../supabaseClient.js");

      // Find the most recent pending operation
      const { data: operations } = await supabase
        .from("sync_operations")
        .select("*")
        .eq("user_id", userId)
        .eq("entity_id", entityId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1);

      if (operations && operations.length > 0) {
        await supabase
          .from("sync_operations")
          .update({
            status,
            response_data: responseData,
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq("id", operations[0].id);
      }
    } catch (error) {
      console.error("Failed to update sync operation status:", error);
    }
  }

  static async logActivity(userId, action, entityId, entityName, details) {
    try {
      await insertActivityLog({
        user_id: userId,
        action,
        entity_type: "product",
        entity_id: entityId,
        entity_name: entityName,
        details,
      });
    } catch (error) {
      console.error("Failed to log activity:", error);
    }
  }
}
