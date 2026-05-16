import React, {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  useRef,
} from "react";
import api from "../utils/api";
import { shouldAutoRefreshView } from "../utils/refreshPolicy";
import {
  DEFAULT_CLIENT_PERMISSIONS,
  normalizeClientPermissions,
} from "../utils/permissionState";

const AuthContext = createContext(null);
const AUTH_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MIN_AUTH_REFRESH_GAP_MS = 5000;
const STORE_ID_UPDATED_EVENT = "moon-profit:store-id-updated";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readJsonFromStorage = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const normalizeStoreId = (value) => {
  const normalized = String(value || "").trim();
  return UUID_REGEX.test(normalized) ? normalized : "";
};

const emitStoreIdUpdated = () => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(STORE_ID_UPDATED_EVENT));
};

const syncCurrentStoreId = (stores = []) => {
  const accessibleStoreIds = (Array.isArray(stores) ? stores : [])
    .map((store) => normalizeStoreId(store?.id))
    .filter(Boolean);

  const currentStoreId = normalizeStoreId(
    localStorage.getItem("currentStoreId"),
  );

  if (accessibleStoreIds.length === 0) {
    localStorage.removeItem("currentStoreId");
    emitStoreIdUpdated();
    return null;
  }

  if (currentStoreId && accessibleStoreIds.includes(currentStoreId)) {
    localStorage.setItem("currentStoreId", currentStoreId);
    emitStoreIdUpdated();
    return currentStoreId;
  }

  const nextStoreId = accessibleStoreIds[0];
  localStorage.setItem("currentStoreId", nextStoreId);
  emitStoreIdUpdated();
  return nextStoreId;
};

const buildCachedPermissions = (cachedUser, cachedPermissions) => {
  if (cachedUser?.role === "admin") {
    return Object.keys(DEFAULT_CLIENT_PERMISSIONS).reduce((acc, key) => {
      acc[key] = true;
      return acc;
    }, {});
  }

  return normalizeClientPermissions(cachedPermissions);
};

export const AuthProvider = ({ children }) => {
  const initialCachedUser = useRef(readJsonFromStorage("user")).current;
  const [user, setUser] = useState(initialCachedUser);
  const [permissions, setPermissions] = useState(() =>
    buildCachedPermissions(initialCachedUser, readJsonFromStorage("permissions")),
  );
  const [loading, setLoading] = useState(!initialCachedUser);
  const [isAdmin, setIsAdmin] = useState(initialCachedUser?.role === "admin");

  const authRefreshInFlight = useRef(false);
  const lastAuthRefreshAt = useRef(0);

  const resetAuthState = useCallback(() => {
    localStorage.removeItem("user");
    localStorage.removeItem("permissions");
    localStorage.removeItem("currentStoreId");
    emitStoreIdUpdated();
    setUser(null);
    setPermissions({});
    setIsAdmin(false);
  }, []);

  const applyAuthState = useCallback((nextUser, nextPermissions) => {
    const normalizedPermissions =
      nextUser?.role === "admin"
        ? Object.keys(DEFAULT_CLIENT_PERMISSIONS).reduce((acc, key) => {
            acc[key] = true;
            return acc;
          }, {})
        : normalizeClientPermissions(nextPermissions);

    localStorage.setItem("user", JSON.stringify(nextUser));
    localStorage.setItem("permissions", JSON.stringify(normalizedPermissions));
    setUser(nextUser);
    setPermissions(normalizedPermissions);
    setIsAdmin(nextUser?.role === "admin");
  }, []);

  const loadAuthState = useCallback(
    async ({ silent = false, force = false } = {}) => {
      if (authRefreshInFlight.current) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastAuthRefreshAt.current < MIN_AUTH_REFRESH_GAP_MS) {
        return;
      }

      const token = localStorage.getItem("token");

      if (!token) {
        resetAuthState();
        if (!silent) {
          setLoading(false);
        }
        return;
      }

      try {
        authRefreshInFlight.current = true;
        lastAuthRefreshAt.current = now;

        const { data: userData } = await api.get("/users/me", {
          params: {
            include_stores: true,
          },
        });

        let perms = userData?.permissions;
        if (!perms) {
          const permissionsResponse = await api.get("/users/me/permissions");
          perms = permissionsResponse.data;
        }

        const resolvedRole = String(userData?.role || "user").toLowerCase();
        const nextUser = {
          id: userData.id,
          email: userData.email,
          name: userData.name,
          role: resolvedRole,
        };

        applyAuthState(
          nextUser,
          perms ||
            buildCachedPermissions(
              nextUser,
              readJsonFromStorage("permissions"),
            ),
        );

        try {
          if (userData?.degraded) {
            return;
          }

          if (Array.isArray(userData?.stores)) {
            syncCurrentStoreId(userData.stores);
          } else {
            const storesResponse = await api.get("/users/me/stores");
            syncCurrentStoreId(storesResponse?.data);
          }
        } catch (storesError) {
          console.error("Failed to sync current store", storesError);
        }
      } catch (error) {
        console.error("Failed to refresh auth state", error);

        if (error.response?.status === 401) {
          localStorage.removeItem("token");
          resetAuthState();

          if (window.location.pathname !== "/login") {
            window.location.href = "/login";
          }
        } else {
          const fallbackUser = readJsonFromStorage("user");
          if (fallbackUser) {
            applyAuthState(
              fallbackUser,
              buildCachedPermissions(
                fallbackUser,
                readJsonFromStorage("permissions"),
              ),
            );
          }
        }
      } finally {
        authRefreshInFlight.current = false;
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [applyAuthState, resetAuthState],
  );

  useEffect(() => {
    loadAuthState({ silent: Boolean(initialCachedUser) });

    if (!shouldAutoRefreshView()) {
      return undefined;
    }

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      loadAuthState({ silent: true });
    }, AUTH_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [initialCachedUser, loadAuthState]);

  const logout = () => {
    localStorage.removeItem("token");
    resetAuthState();
    window.location.href = "/login";
  };

  const hasPermission = (permissionName) => {
    if (isAdmin) return true;
    return Boolean(permissions[permissionName]);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        permissions,
        isAdmin,
        loading,
        logout,
        hasPermission,
        refreshAuth: () => loadAuthState({ silent: true, force: true }),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
