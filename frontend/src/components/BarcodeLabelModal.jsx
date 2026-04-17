import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Printer, Ruler, ScanLine, Settings2, X } from "lucide-react";
import { useLocale } from "../context/LocaleContext";
import {
  BARCODE_LABEL_PRESETS,
  DEFAULT_BARCODE_LABEL_PRESET_ID,
  buildBarcodeLabelPrintHtml,
  getBarcodeLabelPresetById,
  getBarcodeRenderOptions,
  normalizeLabelCopies,
  resolveBarcodeLabelValue,
} from "../utils/barcodeLabels";

const BARCODE_SETTINGS_STORAGE_KEY = "moon_profit_barcode_label_settings_v1";

const readSavedSettings = () => {
  if (typeof window === "undefined") {
    return {
      presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
      copies: 1,
      codePreference: "auto",
      footerLine1: "Moon Profit",
      footerLine2: "",
    };
  }

  try {
    const rawValue = window.localStorage.getItem(BARCODE_SETTINGS_STORAGE_KEY);
    if (!rawValue) {
      return {
        presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
        copies: 1,
        codePreference: "auto",
        footerLine1: "Moon Profit",
        footerLine2: "",
      };
    }

    const parsedValue = JSON.parse(rawValue);
    return {
      presetId: String(
        parsedValue?.presetId || DEFAULT_BARCODE_LABEL_PRESET_ID,
      ),
      copies: normalizeLabelCopies(parsedValue?.copies),
      codePreference:
        parsedValue?.codePreference === "barcode" ||
        parsedValue?.codePreference === "sku"
          ? parsedValue.codePreference
          : "auto",
      footerLine1: String(parsedValue?.footerLine1 || "Moon Profit"),
      footerLine2: String(parsedValue?.footerLine2 || ""),
    };
  } catch {
    return {
      presetId: DEFAULT_BARCODE_LABEL_PRESET_ID,
      copies: 1,
      codePreference: "auto",
      footerLine1: "Moon Profit",
      footerLine2: "",
    };
  }
};

const writeSavedSettings = (settings) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    BARCODE_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      presetId: settings.presetId,
      copies: normalizeLabelCopies(settings.copies),
      codePreference: settings.codePreference,
      footerLine1: String(settings.footerLine1 || "").trim(),
      footerLine2: String(settings.footerLine2 || "").trim(),
    }),
  );
};

const readCustomFooterLines = () => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(
      "barcode-label-custom-footer-lines",
    );
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const writeCustomFooterLines = (customLines) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      "barcode-label-custom-footer-lines",
      JSON.stringify(customLines),
    );
  } catch {
    // Ignore storage errors
  }
};

