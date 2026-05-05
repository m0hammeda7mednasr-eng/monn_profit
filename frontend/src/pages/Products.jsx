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
  Download,
  Edit2,
  Eye,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import ProductEditModal from "../components/ProductEditModal";
import Sidebar from "../components/Sidebar";
import { SkeletonBlock } from "../components/Common";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import api from "../utils/api";
import { buildCsvFilename, downloadCsvSections } from "../utils/csv";
import {
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
import { buildVariantRows, toNumber } from "../utils/productsView";

const INITIAL_FILTERS = {
  searchTerm: "",
  productType: "all",
  sortBy: "updated_desc",
};

const resolveFiltersFromSearchParams = (searchParams) => {
  const nextFilters = { ...INITIAL_FILTERS };
  const searchTerm = String(searchParams.get("q") || "").trim();

  if (searchTerm) {
    nextFilters.searchTerm = searchTerm;
  }

  return nextFilters;
};

const buildSearchParamsFromFilters = (filters, currentSearchParams) => {
  const nextSearchParams = new URLSearchParams(currentSearchParams);
  const normalizedSearchTerm = String(filters.searchTerm || "").trim();

  if (normalizedSearchTerm) {
    nextSearchParams.set("q", normalizedSearchTerm);
  } else {
    nextSearchParams.delete("q");
  }

  return nextSearchParams;
};

const QUICK_COST_FIELDS = [
  "cost_price",
  "ads_cost",
  "operation_cost",
  "shipping_cost",
];

const formatExportAmount = (value, { allowBlank = false } = {}) => {
  if (
    allowBlank &&
    (value === null || value === undefined || String(value).trim() === "")
  ) {
    return "";
  }

  return toNumber(value).toFixed(2);
};

const applyQuickCostEditsToProducts = (
  products,
  productId,
  updates,
  updatedAt = new Date().toISOString(),
) =>
  (Array.isArray(products) ? products : []).map((product) => {
    if (String(product?.id || "") !== String(productId || "")) {
      return product;
    }

    const nextCostFields = QUICK_COST_FIELDS.reduce((accumulator, field) => {
      if (Object.prototype.hasOwnProperty.call(updates || {}, field)) {
        accumulator[field] = toNumber(updates?.[field]);
      }

      return accumulator;
    }, {});

    return {
      ...product,
      ...nextCostFields,
      local_updated_at: updatedAt,
      updated_at: updatedAt,
      variants: Array.isArray(product?.variants)
        ? product.variants.map((variant) => ({
            ...variant,
            ...nextCostFields,
            updated_at: updatedAt,
          }))
        : product?.variants,
    };
  });

const buildProductsExportSections = ({
  variantRows,
  summary,
  select,
}) => {
  const rows = Array.isArray(variantRows) ? variantRows : [];

  return [
    {
      title: select("بيانات التصدير", "Export metadata"),
      headers: [select("البند", "Field"), select("القيمة", "Value")],
      rows: [
        [select("وقت التصدير", "Exported at"), new Date().toISOString()],
        [
          select("عدد المنتجات", "Products"),
          formatNumber(summary?.uniqueProducts || 0, {
            maximumFractionDigits: 0,
          }),
        ],
        [
          select("عدد الفاريانتات", "Variants"),
          formatNumber(summary?.totalVariants || 0, {
            maximumFractionDigits: 0,
          }),
        ],
      ],
    },
    {
      title: select("نسخة احتياطية للمنتجات", "Products backup"),
      headers: [
        "Product ID",
        "Variant ID",
        "Product Title",
        "Variant Title",
        "SKU",
        "Barcode",
        "Price",
        "Cost Price",
        "Ads Cost",
        "Operation Cost",
        "Shipping Cost",
        "Total Unit Cost",
        "Unit Profit",
        "Shopify Inventory",
        "Vendor",
        "Product Type",
        "Updated At",
      ],
      rows: rows.map((variant) => {
        const totalUnitCost =
          toNumber(variant?.cost_price) +
          toNumber(variant?.ads_cost) +
          toNumber(variant?.operation_cost) +
          toNumber(variant?.shipping_cost);
        const unitProfit = toNumber(variant?.price) - totalUnitCost;

        return [
          String(variant?.id || ""),
          String(variant?.variant_id || ""),
          String(variant?.product_title || ""),
          String(variant?.variant_title || ""),
          String(variant?.sku || ""),
          String(variant?.barcode || ""),
          formatExportAmount(variant?.price),
          formatExportAmount(variant?.cost_price, { allowBlank: true }),
          formatExportAmount(variant?.ads_cost),
          formatExportAmount(variant?.operation_cost),
          formatExportAmount(variant?.shipping_cost),
          formatExportAmount(totalUnitCost),
          formatExportAmount(unitProfit),
          String(toNumber(variant?.shopify_inventory_quantity)),
          String(variant?.vendor || ""),
          String(variant?.product_type || ""),
          String(variant?.updated_at || variant?._meta?.updatedAt || ""),
        ];
      }),
    },
  ];
};

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, hasPermission } = useAuth();
  const { select } = useLocale();
  const canEditProducts = hasPermission("can_edit_products");
  const cacheKey = useMemo(() => buildProductsCacheKey(null, "basic"), []);
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
  const [exporting, setExporting] = useState(false);
  const [quickEditVariant, setQuickEditVariant] = useState(null);
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
            light: true,
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
          return rows;
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
          return productsRef.current;
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

    readCachedProducts(cacheKey).then(({ rows: cachedRows, updatedAt }) => {
      if (!active) {
        return;
      }

      if (cachedRows.length > 0) {
        if (productsRef.current.length === 0) {
          setProducts(cachedRows);
        }
        setLastUpdatedAt(updatedAt || new Date());
        setLoadStatus({
          active: false,
          message: `Showing ${formatNumber(cachedRows.length, { maximumFractionDigits: 0 })} saved products`,
        });
        return;
      }

      fetchProducts({ silent: true });
    });

    return () => {
      active = false;
    };
  }, [cacheKey, fetchProducts]);

  const variantRows = useMemo(
    () => buildVariantRows(products, isAdmin),
    [isAdmin, products],
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

    if (filters.productType !== "all") {
      result = result.filter(
        (variant) =>
          String(variant.product_type || "").toLowerCase() ===
          String(filters.productType || "").toLowerCase(),
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
    variantRows,
  ]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const handleExportProducts = useCallback(async () => {
    setExporting(true);
    try {
      let exportSourceProducts = productsRef.current;

      if (fetchPromiseRef.current) {
        await fetchPromiseRef.current;
        exportSourceProducts = productsRef.current;
      } else if (exportSourceProducts.length === 0) {
        exportSourceProducts = await fetchProducts({ silent: true, force: true });
      }

      const exportVariants = buildVariantRows(exportSourceProducts, isAdmin);
      if (exportVariants.length === 0) {
        throw new Error("No products available to export");
      }

      downloadCsvSections({
        filename: buildCsvFilename("products-backup"),
        sections: buildProductsExportSections({
          variantRows: exportVariants,
          summary: {
            uniqueProducts: new Set(
              exportVariants.map((variant) => String(variant?.id || "")),
            ).size,
            totalVariants: exportVariants.length,
          },
          select,
        }),
      });

      showNotification("Products CSV backup is ready", "success");
    } catch (error) {
      console.error("Export error:", error);
      showNotification("Failed to prepare products CSV backup", "error");
    } finally {
      setExporting(false);
    }
  }, [fetchProducts, isAdmin, select, showNotification]);

  const openProductWorkspace = useCallback((productId, mode = "view") => {
    if (!productId) {
      return;
    }

    const href =
      mode === "edit"
        ? `/products/${productId}?mode=edit`
        : `/products/${productId}`;

    const openedWindow = window.open(href, "_blank", "noopener,noreferrer");
    if (!openedWindow) {
      window.location.assign(href);
    }
  }, []);


  const openQuickEdit = useCallback((variant) => {
    setQuickEditVariant(variant);
  }, []);

  const closeQuickEdit = useCallback(() => {
    setQuickEditVariant(null);
  }, []);

  const handleQuickCostSave = useCallback(
    async (payload) => {
      const productId = quickEditVariant?.id;

      if (!productId) {
        throw new Error("Product not found");
      }

      const response = await api.post(`/shopify/products/${productId}/update`, payload);
      const nextUpdatedAt = new Date().toISOString();
      const nextProducts = applyQuickCostEditsToProducts(
        productsRef.current,
        productId,
        payload,
        nextUpdatedAt,
      );

      productsRef.current = nextProducts;
      setProducts(nextProducts);
      setLastUpdatedAt(new Date(nextUpdatedAt));
      await writeProductsCache(cacheKey, nextProducts);

      showNotification(
        select(
          "تم حفظ حقول التكلفة من نفس الصفحة.",
          "Cost fields were saved from the same page.",
        ),
        "success",
      );

      return response?.data;
    },
    [cacheKey, quickEditVariant, select, showNotification],
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
                {select(
                  "\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a",
                  "Products",
                )}
              </h1>
              <p className="text-slate-600">
                {select(
                  "قائمة بسيطة للمنتجات ببحث سريع وتعديل تكلفة سريع بدون حمولة زائدة.",
                  "A lighter products list with quick search and quick cost edit.",
                )}
              </p>
              {lastUpdatedAt && (
                <p className="mt-2 text-xs text-slate-500">
                  {select(
                    "\u0622\u062e\u0631 \u062a\u062d\u062f\u064a\u062b",
                    "Last refresh",
                  )}
                  : {formatDateTime(lastUpdatedAt)}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExportProducts}
                disabled={exporting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50"
              >
                <Download size={18} />
                {exporting
                  ? select("جاري تجهيز النسخة...", "Preparing backup...")
                  : select("نسخة CSV", "Backup CSV")}
              </button>
              <button
                onClick={() => fetchProducts({ force: true })}
                className="bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <RefreshCw size={18} />
                {select("تحديث", "Refresh")}
              </button>
            </div>
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
                <span className="text-xs text-sky-600">Loading...</span>
              )}
            </div>
          )}


          <div className="bg-white rounded-xl shadow p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Simple filters
                </h2>
                <p className="text-sm text-slate-500">
                  Search, type, and sort only.
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
              Showing{" "}
              <strong>
                {formatNumber(filteredVariants.length, {
                  maximumFractionDigits: 0,
                })}
              </strong>{" "}
              items right now.
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
              <div className="md:col-span-2 xl:col-span-2">
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {loadStatus.active && products.length === 0 ? (
              Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={`product-skeleton-${index}`}
                  className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow"
                >
                  <SkeletonBlock className="h-40 w-full" roundedClassName="" />
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
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="h-40 bg-gradient-to-br from-slate-100 via-slate-50 to-slate-200 flex items-center justify-center">
                    <VariantImage variant={variant} />
                  </div>

                  <div className="space-y-3 p-4">
                    <div>
                      <h3 className="font-bold text-slate-900 line-clamp-2 min-h-[3rem]">
                        {variant.product_title}
                      </h3>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span>{variant.variant_title}</span>
                        {variant.product_type ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                            {variant.product_type}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <DetailItem label="Price" value={formatAmount(variant.price)} />
                      {isAdmin ? (
                        <DetailItem
                          label="Cost"
                          value={
                            variant.cost_price !== undefined &&
                            variant.cost_price !== null
                              ? formatAmount(variant.cost_price)
                              : "-"
                          }
                        />
                      ) : null}
                      <DetailItem label="SKU" value={variant.sku || "-"} />
                      <DetailItem
                        label="Updated"
                        value={
                          variant._meta.updatedAt
                            ? formatDateTime(variant._meta.updatedAt)
                            : "-"
                        }
                      />
                    </div>

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

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        onClick={() => openProductWorkspace(variant.id)}
                        className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-700 flex items-center justify-center gap-2 hover:bg-slate-50"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      {canEditProducts && (
                        <button
                          onClick={() =>
                            isAdmin
                              ? openQuickEdit(variant)
                              : openProductWorkspace(variant.id, "edit")
                          }
                          className="flex-1 bg-sky-600 hover:bg-sky-700 text-white py-2 rounded-lg flex items-center justify-center gap-2 text-sm"
                        >
                          <Edit2 size={14} />
                          {isAdmin
                            ? select("تعديل التكلفة", "Quick cost")
                            : select("تعديل", "Edit")}
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

      {quickEditVariant && isAdmin ? (
        <ProductEditModal
          product={quickEditVariant}
          canEditCost={isAdmin}
          onClose={closeQuickEdit}
          onSave={handleQuickCostSave}
        />
      ) : null}
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

