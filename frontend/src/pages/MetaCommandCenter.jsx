import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  Film,
  FlaskConical,
  KeyRound,
  Megaphone,
  MessageSquare,
  PauseCircle,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { ErrorAlert, LoadingSpinner, SuccessAlert } from "../components/Common";
import { useLocale } from "../context/LocaleContext";
import { getErrorMessage, metaAnalyticsAPI } from "../utils/api";

const DEFAULT_ANALYSIS_FOCUS =
  "Act as a store growth strategist. Review what to scale, what to pause, what to test, what audiences to target next, which campaign gaps exist, what creative should change, and which store-side blockers are distorting ad performance.";

const META_VIEW_TABS = [
  { id: "overview", label: "Overview", icon: Target },
  { id: "ai", label: "AI Workspace", icon: MessageSquare },
  { id: "details", label: "Detailed Tables", icon: Settings },
  { id: "history", label: "History", icon: RefreshCw },
];

const toArray = (value) => (Array.isArray(value) ? value : []);
const formatLabel = (value) =>
  String(value || "")
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const truncateText = (value, maxLength = 260) => {
  const normalized = String(value || "").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}...`;
};

function Tile({ title, value, subtitle, icon: Icon, tone = "sky" }) {
  const tones = {
    sky: "border-sky-200 bg-sky-50",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    slate: "border-slate-200 bg-slate-50",
  };
  return (
    <div
      className={`rounded-3xl border p-5 shadow-sm ${tones[tone] || tones.sky}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-600">{title}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">
            {value}
          </p>
          {subtitle ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">{subtitle}</p>
          ) : null}
        </div>
        <div className="rounded-2xl bg-white/80 p-3 shadow-sm">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function Section({ title, description = "", actions = null, children }) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-slate-950">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {description}
            </p>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Badge({ value }) {
  const tones = {
    scale: "bg-emerald-100 text-emerald-800",
    keep: "bg-sky-100 text-sky-800",
    test: "bg-amber-100 text-amber-800",
    pause: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${tones[value] || tones.keep}`}
    >
      {value || "keep"}
    </span>
  );
}

function ViewTabButton({ label, active, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition ${
        active
          ? "bg-slate-950 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function Table({ columns, rows, renderRow, emptyText }) {
  if (!rows.length)
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
        {emptyText}
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-[0.22em] text-slate-500">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 font-bold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}

function MetricChip({ label, value, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };

  return (
    <div
      className={`rounded-2xl border px-3 py-3 ${tones[tone] || tones.slate}`}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-70">
        {label}
      </div>
      <div className="mt-2 text-sm font-black tracking-tight">{value}</div>
    </div>
  );
}

function NarrativeList({ items, emptyText = "No details available." }) {
  const rows = toArray(items).filter(Boolean);

  if (!rows.length) {
    return <p className="text-sm leading-6 text-slate-500">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((item, index) => (
        <div
          key={`${item}-${index}`}
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function DecisionBoardCards({
  rows,
  primaryCurrency,
  formatMoney,
  formatRate,
  formatTimes,
  formatNumber,
}) {
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
        Sync Meta data to start receiving campaign decisions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <article
          key={row.id}
          className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(135deg,_#ffffff_0%,_#f8fafc_100%)] shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black tracking-tight text-slate-950">
                {row.name || row.id}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                {row.objective || "No objective"} | Spend{" "}
                {formatMoney(row.spend, primaryCurrency)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge value={row.decision} />
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {row.confidence || "medium"}
              </span>
            </div>
          </div>

          <div className="grid gap-3 px-5 py-4 md:grid-cols-4">
            <MetricChip
              label="ROAS"
              value={formatTimes(row.roas)}
              tone="emerald"
            />
            <MetricChip
              label="Link CTR"
              value={formatRate(row.link_ctr)}
              tone="sky"
            />
            <MetricChip
              label="Conv. Rate"
              value={formatRate(row.conversion_rate)}
              tone="amber"
            />
            <MetricChip
              label="Frequency"
              value={formatNumber(row.frequency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              tone="rose"
            />
          </div>

          <div className="grid gap-4 px-5 pb-5 lg:grid-cols-[1.15fr,0.85fr]">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                Why
              </div>
              <NarrativeList items={row.why} />
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                  Action
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                  {row.primary_issue || "mixed"}
                </span>
              </div>
              <p className="text-sm leading-7 text-slate-700">
                {row.action || "No action available."}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function CreativeDiagnosticCards({
  rows,
  primaryCurrency,
  formatMoney,
  formatRate,
  formatTimes,
  formatCount,
}) {
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
        No creative diagnostics available yet.
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {rows.map((row) => (
        <article
          key={row.id}
          className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(145deg,_#ffffff_0%,_#fffdf6_100%)] p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black tracking-tight text-slate-950">
                {row.name || row.id}
              </div>
              <div className="mt-1 text-sm text-slate-500">
                Spend {formatMoney(row.spend, primaryCurrency)} |{" "}
                {formatCount(row.video_plays)} video plays
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
              {row.diagnosis || "stable"}
            </span>
          </div>

          <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-black tracking-tight text-slate-900">
              {row.headline || row.diagnosis || "Creative read"}
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-700">
              {row.action || "No action available."}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricChip
              label="ROAS"
              value={formatTimes(row.roas)}
              tone="emerald"
            />
            <MetricChip
              label="Hold"
              value={formatRate(row.video_hold_rate)}
              tone="amber"
            />
            <MetricChip
              label="Completion"
              value={formatRate(row.video_completion_rate)}
              tone="rose"
            />
            <MetricChip
              label="Link CTR"
              value={formatRate(row.link_ctr)}
              tone="sky"
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function QuestionSuggestionCards({ rows, onAsk }) {
  if (!rows.length) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
        Sync Meta data to surface operator-grade questions from the current
        account state.
      </div>
    );
  }

  const priorityTone = {
    high: "border-rose-200 bg-rose-50 text-rose-700",
    medium: "border-amber-200 bg-amber-50 text-amber-700",
    low: "border-sky-200 bg-sky-50 text-sky-700",
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {rows.map((row) => (
        <article
          key={row.id}
          className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(145deg,_#ffffff_0%,_#f8fafc_100%)] p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-600">
                {formatLabel(row.category)}
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${priorityTone[row.priority] || priorityTone.medium}`}
              >
                {formatLabel(row.priority)}
              </span>
            </div>
            {row.source_label ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                {row.source_label}
              </span>
            ) : null}
          </div>

          <h3 className="mt-4 text-lg font-black tracking-tight text-slate-950">
            {row.question}
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-700">{row.why_now}</p>

          {toArray(row.data_points).length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {toArray(row.data_points).map((item, index) => (
                <span
                  key={`${row.id}-point-${index}`}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            {row.reference_note ? (
              <p className="max-w-xl text-xs leading-5 text-slate-500">
                {truncateText(row.reference_note, 150)}
              </p>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {row.source_url ? (
                <a
                  href={row.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  Meta Reference
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => onAsk(row.question)}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
              >
                <MessageSquare size={14} />
                Ask AI
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function MetaCommandCenter() {
  const { formatCurrency, formatDateTime, formatNumber, formatPercent } =
    useLocale();
  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [assistantSending, setAssistantSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [analysisFocus, setAnalysisFocus] = useState(DEFAULT_ANALYSIS_FOCUS);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    {
      role: "assistant",
      content:
        "Ready. Ask about campaigns, targeting, creative, market pressure, store blockers, or the next growth plan, and I will ground the answer in the latest store and Meta data.",
      timestamp: new Date().toISOString(),
    },
  ]);

  const loadPage = async ({ silent = false } = {}) => {
    try {
      silent ? setRefreshing(true) : setLoading(true);
      const statusResponse = await metaAnalyticsAPI.getStatus();
      const nextStatus = statusResponse.data || null;
      setStatus(nextStatus);
      if (nextStatus?.schemaReady === false) {
        setOverview(null);
        setError("");
        return;
      }
      const overviewResponse = await metaAnalyticsAPI.getOverview({ days: 30 });
      setOverview(overviewResponse.data || null);
      setError("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadPage();
  }, []);

  const schemaMissing = status?.schemaReady === false;
  const metaOverview = useMemo(() => overview?.overview ?? null, [overview]);
  const decisionBoard = useMemo(
    () => metaOverview?.decision_board ?? null,
    [metaOverview],
  );
  const summary = metaOverview?.summary || {};
  const decisionSummary = decisionBoard?.summary || {};
  const roasFramework = decisionBoard?.roas_framework || {};
  const storeSnapshot = overview?.store_snapshot || {};
  const recommendations = useMemo(
    () => toArray(overview?.recommendations).slice(0, 6),
    [overview],
  );
  const decisionCampaigns = useMemo(
    () => toArray(decisionBoard?.campaigns).slice(0, 6),
    [decisionBoard],
  );
  const creativeDiagnostics = useMemo(
    () => toArray(decisionBoard?.creative_diagnostics).slice(0, 6),
    [decisionBoard],
  );
  const playbookNotes = useMemo(
    () => toArray(decisionBoard?.playbook_notes).slice(0, 4),
    [decisionBoard],
  );
  const allCampaigns = useMemo(
    () => toArray(metaOverview?.campaigns),
    [metaOverview],
  );
  const allAdsets = useMemo(
    () => toArray(metaOverview?.adsets),
    [metaOverview],
  );
  const allAds = useMemo(() => toArray(metaOverview?.ads), [metaOverview]);
  const assistantQuestions = useMemo(
    () => toArray(overview?.assistant_questions).slice(0, 4),
    [overview],
  );
  const activeCampaigns = useMemo(
    () => allCampaigns.filter((item) => item?.is_active),
    [allCampaigns],
  );
  const activeAdsets = useMemo(
    () => allAdsets.filter((item) => item?.is_active),
    [allAdsets],
  );
  const activeAds = useMemo(
    () => allAds.filter((item) => item?.is_active),
    [allAds],
  );
  const analyses = toArray(overview?.analyses);
  const syncRuns = toArray(overview?.sync_runs);
  const primaryCurrency = metaOverview?.accounts?.[0]?.currency || "USD";
  const quickPrompts = useMemo(() => {
    const dynamicPrompts = assistantQuestions
      .map((item) => item?.question)
      .filter(Boolean);
    if (dynamicPrompts.length) {
      return dynamicPrompts.slice(0, 4);
    }

    return [
      "Give me the biggest growth blockers in the store right now.",
      "Which campaigns or products deserve more budget today, and what are the guardrails?",
      "What new audiences or campaign types are missing right now?",
      "Which creative should I rebuild first, and what hook should replace it?",
    ];
  }, [assistantQuestions]);
  const formatCount = (value) =>
    formatNumber(value, { maximumFractionDigits: 0 });
  const formatRate = (value) =>
    formatPercent(value, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const formatMoney = (value, currency = "USD") =>
    formatCurrency(value, {
      currency: currency || "USD",
      currencyStyle: "intl",
    });
  const formatTimes = (value) =>
    `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError("");
      setSuccess("");
      const response = await metaAnalyticsAPI.sync({ days: 30 });
      setSuccess(
        `Meta sync completed. ${formatCount(response?.data?.sync?.snapshots_count)} daily insight rows loaded.`,
      );
      await loadPage({ silent: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setSyncing(false);
    }
  };

  const handleAnalyze = async () => {
    try {
      setAnalyzing(true);
      setError("");
      setSuccess("");
      await metaAnalyticsAPI.analyze({ days: 30, focus: analysisFocus });
      setSuccess("AI brief generated successfully.");
      await loadPage({ silent: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAssistantSend = async (message = assistantInput) => {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return;
    setActiveView("ai");
    const history = assistantMessages
      .slice(-8)
      .map((entry) => ({ role: entry.role, content: entry.content }));
    const userMessage = {
      role: "user",
      content: normalizedMessage,
      timestamp: new Date().toISOString(),
    };
    setAssistantMessages((current) => [...current, userMessage]);
    setAssistantInput("");
    setAssistantSending(true);
    setError("");
    try {
      const response = await metaAnalyticsAPI.chat({
        message: normalizedMessage,
        history,
        days: 30,
      });
      setAssistantMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            response?.data?.reply?.content ||
            "No response was returned from the AI assistant.",
          timestamp: new Date().toISOString(),
        },
      ]);
      setSuccess("AI operator reply is ready.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setAssistantMessages((current) => current.slice(0, -1));
      setAssistantInput(normalizedMessage);
    } finally {
      setAssistantSending(false);
    }
  };

  if (loading)
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-auto p-8">
          <LoadingSpinner label="Loading Meta command center..." />
        </main>
      </div>
    );

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-8">
          <section className="rounded-[2.25rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_32%),linear-gradient(135deg,_#fffdf6_0%,_#ffffff_42%,_#eff6ff_100%)] p-8 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-slate-600">
                  <Megaphone size={14} />
                  Meta Command Center
                </div>
                <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950">
                  Decide what to pause, what to keep, and what deserves scale.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
                  This page combines store performance, Meta campaign metrics,
                  ROAS rules, and creative diagnostics into direct operating
                  calls.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <Settings size={16} />
                  Settings
                </Link>
                <button
                  type="button"
                  onClick={() => loadPage({ silent: true })}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw
                    size={16}
                    className={refreshing ? "animate-spin" : ""}
                  />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing || schemaMissing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sky-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-800 disabled:opacity-60"
                >
                  <RefreshCw
                    size={16}
                    className={syncing ? "animate-spin" : ""}
                  />
                  {syncing ? "Syncing Meta..." : "Sync Meta"}
                </button>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || schemaMissing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Sparkles
                    size={16}
                    className={analyzing ? "animate-pulse" : ""}
                  />
                  {analyzing ? "Generating brief..." : "Generate AI Brief"}
                </button>
              </div>
            </div>
          </section>

          {error ? (
            <ErrorAlert message={error} onClose={() => setError("")} />
          ) : null}
          {success ? (
            <SuccessAlert message={success} onClose={() => setSuccess("")} />
          ) : null}

          {schemaMissing ? (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-6 py-5 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={20}
                  className="mt-0.5 flex-shrink-0 text-amber-600"
                />
                <div>
                  <h3 className="font-semibold text-amber-900">
                    Meta Analytics Setup Required
                  </h3>
                  <p className="mt-1 text-sm leading-6">
                    Meta Analytics tables are missing from your database. Please
                    run the{" "}
                    <code className="rounded bg-amber-100 px-2 py-1 text-xs font-mono">
                      ADD_META_ANALYTICS_MODULE.sql
                    </code>{" "}
                    script in your Supabase SQL Editor to enable Meta Analytics
                    features.
                  </p>
                  <p className="mt-2 text-xs text-amber-700">
                    Contact your system administrator if you need help with
                    database setup.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
            <Tile
              title="Meta connection"
              value={
                status?.integration?.meta?.configured
                  ? status?.integration?.meta?.connected
                    ? "Connected"
                    : "Configured"
                  : "Not configured"
              }
              subtitle={
                status?.integration?.meta?.last_sync_at
                  ? `Last sync ${formatDateTime(status.integration.meta.last_sync_at)}`
                  : "Configure Meta in Settings to validate the token."
              }
              icon={Megaphone}
              tone="sky"
            />
            <Tile
              title="OpenRouter"
              value={
                status?.integration?.openrouter?.configured
                  ? status?.integration?.openrouter?.connected
                    ? "Ready"
                    : "Configured"
                  : "Not configured"
              }
              subtitle={
                status?.integration?.openrouter?.model ||
                "AI brief and operator chat use the saved model."
              }
              icon={Bot}
              tone="slate"
            />
            <Tile
              title="Net revenue"
              value={formatMoney(
                storeSnapshot?.financial?.net_revenue,
                primaryCurrency,
              )}
              subtitle={`${formatCount(storeSnapshot?.orders?.total)} orders in the store snapshot`}
              icon={Wallet}
              tone="emerald"
            />
            <Tile
              title="Low stock pressure"
              value={formatCount(storeSnapshot?.catalog?.low_stock_count)}
              subtitle={`${formatCount(storeSnapshot?.catalog?.out_of_stock_count)} out of stock`}
              icon={KeyRound}
              tone="amber"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <Tile
              title="Spend"
              value={formatMoney(summary?.spend, primaryCurrency)}
              subtitle={`${formatCount(summary?.accounts_count)} accounts in scope`}
              icon={Wallet}
              tone="slate"
            />
            <Tile
              title="ROAS"
              value={formatTimes(summary?.roas)}
              subtitle={`${formatCount(summary?.purchases)} purchases`}
              icon={TrendingUp}
              tone="emerald"
            />
            <Tile
              title="Link CTR"
              value={formatRate(summary?.link_ctr)}
              subtitle={`CTR ${formatRate(summary?.ctr)}`}
              icon={Target}
              tone="sky"
            />
            <Tile
              title="Conversion rate"
              value={formatRate(summary?.conversion_rate)}
              subtitle={`CPP ${formatMoney(summary?.cost_per_purchase, primaryCurrency)}`}
              icon={Brain}
              tone="amber"
            />
            <Tile
              title="Frequency"
              value={formatNumber(summary?.frequency, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              subtitle={`CPM ${formatMoney(summary?.cpm, primaryCurrency)}`}
              icon={Sparkles}
              tone="rose"
            />
            <Tile
              title="Video hold rate"
              value={formatRate(summary?.video_hold_rate)}
              subtitle={`Completion ${formatRate(summary?.video_completion_rate)}`}
              icon={Film}
              tone="slate"
            />
          </div>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-3">
              {META_VIEW_TABS.map((tab) => (
                <ViewTabButton
                  key={tab.id}
                  label={tab.label}
                  icon={tab.icon}
                  active={activeView === tab.id}
                  onClick={() => setActiveView(tab.id)}
                />
              ))}
            </div>
          </section>

          {activeView === "overview" ? (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.08fr,0.92fr]">
              <Section
                title="Campaign Command Board"
                description="Decision engine for campaigns built from ROAS, spend gate, link CTR, conversion rate, CPM, frequency, and video engagement."
              >
                <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Tile
                    title="Scale Now"
                    value={formatCount(decisionSummary?.scale_count)}
                    subtitle="Campaigns that can take controlled budget expansion."
                    icon={CheckCircle2}
                    tone="emerald"
                  />
                  <Tile
                    title="Keep Running"
                    value={formatCount(decisionSummary?.keep_count)}
                    subtitle="Stable campaigns that should stay live without heavy edits."
                    icon={Target}
                    tone="sky"
                  />
                  <Tile
                    title="Test Next"
                    value={formatCount(decisionSummary?.test_count)}
                    subtitle="Mixed campaigns that need one sharp experiment."
                    icon={FlaskConical}
                    tone="amber"
                  />
                  <Tile
                    title="Pause Now"
                    value={formatCount(decisionSummary?.pause_count)}
                    subtitle="Spend that is failing the current decision rules."
                    icon={PauseCircle}
                    tone="rose"
                  />
                </div>

                <DecisionBoardCards
                  rows={decisionCampaigns}
                  primaryCurrency={primaryCurrency}
                  formatMoney={formatMoney}
                  formatRate={formatRate}
                  formatTimes={formatTimes}
                  formatNumber={formatNumber}
                />
              </Section>

              <div className="space-y-6">
                <Section
                  title="ROAS Rules"
                  description="Guardrails used by the command board so scaling and pausing are not based on guesswork."
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Tile
                      title="Blended ROAS"
                      value={formatTimes(roasFramework?.account_blended_roas)}
                      subtitle="Current account baseline from the loaded snapshot."
                      icon={TrendingUp}
                      tone="slate"
                    />
                    <Tile
                      title="Spend Gate"
                      value={formatMoney(
                        roasFramework?.spend_gate,
                        primaryCurrency,
                      )}
                      subtitle="Minimum spend before a hard stop becomes credible."
                      icon={Wallet}
                      tone="amber"
                    />
                    <Tile
                      title="Scale Threshold"
                      value={formatTimes(roasFramework?.scale_threshold)}
                      subtitle="Campaigns above this line with stable quality can scale."
                      icon={CheckCircle2}
                      tone="emerald"
                    />
                    <Tile
                      title="Pause Threshold"
                      value={formatTimes(roasFramework?.pause_threshold)}
                      subtitle="If spend clears the gate and ROAS stays under this line, cut or pause."
                      icon={PauseCircle}
                      tone="rose"
                    />
                  </div>
                  <div className="mt-5 space-y-3">
                    {toArray(roasFramework?.explanation).map((item, index) => (
                      <div
                        key={`rule-${index}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section
                  title="Suggested Moves"
                  description="Immediate operating calls from store context plus the Meta decision board."
                  actions={
                    <Link
                      to="/settings"
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Settings size={16} />
                      Tune integrations
                    </Link>
                  }
                >
                  {recommendations.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                      Save OpenRouter and Meta in Settings, then sync some data
                      to generate actions.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recommendations.map((item, index) => (
                        <div
                          key={`${item.title || "recommendation"}-${index}`}
                          className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="font-bold text-slate-950">
                              {item?.title || "Recommendation"}
                            </p>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                              {item?.priority || "medium"}
                            </span>
                          </div>
                          <p className="text-sm leading-6 text-slate-700">
                            {item?.action}
                          </p>
                          {item?.reason ? (
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              {item.reason}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              </div>
            </div>
          ) : null}

          {activeView === "details" ? (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <Section
                title="All Campaigns"
                description="Full campaign list from the stored Meta catalog, including zero-spend and active items."
              >
                <Table
                  columns={[
                    "Campaign",
                    "Status",
                    "Spend",
                    "ROAS",
                    "Purchases",
                    "Updated",
                  ]}
                  rows={allCampaigns}
                  emptyText="No campaigns stored yet. Run Meta sync first."
                  renderRow={(row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-950">
                          {row.name || row.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.objective || "No objective"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${row.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}
                          >
                            {row.is_active ? "ACTIVE" : "INACTIVE"}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">
                            {row.effective_status || row.status || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatMoney(row.spend, primaryCurrency)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatTimes(row.roas)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatCount(row.purchases)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.updated_time
                          ? formatDateTime(row.updated_time)
                          : "-"}
                      </td>
                    </tr>
                  )}
                />
              </Section>

              <Section
                title="Active Campaigns"
                description="Live campaigns only, separated so you can review the deliverable set quickly."
              >
                <Table
                  columns={[
                    "Campaign",
                    "Spend",
                    "ROAS",
                    "Link CTR",
                    "Conv. Rate",
                    "Decision",
                  ]}
                  rows={activeCampaigns}
                  emptyText="No active campaigns stored yet."
                  renderRow={(row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-950">
                          {row.name || row.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.effective_status || row.status || "ACTIVE"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatMoney(row.spend, primaryCurrency)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatTimes(row.roas)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatRate(row.link_ctr)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatRate(row.conversion_rate)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge value={row.decision || "keep"} />
                      </td>
                    </tr>
                  )}
                />
              </Section>
            </div>
          ) : null}

          {activeView === "details" ? (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <Section
                title="Active Ad Sets"
                description="All active ad sets with their parent campaign and delivery metadata."
              >
                <Table
                  columns={[
                    "Ad Set",
                    "Campaign",
                    "Optimization",
                    "Spend",
                    "ROAS",
                    "Status",
                  ]}
                  rows={activeAdsets}
                  emptyText="No active ad sets stored yet."
                  renderRow={(row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-950">
                          {row.name || row.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.id}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.campaign_id || "-"}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.optimization_goal || "-"}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatMoney(row.spend, primaryCurrency)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatTimes(row.roas)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-800">
                          {row.effective_status || row.status || "ACTIVE"}
                        </span>
                      </td>
                    </tr>
                  )}
                />
              </Section>

              <Section
                title="Active Ads"
                description="All active ads with their linked campaign, ad set, and current efficiency signals."
              >
                <Table
                  columns={["Ad", "Campaign", "Ad Set", "Spend", "ROAS", "CTR"]}
                  rows={activeAds}
                  emptyText="No active ads stored yet."
                  renderRow={(row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold text-slate-950">
                          {row.name || row.id}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.effective_status || row.status || "ACTIVE"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.campaign_id || "-"}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {row.adset_id || "-"}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatMoney(row.spend, primaryCurrency)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatTimes(row.roas)}
                      </td>
                      <td className="px-4 py-3 align-top text-slate-700">
                        {formatRate(row.link_ctr || row.ctr)}
                      </td>
                    </tr>
                  )}
                />
              </Section>
            </div>
          ) : null}

          {activeView === "overview" ? (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <Section
                title="Creative Diagnostics"
                description="Ad-level reads built from thumb-stop, hold, completion, click quality, and post-click conversion."
              >
                <CreativeDiagnosticCards
                  rows={creativeDiagnostics}
                  primaryCurrency={primaryCurrency}
                  formatMoney={formatMoney}
                  formatRate={formatRate}
                  formatTimes={formatTimes}
                  formatCount={formatCount}
                />
              </Section>

              <Section
                title="Meta Playbook"
                description="Reference notes surfaced from official Meta guidance."
              >
                {playbookNotes.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    No playbook notes available.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {playbookNotes.map((note, index) => (
                      <div
                        key={`playbook-${index}`}
                        className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,_#f8fafc_0%,_#fffdf6_100%)] p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-2xl bg-slate-950 p-2 text-white">
                            {index % 2 === 0 ? (
                              <Film size={16} />
                            ) : (
                              <Sparkles size={16} />
                            )}
                          </div>
                          <p className="text-sm leading-7 text-slate-700">
                            {note}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          ) : null}

          {activeView === "ai" ? (
            <>
              <div className="rounded-[2rem] border border-sky-200 bg-sky-50 px-5 py-4 text-sm text-sky-900">
                <div className="font-bold">
                  AI replies are now tighter by default.
                </div>
                <p className="mt-1 leading-6">
                  Ask about one campaign, one ad, or one problem. The assistant
                  will stay focused and will not pull in unrelated campaigns
                  unless they change the decision.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[0.92fr,1.08fr]">
                <Section
                  title="AI Brief Focus"
                  description="This instruction goes into the formal AI analysis using the latest Meta overview, decision board, and store context."
                  actions={
                    <button
                      type="button"
                      onClick={handleAnalyze}
                      disabled={analyzing || schemaMissing}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      <Brain size={16} />
                      {analyzing ? "Analyzing..." : "Run AI Analysis"}
                    </button>
                  }
                >
                  <textarea
                    rows={6}
                    value={analysisFocus}
                    onChange={(event) => setAnalysisFocus(event.target.value)}
                    className="w-full rounded-3xl border border-slate-200 px-4 py-3 text-sm leading-6 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-100"
                  />
                </Section>

                <Section
                  title="AI Operator Chat"
                  description="Ask about the whole store: what should pause, scale, restock, retarget, test next, or change in audience, offer, and creative."
                  actions={
                    <button
                      type="button"
                      onClick={() => handleAssistantSend(quickPrompts[0])}
                      disabled={assistantSending || schemaMissing}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      <MessageSquare size={16} />
                      Ask AI Now
                    </button>
                  }
                >
                  <div className="mb-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
                          Suggested Questions
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          These prompts are generated from decision-board state,
                          creative diagnostics, commerce pressure, audience
                          gaps, and Meta guidance topics.
                        </p>
                      </div>
                    </div>
                    <QuestionSuggestionCards
                      rows={assistantQuestions}
                      onAsk={handleAssistantSend}
                    />
                  </div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    {quickPrompts.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => handleAssistantSend(prompt)}
                        disabled={assistantSending || schemaMissing}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white disabled:opacity-60"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-3 rounded-[2rem] bg-slate-50 p-4">
                    {assistantMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${message.timestamp || index}-${index}`}
                        className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-3xl rounded-3xl px-4 py-3 shadow-sm ${message.role === "assistant" ? "border border-slate-200 bg-white text-slate-800" : "bg-slate-950 text-white"}`}
                        >
                          <p className="whitespace-pre-wrap text-sm leading-6">
                            {message.content}
                          </p>
                          <p
                            className={`mt-2 text-[11px] ${message.role === "assistant" ? "text-slate-400" : "text-slate-300"}`}
                          >
                            {formatDateTime(message.timestamp)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {assistantSending ? (
                      <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
                        Analyzing store, campaign, audience, and creative context...
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4">
                    <textarea
                      rows={4}
                      value={assistantInput}
                      onChange={(event) =>
                        setAssistantInput(event.target.value)
                      }
                      className="w-full rounded-3xl border border-slate-200 px-4 py-3 text-sm leading-6 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-100"
                      placeholder="Ask about a campaign, audience, city, offer, creative angle, market pressure, or the next growth move."
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-500">
                        The reply is grounded in the latest store snapshot,
                        geography, customer behavior, and Meta decision data.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleAssistantSend()}
                        disabled={
                          assistantSending ||
                          schemaMissing ||
                          !assistantInput.trim()
                        }
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <Send size={16} />
                        {assistantSending ? "Sending..." : "Send to AI"}
                      </button>
                    </div>
                  </div>
                </Section>
              </div>
            </>
          ) : null}

          {activeView === "history" ? (
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              <Section
                title="Recent AI Briefs"
                description="Saved OpenRouter analyses generated from the latest Meta performance data."
              >
                {analyses.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    Generate your first AI brief after syncing Meta data.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {analyses.map((analysis) => {
                      const summaryJson = analysis?.summary_json || {};
                      return (
                        <div
                          key={analysis.id}
                          className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-bold text-slate-950">
                                {analysis.model || "OpenRouter analysis"}
                              </p>
                              <p className="text-xs text-slate-500">
                                {formatDateTime(analysis.created_at)}
                              </p>
                            </div>
                            {analysis.focus_area ? (
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                                {analysis.focus_area}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-sm leading-6 text-slate-700">
                            {summaryJson?.executive_summary
                              ? summaryJson.executive_summary
                              : truncateText(analysis.recommendation_text, 320)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Section>

              <Section
                title="Sync History"
                description="Latest Meta sync runs stored for this store."
              >
                {syncRuns.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-sm text-slate-500">
                    No sync runs recorded yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {syncRuns.map((run) => (
                      <div
                        key={run.id}
                        className="rounded-3xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-bold text-slate-950">
                              {run.status === "completed"
                                ? "Completed"
                                : run.status === "failed"
                                  ? "Failed"
                                  : "Running"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatDateTime(run.started_at)}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-bold ${run.status === "completed" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}
                          >
                            {run.sync_type || "manual"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                          <p>
                            Range: {run.date_start || "-"} to{" "}
                            {run.date_stop || "-"}
                          </p>
                          <p>
                            Finished:{" "}
                            {run.completed_at
                              ? formatDateTime(run.completed_at)
                              : "-"}
                          </p>
                        </div>
                        {run.error_message ? (
                          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                            {run.error_message}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          ) : null}

          {!status?.schemaReady ? (
            <div className="rounded-[2rem] border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <p className="font-bold">Database schema is still missing.</p>
              <p className="mt-1">
                Run <code>ADD_META_ANALYTICS_MODULE.sql</code> on Supabase
                first, then save your Meta and OpenRouter credentials in
                Settings.
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
