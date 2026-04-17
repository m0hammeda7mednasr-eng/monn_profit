const escapeCsvCell = (value) => {
  const normalized = String(value ?? "");
  const escaped = normalized.replace(/"/g, '""');
  return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

const buildCsvContent = ({ headers = [], rows = [] }) =>
  [
    ...(headers.length > 0
      ? [headers.map((header) => escapeCsvCell(header)).join(",")]
      : []),
    ...rows.map((row) => row.map((value) => escapeCsvCell(value)).join(",")),
  ].join("\r\n");

const triggerCsvDownload = ({ filename, content }) => {
  const csvContent = `\uFEFF${content}`;
  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(blobUrl);
};

export const buildCsvFilename = (prefix = "export") => {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ];

  return `${String(prefix || "export").trim() || "export"}-${parts.join("")}.csv`;
};

export const downloadCsvFile = ({ filename, headers = [], rows = [] }) => {
  triggerCsvDownload({
    filename,
    content: buildCsvContent({ headers, rows }),
  });
};

export const downloadCsvSections = ({ filename, sections = [] }) => {
  const normalizedSections = Array.isArray(sections) ? sections : [];
  const content = normalizedSections
    .filter(
      (section) =>
        section &&
        (String(section.title || "").trim() ||
          (Array.isArray(section.headers) && section.headers.length > 0) ||
          (Array.isArray(section.rows) && section.rows.length > 0)),
    )
    .map((section) => {
      const lines = [];
      const title = String(section.title || "").trim();

      if (title) {
        lines.push(escapeCsvCell(title));
      }

      const body = buildCsvContent({
        headers: Array.isArray(section.headers) ? section.headers : [],
        rows: Array.isArray(section.rows) ? section.rows : [],
      });

      if (body) {
        lines.push(body);
      }

      return lines.join("\r\n");
    })
    .filter(Boolean)
    .join("\r\n\r\n");

  triggerCsvDownload({ filename, content });
};
