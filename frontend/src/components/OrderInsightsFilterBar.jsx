import {
  CalendarRange,
  Filter,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useLocale } from "../context/LocaleContext";
import {
  applyOrderScopeDatePreset,
  getActiveOrderScopePresetId,
  getOrderScopeDatePresets,
  getOrderScopePresets,
  getOrderScopeSummary,
  hasActiveOrderScopeFilters,
  resolveOrderScopeDatePreset,
} from "../utils/orderScope";

export default function OrderInsightsFilterBar({
  filters,
  onChange,
  onReset,
  title,
  description,
  baseFilters,
}) {
  const { locale, t } = useLocale();
  const presets = getOrderScopePresets(locale, baseFilters);
  const datePresets = getOrderScopeDatePresets(locale);
  const activePresetId = getActiveOrderScopePresetId(filters, baseFilters);
  const activeDatePresetId = resolveOrderScopeDatePreset(filters);
  const activeSummary = getOrderScopeSummary(filters, locale);
  const hasActiveFilters = hasActiveOrderScopeFilters(filters);
  const resolvedTitle = title || t("orderFilterBar.title", "Analysis Filters");
  const resolvedDescription =
    description ||
    t(
      "orderFilterBar.description",
      "The same filter scope will be applied to the figures and tables shown on this page.",
    );

  const updateField = (key, value) => {
    onChange({
      ...filters,
      [key]: value,
    });
  };

  const handleDatePresetChange = (presetId) => {
    if (presetId === "custom") {
      return;
    }

    onChange(applyOrderScopeDatePreset(filters, presetId));
  };

  return (
    <section className="app-surface rounded-[28px]">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Filter size={18} className="text-sky-700" />
              {resolvedTitle}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{resolvedDescription}</p>
          </div>

          <button
            type="button"
            onClick={onReset}
            className="app-button-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-700"
          >
            <RotateCcw size={16} />
            {t("orderFilterBar.reset", "Reset")}
          </button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => {
            const isActive = preset.id === activePresetId;

            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange({ ...preset.filters })}
                className={`app-chip px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-sky-700 bg-sky-700 text-white shadow-[0_12px_28px_-18px_rgba(2,132,199,0.9)]"
                    : "text-slate-700 hover:bg-white"
                }`}
                title={preset.description}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <Field
            label={t("orderFilterBar.period", "Period")}
            icon={CalendarRange}
          >
            <select
              value={activeDatePresetId}
              onChange={(event) => handleDatePresetChange(event.target.value)}
              className="app-input px-3 py-2.5 text-sm"
            >
              {datePresets.map((preset) => (
                <option
                  key={preset.id}
                  value={preset.id}
                  disabled={
                    preset.id === "custom" && activeDatePresetId !== "custom"
                  }
                >
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={t("orderFilterBar.fromDate", "From Date")}
            icon={CalendarRange}
          >
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => updateField("dateFrom", event.target.value)}
              className="app-input px-3 py-2.5 text-sm"
            />
          </Field>

          <Field
            label={t("orderFilterBar.toDate", "To Date")}
            icon={CalendarRange}
          >
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => updateField("dateTo", event.target.value)}
              className="app-input px-3 py-2.5 text-sm"
            />
          </Field>

          <Field
            label={t("orderFilterBar.ordersLimit", "Orders Count")}
            icon={Filter}
          >
            <input
              type="number"
              min="1"
              step="1"
              value={filters.ordersLimit || ""}
              onChange={(event) =>
                updateField(
                  "ordersLimit",
                  String(event.target.value || "").replace(/[^\d]/g, ""),
                )
              }
              placeholder={locale === "ar" ? "1000 or 4000" : "1000 or 4000"}
              className="app-input px-3 py-2.5 text-sm"
            />
            <p className="mt-2 text-xs text-slate-500">
              {locale === "ar"
                ? "\u0627\u062a\u0631\u0643\u0647 \u0641\u0627\u0631\u063a\u064b\u0627 \u0644\u062a\u062d\u0644\u064a\u0644 \u0643\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062a \u062f\u0627\u062e\u0644 \u0627\u0644\u0646\u0637\u0627\u0642\u060c \u0623\u0648 \u0627\u0643\u062a\u0628 \u0639\u062f\u062f \u0627\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a \u0627\u0644\u0645\u0637\u0644\u0648\u0628."
                : "Leave empty to analyze all orders in scope, or enter the number of recent orders to analyze."}
            </p>
          </Field>

          <Field
            label={t("orderFilterBar.paymentStatus", "Payment Status")}
            icon={ShieldCheck}
          >
            <select
              value={filters.paymentFilter}
              onChange={(event) => updateField("paymentFilter", event.target.value)}
              className="app-input px-3 py-2.5 text-sm"
            >
              <option value="all">
                {locale === "ar" ? "\u0643\u0644 \u0627\u0644\u062d\u0627\u0644\u0627\u062a" : "All statuses"}
              </option>
              <option value="paid_or_partial">
                {locale === "ar"
                  ? "\u0645\u062f\u0641\u0648\u0639 + \u0645\u062f\u0641\u0648\u0639 \u062c\u0632\u0626\u064a\u064b\u0627"
                  : "Paid + Partially Paid"}
              </option>
              <option value="pending_or_authorized">
                {locale === "ar"
                  ? "\u0645\u0639\u0644\u0642 + \u0645\u0635\u0631\u062d \u0628\u0647"
                  : "Pending + Authorized"}
              </option>
              <option value="paid">
                {locale === "ar" ? "\u0645\u062f\u0641\u0648\u0639" : "Paid"}
              </option>
              <option value="partially_paid">
                {locale === "ar"
                  ? "\u0645\u062f\u0641\u0648\u0639 \u062c\u0632\u0626\u064a\u064b\u0627"
                  : "Partially Paid"}
              </option>
              <option value="pending">
                {locale === "ar" ? "\u0645\u0639\u0644\u0642" : "Pending"}
              </option>
              <option value="authorized">
                {locale === "ar" ? "\u0645\u0635\u0631\u062d \u0628\u0647" : "Authorized"}
              </option>
              <option value="partially_refunded">
                {locale === "ar"
                  ? "\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u062c\u0632\u0626\u064a"
                  : "Partially Refunded"}
              </option>
              <option value="refunded">
                {locale === "ar" ? "\u0645\u0633\u062a\u0631\u062f" : "Refunded"}
              </option>
              <option value="voided">
                {locale === "ar" ? "\u0645\u0644\u063a\u064a" : "Voided"}
              </option>
            </select>
          </Field>

          <Field
            label={t("orderFilterBar.fulfillmentStatus", "Fulfillment Status")}
            icon={ShieldCheck}
          >
            <select
              value={filters.fulfillmentFilter}
              onChange={(event) =>
                updateField("fulfillmentFilter", event.target.value)
              }
              className="app-input px-3 py-2.5 text-sm"
            >
              <option value="all">
                {locale === "ar" ? "\u0643\u0644 \u0627\u0644\u062d\u0627\u0644\u0627\u062a" : "All statuses"}
              </option>
              <option value="fulfilled">
                {locale === "ar"
                  ? "\u062a\u0645 \u0627\u0644\u062a\u0633\u0644\u064a\u0645"
                  : "Fulfilled"}
              </option>
              <option value="partial">
                {locale === "ar"
                  ? "\u062a\u0633\u0644\u064a\u0645 \u062c\u0632\u0626\u064a"
                  : "Partially Fulfilled"}
              </option>
              <option value="unfulfilled">
                {locale === "ar"
                  ? "\u063a\u064a\u0631 \u0645\u0633\u0644\u0651\u0645"
                  : "Unfulfilled"}
              </option>
            </select>
          </Field>

          <Field label={t("orderFilterBar.refund", "Refund")} icon={ShieldCheck}>
            <select
              value={filters.refundFilter}
              onChange={(event) => updateField("refundFilter", event.target.value)}
              className="app-input px-3 py-2.5 text-sm"
            >
              <option value="all">
                {locale === "ar" ? "\u0643\u0644 \u0627\u0644\u062d\u0627\u0644\u0627\u062a" : "All statuses"}
              </option>
              <option value="any">
                {locale === "ar"
                  ? "\u064a\u0648\u062c\u062f \u0627\u0633\u062a\u0631\u062c\u0627\u0639"
                  : "Has refund"}
              </option>
              <option value="partial">
                {locale === "ar"
                  ? "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u062c\u0632\u0626\u064a"
                  : "Partial refund"}
              </option>
              <option value="full">
                {locale === "ar"
                  ? "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0643\u0627\u0645\u0644"
                  : "Full refund"}
              </option>
              <option value="none">
                {locale === "ar"
                  ? "\u0628\u062f\u0648\u0646 \u0627\u0633\u062a\u0631\u062c\u0627\u0639"
                  : "No refund"}
              </option>
            </select>
          </Field>
        </div>

        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            hasActiveFilters
              ? "border-sky-200 bg-sky-50/90 text-sky-900"
              : "border-slate-200 bg-slate-50/90 text-slate-600"
          }`}
        >
          {hasActiveFilters ? (
            <div className="flex flex-wrap gap-2">
              {activeSummary.map((item) => (
                <span
                  key={item}
                  className="app-chip inline-flex items-center bg-white px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            t(
              "orderFilterBar.noFilters",
              "No active filters right now. The full available scope for the current store is being shown.",
            )
          )}
        </div>
      </div>
    </section>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <Icon size={14} />
        {label}
      </span>
      {children}
    </label>
  );
}
