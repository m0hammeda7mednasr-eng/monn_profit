const LOCAL_PRODUCT_METADATA_KEY = "_moon_profit_local_product";
const WAREHOUSE_LOCAL_FIELDS = {
  quantity: "_moon_profit_warehouse_quantity",
  lastScannedAt: "_moon_profit_warehouse_last_scanned_at",
  lastMovementType: "_moon_profit_warehouse_last_movement_type",
  lastMovementQuantity: "_moon_profit_warehouse_last_movement_quantity",
  createdAt: "_moon_profit_warehouse_created_at",
  updatedAt: "_moon_profit_warehouse_updated_at",
};

const hasOwn = (value, key) =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

const normalizeText = (value) => String(value ?? "").trim();
const normalizeBoolean = (value) =>
  value === true ||
  value === 1 ||
  String(value ?? "")
    .trim()
    .toLowerCase() === "true";

const toPlainObject = (value) => {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && !Array.isArray(value) ? value : {};
};

const clonePlainObject = (value) =>
  JSON.parse(JSON.stringify(toPlainObject(value) || {}));

const normalizeLocalFields = (value = {}) => ({
  supplier_phone: normalizeText(value?.supplier_phone),
  supplier_location: normalizeText(value?.supplier_location),
  suppress_low_stock_alerts: normalizeBoolean(
    value?.suppress_low_stock_alerts,
  ),
});

const parseNumeric = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeWarehouseMovementType = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "in" || normalized === "out" ? normalized : null;
};

const getProductVariants = (productData = {}) =>
  Array.isArray(productData?.variants) ? productData.variants : [];

const getVariantKey = (variant = {}, fallbackIndex = 0) =>
  normalizeText(variant?.id || variant?.admin_graphql_api_id || variant?.sku) ||
  `variant-${fallbackIndex}`;

const clearWarehouseInventorySnapshot = (value = {}) => {
  const nextValue = { ...toPlainObject(value) };

  Object.values(WAREHOUSE_LOCAL_FIELDS).forEach((fieldName) => {
    delete nextValue[fieldName];
  });

  return nextValue;
};

export const extractWarehouseInventorySnapshot = (value) => ({
  quantity: parseNumeric(value?.[WAREHOUSE_LOCAL_FIELDS.quantity]),
  last_scanned_at:
    normalizeText(value?.[WAREHOUSE_LOCAL_FIELDS.lastScannedAt]) || null,
  last_movement_type: normalizeWarehouseMovementType(
    value?.[WAREHOUSE_LOCAL_FIELDS.lastMovementType],
  ),
  last_movement_quantity: parseNumeric(
    value?.[WAREHOUSE_LOCAL_FIELDS.lastMovementQuantity],
  ),
  created_at: normalizeText(value?.[WAREHOUSE_LOCAL_FIELDS.createdAt]) || null,
  updated_at: normalizeText(value?.[WAREHOUSE_LOCAL_FIELDS.updatedAt]) || null,
});

const applyWarehouseInventorySnapshot = (value, snapshot = {}) => {
  const nextValue = clearWarehouseInventorySnapshot(value);
  const existingSnapshot = extractWarehouseInventorySnapshot(value);
  const normalizedSnapshot = {
    quantity: parseNumeric(snapshot.quantity),
    last_scanned_at: normalizeText(snapshot.last_scanned_at) || null,
    last_movement_type: normalizeWarehouseMovementType(
      snapshot.last_movement_type,
    ),
    last_movement_quantity: parseNumeric(snapshot.last_movement_quantity),
    created_at:
      normalizeText(snapshot.created_at) || existingSnapshot.created_at || null,
    updated_at:
      normalizeText(snapshot.updated_at) ||
      normalizeText(snapshot.last_scanned_at) ||
      null,
  };

  nextValue[WAREHOUSE_LOCAL_FIELDS.quantity] = normalizedSnapshot.quantity;

  if (normalizedSnapshot.last_scanned_at) {
    nextValue[WAREHOUSE_LOCAL_FIELDS.lastScannedAt] =
      normalizedSnapshot.last_scanned_at;
  }

  if (normalizedSnapshot.last_movement_type) {
    nextValue[WAREHOUSE_LOCAL_FIELDS.lastMovementType] =
      normalizedSnapshot.last_movement_type;
  }

  if (normalizedSnapshot.last_movement_quantity > 0) {
    nextValue[WAREHOUSE_LOCAL_FIELDS.lastMovementQuantity] =
      normalizedSnapshot.last_movement_quantity;
  }

  if (normalizedSnapshot.created_at) {
    nextValue[WAREHOUSE_LOCAL_FIELDS.createdAt] = normalizedSnapshot.created_at;
  }

  if (normalizedSnapshot.updated_at) {
    nextValue[WAREHOUSE_LOCAL_FIELDS.updatedAt] = normalizedSnapshot.updated_at;
  }

  return nextValue;
};

