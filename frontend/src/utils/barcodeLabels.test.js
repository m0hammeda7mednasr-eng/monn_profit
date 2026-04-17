import {
  buildBarcodeLabelPrintHtml,
  getBarcodeLabelPresetById,
  hasPrintableLabelContent,
  normalizeBarcodeVariantTitle,
  normalizeLabelCopies,
  resolveBarcodeLabelValue,
} from "./barcodeLabels";

describe("barcodeLabels", () => {
  test("normalizeBarcodeVariantTitle hides default titles", () => {
    expect(normalizeBarcodeVariantTitle("Default Title", "Basic Tee")).toBe("");
    expect(normalizeBarcodeVariantTitle("Basic Tee", "Basic Tee")).toBe("");
    expect(normalizeBarcodeVariantTitle("Black / XL", "Basic Tee")).toBe("Black / XL");
  });

  test("resolveBarcodeLabelValue prioritizes barcode for auto mode", () => {
    expect(
      resolveBarcodeLabelValue(
        {
          sku: "SKU-001",
          barcode: "6221234567890",
        },
        "auto",
      ),
    ).toEqual({
      source: "barcode",
      value: "6221234567890",
    });
  });

  test("normalizeLabelCopies clamps invalid values", () => {
    expect(normalizeLabelCopies("0")).toBe(1);
    expect(normalizeLabelCopies("12")).toBe(12);
    expect(normalizeLabelCopies("999")).toBe(200);
  });

  test("getBarcodeLabelPresetById resolves the new 50x25 preset", () => {
    expect(getBarcodeLabelPresetById("50x25")).toMatchObject({
      id: "50x25",
      widthMm: 50,
      heightMm: 25,
    });
  });

  test("getBarcodeLabelPresetById resolves the new 38x25 preset", () => {
    expect(getBarcodeLabelPresetById("38x25")).toMatchObject({
      id: "38x25",
      widthMm: 38,
      heightMm: 25,
    });
  });

  test("hasPrintableLabelContent allows text-only custom labels when requested", () => {
    expect(
      hasPrintableLabelContent(
        {
          title: "Custom Promo",
          subtitle: "",
          code: "",
          footerLines: [],
        },
        { allowTextOnly: true },
      ),
    ).toBe(true);

    expect(
      hasPrintableLabelContent(
        {
          title: "",
          subtitle: "",
          code: "",
          footerLines: [],
        },
        { allowTextOnly: true },
      ),
    ).toBe(false);
  });

  test("buildBarcodeLabelPrintHtml injects page size and escapes text", () => {
    const html = buildBarcodeLabelPrintHtml({
      label: {
        title: "Dress <Main>",
        subtitle: "Black / XL",
        code: "ARV19964478",
        codeSourceLabel: "SKU",
        vendor: "Moon Profit",
        footerLines: ["moon-profit.example", "01022393911"],
        barcodeSvgMarkup: "<svg></svg>",
      },
      preset: getBarcodeLabelPresetById("50x30"),
      copies: 2,
      direction: "rtl",
    });

    expect(html).toContain("@page");
    expect(html).toContain("size: 50mm 30mm landscape;");
    expect(html).toContain("Dress &lt;Main&gt;");
    expect(html.match(/class="label-page"/g)).toHaveLength(2);
  });

  test("buildBarcodeLabelPrintHtml supports text-only labels without barcode markup", () => {
    const html = buildBarcodeLabelPrintHtml({
      label: {
        title: "Custom Text Only",
        subtitle: "Shelf label",
        footerLines: ["Moon Profit"],
        barcodeSvgMarkup: "",
        code: "",
      },
      preset: getBarcodeLabelPresetById("40x30"),
      copies: 1,
      direction: "ltr",
    });

    expect(html).toContain("Custom Text Only");
    expect(html).not.toContain('class="label-barcode"');
    expect(html).not.toContain('class="label-code"');
  });
});
