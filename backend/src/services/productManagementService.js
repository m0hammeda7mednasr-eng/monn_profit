import { Product } from "../models/index.js";
import {
  extractProductLocalMetadata,
  extractWarehouseInventorySnapshot,
} from "../helpers/productLocalMetadata.js";

export class ProductManagementService {
  /**
   * Get complete product details with all related data from Shopify
   */
  static async getProductDetails(userId, productId) {
    try {
      console.log("ProductManagementService.getProductDetails called:", {
        userId,
        productId,
      });

      const { data: product, error } = await Product.findByIdForUser(
        userId,
        productId,
      );

      console.log("Product query result:", { found: !!product, error: error });

      if (error || !product) {
        console.error("Product not found or error:", error);
        throw new Error("Product not found");
      }

      // Access already validated through store scope (findByIdForUser)

      // Parse the data field if it's a string
      let productData = product.data;
      if (typeof productData === "string") {
        try {
          productData = JSON.parse(productData);
        } catch (e) {
          productData = {};
        }
      }
      const localMetadata = extractProductLocalMetadata(productData);

      // Extract ALL product details from Shopify data

      // Basic Information
      product.title = productData?.title || product.title;
      product.body_html = productData?.body_html || product.description;
      product.vendor = productData?.vendor || product.vendor;
      product.product_type = productData?.product_type || product.product_type;
      product.handle = productData?.handle || null;
      product.template_suffix = productData?.template_suffix || null;

      // Status
      product.status = productData?.status || "active";
      product.published_at = productData?.published_at || null;
      product.published_scope = productData?.published_scope || null;

      // Tags
      product.tags = productData?.tags || product.tags || "";

      // Admin GraphQL API ID
      product.admin_graphql_api_id = productData?.admin_graphql_api_id || null;

      // Extract ALL variants with complete details
      const variants = productData?.variants || [];
      product.variants = variants.map((variant) => {
        const warehouseSnapshot = extractWarehouseInventorySnapshot(variant);

        return {
        id: variant.id,
        product_id: variant.product_id,
        title: variant.title,
        price: variant.price,
        cost: variant.cost || variant.cost_price || 0, // Extract cost from Shopify
        sku: variant.sku,
        position: variant.position,
        inventory_policy: variant.inventory_policy,
        compare_at_price: variant.compare_at_price,
        fulfillment_service: variant.fulfillment_service,
        inventory_management: variant.inventory_management,
        option1: variant.option1,
        option2: variant.option2,
        option3: variant.option3,
        created_at: variant.created_at,
        updated_at: variant.updated_at,
        taxable: variant.taxable,
        barcode: variant.barcode,
        grams: variant.grams,
        image_id: variant.image_id,
        weight: variant.weight,
        weight_unit: variant.weight_unit,
        inventory_item_id: variant.inventory_item_id,
        inventory_quantity: variant.inventory_quantity,
        shopify_inventory_quantity: variant.inventory_quantity,
        warehouse_inventory_quantity: warehouseSnapshot.quantity,
        old_inventory_quantity: variant.old_inventory_quantity,
        requires_shipping: variant.requires_shipping,
        admin_graphql_api_id: variant.admin_graphql_api_id,
        };
      });

      // Update cost_price from first variant if not set
      if (!product.cost_price && variants.length > 0) {
        const firstVariant = variants[0];
        product.cost_price = firstVariant.cost || firstVariant.cost_price || 0;
      }

      // Extract ALL images with complete details
      const images = productData?.images || [];
      product.images = images.map((image) => ({
        id: image.id,
        product_id: image.product_id,
        position: image.position,
        created_at: image.created_at,
        updated_at: image.updated_at,
        alt: image.alt,
        width: image.width,
        height: image.height,
        src: image.src,
        variant_ids: image.variant_ids || [],
        admin_graphql_api_id: image.admin_graphql_api_id,
      }));

      // Main image (first image or from image field)
      product.image = productData?.image || null;
      if (product.images && product.images.length > 0) {
        product.image_url = product.images[0].src;
      } else if (productData?.image?.src) {
        product.image_url = productData.image.src;
      }

      // Extract product options (Size, Color, etc.)
      const options = productData?.options || [];
      product.options = options.map((option) => ({
        id: option.id,
        product_id: option.product_id,
        name: option.name,
        position: option.position,
        values: option.values || [],
      }));

      // SEO Information
      product.seo_title = productData?.seo_title || null;
      product.seo_description = productData?.seo_description || null;
      product.metafields_global_title_tag =
        productData?.metafields_global_title_tag || null;
      product.metafields_global_description_tag =
        productData?.metafields_global_description_tag || null;

      // Collections
      product.collections = productData?.collections || [];

      // Metafields (custom fields)
      product.metafields = productData?.metafields || [];
      product.supplier_phone = localMetadata.supplier_phone;
      product.supplier_location = localMetadata.supplier_location;
      product.suppress_low_stock_alerts = Boolean(
        localMetadata.suppress_low_stock_alerts,
      );

      // Inventory tracking
      product.inventory_tracked = variants.some(
        (v) => v.inventory_management === "shopify",
      );
      product.total_inventory = variants.reduce(
        (sum, v) => sum + (v.inventory_quantity || 0),
        0,
      );
      product.total_shopify_inventory = product.total_inventory;
      product.total_warehouse_inventory = variants.reduce(
        (sum, variant) =>
          sum + extractWarehouseInventorySnapshot(variant).quantity,
        0,
      );
      product.inventory_quantity =
        variants.length > 0
          ? product.total_inventory
          : product.inventory_quantity;
      product.shopify_inventory_quantity = product.inventory_quantity;
      product.warehouse_inventory_quantity = product.total_warehouse_inventory;
      product.variants_count = variants.length;
      product.has_multiple_variants = variants.length > 1;

      // Price range
      const prices = variants
        .map((v) => parseFloat(v.price))
        .filter((p) => !isNaN(p));
      if (prices.length > 0) {
        product.price_min = Math.min(...prices);
        product.price_max = Math.max(...prices);
        product.price_varies = product.price_min !== product.price_max;
      }

      // Compare at price range (original price before discount)
      const compareAtPrices = variants
        .map((v) => parseFloat(v.compare_at_price))
        .filter((p) => !isNaN(p) && p > 0);
      if (compareAtPrices.length > 0) {
        product.compare_at_price_min = Math.min(...compareAtPrices);
        product.compare_at_price_max = Math.max(...compareAtPrices);
        product.on_sale = compareAtPrices.some((cap, i) => cap > prices[i]);
      }

      // Weight information
      const weights = variants.map((v) => v.grams || 0);
      if (weights.length > 0) {
        product.weight_min = Math.min(...weights);
        product.weight_max = Math.max(...weights);
      }

      // Requires shipping
      product.requires_shipping = variants.some((v) => v.requires_shipping);

      // Taxable
      product.taxable = variants.some((v) => v.taxable);

      // Timestamps
      product.created_at = productData?.created_at || product.created_at;
      product.updated_at = productData?.updated_at || product.updated_at;
      product.published_at = productData?.published_at || null;

      return product;
    } catch (error) {
      console.error("Get product details error:", error);
      throw error;
    }
  }
}
