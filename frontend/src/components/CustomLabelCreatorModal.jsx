import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import {
  FileText,
  Printer,
  Ruler,
  ScanLine,
  Settings2,
  X,
} from "lucide-react";
import { useLocale } from "../context/LocaleContext";
import {
  BARCODE_LABEL_PRESETS,
  DEFAULT_BARCODE_LABEL_PRESET_ID,
  buildBarcodeLabelPrintHtml,
  getBarcodeLabelPresetById,
  getBarcodeRenderOptions,
  hasPrintableLabelContent,
  normalizeLabelCopies,
} from "../utils/barcodeLabels";

const CUSTOM_LABEL_SETTINGS_STORAGE_KEY = "moon_profit_custom_label_settings_v1";

const readSavedDraft = () => {
  if (typeof window === "undefined") {
    return {
      title: "",
      subtitle: "",
      code: "",
      showBarcode: false,
      footerLine1: "Moon Profit",
      footerLine2: "",
      copies: 1,
      presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
    };
  }

  try {
    const rawValue = window.localStorage.getItem(CUSTOM_LABEL_SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return {
        title: "",
        subtitle: "",
        code: "",
        showBarcode: false,
        footerLine1: "Moon Profit",
        footerLine2: "",
        copies: 1,
        presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
      };
    }

    const parsedValue = JSON.parse(rawValue);
    return {
      title: String(parsedValue?.title || ""),
      subtitle: String(parsedValue?.subtitle || ""),
      code: String(parsedValue?.code || ""),
      showBarcode: Boolean(parsedValue?.showBarcode),
      footerLine1: String(parsedValue?.footerLine1 || "Moon Profit"),
      footerLine2: String(parsedValue?.footerLine2 || ""),
      copies: normalizeLabelCopies(parsedValue?.copies),
      presetId: String(parsedValue?.presetId || DEFAULT_BARCODE_LABEL_PRESET_ID),
    };
  } catch {
    return {
      title: "",
      subtitle: "",
      code: "",
      showBarcode: false,
      footerLine1: "Moon Profit",
      footerLine2: "",
      copies: 1,
      presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
    };
  }
};

const writeSavedDraft = (draft) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    CUSTOM_LABEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      title: String(draft?.title || "").trim(),
      subtitle: String(draft?.subtitle || "").trim(),
      code: String(draft?.code || "").trim(),
      showBarcode: Boolean(draft?.showBarcode),
      footerLine1: String(draft?.footerLine1 || "").trim(),
      footerLine2: String(draft?.footerLine2 || "").trim(),
      copies: normalizeLabelCopies(draft?.copies),
      presetId: String(draft?.presetId || DEFAULT_BARCODE_LABEL_PRESET_ID),
    }),
  );
};

const createBarcodeSvgMarkup = (value) => {
  const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svgElement, value, getBarcodeRenderOptions(value));
  return svgElement.outerHTML;
};

