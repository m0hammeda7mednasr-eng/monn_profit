import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CalendarRange,
  Clock3,
  Download,
  Eye,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import api, { shopifyAPI } from "../utils/api";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import { extractArray } from "../utils/response";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { useStore } from "../context/StoreContext";
import {
  markSharedDataUpdated,
  subscribeToSharedDataUpdates,
} from "../utils/realtime";
import {
  buildShippingIssueDraftRecord,
  readShippingIssueDrafts,
  resolveShippingIssueDraft,
  writeShippingIssueDrafts,
} from "../utils/shippingIssueDrafts";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";
import { HEAVY_VIEW_CACHE_FRESH_MS } from "../utils/refreshPolicy";
import {
  getShippingIssueBadgeClassName,
  getShippingIssueReasonLabel,
  getShippingIssueReasonOptions,
  isShippingIssueActive,
  isShippingIssueClosed,
  isShippingIssuePhoneRequired,
  normalizeShippingIssueReason,
} from "../utils/shippingIssues";

const FETCH_PAGE_LIMIT = 4500;
const SHIPPING_ISSUES_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const PAGE_SIZE = 50;
const PAGINATION_WINDOW = 5;
const DATE_PRESET_OPTIONS = [
  { id: "all", ar: "All dates", en: "All Dates" },
  { id: "today", ar: "اليوم", en: "Today" },
  { id: "yesterday", ar: "أمس", en: "Yesterday" },
  { id: "week", ar: "أسبوع", en: "Week" },
  { id: "month", ar: "شهر", en: "Month" },
  { id: "quarter", ar: "3 شهور", en: "3 Months" },
  { id: "custom", ar: "تاريخ مخصص", en: "Custom Date" },
];

