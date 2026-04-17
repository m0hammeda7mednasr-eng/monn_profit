import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  Paperclip,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import api, { getErrorMessage } from "../utils/api";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { formatDate, formatNumber, formatPercent } from "../utils/localeFormat";

const RANGE_OPTIONS = [
  { label: "7 Days", value: 7 },
  { label: "30 Days", value: 30 },
  { label: "90 Days", value: 90 },
];

const POLLING_INTERVAL_MS = 120000;
const LATEST_REPORTS_LIMIT = 30;
let reportsAnalyticsEndpointUnsupported = false;
let analyticsRequestInFlight = false;

const LEVEL_META = {
  high: {
    label: "Excellent",
    className: "bg-emerald-100 text-emerald-700",
  },
  good: {
    label: "Good",
    className: "bg-sky-100 text-sky-700",
  },
  average: {
    label: "Average",
    className: "bg-amber-100 text-amber-700",
  },
  needs_attention: {
    label: "Needs Attention",
    className: "bg-rose-100 text-rose-700",
  },
};

const getAttachmentUrl = (file) => file?.url || file?.file_url || "";
const getAttachmentName = (file) =>
  file?.fileName || file?.file_name || file?.name || "attachment";
const normalizeAttachments = (attachments) =>
  Array.isArray(attachments)
    ? attachments.filter((file) => Boolean(getAttachmentUrl(file)))
    : [];

