import express from "express";
import { supabase as db } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { getAccessibleStoreIds } from "../models/index.js";
import {
  clearHeavyCacheByPrefix,
  clearHeavyCacheNamespace,
} from "../helpers/heavyRouteCache.js";
import {
  buildSupplierDetail,
  buildSupplierList,
  normalizeSupplierType,
  sanitizeDeliveryPayload,
  sanitizeFabricPayload,
  sanitizePaymentPayload,
  sanitizeSupplierPayload,
} from "../helpers/suppliers.js";

const router = express.Router();
const SHOPIFY_SCOPED_ENTITY_PAGE_CACHE_NAMESPACE = "shopify:scoped-entity-page";
const PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE = "shopify:product-supplier-links";

const clearProductSupplierReadCaches = () => {
  clearHeavyCacheByPrefix(
    SHOPIFY_SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
    "products::",
  );
  clearHeavyCacheNamespace(PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE);
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const SUPPLIERS_SQL_FILE = "ADD_SUPPLIERS_MODULE.sql";
const SUPPLIERS_SELECT = [
  "id",
  "store_id",
  "supplier_type",
  "code",
  "name",
  "contact_name",
  "phone",
  "address",
  "notes",
  "opening_balance",
  "is_active",
  "created_by",
  "created_at",
  "updated_at",
].join(",");
const SUPPLIER_ENTRIES_SELECT = [
  "id",
  "supplier_id",
  "store_id",
  "entry_type",
  "entry_date",
  "reference_code",
  "description",
  "amount",
  "payment_method",
  "payment_account",
  "items",
  "notes",
  "created_by",
  "created_at",
  "updated_at",
].join(",");
const SUPPLIER_FABRICS_SELECT = [
  "id",
  "supplier_id",
  "store_id",
  "fabric_supplier_id",
  "code",
  "name",
  "notes",
  "is_active",
  "created_by",
  "created_at",
  "updated_at",
].join(",");
const SUPPLIER_PRODUCTS_SELECT = [
  "id",
  "supplier_id",
  "store_id",
  "product_id",
  "variant_id",
  "product_shopify_id",
  "product_name",
  "variant_title",
  "sku",
  "notes",
  "is_active",
  "created_by",
  "created_at",
  "updated_at",
].join(",");
const PRODUCT_LINK_PRODUCT_SELECT = [
  "id",
  "shopify_id",
  "store_id",
  "title",
  "vendor",
  "product_type",
  "sku",
  "data",
].join(",");

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

const handleSchemaError = (res) =>
  res.status(503).json({
    error:
      "Suppliers module is not ready yet. Run ADD_SUPPLIERS_MODULE.sql in Supabase first",
    setup_required: true,
    sql_file: SUPPLIERS_SQL_FILE,
  });

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

const getRequestedSupplierType = (req) => {
  const normalized = String(req.query?.type || req.body?.supplier_type || "").trim();
  if (!normalized) {
    return null;
  }

  return normalizeSupplierType(normalized);
};

const normalizeNullableText = (value) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const resolveIsAdmin = (req) =>
  Boolean(req.user?.isAdmin || String(req.user?.role || "").toLowerCase() === "admin");

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
  const requestedStoreId = getRequestedStoreId(req);
  const isAdmin = resolveIsAdmin(req);

  if (isAdmin) {
    if (requestedStoreId) {
      return {
        isAdmin,
        storeId: requestedStoreId,
      };
    }

    const adminStoreIds = await getAdminStoreIds();
    if (adminStoreIds.length === 1) {
      return {
        isAdmin,
        storeId: adminStoreIds[0],
      };
    }

    if (adminStoreIds.length === 0) {
      throw createHttpError(400, "No connected store is available yet");
    }

    throw createHttpError(400, "Select a store first before opening suppliers");
  }

  const accessibleStoreIds = await getAccessibleStoreIds(req.user?.id);

  if (requestedStoreId) {
    if (
      accessibleStoreIds.length === 0 ||
      !accessibleStoreIds.includes(requestedStoreId)
    ) {
      throw createHttpError(403, "Access denied for the selected store");
    }

    return {
      isAdmin,
      storeId: requestedStoreId,
    };
  }

  if (accessibleStoreIds.length === 1) {
    return {
      isAdmin,
      storeId: accessibleStoreIds[0],
    };
  }

  if (accessibleStoreIds.length === 0) {
    throw createHttpError(400, "No store is connected to this account yet");
  }

  throw createHttpError(400, "Select a store first before opening suppliers");
};

