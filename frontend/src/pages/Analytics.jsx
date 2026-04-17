import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Clock3,
  DollarSign,
  Download,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Target,
  Users,
  XCircle,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { dashboardAPI } from "../utils/api";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import { useLocale } from "../context/LocaleContext";

const DEFAULT_PRESET = "6months";

const RANGE_PRESETS = [
  { id: "day", ar: "يوم", en: "Day" },
  { id: "week", ar: "أسبوع", en: "Week" },
  { id: "month", ar: "شهر", en: "Month" },
  { id: "3months", ar: "3 شهور", en: "3 Months" },
  { id: "6months", ar: "6 شهور", en: "6 Months" },
  { id: "year", ar: "سنة", en: "Year" },
  { id: "custom", ar: "مدة مخصصة", en: "Custom" },
];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toArray = (value) => (Array.isArray(value) ? value : []);

const formatDateInput = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (value, amount) => {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
};

const shiftMonths = (value, amount) => {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount);
  return date;
};

const resolvePresetRange = (presetId) => {
  const today = new Date();
  let from = new Date(today);

  switch (presetId) {
    case "day":
      from = new Date(today);
      break;
    case "week":
      from = shiftDays(today, -6);
      break;
    case "month":
      from = shiftMonths(today, -1);
      break;
    case "3months":
      from = shiftMonths(today, -3);
      break;
    case "year":
      from = shiftMonths(today, -12);
      break;
    case "6months":
    default:
      from = shiftMonths(today, -6);
      break;
  }

  return {
    dateFrom: formatDateInput(from),
    dateTo: formatDateInput(today),
  };
};

const createDefaultFilters = () => ({
  preset: DEFAULT_PRESET,
  ...resolvePresetRange(DEFAULT_PRESET),
});

const normalizeAnalyticsResponse = (raw = {}) => {
  const financial = raw?.financial || {};
  const summary = raw?.summary || {};
  const ordersByStatus = raw?.ordersByStatus || {};
  const meta = raw?.meta || {};

  return {
    financial: {
      totalRevenue: toNumber(financial.totalRevenue),
      refundedAmount: toNumber(financial.refundedAmount),
      pendingAmount: toNumber(financial.pendingAmount),
      netRevenue: toNumber(financial.netRevenue),
    },
    summary: {
      totalOrders: toNumber(summary.totalOrders),
      successRate: toNumber(summary.successRate),
      cancellationRate: toNumber(summary.cancellationRate),
      refundRate: toNumber(summary.refundRate),
    },
    ordersByStatus: {
      pending: toNumber(ordersByStatus.pending),
      paid: toNumber(ordersByStatus.paid),
      refunded: toNumber(ordersByStatus.refunded),
      cancelled: toNumber(ordersByStatus.cancelled),
      fulfilled: toNumber(ordersByStatus.fulfilled),
      unfulfilled: toNumber(ordersByStatus.unfulfilled),
    },
    trends: toArray(raw?.monthlyTrends).map((entry) => ({
      label: entry?.label || entry?.month || "-",
      periodStart: entry?.period_start || null,
      orders: toNumber(entry?.orders),
      revenue: toNumber(entry?.revenue),
      cancelled: toNumber(entry?.cancelled),
      refunded: toNumber(entry?.refunded),
    })),
    topProducts: toArray(raw?.topProducts).map((product) => ({
      title: product?.title || "Unknown Product",
      orders_count: toNumber(product?.orders_count),
      total_revenue: toNumber(product?.total_revenue),
    })),
    topCustomers: toArray(raw?.topCustomers).map((customer) => ({
      name: customer?.name || customer?.email || "Unknown Customer",
      email: customer?.email || "",
      orders_count: toNumber(customer?.orders_count),
      total_spent: toNumber(customer?.total_spent),
    })),
    meta: {
      trendGranularity: String(meta?.trendGranularity || "month"),
      dateRange: meta?.dateRange || null,
    },
  };
};

