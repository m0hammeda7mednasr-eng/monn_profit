import axios from "axios";
import express from "express";
import { supabase as db } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { getAccessibleStoreIds } from "../models/index.js";
import {
  calculateScannedQuantity,
  buildMirroredInventoryRow,
} from "../helpers/warehouseScan.js";
import { emitRealtimeEvent } from "../services/realtimeEventService.js";
import {
  buildWarehouseVariantCatalog,
  normalizeWarehouseCode,
  parseWarehouseJsonField,
} from "../helpers/warehouseCatalog.js";
import {
  applyProductWarehouseInventorySnapshot,
  getProductWarehouseInventorySnapshot,
} from "../helpers/productLocalMetadata.js";
import { insertActivityLog } from "../services/activityLogService.js";

const router = express.Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATALOG_CACHE_TTL_MS = 15 * 1000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const SHOPIFY_API_VERSION = "2024-01";
const SHOPIFY_SYNC_CONCURRENCY = 5;
const MOVEMENT_TYPES = new Set(["in", "out"]);
const STOCK_SORT_FIELDS = new Set([
  "title",
  "sku",
  "updated_at",
  "inventory_quantity",
  "warehouse_quantity",
  "shopify_inventory_quantity",
  "stock_difference",
  "last_scanned_at",
  "price",
]);
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const QUERY_RETRYABLE_ERROR_CODES = new Set(["57014"]);
const PRODUCT_LOOKUP_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "title",
  "vendor",
  "product_type",
  "sku",
  "price",
  "inventory_quantity",
  "updated_at",
  "last_synced_at",
  "created_at",
  "data",
].join(",");
const productCatalogCache = new Map();

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const isSchemaCompatibilityError = (error) => {
  if (!error) {
    return false;
  }

  if (SCHEMA_ERROR_CODES.has(String(error.code || ""))) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    text.includes("does not exist") ||
    text.includes("could not find the") ||
    text.includes("relation") ||
    text.includes("column")
  );
};

const isQueryRetryableError = (error) => {
  if (!error) {
    return false;
  }

  if (QUERY_RETRYABLE_ERROR_CODES.has(String(error.code || ""))) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return text.includes("statement timeout") || text.includes("timeout");
};

const getRequestedStoreId = (req) => {
  const candidates = [req.headers["x-store-id"], req.body?.store_id, req.query?.store_id];

  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (UUID_REGEX.test(normalized)) {
      return normalized;
    }
  }

  return null;
};

const resolveIsAdmin = (req) =>
  Boolean(req.user?.isAdmin || String(req.user?.role || "").toLowerCase() === "admin");

const normalizeSku = (value) => normalizeWarehouseCode(value);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPositiveInteger = (value, fallback = 1) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getPagination = (query = {}) => {
  const requestedLimit = parseInt(query.limit, 10);
  const requestedOffset = parseInt(query.offset, 10);

  return {
    limit:
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT,
    offset:
      Number.isFinite(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0,
  };
};

const getSortOptions = (query = {}) => {
  const rawField = String(query.sort_by || "").trim().toLowerCase();
  const rawDirection = String(query.sort_dir || "asc").trim().toLowerCase();

  return {
    sortBy: STOCK_SORT_FIELDS.has(rawField) ? rawField : "title",
    ascending: rawDirection !== "desc",
  };
};

const buildPaginatedCollection = (rows, { limit, offset }) => {
  const items = Array.isArray(rows) ? rows : [];
  const count = items.length;

  return {
    data: items,
    pagination: {
      limit,
      offset,
      count,
      has_more: count === limit,
      next_offset: offset + count,
    },
  };
};

const buildWarehouseSetupResponse = ({ limit, offset, storeId, message }) => ({
  ...buildPaginatedCollection([], { limit, offset }),
  store_id: storeId || null,
  generated_at: new Date().toISOString(),
  schema_ready: false,
  setup_required: true,
  message,
});

const getFreshProductCatalog = (storeId) => {
  const cacheKey = String(storeId || "").trim();
  if (!cacheKey) {
    return null;
  }

  const entry = productCatalogCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > CATALOG_CACHE_TTL_MS) {
    productCatalogCache.delete(cacheKey);
    return null;
  }

  return entry.value;
};

const rememberProductCatalog = (storeId, value) => {
  const cacheKey = String(storeId || "").trim();
  if (!cacheKey) {
    return;
  }

  productCatalogCache.set(cacheKey, {
    updatedAt: Date.now(),
    value,
  });
};

const clearProductCatalog = (storeId) => {
  const cacheKey = String(storeId || "").trim();
  if (!cacheKey) {
    return;
  }

  productCatalogCache.delete(cacheKey);
};

const getAdminStoreIds = async () => {
  const strategies = [
    async () => {
      const { data, error } = await db.from("stores").select("id");
      if (error) {
        throw error;
      }
      return (data || []).map((row) => String(row?.id || "").trim()).filter(Boolean);
    },
    async () => {
      const { data, error } = await db
        .from("products")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(200);
      if (error) {
        throw error;
      }
      return Array.from(
        new Set(
          (data || []).map((row) => String(row?.store_id || "").trim()).filter(Boolean),
        ),
      );
    },
  ];

  for (const strategy of strategies) {
    try {
      const storeIds = await strategy();
      if (storeIds.length > 0) {
        return storeIds;
      }
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) {
        throw error;
      }
    }
  }

  return [];
};

