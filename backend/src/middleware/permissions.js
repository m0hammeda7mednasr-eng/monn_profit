import { supabase } from "../supabaseClient.js";
import {
  isTransientSupabaseError,
  withSupabaseRetry,
} from "../helpers/supabaseRetry.js";

export const PERMISSION_KEYS = [
  "can_view_dashboard",
  "can_view_products",
  "can_edit_products",
  "can_view_warehouse",
  "can_edit_warehouse",
  "can_view_suppliers",
  "can_edit_suppliers",
  "can_view_orders",
  "can_edit_orders",
  "can_view_customers",
  "can_edit_customers",
  "can_manage_users",
  "can_manage_settings",
  "can_view_profits",
  "can_manage_tasks",
  "can_view_all_reports",
  "can_view_activity_log",
  "can_print_barcode_labels",
];

export const DEFAULT_PERMISSIONS = {
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

const PERMISSION_FALLBACK_KEYS = {
  can_view_warehouse: ["can_view_products"],
  can_edit_warehouse: ["can_edit_products"],
};

const applyPermissionDependencies = (permissions = {}) => {
  const normalized = {
    ...permissions,
  };

  if (normalized.can_edit_orders) {
    normalized.can_view_orders = true;
  }

  if (normalized.can_edit_warehouse) {
    normalized.can_view_warehouse = true;
    normalized.can_print_barcode_labels = true;
  }

  if (!normalized.can_view_orders) {
    normalized.can_edit_orders = false;
  }

  if (!normalized.can_view_warehouse) {
    normalized.can_edit_warehouse = false;
  }

  return normalized;
};

const USER_ACCESS_CACHE_TTL_MS = 60 * 1000;
const userAccessCache = new Map();

const getUserAccessCacheKey = (userId) => String(userId || "").trim();

const getCachedUserAccessContext = (userId) => {
  const cacheKey = getUserAccessCacheKey(userId);
  if (!cacheKey) {
    return null;
  }

  const cachedEntry = userAccessCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.updatedAt > USER_ACCESS_CACHE_TTL_MS) {
    userAccessCache.delete(cacheKey);
    return null;
  }

  return cachedEntry.value;
};

export const peekUserAccessContext = (userId) =>
  getCachedUserAccessContext(userId);

const rememberUserAccessContext = (userId, nextValue = {}) => {
  const cacheKey = getUserAccessCacheKey(userId);
  if (!cacheKey) {
    return null;
  }

  const previousValue = getCachedUserAccessContext(cacheKey) || {};
  const value = {
    ...previousValue,
    ...nextValue,
  };

  userAccessCache.set(cacheKey, {
    value,
    updatedAt: Date.now(),
  });

  return value;
};

export const primeUserAccessContext = (userId, nextValue = {}) =>
  rememberUserAccessContext(userId, nextValue);

export const clearUserAccessContextCache = (userId = null) => {
  const cacheKey = getUserAccessCacheKey(userId);
  if (cacheKey) {
    userAccessCache.delete(cacheKey);
    return;
  }

  userAccessCache.clear();
};

export const normalizePermissions = (permissionsRow = null) => {
  const normalized = { ...DEFAULT_PERMISSIONS };

  if (!permissionsRow) {
    return applyPermissionDependencies(normalized);
  }

  for (const key of PERMISSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(permissionsRow, key)) {
      normalized[key] = Boolean(permissionsRow[key]);
      continue;
    }

    const fallbackKeys = PERMISSION_FALLBACK_KEYS[key] || [];
    const fallbackKey = fallbackKeys.find((candidateKey) =>
      Object.prototype.hasOwnProperty.call(permissionsRow, candidateKey),
    );

    if (fallbackKey) {
      normalized[key] = Boolean(permissionsRow[fallbackKey]);
    }
  }

  return applyPermissionDependencies(normalized);
};