export default function Analytics() {
  const { select, formatCurrency, formatDate, formatNumber, formatPercent } =
    useLocale();
  const [filters, setFilters] = useState(createDefaultFilters);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const apiParams = useMemo(
    () => ({
      ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
      ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    }),
    [filters.dateFrom, filters.dateTo],
  );

  const fetchAnalytics = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await dashboardAPI.getAnalytics(apiParams);
        setAnalytics(normalizeAnalyticsResponse(response?.data));
        setError("");
      } catch (requestError) {
        console.error("Error fetching analytics:", requestError);
        setError(
          requestError?.response?.data?.error ||
            select("فشل تحميل التحليلات", "Failed to load analytics"),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiParams, select],
  );

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const rangeLabel = useMemo(() => {
    const dateRange = analytics?.meta?.dateRange;
    if (!dateRange?.from || !dateRange?.to) {
      return filters.dateFrom && filters.dateTo
        ? `${filters.dateFrom} - ${filters.dateTo}`
        : select("كل الفترة", "Full period");
    }

    return `${formatDate(dateRange.from, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })} - ${formatDate(dateRange.to, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })}`;
  }, [analytics?.meta?.dateRange, filters.dateFrom, filters.dateTo, formatDate, select]);

  const exportAnalytics = useCallback(() => {
    if (!analytics) {
      return;
    }

    downloadCsvSections({
      filename: buildCsvFilename("analytics-view"),
      sections: [
        {
          title: select("بيانات التصدير", "Export metadata"),
          headers: [select("الحقل", "Field"), select("القيمة", "Value")],
          rows: [
            [select("النطاق الحالي", "Current range"), rangeLabel],
            [select("الفترة المختارة", "Selected preset"), filters.preset],
            [
              select("من تاريخ", "Date from"),
              analytics.meta?.dateRange?.from || filters.dateFrom || "-",
            ],
            [
              select("إلى تاريخ", "Date to"),
              analytics.meta?.dateRange?.to || filters.dateTo || "-",
            ],
            [
              select("نوع الاتجاه", "Trend granularity"),
              analytics.meta?.trendGranularity || "-",
            ],
            [select("وقت التصدير", "Exported at"), new Date().toISOString()],
          ],
        },
        {
          title: select("الملخص", "Summary"),
          headers: [select("المؤشر", "Metric"), select("القيمة", "Value")],
          rows: [
            [select("إجمالي الإيراد", "Total revenue"), analytics.financial.totalRevenue],
            [select("صافي الإيراد", "Net revenue"), analytics.financial.netRevenue],
            [select("المرتجعات", "Refunded amount"), analytics.financial.refundedAmount],
            [select("المبالغ المعلقة", "Pending amount"), analytics.financial.pendingAmount],
            [select("عدد الطلبات", "Orders"), analytics.summary.totalOrders],
            [select("معدل النجاح", "Success rate"), analytics.summary.successRate],
            [
              select("معدل الإلغاء", "Cancellation rate"),
              analytics.summary.cancellationRate,
            ],
            [select("معدل المرتجع", "Refund rate"), analytics.summary.refundRate],
          ],
        },
        {
          title: select("حالة الطلبات", "Order status"),
          headers: [select("الحالة", "Status"), select("العدد", "Count")],
          rows: [
            [select("مدفوعة", "Paid"), analytics.ordersByStatus.paid],
            [select("معلقة", "Pending"), analytics.ordersByStatus.pending],
            [select("ملغية", "Cancelled"), analytics.ordersByStatus.cancelled],
            [select("مستردة", "Refunded"), analytics.ordersByStatus.refunded],
            [select("تم تسليمها", "Fulfilled"), analytics.ordersByStatus.fulfilled],
            [select("غير مسلمة", "Unfulfilled"), analytics.ordersByStatus.unfulfilled],
          ],
        },
        {
          title: select("اتجاه الأداء", "Performance trend"),
          headers: [
            select("الفترة", "Period"),
            select("الطلبات", "Orders"),
            select("الإيراد", "Revenue"),
            select("الملغي", "Cancelled"),
            select("المرتجع", "Refunded"),
          ],
          rows: analytics.trends.map((trend) => [
            trend.periodStart || trend.label || "-",
            trend.orders,
            trend.revenue,
            trend.cancelled,
            trend.refunded,
          ]),
        },
        {
          title: select("أفضل المنتجات", "Top products"),
          headers: [
            select("المنتج", "Product"),
            select("عدد الطلبات", "Orders"),
            select("الإيراد", "Revenue"),
          ],
          rows: analytics.topProducts.map((product) => [
            product.title,
            product.orders_count,
            product.total_revenue,
          ]),
        },
        {
          title: select("أفضل العملاء", "Top customers"),
          headers: [
            select("العميل", "Customer"),
            select("البريد", "Email"),
            select("عدد الطلبات", "Orders"),
            select("إجمالي الإنفاق", "Total spent"),
          ],
          rows: analytics.topCustomers.map((customer) => [
            customer.name,
            customer.email || "-",
            customer.orders_count,
            customer.total_spent,
          ]),
        },
      ],
    });
  }, [analytics, filters.dateFrom, filters.dateTo, filters.preset, rangeLabel, select]);

  if (loading && !analytics) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-4 border-slate-200 border-t-sky-700" />
              <p className="text-base text-slate-600">
                {select("جارٍ تحميل التحليلات...", "Loading analytics...")}
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
                  <BarChart3 size={14} />
                  {select("تحليلات المتجر", "Store analytics")}
                </div>
                <h1 className="mt-3 flex items-center gap-3 text-3xl font-bold text-slate-900">
                  <BarChart3 className="text-sky-700" size={28} />
                  {select("التحليلات", "Analytics")}
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={exportAnalytics}
                  disabled={!analytics}
                  className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Download size={16} />
                  {select("تصدير CSV", "Export CSV")}
                </button>
                <button
                  type="button"
                  onClick={() => fetchAnalytics({ silent: true })}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                  {select("تحديث", "Refresh")}
                </button>
                <button
                  type="button"
                  onClick={() => setFilters(createDefaultFilters())}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <RotateCcw size={16} />
                  {select("إعادة الضبط", "Reset")}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    if (preset.id === "custom") {
                      setFilters((current) => ({ ...current, preset: "custom" }));
                      return;
                    }

                    setFilters({
                      preset: preset.id,
                      ...resolvePresetRange(preset.id),
                    });
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    filters.preset === preset.id
                      ? "bg-sky-700 text-white shadow-sm"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {select(preset.ar, preset.en)}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-600">
                <span>{select("من تاريخ", "From date")}</span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      preset: "custom",
                      dateFrom: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-600">
                <span>{select("إلى تاريخ", "To date")}</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      preset: "custom",
                      dateTo: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                />
              </label>
            </div>

            <p className="mt-3 text-sm text-slate-500">
              {select("النطاق الحالي", "Current range")}: {rangeLabel}
            </p>

            {error ? (
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                <div className="space-y-1">
                  <p className="font-semibold">{error}</p>
                  <button
                    type="button"
                    onClick={() => fetchAnalytics()}
                    className="text-sm font-medium underline"
                  >
                    {select("إعادة المحاولة", "Try again")}
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {analytics ? (
            <>
              <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  title={select("إجمالي الإيراد", "Total revenue")}
                  value={formatCurrency(analytics.financial.totalRevenue)}
                  subtitle={select("إجمالي المبيعات المحققة", "Gross revenue in range")}
                  icon={DollarSign}
                  accent="from-emerald-500 to-emerald-700"
                />
                <KpiCard
                  title={select("صافي الإيراد", "Net revenue")}
                  value={formatCurrency(analytics.financial.netRevenue)}
                  subtitle={select("بعد خصم المرتجعات", "After refunds are deducted")}
                  icon={Target}
                  accent="from-sky-500 to-sky-700"
                />
                <KpiCard
                  title={select("عدد الطلبات", "Orders")}
                  value={formatNumber(analytics.summary.totalOrders)}
                  subtitle={select("كل الطلبات داخل النطاق", "All orders in range")}
                  icon={ShoppingCart}
                  accent="from-slate-700 to-slate-900"
                />
                <KpiCard
                  title={select("معدل النجاح", "Success rate")}
                  value={formatPercent(analytics.summary.successRate)}
                  subtitle={select("نسبة الطلبات المدفوعة", "Share of paid orders")}
                  icon={CheckCircle2}
                  accent="from-amber-500 to-orange-600"
                />
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <h2 className="text-xl font-bold text-slate-900">
                    {select("حالة الطلبات", "Order status")}
                  </h2>
                  <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
                    <StatusTile
                      label={select("مدفوعة", "Paid")}
                      value={formatNumber(analytics.ordersByStatus.paid)}
                      icon={CheckCircle2}
                      tone="emerald"
                    />
                    <StatusTile
                      label={select("معلقة", "Pending")}
                      value={formatNumber(analytics.ordersByStatus.pending)}
                      icon={Clock3}
                      tone="amber"
                    />
                    <StatusTile
                      label={select("ملغية", "Cancelled")}
                      value={formatNumber(analytics.ordersByStatus.cancelled)}
                      icon={XCircle}
                      tone="rose"
                    />
                    <StatusTile
                      label={select("مستردة", "Refunded")}
                      value={formatNumber(analytics.ordersByStatus.refunded)}
                      icon={RefreshCw}
                      tone="orange"
                    />
                    <StatusTile
                      label={select("تم تسليمها", "Fulfilled")}
                      value={formatNumber(analytics.ordersByStatus.fulfilled)}
                      icon={Package}
                      tone="sky"
                    />
                    <StatusTile
                      label={select("غير مسلمة", "Unfulfilled")}
                      value={formatNumber(analytics.ordersByStatus.unfulfilled)}
                      icon={ShoppingCart}
                      tone="slate"
                    />
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <h2 className="text-xl font-bold text-slate-900">
                    {select("أفضل العملاء والمنتجات", "Top customers and products")}
                  </h2>
                  <div className="mt-4 space-y-4">
                    <MiniMetric
                      label={select("أفضل المنتجات", "Top products")}
                      value={formatNumber(analytics.topProducts.length)}
                      helper={select("عدد المنتجات الظاهرة في القائمة", "Products shown in ranking")}
                      icon={Package}
                    />
                    <MiniMetric
                      label={select("أفضل العملاء", "Top customers")}
                      value={formatNumber(analytics.topCustomers.length)}
                      helper={select("عدد العملاء الظاهرين في القائمة", "Customers shown in ranking")}
                      icon={Users}
                    />
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        {select(
                          analytics.meta.trendGranularity === "day"
                            ? "اتجاه الأداء اليومي"
                            : "اتجاه الأداء الشهري",
                          analytics.meta.trendGranularity === "day"
                            ? "Daily performance trend"
                            : "Monthly performance trend",
                        )}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {select(
                          "الإيراد وعدد الطلبات عبر الفترة المختارة.",
                          "Revenue and order count across the selected range.",
                        )}
                      </p>
                    </div>
                    <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                      {rangeLabel}
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {analytics.trends.length > 0 ? (
                      analytics.trends.map((trend) => {
                        const maxRevenue = Math.max(
                          1,
                          ...analytics.trends.map((item) => toNumber(item.revenue)),
                        );
                        const label = trend.periodStart
                          ? formatDate(trend.periodStart, {
                              year:
                                analytics.meta.trendGranularity === "day"
                                  ? undefined
                                  : "numeric",
                              month: "short",
                              day:
                                analytics.meta.trendGranularity === "day"
                                  ? "numeric"
                                  : undefined,
                            })
                          : trend.label;

                        return (
                          <div
                            key={`${trend.periodStart || trend.label}-${trend.orders}`}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{label}</p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {select("طلبات", "Orders")}:{" "}
                                  {formatNumber(trend.orders)}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-emerald-700">
                                  {formatCurrency(trend.revenue)}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {select("مرتجع", "Refunded")}:{" "}
                                  {formatNumber(trend.refunded)}
                                </p>
                              </div>
                            </div>
                            <div className="mt-4 h-2 rounded-full bg-slate-200">
                              <div
                                className="h-2 rounded-full bg-sky-600"
                                style={{
                                  width: `${Math.max(
                                    6,
                                    (toNumber(trend.revenue) / maxRevenue) * 100,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <EmptyState
                        title={select("لا توجد بيانات", "No data")}
                        description={select(
                          "لا توجد طلبات داخل النطاق الحالي.",
                          "No orders were found inside the current range.",
                        )}
                      />
                    )}
                  </div>
                </div>

                <div className="grid gap-6">
                  <RankListCard
                    title={select("أفضل المنتجات", "Top products")}
                    emptyTitle={select("لا توجد منتجات", "No products")}
                    emptyDescription={select(
                      "لا توجد بيانات منتجات في النطاق الحالي.",
                      "No product data is available for the current range.",
                    )}
                    rows={analytics.topProducts}
                    renderRow={(product, index) => (
                      <div
                        key={`${product.title}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {product.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {select("طلبات", "Orders")}:{" "}
                            {formatNumber(product.orders_count)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-700">
                          {formatCurrency(product.total_revenue)}
                        </span>
                      </div>
                    )}
                  />

                  <RankListCard
                    title={select("أفضل العملاء", "Top customers")}
                    emptyTitle={select("لا يوجد عملاء", "No customers")}
                    emptyDescription={select(
                      "لا توجد بيانات عملاء في النطاق الحالي.",
                      "No customer data is available for the current range.",
                    )}
                    rows={analytics.topCustomers}
                    renderRow={(customer, index) => (
                      <div
                        key={`${customer.email || customer.name}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {customer.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {customer.email || "-"} • {select("طلبات", "Orders")}:{" "}
                            {formatNumber(customer.orders_count)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-sky-700">
                          {formatCurrency(customer.total_spent)}
                        </span>
                      </div>
                    )}
                  />
                </div>
              </section>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function KpiCard({ title, value, subtitle, icon: Icon, accent }) {
  return (
    <div className={`rounded-3xl bg-gradient-to-br ${accent} p-5 text-white shadow-sm`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-white/85">{title}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
          <p className="mt-2 text-sm text-white/75">{subtitle}</p>
        </div>
        <div className="rounded-2xl bg-white/10 p-3">
          <Icon size={24} />
        </div>
      </div>
    </div>
  );
}

function StatusTile({ label, value, icon: Icon, tone }) {
  const toneClasses = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };

  return (
    <div className={`rounded-2xl border p-4 ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
        </div>
        <Icon size={22} />
      </div>
    </div>
  );
}

function MiniMetric({ label, value, helper, icon: Icon }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{helper}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 text-slate-700">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function RankListCard({
  title,
  rows,
  renderRow,
  emptyTitle,
  emptyDescription,
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length > 0 ? (
          rows.map((row, index) => renderRow(row, index))
        ) : (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  );
}
