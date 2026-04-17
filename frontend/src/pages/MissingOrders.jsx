import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  Eye,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import { useStore } from "../context/StoreContext";
import { shopifyAPI } from "../utils/api";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";
import { HEAVY_VIEW_CACHE_FRESH_MS } from "../utils/refreshPolicy";

const FETCH_PAGE_LIMIT = 4500;
const FOLLOW_UP_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const MISSING_ORDERS_PER_PAGE = 50;
const MISSING_ORDERS_PAGINATION_WINDOW = 5;
const MISSING_ORDER_REASON_NO_ACTION = "in_stock_without_action";

const normalizeStatus = (value, fallback = "none") => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
};

const PAYMENT_STATUS_LABELS = {
  pending: { ar: "معلق", en: "Pending" },
  authorized: { ar: "مصرح به", en: "Authorized" },
  paid: { ar: "مدفوع", en: "Paid" },
  partially_paid: { ar: "مدفوع جزئيًا", en: "Partially Paid" },
  refunded: { ar: "مسترد", en: "Refunded" },
  partially_refunded: { ar: "استرداد جزئي", en: "Partially Refunded" },
  voided: { ar: "ملغي", en: "Voided" },
  failed: { ar: "فشل", en: "Failed" },
  none: { ar: "-", en: "-" },
};

const FULFILLMENT_STATUS_LABELS = {
  fulfilled: { ar: "تم التسليم", en: "Fulfilled" },
  partial: { ar: "تسليم جزئي", en: "Partially Fulfilled" },
  unfulfilled: { ar: "غير مسلم", en: "Unfulfilled" },
  restocked: { ar: "أعيد للمخزون", en: "Restocked" },
  none: { ar: "-", en: "-" },
};

const getLocalizedStatusLabel = (status, locale, dictionary) => {
  const normalizedLocale = locale === "ar" ? "ar" : "en";
  return (
    dictionary[String(status || "").trim().toLowerCase()]?.[normalizedLocale] ||
    String(status || "-")
  );
};

const getStateBadge = (order, locale) =>
  order?.missing_state === "escalated"
    ? {
        label: locale === "ar" ? "حرج" : "Critical",
        className: "border-red-600 bg-red-600 text-white",
      }
    : {
        label: locale === "ar" ? "خارج المخزون" : "Stock-Out",
        className: "border-amber-500 bg-amber-500 text-white",
      };

void getStateBadge;

const getCardClassName = (order) =>
  order?.missing_state === "escalated"
    ? "border-red-200 bg-red-50"
    : isInStockNoActionOrder(order)
      ? "border-sky-200 bg-sky-50"
      : "border-amber-200 bg-amber-50";

const getMissingReason = (order) =>
  String(order?.missing_reason || "").trim().toLowerCase();

const isInStockNoActionOrder = (order) =>
  getMissingReason(order) === MISSING_ORDER_REASON_NO_ACTION;

const getSeverityBadge = (order, locale) =>
  order?.missing_state === "escalated"
    ? {
        label: locale === "ar" ? "Ø­Ø±Ø¬" : "Critical",
        className: "border-red-600 bg-red-600 text-white",
      }
    : {
        label: locale === "ar" ? "ÙŠØ­ØªØ§Ø¬ Ù…ØªØ§Ø¨Ø¹Ø©" : "Needs Follow-Up",
        className: "border-slate-300 bg-white text-slate-700",
      };

const getReasonBadge = (order, locale) =>
  isInStockNoActionOrder(order)
    ? {
        label:
          locale === "ar"
            ? "Ø§Ù„Ù…Ø®Ø²ÙˆÙ† Ù…ØªØ§Ø­ / Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ø¥Ø¬Ø±Ø§Ø¡"
            : "In Stock, No Action",
        className: "border-sky-200 bg-sky-100 text-sky-800",
      }
    : {
        label: locale === "ar" ? "Ø®Ø§Ø±Ø¬ Ø§Ù„Ù…Ø®Ø²ÙˆÙ†" : "Stock-Out",
        className: "border-amber-200 bg-amber-100 text-amber-900",
      };

const matchesSearch = (order, keyword) => {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystacks = [
    order?.customer_name,
    order?.customer_email,
    order?.order_number,
    order?.shopify_id,
  ];

  return haystacks.some((value) =>
    String(value || "").toLowerCase().includes(normalized),
  );
};

