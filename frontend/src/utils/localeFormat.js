const LOCALE_TO_LANGUAGE_TAG = {
  ar: "ar-EG",
  en: "en-US",
};

const LOCALE_TO_CURRENCY_LABEL = {
  ar: "ج.م.",
  en: "EGP",
};

const DEFAULT_LOCALE = "en";
const DEFAULT_LANGUAGE_TAG = LOCALE_TO_LANGUAGE_TAG[DEFAULT_LOCALE];

const toSafeNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const toDate = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const normalizeLocale = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ar" || normalized.startsWith("ar-")) {
    return "ar";
  }
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }
  return DEFAULT_LOCALE;
};

export const resolveLocale = (value) => {
  if (value) {
    return normalizeLocale(value);
  }

  if (typeof document !== "undefined") {
    const bodyLocale = document.body?.dataset?.locale;
    const htmlLocale = document.documentElement?.lang;
    if (bodyLocale || htmlLocale) {
      return normalizeLocale(bodyLocale || htmlLocale);
    }
  }

  if (typeof navigator !== "undefined") {
    return normalizeLocale(navigator.language || navigator.languages?.[0]);
  }

  return DEFAULT_LOCALE;
};

export const resolveLanguageTag = (value) =>
  LOCALE_TO_LANGUAGE_TAG[resolveLocale(value)] || DEFAULT_LANGUAGE_TAG;

export const getCurrencyLabel = (value) =>
  LOCALE_TO_CURRENCY_LABEL[resolveLocale(value)] ||
  LOCALE_TO_CURRENCY_LABEL[DEFAULT_LOCALE];

export const formatNumber = (value, options = {}, locale) =>
  new Intl.NumberFormat(resolveLanguageTag(locale), options).format(
    toSafeNumber(value),
  );

export const formatCurrency = (value, options = {}, locale) => {
  const safeValue = toSafeNumber(value);
  const {
    currency = "EGP",
    currencyStyle = "label",
    currencyLabel,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    ...numberOptions
  } = options || {};

  if (currencyStyle === "intl") {
    try {
      return new Intl.NumberFormat(resolveLanguageTag(locale), {
        style: "currency",
        currency: currency || "EGP",
        minimumFractionDigits,
        maximumFractionDigits,
        ...numberOptions,
      }).format(safeValue);
    } catch {
      // Fallback to locale-aware label formatting below.
    }
  }

  const formattedNumber = formatNumber(
    safeValue,
    {
      minimumFractionDigits,
      maximumFractionDigits,
      ...numberOptions,
    },
    locale,
  );
  const normalizedLocale = resolveLocale(locale);
  const label = currencyLabel || getCurrencyLabel(normalizedLocale);

  return normalizedLocale === "ar"
    ? `${formattedNumber}\u00A0${label}`
    : `${label}\u00A0${formattedNumber}`;
};

export const formatPercent = (value, options = {}, locale) => {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    ...numberOptions
  } = options || {};

  return `${formatNumber(
    value,
    {
      minimumFractionDigits,
      maximumFractionDigits,
      ...numberOptions,
    },
    locale,
  )}%`;
};

export const formatDate = (value, options = {}, locale) => {
  const parsed = toDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleDateString(resolveLanguageTag(locale), options);
};

export const formatDateTime = (value, options = {}, locale) => {
  const parsed = toDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleString(resolveLanguageTag(locale), options);
};

export const formatTime = (value, options = {}, locale) => {
  const parsed = toDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleTimeString(resolveLanguageTag(locale), options);
};

export const formatRelativeTime = (value, options = {}, locale) => {
  const parsed = toDate(value);
  if (!parsed) {
    return "-";
  }

  const { style = "short", numeric = "auto" } = options || {};
  const languageTag = resolveLanguageTag(locale);
  const formatter = new Intl.RelativeTimeFormat(languageTag, {
    style,
    numeric,
  });
  const diffInSeconds = Math.round((parsed.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(diffInSeconds);

  if (absSeconds < 60) {
    return formatter.format(diffInSeconds, "second");
  }
  if (absSeconds < 3600) {
    return formatter.format(Math.round(diffInSeconds / 60), "minute");
  }
  if (absSeconds < 86400) {
    return formatter.format(Math.round(diffInSeconds / 3600), "hour");
  }
  if (absSeconds < 2592000) {
    return formatter.format(Math.round(diffInSeconds / 86400), "day");
  }

  return formatDateTime(
    parsed,
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    languageTag,
  );
};