const createBarcodeSvgMarkup = (value) => {
  const svgElement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
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
    } catch (error) {
      setRenderError(
        select(
          "تعذر توليد الباركود لهذا الكود",
          "Unable to render this barcode value",
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

  return (
    <svg ref={svgRef} className="h-full w-full max-w-full" aria-hidden="true" />
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-800">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-2 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

function LabelPreviewCard({ label, preset, direction }) {
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
        className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto_auto_auto] gap-[4px] p-[7px]"
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
            {label.title}
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

        <div className="min-h-0 overflow-hidden">
          <BarcodeSvg value={label.code} />
        </div>

        <div
          className="truncate text-center text-[13px] font-black tracking-[0.12em] text-slate-950"
          dir="ltr"
        >
          {label.code}
        </div>

        {(label.vendor || label.codeSourceLabel) && (
          <div className="flex items-center justify-between gap-2 overflow-hidden text-[7px] uppercase tracking-[0.14em] text-slate-500">
            <span className="truncate">{label.vendor}</span>
            <span className="truncate">{label.codeSourceLabel}</span>
          </div>
        )}

        {label.footerLines.length > 0 ? (
          <div className="overflow-hidden text-center text-[7px] leading-[1.08] text-slate-700">
            {label.footerLines.map((line, index) => (
              <div key={`${line}-${index}`} className="truncate">
                {line}
              </div>
            ))}
          </div>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}

export default function BarcodeLabelModal({
  open,
  onClose,
  targets,
  defaultTargetKey = "",
}) {
  const { isRTL, select } = useLocale();
  const savedSettings = useMemo(() => readSavedSettings(), []);
  const savedCustomFooterLines = useMemo(() => readCustomFooterLines(), []);
  const [selectedTargetKey, setSelectedTargetKey] = useState(defaultTargetKey);
  const [presetId, setPresetId] = useState(savedSettings.presetId);
  const [copies, setCopies] = useState(savedSettings.copies);
  const [codePreference, setCodePreference] = useState(
    savedSettings.codePreference,
  );
  const [customFooterLines, setCustomFooterLines] = useState(
    savedCustomFooterLines,
  );
  const [printError, setPrintError] = useState("");

  const normalizedTargets = useMemo(
    () =>
      (Array.isArray(targets) ? targets : [])
        .map((target, index) => ({
          key: String(target?.key || target?.id || `label-target-${index}`),
          title: String(target?.title || "").trim(),
          subtitle: String(target?.subtitle || "").trim(),
          sku: String(target?.sku || "").trim(),
          barcode: String(target?.barcode || "").trim(),
          vendor: String(target?.vendor || "").trim(),
          supplierCode: String(target?.supplier_code || "").trim(),
          supplierName: String(target?.supplier_name || "").trim(),
        }))
        .filter((target) => target.title),
    [targets],
  );

  const selectedPreset = useMemo(
    () => getBarcodeLabelPresetById(presetId),
    [presetId],
  );

  const selectedTarget = useMemo(
    () =>
      normalizedTargets.find((target) => target.key === selectedTargetKey) ||
      normalizedTargets[0] ||
      null,
    [normalizedTargets, selectedTargetKey],
  );

  const resolvedCode = useMemo(
    () => resolveBarcodeLabelValue(selectedTarget, codePreference),
    [codePreference, selectedTarget],
  );

  // Get custom footer lines for the current target, with SKU as default for line 1
  const currentFooterLines = useMemo(() => {
    if (!selectedTarget)
      return {
        line1: savedSettings.footerLine1,
        line2: savedSettings.footerLine2,
      };

    const targetKey = selectedTarget.key;
    const customLines = customFooterLines[targetKey];

    return {
      line1:
        customLines?.line1 ||
        selectedTarget.supplierCode ||
        selectedTarget.sku ||
        savedSettings.footerLine1,
      line2:
        customLines?.line2 ||
        (selectedTarget.supplierCode ? selectedTarget.sku : "") ||
        savedSettings.footerLine2,
    };
  }, [
    selectedTarget,
    customFooterLines,
    savedSettings.footerLine1,
    savedSettings.footerLine2,
  ]);

  const previewLabel = useMemo(
    () => ({
      title: selectedTarget?.title || "",
      subtitle: selectedTarget?.subtitle || "",
      vendor: selectedTarget?.vendor || "",
      supplierCode: selectedTarget?.supplierCode || "",
      supplierName: selectedTarget?.supplierName || "",
      code: resolvedCode.value,
      codeSourceLabel:
        resolvedCode.source === "barcode"
          ? select("باركود", "Barcode")
          : resolvedCode.source === "sku"
            ? "SKU"
            : "",
      footerLines: [currentFooterLines.line1, currentFooterLines.line2]
        .map((line) => String(line || "").trim())
        .filter(Boolean),
    }),
    [
      currentFooterLines.line1,
      currentFooterLines.line2,
      resolvedCode.source,
      resolvedCode.value,
      select,
      selectedTarget,
    ],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setPrintError("");
    setSelectedTargetKey((currentValue) => {
      if (
        defaultTargetKey &&
        normalizedTargets.some((target) => target.key === defaultTargetKey)
      ) {
        return defaultTargetKey;
      }

      if (normalizedTargets.some((target) => target.key === currentValue)) {
        return currentValue;
      }

      return String(normalizedTargets[0]?.key || "");
    });
  }, [defaultTargetKey, normalizedTargets, open]);

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

  useEffect(() => {
    writeSavedSettings({
      presetId,
      copies,
      codePreference,
      footerLine1: savedSettings.footerLine1,
      footerLine2: savedSettings.footerLine2,
    });
  }, [
    codePreference,
    copies,
    presetId,
    savedSettings.footerLine1,
    savedSettings.footerLine2,
  ]);

  // Save custom footer lines when they change
  useEffect(() => {
    writeCustomFooterLines(customFooterLines);
  }, [customFooterLines]);

  // Functions to update custom footer lines for current target
  const updateCurrentFooterLine1 = (value) => {
    if (!selectedTarget) return;

    setCustomFooterLines((prev) => ({
      ...prev,
      [selectedTarget.key]: {
        ...prev[selectedTarget.key],
        line1: value,
      },
    }));
  };

  const updateCurrentFooterLine2 = (value) => {
    if (!selectedTarget) return;

    setCustomFooterLines((prev) => ({
      ...prev,
      [selectedTarget.key]: {
        ...prev[selectedTarget.key],
        line2: value,
      },
    }));
  };

  // Function to copy all current SKUs to Extra line 1 for all targets
  const copyAllSKUsToExtraLine = () => {
    let updatedCount = 0;
    const updates = {};

    normalizedTargets.forEach((target) => {
      if (target.sku && target.key) {
        // Only update if there's no existing custom line 1
        if (!customFooterLines[target.key]?.line1) {
          updates[target.key] = {
            ...customFooterLines[target.key],
            line1: target.sku,
          };
          updatedCount++;
        }
      }
    });

    if (updatedCount > 0) {
      setCustomFooterLines((prev) => ({
        ...prev,
        ...updates,
      }));
      // Use console.log instead of alert to avoid console errors
      console.log(
        `✅ تم نسخ ${updatedCount} SKU إلى Extra line 1 - دلوقتي تقدر تغير الـ SKUs والـ Extra line 1 مش هيتأثر`,
      );
    } else {
      console.log("ℹ️ كل المنتجات عندها Extra line 1 محفوظ بالفعل");
    }
  };

  if (!open) {
    return null;
  }

  const canChooseCodeSource = Boolean(
    selectedTarget?.barcode && selectedTarget?.sku,
  );
  const hasPrintableValue = Boolean(previewLabel.code);
  const printableTargetsCount = normalizedTargets.filter(
    (target) => resolveBarcodeLabelValue(target, "auto").value,
  ).length;

  const handlePrint = () => {
    if (!selectedTarget || !hasPrintableValue) {
      setPrintError(
        select(
          "اختَر منتجًا يحتوي على SKU أو باركود قبل الطباعة.",
          "Choose a target with a SKU or barcode before printing.",
        ),
      );
      return;
    }

    try {
      const barcodeSvgMarkup = createBarcodeSvgMarkup(previewLabel.code);
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
            "حدث خطأ أثناء تجهيز ليبل الطباعة.",
            "Failed to prepare the print label.",
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
              <Printer size={14} />
              {select("طباعة ليبل", "Label printer")}
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">
              {select(
                "طباعة باركود بمقاس ثابت",
                "Print barcode labels at an exact size",
              )}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {select(
                "المقاس الافتراضي 50x30 مم مناسب لمعظم رول XP-370B، وتقدر تغيّره وتحفظه محليًا.",
                "The default 50x30 mm preset works well for most XP-370B rolls, and your settings stay saved locally.",
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
          {normalizedTargets.length === 0 || printableTargetsCount === 0 ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-5 text-sm text-amber-900">
              {select(
                "لا يوجد SKU أو باركود متاح لهذا المنتج حاليًا، لذلك لا يمكن تجهيز الليبل.",
                "This item does not currently have a SKU or barcode, so a label cannot be prepared yet.",
              )}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  {normalizedTargets.length > 1 ? (
                    <Field
                      label={select("المنتج أو المتغير", "Product or variant")}
                      hint={select(
                        "اختَر المتغير اللي محتاج تطبع له ليبل الآن.",
                        "Choose the exact variant you want to print right now.",
                      )}
                    >
                      <select
                        value={selectedTarget?.key || ""}
                        onChange={(event) =>
                          setSelectedTargetKey(event.target.value)
                        }
                        className="app-input px-4 py-3 text-sm"
                      >
                        {normalizedTargets.map((target) => {
                          const targetCode = resolveBarcodeLabelValue(
                            target,
                            "auto",
                          ).value;
                          return (
                            <option key={target.key} value={target.key}>
                              {target.subtitle
                                ? `${target.title} | ${target.subtitle}`
                                : target.title}
                              {targetCode ? ` | ${targetCode}` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                  ) : (
                    <Field
                      label={select("الليبل الحالي", "Current label")}
                      hint={select(
                        "ده الهدف اللي هيتجهز منه الليبل مباشرة.",
                        "This is the target that will be used for the label.",
                      )}
                    >
                      <div className="app-note rounded-[22px] px-4 py-3 text-sm text-slate-700">
                        <div className="font-semibold text-slate-900">
                          {selectedTarget?.title}
                        </div>
                        {selectedTarget?.subtitle ? (
                          <div className="mt-1 text-xs text-slate-500">
                            {selectedTarget.subtitle}
                          </div>
                        ) : null}
                      </div>
                    </Field>
                  )}

                  <Field
                    label={select("مصدر الكود", "Code source")}
                    hint={select(
                      "لو المنتج عليه SKU وباركود معًا تقدر تحدد أي واحد منهم يطبع.",
                      "If both SKU and barcode exist, you can choose which one gets printed.",
                    )}
                  >
                    <select
                      value={
                        canChooseCodeSource
                          ? codePreference
                          : resolvedCode.source || "auto"
                      }
                      onChange={(event) =>
                        setCodePreference(event.target.value)
                      }
                      disabled={!canChooseCodeSource}
                      className="app-input px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="auto">{select("تلقائي", "Auto")}</option>
                      <option value="barcode">
                        {select("باركود", "Barcode")}
                      </option>
                      <option value="sku">SKU</option>
                    </select>
                  </Field>

                  <Field
                    label={select("مقاس الليبل", "Label size")}
                    hint={select(
                      "المقاسات محسوبة بالمليمتر لتقليل مشاكل التمدد أو التصغير وقت الطباعة.",
                      "Sizes are stored in millimeters to avoid browser scaling issues.",
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
                            ? ` | ${select("مناسب لـ XP-370B", "XP-370B default")}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label={select("عدد النسخ", "Copies")}
                    hint={select(
                      "كل نسخة ستخرج كليبل مستقل بنفس المقاس.",
                      "Each copy is printed as a separate label with the same size.",
                    )}
                  >
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={copies}
                      onChange={(event) =>
                        setCopies(normalizeLabelCopies(event.target.value))
                      }
                      className="app-input px-4 py-3 text-sm"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={select("سطر إضافي 1", "Extra line 1")}
                    hint={select(
                      "مثال: اسم البراند أو الفرع.",
                      "Example: brand or branch name.",
                    )}
                  >
                    <input
                      type="text"
                      value={currentFooterLines.line1}
                      onChange={(event) =>
                        updateCurrentFooterLine1(event.target.value)
                      }
                      className="app-input px-4 py-3 text-sm"
                      placeholder={selectedTarget?.sku || "Moon Profit"}
                    />
                  </Field>

                  <Field
                    label={select("سطر إضافي 2", "Extra line 2")}
                    hint={select(
                      "مثال: الموقع أو رقم التليفون.",
                      "Example: website or phone number.",
                    )}
                  >
                    <input
                      type="text"
                      value={currentFooterLines.line2}
                      onChange={(event) =>
                        updateCurrentFooterLine2(event.target.value)
                      }
                      className="app-input px-4 py-3 text-sm"
                      placeholder={select(
                        "الموقع أو الهاتف",
                        "Website or phone",
                      )}
                    />
                  </Field>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="app-note rounded-[22px] px-4 py-4">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <ScanLine size={14} />
                      {select("الكود الفعلي", "Active code")}
                    </div>
                    <div
                      className="mt-3 break-all text-lg font-semibold text-slate-950"
                      dir="ltr"
                    >
                      {previewLabel.code || "-"}
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
                    <div className="mt-3 text-lg font-semibold text-slate-950">
                      {copies}
                    </div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-sky-200 bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-900">
                  {select(
                    "لأفضل نتيجة في Chrome اختَر: Scale 100% و Margins None و عطّل Headers and footers. المقاسات نفسها هتتحط تلقائي داخل ملف الطباعة.",
                    "For the best Chrome result, use Scale 100%, Margins None, and disable Headers and footers. The exact page size is already embedded in the print document.",
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
                      "المعاينة تقريبية، لكن الطباعة نفسها ستستخدم نفس المقاس بالمليمتر.",
                      "The preview is approximate, but printing uses the exact same millimeter size.",
                    )}
                  </p>
                </div>

                <div className="flex justify-center rounded-[28px] border border-slate-200 bg-slate-50/90 px-4 py-5">
                  {hasPrintableValue ? (
                    <LabelPreviewCard
                      label={previewLabel}
                      preset={selectedPreset}
                      direction={isRTL ? "rtl" : "ltr"}
                    />
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-white px-6 text-center text-sm text-slate-500">
                      {select(
                        "الهدف الحالي لا يحتوي على SKU أو باركود صالح للطباعة.",
                        "The selected target does not have a printable SKU or barcode.",
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200/80 bg-slate-50/70 px-6 py-5 sm:flex-row sm:justify-between sm:px-7">
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="app-button-secondary rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700"
            >
              {select("إغلاق", "Close")}
            </button>
            {normalizedTargets.length > 1 && (
              <button
                onClick={copyAllSKUsToExtraLine}
                className="app-button-secondary rounded-2xl px-4 py-3 text-sm font-semibold text-orange-700 border-orange-200 bg-orange-50 hover:bg-orange-100"
              >
                {select("نسخ كل الـ SKUs", "Copy all SKUs")}
              </button>
            )}
          </div>
          <button
            onClick={handlePrint}
            disabled={!hasPrintableValue || printableTargetsCount === 0}
            className="app-button-primary flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Printer size={16} />
            {select("طباعة الليبل", "Print label")}
          </button>
        </div>
      </div>
    </div>
  );
}
