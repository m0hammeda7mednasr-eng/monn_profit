import React, { useMemo, useState } from "react";
import { Loader, Package, Save, Wallet, X } from "lucide-react";
import { useLocale } from "../context/LocaleContext";

const CURRENCY_LABEL = "LE";

export default function ProductEditModal({
  product,
  onClose,
  onSave,
  canEditCost = false,
}) {
  const { select } = useLocale();
  const hasMultipleVariants = Boolean(product.has_multiple_variants);
  const [price, setPrice] = useState(product.price || "");
  const [sku, setSku] = useState(product.sku || "");
  const [costPrice, setCostPrice] = useState(
    canEditCost ? product.cost_price || "" : "",
  );
  const [adsCost, setAdsCost] = useState(
    canEditCost ? product.ads_cost || "" : "",
  );
  const [operationCost, setOperationCost] = useState(
    canEditCost ? product.operation_cost || "" : "",
  );
  const [shippingCost, setShippingCost] = useState(
    canEditCost ? product.shipping_cost || "" : "",
  );
  const [inventory, setInventory] = useState(
    product.total_inventory ?? product.inventory_quantity ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const profit = useMemo(() => {
    if (!canEditCost || !price || !costPrice) return "0.00";
    const totalCost =
      parseFloat(costPrice || 0) +
      parseFloat(adsCost || 0) +
      parseFloat(operationCost || 0) +
      parseFloat(shippingCost || 0);
    return (parseFloat(price) - totalCost).toFixed(2);
  }, [canEditCost, price, costPrice, adsCost, operationCost, shippingCost]);

  const profitMargin = useMemo(() => {
    if (!canEditCost || !price || !costPrice || parseFloat(price) <= 0) {
      return "0.00";
    }
    return ((parseFloat(profit) / parseFloat(price)) * 100).toFixed(2);
  }, [canEditCost, price, costPrice, profit]);

  const handleSave = async () => {
    setLoading(true);
    setError("");

    try {
      const payload = {
        price: parseFloat(price),
        sku: String(sku || "").trim(),
      };

      if (!hasMultipleVariants) {
        payload.inventory = parseInt(inventory, 10);
      }

      if (canEditCost) {
        payload.cost_price = parseFloat(costPrice || 0);
        payload.ads_cost = parseFloat(adsCost || 0);
        payload.operation_cost = parseFloat(operationCost || 0);
        payload.shipping_cost = parseFloat(shippingCost || 0);
      }

      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to update product");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="app-modal-panel w-full max-w-2xl overflow-hidden rounded-[30px]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5 sm:px-7">
          <div>
            <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
              <Package size={14} />
              {select("تعديل المنتج", "Product editor")}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              {select("تعديل بيانات المنتج", "Edit product details")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{product.title}</p>
          </div>
          <button
            onClick={onClose}
            className="app-button-secondary flex h-11 w-11 items-center justify-center rounded-2xl text-slate-500"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-6 px-6 py-6 sm:px-7">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="app-note px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                {select("السعر", "Price")}
              </p>
              <p className="metric-number mt-2 text-lg font-semibold text-slate-950">
                {price || "0.00"} {CURRENCY_LABEL}
              </p>
            </div>
            <div className="app-note px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                SKU
              </p>
              <p className="mt-2 truncate text-sm font-medium text-slate-700">
                {sku || select("غير محدد", "Not set")}
              </p>
            </div>
            <div className="app-note px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                {select("مخزون Shopify", "Shopify inventory")}
              </p>
              <p className="metric-number mt-2 text-lg font-semibold text-slate-950">
                {inventory === "" ? "-" : inventory}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${select("السعر", "Price")} (${CURRENCY_LABEL})`}>
              <input
                type="number"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                min="0"
                step="0.01"
                className="app-input px-4 py-3 text-sm"
                placeholder="0.00"
              />
            </Field>

            <Field label="SKU">
              <input
                type="text"
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                className="app-input px-4 py-3 text-sm"
                placeholder="SKU-001"
              />
            </Field>

            {canEditCost && (
              <>
                <Field
                  label={`${select("سعر التكلفة", "Cost price")} (${CURRENCY_LABEL})`}
                >
                  <input
                    type="number"
                    value={costPrice}
                    onChange={(event) => setCostPrice(event.target.value)}
                    min="0"
                    step="0.01"
                    className="app-input px-4 py-3 text-sm"
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={`${select("تكلفة الإعلانات", "Ads cost")} (${CURRENCY_LABEL})`}
                >
                  <input
                    type="number"
                    value={adsCost}
                    onChange={(event) => setAdsCost(event.target.value)}
                    min="0"
                    step="0.01"
                    className="app-input px-4 py-3 text-sm"
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={`${select("تكلفة التشغيل", "Operation cost")} (${CURRENCY_LABEL})`}
                >
                  <input
                    type="number"
                    value={operationCost}
                    onChange={(event) => setOperationCost(event.target.value)}
                    min="0"
                    step="0.01"
                    className="app-input px-4 py-3 text-sm"
                    placeholder="0.00"
                  />
                </Field>

                <Field
                  label={`${select("تكلفة الشحن", "Shipping cost")} (${CURRENCY_LABEL})`}
                >
                  <input
                    type="number"
                    value={shippingCost}
                    onChange={(event) => setShippingCost(event.target.value)}
                    min="0"
                    step="0.01"
                    className="app-input px-4 py-3 text-sm"
                    placeholder="0.00"
                  />
                </Field>
              </>
            )}

            <Field
              label={
                hasMultipleVariants
                  ? select("إجمالي مخزون Shopify", "Total Shopify inventory")
                  : select("مخزون Shopify", "Shopify inventory")
              }
            >
              <input
                type="number"
                value={inventory}
                onChange={(event) => setInventory(event.target.value)}
                min="0"
                step="1"
                disabled={hasMultipleVariants}
                className="app-input px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                placeholder="0"
              />
            </Field>
          </div>

          {hasMultipleVariants && (
            <div className="app-note px-4 py-4 text-sm leading-6 text-slate-600">
              {select(
                "المنتجات متعددة الـ variants يتم تعديل مخزونها من صفحة تفاصيل المنتج لكل Variant على حدة.",
                "Products with multiple variants should have inventory updated from the product details page for each variant separately.",
              )}
            </div>
          )}

          {canEditCost && price && costPrice && (
            <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/90 px-5 py-4">
              <div className="flex items-center gap-2 text-emerald-800">
                <Wallet size={16} />
                <p className="text-sm font-semibold">
                  {select("معاينة الربح", "Profit preview")}
                </p>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/80 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700/70">
                    {select("ربح القطعة", "Unit profit")}
                  </p>
                  <p className="metric-number mt-2 text-lg font-semibold text-emerald-900">
                    {profit} {CURRENCY_LABEL}
                  </p>
                </div>
                <div className="rounded-2xl bg-white/80 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700/70">
                    {select("هامش الربح", "Profit margin")}
                  </p>
                  <p className="metric-number mt-2 text-lg font-semibold text-emerald-900">
                    {profitMargin}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-[22px] border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="app-note px-4 py-4 text-sm leading-6 text-slate-600">
            <p className="font-semibold text-slate-800">
              {select("ملاحظة", "Note")}
            </p>
            <p className="mt-1">
              {select(
                "هذه الشاشة تعدل مخزون Shopify فقط. مخزون المخزن/السكانر منفصل. والتغييرات هنا لا تثبت إلا بعد نجاح المزامنة مع Shopify.",
                "This editor changes Shopify inventory only. Warehouse/scanner stock is separate. Changes here are kept only after Shopify sync succeeds.",
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200/80 bg-slate-50/70 px-6 py-5 sm:flex-row sm:justify-end sm:px-7">
          <button
            onClick={onClose}
            disabled={loading}
            className="app-button-secondary rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {select("إلغاء", "Cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="app-button-primary flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader size={16} className="animate-spin" />
                {select("جاري الحفظ...", "Saving...")}
              </>
            ) : (
              <>
                <Save size={16} />
                {select("حفظ التغييرات", "Save changes")}
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
