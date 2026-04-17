import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "../components/Sidebar";
import api from "../utils/api";
import { extractArray, extractObject } from "../utils/response";
import {
  CalendarRange,
  DollarSign,
  Download,
  Edit,
  Pencil,
  Package,
  Plus,
  Save,
  Search,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import {
  formatCurrency as formatLocaleCurrency,
  formatNumber,
  formatPercent as formatLocalePercent,
} from "../utils/helpers";
import {
  buildProductCostBreakdown,
  buildSavedUnitCostSnapshot,
  getAppliedCostTotal,
  getCostGroupKey,
  hasCostPrice,
  toAmount,
  toDraftAmount,
} from "../utils/productProfitability";

const SUMMARY_DEFAULT = {
  total_revenue: 0,
  total_cost: 0,
  total_gross_profit: 0,
  total_operational_costs: 0,
  total_return_cost: 0,
  total_net_profit: 0,
  total_sold_units: 0,
  total_returned_units: 0,
  total_returned_orders: 0,
  profit_margin: 0,
};

const EMPTY_PRODUCT_COST_FORM = {
  cost_price: "",
  ads_cost: "0",
  operation_cost: "0",
  shipping_cost: "0",
};
const EMPTY_COST_FORM = {
  cost_name: "",
  cost_type: "operations",
  amount: "",
  apply_to: "per_unit",
  description: "",
};
const COST_TYPE_LABELS = {
  ads: "Ads",
  shipping: "Shipping",
  workshop: "Workshop",
  operations: "Operations",
  packaging: "Packaging",
  other: "Other",
};
const COST_TYPE_DEFAULT_NAMES = {
  ads: "Ads Cost",
  shipping: "Shipping Cost",
  workshop: "Workshop Cost",
  operations: "Operational Cost",
  packaging: "Packaging Cost",
  other: "Other Cost",
};
const DATE_PRESET_OPTIONS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "3 Months" },
  { id: "custom", label: "Custom Date" },
];
const formatAmount = (value) => formatLocaleCurrency(value);
const formatCount = (value) =>
  formatNumber(Math.round(toAmount(value)), { maximumFractionDigits: 0 });
