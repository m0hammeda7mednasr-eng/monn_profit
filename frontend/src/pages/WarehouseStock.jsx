import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Clock3,
  Package,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  Store,
  Tags,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { warehouseAPI } from "../utils/api";
import { formatCurrency, formatDateTime, formatNumber } from "../utils/helpers";
import { fetchAllPagesProgressively } from "../utils/pagination";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { extractObject } from "../utils/response";

const PAGE_LIMIT = 100;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCount = (value) =>
  formatNumber(value, { maximumFractionDigits: 0 });

const matchesSearch = (row, keyword) => {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    row?.display_title,
    row?.product_title,
    row?.variant_title,
    row?.warehouse_code,
    row?.sku,
    row?.barcode,
    row?.barcode_or_sku,
    row?.vendor,
    row?.product_type,
    ...(Array.isArray(row?.option_values) ? row.option_values : []),
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
};

const isWarehouseRelatedSharedUpdate = (event) => {
  const source = String(event?.source || "").toLowerCase();
  if (!source) {
    return true;
  }

  return source.includes("/warehouse") || source.includes("/shopify/products");
};

const getRowClassName = (row) => {
  if (row?.is_archived) {
    return "bg-slate-50";
  }

  if (toNumber(row?.warehouse_quantity) <= 0) {
    return "bg-rose-50";
  }

  if (toNumber(row?.stock_difference) !== 0) {
    return "bg-amber-50";
  }

  return "bg-white";
};

const getDifferenceBadgeClassName = (difference) => {
  if (difference === 0) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }

  if (difference > 0) {
    return "bg-sky-50 text-sky-700 border-sky-200";
  }

  return "bg-amber-50 text-amber-700 border-amber-200";
};

const formatDifference = (value) => {
  const numericValue = toNumber(value);
  if (numericValue > 0) {
    return `+${formatNumber(numericValue, { maximumFractionDigits: 0 })}`;
  }

  return formatNumber(numericValue, { maximumFractionDigits: 0 });
};

const getDisplayTitle = (row) =>
  row?.display_title || row?.product_title || row?.title || row?.warehouse_code || "Variant";

const getVariantLabel = (row) => {
  const variantTitle = String(row?.variant_title || "").trim();
  if (!variantTitle || variantTitle === "Default Variant") {
    return "Default";
  }

  return variantTitle;
};

const getCodeSourceLabel = (row) => {
  if (row?.warehouse_code_source === "sku") {
    return "Primary code from SKU";
  }

  if (row?.warehouse_code_source === "barcode") {
    return "Primary code from barcode";
  }

  if (row?.warehouse_code_source === "internal") {
    return "Primary internal code";
  }

  return "Legacy warehouse code";
};

