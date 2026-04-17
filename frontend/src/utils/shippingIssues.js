export const DEFAULT_SHIPPING_ISSUE_REASON = "issue";

const SHIPPING_ISSUE_REASON_OPTIONS = [
  {
    value: "confirm_return",
    ar: "\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0631\u062c\u0648\u0639",
    en: "Confirm return",
  },
  {
    value: "part_with_phone",
    ar: "\u0642\u0637\u0639\u0629 \u0645\u0639 \u0627\u0644\u0647\u0627\u062a\u0641",
    en: "Part with phone",
  },
  {
    value: "delivered",
    ar: "\u062a\u0645 \u0627\u0644\u062a\u0633\u0644\u064a\u0645",
    en: "Delivered",
  },
  {
    value: "cancel",
    ar: "\u0625\u0644\u063a\u0627\u0621",
    en: "Cancel",
  },
  {
    value: DEFAULT_SHIPPING_ISSUE_REASON,
    ar: "\u0645\u0634\u0643\u0644\u0629",
    en: "Issue",
  },
  {
    value: "part",
    ar: "\u0642\u0637\u0639\u0629",
    en: "Part",
  },
  {
    value: "return_with_phone",
    ar: "\u0631\u062c\u0648\u0639 \u0645\u0639 \u0627\u0644\u0647\u0627\u062a\u0641",
    en: "Return with phone",
  },
];

const SHIPPING_ISSUE_REASON_SET = new Set(
  SHIPPING_ISSUE_REASON_OPTIONS.map((option) => option.value),
);
const SHIPPING_ISSUE_CLOSED_REASON_SET = new Set(["delivered", "cancel"]);
const SHIPPING_ISSUE_PHONE_REQUIRED_REASON_SET = new Set([
  "part_with_phone",
  "return_with_phone",
]);

export const normalizeShippingIssueReason = (
  value,
  fallback = DEFAULT_SHIPPING_ISSUE_REASON,
) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

  return SHIPPING_ISSUE_REASON_SET.has(normalized) ? normalized : fallback;
};

export const getShippingIssueReasonOptions = (select) =>
  SHIPPING_ISSUE_REASON_OPTIONS.map((option) => ({
    value: option.value,
    label: select(option.ar, option.en),
  }));

export const getShippingIssueReasonLabel = (reason, select) => {
  const normalized = normalizeShippingIssueReason(reason);
  const option =
    SHIPPING_ISSUE_REASON_OPTIONS.find((entry) => entry.value === normalized) ||
    SHIPPING_ISSUE_REASON_OPTIONS.find(
      (entry) => entry.value === DEFAULT_SHIPPING_ISSUE_REASON,
    ) ||
    SHIPPING_ISSUE_REASON_OPTIONS[0];

  return select(option.ar, option.en);
};

export const isShippingIssueActive = (order) =>
  Boolean(order?.shipping_issue || order?.shipping_issue_reason);

export const isShippingIssueClosed = (reason) =>
  SHIPPING_ISSUE_CLOSED_REASON_SET.has(normalizeShippingIssueReason(reason));

export const isShippingIssuePhoneRequired = (reason) =>
  SHIPPING_ISSUE_PHONE_REQUIRED_REASON_SET.has(
    normalizeShippingIssueReason(reason),
  );

export const getShippingIssueBadgeClassName = (reason) => {
  switch (normalizeShippingIssueReason(reason)) {
    case "cancel":
      return "bg-rose-100 text-rose-800 border border-rose-200";
    case "delivered":
      return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    case "part":
    case "part_with_phone":
      return "bg-sky-100 text-sky-800 border border-sky-200";
    case "confirm_return":
    case "return_with_phone":
      return "bg-violet-100 text-violet-800 border border-violet-200";
    case "issue":
      return "bg-amber-100 text-amber-800 border border-amber-200";
    default:
      return "bg-slate-100 text-slate-800 border border-slate-200";
  }
};
