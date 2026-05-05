import { useEffect, useMemo, useRef, useState } from "react";
import { Loader, Save, TrendingUp, Wallet, X } from "lucide-react";
import { useLocale } from "../context/LocaleContext";

const toDraftValue = (value, { allowBlank = true } = {}) => {
  if (value === null || value === undefined || value === "") {
    return allowBlank ? "" : "0";
  }

  return String(value);
};

const toAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function ProductEditModal({
  product,
  onClose,
  onSave,
  canEditCost = false,
}) {
  const { select, currencyLabel } = useLocale();
  const costInputRef = useRef(null);
  const [costPrice, setCostPrice] = useState(
    toDraftValue(product?.cost_price, { allowBlank: true }),
  );
  const [adsCost, setAdsCost] = useState(
    toDraftValue(product?.ads_cost, { allowBlank: false }),
  );
  const [operationCost, setOperationCost] = useState(
    toDraftValue(product?.operation_cost, { allowBlank: false }),
  );
  const [shippingCost, setShippingCost] = useState(
    toDraftValue(product?.shipping_cost, { allowBlank: false }),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const resolvedCurrencyLabel = currencyLabel || "LE";
  const unitPrice = toAmount(product?.price);
  const totalUnitCost = useMemo(
    () =>
      toAmount(costPrice) +
      toAmount(adsCost) +
      toAmount(operationCost) +
      toAmount(shippingCost),
    [adsCost, costPrice, operationCost, shippingCost],
  );
  const unitProfit = useMemo(
    () => unitPrice - totalUnitCost,
    [totalUnitCost, unitPrice],
  );
  const profitMargin = useMemo(() => {
    if (unitPrice <= 0) {
      return "0.00";
    }

    return ((unitProfit / unitPrice) * 100).toFixed(2);
  }, [unitPrice, unitProfit]);

  useEffect(() => {
    costInputRef.current?.focus();
    costInputRef.current?.select();
  }, []);

  const handleSave = async () => {
    if (!canEditCost) {
      setError(
        select(
          "ليس لديك صلاحية تعديل التكلفة من هذه الشاشة.",
          "You do not have permission to edit cost fields here.",
        ),
      );
      return;
    }

    setLoading(true);
    setError("");

    try {
      await onSave({
        cost_price: toAmount(costPrice),
        ads_cost: toAmount(adsCost),
        operation_cost: toAmount(operationCost),
        shipping_cost: toAmount(shippingCost),
      });
      onClose();
    } catch (requestError) {
      setError(
        requestError?.message ||
          select("فشل حفظ التكلفة", "Failed to save cost fields"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="app-modal-panel w-full max-w-xl overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              {select("تعديل سريع", "Quick edit")}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              {select("تعديل التكلفة بسرعة", "Fast cost editing")}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-500">
              {product?.product_title || product?.title}
            </p>
            {product?.variant_title ? (
              <p className="mt-1 text-xs text-slate-400">
                {product.variant_title}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat
              label={select("السعر الحالي", "Current price")}
              value={`${unitPrice.toFixed(2)} ${resolvedCurrencyLabel}`}
            />
            <MiniStat
              label="SKU"
              value={String(product?.sku || "").trim() || "-"}
            />
            <MiniStat
              label={select("مخزون Shopify", "Shopify stock")}
              value={String(product?.shopify_inventory_quantity ?? product?.inventory_quantity ?? 0)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={`${select("سعر التكلفة", "Cost price")} (${resolvedCurrencyLabel})`}
            >
              <input
                ref={costInputRef}
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
                className="app-input w-full px-4 py-3 text-sm"
                placeholder="0.00"
              />
            </Field>

            <Field
              label={`${select("تكلفة الإعلانات", "Ads cost")} (${resolvedCurrencyLabel})`}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={adsCost}
                onChange={(event) => setAdsCost(event.target.value)}
                className="app-input w-full px-4 py-3 text-sm"
                placeholder="0.00"
              />
            </Field>

            <Field
              label={`${select("تكلفة التشغيل", "Operation cost")} (${resolvedCurrencyLabel})`}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={operationCost}
                onChange={(event) => setOperationCost(event.target.value)}
                className="app-input w-full px-4 py-3 text-sm"
                placeholder="0.00"
              />
            </Field>

            <Field
              label={`${select("تكلفة الشحن", "Shipping cost")} (${resolvedCurrencyLabel})`}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                dir="ltr"
                value={shippingCost}
                onChange={(event) => setShippingCost(event.target.value)}
                className="app-input w-full px-4 py-3 text-sm"
                placeholder="0.00"
              />
            </Field>
          </div>

          <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="flex items-center gap-2 text-emerald-800">
              <Wallet size={16} />
              <p className="text-sm font-semibold">
                {select("ملخص الربحية", "Profit summary")}
              </p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <SummaryValue
                label={select("إجمالي التكلفة", "Total unit cost")}
                value={`${totalUnitCost.toFixed(2)} ${resolvedCurrencyLabel}`}
              />
              <SummaryValue
                label={select("ربح القطعة", "Unit profit")}
                value={`${unitProfit.toFixed(2)} ${resolvedCurrencyLabel}`}
                tone={unitProfit >= 0 ? "text-emerald-900" : "text-red-700"}
              />
              <SummaryValue
                label={select("الهامش", "Margin")}
                value={`${profitMargin}%`}
                icon={TrendingUp}
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:opacity-50"
          >
            {select("إلغاء", "Cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" />
                {select("جارٍ الحفظ...", "Saving...")}
              </>
            ) : (
              <>
                <Save size={16} />
                {select("حفظ التكلفة", "Save cost")}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ children, label }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 truncate text-sm font-semibold text-slate-900">
        {value}
      </p>
    </div>
  );
}

function SummaryValue({ label, value, tone = "text-slate-900", icon: Icon = null }) {
  return (
    <div className="rounded-2xl bg-white/85 px-4 py-3">
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={13} className="text-emerald-700" /> : null}
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700/70">
          {label}
        </p>
      </div>
      <p className={`mt-2 text-base font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
