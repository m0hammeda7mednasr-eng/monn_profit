import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Edit2,
  Eye,
  Package,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  TrendingUp,
} from "lucide-react";
import BarcodeLabelModal from "../components/BarcodeLabelModal";
import Sidebar from "../components/Sidebar";
import { SkeletonBlock } from "../components/Common";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { shouldAutoRefreshView } from "../utils/refreshPolicy";
import {
  PRODUCT_CACHE_FRESH_MS,
  buildProductsCacheKey,
  fetchProductPages,
  peekCachedProducts,
  readCachedProducts,
  writeProductsCache,
} from "../utils/productCache";
import {
  formatCurrency as formatAmount,
  formatDateTime,
  formatNumber,
} from "../utils/helpers";
import { normalizeBarcodeVariantTitle } from "../utils/barcodeLabels";
import {
  buildCatalogCounts,
  buildVariantRows,
  getNormalizedDateRange,
  toNumber,
} from "../utils/productsView";

const INITIAL_FILTERS = {
  searchTerm: "",
  vendor: "all",
  productType: "all",
  stockStatus: "all",
  syncStatus: "all",
  minPrice: "",
  maxPrice: "",
  minInventory: "",
  maxInventory: "",
  updatedFrom: "",
  updatedTo: "",
  profitability: "all",
  sortBy: "updated_desc",
};
const SUPPORTED_STOCK_STATUS_FILTERS = new Set([
  "all",
  "in_stock",
  "low_stock",
  "out_of_stock",
]);

const resolveFiltersFromSearchParams = (searchParams) => {
  const nextFilters = { ...INITIAL_FILTERS };
  const stockStatus = String(searchParams.get("stockStatus") || "").trim();
  const searchTerm = String(searchParams.get("q") || "").trim();

  if (SUPPORTED_STOCK_STATUS_FILTERS.has(stockStatus)) {
    nextFilters.stockStatus = stockStatus;
  }

  if (searchTerm) {
    nextFilters.searchTerm = searchTerm;
  }

  return nextFilters;
};

const buildSearchParamsFromFilters = (filters, currentSearchParams) => {
  const nextSearchParams = new URLSearchParams(currentSearchParams);
  const normalizedSearchTerm = String(filters.searchTerm || "").trim();

  if (
    filters.stockStatus &&
    filters.stockStatus !== "all" &&
    SUPPORTED_STOCK_STATUS_FILTERS.has(filters.stockStatus)
  ) {
    nextSearchParams.set("stockStatus", filters.stockStatus);
  } else {
    nextSearchParams.delete("stockStatus");
  }

  if (normalizedSearchTerm) {
    nextSearchParams.set("q", normalizedSearchTerm);
  } else {
    nextSearchParams.delete("q");
  }

  return nextSearchParams;
};