const resolveStoreContext = async (req) => {
  const rawRequestedStoreId = getRequestedStoreId(req);
  const isAdmin = resolveIsAdmin(req);

  if (isAdmin) {
    if (rawRequestedStoreId) {
      return {
        isAdmin,
        storeId: rawRequestedStoreId,
        accessibleStoreIds: [],
      };
    }

    const adminStoreIds = await getAdminStoreIds();
    if (adminStoreIds.length === 1) {
      return {
        isAdmin,
        storeId: adminStoreIds[0],
        accessibleStoreIds: adminStoreIds,
      };
    }

    if (adminStoreIds.length === 0) {
      throw createHttpError(400, "No connected store is available yet");
    }

    throw createHttpError(400, "Select a store first before using warehouse tools");
  }

  const accessibleStoreIds = await getAccessibleStoreIds(req.user?.id);
  const requestedStoreId = accessibleStoreIds.includes(rawRequestedStoreId)
    ? rawRequestedStoreId
    : null;

  if (requestedStoreId) {
    return {
      isAdmin,
      storeId: requestedStoreId,
      accessibleStoreIds,
    };
  }

  if (rawRequestedStoreId && accessibleStoreIds.length > 0) {
    return {
      isAdmin,
      storeId: accessibleStoreIds[0],
      accessibleStoreIds,
    };
  }

  if (accessibleStoreIds.length === 1) {
    return {
      isAdmin,
      storeId: accessibleStoreIds[0],
      accessibleStoreIds,
    };
  }

  if (accessibleStoreIds.length === 0) {
    throw createHttpError(400, "No store is connected to this account yet");
  }

  throw createHttpError(400, "Select a store first before using warehouse tools");
};

const loadAllStoreProducts = async (storeId) => {
  const rows = [];
  const pageSize = 500;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from("products")
      .select(PRODUCT_LOOKUP_SELECT)
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return rows;
};

const getWarehouseProductCatalog = async (storeId) => {
  const cached = getFreshProductCatalog(storeId);
  if (cached) {
    return cached;
  }

  const products = await loadAllStoreProducts(storeId);
  const catalog = buildWarehouseVariantCatalog(products);
  rememberProductCatalog(storeId, catalog);
  return catalog;
};

const getInventoryRowsForStore = async (storeId) => {
  const { data, error } = await db
    .from("warehouse_inventory")
    .select(
      "id, store_id, product_id, sku, quantity, last_scanned_at, last_movement_type, last_movement_quantity, created_at, updated_at",
    )
    .eq("store_id", storeId);

  if (error) {
    throw error;
  }

  return data || [];
};

const cloneJsonValue = (value) =>
  JSON.parse(JSON.stringify(parseWarehouseJsonField(value) || {}));

const getProductVariants = (productData = {}) =>
  Array.isArray(productData?.variants) ? productData.variants : [];

const getTotalInventory = (variants = [], fallbackInventory = 0) => {
  if (!Array.isArray(variants) || variants.length === 0) {
    return toNumber(fallbackInventory);
  }

  return variants.reduce(
    (sum, variant) => sum + toNumber(variant?.inventory_quantity),
    0,
  );
};

const getShopifyTokenForStore = async (storeId, fallbackUserId) => {
  if (storeId) {
    const { data: tokenByStore, error: tokenByStoreError } = await db
      .from("shopify_tokens")
      .select("*")
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenByStoreError) {
      throw tokenByStoreError;
    }

    if (tokenByStore) {
      return tokenByStore;
    }
  }

  const fallbackUserIdValue = String(fallbackUserId || "").trim();
  if (!fallbackUserIdValue) {
    return null;
  }

  const { data: tokenByUser, error: tokenByUserError } = await db
    .from("shopify_tokens")
    .select("*")
    .eq("user_id", fallbackUserIdValue)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (tokenByUserError) {
    throw tokenByUserError;
  }

  return tokenByUser || null;
};

const buildShopifyHeaders = (accessToken) => ({
  "X-Shopify-Access-Token": accessToken,
  "Content-Type": "application/json",
});

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
    throw createHttpError(
      503,
      "No active Shopify location was found for inventory updates",
    );
  }

  return activeLocation.id;
};

const mapInventoryRowsByCode = (rows = []) =>
  new Map(
    (rows || [])
      .filter((row) => normalizeSku(row?.sku))
      .map((row) => [normalizeSku(row?.sku), row]),
  );