const getDaysWithoutStock = (order) =>
  Number(order?.days_without_stock || order?.days_without_action || 0);

const getShortageStats = (order) => ({
  shortageQuantity: Number(order?.warehouse_shortage_quantity || 0),
  requiredQuantity: Number(order?.warehouse_required_quantity || 0),
  blockedItemsCount: Number(order?.warehouse_shortage_items_count || 0),
  preview:
    order?.warehouse_shortage_preview ||
    order?.warehouse_shortage_lines?.[0]?.display_title ||
    "",
});

const formatShortageSummary = (order, select, formatNumber) => {
  const { shortageQuantity, requiredQuantity, blockedItemsCount } =
    getShortageStats(order);

  return select(
    `عجز ${formatNumber(shortageQuantity, { maximumFractionDigits: 0 })} من ${formatNumber(requiredQuantity, { maximumFractionDigits: 0 })} قطعة عبر ${formatNumber(blockedItemsCount, { maximumFractionDigits: 0 })} صنف`,
    `Short ${formatNumber(shortageQuantity, { maximumFractionDigits: 0 })} of ${formatNumber(requiredQuantity, { maximumFractionDigits: 0 })} units across ${formatNumber(blockedItemsCount, { maximumFractionDigits: 0 })} item(s)`,
  );
};

const formatAlertSummary = (order, select, formatNumber) => {
  if (isInStockNoActionOrder(order)) {
    const requiredQuantity = Number(order?.warehouse_required_quantity || 0);

    return select(
      `Ø§Ù„Ù…Ø®Ø²ÙˆÙ† ÙŠØºØ·ÙŠ ${formatNumber(requiredQuantity, { maximumFractionDigits: 0 })} Ù‚Ø·Ø¹Ø© Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø¨Ø¯ÙˆÙ† Ø¥Ø¬Ø±Ø§Ø¡`,
      `Warehouse covers ${formatNumber(requiredQuantity, { maximumFractionDigits: 0 })} unit(s), but no action was taken`,
    );
  }

  return formatShortageSummary(order, select, formatNumber);
};

const formatAlertPreview = (order, select) => {
  if (isInStockNoActionOrder(order)) {
    return select(
      "Ø¬Ù…ÙŠØ¹ Ø£ØµÙ†Ø§Ù Ø§Ù„Ø·Ù„Ø¨ Ù…ØªØ§Ø­Ø© ÙÙŠ Ø§Ù„Ù…Ø®Ø²Ù†ØŒ Ù„ÙƒÙ† Ù„Ù… ÙŠØªÙ… ØªØ³Ø¬ÙŠÙ„ Ø£ÙŠ comment Ø£Ùˆ Ù…ØªØ§Ø¨Ø¹Ø© Ø­ØªÙ‰ Ø§Ù„Ø¢Ù†.",
      "All required items are available in warehouse stock, but no order comment or follow-up has been recorded yet.",
    );
  }

  return (
    getShortageStats(order).preview ||
    select(
      "ÙŠÙˆØ¬Ø¯ ØµÙ†Ù Ø£Ùˆ Ø£ÙƒØ«Ø± ØºÙŠØ± Ù…ØªØºØ·Ù‰ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„.",
      "One or more line items are not fully covered.",
    )
  );
};

const formatOrderAge = (order, select, formatNumber) =>
  select(
    `منذ ${formatNumber(getDaysWithoutStock(order), {
      maximumFractionDigits: 0,
    })} يوم`,
    `${formatNumber(getDaysWithoutStock(order), {
      maximumFractionDigits: 0,
    })} days old`,
  );