export const buildPermissionsForRole = (role, permissionsRow = null) => {
  const normalizedRole = normalizeRole(role);
  const normalizedPermissions = normalizePermissions(permissionsRow);

  if (normalizedRole !== "admin") {
    return normalizedPermissions;
  }

  for (const key of PERMISSION_KEYS) {
    normalizedPermissions[key] = true;
  }

  return normalizedPermissions;
};

export const normalizeRole = (role) => {
  if (typeof role !== "string") {
    return "user";
  }

  const normalized = role.trim().toLowerCase();
  if (normalized === "admin") {
    return "admin";
  }

  return "user";
};

export const getUserRole = async (
  userId,
  { retryOptions = undefined, useCache = true } = {},
) => {
  if (!userId) {
    return null;
  }

  if (useCache) {
    const cachedContext = getCachedUserAccessContext(userId);
    if (cachedContext?.role) {
      return cachedContext.role;
    }
  }

  const { data: user, error } = await withSupabaseRetry(
    ({ signal } = {}) =>
      supabase
        .from("users")
        .select("role")
        .eq("id", userId)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
    retryOptions,
  );

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!user?.role) {
    return null;
  }

  const normalizedRole = normalizeRole(user.role);
  rememberUserAccessContext(userId, { role: normalizedRole });
  return normalizedRole;
};

export const getUserPermissions = async (
  userId,
  { retryOptions = undefined, useCache = true } = {},
) => {
  if (!userId) {
    return { ...DEFAULT_PERMISSIONS };
  }

  if (useCache) {
    const cachedContext = getCachedUserAccessContext(userId);
    if (cachedContext?.permissions) {
      return cachedContext.permissions;
    }
  }

  const { data: permissions, error } = await withSupabaseRetry(
    ({ signal } = {}) =>
      supabase
        .from("permissions")
        .select("*")
        .eq("user_id", userId)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
    retryOptions,
  );

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  const normalizedPermissions = normalizePermissions(permissions);
  rememberUserAccessContext(userId, { permissions: normalizedPermissions });
  return normalizedPermissions;
};

const getPermissionFallbackContext = (userId, role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "admin") {
    return buildPermissionsForRole("admin");
  }

  return getCachedUserAccessContext(userId)?.permissions || null;
};

export const requireAdminRole = async (req, res, next) => {
  try {
    const role = normalizeRole(
      req.user?.role || (await getUserRole(req.user?.id)),
    );

    if (role !== "admin") {
      return res.status(403).json({
        error: "Access denied: admin access required",
      });
    }

    req.user.role = "admin";
    req.user.isAdmin = true;
    next();
  } catch (error) {
    console.error("Admin role check error:", error);
    res.status(isTransientSupabaseError(error) ? 503 : 500).json({
      error: isTransientSupabaseError(error)
        ? "User role validation is temporarily unavailable"
        : "Failed to validate user role",
    });
  }
};

export const requirePermission = (permissionName) => {
  return async (req, res, next) => {
    try {
      const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(
        String(req.method || "").toUpperCase(),
      );
      const retryOptions = isSafeMethod
        ? { attempts: 1, timeoutMs: 2500 }
        : { attempts: 2, baseDelayMs: 150, timeoutMs: 5000 };
      const role = normalizeRole(
        req.user?.role ||
          (await getUserRole(req.user?.id, {
            retryOptions,
          })),
      );

      if (role === "admin") {
        const adminPermissions = buildPermissionsForRole("admin");
        req.user.role = "admin";
        req.user.isAdmin = true;
        req.user.permissions = adminPermissions;
        primeUserAccessContext(req.user?.id, {
          role: "admin",
          permissions: adminPermissions,
        });
        return next();
      }

      if (isSafeMethod && req.authFallback?.source === "token-role") {
        const fallbackPermissions = getPermissionFallbackContext(
          req.user?.id,
          role || "user",
        );
        if (fallbackPermissions?.[permissionName]) {
          req.user.role = role || "user";
          req.user.isAdmin = normalizeRole(role) === "admin";
          req.user.permissions = fallbackPermissions;
          req.permissionFallback = {
            source: "token-role",
          };
          return next();
        }
      }

      const permissions = await getUserPermissions(req.user?.id, {
        retryOptions,
      });

      if (!permissions[permissionName]) {
        return res.status(403).json({
          error: "Access denied: insufficient permissions",
        });
      }

      req.user.role = role || "user";
      req.user.isAdmin = false;
      req.user.permissions = permissions;
      primeUserAccessContext(req.user?.id, {
        role: role || "user",
        permissions,
      });
      next();
    } catch (error) {
      console.error("Permission check error:", error);
      if (isSafeMethod && isTransientSupabaseError(error) && req.user?.role) {
        const fallbackPermissions = getPermissionFallbackContext(
          req.user?.id,
          req.user.role,
        );
        if (fallbackPermissions?.[permissionName]) {
          req.user.permissions = fallbackPermissions;
          req.permissionFallback = {
            source: "token-role",
          };
          return next();
        }
      }

      res.status(isTransientSupabaseError(error) ? 503 : 500).json({
        error: isTransientSupabaseError(error)
          ? "Permission validation is temporarily unavailable"
          : "Failed to validate permissions",
      });
    }
  };
};

