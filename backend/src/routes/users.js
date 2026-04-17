import express from "express";
import bcrypt from "bcryptjs";
import { authenticateToken } from "../middleware/auth.js";
import {
  buildPermissionsForRole,
  clearUserAccessContextCache,
  requirePermission,
  DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,
  normalizePermissions,
  normalizeRole,
  primeUserAccessContext,
} from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";
import {
  isTransientSupabaseError,
  withSupabaseRetry,
} from "../helpers/supabaseRetry.js";
import { getAccessibleStoreIds } from "../models/index.js";

const router = express.Router();
const MAX_USERS_LIST_LIMIT = 200;
const FAST_AUTH_QUERY_RETRY_OPTIONS = {
  attempts: 1,
  timeoutMs: 3000,
};
const unsupportedPermissionColumns = new Set();
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const buildPermissionsPayload = (input = {}, { includeUpdatedAt = false } = {}) => {
  const normalized = normalizePermissions(input);
  const payload = {};

  for (const key of PERMISSION_KEYS) {
    if (!unsupportedPermissionColumns.has(key)) {
      payload[key] = normalized[key];
    }
  }

  if (includeUpdatedAt && !unsupportedPermissionColumns.has("updated_at")) {
    payload.updated_at = new Date().toISOString();
  }

  return payload;
};

const extractMissingColumnName = (error) => {
  const text = String(
    error?.message || error?.details || error?.hint || error?.error_description || "",
  );

  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column "([^"]+)" of relation/i,
    /column "([^"]+)" does not exist/i,
    /schema cache.*column[^']*'([^']+)'/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
};

const executePermissionsMutation = async ({
  userId,
  payload = {},
  operation = "update",
}) => {
  let nextPayload = { ...payload };

  while (true) {
    if (operation === "update" && Object.keys(nextPayload).length === 0) {
      return { data: null, error: null, skipped: true };
    }

    const query =
      operation === "insert"
        ? supabase.from("permissions").insert([
            {
              user_id: userId,
              ...nextPayload,
            },
          ])
        : supabase.from("permissions").update(nextPayload).eq("user_id", userId);

    const { data, error } = await query;

    if (!error) {
      return { data, error: null, skipped: false };
    }

    const missingColumn = extractMissingColumnName(error);
    if (
      missingColumn &&
      Object.prototype.hasOwnProperty.call(nextPayload, missingColumn)
    ) {
      unsupportedPermissionColumns.add(missingColumn);
      delete nextPayload[missingColumn];
      continue;
    }

    throw error;
  }
};

const parseListLimit = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(MAX_USERS_LIST_LIMIT, parsed);
};

const parseListOffset = (value) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
};

const shouldIncludeCount = (value) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const shouldUseCompactSelect = (value) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const shouldIncludeRelatedStores = (value) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const getStoreFallbackName = (storeId) =>
  `Store ${String(storeId || "").trim().slice(0, 8)}`;

const rememberDiscoveredStore = (storesMap, storeId, preferredName = "") => {
  const normalizedId = String(storeId || "").trim();
  if (!normalizedId) {
    return;
  }

  const normalizedName = String(preferredName || "").trim();
  const nextStore = {
    id: normalizedId,
    name: normalizedName || getStoreFallbackName(normalizedId),
  };
  const existingStore = storesMap.get(normalizedId);

  if (!existingStore) {
    storesMap.set(normalizedId, nextStore);
    return;
  }

  const existingUsesFallbackName =
    existingStore.name === getStoreFallbackName(normalizedId);

  if (normalizedName && existingUsesFallbackName) {
    storesMap.set(normalizedId, nextStore);
  }
};

const listAccessibleStoresForUser = async (userId, normalizedRole = "user") => {
  if (normalizedRole === "admin") {
    const adminStores = await getAdminVisibleStores();
    if (adminStores.length > 0) {
      return adminStores;
    }
  }

  const accessibleStoreIds = await getAccessibleStoreIds(userId);
  if (!Array.isArray(accessibleStoreIds) || accessibleStoreIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .in("id", accessibleStoreIds)
    .order("name", { ascending: true });

  if (!error && Array.isArray(data) && data.length > 0) {
    return data;
  }

  if (error) {
    console.error("Error fetching accessible stores:", error);
  }

  return accessibleStoreIds.map((storeId) => ({
    id: storeId,
    name: `Store ${String(storeId).slice(0, 8)}`,
  }));
};

export const getAdminVisibleStores = async () => {
  const discoveredStores = new Map();

  try {
    const { data, error } = await supabase
      .from("stores")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error fetching admin stores:", error);
    } else {
      (data || []).forEach((store) =>
        rememberDiscoveredStore(discoveredStores, store?.id, store?.name),
      );
    }
  } catch (error) {
    console.error("Admin stores lookup failed:", error);
  }

  try {
    const { data, error } = await supabase
      .from("shopify_tokens")
      .select("store_id, shop")
      .not("store_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Error inferring admin stores from Shopify tokens:", error);
    } else {
      (data || []).forEach((token) =>
        rememberDiscoveredStore(
          discoveredStores,
          token?.store_id,
          token?.shop,
        ),
      );
    }
  } catch (error) {
    console.error("Admin token-based store lookup failed:", error);
  }

  try {
    const inferredResults = await Promise.all([
      supabase
        .from("products")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(200),
      supabase
        .from("orders")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(200),
      supabase
        .from("customers")
        .select("store_id")
        .not("store_id", "is", null)
        .limit(200),
    ]);

    inferredResults.forEach((result) => {
      if (result?.error) {
        throw result.error;
      }

      (result?.data || []).forEach((row) =>
        rememberDiscoveredStore(discoveredStores, row?.store_id),
      );
    });
  } catch (error) {
    console.error("Admin data-based store inference failed:", error);
  }

  return Array.from(discoveredStores.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
};

