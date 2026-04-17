const DEFAULT_VARIANT_TITLES = new Set(["default title", "default"]);

export const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseLocalDateInput = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
};

export const startOfDay = (dateString) => {
  const date = parseLocalDateInput(dateString);
  if (!date) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

export const endOfDay = (dateString) => {
  const date = parseLocalDateInput(dateString);
  if (!date) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
};

export const getNormalizedDateRange = (dateFrom, dateTo) => {
  const from = dateFrom ? startOfDay(dateFrom) : null;
  const to = dateTo ? endOfDay(dateTo) : null;

  if (from && to && from.getTime() > to.getTime()) {
    return {
      from: startOfDay(dateTo),
      to: endOfDay(dateFrom),
      wasSwapped: true,
    };
  }

  return {
    from,
    to,
    wasSwapped: false,
  };
};

export const getStockState = (inventoryQuantity) => {
  const quantity = toNumber(inventoryQuantity);
  if (quantity <= 0) return "out_of_stock";
  if (quantity < 10) return "low_stock";
  return "in_stock";
};

export const getAlertManagedStockState = (
  inventoryQuantity,
  suppressLowStockAlerts = false,
) => {
  const actualStockState = getStockState(inventoryQuantity);

  if (suppressLowStockAlerts && actualStockState !== "in_stock") {
    return "suppressed";
  }

  return actualStockState;
};

export const getSyncState = (product) => {
  if (product.pending_sync) return "pending";
  if (product.sync_error) return "failed";
  if (product.last_synced_at) return "synced";
  return "never";
};

export const getProfitabilityState = (item) => {
  const hasCost =
    item.cost_price !== null &&
    item.cost_price !== undefined &&
    item.cost_price !== "";
  if (!hasCost) return "no_cost";

  const totalCost =
    toNumber(item.cost_price) +
    toNumber(item.ads_cost || 0) +
    toNumber(item.operation_cost || 0) +
    toNumber(item.shipping_cost || 0);
  const profit = toNumber(item.price) - totalCost;
  if (profit > 0) return "profitable";
  if (profit < 0) return "loss";
  return "break_even";
};

export const getVariantTitle = (product, variant, index) => {
  const rawTitle = String(variant?.title || "").trim();
  if (!rawTitle) {
    return `Variant ${index + 1}`;
  }

  const normalizedTitle = rawTitle.toLowerCase();
  if (DEFAULT_VARIANT_TITLES.has(normalizedTitle)) {
    return "Default Variant";
  }

  const productTitle = String(product?.title || "")
    .trim()
    .toLowerCase();
  if (productTitle && normalizedTitle === productTitle) {
    return "Default Variant";
  }

  return rawTitle;
};

export const buildVariantRows = (products, isAdmin) =>
  (Array.isArray(products) ? products : []).flatMap((product) => {
    const variants =
      Array.isArray(product?.variants) && product.variants.length > 0
        ? product.variants
        : [
            {
              id: null,
              title: product?.title || "Default Variant",
              price: product?.price ?? 0,
              cost_price: product?.cost_price ?? null,
              sku: product?.sku || "",
              inventory_quantity: product?.inventory_quantity ?? 0,
              image_url: product?.image_url || "",
              updated_at:
                product?.updated_at || product?.local_updated_at || null,
              created_at: product?.created_at || null,
            },
          ];

    const hasMultipleVariants =
      Boolean(product?.has_multiple_variants) || variants.length > 1;

    return variants.map((variant, index) => {
      const variantTitle = getVariantTitle(product, variant, index);
      const inventoryQuantity = toNumber(
        variant?.inventory_quantity ?? product?.inventory_quantity ?? 0,
      );
      const shopifyInventoryQuantity = toNumber(
        variant?.shopify_inventory_quantity ??
          variant?.inventory_quantity ??
          product?.shopify_inventory_quantity ??
          product?.inventory_quantity ??
          0,
      );
      const warehouseInventoryQuantity = toNumber(
        variant?.warehouse_inventory_quantity ??
          product?.warehouse_inventory_quantity ??
          product?.total_warehouse_inventory ??
          0,
      );
      const price = variant?.price ?? product?.price ?? 0;
      const costPrice = isAdmin
        ? (variant?.cost_price ?? variant?.cost ?? product?.cost_price ?? null)
        : undefined;
      const updatedAt =
        variant?.updated_at ||
        product?.local_updated_at ||
        product?.last_synced_at ||
        product?.updated_at ||
        product?.created_at ||
        null;
      const optionValues = [
        variant?.option1,
        variant?.option2,
        variant?.option3,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      const row = {
        key: `${product?.id}:${variant?.id || `default-${index}`}`,
        id: product?.id,
        variant_id: variant?.id || null,
        product_title: product?.title || "Untitled product",
        variant_title: variantTitle,
        vendor: product?.vendor || "",
        product_type: product?.product_type || "",
        image_url: variant?.image_url || product?.image_url || "",
        sku: String(variant?.sku || product?.sku || "").trim(),
        barcode: String(variant?.barcode || "").trim(),
        supplier_links: Array.isArray(variant?.supplier_links)
          ? variant.supplier_links
          : Array.isArray(product?.supplier_links)
            ? product.supplier_links
            : [],
        price,
        compare_at_price: variant?.compare_at_price ?? null,
        cost_price: costPrice,
        ads_cost: isAdmin
          ? (variant?.ads_cost ?? product?.ads_cost ?? null)
          : undefined,
        operation_cost: isAdmin
          ? (variant?.operation_cost ?? product?.operation_cost ?? null)
          : undefined,
        shipping_cost: isAdmin
          ? (variant?.shipping_cost ?? product?.shipping_cost ?? null)
          : undefined,
        inventory_quantity: inventoryQuantity,
        shopify_inventory_quantity: shopifyInventoryQuantity,
        warehouse_inventory_quantity: warehouseInventoryQuantity,
        total_inventory: toNumber(
          product?.total_inventory ?? product?.inventory_quantity ?? 0,
        ),
        total_shopify_inventory: toNumber(
          product?.total_shopify_inventory ??
            product?.shopify_inventory_quantity ??
            product?.total_inventory ??
            product?.inventory_quantity ??
            0,
        ),
        total_warehouse_inventory: toNumber(
          product?.total_warehouse_inventory ??
            product?.warehouse_inventory_quantity ??
            0,
        ),
        pending_sync: Boolean(product?.pending_sync),
        sync_error: product?.sync_error || "",
        last_synced_at: product?.last_synced_at || null,
        local_updated_at: product?.local_updated_at || null,
        updated_at: updatedAt,
        created_at: variant?.created_at || product?.created_at || null,
        has_multiple_variants: hasMultipleVariants,
        variants_count: toNumber(product?.variants_count || variants.length),
        option_values: optionValues,
        suppress_low_stock_alerts: Boolean(product?.suppress_low_stock_alerts),
      };

      return {
        ...row,
        _meta: {
          actualStockState: getStockState(inventoryQuantity),
          stockState: getAlertManagedStockState(
            inventoryQuantity,
            row.suppress_low_stock_alerts,
          ),
          lowStockAlertSuppressed: row.suppress_low_stock_alerts,
          syncState: getSyncState(row),
          profitabilityState: getProfitabilityState(row),
          updatedAt: normalizeDate(updatedAt),
        },
      };
    });
  });

export const buildCatalogCounts = (variantRows = [], filteredVariants = []) => {
  const allProducts = new Set(
    variantRows.map((variant) => String(variant?.id || "")).filter(Boolean),
  );
  const filteredProducts = new Set(
    filteredVariants
      .map((variant) => String(variant?.id || ""))
      .filter(Boolean),
  );

  return {
    totalProducts: allProducts.size,
    totalVariants: Array.isArray(variantRows) ? variantRows.length : 0,
    filteredProducts: filteredProducts.size,
    filteredVariants: Array.isArray(filteredVariants)
      ? filteredVariants.length
      : 0,
  };
};
