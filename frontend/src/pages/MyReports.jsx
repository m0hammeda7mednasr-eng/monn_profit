import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  Edit,
  Paperclip,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import api, { getErrorMessage } from "../utils/api";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { formatDate, formatNumber } from "../utils/localeFormat";

const DEFAULT_FORM = {
  title: "",
  description: "",
  tasks_completed: "",
  notes: "",
  report_date: new Date().toISOString().split("T")[0],
};

const POLLING_INTERVAL_MS = 30000;
const MIN_REPORTS_FETCH_GAP_MS = 5000;

let reportsFetchInFlight = false;
let lastReportsFetchAt = 0;

const getAttachmentUrl = (file) => file?.url || file?.file_url || "";
const getAttachmentName = (file) =>
  file?.fileName || file?.file_name || file?.name || "attachment";
const normalizeAttachment = (file) => ({
  fileName: getAttachmentName(file),
  url: getAttachmentUrl(file),
  storagePath: file?.storagePath || file?.storage_path || null,
  size: Number(file?.size ?? file?.size_bytes ?? 0) || 0,
  mimeType: file?.mimeType || file?.mime_type || file?.type || "",
});
const normalizeAttachments = (attachments) =>
  Array.isArray(attachments)
    ? attachments
        .map((file) => normalizeAttachment(file))
        .filter((file) => Boolean(file.url))
    : [];

const getStatusLabel = (status, locale) => {
  const normalized = String(status || "submitted").trim().toLowerCase();
  const dictionary = {
    submitted: { ar: "مرسل", en: "Submitted" },
    draft: { ar: "مسودة", en: "Draft" },
    approved: { ar: "معتمد", en: "Approved" },
    rejected: { ar: "مرفوض", en: "Rejected" },
  };

  return (
    dictionary[normalized]?.[locale === "ar" ? "ar" : "en"] ||
    String(status || "submitted")
  );
};