// Get all users (Admin only)
router.get(
  "/",
  authenticateToken,
  requirePermission("can_manage_users"),
  async (req, res) => {
    try {
      const limit = parseListLimit(req.query.limit);
      const offset = parseListOffset(req.query.offset);
      const includeCount = shouldIncludeCount(req.query.include_count);
      const compact = shouldUseCompactSelect(req.query.compact);
      const selectClause = compact
        ? `
        id,
        email,
        name,
        role,
        is_active,
        created_at
      `
        : `
        id,
        email,
        name,
        role,
        is_active,
        created_at,
        permissions (*)
      `;

      let query = supabase
        .from("users")
        .select(selectClause, includeCount ? { count: "exact" } : undefined)
        .order("created_at", { ascending: false });

      if (limit !== null) {
        query = query.range(offset, offset + limit - 1);
      }

      const { data: users, error, count } = await query;

      if (error) throw error;

      if (includeCount) {
        return res.json({
          data: users || [],
          total: Number.isFinite(count) ? count : (users || []).length,
          limit,
          offset,
        });
      }

      res.json(users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Create new user (Admin only)
router.post(
  "/create",
  authenticateToken,
  requirePermission("can_manage_users"),
  async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const name = String(req.body?.name || "").trim();
      const { role, permissions } = req.body;

      if (!email || !password || !name) {
        return res
          .status(400)
          .json({ error: "Email, password, and name are required" });
      }

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .ilike("email", email)
        .maybeSingle();

      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert([
          {
            email,
            password: hashedPassword,
            name,
            role: normalizeRole(role || "user"),
            created_by: req.user.id,
            is_active: true,
          },
        ])
        .select()
        .single();

      if (userError) throw userError;

      // Create permissions
      const normalizedPermissions = buildPermissionsPayload(permissions);
      const { error: permError } = await executePermissionsMutation({
        userId: newUser.id,
        payload: normalizedPermissions,
        operation: "insert",
      });

      if (permError) throw permError;

      res.json({
        success: true,
        message: "User created successfully",
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
        },
      });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Update user permissions and role (Admin only)
router.put(
  "/:userId",
  authenticateToken,
  requirePermission("can_manage_users"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { permissions, role } = req.body; // Include role

      // Update user role if provided
      if (role) {
        const { error: roleError } = await supabase
          .from("users")
          .update({ role: normalizeRole(role) })
          .eq("id", userId);
        if (roleError) throw roleError;
      }

      // Update permissions
      if (permissions) {
        const normalizedPermissions = buildPermissionsPayload(permissions, {
          includeUpdatedAt: true,
        });
        // Check if permissions exist
        const { data: existing, error: existingError } = await supabase
          .from("permissions")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existingError && existingError.code !== "PGRST116") {
          throw existingError;
        }

        if (existing) {
          // Update existing permissions
          const { error } = await executePermissionsMutation({
            userId,
            payload: normalizedPermissions,
            operation: "update",
          });

          if (error) throw error;
        } else {
          // Create new permissions if they don't exist
          const { error } = await executePermissionsMutation({
            userId,
            payload: normalizedPermissions,
            operation: "insert",
          });

          if (error) throw error;
        }
      }

      clearUserAccessContextCache(userId);

      res.json({ success: true, message: "User updated successfully" });
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Delete user (Admin only)
router.delete(
  "/:userId",
  authenticateToken,
  requirePermission("can_manage_users"),
  async (req, res) => {
    try {
      const { userId } = req.params;

      // Prevent deleting yourself
      if (userId === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot delete your own account" });
      }

      // Check if user is admin
      const { data: user } = await supabase
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();

      if (user && user.role === "admin") {
        return res.status(400).json({ error: "Cannot delete admin users" });
      }

      // Delete user (permissions will be deleted automatically due to CASCADE)
      const { error } = await supabase.from("users").delete().eq("id", userId);

      if (error) throw error;

      res.json({ success: true, message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Get current user's stores
router.get("/me/stores", authenticateToken, async (req, res) => {
  try {
    const normalizedRole = String(req.user?.role || "").toLowerCase();
    return res.json(
      await listAccessibleStoresForUser(req.user.id, normalizedRole),
    );
  } catch (error) {
    console.error("Error fetching user stores:", error);
    res.status(500).json({ error: error.message });
  }
});

// Get current user info (no admin required) - MUST be before /:userId
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const includeStores = shouldIncludeRelatedStores(req.query.include_stores);
    const { data: user, error } = await withSupabaseRetry(({ signal } = {}) =>
      supabase
        .from("users")
        .select("id, email, name, role, is_active, created_at")
        .eq("id", req.user.id)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
      FAST_AUTH_QUERY_RETRY_OPTIONS,
    );

    if (error && isTransientSupabaseError(error)) {
      const degradedResponse = {
        id: req.user.id,
        email: req.user.email,
        name: null,
        role: normalizeRole(req.user.role),
        is_active: true,
        created_at: null,
        permissions: buildPermissionsForRole(req.user.role),
        degraded: true,
      };

      primeUserAccessContext(req.user.id, {
        role: degradedResponse.role,
        permissions: degradedResponse.permissions,
      });

      return res.json(degradedResponse);
    }

    if (error) throw error;

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let normalizedPermissions = { ...DEFAULT_PERMISSIONS };
    const normalizedUserRole = normalizeRole(user.role);

    if (normalizedUserRole === "admin") {
      normalizedPermissions = buildPermissionsForRole(normalizedUserRole);
    } else {
      const { data: permissionsData, error: permissionsError } =
        await withSupabaseRetry(({ signal } = {}) =>
          supabase
            .from("permissions")
            .select("*")
            .eq("user_id", req.user.id)
            .limit(1)
            .abortSignal(signal)
            .maybeSingle(),
          FAST_AUTH_QUERY_RETRY_OPTIONS,
        );

      if (permissionsError && isTransientSupabaseError(permissionsError)) {
        normalizedPermissions = buildPermissionsForRole(normalizedUserRole);
      } else {
        if (permissionsError && permissionsError.code !== "PGRST116") {
          throw permissionsError;
        }

        normalizedPermissions = normalizePermissions(permissionsData);
      }
    }

    const responsePayload = {
      ...user,
      role: normalizedUserRole,
      permissions: normalizedPermissions,
    };

    if (includeStores) {
      try {
        responsePayload.stores = await listAccessibleStoresForUser(
          req.user.id,
          normalizedUserRole,
        );
      } catch (storesError) {
        console.error(
          "Error embedding user stores in /me response:",
          storesError,
        );
        responsePayload.stores = [];
      }
    }

    primeUserAccessContext(req.user.id, {
      role: normalizedUserRole,
      permissions: normalizedPermissions,
    });

    res.json(responsePayload);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? "User profile is temporarily unavailable"
        : error.message,
    });
  }
});

// Get current user permissions - MUST be before /:userId
router.get("/me/permissions", authenticateToken, async (req, res) => {
  try {
    const { data: userData, error: userError } = await withSupabaseRetry(({ signal } = {}) =>
      supabase
        .from("users")
        .select("role")
        .eq("id", req.user.id)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
      FAST_AUTH_QUERY_RETRY_OPTIONS,
    );

    if (userError && isTransientSupabaseError(userError)) {
      const fallbackPermissions = buildPermissionsForRole(req.user.role);
      primeUserAccessContext(req.user.id, {
        role: normalizeRole(req.user.role),
        permissions: fallbackPermissions,
      });
      return res.json(fallbackPermissions);
    }

    if (userError && userError.code !== "PGRST116") {
      throw userError;
    }

    if (normalizeRole(userData?.role) === "admin") {
      const adminPermissions = buildPermissionsForRole("admin");
      primeUserAccessContext(req.user.id, {
        role: "admin",
        permissions: adminPermissions,
      });
      return res.json(adminPermissions);
    }

    const { data, error } = await withSupabaseRetry(({ signal } = {}) =>
      supabase
        .from("permissions")
        .select("*")
        .eq("user_id", req.user.id)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
      FAST_AUTH_QUERY_RETRY_OPTIONS,
    );

    if (error && isTransientSupabaseError(error)) {
      const fallbackPermissions = buildPermissionsForRole(req.user.role);
      primeUserAccessContext(req.user.id, {
        role: normalizeRole(req.user.role),
        permissions: fallbackPermissions,
      });
      return res.json(fallbackPermissions);
    }

    if (error && error.code !== "PGRST116") throw error;

    const normalizedPermissions = normalizePermissions(data);
    primeUserAccessContext(req.user.id, {
      role: normalizeRole(userData?.role || req.user.role),
      permissions: normalizedPermissions,
    });

    res.json(normalizedPermissions);
  } catch (error) {
    console.error("Error fetching permissions:", error);
    res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? "User permissions are temporarily unavailable"
        : error.message,
    });
  }
});

// Get single user by ID (Admin only)
router.get(
  "/:userId",
  authenticateToken,
  requirePermission("can_manage_users"),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const { data: user, error } = await supabase
        .from("users")
        .select(
          `
        id,
        email,
        name,
        role,
        is_active,
        created_at,
        permissions (*),
        shopify_credentials (*)
      `,
        )
        .eq("id", userId)
        .single();

      if (error) throw error;

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
