import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Clock3,
  FileText,
  Package,
  RefreshCw,
  Shield,
  ShoppingCart,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import api, { getErrorMessage, shopifyAPI } from "../utils/api";
import Sidebar from "../components/Sidebar";
import {
  SkeletonBlock,
  StatCardSkeleton,
  TableSkeleton,
} from "../components/Common";
import OrderInsightsFilterBar from "../components/OrderInsightsFilterBar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { extractArray, extractObject } from "../utils/response";
import {
  markSharedDataUpdated,
  subscribeToSharedDataUpdates,
} from "../utils/realtime";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  peekCachedView,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";
import {
  HEAVY_VIEW_CACHE_FRESH_MS,
  shouldAutoRefreshView,
} from "../utils/refreshPolicy";
import {
  buildOrderScopeApiParams,
  hasActiveOrderScopeFilters,
  INITIAL_ORDER_SCOPE_FILTERS,
} from "../utils/orderScope";

const DASHBOARD_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const EMPTY_DASHBOARD_STATS = {
  total_sales: 0,
  total_order_value: 0,
  pending_order_value: 0,
  total_orders: 0,
  total_products: 0,
  total_customers: 0,
  low_stock_products: 0,
  orders_window_limit: 4500,
  paid_orders_count: 0,
  avg_order_value: 0,
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getOrderFinancialStatus = (order) => {
  return String(order.financial_status || order.status || "")
    .toLowerCase()
    .trim();
};

const PAYMENT_STATUS_STYLE = {
  paid: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  pending: "bg-amber-100 text-amber-700 border border-amber-200",
  authorized: "bg-sky-100 text-sky-700 border border-sky-200",
  refunded: "bg-rose-100 text-rose-700 border border-rose-200",
  partially_refunded: "bg-orange-100 text-orange-700 border border-orange-200",
  failed: "bg-rose-100 text-rose-700 border border-rose-200",
};

const getPaymentStatusClassName = (status) => {
  const normalized = String(status || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  return (
    PAYMENT_STATUS_STYLE[normalized] ||
    "bg-slate-100 text-slate-700 border border-slate-200"
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, hasPermission, loading: authLoading } = useAuth();
  const { select, isRTL, formatCurrency, formatDateTime, formatNumber, formatTime } =
    useLocale();

  const isAdmin = user?.role === "admin";
  const canManageSettings = hasPermission("can_manage_settings");
  const canViewProducts = hasPermission("can_view_products");
  const canViewOrders = hasPermission("can_view_orders");
  const canViewCustomers = hasPermission("can_view_customers");
  const canManageUsers = hasPermission("can_manage_users");
  const canViewAllReports = hasPermission("can_view_all_reports");
  const [scopeFilters, setScopeFilters] = useState(INITIAL_ORDER_SCOPE_FILTERS);
  const scopeParams = useMemo(
    () => buildOrderScopeApiParams(scopeFilters),
    [scopeFilters],
  );
  const hasScopedOrderFilters = useMemo(
    () => hasActiveOrderScopeFilters(scopeFilters),
    [scopeFilters],
  );
  const scopeCacheToken = useMemo(
    () => JSON.stringify(scopeParams),
    [scopeParams],
  );
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey(`dashboard:summary:${scopeCacheToken}`),
    [scopeCacheToken],
  );
  const initialCachedSnapshot = useMemo(() => {
    const cached = peekCachedView(cacheKey);
    const snapshot = cached?.value;

    return {
      stats: {
        ...EMPTY_DASHBOARD_STATS,
        ...(snapshot?.stats || {}),
      },
      recentOrders: Array.isArray(snapshot?.recentOrders)
        ? snapshot.recentOrders
        : [],
      pendingRequests: Array.isArray(snapshot?.pendingRequests)
        ? snapshot.pendingRequests
        : [],
      pendingRequestsCount: Number(
        snapshot?.pendingRequestsCount ??
          snapshot?.pendingRequests?.length ??
          0,
      ),
      recentReports: Array.isArray(snapshot?.recentReports)
        ? snapshot.recentReports
        : [],
      updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
    };
  }, [cacheKey]);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    () => initialCachedSnapshot.updatedAt,
  );
  const [stats, setStats] = useState(() => initialCachedSnapshot.stats);
  const [pendingRequests, setPendingRequests] = useState(
    () => initialCachedSnapshot.pendingRequests,
  );
  const [pendingRequestsCount, setPendingRequestsCount] = useState(
    () => initialCachedSnapshot.pendingRequestsCount,
  );
  const [recentReports, setRecentReports] = useState(
    () => initialCachedSnapshot.recentReports,
  );
  const [recentOrders, setRecentOrders] = useState(
    () => initialCachedSnapshot.recentOrders,
  );
  const formatDashboardDate = useCallback(
    (value) =>
      formatDateTime(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [formatDateTime],
  );

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        if (!silent) {
          setError("");
        }

        const statsPromise = api.get("/dashboard/stats", {
          params: scopeParams,
        });
        const ordersPromise = canViewOrders
          ? shopifyAPI.getOrders({
              limit: 6,
              sort_by: "created_at",
              sort_dir: "desc",
              sync_recent: "false",
              ...scopeParams,
            })
          : Promise.resolve({ data: [] });
        const requestsPromise =
          isAdmin || canManageUsers
            ? api.get("/access-requests/all", {
                params: {
                  status: "pending",
                  limit: 4,
                  include_count: true,
                },
              })
            : Promise.resolve({ data: [] });
        const reportsPromise =
          isAdmin || canViewAllReports
            ? api.get("/daily-reports/all", {
                params: {
                  limit: 5,
                },
              })
            : Promise.resolve({ data: [] });

        const [statsResult, ordersResult, requestsResult, reportsResult] =
          await Promise.allSettled([
            statsPromise,
            ordersPromise,
            requestsPromise,
            reportsPromise,
          ]);

        if (statsResult.status === "fulfilled") {
          setStats({
            ...EMPTY_DASHBOARD_STATS,
            ...extractObject(statsResult.value.data),
          });
        } else {
          setStats(EMPTY_DASHBOARD_STATS);
        }

        const ordersData =
          ordersResult.status === "fulfilled"
            ? extractArray(ordersResult.value.data)
            : [];
        const sortedOrders = [...ordersData].sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at),
        );
        setRecentOrders(sortedOrders.slice(0, 6));

        const requestsData =
          requestsResult.status === "fulfilled"
            ? extractArray(requestsResult.value.data)
            : [];
        const nextPendingRequests = requestsData
          .filter((item) => String(item.status) === "pending")
          .slice(0, 4);
        const nextPendingRequestsCount =
          requestsResult.status === "fulfilled"
            ? Number(
                requestsResult.value.data?.total ?? nextPendingRequests.length,
              )
            : 0;
        setPendingRequests(nextPendingRequests);
        setPendingRequestsCount(nextPendingRequestsCount);

        const reportsData =
          reportsResult.status === "fulfilled"
            ? extractArray(reportsResult.value.data)
            : [];
        setRecentReports(
          reportsData
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5),
        );
        await writeCachedView(cacheKey, {
          stats:
            statsResult.status === "fulfilled"
              ? {
                  ...EMPTY_DASHBOARD_STATS,
                  ...extractObject(statsResult.value.data),
                }
              : EMPTY_DASHBOARD_STATS,
          recentOrders: sortedOrders.slice(0, 6),
          pendingRequests: nextPendingRequests,
          pendingRequestsCount: nextPendingRequestsCount,
          recentReports: reportsData
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5),
        });

        if (!silent) {
          const firstFailure = [
            statsResult,
            ordersResult,
            requestsResult,
            reportsResult,
          ]
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason)[0];
          if (firstFailure) {
            setError(getErrorMessage(firstFailure));
          }
        }

        setLastUpdatedAt(new Date());
      } catch (requestError) {
        if (!silent) {
          setError(getErrorMessage(requestError));
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [
      cacheKey,
      canManageUsers,
      canViewAllReports,
      canViewOrders,
      isAdmin,
      scopeParams,
    ],
  );

  useEffect(() => {
    if (authLoading) return;

    let active = true;

    (async () => {
      const cached = await readCachedView(cacheKey);
      const snapshot = cached?.value;

      if (active && snapshot) {
        setStats({
          ...EMPTY_DASHBOARD_STATS,
          ...(snapshot.stats || {}),
        });
        setRecentOrders(
          Array.isArray(snapshot.recentOrders) ? snapshot.recentOrders : [],
        );
        setPendingRequests(
          Array.isArray(snapshot.pendingRequests)
            ? snapshot.pendingRequests
            : [],
        );
        setPendingRequestsCount(
          Number(
            snapshot.pendingRequestsCount ??
              snapshot.pendingRequests?.length ??
              0,
          ),
        );
        setRecentReports(
          Array.isArray(snapshot.recentReports) ? snapshot.recentReports : [],
        );
        setLastUpdatedAt(
          cached?.updatedAt ? new Date(cached.updatedAt) : new Date(),
        );
        setLoading(false);
      }

      if (!active) {
        return;
      }

      const hasCachedSnapshot = Boolean(snapshot);
      if (
        !hasCachedSnapshot ||
        !isCacheFresh(cached, DASHBOARD_CACHE_FRESH_MS)
      ) {
        await loadData({ silent: hasCachedSnapshot });
      }
    })();

    return () => {
      active = false;
    };
  }, [authLoading, cacheKey, loadData]);

  useEffect(() => {
    if (authLoading) return;

    let unsubscribe = () => {};
    let onFocus = null;

    if (shouldAutoRefreshView()) {
      unsubscribe = subscribeToSharedDataUpdates(() => {
        loadData({ silent: true });
      });

      onFocus = async () => {
        const cached = await readCachedView(cacheKey);
        if (isCacheFresh(cached, DASHBOARD_CACHE_FRESH_MS)) {
          return;
        }

        loadData({ silent: true });
      };

      window.addEventListener("focus", onFocus);
    }

    return () => {
      unsubscribe();
      if (onFocus) {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [authLoading, cacheKey, loadData]);

  const shortcuts = useMemo(() => {
    const items = [
      {
        id: "products",
        label: "Products",
        description: "Browse and update product catalog",
        icon: Package,
        path: "/products",
        visible: hasPermission("can_view_products"),
        className: "from-indigo-500 to-indigo-700",
      },
      {
        id: "orders",
        label: "Orders",
        description: "Track payment, fulfillment, and refunds",
        icon: ShoppingCart,
        path: "/orders",
        visible: hasPermission("can_view_orders"),
        className: "from-sky-500 to-sky-700",
      },
        {
          id: "customers",
          label: "Customers",
          description: "Customer profiles, spend, and history",
          icon: Users,
          path: "/customers",
          visible: hasPermission("can_view_customers"),
          className: "from-emerald-500 to-emerald-700",
        },
        {
          id: "growth-center",
          label: "Growth Center",
          description: "Restock, retention, and margin actions in one view",
          icon: TrendingUp,
          path: "/growth-center",
          visible: isAdmin || canManageSettings,
          className: "from-cyan-500 to-sky-700",
        },
        {
          id: "my-tasks",
          label: "My Tasks",
        description: "Your assigned work and follow-ups",
        icon: FileText,
        path: "/my-tasks",
        visible: !isAdmin,
        className: "from-orange-500 to-orange-700",
      },
      {
        id: "manage-team",
        label: "Team Management",
        description: "Users, roles, and permissions",
        icon: Shield,
        path: "/users?tab=users",
        visible: isAdmin || canManageUsers,
        className: "from-fuchsia-600 to-fuchsia-800",
      },
      {
        id: "access-requests",
        label: "Access Requests",
        description: `Pending now: ${pendingRequestsCount}`,
        icon: UserCheck,
        path: "/users?tab=requests",
        visible: isAdmin || canManageUsers,
        className: "from-amber-500 to-amber-700",
      },
    ];

    return items.filter((item) => item.visible);
  }, [canManageSettings, canManageUsers, hasPermission, isAdmin, pendingRequestsCount]);

  const initialDashboardLoad = useMemo(
    () =>
      loading &&
      !lastUpdatedAt &&
      recentOrders.length === 0 &&
      pendingRequests.length === 0 &&
      recentReports.length === 0,
    [lastUpdatedAt, loading, pendingRequests.length, recentOrders.length, recentReports.length],
  );

  const statCards = useMemo(
    () =>
      [
        {
          id: "net-sales",
          title: "Collected Net Sales",
          value: formatCurrency(stats.total_sales),
          subtitle: hasScopedOrderFilters
            ? "Paid-like orders after refunds inside the current filtered scope"
            : "Paid-like orders after refunds across all synced orders",
          icon: TrendingUp,
          color: "from-emerald-500 to-emerald-700",
          actionLabel: canViewOrders ? "View orders" : "",
          onClick: canViewOrders ? () => navigate("/orders") : null,
        },
        {
          id: "order-value",
          title: "Gross Order Value",
          value: formatCurrency(stats.total_order_value),
          subtitle: hasScopedOrderFilters
            ? "Paid-like order total before refunds inside the current filtered scope"
            : "Paid-like order total before refunds across all synced orders",
          icon: TrendingUp,
          color: "from-amber-500 to-amber-700",
          actionLabel: canViewOrders ? "View orders" : "",
          onClick: canViewOrders ? () => navigate("/orders") : null,
        },
        {
          id: "orders",
          title: "Total Orders",
          value: formatNumber(stats.total_orders),
          subtitle: hasScopedOrderFilters
            ? "Orders matching the current filter scope"
            : "All synced orders in the current store",
          icon: ShoppingCart,
          color: "from-blue-500 to-blue-700",
          actionLabel: canViewOrders ? "View orders" : "",
          onClick: canViewOrders ? () => navigate("/orders") : null,
        },
        {
          id: "products",
          title: "Products",
          value: formatNumber(stats.total_products),
          subtitle: hasScopedOrderFilters
            ? "Products referenced by matching orders"
            : "Total synced products in the catalog",
          icon: Package,
          color: "from-indigo-500 to-indigo-700",
          actionLabel: canViewProducts ? "View catalog" : "",
          onClick: canViewProducts ? () => navigate("/products") : null,
        },
        {
          id: "customers",
          title: "Customers",
          value: formatNumber(stats.total_customers),
          subtitle: hasScopedOrderFilters
            ? "Customers referenced by the current order scope"
            : "Total synced customers in the store",
          icon: Users,
          color: "from-cyan-500 to-cyan-700",
          actionLabel: canViewCustomers ? "View customers" : "",
          onClick: canViewCustomers ? () => navigate("/customers") : null,
        },
        {
          id: "avg-order",
          title: "Avg Paid Order",
          value: formatCurrency(stats.avg_order_value),
          subtitle: hasScopedOrderFilters
            ? `Net sales divided by ${formatNumber(stats.paid_orders_count)} paid orders in scope`
            : `Net sales divided by ${formatNumber(stats.paid_orders_count)} paid orders`,
          icon: TrendingUp,
          color: "from-violet-500 to-violet-700",
        },
        canViewProducts
          ? {
              id: "low-stock",
              title: "Low Stock",
              value: formatNumber(stats.low_stock_products),
              subtitle:
                toNumber(stats.low_stock_products) > 0
                  ? "Catalog-wide items below 10 units need attention"
                  : "No low-stock items need action right now",
              icon: AlertCircle,
              color: "from-rose-500 to-rose-700",
              actionLabel:
                toNumber(stats.low_stock_products) > 0 ? "Review low stock" : "Catalog healthy",
              onClick: () => navigate("/products?stockStatus=low_stock"),
            }
          : null,
      ].filter(Boolean),
    [
      canViewOrders,
      canViewCustomers,
      canViewProducts,
      formatCurrency,
      formatNumber,
      hasScopedOrderFilters,
      navigate,
      stats.avg_order_value,
      stats.low_stock_products,
      stats.paid_orders_count,
      stats.total_customers,
      stats.total_order_value,
      stats.total_orders,
      stats.total_products,
      stats.total_sales,
    ],
  );

  const handleSync = async () => {
    if (!canManageSettings) return;

    try {
      setSyncing(true);
      setError("");
      await shopifyAPI.sync();
      markSharedDataUpdated();
      await loadData({ silent: true });
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      const backendCode = requestError.response?.data?.code;
      const backendMessage = String(requestError.response?.data?.error || "");
      const notConnected =
        backendCode === "SHOPIFY_NOT_CONNECTED" ||
        backendMessage.toLowerCase().includes("not connected");

      if (notConnected) {
        setError(
          "Shopify is not connected for this account/store. Open Settings and connect the store first.",
        );
      } else {
        setError(getErrorMessage(requestError));
      }
    } finally {
      setSyncing(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 p-8" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
              <p className="text-slate-600 mt-1">
                {isAdmin
                  ? "Central operations for users, reports, and requests"
                  : "Your shortcuts, key metrics, and latest shared updates"}
              </p>
              {lastUpdatedAt && (
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                  <Clock3 size={12} />
                  {select("آخر تحديث", "Last refresh")}:{" "}
                  {formatTime(lastUpdatedAt, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}
            </div>

            {canManageSettings && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 bg-sky-700 hover:bg-sky-800 text-white px-5 py-2 rounded-lg disabled:opacity-60"
              >
                <RefreshCw
                  size={18}
                  className={syncing ? "animate-spin" : ""}
                />
                {syncing ? "Syncing..." : "Sync Shopify"}
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          {canViewProducts &&
            toNumber(stats.low_stock_products) > 0 &&
            !initialDashboardLoad && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700">
                    <AlertCircle size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">
                      {formatNumber(stats.low_stock_products)} items need stock attention
                    </p>
                    <p className="mt-1 text-xs text-amber-800/90">
                      Low-stock alerts are generated automatically and sent to product owners.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/products?stockStatus=low_stock")}
                  className="inline-flex items-center rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
                >
                  Review low stock
                </button>
              </div>
            )}

          <OrderInsightsFilterBar
            filters={scopeFilters}
            onChange={setScopeFilters}
            onReset={() => setScopeFilters(INITIAL_ORDER_SCOPE_FILTERS)}
            title={select("فلترة مؤشرات لوحة التحكم", "Dashboard Metrics Filter")}
            description={select(
              "الأرقام وأحدث الطلبات سيعتمدوا على نفس نطاق الحالات والتواريخ المختار هنا.",
              "The figures and latest orders will use the same scope of statuses and dates selected here.",
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            {initialDashboardLoad
              ? Array.from({ length: canViewProducts ? 7 : 6 }).map((_, index) => (
                  <StatCardSkeleton key={`dashboard-stat-skeleton-${index}`} />
                ))
              : statCards.map((item) => <StatCard key={item.id} {...item} />)}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {initialDashboardLoad
              ? Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`shortcut-skeleton-${index}`}
                    className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <SkeletonBlock
                      className="mb-4 h-10 w-10 rounded-2xl"
                      roundedClassName=""
                    />
                    <SkeletonBlock className="h-5 w-32" />
                    <SkeletonBlock className="mt-3 h-4 w-full max-w-[16rem]" />
                  </div>
                ))
              : shortcuts.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.path)}
                    className={`bg-gradient-to-r ${item.className} rounded-xl p-6 text-white transition hover:shadow-xl ${
                      isRTL ? "text-right" : "text-left"
                    }`}
                  >
                    <item.icon size={28} className="mb-3" />
                    <p className="font-bold text-lg">{item.label}</p>
                    <p className="text-sm text-white/90 mt-1">{item.description}</p>
                  </button>
                ))}
          </div>

          {canViewOrders && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">
                    {hasScopedOrderFilters
                      ? select("أحدث الطلبات المطابقة", "Latest Matching Orders")
                      : select("أحدث الطلبات", "Latest Orders")}
                  </h2>
                  {hasScopedOrderFilters ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {select(
                        "لا تظهر هنا إلا الطلبات الواقعة داخل نطاق الفلترة الحالي.",
                        "Only orders inside the current filter scope appear here.",
                      )}
                    </p>
                  ) : null}
                </div>
                <button
                  onClick={() => navigate("/orders")}
                  className="inline-flex items-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100"
                >
                  {select("فتح الطلبات", "Open Orders")}
                </button>
              </div>

              {initialDashboardLoad ? (
                <div className="p-5">
                  <TableSkeleton rows={5} columns={5} />
                </div>
              ) : recentOrders.length === 0 ? (
                <p className="px-5 py-6 text-slate-500">
                  {hasScopedOrderFilters
                    ? select(
                        "لا توجد طلبات مطابقة للفلاتر المختارة.",
                        "No orders match the selected filters.",
                      )
                    : select("لا توجد طلبات حديثة.", "No recent orders found.")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full min-w-[720px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr
                        className={`text-xs tracking-wide text-slate-500 ${
                          isRTL ? "text-right" : "text-left uppercase"
                        }`}
                      >
                        <th className="px-5 py-3">{select("الطلب", "Order")}</th>
                        <th className="px-5 py-3">{select("العميل", "Customer")}</th>
                        <th className="px-5 py-3">{select("الإجمالي", "Total")}</th>
                        <th className="px-5 py-3">{select("الدفع", "Payment")}</th>
                        <th className="px-5 py-3">{select("التاريخ", "Date")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {recentOrders.map((order) => (
                        <tr
                          key={order.id}
                          className="hover:bg-slate-50 cursor-pointer transition"
                          onClick={() => navigate(`/orders/${order.id}`)}
                        >
                          <td className="px-5 py-3.5 text-sm font-semibold text-slate-900">
                            #{order.order_number || order.shopify_id}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-700">
                            {order.customer_name || "Unknown customer"}
                          </td>
                          <td className="px-5 py-3.5 text-sm font-medium text-slate-800">
                            {formatCurrency(order.total_price)}
                          </td>
                          <td className="px-5 py-3.5 text-sm">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getPaymentStatusClassName(
                                getOrderFinancialStatus(order),
                              )}`}
                            >
                              {getOrderFinancialStatus(order) || "-"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-slate-600">
                            {formatDashboardDate(order.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {(isAdmin || canManageUsers || canViewAllReports) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(isAdmin || canManageUsers) && (
                <div className="bg-white rounded-xl shadow p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">
                      Pending Access Requests
                    </h2>
                    <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-semibold">
                      {pendingRequestsCount}
                    </span>
                  </div>

                  {pendingRequests.length === 0 ? (
                    <p className="text-slate-500">
                      No pending access requests now.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {pendingRequests.slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="border rounded-lg px-3 py-2 text-sm"
                        >
                          <p className="font-medium text-slate-800">
                            {item.users?.name || item.user_name || "User"}
                          </p>
                          <p className="text-slate-500">
                            {item.permission_requested}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => navigate("/users?tab=requests")}
                    className="mt-4 text-sm text-sky-700 hover:text-sky-900 font-semibold"
                  >
                    Open requests manager
                  </button>
                </div>
              )}

              {(isAdmin || canViewAllReports) && (
                <div className="bg-white rounded-xl shadow p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold">
                      Recent Employee Reports
                    </h2>
                    <button
                      onClick={() => navigate("/reports")}
                      className="text-sky-700 text-sm hover:text-sky-900"
                    >
                      View all
                    </button>
                  </div>

                  {recentReports.length === 0 ? (
                    <p className="text-slate-500">No recent reports.</p>
                  ) : (
                    <div className="space-y-2">
                      {recentReports.map((item) => (
                        <div
                          key={item.id}
                          className="border rounded-lg px-3 py-2 text-sm"
                        >
                          <p className="font-medium text-slate-800">
                            {item.title}
                          </p>
                          <p className="text-slate-500">
                            {item.users?.name || item.user_name || "Employee"}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {(isAdmin || canManageUsers) && (
                    <button
                      onClick={() => navigate("/users?tab=users")}
                      className="mt-4 text-sm text-fuchsia-700 hover:text-fuchsia-900 font-semibold"
                    >
                      Open users and permissions
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle = "",
  icon: Icon,
  color,
  onClick = null,
  actionLabel = "",
}) {
  const { isRTL } = useLocale();
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick || undefined}
      className={`bg-gradient-to-r ${color} rounded-xl p-5 text-white ${
        onClick
          ? `${isRTL ? "text-right" : "text-left"} transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-sky-100/80`
          : ""
      }`}
    >
      <div className="flex justify-between items-center gap-3">
        <div>
          <p className="text-sm text-white/90">{title}</p>
          <p className="text-2xl font-bold mt-2">{value}</p>
          {subtitle ? (
            <p className="text-xs text-white/80 mt-1">{subtitle}</p>
          ) : null}
          {actionLabel ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
              {actionLabel}
            </p>
          ) : null}
        </div>
        <Icon size={28} />
      </div>
    </Component>
  );
}