const serializeWarehouseVariantRow = (variantRow, inventoryRow) => {
  const warehouseQuantity = toNumber(inventoryRow?.quantity);
  const shopifyQuantity = toNumber(variantRow?.shopify_inventory_quantity);
  const difference = warehouseQuantity - shopifyQuantity;

  return {
    id: variantRow?.key || variantRow?.id || inventoryRow?.id || null,
    product_id: variantRow?.product_id || inventoryRow?.product_id || null,
    variant_id: variantRow?.variant_id || null,
    shopify_id: variantRow?.shopify_id || null,
    inventory_item_id: variantRow?.inventory_item_id || null,
    store_id: variantRow?.store_id || inventoryRow?.store_id || null,
    title: variantRow?.title || "Archived product",
    product_title: variantRow?.product_title || variantRow?.title || "Archived product",
    variant_title: variantRow?.variant_title || "Archived Variant",
    display_title:
      variantRow?.display_title ||
      variantRow?.title ||
      `Archived code ${inventoryRow?.sku || ""}`.trim(),
    vendor: variantRow?.vendor || "",
    product_type: variantRow?.product_type || "",
    warehouse_code:
      variantRow?.warehouse_code || normalizeSku(variantRow?.sku || inventoryRow?.sku),
    warehouse_code_source: variantRow?.warehouse_code_source || "legacy",
    sku: variantRow?.sku || inventoryRow?.sku || "",
    normalized_sku:
      variantRow?.normalized_sku || normalizeSku(variantRow?.sku || inventoryRow?.sku),
    barcode: variantRow?.barcode || "",
    normalized_barcode:
      variantRow?.normalized_barcode || normalizeSku(variantRow?.barcode),
    barcode_or_sku:
      variantRow?.barcode_or_sku ||
      variantRow?.sku ||
      variantRow?.barcode ||
      inventoryRow?.sku ||
      "",
    barcode_or_sku_label: variantRow?.barcode_or_sku_label || "Code",
    image_url: variantRow?.image_url || "",
    option_values: Array.isArray(variantRow?.option_values)
      ? variantRow.option_values
      : [],
    price: variantRow?.price ?? null,
    shopify_inventory_quantity: shopifyQuantity,
    warehouse_quantity: warehouseQuantity,
    stock_difference: difference,
    stock_state:
      difference === 0
        ? "matched"
        : difference > 0
          ? "warehouse_higher"
          : "shopify_higher",
    has_multiple_variants: Boolean(variantRow?.has_multiple_variants),
    variants_count: toNumber(variantRow?.variants_count),
    is_archived: Boolean(variantRow?.is_archived),
    is_scannable:
      variantRow?.is_scannable !== undefined
        ? Boolean(variantRow.is_scannable)
        : Boolean(variantRow?.warehouse_code || inventoryRow?.sku),
    last_scanned_at: inventoryRow?.last_scanned_at || null,
    last_movement_type: inventoryRow?.last_movement_type || null,
    last_movement_quantity: toNumber(inventoryRow?.last_movement_quantity),
    last_synced_at: variantRow?.last_synced_at || null,
    created_at: variantRow?.created_at || inventoryRow?.created_at || null,
    updated_at:
      inventoryRow?.updated_at || variantRow?.updated_at || variantRow?.created_at || null,
  };
};

const buildOrphanWarehouseRow = (inventoryRow) =>
  serializeWarehouseVariantRow(
    {
      key: inventoryRow?.id || normalizeSku(inventoryRow?.sku),
      id: normalizeSku(inventoryRow?.sku),
      product_id: inventoryRow?.product_id || null,
      store_id: inventoryRow?.store_id || null,
      title: "Archived product",
      product_title: "Archived product",
      variant_title: "Unknown Variant",
      display_title: `Archived code ${inventoryRow?.sku || ""}`.trim(),
      is_archived: true,
      warehouse_code: normalizeSku(inventoryRow?.sku),
      warehouse_code_source: "legacy",
      sku: inventoryRow?.sku || "",
      normalized_sku: normalizeSku(inventoryRow?.sku),
      barcode_or_sku: inventoryRow?.sku || "",
      barcode_or_sku_label: "Legacy code",
      shopify_inventory_quantity: 0,
      price: null,
      is_scannable: Boolean(inventoryRow?.sku),
      has_multiple_variants: false,
      variants_count: 0,
      option_values: [],
      last_synced_at: null,
      created_at: inventoryRow?.created_at || null,
      updated_at: inventoryRow?.updated_at || null,
    },
    inventoryRow,
  );

const loadWarehouseInventoryState = async (storeId) => {
  const catalog = await getWarehouseProductCatalog(storeId);
  let inventoryRows = [];
  let warehouseTablesReady = true;

  try {
    inventoryRows = await getInventoryRowsForStore(storeId);
  } catch (inventoryError) {
    if (
      !isSchemaCompatibilityError(inventoryError) &&
      !isQueryRetryableError(inventoryError)
    ) {
      throw inventoryError;
    }

    warehouseTablesReady = false;
  }

  const inventoryByCode = mapInventoryRowsByCode(inventoryRows);
  const catalogRows = catalog.rows.map((variantRow) =>
    serializeWarehouseVariantRow(
      variantRow,
      warehouseTablesReady
        ? inventoryByCode.get(variantRow.warehouse_code)
        : buildMirroredInventoryRow({
            product: variantRow,
            quantity: variantRow.local_warehouse_quantity,
            scannedAt: variantRow.local_last_scanned_at,
            movementType: variantRow.local_last_movement_type,
            movementQuantity: variantRow.local_last_movement_quantity,
            createdAt: variantRow.local_created_at,
            updatedAt: variantRow.local_updated_at,
          }),
    ),
  );
  const orphanRows = warehouseTablesReady
    ? inventoryRows
        .filter(
          (inventoryRow) =>
            !catalog.rowsByPrimaryCode.has(normalizeSku(inventoryRow?.sku)),
        )
        .map((inventoryRow) => buildOrphanWarehouseRow(inventoryRow))
    : [];

  return {
    catalog,
    warehouseTablesReady,
    trackingMode: warehouseTablesReady
      ? "warehouse_tables"
      : "local_product_data",
    rows: [...catalogRows, ...orphanRows],
  };
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  if (normalizedItems.length === 0) {
    return [];
  }

  const results = new Array(normalizedItems.length);
  const workerCount = Math.max(
    1,
    Math.min(concurrency, normalizedItems.length),
  );
  let currentIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = currentIndex;
        currentIndex += 1;

        if (index >= normalizedItems.length) {
          return;
        }

        results[index] = await worker(normalizedItems[index], index);
      }
    }),
  );

  return results;
};

