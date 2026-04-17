import { Languages } from "lucide-react";
import { useLocale } from "../context/LocaleContext";

export default function LanguageToggle({ className = "" }) {
  const { locale, setLocale, t } = useLocale();

  return (
    <div
      className={`app-surface inline-flex items-center gap-2 rounded-2xl px-2 py-2 ${className}`.trim()}
      aria-label={t("language.switcherLabel", "Interface language")}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100/90 text-slate-600">
        <Languages size={16} />
      </div>
      <div className="inline-flex items-center rounded-xl bg-slate-100/90 p-1">
        <ToggleButton
          label="AR"
          title={t("language.arabic", "Arabic")}
          isActive={locale === "ar"}
          onClick={() => setLocale("ar")}
        />
        <ToggleButton
          label="EN"
          title={t("language.english", "English")}
          isActive={locale === "en"}
          onClick={() => setLocale("en")}
        />
      </div>
    </div>
  );
}

function ToggleButton({ label, title, isActive, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        isActive
          ? "bg-sky-700 text-white shadow-[0_10px_24px_-16px_rgba(2,132,199,0.8)]"
          : "text-slate-600 hover:bg-white hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );
}
