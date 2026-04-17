import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Clock3,
  Download,
  Eye,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingCart,
  TrendingUp,
  Truck,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import OrdersExportPanel from "../components/OrdersExportPanel";
import { shopifyAPI } from "../utils/api";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { fetchAllPagesProgressively } from "../utils/pagination";
import { useLocale } from "../context/LocaleContext";
import { useStore } from "../context/StoreContext";
import {
  HEAVY_VIEW_CACHE_FRESH_MS,
  shouldAutoRefreshView,
} from "../utils/refreshPolicy";
import {
  buildOrdersListApiParams,
  hasActiveOrdersListFilters,
} from "../utils/orderScope";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  peekCachedView,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";
import {
  isShippingIssueClosed,
  isShippingIssueActive,
} from "../utils/shippingIssues";

const LIVE_REFRESH_DEBOUNCE_MS = 450;
const ORDERS_PAGE_FETCH_SIZE = 200;
const ORDER_HISTORY_SEARCH_PAGE_SIZE = 1000;
const MISSING_ORDERS_FETCH_PAGE_SIZE = 4500;
const ORDERS_VISIBLE_LIMIT = 1000;
const ORDERS_PER_PAGE = 50;
const ORDERS_PAGINATION_WINDOW = 5;
const ORDERS_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const MISSING_ORDER_REASON_NO_ACTION = "in_stock_without_action";

const INITIAL_FILTERS = {
  searchTerm: "",
  dateFrom: "",
  dateTo: "",
  orderNumberFrom: "",
  orderNumberTo: "",
  amountMin: "",
  amountMax: "",
  paymentFilter: "all",
  paymentMethodFilter: "all",
  fulfillmentFilter: "all",
  refundFilter: "all",
  cancelledOnly: false,
  fulfilledOnly: false,
  paidOnly: false,
  sortBy: "newest",
};

const ORDER_DATE_PRESET_IDS = [
  "all",
  "today",
  "yesterday",
  "weekly",
  "half_monthly",
  "monthly",
];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSearchValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizePhoneSearch = (value) =>
  String(value || "").replace(/\D/g, "");

const normalizeOrderNumberSearch = (value) =>
  String(value || "").replace(/[^\d]/g, "");

const parseLocalDateInput = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const parseOrderDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getNormalizedDateRange = (dateFrom, dateTo) => {
  const from = dateFrom ? startOfDay(dateFrom) : null;
  const to = dateTo ? endOfDay(dateTo) : null;

  if (from && to && from.getTime() > to.getTime()) {
    return {
      from: startOfDay(dateTo),
      to: endOfDay(dateFrom),
      wasSwapped: true,
    };
  }

  return {
    from,
    to,
    wasSwapped: false,
  };
};

const isNumericSearchToken = (value) => /^\d+$/.test(String(value || "").trim());

const isLikelyOrderNumberToken = (value) =>
  /^#?\d{3,6}$/.test(String(value || "").trim());

const splitSearchTokens = (value) =>
  Array.from(
    new Set(
      normalizeSearchValue(value)
        .split(/\s+/)
        .filter(Boolean),
    ),
  );

const parseJsonObject = (value) => {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const buildOrderSearchIndex = (order) => {
  const parsedData = parseJsonObject(order?.data);
  const lineItems = Array.isArray(parsedData?.line_items) ? parsedData.line_items : [];
  const itemPreviewTitles = Array.isArray(order?.item_previews)
    ? order.item_previews.map((item) => item?.title)
    : [];
  const phoneValues = [
    order?.customer_phone,
    parsedData?.customer?.phone,
    parsedData?.shipping_address?.phone,
    parsedData?.billing_address?.phone,
  ]
    .map(normalizePhoneSearch)
    .filter(Boolean);
  const orderNumberTextValues = [
    order?.order_number,
    parsedData?.order_number,
    parsedData?.name,
  ]
    .map(normalizeSearchValue)
    .filter(Boolean);
  const orderNumberValues = [
    order?.order_number,
    parsedData?.order_number,
    parsedData?.name,
  ]
    .map(normalizeOrderNumberSearch)
    .filter(Boolean);
  const searchValues = [
    order?.customer_name,
    order?.customer_email,
    order?.shopify_id,
    order?.financial_status,
    order?.fulfillment_status,
    order?.payment_method,
    order?.status,
    parsedData?.name,
    parsedData?.tags,
    parsedData?.note,
    parsedData?.customer?.first_name,
    parsedData?.customer?.last_name,
    parsedData?.customer?.email,
    parsedData?.shipping_address?.name,
    parsedData?.shipping_address?.address1,
    parsedData?.shipping_address?.address2,
    parsedData?.shipping_address?.city,
    parsedData?.shipping_address?.province,
    parsedData?.shipping_address?.country,
    parsedData?.shipping_address?.zip,
    parsedData?.billing_address?.name,
    parsedData?.billing_address?.address1,
    parsedData?.billing_address?.address2,
    parsedData?.billing_address?.city,
    parsedData?.billing_address?.province,
    parsedData?.billing_address?.country,
    parsedData?.billing_address?.zip,
    ...itemPreviewTitles,
    ...lineItems.flatMap((item) => [
      item?.title,
      item?.name,
      item?.variant_title,
      item?.sku,
      item?.vendor,
      item?.fulfillment_status,
    ]),
  ]
    .map(normalizeSearchValue)
    .filter(Boolean);

  return {
    textValues: Array.from(new Set([...searchValues, ...orderNumberTextValues])),
    phoneValues: Array.from(new Set(phoneValues)),
    orderNumberValues: Array.from(new Set(orderNumberValues)),
  };
};

const matchesOrderSearch = (searchIndex, searchTerm) => {
  const tokens = splitSearchTokens(searchTerm);
  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    const normalizedPhoneToken = normalizePhoneSearch(token);
    const normalizedOrderToken = normalizeOrderNumberSearch(token);

    if (isLikelyOrderNumberToken(token)) {
      return searchIndex.orderNumberValues.some((value) =>
        value.includes(normalizedOrderToken),
      );
    }

    if (isNumericSearchToken(token) && normalizedPhoneToken.length >= 7) {
      return (
        searchIndex.phoneValues.some((value) =>
          value.includes(normalizedPhoneToken),
        ) ||
        searchIndex.orderNumberValues.some((value) =>
          value.includes(normalizedPhoneToken),
        )
      );
    }

    return (
      searchIndex.textValues.some((value) => value.includes(token)) ||
      (normalizedPhoneToken.length >= 7 &&
        searchIndex.phoneValues.some((value) =>
          value.includes(normalizedPhoneToken),
        )) ||
      (token.startsWith("#") &&
        normalizedOrderToken &&
        searchIndex.orderNumberValues.some((value) =>
          value.includes(normalizedOrderToken),
        ))
    );
  });
};

const PAYMENT_METHOD_LABELS = {
  shopify: "Shopify",
  instapay: "InstaPay",
  wallet: "Wallet",
  none: "None",
};
const PAID_LIKE_STATUSES = new Set([
  "paid",
  "partially_paid",
  "partially_refunded",
  "refunded",
]);
const normalizeOrderState = (value) =>
  String(value || "")
    .toLowerCase()
    .trim();
const isOrdersRelatedSharedUpdate = (event) => {
  const source = String(event?.source || "").toLowerCase();
  if (!source) {
    return true;
  }

  return (
    source.includes("/shopify/orders") ||
    source.includes("/orders/") ||
    source.includes("/order-comments")
  );
};