const updateLocalProductsAfterShopifySync = async ({
  products,
  syncedRows,
  nowIso,
}) => {
  const syncedRowsByProductId = new Map();

  (syncedRows || []).forEach((row) => {
    const productId = String(row?.product_id || "").trim();
    if (!productId) {
      return;
    }

    const existingRows = syncedRowsByProductId.get(productId) || [];
    existingRows.push(row);
    syncedRowsByProductId.set(productId, existingRows);
  });

  let updatedProductsCount = 0;

  for (const product of products || []) {
    const productId = String(product?.id || "").trim();
    const productRows = syncedRowsByProductId.get(productId);
    if (!productRows || productRows.length === 0) {
      continue;
    }

    const parsedData = parseWarehouseJsonField(product?.data);
    const nextData = cloneJsonValue(parsedData);
    const variants = getProductVariants(parsedData);
    let dataChanged = false;
    let inventoryQuantityChanged = false;
    let nextInventoryQuantity = toNumber(product?.inventory_quantity);

    if (variants.length > 0) {
      const nextVariants = variants.map((variant) => {
        const variantId = String(variant?.id || "").trim();
        const inventoryItemId = String(variant?.inventory_item_id || "").trim();
        const normalizedVariantSku = normalizeSku(variant?.sku);
        const matchedRow = productRows.find(
          (row) =>
            (variantId && String(row?.variant_id || "").trim() === variantId) ||
            (inventoryItemId &&
              String(row?.inventory_item_id || "").trim() === inventoryItemId) ||
            (normalizedVariantSku &&
              normalizeSku(row?.sku) === normalizedVariantSku),
        );

        if (!matchedRow) {
          return variant;
        }

        const nextAvailable = toNumber(matchedRow.available);
        if (toNumber(variant?.inventory_quantity) !== nextAvailable) {
          dataChanged = true;
        }

        return {
          ...variant,
          inventory_quantity: nextAvailable,
          updated_at: nowIso,
        };
      });

      nextData.variants = nextVariants;
      nextInventoryQuantity = getTotalInventory(
        nextVariants,
        product?.inventory_quantity,
      );
    } else {
      const matchedRow = productRows[0] || null;
      if (matchedRow) {
        nextInventoryQuantity = toNumber(matchedRow.available);
        if (toNumber(parsedData?.inventory_quantity) !== nextInventoryQuantity) {
          dataChanged = true;
        }

        nextData.inventory_quantity = nextInventoryQuantity;
        nextData.updated_at = nowIso;
      }
    }

    inventoryQuantityChanged =
      nextInventoryQuantity !== toNumber(product?.inventory_quantity);

    if (!dataChanged && !inventoryQuantityChanged) {
      continue;
    }

    const { error: updateError } = await db
      .from("products")
      .update({
        data: nextData,
        inventory_quantity: nextInventoryQuantity,
        pending_sync: false,
        sync_error: null,
        last_synced_at: nowIso,
        shopify_updated_at: nowIso,
        local_updated_at: nowIso,
      })
      .eq("id", product.id);

    if (updateError) {
      throw updateError;
    }

    updatedProductsCount += 1;
  }

  return updatedProductsCount;
};

const sortWarehouseRows = (rows, { sortBy, ascending }) => {
  const direction = ascending ? 1 : -1;
  const sortedRows = [...(rows || [])];

  sortedRows.sort((left, right) => {
    let leftValue;
    let rightValue;

    switch (sortBy) {
      case "sku":
        leftValue = left?.warehouse_code || left?.normalized_sku || "";
        rightValue = right?.warehouse_code || right?.normalized_sku || "";
        break;
      case "price":
        leftValue = toNumber(left?.price);
        rightValue = toNumber(right?.price);
        break;
      case "inventory_quantity":
      case "shopify_inventory_quantity":
        leftValue = toNumber(left?.shopify_inventory_quantity);
        rightValue = toNumber(right?.shopify_inventory_quantity);
        break;
      case "warehouse_quantity":
        leftValue = toNumber(left?.warehouse_quantity);
        rightValue = toNumber(right?.warehouse_quantity);
        break;
      case "stock_difference":
        leftValue = toNumber(left?.stock_difference);
        rightValue = toNumber(right?.stock_difference);
        break;
      case "last_scanned_at":
        leftValue = new Date(left?.last_scanned_at || 0).getTime() || 0;
        rightValue = new Date(right?.last_scanned_at || 0).getTime() || 0;
        break;
      case "updated_at":
        leftValue = new Date(left?.updated_at || 0).getTime() || 0;
        rightValue = new Date(right?.updated_at || 0).getTime() || 0;
        break;
      case "title":
      default:
        leftValue = String(left?.display_title || left?.title || "").toLowerCase();
        rightValue = String(right?.display_title || right?.title || "").toLowerCase();
        break;
    }

    if (leftValue < rightValue) {
      return -1 * direction;
    }
    if (leftValue > rightValue) {
      return 1 * direction;
    }

    return String(left?.warehouse_code || left?.normalized_sku || "").localeCompare(
      String(right?.warehouse_code || right?.normalized_sku || ""),
    );
  });

  return sortedRows;
};