const findVariantIndex = (variants = [], selector = {}) => {
  const normalizedVariantId = normalizeText(selector?.variantId);
  if (normalizedVariantId) {
    const matchedIndex = variants.findIndex(
      (variant) => normalizeText(variant?.id) === normalizedVariantId,
    );
    if (matchedIndex >= 0) {
      return matchedIndex;
    }
  }

  const normalizedSku = normalizeText(selector?.sku);
  if (normalizedSku) {
    return variants.findIndex(
      (variant) => normalizeText(variant?.sku) === normalizedSku,
    );
  }

  return -1;
};

export const extractProductLocalMetadata = (productData) => {
  const data = toPlainObject(productData);
  const localMetadata = toPlainObject(data?.[LOCAL_PRODUCT_METADATA_KEY]);
  return normalizeLocalFields(localMetadata);
};

export const isProductLowStockAlertsSuppressed = (productOrData) =>
  Boolean(
    extractProductLocalMetadata(productOrData?.data ?? productOrData)
      ?.suppress_low_stock_alerts,
  );

export const mergeProductLocalMetadata = (productData, updates = {}) => {
  const nextData = clonePlainObject(productData);
  const currentMetadata = extractProductLocalMetadata(nextData);
  const nextMetadata = { ...currentMetadata };

  if (hasOwn(updates, "supplier_phone")) {
    nextMetadata.supplier_phone = normalizeText(updates.supplier_phone);
  }

  if (hasOwn(updates, "supplier_location")) {
    nextMetadata.supplier_location = normalizeText(updates.supplier_location);
  }

  if (hasOwn(updates, "suppress_low_stock_alerts")) {
    nextMetadata.suppress_low_stock_alerts = normalizeBoolean(
      updates.suppress_low_stock_alerts,
    );
  }

  if (
    nextMetadata.supplier_phone ||
    nextMetadata.supplier_location ||
    nextMetadata.suppress_low_stock_alerts
  ) {
    nextData[LOCAL_PRODUCT_METADATA_KEY] = nextMetadata;
  } else {
    delete nextData[LOCAL_PRODUCT_METADATA_KEY];
  }

  return nextData;
};

export const preserveProductLocalMetadata = (incomingData, existingData) =>
  mergeProductLocalMetadata(
    incomingData,
    extractProductLocalMetadata(existingData),
  );

export const getProductWarehouseInventorySnapshot = (
  productData,
  selector = {},
) => {
  const nextData = clonePlainObject(productData);
  const variants = getProductVariants(nextData);

  if (variants.length > 0) {
    const targetIndex = findVariantIndex(variants, selector);
    if (targetIndex < 0) {
      return extractWarehouseInventorySnapshot({});
    }

    return extractWarehouseInventorySnapshot(variants[targetIndex]);
  }

  return extractWarehouseInventorySnapshot(nextData);
};

export const applyProductWarehouseInventorySnapshot = (
  productData,
  selector = {},
  snapshot = {},
) => {
  const nextData = clonePlainObject(productData);
  const variants = getProductVariants(nextData);

  if (variants.length > 0) {
    const targetIndex = findVariantIndex(variants, selector);

    if (targetIndex < 0) {
      throw new Error("Warehouse variant metadata target was not found.");
    }

    nextData.variants = variants.map((variant, index) =>
      index === targetIndex
        ? applyWarehouseInventorySnapshot(variant, snapshot)
        : variant,
    );

    return clearWarehouseInventorySnapshot(nextData);
  }

  return applyWarehouseInventorySnapshot(nextData, snapshot);
};

export const preserveProductWarehouseData = (incomingData, existingData) => {
  const nextData = clonePlainObject(incomingData);
  const existing = clonePlainObject(existingData);
  const incomingVariants = getProductVariants(nextData);
  const existingVariants = getProductVariants(existing);

  if (incomingVariants.length > 0) {
    const existingVariantsByKey = new Map(
      existingVariants.map((variant, index) => [
        getVariantKey(variant, index),
        variant,
      ]),
    );

    nextData.variants = incomingVariants.map((variant, index) => {
      const key = getVariantKey(variant, index);
      const existingVariant = existingVariantsByKey.get(key);

      return existingVariant
        ? applyWarehouseInventorySnapshot(
            variant,
            extractWarehouseInventorySnapshot(existingVariant),
          )
        : applyWarehouseInventorySnapshot(variant, {});
    });

    delete nextData[WAREHOUSE_LOCAL_FIELDS.quantity];
    delete nextData[WAREHOUSE_LOCAL_FIELDS.lastScannedAt];
    delete nextData[WAREHOUSE_LOCAL_FIELDS.lastMovementType];
    delete nextData[WAREHOUSE_LOCAL_FIELDS.lastMovementQuantity];
    delete nextData[WAREHOUSE_LOCAL_FIELDS.createdAt];
    delete nextData[WAREHOUSE_LOCAL_FIELDS.updatedAt];
    return nextData;
  }

  return applyWarehouseInventorySnapshot(
    nextData,
    extractWarehouseInventorySnapshot(existing),
  );
};
