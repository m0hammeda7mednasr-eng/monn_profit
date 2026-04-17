import path from "path";
import dotenv from "dotenv";
import bcryptjs from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve("backend/.env") });
dotenv.config({ path: path.resolve(".env") });

const showHelp = () => {
  console.log(`
Shopify full bootstrap sync

Required:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Shopify connection:
  - Preferred env:
      SHOPIFY_BOOTSTRAP_SHOP or SHOPIFY_EMERGENCY_SHOP
      SHOPIFY_BOOTSTRAP_ACCESS_TOKEN or SHOPIFY_EMERGENCY_ACCESS_TOKEN
  - Or reuse an existing row from public.shopify_tokens
    when the database already has the saved Shopify token

User resolution:
  - If SHOPIFY_BOOTSTRAP_USER_ID is set, use that user
  - Else if SHOPIFY_BOOTSTRAP_USER_EMAIL is set, use that user
  - Else if the database has exactly one user, use it
  - Else create one with:
      SHOPIFY_BOOTSTRAP_USER_EMAIL
      SHOPIFY_BOOTSTRAP_USER_NAME
      SHOPIFY_BOOTSTRAP_USER_PASSWORD

Optional:
  SHOPIFY_BOOTSTRAP_STORE_ID
  SHOPIFY_BOOTSTRAP_STORE_NAME
  SHOPIFY_BOOTSTRAP_STORE_DISPLAY_NAME
  SHOPIFY_BOOTSTRAP_INCLUDE=products,orders,customers
  SHOPIFY_BOOTSTRAP_BATCH_SIZE=250
  SHOPIFY_BOOTSTRAP_UPDATED_AT_MIN=2026-01-01T00:00:00Z

Run:
  node backend/scripts/shopify-bootstrap-sync.js
`);
};

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  showHelp();
  process.exit(0);
}