const findCatalogVariantByScanCode = async ({ storeId, scanCode }) => {
  const normalizedCode = normalizeSku(scanCode);
  if (!normalizedCode) {
    return null;
  }

  const catalog = await getWarehouseProductCatalog(storeId);

  if (catalog.duplicateScanCodes.has(normalizedCode)) {
    throw createHttpError(
      409,
      `More than one variant matches code ${normalizedCode}. SKU or barcode must be unique per store.`,
    );
  }

  return catalog.rowsByAnyCode.get(normalizedCode) || null;
};

const getFallbackScanEvent = ({
  storeId,
  userId,
  product,
  movementType,
  quantity,
  scanCode,
  note,
  nowIso,
}) => ({
  id: null,
  store_id: storeId,
  sku: product.warehouse_code,
  product_id: product.product_id,
  user_id: userId || null,
  movement_type: movementType,
  quantity,
  scan_code: scanCode,
  note: note || null,
  created_at: nowIso,
});

const buildInsufficientWarehouseStockError = ({
  product,
  quantity,
  currentWarehouseQuantity,
}) =>
  createHttpError(
    400,
    `Cannot scan out ${quantity}. Available warehouse stock for ${product.warehouse_code} is ${currentWarehouseQuantity}.`,
  );

const getNextWarehouseQuantity = ({
  product,
  currentWarehouseQuantity,
  movementType,
  quantity,
}) => {
  const nextWarehouseQuantity = calculateScannedQuantity({
    currentQuantity: currentWarehouseQuantity,
    movementType,
    quantity,
  });

  if (movementType === "out" && nextWarehouseQuantity < 0) {
    throw buildInsufficientWarehouseStockError({
      product,
      quantity,
      currentWarehouseQuantity,
    });
  }

  return Math.max(0, nextWarehouseQuantity);
};

const persistLocalWarehouseTracking = async ({
  storeId,
  userId,
  product,
  movementType,
  quantity,
  scanCode,
  note,
  nowIso,
}) => {
  if (!product?.product_id) {
    throw createHttpError(400, "Matched product is missing a local product id");
  }

  const fallbackScanEvent = getFallbackScanEvent({
    storeId,
    userId,
    product,
    movementType,
    quantity,
    scanCode,
    note,
    nowIso,
  });
  const { data: productRow, error: productLookupError } = await db
    .from("products")
    .select("id, data")
    .eq("id", product.product_id)
    .maybeSingle();

  if (productLookupError) {
    throw productLookupError;
  }

  if (!productRow?.id) {
    throw createHttpError(404, "Matched product no longer exists locally");
  }

  const currentSnapshot = getProductWarehouseInventorySnapshot(productRow.data, {
    variantId: product.variant_id,
    sku: product.sku,
  });
  const currentWarehouseQuantity = toNumber(currentSnapshot.quantity);
  const nextWarehouseQuantity = getNextWarehouseQuantity({
    product,
    currentWarehouseQuantity,
    movementType,
    quantity,
  });
  const nextData = applyProductWarehouseInventorySnapshot(
    productRow.data,
    {
      variantId: product.variant_id,
      sku: product.sku,
    },
    {
      quantity: nextWarehouseQuantity,
      last_scanned_at: nowIso,
      last_movement_type: movementType,
      last_movement_quantity: quantity,
      created_at: currentSnapshot.created_at || nowIso,
      updated_at: nowIso,
    },
  );
  const { error: updateError } = await db
    .from("products")
    .update({
      data: nextData,
      local_updated_at: nowIso,
    })
    .eq("id", product.product_id);

  if (updateError) {
    throw updateError;
  }

  clearProductCatalog(storeId);

  const refreshedProduct =
    (await findCatalogVariantByScanCode({
      storeId,
      scanCode: product.warehouse_code,
    })) || {
      ...product,
      local_warehouse_quantity: nextWarehouseQuantity,
      local_last_scanned_at: nowIso,
      local_last_movement_type: movementType,
      local_last_movement_quantity: quantity,
      local_created_at: currentSnapshot.created_at || nowIso,
      local_updated_at: nowIso,
    };

  return {
    savedInventory: buildMirroredInventoryRow({
      product: refreshedProduct,
      quantity: nextWarehouseQuantity,
      scannedAt: nowIso,
      movementType,
      movementQuantity: quantity,
      createdAt: currentSnapshot.created_at || nowIso,
      updatedAt: nowIso,
    }),
    scanEvent: fallbackScanEvent,
    trackingMode: "local_product_data",
    warehouseTrackingSaved: false,
    nextWarehouseQuantity,
    refreshedProduct,
  };
};

