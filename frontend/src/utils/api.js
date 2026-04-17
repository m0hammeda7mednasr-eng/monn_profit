import axios from "axios";
import { markSharedDataUpdated } from "./realtime";
import { resolveApiBase } from "./apiConfig";

const API_BASE = resolveApiBase();
const DEFAULT_API_TIMEOUT_MS = 60 * 1000;
const ORDER_REPORT_TIMEOUT_MS = 2 * 60 * 1000;
const SHOPIFY_SYNC_TIMEOUT_MS = 10 * 60 * 1000;
const META_SYNC_TIMEOUT_MS = 3 * 60 * 1000;
const META_ANALYSIS_TIMEOUT_MS = 2 * 60 * 1000;
const META_CHAT_TIMEOUT_MS = 2 * 60 * 1000;
const SLOW_API_REQUEST_THRESHOLD_MS = 1500;
const isDevelopment = process.env.NODE_ENV !== "production";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const api = axios.create({
  baseURL: API_BASE,
  timeout: DEFAULT_API_TIMEOUT_MS,
  headers: {
    "Content-Type": "application/json",
  },
});

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

const getNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const parseMilliseconds = (value) => {
  const normalized = String(value || "")
    .trim()
    .replace(/ms$/i, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildRequestPerformance = (config = {}, headers = {}) => {
  const startedAt = Number(config?.metadata?.startedAt);
  const clientDurationMs =
    Number.isFinite(startedAt) && startedAt > 0
      ? Number.parseFloat((getNow() - startedAt).toFixed(2))
      : null;

  return {
    clientDurationMs,
    serverDurationMs: parseMilliseconds(headers?.["x-response-time"]),
    serverTiming: String(headers?.["server-timing"] || "").trim(),
    requestId: String(headers?.["x-request-id"] || "").trim(),
  };
};

const logSlowRequest = (config, status, performanceMeta, isError = false) => {
  if (!isDevelopment) {
    return;
  }

  const durationMs = Number(performanceMeta?.clientDurationMs);
  if (!Number.isFinite(durationMs) || durationMs < SLOW_API_REQUEST_THRESHOLD_MS) {
    return;
  }

  const payload = {
    method: String(config?.method || "get").toUpperCase(),
    url: String(config?.url || ""),
    status: Number(status || 0),
    clientDurationMs: durationMs,
    serverDurationMs: performanceMeta?.serverDurationMs,
    requestId: performanceMeta?.requestId || "",
    serverTiming: performanceMeta?.serverTiming || "",
  };

  if (isError) {
    console.warn("[api][slow][error]", payload);
    return;
  }

  console.info("[api][slow]", payload);
};

const shouldBroadcastMutation = (response) => {
  const method = String(response?.config?.method || "").toLowerCase();
  const requestUrl = String(response?.config?.url || "");

  if (!MUTATION_METHODS.has(method)) {
    return false;
  }

  if (
    requestUrl.includes("/auth/login") ||
    requestUrl.includes("/auth/register") ||
    requestUrl.includes("/auth/verify")
  ) {
    return false;
  }

  if (requestUrl.includes("/notifications")) {
    return false;
  }

  return true;
};

// Add token to requests
api.interceptors.request.use((config) => {
  config.metadata = {
    ...(config.metadata || {}),
    startedAt: getNow(),
  };

  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const storeId = localStorage.getItem("currentStoreId");
  if (storeId && UUID_REGEX.test(storeId)) {
    config.headers["x-store-id"] = storeId;
  } else if (storeId) {
    localStorage.removeItem("currentStoreId");
  }

  return config;
});

// Handle errors
api.interceptors.response.use(
  (response) => {
    response.performance = buildRequestPerformance(
      response.config,
      response.headers,
    );
    logSlowRequest(
      response.config,
      response.status,
      response.performance,
      false,
    );

    if (shouldBroadcastMutation(response)) {
      markSharedDataUpdated({
        source: String(response?.config?.url || ""),
        method: String(response?.config?.method || "").toUpperCase(),
      });
    }

    return response;
  },
  (error) => {
    error.performance = buildRequestPerformance(
      error.config,
      error.response?.headers || {},
    );
    logSlowRequest(
      error.config,
      error.response?.status,
      error.performance,
      true,
    );

    const status = error.response?.status;
    const backendError = error.response?.data?.error;
    const requestUrl = String(error.config?.url || "");
    const isAuthEndpoint =
      requestUrl.includes("/auth/login") ||
      requestUrl.includes("/auth/register") ||
      requestUrl.includes("/auth/verify");

    const authErrorsThatRequireLogout = new Set([
      "No token provided",
      "Invalid token",
      "Token expired",
      "Token verification failed",
      "Invalid token payload",
    ]);

    const shouldForceLogout =
      status === 401 &&
      !isAuthEndpoint &&
      authErrorsThatRequireLogout.has(String(backendError || ""));

    if (shouldForceLogout) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    } else if (status === 401) {
      error.userMessage = backendError || "Request is unauthorized";
    } else if (status === 403) {
      // Forbidden - add user-friendly error message
      error.userMessage = "Access denied: insufficient permissions";
    }
    return Promise.reject(error);
  },
);

export const authAPI = {
  register: (data) => api.post("/auth/register", data),
  login: (data) => api.post("/auth/login", data),
  verify: () => api.post("/auth/verify", {}),
};

// Utility function to extract user-friendly error messages
export const getErrorMessage = (error) => {
  // Check if we added a user message in the interceptor
  if (error.userMessage) {
    return error.userMessage;
  }

  if (
    String(error?.code || "").toUpperCase() === "ECONNABORTED" ||
    String(error?.message || "").toLowerCase().includes("timeout")
  ) {
    return "The server took too long to respond. Please try again.";
  }

  // Check for specific error messages from the backend
  if (error.response?.data?.error) {
    return error.response.data.error;
  }

  // Default error messages based on status code
  switch (error.response?.status) {
    case 401:
      return "Authentication required. Please log in.";
    case 403:
      return "Access denied: insufficient permissions";
    case 404:
      return "Resource not found";
    case 500:
      return "Server error. Please try again later.";
    case 503:
      return "Service temporarily unavailable. Please try again in a moment.";
    default:
      return "An unexpected error occurred. Please try again.";
  }
};

export const dashboardAPI = {
  getStats: () => api.get("/dashboard/stats"),
  getAnalytics: (params = {}) => api.get("/dashboard/analytics", { params }),
  getGrowthCenter: (params = {}) => api.get("/dashboard/growth-center", { params }),
  getProducts: (limit, offset) =>
    api.get(`/dashboard/products?limit=${limit}&offset=${offset}`),
  getOrders: (limit, offset) =>
    api.get(`/dashboard/orders?limit=${limit}&offset=${offset}`),
  getCustomers: (limit, offset) =>
    api.get(`/dashboard/customers?limit=${limit}&offset=${offset}`),
};

export const shopifyAPI = {
  getProducts: () => api.get("/shopify/products"),
  getOrders: (params = {}) =>
    api.get("/shopify/orders", {
      params,
      timeout: ORDER_REPORT_TIMEOUT_MS,
    }),
  getOrderDetails: (id) =>
    api.get(`/shopify/orders/${id}/details`, {
      timeout: ORDER_REPORT_TIMEOUT_MS,
    }),
  getOrderProfit: (id) =>
    api.get(`/shopify/orders/${id}/profit`, {
      timeout: ORDER_REPORT_TIMEOUT_MS,
    }),
  getMissingOrders: (params = {}) =>
    api.get("/shopify/orders/missing", {
      params,
      timeout: ORDER_REPORT_TIMEOUT_MS,
    }),
  getShippingIssues: (params = {}) =>
    api.get("/shopify/orders/shipping-issues", {
      params,
      timeout: ORDER_REPORT_TIMEOUT_MS,
    }),
  getCustomers: () => api.get("/shopify/customers"),
  sync: () =>
    api.post("/shopify/sync", {}, { timeout: SHOPIFY_SYNC_TIMEOUT_MS }),
};

export const warehouseAPI = {
  getStock: (params = {}) => api.get("/warehouse/stock", { params }),
  getScans: (params = {}) => api.get("/warehouse/scans", { params }),
  scan: (data) => api.post("/warehouse/scan", data),
  syncToShopify: (data = {}) =>
    api.post("/warehouse/sync-to-shopify", data, {
      timeout: SHOPIFY_SYNC_TIMEOUT_MS,
    }),
};

export const productAnalysisAPI = {
  get: (params = {}) => api.get("/product-analysis", { params }),
};

export const suppliersAPI = {
  list: (params = {}) => api.get("/suppliers", { params }),
  getById: (id, params = {}) => api.get(`/suppliers/${id}`, { params }),
  create: (data) => api.post("/suppliers", data),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  getProductLinks: (id, params = {}) =>
    api.get(`/suppliers/${id}/product-links`, { params }),
  updateProductLinks: (id, data) =>
    api.put(`/suppliers/${id}/product-links`, data),
  addFabric: (id, data) => api.post(`/suppliers/${id}/fabrics`, data),
  updateFabric: (id, fabricId, data) =>
    api.put(`/suppliers/${id}/fabrics/${fabricId}`, data),
  addDelivery: (id, data) => api.post(`/suppliers/${id}/deliveries`, data),
  addPayment: (id, data) => api.post(`/suppliers/${id}/payments`, data),
};

export const metaAnalyticsAPI = {
  getStatus: () => api.get("/meta-analytics/status"),
  getOverview: (params = {}) => api.get("/meta-analytics/overview", { params }),
  saveMetaConfig: (data) => api.put("/meta-analytics/config/meta", data),
  saveOpenRouterConfig: (data) =>
    api.put("/meta-analytics/config/openrouter", data),
  getModels: (params = {}) => api.get("/meta-analytics/models", { params }),
  sync: (data = {}) =>
    api.post("/meta-analytics/sync", data, {
      timeout: META_SYNC_TIMEOUT_MS,
    }),
  analyze: (data = {}) =>
    api.post("/meta-analytics/analyze", data, {
      timeout: META_ANALYSIS_TIMEOUT_MS,
    }),
  chat: (data = {}) =>
    api.post("/meta-analytics/assistant/chat", data, {
      timeout: META_CHAT_TIMEOUT_MS,
    }),
};

export default api;