const loadStoreSuppliers = async (storeId, supplierType = null) => {
  let query = db
    .from("suppliers")
    .select(SUPPLIERS_SELECT)
    .eq("store_id", storeId);

  if (supplierType) {
    query = query.eq("supplier_type", supplierType);
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
};

const loadStoreSupplierEntries = async (storeId) => {
  const { data, error } = await db
    .from("supplier_entries")
    .select(SUPPLIER_ENTRIES_SELECT)
    .eq("store_id", storeId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  return data || [];
};

const loadStoreSupplierFabrics = async (storeId) => {
  const { data, error } = await db
    .from("supplier_fabrics")
    .select(SUPPLIER_FABRICS_SELECT)
    .eq("store_id", storeId)
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })
    .limit(500);

  if (error) {
    throw error;
  }

  return data || [];
};

const loadStoreSupplierProductLinks = async (storeId, supplierId = null) => {
  let query = db
    .from("supplier_products")
    .select(SUPPLIER_PRODUCTS_SELECT)
    .eq("store_id", storeId);

  if (supplierId) {
    query = query.eq("supplier_id", supplierId);
  }

  const { data, error } = await query
    .order("product_name", { ascending: true })
    .order("variant_title", { ascending: true });

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return [];
    }
    throw error;
  }

  return data || [];
};

router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      clearProductSupplierReadCaches();
    }
  });

  return next();
});

const getProductVariantRows = (product = {}) => {
  const rawData = product?.data;
  const parsedData =
    rawData && typeof rawData === "object"
      ? rawData
      : (() => {
          try {
            return rawData ? JSON.parse(rawData) : {};
          } catch {
            return {};
          }
        })();

  return Array.isArray(parsedData?.variants) ? parsedData.variants : [];
};

const buildProductLinkSnapshot = (product = {}, variantId = "") => {
  const normalizedVariantId = String(variantId || "").trim();
  const variants = getProductVariantRows(product);
  const variant = normalizedVariantId
    ? variants.find((item) => String(item?.id || "").trim() === normalizedVariantId)
    : null;
  const variantTitle = normalizeNullableText(variant?.title) || "";
  const sku = normalizeNullableText(variant?.sku || product?.sku) || "";

  return {
    product_shopify_id: String(product?.shopify_id || "").trim(),
    product_name: String(product?.title || "").trim(),
    variant_title: variantTitle,
    sku,
  };
};

const decorateSupplierProductLinks = async (links = [], storeId) => {
  const productIds = Array.from(
    new Set(
      (links || [])
        .map((link) => String(link?.product_id || "").trim())
        .filter(Boolean),
    ),
  );

  if (productIds.length === 0) {
    return links || [];
  }

  const { data: products, error } = await db
    .from("products")
    .select(PRODUCT_LINK_PRODUCT_SELECT)
    .eq("store_id", storeId)
    .in("id", productIds);

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return links || [];
    }
    throw error;
  }

  const productsById = new Map(
    (products || []).map((product) => [String(product?.id || ""), product]),
  );

  return (links || []).map((link) => {
    const product = productsById.get(String(link?.product_id || "")) || null;
    const snapshot = product
      ? buildProductLinkSnapshot(product, link?.variant_id)
      : {};

    return {
      ...link,
      product_shopify_id:
        String(link?.product_shopify_id || "").trim() ||
        snapshot.product_shopify_id ||
        "",
      product_name:
        String(link?.product_name || "").trim() || snapshot.product_name || "",
      variant_title:
        String(link?.variant_title || "").trim() || snapshot.variant_title || "",
      sku: String(link?.sku || "").trim() || snapshot.sku || "",
      product: product
        ? {
            id: product.id,
            shopify_id: product.shopify_id,
            title: product.title,
            vendor: product.vendor,
            product_type: product.product_type,
            sku: product.sku,
          }
        : null,
    };
  });
};

const attachProductLinkCounts = (suppliers = [], links = []) => {
  const countsBySupplier = new Map();

  for (const link of links || []) {
    if (link?.is_active === false) {
      continue;
    }

    const supplierId = String(link?.supplier_id || "").trim();
    if (!supplierId) {
      continue;
    }

    const current = countsBySupplier.get(supplierId) || new Set();
    current.add(
      `${String(link?.product_id || "").trim()}::${String(
        link?.variant_id || "",
      ).trim()}`,
    );
    countsBySupplier.set(supplierId, current);
  }

  return (suppliers || []).map((supplier) => {
    const directProductsCount = countsBySupplier.get(String(supplier?.id || ""))?.size || 0;
    return {
      ...supplier,
      direct_products_count: directProductsCount,
      products_count: Math.max(Number(supplier?.products_count || 0), directProductsCount),
    };
  });
};

