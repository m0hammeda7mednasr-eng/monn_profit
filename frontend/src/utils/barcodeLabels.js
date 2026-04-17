const DEFAULT_VARIANT_TITLES = new Set([
  "default title",
  "default",
  "default variant",
]);

export const BARCODE_LABEL_PRESETS = [
  {
    id: "50x30",
    widthMm: 50,
    heightMm: 30,
    recommended: true,
  },
  {
    id: "50x25",
    widthMm: 50,
    heightMm: 25,
    recommended: false,
  },
  {
    id: "38x25",
    widthMm: 38,
    heightMm: 25,
    recommended: false,
  },
  {
    id: "40x30",
    widthMm: 40,
    heightMm: 30,
    recommended: false,
  },
  {
    id: "58x40",
    widthMm: 58,
    heightMm: 40,
    recommended: false,
  },
  {
    id: "70x50",
    widthMm: 70,
    heightMm: 50,
    recommended: false,
  },
];

export const DEFAULT_BARCODE_LABEL_PRESET_ID = BARCODE_LABEL_PRESETS[0].id;

export const normalizeBarcodeVariantTitle = (value, productTitle = "") => {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  const normalizedLowercaseValue = normalizedValue.toLowerCase();
  if (DEFAULT_VARIANT_TITLES.has(normalizedLowercaseValue)) {
    return "";
  }

  const normalizedProductTitle = String(productTitle || "")
    .trim()
    .toLowerCase();
  if (
    normalizedProductTitle &&
    normalizedLowercaseValue === normalizedProductTitle
  ) {
    return "";
  }

  return normalizedValue;
};

export const normalizeLabelCopies = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(200, Math.max(1, parsed));
};

export const getBarcodeLabelPresetById = (presetId) =>
  BARCODE_LABEL_PRESETS.find((preset) => preset.id === presetId) ||
  BARCODE_LABEL_PRESETS[0];

export const resolveBarcodeLabelValue = (
  target = {},
  preferredSource = "auto",
) => {
  const barcode = String(target?.barcode || "").trim();
  const sku = String(target?.sku || "").trim();

  if (preferredSource === "barcode" && barcode) {
    return { source: "barcode", value: barcode };
  }

  if (preferredSource === "sku" && sku) {
    return { source: "sku", value: sku };
  }

  if (barcode) {
    return { source: "barcode", value: barcode };
  }

  if (sku) {
    return { source: "sku", value: sku };
  }

  return { source: "", value: "" };
};

export const hasPrintableBarcodeValue = (target = {}) =>
  Boolean(resolveBarcodeLabelValue(target, "auto").value);