export default function WarehouseStock() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { isRTL, select } = useLocale();
  const [rows, setRows] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [setupNotice, setSetupNotice] = useState("");
  const [syncingToShopify, setSyncingToShopify] = useState(false);
  const [syncNotice, setSyncNotice] = useState(null);

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const canManageWarehouse = hasPermission("can_edit_warehouse");

  const fetchStock = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
      setSetupNotice("");
    }

    try {
      let schemaReady = true;
      let setupMessage = "";
      const variants = await fetchAllPagesProgressively(
        ({ limit, offset }) =>
          warehouseAPI.getStock({
            limit,
            offset,
            sort_by: "title",
            sort_dir: "asc",
          }),
        {
          limit: PAGE_LIMIT,
          onPage: ({ rows: accumulatedRows, payload }) => {
            setRows(accumulatedRows);
            const responsePayload = extractObject(payload);
            if (
              responsePayload?.schema_ready === false ||
              responsePayload?.setup_required
            ) {
              schemaReady = false;
              setupMessage =
                responsePayload?.message ||
                "Warehouse tables are not configured yet on the database.";
            }
          },
        },
      );

      setRows(variants);
      setSetupNotice(schemaReady ? "" : setupMessage);
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      console.error("Error fetching warehouse stock:", requestError);
      setError(
        requestError?.response?.data?.error || "Failed to load warehouse stock",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  useEffect(() => {
    const unsubscribe = subscribeToSharedDataUpdates((event) => {
      if (!isWarehouseRelatedSharedUpdate(event)) {
        return;
      }

      fetchStock({ silent: true });
    });

    return () => unsubscribe();
  }, [fetchStock]);

  const filteredRows = useMemo(
    () => rows.filter((row) => matchesSearch(row, deferredSearchTerm)),
    [rows, deferredSearchTerm],
  );

  const summary = useMemo(() => {
    let warehouseUnits = 0;
    let mismatched = 0;
    let zeroStock = 0;
    let archived = 0;

    filteredRows.forEach((row) => {
      warehouseUnits += toNumber(row?.warehouse_quantity);

      if (toNumber(row?.stock_difference) !== 0) {
        mismatched += 1;
      }

      if (toNumber(row?.warehouse_quantity) <= 0) {
        zeroStock += 1;
      }

      if (row?.is_archived) {
        archived += 1;
      }
    });

    return {
      totalVariants: filteredRows.length,
      warehouseUnits,
      mismatched,
      zeroStock,
      archived,
    };
  }, [filteredRows]);

  const openScanner = (row, mode = "") => {
    if (!canManageWarehouse) {
      return;
    }

    const code = String(row?.warehouse_code || "").trim();
    if (!code) {
      return;
    }

    const params = new URLSearchParams({ code });
    if (mode) {
      params.set("mode", mode);
    }
    navigate(`/warehouse/scanner?${params.toString()}`);
  };

  const handleSyncToShopify = useCallback(async () => {
    if (!canManageWarehouse || syncingToShopify) {
      return;
    }

    const confirmed = window.confirm(
      select(
        "سيتم استبدال مخزون Shopify ليطابق مخزون المخزن الفعلي لكل المنتجات في هذا المتجر. التنفيذ يدوي ولن يحدث إلا عند الضغط الآن. هل تريد المتابعة؟",
        "This will overwrite Shopify inventory to match the actual warehouse stock for every product in this store. It only runs when you press this button. Continue?",
      ),
    );

    if (!confirmed) {
      return;
    }

    setSyncingToShopify(true);
    setError("");
    setSyncNotice(null);

    try {
      const response = await warehouseAPI.syncToShopify();
      const payload = extractObject(response);
      const syncedCount = toNumber(payload?.synced_count);
      const unchangedCount = toNumber(payload?.unchanged_count);
      const skippedCount = toNumber(payload?.skipped_count);
      const failedCount = toNumber(payload?.failed_count);
      const localUpdateError = String(payload?.local_update_error || "").trim();

      setSyncNotice({
        tone: failedCount > 0 || localUpdateError ? "warning" : "success",
        title: select(
          "انتهت مزامنة المخزن إلى Shopify",
          "Warehouse to Shopify sync finished",
        ),
        message: select(
          `تم تحديث ${formatCount(syncedCount)} صف على Shopify، و${formatCount(unchangedCount)} كان مطابقًا بالفعل، و${formatCount(skippedCount)} تم تخطيه، و${formatCount(failedCount)} فشل.`,
          `Updated ${formatCount(syncedCount)} rows on Shopify, ${formatCount(unchangedCount)} were already matched, ${formatCount(skippedCount)} were skipped, and ${formatCount(failedCount)} failed.`,
        ),
        detail: localUpdateError
          ? select(
              `تم تحديث Shopify لكن تحديث النسخة المحلية تعثر: ${localUpdateError}`,
              `Shopify was updated, but refreshing the local snapshot failed: ${localUpdateError}`,
            )
          : "",
      });

      await fetchStock({ silent: true });
    } catch (requestError) {
      console.error("Error syncing warehouse stock to Shopify:", requestError);
      setError(
        requestError?.response?.data?.error ||
          "Failed to sync warehouse stock to Shopify",
      );
    } finally {
      setSyncingToShopify(false);
    }
  }, [canManageWarehouse, fetchStock, select, syncingToShopify]);

  const tableAlignClass = isRTL ? "text-right" : "text-left";
  const searchIconPositionClass = isRTL ? "right-3" : "left-3";
  const searchInputPaddingClass = isRTL ? "pr-8 pl-3" : "pl-8 pr-3";

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="bg-gradient-to-r from-slate-50 via-white to-sky-50/80 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900">
                    {select("مخزون المخزن", "Warehouse Stock")}
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                    {select(
                      "كل فاريانت من Shopify ظاهر هنا مع كود مخزني جاهز للمسح. رقم Shopify يظل ظاهر كمرجع، بينما مخزون المخزن الفعلي يُدار بشكل منفصل من السكانر فقط.",
                      "Every Shopify variant is listed here with a warehouse code ready for scanning. Shopify stock stays visible as a reference, while warehouse stock is tracked separately by the scanner.",
                    )}
                  </p>
                  {lastUpdatedAt && (
                    <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                      <Clock3 size={12} />
                      {select("آخر تحديث", "Last refresh")} {formatDateTime(lastUpdatedAt)}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                      type="button"
                      onClick={handleSyncToShopify}
                      disabled={!canManageWarehouse || syncingToShopify}
                      title={select(
                        canManageWarehouse
                          ? "ÙŠØ¯ÙØ¹ Ù…Ø®Ø²ÙˆÙ† Ø§Ù„Ù…Ø®Ø²Ù† Ø§Ù„ÙØ¹Ù„ÙŠ Ø¥Ù„Ù‰ Shopify Ø¹Ù†Ø¯ Ø§Ù„Ø¶ØºØ· ÙÙ‚Ø·"
                          : "ØªØ­ØªØ§Ø¬ ØµÙ„Ø§Ø­ÙŠØ© Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ù„ØªØ´ØºÙŠÙ„ Ù…Ø²Ø§Ù…Ù†Ø© Shopify",
                        canManageWarehouse
                          ? "Push the actual warehouse balance to Shopify when pressed"
                          : "You need warehouse edit permission to run the Shopify sync",
                      )}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {syncingToShopify ? (
                        <RefreshCw size={18} className="animate-spin" />
                      ) : (
                        <ArrowUp size={18} />
                      )}
                      {select(
                        syncingToShopify
                          ? "جاري دفع المخزون إلى Shopify"
                          : "مزامنة المخزن إلى Shopify",
                        syncingToShopify
                          ? "Syncing warehouse to Shopify"
                          : "Sync Warehouse To Shopify",
                      )}
                    </button>

                  <button
                    type="button"
                    onClick={() => fetchStock()}
                    disabled={syncingToShopify}
                    className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
                  {select("تحديث", "Refresh")}
                </button>
                  <p
                    className={`basis-full text-xs ${
                      canManageWarehouse ? "text-slate-500" : "text-amber-700"
                    }`}
                  >
                    {select(
                      canManageWarehouse
                        ? "Ù…Ø²Ø§Ù…Ù†Ø© Shopify ÙŠØ¯ÙˆÙŠØ© ÙÙ‚Ø·ØŒ ÙˆÙ„Ù† ØªØ¹Ù…Ù„ Ø¥Ù„Ø§ Ø¹Ù†Ø¯ Ø§Ù„Ø¶ØºØ· Ø¹Ù„Ù‰ Ø²Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© ÙÙŠ Ø£Ø¹Ù„Ù‰ Ø§Ù„ØµÙØ­Ø©."
                        : "Ø²Ø± Ø§Ù„Ù…Ø²Ø§Ù…Ù†Ø© Ø¸Ø§Ù‡Ø± Ù‡Ù†Ø§ØŒ Ù„ÙƒÙ†Ùƒ ØªØ­ØªØ§Ø¬ ØµÙ„Ø§Ø­ÙŠØ© Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª Ù„ØªÙ†ÙÙŠØ°Ù‡.",
                      canManageWarehouse
                        ? "Shopify sync is manual only and runs only when you press the sync button at the top of the page."
                        : "The sync button is visible here, but you need warehouse edit permission to run it.",
                    )}
                  </p>
              </div>
            </div>
          </div>

            <div className="grid gap-3 border-t border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600 sm:grid-cols-3">
              <InsightBanner
                label={select("نطاق الكتالوج", "Catalog Scope")}
                value={select(
                  "الصفحة تعرض كل فاريانتات Shopify، وليس فقط الصفوف التي لها حركات مخزنية بالفعل.",
                  "The page shows every Shopify variant, not only rows that already have warehouse movements.",
                )}
              />
              <InsightBanner
                label={select("كود المخزن", "Warehouse Code")}
                value={select(
                  "أولوية كود المسح هي SKU ثم الباركود ثم الكود الداخلي البديل.",
                  "Scanner code priority is SKU, then barcode, then an internal fallback code.",
                )}
              />
              <InsightBanner
                label={select("إجراءات سريعة", "Quick Actions")}
                value={select(
                  "استخدم إدخال أو إخراج أو فتح للانتقال مباشرة إلى الماسح بالكود المختار.",
                  "Use In, Out, or Open to jump straight to the scanner with the chosen product code.",
                )}
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          {syncNotice && (
            <div
              className={`flex items-start gap-2 rounded-xl border p-4 ${
                syncNotice.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              <RefreshCw size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">{syncNotice.title}</p>
                <p className="mt-1 text-sm">{syncNotice.message}</p>
                {syncNotice.detail ? (
                  <p className="mt-1 text-xs">{syncNotice.detail}</p>
                ) : null}
              </div>
            </div>
          )}

          {setupNotice && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <ShieldAlert size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {select("عرض مباشر للمخزون", "Live stock view")}
                </p>
                <p className="mt-1 text-sm">
                  {setupNotice}.{" "}
                  {select(
                    "الصفحة تعرض الآن مخزون المخزن المحلي المنفصل عن Shopify، والسكان سيستمر في تحديثه حتى لو جداول سجل warehouse التفصيلي غير متاحة.",
                    "The page is showing scanner-managed warehouse stock saved separately from Shopify, even if detailed warehouse history tables are unavailable.",
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <SummaryCard
              title={select("الفاريانتات", "Variants")}
              value={formatCount(summary.totalVariants)}
              tone="blue"
              icon={Tags}
            />
            <SummaryCard
              title={select("وحدات المخزن", "Warehouse Units")}
              value={formatCount(summary.warehouseUnits)}
              tone="emerald"
              icon={Store}
            />
            <SummaryCard
              title={select("تحتاج مراجعة", "Need Review")}
              value={formatCount(summary.mismatched)}
              tone="amber"
              icon={ShieldAlert}
            />
            <SummaryCard
              title={select("صفر أو أقل", "Zero Or Less")}
              value={formatCount(summary.zeroStock)}
              tone="red"
              icon={AlertCircle}
            />
            <SummaryCard
              title={select("أكواد مؤرشفة", "Archived Codes")}
              value={formatCount(summary.archived)}
              tone="slate"
              icon={Package}
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("جرد الفاريانتات", "Variant Inventory")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {select(
                    "قارن رقم Shopify المرجعي برصيد المخزن الفعلي الذي يديره السكانر لنفس الكود المخزني.",
                    "Compare Shopify stock against the separate scanner-managed warehouse balance for the same warehouse code.",
                  )}
                </p>
              </div>

              <div className="relative w-full lg:w-96">
                <Search
                  className={`absolute top-2.5 text-slate-400 ${searchIconPositionClass}`}
                  size={16}
                />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={select(
                    "ابحث بالمنتج أو الفاريانت أو الكود أو SKU أو الباركود أو المورد",
                    "Search product, variant, code, SKU, barcode, or vendor",
                  )}
                  className={`w-full rounded-xl border border-slate-200 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500 ${searchInputPaddingClass}`}
                />
              </div>
            </div>

            <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
              {select("عرض", "Showing")} {formatCount(filteredRows.length)}{" "}
              {select("صفًا من أصل", "rows out of")} {formatCount(rows.length)}.
            </div>

            <div className="p-4 sm:p-5">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                  {select("جارٍ تحميل مخزون المخزن...", "Loading warehouse stock...")}
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                  {select("لا توجد فاريانتات مطابقة للبحث الحالي.", "No variants match the current search.")}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`min-w-full text-sm ${tableAlignClass}`}>
                    <thead>
                      <tr className="bg-slate-50 text-slate-600">
                        <th className="px-4 py-3 font-semibold">{select("الفاريانت", "Variant")}</th>
                        <th className="px-4 py-3 font-semibold">{select("الكود", "Code")}</th>
                        <th className="px-4 py-3 font-semibold">{select("السعر", "Price")}</th>
                        <th className="px-4 py-3 font-semibold">{select("المخزن", "Warehouse")}</th>
                        <th className="px-4 py-3 font-semibold">Shopify</th>
                        <th className="px-4 py-3 font-semibold">{select("الفرق", "Difference")}</th>
                        <th className="px-4 py-3 font-semibold">{select("آخر حركة", "Last Movement")}</th>
                        <th className="px-4 py-3 font-semibold">{select("الحالة", "Status")}</th>
                        <th className="px-4 py-3 font-semibold">{select("الماسح", "Scanner")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => {
                        const difference = toNumber(row?.stock_difference);

                        return (
                          <tr
                            key={row.id}
                            className={`border-b border-slate-100 align-top ${getRowClassName(row)}`}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-start gap-3">
                                <WarehouseRowThumbnail
                                  src={row?.image_url}
                                  label={getDisplayTitle(row)}
                                />
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">
                                    {getDisplayTitle(row)}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {row?.product_title || "-"}
                                    {row?.variant_title
                                      ? ` | ${getVariantLabel(row)}`
                                      : ""}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {row?.vendor || "-"}
                                    {row?.product_type ? ` | ${row.product_type}` : ""}
                                  </div>
                                  {Array.isArray(row?.option_values) &&
                                  row.option_values.length > 0 ? (
                                    <div className="mt-1 text-xs text-slate-500">
                                      {row.option_values.join(" | ")}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-700">
                              <div className="font-semibold text-slate-900">
                                {row.warehouse_code || "-"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                SKU: {row?.sku || "-"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {select("باركود", "Barcode")}: {row?.barcode || "-"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {getCodeSourceLabel(row)}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {formatCurrency(row.price)}
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              {formatCount(row.warehouse_quantity)}
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              {formatCount(row.shopify_inventory_quantity)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getDifferenceBadgeClassName(difference)}`}
                              >
                                {formatDifference(difference)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">
                              <div>{formatDateTime(row.last_scanned_at)}</div>
                              {row.last_movement_type ? (
                                <div className="mt-1 text-xs text-slate-500">
                                  {row.last_movement_type === "in"
                                    ? select("إدخال", "In")
                                    : select("إخراج", "Out")}
                                  {row.last_movement_quantity
                                    ? ` | ${formatCount(row.last_movement_quantity)}`
                                    : ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              <div className="space-y-2">
                                {row?.is_archived ? (
                                  <Badge
                                    tone="slate"
                                    label={select("كود مؤرشف", "Archived code")}
                                  />
                                ) : null}
                                {difference === 0 ? (
                                  <Badge
                                    tone="emerald"
                                    label={select("متطابق", "Matched")}
                                  />
                                ) : difference > 0 ? (
                                  <Badge
                                    tone="sky"
                                    label={select("المخزن أعلى", "Warehouse higher")}
                                  />
                                ) : (
                                  <Badge
                                    tone="amber"
                                    label={select("Shopify أعلى", "Shopify higher")}
                                  />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex min-w-[120px] flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => openScanner(row, "in")}
                                  disabled={!canManageWarehouse || !row?.warehouse_code}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ArrowDown size={13} />
                                  {select("إدخال", "In")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openScanner(row, "out")}
                                  disabled={!canManageWarehouse || !row?.warehouse_code}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ArrowUp size={13} />
                                  {select("إخراج", "Out")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openScanner(row)}
                                  disabled={!canManageWarehouse || !row?.warehouse_code}
                                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <ScanLine size={13} />
                                  {select("فتح", "Open")}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ title, value, tone, icon: Icon }) {
  const tones = {
    blue: "bg-sky-50 text-sky-700 border-sky-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    red: "bg-red-50 text-red-700 border-red-100",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };

  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${tones[tone] || tones.blue}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="mt-2 text-2xl font-bold">{value}</p>
        </div>
        <div className="rounded-2xl bg-white/70 p-3">
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function InsightBanner({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-700">{value}</div>
    </div>
  );
}

function Badge({ tone = "slate", label }) {
  const tones = {
    slate: "border-slate-200 bg-slate-100 text-slate-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone] || tones.slate}`}
    >
      {label}
    </span>
  );
}

function WarehouseRowThumbnail({ src, label }) {
  const [imageFailed, setImageFailed] = useState(false);
  const fallback = String(label || "S").trim().slice(0, 1).toUpperCase();

  if (!src || imageFailed) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-lg font-bold text-slate-500">
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={label || "Variant"}
      className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 bg-white object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  );
}
