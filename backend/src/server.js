import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import compression from "compression";
// import { createClient } from "@supabase/supabase-js"; // Not used directly here
import authRoutes from "./routes/auth.js";
import shopifyRoutes from "./routes/shopify.js";
import dashboardRoutes from "./routes/dashboard.js";
import usersRoutes from "./routes/users.js";
import reportsRoutes from "./routes/reports.js";
import dailyReportsRoutes from "./routes/dailyReports.js";
import accessRequestsRoutes from "./routes/accessRequests.js";
import tasksRoutes from "./routes/tasks.js";
import activityLogRoutes from "./routes/activityLog.js";
import operationalCostsRoutes from "./routes/operationalCosts.js";
import adminRoutes from "./routes/admin.js";
import adminFixRoutes from "./routes/admin-fix.js";
import orderCommentsRoutes from "./routes/orderComments.js";
import shopifyWebhooksRoutes from "./routes/shopifyWebhooks.js";
import eventsRoutes from "./routes/events.js";
import warehouseRoutes from "./routes/warehouse.js";
import suppliersRoutes from "./routes/suppliers.js";
import metaAnalyticsRoutes from "./routes/metaAnalytics.js";
import bostaRoutes from "./routes/bosta.js";
import productsExportRoutes from "./routes/productsExport.js";
import { supabase } from "./supabaseClient.js";
import { setRlsContext } from "./middleware/rls.js";
import { emitRealtimeEvent } from "./services/realtimeEventService.js";
import { startShopifyBackgroundSync } from "./services/shopifyBackgroundSyncService.js";
import { requestProfilingMiddleware } from "./helpers/requestProfiler.js";

const app = express();
const PORT = process.env.PORT || 5000;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const isDevelopment = process.env.NODE_ENV === "development";

const parseCsvEnv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const toBooleanEnvFlag = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

const ALLOW_VERCEL_APP_ORIGINS = toBooleanEnvFlag(
  process.env.ALLOW_VERCEL_APP_ORIGINS,
  true,
);

const ALLOWED_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "https://monn-profit.vercel.app",
  process.env.FRONTEND_URL,
  ...parseCsvEnv(process.env.FRONTEND_URLS),
].filter(Boolean);

const normalizeCorsOrigin = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");

const isVercelAppOrigin = (origin) => {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      (url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app"))
    );
  } catch {
    return false;
  }
};

const isAllowedCorsOrigin = (origin) => {
  const normalizedOrigin = normalizeCorsOrigin(origin);
  if (!normalizedOrigin) {
    return true;
  }

  if (ALLOW_VERCEL_APP_ORIGINS && isVercelAppOrigin(normalizedOrigin)) {
    return true;
  }

  return ALLOWED_CORS_ORIGINS.some((allowedOrigin) => {
    if (allowedOrigin instanceof RegExp) {
      return allowedOrigin.test(normalizedOrigin);
    }

    return normalizeCorsOrigin(allowedOrigin) === normalizedOrigin;
  });
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    // Return false instead of throwing error to avoid crashing OPTIONS requests
    callback(null, false);
  },
  credentials: true,
  exposedHeaders: ["X-Request-Id", "X-Response-Time", "Server-Timing"],
};

const shouldCompressResponse = (req, res) => {
  if (String(req.path || "").startsWith("/api/events/stream")) {
    return false;
  }

  return compression.filter(req, res);
};

// Middleware
app.use(cors(corsOptions));
app.use(
  compression({
    threshold: 1024,
    filter: shouldCompressResponse,
  }),
);
app.use(requestProfilingMiddleware);
app.use(
  "/api/shopify/webhooks",
  express.raw({ type: "application/json" }),
  shopifyWebhooksRoutes,
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Export supabase for any legacy imports, but it's now initialized elsewhere
export { supabase };

// Routes
app.use("/api/auth", authRoutes);

// Apply RLS middleware to all routes below this line
app.use(setRlsContext);

app.use((req, res, next) => {
  const requestPath = String(req.originalUrl || "").split("?")[0];
  const isTrackedMutation =
    MUTATION_METHODS.has(String(req.method || "").toUpperCase()) &&
    requestPath.startsWith("/api/") &&
    !requestPath.startsWith("/api/auth");

  if (!isTrackedMutation) {
    next();
    return;
  }

  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return;
    }

    const userId = String(req.user?.id || "").trim();
    if (!userId) {
      return;
    }

    const storeId =
      typeof req.headers["x-store-id"] === "string"
        ? req.headers["x-store-id"].trim()
        : "";

    emitRealtimeEvent({
      type: "data.updated",
      source: requestPath,
      userIds: [userId],
      storeIds: storeId ? [storeId] : [],
      payload: {
        method: String(req.method || "").toUpperCase(),
      },
    });
  });

  next();
});

app.use("/api/shopify", shopifyRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/daily-reports", dailyReportsRoutes);
app.use("/api/access-requests", accessRequestsRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/activity-log", activityLogRoutes);
app.use("/api/operational-costs", operationalCostsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin-fix", adminFixRoutes);
app.use("/api/order-comments", orderCommentsRoutes);
app.use("/api/warehouse", warehouseRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/meta-analytics", metaAnalyticsRoutes);
app.use("/api/bosta", bostaRoutes);
app.use("/api/products", productsExportRoutes);

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Internal server error",
    ...(isDevelopment ? { message: err.message } : {}),
  });
});

app.listen(PORT, () => {
  startShopifyBackgroundSync();
  console.log(`Server running on port ${PORT}`);
});
