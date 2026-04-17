import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Clock3,
  Package,
  RefreshCw,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { warehouseAPI } from "../utils/api";
import { formatDateTime, formatNumber } from "../utils/helpers";
import { extractArray, extractObject } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";

const formatCount = (value) =>
  formatNumber(value, { maximumFractionDigits: 0 });

const isWarehouseEvent = (event) =>
  String(event?.source || "").toLowerCase().includes("/warehouse");

const getScanDisplayTitle = (product) =>
  product?.display_title || product?.product_title || product?.title || product?.sku || "-";

const getScanVariantLabel = (product) => {
  const variantTitle = String(product?.variant_title || "").trim();
  if (!variantTitle || variantTitle === "Default Variant") {
    return "Default";
  }

  return variantTitle;
};

export default function WarehouseScanner() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { isRTL, select } = useLocale();
  const inputRef = useRef(null);

  const [movementType, setMovementType] = useState("in");
  const [scanCode, setScanCode] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingScans, setLoadingScans] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recentScans, setRecentScans] = useState([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const [setupNotice, setSetupNotice] = useState("");

  useEffect(() => {
    const codeFromUrl = String(searchParams.get("code") || "").trim();
    const modeFromUrl = String(searchParams.get("mode") || "").trim().toLowerCase();

    if (codeFromUrl) {
      setScanCode(codeFromUrl);
    }

    if (modeFromUrl === "in" || modeFromUrl === "out") {
      setMovementType(modeFromUrl);
    }
  }, [searchParams]);

  const fetchRecentScans = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoadingScans(true);
      setSetupNotice("");
    }

    try {
      const response = await warehouseAPI.getScans({
        limit: 20,
        offset: 0,
      });
      const payload = extractObject(response?.data);
      const rows = extractArray(response?.data);
      setRecentScans(rows);
      if (payload?.schema_ready === false || payload?.setup_required) {
        setSetupNotice(
          payload?.message ||
            select(
              "سجل مسح المخزن غير متاح الآن، لكن السكان سيحدث مخزون المخزن المنفصل عن Shopify.",
              "Warehouse scan history is unavailable right now, but the scanner will still update the separate warehouse stock.",
            ),
        );
      }
      setLastUpdatedAt(new Date());
    } catch (requestError) {
      console.error("Error fetching recent scans:", requestError);
      setError(
        requestError?.response?.data?.error ||
          select(
            "تعذر تحميل سجل مسح المخزن.",
            "Failed to load warehouse scans",
          ),
      );
    } finally {
      setLoadingScans(false);
    }
  }, [select]);

  useEffect(() => {
    inputRef.current?.focus();
    fetchRecentScans();
  }, [fetchRecentScans]);

  useEffect(() => {
    const unsubscribe = subscribeToSharedDataUpdates((event) => {
      if (!isWarehouseEvent(event)) {
        return;
      }

      fetchRecentScans({ silent: true });
    });

    return () => unsubscribe();
  }, [fetchRecentScans]);

  const quantityNumber = useMemo(
    () => Math.max(1, parseInt(quantity, 10) || 1),
    [quantity],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await warehouseAPI.scan({
        code: scanCode,
        movement_type: movementType,
        quantity: quantityNumber,
        note,
      });

      const payload = response?.data || {};
      const inventory = payload?.inventory || null;
      const product = payload?.product || null;

      setSuccess(
        movementType === "in"
          ? select(
              `تمت إضافة ${formatCount(quantityNumber)} وحدة إلى ${getScanDisplayTitle(product)}`,
              `Added ${formatCount(quantityNumber)} unit(s) to ${getScanDisplayTitle(product)}`,
            )
          : select(
              `تم خصم ${formatCount(quantityNumber)} وحدة من ${getScanDisplayTitle(product)}`,
              `Removed ${formatCount(quantityNumber)} unit(s) from ${getScanDisplayTitle(product)}`,
            ),
      );
      setLastResult({
        ...payload,
        inventory,
        product,
      });
      setScanCode("");
      setNote("");
      setQuantity("1");
      await fetchRecentScans({ silent: true });
      inputRef.current?.focus();
    } catch (requestError) {
      console.error("Error applying warehouse scan:", requestError);
      setError(
        requestError?.response?.data?.error ||
          select(
            "تعذر حفظ حركة المخزن.",
            "Failed to save warehouse scan",
          ),
      );
      inputRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  const modeClassName =
    movementType === "in"
      ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
      : "bg-rose-600 hover:bg-rose-700 border-rose-600";
  const textAlignClass = isRTL ? "text-right" : "text-left";

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
            <div className="flex flex-wrap justify-between items-center gap-3">
              <div className={textAlignClass}>
                <h1 className="text-3xl font-bold text-slate-900">
                  {select("ماسح المخزن", "Warehouse Scanner")}
                </h1>
                <p className="text-slate-600 mt-1">
                  {select(
                    "امسح كود المخزن لتنفيذ إدخال أو إخراج للمخزون. الماسح يقبل SKU أو الباركود أو الكود الداخلي للفاريانت المحدد.",
                    "Scan a warehouse code to move stock in or out. The scanner accepts SKU, barcode, or the generated internal code for the selected variant.",
                  )}
                </p>
                {lastUpdatedAt && (
                  <div className="mt-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    <Clock3 size={12} />
                    {select("آخر تحديث", "Last refresh")} {formatDateTime(lastUpdatedAt)}
                  </div>
                )}
              </div>

              <button
                onClick={() => fetchRecentScans()}
                className="bg-sky-700 hover:bg-sky-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <RefreshCw size={18} />
                {select("تحديث السجل", "Refresh Log")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr,0.85fr] gap-6">
            <section className="space-y-4">
              {setupNotice && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-2 text-amber-800">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      {select("سجل المسح محدود", "Limited scan history")}
                    </p>
                    <p className="text-sm mt-1">
                      {setupNotice}.{" "}
                      {select(
                        "ما زال بإمكانك المسح بالـSKU أو الباركود وتحديث مخزون المخزن المنفصل مباشرة.",
                        "You can still scan SKU or barcode values and update the separate warehouse stock immediately.",
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <div className="flex flex-wrap gap-3">
                  <ToggleButton
                    active={movementType === "in"}
                    label={select("إدخال", "In")}
                    icon={ArrowDown}
                    onClick={() => setMovementType("in")}
                    className="border-emerald-200 bg-emerald-50 text-emerald-700"
                  />
                  <ToggleButton
                    active={movementType === "out"}
                    label={select("إخراج", "Out")}
                    icon={ArrowUp}
                    onClick={() => setMovementType("out")}
                    className="border-rose-200 bg-rose-50 text-rose-700"
                  />
                </div>

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      {select("كود المسح", "Scan Code")}
                    </label>
                    <input
                      ref={inputRef}
                      type="text"
                      value={scanCode}
                      onChange={(event) => setScanCode(event.target.value)}
                      placeholder={select(
                        "امسح أو اكتب SKU أو الباركود أو الكود الداخلي",
                        "Scan or type SKU, barcode, or internal code",
                      )}
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500 text-lg"
                      autoComplete="off"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {select("الكمية", "Quantity")}
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        {select("ملاحظة", "Note")}
                      </label>
                      <input
                        type="text"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={select(
                          "اختياري: مرتجع، تحويل، جرد، تسوية...",
                          "Optional: return, transfer, count, adjustment...",
                        )}
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !scanCode.trim()}
                    className={`w-full text-white px-4 py-3 rounded-xl border flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed ${modeClassName}`}
                  >
                    {movementType === "in" ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
                    {submitting
                      ? select("جارٍ حفظ الحركة...", "Saving movement...")
                      : movementType === "in"
                        ? select("تسجيل إدخال مخزون", "Record Stock In")
                        : select("تسجيل إخراج مخزون", "Record Stock Out")}
                  </button>
                </form>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
                  <AlertCircle size={18} />
                  {error}
                </div>
              )}

              {success && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-2 text-emerald-700">
                  <CheckCircle size={18} />
                  {success}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="bg-slate-900 text-white rounded-2xl shadow-sm p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-slate-300 text-sm">
                      {select("الوضع الحالي", "Current Mode")}
                    </p>
                    <h2 className="text-2xl font-bold mt-1">
                      {movementType === "in"
                        ? select("إدخال مخزون", "Stock In")
                        : select("إخراج مخزون", "Stock Out")}
                    </h2>
                  </div>
                  <div
                    className={`rounded-2xl p-3 ${
                      movementType === "in" ? "bg-emerald-500/20" : "bg-rose-500/20"
                    }`}
                  >
                    {movementType === "in" ? <ArrowDown size={24} /> : <ArrowUp size={24} />}
                  </div>
                </div>
                <p className="text-slate-300 text-sm mt-4 leading-6">
                  {movementType === "in"
                    ? select(
                        "كل عملية مسح تزود مخزون المخزن الفعلي للكود المحدد بدون تغيير رقم Shopify.",
                        "Each scan increases the scanner-managed warehouse stock for the selected variant code without changing Shopify stock.",
                      )
                    : select(
                        "كل عملية مسح تقلل مخزون المخزن الفعلي للكود المحدد ولا تسمح أبدًا بمخزون سالب.",
                        "Each scan decreases the scanner-managed warehouse stock for the selected variant code and never allows negative inventory.",
                      )}
                </p>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("آخر حركة", "Last Movement")}
                </h2>

                {lastResult?.inventory ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                      <div className="font-semibold text-slate-900">
                        {getScanDisplayTitle(lastResult?.product)}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        {select("الكود", "Code")}:{" "}
                        {lastResult?.product?.warehouse_code || lastResult?.product?.sku || "-"}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        SKU: {lastResult?.product?.sku || "-"}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {select("باركود", "Barcode")}: {lastResult?.product?.barcode || "-"}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {select("الفاريانت", "Variant")}: {getScanVariantLabel(lastResult?.product)}
                      </div>
                      {lastResult?.product?.vendor ? (
                        <div className="text-xs text-slate-500 mt-1">
                          {select("المورد", "Vendor")}: {lastResult.product.vendor}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <InfoTile
                        label="Warehouse Stock"
                        value={formatCount(lastResult.inventory.warehouse_quantity)}
                      />
                      <InfoTile
                        label="Shopify Stock"
                        value={formatCount(lastResult.inventory.shopify_inventory_quantity)}
                      />
                      <InfoTile
                        label="Difference"
                        value={formatCount(lastResult.inventory.stock_difference)}
                      />
                      <InfoTile
                        label="Movement Time"
                        value={formatDateTime(lastResult.scan?.created_at)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">
                    {select(
                      "لم يتم تسجيل أي حركة في هذه الجلسة بعد.",
                      "No movement has been recorded in this session yet.",
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="bg-white rounded-xl shadow p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("سجل المسح الأخير", "Recent Scan History")}
                </h2>
                <p className="text-sm text-slate-500">
                  {select(
                    "يتم حفظ كل حركة مع الوقت والكود والكمية والمستخدم.",
                    "Every movement is saved with time, code, quantity, and user.",
                  )}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 border border-slate-200">
                <Package size={14} />
                {select("المستخدم الحالي", "Current user")} {user?.name || select("مستخدم", "User")}
              </div>
            </div>

            {loadingScans ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                {select("جارٍ تحميل سجل المسح...", "Loading scan history...")}
              </div>
            ) : recentScans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
                {setupNotice
                  ? select(
                      "سجل المسح غير متاح حاليًا، لكن آخر نتيجة من السكان ستظهر أعلى الصفحة.",
                      "Scan history is currently unavailable, but the latest scan result will still appear above.",
                    )
                  : select(
                      "لم يتم تسجيل أي عمليات مسح للمخزن بعد.",
                      "No warehouse scans have been recorded yet.",
                    )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className={`min-w-full text-sm ${textAlignClass}`}>
                  <thead>
                    <tr className="bg-slate-50 text-slate-600">
                      <th className="px-4 py-3 font-semibold">{select("الوقت", "Time")}</th>
                      <th className="px-4 py-3 font-semibold">{select("الحركة", "Movement")}</th>
                      <th className="px-4 py-3 font-semibold">{select("المنتج", "Product")}</th>
                      <th className="px-4 py-3 font-semibold">{select("الكود", "Code")}</th>
                      <th className="px-4 py-3 font-semibold">{select("الكمية", "Quantity")}</th>
                      <th className="px-4 py-3 font-semibold">{select("المستخدم", "User")}</th>
                      <th className="px-4 py-3 font-semibold">{select("ملاحظة", "Note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentScans.map((scan) => (
                      <tr key={scan.id} className="border-b border-slate-100">
                        <td className="px-4 py-3 text-slate-700">
                          {formatDateTime(scan.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold ${
                              scan.movement_type === "in"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-rose-50 text-rose-700 border-rose-200"
                            }`}
                          >
                            {scan.movement_type === "in" ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                            {scan.movement_type === "in"
                              ? select("إدخال", "In")
                              : select("إخراج", "Out")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">
                            {getScanDisplayTitle(scan?.product)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {scan?.product?.vendor || "-"}
                            {scan?.product?.variant_title
                              ? ` | ${getScanVariantLabel(scan?.product)}`
                              : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          <div className="font-medium text-slate-900">
                            {scan?.product?.warehouse_code || scan?.sku || "-"}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            SKU: {scan?.product?.sku || "-"}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatCount(scan.quantity)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {scan?.user?.name || scan?.user?.email || "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {scan.note || "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ToggleButton({ active, label, icon: Icon, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
        active ? className : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 mt-2">{value}</div>
    </div>
  );
}
