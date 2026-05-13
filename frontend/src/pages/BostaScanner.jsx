import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  DollarSign,
  Download,
  Package,
  RotateCcw,
  Search,
  Trash2,
  TrendingUp,
  Truck,
  X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import api from "../utils/api";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import { formatCurrency } from "../utils/helpers";
import {
  buildBostaScannerExportRows,
  canReuseScannedItem,
  calculateScannerProfitSnapshot,
  filterBostaScannerItems,
  getBostaFinancialDetails,
  getFallbackOrderCost,
  getBostaScannerItemTimestamp,
  getBostaScannerStatusKey,
  getBostaScannerTimeRange,
  normalizeScannedItem,
  parseAmount,
  resolveBostaScannerFallback,
} from "../utils/bostaScanner";
import {
  isDemoTrackingNumber,
  normalizeTrackingNumber,
} from "../utils/bostaTracking";
import {
  buildStoreScopedCacheKey,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";

const SCANNER_CACHE_SCOPE = "bosta-scanner:history";
const ENABLE_VERCEL_BOSTA_FALLBACK =
  String(process.env.REACT_APP_ENABLE_VERCEL_BOSTA_FALLBACK || "")
    .trim()
    .toLowerCase() === "true";
const INITIAL_FILTERS = {
  searchTerm: "",
  status: "all",
  timePreset: "details",
  customFrom: "",
  customTo: "",
};

const extractFetchErrorMessage = async (response) => {
  try {
    const data = await response.json();
    return data?.message || data?.error || `HTTP ${response.status}`;
  } catch {
    const text = await response.text();
    return text || `HTTP ${response.status}`;
  }
};

const getCachedScannerRows = (cached) => {
  if (Array.isArray(cached?.value?.rows)) {
    return cached.value.rows;
  }

  if (Array.isArray(cached?.rows)) {
    return cached.rows;
  }

  return [];
};

const getDeliveryStateBadgeClass = (state) => {
  if (state === 40 || state === 45) {
    return "bg-green-100 text-green-800";
  }

  if (state === 30 || state === 41) {
    return "bg-blue-100 text-blue-800";
  }

  if (state === 47 || state === 100 || state === 101) {
    return "bg-red-100 text-red-800";
  }

  if (state === 48 || state === 49 || state === 50 || state === 60) {
    return "bg-gray-100 text-gray-800";
  }

  return "bg-yellow-100 text-yellow-800";
};

const getScannerChipClass = (item) => {
  if (item?.is_pending) {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }

  if (item?.has_error) {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
};

const getScannerChipStatus = (item, select) => {
  if (item?.is_pending) {
    return select("قيد الحساب", "Queued");
  }

  if (item?.has_error) {
    return select("إعادة", "Retry");
  }

  return item?.delivery_state_label || select("جاهز", "Ready");
};

const buildScannerStatusFilterOptions = (select) => [
  { value: "all", label: select("كل الحالات", "All statuses") },
  { value: "pending", label: select("قيد المعالجة", "Queued") },
  { value: "failed", label: select("فشل", "Failed") },
  { value: "delivered", label: select("تم التسليم", "Delivered") },
  { value: "in_transit", label: select("في الطريق", "In transit") },
  { value: "exception", label: select("مشكلة", "Exception") },
  { value: "cancelled", label: select("ملغي", "Cancelled") },
  { value: "other", label: select("أخرى", "Other") },
];

const buildScannerTimePresetOptions = (select) => [
  { value: "daily", label: select("يومي", "Daily") },
  { value: "monthly", label: select("شهري", "Monthly") },
  { value: "custom", label: select("مخصص", "Custom") },
  { value: "details", label: select("تفاصيل", "Details") },
];

const formatDisplayDateValue = (value, select) => {
  const parsed = value instanceof Date ? value : new Date(value || "");

  if (Number.isNaN(parsed.getTime())) {
    return select("غير متاح", "Unavailable");
  }

  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDisplayDateOnly = (value, select) => {
  const parsed = value instanceof Date ? value : new Date(value || "");

  if (Number.isNaN(parsed.getTime())) {
    return select("غير متاح", "Unavailable");
  }

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const buildTimeFilterSummary = (timeRange, select) => {
  if (timeRange?.preset === "daily") {
    return select("شحنات اليوم فقط", "Today's scanned shipments only");
  }

  if (timeRange?.preset === "monthly") {
    return select("شحنات الشهر الحالي", "This month's scanned shipments");
  }

  if (timeRange?.preset === "custom") {
    if (timeRange?.start && timeRange?.end) {
      return `${formatDisplayDateOnly(timeRange.start, select)} - ${formatDisplayDateOnly(
        timeRange.end,
        select,
      )}`;
    }

    if (timeRange?.start) {
      return `${select("من", "From")} ${formatDisplayDateOnly(timeRange.start, select)}`;
    }

    if (timeRange?.end) {
      return `${select("إلى", "Until")} ${formatDisplayDateOnly(timeRange.end, select)}`;
    }

    return select(
      "اختار من وإلى لتفعيل الفترة المخصصة",
      "Choose a start and end date to activate the custom range.",
    );
  }

  return select("كل السجلات المحفوظة بالتفاصيل", "Full detailed history");
};

const buildScannerStatusCounts = (items = []) =>
  (Array.isArray(items) ? items : []).reduce(
    (acc, item) => {
      const nextKey = getBostaScannerStatusKey(item);
      acc[nextKey] = (acc[nextKey] || 0) + 1;
      return acc;
    },
    {
      pending: 0,
      failed: 0,
      delivered: 0,
      in_transit: 0,
      exception: 0,
      cancelled: 0,
      other: 0,
    },
  );

const calculateScannerTotals = (items = []) =>
  (Array.isArray(items) ? items : []).reduce(
    (acc, item) => ({
      orderTotal: acc.orderTotal + parseAmount(item.order_total ?? item.revenue),
      productCost:
        acc.productCost + parseAmount(item.product_cost ?? item.total_cost),
      estimatedBostaDues:
        acc.estimatedBostaDues +
        parseAmount(item.estimated_bosta_dues ?? item.bosta_dues),
      netProfit: acc.netProfit + parseAmount(item.net_profit),
    }),
    {
      orderTotal: 0,
      productCost: 0,
      estimatedBostaDues: 0,
      netProfit: 0,
    },
  );

const upsertScannerItemAtBottom = (items, nextItem) => {
  const existingIndex = items.findIndex(
    (item) => item.tracking_number === nextItem.tracking_number,
  );

  if (existingIndex < 0) {
    return [...items, nextItem];
  }

  const updated = [...items];
  updated.splice(existingIndex, 1);
  updated.push(nextItem);
  return updated;
};

const createPendingScannerItem = (trackingNumber, scanId, select) => {
  const now = new Date().toISOString();

  return normalizeScannedItem({
    tracking_number: trackingNumber,
    scan_id: scanId,
    is_pending: true,
    order_name: select("جاري قراءة التفاصيل...", "Loading details..."),
    customer_name: select(
      "يمكنك مسح الرقم التالي الآن",
      "Scan the next number now",
    ),
    delivery_state_label: select("جاري المعالجة", "Processing"),
    scan_data_source: "pending_scan",
    scan_resolution_message: select(
      "تمت إضافة الشحنة وسيتم استكمال التفاصيل في الخلفية.",
      "Shipment was queued and details will finish loading in the background.",
    ),
    last_status_update: now,
    scanned_at: now,
  });
};

const createFailedScannerItem = (
  trackingNumber,
  scanId,
  errorMessage,
  select,
) => {
  const now = new Date().toISOString();

  return normalizeScannedItem({
    tracking_number: trackingNumber,
    scan_id: scanId,
    has_error: true,
    order_name: select("فشل تحميل الشحنة", "Shipment load failed"),
    customer_name: select("أعد المحاولة أو احذف الصف", "Retry scan or delete row"),
    delivery_state_label: select("فشل", "Failed"),
    scan_data_source: "scan_failed",
    scan_resolution_message:
      errorMessage ||
      select("حدث خطأ أثناء جلب البيانات.", "Failed to fetch shipment data."),
    last_status_update: now,
    scanned_at: now,
  });
};

const fetchShipmentByTrackingNumber = async (trackingNumber) => {
  try {
    const response = await api.get(`/bosta/shipments/${trackingNumber}`);
    return response.data;
  } catch (apiError) {
    if (!ENABLE_VERCEL_BOSTA_FALLBACK) {
      throw apiError;
    }

    try {
      const vercelResponse = await fetch(
        `/api/bosta-shipment?trackingNumber=${encodeURIComponent(trackingNumber)}`,
      );

      if (!vercelResponse.ok) {
        throw new Error(await extractFetchErrorMessage(vercelResponse));
      }

      return await vercelResponse.json();
    } catch (vercelError) {
      throw vercelError?.message ? vercelError : apiError;
    }
  }
};

export default function BostaScanner() {
  const { select, formatNumber } = useLocale();
  const { hasPermission } = useAuth();
  const { currentStoreId } = useStore();
  const [barcode, setBarcode] = useState("");
  const [scannedItems, setScannedItems] = useState([]);
  const [processingCount, setProcessingCount] = useState(0);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const inputRef = useRef(null);
  const latestScanIdByTrackingRef = useRef(new Map());
  const deferredSearchTerm = useDeferredValue(filters.searchTerm);
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey(SCANNER_CACHE_SCOPE, currentStoreId),
    [currentStoreId],
  );
  const scannedItemLookup = useMemo(() => {
    const lookup = new Map();

    scannedItems.forEach((item) => {
      if (item?.tracking_number) {
        lookup.set(item.tracking_number, item);
      }
    });

    return lookup;
  }, [scannedItems]);

  const canViewOrders = hasPermission("can_view_orders");
  const timePresetOptions = useMemo(
    () => buildScannerTimePresetOptions(select),
    [select],
  );
  const activeTimeRange = useMemo(
    () =>
      getBostaScannerTimeRange({
        timePreset: filters.timePreset,
        customFrom: filters.customFrom,
        customTo: filters.customTo,
      }),
    [filters.customFrom, filters.customTo, filters.timePreset],
  );
  const searchAndTimeFilteredItems = useMemo(
    () =>
      filterBostaScannerItems(scannedItems, {
        searchTerm: deferredSearchTerm,
        timePreset: filters.timePreset,
        customFrom: filters.customFrom,
        customTo: filters.customTo,
      }),
    [
      deferredSearchTerm,
      filters.customFrom,
      filters.customTo,
      filters.timePreset,
      scannedItems,
    ],
  );
  const statusCounts = useMemo(
    () => buildScannerStatusCounts(searchAndTimeFilteredItems),
    [searchAndTimeFilteredItems],
  );
  const statusFilterOptions = useMemo(
    () =>
      buildScannerStatusFilterOptions(select).map((option) => ({
        ...option,
        count:
          option.value === "all"
            ? searchAndTimeFilteredItems.length
            : statusCounts[option.value] || 0,
      })),
    [searchAndTimeFilteredItems.length, select, statusCounts],
  );
  const filteredScannedItems = useMemo(
    () =>
      filterBostaScannerItems(searchAndTimeFilteredItems, {
        status: filters.status,
      }),
    [filters.status, searchAndTimeFilteredItems],
  );
  const visibleDateMetrics = useMemo(
    () =>
      filteredScannedItems.reduce(
        (acc, item) => {
          const timestamp = getBostaScannerItemTimestamp(item);

          if (!timestamp) {
            return acc;
          }

          return {
            earliest:
              !acc.earliest || timestamp < acc.earliest
                ? timestamp
                : acc.earliest,
            latest:
              !acc.latest || timestamp > acc.latest ? timestamp : acc.latest,
          };
        },
        {
          earliest: null,
          latest: null,
        },
      ),
    [filteredScannedItems],
  );
  const activeTimePresetLabel =
    timePresetOptions.find((option) => option.value === filters.timePreset)
      ?.label || filters.timePreset;
  const activeTimeSummary = buildTimeFilterSummary(activeTimeRange, select);
  const visibleDateSummary = visibleDateMetrics.earliest
    ? formatDisplayDateValue(visibleDateMetrics.earliest, select)
    : select("لا يوجد توقيت ظاهر", "No visible timestamp");
  const visibleDateHint = visibleDateMetrics.latest
    ? formatDisplayDateValue(visibleDateMetrics.latest, select)
    : select("امسح شحنة لعرض الفترة", "Scan shipments to show the visible range");
  const hasActiveFilters =
    Boolean(String(filters.searchTerm || "").trim()) ||
    filters.status !== "all" ||
    filters.timePreset !== INITIAL_FILTERS.timePreset ||
    (filters.timePreset === "custom" &&
      (Boolean(filters.customFrom) || Boolean(filters.customTo)));

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus();
    };

    focusInput();
    window.addEventListener("focus", focusInput);

    return () => {
      window.removeEventListener("focus", focusInput);
    };
  }, []);

  useEffect(() => {
    let active = true;

    readCachedView(cacheKey)
      .then((cached) => {
        if (!active) {
          return;
        }

        setScannedItems(
          getCachedScannerRows(cached).map((item) => normalizeScannedItem(item)),
        );
      })
      .finally(() => {
        if (active) {
          setCacheHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    if (!cacheHydrated) {
      return;
    }

    void writeCachedView(cacheKey, {
      rows: scannedItems.filter((item) => !item.is_pending),
    });
  }, [cacheHydrated, cacheKey, scannedItems]);

  const handleScan = (event) => {
    event.preventDefault();
    const trimmedBarcode = normalizeTrackingNumber(barcode);

    if (!trimmedBarcode) {
      setError(
        select("من فضلك أدخل رقم التتبع", "Please enter tracking number"),
      );
      return;
    }

    if (isDemoTrackingNumber(trimmedBarcode)) {
      setError(
        select(
          "تم إيقاف أرقام التتبع التجريبية. استخدم رقم بوسطة حقيقي.",
          "Demo tracking is disabled. Use a real Bosta tracking number.",
        ),
      );
      setBarcode(trimmedBarcode);
      return;
    }

    const existingItem = scannedItemLookup.get(trimmedBarcode);

    if (existingItem?.is_pending) {
      setError("");
      setBarcode("");
      setScannedItems((current) =>
        upsertScannerItemAtBottom(current, {
          ...existingItem,
          scanned_at: new Date().toISOString(),
        }),
      );
      inputRef.current?.focus();
      return;
    }

    if (canReuseScannedItem(existingItem)) {
      setError("");
      setBarcode("");
      setScannedItems((current) =>
        upsertScannerItemAtBottom(
          current,
          normalizeScannedItem({
            ...existingItem,
            scanned_at: new Date().toISOString(),
          }),
        ),
      );
      inputRef.current?.focus();
      return;
    }

    const scanId = `${trimmedBarcode}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    latestScanIdByTrackingRef.current.set(trimmedBarcode, scanId);
    setError("");
    setBarcode("");
    inputRef.current?.focus();

    setScannedItems((current) =>
      upsertScannerItemAtBottom(
        current,
        createPendingScannerItem(trimmedBarcode, scanId, select),
      ),
    );
    setProcessingCount((current) => current + 1);

    void (async () => {
      try {
        const shipment = await fetchShipmentByTrackingNumber(trimmedBarcode);

        if (!shipment) {
          throw new Error(select("الشحنة غير موجودة", "Shipment not found"));
        }

        if (latestScanIdByTrackingRef.current.get(trimmedBarcode) !== scanId) {
          return;
        }

        const financialDetails = getBostaFinancialDetails(shipment);
        const scannerFallback = resolveBostaScannerFallback(shipment, select);
        let orderTotal = parseAmount(shipment.order_total ?? shipment.revenue);
        let productCost = parseAmount(
          shipment.product_cost ?? shipment.total_cost,
        );
        let orderName =
          shipment.order_name ||
          scannerFallback.orderName ||
          select("غير معروف", "Unknown");
        let customerName =
          shipment.customer_name ||
          scannerFallback.customerName ||
          select("غير معروف", "Unknown");

        if (shipment.order_id) {
          try {
            const orderResponse = await api.get(
              `/shopify/orders/${shipment.order_id}/details`,
            );
            const order = orderResponse.data;
            const fallbackProductCost = getFallbackOrderCost(order);

            if (orderTotal <= 0) {
              orderTotal = parseAmount(order.total_price);
            }

            if (fallbackProductCost > 0) {
              productCost =
                productCost > 0
                  ? Math.max(productCost, fallbackProductCost)
                  : fallbackProductCost;
            }

            orderName =
              shipment.order_name ||
              order.name ||
              order.order_number ||
              shipment.order_id;
            customerName =
              shipment.customer_name ||
              order.customer?.name ||
              order.customer_info?.name ||
              [order.customer_info?.first_name, order.customer_info?.last_name]
                .filter(Boolean)
                .join(" ") ||
              order.customer_name ||
              select("غير معروف", "Unknown");
          } catch (orderError) {
            console.warn("Could not fetch order details:", orderError);
          }
        }

        if (orderTotal <= 0) {
          orderTotal = financialDetails.codAmount;
        }

        const snapshot = calculateScannerProfitSnapshot({
          orderTotal,
          productCost,
          shipment,
        });

        const resolvedItem = normalizeScannedItem({
          tracking_number: trimmedBarcode,
          scan_id: scanId,
          is_pending: false,
          order_id: shipment.order_id,
          order_name: orderName,
          customer_name: customerName,
          business_reference:
            shipment.business_reference || scannerFallback.businessReference,
          has_order_match:
            Boolean(shipment.has_order_match) || scannerFallback.hasOrderMatch,
          scan_data_source:
            shipment.scan_data_source || scannerFallback.scanDataSource,
          scan_resolution_message:
            shipment.scan_resolution_message ||
            scannerFallback.scanResolutionMessage,
          order_total: snapshot.orderTotal,
          revenue: snapshot.orderTotal,
          product_cost: snapshot.productCost,
          total_cost: snapshot.productCost,
          estimated_bosta_dues: snapshot.estimatedBostaDues,
          shipping_fee: snapshot.shippingFee,
          shipping_cost: snapshot.shippingFee,
          net_profit: snapshot.netProfit,
          real_net_profit: snapshot.netProfit,
          cod_amount: financialDetails.codAmount,
          bosta_dues: financialDetails.bostaDues,
          deposited_amount: financialDetails.depositedAmount,
          vat_amount: financialDetails.vatAmount,
          opening_package_fees: financialDetails.openingPackageFees,
          delivery_state: shipment.delivery_state,
          delivery_state_label: shipment.delivery_state_label,
          tracking_url: financialDetails.trackingUrl,
          promised_date: financialDetails.promisedDate,
          last_status_update: financialDetails.lastStatusUpdate,
          support_phone_numbers: financialDetails.supportPhoneNumbers,
          scanned_at: new Date().toISOString(),
        });

        if (latestScanIdByTrackingRef.current.get(trimmedBarcode) !== scanId) {
          return;
        }

        setScannedItems((current) =>
          upsertScannerItemAtBottom(current, resolvedItem),
        );
      } catch (scanError) {
        console.error("Error scanning barcode:", scanError);
        const errorMessage =
          scanError?.response?.data?.message ||
          scanError?.response?.data?.error ||
          scanError?.message ||
          select(
            "فشل في جلب بيانات الشحنة",
            "Failed to fetch shipment data",
          );

        if (latestScanIdByTrackingRef.current.get(trimmedBarcode) !== scanId) {
          return;
        }

        setScannedItems((current) =>
          upsertScannerItemAtBottom(
            current,
            createFailedScannerItem(
              trimmedBarcode,
              scanId,
              errorMessage,
              select,
            ),
          ),
        );
        setError(errorMessage);
      } finally {
        setProcessingCount((current) => Math.max(0, current - 1));
        inputRef.current?.focus();
      }
    })();
  };

  const handleDelete = (trackingNumber) => {
    latestScanIdByTrackingRef.current.delete(trackingNumber);
    setScannedItems((current) =>
      current.filter((item) => item.tracking_number !== trackingNumber),
    );
    inputRef.current?.focus();
  };

  const handleClearAll = () => {
    if (window.confirm(select("هل تريد مسح كل البيانات؟", "Clear all data?"))) {
      latestScanIdByTrackingRef.current.clear();
      setScannedItems([]);
      inputRef.current?.focus();
    }
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const exportFilteredResults = () => {
    if (filteredScannedItems.length === 0) {
      return;
    }

    const exportRows = buildBostaScannerExportRows(filteredScannedItems);
    const exportFilename = buildCsvFilename("bosta-scanner");

    downloadCsvSections({
      filename: exportFilename,
      sections: [
        {
          title: select("ملخص الفلتر الحالي", "Current filter summary"),
          headers: [
            select("البند", "Metric"),
            select("القيمة", "Value"),
          ],
          rows: [
            [
              select("النتائج الظاهرة", "Visible shipments"),
              formatNumber(filteredScannedItems.length, {
                maximumFractionDigits: 0,
              }),
            ],
            [
              select("إجمالي الشحنات الممسوحة", "Total scanned shipments"),
              formatNumber(scannedItems.length, {
                maximumFractionDigits: 0,
              }),
            ],
            [
              select("إجمالي الأوردرات", "Order total"),
              formatCurrency(totals.orderTotal),
            ],
            [
              select("تكلفة المنتجات", "Product cost"),
              formatCurrency(totals.productCost),
            ],
            [
              select("مستحقات بوسطة", "Estimated Bosta dues"),
              formatCurrency(totals.estimatedBostaDues),
            ],
            [
              select("النيت بروفت", "Net profit"),
              formatCurrency(totals.netProfit),
            ],
            [
              select("نص البحث", "Search term"),
              String(filters.searchTerm || "").trim() ||
                select("بدون", "None"),
            ],
            [
              select("فلتر الحالة", "Status filter"),
              statusFilterOptions.find((option) => option.value === filters.status)
                ?.label || filters.status,
            ],
            [
              select("فلتر الوقت", "Time filter"),
              activeTimePresetLabel,
            ],
            [
              select("ملخص الفترة", "Time summary"),
              activeTimeSummary,
            ],
          ],
        },
        {
          title: select("الشحنات الظاهرة", "Visible shipments"),
          headers: [
            "Tracking #",
            "Status Key",
            "Status Label",
            "Order",
            "Reference",
            "Customer",
            "COD Amount",
            "Order Total",
            "Product Cost",
            "Estimated Bosta Dues",
            "Shipping Fee",
            "Opening Fee",
            "VAT",
            "Net Profit",
            "Scanned At",
            "Last Status Update",
            "Promised Date",
            "Data Source",
            "Resolution Note",
            "Tracking URL",
          ],
          rows: exportRows,
        },
      ],
    });
  };

  const totals = useMemo(
    () => calculateScannerTotals(filteredScannedItems),
    [filteredScannedItems],
  );

  if (!canViewOrders) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="p-8">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
              <p className="text-red-800">
                {select(
                  "ليس لديك صلاحية لعرض هذه الصفحة",
                  "You don't have permission to view this page",
                )}
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
        <div className="space-y-6 p-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {select("سكانر بوسطة", "Bosta Scanner")}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {select(
                  "اسكان باركود الشحنة لحساب النيت بروفت بعد خصم مستحقات بوسطة وتكلفة المنتجات.",
                  "Scan shipment barcode to calculate net profit after Bosta dues and product cost.",
                )}
              </p>
            </div>
            {scannedItems.length > 0 ? (
              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
              >
                <Trash2 size={16} />
                {select("مسح الكل", "Clear All")}
              </button>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <form onSubmit={handleScan} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  {select("رقم التتبع", "Tracking Number")}
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  dir="ltr"
                  autoFocus
                  autoComplete="off"
                  inputMode="text"
                  spellCheck={false}
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                  placeholder={select(
                    "اسكان أو اكتب رقم التتبع",
                    "Scan or type tracking number",
                  )}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-lg focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              {false ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-slate-600">
                      {select("الأرقام الممسوحة", "Scanned numbers")}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {select("احذف أي رقم من x", "Remove any number with x")}
                    </p>
                  </div>
                  <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                    {scannedItems.map((item) => (
                      <div
                        key={`${item.tracking_number}-chip`}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${getScannerChipClass(
                          item,
                        )}`}
                      >
                        <span className="font-mono">{item.tracking_number}</span>
                        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {getScannerChipStatus(item, select)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.tracking_number)}
                          className="rounded-full p-0.5 transition hover:bg-black/5"
                          title={select("حذف", "Delete")}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={!normalizeTrackingNumber(barcode)}
                  className="w-full rounded-xl bg-sky-600 px-6 py-3 font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {select("سكان", "Scan")}
                </button>
                <p className="text-xs text-slate-500">
                  {select(
                    "النتائج بتتحفظ تلقائيًا ومش هتتمسح إلا لما تعمل Delete أو Clear All.",
                    "Results are saved automatically and stay until you delete them or clear all.",
                  )}
                </p>
                {processingCount > 0 ? (
                  <p className="text-xs text-sky-700">
                    {select(
                      `جاري استكمال ${processingCount} شحنة في الخلفية ويمكنك مسح الرقم التالي الآن.`,
                      `${processingCount} shipment(s) are finishing in the background. You can scan the next number now.`,
                    )}
                  </p>
                ) : null}
              </div>
            </form>
          </div>

          {scannedItems.length > 0 ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {select("فلترة السجلات الممسوحة", "Filter scanned history")}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {select(
                      `عرض ${formatNumber(filteredScannedItems.length, {
                        maximumFractionDigits: 0,
                      })} من أصل ${formatNumber(scannedItems.length, {
                        maximumFractionDigits: 0,
                      })} شحنة ممسوحة.`,
                      `Showing ${formatNumber(filteredScannedItems.length, {
                        maximumFractionDigits: 0,
                      })} of ${formatNumber(scannedItems.length, {
                        maximumFractionDigits: 0,
                      })} scanned shipment(s).`,
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resetFilters}
                    disabled={!hasActiveFilters}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw size={16} />
                    {select("إعادة ضبط", "Reset")}
                  </button>
                  <button
                    type="button"
                    onClick={exportFilteredResults}
                    disabled={filteredScannedItems.length === 0}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download size={16} />
                    {select("تصدير شيت", "Export sheet")}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.7fr)]">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {select("بحث", "Search")}
                  </span>
                  <div className="relative">
                    <Search
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="text"
                      value={filters.searchTerm}
                      onChange={(event) =>
                        setFilters((current) => ({
                          ...current,
                          searchTerm: event.target.value,
                        }))
                      }
                      placeholder={select(
                        "ابحث برقم التتبع أو الأوردر أو العميل أو المرجع",
                        "Search tracking #, order, customer, or reference",
                      )}
                      className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                    />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">
                    {select("الحالة", "Status")}
                  </span>
                  <select
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                  >
                    {statusFilterOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {`${option.label} (${formatNumber(option.count, {
                          maximumFractionDigits: 0,
                        })})`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {select("فلتر الوقت", "Time filter")}
                      </p>
                      <p className="text-xs text-slate-500">
                        {select(
                          "اختار عرض يومي أو شهري أو مخصص أو كل التفاصيل على حسب الفترة اللي محتاجها.",
                          "Switch between daily, monthly, custom, or full detailed history.",
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {timePresetOptions.map((option) => {
                        const isActive = filters.timePreset === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              setFilters((current) => ({
                                ...current,
                                timePreset: option.value,
                              }))
                            }
                            className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                              isActive
                                ? "border-sky-200 bg-sky-600 text-white shadow-sm"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[420px]">
                    <FilterInfoCard
                      label={select("الوضع الحالي", "Current mode")}
                      value={activeTimePresetLabel}
                      hint={activeTimeSummary}
                    />
                    <FilterInfoCard
                      label={select("النطاق الظاهر", "Visible range")}
                      value={visibleDateSummary}
                      hint={visibleDateHint}
                    />
                  </div>
                </div>

                {filters.timePreset === "custom" ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        {select("من تاريخ", "From date")}
                      </span>
                      <input
                        type="date"
                        dir="ltr"
                        value={filters.customFrom}
                        max={filters.customTo || undefined}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            customFrom: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">
                        {select("إلى تاريخ", "To date")}
                      </span>
                      <input
                        type="date"
                        dir="ltr"
                        value={filters.customTo}
                        min={filters.customFrom || undefined}
                        onChange={(event) =>
                          setFilters((current) => ({
                            ...current,
                            customTo: event.target.value,
                          }))
                        }
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {scannedItems.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <SummaryCard
                icon={Package}
                label={select("عدد الشحنات", "Shipments")}
                value={formatNumber(filteredScannedItems.length, {
                  maximumFractionDigits: 0,
                })}
                color="blue"
              />
              <SummaryCard
                icon={DollarSign}
                label={select("إجمالي الأوردرات", "Order Total")}
                value={formatCurrency(totals.orderTotal)}
                color="green"
              />
              <SummaryCard
                icon={Package}
                label={select("تكلفة المنتجات", "Product Cost")}
                value={formatCurrency(totals.productCost)}
                color="orange"
              />
              <SummaryCard
                icon={Truck}
                label={select("تقدير مستحقات بوسطة", "Estimated Bosta Dues")}
                value={formatCurrency(totals.estimatedBostaDues)}
                color="slate"
              />
              <SummaryCard
                icon={TrendingUp}
                label={select("النيت بروفت", "Net Profit")}
                value={formatCurrency(totals.netProfit)}
                color={totals.netProfit >= 0 ? "emerald" : "red"}
              />
            </div>
          ) : null}

          {scannedItems.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                        {select("رقم التتبع", "Tracking #")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                        {select("الحالة", "Status")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                        {select("الأوردر", "Order")}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700">
                        {select("العميل", "Customer")}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700">
                        {select("تمن الأوردر", "Order Total")}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700">
                        {select("تكلفة المنتجات", "Product Cost")}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700">
                        {select("تقدير مستحقات بوسطة", "Estimated Bosta Dues")}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700">
                        {select("النيت بروفت", "Net Profit")}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700">
                        {select("إجراءات", "Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredScannedItems.length > 0 ? (
                      filteredScannedItems.map((item) => (
                      <tr key={item.tracking_number} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-sm font-mono text-slate-900">
                          <div>{item.tracking_number}</div>
                          <div className="mt-1 text-[11px] font-normal text-slate-500">
                            {select("وقت المسح", "Scanned")}:{" "}
                            {item.scanned_at
                              ? formatDisplayDateValue(item.scanned_at, select)
                              : select("غير متاح", "Unavailable")}
                          </div>
                          <div className="mt-1 text-[11px] font-normal text-slate-500">
                            {select("آخر تحديث", "Updated")}:{" "}
                            {item.last_status_update
                              ? new Date(item.last_status_update).toLocaleString(
                                  "en-GB",
                                )
                              : select("غير متاح", "Unavailable")}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              item.is_pending
                                ? "bg-sky-100 text-sky-800"
                                : item.has_error
                                  ? "bg-red-100 text-red-800"
                                  : getDeliveryStateBadgeClass(item.delivery_state)
                            }`}
                          >
                            {item.delivery_state_label ||
                              select("غير معروف", "Unknown")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900">
                          <div>{item.order_name}</div>
                          {item.business_reference &&
                          item.business_reference !== item.order_name ? (
                            <div className="mt-1 text-[11px] text-slate-500">
                              Ref: {item.business_reference}
                            </div>
                          ) : null}
                          {item.scan_resolution_message &&
                          (item.is_pending || item.has_error) ? (
                            <div className="mt-1 max-w-xs text-[11px] text-slate-500">
                              {item.scan_resolution_message}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          <div>{item.customer_name}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            COD: {formatCurrency(item.cod_amount)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-green-700">
                          {formatCurrency(item.order_total ?? item.revenue)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-slate-600">
                          {formatCurrency(item.product_cost ?? item.total_cost)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-orange-600">
                          <div>
                            {formatCurrency(
                              item.estimated_bosta_dues ?? item.bosta_dues,
                            )}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {select("شحن", "Ship")}:{" "}
                            {formatCurrency(item.shipping_fee)}
                            {" + "}
                            {select("فتح", "Open")}:{" "}
                            {formatCurrency(item.opening_package_fees)}
                            {" + "}
                            VAT: {formatCurrency(item.vat_amount)}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-right text-sm font-bold ${
                            parseAmount(item.net_profit) >= 0
                              ? "text-emerald-700"
                              : "text-red-700"
                          }`}
                        >
                          {formatCurrency(item.net_profit)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-3">
                            {item.tracking_url ? (
                              <a
                                href={
                                  item.tracking_url.startsWith("http")
                                    ? item.tracking_url
                                    : `https://${item.tracking_url}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-600 transition hover:text-sky-800"
                                title={select(
                                  "فتح تتبع بوسطة",
                                  "Open Bosta tracking",
                                )}
                              >
                                <Truck size={16} />
                              </a>
                            ) : null}
                            <button
                              onClick={() => handleDelete(item.tracking_number)}
                              className="text-red-600 transition hover:text-red-800"
                              title={select("حذف", "Delete")}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan="9"
                          className="px-6 py-12 text-center text-sm text-slate-500"
                        >
                          {select(
                            "لا توجد شحنات مطابقة للفلتر الحالي.",
                            "No shipments match the current filters.",
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr className="font-bold">
                      <td colSpan="4" className="px-4 py-3 text-sm text-slate-900">
                        {select("الإجمالي", "Total")}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-green-700">
                        {formatCurrency(totals.orderTotal)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-slate-900">
                        {formatCurrency(totals.productCost)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-orange-600">
                        {formatCurrency(totals.estimatedBostaDues)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right text-sm ${
                          totals.netProfit >= 0
                            ? "text-emerald-700"
                            : "text-red-700"
                        }`}
                      >
                        {formatCurrency(totals.netProfit)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-12 text-center">
              <Truck size={48} className="mx-auto mb-4 text-slate-400" />
              <p className="text-slate-600">
                {select("لا توجد شحنات مسكانة بعد", "No shipments scanned yet")}
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function FilterInfoCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3">
        <Icon size={20} />
        <div>
          <p className="text-xs font-medium opacity-80">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </div>
    </div>
  );
}