const requireEnv = (name, fallbackNames = []) => {
  const candidateNames = [name, ...fallbackNames];

  for (const candidateName of candidateNames) {
    const value = String(process.env[candidateName] || "").trim();
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable: ${candidateNames.join(" or ")}`);
};

const parsePositiveInteger = (value, fallbackValue) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
};

const uniqueStrings = (values = []) =>
  Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const includeEntities = uniqueStrings(
  String(process.env.SHOPIFY_BOOTSTRAP_INCLUDE || "products,orders,customers").split(","),
);

const shouldSyncEntity = (entityLabel) =>
  includeEntities.length === 0 || includeEntities.includes(entityLabel);

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_KEY"]);
const configuredShop = String(
  process.env.SHOPIFY_BOOTSTRAP_SHOP || process.env.SHOPIFY_EMERGENCY_SHOP || "",
).trim();
const configuredAccessToken = String(
  process.env.SHOPIFY_BOOTSTRAP_ACCESS_TOKEN ||
    process.env.SHOPIFY_EMERGENCY_ACCESS_TOKEN ||
    "",
).trim();
const batchSize = Math.min(
  parsePositiveInteger(process.env.SHOPIFY_BOOTSTRAP_BATCH_SIZE, 250),
  250,
);
const updatedAtMin = String(process.env.SHOPIFY_BOOTSTRAP_UPDATED_AT_MIN || "").trim() || null;
let activeShop = configuredShop;
let activeAccessToken = configuredAccessToken;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
});

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase() === "admin"
    ? "admin"
    : "user";

const buildPermissionsForRole = (role) => {
  if (normalizeRole(role) === "admin") {
    return {
      can_view_dashboard: true,
      can_view_products: true,
      can_edit_products: true,
      can_view_warehouse: true,
      can_edit_warehouse: true,
      can_view_suppliers: true,
      can_edit_suppliers: true,
      can_view_orders: true,
      can_edit_orders: true,
      can_view_customers: true,
      can_edit_customers: true,
      can_manage_users: true,
      can_manage_settings: true,
      can_view_profits: true,
      can_manage_tasks: true,
      can_view_all_reports: true,
      can_view_activity_log: true,
      can_print_barcode_labels: true,
    };
  }

  return {
    can_view_dashboard: true,
    can_view_products: true,
    can_edit_products: false,
    can_view_warehouse: true,
    can_edit_warehouse: false,
    can_view_suppliers: false,
    can_edit_suppliers: false,
    can_view_orders: true,
    can_edit_orders: false,
    can_view_customers: true,
    can_edit_customers: false,
    can_manage_users: false,
    can_manage_settings: false,
    can_view_profits: false,
    can_manage_tasks: false,
    can_view_all_reports: false,
    can_view_activity_log: false,
    can_print_barcode_labels: true,
  };
};

const findUserById = async (userId) =>
  await supabase
    .from("users")
    .select("id,email,name,role")
    .eq("id", userId)
    .maybeSingle();

const findUserByEmail = async (email) =>
  await supabase
    .from("users")
    .select("id,email,name,role")
    .eq("email", email)
    .maybeSingle();

const ensurePermissions = async (user) => {
  const result = await supabase.from("permissions").upsert(
    {
      user_id: user.id,
      ...buildPermissionsForRole(user.role),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id",
    },
  );

  if (result.error) {
    throw result.error;
  }
};

const resolveSingleExistingUser = async () => {
  const result = await supabase
    .from("users")
    .select("id,email,name,role")
    .order("created_at", { ascending: true })
    .limit(2);

  if (result.error) {
    throw result.error;
  }

  if ((result.data || []).length === 1) {
    return result.data[0];
  }

  return null;
};

const createBootstrapUser = async () => {
  const email = String(process.env.SHOPIFY_BOOTSTRAP_USER_EMAIL || "").trim();
  const name = String(process.env.SHOPIFY_BOOTSTRAP_USER_NAME || "").trim();
  const password = String(process.env.SHOPIFY_BOOTSTRAP_USER_PASSWORD || "");
  const requestedRole = String(process.env.SHOPIFY_BOOTSTRAP_USER_ROLE || "admin").trim();
  const role = normalizeRole(requestedRole || "admin");

  if (!email || !name || !password) {
    throw new Error(
      "Cannot create bootstrap user. Set SHOPIFY_BOOTSTRAP_USER_EMAIL, SHOPIFY_BOOTSTRAP_USER_NAME, and SHOPIFY_BOOTSTRAP_USER_PASSWORD.",
    );
  }

  const passwordHash = await bcryptjs.hash(password, 10);
  const userPayload = {
    email,
    password: passwordHash,
    name,
    role,
    is_active: true,
  };

  if (activeShop) {
    userPayload.shopify_shop = activeShop;
  }

  if (activeAccessToken) {
    userPayload.shopify_access_token = activeAccessToken;
  }

  const createResult = await supabase
    .from("users")
    .insert(userPayload)
    .select("id,email,name,role")
    .single();

  if (createResult.error) {
    throw createResult.error;
  }

  await ensurePermissions(createResult.data);
  return createResult.data;
};

const resolveUser = async () => {
  const explicitUserId = String(process.env.SHOPIFY_BOOTSTRAP_USER_ID || "").trim();
  if (explicitUserId) {
    const result = await findUserById(explicitUserId);
    if (result.error) {
      throw result.error;
    }
    if (!result.data) {
      throw new Error(`User not found for SHOPIFY_BOOTSTRAP_USER_ID=${explicitUserId}`);
    }
    await ensurePermissions(result.data);
    return result.data;
  }

  const explicitEmail = String(process.env.SHOPIFY_BOOTSTRAP_USER_EMAIL || "").trim();
  if (explicitEmail) {
    const result = await findUserByEmail(explicitEmail);
    if (result.error) {
      throw result.error;
    }
    if (result.data) {
      await ensurePermissions(result.data);
      return result.data;
    }

    return await createBootstrapUser();
  }

  const singleUser = await resolveSingleExistingUser();
  if (singleUser) {
    await ensurePermissions(singleUser);
    return singleUser;
  }

  return await createBootstrapUser();
};

const findStoreById = async (storeId) =>
  await supabase
    .from("stores")
    .select("id,name,display_name")
    .eq("id", storeId)
    .maybeSingle();

const findStoreByName = async (storeName) =>
  await supabase
    .from("stores")
    .select("id,name,display_name")
    .eq("name", storeName)
    .maybeSingle();

const resolveExistingTokenRow = async (userId) => {
  let query = supabase
    .from("shopify_tokens")
    .select("id,user_id,store_id,shop")
    .eq("user_id", userId);

  if (activeShop) {
    query = query.eq("shop", activeShop);
  }

  const result = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data || null;
};

const resolveShopifyConnection = async ({ userId = null, storeId = null } = {}) => {
  if (activeShop && activeAccessToken) {
    return {
      shop: activeShop,
      accessToken: activeAccessToken,
      source: "env",
    };
  }

  let query = supabase
    .from("shopify_tokens")
    .select("shop,access_token,user_id,store_id,updated_at");

  if (activeShop) {
    query = query.eq("shop", activeShop);
  }

  if (userId) {
    query = query.eq("user_id", userId);
  }

  if (storeId) {
    query = query.eq("store_id", storeId);
  }

  const result = await query.order("updated_at", { ascending: false }).limit(2);
  if (result.error) {
    throw result.error;
  }

  const rows = result.data || [];
  if (rows.length === 0) {
    throw new Error(
      "Shopify access token was not found. Set SHOPIFY_BOOTSTRAP_ACCESS_TOKEN or reconnect Shopify once so the token is saved in shopify_tokens.",
    );
  }

  if (!activeShop && rows.length > 1) {
    throw new Error(
      "Multiple Shopify token rows found. Set SHOPIFY_BOOTSTRAP_SHOP or SHOPIFY_BOOTSTRAP_STORE_ID to choose the correct store.",
    );
  }

  const row = rows[0];
  activeShop = activeShop || String(row.shop || "").trim();
  activeAccessToken = activeAccessToken || String(row.access_token || "").trim();

  if (!activeShop || !activeAccessToken) {
    throw new Error(
      "Resolved Shopify connection is incomplete. Verify shopify_tokens has both shop and access_token.",
    );
  }

  return {
    shop: activeShop,
    accessToken: activeAccessToken,
    source: "database",
  };
};

const resolveStore = async (user) => {
  const explicitStoreId = String(process.env.SHOPIFY_BOOTSTRAP_STORE_ID || "").trim();
  if (explicitStoreId) {
    const result = await findStoreById(explicitStoreId);
    if (result.error) {
      throw result.error;
    }
    if (!result.data) {
      throw new Error(`Store not found for SHOPIFY_BOOTSTRAP_STORE_ID=${explicitStoreId}`);
    }
    return result.data;
  }

  const tokenRow = await resolveExistingTokenRow(user.id);
  if (tokenRow?.store_id) {
    const result = await findStoreById(tokenRow.store_id);
    if (result.error) {
      throw result.error;
    }
    if (result.data) {
      return result.data;
    }
  }

  if (!activeShop) {
    throw new Error(
      "Cannot resolve store before Shopify shop is known. Set SHOPIFY_BOOTSTRAP_SHOP or ensure a matching shopify_tokens row exists.",
    );
  }

  const storeName = String(process.env.SHOPIFY_BOOTSTRAP_STORE_NAME || activeShop).trim();
  const storeDisplayName = String(
    process.env.SHOPIFY_BOOTSTRAP_STORE_DISPLAY_NAME || storeName,
  ).trim();
  const existingStore = await findStoreByName(storeName);
  if (existingStore.error) {
    throw existingStore.error;
  }
  if (existingStore.data) {
    return existingStore.data;
  }

  const createResult = await supabase
    .from("stores")
    .insert({
      name: storeName,
      display_name: storeDisplayName,
      created_by: user.id,
    })
    .select("id,name,display_name")
    .single();

  if (createResult.error) {
    throw createResult.error;
  }

  return createResult.data;
};

const ensureUserStoreAccess = async (userId, storeId) => {
  const result = await supabase.from("user_stores").upsert(
    {
      user_id: userId,
      store_id: storeId,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,store_id",
    },
  );

  if (result.error) {
    throw result.error;
  }
};

const saveShopifyToken = async (userId, storeId) => {
  const now = new Date().toISOString();

  const tokenResult = await supabase.from("shopify_tokens").upsert(
    {
      user_id: userId,
      store_id: storeId,
      shop: activeShop,
      access_token: activeAccessToken,
      updated_at: now,
      created_at: now,
    },
    {
      onConflict: "user_id,shop",
    },
  );

  const normalizedErrorMessage = String(
    tokenResult?.error?.message || "",
  ).toLowerCase();

  if (
    tokenResult.error &&
    normalizedErrorMessage.includes(
      "there is no unique or exclusion constraint matching the on conflict specification",
    )
  ) {
    const existingTokenResult = await supabase
      .from("shopify_tokens")
      .select("id")
      .eq("user_id", userId)
      .eq("shop", activeShop)
      .maybeSingle();

    if (existingTokenResult.error) {
      throw existingTokenResult.error;
    }

    if (existingTokenResult.data?.id) {
      const updateResult = await supabase
        .from("shopify_tokens")
        .update({
          access_token: activeAccessToken,
          store_id: storeId,
          updated_at: now,
        })
        .eq("id", existingTokenResult.data.id);

      if (updateResult.error) {
        throw updateResult.error;
      }
    } else {
      const insertResult = await supabase.from("shopify_tokens").insert({
        user_id: userId,
        store_id: storeId,
        shop: activeShop,
        access_token: activeAccessToken,
        updated_at: now,
        created_at: now,
      });

      if (insertResult.error) {
        throw insertResult.error;
      }
    }
  } else if (tokenResult.error) {
    throw tokenResult.error;
  }

  const userUpdateResult = await supabase
    .from("users")
      .update({
      shopify_shop: activeShop,
      shopify_access_token: activeAccessToken,
      updated_at: now,
    })
    .eq("id", userId);

  if (userUpdateResult.error) {
    throw userUpdateResult.error;
  }
};

const countStoreRows = async (tableName, storeId) => {
  const result = await supabase
    .from(tableName)
    .select("*", { count: "exact", head: true })
    .eq("store_id", storeId);

  if (result.error) {
    throw result.error;
  }

  return result.count || 0;
};

const fetchLatestOrderSummary = async (storeId) => {
  const result = await supabase
    .from("orders")
    .select(
      "id,shopify_id,order_number,customer_name,customer_email,total_price,currency,created_at,updated_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw result.error;
  }

  return result.data || null;
};

const syncEntityInBatches = async ({
  entityLabel,
  syncBatch,
  userId,
  storeId,
}) => {
  if (!shouldSyncEntity(entityLabel)) {
    return {
      skipped: true,
      batches: 0,
      fetched: 0,
      persisted: 0,
    };
  }

  let pageUrl = null;
  let totalFetched = 0;
  let totalPersisted = 0;
  let batches = 0;

  while (true) {
    const batchResult = await syncBatch(userId, activeShop, activeAccessToken, storeId, {
      batchSize,
      pageUrl,
      updatedAtMin,
    });

    const currentFetched = Number(batchResult?.batchCount || 0);
    const currentPersisted = Number(batchResult?.persistedCount || 0);
    pageUrl = batchResult?.nextPageUrl || null;
    totalFetched += currentFetched;
    totalPersisted += currentPersisted;
    batches += 1;

    console.log(
      `[${entityLabel}] batch ${batches}: fetched=${currentFetched}, persisted=${currentPersisted}, total=${totalFetched}`,
    );

    if (!pageUrl) {
      break;
    }
  }

  return {
    skipped: false,
    batches,
    fetched: totalFetched,
    persisted: totalPersisted,
  };
};

const main = async () => {
  const { ShopifyService } = await import("../src/services/shopifyService.js");

  console.log("Resolving target user...");
  const user = await resolveUser();
  console.log(`Using user ${user.email} (${user.id})`);

  const shopifyConnection = await resolveShopifyConnection({
    userId: user.id,
  });
  console.log(`Using Shopify source=${shopifyConnection.source}, shop=${shopifyConnection.shop}`);

  console.log("Resolving target store...");
  const store = await resolveStore(user);
  console.log(`Using store ${store.name} (${store.id})`);

  await resolveShopifyConnection({
    userId: user.id,
    storeId: store.id,
  });

  console.log("Ensuring store access and Shopify token...");
  await ensureUserStoreAccess(user.id, store.id);
  await saveShopifyToken(user.id, store.id);

  const results = {
    shop: activeShop,
    user_id: user.id,
    store_id: store.id,
    include: includeEntities,
    batch_size: batchSize,
    updated_at_min: updatedAtMin,
    entities: {},
  };

  results.entities.products = await syncEntityInBatches({
    entityLabel: "products",
    syncBatch: ShopifyService.syncProductsBatch.bind(ShopifyService),
    userId: user.id,
    storeId: store.id,
  });

  results.entities.orders = await syncEntityInBatches({
    entityLabel: "orders",
    syncBatch: ShopifyService.syncOrdersBatch.bind(ShopifyService),
    userId: user.id,
    storeId: store.id,
  });

  results.entities.customers = await syncEntityInBatches({
    entityLabel: "customers",
    syncBatch: ShopifyService.syncCustomersBatch.bind(ShopifyService),
    userId: user.id,
    storeId: store.id,
  });

  results.database_counts = {
    products: await countStoreRows("products", store.id),
    orders: await countStoreRows("orders", store.id),
    customers: await countStoreRows("customers", store.id),
  };

  results.latest_order = await fetchLatestOrderSummary(store.id);

  console.log(JSON.stringify(results, null, 2));
};

main().catch((error) => {
  console.error("Shopify bootstrap sync failed.");
  console.error(error?.message || error);
  process.exit(1);
});