export default function MyReports() {
  const { locale, isRTL, select } = useLocale();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingReport, setEditingReport] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [message, setMessage] = useState({ type: "", text: "" });

  const fetchReports = useCallback(async ({ silent = false } = {}) => {
    if (reportsFetchInFlight) {
      return;
    }

    const now = Date.now();
    if (now - lastReportsFetchAt < MIN_REPORTS_FETCH_GAP_MS) {
      return;
    }

    try {
      reportsFetchInFlight = true;
      lastReportsFetchAt = now;

      if (!silent) {
        setLoading(true);
      }

      const response = await api.get("/daily-reports/my-reports");
      setReports(extractArray(response.data));
    } catch (error) {
      if (!silent) {
        setMessage({ type: "error", text: getErrorMessage(error) });
      }
    } finally {
      reportsFetchInFlight = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchReports();

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      fetchReports({ silent: true });
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchReports({ silent: true });
    });

    const onFocus = () => fetchReports({ silent: true });
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchReports]);

  const resetForm = () => {
    setFormData(DEFAULT_FORM);
    setExistingAttachments([]);
    setNewFiles([]);
    setEditingReport(null);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (report) => {
    setEditingReport(report);
    setFormData({
      title: report.title || "",
      description: report.description || "",
      tasks_completed: report.tasks_completed || "",
      notes: report.notes || "",
      report_date: report.report_date
        ? report.report_date.split("T")[0]
        : DEFAULT_FORM.report_date,
    });
    setExistingAttachments(normalizeAttachments(report.attachments));
    setNewFiles([]);
    setShowModal(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      const payload = new FormData();
      payload.append("title", formData.title);
      payload.append("description", formData.description);
      payload.append("tasks_completed", formData.tasks_completed);
      payload.append("notes", formData.notes);
      payload.append("report_date", formData.report_date);
      payload.append(
        "existing_attachments",
        JSON.stringify(normalizeAttachments(existingAttachments)),
      );

      newFiles.forEach((file) => payload.append("files", file));

      if (editingReport) {
        await api.put(`/daily-reports/${editingReport.id}`, payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setMessage({
          type: "success",
          text: select("تم تحديث التقرير بنجاح", "Report updated successfully"),
        });
      } else {
        await api.post("/daily-reports", payload, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setMessage({
          type: "success",
          text: select("تم إرسال التقرير بنجاح", "Report submitted successfully"),
        });
      }

      closeModal();
      await fetchReports();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (
      !window.confirm(
        select(
          "هل أنت متأكد من حذف التقرير؟",
          "Are you sure you want to delete this report?",
        ),
      )
    ) {
      return;
    }

    try {
      await api.delete(`/daily-reports/${reportId}`);
      setMessage({
        type: "success",
        text: select("تم حذف التقرير بنجاح", "Report deleted successfully"),
      });
      await fetchReports();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const removeExistingAttachment = (index) => {
    setExistingAttachments((prev) => prev.filter((_, idx) => idx !== index));
  };

  const removeNewFile = (index) => {
    setNewFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 p-8">
          {select("جاري التحميل...", "Loading...")}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className={isRTL ? "text-right" : "text-left"}>
              <h1 className="text-3xl font-bold text-slate-900">
                {select("تقاريري اليومية", "My Daily Reports")}
              </h1>
              <p className="mt-1 text-slate-600">
                {select(
                  "سجّل إنجازاتك وأرفق الملفات المطلوبة",
                  "Record your progress and attach the required files.",
                )}
              </p>
            </div>
            <button
              onClick={openCreateModal}
              className="flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2 text-white hover:bg-sky-800"
            >
              <Plus size={18} />
              {select("تقرير جديد", "New Report")}
            </button>
          </div>

          {message.text && (
            <div
              className={`rounded-lg px-4 py-3 ${
                message.type === "error"
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.length === 0 ? (
              <div className="col-span-full rounded-xl bg-white py-12 text-center text-slate-500 shadow">
                {select("لا توجد تقارير بعد", "No reports yet")}
              </div>
            ) : (
              reports.map((report) => (
                <div
                  key={report.id}
                  className="space-y-3 rounded-xl bg-white p-4 shadow"
                >
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={14} />
                      {formatDate(report.report_date || report.created_at)}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
                      {getStatusLabel(report.status, locale)}
                    </span>
                  </div>

                  <h3 className="font-bold text-slate-900">{report.title}</h3>
                  {report.description && (
                    <p className="line-clamp-2 text-sm text-slate-600">
                      {report.description}
                    </p>
                  )}

                  {Array.isArray(report.attachments) &&
                    report.attachments.length > 0 && (
                      <div className="border-t pt-2">
                        <p className="flex items-center gap-1 text-xs font-medium text-slate-700">
                          <Paperclip size={12} />
                          {select("المرفقات", "Attachments")} (
                          {formatNumber(report.attachments.length, {
                            maximumFractionDigits: 0,
                          })})
                        </p>
                        <div className="mt-1 space-y-1">
                          {normalizeAttachments(report.attachments)
                            .slice(0, 3)
                            .map((file, index) => (
                              <a
                                key={`${report.id}-${index}`}
                                href={getAttachmentUrl(file)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block text-xs text-sky-700 hover:text-sky-900"
                              >
                                {getAttachmentName(file)}
                              </a>
                            ))}
                        </div>
                      </div>
                    )}

                  <div className="flex gap-2 border-t pt-3">
                    <button
                      onClick={() => openEditModal(report)}
                      className="flex flex-1 items-center justify-center gap-1 rounded bg-sky-50 py-2 text-sky-700 hover:bg-sky-100"
                    >
                      <Edit size={14} />
                      {select("تعديل", "Edit")}
                    </button>
                    <button
                      onClick={() => handleDeleteReport(report.id)}
                      className="flex flex-1 items-center justify-center gap-1 rounded bg-red-50 py-2 text-red-700 hover:bg-red-100"
                    >
                      <Trash2 size={14} />
                      {select("حذف", "Delete")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingReport
                  ? select("تعديل التقرير", "Edit Report")
                  : select("تقرير يومي جديد", "New Daily Report")}
              </h2>
              <button onClick={closeModal} className="text-slate-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label={select("التاريخ", "Date")}>
                <input
                  type="date"
                  value={formData.report_date}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      report_date: event.target.value,
                    }))
                  }
                  required
                  className="w-full rounded-lg border px-3 py-2"
                />
              </Field>

              <Field label={select("العنوان", "Title")}>
                <input
                  value={formData.title}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      title: event.target.value,
                    }))
                  }
                  required
                  className="w-full rounded-lg border px-3 py-2"
                />
              </Field>

              <Field label={select("الوصف", "Description")}>
                <textarea
                  value={formData.description}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2"
                />
              </Field>

              <Field label={select("المهام المنجزة", "Completed Tasks")}>
                <textarea
                  value={formData.tasks_completed}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      tasks_completed: event.target.value,
                    }))
                  }
                  rows={4}
                  className="w-full rounded-lg border px-3 py-2"
                />
              </Field>

              <Field label={select("ملاحظات", "Notes")}>
                <textarea
                  value={formData.notes}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2"
                />
              </Field>

              <div className="space-y-3">
                <label className="block text-sm font-medium">
                  {select("مرفقات التقرير", "Report Attachments")}
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"
                  onChange={(event) =>
                    setNewFiles(Array.from(event.target.files || []))
                  }
                  className="w-full rounded-lg border px-3 py-2"
                />

                {existingAttachments.length > 0 && (
                  <AttachmentGroup
                    title={select("المرفقات الحالية", "Current Attachments")}
                    items={existingAttachments}
                    onRemove={removeExistingAttachment}
                    getName={getAttachmentName}
                  />
                )}

                {newFiles.length > 0 && (
                  <AttachmentGroup
                    title={select("ملفات جديدة", "New Files")}
                    items={newFiles}
                    onRemove={removeNewFile}
                    getName={(file) => file.name}
                  />
                )}
              </div>

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-white hover:bg-emerald-700"
              >
                <Save size={18} />
                {select("حفظ", "Save")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function AttachmentGroup({ title, items, onRemove, getName }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{title}</p>
      <div className="space-y-1">
        {items.map((item, index) => (
          <div
            key={`${title}-${index}`}
            className="flex items-center justify-between rounded bg-slate-50 px-3 py-2"
          >
            <span className="text-sm">{getName(item)}</span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="text-red-600 hover:text-red-800"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