const formatPercent = (value) =>
  formatLocalePercent(toAmount(value), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const formatArabicNumber = (value, options = {}) =>
  new Intl.NumberFormat("ar-EG", options).format(toAmount(value));
const formatArabicCompactNumber = (value) =>
  new Intl.NumberFormat("ar-EG", {
    notation: "compact",
    compactDisplay: "long",
    maximumFractionDigits: 2,
  }).format(toAmount(value));
const buildArabicHoverText = (value, kind = "number") => {
  const numericValue = toAmount(value);
  const absoluteValue = Math.abs(numericValue);
  const fullValue =
    kind === "currency"
      ? `${formatArabicNumber(numericValue, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} جنيه مصري`
      : kind === "percent"
        ? `${formatArabicNumber(numericValue, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}%`
        : formatArabicNumber(numericValue, {
            maximumFractionDigits: 0,
          });

  if (kind === "percent" || absoluteValue < 1000) {
    return fullValue;
  }

  return `${fullValue} • تقريبًا ${formatArabicCompactNumber(numericValue)}`;
};
const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const dateFrom = String(range?.dateFrom || "").trim();
  const dateTo = String(range?.dateTo || "").trim();

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    return {
      dateFrom: dateTo,
      dateTo: dateFrom,
      wasSwapped: true,
    };
  }

  return {
    dateFrom,
    dateTo,
    wasSwapped: false,
  };
};
const resolveDatePreset = (range = {}, now = new Date()) => {
  const normalizedDateFrom = String(range?.dateFrom || "").trim();
  const normalizedDateTo = String(range?.dateTo || "").trim();

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
const buildDateScopeParams = (range = {}) => {
  const params = {};

  if (range.dateFrom) {
    params.date_from = range.dateFrom;
  }
  if (range.dateTo) {
    params.date_to = range.dateTo;
  }

  return params;
};
const createProductCostDraft = (product = null) => ({
  cost_price: toDraftAmount(product?.cost_price, { allowBlank: true }),
  ads_cost: toDraftAmount(product?.ads_cost),
  operation_cost: toDraftAmount(product?.operation_cost),
  shipping_cost: toDraftAmount(product?.shipping_cost),
});
const parseEditableAmount = (value, label) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number`);
  }
  if (parsed < 0) {
    throw new Error(`${label} cannot be negative`);
  }

  return parsed;
};
const getApplyToLabel = (applyTo) => {
  switch (String(applyTo || "")) {
    case "per_order":
      return "Per order";
    case "fixed":
      return "Fixed";
    default:
      return "Per unit";
  }
};
const formatEntryCount = (count) => {
  if (!count) return "No entries";
  return `${count} ${count === 1 ? "entry" : "entries"}`;
};
const getMarginTone = (value) => {
  const margin = toAmount(value);
  if (margin >= 35) {
    return {
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      bar: "bg-emerald-500",
    };
  }
  if (margin >= 15) {
    return {
      badge: "bg-sky-50 text-sky-700 ring-sky-200",
      bar: "bg-sky-500",
    };
  }
  if (margin >= 0) {
    return {
      badge: "bg-amber-50 text-amber-700 ring-amber-200",
      bar: "bg-amber-500",
    };
  }
  return {
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    bar: "bg-rose-500",
  };
};
const getProfitToneClass = (value) =>
  toAmount(value) >= 0 ? "text-emerald-700" : "text-rose-700";

export default function NetProfit() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(SUMMARY_DEFAULT);
  const [operationalCosts, setOperationalCosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState(() => getDatePresetRange("month"));

  const [showCostModal, setShowCostModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [productCostDraft, setProductCostDraft] = useState(
    EMPTY_PRODUCT_COST_FORM,
  );
  const [editingOperationalCostId, setEditingOperationalCostId] =
    useState(null);
  const [newCost, setNewCost] = useState(EMPTY_COST_FORM);
  const normalizedDateRange = useMemo(
    () => normalizeDateRange(dateRange),
    [dateRange],
  );
  const activeDatePreset = useMemo(
    () => resolveDatePreset(normalizedDateRange),
    [normalizedDateRange],
  );
  const activeDatePresetLabel = useMemo(
    () =>
      DATE_PRESET_OPTIONS.find((option) => option.id === activeDatePreset)
        ?.label || "Custom Date",
    [activeDatePreset],
  );

  const fetchProfitability = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard/products", {
        params: buildDateScopeParams(normalizedDateRange),
      });
      const list = extractArray(data);
      setProducts(list);
      setSummary({
        ...SUMMARY_DEFAULT,
        ...extractObject(data?.summary),
      });
    } catch (error) {
      setProducts([]);
      setSummary(SUMMARY_DEFAULT);
      setMessage({ type: "error", text: "Failed to load net profit data" });
    }
  }, [normalizedDateRange]);

  const fetchOperationalCosts = useCallback(async () => {
    try {
      const { data } = await api.get("/operational-costs");
      const list = extractArray(data);
      setOperationalCosts(list);
    } catch (error) {
      setOperationalCosts([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([fetchProfitability(), fetchOperationalCosts()]);
    } catch (error) {
      // handled in called methods
    } finally {
      setLoading(false);
    }
  }, [fetchOperationalCosts, fetchProfitability]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredProducts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return products;

    return products.filter(
      (product) =>
        String(product?.title || "")
          .toLowerCase()
          .includes(keyword) ||
        String(product?.id || "")
          .toLowerCase()
          .includes(keyword) ||
        String(product?.shopify_id || "")
          .toLowerCase()
          .includes(keyword),
    );
  }, [products, searchTerm]);
  const applyDatePreset = (presetId) => {
    if (presetId === "custom") {
      return;
    }

    setDateRange(getDatePresetRange(presetId));
  };
  const handleDateInputChange = (key, value) => {
    setDateRange((current) => ({
      ...current,
      [key]: value,
    }));
  };
  const resetDateFilters = () => {
    setDateRange(getDatePresetRange("month"));
  };

  const operationalCostsByProduct = useMemo(() => {
    const nextMap = new Map();

    operationalCosts.forEach((cost) => {
      if (!cost?.product_id || cost.is_active === false) {
        return;
      }

      const list = nextMap.get(cost.product_id) || [];
      list.push(cost);
      nextMap.set(cost.product_id, list);
    });

    return nextMap;
  }, [operationalCosts]);

  const trackedEntriesCount = useMemo(
    () =>
      operationalCosts.reduce(
        (count, cost) =>
          cost?.product_id && cost.is_active !== false ? count + 1 : count,
        0,
      ),
    [operationalCosts],
  );

  const missingSavedCostCount = useMemo(
    () =>
      products.reduce(
        (count, product) =>
          hasCostPrice(product?.cost_price) ? count : count + 1,
        0,
      ),
    [products],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId],
  );

  const selectedProductCosts = useMemo(
    () => (selectedProductId ? operationalCostsByProduct.get(selectedProductId) || [] : []),
    [operationalCostsByProduct, selectedProductId],
  );

  const selectedProductBreakdown = useMemo(
    () => buildProductCostBreakdown(selectedProduct, selectedProductCosts),
    [selectedProduct, selectedProductCosts],
  );

  const draftProductCostPreview = useMemo(() => {
    const snapshot = buildSavedUnitCostSnapshot(
      {
        price: selectedProduct?.avg_selling_price,
        cost_price: productCostDraft.cost_price,
        ads_cost: productCostDraft.ads_cost,
        operation_cost: productCostDraft.operation_cost,
        shipping_cost: productCostDraft.shipping_cost,
      },
      {
        quantity: selectedProduct?.sold_quantity,
      },
    );

    return {
      totalPerUnit: snapshot.totalUnitCost,
      unitProfit: snapshot.unitProfit,
      margin: snapshot.profitMargin,
      soldQuantity: snapshot.soldQuantity,
      savedTotal: snapshot.savedTotal,
    };
  }, [productCostDraft, selectedProduct]);

  const saveProductCosts = async () => {
    let payload;

    try {
      payload = {
        cost_price: parseEditableAmount(
          productCostDraft.cost_price,
          "Cost price",
        ),
        ads_cost: parseEditableAmount(productCostDraft.ads_cost, "Ads cost"),
        operation_cost: parseEditableAmount(
          productCostDraft.operation_cost,
          "Operation cost",
        ),
        shipping_cost: parseEditableAmount(
          productCostDraft.shipping_cost,
          "Shipping cost",
        ),
      };
    } catch (validationError) {
      setMessage({
        type: "error",
        text: validationError.message,
      });
      return;
    }

    try {
      await api.put(`/dashboard/products/${selectedProductId}`, payload);
      setMessage({
        type: "success",
        text: "Product cost fields updated successfully",
      });
      await fetchProfitability();
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error.response?.data?.error || "Failed to update product cost fields",
      });
    }
  };

  const openCostModal = (productId, cost = null) => {
    const product = products.find((item) => item.id === productId) || null;
    setSelectedProductId(productId);
    setProductCostDraft(createProductCostDraft(product));
    setEditingOperationalCostId(cost?.id || null);
    setNewCost(
      cost
        ? {
            cost_name: cost.cost_name || "",
            cost_type: cost.cost_type || "operations",
            amount: String(cost.amount ?? ""),
            apply_to: cost.apply_to || "per_unit",
            description: cost.description || "",
          }
        : EMPTY_COST_FORM,
    );
    setShowCostModal(true);
  };

  const closeCostModal = () => {
    setShowCostModal(false);
    setSelectedProductId(null);
    setProductCostDraft(EMPTY_PRODUCT_COST_FORM);
    setEditingOperationalCostId(null);
    setNewCost(EMPTY_COST_FORM);
  };

  const prepareNewOperationalCost = () => {
    setEditingOperationalCostId(null);
    setNewCost(EMPTY_COST_FORM);
  };

  const saveOperationalCost = async () => {
    if (!newCost.amount) {
      setMessage({ type: "error", text: "Amount is required" });
      return;
    }

    try {
      const normalizedCostName =
        String(newCost.cost_name || "").trim() ||
        COST_TYPE_DEFAULT_NAMES[newCost.cost_type] ||
        "Operational Cost";
      const payload = {
        ...newCost,
        cost_name: normalizedCostName,
        product_id: selectedProductId,
        amount: parseFloat(newCost.amount),
      };

      if (editingOperationalCostId) {
        await api.put(
          `/operational-costs/${editingOperationalCostId}`,
          payload,
        );
      } else {
        await api.post("/operational-costs", payload);
      }

      setMessage({
        type: "success",
        text: editingOperationalCostId
          ? "Operational cost updated successfully"
          : "Operational cost added successfully",
      });
      await Promise.all([fetchProfitability(), fetchOperationalCosts()]);
      prepareNewOperationalCost();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to add operational cost",
      });
    }
  };

  const deleteOperationalCost = async (costId) => {
    if (!window.confirm("Delete this operational cost?")) return;
    try {
      await api.delete(`/operational-costs/${costId}`);
      setMessage({ type: "success", text: "Operational cost deleted" });
      await Promise.all([fetchProfitability(), fetchOperationalCosts()]);
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error.response?.data?.error || "Failed to delete operational cost",
      });
    }
  };

  const getProductCosts = (productId) =>
    operationalCostsByProduct.get(productId) || [];

  const exportNetProfitView = useCallback(() => {
    const visibleProductRows = filteredProducts.map((product) => {
      const productCosts = operationalCostsByProduct.get(product.id) || [];
      const breakdown = buildProductCostBreakdown(product, productCosts);

      return [
        product.id,
        product.title || "Untitled product",
        toAmount(product.sold_quantity),
        toAmount(product.orders_count),
        toAmount(product.returned_quantity),
        toAmount(product.avg_selling_price),
        toAmount(product.total_revenue),
        toAmount(product.gross_profit),
        hasCostPrice(product.cost_price) ? toAmount(product.cost_price) : "",
        toAmount(product.ads_cost),
        toAmount(product.operation_cost),
        toAmount(product.shipping_cost),
        breakdown.saved.total,
        breakdown.tracked.ads,
        breakdown.tracked.shipping,
        breakdown.tracked.operations,
        breakdown.tracked.other,
        breakdown.tracked.total,
        toAmount(product.return_cost_total),
        breakdown.totalCosts,
        toAmount(product.net_profit),
        toAmount(product.profit_margin),
        productCosts.length,
      ];
    });

    const visibleCostRows = filteredProducts.flatMap((product) => {
      const productCosts = operationalCostsByProduct.get(product.id) || [];

      return productCosts.map((cost) => [
        product.id,
        product.title || "Untitled product",
        cost.cost_name || COST_TYPE_LABELS[cost.cost_type] || "Operational Cost",
        cost.cost_type || "other",
        cost.apply_to || "per_unit",
        toAmount(cost.amount),
        getAppliedCostTotal(
          cost,
          product.sold_quantity,
          product.orders_count,
        ),
        cost.description || "",
      ]);
    });

    downloadCsvSections({
      filename: buildCsvFilename("net-profit-view"),
      sections: [
        {
          title: "Export metadata",
          headers: ["Field", "Value"],
          rows: [
            ["Search", searchTerm.trim() || "-"],
            [
              "Date range",
              normalizedDateRange.dateFrom || normalizedDateRange.dateTo
                ? `${normalizedDateRange.dateFrom || "-"} -> ${
                    normalizedDateRange.dateTo || "-"
                  }`
                : "Preset only",
            ],
            ["Date preset", activeDatePresetLabel],
            ["Visible products", filteredProducts.length],
            ["Exported at", new Date().toISOString()],
          ],
        },
        {
          title: "Summary",
          headers: ["Metric", "Value"],
          rows: [
            ["Total revenue", toAmount(summary.total_revenue)],
            ["Saved product costs", toAmount(summary.total_cost)],
            ["Gross profit", toAmount(summary.total_gross_profit)],
            ["Tracked extra costs", toAmount(summary.total_operational_costs)],
            ["Return costs", toAmount(summary.total_return_cost)],
            ["Total net profit", toAmount(summary.total_net_profit)],
            ["Sold units", toAmount(summary.total_sold_units)],
            ["Returned units", toAmount(summary.total_returned_units)],
            ["Profit margin", toAmount(summary.profit_margin)],
          ],
        },
        {
          title: "Visible products",
          headers: [
            "Product ID",
            "Title",
            "Sold Qty",
            "Orders",
            "Returned Qty",
            "Avg Sell",
            "Sales Revenue",
            "Gross Profit",
            "Cost / Unit",
            "Ads / Unit",
            "Operations / Unit",
            "Shipping / Unit",
            "Saved Product Costs",
            "Tracked Ads",
            "Tracked Shipping",
            "Tracked Operations",
            "Tracked Other",
            "Tracked Total",
            "Return Cost",
            "Grand Total Costs",
            "Net Profit",
            "Profit Margin %",
            "Tracked Cost Entries",
          ],
          rows: visibleProductRows,
        },
        {
          title: "Tracked operational costs",
          headers: [
            "Product ID",
            "Product",
            "Cost Name",
            "Cost Type",
            "Apply To",
            "Unit Amount",
            "Applied Total",
            "Description",
          ],
          rows: visibleCostRows,
        },
      ],
    });
  }, [
    activeDatePresetLabel,
    filteredProducts,
    normalizedDateRange.dateFrom,
    normalizedDateRange.dateTo,
    operationalCostsByProduct,
    searchTerm,
    summary,
  ]);

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="text-center">Loading net profit...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[linear-gradient(180deg,_#f8fafc_0%,_#eef4ff_42%,_#f8fafc_100%)]">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 md:p-8 space-y-6">
          <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98)_0%,_rgba(239,246,255,0.96)_52%,_rgba(248,250,252,0.98)_100%)] p-6 shadow-sm shadow-slate-200/70">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
                  Profitability workspace
                </div>
                <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">
                  Net Profit
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 md:text-[15px]">
                  Review revenue, saved unit costs, and tracked extras in one
                  calmer view. The layout below keeps product economics readable
                  without forcing a giant spreadsheet across the page.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[680px] xl:grid-cols-4">
                <OverviewPill
                  label="Visible Products"
                  value={formatCount(filteredProducts.length)}
                  tone="sky"
                  hoverText={buildArabicHoverText(filteredProducts.length)}
                />
                <OverviewPill
                  label="Tracked Entries"
                  value={formatCount(trackedEntriesCount)}
                  tone="emerald"
                  hoverText={buildArabicHoverText(trackedEntriesCount)}
                />
                <OverviewPill
                  label="Missing Saved Cost"
                  value={formatCount(missingSavedCostCount)}
                  tone={missingSavedCostCount > 0 ? "amber" : "slate"}
                  hoverText={buildArabicHoverText(missingSavedCostCount)}
                />
                <OverviewPill
                  label="Active Period"
                  value={activeDatePresetLabel}
                  tone="slate"
                />
              </div>
            </div>
          </div>

          {message.text && (
            <div
              className={`p-4 rounded-lg ${
                message.type === "error"
                  ? "bg-red-50 text-red-800 border border-red-200"
                  : "bg-emerald-50 text-emerald-800 border border-emerald-200"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Sales Revenue"
              value={formatAmount(summary.total_revenue)}
              hoverText={buildArabicHoverText(summary.total_revenue, "currency")}
              icon={DollarSign}
              color="bg-sky-100 text-sky-700"
            />
            <SummaryCard
              label="Saved Product Costs"
              value={formatAmount(summary.total_cost)}
              hoverText={buildArabicHoverText(summary.total_cost, "currency")}
              icon={Package}
              color="bg-amber-100 text-amber-700"
            />
            <SummaryCard
              label="Return Costs"
              value={formatAmount(summary.total_return_cost)}
              hoverText={buildArabicHoverText(summary.total_return_cost, "currency")}
              icon={CalendarRange}
              color="bg-rose-100 text-rose-700"
            />
            <SummaryCard
              label="Gross Profit"
              value={formatAmount(summary.total_gross_profit)}
              hoverText={buildArabicHoverText(summary.total_gross_profit, "currency")}
              icon={TrendingUp}
              color="bg-teal-100 text-teal-700"
            />
            <SummaryCard
              label="Tracked Extra Costs"
              value={formatAmount(summary.total_operational_costs)}
              hoverText={buildArabicHoverText(
                summary.total_operational_costs,
                "currency",
              )}
              icon={TrendingUp}
              color="bg-orange-100 text-orange-700"
            />
            <SummaryCard
              label="Total Net Profit"
              value={formatAmount(summary.total_net_profit)}
              hoverText={buildArabicHoverText(summary.total_net_profit, "currency")}
              icon={TrendingUp}
              color="bg-emerald-100 text-emerald-700"
            />
            <SummaryCard
              label="Sold Units"
              value={formatCount(summary.total_sold_units)}
              hoverText={buildArabicHoverText(summary.total_sold_units)}
              icon={Package}
              color="bg-indigo-100 text-indigo-700"
            />
            <SummaryCard
              label="Profit Margin"
              value={formatPercent(summary.profit_margin)}
              hoverText={buildArabicHoverText(summary.profit_margin, "percent")}
              icon={TrendingUp}
              color="bg-rose-100 text-rose-700"
            />
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Search className="text-slate-500" size={18} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by product name, product ID, or Shopify ID..."
                    className="w-full border-0 bg-transparent px-0 py-0 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:ring-0"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-600">
                    Showing {formatCount(filteredProducts.length)} of{" "}
                    {formatCount(products.length)} products
                  </div>
                  <button
                    onClick={exportNetProfitView}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900"
                  >
                    <Download size={16} />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {DATE_PRESET_OPTIONS.map((option) => {
                        const isActive = activeDatePreset === option.id;
                        return (
                          <button
                            key={option.id}
                            onClick={() => applyDatePreset(option.id)}
                            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                              isActive
                                ? "bg-slate-950 text-white shadow-sm"
                                : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-sm text-slate-500">
                      Filter the profit view by order date, and keep the return
                      losses visible inside the same period.
                    </p>
                    {normalizedDateRange.wasSwapped ? (
                      <p className="text-xs font-medium text-amber-700">
                        The selected range was auto-corrected because the start
                        date was later than the end date.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        From
                      </span>
                      <input
                        type="date"
                        value={dateRange.dateFrom}
                        onChange={(event) =>
                          handleDateInputChange("dateFrom", event.target.value)
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        To
                      </span>
                      <input
                        type="date"
                        value={dateRange.dateTo}
                        onChange={(event) =>
                          handleDateInputChange("dateTo", event.target.value)
                        }
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                      />
                    </label>
                    <div className="flex items-end">
                      <button
                        onClick={resetDateFilters}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Reset To Month
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-sky-100 bg-[linear-gradient(135deg,_#f0f9ff_0%,_#eff6ff_100%)] px-4 py-4 text-sm leading-6 text-sky-950">
                  Costs stay attached to each product. Use Manage to edit saved
                  unit costs, then track any extra ads, shipping, workshop, or
                  packaging expenses without losing the clean revenue picture.
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  The view is tuned to reduce crowding, keep the economics
                  block readable, and make actions easier to reach without
                  staring at a giant spreadsheet wall.
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
            <div className="overflow-x-auto pb-2" dir="ltr">
              <table className="data-table table-fixed w-full min-w-[1880px]">
                <colgroup>
                  <col className="w-[340px]" />
                  <col className="w-[110px]" />
                  <col className="w-[110px]" />
                  <col className="w-[160px]" />
                  <col className="w-[170px]" />
                  <col className="w-[170px]" />
                  <col className="w-[500px]" />
                  <col className="w-[170px]" />
                  <col className="w-[180px]" />
                  <col className="w-[140px]" />
                  <col className="w-[180px]" />
                </colgroup>
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur">
                  <tr>
                    <th className="px-5 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Product
                    </th>
                    <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Sold
                    </th>
                    <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Orders
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Avg Sell
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Sales Revenue
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Gross Profit
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Cost Breakdown
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Total Costs
                    </th>
                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Net Profit
                    </th>
                    <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Margin
                    </th>
                    <th className="px-4 py-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredProducts.map((product) => {
                    const opCosts = getProductCosts(product.id);
                    const previewTrackedCosts = opCosts.slice(0, 2);
                    const remainingTrackedCosts = Math.max(
                      opCosts.length - previewTrackedCosts.length,
                      0,
                    );
                    const breakdown = buildProductCostBreakdown(
                      product,
                      opCosts,
                    );
                    const costGroupsCount = opCosts.reduce(
                      (acc, cost) => {
                        const groupKey = getCostGroupKey(cost?.cost_type);
                        acc[groupKey] = (acc[groupKey] || 0) + 1;
                        return acc;
                      },
                      { ads: 0, shipping: 0, operations: 0, other: 0 },
                    );
                    const productCostMissing = !hasCostPrice(
                      product.cost_price,
                    );
                    const adsNote =
                      costGroupsCount.ads > 0
                        ? `Saved ${formatAmount(
                            breakdown.saved.adsUnit,
                          )} / unit + ${formatEntryCount(costGroupsCount.ads)}`
                        : `Saved ${formatAmount(
                            breakdown.saved.adsUnit,
                          )} / unit`;
                    const shippingNote =
                      costGroupsCount.shipping > 0
                        ? `Saved ${formatAmount(
                            breakdown.saved.shippingUnit,
                          )} / unit + ${formatEntryCount(
                            costGroupsCount.shipping,
                          )}`
                        : `Saved ${formatAmount(
                            breakdown.saved.shippingUnit,
                          )} / unit`;
                    const operationsNote =
                      costGroupsCount.operations > 0
                        ? `Saved ${formatAmount(
                            breakdown.saved.operationsUnit,
                          )} / unit + ${formatEntryCount(
                            costGroupsCount.operations,
                          )}`
                        : `Saved ${formatAmount(
                            breakdown.saved.operationsUnit,
                          )} / unit`;

                    const marginTone = getMarginTone(product.profit_margin);

                    return (
                      <tr
                        key={product.id}
                        className="align-top transition-colors hover:bg-slate-50/80"
                      >
                        <td className="px-5 py-5">
                          <div className="flex min-w-0 items-start gap-4">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.title}
                                className="h-[72px] w-[72px] flex-none rounded-[22px] border border-slate-200 object-cover shadow-sm shadow-slate-200/60"
                              />
                            ) : (
                              <div className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[22px] border border-slate-200 bg-slate-100">
                                <Package size={22} className="text-slate-400" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p
                                className="break-words text-[15px] font-semibold leading-7 tracking-tight text-slate-900"
                                dir="auto"
                              >
                                {product.title}
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                  #{product.id}
                                </span>
                                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                                  {formatCount(opCosts.length)} tracked
                                </span>
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                    productCostMissing
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-emerald-50 text-emerald-700"
                                  }`}
                                >
                                  {productCostMissing ? "Cost missing" : "Cost saved"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatCount(product.sold_quantity)}
                            note="units sold"
                            align="center"
                            hoverText={buildArabicHoverText(product.sold_quantity)}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatCount(product.orders_count)}
                            note="orders"
                            align="center"
                            hoverText={buildArabicHoverText(product.orders_count)}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatAmount(product.avg_selling_price)}
                            note="per unit"
                            hoverText={buildArabicHoverText(
                              product.avg_selling_price,
                              "currency",
                            )}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatAmount(product.total_revenue)}
                            note="sales before any costs"
                            valueClassName="text-sky-700"
                            hoverText={buildArabicHoverText(
                              product.total_revenue,
                              "currency",
                            )}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatAmount(product.gross_profit)}
                            note={`sales ${formatAmount(
                              product.total_revenue,
                            )} - saved costs ${formatAmount(
                              breakdown.saved.total,
                            )}`}
                            valueClassName={getProfitToneClass(product.gross_profit)}
                            hoverText={buildArabicHoverText(
                              product.gross_profit,
                              "currency",
                            )}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <BreakdownMetric
                                label="Product Cost"
                                value={
                                  productCostMissing
                                    ? "Missing"
                                    : `${formatAmount(
                                        breakdown.saved.productUnit,
                                      )} / unit`
                                }
                                note={
                                  productCostMissing
                                    ? "Add from Manage to unlock exact profit"
                                    : `Saved total ${formatAmount(
                                        breakdown.saved.productTotal,
                                      )}`
                                }
                                valueClassName={
                                  productCostMissing
                                    ? "text-amber-700"
                                    : "text-slate-900"
                                }
                                hoverText={
                                  productCostMissing
                                    ? ""
                                    : buildArabicHoverText(
                                        breakdown.saved.productUnit,
                                        "currency",
                                      )
                                }
                              />
                              <BreakdownMetric
                                label="Ads"
                                value={formatAmount(breakdown.combined.ads)}
                                note={adsNote}
                                valueClassName="text-rose-700"
                                hoverText={buildArabicHoverText(
                                  breakdown.combined.ads,
                                  "currency",
                                )}
                              />
                              <BreakdownMetric
                                label="Shipping"
                                value={formatAmount(breakdown.combined.shipping)}
                                note={shippingNote}
                                valueClassName="text-sky-700"
                                hoverText={buildArabicHoverText(
                                  breakdown.combined.shipping,
                                  "currency",
                                )}
                              />
                              <BreakdownMetric
                                label="Operations"
                                value={formatAmount(
                                  breakdown.combined.operations,
                                )}
                                note={operationsNote}
                                valueClassName="text-amber-700"
                                hoverText={buildArabicHoverText(
                                  breakdown.combined.operations,
                                  "currency",
                                )}
                              />
                              <BreakdownMetric
                                label="Other"
                                value={formatAmount(breakdown.combined.other)}
                                note={formatEntryCount(costGroupsCount.other)}
                                valueClassName="text-slate-700"
                                hoverText={buildArabicHoverText(
                                  breakdown.combined.other,
                                  "currency",
                                )}
                              />
                              <BreakdownMetric
                                label="Returns"
                                value={formatAmount(breakdown.returns.total)}
                                note={
                                  breakdown.returns.quantity > 0
                                    ? `${formatCount(
                                        breakdown.returns.quantity,
                                      )} returned units`
                                    : "No returned units"
                                }
                                valueClassName="text-rose-700"
                                hoverText={buildArabicHoverText(
                                  breakdown.returns.total,
                                  "currency",
                                )}
                              />
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  Tracked Entries
                                </p>
                                <div className="flex items-center gap-2">
                                  {remainingTrackedCosts > 0 ? (
                                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                                      +{formatCount(remainingTrackedCosts)} more
                                    </span>
                                  ) : null}
                                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                    {formatCount(opCosts.length)}
                                  </span>
                                </div>
                              </div>

                              {opCosts.length > 0 ? (
                                <div className="space-y-2">
                                  {previewTrackedCosts.map((cost) => (
                                    <div
                                      key={cost.id}
                                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-100/70"
                                    >
                                      <div className="min-w-0">
                                        <p
                                          className="truncate text-sm font-semibold text-slate-900"
                                          dir="auto"
                                        >
                                          {cost.cost_name ||
                                            COST_TYPE_LABELS[cost.cost_type] ||
                                            "Operational Cost"}
                                        </p>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                                            {COST_TYPE_LABELS[cost.cost_type] ||
                                              "Other"}
                                          </span>
                                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                                            {getApplyToLabel(cost.apply_to)}
                                          </span>
                                          <span className="whitespace-nowrap">
                                            {formatAmount(cost.amount)}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 pl-2">
                                        <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
                                          {formatAmount(
                                            getAppliedCostTotal(
                                              cost,
                                              product.sold_quantity,
                                              product.orders_count,
                                            ),
                                          )}
                                        </span>
                                        <button
                                          onClick={() =>
                                            openCostModal(product.id, cost)
                                          }
                                          className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50 hover:text-blue-700"
                                          title="Edit cost"
                                        >
                                          <Pencil size={12} />
                                        </button>
                                        <button
                                          onClick={() =>
                                            deleteOperationalCost(cost.id)
                                          }
                                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700"
                                          title="Delete cost"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                  {remainingTrackedCosts > 0 ? (
                                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-xs font-medium text-slate-500">
                                      Open Manage to review the remaining tracked
                                      cost entries for this product.
                                    </div>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
                                  No per-product costs added yet.
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatAmount(breakdown.totalCosts)}
                            note={`Saved on product ${formatAmount(
                              breakdown.saved.total,
                            )} + tracked extras ${formatAmount(
                              breakdown.tracked.total,
                            )} + returns ${formatAmount(
                              breakdown.returns.total,
                            )}`}
                            hoverText={buildArabicHoverText(
                              breakdown.totalCosts,
                              "currency",
                            )}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <DataMetric
                            value={formatAmount(product.net_profit)}
                            note={`gross profit ${formatAmount(
                              product.gross_profit,
                            )} - tracked extras ${formatAmount(
                              breakdown.tracked.total,
                            )} - returns ${formatAmount(
                              breakdown.returns.total,
                            )}`}
                            valueClassName={getProfitToneClass(product.net_profit)}
                            hoverText={buildArabicHoverText(
                              product.net_profit,
                              "currency",
                            )}
                          />
                        </td>
                        <td className="px-4 py-5">
                          <div className="mx-auto w-full max-w-[112px]">
                            <div
                              className={`rounded-full px-3 py-2 text-center text-sm font-semibold ring-1 ${marginTone.badge}`}
                            >
                              <MetricValue
                                display={formatPercent(product.profit_margin)}
                                hoverText={buildArabicHoverText(
                                  product.profit_margin,
                                  "percent",
                                )}
                                className="justify-center"
                              />
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${marginTone.bar}`}
                                style={{
                                  width: `${Math.min(
                                    Math.abs(toAmount(product.profit_margin)),
                                    100,
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5">
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => openCostModal(product.id)}
                              className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                                productCostMissing
                                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                              }`}
                              title={
                                productCostMissing
                                  ? "Set product cost and manage costs"
                                  : "Manage product cost and operational costs"
                              }
                            >
                              <Edit size={14} />
                              {productCostMissing ? "Set Cost" : "Manage"}
                            </button>
                            <button
                              onClick={() => {
                                openCostModal(product.id);
                                prepareNewOperationalCost();
                              }}
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                              title="Add operational cost"
                            >
                              <Plus size={14} />
                              New Cost
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredProducts.length === 0 && (
              <div className="text-center py-12">
                <Package size={48} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-500">No products found</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showCostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  Manage Product Costs
                </h2>
                {selectedProduct && (
                  <p className="mt-1 text-sm text-gray-500">
                    {selectedProduct.title}
                  </p>
                )}
              </div>
              <button
                onClick={closeCostModal}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Saved Unit Costs
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        These values live on the product itself and are applied
                        to every sold unit.
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        hasCostPrice(selectedProduct?.cost_price)
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {hasCostPrice(selectedProduct?.cost_price)
                        ? `Saved ${formatAmount(
                            selectedProduct?.cost_price,
                          )} / unit`
                        : "Base cost missing"}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <CostField
                      label="Cost Price / Unit"
                      value={productCostDraft.cost_price}
                      onChange={(value) =>
                        setProductCostDraft((prev) => ({
                          ...prev,
                          cost_price: value,
                        }))
                      }
                    />
                    <CostField
                      label="Ads / Unit"
                      value={productCostDraft.ads_cost}
                      onChange={(value) =>
                        setProductCostDraft((prev) => ({
                          ...prev,
                          ads_cost: value,
                        }))
                      }
                    />
                    <CostField
                      label="Operations / Unit"
                      value={productCostDraft.operation_cost}
                      onChange={(value) =>
                        setProductCostDraft((prev) => ({
                          ...prev,
                          operation_cost: value,
                        }))
                      }
                    />
                    <CostField
                      label="Shipping / Unit"
                      value={productCostDraft.shipping_cost}
                      onChange={(value) =>
                        setProductCostDraft((prev) => ({
                          ...prev,
                          shipping_cost: value,
                        }))
                      }
                    />
                  </div>

                  {selectedProduct && (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <InfoBadge
                        label="Avg Sell"
                        value={formatAmount(selectedProduct.avg_selling_price)}
                        hoverText={buildArabicHoverText(
                          selectedProduct.avg_selling_price,
                          "currency",
                        )}
                      />
                      <InfoBadge
                        label="Saved / Unit"
                        value={formatAmount(draftProductCostPreview.totalPerUnit)}
                        hoverText={buildArabicHoverText(
                          draftProductCostPreview.totalPerUnit,
                          "currency",
                        )}
                      />
                      <InfoBadge
                        label="Saved Total"
                        value={formatAmount(draftProductCostPreview.savedTotal)}
                        hoverText={buildArabicHoverText(
                          draftProductCostPreview.savedTotal,
                          "currency",
                        )}
                      />
                      <InfoBadge
                        label="Unit Margin"
                        value={formatPercent(draftProductCostPreview.margin)}
                        hoverText={buildArabicHoverText(
                          draftProductCostPreview.margin,
                          "percent",
                        )}
                      />
                      <InfoBadge
                        label="Unit Profit"
                        value={formatAmount(draftProductCostPreview.unitProfit)}
                        hoverText={buildArabicHoverText(
                          draftProductCostPreview.unitProfit,
                          "currency",
                        )}
                      />
                      <InfoBadge
                        label="Sold Qty"
                        value={formatCount(selectedProduct.sold_quantity)}
                        hoverText={buildArabicHoverText(
                          selectedProduct.sold_quantity,
                        )}
                      />
                      <InfoBadge
                        label="Tracked Extras"
                        value={formatAmount(selectedProductBreakdown.tracked.total)}
                        hoverText={buildArabicHoverText(
                          selectedProductBreakdown.tracked.total,
                          "currency",
                        )}
                      />
                      <InfoBadge
                        label="Orders"
                        value={formatCount(selectedProduct.orders_count)}
                        hoverText={buildArabicHoverText(
                          selectedProduct.orders_count,
                        )}
                      />
                      <InfoBadge
                        label="Return Cost"
                        value={formatAmount(selectedProduct.return_cost_total)}
                        hoverText={buildArabicHoverText(
                          selectedProduct.return_cost_total,
                          "currency",
                        )}
                      />
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                      onClick={saveProductCosts}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700"
                    >
                      <Save size={16} />
                      Save Product Costs
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        Tracked Extra Costs
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Add any extra product-level expenses that should sit on
                        top of the saved unit costs.
                      </p>
                    </div>
                    <button
                      onClick={prepareNewOperationalCost}
                      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <Plus size={14} />
                      New Cost
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    {selectedProductCosts.length > 0 ? (
                      selectedProductCosts.map((cost) => (
                        <div
                          key={cost.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-900">
                              {cost.cost_name ||
                                COST_TYPE_LABELS[cost.cost_type] ||
                                "Operational Cost"}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              {COST_TYPE_LABELS[cost.cost_type] || "Other"} |{" "}
                              {getApplyToLabel(cost.apply_to)} |{" "}
                              {formatAmount(cost.amount)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-gray-800">
                              {formatAmount(
                                getAppliedCostTotal(
                                  cost,
                                  selectedProduct?.sold_quantity,
                                  selectedProduct?.orders_count,
                                ),
                              )}
                            </span>
                            <button
                              onClick={() =>
                                openCostModal(selectedProductId, cost)
                              }
                              className="rounded p-1 text-blue-500 hover:bg-blue-50 hover:text-blue-700"
                              title="Edit cost"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => deleteOperationalCost(cost.id)}
                              className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
                              title="Delete cost"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
                        No operational costs added for this product yet.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {editingOperationalCostId
                        ? "Edit Selected Cost"
                        : "Add New Operational Cost"}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Use this form to save ads, workshop, shipping, packaging,
                      or any other cost for the current product.
                    </p>
                  </div>
                  {editingOperationalCostId ? (
                    <button
                      onClick={prepareNewOperationalCost}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Add Another Cost
                    </button>
                  ) : null}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Cost name (optional)"
                    value={newCost.cost_name}
                    onChange={(e) =>
                      setNewCost((prev) => ({
                        ...prev,
                        cost_name: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                  />
                  <select
                    value={newCost.cost_type}
                    onChange={(e) =>
                      setNewCost((prev) => ({
                        ...prev,
                        cost_type: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                  >
                    <option value="operations">Operations</option>
                    <option value="ads">Ads</option>
                    <option value="workshop">Workshop</option>
                    <option value="shipping">Shipping</option>
                    <option value="packaging">Packaging</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Amount"
                    value={newCost.amount}
                    onChange={(e) =>
                      setNewCost((prev) => ({
                        ...prev,
                        amount: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                  />
                  <select
                    value={newCost.apply_to}
                    onChange={(e) =>
                      setNewCost((prev) => ({
                        ...prev,
                        apply_to: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                  >
                    <option value="per_unit">Per Unit</option>
                    <option value="per_order">Per Order</option>
                    <option value="fixed">Fixed</option>
                  </select>
                  <textarea
                    rows={4}
                    placeholder="Description"
                    value={newCost.description}
                    onChange={(e) =>
                      setNewCost((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    className="md:col-span-2 w-full rounded-xl border border-gray-200 px-4 py-3"
                  />
                </div>

                <p className="mt-3 text-xs text-gray-500">
                  Per unit is multiplied by sold quantity. Per order is
                  multiplied by the number of orders. Fixed is applied once for
                  the product.
                </p>
              </section>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button
                onClick={saveOperationalCost}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white hover:bg-blue-700"
              >
                <Save size={16} />
                {editingOperationalCostId ? "Save Cost" : "Add Cost"}
              </button>
              <button
                onClick={closeCostModal}
                className="rounded-xl bg-gray-200 px-4 py-2.5 font-medium text-gray-800 hover:bg-gray-300"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataMetric({
  value,
  note,
  valueClassName = "text-slate-900",
  align = "left",
  hoverText = "",
}) {
  const alignmentClass = align === "center" ? "text-center" : "text-left";

  return (
    <div className={alignmentClass}>
      <MetricValue
        display={value}
        hoverText={hoverText}
        className={`break-words text-lg font-semibold leading-7 tracking-tight tabular-nums ${valueClassName}`}
        align={align}
      />
      <p className="mt-1 text-xs font-medium text-slate-500">{note}</p>
    </div>
  );
}

function BreakdownMetric({
  label,
  value,
  note,
  valueClassName = "text-slate-900",
  hoverText = "",
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm shadow-slate-100/70">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="mt-2">
        <MetricValue
          display={value}
          hoverText={hoverText}
          className={`break-words text-sm font-semibold leading-6 tabular-nums ${valueClassName}`}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{note}</p>
    </div>
  );
}

function CostField({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-gray-700">
        {label}
      </span>
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3"
      />
    </label>
  );
}

function InfoBadge({ label, value, hoverText = "" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-100/60">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <div className="mt-2">
        <MetricValue
          display={value}
          hoverText={hoverText}
          className="break-words text-lg font-semibold leading-7 tabular-nums text-slate-900"
        />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  color,
  className = "",
  hoverText = "",
}) {
  return (
    <div
      className={`rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 ${className}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {label}
          </p>
          <div className="mt-3">
            <MetricValue
              display={value}
              hoverText={hoverText}
              className="break-words text-[28px] font-semibold leading-9 tracking-tight tabular-nums text-slate-950"
            />
          </div>
        </div>
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm shadow-slate-200/60 ${color}`}
        >
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function OverviewPill({ label, value, tone = "slate", hoverText = "" }) {
  const toneClass =
    tone === "sky"
      ? "border-sky-200 bg-sky-50 text-sky-800"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-slate-200 bg-white text-slate-800";

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm shadow-slate-200/50 ${toneClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">
        {label}
      </p>
      <div className="mt-2">
        <MetricValue
          display={value}
          hoverText={hoverText}
          className="break-words text-xl font-semibold tracking-tight tabular-nums"
        />
      </div>
    </div>
  );
}

function MetricValue({
  display,
  hoverText = "",
  className = "",
  align = "left",
}) {
  const tooltipAlignmentClass =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : "left-0";

  return (
    <span className={`group/metric relative inline-flex max-w-full ${className}`}>
      <span>{display}</span>
      {hoverText ? (
        <span
          className={`pointer-events-none absolute bottom-full z-20 mb-2 w-max max-w-[260px] rounded-2xl bg-slate-950 px-3 py-2 text-[11px] font-medium leading-5 text-white opacity-0 shadow-xl transition duration-150 group-hover/metric:opacity-100 ${tooltipAlignmentClass}`}
        >
          {hoverText}
        </span>
      ) : null}
    </span>
  );
}
