import { useState, useEffect, useCallback } from "react";
import api from "../utils/api";
import Sidebar from "../components/Sidebar";
import { Clock, User, List } from "lucide-react";
import { EmptyState, ErrorAlert, LoadingSpinner } from "../components/Common";
import { useLocale } from "../context/LocaleContext";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";

const POLLING_INTERVAL_MS = 30000;

export default function ActivityLog() {
  const { select, formatDateTime } = useLocale();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [filters, setFilters] = useState({ entity_type: "" });

  const fetchLogs = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }

        const response = await api.get("/activity-log", { params: filters });
        setLogs(extractArray(response.data));
      } catch (err) {
        if (!silent) {
          console.error("Error fetching activity log:", err);
          setMessage({
            type: "error",
            text: err.response?.data?.error || "Failed to load activity log",
          });
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    fetchLogs();

    const interval = setInterval(() => {
      fetchLogs({ silent: true });
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchLogs({ silent: true });
    });

    const onFocus = () => fetchLogs({ silent: true });
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchLogs]);

  const handleFilterChange = (e) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 sm:p-8 space-y-6">
          <div className="app-toolbar rounded-[30px] px-6 py-6 sm:px-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                  <List size={14} />
                  {select("سجل النظام", "System Timeline")}
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-slate-900">
                  {select("سجل النشاط", "Activity Log")}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  {select(
                    "راجع تغييرات النظام على المنتجات والطلبات والعملاء بشكل أوضح ومنظم.",
                    "Review system-wide changes across products, orders, and customers in a clearer timeline.",
                  )}
                </p>
              </div>
            </div>
          </div>

          {message.text ? (
            <ErrorAlert
              message={message.text}
              onClose={() => setMessage({ type: "", text: "" })}
            />
          ) : null}

          <div className="app-surface rounded-[28px] p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("فلترة السجل", "Filter Timeline")}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {select(
                    "اختَر نوع الكيان لعرض التغييرات الخاصة به فقط.",
                    "Choose an entity type to focus on a specific stream of activity.",
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <List size={18} />
                </div>
                <select
                  name="entity_type"
                  value={filters.entity_type}
                  onChange={handleFilterChange}
                  className="app-input min-w-[220px] px-4 py-2.5 text-sm"
                >
                  <option value="">{select("كل الكيانات", "All entities")}</option>
                  <option value="product">{select("المنتجات", "Product")}</option>
                  <option value="order">{select("الطلبات", "Order")}</option>
                  <option value="customer">{select("العملاء", "Customer")}</option>
                  <option value="operational_cost">
                    {select("التكاليف التشغيلية", "Operational Cost")}
                  </option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner label={select("جاري تحميل سجل النشاط...", "Loading activity log...")} />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Clock}
              title={select("لا توجد سجلات مطابقة", "No matching records")}
              message={select(
                "لم يتم العثور على أي سجل يطابق الفلتر الحالي.",
                "No activity records match the current filter.",
              )}
            />
          ) : (
            <div className="app-table-shell rounded-[30px]">
              <div className="border-b border-slate-100 bg-slate-50/90 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  {select("آخر التغييرات", "Latest Changes")}
                </h2>
              </div>

              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[920px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {select("التاريخ", "Date")}
                      </th>
                      <th className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {select("المستخدم", "User")}
                      </th>
                      <th className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {select("الإجراء", "Action")}
                      </th>
                      <th className="px-6 py-4 text-sm font-semibold text-slate-700">
                        {select("التفاصيل", "Details")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-6 py-4 text-sm text-slate-500">
                          {formatDateTime(log.created_at, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                              <User size={16} />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">
                                {log.user?.name || log.user?.email}
                              </p>
                              <p className="text-xs text-slate-400">{log.user_id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`app-chip inline-flex px-2.5 py-1 text-xs font-semibold ${
                              log.action === "product_update"
                                ? "bg-sky-50 text-sky-800"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          <p>
                            <strong className="font-semibold text-slate-900">
                              {log.entity_type}:
                            </strong>{" "}
                            {log.entity_name || log.entity_id}
                          </p>
                          {log.details ? (
                            <pre className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-6 text-slate-600">
                              {JSON.stringify(log.details, null, 2)}
                            </pre>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
