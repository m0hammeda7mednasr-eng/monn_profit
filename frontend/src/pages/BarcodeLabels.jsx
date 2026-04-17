import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FileText,
  Package,
  Printer,
  RefreshCw,
  Search,
  Tags,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import BarcodeLabelModal from "../components/BarcodeLabelModal";
import CustomLabelCreatorModal from "../components/CustomLabelCreatorModal";
import { EmptyState, ErrorAlert, LoadingSpinner } from "../components/Common";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { formatDateTime, formatNumber } from "../utils/helpers";
import {
  hasPrintableBarcodeValue,
  normalizeBarcodeVariantTitle,
} from "../utils/barcodeLabels";
import { buildVariantRows } from "../utils/productsView";
import {
  buildProductsCacheKey,
  fetchProductPages,
  peekCachedProducts,
  readCachedProducts,
  writeProductsCache,
} from "../utils/productCache";

const getActiveSupplierLinks = (variant = {}) =>
  (Array.isArray(variant?.supplier_links) ? variant.supplier_links : [])
    .filter((link) => link?.is_active !== false && link?.supplier?.is_active !== false);

const getSupplierDisplayCode = (link = {}) =>
  String(link?.supplier?.code || link?.supplier_code || "").trim();

const getSupplierDisplayName = (link = {}) =>
  String(link?.supplier?.name || link?.supplier_name || "").trim();

const resolveSelectedSupplierLink = (variant = {}, selectedSupplierId = "") => {
  const links = getActiveSupplierLinks(variant);
  if (links.length === 0) {
    return null;
  }

  const normalizedSupplierId = String(selectedSupplierId || "").trim();
  if (normalizedSupplierId) {
    const selected = links.find(
      (link) => String(link?.supplier_id || link?.supplier?.id || "").trim() === normalizedSupplierId,
    );
    if (selected) {
      return selected;
    }
  }

  return links.length === 1 ? links[0] : links[0];
};

const buildPrintableTarget = (variant, selectedSupplierId = "") => {
  const supplierLink = resolveSelectedSupplierLink(variant, selectedSupplierId);
  const supplierCode = getSupplierDisplayCode(supplierLink);
  const supplierName = getSupplierDisplayName(supplierLink);

  return {
    key: String(variant?.key || variant?.variant_id || variant?.id || ""),
    title: String(variant?.product_title || "").trim(),
    subtitle: normalizeBarcodeVariantTitle(
      variant?.variant_title,
      variant?.product_title,
    ),
    sku: String(variant?.sku || "").trim(),
    barcode: String(variant?.barcode || "").trim(),
    vendor: String(variant?.vendor || "").trim(),
    supplier_id: String(supplierLink?.supplier_id || supplierLink?.supplier?.id || "").trim(),
    supplier_code: supplierCode,
    supplier_name: supplierName,
  };
};