const persistWarehouseTracking = async ({
  storeId,
  userId,
  product,
  movementType,
  quantity,
  scanCode,
  note,
  nowIso,
}) => {
  try {
    const { data: existingInventory, error: inventoryLookupError } = await db
      .from("warehouse_inventory")
      .select(
        "id, store_id, product_id, sku, quantity, last_scanned_at, last_movement_type, last_movement_quantity",
      )
      .eq("store_id", storeId)
      .eq("sku", product.warehouse_code)
      .maybeSingle();

    if (inventoryLookupError && inventoryLookupError.code !== "PGRST116") {
      throw inventoryLookupError;
    }

    const currentWarehouseQuantity = toNumber(existingInventory?.quantity);
    const nextWarehouseQuantity = getNextWarehouseQuantity({
      product,
      currentWarehouseQuantity,
      movementType,
      quantity,
    });

    const inventoryPayload = {
      store_id: storeId,
      product_id: product.product_id,
      sku: product.warehouse_code,
      quantity: nextWarehouseQuantity,
      last_scanned_at: nowIso,
      last_movement_type: movementType,
      last_movement_quantity: quantity,
      updated_at: nowIso,
    };

    let savedInventory;
    if (existingInventory?.id) {
      const { data, error } = await db
        .from("warehouse_inventory")
        .update(inventoryPayload)
        .eq("id", existingInventory.id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      savedInventory = data;
    } else {
      const { data, error } = await db
        .from("warehouse_inventory")
        .insert({
          ...inventoryPayload,
          created_at: nowIso,
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      savedInventory = data;
    }

    const { data: scanEvent, error: scanEventError } = await db
      .from("warehouse_scan_events")
      .insert({
        store_id: storeId,
        sku: product.warehouse_code,
        product_id: product.product_id,
        user_id: userId || null,
        movement_type: movementType,
        quantity,
        scan_code: scanCode,
        note: note || null,
        created_at: nowIso,
      })
      .select(
        "id, store_id, sku, product_id, user_id, movement_type, quantity, scan_code, note, created_at",
      )
      .single();

    if (scanEventError) {
      throw scanEventError;
    }

    return {
      savedInventory,
      scanEvent,
      trackingMode: "warehouse_tables",
      warehouseTrackingSaved: true,
      nextWarehouseQuantity,
      refreshedProduct: product,
    };
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }

    return persistLocalWarehouseTracking({
      storeId,
      userId,
      product,
      movementType,
      quantity,
      scanCode,
      note,
      nowIso,
    });
  }
};

const serializeScanProduct = (product) => ({
  id: product?.product_id || product?.id || null,
  product_id: product?.product_id || product?.id || null,
  variant_id: product?.variant_id || null,
  title: product?.title || "",
  product_title: product?.product_title || product?.title || "",
  variant_title: product?.variant_title || "",
  display_title: product?.display_title || product?.title || "",
  warehouse_code: product?.warehouse_code || product?.sku || "",
  warehouse_code_source: product?.warehouse_code_source || "legacy",
  sku: product?.sku || "",
  vendor: product?.vendor || "",
  price: product?.price ?? null,
  barcode: product?.barcode || "",
  image_url: product?.image_url || "",
  option_values: Array.isArray(product?.option_values) ? product.option_values : [],
});

const enrichScanEvent = (scan, catalog) => {
  const normalizedCode = normalizeSku(scan?.sku || scan?.scan_code);
  const variantRow = normalizedCode ? catalog.rowsByAnyCode.get(normalizedCode) : null;
  const fallbackProduct = scan?.product || {};

  return {
    ...scan,
    product: {
      id: variantRow?.product_id || fallbackProduct?.id || scan?.product_id || null,
      product_id: variantRow?.product_id || fallbackProduct?.id || scan?.product_id || null,
      variant_id: variantRow?.variant_id || null,
      title: variantRow?.title || fallbackProduct?.title || "Archived product",
      product_title:
        variantRow?.product_title || fallbackProduct?.title || "Archived product",
      variant_title: variantRow?.variant_title || "Unknown Variant",
      display_title:
        variantRow?.display_title || fallbackProduct?.title || scan?.sku || scan?.scan_code || "-",
      warehouse_code: variantRow?.warehouse_code || normalizedCode || "",
      warehouse_code_source: variantRow?.warehouse_code_source || "legacy",
      sku: variantRow?.sku || fallbackProduct?.sku || scan?.sku || "-",
      normalized_sku: variantRow?.normalized_sku || normalizeSku(variantRow?.sku),
      vendor: variantRow?.vendor || fallbackProduct?.vendor || "",
      image_url: variantRow?.image_url || "",
      barcode: variantRow?.barcode || "",
      option_values: Array.isArray(variantRow?.option_values)
        ? variantRow.option_values
        : [],
    },
  };
};

const writeActivityLog = async ({
  userId,
  product,
  movementType,
  quantity,
  storeId,
  scanCode,
  note,
  nextWarehouseQuantity,
  shopifyInventoryQuantity,
  trackingMode,
}) => {
  try {
    const { error } = await insertActivityLog({
      user_id: userId,
      action: movementType === "in" ? "warehouse_scan_in" : "warehouse_scan_out",
      entity_type: "warehouse_variant",
      entity_id: product?.variant_id || product?.product_id || product?.id || null,
      entity_name:
        product?.display_title || product?.title || product?.sku || scanCode,
      details: {
        sku: product?.warehouse_code || product?.sku || scanCode,
        normalized_sku: normalizeSku(product?.warehouse_code || scanCode),
        product_id: product?.product_id || product?.id || null,
        variant_id: product?.variant_id || null,
        movement_type: movementType,
        quantity,
        store_id: storeId,
        warehouse_quantity_after: nextWarehouseQuantity,
        shopify_inventory_reference: shopifyInventoryQuantity,
        tracking_mode: trackingMode,
        note: note || null,
      },
    });

    if (error && !isSchemaCompatibilityError(error)) {
      console.warn("Failed to write warehouse activity log:", error.message);
    }
  } catch (error) {
    console.warn("Warehouse activity log exception:", error.message);
  }
};

router.use(authenticateToken);

router.get("/stock", requirePermission("can_view_warehouse"), async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const pagination = getPagination(req.query);
    const sortOptions = getSortOptions(req.query);
    const inventoryState = await loadWarehouseInventoryState(storeId);
    const sortedRows = sortWarehouseRows(inventoryState.rows, sortOptions);
    const rows = sortedRows.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    res.json({
      ...buildPaginatedCollection(rows, pagination),
      store_id: storeId,
      generated_at: new Date().toISOString(),
      schema_ready: inventoryState.warehouseTablesReady,
      setup_required: !inventoryState.warehouseTablesReady,
      tracking_mode: inventoryState.trackingMode,
      message: inventoryState.warehouseTablesReady
        ? null
        : "Warehouse tables are not deployed yet. Showing local warehouse stock saved on the product record.",
    });
  } catch (error) {
    console.error("Error fetching warehouse stock:", error);

    if (isSchemaCompatibilityError(error) || isQueryRetryableError(error)) {
      return res.json(
        buildWarehouseSetupResponse({
          limit: getPagination(req.query).limit,
          offset: getPagination(req.query).offset,
          storeId: getRequestedStoreId(req),
          message: "Warehouse tables are not deployed yet",
        }),
      );
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to fetch warehouse stock",
    });
  }
});

