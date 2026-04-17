import React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Package,
  X,
} from "lucide-react";
import { useLocale } from "../context/LocaleContext";

export function LoadingSpinner({ label = "" }) {
  const { select } = useLocale();
  const message = label || select("جاري التحميل...", "Loading...");

  return (
    <div className="flex h-96 flex-col items-center justify-center gap-3 text-slate-500">
      <Loader2 className="animate-spin text-sky-600" size={40} />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
}

export function SkeletonBlock({
  className = "",
  roundedClassName = "rounded-xl",
}) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-slate-200/80 ${roundedClassName} ${className}`}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="app-surface rounded-[26px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-3.5 w-24" />
          <SkeletonBlock className="h-8 w-28" />
          <SkeletonBlock className="h-3 w-full max-w-[14rem]" />
        </div>
        <SkeletonBlock className="h-12 w-12 rounded-2xl" roundedClassName="" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }) {
  return (
    <div className="app-table-shell rounded-[30px]">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: columns }).map((_, index) => (
            <SkeletonBlock
              key={`table-header-${index}`}
              className="h-3 w-20"
            />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 px-5">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            key={`table-row-${rowIndex}`}
            className="grid grid-cols-1 gap-3 py-4 md:grid-cols-5"
          >
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <SkeletonBlock
                key={`table-cell-${rowIndex}-${columnIndex}`}
                className={`h-4 ${
                  columnIndex === 0
                    ? "w-24"
                    : columnIndex === columns - 1
                      ? "w-20"
                      : "w-full"
                }`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineAlert({
  message,
  onClose,
  icon: Icon,
  tone = "red",
  closeLabel,
}) {
  const toneClasses = {
    red: "border-rose-200 bg-rose-50 text-rose-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  const iconClasses = {
    red: "text-rose-600",
    green: "text-emerald-600",
  };

  return (
    <div
      className={`mb-6 flex items-start justify-between gap-3 rounded-2xl border p-4 shadow-sm ${
        toneClasses[tone] || toneClasses.red
      }`}
      role="alert"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Icon
          className={`mt-0.5 shrink-0 ${iconClasses[tone] || iconClasses.red}`}
          size={20}
        />
        <p className="text-sm font-medium leading-6">{message}</p>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className={`rounded-full p-1 transition hover:bg-white/70 ${
            iconClasses[tone] || iconClasses.red
          }`}
          aria-label={closeLabel}
        >
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function ErrorAlert({ message, onClose }) {
  const { select } = useLocale();

  return (
    <InlineAlert
      message={message}
      onClose={onClose}
      icon={AlertCircle}
      tone="red"
      closeLabel={select("إغلاق التنبيه", "Dismiss alert")}
    />
  );
}

export function SuccessAlert({ message, onClose }) {
  const { select } = useLocale();

  return (
    <InlineAlert
      message={message}
      onClose={onClose}
      icon={CheckCircle2}
      tone="green"
      closeLabel={select("إغلاق الرسالة", "Dismiss message")}
    />
  );
}

export function EmptyState({
  icon: Icon = Package,
  title,
  message = "",
}) {
  const { select } = useLocale();
  const resolvedTitle = title || select("لا توجد بيانات", "No data found");

  return (
    <div className="app-surface rounded-[28px] border-dashed border-slate-300 p-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon size={30} />
      </div>
      <p className="mb-2 text-base font-semibold text-slate-800">
        {resolvedTitle}
      </p>
      {message ? <p className="text-sm text-slate-500">{message}</p> : null}
    </div>
  );
}

export function Pagination({ page, totalPages, onPageChange }) {
  const { isRTL, select } = useLocale();
  const previousIcon = isRTL ? <ChevronRight size={16} /> : <ChevronLeft size={16} />;
  const nextIcon = isRTL ? <ChevronLeft size={16} /> : <ChevronRight size={16} />;

  return (
    <div className="app-surface mt-6 flex flex-col gap-3 rounded-[24px] p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-600">
        {select("الصفحة", "Page")} {page} {select("من", "of")} {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className="app-button-secondary inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {previousIcon}
          <span>{select("السابق", "Previous")}</span>
        </button>
        <button
          type="button"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          className="app-button-secondary inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{select("التالي", "Next")}</span>
          {nextIcon}
        </button>
      </div>
    </div>
  );
}
