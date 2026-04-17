import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CircleDollarSign,
  HeartHandshake,
  PackageSearch,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Warehouse,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import {
  EmptyState,
  ErrorAlert,
  LoadingSpinner,
  SkeletonBlock,
} from "../components/Common";
import { useLocale } from "../context/LocaleContext";
import { dashboardAPI, getErrorMessage } from "../utils/api";
import { HEAVY_VIEW_CACHE_FRESH_MS } from "../utils/refreshPolicy";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  peekCachedView,
  readCachedView,
  writeCachedView,
} from "../utils/viewCache";

const GROWTH_CENTER_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
const DEFAULT_LOOKBACK_DAYS = 30;

const toArray = (value) => (Array.isArray(value) ? value : []);

const STATUS_STYLES = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-700",
  watch: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-rose-200 bg-rose-50 text-rose-700",
};

const PRIORITY_STYLES = {
  critical: "border-rose-200 bg-rose-50 text-rose-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  growth: "border-sky-200 bg-sky-50 text-sky-700",
};

const STOCK_STYLES = {
  out_of_stock: "border-rose-200 bg-rose-50 text-rose-700",
  critical: "border-orange-200 bg-orange-50 text-orange-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  watch: "border-sky-200 bg-sky-50 text-sky-700",
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const getLocalizedPriorityLabel = (value, select) => {
  switch (String(value || "").trim().toLowerCase()) {
    case "critical":
      return select("حرج", "Critical");
    case "high":
      return select("عالي", "High");
    case "medium":
      return select("متوسط", "Medium");
    case "growth":
      return select("نمو", "Growth");
    default:
      return select("متوسط", "Medium");
  }
};

const getLocalizedStatusLabel = (value, select) => {
  switch (String(value || "").trim().toLowerCase()) {
    case "good":
      return select("ممتاز", "Good");
    case "watch":
      return select("مراقبة", "Watch");
    case "critical":
      return select("خطر", "Critical");
    default:
      return select("مراقبة", "Watch");
  }
};

const getLocalizedStockStatusLabel = (value, select) => {
  switch (String(value || "").trim().toLowerCase()) {
    case "out_of_stock":
      return select("نافد", "Out of Stock");
    case "critical":
      return select("حرج", "Critical");
    case "warning":
      return select("منخفض", "Low");
    case "watch":
      return select("تحت المراقبة", "Watch");
    case "healthy":
      return select("صحي", "Healthy");
    default:
      return select("تحت المراقبة", "Watch");
  }
};

const getLocalizedActionCopy = (item, select, formatNumber, formatPercent) => {
  const metricValue = formatNumber(item?.metric || 0);

  switch (item?.id) {
    case "restock-critical-skus":
      return {
        title: select(
          "زوّد مخزون المنتجات السريعة قبل ما توقف النمو",
          "Restock fast-moving products before they block growth",
        ),
        reason: select(
          `${metricValue} منتج نفد أو قرب ينفد.`,
          `${metricValue} products are already out of stock or close to running out.`,
        ),
        action: select(
          "اعتمد كميات إعادة الطلب للمنتجات العاجلة واحمِ الأكثر مبيعًا قبل أي دفع ترافيك إضافي.",
          "Approve reorder quantities for the urgent list and protect best sellers before sending more traffic.",
        ),
      };
    case "fill-missing-costs":
      return {
        title: select(
          "كمّل تكاليف المنتجات المحفوظة قبل الحكم على الربحية",
          "Complete saved product costs before trusting margin decisions",
        ),
        reason: select(
          `${metricValue} منتج نشط يبيع بدون تغطية تكلفة محفوظة كاملة.`,
          `${metricValue} active products are selling without complete saved cost coverage.`,
        ),
        action: select(
          "حدّث التكاليف المحفوظة للمنتجات حتى يفرق النظام بين المنتج الرابح فعلًا والمنتج الذي يبدو رابحًا فقط.",
          "Update saved product costs so the system can separate real winners from fake winners.",
        ),
      };
    case "fix-margin-leaks":
      return {
        title: select(
          "أصلح المنتجات التي تبيع لكن تهرب الربح",
          "Fix products that are converting but leaking margin",
        ),
        reason: select(
          `${metricValue} منتج حديث هامشه ضعيف أو سلبي.`,
          `${metricValue} recent products have weak or negative saved margin.`,
        ),
        action: select(
          "راجع السعر أو التكاليف أو الباندلز أو مصاريف التنفيذ قبل ما تزود الصرف عليها.",
          "Review pricing, saved costs, bundles, or fulfillment leakage before scaling them further.",
        ),
      };
    case "launch-win-back":
      return {
        title: select(
          "شغّل دورة استرجاع للعملاء الحاليين",
          "Start a win-back cycle from the existing customer base",
        ),
        reason: select(
          `${metricValue} عميل داخل دائرة الاسترجاع أو أصبح خاملًا.`,
          `${metricValue} customers are ready for win-back or already dormant.`,
        ),
        action: select(
          "ابنِ حملة رجوع للعملاء الهادئين بدل الاعتماد الكامل على اكتساب عملاء جدد فقط.",
          "Build a comeback campaign for quiet customers instead of relying only on acquisition spend.",
        ),
      };
    case "reduce-pending-load":
      return {
        title: select(
          "خفّض ضغط الطلبات المعلقة",
          "Reduce pending order exposure",
        ),
        reason: select(
          `${formatPercent(item?.metric || 0)} من الطلبات الحديثة ما زالت معلقة.`,
          `${formatPercent(item?.metric || 0)} of recent orders are still pending.`,
        ),
        action: select(
          "شدّد المتابعة وتأكيد الدفع قبل ما تتحول الطلبات المعلقة إلى إلغاءات.",
          "Tighten follow-up and payment confirmation before pending orders turn into cancellations.",
        ),
      };
    case "scale-healthy-skus":
      return {
        title: select(
          "ادفع المنتجات الجاهزة للنمو فعلاً",
          "Push the products that already have margin and stock room",
        ),
        reason: select(
          `${metricValue} منتج عنده هامش صحي ومخزون يكفي.`,
          `${metricValue} products have healthy saved margin and enough stock to support more demand.`,
        ),
        action: select(
          "استخدمها في الحملات والباندلز والهوم بيج قبل اختبار أفكار أبرد.",
          "Use them in campaigns, bundles, or homepage placement before testing colder ideas.",
        ),
      };
    case "system-healthy":
      return {
        title: select(
          "حلقة التشغيل الحالية مستقرة",
          "The current store loop is stable",
        ),
        reason: select(
          "لا يوجد عائق نمو كبير ظاهر الآن في المخزون أو الاحتفاظ أو تغطية التكاليف.",
          "No major growth blockers were detected in stock, retention, or saved cost coverage.",
        ),
        action: select(
          "استخدم المنتجات الجاهزة للنمو وشرائح الاحتفاظ لدفع نمو محسوب.",
          "Use the scale candidates and retention segments to push controlled growth.",
        ),
      };
    default:
      return {
        title: item?.title || select("إجراء مطلوب", "Action required"),
        reason: item?.reason || "",
        action: item?.action || "",
      };
  }
};

const getLocalizedSegmentCopy = (segment, select) => {
  switch (segment?.id) {
    case "new_customers":
      return {
        title: select("عملاء جدد", "New customers"),
        note: select(
          "عملاء اشتروا لأول مرة خلال آخر 30 يومًا.",
          "First-order customers from the last 30 days.",
        ),
        action: select(
          "احمِ أول تجربة وحرّكهم بسرعة إلى الطلب الثاني.",
          "Protect the first experience and move them quickly to order two.",
        ),
      };
    case "needs_second_order":
      return {
        title: select("محتاجين الطلب الثاني", "Needs second order"),
        note: select(
          "عملاء اشتروا مرة واحدة وبدأوا يهدوا بعد أول شراء.",
          "One-time buyers who are cooling off after the first purchase.",
        ),
        action: select(
          "أرسل حافز للطلب الثاني أو تذكير بباندل بسيط.",
          "Send a second-order incentive or a simple bundle reminder.",
        ),
      };
    case "repeat_customers":
      return {
        title: select("عملاء متكررين", "Repeat customers"),
        note: select(
          "عملاء عندهم طلبان أو أكثر ونشاط خلال آخر 90 يومًا.",
          "Customers with 2+ orders and activity in the last 90 days.",
        ),
        action: select(
          "غذّهم برسائل إعادة الشراء والباندلز والولاء.",
          "Feed them with restock timing, bundles, and loyalty messaging.",
        ),
      };
    case "vip_customers":
      return {
        title: select("عملاء VIP", "VIP customers"),
        note: select(
          "عملاء عاليي القيمة يستحقون معاملة احتفاظ خاصة.",
          "High-value buyers worth special retention treatment.",
        ),
        action: select(
          "اعطهم أولوية خدمة وإطلاقات أو عروض خاصة.",
          "Give them priority service and exclusive launches.",
        ),
      };
    case "win_back_ready":
      return {
        title: select("جاهزين للاسترجاع", "Win-back ready"),
        note: select(
          "عملاء هادئون منذ 45 إلى 120 يومًا.",
          "Customers who have been quiet for 45 to 120 days.",
        ),
        action: select(
          "ابدأ تسلسل رجوع قبل ما يتحولوا إلى خاملين بالكامل.",
          "Launch a comeback sequence before they fully churn.",
        ),
      };
    case "dormant_customers":
      return {
        title: select("عملاء خاملون", "Dormant customers"),
        note: select(
          "عملاء غير نشطين منذ أكثر من 120 يومًا.",
          "Customers inactive for more than 120 days.",
        ),
        action: select(
          "استخدم عروض أقوى أو قلل الضغط الإعلاني عليهم.",
          "Use stronger offers or suppress them from high-frequency spend.",
        ),
      };
    default:
      return {
        title: segment?.title || "",
        note: segment?.note || "",
        action: segment?.action || "",
      };
  }
};

const getLocalizedRecoveryCopy = (item, select) => {
  const segment = String(item?.segment || "").trim().toLowerCase();

  return {
    segmentLabel:
      segment === "dormant"
        ? select("خامل", "Dormant")
        : select("استرجاع", "Win Back"),
    suggestedAction:
      segment === "dormant"
        ? select(
            "اعمل عرض رجوع أقوى أو متابعة مباشرة لإحياء العميل من جديد.",
            "Use a stronger comeback offer or direct follow-up to reactivate this customer.",
          )
        : item?.priority === "high"
          ? select(
              "تواصل معه بعرض استرجاع VIP ومتابعة يدوية.",
              "Reach out with a VIP recovery offer and manual follow-up.",
            )
          : select(
              "أرسل تذكيرًا ذكيًا أو باندل لإعادة تشغيل دورة الشراء.",
              "Use a timed reminder or bundle to restart the buying cycle.",
            ),
  };
};

export default function GrowthCenter() {
  const {
    formatCurrency,
    formatDateTime,
    formatNumber,
    formatPercent,
    isRTL,
    select,
  } = useLocale();
  const cacheKey = useMemo(
    () => buildStoreScopedCacheKey("dashboard:growth-center:v1"),
    [],
  );
  const initialCachedEntry = useMemo(() => peekCachedView(cacheKey), [cacheKey]);
  const [data, setData] = useState(() => initialCachedEntry?.value || null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    () => initialCachedEntry?.updatedAt || null,
  );
  const [loading, setLoading] = useState(!initialCachedEntry?.value);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await dashboardAPI.getGrowthCenter({
          days: DEFAULT_LOOKBACK_DAYS,
        });
        const nextPayload = response?.data || null;
        setData(nextPayload);
        setError("");

        const cachedEntry = await writeCachedView(cacheKey, nextPayload);
        setLastUpdatedAt(cachedEntry?.updatedAt || new Date().toISOString());
      } catch (requestError) {
        setError(getErrorMessage(requestError));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [cacheKey],
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const cachedEntry = await readCachedView(cacheKey);
      if (!active) {
        return;
      }

      if (cachedEntry?.value) {
        setData(cachedEntry.value);
        setLastUpdatedAt(cachedEntry.updatedAt || null);
        setLoading(false);
      }

      if (!cachedEntry?.value || !isCacheFresh(cachedEntry, GROWTH_CENTER_CACHE_FRESH_MS)) {
        await loadData({ silent: Boolean(cachedEntry?.value) });
      }
    })();

    return () => {
      active = false;
    };
  }, [cacheKey, loadData]);

  const showLoadingState = loading && !data;
  const loadingView = (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <LoadingSpinner label={select("جاري تحميل مركز النمو...", "Loading growth center...")} />
        </main>
      </div>
  );

  const summary = data?.summary || {};
  const healthChecks = toArray(data?.health_checks);
  const actions = toArray(data?.recommended_actions);
  const replenishment = data?.replenishment || {};
  const retention = data?.retention || {};
  const profitability = data?.profitability || {};
  const orderSummary = data?.order_summary || {};
  const localizedActions = useMemo(
    () =>
      actions.map((item) => ({
        ...item,
        ...getLocalizedActionCopy(item, select, formatNumber, formatPercent),
      })),
    [actions, formatNumber, formatPercent, select],
  );
  const localizedHealthChecks = useMemo(
    () =>
      healthChecks.map((check) => {
        const checkId = String(check?.id || "").trim().toLowerCase();

        if (checkId === "inventory") {
          return {
            ...check,
            title: select("ضغط المخزون", "Inventory pressure"),
            detail: select(
              "يقيس هل المخزون الحالي يكفي لدعم المنتجات التي تبيع بالفعل.",
              "Measures whether current stock can support the SKUs already selling.",
            ),
            metric: select(
              `${formatNumber(replenishment?.summary?.urgent_replenishment_count || 0)} عاجل / ${formatNumber(replenishment?.summary?.low_stock_count || 0)} منخفض`,
              `${formatNumber(replenishment?.summary?.urgent_replenishment_count || 0)} urgent / ${formatNumber(replenishment?.summary?.low_stock_count || 0)} low`,
            ),
            statusLabel: getLocalizedStatusLabel(check?.status, select),
          };
        }

        if (checkId === "costs") {
          return {
            ...check,
            title: select("تغطية التكاليف", "Cost coverage"),
            detail: select(
              "يراجع هل التكاليف المحفوظة مكتملة بما يكفي لاتخاذ قرار ربحي صحيح.",
              "Checks whether saved unit costs are filled well enough to trust margin decisions.",
            ),
            metric: select(
              `${formatPercent(summary.cost_coverage_rate || 0)} مكتمل`,
              `${formatPercent(summary.cost_coverage_rate || 0)} covered`,
            ),
            statusLabel: getLocalizedStatusLabel(check?.status, select),
          };
        }

        if (checkId === "retention") {
          return {
            ...check,
            title: select("محرك الاحتفاظ", "Retention engine"),
            detail: select(
              "يتابع هل المشترون الحاليون يتحولون إلى عملاء متكررين وعاليي القيمة.",
              "Tracks whether current buyers are becoming repeat and high-value customers.",
            ),
            metric: select(
              `${formatPercent(retention?.summary?.repeat_customer_rate || 0)} إعادة شراء`,
              `${formatPercent(retention?.summary?.repeat_customer_rate || 0)} repeat`,
            ),
            statusLabel: getLocalizedStatusLabel(check?.status, select),
          };
        }

        if (checkId === "orders") {
          return {
            ...check,
            title: select("جودة الطلبات", "Order quality"),
            detail: select(
              "يوضح هل الطلبات الداخلة نظيفة كفاية للنمو بثقة.",
              "Highlights whether incoming orders are clean enough to scale confidently.",
            ),
            metric: select(
              `${formatPercent(orderSummary.cancellation_rate || 0)} ملغي / ${formatPercent(orderSummary.refund_rate || 0)} مرتجع`,
              `${formatPercent(orderSummary.cancellation_rate || 0)} cancelled / ${formatPercent(orderSummary.refund_rate || 0)} refunded`,
            ),
            statusLabel: getLocalizedStatusLabel(check?.status, select),
          };
        }

        if (checkId === "freshness") {
          const freshnessDays = summary.freshness_days;
          return {
            ...check,
            title: select("تحديث البيانات", "Data freshness"),
            detail: select(
              "يراجع مدى حداثة نشاط المتجر قبل إصدار توصيات النمو.",
              "Checks how fresh store activity is before issuing growth recommendations.",
            ),
            metric:
              freshnessDays === null || freshnessDays === undefined
                ? select("لا يوجد نشاط حديث", "No recent activity")
                : freshnessDays === 0
                  ? select("محدث اليوم", "Updated today")
                  : select(
                      `${formatNumber(freshnessDays)} يوم`,
                      `${formatNumber(freshnessDays)} day(s) old`,
                    ),
            statusLabel: getLocalizedStatusLabel(check?.status, select),
          };
        }

        return {
          ...check,
          statusLabel: getLocalizedStatusLabel(check?.status, select),
        };
      }),
    [
      formatNumber,
      formatPercent,
      healthChecks,
      orderSummary.cancellation_rate,
      orderSummary.refund_rate,
      replenishment?.summary?.low_stock_count,
      replenishment?.summary?.urgent_replenishment_count,
      retention?.summary?.repeat_customer_rate,
      select,
      summary.cost_coverage_rate,
      summary.freshness_days,
    ],
  );
  const localizedSegments = useMemo(
    () =>
      toArray(retention.segments).map((segment) => ({
        ...segment,
        ...getLocalizedSegmentCopy(segment, select),
      })),
    [retention.segments, select],
  );
  const localizedWinBackCandidates = useMemo(
    () =>
      toArray(retention.win_back_candidates).map((item) => ({
        ...item,
        ...getLocalizedRecoveryCopy(item, select),
      })),
    [retention.win_back_candidates, select],
  );

  if (showLoadingState) {
    return loadingView;
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section className="app-surface-strong overflow-hidden rounded-[32px] p-6 sm:p-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
                  <TrendingUp size={14} />
                  {select("مركز النمو", "Growth Center")}
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                  {select(
                    "شغّل المتجر بحلقة نمو واحدة بدل صفحات منفصلة.",
                    "Run the store with one growth loop, not disconnected pages.",
                  )}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                  {select(
                    "المخزون والاحتفاظ بالعملاء والهوامش المحفوظة وجودة الطلبات بقى لهم عرض واحد واضح لاتخاذ القرار.",
                    "Inventory pressure, customer retention, saved margins, and order quality are now tied together in one operator view.",
                  )}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <HeroChip
                    icon={ShieldCheck}
                    label={select("سكور الصحة", "Health Score")}
                    value={`${formatNumber(summary.health_score || 0)} / 100`}
                  />
                  <HeroChip
                    icon={Warehouse}
                    label={select("إجراءات عاجلة", "Urgent Actions")}
                    value={formatNumber(summary.urgent_actions_count || 0)}
                  />
                  <HeroChip
                    icon={HeartHandshake}
                    label={select("حوض الاسترجاع", "Win-Back Pool")}
                    value={formatNumber(summary.win_back_count || 0)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <div className={`text-xs font-semibold text-slate-500 ${isRTL ? "" : "uppercase tracking-[0.22em]"}`}>
                    {select("آخر تحديث", "Last refresh")}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-800">
                    {formatDateTime(lastUpdatedAt || data?.generated_at)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => loadData({ silent: true })}
                  className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white"
                >
                  <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                  {select("تحديث", "Refresh")}
                </button>
              </div>
            </div>

            {error ? <div className="mt-5"><ErrorAlert message={error} /></div> : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <SummaryCard
                icon={TrendingUp}
                title={select("الإيراد الحديث", "Recent Revenue")}
                value={formatCurrency(summary.recent_revenue || 0)}
                subtitle={select(
                  `آخر ${DEFAULT_LOOKBACK_DAYS} يوم`,
                  `Last ${DEFAULT_LOOKBACK_DAYS} days`,
                )}
              />
              <SummaryCard
                icon={Users}
                title={select("معدل التكرار", "Repeat Rate")}
                value={formatPercent(summary.repeat_customer_rate || 0)}
                subtitle={select("العملاء النشطون الذين عادوا للشراء", "Active customers returning")}
              />
              <SummaryCard
                icon={CircleDollarSign}
                title={select("تغطية التكاليف", "Cost Coverage")}
                value={formatPercent(summary.cost_coverage_rate || 0)}
                subtitle={select("المنتجات التي لها تكاليف محفوظة", "Products with saved costs")}
              />
              <SummaryCard
                icon={PackageSearch}
                title={select("مخزون منخفض", "Low Stock")}
                value={formatNumber(summary.low_stock_count || 0)}
                subtitle={select("منتجات تحت ضغط المخزون", "Products under pressure")}
              />
              <SummaryCard
                icon={TrendingUp}
                title={select("جاهز للتوسيع", "Scale Now")}
                value={formatNumber(summary.scale_now_count || 0)}
                subtitle={select("منتجات بهامش ومخزون كافيين", "Healthy SKUs with room")}
              />
            </div>
          </section>

          <div className="grid gap-6 2xl:grid-cols-[1.08fr,0.92fr]">
            <SectionShell
              title={select("لوحة الإجراءات", "Action Board")}
              description={select(
                "أهم الإجراءات التالية التي تفتح النمو بأسرع شكل.",
                "The next actions that unblock growth fastest.",
              )}
            >
              {localizedActions.length ? (
                <div className="space-y-4">
                  {localizedActions.map((item) => (
                    <ActionCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={select("لا توجد إجراءات الآن", "No actions yet")}
                  message={select(
                    "حدّث الصفحة بعد توفر بيانات المتجر.",
                    "Refresh the page after store data is available.",
                  )}
                />
              )}
            </SectionShell>

            <SectionShell
              title={select("فحوصات الصحة", "Health Checks")}
              description={select(
                "خمسة فحوصات تقول لك هل النمو آمن الآن أم لا.",
                "Five checks that tell you whether growth is safe to push.",
              )}
            >
              <div className="grid gap-4">
                {localizedHealthChecks.length ? (
                  localizedHealthChecks.map((check) => (
                    <HealthCheckCard key={check.id} check={check} />
                  ))
                ) : (
                  <SkeletonBlock className="h-52 w-full rounded-[28px]" roundedClassName="" />
                )}
              </div>

              <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-4">
                <div className={`text-xs font-semibold text-slate-500 ${isRTL ? "" : "uppercase tracking-[0.22em]"}`}>
                  {select("لقطة الطلبات", "Order Snapshot")}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MiniStat label={select("طلبات", "Orders")} value={formatNumber(orderSummary.orders_count || 0)} />
                  <MiniStat
                    label={select("متوسط الطلب", "Avg Order")}
                    value={formatCurrency(orderSummary.average_order_value || 0)}
                  />
                  <MiniStat
                    label={select("ملغي", "Cancelled")}
                    value={formatPercent(orderSummary.cancellation_rate || 0)}
                  />
                  <MiniStat
                    label={select("مرتجع", "Refunded")}
                    value={formatPercent(orderSummary.refund_rate || 0)}
                  />
                </div>
              </div>
            </SectionShell>
          </div>

          <SectionShell
            title={select("أولويات التوريد", "Replenishment Priorities")}
            description={select(
              "تم تحويل البيع الحديث إلى ضغط مخزون وكميات إعادة طلب مقترحة.",
              "Recent sell-through is translated into stock pressure and suggested reorder units.",
            )}
          >
            {toArray(replenishment.priorities).length ? (
              <div className="space-y-3">
                {toArray(replenishment.priorities).map((item) => (
                  <ReplenishmentRow
                    key={item.id || item.title}
                    item={item}
                    formatCurrency={formatCurrency}
                    formatNumber={formatNumber}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={select("لا يوجد ضغط توريد", "No replenishment pressure")}
                message={select(
                  "المنتجات ستظهر هنا عند وجود طلب حديث أو ضغط مخزون.",
                  "Products will appear here once recent demand or stock pressure exists.",
                )}
              />
            )}
          </SectionShell>

          <div className="grid gap-6 2xl:grid-cols-[1fr,0.95fr]">
            <SectionShell
              title={select("محرك الاحتفاظ", "Retention Engine")}
              description={select(
                "شرائح نمو العملاء مبنية على سلوك الشراء وليس مجرد إجماليات خام.",
                "Customer growth segments built from buying behavior, not just raw totals.",
              )}
            >
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {localizedSegments.map((segment) => (
                  <SegmentCard
                    key={segment.id}
                    segment={segment}
                    formatCurrency={formatCurrency}
                    formatNumber={formatNumber}
                    formatPercent={formatPercent}
                  />
                ))}
              </div>
            </SectionShell>

            <SectionShell
              title={select("قائمة الاسترجاع", "Win-Back Queue")}
              description={select(
                "أعلى العملاء قيمة والهادئين الذين يجب استرجاعهم أولًا.",
                "The highest-value quiet customers to recover first.",
              )}
            >
              {localizedWinBackCandidates.length ? (
                <div className="space-y-3">
                  {localizedWinBackCandidates.map((item) => (
                    <CustomerRecoveryCard
                      key={item.id}
                      item={item}
                      formatCurrency={formatCurrency}
                      formatNumber={formatNumber}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={select("لا توجد قائمة استرجاع", "No win-back queue")}
                  message={select(
                    "عندما يخرج العملاء من نافذة النشاط سيظهرون هنا.",
                    "Once customers age out of the active window, they will appear here.",
                  )}
                />
              )}
            </SectionShell>
          </div>

          <SectionShell
            title={select("محرك الربحية", "Profitability Engine")}
            description={select(
              "منتجات جاهزة للتوسيع، ومنتجات تهرب الربح، ومنتجات ناقص لها تكلفة محفوظة.",
              "Products ready to scale, products leaking margin, and products missing saved cost data.",
            )}
          >
            <div className="grid gap-6 xl:grid-cols-3">
              <ListPanel
                title={select("وسّع الآن", "Scale Now")}
                rows={toArray(profitability.scale_now)}
                emptyTitle={select("لا توجد منتجات جاهزة للتوسيع", "No scale candidates")}
                renderRow={(item) => (
                  <ProductDecisionCard
                    item={item}
                    formatCurrency={formatCurrency}
                    formatNumber={formatNumber}
                    valueLabel={select("الربح الحديث", "Recent Profit")}
                    value={formatCurrency(item.recent_profit || 0)}
                    hint={select(
                      `هامش ${formatPercent(item.recent_margin || 0)} | مخزون ${formatNumber(item.inventory_quantity || 0)}`,
                      `Margin ${formatPercent(item.recent_margin || 0)} | Stock ${formatNumber(item.inventory_quantity || 0)}`,
                    )}
                  />
                )}
              />
              <ListPanel
                title={select("تسريب الربح", "Margin Leaks")}
                rows={toArray(profitability.margin_leaks)}
                emptyTitle={select("لا يوجد تسريب ربح ظاهر", "No margin leaks")}
                renderRow={(item) => (
                  <ProductDecisionCard
                    item={item}
                    formatCurrency={formatCurrency}
                    formatNumber={formatNumber}
                    valueLabel={select("الإيراد الحديث", "Recent Revenue")}
                    value={formatCurrency(item.recent_revenue || 0)}
                    hint={select(
                      `هامش ${formatPercent(item.recent_margin || 0)} | وحدات ${formatNumber(item.sold_units_lookback || 0)}`,
                      `Margin ${formatPercent(item.recent_margin || 0)} | Units ${formatNumber(item.sold_units_lookback || 0)}`,
                    )}
                  />
                )}
              />
              <ListPanel
                title={select("تكاليف ناقصة", "Missing Costs")}
                rows={toArray(profitability.missing_cost_products)}
                emptyTitle={select("كل التكاليف المتابعة مكتملة", "All tracked costs are filled")}
                renderRow={(item) => (
                  <ProductDecisionCard
                    item={item}
                    formatCurrency={formatCurrency}
                    formatNumber={formatNumber}
                    valueLabel={select("إيراد مكشوف", "Revenue Exposed")}
                    value={formatCurrency(item.recent_revenue || 0)}
                    hint={select(
                      `مخزون ${formatNumber(item.inventory_quantity || 0)} | وحدات ${formatNumber(item.sold_units_lookback || 0)}`,
                      `Stock ${formatNumber(item.inventory_quantity || 0)} | Units ${formatNumber(item.sold_units_lookback || 0)}`,
                    )}
                  />
                )}
              />
            </div>
          </SectionShell>
        </div>
      </main>
    </div>
  );
}

function HeroChip({ icon: Icon, label, value }) {
  const { isRTL } = useLocale();

  return (
    <div className="rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
      <div
        className={`flex items-center gap-2 text-xs font-semibold text-slate-500 ${
          isRTL ? "" : "uppercase tracking-[0.18em]"
        }`}
      >
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function SummaryCard({ icon: Icon, title, value, subtitle }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-500">{title}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</div>
          <div className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</div>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function SectionShell({ title, description, children }) {
  return (
    <section className="app-surface rounded-[30px] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-black tracking-tight text-slate-950">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ActionCard({ item }) {
  const { isRTL, select } = useLocale();

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            isRTL ? "" : "uppercase tracking-[0.18em]"
          } ${PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.medium}`}
        >
          {getLocalizedPriorityLabel(item.priority, select)}
        </span>
        <Link to={item.route || "/dashboard"} className="inline-flex items-center gap-2 text-sm font-semibold text-sky-700">
          {select("فتح", "Open")}
          <ArrowRight size={14} className={isRTL ? "rotate-180" : ""} />
        </Link>
      </div>
      <h3 className="mt-4 text-lg font-black tracking-tight text-slate-950">{item.title}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-600">{item.reason}</p>
      <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700">
        {item.action}
      </p>
    </div>
  );
}

function HealthCheckCard({ check }) {
  const { isRTL } = useLocale();

  return (
    <Link
      to={check.route || "/dashboard"}
      className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-500">{check.title}</div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            isRTL ? "" : "uppercase tracking-[0.18em]"
          } ${STATUS_STYLES[check.status] || STATUS_STYLES.watch}`}
        >
          {check.statusLabel || check.status}
        </span>
      </div>
      <div className="mt-4 text-3xl font-black tracking-tight text-slate-950">{check.score}</div>
      <div className="mt-2 text-sm font-semibold text-slate-700">{check.metric}</div>
      <div className="mt-3 text-sm leading-7 text-slate-500">{check.detail}</div>
    </Link>
  );
}

function MiniStat({ label, value }) {
  const { isRTL } = useLocale();

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div
        className={`text-xs font-semibold text-slate-500 ${
          isRTL ? "" : "uppercase tracking-[0.18em]"
        }`}
      >
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function ReplenishmentRow({ item, formatCurrency, formatNumber }) {
  const { select } = useLocale();

  return (
    <Link
      to={item.route || "/products"}
      className="grid gap-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md md:grid-cols-[1.15fr,0.85fr]"
    >
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-lg font-black tracking-tight text-slate-950">{item.title}</div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STOCK_STYLES[item.stock_status] || STOCK_STYLES.watch}`}>
            {getLocalizedStockStatusLabel(item.stock_status, select)}
          </span>
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          {item.stock_status === "out_of_stock"
            ? select(
                "المنتج نافد بالفعل مع وجود طلب واضح عليه.",
                "Already out of stock while demand exists.",
              )
            : item.stock_status === "critical"
              ? select(
                  "المخزون قد ينفد خلال أيام على نفس سرعة البيع الحالية.",
                  "Likely to run out within days at the current sell-through pace.",
                )
              : item.stock_status === "warning"
                ? select(
                    "المخزون منخفض مقارنة بسرعة البيع الحديثة.",
                    "Stock is low relative to recent demand.",
                  )
                : select(
                    "يوجد طلب على المنتج ويحتاج متابعة قريبة.",
                    "Demand exists and this SKU needs monitoring.",
                  )}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label={select("مخزون", "Stock")} value={formatNumber(item.inventory_quantity || 0)} />
        <MiniStat label={select("مباع", "Sold")} value={formatNumber(item.sold_units_lookback || 0)} />
        <MiniStat
          label={select("تغطية", "Cover")}
          value={
            item.days_of_cover === null
              ? select("لا يوجد معدل بيع بعد", "No pace yet")
              : select(
                  `${formatNumber(item.days_of_cover)} يوم`,
                  `${formatNumber(item.days_of_cover)} days`,
                )
          }
        />
        <MiniStat
          label={select("إعادة طلب", "Reorder")}
          value={select(
            `${formatNumber(item.suggested_reorder_units || 0)} وحدة`,
            `${formatNumber(item.suggested_reorder_units || 0)} units`,
          )}
        />
      </div>
      <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <span>{select("إيراد معرض للخطر:", "Revenue at risk:")} {formatCurrency(item.recent_revenue || 0)}</span>
        <span className="font-semibold text-sky-700">{select("فتح المنتج", "Open product")}</span>
      </div>
    </Link>
  );
}

function SegmentCard({ segment, formatCurrency, formatNumber, formatPercent }) {
  const { select } = useLocale();

  return (
    <Link
      to={segment.route || "/customers"}
      className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="text-lg font-black tracking-tight text-slate-950">{segment.title}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <MiniStat label={select("عملاء", "Customers")} value={formatNumber(segment.count || 0)} />
        <MiniStat label={select("إيراد", "Revenue")} value={formatCurrency(segment.revenue || 0)} />
      </div>
      <p className="mt-4 text-sm leading-7 text-slate-500">{segment.note}</p>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <div className="font-semibold">{segment.action}</div>
        <div className="mt-2 text-slate-500">
          {select("نسبة من العملاء:", "Share of customers:")} {formatPercent(segment.share_of_customers || 0)}
        </div>
      </div>
    </Link>
  );
}

function CustomerRecoveryCard({ item, formatCurrency, formatNumber }) {
  const { isRTL, select } = useLocale();

  return (
    <Link
      to="/customers"
      className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base font-bold text-slate-950">{item.name}</div>
          <div className="mt-1 text-sm text-slate-500">
            {item.email || select("لا يوجد بريد مسجل", "No email captured")}
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            isRTL ? "" : "uppercase tracking-[0.18em]"
          } ${PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.medium}`}
        >
          {item.segmentLabel}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label={select("إنفاق", "Spent")} value={formatCurrency(item.total_spent || 0)} />
        <MiniStat label={select("طلبات", "Orders")} value={formatNumber(item.orders_count || 0)} />
        <MiniStat
          label={select("آخر طلب", "Last Order")}
          value={select(
            `${formatNumber(item.last_order_days_ago || 0)} يوم`,
            `${formatNumber(item.last_order_days_ago || 0)} days`,
          )}
        />
      </div>
      <p className="mt-4 text-sm leading-7 text-slate-600">
        {item.suggestedAction || item.suggested_action}
      </p>
    </Link>
  );
}

function ListPanel({ title, rows, renderRow, emptyTitle }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
      <div className="mb-4 text-lg font-black tracking-tight text-slate-950">{title}</div>
      <div className="space-y-3">
        {rows.length ? rows.map(renderRow) : <EmptyState title={emptyTitle} message="" />}
      </div>
    </div>
  );
}

function ProductDecisionCard({
  item,
  valueLabel,
  value,
  hint,
}) {
  return (
    <Link
      to={item.route || "/products"}
      className="block rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="text-base font-bold text-slate-950">{item.title}</div>
      <div className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {valueLabel}
      </div>
      <div className="mt-1 text-lg font-black tracking-tight text-slate-900">{value}</div>
      <div className="mt-3 text-sm leading-7 text-slate-500">{hint}</div>
    </Link>
  );
}