router.post(
  "/sync-to-shopify",
  requirePermission("can_edit_warehouse"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const inventoryState = await loadWarehouseInventoryState(storeId);
      const tokenData = await getShopifyTokenForStore(storeId, req.user?.id);

      if (!tokenData?.access_token || !tokenData?.shop) {
        throw createHttpError(
          400,
          "Shopify is not connected for the selected store",
        );
      }

      const locationId = await fetchPrimaryShopifyLocationId(tokenData);
      const warehouseRows = inventoryState.rows.filter(
        (row) => !Boolean(row?.is_archived),
      );

      const unchangedRows = [];
      const skippedRows = [];
      const syncCandidates = [];

      warehouseRows.forEach((row) => {
        const normalizedWarehouseQuantity = toNumber(row?.warehouse_quantity);
        const normalizedShopifyQuantity = toNumber(
          row?.shopify_inventory_quantity,
        );

        if (!row?.product_id) {
          skippedRows.push({
            warehouse_code: row?.warehouse_code || "",
            reason: "missing_local_product",
          });
          return;
        }

        if (!row?.inventory_item_id) {
          skippedRows.push({
            warehouse_code: row?.warehouse_code || "",
            product_id: row?.product_id || null,
            variant_id: row?.variant_id || null,
            reason: "missing_inventory_item_id",
          });
          return;
        }

        if (normalizedWarehouseQuantity === normalizedShopifyQuantity) {
          unchangedRows.push({
            warehouse_code: row?.warehouse_code || "",
            product_id: row?.product_id || null,
            variant_id: row?.variant_id || null,
            available: normalizedWarehouseQuantity,
          });
          return;
        }

        syncCandidates.push({
          product_id: row?.product_id || null,
          variant_id: row?.variant_id || null,
          inventory_item_id: String(row.inventory_item_id),
          warehouse_code: row?.warehouse_code || "",
          sku: row?.sku || "",
          available: normalizedWarehouseQuantity,
          previous_shopify_quantity: normalizedShopifyQuantity,
        });
      });

      const syncResults = await mapWithConcurrency(
        syncCandidates,
        SHOPIFY_SYNC_CONCURRENCY,
        async (candidate) => {
          try {
            await axios.post(
              `https://${tokenData.shop}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`,
              {
                location_id: locationId,
                inventory_item_id: candidate.inventory_item_id,
                available: candidate.available,
              },
              {
                headers: buildShopifyHeaders(tokenData.access_token),
              },
            );

            return {
              ...candidate,
              success: true,
            };
          } catch (error) {
            return {
              ...candidate,
              success: false,
              error:
                error?.response?.data?.errors ||
                error?.response?.data?.error ||
                error?.message ||
                "Shopify inventory sync failed",
            };
          }
        },
      );

      const successfulSyncs = syncResults.filter((row) => row?.success);
      const failedSyncs = syncResults.filter((row) => !row?.success);
      const nowIso = new Date().toISOString();
      let localProductsUpdated = 0;
      let localUpdateError = "";

      if (successfulSyncs.length > 0) {
        try {
          const storeProducts = await loadAllStoreProducts(storeId);
          localProductsUpdated = await updateLocalProductsAfterShopifySync({
            products: storeProducts,
            syncedRows: successfulSyncs,
            nowIso,
          });
        } catch (error) {
          localUpdateError =
            error?.message || "Local product state could not be refreshed";
          console.error(
            "Failed to refresh local product inventory after warehouse sync:",
            error,
          );
        } finally {
          clearProductCatalog(storeId);
        }
      }

      emitRealtimeEvent({
        type: "warehouse.updated",
        source: "/api/warehouse/sync-to-shopify",
        userIds: [String(req.user?.id || "").trim()].filter(Boolean),
        storeIds: [storeId],
        payload: {
          resource: "warehouse",
          context: "shopify_inventory_sync",
          synced_count: successfulSyncs.length,
          failed_count: failedSyncs.length,
        },
      });

      res.json({
        message:
          successfulSyncs.length > 0
            ? `Synced ${successfulSyncs.length} warehouse rows to Shopify inventory.`
            : "No Shopify inventory changes were needed.",
        store_id: storeId,
        generated_at: nowIso,
        tracking_mode: inventoryState.trackingMode,
        shopify_location_id: locationId,
        total_rows: warehouseRows.length,
        sync_attempted_count: syncCandidates.length,
        synced_count: successfulSyncs.length,
        unchanged_count: unchangedRows.length,
        skipped_count: skippedRows.length,
        failed_count: failedSyncs.length,
        local_products_updated: localProductsUpdated,
        local_state_updated: !localUpdateError,
        local_update_error: localUpdateError || null,
        skipped_rows: skippedRows.slice(0, 25),
        failed_rows: failedSyncs.slice(0, 25),
      });
    } catch (error) {
      console.error("Error syncing warehouse stock to Shopify:", error);

      res.status(error.status || 500).json({
        error:
          error.status
            ? error.message
            : "Failed to sync warehouse stock to Shopify",
      });
    }
  },
);

