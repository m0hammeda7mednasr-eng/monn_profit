import { supabase as db } from "../supabaseClient.js";
import {
  buildWarehouseVariantCatalog,
  normalizeWarehouseCode,
} from "../helpers/warehouseCatalog.js";

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
const PRODUCT_PAGE_SIZE = 500;
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

const normalizeId = (value) => String(value || "").trim();

const normalizeSku = (value) => normalizeWarehouseCode(value);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

const loadProductsForStoreIds = async (storeIds = []) => {
  const normalizedStoreIds = Array.from(
    new Set((storeIds || []).map(normalizeId).filter(Boolean)),
  );
  if (normalizedStoreIds.length === 0) {
    return [];
  }

  const rows = [];

  for (let offset = 0; ; offset += PRODUCT_PAGE_SIZE) {
    const { data, error } = await db
      .from("products")
      .select(PRODUCT_LOOKUP_SELECT)
      .in("store_id", normalizedStoreIds)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PRODUCT_PAGE_SIZE - 1);

    if (error) {
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);

    if (pageRows.length < PRODUCT_PAGE_SIZE) {
      break;
    }
  }

  return rows;
};

const loadInventoryRowsForStoreIds = async (storeIds = []) => {
  const normalizedStoreIds = Array.from(
    new Set((storeIds || []).map(normalizeId).filter(Boolean)),
  );
  if (normalizedStoreIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("warehouse_inventory")
    .select("id, store_id, product_id, sku, quantity")
    .in("store_id", normalizedStoreIds);

  if (error) {
    throw error;
  }

  return data || [];
};

const mapInventoryRowsByCode = (rows = []) =>
  new Map(
    (rows || [])
      .map((row) => [normalizeSku(row?.sku), row])
      .filter(([code]) => code),
  );

const buildAvailabilityEntry = (catalogRow, inventoryRow, warehouseTablesReady) => ({
  key:
    normalizeId(catalogRow?.key) ||
    normalizeId(catalogRow?.variant_id) ||
    normalizeSku(catalogRow?.warehouse_code || catalogRow?.sku),
  store_id: normalizeId(catalogRow?.store_id || inventoryRow?.store_id),
  product_id: normalizeId(catalogRow?.product_id || inventoryRow?.product_id),
  shopify_id: normalizeId(catalogRow?.shopify_id),
  variant_id: normalizeId(catalogRow?.variant_id),
  warehouse_code: normalizeSku(catalogRow?.warehouse_code || catalogRow?.sku),
  sku: normalizeSku(catalogRow?.sku || inventoryRow?.sku),
  display_title:
    String(catalogRow?.display_title || catalogRow?.product_title || catalogRow?.title || "")
      .trim() || "Archived product",
  warehouse_quantity: warehouseTablesReady
    ? Math.max(0, toNumber(inventoryRow?.quantity))
    : Math.max(0, toNumber(catalogRow?.local_warehouse_quantity)),
});

const buildOrphanAvailabilityEntry = (inventoryRow) => ({
  key: normalizeId(inventoryRow?.id) || normalizeSku(inventoryRow?.sku),
  store_id: normalizeId(inventoryRow?.store_id),
  product_id: normalizeId(inventoryRow?.product_id),
  shopify_id: "",
  variant_id: "",
  warehouse_code: normalizeSku(inventoryRow?.sku),
  sku: normalizeSku(inventoryRow?.sku),
  display_title: `Archived code ${String(inventoryRow?.sku || "").trim()}`.trim(),
  warehouse_quantity: Math.max(0, toNumber(inventoryRow?.quantity)),
});

export const loadWarehouseAvailabilityByStoreIds = async (storeIds = []) => {
  const normalizedStoreIds = Array.from(
    new Set((storeIds || []).map(normalizeId).filter(Boolean)),
  );
  const rowsByStoreId = new Map(
    normalizedStoreIds.map((storeId) => [storeId, []]),
  );

  if (normalizedStoreIds.length === 0) {
    return rowsByStoreId;
  }

  const products = await loadProductsForStoreIds(normalizedStoreIds);
  const catalog = buildWarehouseVariantCatalog(products);

  let inventoryRows = [];
  let warehouseTablesReady = true;

  try {
    inventoryRows = await loadInventoryRowsForStoreIds(normalizedStoreIds);
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }

    warehouseTablesReady = false;
  }

  const inventoryByCode = mapInventoryRowsByCode(inventoryRows);
  const matchedInventoryCodes = new Set();

  for (const catalogRow of catalog.rows) {
    const inventoryCode = normalizeSku(catalogRow?.warehouse_code);
    const matchedInventoryRow =
      warehouseTablesReady && inventoryCode
        ? inventoryByCode.get(inventoryCode)
        : null;

    if (matchedInventoryRow && inventoryCode) {
      matchedInventoryCodes.add(inventoryCode);
    }

    const entry = buildAvailabilityEntry(
      catalogRow,
      matchedInventoryRow,
      warehouseTablesReady,
    );
    const storeId = normalizeId(entry.store_id);
    if (!storeId) {
      continue;
    }

    const storeRows = rowsByStoreId.get(storeId) || [];
    storeRows.push(entry);
    rowsByStoreId.set(storeId, storeRows);
  }

  if (warehouseTablesReady) {
    for (const inventoryRow of inventoryRows) {
      const inventoryCode = normalizeSku(inventoryRow?.sku);
      if (!inventoryCode || matchedInventoryCodes.has(inventoryCode)) {
        continue;
      }

      const entry = buildOrphanAvailabilityEntry(inventoryRow);
      const storeId = normalizeId(entry.store_id);
      if (!storeId) {
        continue;
      }

      const storeRows = rowsByStoreId.get(storeId) || [];
      storeRows.push(entry);
      rowsByStoreId.set(storeId, storeRows);
    }
  }

  return rowsByStoreId;
};
