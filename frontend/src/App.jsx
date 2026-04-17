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

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Customers = lazy(() => import("./pages/Customers"));
const Products = lazy(() => import("./pages/Products"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const ProductAnalysis = lazy(() => import("./pages/ProductAnalysis"));
const ProductDetails = lazy(() => import("./pages/ProductDetails"));
const BarcodeLabels = lazy(() => import("./pages/BarcodeLabels"));
const Orders = lazy(() => import("./pages/Orders"));
const MissingOrders = lazy(() => import("./pages/MissingOrders"));
const ShippingIssues = lazy(() => import("./pages/ShippingIssues"));
const OrderDetails = lazy(() => import("./pages/OrderDetails"));
const WarehouseStock = lazy(() => import("./pages/WarehouseStock"));
const WarehouseScanner = lazy(() => import("./pages/WarehouseScanner"));
const Settings = lazy(() => import("./pages/Settings"));
const Users = lazy(() => import("./pages/Users"));
const Reports = lazy(() => import("./pages/Reports"));
const MyReports = lazy(() => import("./pages/MyReports"));
const RequestAccess = lazy(() => import("./pages/RequestAccess"));
const Tasks = lazy(() => import("./pages/Tasks"));
const MyTasks = lazy(() => import("./pages/MyTasks"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const NetProfit = lazy(() => import("./pages/NetProfit"));
const Analytics = lazy(() => import("./pages/Analytics"));
const GrowthCenter = lazy(() => import("./pages/GrowthCenter"));
const MetaAnalytics = lazy(() => import("./pages/MetaCommandCenter"));
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
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute permission="can_view_dashboard">
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/customers"
                element={
                  <ProtectedRoute permission="can_view_customers">
                    <Customers />
                  </ProtectedRoute>
                }
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
                path="/suppliers"
                element={
                  <ProtectedRoute permission="can_view_suppliers">
                    <Suppliers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/suppliers/:supplierId"
                element={
                  <ProtectedRoute permission="can_view_suppliers">
                    <Suppliers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/suppliers/fabric-suppliers"
                element={
                  <ProtectedRoute permission="can_view_suppliers">
                    <Suppliers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/suppliers/fabric-suppliers/:supplierId"
                element={
                  <ProtectedRoute permission="can_view_suppliers">
                    <Suppliers />
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
                path="/barcode-labels"
                element={
                  <ProtectedRoute permission="can_print_barcode_labels">
                    <BarcodeLabels />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/warehouse"
                element={
                  <ProtectedRoute permission="can_view_warehouse">
                    <WarehouseStock />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/warehouse/scanner"
                element={
                  <ProtectedRoute permission="can_edit_warehouse">
                    <WarehouseScanner />
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
                path="/orders/missing"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <MissingOrders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/in-stock-follow-up"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <MissingOrders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders/shipping-issues"
                element={
                  <ProtectedRoute permission="can_view_orders">
                    <ShippingIssues />
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
                path="/reports"
                element={
                  <ProtectedRoute permission="can_view_all_reports">
                    <Reports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-reports"
                element={
                  <ProtectedRoute>
                    <MyReports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/request-access"
                element={
                  <ProtectedRoute>
                    <RequestAccess />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/tasks"
                element={
                  <ProtectedRoute permission="can_manage_tasks">
                    <Tasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-tasks"
                element={
                  <ProtectedRoute>
                    <MyTasks />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/activity-log"
                element={
                  <ProtectedRoute permission="can_view_activity_log">
                    <ActivityLog />
                  </ProtectedRoute>
                }
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
                element={
                  <ProtectedRoute permission="can_manage_settings">
                    <MetaAnalytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/growth-center"
                element={
                  <ProtectedRoute permission="can_manage_settings">
                    <GrowthCenter />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <AdminRoute>
                    <Analytics />
                  </AdminRoute>
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
              <Route path="/" element={<Navigate to="/dashboard" />} />
            </Routes>
          </Suspense>
        </Router>
      </AuthProvider>
    </StoreProvider>
  );
}

export default App;