const buildSupplierProductPayloads = async ({
  storeId,
  supplierId,
  links = [],
  userId,
}) => {
  const requestedLinks = Array.isArray(links) ? links : [];
  const normalizedLinks = requestedLinks
    .map((link) => ({
      product_id: String(link?.product_id || "").trim(),
      variant_id: normalizeNullableText(link?.variant_id),
      notes: String(link?.notes || "").trim(),
      is_active: link?.is_active !== false,
    }))
    .filter((link) => UUID_REGEX.test(link.product_id));

  if (normalizedLinks.length === 0) {
    return [];
  }

  const uniqueKeys = new Set();
  const dedupedLinks = normalizedLinks.filter((link) => {
    const key = `${link.product_id}::${link.variant_id || ""}`;
    if (uniqueKeys.has(key)) {
      return false;
    }
    uniqueKeys.add(key);
    return true;
  });

  const productIds = Array.from(new Set(dedupedLinks.map((link) => link.product_id)));
  const { data: products, error } = await db
    .from("products")
    .select(PRODUCT_LINK_PRODUCT_SELECT)
    .eq("store_id", storeId)
    .in("id", productIds);

  if (error) {
    throw error;
  }

  const productsById = new Map(
    (products || []).map((product) => [String(product?.id || ""), product]),
  );

  if (productsById.size !== productIds.length) {
    throw createHttpError(400, "One or more selected products were not found");
  }

  return dedupedLinks.map((link) => {
    const product = productsById.get(link.product_id);
    const snapshot = buildProductLinkSnapshot(product, link.variant_id);

    return {
      supplier_id: supplierId,
      store_id: storeId,
      product_id: link.product_id,
      variant_id: link.variant_id,
      product_shopify_id: snapshot.product_shopify_id,
      product_name: snapshot.product_name,
      variant_title: snapshot.variant_title,
      sku: snapshot.sku,
      notes: link.notes,
      is_active: link.is_active,
      created_by: userId || null,
      updated_at: new Date().toISOString(),
    };
  });
};