router.get("/scans", requirePermission("can_view_warehouse"), async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const pagination = getPagination(req.query);
    const catalog = await getWarehouseProductCatalog(storeId);

    const { data, error } = await db
      .from("warehouse_scan_events")
      .select(
        "id, store_id, sku, product_id, user_id, movement_type, quantity, scan_code, note, created_at, product:products(id, title, sku, vendor), user:users(id, name, email)",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .range(pagination.offset, pagination.offset + pagination.limit - 1);

    if (error) {
      throw error;
    }

    const rows = (data || []).map((scan) => enrichScanEvent(scan, catalog));

    res.json({
      ...buildPaginatedCollection(rows, pagination),
      store_id: storeId,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    if (isSchemaCompatibilityError(error)) {
      const pagination = getPagination(req.query);
      const requestedStoreId = getRequestedStoreId(req);

      return res.json({
        ...buildPaginatedCollection([], pagination),
        store_id: requestedStoreId,
        generated_at: new Date().toISOString(),
        schema_ready: false,
        setup_required: true,
        tracking_mode: "local_product_data",
        message:
          "Warehouse scan history is not available yet. Scanner actions still update local warehouse stock.",
      });
    }

    console.error("Error fetching warehouse scans:", error);

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to fetch warehouse scan history",
    });
  }
});

router.post("/scan", requirePermission("can_edit_warehouse"), async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const movementType = String(req.body?.movement_type || "").trim().toLowerCase();
    const quantity = toPositiveInteger(req.body?.quantity, 1);
    const scanCode = String(req.body?.code || req.body?.sku || "").trim();
    const normalizedScanCode = normalizeSku(scanCode);
    const note = String(req.body?.note || "").trim();

    if (!normalizedScanCode) {
      throw createHttpError(400, "Scan code is required");
    }

    if (!MOVEMENT_TYPES.has(movementType)) {
      throw createHttpError(400, "movement_type must be either in or out");
    }

    const product = await findCatalogVariantByScanCode({
      storeId,
      scanCode: normalizedScanCode,
    });

    if (!product) {
      throw createHttpError(
        404,
        `No product was found for code ${normalizedScanCode} in the selected store`,
      );
    }

    const nowIso = new Date().toISOString();
    const trackingResult = await persistWarehouseTracking({
      storeId,
      userId: req.user?.id,
      product,
      movementType,
      quantity,
      scanCode,
      note,
      nowIso,
    });
    const refreshedProduct = trackingResult.refreshedProduct || product;
    const inventorySnapshot = serializeWarehouseVariantRow(
      refreshedProduct,
      trackingResult.savedInventory ||
        buildMirroredInventoryRow({
          product: refreshedProduct,
          quantity: trackingResult.nextWarehouseQuantity,
          scannedAt: nowIso,
          movementType,
          movementQuantity: quantity,
          createdAt:
            trackingResult.savedInventory?.created_at ||
            refreshedProduct?.local_created_at ||
            nowIso,
          updatedAt: nowIso,
        }),
    );

    await writeActivityLog({
      userId: req.user?.id,
      product: refreshedProduct,
      movementType,
      quantity,
      storeId,
      scanCode,
      note,
      nextWarehouseQuantity: trackingResult.nextWarehouseQuantity,
      shopifyInventoryQuantity: toNumber(refreshedProduct?.shopify_inventory_quantity),
      trackingMode: trackingResult.trackingMode,
    });

    emitRealtimeEvent({
      type: "warehouse.updated",
      source: "/api/warehouse/scan",
      userIds: [String(req.user?.id || "").trim()].filter(Boolean),
      storeIds: [storeId],
      payload: {
        resource: "warehouse",
        context: "scanner",
        sku: refreshedProduct.warehouse_code,
        movement_type: movementType,
        quantity,
      },
    });

    res.status(201).json({
      message:
        movementType === "in"
          ? `Stock increased for code ${refreshedProduct.warehouse_code}`
          : `Stock decreased for code ${refreshedProduct.warehouse_code}`,
      tracking_mode: trackingResult.trackingMode,
      warehouse_tracking_saved: trackingResult.warehouseTrackingSaved,
      product: serializeScanProduct(refreshedProduct),
      inventory: inventorySnapshot,
      scan: trackingResult.scanEvent,
    });
  } catch (error) {
    console.error("Error applying warehouse scan:", error);

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to save warehouse scan",
    });
  }
});

export default router;
