import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getNestedLocaleValue } from "../i18n/appStrings";
import {
  formatCurrency as formatCurrencyValue,
  formatDate as formatDateValue,
  formatDateTime as formatDateTimeValue,
  formatNumber as formatNumberValue,
  formatPercent as formatPercentValue,
  formatRelativeTime as formatRelativeTimeValue,
  formatTime as formatTimeValue,
  getCurrencyLabel,
  resolveLanguageTag,
} from "../utils/localeFormat";
import { decodeMaybeMojibake } from "../utils/text";

const LOCALE_STORAGE_KEY = "moon_profit_locale";

const LocaleContext = createContext(null);

const getInitialLocale = () => {
  if (typeof window === "undefined") {
    return "ar";
  }

  const cachedLocale = String(localStorage.getItem(LOCALE_STORAGE_KEY) || "")
    .trim()
    .toLowerCase();
  if (cachedLocale === "ar" || cachedLocale === "en") {
    return cachedLocale;
  }

  const browserLanguage = String(
    window.navigator?.language || window.navigator?.languages?.[0] || "",
  )
    .trim()
    .toLowerCase();

  return browserLanguage.startsWith("ar") ? "ar" : "en";
};

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    }

    const root = document.documentElement;
    const direction = locale === "ar" ? "rtl" : "ltr";

    root.lang = locale;
    root.dir = direction;
    document.body.dir = direction;
    document.body.dataset.locale = locale;
  }, [locale]);

  const value = useMemo(() => {
    const isArabic = locale === "ar";
    const direction = isArabic ? "rtl" : "ltr";
    const languageTag = resolveLanguageTag(locale);

    return {
      locale,
      direction,
      languageTag,
      currencyLabel: getCurrencyLabel(locale),
      isArabic,
      isRTL: isArabic,
      setLocale: (nextLocale) => {
        const normalized = String(nextLocale || "").trim().toLowerCase();
        setLocaleState(normalized === "ar" ? "ar" : "en");
      },
      toggleLocale: () => {
        setLocaleState((current) => (current === "ar" ? "en" : "ar"));
      },
      t: (key, fallback = "") => {
        const resolved = getNestedLocaleValue(locale, key);
        return decodeMaybeMojibake(resolved === undefined ? fallback : resolved);
      },
      select: (arabicValue, englishValue) =>
        decodeMaybeMojibake(isArabic ? arabicValue : englishValue),
      formatNumber: (value, options = {}) =>
        formatNumberValue(value, options, locale),
      formatCurrency: (value, options = {}) =>
        formatCurrencyValue(value, options, locale),
      formatPercent: (value, options = {}) =>
        formatPercentValue(value, options, locale),
      formatDateTime: (value, options = {}) =>
        formatDateTimeValue(value, options, locale),
      formatDate: (value, options = {}) =>
        formatDateValue(value, options, locale),
      formatTime: (value, options = {}) =>
        formatTimeValue(value, options, locale),
      formatRelativeTime: (value, options = {}) =>
        formatRelativeTimeValue(value, options, locale),
    };
  }, [locale]);

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);

  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }

  return context;
}