const findSupplierForStore = async (storeId, supplierId) => {
  const { data, error } = await db
    .from("suppliers")
    .select(SUPPLIERS_SELECT)
    .eq("store_id", storeId)
    .eq("id", supplierId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const requireSupplierForStore = async (storeId, supplierId) => {
  const supplier = await findSupplierForStore(storeId, supplierId);
  if (!supplier) {
    throw createHttpError(404, "Supplier not found for the selected store");
  }

  return supplier;
};

const requireSupplierType = (supplier, supplierType, message) => {
  if (supplierType && supplier?.supplier_type !== supplierType) {
    throw createHttpError(
      400,
      message || "Supplier type does not match the requested operation",
    );
  }

  return supplier;
};

const findSupplierFabricForStore = async (storeId, supplierId, fabricId) => {
  const { data, error } = await db
    .from("supplier_fabrics")
    .select(SUPPLIER_FABRICS_SELECT)
    .eq("store_id", storeId)
    .eq("supplier_id", supplierId)
    .eq("id", fabricId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const requireSupplierFabricForStore = async (storeId, supplierId, fabricId) => {
  const fabric = await findSupplierFabricForStore(storeId, supplierId, fabricId);
  if (!fabric) {
    throw createHttpError(404, "Fabric record not found for the selected supplier");
  }

  return fabric;
};

router.use(authenticateToken, requirePermission("can_view_suppliers"));

router.get("/", async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const supplierType = getRequestedSupplierType(req);
    const [suppliers, entries, fabrics, allSuppliers, productLinks] = await Promise.all([
      loadStoreSuppliers(storeId, supplierType),
      loadStoreSupplierEntries(storeId),
      loadStoreSupplierFabrics(storeId),
      loadStoreSuppliers(storeId),
      loadStoreSupplierProductLinks(storeId),
    ]);
    const data = attachProductLinkCounts(
      buildSupplierList(suppliers, entries, fabrics, allSuppliers),
      productLinks,
    );

    res.json({
      data,
      meta: {
        store_id: storeId,
        supplier_type: supplierType,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);

    if (isSchemaCompatibilityError(error)) {
      return handleSchemaError(res);
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to fetch suppliers",
    });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const requestedSupplierType = getRequestedSupplierType(req);
    const supplier = requireSupplierType(
      await requireSupplierForStore(storeId, req.params.id),
      requestedSupplierType,
      "Supplier type does not match the current page",
    );
    const [entries, fabrics, allSuppliers, productLinks] = await Promise.all([
      loadStoreSupplierEntries(storeId),
      loadStoreSupplierFabrics(storeId),
      loadStoreSuppliers(storeId),
      loadStoreSupplierProductLinks(storeId, supplier.id),
    ]);
    const detail = buildSupplierDetail(
      supplier,
      entries,
      fabrics,
      allSuppliers,
    );
    const decoratedProductLinks = await decorateSupplierProductLinks(
      productLinks,
      storeId,
    );

    res.json({
      supplier: {
        ...detail,
        product_links: decoratedProductLinks,
        direct_products_count: decoratedProductLinks.filter(
          (link) => link?.is_active !== false,
        ).length,
        products_count: Math.max(
          Number(detail?.products_count || 0),
          decoratedProductLinks.filter((link) => link?.is_active !== false).length,
        ),
      },
      meta: {
        store_id: storeId,
        supplier_type: supplier.supplier_type,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching supplier detail:", error);

    if (isSchemaCompatibilityError(error)) {
      return handleSchemaError(res);
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to fetch supplier detail",
    });
  }
});

router.get(
  "/:id/product-links",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      await requireSupplierForStore(storeId, req.params.id);
      const links = await decorateSupplierProductLinks(
        await loadStoreSupplierProductLinks(storeId, req.params.id),
        storeId,
      );

      res.json({
        data: links,
        meta: {
          store_id: storeId,
          supplier_id: req.params.id,
          generated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Error fetching supplier product links:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to fetch supplier product links",
      });
    }
  },
);

router.put(
  "/:id/product-links",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const supplier = await requireSupplierForStore(storeId, req.params.id);
      const payloads = await buildSupplierProductPayloads({
        storeId,
        supplierId: supplier.id,
        links: req.body?.links,
        userId: req.user?.id,
      });

      const deleteResult = await db
        .from("supplier_products")
        .delete()
        .eq("store_id", storeId)
        .eq("supplier_id", supplier.id);

      if (deleteResult.error) {
        throw deleteResult.error;
      }

      if (payloads.length > 0) {
        const { error: insertError } = await db
          .from("supplier_products")
          .insert(payloads);

        if (insertError) {
          throw insertError;
        }
      }

      clearHeavyCacheByPrefix(
        SHOPIFY_SCOPED_ENTITY_PAGE_CACHE_NAMESPACE,
        "products::",
      );
      clearHeavyCacheNamespace(PRODUCT_SUPPLIER_LINKS_CACHE_NAMESPACE);

      const links = await decorateSupplierProductLinks(
        await loadStoreSupplierProductLinks(storeId, supplier.id),
        storeId,
      );

      res.json({
        data: links,
        meta: {
          store_id: storeId,
          supplier_id: supplier.id,
          count: links.length,
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Error saving supplier product links:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to save supplier product links",
      });
    }
  },
);

router.post("/", requirePermission("can_edit_suppliers"), async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    const payload = sanitizeSupplierPayload(req.body);

    if (!payload.name) {
      return res.status(400).json({ error: "Supplier name is required" });
    }

    const { data, error } = await db
      .from("suppliers")
      .insert({
        ...payload,
        store_id: storeId,
        created_by: req.user?.id || null,
      })
      .select(SUPPLIERS_SELECT)
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating supplier:", error);

    if (isSchemaCompatibilityError(error)) {
      return handleSchemaError(res);
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to create supplier",
    });
  }
});

router.put("/:id", requirePermission("can_edit_suppliers"), async (req, res) => {
  try {
    const { storeId } = await resolveStoreContext(req);
    await requireSupplierForStore(storeId, req.params.id);

    const payload = sanitizeSupplierPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({ error: "Supplier name is required" });
    }

    const { data, error } = await db
      .from("suppliers")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq("store_id", storeId)
      .eq("id", req.params.id)
      .select(SUPPLIERS_SELECT)
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error updating supplier:", error);

    if (isSchemaCompatibilityError(error)) {
      return handleSchemaError(res);
    }

    res.status(error.status || 500).json({
      error: error.status ? error.message : "Failed to update supplier",
    });
  }
});

router.post(
  "/:id/fabrics",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const supplier = requireSupplierType(
        await requireSupplierForStore(storeId, req.params.id),
        "factory",
        "Fabric codes can only be created under factory suppliers",
      );
      const payload = sanitizeFabricPayload(req.body);
      const fabricSupplier = payload.fabric_supplier_id
        ? requireSupplierType(
            await requireSupplierForStore(storeId, payload.fabric_supplier_id),
            "fabric",
            "Fabric supplier must be selected from fabric suppliers only",
          )
        : null;

      if (!payload.name) {
        return res.status(400).json({ error: "Fabric name is required" });
      }

      const { data, error } = await db
        .from("supplier_fabrics")
        .insert({
          supplier_id: supplier.id,
          store_id: storeId,
          fabric_supplier_id: fabricSupplier?.id || null,
          code: payload.code || null,
          name: payload.name,
          notes: payload.notes || null,
          is_active: payload.is_active,
          created_by: req.user?.id || null,
        })
        .select(SUPPLIER_FABRICS_SELECT)
        .single();

      if (error) {
        throw error;
      }

      res.status(201).json(data);
    } catch (error) {
      console.error("Error creating supplier fabric:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to create supplier fabric",
      });
    }
  },
);

