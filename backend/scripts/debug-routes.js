import express from "express";
import dashboardRoutes from "./src/routes/dashboard.js";

const app = express();

// Add debugging middleware
app.use("/api/dashboard", (req, res, next) => {
  console.log(`🔍 Dashboard route accessed: ${req.method} ${req.path}`);
  console.log(`🔍 Full URL: ${req.originalUrl}`);
  next();
});

// Register dashboard routes
app.use("/api/dashboard", dashboardRoutes);

// List all registered routes
function listRoutes(app) {
  console.log("📋 Registered routes:");

  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // Direct route
      console.log(
        `  ${Object.keys(middleware.route.methods).join(", ").toUpperCase()} ${middleware.route.path}`,
      );
    } else if (middleware.name === "router") {
      // Router middleware
      console.log(`  Router: ${middleware.regexp}`);

      if (middleware.handle && middleware.handle.stack) {
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods)
              .join(", ")
              .toUpperCase();
            console.log(
              `    ${methods} ${middleware.regexp.source.replace("\\/?", "")}${handler.route.path}`,
            );
          }
        });
      }
    }
  });
}

listRoutes(app);

// Test if the route exists
console.log("\n🧪 Testing route matching...");

// Simulate a request to /analytics
const mockReq = {
  method: "GET",
  path: "/analytics",
  originalUrl: "/api/dashboard/analytics",
};

console.log("Mock request:", mockReq);

// Check if dashboard routes have the analytics route
console.log("\n🔍 Checking dashboard routes directly...");
if (dashboardRoutes && dashboardRoutes.stack) {
  dashboardRoutes.stack.forEach((layer, index) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(", ").toUpperCase();
      console.log(`  Route ${index}: ${methods} ${layer.route.path}`);
    }
  });
} else {
  console.log("❌ Dashboard routes stack not accessible");
}