export default function Reports() {
  const { select } = useLocale();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [reports, setReports] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [analyticsApiAvailable, setAnalyticsApiAvailable] = useState(
    !reportsAnalyticsEndpointUnsupported,
  );

  const fetchReportsData = useCallback(async (selectedDays, { silent = false } = {}) => {
    if (analyticsRequestInFlight && silent) {
      return;
    }

    try {
      analyticsRequestInFlight = true;
      if (!silent) {
        setLoading(true);
        setMessage({ type: "", text: "" });
      }

      const requests = [
        api.get("/daily-reports/all", {
          params: {
            limit: LATEST_REPORTS_LIMIT,
          },
        }),
      ];
      if (analyticsApiAvailable && !reportsAnalyticsEndpointUnsupported) {
        requests.push(api.get(`/daily-reports/analytics?days=${selectedDays}`));
      }

      const results = await Promise.allSettled(requests);
      const reportsResult = results[0];
      const analyticsResult = results[1];

      if (reportsResult.status === "fulfilled") {
        setReports(extractArray(reportsResult.value.data));
      } else {
        setReports([]);
      }

      if (!analyticsApiAvailable) {
        setAnalytics(null);
      } else if (analyticsResult?.status === "fulfilled") {
        setAnalytics(analyticsResult.value.data || null);
      } else if (analyticsResult?.status === "rejected") {
        if (analyticsResult.reason?.response?.status === 404) {
          reportsAnalyticsEndpointUnsupported = true;
          setAnalyticsApiAvailable(false);
          setAnalytics(null);
        } else if (!silent) {
          setMessage({ type: "error", text: getErrorMessage(analyticsResult.reason) });
        }
      }

      if (reportsResult.status === "rejected" && !silent) {
        setMessage({ type: "error", text: getErrorMessage(reportsResult.reason) });
      }
    } catch (error) {
      if (!silent) {
        setMessage({ type: "error", text: getErrorMessage(error) });
      }
    } finally {
      analyticsRequestInFlight = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, [analyticsApiAvailable]);

  useEffect(() => {
    fetchReportsData(days);

    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      fetchReportsData(days, { silent: true });
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchReportsData(days, { silent: true });
    });

    const onFocus = () => {
      fetchReportsData(days, { silent: true });
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [days, fetchReportsData]);

  const cards = useMemo(() => {
    if (analytics?.summary) {
      return {
        reportsCount: analytics.summary.total_reports || 0,
        usersCount: analytics.summary.active_employees || 0,
        attachmentsCount: analytics.summary.total_attachments || 0,
        onTimeRate: analytics.summary.on_time_rate || 0,
      };
    }

    const uniqueUsers = new Set(reports.map((item) => item.user_id));
    const attachmentsCount = reports.reduce(
      (sum, item) =>
        sum + (Array.isArray(item.attachments) ? item.attachments.length : 0),
      0,
    );
    return {
      reportsCount: reports.length,
      usersCount: uniqueUsers.size,
      attachmentsCount,
      onTimeRate: 0,
    };
  }, [analytics, reports]);

  const submissionTrend = analytics?.flow?.submission_trend || [];
  const employeePerformance = analytics?.flow?.employee_performance || [];

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 p-8">
          {select("\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u0642\u0627\u0631\u064a\u0631...", "Loading reports...")}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              {select("\u062a\u0642\u0627\u0631\u064a\u0631 \u0627\u0644\u0645\u0648\u0638\u0641\u064a\u0646", "Employee Reports")}
            </h1>
            <p className="text-slate-600 mt-1">
              {select(
                "\u0627\u0644\u062a\u0633\u0644\u064a\u0645\u0627\u062a \u0627\u0644\u064a\u0648\u0645\u064a\u0629\u060c \u0645\u062a\u0627\u0628\u0639\u0629 \u0627\u0644\u0627\u0646\u0636\u0628\u0627\u0637\u060c \u0648\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0645\u0631\u0641\u0642\u0627\u062a",
                "Daily submissions, discipline tracking, and attachment review",
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">
              {select("\u0627\u0644\u0645\u062f\u0649", "Range")}
            </span>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10))}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {message.text && (
          <div
            className={`px-4 py-3 rounded-lg ${
              message.type === "error"
                ? "bg-red-50 border border-red-200 text-red-700"
                : "bg-emerald-50 border border-emerald-200 text-emerald-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard
            icon={FileText}
            title="Total Reports"
            value={formatNumber(cards.reportsCount, {
              maximumFractionDigits: 0,
            })}
            subtitle={`Last ${days} days`}
          />
          <StatCard
            icon={Users}
            title="Active Employees"
            value={formatNumber(cards.usersCount, {
              maximumFractionDigits: 0,
            })}
            subtitle="Submitted at least once"
          />
          <StatCard
            icon={Paperclip}
            title="Total Attachments"
            value={formatNumber(cards.attachmentsCount, {
              maximumFractionDigits: 0,
            })}
            subtitle="Uploaded files"
          />
          <StatCard
            icon={TrendingUp}
            title="On-time Rate"
            value={formatPercent(cards.onTimeRate, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            subtitle="Delivery discipline"
          />
        </div>

        <div className="bg-white rounded-xl shadow p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Submission Flow</h2>
              <p className="text-sm text-slate-500">
                On-time vs late submissions by day
              </p>
            </div>
            <div className="text-sm text-slate-500">
              {analytics?.range?.start_date} to {analytics?.range?.end_date}
            </div>
          </div>

          {submissionTrend.length === 0 ? (
            <div className="text-slate-500 text-sm py-8 text-center">
              No trend data in the selected range
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={submissionTrend}>
                  <defs>
                    <linearGradient id="submittedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="onTimeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => value.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="submitted"
                    stroke="#0ea5e9"
                    fill="url(#submittedGradient)"
                    strokeWidth={2}
                    name="Submitted"
                  />
                  <Area
                    type="monotone"
                    dataKey="on_time"
                    stroke="#10b981"
                    fill="url(#onTimeGradient)"
                    strokeWidth={2}
                    name="On Time"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80">
            <h2 className="text-xl font-semibold text-slate-900">
              Employee Discipline Ranking
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Employee
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Reports
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    On Time
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Submission
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Score
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Attachments
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                    Last Report
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employeePerformance.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-slate-500">
                      No employee performance data available
                    </td>
                  </tr>
                ) : (
                  employeePerformance.map((employee, index) => {
                    const meta =
                      LEVEL_META[employee.discipline_level] || LEVEL_META.needs_attention;
                    const rowKey =
                      employee.user_id || employee.email || `${employee.name || "employee"}-${index}`;
                    return (
                      <tr key={rowKey} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-3 text-sm min-w-[220px]">
                          <p className="font-medium text-slate-800">{employee.name}</p>
                          <p className="text-slate-500">{employee.email}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatNumber(employee.reports_count, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatPercent(employee.on_time_rate, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatPercent(employee.submission_rate, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                          {formatNumber(employee.discipline_score, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${meta.className}`}
                          >
                            {employee.discipline_level === "needs_attention" && (
                              <AlertTriangle size={12} className="mr-1" />
                            )}
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatNumber(employee.attachments_count, {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {employee.last_report_date || "-"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80">
            <h2 className="text-xl font-semibold text-slate-900">Latest Submitted Reports</h2>
          </div>
          <table className="data-table w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                  Employee
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                  Title
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">
                  Attachments
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-10 text-slate-500">
                    No reports available
                  </td>
                </tr>
              ) : (
                reports.map((report) => (
                  <tr key={report.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium">{report.users?.name || "-"}</p>
                      <p className="text-slate-500">{report.users?.email || "-"}</p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <p className="font-medium">{report.title}</p>
                      {report.description && (
                        <p className="text-slate-500 mt-1 line-clamp-2">
                          {report.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={14} />
                        {formatDate(report.report_date || report.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {normalizeAttachments(report.attachments).length > 0 ? (
                        <div className="space-y-1">
                          {normalizeAttachments(report.attachments).map((file, idx) => (
                            <a
                              key={`${report.id}-file-${idx}`}
                              href={getAttachmentUrl(file)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-700 hover:text-sky-900 block"
                            >
                              {getAttachmentName(file)}
                            </a>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">No files</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, title, value, subtitle }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-slate-500 text-sm">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle ? <p className="text-xs text-slate-500 mt-1">{subtitle}</p> : null}
        </div>
        <Icon className="text-sky-700" size={26} />
      </div>
    </div>
  );
}