export const requireAnyPermission = (permissionNames) => {
  return async (req, res, next) => {
    try {
      const isSafeMethod = ["GET", "HEAD", "OPTIONS"].includes(
        String(req.method || "").toUpperCase(),
      );
      const retryOptions = isSafeMethod
        ? { attempts: 1, timeoutMs: 2500 }
        : { attempts: 2, baseDelayMs: 150, timeoutMs: 5000 };
      const role = normalizeRole(
        req.user?.role ||
          (await getUserRole(req.user?.id, {
            retryOptions,
          })),
      );

      if (role === "admin") {
        const adminPermissions = buildPermissionsForRole("admin");
        req.user.role = "admin";
        req.user.isAdmin = true;
        req.user.permissions = adminPermissions;
        primeUserAccessContext(req.user?.id, {
          role: "admin",
          permissions: adminPermissions,
        });
        return next();
      }

      if (isSafeMethod && req.authFallback?.source === "token-role") {
        const fallbackPermissions = getPermissionFallbackContext(
          req.user?.id,
          role || "user",
        );
        const hasAnyPermission = permissionNames.some(
          (permissionName) => fallbackPermissions?.[permissionName],
        );
        if (hasAnyPermission) {
          req.user.role = role || "user";
          req.user.isAdmin = normalizeRole(role) === "admin";
          req.user.permissions = fallbackPermissions;
          req.permissionFallback = {
            source: "token-role",
          };
          return next();
        }
      }

      const permissions = await getUserPermissions(req.user?.id, {
        retryOptions,
      });

      const hasAnyPermission = permissionNames.some(
        (permissionName) => permissions[permissionName],
      );
      if (!hasAnyPermission) {
        return res.status(403).json({
          error: "Access denied: insufficient permissions",
        });
      }

      req.user.role = role || "user";
      req.user.isAdmin = false;
      req.user.permissions = permissions;
      primeUserAccessContext(req.user?.id, {
        role: role || "user",
        permissions,
      });
      next();
    } catch (error) {
      console.error("Permission check error:", error);
      if (isSafeMethod && isTransientSupabaseError(error) && req.user?.role) {
        const fallbackPermissions = getPermissionFallbackContext(
          req.user?.id,
          req.user.role,
        );
        const hasAnyPermission = permissionNames.some(
          (permissionName) => fallbackPermissions?.[permissionName],
        );
        if (hasAnyPermission) {
          req.user.permissions = fallbackPermissions;
          req.permissionFallback = {
            source: "token-role",
          };
          return next();
        }
      }

      res.status(isTransientSupabaseError(error) ? 503 : 500).json({
        error: isTransientSupabaseError(error)
          ? "Permission validation is temporarily unavailable"
          : "Failed to validate permissions",
      });
    }
  };
};

// Backward compatible aliases
export const checkPermission = requirePermission;
export const isAdmin = requireAdminRole;