function BarcodeSvg({ value }) {
  const svgRef = useRef(null);
  const { select } = useLocale();
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    if (!svgRef.current) {
      return;
    }

    if (!value) {
      setRenderError("");
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
      return;
    }

    try {
      JsBarcode(svgRef.current, value, getBarcodeRenderOptions(value));
      setRenderError("");
    } catch {
      setRenderError(
        select(
          "تعذر إنشاء الباركود لهذا الكود.",
          "Unable to create a barcode for this value.",
        ),
      );
      while (svgRef.current.firstChild) {
        svgRef.current.removeChild(svgRef.current.firstChild);
      }
    }
  }, [select, value]);

  if (renderError) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-center text-xs font-medium text-red-700">
        {renderError}
      </div>
    );
  }

  return <svg ref={svgRef} className="h-full w-full max-w-full" aria-hidden="true" />;
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">{label}</span>
      {children}
      {hint ? <span className="mt-2 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function CustomLabelPreviewCard({ label, preset, direction, showBarcode }) {
  const scale = 4.4;

  return (
    <div
      className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_18px_35px_-24px_rgba(15,23,42,0.5)]"
      style={{
        width: `${preset.widthMm * scale}px`,
        height: `${preset.heightMm * scale}px`,
      }}
    >
      <div
        className={`flex h-full flex-col gap-[4px] p-[7px] ${showBarcode ? "" : "justify-center"}`}
        dir={direction}
      >
        <div className="overflow-hidden">
          <div
            className="overflow-hidden text-[11px] font-bold leading-[1.05] text-slate-950"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {label.title || " "}
          </div>
          {label.subtitle ? (
            <div
              className="mt-[2px] overflow-hidden text-[8px] leading-[1.05] text-slate-700"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {label.subtitle}
            </div>
          ) : null}
        </div>

        {showBarcode && label.code ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <BarcodeSvg value={label.code} />
          </div>
        ) : null}

        {label.code ? (
          <div className="truncate text-center text-[13px] font-black tracking-[0.12em] text-slate-950" dir="ltr">
            {label.code}
          </div>
        ) : null}

        {label.footerLines.length > 0 ? (
          <div className="overflow-hidden text-center text-[7px] leading-[1.08] text-slate-700">
            {label.footerLines.map((line, index) => (
              <div key={`${line}-${index}`} className="truncate">
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomLabelCreatorModal({ open, onClose }) {
  const { isRTL, select } = useLocale();
  const savedDraft = useMemo(() => readSavedDraft(), []);
  const [title, setTitle] = useState(savedDraft.title);
  const [subtitle, setSubtitle] = useState(savedDraft.subtitle);
  const [code, setCode] = useState(savedDraft.code);
  const [showBarcode, setShowBarcode] = useState(savedDraft.showBarcode);
  const [footerLine1, setFooterLine1] = useState(savedDraft.footerLine1);
  const [footerLine2, setFooterLine2] = useState(savedDraft.footerLine2);
  const [copies, setCopies] = useState(savedDraft.copies);
  const [presetId, setPresetId] = useState(savedDraft.presetId);
  const [printError, setPrintError] = useState("");

  const selectedPreset = useMemo(
    () => getBarcodeLabelPresetById(presetId),
    [presetId],
  );

  const previewLabel = useMemo(
    () => ({
      title: String(title || "").trim(),
      subtitle: String(subtitle || "").trim(),
      code: String(code || "").trim(),
      footerLines: [footerLine1, footerLine2]
        .map((line) => String(line || "").trim())
        .filter(Boolean),
    }),
    [code, footerLine1, footerLine2, subtitle, title],
  );

  const hasPrintableContent = useMemo(
    () => hasPrintableLabelContent(previewLabel, { allowTextOnly: true }),
    [previewLabel],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setPrintError("");
  }, [open]);

  useEffect(() => {
    writeSavedDraft({
      title,
      subtitle,
      code,
      showBarcode,
      footerLine1,
      footerLine2,
      copies,
      presetId,
    });
  }, [code, copies, footerLine1, footerLine2, presetId, showBarcode, subtitle, title]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const handlePrint = () => {
    if (!hasPrintableContent) {
      setPrintError(
        select(
          "اكتب عنوانًا أو نصًا أو كودًا قبل الطباعة.",
          "Enter a title, text, or code before printing.",
        ),
      );
      return;
    }

    if (showBarcode && !previewLabel.code) {
      setPrintError(
        select(
          "لازم تدخل كود لو عايز يظهر باركود على الليبل.",
          "Enter a code if you want the label to include a barcode.",
        ),
      );
      return;
    }

    try {
      const barcodeSvgMarkup =
        showBarcode && previewLabel.code
          ? createBarcodeSvgMarkup(previewLabel.code)
          : "";
      const printWindow = window.open("", "_blank", "width=960,height=720");

      if (!printWindow) {
        setPrintError(
          select(
            "المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم حاول مرة ثانية.",
            "The browser blocked the print window. Allow pop-ups and try again.",
          ),
        );
        return;
      }

      const printHtml = buildBarcodeLabelPrintHtml({
        label: {
          ...previewLabel,
          barcodeSvgMarkup,
          codeSourceLabel: previewLabel.code ? select("كود مخصص", "Custom code") : "",
        },
        preset: selectedPreset,
        copies,
        direction: isRTL ? "rtl" : "ltr",
      });

      printWindow.document.open();
      printWindow.document.write(printHtml);
      printWindow.document.close();
      onClose();
    } catch (error) {
      setPrintError(
        error?.message ||
          select(
            "حدث خطأ أثناء تجهيز الليبل المخصص.",
            "Failed to prepare the custom label.",
          ),
      );
    }
  };

  return (
    <div
      className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="app-modal-panel max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-[30px]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5 sm:px-7">
          <div>
            <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
              <FileText size={14} />
              {select("ليبل مخصص", "Custom label")}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              {select("إنشاء ليبل حر للطباعة", "Create a custom printable label")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {select(
                "تقدر تكتب نص فقط، أو نص مع كود، أو كود يتحول لباركود. مناسب للعروض، الرفوف، أو أي استخدام سريع.",
                "You can print text only, text with a code, or a code rendered as a barcode. Useful for promos, shelf tags, or quick custom labels.",
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="app-button-secondary flex h-11 w-11 items-center justify-center rounded-2xl text-slate-500"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(94vh-160px)] overflow-y-auto px-6 py-6 sm:px-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={select("العنوان الرئيسي", "Main title")}
                  hint={select(
                    "مثال: خصم 20% أو رف الأحذية أو اسم القسم.",
                    "Example: 20% off, shoes shelf, or section name.",
                  )}
                >
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                    placeholder={select("اكتب عنوان الليبل", "Type the label title")}
                  />
                </Field>

                <Field
                  label={select("سطر فرعي", "Subtitle")}
                  hint={select(
                    "اختياري لشرح إضافي تحت العنوان.",
                    "Optional extra context below the title.",
                  )}
                >
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(event) => setSubtitle(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                    placeholder={select("مثال: صف A أو المقاس الكبير", "Example: Row A or Large size")}
                  />
                </Field>

                <Field
                  label={select("الكود أو النص المختصر", "Code or short value")}
                  hint={select(
                    "لو فعّلت الباركود، نفس القيمة دي هتتحول إلى باركود.",
                    "If barcode mode is enabled, this same value is rendered as a barcode.",
                  )}
                >
                  <input
                    type="text"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                    placeholder={select("مثال: SALE-20 أو 123456789", "Example: SALE-20 or 123456789")}
                  />
                </Field>

                <Field
                  label={select("مقاس الليبل", "Label size")}
                  hint={select(
                    "المقاسات هنا بالمليمتر ومناسبة للطباعة الدقيقة.",
                    "These sizes are stored in millimeters for accurate printing.",
                  )}
                >
                  <select
                    value={selectedPreset.id}
                    onChange={(event) => setPresetId(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                  >
                    {BARCODE_LABEL_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.widthMm} x {preset.heightMm} mm
                        {preset.recommended
                          ? ` | ${select("الافتراضي", "Default")}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label={select("سطر إضافي 1", "Extra line 1")}
                  hint={select(
                    "مناسب للبراند أو الفرع أو أي ملاحظة خفيفة.",
                    "Useful for brand, branch, or a light note.",
                  )}
                >
                  <input
                    type="text"
                    value={footerLine1}
                    onChange={(event) => setFooterLine1(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                    placeholder="Moon Profit"
                  />
                </Field>

                <Field
                  label={select("سطر إضافي 2", "Extra line 2")}
                  hint={select(
                    "مثال: الموقع أو الهاتف أو ملاحظة قصيرة.",
                    "Example: website, phone, or a short note.",
                  )}
                >
                  <input
                    type="text"
                    value={footerLine2}
                    onChange={(event) => setFooterLine2(event.target.value)}
                    className="app-input px-4 py-3 text-sm"
                    placeholder={select("موقع أو هاتف أو وصف", "Website, phone, or note")}
                  />
                </Field>

                <Field
                  label={select("عدد النسخ", "Copies")}
                  hint={select(
                    "كل نسخة تطبع كليبل منفصل.",
                    "Each copy is printed as a separate label.",
                  )}
                >
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={copies}
                    onChange={(event) => setCopies(normalizeLabelCopies(event.target.value))}
                    className="app-input px-4 py-3 text-sm"
                  />
                </Field>

                <Field
                  label={select("شكل الطباعة", "Print style")}
                  hint={select(
                    "فعّل الباركود لو الكود لازم يظهر كأشرطة قابلة للمسح.",
                    "Enable barcode if the code should be rendered as scannable bars.",
                  )}
                >
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={showBarcode}
                      onChange={(event) => setShowBarcode(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>{select("حوّل الكود إلى باركود", "Render the code as a barcode")}</span>
                  </label>
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="app-note rounded-[22px] px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <FileText size={14} />
                    {select("نوع الليبل", "Label type")}
                  </div>
                  <div className="mt-3 text-lg font-semibold text-slate-950">
                    {showBarcode
                      ? select("نص + باركود", "Text + barcode")
                      : select("نص حر", "Free text")}
                  </div>
                </div>

                <div className="app-note rounded-[22px] px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <Ruler size={14} />
                    {select("المقاس", "Size")}
                  </div>
                  <div className="mt-3 text-lg font-semibold text-slate-950">
                    {selectedPreset.widthMm} x {selectedPreset.heightMm} mm
                  </div>
                </div>

                <div className="app-note rounded-[22px] px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <Settings2 size={14} />
                    {select("عدد الليبلات", "Labels queued")}
                  </div>
                  <div className="mt-3 text-lg font-semibold text-slate-950">{copies}</div>
                </div>
              </div>

              <div className="rounded-[24px] border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-900">
                {select(
                  "ده جزء إضافي فوق طباعة المنتجات الجاهزة. يعني تقدر تعمل ليبل احترافي لأي نص أو ملاحظة أو كود يدوي وتطبعه فورًا.",
                  "This sits above the existing product-label workflow, so you can print a professional label for any custom text, note, or manual code instantly.",
                )}
              </div>

              {printError ? (
                <div className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {printError}
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {select("معاينة الليبل", "Label preview")}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {select(
                    "المعاينة تقريبية، لكن الطباعة الفعلية هتطلع بنفس المقاس بالمليمتر.",
                    "The preview is approximate, but the real print uses the exact millimeter size.",
                  )}
                </p>
              </div>

              <div className="flex justify-center rounded-[28px] border border-slate-200 bg-slate-50/90 px-4 py-5">
                {hasPrintableContent ? (
                  <CustomLabelPreviewCard
                    label={previewLabel}
                    preset={selectedPreset}
                    direction={isRTL ? "rtl" : "ltr"}
                    showBarcode={showBarcode}
                  />
                ) : (
                  <div className="flex min-h-[220px] items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
                    {select(
                      "ابدأ اكتب عنوان أو كود أو ملاحظة علشان تظهر المعاينة هنا.",
                      "Start typing a title, code, or note to preview the label here.",
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <div className="app-note rounded-[22px] px-4 py-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <ScanLine size={14} />
                    {select("القيمة الحالية", "Current value")}
                  </div>
                  <div className="mt-3 break-all text-lg font-semibold text-slate-950" dir="ltr">
                    {previewLabel.code || "-"}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200/80 bg-slate-50/70 px-6 py-5 sm:flex-row sm:justify-end sm:px-7">
          <button
            onClick={onClose}
            className="app-button-secondary rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700"
          >
            {select("إغلاق", "Close")}
          </button>
          <button
            onClick={handlePrint}
            disabled={!hasPrintableContent}
            className="app-button-primary flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} />
            {select("طباعة الليبل المخصص", "Print custom label")}
          </button>
        </div>
      </div>
    </div>
  );
}