export const hasPrintableLabelContent = (
  label = {},
  { allowTextOnly = false } = {},
) => {
  const textValues = [
    label?.title,
    label?.subtitle,
    label?.code,
    label?.vendor,
    ...(Array.isArray(label?.footerLines) ? label.footerLines : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (allowTextOnly) {
    return textValues.length > 0;
  }

  return hasPrintableBarcodeValue(label);
};

export const getBarcodeModuleWidth = (value) => {
  const length = String(value || "").trim().length;

  if (length <= 8) {
    return 2.6;
  }

  if (length <= 12) {
    return 2.1;
  }

  if (length <= 18) {
    return 1.6;
  }

  return 1.25;
};

export const getBarcodeRenderOptions = (value) => ({
  format: "CODE128",
  displayValue: false,
  margin: 0,
  width: getBarcodeModuleWidth(value),
  height: 54,
  background: "#ffffff",
  lineColor: "#111111",
});

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getLabelLayoutProfile = (preset, codeValue = "") => {
  const resolvedPreset = getBarcodeLabelPresetById(preset?.id);
  const codeLength = String(codeValue || "").trim().length;
  const isCompactLabel = resolvedPreset.heightMm <= 25;
  const isLongCode = codeLength > 18;
  const isVeryLongCode = codeLength > 24;

  return {
    paddingMm: isCompactLabel ? "1.1mm" : "1.5mm",
    gapMm: isCompactLabel ? "0.45mm" : "0.7mm",
    titleMaxHeight: isCompactLabel
      ? "4.8mm"
      : resolvedPreset.heightMm >= 40
        ? "8.4mm"
        : "6.8mm",
    titleFontSize: isCompactLabel
      ? "2.45mm"
      : resolvedPreset.heightMm >= 40
        ? "3.4mm"
        : "3.05mm",
    subtitleMaxHeight: isCompactLabel ? "3.2mm" : "4.8mm",
    subtitleFontSize: isCompactLabel ? "1.85mm" : "2.35mm",
    barcodeMaxHeight: isCompactLabel
      ? "8.4mm"
      : resolvedPreset.heightMm >= 40
        ? "18mm"
        : "14mm",
    codeFontSize: isCompactLabel
      ? isVeryLongCode
        ? "2mm"
        : isLongCode
          ? "2.2mm"
          : "2.55mm"
      : resolvedPreset.heightMm >= 40
        ? isVeryLongCode
          ? "3.1mm"
          : isLongCode
            ? "3.45mm"
            : "4.1mm"
        : isVeryLongCode
          ? "2.55mm"
          : isLongCode
            ? "2.9mm"
            : "3.7mm",
    codeLetterSpacing: isCompactLabel
      ? isLongCode
        ? "0.03mm"
        : "0.07mm"
      : isLongCode
        ? "0.07mm"
        : "0.15mm",
    metaFontSize: isCompactLabel ? "1.45mm" : "2mm",
    footerFontSize: isCompactLabel ? "1.55mm" : "2.1mm",
  };
};

export const buildBarcodeLabelPrintHtml = ({
  label,
  preset,
  copies,
  direction = "ltr",
}) => {
  const safeLabel = label || {};
  const safePreset = getBarcodeLabelPresetById(preset?.id);
  const layout = getLabelLayoutProfile(safePreset, safeLabel.code);
  const normalizedCopies = normalizeLabelCopies(copies);
  const footerLines = Array.isArray(safeLabel.footerLines)
    ? safeLabel.footerLines
        .map((line) => String(line || "").trim())
        .filter(Boolean)
    : [];
  const hasBarcodeMarkup = Boolean(
    String(safeLabel.barcodeSvgMarkup || "").trim(),
  );
  const hasCodeText = Boolean(String(safeLabel.code || "").trim());

  const metaMarkup =
    safeLabel.vendor || safeLabel.codeSourceLabel
      ? `
        <div class="label-meta">
          <span>${escapeHtml(safeLabel.vendor || "")}</span>
          <span>${escapeHtml(safeLabel.codeSourceLabel || "")}</span>
        </div>
      `
      : "";
  const footerMarkup =
    footerLines.length > 0
      ? `
        <div class="label-footer">
          ${footerLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
        </div>
      `
      : "";

  const pageMarkup = `
    <section class="label-page">
      <article class="label-card" dir="${direction}">
        <div class="label-body ${hasBarcodeMarkup ? "label-body--barcode" : "label-body--text"}">
          <div class="label-header">
            <div class="label-title">${escapeHtml(safeLabel.title || "")}</div>
            ${
              safeLabel.subtitle
                ? `<div class="label-subtitle">${escapeHtml(safeLabel.subtitle)}</div>`
                : ""
            }
          </div>
          ${
            hasBarcodeMarkup
              ? `<div class="label-barcode">${safeLabel.barcodeSvgMarkup || ""}</div>`
              : ""
          }
          ${
            hasCodeText
              ? `<div class="label-code" dir="ltr">${escapeHtml(safeLabel.code || "")}</div>`
              : ""
          }
          ${metaMarkup}
        </div>
        ${footerMarkup}
      </article>
    </section>
  `;

  return `<!doctype html>
<html lang="en" dir="${direction}">
  <head>
    <meta charset="utf-8" />
    <title>Barcode Label Print</title>
    <style>
      @page {
        size: ${safePreset.widthMm}mm ${safePreset.heightMm}mm landscape;
        margin: 0;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: ${safePreset.widthMm}mm;
        background: #ffffff;
        color: #111111;
        font-family: "Segoe UI", Tahoma, Arial, sans-serif;
      }

      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        transform-origin: top left;
      }

      .label-page {
        width: ${safePreset.widthMm}mm;
        height: ${safePreset.heightMm}mm;
        overflow: hidden;
        break-after: page;
        page-break-after: always;
      }

      .label-page:last-child {
        break-after: auto;
        page-break-after: auto;
      }

      .label-card {
        display: flex;
        flex-direction: column;
        gap: ${layout.gapMm};
        width: 100%;
        height: 100%;
        padding: ${layout.paddingMm};
      }

      .label-body {
        display: flex;
        min-height: 0;
        flex: 1 1 auto;
        flex-direction: column;
        gap: ${layout.gapMm};
      }

      .label-body--text {
        justify-content: center;
      }

      .label-header {
        overflow: hidden;
      }

      .label-title {
        max-height: ${layout.titleMaxHeight};
        overflow: hidden;
        font-size: ${layout.titleFontSize};
        font-weight: 700;
        line-height: 1.05;
      }

      .label-subtitle {
        margin-top: 0.25mm;
        max-height: ${layout.subtitleMaxHeight};
        overflow: hidden;
        font-size: ${layout.subtitleFontSize};
        line-height: 1.05;
      }

      .label-barcode {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .label-barcode svg {
        display: block;
        width: 100%;
        max-height: ${layout.barcodeMaxHeight};
      }

      .label-code {
        overflow: hidden;
        white-space: nowrap;
        text-align: center;
        font-size: ${layout.codeFontSize};
        font-weight: 700;
        letter-spacing: ${layout.codeLetterSpacing};
        line-height: 1;
      }

      .label-meta {
        display: flex;
        justify-content: space-between;
        gap: 2mm;
        overflow: hidden;
        font-size: ${layout.metaFontSize};
        line-height: 1.05;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #4b5563;
      }

      .label-meta span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .label-footer {
        overflow: hidden;
        text-align: center;
        font-size: ${layout.footerFontSize};
        line-height: 1.08;
      }

      .label-footer div {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media print {
        @page {
          size: ${safePreset.widthMm}mm ${safePreset.heightMm}mm landscape;
          margin: 0;
        }
        
        body {
          width: ${safePreset.widthMm}mm;
          height: ${safePreset.heightMm}mm;
        }
      }
    </style>
  </head>
  <body>
    ${Array.from({ length: normalizedCopies }, () => pageMarkup).join("")}
    <script>
      window.addEventListener("load", function () {
        window.setTimeout(function () {
          window.focus();
          window.print();
        }, 120);
      });

      window.addEventListener("afterprint", function () {
        window.close();
      });
    </script>
  </body>
</html>`;
};