const normalizeText = (value) => String(value ?? "").trim();
const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
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
const shiftDateByDays = (date, amount) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + amount);
  return next;
};
const getDatePresetRange = (presetId, now = new Date()) => {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  switch (presetId) {
    case "all":
      return {
        dateFrom: "",
        dateTo: "",
      };
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
    case "week":
      return {
        dateFrom: formatDateInputValue(shiftDateByDays(today, -6)),
        dateTo: formatDateInputValue(today),
      };
    case "month":
      return {
        dateFrom: formatDateInputValue(shiftDateByDays(today, -29)),
        dateTo: formatDateInputValue(today),
      };
    case "quarter":
      return {
        dateFrom: formatDateInputValue(shiftDateByDays(today, -89)),
        dateTo: formatDateInputValue(today),
      };
    default:
      return {
        dateFrom: "",
        dateTo: "",
      };
  }
};
const normalizeDateRange = (range = {}) => {
  const dateFrom = normalizeText(range?.dateFrom);
  const dateTo = normalizeText(range?.dateTo);

  const parsedDateFrom = parseLocalDateInput(dateFrom);
  const parsedDateTo = parseLocalDateInput(dateTo);

  if (
    parsedDateFrom &&
    parsedDateTo &&
    parsedDateFrom.getTime() > parsedDateTo.getTime()
  ) {
    return {
      dateFrom: dateTo,
      dateTo: dateFrom,
    };
  }

  return {
    dateFrom,
    dateTo,
  };
};
const resolveDatePreset = (range = {}, now = new Date()) => {
  const normalizedDateFrom = normalizeText(range?.dateFrom);
  const normalizedDateTo = normalizeText(range?.dateTo);

  for (const option of DATE_PRESET_OPTIONS) {
    if (option.id === "custom") {
      continue;
    }

    const presetRange = getDatePresetRange(option.id, now);
    if (
      presetRange.dateFrom === normalizedDateFrom &&
      presetRange.dateTo === normalizedDateTo
    ) {
      return option.id;
    }
  }

  return "custom";
};
const parseDateValue = (value) => {
  const parsed = parseLocalDateInput(value);
  if (!parsed) {
    return null;
  }

  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const matchesDateRange = (value, range = {}) => {
  const parsed = parseDateValue(value);
  if (!range?.dateFrom && !range?.dateTo) {
    return true;
  }

  if (!parsed) {
    return false;
  }

  const fromDate = parseDateValue(range?.dateFrom);
  const toDate = parseDateValue(range?.dateTo);

  if (fromDate) {
    fromDate.setHours(0, 0, 0, 0);
    if (parsed < fromDate) {
      return false;
    }
  }

  if (toDate) {
    toDate.setHours(23, 59, 59, 999);
    if (parsed > toDate) {
      return false;
    }
  }

  return true;
};

const matchesSearch = (order, keyword) => {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    order?.customer_name,
    order?.customer_email,
    order?.order_number,
    order?.shopify_id,
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
};

function SummaryCard({ title, value, tone = "violet" }) {
  const toneClassName = {
    violet: "from-violet-500 to-violet-700",
    amber: "from-amber-500 to-amber-700",
    sky: "from-sky-500 to-sky-700",
    rose: "from-rose-500 to-rose-700",
  }[tone];

  return (
    <div
      className={`rounded-2xl bg-gradient-to-br p-5 text-white shadow-sm ${toneClassName}`}
    >
      <p className="text-sm/6 text-white/80">{title}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function ShippingIssueNoteField({
  label,
  description,
  placeholder,
  value,
  onChange,
  disabled,
  isRTL,
}) {
  return (
    <label className="app-note flex h-full flex-col gap-3 px-4 py-4">
      <div className={isRTL ? "text-right" : "text-left"}>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <textarea
        rows={4}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`app-input min-h-[112px] w-full resize-y px-3 py-2.5 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${
          isRTL ? "text-right" : "text-left"
        }`}
      />
    </label>
  );
}

export default function ShippingIssues() {
  const navigate = useNavigate();
  const { currentStoreId } = useStore();
  const { hasPermission } = useAuth();
  const { select, isRTL, formatDateTime, formatNumber, formatTime } =
    useLocale();
  const canEditOrders = hasPermission("can_edit_orders");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [dateRange, setDateRange] = useState(() => getDatePresetRange("all"));
  const [currentPage, setCurrentPage] = useState(1);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [updatingOrderIds, setUpdatingOrderIds] = useState({});
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteSaveStatusByOrderId, setNoteSaveStatusByOrderId] = useState({});
  const [draftHydrationReady, setDraftHydrationReady] = useState(false);
  const fetchPromiseRef = useRef(null);

  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey("shipping-issues:list", currentStoreId),
    [currentStoreId],
  );
  const reasonOptions = useMemo(() => getShippingIssueReasonOptions(select), [
    select,
  ]);
  const datePresetOptions = useMemo(
    () =>
      DATE_PRESET_OPTIONS.map((option) => ({
        ...option,
        label: select(option.ar, option.en),
      })),
    [select],
  );
  const normalizedDateRange = useMemo(
    () => normalizeDateRange(dateRange),
    [dateRange],
  );
  const activeDatePresetId = useMemo(
    () => resolveDatePreset(normalizedDateRange),
    [normalizedDateRange],
  );
  const activeDatePresetLabel = useMemo(() => {
    const activePreset = datePresetOptions.find(
      (option) => option.id === activeDatePresetId,
    );
    if (activeDatePresetId !== "custom") {
      return activePreset?.label || select("الفترة", "Period");
    }

    if (normalizedDateRange.dateFrom || normalizedDateRange.dateTo) {
      return `${normalizedDateRange.dateFrom || "..."} -> ${
        normalizedDateRange.dateTo || "..."
      }`;
    }

    return select("كل التواريخ", "All updates");
  }, [activeDatePresetId, datePresetOptions, normalizedDateRange, select]);
  const activeReasonFilterLabel = useMemo(() => {
    if (reasonFilter === "all") {
      return select("كل الأسباب", "All reasons");
    }

    return (
      reasonOptions.find((option) => option.value === reasonFilter)?.label ||
      reasonFilter
    );
  }, [reasonFilter, reasonOptions, select]);

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

  const fetchShippingIssues = useCallback(
    async ({ silent = false, force = false } = {}) => {
      if (fetchPromiseRef.current?.cacheKey === cacheKey) {
        return fetchPromiseRef.current.promise;
      }

      const request = (async () => {
        if (!force) {
          const cached = await readCachedView(cacheKey);
          const cachedRows = Array.isArray(cached?.value?.rows)
            ? cached.value.rows
            : [];

          if (
            cachedRows.length > 0 &&
            isCacheFresh(cached, SHIPPING_ISSUES_CACHE_FRESH_MS)
          ) {
            setOrders(cachedRows.filter((order) => isShippingIssueActive(order)));
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
          const response = await shopifyAPI.getShippingIssues({
            limit: FETCH_PAGE_LIMIT,
            offset: 0,
            ...(force ? { cache_refresh: "1" } : {}),
          });
          const rows = extractArray(response?.data);
          const activeRows = rows.filter((order) =>
            isShippingIssueActive(order),
          );

          setOrders(activeRows);
          setLastUpdatedAt(new Date());
          await writeCachedView(cacheKey, { rows: activeRows });
          return activeRows;
        } catch (requestError) {
          console.error("Error fetching shipping issues:", requestError);
          setError(
            requestError?.response?.data?.error ||
              select(
                "\u0641\u0634\u0644 \u062a\u062d\u0645\u064a\u0644 \u0645\u0634\u0627\u0643\u0644 \u0627\u0644\u0634\u062d\u0646",
                "Failed to load shipping issues",
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
    },
    [cacheKey, select],
  );

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

      setOrders(cachedRows.filter((order) => isShippingIssueActive(order)));
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
    fetchShippingIssues();
  }, [currentStoreId, fetchShippingIssues]);

  useEffect(() => {
    setNoteDrafts({});
    setNoteSaveStatusByOrderId({});
    setDraftHydrationReady(false);
  }, [currentStoreId]);

  useEffect(() => {
    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchShippingIssues({ silent: true, force: true });
    });

    return () => unsubscribe();
  }, [fetchShippingIssues]);

  useEffect(() => {
    if (loading || draftHydrationReady) {
      return;
    }

    const storedDrafts = readShippingIssueDrafts();
    const nextHydratedDrafts = {};
    let hasStorageChanges = false;

    for (const order of orders) {
      const orderId = String(order?.id || "");
      if (!orderId || !storedDrafts[orderId]) {
        continue;
      }

      const resolution = resolveShippingIssueDraft(order, storedDrafts[orderId]);
      if (resolution.status === "hydrate") {
        nextHydratedDrafts[orderId] = storedDrafts[orderId];
        continue;
      }

      delete storedDrafts[orderId];
      hasStorageChanges = true;
    }

    if (hasStorageChanges) {
      writeShippingIssueDrafts(storedDrafts);
    }

    if (Object.keys(nextHydratedDrafts).length > 0) {
      setNoteDrafts(nextHydratedDrafts);
    }

    setDraftHydrationReady(true);
  }, [draftHydrationReady, loading, orders]);

  useEffect(() => {
    if (!draftHydrationReady) {
      return;
    }

    const ordersById = new Map(
      orders
        .filter((order) => order?.id !== undefined && order?.id !== null)
        .map((order) => [String(order.id), order]),
    );

    setNoteDrafts((current) => {
      let changed = false;
      const nextDrafts = { ...current };

      for (const [orderId, draft] of Object.entries(current)) {
        const order = ordersById.get(orderId);
        if (!order) {
          continue;
        }

        const resolution = resolveShippingIssueDraft(order, draft);
        if (resolution.status === "hydrate") {
          continue;
        }

        delete nextDrafts[orderId];
        changed = true;
      }

      return changed ? nextDrafts : current;
    });
  }, [draftHydrationReady, orders]);

  useEffect(() => {
    if (!draftHydrationReady) {
      return;
    }

    writeShippingIssueDrafts(noteDrafts);
  }, [draftHydrationReady, noteDrafts]);

  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!matchesSearch(order, searchTerm)) {
          return false;
        }

        if (reasonFilter === "all") {
          return matchesDateRange(
            order?.shipping_issue?.updated_at ||
              order?.updated_at ||
              order?.created_at,
            normalizedDateRange,
          );
        }

        const matchesReason =
          normalizeShippingIssueReason(order?.shipping_issue?.reason) ===
          reasonFilter;

        if (!matchesReason) {
          return false;
        }

        return matchesDateRange(
          order?.shipping_issue?.updated_at ||
            order?.updated_at ||
            order?.created_at,
          normalizedDateRange,
        );
      }),
    [normalizedDateRange, orders, reasonFilter, searchTerm],
  );

  const summary = useMemo(() => {
    const closedCases = filteredOrders.filter((order) =>
      isShippingIssueClosed(order?.shipping_issue?.reason),
    ).length;
    const phoneCases = filteredOrders.filter((order) =>
      isShippingIssuePhoneRequired(order?.shipping_issue?.reason),
    ).length;

    return {
      total: filteredOrders.length,
      openFollowUp: filteredOrders.length - closedCases,
      phoneCases,
      closedCases,
    };
  }, [filteredOrders]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE)),
    [filteredOrders.length],
  );

  const paginatedOrders = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * PAGE_SIZE;
    return filteredOrders.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredOrders, totalPages]);

  const visibleRange = useMemo(() => {
    if (filteredOrders.length === 0) {
      return { start: 0, end: 0 };
    }

    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * PAGE_SIZE + 1;
    const end = Math.min(filteredOrders.length, safePage * PAGE_SIZE);

    return { start, end };
  }, [currentPage, filteredOrders.length, totalPages]);

  const paginationPages = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const halfWindow = Math.floor(PAGINATION_WINDOW / 2);
    const startPage = Math.max(1, safePage - halfWindow);
    const endPage = Math.min(totalPages, startPage + PAGINATION_WINDOW - 1);
    const pages = [];

    for (let page = startPage; page <= endPage; page += 1) {
      pages.push(page);
    }

    return pages;
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedDateRange.dateFrom, normalizedDateRange.dateTo, reasonFilter, searchTerm]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(page, 1), totalPages));
  }, [totalPages]);

  const setUpdatingState = (orderId, value) => {
    setUpdatingOrderIds((current) => ({
      ...current,
      [orderId]: value,
    }));
  };

  const setNoteSaveStatus = (orderId, status) => {
    setNoteSaveStatusByOrderId((current) => ({
      ...current,
      [orderId]: status,
    }));
  };

  const showEditPermissionMessage = useCallback(() => {
    setError(
      select(
        "يمكنك عرض مشاكل الشحن فقط. لتعديل الحالة أو حفظ الملاحظات، فعّل صلاحية تعديل الطلبات.",
        "You can view shipping issues only. Enable order edit permission to update status or save notes.",
      ),
    );
  }, [select]);

  const updateNoteDraft = (order, field, value) => {
    if (!canEditOrders) {
      showEditPermissionMessage();
      return;
    }

    const orderId = String(order?.id || "");
    if (!orderId) {
      return;
    }

    const existingDraft = noteDrafts[orderId];
    const nextDraftValues = {
      shipping_company_note:
        field === "shipping_company_note"
          ? value
          : String(
              existingDraft?.shipping_company_note ??
                order?.shipping_issue?.shipping_company_note ??
                "",
            ),
      customer_service_note:
        field === "customer_service_note"
          ? value
          : String(
              existingDraft?.customer_service_note ??
                order?.shipping_issue?.customer_service_note ??
                "",
            ),
    };
    const nextDraft = existingDraft
      ? {
          ...existingDraft,
          ...nextDraftValues,
          updated_at: new Date().toISOString(),
        }
      : buildShippingIssueDraftRecord(order, nextDraftValues);

    setNoteDrafts((current) => {
      if (!nextDraft) {
        if (!current[orderId]) {
          return current;
        }

        const next = { ...current };
        delete next[orderId];
        return next;
      }

      return {
        ...current,
        [orderId]: nextDraft,
      };
    });
    setNoteSaveStatusByOrderId((current) => {
      if (!current[orderId]) {
        return current;
      }

      const next = { ...current };
      delete next[orderId];
      return next;
    });
  };

  const clearNoteDraft = (orderId) => {
    const normalizedOrderId = String(orderId || "");
    if (!normalizedOrderId) {
      return;
    }

    setNoteDrafts((current) => {
      if (!current[normalizedOrderId]) {
        return current;
      }

      const next = { ...current };
      delete next[normalizedOrderId];
      return next;
    });
  };

  const handleDatePresetChange = (presetId) => {
    if (presetId === "custom") {
      setDateRange({
        dateFrom: "",
        dateTo: "",
      });
      return;
    }

    setDateRange(getDatePresetRange(presetId));
  };

  const handleDateInputChange = (field, value) => {
    setDateRange((current) =>
      normalizeDateRange({
        ...current,
        [field]: value,
      }),
    );
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setReasonFilter("all");
    setDateRange(getDatePresetRange("all"));
  };

  const handleExportShippingIssues = useCallback(() => {
    if (filteredOrders.length === 0) {
      return;
    }

    downloadCsvSections({
      filename: buildCsvFilename("shipping-issues-report"),
      sections: [
        {
          title: select("بيانات التصفية", "Filter metadata"),
          headers: [select("الحقل", "Field"), select("القيمة", "Value")],
          rows: [
            [select("البحث", "Search"), searchTerm.trim() || "-"],
            [select("السبب", "Reason"), activeReasonFilterLabel],
            [select("الفترة", "Period"), activeDatePresetLabel],
            [
              select("من تاريخ", "Date from"),
              normalizedDateRange.dateFrom || "-",
            ],
            [
              select("إلى تاريخ", "Date to"),
              normalizedDateRange.dateTo || "-",
            ],
            [
              select("عدد النتائج", "Results"),
              formatNumber(filteredOrders.length, { maximumFractionDigits: 0 }),
            ],
            [select("وقت التصدير", "Exported at"), new Date().toISOString()],
          ],
        },
        {
          title: select(
            "مشاكل الشحن الظاهرة",
            "Visible shipping issues",
          ),
          headers: [
            select("رقم الأوردر", "Order Number"),
            select("اسم العميل", "Customer"),
            select("البريد الإلكتروني", "Email"),
            select("الهاتف", "Phone"),
            select("سبب المشكلة", "Issue"),
            select("ملاحظة شركة الشحن", "Shipping Company Note"),
            select("ملاحظة خدمة العملاء", "Customer Service Note"),
            select("آخر تحديث", "Last update"),
            select("تاريخ الإنشاء", "Created at"),
          ],
          rows: filteredOrders.map((order) => [
            order.order_number || order.shopify_id || "",
            order.customer_name || select("عميل غير معروف", "Unknown customer"),
            order.customer_email || "",
            order.customer_phone || "",
            getShippingIssueReasonLabel(order?.shipping_issue?.reason, select),
            order?.shipping_issue?.shipping_company_note || "",
            order?.shipping_issue?.customer_service_note || "",
            formatDate(order?.shipping_issue?.updated_at || order?.updated_at),
            formatDate(order?.created_at),
          ]),
        },
      ],
    });
  }, [
    activeDatePresetLabel,
    activeReasonFilterLabel,
    filteredOrders,
    formatDate,
    formatNumber,
    normalizedDateRange.dateFrom,
    normalizedDateRange.dateTo,
    searchTerm,
    select,
  ]);

  const getNoteDraftValue = (order, field) => {
    const orderId = String(order?.id || "");
    const orderDraft = noteDrafts[orderId];
    if (orderDraft && Object.prototype.hasOwnProperty.call(orderDraft, field)) {
      return orderDraft[field];
    }

    return String(order?.shipping_issue?.[field] || "");
  };

  const hasNoteDraftChanged = (order) => {
    const orderId = String(order?.id || "");
    const orderDraft = noteDrafts[orderId];
    if (!orderDraft) {
      return false;
    }

    return ["shipping_company_note", "customer_service_note"].some((field) => {
      if (!Object.prototype.hasOwnProperty.call(orderDraft, field)) {
        return false;
      }

      return (
        normalizeText(orderDraft[field]) !==
        normalizeText(order?.shipping_issue?.[field])
      );
    });
  };

  const handleIssueReasonChange = async (orderId, reason) => {
    if (!canEditOrders) {
      showEditPermissionMessage();
      return;
    }

    setUpdatingState(orderId, true);
    try {
      await api.post(`/shopify/orders/${orderId}/shipping-issue`, {
        active: true,
        reason,
      });
      setOrders((current) => {
        const nextOrders = current.map((order) =>
          order.id === orderId
            ? {
                ...order,
                shipping_issue: {
                  ...order.shipping_issue,
                  reason,
                  updated_at: new Date().toISOString(),
                },
                shipping_issue_reason: reason,
              }
            : order,
        );
        void writeCachedView(cacheKey, { rows: nextOrders });
        return nextOrders;
      });
      markSharedDataUpdated();
    } catch (updateError) {
      console.error("Error updating shipping issue:", updateError);
      setError(
        updateError?.response?.data?.error ||
          select(
            "\u0641\u0634\u0644 \u062a\u062d\u062f\u064a\u062b \u0633\u0628\u0628 \u0627\u0644\u0645\u0634\u0643\u0644\u0629",
            "Failed to update issue reason",
          ),
      );
    } finally {
      setUpdatingState(orderId, false);
    }
  };

  const handleSaveIssueNotes = async (order) => {
    if (!canEditOrders) {
      showEditPermissionMessage();
      return;
    }

    const orderId = order.id;
    const reason = normalizeShippingIssueReason(order?.shipping_issue?.reason);
    const shippingCompanyNote = normalizeText(
      getNoteDraftValue(order, "shipping_company_note"),
    );
    const customerServiceNote = normalizeText(
      getNoteDraftValue(order, "customer_service_note"),
    );

    setUpdatingState(orderId, true);
    setNoteSaveStatus(orderId, "saving");
    setError("");
    try {
      const response = await api.post(`/shopify/orders/${orderId}/shipping-issue`, {
        active: true,
        reason,
        shipping_company_note: shippingCompanyNote,
        customer_service_note: customerServiceNote,
      });
      const persistedShippingIssue = response?.data?.order?.shipping_issue || {};
      const persistedShippingCompanyNote = normalizeText(
        persistedShippingIssue?.shipping_company_note,
      );
      const persistedCustomerServiceNote = normalizeText(
        persistedShippingIssue?.customer_service_note,
      );

      if (
        persistedShippingCompanyNote !== shippingCompanyNote ||
        persistedCustomerServiceNote !== customerServiceNote
      ) {
        setNoteSaveStatus(orderId, "failed");
        setError(
          select(
            "الـ backend الحالي لم يحفظ النوتس. اعمل restart أو deploy لآخر نسخة من السيرفر ثم جرّب تاني.",
            "The current backend did not persist the notes. Restart or deploy the latest server version, then try again.",
          ),
        );
        return;
      }

      setOrders((current) => {
        const nextOrders = current.map((entry) =>
          entry.id === orderId
            ? {
                ...entry,
                shipping_issue: {
                  ...entry.shipping_issue,
                  reason,
                  shipping_company_note: shippingCompanyNote,
                  customer_service_note: customerServiceNote,
                  updated_at: new Date().toISOString(),
                },
                shipping_issue_reason: reason,
              }
            : entry,
        );
        void writeCachedView(cacheKey, { rows: nextOrders });
        return nextOrders;
      });
      clearNoteDraft(orderId);
      setLastUpdatedAt(new Date());
      setNoteSaveStatus(orderId, "saved");
      window.setTimeout(() => {
        setNoteSaveStatusByOrderId((current) => {
          if (current[orderId] !== "saved") {
            return current;
          }

          const next = { ...current };
          delete next[orderId];
          return next;
        });
      }, 2500);
      markSharedDataUpdated();
    } catch (updateError) {
      console.error("Error saving shipping follow-up notes:", updateError);
      setNoteSaveStatus(orderId, "failed");
      setError(
        updateError?.response?.data?.error ||
          select(
            "\u0641\u0634\u0644 \u062d\u0641\u0638 \u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629",
            "Failed to save follow-up notes",
          ),
      );
    } finally {
      setUpdatingState(orderId, false);
    }
  };

  const handleReturnToOrders = async (orderId) => {
    if (!canEditOrders) {
      showEditPermissionMessage();
      return;
    }

    setUpdatingState(orderId, true);
    try {
      await api.post(`/shopify/orders/${orderId}/shipping-issue`, {
        active: false,
      });
      setOrders((current) => {
        const nextOrders = current.filter((order) => order.id !== orderId);
        void writeCachedView(cacheKey, { rows: nextOrders });
        return nextOrders;
      });
      clearNoteDraft(orderId);
      markSharedDataUpdated();
    } catch (updateError) {
      console.error("Error returning order to orders list:", updateError);
      setError(
        updateError?.response?.data?.error ||
          select(
            "\u0641\u0634\u0644 \u0625\u0631\u062c\u0627\u0639 \u0627\u0644\u0623\u0648\u0631\u062f\u0631 \u0644\u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a",
            "Failed to return order to Orders",
          ),
      );
    } finally {
      setUpdatingState(orderId, false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={isRTL ? "text-right" : "text-left"}>
                <h1 className="text-3xl font-bold text-slate-900">
                  {select(
                    "\u0645\u0634\u0627\u0643\u0644 \u0627\u0644\u0634\u062d\u0646",
                    "Shipping Issues",
                  )}
                </h1>
                <p className="mt-1 text-slate-600">
                  {select(
                    "\u0627\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a \u0627\u0644\u0645\u062d\u0648\u0644\u0629 \u0645\u0646 \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a \u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u0634\u062d\u0646 \u062a\u0638\u0647\u0631 \u0647\u0646\u0627 \u0645\u0639 \u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0634\u0643\u0644\u0629 \u0648\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u062f\u0627\u062e\u0644\u064a\u0629.",
                    "Orders moved out of the main list for shipping follow-up appear here with issue status and internal follow-up notes.",
                  )}
                </p>
                {lastUpdatedAt ? (
                  <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    <Clock3 size={12} />
                    {select(
                      "\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b",
                      "Last refresh",
                    )}{" "}
                    {formatTime(lastUpdatedAt, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => fetchShippingIssues({ force: true })}
                className="flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-white transition hover:bg-sky-800"
              >
                <RefreshCw size={18} />
                {select("\u062a\u062d\u062f\u064a\u062b", "Refresh")}
              </button>
            </div>
          </div>

          {error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}

          {!canEditOrders ? (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <AlertCircle size={18} />
              {select(
                "هذه الصفحة متاحة لك للعرض فقط. تغيير حالة المشكلة أو حفظ الملاحظات يحتاج صلاحية تعديل الطلبات.",
                "This page is view-only for your account. Changing issue status or saving notes requires order edit permission.",
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title={select(
                "\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0645\u0634\u0627\u0643\u0644",
                "Total Issues",
              )}
              value={formatNumber(summary.total, {
                maximumFractionDigits: 0,
              })}
            />
            <SummaryCard
              title={select(
                "\u0645\u062a\u0627\u0628\u0639\u0627\u062a \u0645\u0641\u062a\u0648\u062d\u0629",
                "Open Follow-Up",
              )}
              value={formatNumber(summary.openFollowUp, {
                maximumFractionDigits: 0,
              })}
              tone="amber"
            />
            <SummaryCard
              title={select(
                "\u062d\u0627\u0644\u0627\u062a \u0628\u0627\u0644\u0647\u0627\u062a\u0641",
                "Phone Cases",
              )}
              value={formatNumber(summary.phoneCases, {
                maximumFractionDigits: 0,
              })}
              tone="sky"
            />
            <SummaryCard
              title={select(
                "\u062d\u0627\u0644\u0627\u062a \u0645\u063a\u0644\u0642\u0629",
                "Closed Cases",
              )}
              value={formatNumber(summary.closedCases, {
                maximumFractionDigits: 0,
              })}
              tone="rose"
            />
          </div>

          <div className="app-surface rounded-[28px] p-4 sm:p-5">
            <div className="space-y-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className={isRTL ? "text-right" : "text-left"}>
                  <h2 className="text-lg font-bold text-slate-900">
                    {select("فلترة ومتابعة المشاكل", "Filter & Follow-Up")}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {select(
                      "فلتر حسب آخر تحديث للمشكلة، ودوّر بسرعة على العميل أو رقم الأوردر.",
                      "Filter by the issue's latest update and search quickly by customer or order number.",
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportShippingIssues}
                    disabled={filteredOrders.length === 0}
                    className="app-button-primary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Download size={16} />
                    {select("تصدير Excel", "Export Excel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="app-button-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    <RotateCcw size={16} />
                    {select("إعادة ضبط", "Reset")}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {datePresetOptions.map((option) => {
                  const isActive = option.id === activeDatePresetId;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleDatePresetChange(option.id)}
                      className={`app-chip px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? "border-sky-700 bg-sky-700 text-white shadow-[0_12px_28px_-18px_rgba(2,132,199,0.9)]"
                          : "text-slate-700 hover:bg-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_260px_240px]">
                <div className="relative">
                  <Search
                    className={`absolute top-3 text-slate-400 ${
                      isRTL ? "right-3" : "left-3"
                    }`}
                    size={16}
                  />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={select(
                      "ابحث بالعميل أو رقم الأوردر",
                      "Search by customer or order number",
                    )}
                    className={`app-input py-2.5 text-sm ${
                      isRTL ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left"
                    }`}
                  />
                </div>

                <select
                  value={reasonFilter}
                  onChange={(event) => setReasonFilter(event.target.value)}
                  className="app-input px-3 py-2.5 text-sm text-slate-700"
                >
                  <option value="all">
                    {select("كل الأسباب", "All reasons")}
                  </option>
                  {reasonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <div className="app-note flex flex-col justify-center px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {select("النطاق الحالي", "Current Scope")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-900">
                    {activeDatePresetLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {select(
                      `${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} نتيجة مطابقة`,
                      `${formatNumber(filteredOrders.length, { maximumFractionDigits: 0 })} matching issue(s)`,
                    )}
                  </p>
                </div>
              </div>

              {activeDatePresetId === "custom" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="app-note flex flex-col gap-2 px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <CalendarRange size={14} />
                      {select("من تاريخ", "From Date")}
                    </span>
                    <input
                      type="date"
                      value={normalizedDateRange.dateFrom}
                      onChange={(event) =>
                        handleDateInputChange("dateFrom", event.target.value)
                      }
                      className="app-input px-3 py-2.5 text-sm"
                    />
                  </label>

                  <label className="app-note flex flex-col gap-2 px-4 py-3">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <CalendarRange size={14} />
                      {select("إلى تاريخ", "To Date")}
                    </span>
                    <input
                      type="date"
                      value={normalizedDateRange.dateTo}
                      onChange={(event) =>
                        handleDateInputChange("dateTo", event.target.value)
                      }
                      className="app-input px-3 py-2.5 text-sm"
                    />
                  </label>
                </div>
              ) : null}
            </div>

            {loading ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                {select(
                  "\u062c\u0627\u0631\u064a \u062a\u062d\u0645\u064a\u0644 \u0645\u0634\u0627\u0643\u0644 \u0627\u0644\u0634\u062d\u0646...",
                  "Loading shipping issues...",
                )}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                {select(
                  "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0634\u0627\u0643\u0644 \u0634\u062d\u0646 \u0645\u0637\u0627\u0628\u0642\u0629 \u062d\u0627\u0644\u064a\u0627\u064b.",
                  "There are no matching shipping issues right now.",
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {paginatedOrders.map((order) => {
                    const reason = normalizeShippingIssueReason(
                      order?.shipping_issue?.reason,
                    );
                    const isUpdating = Boolean(updatingOrderIds[order.id]);
                    const shippingCompanyNote = getNoteDraftValue(
                      order,
                      "shipping_company_note",
                    );
                    const customerServiceNote = getNoteDraftValue(
                      order,
                      "customer_service_note",
                    );
                    const hasUnsavedNotes = hasNoteDraftChanged(order);
                    const noteSaveStatus = noteSaveStatusByOrderId[order.id];

                    return (
                      <article
                        key={order.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm sm:p-5"
                      >
                        <div className="grid gap-4 xl:grid-cols-[180px_minmax(0,1fr)_260px] xl:items-start">
                          <div>
                            <button
                              type="button"
                              onClick={() => navigate(`/orders/${order.id}`)}
                              className="font-semibold text-slate-900 transition hover:text-sky-700"
                            >
                              #{order.order_number || order.shopify_id}
                            </button>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatDate(
                                order?.shipping_issue?.updated_at ||
                                  order.updated_at,
                              )}
                            </p>
                          </div>

                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              {order.customer_name ||
                                select(
                                  "\u0639\u0645\u064a\u0644 \u063a\u064a\u0631 \u0645\u0639\u0631\u0648\u0641",
                                  "Unknown customer",
                                )}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {order.customer_email || "-"}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getShippingIssueBadgeClassName(
                                  reason,
                                )}`}
                              >
                                {getShippingIssueReasonLabel(reason, select)}
                              </span>
                              <span className="text-xs text-slate-500">
                                {select(
                                  "\u0622\u062e\u0631 \u062a\u0639\u062f\u064a\u0644",
                                  "Last update",
                                )}
                                :{" "}
                                {formatDate(
                                  order?.shipping_issue?.updated_at ||
                                    order.updated_at,
                                )}
                              </span>
                            </div>
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {select(
                                "\u062a\u063a\u064a\u064a\u0631 \u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u0634\u0643\u0644\u0629",
                                "Change issue",
                              )}
                            </label>
                            <select
                              value={reason}
                              onChange={(event) =>
                                handleIssueReasonChange(
                                  order.id,
                                  event.target.value,
                                )
                              }
                              disabled={isUpdating || !canEditOrders}
                              className="app-input w-full px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                            >
                              {reasonOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] xl:items-start">
                          <ShippingIssueNoteField
                            label={select(
                              "\u0645\u0644\u0627\u062d\u0638\u0629 \u0634\u0631\u0643\u0629 \u0627\u0644\u0634\u062d\u0646",
                              "Shipping Company Note",
                            )}
                            description={select(
                              "\u0627\u0643\u062a\u0628 \u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b \u0648\u0627\u0644\u062e\u0637\u0648\u0629 \u0627\u0644\u0642\u0627\u062f\u0645\u0629 \u0645\u0646 \u062c\u0647\u0629 \u0627\u0644\u0634\u062d\u0646.",
                              "Document the latest courier update and next shipping step.",
                            )}
                            placeholder={select(
                              "\u0645\u062b\u0627\u0644: \u062a\u0645 \u062a\u0623\u0643\u064a\u062f \u0645\u0639\u0627\u062f \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645 \u063a\u062f\u0627\u064b \u0645\u0639 \u0627\u0644\u0645\u0646\u062f\u0648\u0628.",
                              "Example: Pickup was confirmed with the courier for tomorrow.",
                            )}
                            value={shippingCompanyNote}
                            onChange={(event) =>
                              updateNoteDraft(
                                order,
                                "shipping_company_note",
                                event.target.value,
                              )
                            }
                            disabled={isUpdating || !canEditOrders}
                            isRTL={isRTL}
                          />

                          <ShippingIssueNoteField
                            label={select(
                              "\u0645\u0644\u0627\u062d\u0638\u0629 \u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621",
                              "Customer Service Note",
                            )}
                            description={select(
                              "\u0627\u0643\u062a\u0628 \u062e\u0644\u0627\u0635\u0629 \u062a\u0648\u0627\u0635\u0644 \u062e\u062f\u0645\u0629 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0645\u0639 \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0645\u0627 \u062a\u0645 \u0627\u0644\u0627\u062a\u0641\u0627\u0642 \u0639\u0644\u064a\u0647.",
                              "Summarize customer service follow-up and the agreed customer action.",
                            )}
                            placeholder={select(
                              "\u0645\u062b\u0627\u0644: \u062a\u0645 \u0625\u0628\u0644\u0627\u063a \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0623\u0643\u062f \u062a\u0648\u0627\u0641\u0631 \u0627\u0644\u0647\u0627\u062a\u0641 \u0623\u062b\u0646\u0627\u0621 \u0627\u0644\u0627\u0633\u062a\u0644\u0627\u0645.",
                              "Example: Customer was informed and confirmed phone availability during delivery.",
                            )}
                            value={customerServiceNote}
                            onChange={(event) =>
                              updateNoteDraft(
                                order,
                                "customer_service_note",
                                event.target.value,
                              )
                            }
                            disabled={isUpdating || !canEditOrders}
                            isRTL={isRTL}
                          />

                          <div className="app-note flex h-full flex-col justify-between gap-4 px-4 py-4">
                            <div className={isRTL ? "text-right" : "text-left"}>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                                {select(
                                  "\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629",
                                  "Follow-Up Actions",
                                )}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-slate-600">
                                {select(
                                  "\u062d\u062f\u0651\u062b \u0627\u0644\u062d\u0627\u0644\u0629 \u0648\u0627\u062d\u0641\u0638 \u0627\u0644\u0646\u0648\u062a\u0633 \u0627\u0644\u062f\u0627\u062e\u0644\u064a\u0629 \u0628\u0639\u062f \u0643\u0644 \u0645\u062a\u0627\u0628\u0639\u0629 \u0645\u0639 \u0627\u0644\u0634\u062d\u0646 \u0623\u0648 \u0627\u0644\u0639\u0645\u064a\u0644.",
                                  "Update the issue status and save internal notes after each shipping or customer follow-up.",
                                )}
                              </p>
                              {noteSaveStatus === "saved" ? (
                                <p className="mt-2 text-xs font-medium text-emerald-700">
                                  {select(
                                    "تم حفظ النوتس بنجاح.",
                                    "Notes saved successfully.",
                                  )}
                                </p>
                              ) : null}
                              {noteSaveStatus === "failed" ? (
                                <p className="mt-2 text-xs font-medium text-rose-700">
                                  {select(
                                    "فشل تأكيد حفظ النوتس من السيرفر.",
                                    "Could not confirm note persistence from the server.",
                                  )}
                                </p>
                              ) : null}
                              {hasUnsavedNotes ? (
                                <p className="mt-2 text-xs font-medium text-amber-700">
                                  {select(
                                    "Ø§Ù„ÙƒØªØ§Ø¨Ø© Ø§Ù„ØºÙŠØ± Ù…Ø­ÙÙˆØ¸Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø³ÙŠØ±ÙØ± Ø¨ØªØªØ®Ø²Ù† Ù…Ø­Ù„ÙŠÙ‹Ø§ Ø¹Ù„Ù‰ Ù†ÙØ³ Ø§Ù„Ø¬Ù‡Ø§Ø² Ø­ØªÙ‰ Ù„Ùˆ Ø­ØµÙ„ refresh.",
                                    "Unsaved text stays stored locally on this device even after a refresh.",
                                  )}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveIssueNotes(order)}
                                disabled={!canEditOrders || !hasUnsavedNotes || isUpdating}
                                className="inline-flex items-center gap-1 rounded-lg bg-sky-700 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {select(
                                  noteSaveStatus === "saving"
                                    ? "\u062c\u0627\u0631\u064a \u062d\u0641\u0638 \u0627\u0644\u0646\u0648\u062a\u0633..."
                                    : "\u062d\u0641\u0638 \u0627\u0644\u0646\u0648\u062a\u0633",
                                  noteSaveStatus === "saving"
                                    ? "Saving notes..."
                                    : "Save notes",
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/orders/${order.id}`)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                              >
                                <Eye size={15} />
                                {select("\u0639\u0631\u0636", "View")}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReturnToOrders(order.id)}
                                disabled={!canEditOrders || isUpdating}
                                className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Undo2 size={15} />
                                {select(
                                  "\u0631\u062c\u0648\u0639 \u0644\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a",
                                  "Return to Orders",
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-600">
                    {select(
                      `\u0639\u0631\u0636 ${formatNumber(visibleRange.start, {
                        maximumFractionDigits: 0,
                      })} - ${formatNumber(visibleRange.end, {
                        maximumFractionDigits: 0,
                      })} \u0645\u0646 ${formatNumber(filteredOrders.length, {
                        maximumFractionDigits: 0,
                      })} \u0623\u0648\u0631\u062f\u0631`,
                      `Showing ${formatNumber(visibleRange.start, {
                        maximumFractionDigits: 0,
                      })} - ${formatNumber(visibleRange.end, {
                        maximumFractionDigits: 0,
                      })} of ${formatNumber(filteredOrders.length, {
                        maximumFractionDigits: 0,
                      })} orders`,
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage((page) => Math.max(1, page - 1))
                      }
                      disabled={currentPage <= 1}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {select("\u0627\u0644\u0633\u0627\u0628\u0642", "Previous")}
                    </button>
                    {paginationPages.map((pageNumber) => (
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
                    <button
                      type="button"
                      onClick={() =>
                        setCurrentPage((page) => Math.min(totalPages, page + 1))
                      }
                      disabled={currentPage >= totalPages}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {select("\u0627\u0644\u062a\u0627\u0644\u064a", "Next")}
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