const getOrderMeta = (order) => {
  const paymentStatus = normalizeOrderState(
    order.financial_status || order.status,
  );
  const fulfillmentStatus = normalizeOrderState(order.fulfillment_status);
  const totalPrice = toNumber(order.total_price);
  const refundedAmount = Math.max(
    toNumber(order.refunded_amount),
    toNumber(order.total_refunded),
  );
  const isCancelled =
    Boolean(order.is_cancelled) ||
    paymentStatus === "voided" ||
    paymentStatus === "cancelled";
  const hasAnyRefund = Boolean(order.has_any_refund) || refundedAmount > 0;
  const isPartialRefund =
    Boolean(order.is_partial_refund) ||
    (hasAnyRefund && refundedAmount > 0 && refundedAmount < totalPrice);
  const isFullRefund =
    Boolean(order.is_full_refund) ||
    (hasAnyRefund && totalPrice > 0 && refundedAmount >= totalPrice);
  const isPaid = Boolean(order.is_paid);
  const isPaidLike = Boolean(order.is_paid_like) || PAID_LIKE_STATUSES.has(paymentStatus);
  const isFulfilled = Boolean(order.is_fulfilled) || fulfillmentStatus === "fulfilled";
  const paymentMethod = normalizeOrderState(order.payment_method || "none") || "none";
  const netSalesAmount =
    order.net_sales_amount !== undefined && order.net_sales_amount !== null
      ? toNumber(order.net_sales_amount)
      : isCancelled || !isPaidLike
        ? 0
        : Math.max(0, totalPrice - refundedAmount);

  return {
    paymentStatus,
    fulfillmentStatus,
    refundedAmount,
    totalPrice,
    isCancelled,
    hasAnyRefund,
    isPartialRefund,
    isFullRefund,
    isPaid,
    isPaidLike,
    isFulfilled,
    paymentMethod,
    netSalesAmount,
    orderNumberNumeric: toNumber(order.order_number),
    createdAtDate: parseOrderDate(order.created_at),
  };
};