router.put(
  "/:id/fabrics/:fabricId",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const supplier = requireSupplierType(
        await requireSupplierForStore(storeId, req.params.id),
        "factory",
        "Fabric codes can only be edited under factory suppliers",
      );
      await requireSupplierFabricForStore(storeId, supplier.id, req.params.fabricId);
      const payload = sanitizeFabricPayload(req.body);
      const fabricSupplier = payload.fabric_supplier_id
        ? requireSupplierType(
            await requireSupplierForStore(storeId, payload.fabric_supplier_id),
            "fabric",
            "Fabric supplier must be selected from fabric suppliers only",
          )
        : null;

      if (!payload.name) {
        return res.status(400).json({ error: "Fabric name is required" });
      }

      const { data, error } = await db
        .from("supplier_fabrics")
        .update({
          fabric_supplier_id: fabricSupplier?.id || null,
          code: payload.code || null,
          name: payload.name,
          notes: payload.notes || null,
          is_active: payload.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("store_id", storeId)
        .eq("supplier_id", supplier.id)
        .eq("id", req.params.fabricId)
        .select(SUPPLIER_FABRICS_SELECT)
        .single();

      if (error) {
        throw error;
      }

      res.json(data);
    } catch (error) {
      console.error("Error updating supplier fabric:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to update supplier fabric",
      });
    }
  },
);

router.post(
  "/:id/deliveries",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const supplier = requireSupplierType(
        await requireSupplierForStore(storeId, req.params.id),
        "factory",
        "Deliveries can only be recorded for factory suppliers",
      );
      const payload = sanitizeDeliveryPayload(req.body);

      if (!payload.entry_date) {
        return res.status(400).json({ error: "Delivery date is required" });
      }

      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        return res.status(400).json({
          error: "Add at least one received product before saving the delivery",
        });
      }

      const { data, error } = await db
        .from("supplier_entries")
        .insert({
          supplier_id: supplier.id,
          store_id: storeId,
          entry_type: "delivery",
          entry_date: payload.entry_date,
          reference_code: payload.reference_code || null,
          description: payload.description || null,
          amount: payload.amount,
          payment_method: payload.payment_method || null,
          payment_account: payload.payment_account || null,
          items: payload.items,
          notes: payload.notes || null,
          created_by: req.user?.id || null,
        })
        .select(SUPPLIER_ENTRIES_SELECT)
        .single();

      if (error) {
        throw error;
      }

      res.status(201).json(data);
    } catch (error) {
      console.error("Error creating supplier delivery:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to add supplier delivery",
      });
    }
  },
);

router.post(
  "/:id/payments",
  requirePermission("can_edit_suppliers"),
  async (req, res) => {
    try {
      const { storeId } = await resolveStoreContext(req);
      const supplier = requireSupplierType(
        await requireSupplierForStore(storeId, req.params.id),
        "factory",
        "Payments can only be recorded for factory suppliers",
      );
      const payload = sanitizePaymentPayload(req.body);

      if (!payload.entry_date) {
        return res.status(400).json({ error: "Payment date is required" });
      }

      if (payload.amount <= 0) {
        return res.status(400).json({ error: "Payment amount must be greater than 0" });
      }

      const { data, error } = await db
        .from("supplier_entries")
        .insert({
          supplier_id: supplier.id,
          store_id: storeId,
          entry_type: "payment",
          entry_date: payload.entry_date,
          reference_code: payload.reference_code || null,
          description: payload.description || null,
          amount: payload.amount,
          payment_method: payload.payment_method || null,
          payment_account: payload.payment_account || null,
          items: [],
          notes: payload.notes || null,
          created_by: req.user?.id || null,
        })
        .select(SUPPLIER_ENTRIES_SELECT)
        .single();

      if (error) {
        throw error;
      }

      res.status(201).json(data);
    } catch (error) {
      console.error("Error creating supplier payment:", error);

      if (isSchemaCompatibilityError(error)) {
        return handleSchemaError(res);
      }

      res.status(error.status || 500).json({
        error: error.status ? error.message : "Failed to add supplier payment",
      });
    }
  },
);

export default router;
