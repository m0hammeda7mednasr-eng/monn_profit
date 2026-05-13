import { extractWarehouseInventorySnapshot } from "./productLocalMetadata.js";

const DEFAULT_VARIANT_TITLES = new Set(["default", "default title"]);
const INTERNAL_CODE_PREFIX = "INT-";

export const normalizeWarehouseCode = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

const normalizeIdentifier = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .toUpperCase();

export const parseWarehouseJsonField = (value) => {
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

  return value;
};

export const toWarehouseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getProductVariantRows = (product) => {
  const parsedData = parseWarehouseJsonField(product?.data);
  return Array.isArray(parsedData?.variants) ? parsedData.variants : [];
};

export const getProductImageRows = (product) => {
  return [];
};

export const getProductPrimaryImageUrl = (product) => {
  return "";
};

export const resolveVariantImageUrl = (
  variant,
  imageRows = [],
  fallbackImageUrl = "",
) => {
  const variantId = String(variant?.id || "").trim();
  const variantImageId = String(variant?.image_id || "").trim();

  if (variantImageId) {
    const directImage = imageRows.find(
      (image) => String(image?.id || "").trim() === variantImageId,
    );
    if (directImage?.src) {
      return directImage.src;
    }
  }

  if (variantId) {
    const linkedImage = imageRows.find(
      (image) =>
        Array.isArray(image?.variant_ids) &&
        image.variant_ids.some((value) => String(value || "").trim() === variantId),
    );
    if (linkedImage?.src) {
      return linkedImage.src;
    }
  }

  return fallbackImageUrl;
};

export const getVariantDisplayTitle = (product, variant, index) => {
  const rawTitle = String(variant?.title || "").trim();
  if (!rawTitle) {
    return `Variant ${index + 1}`;
  }

  const normalizedTitle = rawTitle.toLowerCase();
  if (DEFAULT_VARIANT_TITLES.has(normalizedTitle)) {
    return "Default Variant";
  }

  const normalizedProductTitle = String(product?.title || "").trim().toLowerCase();
  if (normalizedProductTitle && normalizedTitle === normalizedProductTitle) {
    return "Default Variant";
  }

  return rawTitle;
};

export const buildFallbackVariant = (product) => {
  const parsedData = parseWarehouseJsonField(product?.data);
  const localWarehouseSnapshot = extractWarehouseInventorySnapshot(
    parsedData,
  );

  return {
    id: product?.shopify_id || product?.id || null,
    title: product?.title || "Default Variant",
    sku: product?.sku || "",
    barcode: "",
    price: product?.price ?? null,
    inventory_item_id: parsedData?.inventory_item_id || null,
    inventory_quantity: product?.inventory_quantity ?? 0,
    created_at: product?.created_at || null,
    updated_at: product?.updated_at || null,
    _moon_profit_warehouse_quantity: localWarehouseSnapshot.quantity,
    _moon_profit_warehouse_last_scanned_at: localWarehouseSnapshot.last_scanned_at,
    _moon_profit_warehouse_last_movement_type:
      localWarehouseSnapshot.last_movement_type,
    _moon_profit_warehouse_last_movement_quantity:
      localWarehouseSnapshot.last_movement_quantity,
    _moon_profit_warehouse_created_at: localWarehouseSnapshot.created_at,
    _moon_profit_warehouse_updated_at: localWarehouseSnapshot.updated_at,
  };
};

const buildInternalCode = (product, variant) => {
  const variantId = normalizeIdentifier(variant?.id);
  if (variantId) {
    return `${INTERNAL_CODE_PREFIX}${variantId}`;
  }

  const productId = normalizeIdentifier(product?.shopify_id || product?.id);
  if (productId) {
    return `${INTERNAL_CODE_PREFIX}${productId}`;
  }

  return "";
};

const getVariantCodeCandidates = (product, variant) => {
  const sku = normalizeWarehouseCode(variant?.sku || product?.sku);
  const barcode = normalizeWarehouseCode(variant?.barcode);
  const internalCode = buildInternalCode(product, variant);

  const candidates = [
    { code: sku, source: "sku" },
    { code: barcode, source: "barcode" },
    { code: internalCode, source: "internal" },
  ].filter((candidate) => candidate.code);

  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex((entry) => entry.code === candidate.code) === index,
  );
};

