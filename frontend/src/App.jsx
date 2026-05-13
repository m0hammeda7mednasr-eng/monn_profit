import React, { Suspense, lazy } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { StoreProvider } from "./context/StoreContext";
import { LoadingSpinner } from "./components/Common";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import "./index.css";

const Orders = lazy(() => import("./pages/Orders"));
const OrderDetails = lazy(() => import("./pages/OrderDetails"));
const Products = lazy(() => import("./pages/Products"));
const ProductDetails = lazy(() => import("./pages/ProductDetails"));
const ProductAnalysis = lazy(() => import("./pages/ProductAnalysis"));
const BostaScanner = lazy(() => import("./pages/BostaScanner"));
const NetProfit = lazy(() => import("./pages/NetProfit"));
const Settings = lazy(() => import("./pages/Settings"));
const Users = lazy(() => import("./pages/Users"));
const AdminPage = lazy(() => import("./pages/Admin"));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <LoadingSpinner />
    </div>
  );
}

function App() {
  return (
    <StoreProvider>
      <AuthProvider>
        <Router
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/dashboard" element={<Navigate to="/orders" replace />} />
              <Route
                path="/suppliers/*"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/products"
                element={
                  <ProtectedRoute permission="can_view_products">
                    <Products />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/products/analysis"
                element={
                  <ProtectedRoute permission="can_view_products">
                    <ProductAnalysis />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/products/:id"
                element={
                  <ProtectedRoute permission="can_view_products">
                    <ProductDetails />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <Orders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/:id"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <OrderDetails />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bosta-scanner"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <BostaScanner />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute permission="can_manage_settings">
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute permission="can_manage_users">
                    <Users />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminPage />
                  </AdminRoute>
                }
              />
              <Route path="/" element={<Navigate to="/orders" />} />

              {/* Redirect old routes to main pages */}
              <Route
                path="/customers"
                element={<Navigate to="/dashboard" replace />}
              />
              <Route
                path="/barcode-labels"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/warehouse/*"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/orders/missing"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/orders/in-stock-follow-up"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/orders/shipping-issues"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/reports"
                element={<Navigate to="/admin" replace />}
              />
              <Route
                path="/my-reports"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/request-access"
                element={<Navigate to="/orders" replace />}
              />
              <Route path="/tasks" element={<Navigate to="/admin" replace />} />
              <Route
                path="/my-tasks"
                element={<Navigate to="/orders" replace />}
              />
              <Route
                path="/activity-log"
                element={<Navigate to="/admin" replace />}
              />
              <Route
                path="/growth-center"
                element={<Navigate to="/admin" replace />}
              />
              <Route
                path="/net-profit"
                element={
                  <AdminRoute>
                    <NetProfit />
                  </AdminRoute>
                }
              />
              <Route
                path="/meta-analytics"
                element={<Navigate to="/admin" replace />}
              />
              <Route
                path="/analytics"
                element={<Navigate to="/admin" replace />}
              />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </StoreProvider>
  );
}

export default App;