function MetricCard({ icon: Icon, label, value, helper }) {
  return (
    <div className="app-surface rounded-[24px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            {label}
          </p>
          <p className="mt-3 text-2xl font-bold text-slate-950">{value}</p>
          {helper ? <p className="mt-2 text-sm text-slate-500">{helper}</p> : null}
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  target,
  variant,
  selectedSupplierId,
  onSupplierChange,
  onPrint,
  select,
}) {
  const supplierLinks = getActiveSupplierLinks(variant);

  return (
    <div className="app-surface rounded-[26px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-slate-950">
            {target.title}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {target.subtitle || select("بدون متغير", "No variant title")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onPrint(variant)}
          className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
        >
          <Printer size={16} />
          {select("طباعة", "Print")}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Barcode
          </div>
          <div className="mt-2 break-all font-semibold text-slate-900">
            {target.barcode || "-"}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            SKU
          </div>
          <div className="mt-2 break-all font-semibold text-slate-900">
            {target.sku || "-"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {target.supplier_code ? (
          <span className="app-chip px-3 py-1.5 text-xs font-semibold text-slate-800">
            {select("كود المورد", "Supplier code")}: {target.supplier_code}
          </span>
        ) : null}
        {target.supplier_name ? (
          <span className="app-chip px-3 py-1.5 text-xs font-medium text-slate-700">
            {target.supplier_name}
          </span>
        ) : null}
        {target.vendor ? (
          <span className="app-chip px-3 py-1.5 text-xs font-medium text-slate-700">
            {target.vendor}
          </span>
        ) : null}
        {Array.isArray(variant?.option_values) &&
          variant.option_values.map((value) => (
            <span
              key={`${target.key}-${value}`}
              className="app-chip px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              {value}
            </span>
          ))}
      </div>

      {supplierLinks.length > 1 ? (
        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {select("المورد على الليبل", "Label supplier")}
          </span>
          <select
            value={selectedSupplierId}
            onChange={(event) => onSupplierChange(variant, event.target.value)}
            className="app-input rounded-2xl px-4 py-3 text-sm"
          >
            {supplierLinks.map((link) => {
              const supplierId = String(link?.supplier_id || link?.supplier?.id || "").trim();
              const code = getSupplierDisplayCode(link);
              const name = getSupplierDisplayName(link);
              return (
                <option key={`${target.key}-${supplierId}`} value={supplierId}>
                  {code ? `${code} | ${name || "-"}` : name || supplierId}
                </option>
              );
            })}
          </select>
        </label>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <span>
          {select("آخر تحديث", "Updated")}: {formatDateTime(variant?.updated_at)}
        </span>
        <span>
          {select("المخزون", "Stock")}:{" "}
          {formatNumber(variant?.inventory_quantity, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>
    </div>
  );
}

export default function BarcodeLabels() {
  const { isAdmin } = useAuth();
  const { select } = useLocale();
  const cacheKey = useMemo(() => buildProductsCacheKey(), []);
  const initialCachedProducts = useMemo(
    () => peekCachedProducts(cacheKey),
    [cacheKey],
  );
  const [products, setProducts] = useState(() => initialCachedProducts);
  const [loading, setLoading] = useState(initialCachedProducts.length === 0);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [loadStatus, setLoadStatus] = useState({
    active: false,
    message: "",
  });
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [isCustomLabelModalOpen, setIsCustomLabelModalOpen] = useState(false);
  const [barcodeModalTargets, setBarcodeModalTargets] = useState([]);
  const [barcodeModalTargetKey, setBarcodeModalTargetKey] = useState("");
  const [selectedSuppliersByVariantKey, setSelectedSuppliersByVariantKey] =
    useState({});
  const productsRef = useRef([]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const fetchProducts = useCallback(async ({ force = false, silent = false } = {}) => {
    if (!force) {
      const { rows: cachedRows, isFresh } = await readCachedProducts(cacheKey);
      if (cachedRows.length > 0) {
        setProducts(cachedRows);
        setLoading(false);
        setLoadStatus({
          active: false,
          message: select(
            `تم عرض ${formatNumber(cachedRows.length, {
              maximumFractionDigits: 0,
            })} منتج من الكاش`,
            `Showing ${formatNumber(cachedRows.length, {
              maximumFractionDigits: 0,
            })} cached products`,
          ),
        });

        if (isFresh) {
          return;
        }
      }
    }

    setLoading(!silent && productsRef.current.length === 0);
    setError("");
    setLoadStatus({
      active: true,
      message: select(
        "جاري تحميل المنتجات القابلة للطباعة...",
        "Loading printable products...",
      ),
    });

    try {
      const rows = await fetchProductPages({
        sortBy: "updated_at",
        sortDir: "desc",
        cacheRefresh: force,
        onPage: ({ rows: accumulatedRows, hasMore }) => {
          setProducts(accumulatedRows);
          setLoadStatus({
            active: hasMore,
            message: hasMore
                ? select(
                    `تم تحميل ${formatNumber(accumulatedRows.length, {
                      maximumFractionDigits: 0,
                    })} منتج حتى الآن...`,
                    `Loaded ${formatNumber(accumulatedRows.length, {
                      maximumFractionDigits: 0,
                    })} products so far...`,
                  )
                : select(
                    `تم تحميل ${formatNumber(accumulatedRows.length, {
                      maximumFractionDigits: 0,
                    })} منتج`,
                    `Loaded ${formatNumber(accumulatedRows.length, {
                      maximumFractionDigits: 0,
                    })} products`,
                  ),
          });
        },
      });

      setProducts(rows);
      await writeProductsCache(cacheKey, rows);
      setLoadStatus({
        active: false,
        message: "",
      });
    } catch (requestError) {
      console.error("Failed to load barcode labels page data", requestError);
      setError(
        select(
          "فشل تحميل المنتجات. حاول تحديث الصفحة مرة ثانية.",
          "Failed to load products. Try refreshing the page.",
        ),
      );
      setLoadStatus({
        active: false,
        message: "",
      });
    } finally {
      setLoading(false);
    }
  }, [cacheKey, select]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const printableVariants = useMemo(
    () =>
      buildVariantRows(products, isAdmin).filter((variant) =>
        hasPrintableBarcodeValue(variant),
      ),
    [isAdmin, products],
  );

  const filteredVariants = useMemo(() => {
    const keyword = String(searchTerm || "").trim().toLowerCase();
    if (!keyword) {
      return printableVariants;
    }

    return printableVariants.filter((variant) => {
      const target = buildPrintableTarget(
        variant,
        selectedSuppliersByVariantKey[
          String(variant?.key || variant?.variant_id || variant?.id || "")
        ],
      );
      const fields = [
        target.title,
        target.subtitle,
        target.sku,
        target.barcode,
        target.vendor,
        target.supplier_code,
        target.supplier_name,
        ...(Array.isArray(variant?.option_values) ? variant.option_values : []),
      ]
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean);

      return fields.some((value) => value.includes(keyword));
    });
  }, [printableVariants, searchTerm, selectedSuppliersByVariantKey]);

  useEffect(() => {
    setSelectedSuppliersByVariantKey((current) => {
      const next = { ...current };
      let changed = false;

      for (const variant of printableVariants) {
        const key = String(variant?.key || variant?.variant_id || variant?.id || "");
        if (!key) {
          continue;
        }

        const links = getActiveSupplierLinks(variant);
        if (links.length === 1) {
          const supplierId = String(
            links[0]?.supplier_id || links[0]?.supplier?.id || "",
          ).trim();
          if (supplierId && next[key] !== supplierId) {
            next[key] = supplierId;
            changed = true;
          }
        } else if (links.length > 1 && !next[key]) {
          const supplierId = String(
            links[0]?.supplier_id || links[0]?.supplier?.id || "",
          ).trim();
          if (supplierId) {
            next[key] = supplierId;
            changed = true;
          }
        }
      }

      return changed ? next : current;
    });
  }, [printableVariants]);

  const updateVariantSupplierSelection = useCallback((variant, supplierId) => {
    const key = String(variant?.key || variant?.variant_id || variant?.id || "");
    if (!key) {
      return;
    }

    setSelectedSuppliersByVariantKey((current) => ({
      ...current,
      [key]: supplierId,
    }));
  }, []);

  const openBarcodeLabelModal = useCallback(
    (variant) => {
      const variantKey = String(
        variant?.key || variant?.variant_id || variant?.id || "",
      );
      const target = buildPrintableTarget(
        variant,
        selectedSuppliersByVariantKey[variantKey],
      );
      if (!hasPrintableBarcodeValue(target)) {
        return;
      }

      setBarcodeModalTargets([target]);
      setBarcodeModalTargetKey(target.key);
      setIsBarcodeModalOpen(true);
    },
    [selectedSuppliersByVariantKey],
  );

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
                <Tags size={14} />
                {select("مركز الباركود", "Barcode hub")}
              </div>
              <h1 className="mt-4 text-3xl font-bold text-slate-950">
                {select("طباعة الباركود", "Barcode label printing")}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {select(
                  "دي شاشة مستقلة في النافبار مخصوص للبحث عن أي منتج أو متغير وطباعة الليبل مباشرة من غير ما تدخل على تفاصيل المنتج.",
                  "This page is a dedicated navbar entry for finding any product or variant and printing its label directly without opening product details.",
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={() => fetchProducts({ force: true })}
              className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white"
            >
              <RefreshCw size={16} />
              {select("تحديث", "Refresh")}
            </button>
          </div>

          <div className="app-surface-strong rounded-[30px] p-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                  <FileText size={14} />
                  {select("منشئ ليبل مخصص", "Custom label studio")}
                </div>
                <h2 className="mt-4 text-2xl font-bold text-slate-950">
                  {select("اعمل ليبل لأي كلام أو كود", "Create a label for any text or code")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {select(
                    "ده فوق الجزء الحالي الخاص بمنتجات السيستم. يعني تقدر تعمل ليبل حر للعروض أو أسماء الرفوف أو أي ملاحظة، ومعاك اختيار تضيف باركود أو تكتفي بالنص فقط.",
                    "This sits above the existing system-product labels. You can create a free-form label for promos, shelf names, or any note, with the option to add a barcode or keep it text-only.",
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsCustomLabelModalOpen(true)}
                className="app-button-primary inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white"
              >
                <Printer size={16} />
                {select("إنشاء ليبل مخصص", "Create custom label")}
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <MetricCard
                icon={FileText}
                label={select("حرية الطباعة", "Printing flexibility")}
                value={select("نص أو باركود", "Text or barcode")}
                helper={select(
                  "ينفع تطبع عنوان فقط، عنوان مع كود، أو كود يتحول لباركود.",
                  "Print a title only, a title with a code, or a code rendered as a barcode.",
                )}
              />
              <MetricCard
                icon={Tags}
                label={select("أفضل استخدام", "Best use")}
                value={select("عروض + رفوف", "Promos + shelves")}
                helper={select(
                  "مناسب للعروض المؤقتة، أسماء الأماكن، والليبلات السريعة.",
                  "Great for temporary promos, location names, and quick ad hoc labels.",
                )}
              />
              <MetricCard
                icon={Printer}
                label={select("الجودة", "Output quality")}
                value={select("مقاس ثابت", "Exact size")}
                helper={select(
                  "نفس نظام المقاسات الدقيقة المستخدم في ليبلات الباركود الحالية.",
                  "Uses the same exact-size print engine as the existing barcode labels.",
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              icon={Package}
              label={select("المنتجات المحملة", "Loaded products")}
              value={formatNumber(products.length, { maximumFractionDigits: 0 })}
              helper={select("إجمالي المنتجات التي تم جلبها من السيستم", "Total products fetched from the system")}
            />
            <MetricCard
              icon={Tags}
              label={select("العناصر القابلة للطباعة", "Printable items")}
              value={formatNumber(printableVariants.length, {
                maximumFractionDigits: 0,
              })}
              helper={select("منتجات أو متغيرات تحتوي على SKU أو باركود", "Products or variants that have a SKU or barcode")}
            />
            <MetricCard
              icon={Printer}
              label={select("نتيجة البحث الحالية", "Current search result")}
              value={formatNumber(filteredVariants.length, {
                maximumFractionDigits: 0,
              })}
              helper={select("العناصر الظاهرة بعد الفلترة الحالية", "Items shown after the current filter")}
            />
          </div>

          <div className="app-toolbar rounded-[28px] p-4">
            <div className="relative">
              <Search
                size={18}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={select(
                  "ابحث باسم المنتج أو المتغير أو SKU أو الباركود...",
                  "Search by product, variant, SKU, or barcode...",
                )}
                className="app-input rounded-2xl py-3 pl-11 pr-4 text-sm"
              />
            </div>
            {loadStatus.message ? (
              <p className="mt-3 text-sm text-sky-700">{loadStatus.message}</p>
            ) : null}
          </div>

          {error ? <ErrorAlert message={error} onClose={() => setError("")} /> : null}

          {loading ? (
            <LoadingSpinner
              label={select(
                "جاري تجهيز صفحة الباركود...",
                "Preparing the barcode page...",
              )}
            />
          ) : filteredVariants.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredVariants.map((variant) => {
                const variantKey = String(
                  variant?.key || variant?.variant_id || variant?.id || "",
                );
                const selectedSupplierId =
                  selectedSuppliersByVariantKey[variantKey] || "";
                const target = buildPrintableTarget(variant, selectedSupplierId);

                return (
                  <VariantCard
                    key={target.key}
                    target={target}
                    variant={variant}
                    selectedSupplierId={selectedSupplierId}
                    onSupplierChange={updateVariantSupplierSelection}
                    onPrint={openBarcodeLabelModal}
                    select={select}
                  />
                );
              })}
            </div>
          ) : printableVariants.length > 0 ? (
            <EmptyState
              icon={Search}
              title={select("مفيش نتيجة للبحث الحالي", "No results for this search")}
              message={select(
                "غيّر كلمة البحث أو امسحها عشان تظهر العناصر القابلة للطباعة.",
                "Change or clear the search term to show printable items.",
              )}
            />
          ) : (
            <EmptyState
              icon={Printer}
              title={select("لا يوجد باركود أو SKU جاهز للطباعة", "No printable barcode or SKU found")}
              message={select(
                "أضف SKU أو باركود للمنتجات أولًا، وبعدها هتظهر هنا تلقائيًا.",
                "Add a SKU or barcode to products first, then they will appear here automatically.",
              )}
            />
          )}
        </div>
      </main>

      <BarcodeLabelModal
        open={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        targets={barcodeModalTargets}
        defaultTargetKey={barcodeModalTargetKey}
      />
      <CustomLabelCreatorModal
        open={isCustomLabelModalOpen}
        onClose={() => setIsCustomLabelModalOpen(false)}
      />
    </div>
  );
}