export const buildWarehouseVariantCatalogEntry = (
  product,
  variant,
  index,
  variantsCount,
) => {
  const codeCandidates = getVariantCodeCandidates(product, variant);
  if (codeCandidates.length === 0) {
    return null;
  }

  const primaryCode = codeCandidates[0];
  const rawSku = String(variant?.sku || product?.sku || "").trim();
  const rawBarcode = String(variant?.barcode || "").trim();
  const imageRows = getProductImageRows(product);
  const fallbackImageUrl = getProductPrimaryImageUrl(product);
  const variantTitle = getVariantDisplayTitle(product, variant, index);
  const isDefaultVariant = variantTitle === "Default Variant";
  const productTitle = product?.title || "Untitled product";
  const localWarehouseSnapshot = extractWarehouseInventorySnapshot(variant);

  return {
    key: `${product?.id || "product"}:${variant?.id || primaryCode.code}:${index}`,
    id: variant?.id || primaryCode.code,
    product_id: product?.id || null,
    variant_id: variant?.id || null,
    shopify_id: product?.shopify_id || null,
    store_id: product?.store_id || null,
    title: productTitle,
    product_title: productTitle,
    variant_title: variantTitle,
    display_title: isDefaultVariant ? productTitle : `${productTitle} / ${variantTitle}`,
    vendor: product?.vendor || "",
    product_type: product?.product_type || "",
    warehouse_code: primaryCode.code,
    warehouse_code_source: primaryCode.source,
    scan_codes: codeCandidates.map((candidate) => candidate.code),
    sku: rawSku || "",
    normalized_sku: normalizeWarehouseCode(rawSku),
    barcode: rawBarcode || "",
    normalized_barcode: normalizeWarehouseCode(rawBarcode),
    inventory_item_id: variant?.inventory_item_id || null,
    barcode_or_sku: rawSku || rawBarcode || primaryCode.code,
    barcode_or_sku_label:
      primaryCode.source === "sku"
        ? "SKU"
        : primaryCode.source === "barcode"
          ? "Barcode"
          : "Internal code",
    image_url: resolveVariantImageUrl(variant, imageRows, fallbackImageUrl),
    price: variant?.price ?? product?.price ?? null,
    shopify_inventory_quantity: toWarehouseNumber(
      variant?.inventory_quantity ?? product?.inventory_quantity,
    ),
    local_warehouse_quantity: toWarehouseNumber(localWarehouseSnapshot.quantity),
    local_last_scanned_at: localWarehouseSnapshot.last_scanned_at,
    local_last_movement_type: localWarehouseSnapshot.last_movement_type,
    local_last_movement_quantity: toWarehouseNumber(
      localWarehouseSnapshot.last_movement_quantity,
    ),
    local_created_at: localWarehouseSnapshot.created_at,
    local_updated_at: localWarehouseSnapshot.updated_at,
    has_multiple_variants: variantsCount > 1,
    variants_count: variantsCount,
    option_values: [variant?.option1, variant?.option2, variant?.option3]
      .map((value) => String(value || "").trim())
      .filter(Boolean),
    last_synced_at: product?.last_synced_at || null,
    created_at: variant?.created_at || product?.created_at || null,
    updated_at: variant?.updated_at || product?.updated_at || null,
    is_scannable: true,
  };
};

export const buildWarehouseVariantCatalog = (products = []) => {
  const rows = [];
  const rowsByPrimaryCode = new Map();
  const rowsByAnyCode = new Map();
  const duplicateScanCodes = new Set();

  for (const product of products) {
    const variants = getProductVariantRows(product);
    const normalizedVariants =
      variants.length > 0 ? variants : [buildFallbackVariant(product)];

    normalizedVariants.forEach((variant, index) => {
      const entry = buildWarehouseVariantCatalogEntry(
        product,
        variant,
        index,
        normalizedVariants.length,
      );

      if (!entry) {
        return;
      }

      rows.push(entry);
      rowsByPrimaryCode.set(entry.warehouse_code, entry);

      entry.scan_codes.forEach((scanCode) => {
        const existing = rowsByAnyCode.get(scanCode);
        if (existing && existing.key !== entry.key) {
          duplicateScanCodes.add(scanCode);
          return;
        }
        rowsByAnyCode.set(scanCode, entry);
      });
    });
  }

  return {
    rows,
    rowsByPrimaryCode,
    rowsByAnyCode,
    duplicateScanCodes,
  };
};