const PRODUCT_FILTER_LABELS = {
  stockStatus: {
    in_stock: "In stock",
    low_stock: "Low stock",
    out_of_stock: "Out of stock",
  },
  syncStatus: {
    synced: "Synced",
    pending: "Pending",
    failed: "Failed",
    never: "Never",
  },
  profitability: {
    profitable: "Profitable",
    loss: "Loss",
    break_even: "Break-even",
    no_cost: "No cost",
  },
};
const isProductsRelatedSharedUpdate = (event) => {
  const source = String(event?.source || "").toLowerCase();
  if (!source) {
    return true;
  }

  return source.includes("/shopify/products") || source.includes("/products/");
};

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, hasPermission } = useAuth();
  const { select } = useLocale();
  const canEditProducts = hasPermission("can_edit_products");
  const canPrintBarcodeLabels = hasPermission("can_print_barcode_labels");
  const cacheKey = useMemo(() => buildProductsCacheKey(), []);
  const initialCachedSnapshot = useMemo(() => {
    const rows = peekCachedProducts(cacheKey);
    return {
      rows,
      updatedAt: null,
    };
  }, [cacheKey]);

  const [products, setProducts] = useState(() => initialCachedSnapshot.rows);
  const [filters, setFilters] = useState(() =>
    resolveFiltersFromSearchParams(searchParams),
  );
  const [, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [error, setError] = useState("");
  const [barcodeModalTargets, setBarcodeModalTargets] = useState([]);
  const [barcodeModalTargetKey, setBarcodeModalTargetKey] = useState("");
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    () => initialCachedSnapshot.updatedAt,
  );
  const [loadStatus, setLoadStatus] = useState({
    active: false,
    message: "",
  });
  const fetchPromiseRef = useRef(null);
  const productsRef = useRef([]);
  const deferredSearchTerm = useDeferredValue(filters.searchTerm);

  useEffect(() => {
    const nextSearchParams = buildSearchParamsFromFilters(
      filters,
      searchParams,
    );
    const currentParamsString = searchParams.toString();
    const nextParamsString = nextSearchParams.toString();

    if (currentParamsString !== nextParamsString) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    let active = true;

    readCachedProducts(cacheKey).then(({ rows: cachedRows, updatedAt }) => {
      if (!active || cachedRows.length === 0) {
        return;
      }

      if (cachedRows.length > productsRef.current.length) {
        setProducts(cachedRows);
      }
      setLastUpdatedAt(updatedAt || new Date());
      setLoadStatus({
        active: false,
        message: `Showing ${formatNumber(cachedRows.length, { maximumFractionDigits: 0 })} cached products`,
      });
    });

    return () => {
      active = false;
    };
  }, [cacheKey]);

  const showNotification = useCallback((message, type = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const fetchProducts = useCallback(
    async ({ silent = false, force = false } = {}) => {
      if (fetchPromiseRef.current) {
        return fetchPromiseRef.current;
      }

      const request = (async () => {
        if (!silent) {
          setLoading(false);
          setError("");
        }

        setLoadStatus({
          active: true,
          message: select(
            "\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0639\u0644\u0649 \u062f\u0641\u0639\u0627\u062a...",
            "Loading products in batches...",
          ),
        });

        try {
          const rows = await fetchProductPages({
            sortBy: "updated_at",
            sortDir: "desc",
            cacheRefresh: force,
            onPage: ({ rows: accumulatedRows, hasMore }) => {
              setProducts(accumulatedRows);
              setLastUpdatedAt(new Date());
              setLoadStatus({
                active: hasMore,
                message: hasMore
                  ? `Loaded ${formatNumber(accumulatedRows.length, { maximumFractionDigits: 0 })} products so far...`
                  : `Loaded ${formatNumber(accumulatedRows.length, { maximumFractionDigits: 0 })} products`,
              });
            },
          });

          setProducts(rows);
          setLastUpdatedAt(new Date());
          setLoadStatus({
            active: false,
            message:
              rows.length > 0
                ? `Loaded ${formatNumber(rows.length, { maximumFractionDigits: 0 })} products`
                : "No products found",
          });
          await writeProductsCache(cacheKey, rows);
        } catch (requestError) {
          console.error("Error fetching products:", requestError);
          if (!silent) {
            if (productsRef.current.length === 0) {
              setProducts([]);
              setError("Failed to load products");
            } else {
              setError("Showing saved products while refresh failed");
            }
            showNotification("Failed to load products", "error");
          }
          setLoadStatus((current) =>
            current.message && productsRef.current.length > 0
              ? { active: false, message: current.message }
              : { active: false, message: "" },
          );
        } finally {
          setLoading(false);
        }
      })();

      fetchPromiseRef.current = request;

      try {
        await request;
      } finally {
        fetchPromiseRef.current = null;
      }
    },
    [cacheKey, select, showNotification],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const {
        rows: cachedRows,
        isFresh,
        updatedAt,
      } = await readCachedProducts(cacheKey);
      if (!active) {
        return;
      }

      const hasCachedRows = cachedRows.length > 0;
      if (hasCachedRows && productsRef.current.length === 0) {
        setProducts(cachedRows);
        setLastUpdatedAt(updatedAt || new Date());
      }

      if (hasCachedRows && isFresh) {
        return;
      }

      if (!hasCachedRows || !isFresh) {
        await fetchProducts({ silent: true });
      }
    })();

    let unsubscribe = () => {};
    let onFocus = null;
    let interval = null;

    if (shouldAutoRefreshView()) {
      unsubscribe = subscribeToSharedDataUpdates((event) => {
        if (!isProductsRelatedSharedUpdate(event)) {
          return;
        }

        fetchProducts({ silent: true });
      });

      interval = setInterval(() => {
        if (document.visibilityState !== "visible") {
          return;
        }

        fetchProducts({ silent: true });
      }, PRODUCT_CACHE_FRESH_MS);

      onFocus = async () => {
        const { isFresh } = await readCachedProducts(cacheKey);
        if (isFresh) {
          return;
        }

        fetchProducts({ silent: true });
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
  }, [cacheKey, fetchProducts]);

  const variantRows = useMemo(
    () => buildVariantRows(products, isAdmin),
    [isAdmin, products],
  );

  const vendorOptions = useMemo(
    () =>
      Array.from(
        new Set(
          variantRows
            .map((variant) => String(variant.vendor || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [variantRows],
  );

  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          variantRows
            .map((variant) => String(variant.product_type || "").trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [variantRows],
  );

  const normalizedUpdatedRange = useMemo(
    () => getNormalizedDateRange(filters.updatedFrom, filters.updatedTo),
    [filters.updatedFrom, filters.updatedTo],
  );

  const filteredVariants = useMemo(() => {
    let result = [...variantRows];

    if (deferredSearchTerm.trim()) {
      const keyword = deferredSearchTerm.trim().toLowerCase();
      result = result.filter((variant) => {
        const searchableFields = [
          variant.product_title,
          variant.variant_title,
          variant.vendor,
          variant.sku,
          variant.product_type,
          variant.barcode,
          ...variant.option_values,
        ]
          .map((value) => String(value || "").toLowerCase())
          .filter(Boolean);

        return searchableFields.some((value) => value.includes(keyword));
      });
    }

    if (filters.vendor !== "all") {
      result = result.filter(
        (variant) =>
          String(variant.vendor || "").toLowerCase() ===
          String(filters.vendor || "").toLowerCase(),
      );
    }

    if (filters.productType !== "all") {
      result = result.filter(
        (variant) =>
          String(variant.product_type || "").toLowerCase() ===
          String(filters.productType || "").toLowerCase(),
      );
    }

    if (filters.stockStatus !== "all") {
      result = result.filter(
        (variant) => variant._meta.stockState === filters.stockStatus,
      );
    }

    if (filters.syncStatus !== "all") {
      result = result.filter(
        (variant) => variant._meta.syncState === filters.syncStatus,
      );
    }

    if (filters.minPrice) {
      const minPrice = toNumber(filters.minPrice);
      result = result.filter((variant) => toNumber(variant.price) >= minPrice);
    }

    if (filters.maxPrice) {
      const maxPrice = toNumber(filters.maxPrice);
      result = result.filter((variant) => toNumber(variant.price) <= maxPrice);
    }

    if (filters.minInventory) {
      const minInventory = toNumber(filters.minInventory);
      result = result.filter(
        (variant) => toNumber(variant.inventory_quantity) >= minInventory,
      );
    }

    if (filters.maxInventory) {
      const maxInventory = toNumber(filters.maxInventory);
      result = result.filter(
        (variant) => toNumber(variant.inventory_quantity) <= maxInventory,
      );
    }

    if (normalizedUpdatedRange.from) {
      result = result.filter(
        (variant) =>
          variant._meta.updatedAt &&
          variant._meta.updatedAt >= normalizedUpdatedRange.from,
      );
    }

    if (normalizedUpdatedRange.to) {
      result = result.filter(
        (variant) =>
          variant._meta.updatedAt &&
          variant._meta.updatedAt <= normalizedUpdatedRange.to,
      );
    }

    if (isAdmin && filters.profitability !== "all") {
      result = result.filter(
        (variant) => variant._meta.profitabilityState === filters.profitability,
      );
    }

    result.sort((a, b) => {
      switch (filters.sortBy) {
        case "title_asc":
          return `${a.product_title} ${a.variant_title}`.localeCompare(
            `${b.product_title} ${b.variant_title}`,
          );
        case "title_desc":
          return `${b.product_title} ${b.variant_title}`.localeCompare(
            `${a.product_title} ${a.variant_title}`,
          );
        case "price_desc":
          return toNumber(b.price) - toNumber(a.price);
        case "price_asc":
          return toNumber(a.price) - toNumber(b.price);
        case "inventory_desc":
          return (
            toNumber(b.inventory_quantity) - toNumber(a.inventory_quantity)
          );
        case "inventory_asc":
          return (
            toNumber(a.inventory_quantity) - toNumber(b.inventory_quantity)
          );
        case "updated_asc":
          return (
            (a._meta.updatedAt ? a._meta.updatedAt.getTime() : 0) -
            (b._meta.updatedAt ? b._meta.updatedAt.getTime() : 0)
          );
        case "updated_desc":
        default:
          return (
            (b._meta.updatedAt ? b._meta.updatedAt.getTime() : 0) -
            (a._meta.updatedAt ? a._meta.updatedAt.getTime() : 0)
          );
      }
    });

    return result;
  }, [
    deferredSearchTerm,
    filters,
    isAdmin,
    normalizedUpdatedRange,
    variantRows,
  ]);

  const summary = useMemo(() => {
    const outOfStock = filteredVariants.filter(
      (variant) => variant._meta.stockState === "out_of_stock",
    ).length;
    const lowStock = filteredVariants.filter(
      (variant) => variant._meta.stockState === "low_stock",
    ).length;
    const totalInventory = filteredVariants.reduce(
      (sum, variant) => sum + toNumber(variant.inventory_quantity),
      0,
    );
    const syncedCount = filteredVariants.filter(
      (variant) => variant._meta.syncState === "synced",
    ).length;
    const uniqueProducts = new Set(
      filteredVariants.map((variant) => String(variant.id || "")),
    ).size;

    return {
      totalVariants: filteredVariants.length,
      uniqueProducts,
      outOfStock,
      lowStock,
      totalInventory,
      syncedCount,
    };
  }, [filteredVariants]);

  const catalogCounts = useMemo(() => {
    return buildCatalogCounts(variantRows, filteredVariants);
  }, [filteredVariants, variantRows]);

  const hasLowStockAlert =
    summary.lowStock > 0 && filters.stockStatus !== "low_stock";

  const activeFilterChips = useMemo(() => {
    const chips = [];

    if (filters.searchTerm.trim()) {
      chips.push(`Search: ${filters.searchTerm.trim()}`);
    }
    if (filters.vendor !== "all") {
      chips.push(`Vendor: ${filters.vendor}`);
    }
    if (filters.productType !== "all") {
      chips.push(`Type: ${filters.productType}`);
    }
    if (filters.stockStatus !== "all") {
      chips.push(
        `Shopify Stock: ${
          PRODUCT_FILTER_LABELS.stockStatus[filters.stockStatus] ||
          filters.stockStatus
        }`,
      );
    }
    if (filters.syncStatus !== "all") {
      chips.push(
        `Sync: ${
          PRODUCT_FILTER_LABELS.syncStatus[filters.syncStatus] ||
          filters.syncStatus
        }`,
      );
    }
    if (filters.minPrice) {
      chips.push(`Price >= ${filters.minPrice}`);
    }
    if (filters.maxPrice) {
      chips.push(`Price <= ${filters.maxPrice}`);
    }
    if (filters.minInventory) {
      chips.push(`Inventory >= ${filters.minInventory}`);
    }
    if (filters.maxInventory) {
      chips.push(`Inventory <= ${filters.maxInventory}`);
    }
    if (filters.updatedFrom || filters.updatedTo) {
      chips.push(
        `Updated: ${filters.updatedFrom || "Start"} -> ${filters.updatedTo || "Now"}`,
      );
    }
    if (isAdmin && filters.profitability !== "all") {
      chips.push(
        `Profitability: ${
          PRODUCT_FILTER_LABELS.profitability[filters.profitability] ||
          filters.profitability
        }`,
      );
    }

    return chips;
  }, [filters, isAdmin]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const getSyncStatusIcon = (variant) => {
    if (variant.pending_sync) {
      return (
        <Clock size={16} className="text-yellow-500" title="Pending sync" />
      );
    }
    if (variant.sync_error) {
      return (
        <AlertCircle
          size={16}
          className="text-red-500"
          title={variant.sync_error}
        />
      );
    }
    if (variant.last_synced_at) {
      return (
        <CheckCircle size={16} className="text-green-500" title="Synced" />
      );
    }
    return null;
  };

  const openProductWorkspace = useCallback((productId, mode = "view") => {
    if (!productId) {
      return;
    }

    const href =
      mode === "edit"
        ? `/products/${productId}?mode=edit`
        : `/products/${productId}`;

    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  const openBarcodeLabelModal = useCallback(
    (variant) => {
      if (!canPrintBarcodeLabels) {
        showNotification(
          select(
            "صلاحية طباعة الباركود غير مفعلة لهذا الحساب.",
            "Barcode label printing is not enabled for this account.",
          ),
          "error",
        );
        return;
      }

      const target = {
        key: String(variant?.key || variant?.variant_id || variant?.id || ""),
        title: String(variant?.product_title || "").trim(),
        subtitle: normalizeBarcodeVariantTitle(
          variant?.variant_title,
          variant?.product_title,
        ),
        sku: String(variant?.sku || "").trim(),
        barcode: String(variant?.barcode || "").trim(),
        vendor: String(variant?.vendor || "").trim(),
      };

      if (!target.key || (!target.sku && !target.barcode)) {
        showNotification(
          "This variant does not have a printable SKU or barcode",
          "error",
        );
        return;
      }

      setBarcodeModalTargets([target]);
      setBarcodeModalTargetKey(target.key);
      setIsBarcodeModalOpen(true);
    },
    [canPrintBarcodeLabels, select, showNotification],
  );

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {notification && (
            <div
              className={`fixed top-4 right-4 z-50 px-5 py-3 rounded-lg shadow-lg text-white ${
                notification.type === "success"
                  ? "bg-emerald-600"
                  : notification.type === "error"
                    ? "bg-red-600"
                    : "bg-sky-600"
              }`}
            >
              {notification.message}
            </div>
          )}

          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                {select("\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a", "Products")}
              </h1>
              <p className="text-slate-600">
                {select(
                  "\u062a\u0645 \u0641\u0635\u0644 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0639\u0646 \u0627\u0644\u0641\u0627\u0631\u064a\u0627\u0646\u062a\u0627\u062a \u0628\u0634\u0643\u0644 \u0648\u0627\u0636\u062d \u0644\u062a\u0628\u0642\u0649 \u0627\u0644\u0641\u0644\u0627\u062a\u0631 \u0648\u0627\u0644\u0625\u062c\u0645\u0627\u0644\u064a\u0627\u062a \u0633\u0647\u0644\u0629 \u0627\u0644\u0642\u0631\u0627\u0621\u0629.",
                  "Products and variants are separated clearly so filters and totals stay easy to read.",
                )}
              </p>
              {lastUpdatedAt && (
                <p className="mt-2 text-xs text-slate-500">
                  {select("\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b", "Last refresh")}: {formatDateTime(lastUpdatedAt)}
                </p>
              )}
            </div>
            <button
                onClick={() => fetchProducts({ force: true })}
              className="bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
            >
              <RefreshCw size={18} />
              {select("\u062a\u062d\u062f\u064a\u062b", "Refresh")}
            </button>
          </div>

          {(error || notification?.type === "error") && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
              <AlertCircle size={18} />
              {error || notification?.message}
            </div>
          )}

          {loadStatus.message && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 text-sm text-sky-800 flex items-center justify-between gap-3">
              <span>{loadStatus.message}</span>
              {loadStatus.active && (
                <span className="text-xs text-sky-600">Updating...</span>
              )}
            </div>
          )}

          {hasLowStockAlert && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700">
                  <AlertCircle size={18} />
                </div>
                <div>
                  <p className="text-sm font-semibold">
                    {formatNumber(summary.lowStock, {
                      maximumFractionDigits: 0,
                    })}{" "}
                    {select(
                      "\u0641\u0627\u0631\u064a\u0627\u0646\u062a\u0627\u062a \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0646\u062e\u0641\u0636 \u062a\u062d\u062a\u0627\u062c \u0645\u062a\u0627\u0628\u0639\u0629",
                      "low-Shopify-stock variants need follow-up",
                    )}
                  </p>
                  <p className="mt-1 text-xs text-amber-800/90">
                    {select(
                      "\u0631\u0643\u0632 \u0647\u0630\u0627 \u0627\u0644\u0639\u0631\u0636 \u0639\u0644\u0649 \u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u0623\u0642\u0644 \u0645\u0646 \u062d\u062f \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0644\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u062a\u0648\u0631\u064a\u062f \u0623\u0633\u0631\u0639.",
                      "This alert is based on Shopify stock shown on this page, not warehouse balance.",
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleFilterChange("stockStatus", "low_stock")}
                className="inline-flex items-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                {select("\u0631\u0643\u0632 \u0639\u0644\u0649 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0646\u062e\u0641\u0636", "Focus low stock")}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
            <SummaryCard
              label={select("\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a", "Products")}
              value={formatNumber(summary.uniqueProducts, {
                maximumFractionDigits: 0,
              })}
              icon={Package}
              color="from-sky-500 to-sky-700"
            />
            <SummaryCard
              label={select("\u0627\u0644\u0641\u0627\u0631\u064a\u0627\u0646\u062a\u0627\u062a", "Variants")}
              value={formatNumber(summary.totalVariants, {
                maximumFractionDigits: 0,
              })}
              icon={Package}
              color="from-indigo-500 to-indigo-700"
            />
            <SummaryCard
              label={select("\u0625\u062c\u0645\u0627\u0644\u064a \u0645\u062e\u0632\u0648\u0646 Shopify", "Total Shopify Stock")}
              value={formatNumber(summary.totalInventory, {
                maximumFractionDigits: 0,
              })}
              icon={TrendingUp}
              color="from-emerald-500 to-emerald-700"
            />
            <SummaryCard
              label={select("Shopify \u0645\u0646\u062e\u0641\u0636", "Low Shopify Stock")}
              value={formatNumber(summary.lowStock, {
                maximumFractionDigits: 0,
              })}
              icon={AlertCircle}
              color="from-amber-500 to-amber-700"
            />
            <SummaryCard
              label="Shopify OOS"
              value={formatNumber(summary.outOfStock, {
                maximumFractionDigits: 0,
              })}
              icon={AlertCircle}
              color="from-rose-500 to-rose-700"
            />
            <SummaryCard
              label="Synced"
              value={formatNumber(summary.syncedCount, {
                maximumFractionDigits: 0,
              })}
              icon={CheckCircle}
              color="from-cyan-500 to-cyan-700"
            />
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Product & Variant Filters
                </h2>
                <p className="text-sm text-slate-500">
                  Filters apply to the variant cards and product totals update
                  with them.
                </p>
              </div>
              <button
                onClick={resetFilters}
                className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <span>
                  Showing{" "}
                  <strong>
                    {formatNumber(catalogCounts.filteredProducts, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>{" "}
                  products
                </span>
                <span>
                  and{" "}
                  <strong>
                    {formatNumber(catalogCounts.filteredVariants, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>{" "}
                  variants
                </span>
                <span className="text-slate-500">
                  from{" "}
                  {formatNumber(catalogCounts.totalProducts, {
                    maximumFractionDigits: 0,
                  })}{" "}
                  total products /{" "}
                  {formatNumber(catalogCounts.totalVariants, {
                    maximumFractionDigits: 0,
                  })}{" "}
                  total variants
                </span>
              </div>
              {normalizedUpdatedRange.wasSwapped && (
                <p className="mt-2 text-xs text-amber-700">
                  Date range was auto-corrected because From Date was later than
                  To Date.
                </p>
              )}
              {activeFilterChips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {activeFilterChips.map((chip) => (
                    <span
                      key={chip}
                      className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 border border-slate-200"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <div className="xl:col-span-2">
                <label className="block text-xs text-slate-500 mb-1">
                  Search
                </label>
                <div className="relative">
                  <Search
                    className="absolute left-3 top-2.5 text-slate-400"
                    size={16}
                  />
                  <input
                    type="text"
                    placeholder="Product, variant, SKU, barcode..."
                    value={filters.searchTerm}
                    onChange={(event) =>
                      handleFilterChange("searchTerm", event.target.value)
                    }
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Vendor
                </label>
                <select
                  value={filters.vendor}
                  onChange={(event) =>
                    handleFilterChange("vendor", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>
                      {vendor}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Type
                </label>
                <select
                  value={filters.productType}
                  onChange={(event) =>
                    handleFilterChange("productType", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  {typeOptions.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Shopify Stock
                </label>
                <select
                  value={filters.stockStatus}
                  onChange={(event) =>
                    handleFilterChange("stockStatus", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="in_stock">In stock</option>
                  <option value="low_stock">Low stock</option>
                  <option value="out_of_stock">Out of stock</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Sync
                </label>
                <select
                  value={filters.syncStatus}
                  onChange={(event) =>
                    handleFilterChange("syncStatus", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="all">All</option>
                  <option value="synced">Synced</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Price Min
                </label>
                <input
                  type="number"
                  value={filters.minPrice}
                  onChange={(event) =>
                    handleFilterChange("minPrice", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Price Max
                </label>
                <input
                  type="number"
                  value={filters.maxPrice}
                  onChange={(event) =>
                    handleFilterChange("maxPrice", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Inventory Min
                </label>
                <input
                  type="number"
                  value={filters.minInventory}
                  onChange={(event) =>
                    handleFilterChange("minInventory", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Inventory Max
                </label>
                <input
                  type="number"
                  value={filters.maxInventory}
                  onChange={(event) =>
                    handleFilterChange("maxInventory", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Updated From
                </label>
                <input
                  type="date"
                  value={filters.updatedFrom}
                  onChange={(event) =>
                    handleFilterChange("updatedFrom", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Updated To
                </label>
                <input
                  type="date"
                  value={filters.updatedTo}
                  onChange={(event) =>
                    handleFilterChange("updatedTo", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Sort
                </label>
                <select
                  value={filters.sortBy}
                  onChange={(event) =>
                    handleFilterChange("sortBy", event.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="updated_desc">Newest updates</option>
                  <option value="updated_asc">Oldest updates</option>
                  <option value="title_asc">Name A-Z</option>
                  <option value="title_desc">Name Z-A</option>
                  <option value="price_desc">Price high-low</option>
                  <option value="price_asc">Price low-high</option>
                  <option value="inventory_desc">Inventory high-low</option>
                  <option value="inventory_asc">Inventory low-high</option>
                </select>
              </div>

              {isAdmin && (
                <div>
                  <label className="block text-xs text-slate-500 mb-1">
                    Profitability
                  </label>
                  <select
                    value={filters.profitability}
                    onChange={(event) =>
                      handleFilterChange("profitability", event.target.value)
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="all">All</option>
                    <option value="profitable">Profitable</option>
                    <option value="loss">Loss</option>
                    <option value="break_even">Break-even</option>
                    <option value="no_cost">No cost</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
            {loadStatus.active && products.length === 0 ? (
              Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`product-skeleton-${index}`}
                  className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow"
                >
                  <SkeletonBlock className="h-52 w-full" roundedClassName="" />
                  <div className="space-y-4 p-4">
                    <div className="space-y-2">
                      <SkeletonBlock className="h-3 w-16" />
                      <SkeletonBlock className="h-5 w-full max-w-[14rem]" />
                      <SkeletonBlock className="h-5 w-24" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((__, detailIndex) => (
                        <div
                          key={`product-skeleton-detail-${index}-${detailIndex}`}
                          className="space-y-2"
                        >
                          <SkeletonBlock className="h-3 w-14" />
                          <SkeletonBlock className="h-4 w-20" />
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                      <SkeletonBlock className="h-4 w-full" />
                      <SkeletonBlock className="h-4 w-4/5" />
                    </div>
                    <div className="flex gap-2">
                      <SkeletonBlock
                        className="h-10 flex-1 rounded-lg"
                        roundedClassName=""
                      />
                      <SkeletonBlock
                        className="h-10 flex-1 rounded-lg"
                        roundedClassName=""
                      />
                    </div>
                  </div>
                </div>
              ))
            ) : filteredVariants.length > 0 ? (
              filteredVariants.map((variant) => (
                <div
                  key={variant.key}
                  className="bg-white rounded-xl shadow hover:shadow-xl transition overflow-hidden border border-slate-100"
                >
                  <div className="relative h-52 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex items-center justify-center">
                    <VariantImage variant={variant} />
                    {getSyncStatusIcon(variant) && (
                      <div className="absolute top-3 left-3 bg-white/90 rounded-full p-2 shadow-sm">
                        {getSyncStatusIcon(variant)}
                      </div>
                    )}
                    <StockBadge
                      stockState={variant._meta.actualStockState}
                      shopifyInventoryQuantity={variant.shopify_inventory_quantity}
                      warehouseInventoryQuantity={variant.warehouse_inventory_quantity}
                    />
                  </div>

                  <div className="p-4 space-y-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                        Product
                      </p>
                      <h3 className="font-bold text-slate-900 line-clamp-2 min-h-[3rem]">
                        {variant.product_title}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                          {variant.variant_title}
                        </span>
                        {variant.has_multiple_variants && (
                          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-700">
                            {variant.variants_count} variants
                          </span>
                        )}
                        {variant.product_type && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            {variant.product_type}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <DetailItem
                        label="Price"
                        value={formatAmount(variant.price)}
                      />
                      <DetailItem
                        label="Shopify"
                        value={formatNumber(variant.shopify_inventory_quantity, {
                          maximumFractionDigits: 0,
                        })}
                        valueClassName={
                          variant._meta.actualStockState === "in_stock"
                            ? "text-emerald-600"
                            : variant._meta.actualStockState === "low_stock"
                              ? "text-amber-600"
                              : "text-rose-600"
                        }
                      />
                      <DetailItem
                        label="Warehouse"
                        value={formatNumber(variant.warehouse_inventory_quantity, {
                          maximumFractionDigits: 0,
                        })}
                        valueClassName={
                          toNumber(variant.warehouse_inventory_quantity) > 0
                            ? "text-emerald-600"
                            : "text-slate-500"
                        }
                      />
                      <DetailItem label="SKU" value={variant.sku || "-"} />
                      <DetailItem
                        label="Updated"
                        value={formatDateTime(variant.updated_at)}
                      />
                    </div>

                    {toNumber(variant.shopify_inventory_quantity) !==
                    toNumber(variant.warehouse_inventory_quantity) ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Shopify stock and warehouse stock are different for this variant.
                      </div>
                    ) : null}

                    {(variant.vendor || variant.barcode) && (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 space-y-2">
                        {variant.vendor && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-500">Vendor</span>
                            <span className="font-medium text-right">
                              {variant.vendor}
                            </span>
                          </div>
                        )}
                        {variant.barcode && (
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-500">Barcode</span>
                            <span className="font-medium text-right break-all">
                              {variant.barcode}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {variant.option_values.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {variant.option_values.map((value) => (
                          <span
                            key={`${variant.key}:${value}`}
                            className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700"
                          >
                            {value}
                          </span>
                        ))}
                      </div>
                    )}

                    {variant.compare_at_price &&
                      toNumber(variant.compare_at_price) > 0 && (
                        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">
                          Compare at:{" "}
                          <span className="font-semibold text-slate-900">
                            {formatAmount(variant.compare_at_price)}
                          </span>
                        </div>
                      )}

                    {isAdmin &&
                      variant.cost_price !== undefined &&
                      variant.cost_price !== null && (
                        <div className="bg-emerald-50 rounded-lg p-3 text-sm text-emerald-900">
                          <div className="flex items-center justify-between gap-3">
                            <span>Unit profit</span>
                            <span className="font-bold">
                              {formatAmount(
                                toNumber(variant.price) -
                                  (toNumber(variant.cost_price) +
                                    toNumber(variant.ads_cost || 0) +
                                    toNumber(variant.operation_cost || 0) +
                                    toNumber(variant.shipping_cost || 0)),
                              )}
                            </span>
                          </div>
                        </div>
                      )}

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {canPrintBarcodeLabels ? (
                        <button
                          onClick={() => openBarcodeLabelModal(variant)}
                          className="app-button-secondary flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700"
                        >
                          <Printer size={14} />
                          Label
                        </button>
                      ) : (
                        <div />
                      )}
                      <button
                        onClick={() => openProductWorkspace(variant.id)}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg flex items-center justify-center gap-2 text-sm"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      {canEditProducts && (
                        <button
                          onClick={() =>
                            openProductWorkspace(variant.id, "edit")
                          }
                          className="flex-1 bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-lg flex items-center justify-center gap-2 text-sm"
                        >
                          <Edit2 size={14} />
                          {select("\u062a\u0639\u062f\u064a\u0644", "Edit")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full bg-white rounded-xl shadow p-10 text-center text-slate-500">
                <Package size={52} className="mx-auto mb-3 text-slate-300" />
                <p className="font-semibold mb-1">No matching products found</p>
                <p className="text-sm">
                  Try adjusting the filters or reset them.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <BarcodeLabelModal
        open={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        targets={barcodeModalTargets}
        defaultTargetKey={barcodeModalTargetKey}
      />
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, color }) {
  return (
    <div className={`bg-gradient-to-r ${color} rounded-xl text-white p-4`}>
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-white/90">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon size={24} />
      </div>
    </div>
  );
}

function DetailItem({ label, value, valueClassName = "" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p
        className={`mt-1 font-semibold text-slate-900 break-words ${valueClassName}`}
      >
        {value}
      </p>
    </div>
  );
}

function VariantImage({ variant }) {
  const [hasError, setHasError] = useState(false);
  const imageUrl = String(variant?.image_url || "").trim();

  if (!imageUrl || hasError) {
    return <Package size={56} className="text-slate-400" />;
  }

  return (
    <img
      src={imageUrl}
      alt={`${variant?.product_title || "Product"} ${variant?.variant_title || ""}`.trim()}
      className="w-full h-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
    />
  );
}

function StockBadge({ stockState, shopifyInventoryQuantity = 0, warehouseInventoryQuantity = 0 }) {
  const hasWarehouseStockOnly =
    toNumber(shopifyInventoryQuantity) <= 0 &&
    toNumber(warehouseInventoryQuantity) > 0;

  if (hasWarehouseStockOnly) {
    return (
      <span className="absolute top-3 right-3 bg-amber-600 text-white text-xs px-2.5 py-1 rounded-full shadow">
        Shopify OOS
      </span>
    );
  }

  if (stockState === "out_of_stock") {
    return (
      <span className="absolute top-3 right-3 bg-red-600 text-white text-xs px-2.5 py-1 rounded-full shadow">
        Out of stock
      </span>
    );
  }

  if (stockState === "low_stock") {
    return (
      <span className="absolute top-3 right-3 bg-amber-500 text-white text-xs px-2.5 py-1 rounded-full shadow">
        Low stock
      </span>
    );
  }

  return (
    <span className="absolute top-3 right-3 bg-emerald-600 text-white text-xs px-2.5 py-1 rounded-full shadow">
      In stock
    </span>
  );
}