function SummaryCard({ title, value, tone, icon: Icon }) {
  const toneClassName = {
    blue: "from-sky-500 to-sky-700",
    amber: "from-amber-500 to-amber-700",
    red: "from-red-500 to-red-700",
  }[tone] || "from-slate-500 to-slate-700";

  return (
    <div
      className={`rounded-2xl bg-gradient-to-br p-5 text-white shadow-sm ${toneClassName}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm/6 text-white/80">{title}</p>
          <p className="mt-2 text-3xl font-bold">{value}</p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function InfoBox({ label, value }) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
      {text}
    </div>
  );
}

export default function MissingOrders() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentStoreId } = useStore();
  const { locale, isRTL, select, formatDateTime, formatNumber, formatTime } =
    useLocale();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const fetchPromiseRef = useRef(null);
  const isInStockFollowUpView =
    location.pathname === "/orders/in-stock-follow-up";
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey("missing-orders:list", currentStoreId),
    [currentStoreId],
  );

  const pageConfig = useMemo(
    () =>
      isInStockFollowUpView
        ? {
            title: select(
              "طلبات المخزون المتاح",
              "In-Stock Follow-Up Orders",
            ),
            description: select(
              "هذه الطلبات مغطاة بالكامل من مخزون المخزن، لكنها بقيت 3 أيام أو أكثر بدون أي إجراء أو comment مسجل، وبعد 6 أيام تتحول إلى حالة حرجة.",
              "These orders are fully covered by warehouse stock, but they stayed for 3 days or more without any recorded action or comment. After 6 days they become critical.",
            ),
            loadingText: select(
              "جاري تحميل طلبات المخزون المتاح...",
              "Loading in-stock follow-up orders...",
            ),
            emptyText: select(
              "لا توجد طلبات مخزون متاح بدون إجراء حاليًا.",
              "There are no in-stock follow-up orders right now.",
            ),
            legendText: select(
              "الأحمر = حالة حرجة، الأزرق = المخزون متاح لكن لا يوجد إجراء.",
              "Red = critical, blue = in stock with no action.",
            ),
            totalCardTitle: select(
              "إجمالي طلبات المخزون المتاح",
              "Total In-Stock Follow-Up",
            ),
            activeCardTitle: select(
              "بانتظار إجراء",
              "Awaiting Action",
            ),
            activeCardTone: "blue",
            activeCardIcon: Clock3,
          }
        : {
            title: select(
              "الطلبات الخارجة عن المخزون",
              "Out-of-Stock Orders",
            ),
            description: select(
              "أي طلب لا يغطيه مخزون المخزن بالكامل يبقى في قائمة الطلبات العادية أول 3 أيام، ثم ينتقل هنا تلقائيًا. وبعد 6 أيام يتحول إلى حالة حرجة.",
              "Orders whose warehouse stock is still not fully covered stay in the main list for 3 days, then move here automatically. After 6 days they become critical.",
            ),
            loadingText: select(
              "جاري تحميل الطلبات الخارجة عن المخزون...",
              "Loading out-of-stock orders...",
            ),
            emptyText: select(
              "لا توجد طلبات خارجة عن المخزون حاليًا.",
              "There are no out-of-stock orders right now.",
            ),
            legendText: select(
              "الأحمر = حالة حرجة، الأصفر = عجز مخزون.",
              "Red = critical, amber = stock shortage.",
            ),
            totalCardTitle: select(
              "إجمالي الطلبات الخارجة عن المخزون",
              "Total Out-of-Stock Orders",
            ),
            activeCardTitle: select(
              "تحتاج تغطية مخزون",
              "Needs Stock Coverage",
            ),
            activeCardTone: "amber",
            activeCardIcon: AlertTriangle,
          },
    [
      isInStockFollowUpView,
      select,
    ],
  );

  const formatDate = useCallback(
    (value) => {
      if (!value) return "-";
      return formatDateTime(value, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    [formatDateTime],
  );

  const fetchMissingOrders = useCallback(async ({ silent = false, force = false } = {}) => {
    if (fetchPromiseRef.current?.cacheKey === cacheKey) {
      return fetchPromiseRef.current.promise;
    }

    const request = (async () => {
      if (!force) {
        const cached = await readCachedView(cacheKey);
        const cachedRows = Array.isArray(cached?.value?.rows)
          ? cached.value.rows
          : [];

        if (cachedRows.length > 0 && isCacheFresh(cached, FOLLOW_UP_CACHE_FRESH_MS)) {
          setOrders(cachedRows);
          setLastUpdatedAt(
            cached?.updatedAt ? new Date(cached.updatedAt) : new Date(),
          );
          setLoading(false);
          setError("");
          return cachedRows;
        }
      }

      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const response = await shopifyAPI.getMissingOrders({
          limit: FETCH_PAGE_LIMIT,
          offset: 0,
          ...(force ? { cache_refresh: "1" } : {}),
        });
        const rows = extractArray(response?.data);

        setOrders(rows);
        setLastUpdatedAt(new Date());
        await writeCachedView(cacheKey, { rows });
        return rows;
      } catch (requestError) {
      console.error("Error fetching missing orders:", requestError);
      setError(
        requestError?.response?.data?.error ||
          select(
            "فشل تحميل الطلبات الخارجة عن المخزون",
            "Failed to load follow-up orders",
          ),
      );
    } finally {
      setLoading(false);
    }
    })();

    fetchPromiseRef.current = { cacheKey, promise: request };
    try {
      return await request;
    } finally {
      if (fetchPromiseRef.current?.promise === request) {
        fetchPromiseRef.current = null;
      }
    }
  }, [cacheKey, select]);

  useEffect(() => {
    let active = true;

    readCachedView(cacheKey).then((cached) => {
      if (!active) {
        return;
      }

      const cachedRows = Array.isArray(cached?.value?.rows)
        ? cached.value.rows
        : [];
      if (cachedRows.length === 0) {
        return;
      }

      setOrders(cachedRows);
      setLastUpdatedAt(
        cached?.updatedAt ? new Date(cached.updatedAt) : new Date(),
      );
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    fetchMissingOrders();
  }, [currentStoreId, fetchMissingOrders]);

  useEffect(() => {
    const unsubscribe = subscribeToSharedDataUpdates((event) => {
      if (String(event?.resource || "").toLowerCase() === "notifications") {
        return;
      }
      fetchMissingOrders({ silent: true, force: true });
    });

    return () => unsubscribe();
  }, [fetchMissingOrders]);

  const scopedOrders = useMemo(
    () =>
      orders.filter((order) =>
        isInStockFollowUpView
          ? isInStockNoActionOrder(order)
          : !isInStockNoActionOrder(order),
      ),
    [isInStockFollowUpView, orders],
  );

  const filteredOrders = useMemo(
    () => scopedOrders.filter((order) => matchesSearch(order, searchTerm)),
    [scopedOrders, searchTerm],
  );

  const summary = useMemo(() => {
    const escalatedCount = filteredOrders.filter(
      (order) => order?.missing_state === "escalated",
    ).length;

    return {
      total: filteredOrders.length,
      active: filteredOrders.length - escalatedCount,
      escalated: escalatedCount,
      stockShortage: filteredOrders.filter(
        (order) => !isInStockNoActionOrder(order),
      ).length,
      noAction: filteredOrders.filter((order) =>
        isInStockNoActionOrder(order),
      ).length,
    };
  }, [filteredOrders]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOrders.length / MISSING_ORDERS_PER_PAGE)),
    [filteredOrders.length],
  );

  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * MISSING_ORDERS_PER_PAGE;
    return filteredOrders.slice(
      startIndex,
      startIndex + MISSING_ORDERS_PER_PAGE,
    );
  }, [currentPage, filteredOrders, totalPages]);

  const visibleRange = useMemo(() => {
    if (filteredOrders.length === 0) {
      return { start: 0, end: 0 };
    }

    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * MISSING_ORDERS_PER_PAGE + 1;
    const end = Math.min(
      filteredOrders.length,
      safePage * MISSING_ORDERS_PER_PAGE,
    );

    return { start, end };
  }, [currentPage, filteredOrders.length, totalPages]);

  const paginationWindow = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const halfWindow = Math.floor(MISSING_ORDERS_PAGINATION_WINDOW / 2);
    let startPage = Math.max(1, safePage - halfWindow);
    let endPage = Math.min(
      totalPages,
      startPage + MISSING_ORDERS_PAGINATION_WINDOW - 1,
    );

    if (endPage - startPage + 1 < MISSING_ORDERS_PAGINATION_WINDOW) {
      startPage = Math.max(
        1,
        endPage - MISSING_ORDERS_PAGINATION_WINDOW + 1,
      );
    }

    const pages = [];
    for (let page = startPage; page <= endPage; page += 1) {
      pages.push(page);
    }

    return {
      startPage,
      endPage,
      pages,
    };
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, orders.length]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const rangeLabel = useMemo(
    () =>
      isInStockFollowUpView
        ? select(
            `عرض ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} من ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} طلب مخزون متاح`,
            `Showing ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} of ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} in-stock follow-up orders`,
          )
        : select(
            `عرض ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} من ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} طلب خارج المخزون`,
            `Showing ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} of ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} out-of-stock orders`,
          ),
    [
      filteredOrders.length,
      formatNumber,
      isInStockFollowUpView,
      select,
      visibleRange.end,
      visibleRange.start,
    ],
  );

  const tableHeaderAlignClass = isRTL ? "text-right" : "text-left";
  const stickyTableHeaderClass =
    "sticky top-0 z-20 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/85";

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={isRTL ? "text-right" : "text-left"}>
                <h1 className="text-3xl font-bold text-slate-900">
                  {select("الطلبات الخارجة عن المخزون", "Out-of-Stock Orders")}
                </h1>
                <p className="mt-1 text-slate-600">
                  {select(
                    "أي طلب لا يغطيه مخزون المخزن بالكامل يبقى في قائمة الطلبات العادية أول 3 أيام، ثم ينتقل هنا تلقائيًا. وإذا تجاوز 6 أيام يتحول إلى حالة حرجة.",
                    "Orders with warehouse stock shortages, plus orders that are fully in stock but still have no recorded action, stay in the main list for 3 days and then move here automatically. After 6 days they become critical.",
                  )}
                </p>
                {lastUpdatedAt ? (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    <Clock3 size={12} />
                    {select("آخر تحديث", "Last refresh")}{" "}
                    {formatTime(lastUpdatedAt, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => fetchMissingOrders({ force: true })}
                className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-white transition hover:bg-sky-800"
              >
                <RefreshCw size={18} />
                {select("تحديث", "Refresh")}
              </button>
            </div>
          </div>

          {isInStockFollowUpView ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 shadow-sm sm:p-6">
              <div className={isRTL ? "text-right" : "text-left"}>
                <h2 className="text-2xl font-bold text-sky-950">
                  {pageConfig.title}
                </h2>
                <p className="mt-1 text-sky-900/80">{pageConfig.description}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-sky-900/80">
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1">
                    {rangeLabel}
                  </span>
                  <span className="rounded-full border border-sky-200 bg-white px-3 py-1">
                    {pageConfig.legendText}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title={select(
                "إجمالي الطلبات الخارجة عن المخزون",
                "Total Follow-Up Orders",
              )}
              value={formatNumber(summary.total, {
                maximumFractionDigits: 0,
              })}
              tone="blue"
              icon={Search}
            />
            <SummaryCard
              title={select("حالات عجز المخزون", "Stock-Out Cases")}
              value={formatNumber(summary.stockShortage, {
                maximumFractionDigits: 0,
              })}
              tone="amber"
              icon={AlertTriangle}
            />
            <SummaryCard
              title={select(
                "Ø§Ù„Ù…Ø®Ø²ÙˆÙ† Ù…ØªØ§Ø­ ÙˆÙ„Ø§ ÙŠÙˆØ¬Ø¯ Ø¥Ø¬Ø±Ø§Ø¡",
                "In-Stock, No Action",
              )}
              value={formatNumber(summary.noAction, {
                maximumFractionDigits: 0,
              })}
              tone="blue"
              icon={Clock3}
            />
            <SummaryCard
              title={select("حالات حرجة", "Critical Cases")}
              value={formatNumber(summary.escalated, {
                maximumFractionDigits: 0,
              })}
              tone="red"
              icon={ShieldAlert}
            />
          </div>

          <div className="space-y-4 rounded-2xl bg-white p-4 shadow sm:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className={isRTL ? "text-right" : "text-left"}>
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("قائمة الطلبات", "Orders List")}
                </h2>
                <p className="text-sm text-slate-500">
                  {select(
                    "يتم عرض 50 طلبًا في الصفحة الواحدة مع هيدر ثابت لتسهيل مراجعة التفاصيل أثناء التمرير.",
                    "The page shows 50 orders at a time with a sticky header so the details stay clear while you scroll.",
                  )}
                </p>
              </div>

              <div className="relative w-full md:w-80">
                <Search
                  className={`absolute top-2.5 text-slate-400 ${
                    isRTL ? "right-3" : "left-3"
                  }`}
                  size={16}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={select(
                    "ابحث بالعميل أو الإيميل أو رقم الطلب",
                    "Search by customer, email, or order number",
                  )}
                  className={`w-full rounded-lg border border-slate-200 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                    isRTL ? "pr-8 pl-3 text-right" : "pl-8 pr-3 text-left"
                  }`}
                />
              </div>
            </div>

            {loading ? (
              <EmptyState
                text={select(
                  "جاري تحميل الطلبات الخارجة عن المخزون...",
                  "Loading follow-up orders...",
                )}
              />
            ) : filteredOrders.length === 0 ? (
              <EmptyState
                text={select(
                  "لا توجد طلبات خارجة عن المخزون حاليًا.",
                  "There are no follow-up orders right now.",
                )}
              />
            ) : (
              <>
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-slate-700">
                    {select(
                      `عرض ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} من ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} طلب خارج المخزون`,
                      `Showing ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} of ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} follow-up orders`,
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    {select(
                      "الأحمر = حالة حرجة، الأصفر = تحتاج متابعة.",
                      "Red = critical, amber = stock shortage, blue = in stock with no action.",
                    )}
                  </p>
                </div>

                <div className="hidden max-h-[68vh] overflow-auto rounded-2xl border border-slate-200 lg:block">
                  <table className="w-full min-w-[1180px] text-sm">
                    <colgroup>
                      <col className="w-[140px]" />
                      <col className="w-[260px]" />
                      <col className="w-[160px]" />
                      <col className="w-[140px]" />
                      <col className="w-[180px]" />
                      <col className="w-[180px]" />
                      <col className="w-[180px]" />
                      <col className="w-[120px]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("الطلب", "Order")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("العميل", "Customer")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("الحالة", "Status")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("سبب التنبيه", "Alert Reason")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("عمر الطلب", "Order Age")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("دخل القائمة", "Moved Here")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("الدفع / التسليم", "Payment / Fulfillment")}
                        </th>
                        <th className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}>
                          {select("التفاصيل", "Details")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {paginatedOrders.map((order) => {
                        const severityBadge = getSeverityBadge(order, locale);
                        const reasonBadge = getReasonBadge(order, locale);
                        const alertSummary = formatAlertSummary(
                          order,
                          select,
                          formatNumber,
                        );
                        const alertPreview = formatAlertPreview(order, select);
                        const fulfillmentStatus = getLocalizedStatusLabel(
                          normalizeStatus(order?.fulfillment_status, "unfulfilled"),
                          locale,
                          FULFILLMENT_STATUS_LABELS,
                        );
                        const paymentStatus = getLocalizedStatusLabel(
                          normalizeStatus(
                            order?.financial_status || order?.status,
                            "pending",
                          ),
                          locale,
                          PAYMENT_STATUS_LABELS,
                        );

                        return (
                          <tr
                            key={order.id}
                            className={`cursor-pointer transition hover:bg-slate-50 ${
                              order?.missing_state === "escalated"
                                ? "bg-red-50/45"
                                : isInStockNoActionOrder(order)
                                  ? "bg-sky-50/50"
                                  : "bg-amber-50/40"
                            }`}
                            onClick={() => navigate(`/orders/${order.id}`)}
                          >
                            <td className="px-4 py-4 align-top">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/orders/${order.id}`);
                                }}
                                className="font-semibold text-slate-900 transition hover:text-sky-700"
                              >
                                {select("طلب", "Order")} #
                                {order.order_number || order.shopify_id}
                              </button>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <p className="font-medium text-slate-900">
                                {order.customer_name ||
                                  select("عميل غير معروف", "Unknown customer")}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {order.customer_email || "-"}
                              </p>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="flex flex-wrap gap-2">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${severityBadge.className}`}>
                                  {severityBadge.label}
                                </span>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${reasonBadge.className}`}>
                                  {reasonBadge.label}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top text-sm text-slate-700">
                              <p className="font-medium text-slate-900">
                                {alertSummary}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {alertPreview}
                              </p>
                            </td>
                            <td className="px-4 py-4 align-top text-sm font-medium text-slate-700">
                              {formatOrderAge(order, select, formatNumber)}
                            </td>
                            <td className="px-4 py-4 align-top text-sm text-slate-700">
                              {formatDate(order.missing_since)}
                            </td>
                            <td className="px-4 py-4 align-top">
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                                  {paymentStatus}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                                  {fulfillmentStatus}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-4 align-top">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  navigate(`/orders/${order.id}`);
                                }}
                                className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 transition hover:text-sky-900"
                              >
                                <Eye size={15} />
                                {select("عرض", "View")}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 lg:hidden">
                  {paginatedOrders.map((order) => {
                    const severityBadge = getSeverityBadge(order, locale);
                    const reasonBadge = getReasonBadge(order, locale);
                    const alertSummary = formatAlertSummary(
                      order,
                      select,
                      formatNumber,
                    );
                    const alertPreview = formatAlertPreview(order, select);
                    const fulfillmentStatus = getLocalizedStatusLabel(
                      normalizeStatus(order?.fulfillment_status, "unfulfilled"),
                      locale,
                      FULFILLMENT_STATUS_LABELS,
                    );
                    const paymentStatus = getLocalizedStatusLabel(
                      normalizeStatus(
                        order?.financial_status || order?.status,
                        "pending",
                      ),
                      locale,
                      PAYMENT_STATUS_LABELS,
                    );

                    return (
                      <article
                        key={order.id}
                        className={`rounded-2xl border p-4 transition-shadow hover:shadow-md sm:p-5 ${getCardClassName(order)}`}
                      >
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => navigate(`/orders/${order.id}`)}
                                className="text-lg font-semibold text-slate-900 transition hover:text-sky-700"
                              >
                                {select("طلب", "Order")} #
                                {order.order_number || order.shopify_id}
                              </button>
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${severityBadge.className}`}>
                                {severityBadge.label}
                              </span>
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${reasonBadge.className}`}>
                                {reasonBadge.label}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                                {formatOrderAge(order, select, formatNumber)}
                              </span>
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                                {alertSummary}
                              </span>
                            </div>

                            <div className="space-y-1 text-sm text-slate-700">
                              <p className="font-medium text-slate-900">
                                {order.customer_name ||
                                  select("عميل غير معروف", "Unknown customer")}
                              </p>
                              <p>{order.customer_email || "-"}</p>
                              {alertPreview ? (
                                <p className="text-xs text-slate-500">
                                  {alertPreview}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:min-w-[32rem] xl:grid-cols-4">
                            <InfoBox
                              label={select("سبب التنبيه", "Alert Reason")}
                              value={alertSummary}
                            />
                            <InfoBox
                              label={select("عمر الطلب", "Order Age")}
                              value={formatOrderAge(order, select, formatNumber)}
                            />
                            <InfoBox
                              label={select("دخل القائمة", "Moved Here")}
                              value={formatDate(order.missing_since)}
                            />
                            <InfoBox
                              label={select("الدفع / التسليم", "Payment / Fulfillment")}
                              value={`${paymentStatus} / ${fulfillmentStatus}`}
                            />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-600">
                    {select(
                      `عرض ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} من ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} طلب`,
                      `Showing ${formatNumber(visibleRange.start, { maximumFractionDigits: 0 })} - ${formatNumber(visibleRange.end, { maximumFractionDigits: 0 })} of ${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} orders`,
                    )}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      disabled={currentPage <= 1}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {select("السابق", "Previous")}
                    </button>

                    {paginationWindow.startPage > 1 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setCurrentPage(1)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          1
                        </button>
                        {paginationWindow.startPage > 2 ? (
                          <span className="px-1 text-sm text-slate-400">...</span>
                        ) : null}
                      </>
                    ) : null}

                    {paginationWindow.pages.map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setCurrentPage(pageNumber)}
                        className={`rounded-lg px-3 py-2 text-sm font-medium ${
                          pageNumber === currentPage
                            ? "bg-sky-700 text-white shadow-sm"
                            : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {formatNumber(pageNumber, {
                          maximumFractionDigits: 0,
                        })}
                      </button>
                    ))}

                    {paginationWindow.endPage < totalPages ? (
                      <>
                        {paginationWindow.endPage < totalPages - 1 ? (
                          <span className="px-1 text-sm text-slate-400">...</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setCurrentPage(totalPages)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {formatNumber(totalPages, {
                            maximumFractionDigits: 0,
                          })}
                        </button>
                      </>
                    ) : null}

                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage((page) => Math.min(totalPages, page + 1))
                      }
                      disabled={currentPage >= totalPages}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {select("التالي", "Next")}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