const startOfDay = (dateString) => {
  const date = parseLocalDateInput(dateString);
  if (!date) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (dateString) => {
  const date = parseLocalDateInput(dateString);
  if (!date) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
};

const formatDateInputValue = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDateByDays = (date, days) => {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const getOrderDatePresetRange = (presetId, now = new Date()) => {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  switch (presetId) {
    case "today":
      return {
        dateFrom: formatDateInputValue(today),
        dateTo: formatDateInputValue(today),
      };
    case "yesterday": {
      const yesterday = shiftDateByDays(today, -1);
      return {
        dateFrom: formatDateInputValue(yesterday),
        dateTo: formatDateInputValue(yesterday),
      };
    }
    case "weekly": {
      const fromDate = shiftDateByDays(today, -6);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    case "half_monthly": {
      const fromDate = shiftDateByDays(today, -14);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    case "monthly": {
      const fromDate = shiftDateByDays(today, -29);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    case "all":
    default:
      return {
        dateFrom: "",
        dateTo: "",
      };
  }
};

const resolveOrderDatePreset = (dateFrom, dateTo, now = new Date()) => {
  const normalizedDateFrom = String(dateFrom || "").trim();
  const normalizedDateTo = String(dateTo || "").trim();

  if (!normalizedDateFrom && !normalizedDateTo) {
    return "all";
  }

  for (const presetId of ORDER_DATE_PRESET_IDS.filter((value) => value !== "all")) {
    const presetRange = getOrderDatePresetRange(presetId, now);
    if (
      presetRange.dateFrom === normalizedDateFrom &&
      presetRange.dateTo === normalizedDateTo
    ) {
      return presetId;
    }
  }

  return "custom";
};

export default function Orders() {
  const navigate = useNavigate();
  const { currentStoreId } = useStore();
  const {
    select,
    isRTL,
    formatCurrency: formatAmount,
    formatDateTime,
    formatNumber,
    formatTime,
  } = useLocale();
  const tableHeaderAlignClass = isRTL ? "text-right" : "text-left";
  const stickyTableHeaderClass =
    "sticky top-0 z-20 bg-slate-50/95 backdrop-blur supports-[backdrop-filter]:bg-slate-50/85";
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey("orders:list", currentStoreId),
    [currentStoreId],
  );
  const missingOrdersCacheKey = useMemo(
    () => buildStoreScopedCacheKey("missing-orders:list", currentStoreId),
    [currentStoreId],
  );
  const initialCachedSnapshot = useMemo(() => {
    const cached = peekCachedView(cacheKey);
    return {
      rows: Array.isArray(cached?.value?.rows)
        ? cached.value.rows.slice(0, ORDERS_VISIBLE_LIMIT)
        : [],
      updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
    };
  }, [cacheKey]);
  const [orders, setOrders] = useState(() => initialCachedSnapshot.rows);
  const [missingOrderIds, setMissingOrderIds] = useState([]);
  const [missingOrdersSummary, setMissingOrdersSummary] = useState({
    total: 0,
    stockShortage: 0,
    noAction: 0,
  });
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    () => initialCachedSnapshot.updatedAt,
  );
  const [lastLiveEventAt, setLastLiveEventAt] = useState(null);
  const [fullHistorySearchOrders, setFullHistorySearchOrders] = useState(null);
  const [fullHistorySearchError, setFullHistorySearchError] = useState("");
  const [fullHistorySearchLoading, setFullHistorySearchLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState({
    active: false,
    message: "",
  });
  const deferredSearchTerm = useDeferredValue(filters.searchTerm);
  const refreshTimeoutRef = useRef(null);
  const fetchPromiseRef = useRef(null);
  const missingFetchPromiseRef = useRef(null);
  const fullHistorySearchRequestIdRef = useRef(0);
  const ordersRef = useRef([]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const fullHistoryQueryParams = useMemo(
    () =>
      buildOrdersListApiParams({
        ...filters,
        searchTerm: deferredSearchTerm,
      }),
    [deferredSearchTerm, filters],
  );

  const shouldUseFullHistory = useMemo(
    () =>
      hasActiveOrdersListFilters({
        ...filters,
        searchTerm: deferredSearchTerm,
      }),
    [deferredSearchTerm, filters],
  );

  useEffect(() => {
    if (!shouldUseFullHistory) {
      fullHistorySearchRequestIdRef.current += 1;
      setFullHistorySearchOrders(null);
      setFullHistorySearchError("");
      setFullHistorySearchLoading(false);
      return undefined;
    }

    const requestId = fullHistorySearchRequestIdRef.current + 1;
    fullHistorySearchRequestIdRef.current = requestId;
    let active = true;

    setFullHistorySearchLoading(true);
    setFullHistorySearchError("");
    setFullHistorySearchOrders(null);
    setLoadStatus({
      active: true,
      message: select(
        "جاري فحص كل تاريخ أوردرات المتجر حسب البحث والفلاتر الحالية...",
        "Scanning the full store order history with the active search and filters...",
      ),
    });

    fetchAllPagesProgressively(
      ({ limit, offset }) =>
        shopifyAPI.getOrders({
          limit,
          offset,
          ...fullHistoryQueryParams,
          search_all: "true",
        }),
      {
        limit: ORDER_HISTORY_SEARCH_PAGE_SIZE,
        onPage: ({ rows, hasMore }) => {
          if (!active || requestId !== fullHistorySearchRequestIdRef.current) {
            return false;
          }

          setFullHistorySearchOrders(rows);
          setLoadStatus({
            active: hasMore,
            message: hasMore
              ? select(
                  `تم العثور على ${formatNumber(rows.length, { maximumFractionDigits: 0 })} طلب حتى الآن من كل تاريخ المتجر...`,
                  `Found ${formatNumber(rows.length, { maximumFractionDigits: 0 })} matching orders from full store history so far...`,
                )
              : select(
                  `تم تحميل ${formatNumber(rows.length, { maximumFractionDigits: 0 })} طلب مطابق من كل تاريخ المتجر.`,
                  `Loaded ${formatNumber(rows.length, { maximumFractionDigits: 0 })} matching orders from full store history.`,
                ),
          });

          return true;
        },
      },
    )
      .then((rows) => {
        if (!active || requestId !== fullHistorySearchRequestIdRef.current) {
          return;
        }

        setFullHistorySearchOrders(rows);
        setFullHistorySearchLoading(false);
        setLoadStatus({
          active: false,
          message:
            rows.length > 0
              ? select(
                  `تم تحميل ${formatNumber(rows.length, { maximumFractionDigits: 0 })} طلب مطابق من كل تاريخ المتجر.`,
                  `Loaded ${formatNumber(rows.length, { maximumFractionDigits: 0 })} matching orders from full store history.`,
                )
              : select(
                  "لم يتم العثور على طلبات مطابقة في كل تاريخ المتجر.",
                  "No matching orders were found across full store history.",
                ),
        });
      })
      .catch((searchError) => {
        if (!active || requestId !== fullHistorySearchRequestIdRef.current) {
          return;
        }

        console.error("Error searching orders across full history:", searchError);
        setFullHistorySearchOrders(null);
        setFullHistorySearchLoading(false);
        setFullHistorySearchError(
          select(
            "تعذر البحث في كل تاريخ المتجر. يتم الآن عرض النتائج من الطلبات المحملة فقط.",
            "Couldn't search the full store history. Showing results from loaded orders only.",
          ),
        );
        setLoadStatus((current) =>
          current.active
            ? { active: false, message: "" }
            : current,
        );
      });

    return () => {
      active = false;
    };
  }, [
    currentStoreId,
    deferredSearchTerm,
    formatNumber,
    fullHistoryQueryParams,
    select,
    shouldUseFullHistory,
  ]);

  useEffect(() => {
    let active = true;

    readCachedView(cacheKey).then((cached) => {
      const cachedRows = Array.isArray(cached?.value?.rows)
        ? cached.value.rows.slice(0, ORDERS_VISIBLE_LIMIT)
        : [];
      if (!active || cachedRows.length === 0 || cachedRows.length <= ordersRef.current.length) {
        return;
      }

      setOrders(cachedRows);
      setLastUpdatedAt(
        cached?.updatedAt ? new Date(cached.updatedAt) : new Date(),
      );
      setLoadStatus({
        active: false,
        message: `Showing ${formatNumber(cachedRows.length, { maximumFractionDigits: 0 })} cached orders`,
      });
    });

    return () => {
      active = false;
    };
  }, [cacheKey, formatNumber]);

  const fetchMissingOrderIds = useCallback(async ({ force = false } = {}) => {
    if (missingFetchPromiseRef.current) {
      return missingFetchPromiseRef.current;
    }

    const request = (async () => {
      try {
        if (!force) {
          const cached = await readCachedView(missingOrdersCacheKey);
          const cachedRows = Array.isArray(cached?.value?.rows)
            ? cached.value.rows
            : [];

          if (
            cachedRows.length > 0 &&
            isCacheFresh(cached, ORDERS_CACHE_FRESH_MS)
          ) {
            setMissingOrderIds(
              cachedRows
                .map((order) => String(order?.id || "").trim())
                .filter(Boolean),
            );
            setMissingOrdersSummary({
              total: cachedRows.length,
              stockShortage: cachedRows.filter(
                (order) =>
                  String(order?.missing_reason || "").trim().toLowerCase() !==
                  MISSING_ORDER_REASON_NO_ACTION,
              ).length,
              noAction: cachedRows.filter(
                (order) =>
                  String(order?.missing_reason || "").trim().toLowerCase() ===
                  MISSING_ORDER_REASON_NO_ACTION,
              ).length,
            });
            return cachedRows;
          }
        }

        const rows = await fetchAllPagesProgressively(
          ({ limit, offset }) =>
            shopifyAPI.getMissingOrders({
              limit,
              offset,
              ...(force ? { cache_refresh: "1" } : {}),
            }),
          {
            limit: MISSING_ORDERS_FETCH_PAGE_SIZE,
          },
        );

        setMissingOrderIds(
          rows
            .map((order) => String(order?.id || "").trim())
            .filter(Boolean),
        );
        setMissingOrdersSummary({
          total: rows.length,
          stockShortage: rows.filter(
            (order) =>
              String(order?.missing_reason || "").trim().toLowerCase() !==
              MISSING_ORDER_REASON_NO_ACTION,
          ).length,
          noAction: rows.filter(
            (order) =>
              String(order?.missing_reason || "").trim().toLowerCase() ===
              MISSING_ORDER_REASON_NO_ACTION,
          ).length,
        });
        await writeCachedView(missingOrdersCacheKey, { rows });
        return rows;
      } catch (missingError) {
        console.error("Error fetching missing orders:", missingError);
      }
    })();

    missingFetchPromiseRef.current = request;

    try {
      await request;
    } finally {
      missingFetchPromiseRef.current = null;
    }
  }, [missingOrdersCacheKey]);

  const fetchOrders = useCallback(async ({ silent = false, forceSync = false } = {}) => {
    if (fetchPromiseRef.current) {
      return fetchPromiseRef.current;
    }

    const request = (async () => {
      if (!silent) {
        setLoading(Boolean(forceSync));
        setError("");
      }

      setLoadStatus({
        active: true,
        message: forceSync
          ? select(
              `\u062c\u0627\u0631\u064d \u062a\u062d\u062f\u064a\u062b \u0637\u0644\u0628\u0627\u062a Shopify \u0648\u062a\u062d\u0645\u064a\u0644 \u0622\u062e\u0631 ${formatNumber(ORDERS_VISIBLE_LIMIT, {
                maximumFractionDigits: 0,
              })} \u0637\u0644\u0628...`,
              `Refreshing Shopify orders and loading the latest ${formatNumber(ORDERS_VISIBLE_LIMIT, { maximumFractionDigits: 0 })} orders...`,
            )
          : select(
              `\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0622\u062e\u0631 ${formatNumber(ORDERS_VISIBLE_LIMIT, {
                maximumFractionDigits: 0,
              })} \u0637\u0644\u0628...`,
              `Loading the latest ${formatNumber(ORDERS_VISIBLE_LIMIT, { maximumFractionDigits: 0 })} orders...`,
            ),
      });

      try {
        void fetchMissingOrderIds({ force: forceSync });

        const rows = await fetchAllPagesProgressively(
          ({ limit, offset }) =>
            shopifyAPI.getOrders({
              limit,
              offset,
              sort_by: "created_at",
              sort_dir: "desc",
              sync_recent: forceSync && offset === 0 ? "force" : "false",
            }),
          {
            limit: ORDERS_PAGE_FETCH_SIZE,
            onPage: ({ rows: accumulatedRows, hasMore }) => {
              const visibleRows = accumulatedRows.slice(0, ORDERS_VISIBLE_LIMIT);

              setOrders(visibleRows);
              setLastUpdatedAt(new Date());
              setLoadStatus({
                active: hasMore && visibleRows.length < ORDERS_VISIBLE_LIMIT,
                message: hasMore && visibleRows.length < ORDERS_VISIBLE_LIMIT
                  ? `Loaded ${formatNumber(visibleRows.length, { maximumFractionDigits: 0 })} recent orders so far...`
                  : `Loaded ${formatNumber(visibleRows.length, { maximumFractionDigits: 0 })} recent orders`,
              });

              return visibleRows.length < ORDERS_VISIBLE_LIMIT;
            },
          },
        );

        const visibleRows = rows.slice(0, ORDERS_VISIBLE_LIMIT);

        setOrders(visibleRows);
        setLastUpdatedAt(new Date());
        setLoadStatus({
          active: false,
          message:
            visibleRows.length > 0
              ? `Loaded ${formatNumber(visibleRows.length, { maximumFractionDigits: 0 })} recent orders`
              : "No orders found",
        });
        await writeCachedView(cacheKey, {
          rows: visibleRows,
        });
      } catch (requestError) {
        console.error("Error fetching orders:", requestError);
        if (!silent) {
          if (ordersRef.current.length === 0) {
            setOrders([]);
            setError("Failed to load orders");
          } else {
            setError("Showing saved orders while refresh failed");
          }
        }
        setLoadStatus((current) =>
          current.message && ordersRef.current.length > 0
            ? { active: false, message: current.message }
            : { active: false, message: "" },
        );
      } finally {
        if (!silent && forceSync) {
          setLoading(false);
        }
      }
    })();

    fetchPromiseRef.current = request;

    try {
      await request;
    } finally {
      fetchPromiseRef.current = null;
    }
  }, [cacheKey, fetchMissingOrderIds, formatNumber, select]);

  const scheduleSilentRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) {
      return;
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      fetchOrders({ silent: true });
    }, LIVE_REFRESH_DEBOUNCE_MS);
  }, [fetchOrders]);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const cached = await readCachedView(cacheKey);
      if (!active) {
        return;
      }

      void fetchMissingOrderIds();

      const hasCachedRows = Array.isArray(cached?.value?.rows) && cached.value.rows.length > 0;
      if (!hasCachedRows && !isCacheFresh(cached, ORDERS_CACHE_FRESH_MS)) {
        await fetchOrders({ silent: true });
      }
    })();

    let unsubscribe = () => {};
    let onFocus = null;
    let interval = null;

    if (shouldAutoRefreshView()) {
      unsubscribe = subscribeToSharedDataUpdates((event) => {
        if (!isOrdersRelatedSharedUpdate(event)) {
          return;
        }

        setLastLiveEventAt(new Date());
        scheduleSilentRefresh();
      });

      interval = setInterval(() => {
        if (document.visibilityState !== "visible") {
          return;
        }

        scheduleSilentRefresh();
      }, ORDERS_CACHE_FRESH_MS);

      onFocus = async () => {
        const cached = await readCachedView(cacheKey);
        if (isCacheFresh(cached, ORDERS_CACHE_FRESH_MS)) {
          return;
        }

        scheduleSilentRefresh();
      };
      window.addEventListener("focus", onFocus);
    }

    return () => {
      active = false;
      if (interval) {
        clearInterval(interval);
      }
      unsubscribe();
      if (onFocus) {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [cacheKey, fetchMissingOrderIds, fetchOrders, scheduleSilentRefresh]);

  const activeOrders = useMemo(
    () => fullHistorySearchOrders ?? orders,
    [fullHistorySearchOrders, orders],
  );

  const missingOrderIdSet = useMemo(
    () => new Set(missingOrderIds),
    [missingOrderIds],
  );

  const selectedOrderIdSet = useMemo(
    () => new Set(selectedOrderIds),
    [selectedOrderIds],
  );

  const ordersWithMeta = useMemo(
    () =>
      activeOrders.map((order) => ({
        ...order,
        _meta: getOrderMeta(order),
        _searchIndex: buildOrderSearchIndex(order),
      })),
    [activeOrders],
  );

  const shippingIssueOrders = useMemo(
    () => ordersWithMeta.filter((order) => isShippingIssueActive(order)),
    [ordersWithMeta],
  );

  const shippingIssueIdSet = useMemo(
    () =>
      new Set(
        shippingIssueOrders
          .map((order) => String(order?.id || "").trim())
          .filter(Boolean),
      ),
    [shippingIssueOrders],
  );

  const shippingIssuesSummary = useMemo(
    () => ({
      total: shippingIssueOrders.length,
      openFollowUp: shippingIssueOrders.filter(
        (order) => !isShippingIssueClosed(order?.shipping_issue?.reason),
      ).length,
    }),
    [shippingIssueOrders],
  );

  const normalizedDateRange = useMemo(
    () => getNormalizedDateRange(filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo],
  );

  const filteredOrders = useMemo(() => {
    let result = ordersWithMeta.filter(
      (order) =>
        !missingOrderIdSet.has(String(order?.id || "").trim()) &&
        !shippingIssueIdSet.has(String(order?.id || "").trim()),
    );

    if (deferredSearchTerm.trim()) {
      result = result.filter((order) => {
        return matchesOrderSearch(order._searchIndex, deferredSearchTerm);
      });
    }

    if (normalizedDateRange.from) {
      result = result.filter((order) => {
        const orderDate = order._meta.createdAtDate;
        return orderDate && orderDate >= normalizedDateRange.from;
      });
    }

    if (normalizedDateRange.to) {
      result = result.filter((order) => {
        const orderDate = order._meta.createdAtDate;
        return orderDate && orderDate <= normalizedDateRange.to;
      });
    }

    if (filters.orderNumberFrom) {
      const minOrderNumber = toNumber(filters.orderNumberFrom);
      result = result.filter(
        (order) => order._meta.orderNumberNumeric >= minOrderNumber,
      );
    }

    if (filters.orderNumberTo) {
      const maxOrderNumber = toNumber(filters.orderNumberTo);
      result = result.filter(
        (order) => order._meta.orderNumberNumeric <= maxOrderNumber,
      );
    }

    if (filters.amountMin) {
      const minAmount = toNumber(filters.amountMin);
      result = result.filter((order) => order._meta.totalPrice >= minAmount);
    }

    if (filters.amountMax) {
      const maxAmount = toNumber(filters.amountMax);
      result = result.filter((order) => order._meta.totalPrice <= maxAmount);
    }

    if (filters.paymentFilter !== "all") {
      result = result.filter((order) => {
        const status = order._meta.paymentStatus;
        if (filters.paymentFilter === "pending_or_authorized") {
          return status === "pending" || status === "authorized";
        }
        if (filters.paymentFilter === "paid_or_partial") {
          return status === "paid" || status === "partially_paid";
        }
        return status === filters.paymentFilter;
      });
    }

    if (filters.paymentMethodFilter !== "all") {
      result = result.filter(
        (order) => order._meta.paymentMethod === filters.paymentMethodFilter,
      );
    }

    if (filters.fulfillmentFilter !== "all") {
      result = result.filter((order) => {
        const status = order._meta.fulfillmentStatus;
        if (filters.fulfillmentFilter === "unfulfilled") {
          return !status || status === "unfulfilled" || status === "null";
        }
        return status === filters.fulfillmentFilter;
      });
    }

    if (filters.refundFilter !== "all") {
      result = result.filter((order) => {
        if (filters.refundFilter === "any") return order._meta.hasAnyRefund;
        if (filters.refundFilter === "partial") return order._meta.isPartialRefund;
        if (filters.refundFilter === "full") return order._meta.isFullRefund;
        if (filters.refundFilter === "none") return !order._meta.hasAnyRefund;
        return true;
      });
    }

    if (filters.cancelledOnly) {
      result = result.filter((order) => order._meta.isCancelled);
    }

    if (filters.fulfilledOnly) {
      result = result.filter((order) => order._meta.isFulfilled);
    }

    if (filters.paidOnly) {
      result = result.filter((order) => order._meta.isPaid);
    }

    result.sort((a, b) => {
      switch (filters.sortBy) {
        case "oldest":
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case "amount_desc":
          return b._meta.totalPrice - a._meta.totalPrice;
        case "amount_asc":
          return a._meta.totalPrice - b._meta.totalPrice;
        case "order_desc":
          return b._meta.orderNumberNumeric - a._meta.orderNumberNumeric;
        case "order_asc":
          return a._meta.orderNumberNumeric - b._meta.orderNumberNumeric;
        case "newest":
        default:
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
      }
    });

    return result;
  }, [
    deferredSearchTerm,
    filters,
    missingOrderIdSet,
    normalizedDateRange,
    ordersWithMeta,
    shippingIssueIdSet,
  ]);

  const selectableOrders = useMemo(
    () =>
      ordersWithMeta.filter(
        (order) =>
          !missingOrderIdSet.has(String(order?.id || "").trim()) &&
          !shippingIssueIdSet.has(String(order?.id || "").trim()),
      ),
    [missingOrderIdSet, ordersWithMeta, shippingIssueIdSet],
  );

  const selectedOrders = useMemo(
    () =>
      selectableOrders.filter((order) =>
        selectedOrderIdSet.has(String(order?.id || "").trim()),
      ),
    [selectableOrders, selectedOrderIdSet],
  );

  useEffect(() => {
    const selectableOrderIds = new Set(
      selectableOrders
        .map((order) => String(order?.id || "").trim())
        .filter(Boolean),
    );

    setSelectedOrderIds((current) =>
      current.filter((orderId) => selectableOrderIds.has(orderId)),
    );
  }, [selectableOrders]);

  const allFilteredOrdersSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((order) =>
      selectedOrderIdSet.has(String(order?.id || "").trim()),
    );

  const summary = useMemo(() => {
    const totalOrderValue = filteredOrders.reduce(
      (sum, order) => sum + order._meta.totalPrice,
      0,
    );
    const netSales = filteredOrders.reduce(
      (sum, order) => sum + order._meta.netSalesAmount,
      0,
    );
    const paidCount = filteredOrders.filter((order) => order._meta.isPaid).length;
    const fulfilledCount = filteredOrders.filter(
      (order) => order._meta.isFulfilled,
    ).length;
    const refundedCount = filteredOrders.filter(
      (order) => order._meta.hasAnyRefund,
    ).length;

    return {
      totalOrders: filteredOrders.length,
      totalOrderValue,
      netSales,
      paidCount,
      fulfilledCount,
      refundedCount,
    };
  }, [filteredOrders]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE)),
    [filteredOrders.length],
  );

  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * ORDERS_PER_PAGE;
    return filteredOrders.slice(startIndex, startIndex + ORDERS_PER_PAGE);
  }, [currentPage, filteredOrders, totalPages]);

  const paginationWindow = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const halfWindow = Math.floor(ORDERS_PAGINATION_WINDOW / 2);
    let startPage = Math.max(1, safePage - halfWindow);
    let endPage = Math.min(totalPages, startPage + ORDERS_PAGINATION_WINDOW - 1);

    if (endPage - startPage + 1 < ORDERS_PAGINATION_WINDOW) {
      startPage = Math.max(1, endPage - ORDERS_PAGINATION_WINDOW + 1);
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

  const visibleRange = useMemo(() => {
    if (filteredOrders.length === 0) {
      return { start: 0, end: 0 };
    }

    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * ORDERS_PER_PAGE + 1;
    const end = Math.min(filteredOrders.length, safePage * ORDERS_PER_PAGE);

    return { start, end };
  }, [currentPage, filteredOrders.length, totalPages]);

  const searchScopeHint = useMemo(() => {
    if (!shouldUseFullHistory) {
      return select(
        `بدون بحث أو فلاتر، الصفحة تعرض آخر ${formatNumber(ORDERS_VISIBLE_LIMIT, { maximumFractionDigits: 0 })} طلب فقط. عند البحث أو تطبيق أي فلتر، سيتم فحص كل تاريخ أوردرات المتجر تلقائيًا.`,
        `Without search or filters, the page shows the latest ${formatNumber(ORDERS_VISIBLE_LIMIT, { maximumFractionDigits: 0 })} orders only. Once you search or apply filters, the page scans the full store order history automatically.`,
      );
    }

    if (fullHistorySearchLoading) {
      return select(
        "جاري فحص كل تاريخ أوردرات المتجر الآن...",
        "Scanning the full store order history now...",
      );
    }

    if (fullHistorySearchOrders) {
      return select(
        `يتم الآن عرض ${formatNumber(fullHistorySearchOrders.length, { maximumFractionDigits: 0 })} نتيجة من كل تاريخ المتجر.`,
        `Showing ${formatNumber(fullHistorySearchOrders.length, { maximumFractionDigits: 0 })} result(s) from the full store history.`,
      );
    }

    return select(
      "سيتم فحص كل تاريخ أوردرات المتجر بدل آخر الطلبات فقط.",
      "The active search and filters will scan the full store history instead of only recent orders.",
    );
  }, [
    formatNumber,
    fullHistorySearchLoading,
    fullHistorySearchOrders,
    select,
    shouldUseFullHistory,
  ]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const datePresetValue = useMemo(
    () => resolveOrderDatePreset(filters.dateFrom, filters.dateTo),
    [filters.dateFrom, filters.dateTo],
  );

  const datePresetOptions = useMemo(
    () => [
      {
        value: "all",
        label: select("كل الفترات", "All Periods"),
      },
      {
        value: "today",
        label: select("يومي: اليوم", "Daily: Today"),
      },
      {
        value: "yesterday",
        label: select("أمس", "Yesterday"),
      },
      {
        value: "weekly",
        label: select("أسبوعي: آخر 7 أيام", "Weekly: Last 7 Days"),
      },
      {
        value: "half_monthly",
        label: select("نصف شهري: آخر 15 يوم", "Half-Monthly: Last 15 Days"),
      },
      {
        value: "monthly",
        label: select("شهري: آخر 30 يوم", "Monthly: Last 30 Days"),
      },
      {
        value: "custom",
        label: select("تخصيص يدوي", "Custom Range"),
      },
    ],
    [select],
  );

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleDatePresetChange = (presetId) => {
    if (presetId === "custom") {
      return;
    }

    const range = getOrderDatePresetRange(presetId);
    setFilters((prev) => ({
      ...prev,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const toggleOrderSelection = (orderId) => {
    const normalizedOrderId = String(orderId || "").trim();
    if (!normalizedOrderId) {
      return;
    }

    setSelectedOrderIds((current) =>
      current.includes(normalizedOrderId)
        ? current.filter((value) => value !== normalizedOrderId)
        : [...current, normalizedOrderId],
    );
  };

  const clearSelectedOrders = () => {
    setSelectedOrderIds([]);
  };

  const toggleSelectAllFilteredOrders = () => {
    const filteredOrderIds = filteredOrders
      .map((order) => String(order?.id || "").trim())
      .filter(Boolean);

    if (filteredOrderIds.length === 0) {
      return;
    }

    if (allFilteredOrdersSelected) {
      setSelectedOrderIds((current) =>
        current.filter((orderId) => !filteredOrderIds.includes(orderId)),
      );
      return;
    }

    setSelectedOrderIds((current) =>
      Array.from(new Set([...current, ...filteredOrderIds])),
    );
  };

  const formatDate = (dateString) =>
    formatDateTime(dateString, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getStatusColor = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "paid" || normalized === "completed") {
      return "bg-green-100 text-green-800";
    }
    if (normalized === "pending" || normalized === "authorized") {
      return "bg-yellow-100 text-yellow-800";
    }
    if (normalized === "partially_paid" || normalized === "partially_refunded") {
      return "bg-blue-100 text-blue-800";
    }
    if (normalized === "refunded" || normalized === "voided") {
      return "bg-red-100 text-red-800";
    }
    return "bg-gray-100 text-gray-800";
  };

  const getFulfillmentColor = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "fulfilled") return "bg-green-100 text-green-800";
    if (normalized === "partial") return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-800";
  };

  const getPaymentMethodColor = (method) => {
    const normalized = String(method || "").toLowerCase();
    if (normalized === "shopify") return "bg-emerald-100 text-emerald-800";
    if (normalized === "instapay") return "bg-blue-100 text-blue-800";
    if (normalized === "wallet") return "bg-violet-100 text-violet-800";
    return "bg-slate-100 text-slate-700";
  };

  const renderOrderItemPreview = (order) => {
    const parsedData = parseJsonObject(order?.data);
    const previews = Array.isArray(order?.item_previews)
      ? order.item_previews.filter(
          (item) =>
            item &&
            (String(item.image_url || "").trim() || String(item.title || "").trim()),
        )
      : [];

    if (previews.length === 0) {
      return (
        <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <Package size={16} className="text-slate-400" />
          <span>
            {select(
              `${formatNumber(order.items_count, { maximumFractionDigits: 0 })} عنصر`,
              `${formatNumber(order.items_count, { maximumFractionDigits: 0 })} item(s)`,
            )}
          </span>
        </div>
      );
    }

    const primaryItem = previews[0];
    const allLineItems = Array.isArray(parsedData?.line_items)
      ? parsedData.line_items
      : previews;
    const allItemsCount = Math.max(previews.length, toNumber(order?.items_count));
    const remainingItemsCount = Math.max(0, allItemsCount - 1);
    const totalQuantity = allLineItems.reduce(
      (sum, item) => sum + Math.max(1, toNumber(item?.quantity)),
      0,
    );

    return (
      <div className="flex min-w-[280px] items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm">
          {String(primaryItem?.image_url || "").trim() ? (
            <img
              src={primaryItem.image_url}
              alt={primaryItem.title || "Order item"}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-400">
              <Package size={18} />
            </div>
          )}
          {toNumber(primaryItem?.quantity) > 1 ? (
            <span className="absolute bottom-1 left-1 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              x{toNumber(primaryItem.quantity)}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">
            {primaryItem?.title || select("منتج بدون اسم", "Untitled item")}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {select(
              `${formatNumber(order.items_count, { maximumFractionDigits: 0 })} بند • ${formatNumber(totalQuantity, { maximumFractionDigits: 0 })} قطعة`,
              `${formatNumber(order.items_count, { maximumFractionDigits: 0 })} line item(s) • ${formatNumber(totalQuantity, { maximumFractionDigits: 0 })} qty`,
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {remainingItemsCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                {select(
                  `+ ${remainingItemsCount} أصناف أخرى`,
                  `+ ${remainingItemsCount} more item(s)`,
                )}
              </span>
            ) : null}
            {previews.slice(1, 3).map((item, index) => (
              <span
                key={`${item.id || item.title || "secondary"}-${index}`}
                className="max-w-[120px] truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                title={item.title || "Order item"}
              >
                {item.title}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
                <p className="text-slate-600">
                  Live order feed with advanced filtering by status, payment, fulfillment, and refunds.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Sync Active
                  </span>
                  {lastUpdatedAt && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                      <Clock3 size={12} />
                      {select("آخر تحديث", "Last refresh")}{" "}
                      {formatTime(lastUpdatedAt, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                  {lastLiveEventAt && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200">
                      {select("آخر حدث", "Event")}{" "}
                      {formatTime(lastLiveEventAt, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => fetchOrders({ forceSync: true })}
                  className="bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  <RefreshCw size={18} />
                  {select("\u062a\u062d\u062f\u064a\u062b", "Refresh")}
                </button>
                <button
                  onClick={() => setIsExportPanelOpen((current) => !current)}
                  className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  <Download size={18} />
                  {isExportPanelOpen ? "Hide Export" : "Export"}
                </button>
              </div>
            </div>
          </div>

          <OrdersExportPanel
            isOpen={isExportPanelOpen}
            filteredOrders={filteredOrders}
            selectedOrders={selectedOrders}
            onClearSelectedOrders={clearSelectedOrders}
          />

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          {missingOrderIds.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-amber-900">
              <div className="flex items-start gap-2">
                <AlertCircle size={18} className="mt-0.5 text-amber-600" />
                <div>
                  <p className="font-semibold">
                    {select(
                      `${formatNumber(missingOrderIds.length, { maximumFractionDigits: 0 })} طلب خارج قائمة الطلبات الآن`,
                      `${formatNumber(missingOrderIds.length, { maximumFractionDigits: 0 })} orders are now outside the main orders list`,
                    )}
                  </p>
                  <p className="text-sm text-amber-800">
                    {select(
                      "هذه الطلبات انتقلت إلى صفحة الطلبات الخارجة عن المخزون لأن مخزون المخزن لا يغطيها بالكامل بعد مرور 3 أيام.",
                      "These orders moved to the out-of-stock orders page because warehouse stock still does not fully cover them after 3 days, or because they are fully in stock but still have no recorded action after 3 days.",
                    )}
                  </p>
                  <p className="mt-2 text-xs font-medium text-amber-900/80">
                    {select(
                      `${formatNumber(missingOrdersSummary.stockShortage, { maximumFractionDigits: 0 })} خارج المخزون + ${formatNumber(missingOrdersSummary.noAction, { maximumFractionDigits: 0 })} مخزون متاح بدون إجراء`,
                      `${formatNumber(missingOrdersSummary.stockShortage, { maximumFractionDigits: 0 })} out-of-stock + ${formatNumber(missingOrdersSummary.noAction, { maximumFractionDigits: 0 })} in-stock follow-up`,
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => navigate("/orders/missing")}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
              >
                {select(
                  "فتح الطلبات الخارجة عن المخزون",
                  "Open Out-of-Stock Orders",
                )}
              </button>
              {missingOrdersSummary.noAction > 0 ? (
                <button
                  onClick={() => navigate("/orders/in-stock-follow-up")}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium"
                >
                  {select(
                    "فتح طلبات المخزون المتاح",
                    "Open In-Stock Follow-Up",
                  )}
                </button>
              ) : null}
            </div>
          )}

          {shippingIssuesSummary.total > 0 && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 text-violet-900">
              <div className="flex items-start gap-2">
                <Truck size={18} className="mt-0.5 text-violet-600" />
                <div>
                  <p className="font-semibold">
                    {select(
                      `${formatNumber(shippingIssuesSummary.total, { maximumFractionDigits: 0 })} أوردر متحول لقائمة مشاكل الشحن`,
                      `${formatNumber(shippingIssuesSummary.total, { maximumFractionDigits: 0 })} orders moved to the shipping issues list`,
                    )}
                  </p>
                  <p className="text-sm text-violet-800">
                    {select(
                      "الأوردرات دي اتشالت من الليستة الأساسية علشان تتابع من صفحة مشاكل الشحن، وتقدر ترجّعها تاني من هناك أو من داخل الأوردر نفسه.",
                      "These orders are removed from the main list and tracked from the Shipping Issues page until they are returned back.",
                    )}
                  </p>
                  {shippingIssuesSummary.openFollowUp > 0 ? (
                    <p className="mt-2 text-xs font-medium text-violet-900/80">
                      {select(
                        `لسه ${formatNumber(shippingIssuesSummary.openFollowUp, { maximumFractionDigits: 0 })} أوردر في متابعة شحن مفتوحة`,
                        `${formatNumber(shippingIssuesSummary.openFollowUp, { maximumFractionDigits: 0 })} order(s) still have an open shipping follow-up`,
                      )}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                onClick={() => navigate("/orders/shipping-issues")}
                className="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium"
              >
                {select("فتح مشاكل الشحن", "Open Shipping Issues")}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <SummaryCard
              label="Orders"
              value={formatNumber(summary.totalOrders, {
                maximumFractionDigits: 0,
              })}
              icon={ShoppingCart}
              color="from-blue-500 to-blue-700"
            />
            <SummaryCard
              label="Order Value"
              value={formatAmount(summary.totalOrderValue)}
              subtitle="All filtered orders"
              icon={TrendingUp}
              color="from-amber-500 to-amber-700"
            />
            <SummaryCard
              label="Net Sales"
              value={formatAmount(summary.netSales)}
              subtitle="Paid after refunds"
              icon={TrendingUp}
              color="from-emerald-500 to-emerald-700"
            />
            <SummaryCard
              label="Paid"
              value={formatNumber(summary.paidCount, {
                maximumFractionDigits: 0,
              })}
              icon={TrendingUp}
              color="from-violet-500 to-violet-700"
            />
            <SummaryCard
              label="Fulfilled"
              value={formatNumber(summary.fulfilledCount, {
                maximumFractionDigits: 0,
              })}
              icon={TrendingUp}
              color="from-teal-500 to-teal-700"
            />
            <SummaryCard
              label="Refunded"
              value={formatNumber(summary.refundedCount, {
                maximumFractionDigits: 0,
              })}
              icon={AlertCircle}
              color="from-rose-500 to-rose-700"
            />
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Order Filters</h2>
              <button
                onClick={resetFilters}
                className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="xl:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Search</label>
                <div className="relative">
                  <Search
                    className={`absolute top-2.5 text-slate-400 ${
                      isRTL ? "right-3" : "left-3"
                    }`}
                    size={16}
                  />
                  <input
                    type="text"
                    placeholder="Order #, phone, customer, email, product, SKU..."
                    value={filters.searchTerm}
                    onChange={(event) =>
                      handleFilterChange("searchTerm", event.target.value)
                    }
                    className={`w-full py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                      isRTL ? "pr-8 pl-3" : "pl-8 pr-3"
                    }`}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {searchScopeHint}
                </p>
                {fullHistorySearchError ? (
                  <p className="mt-1 text-xs text-amber-700">
                    {fullHistorySearchError}
                  </p>
                ) : null}
                {normalizedDateRange.wasSwapped && (
                  <p className="mt-1 text-xs text-amber-700">
                    {select(
                      "تم تصحيح مدى التاريخ تلقائيًا لأن من تاريخ كان بعد إلى تاريخ.",
                      "Date range was auto-corrected because From Date was later than To Date.",
                    )}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  {select("الفترة", "Period")}
                </label>
                <select
                  value={datePresetValue}
                  onChange={(event) => handleDatePresetChange(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {datePresetOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                      disabled={option.value === "custom" && datePresetValue !== "custom"}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {datePresetValue === "custom"
                    ? select(
                        "المدى الحالي مخصص يدويًا من حقلي البداية والنهاية.",
                        "The current range is manually set from the start and end dates.",
                      )
                    : select(
                        "اختيار الفترة يضبط التاريخين تلقائيًا ويعرض كل الأوردرات داخلها.",
                        "Choosing a period fills the date range automatically and shows all orders within it.",
                      )}
                </p>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">From Date</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">To Date</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => handleFilterChange("dateTo", event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Order # From</label>
                <input
                  type="number"
                  value={filters.orderNumberFrom}
                  onChange={(event) =>
                    handleFilterChange("orderNumberFrom", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Order # To</label>
                <input
                  type="number"
                  value={filters.orderNumberTo}
                  onChange={(event) =>
                    handleFilterChange("orderNumberTo", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Amount Min</label>
                <input
                  type="number"
                  value={filters.amountMin}
                  onChange={(event) => handleFilterChange("amountMin", event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Amount Max</label>
                <input
                  type="number"
                  value={filters.amountMax}
                  onChange={(event) => handleFilterChange("amountMax", event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Payment Status</label>
                <select
                  value={filters.paymentFilter}
                  onChange={(event) =>
                    handleFilterChange("paymentFilter", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="paid_or_partial">Paid + Partial</option>
                  <option value="pending_or_authorized">Pending + Authorized</option>
                  <option value="paid">Paid</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="pending">Pending</option>
                  <option value="authorized">Authorized</option>
                  <option value="refunded">Refunded</option>
                  <option value="partially_refunded">Partially Refunded</option>
                  <option value="voided">Voided</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Payment Method</label>
                <select
                  value={filters.paymentMethodFilter}
                  onChange={(event) =>
                    handleFilterChange("paymentMethodFilter", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="shopify">Shopify</option>
                  <option value="instapay">InstaPay</option>
                  <option value="wallet">Wallet</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Fulfillment</label>
                <select
                  value={filters.fulfillmentFilter}
                  onChange={(event) =>
                    handleFilterChange("fulfillmentFilter", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="fulfilled">Fulfilled</option>
                  <option value="partial">Partial</option>
                  <option value="unfulfilled">Unfulfilled</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Refund Filter</label>
                <select
                  value={filters.refundFilter}
                  onChange={(event) =>
                    handleFilterChange("refundFilter", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="any">Any Refund</option>
                  <option value="partial">Partial Refund</option>
                  <option value="full">Full Refund</option>
                  <option value="none">No Refund</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">Sort</label>
                <select
                  value={filters.sortBy}
                  onChange={(event) => handleFilterChange("sortBy", event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="amount_desc">Amount (High)</option>
                  <option value="amount_asc">Amount (Low)</option>
                  <option value="order_desc">Order # (High)</option>
                  <option value="order_asc">Order # (Low)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filters.paidOnly}
                  onChange={(event) => handleFilterChange("paidOnly", event.target.checked)}
                />
                Paid only
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filters.fulfilledOnly}
                  onChange={(event) =>
                    handleFilterChange("fulfilledOnly", event.target.checked)
                  }
                />
                Fulfilled only
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={filters.cancelledOnly}
                  onChange={(event) =>
                    handleFilterChange("cancelledOnly", event.target.checked)
                  }
                />
                Cancelled only
              </label>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow overflow-hidden border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Orders Table</p>
                <p className="text-xs text-slate-500">
                  {formatNumber(filteredOrders.length, {
                    maximumFractionDigits: 0,
                  })} filtered orders,{" "}
                  {formatNumber(selectedOrders.length, {
                    maximumFractionDigits: 0,
                  })} selected for export.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {select(
                    `الصفحة ${formatNumber(currentPage, { maximumFractionDigits: 0 })} من ${formatNumber(totalPages, { maximumFractionDigits: 0 })} - 50 طلب في الصفحة`,
                    `Page ${formatNumber(currentPage, { maximumFractionDigits: 0 })} of ${formatNumber(totalPages, { maximumFractionDigits: 0 })} - 50 orders per page`,
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAllFilteredOrders}
                  disabled={filteredOrders.length === 0}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {allFilteredOrdersSelected ? "Unselect filtered" : "Select filtered"}
                </button>
                <button
                  type="button"
                  onClick={clearSelectedOrders}
                  disabled={selectedOrders.length === 0}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear selected
                </button>
              </div>
            </div>

            <div className="hidden max-h-[68vh] overflow-auto lg:block">
              <table className="data-table orders-table w-full min-w-[1600px]">
                <colgroup>
                  <col className="w-[56px]" />
                  <col className="w-[120px]" />
                  <col className="w-[260px]" />
                  <col className="w-[320px]" />
                  <col className="w-[130px]" />
                  <col className="w-[120px]" />
                  <col className="w-[150px]" />
                  <col className="w-[130px]" />
                  <col className="w-[120px]" />
                  <col className="w-[180px]" />
                  <col className="w-[110px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      <input
                        type="checkbox"
                        checked={allFilteredOrdersSelected}
                        onChange={toggleSelectAllFilteredOrders}
                      />
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("الطلب", "Order")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("العميل", "Customer")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("العناصر", "Items")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("الإجمالي", "Total")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("الدفع", "Payment")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("طريقة الدفع", "Payment Method")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("التنفيذ", "Fulfillment")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("الاسترداد", "Refund")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("التاريخ", "Date")}
                    </th>
                    <th
                      className={`px-4 py-3 text-sm font-semibold text-slate-700 ${tableHeaderAlignClass} ${stickyTableHeaderClass}`}
                    >
                      {select("التفاصيل", "Details")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadStatus.active && orders.length === 0 ? (
                    <tr>
                      <td colSpan="11" className="px-6 py-10 text-center text-slate-500">
                        {select(
                          "ستظهر أحدث الطلبات هنا تلقائيًا.",
                          "Latest orders will appear here automatically.",
                        )}
                      </td>
                    </tr>
                  ) : paginatedOrders.length > 0 ? (
                    paginatedOrders.map((order) => (
                      <tr
                        key={order.id}
                        className="border-b hover:bg-slate-50 transition cursor-pointer"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedOrderIdSet.has(String(order?.id || "").trim())}
                            onChange={() => toggleOrderSelection(order.id)}
                          />
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800 whitespace-nowrap">
                          #{order.order_number || order.shopify_id}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          <p className="truncate font-medium text-slate-800">
                            {order.customer_name || "Unknown"}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {order.customer_email || "-"}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {renderOrderItemPreview(order)}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-800 whitespace-nowrap">
                          {formatAmount(order._meta.totalPrice)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                              order._meta.paymentStatus,
                            )}`}
                          >
                            {order._meta.paymentStatus || "n/a"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${getPaymentMethodColor(
                              order._meta.paymentMethod,
                            )}`}
                          >
                            {PAYMENT_METHOD_LABELS[order._meta.paymentMethod] || "None"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${getFulfillmentColor(
                              order._meta.fulfillmentStatus,
                            )}`}
                          >
                            {order._meta.fulfillmentStatus || "unfulfilled"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {order._meta.hasAnyRefund ? (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                order._meta.isPartialRefund
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {order._meta.isPartialRefund ? "Partial" : "Full"}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                              None
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {formatDate(order.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/orders/${order.id}`);
                            }}
                            className="text-sky-700 hover:text-sky-900 flex items-center gap-1 text-sm font-medium"
                          >
                            <Eye size={15} />
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="11" className="px-6 py-12 text-center text-slate-500">
                        <ShoppingCart size={44} className="mx-auto mb-3 text-slate-300" />
                        <p className="font-semibold mb-1">No matching orders found</p>
                        <p className="text-sm">Try adjusting or resetting filters.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-slate-100">
              {loadStatus.active && orders.length === 0 ? (
                <div className="px-5 py-10 text-center text-slate-500">
                  Latest orders will appear here automatically.
                </div>
              ) : paginatedOrders.length > 0 ? (
                paginatedOrders.map((order) => (
                  <article key={order.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500">Order</p>
                        <p className="text-base font-semibold text-slate-900">
                          #{order.order_number || order.shopify_id}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate(`/orders/${order.id}`)}
                        className="text-sky-700 hover:text-sky-900 flex items-center gap-1 text-sm font-medium"
                      >
                        <Eye size={15} />
                        View
                      </button>
                    </div>

                    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={selectedOrderIdSet.has(String(order?.id || "").trim())}
                        onChange={() => toggleOrderSelection(order.id)}
                      />
                      Select for export
                    </label>

                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {order.customer_name || "Unknown"}
                      </p>
                      <p className="text-xs text-slate-500">{order.customer_email || "-"}</p>
                    </div>

                    <div className="space-y-3">
                      <div>{renderOrderItemPreview(order)}</div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <p className="text-slate-600">
                          Items:{" "}
                          <span className="font-medium text-slate-900">
                            {formatNumber(order.items_count, {
                              maximumFractionDigits: 0,
                            })}
                          </span>
                        </p>
                        <p className="text-slate-600">
                          Total:{" "}
                          <span className="font-medium text-slate-900">
                            {formatAmount(order._meta.totalPrice)}
                          </span>
                        </p>
                        <p className="text-slate-600">
                          Date:{" "}
                          <span className="font-medium text-slate-900">
                            {formatDate(order.created_at)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                          order._meta.paymentStatus,
                        )}`}
                      >
                        {order._meta.paymentStatus || "n/a"}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${getPaymentMethodColor(
                          order._meta.paymentMethod,
                        )}`}
                      >
                        {PAYMENT_METHOD_LABELS[order._meta.paymentMethod] || "None"}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${getFulfillmentColor(
                          order._meta.fulfillmentStatus,
                        )}`}
                      >
                        {order._meta.fulfillmentStatus || "unfulfilled"}
                      </span>
                    </div>
                  </article>
                ))
              ) : (
                <div className="px-5 py-12 text-center text-slate-500">
                  <ShoppingCart size={44} className="mx-auto mb-3 text-slate-300" />
                  <p className="font-semibold mb-1">No matching orders found</p>
                  <p className="text-sm">Try adjusting or resetting filters.</p>
                </div>
              )}
            </div>

            {filteredOrders.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value, subtitle = "", icon: Icon, color }) {
  return (
    <div className={`bg-gradient-to-r ${color} rounded-xl text-white p-4`}>
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-white/90">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle ? (
            <p className="text-xs text-white/80 mt-1">{subtitle}</p>
          ) : null}
        </div>
        <Icon size={24} />
      </div>
    </div>
  );
}
