import axios from "axios";

const META_GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v25.0";
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_DEFAULT_MODEL || "openai/gpt-4o-mini";
const DEFAULT_META_LOOKBACK_DAYS = 30;
const META_API_TIMEOUT_MS = 60 * 1000;
const OPENROUTER_TIMEOUT_MS = 90 * 1000;
const MAX_META_PAGES = 25;
export const META_REFERENCE_LIBRARY = [
  {
    id: "placements",
    title: "Meta placements coverage",
    source_label: "Meta for Business",
    source_url: "https://www.facebook.com/business/ads/ad-creative",
    insight:
      "Meta recommends giving delivery room across placements so the system can find efficient inventory instead of forcing one narrow surface.",
  },
  {
    id: "reels",
    title: "Reels-native creative",
    source_label: "Meta for Business",
    source_url:
      "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
    insight:
      "Meta recommends Reels-native creative: vertical video, early brand or product proof, safe-zone layouts, and creative built for sound-on viewing.",
  },
  {
    id: "structure",
    title: "Ad set structure and learning",
    source_label: "Meta for Business",
    source_url: "https://www.facebook.com/business/ads/ad-set-structure",
    insight:
      "Meta advises simpler account structure with fewer overlapping ad sets and fewer heavy edits so delivery can exit learning more efficiently.",
  },
  {
    id: "testing",
    title: "Creative testing discipline",
    source_label: "Meta for Business",
    source_url: "https://www.facebook.com/business/ads/ad-creative",
    insight:
      "Meta creative guidance favors testing distinct concepts and changing one major variable at a time instead of editing too many things together.",
  },
  {
    id: "measurement",
    title: "Conversions API measurement",
    source_label: "Meta Business Help Center",
    source_url: "https://www.facebook.com/business/help/AboutConversionsAPI",
    insight:
      "Meta states that Conversions API can strengthen measurement quality and attribution continuity across the customer journey.",
  },
];
export const META_PLAYBOOK_NOTES = META_REFERENCE_LIBRARY.map(
  (reference) => reference.insight,
);
const META_REFERENCE_MAP = new Map(
  META_REFERENCE_LIBRARY.map((reference) => [reference.id, reference]),
);
const ACTIVE_META_STATUSES = new Set(["ACTIVE"]);
const ACTION_TYPE_GROUPS = {
  purchases: [
    "purchase",
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_web_purchase",
  ],
  leads: [
    "lead",
    "omni_lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
  ],
  linkClicks: ["link_click", "inline_link_click", "landing_page_view"],
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeText = (value) => String(value || "").trim();
const normalizeSearchText = (value) => normalizeText(value).toLowerCase();
const getMetaReference = (id) =>
  META_REFERENCE_MAP.get(normalizeText(id)) || null;

const createServiceError = (status, publicMessage, details = "") => {
  const error = new Error(details || publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
};

const normalizeAdAccountId = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (normalized.startsWith("act_")) {
    return normalized;
  }

  const digits = normalized.replace(/[^\d]/g, "");
  return digits ? `act_${digits}` : normalized;
};

const parseJsonObject = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
};

const getDateRange = ({
  since,
  until,
  days = DEFAULT_META_LOOKBACK_DAYS,
} = {}) => {
  const normalizedSince = normalizeText(since);
  const normalizedUntil = normalizeText(until);

  if (normalizedSince && normalizedUntil) {
    return {
      since: normalizedSince,
      until: normalizedUntil,
    };
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(
    endDate.getDate() -
      Math.max(1, toNumber(days) || DEFAULT_META_LOOKBACK_DAYS) +
      1,
  );

  return {
    since: startDate.toISOString().slice(0, 10),
    until: endDate.toISOString().slice(0, 10),
  };
};

const buildMetaHeaders = (accessToken) => ({
  Authorization: `Bearer ${accessToken}`,
});

const normalizeMetaRequestError = (error) => {
  if (error?.publicMessage) {
    return error;
  }

  const providerStatus = toNumber(error?.response?.status);
  const providerCode = toNumber(error?.response?.data?.error?.code);
  const providerMessage = normalizeText(
    error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message,
  );
  const normalizedMessage = providerMessage.toLowerCase();

  if (error?.code === "ECONNABORTED") {
    return createServiceError(
      504,
      "Meta API timed out while syncing. Try again in a moment.",
      providerMessage,
    );
  }

  if (!error?.response) {
    return createServiceError(
      502,
      "Could not reach Meta API. Check the connection and try again.",
      providerMessage,
    );
  }

  if (
    providerStatus === 429 ||
    normalizedMessage.includes("application request limit reached") ||
    normalizedMessage.includes("too many calls")
  ) {
    return createServiceError(
      429,
      "Meta rate-limited this account. Wait a moment, then run sync again.",
      providerMessage,
    );
  }

  if (
    providerCode === 190 ||
    normalizedMessage.includes("access token") ||
    normalizedMessage.includes("oauth")
  ) {
    return createServiceError(
      400,
      "Meta rejected the saved access token. Reconnect Meta and try again.",
      providerMessage,
    );
  }

  if (
    providerCode === 10 ||
    providerCode === 200 ||
    normalizedMessage.includes("insufficient permission") ||
    normalizedMessage.includes("permissions error") ||
    normalizedMessage.includes("missing permissions") ||
    normalizedMessage.includes("not authorized")
  ) {
    return createServiceError(
      400,
      "Meta permissions are incomplete for this business or ad account. Check Business Manager access and try again.",
      providerMessage,
    );
  }

  if (
    normalizedMessage.includes("unsupported get request") ||
    normalizedMessage.includes("does not exist") ||
    normalizedMessage.includes("unknown path components") ||
    normalizedMessage.includes("invalid ad account")
  ) {
    return createServiceError(
      400,
      "One of the selected Meta business or ad account IDs is invalid or no longer accessible.",
      providerMessage,
    );
  }

  if (providerStatus >= 500) {
    return createServiceError(
      502,
      "Meta is temporarily unavailable. Try syncing again in a moment.",
      providerMessage,
    );
  }

  return createServiceError(
    400,
    providerMessage ||
      "Meta API request failed. Check the saved Meta configuration and try again.",
    providerMessage,
  );
};

const requestMetaPage = async ({ url, params = {}, accessToken }) => {
  try {
    const response = await axios.get(url, {
      params,
      headers: buildMetaHeaders(accessToken),
      timeout: META_API_TIMEOUT_MS,
    });
    return response.data || {};
  } catch (error) {
    throw normalizeMetaRequestError(error);
  }
};

const fetchMetaPaged = async ({ path, params = {}, accessToken }) => {
  let nextUrl = path.startsWith("http")
    ? path
    : `${META_GRAPH_BASE_URL}${path}`;
  let nextParams = { ...params };
  const rows = [];
  let pageCount = 0;

  while (nextUrl && pageCount < MAX_META_PAGES) {
    const payload = await requestMetaPage({
      url: nextUrl,
      params: nextParams,
      accessToken,
    });

    rows.push(...normalizeArray(payload?.data));
    nextUrl = normalizeText(payload?.paging?.next);
    nextParams = {};
    pageCount += 1;

    if (!nextUrl) {
      break;
    }
  }

  return rows;
};

const extractActionMetric = (items, actionTypes = []) => {
  const normalizedActionTypes = new Set(
    normalizeArray(actionTypes).map((value) =>
      normalizeText(value).toLowerCase(),
    ),
  );

  return normalizeArray(items).reduce((sum, item) => {
    const actionType = normalizeText(item?.action_type).toLowerCase();
    if (!normalizedActionTypes.has(actionType)) {
      return sum;
    }

    return sum + toNumber(item?.value);
  }, 0);
};

const extractMetricValue = (value) => {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => {
      if (item && typeof item === "object") {
        return sum + toNumber(item?.value);
      }

      return sum + toNumber(item);
    }, 0);
  }

  if (value && typeof value === "object") {
    return toNumber(value?.value);
  }

  return toNumber(value);
};

const deriveMetricsFromInsight = (row) => {
  const spend = toNumber(row?.spend);
  const impressions = toNumber(row?.impressions);
  const reach = toNumber(row?.reach);
  const clicks = toNumber(row?.clicks);
  const inlineLinkClicks =
    toNumber(row?.inline_link_clicks) ||
    extractActionMetric(row?.actions, ACTION_TYPE_GROUPS.linkClicks);
  const purchases = extractActionMetric(
    row?.actions,
    ACTION_TYPE_GROUPS.purchases,
  );
  const purchaseValue = extractActionMetric(
    row?.action_values,
    ACTION_TYPE_GROUPS.purchases,
  );
  const leads = extractActionMetric(row?.actions, ACTION_TYPE_GROUPS.leads);
  const videoPlays = extractMetricValue(row?.video_play_actions);
  const thruplays = extractMetricValue(row?.video_30_sec_watched_actions); // Use 30-second video watches instead of thruplays
  const videoP25Watched = extractMetricValue(row?.video_p25_watched_actions);
  const videoP50Watched = extractMetricValue(row?.video_p50_watched_actions);
  const videoP75Watched = extractMetricValue(row?.video_p75_watched_actions);
  const videoP95Watched = extractMetricValue(row?.video_p95_watched_actions);
  const videoP100Watched = extractMetricValue(row?.video_p100_watched_actions);
  const reportedPurchaseRoas = extractActionMetric(
    row?.purchase_roas,
    ACTION_TYPE_GROUPS.purchases,
  );

  const ctr =
    toNumber(row?.ctr) || (impressions > 0 ? (clicks / impressions) * 100 : 0);
  const cpc = toNumber(row?.cpc) || (clicks > 0 ? spend / clicks : 0);
  const cpm =
    toNumber(row?.cpm) || (impressions > 0 ? (spend / impressions) * 1000 : 0);
  const frequency =
    toNumber(row?.frequency) || (reach > 0 ? impressions / reach : 0);
  const linkCtr = impressions > 0 ? (inlineLinkClicks / impressions) * 100 : 0;
  const conversionRate =
    inlineLinkClicks > 0 ? (purchases / inlineLinkClicks) * 100 : 0;
  const leadRate = inlineLinkClicks > 0 ? (leads / inlineLinkClicks) * 100 : 0;
  const costPerPurchase = purchases > 0 ? spend / purchases : 0;
  const costPerLead = leads > 0 ? spend / leads : 0;
  const videoPlayRate = impressions > 0 ? (videoPlays / impressions) * 100 : 0;
  const thruplayRate = impressions > 0 ? (thruplays / impressions) * 100 : 0;
  const videoHoldRate = videoPlays > 0 ? (thruplays / videoPlays) * 100 : 0;
  const videoCompletionRate =
    videoPlays > 0 ? (videoP100Watched / videoPlays) * 100 : 0;
  const roas =
    reportedPurchaseRoas > 0
      ? reportedPurchaseRoas
      : spend > 0
        ? purchaseValue / spend
        : 0;

  return {
    spend,
    impressions,
    reach,
    clicks,
    inline_link_clicks: inlineLinkClicks,
    purchases,
    purchase_value: purchaseValue,
    leads,
    video_plays: videoPlays,
    thruplays,
    video_p25_watched: videoP25Watched,
    video_p50_watched: videoP50Watched,
    video_p75_watched: videoP75Watched,
    video_p95_watched: videoP95Watched,
    video_p100_watched: videoP100Watched,
    ctr,
    link_ctr: linkCtr,
    cpc,
    cpm,
    frequency,
    conversion_rate: conversionRate,
    lead_rate: leadRate,
    cost_per_purchase: costPerPurchase,
    cost_per_lead: costPerLead,
    video_play_rate: videoPlayRate,
    thruplay_rate: thruplayRate,
    video_hold_rate: videoHoldRate,
    video_completion_rate: videoCompletionRate,
    roas,
  };
};

const accumulateMetricSet = (target, metrics) => {
  target.spend += toNumber(metrics?.spend);
  target.impressions += toNumber(metrics?.impressions);
  target.reach += toNumber(metrics?.reach);
  target.clicks += toNumber(metrics?.clicks);
  target.inline_link_clicks += toNumber(metrics?.inline_link_clicks);
  target.purchases += toNumber(metrics?.purchases);
  target.purchase_value += toNumber(metrics?.purchase_value);
  target.leads += toNumber(metrics?.leads);
  target.video_plays += toNumber(metrics?.video_plays);
  target.thruplays += toNumber(metrics?.thruplays);
  target.video_p25_watched += toNumber(metrics?.video_p25_watched);
  target.video_p50_watched += toNumber(metrics?.video_p50_watched);
  target.video_p75_watched += toNumber(metrics?.video_p75_watched);
  target.video_p95_watched += toNumber(metrics?.video_p95_watched);
  target.video_p100_watched += toNumber(metrics?.video_p100_watched);
};

const finalizeMetricSet = (metrics) => {
  const spend = toNumber(metrics?.spend);
  const impressions = toNumber(metrics?.impressions);
  const clicks = toNumber(metrics?.clicks);
  const reach = toNumber(metrics?.reach);
  const inlineLinkClicks = toNumber(metrics?.inline_link_clicks);
  const purchases = toNumber(metrics?.purchases);
  const leads = toNumber(metrics?.leads);
  const purchaseValue = toNumber(metrics?.purchase_value);
  const videoPlays = toNumber(metrics?.video_plays);
  const thruplays = toNumber(metrics?.thruplays);
  const videoP100Watched = toNumber(metrics?.video_p100_watched);

  return {
    ...metrics,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    link_ctr: impressions > 0 ? (inlineLinkClicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    frequency: reach > 0 ? impressions / reach : 0,
    conversion_rate:
      inlineLinkClicks > 0 ? (purchases / inlineLinkClicks) * 100 : 0,
    lead_rate: inlineLinkClicks > 0 ? (leads / inlineLinkClicks) * 100 : 0,
    cost_per_purchase: purchases > 0 ? spend / purchases : 0,
    cost_per_lead: leads > 0 ? spend / leads : 0,
    video_play_rate: impressions > 0 ? (videoPlays / impressions) * 100 : 0,
    thruplay_rate: impressions > 0 ? (thruplays / impressions) * 100 : 0,
    video_hold_rate: videoPlays > 0 ? (thruplays / videoPlays) * 100 : 0,
    video_completion_rate:
      videoPlays > 0 ? (videoP100Watched / videoPlays) * 100 : 0,
    roas: spend > 0 ? purchaseValue / spend : 0,
  };
};

const buildAggregateBucket = (id, name, extra = {}) => ({
  id,
  name,
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  inline_link_clicks: 0,
  purchases: 0,
  purchase_value: 0,
  leads: 0,
  video_plays: 0,
  thruplays: 0,
  video_p25_watched: 0,
  video_p50_watched: 0,
  video_p75_watched: 0,
  video_p95_watched: 0,
  video_p100_watched: 0,
  ...extra,
});

export const aggregateMetaSnapshotRows = (rows = []) => {
  const totals = buildAggregateBucket("summary", "Summary");
  const accounts = new Map();
  const campaigns = new Map();
  const adsets = new Map();
  const ads = new Map();
  const daily = new Map();

  for (const row of normalizeArray(rows)) {
    const metrics = finalizeMetricSet(parseJsonObject(row?.metrics, {}));
    const rawPayload = parseJsonObject(row?.raw_payload, {});
    const campaignMeta = parseJsonObject(rawPayload?.campaign, {});
    const adsetMeta = parseJsonObject(rawPayload?.adset, {});
    const adMeta = parseJsonObject(rawPayload?.ad, {});
    const accountId = normalizeText(row?.account_id);
    const campaignId = normalizeText(row?.campaign_id);
    const adsetId = normalizeText(row?.adset_id);
    const adId = normalizeText(row?.ad_id);
    const dateStart = normalizeText(row?.date_start);

    accumulateMetricSet(totals, metrics);

    if (accountId) {
      if (!accounts.has(accountId)) {
        accounts.set(
          accountId,
          buildAggregateBucket(accountId, row?.account_name || accountId, {
            currency: row?.currency || null,
            account_status: normalizeText(rawPayload?.account_status) || null,
          }),
        );
      }
      accumulateMetricSet(accounts.get(accountId), metrics);
    }

    if (campaignId) {
      if (!campaigns.has(campaignId)) {
        campaigns.set(
          campaignId,
          buildAggregateBucket(campaignId, row?.campaign_name || campaignId, {
            account_id: accountId || null,
            objective: row?.objective || campaignMeta?.objective || null,
            status: normalizeText(campaignMeta?.status) || null,
            effective_status:
              normalizeText(campaignMeta?.effective_status) || null,
            daily_budget: toNumber(campaignMeta?.daily_budget),
            lifetime_budget: toNumber(campaignMeta?.lifetime_budget),
            start_time: normalizeText(campaignMeta?.start_time) || null,
            stop_time: normalizeText(campaignMeta?.stop_time) || null,
            updated_time: normalizeText(campaignMeta?.updated_time) || null,
          }),
        );
      }
      accumulateMetricSet(campaigns.get(campaignId), metrics);
    }

    if (adsetId) {
      if (!adsets.has(adsetId)) {
        adsets.set(
          adsetId,
          buildAggregateBucket(adsetId, row?.adset_name || adsetId, {
            account_id: accountId || null,
            campaign_id: campaignId || null,
            status: normalizeText(adsetMeta?.status) || null,
            effective_status:
              normalizeText(adsetMeta?.effective_status) || null,
            optimization_goal:
              normalizeText(adsetMeta?.optimization_goal) || null,
            billing_event: normalizeText(adsetMeta?.billing_event) || null,
            daily_budget: toNumber(adsetMeta?.daily_budget),
            lifetime_budget: toNumber(adsetMeta?.lifetime_budget),
            start_time: normalizeText(adsetMeta?.start_time) || null,
            end_time: normalizeText(adsetMeta?.end_time) || null,
            updated_time: normalizeText(adsetMeta?.updated_time) || null,
          }),
        );
      }
      accumulateMetricSet(adsets.get(adsetId), metrics);
    }

    if (adId) {
      if (!ads.has(adId)) {
        ads.set(
          adId,
          buildAggregateBucket(adId, row?.ad_name || adId, {
            account_id: accountId || null,
            campaign_id: campaignId || null,
            adset_id: adsetId || null,
            status: normalizeText(adMeta?.status) || null,
            effective_status: normalizeText(adMeta?.effective_status) || null,
            updated_time: normalizeText(adMeta?.updated_time) || null,
          }),
        );
      }
      accumulateMetricSet(ads.get(adId), metrics);
    }

    if (dateStart) {
      if (!daily.has(dateStart)) {
        daily.set(dateStart, buildAggregateBucket(dateStart, dateStart));
      }
      accumulateMetricSet(daily.get(dateStart), metrics);
    }
  }

  const sortBySpendDesc = (left, right) => right.spend - left.spend;

  return {
    summary: finalizeMetricSet({
      spend: totals.spend,
      impressions: totals.impressions,
      reach: totals.reach,
      clicks: totals.clicks,
      inline_link_clicks: totals.inline_link_clicks,
      purchases: totals.purchases,
      purchase_value: totals.purchase_value,
      leads: totals.leads,
      video_plays: totals.video_plays,
      thruplays: totals.thruplays,
      video_p25_watched: totals.video_p25_watched,
      video_p50_watched: totals.video_p50_watched,
      video_p75_watched: totals.video_p75_watched,
      video_p95_watched: totals.video_p95_watched,
      video_p100_watched: totals.video_p100_watched,
      accounts_count: accounts.size,
      campaigns_count: campaigns.size,
      adsets_count: adsets.size,
      ads_count: ads.size,
      rows_count: normalizeArray(rows).length,
    }),
    accounts: Array.from(accounts.values())
      .map((item) => finalizeMetricSet(item))
      .sort(sortBySpendDesc),
    campaigns: Array.from(campaigns.values())
      .map((item) => finalizeMetricSet(item))
      .sort(sortBySpendDesc),
    adsets: Array.from(adsets.values())
      .map((item) => finalizeMetricSet(item))
      .sort(sortBySpendDesc),
    ads: Array.from(ads.values())
      .map((item) => finalizeMetricSet(item))
      .sort(sortBySpendDesc),
    daily: Array.from(daily.values())
      .map((item) => finalizeMetricSet(item))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
};

const normalizeAccountRow = (row) => ({
  id: normalizeAdAccountId(row?.object_id || row?.id || row?.account_id),
  account_id: normalizeText(row?.account_id || row?.object_id || row?.id),
  name:
    normalizeText(row?.name || row?.account_name || row?.object_name) ||
    normalizeAdAccountId(row?.object_id || row?.id || row?.account_id),
  currency: normalizeText(row?.currency) || null,
  timezone_name: normalizeText(row?.timezone_name) || null,
  account_status: normalizeText(row?.account_status) || null,
});

const normalizeMetaStatus = (value) => normalizeText(value).toUpperCase();

const isMetaEntityActive = (effectiveStatus, status) => {
  const normalizedEffectiveStatus = normalizeMetaStatus(effectiveStatus);
  const normalizedStatus = normalizeMetaStatus(status);

  if (normalizedEffectiveStatus) {
    return ACTIVE_META_STATUSES.has(normalizedEffectiveStatus);
  }

  return ACTIVE_META_STATUSES.has(normalizedStatus);
};

const buildZeroMetricRow = (extra = {}) =>
  finalizeMetricSet({
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    inline_link_clicks: 0,
    purchases: 0,
    purchase_value: 0,
    leads: 0,
    video_plays: 0,
    thruplays: 0,
    video_p25_watched: 0,
    video_p50_watched: 0,
    video_p75_watched: 0,
    video_p95_watched: 0,
    video_p100_watched: 0,
    ...extra,
  });

const normalizeCampaignRow = (row) => {
  const campaignId =
    normalizeText(row?.campaign_id || row?.id || row?.object_id) || null;

  return {
    id: campaignId,
    campaign_id: campaignId,
    account_id: normalizeText(row?.account_id) || null,
    name:
      normalizeText(row?.name || row?.campaign_name || row?.object_name) ||
      campaignId,
    objective: normalizeText(row?.objective) || null,
    status: normalizeText(row?.status) || null,
    effective_status: normalizeText(row?.effective_status) || null,
    is_active: isMetaEntityActive(row?.effective_status, row?.status),
    daily_budget: toNumber(row?.daily_budget),
    lifetime_budget: toNumber(row?.lifetime_budget),
    start_time: normalizeText(row?.start_time) || null,
    stop_time: normalizeText(row?.stop_time) || null,
    updated_time: normalizeText(row?.updated_time) || null,
  };
};

const normalizeAdSetRow = (row) => {
  const adsetId =
    normalizeText(row?.adset_id || row?.id || row?.object_id) || null;

  return {
    id: adsetId,
    adset_id: adsetId,
    account_id: normalizeText(row?.account_id) || null,
    campaign_id: normalizeText(row?.campaign_id) || null,
    name:
      normalizeText(row?.name || row?.adset_name || row?.object_name) ||
      adsetId,
    status: normalizeText(row?.status) || null,
    effective_status: normalizeText(row?.effective_status) || null,
    is_active: isMetaEntityActive(row?.effective_status, row?.status),
    optimization_goal: normalizeText(row?.optimization_goal) || null,
    billing_event: normalizeText(row?.billing_event) || null,
    daily_budget: toNumber(row?.daily_budget),
    lifetime_budget: toNumber(row?.lifetime_budget),
    start_time: normalizeText(row?.start_time) || null,
    end_time: normalizeText(row?.end_time) || null,
    updated_time: normalizeText(row?.updated_time) || null,
  };
};

const normalizeAdRow = (row) => {
  const adId = normalizeText(row?.ad_id || row?.id || row?.object_id) || null;

  return {
    id: adId,
    ad_id: adId,
    account_id: normalizeText(row?.account_id) || null,
    campaign_id: normalizeText(row?.campaign_id) || null,
    adset_id: normalizeText(row?.adset_id) || null,
    name: normalizeText(row?.name || row?.ad_name || row?.object_name) || adId,
    status: normalizeText(row?.status) || null,
    effective_status: normalizeText(row?.effective_status) || null,
    is_active: isMetaEntityActive(row?.effective_status, row?.status),
    updated_time: normalizeText(row?.updated_time) || null,
  };
};

const mergeEntityCollections = ({
  catalogRows = [],
  metricRows = [],
  normalizeRow,
}) => {
  const merged = [];
  const seen = new Set();
  const metricsById = new Map(
    normalizeArray(metricRows).map((row) => [normalizeText(row?.id), row]),
  );

  for (const catalogRow of normalizeArray(catalogRows)) {
    const normalizedCatalogRow = normalizeRow(catalogRow);
    const id = normalizeText(normalizedCatalogRow?.id);
    if (!id) {
      continue;
    }

    const metricRow = metricsById.get(id);
    merged.push({
      ...buildZeroMetricRow(normalizedCatalogRow),
      ...(metricRow || {}),
      ...normalizedCatalogRow,
      ...(metricRow || {}),
      is_active:
        typeof metricRow?.is_active === "boolean"
          ? metricRow.is_active
          : normalizedCatalogRow.is_active,
      status:
        normalizeText(metricRow?.status) || normalizedCatalogRow.status || null,
      effective_status:
        normalizeText(metricRow?.effective_status) ||
        normalizedCatalogRow.effective_status ||
        null,
    });
    seen.add(id);
  }

  for (const metricRow of normalizeArray(metricRows)) {
    const id = normalizeText(metricRow?.id);
    if (!id || seen.has(id)) {
      continue;
    }

    const normalizedMetricRow = normalizeRow(metricRow);
    merged.push({
      ...buildZeroMetricRow(normalizedMetricRow),
      ...normalizedMetricRow,
      ...metricRow,
      is_active:
        typeof metricRow?.is_active === "boolean"
          ? metricRow.is_active
          : normalizedMetricRow.is_active,
    });
  }

  return merged.sort((left, right) => {
    if (Boolean(left?.is_active) !== Boolean(right?.is_active)) {
      return left?.is_active ? -1 : 1;
    }

    const spendDiff = toNumber(right?.spend) - toNumber(left?.spend);
    if (spendDiff !== 0) {
      return spendDiff;
    }

    return normalizeText(left?.name).localeCompare(normalizeText(right?.name));
  });
};

export const buildMetaEntityCatalogRows = ({
  integrationId,
  storeId,
  account,
  campaigns = [],
  adsets = [],
  ads = [],
}) => {
  const normalizedAccount = normalizeAccountRow(account);
  const syncedAt = new Date().toISOString();

  return [
    {
      integration_id: integrationId,
      store_id: storeId,
      object_type: "account",
      object_id: normalizedAccount.id,
      name: normalizedAccount.name,
      account_id: normalizedAccount.account_id,
      account_name: normalizedAccount.name,
      status: normalizeText(account?.account_status),
      effective_status: normalizeText(account?.account_status),
      is_active: isMetaEntityActive(
        account?.account_status,
        account?.account_status,
      ),
      currency: normalizeText(account?.currency),
      timezone_name: normalizeText(account?.timezone_name),
      raw_payload: account || {},
      synced_at: syncedAt,
      updated_time: normalizeText(account?.updated_time) || null,
    },
    ...normalizeArray(campaigns).map((campaign) => ({
      integration_id: integrationId,
      store_id: storeId,
      object_type: "campaign",
      object_id: normalizeText(campaign?.id),
      name: normalizeText(campaign?.name) || normalizeText(campaign?.id),
      account_id: normalizedAccount.id,
      account_name: normalizedAccount.name,
      campaign_id: normalizeText(campaign?.id),
      campaign_name: normalizeText(campaign?.name),
      objective: normalizeText(campaign?.objective),
      status: normalizeText(campaign?.status),
      effective_status: normalizeText(campaign?.effective_status),
      is_active: isMetaEntityActive(
        campaign?.effective_status,
        campaign?.status,
      ),
      currency: normalizeText(account?.currency),
      daily_budget: toNumber(campaign?.daily_budget),
      lifetime_budget: toNumber(campaign?.lifetime_budget),
      start_time: normalizeText(campaign?.start_time) || null,
      stop_time: normalizeText(campaign?.stop_time) || null,
      updated_time: normalizeText(campaign?.updated_time) || null,
      raw_payload: campaign || {},
      synced_at: syncedAt,
    })),
    ...normalizeArray(adsets).map((adset) => ({
      integration_id: integrationId,
      store_id: storeId,
      object_type: "adset",
      object_id: normalizeText(adset?.id),
      name: normalizeText(adset?.name) || normalizeText(adset?.id),
      account_id: normalizedAccount.id,
      account_name: normalizedAccount.name,
      campaign_id: normalizeText(adset?.campaign_id),
      adset_id: normalizeText(adset?.id),
      adset_name: normalizeText(adset?.name),
      status: normalizeText(adset?.status),
      effective_status: normalizeText(adset?.effective_status),
      is_active: isMetaEntityActive(adset?.effective_status, adset?.status),
      currency: normalizeText(account?.currency),
      optimization_goal: normalizeText(adset?.optimization_goal),
      billing_event: normalizeText(adset?.billing_event),
      daily_budget: toNumber(adset?.daily_budget),
      lifetime_budget: toNumber(adset?.lifetime_budget),
      start_time: normalizeText(adset?.start_time) || null,
      end_time: normalizeText(adset?.end_time) || null,
      updated_time: normalizeText(adset?.updated_time) || null,
      raw_payload: adset || {},
      synced_at: syncedAt,
    })),
    ...normalizeArray(ads).map((ad) => ({
      integration_id: integrationId,
      store_id: storeId,
      object_type: "ad",
      object_id: normalizeText(ad?.id),
      name: normalizeText(ad?.name) || normalizeText(ad?.id),
      account_id: normalizedAccount.id,
      account_name: normalizedAccount.name,
      campaign_id: normalizeText(ad?.campaign_id),
      adset_id: normalizeText(ad?.adset_id),
      ad_id: normalizeText(ad?.id),
      ad_name: normalizeText(ad?.name),
      status: normalizeText(ad?.status),
      effective_status: normalizeText(ad?.effective_status),
      is_active: isMetaEntityActive(ad?.effective_status, ad?.status),
      currency: normalizeText(account?.currency),
      updated_time: normalizeText(ad?.updated_time) || null,
      raw_payload: ad || {},
      synced_at: syncedAt,
    })),
  ].filter((row) => normalizeText(row?.object_id));
};

export const fetchMetaAdAccounts = async ({
  accessToken,
  businessId = "",
  adAccountIds = [],
}) => {
  const normalizedBusinessId = normalizeText(businessId);
  const fields = [
    "id",
    "account_id",
    "name",
    "currency",
    "timezone_name",
    "account_status",
  ].join(",");

  let accounts = [];
  if (normalizedBusinessId) {
    accounts = await fetchMetaPaged({
      path: `/${normalizedBusinessId}/owned_ad_accounts`,
      params: { fields, limit: 100 },
      accessToken,
    });
  }

  if (accounts.length === 0) {
    accounts = await fetchMetaPaged({
      path: "/me/adaccounts",
      params: { fields, limit: 100 },
      accessToken,
    });
  }

  const normalizedAccounts = accounts.map(normalizeAccountRow);
  const selectedIds = new Set(
    normalizeArray(adAccountIds).map((value) => normalizeAdAccountId(value)),
  );

  if (selectedIds.size === 0) {
    return normalizedAccounts;
  }

  const selectedAccounts = normalizedAccounts.filter((account) =>
    selectedIds.has(account.id),
  );

  if (selectedAccounts.length > 0) {
    return selectedAccounts;
  }

  return Array.from(selectedIds).map((accountId) => ({
    id: accountId,
    account_id: accountId.replace(/^act_/, ""),
    name: accountId,
    currency: null,
    timezone_name: null,
    account_status: null,
  }));
};

const fetchAccountCollection = async ({
  accessToken,
  adAccountId,
  edge,
  fields,
}) =>
  fetchMetaPaged({
    path: `/${normalizeAdAccountId(adAccountId)}/${edge}`,
    params: {
      fields: normalizeArray(fields).join(","),
      limit: 200,
    },
    accessToken,
  });

export const fetchMetaCampaigns = async ({ accessToken, adAccountId }) =>
  fetchAccountCollection({
    accessToken,
    adAccountId,
    edge: "campaigns",
    fields: [
      "id",
      "name",
      "status",
      "effective_status",
      "objective",
      "daily_budget",
      "lifetime_budget",
      "start_time",
      "stop_time",
      "updated_time",
    ],
  });

export const fetchMetaAdSets = async ({ accessToken, adAccountId }) =>
  fetchAccountCollection({
    accessToken,
    adAccountId,
    edge: "adsets",
    fields: [
      "id",
      "name",
      "status",
      "effective_status",
      "campaign_id",
      "optimization_goal",
      "billing_event",
      "daily_budget",
      "lifetime_budget",
      "start_time",
      "end_time",
      "updated_time",
    ],
  });

export const fetchMetaAds = async ({ accessToken, adAccountId }) =>
  fetchAccountCollection({
    accessToken,
    adAccountId,
    edge: "ads",
    fields: [
      "id",
      "name",
      "status",
      "effective_status",
      "campaign_id",
      "adset_id",
      "updated_time",
    ],
  });

export const fetchMetaInsightsForAccount = async ({
  accessToken,
  adAccountId,
  since,
  until,
}) => {
  const fields = [
    "account_id",
    "account_name",
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "objective",
    "spend",
    "impressions",
    "reach",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "frequency",
    "inline_link_clicks",
    "actions",
    "action_values",
    "cost_per_action_type",
    "purchase_roas",
    "video_play_actions",
    "video_p25_watched_actions",
    "video_p50_watched_actions",
    "video_p75_watched_actions",
    "video_p95_watched_actions",
    "video_p100_watched_actions",
    "video_30_sec_watched_actions",
    "date_start",
    "date_stop",
  ].join(",");

  return fetchMetaPaged({
    path: `/${normalizeAdAccountId(adAccountId)}/insights`,
    params: {
      fields,
      level: "ad",
      time_increment: 1,
      time_range: JSON.stringify({
        since,
        until,
      }),
      limit: 250,
    },
    accessToken,
  });
};

export const buildMetaInsightSnapshots = ({
  integrationId,
  storeId,
  account,
  insightRows,
  campaigns = [],
  adsets = [],
  ads = [],
}) => {
  const campaignsById = new Map(
    normalizeArray(campaigns).map((item) => [normalizeText(item?.id), item]),
  );
  const adsetsById = new Map(
    normalizeArray(adsets).map((item) => [normalizeText(item?.id), item]),
  );
  const adsById = new Map(
    normalizeArray(ads).map((item) => [normalizeText(item?.id), item]),
  );

  return normalizeArray(insightRows).map((row) => {
    const campaignId = normalizeText(row?.campaign_id);
    const adsetId = normalizeText(row?.adset_id);
    const adId = normalizeText(row?.ad_id);

    return {
      integration_id: integrationId,
      store_id: storeId,
      object_type: "ad",
      object_id: adId || campaignId || account?.id,
      object_name:
        normalizeText(row?.ad_name) ||
        normalizeText(row?.campaign_name) ||
        account?.name ||
        "Unnamed",
      level: "ad",
      account_id: normalizeText(row?.account_id) || account?.id || null,
      account_name: normalizeText(row?.account_name) || account?.name || null,
      campaign_id: campaignId || null,
      campaign_name: normalizeText(row?.campaign_name) || null,
      adset_id: adsetId || null,
      adset_name: normalizeText(row?.adset_name) || null,
      ad_id: adId || null,
      ad_name: normalizeText(row?.ad_name) || null,
      objective: normalizeText(row?.objective) || null,
      currency: normalizeText(account?.currency) || null,
      date_start: normalizeText(row?.date_start) || null,
      date_stop: normalizeText(row?.date_stop) || null,
      metrics: deriveMetricsFromInsight(row),
      raw_payload: {
        insight: row,
        account_status: account?.account_status || null,
        campaign: campaignsById.get(campaignId) || null,
        adset: adsetsById.get(adsetId) || null,
        ad: adsById.get(adId) || null,
      },
      synced_at: new Date().toISOString(),
    };
  });
};

export const buildMetaOverview = ({
  snapshots = [],
  accounts = [],
  campaigns = [],
  adsets = [],
  ads = [],
}) => {
  const aggregate = aggregateMetaSnapshotRows(snapshots);
  const mergedAccounts = mergeEntityCollections({
    catalogRows: accounts,
    metricRows: aggregate.accounts,
    normalizeRow: normalizeAccountRow,
  });
  const mergedCampaigns = mergeEntityCollections({
    catalogRows: campaigns,
    metricRows: aggregate.campaigns,
    normalizeRow: normalizeCampaignRow,
  });
  const mergedAdsets = mergeEntityCollections({
    catalogRows: adsets,
    metricRows: aggregate.adsets,
    normalizeRow: normalizeAdSetRow,
  });
  const mergedAds = mergeEntityCollections({
    catalogRows: ads,
    metricRows: aggregate.ads,
    normalizeRow: normalizeAdRow,
  });
  const summary = {
    ...aggregate.summary,
    accounts_count: mergedAccounts.length,
    campaigns_count: mergedCampaigns.length,
    adsets_count: mergedAdsets.length,
    ads_count: mergedAds.length,
    active_accounts_count: mergedAccounts.filter((item) => item?.is_active)
      .length,
    active_campaigns_count: mergedCampaigns.filter((item) => item?.is_active)
      .length,
    active_adsets_count: mergedAdsets.filter((item) => item?.is_active).length,
    active_ads_count: mergedAds.filter((item) => item?.is_active).length,
  };

  return {
    summary,
    daily: aggregate.daily,
    accounts: mergedAccounts,
    campaigns: mergedCampaigns,
    adsets: mergedAdsets,
    ads: mergedAds,
  };
};

const median = (values = []) => {
  const sorted = normalizeArray(values)
    .map((value) => toNumber(value))
    .filter((value) => value > 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return 0;
  }

  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middleIndex];
  }

  return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
};

const toFixedMetric = (value, digits = 2) =>
  Number(toNumber(value).toFixed(digits));

const buildMetaBenchmarks = ({ overview = {}, storeSnapshot = {} }) => {
  const summary = overview?.summary || {};
  const financial = storeSnapshot?.financial || {};
  const campaigns = normalizeArray(overview?.campaigns);
  const spendValues = campaigns.map((campaign) => campaign?.spend);
  const medianCampaignSpend = median(spendValues);
  const averageOrderValue = toNumber(financial?.average_order_value);
  const accountCostPerPurchase = toNumber(summary?.cost_per_purchase);
  const spendGateCandidates = [
    averageOrderValue > 0 ? averageOrderValue * 0.5 : 0,
    accountCostPerPurchase > 0 ? accountCostPerPurchase * 0.75 : 0,
    medianCampaignSpend > 0 ? medianCampaignSpend * 0.7 : 0,
    30,
  ].filter((value) => value > 0);

  return {
    roas: Math.max(0, toNumber(summary?.roas)),
    ctr: Math.max(0, toNumber(summary?.ctr)),
    link_ctr: Math.max(0, toNumber(summary?.link_ctr)),
    conversion_rate: Math.max(0, toNumber(summary?.conversion_rate)),
    cpm: Math.max(0, toNumber(summary?.cpm)),
    frequency: Math.max(0, toNumber(summary?.frequency)),
    cost_per_purchase: Math.max(0, accountCostPerPurchase),
    average_order_value: Math.max(0, averageOrderValue),
    spend_gate: Math.max(20, Math.min(...spendGateCandidates)),
    high_frequency: 3.5,
    min_link_ctr: Math.max(0.9, toNumber(summary?.link_ctr) * 0.8),
    strong_link_ctr: Math.max(1.2, toNumber(summary?.link_ctr) * 1.1),
    min_conversion_rate: Math.max(1, toNumber(summary?.conversion_rate) * 0.8),
    strong_conversion_rate: Math.max(
      2,
      toNumber(summary?.conversion_rate) * 1.1,
    ),
    scale_roas: Math.max(1.8, toNumber(summary?.roas) * 1.15),
    keep_roas: Math.max(1.2, toNumber(summary?.roas) * 0.85),
    pause_roas: Math.max(0.8, toNumber(summary?.roas) * 0.65),
    low_video_hold_rate: 20,
    low_video_completion_rate: 8,
  };
};

const buildDriverText = (key, actual, benchmark) => {
  const actualMetric = toFixedMetric(actual);
  const benchmarkMetric = toFixedMetric(benchmark);

  switch (key) {
    case "strong_roas":
      return `ROAS ${actualMetric}x beats the account baseline ${benchmarkMetric}x.`;
    case "strong_link_ctr":
      return `Link CTR ${actualMetric}% is stronger than the account baseline ${benchmarkMetric}%.`;
    case "strong_conversion_rate":
      return `Post-click conversion rate ${actualMetric}% is stronger than the baseline ${benchmarkMetric}%.`;
    case "controlled_frequency":
      return `Frequency ${actualMetric} is still controlled.`;
    case "low_link_ctr":
      return `Link CTR ${actualMetric}% is weak versus the baseline ${benchmarkMetric}%.`;
    case "low_conversion_rate":
      return `Conversion rate ${actualMetric}% is below the baseline ${benchmarkMetric}%.`;
    case "high_frequency":
      return `Frequency ${actualMetric} suggests fatigue or audience saturation.`;
    case "expensive_traffic":
      return `CPM ${actualMetric} is elevated versus the baseline ${benchmarkMetric}.`;
    case "weak_video_hold":
      return `Video hold rate ${actualMetric}% is weak after the initial play.`;
    case "low_video_completion":
      return `Video completion rate ${actualMetric}% is low, so the core message may land too late.`;
    case "no_conversion":
      return `Spend ${actualMetric} reached the decision threshold ${benchmarkMetric} with no purchases.`;
    default:
      return "";
  }
};

const buildPerformanceDrivers = (row, benchmarks) => {
  const drivers = [];
  const spend = toNumber(row?.spend);
  const roas = toNumber(row?.roas);
  const linkCtr = toNumber(row?.link_ctr);
  const conversionRate = toNumber(row?.conversion_rate);
  const frequency = toNumber(row?.frequency);
  const cpm = toNumber(row?.cpm);
  const videoHoldRate = toNumber(row?.video_hold_rate);
  const videoCompletionRate = toNumber(row?.video_completion_rate);
  const purchases = toNumber(row?.purchases);

  if (roas >= benchmarks.scale_roas) {
    drivers.push({
      key: "strong_roas",
      actual: roas,
      benchmark: benchmarks.scale_roas,
    });
  }
  if (linkCtr >= benchmarks.strong_link_ctr) {
    drivers.push({
      key: "strong_link_ctr",
      actual: linkCtr,
      benchmark: benchmarks.strong_link_ctr,
    });
  }
  if (conversionRate >= benchmarks.strong_conversion_rate) {
    drivers.push({
      key: "strong_conversion_rate",
      actual: conversionRate,
      benchmark: benchmarks.strong_conversion_rate,
    });
  }
  if (frequency > 0 && frequency < benchmarks.high_frequency) {
    drivers.push({
      key: "controlled_frequency",
      actual: frequency,
      benchmark: benchmarks.high_frequency,
    });
  }
  if (linkCtr > 0 && linkCtr < benchmarks.min_link_ctr) {
    drivers.push({
      key: "low_link_ctr",
      actual: linkCtr,
      benchmark: benchmarks.min_link_ctr,
    });
  }
  if (conversionRate > 0 && conversionRate < benchmarks.min_conversion_rate) {
    drivers.push({
      key: "low_conversion_rate",
      actual: conversionRate,
      benchmark: benchmarks.min_conversion_rate,
    });
  }
  if (frequency >= benchmarks.high_frequency) {
    drivers.push({
      key: "high_frequency",
      actual: frequency,
      benchmark: benchmarks.high_frequency,
    });
  }
  if (cpm > benchmarks.cpm * 1.25 && linkCtr < benchmarks.strong_link_ctr) {
    drivers.push({
      key: "expensive_traffic",
      actual: cpm,
      benchmark: benchmarks.cpm,
    });
  }
  if (videoHoldRate > 0 && videoHoldRate < benchmarks.low_video_hold_rate) {
    drivers.push({
      key: "weak_video_hold",
      actual: videoHoldRate,
      benchmark: benchmarks.low_video_hold_rate,
    });
  }
  if (
    videoCompletionRate > 0 &&
    videoCompletionRate < benchmarks.low_video_completion_rate
  ) {
    drivers.push({
      key: "low_video_completion",
      actual: videoCompletionRate,
      benchmark: benchmarks.low_video_completion_rate,
    });
  }
  if (purchases === 0 && spend >= benchmarks.spend_gate) {
    drivers.push({
      key: "no_conversion",
      actual: spend,
      benchmark: benchmarks.spend_gate,
    });
  }

  return drivers;
};

const buildDecisionActionText = (decision, primaryIssue = "") => {
  if (decision === "scale") {
    return "Increase budget 10-15% and keep the current winner stable for one more learning cycle.";
  }

  if (decision === "pause") {
    if (primaryIssue === "creative") {
      return "Pause this asset and replace the creative before spending more.";
    }
    if (primaryIssue === "conversion") {
      return "Pause or sharply cut spend until the offer, landing page, or product-page match improves.";
    }
    return "Pause this item now and redirect budget to stronger winners.";
  }

  if (decision === "test") {
    if (primaryIssue === "fatigue") {
      return "Keep delivery controlled, but launch fresh creative and audience angles before scaling.";
    }
    if (primaryIssue === "creative") {
      return "Test a new hook, shorter opening, and clearer product proof before increasing spend.";
    }
    if (primaryIssue === "conversion") {
      return "Keep spend constrained and test the offer, CTA, price framing, or landing page match.";
    }
    return "Run one focused test before making a bigger budget decision.";
  }

  return "Keep running and monitor efficiency before making larger changes.";
};

const buildDecisionRow = ({ row, level, benchmarks }) => {
  const spend = toNumber(row?.spend);
  const purchases = toNumber(row?.purchases);
  const roas = toNumber(row?.roas);
  const linkCtr = toNumber(row?.link_ctr);
  const conversionRate = toNumber(row?.conversion_rate);
  const frequency = toNumber(row?.frequency);
  const drivers = buildPerformanceDrivers(row, benchmarks);
  const negativeKeys = new Set(
    drivers
      .map((driver) => driver.key)
      .filter(
        (key) =>
          key.startsWith("low_") ||
          key.startsWith("high_") ||
          key === "no_conversion" ||
          key === "weak_video_hold" ||
          key === "expensive_traffic",
      ),
  );
  const scalePurchaseFloor =
    level === "campaign" ? 3 : level === "adset" ? 2 : 1;
  const enoughSpend = spend >= benchmarks.spend_gate;
  const enoughData =
    enoughSpend ||
    purchases >= 1 ||
    toNumber(row?.inline_link_clicks) >= 20 ||
    toNumber(row?.clicks) >= 30;

  let decision = "keep";
  let confidence = "medium";

  if (
    purchases >= scalePurchaseFloor &&
    roas >= benchmarks.scale_roas &&
    conversionRate >= benchmarks.min_conversion_rate &&
    frequency > 0 &&
    frequency < benchmarks.high_frequency
  ) {
    decision = "scale";
    confidence = "high";
  } else if (
    enoughSpend &&
    ((purchases === 0 &&
      (linkCtr < benchmarks.min_link_ctr ||
        conversionRate < benchmarks.min_conversion_rate ||
        negativeKeys.has("weak_video_hold"))) ||
      (purchases > 0 && roas < benchmarks.pause_roas))
  ) {
    decision = "pause";
    confidence = purchases > 0 ? "high" : "medium";
  } else if (!enoughData) {
    decision = "keep";
    confidence = "low";
  } else if (
    negativeKeys.has("high_frequency") ||
    negativeKeys.has("low_link_ctr") ||
    negativeKeys.has("low_conversion_rate") ||
    negativeKeys.has("weak_video_hold") ||
    negativeKeys.has("low_video_completion") ||
    negativeKeys.has("expensive_traffic")
  ) {
    decision = "test";
    confidence = "medium";
  } else if (roas >= benchmarks.keep_roas) {
    decision = "keep";
    confidence = purchases >= 1 ? "medium" : "low";
  }

  const primaryIssue = negativeKeys.has("high_frequency")
    ? "fatigue"
    : negativeKeys.has("weak_video_hold") || negativeKeys.has("low_link_ctr")
      ? "creative"
      : negativeKeys.has("low_conversion_rate") ||
          negativeKeys.has("no_conversion")
        ? "conversion"
        : negativeKeys.has("expensive_traffic")
          ? "cost"
          : decision === "scale"
            ? "winner"
            : "mixed";

  const why = drivers
    .slice(0, 3)
    .map((driver) =>
      buildDriverText(driver.key, driver.actual, driver.benchmark),
    )
    .filter(Boolean);

  return {
    ...row,
    level,
    decision,
    confidence,
    primary_issue: primaryIssue,
    why,
    drivers,
    action: buildDecisionActionText(decision, primaryIssue),
  };
};

const rankDecisionRows = (rows = [], level, benchmarks) =>
  normalizeArray(rows)
    .map((row) => buildDecisionRow({ row, level, benchmarks }))
    .sort((left, right) => {
      const decisionPriority = {
        scale: 0,
        pause: 1,
        test: 2,
        keep: 3,
      };

      if (
        decisionPriority[left.decision] !== decisionPriority[right.decision]
      ) {
        return (
          decisionPriority[left.decision] - decisionPriority[right.decision]
        );
      }

      return toNumber(right.spend) - toNumber(left.spend);
    });

const buildCreativeDiagnostics = (ads = [], benchmarks) =>
  normalizeArray(ads)
    .filter(
      (ad) =>
        toNumber(ad?.video_plays) > 0 ||
        toNumber(ad?.thruplays) > 0 ||
        toNumber(ad?.spend) > 0,
    )
    .map((ad) => {
      const videoPlayRate = toNumber(ad?.video_play_rate);
      const videoHoldRate = toNumber(ad?.video_hold_rate);
      const videoCompletionRate = toNumber(ad?.video_completion_rate);
      const linkCtr = toNumber(ad?.link_ctr);
      const conversionRate = toNumber(ad?.conversion_rate);
      const roas = toNumber(ad?.roas);

      let diagnosis = "stable";
      let headline = "Keep monitoring";
      let action = "Monitor this ad and compare it against stronger creatives.";

      if (roas >= benchmarks.scale_roas && toNumber(ad?.purchases) >= 1) {
        diagnosis = "winner";
        headline = "Creative winner";
        action =
          "Protect this winner, use it as the control, and build two adjacent variants around the same message.";
      } else if (videoPlayRate > 0 && videoPlayRate < 10) {
        diagnosis = "weak_thumb_stop";
        headline = "Weak first impression";
        action =
          "Test a sharper opening frame, faster branding, and clearer product demonstration in the first seconds.";
      } else if (
        videoHoldRate > 0 &&
        videoHoldRate < benchmarks.low_video_hold_rate
      ) {
        diagnosis = "weak_hold";
        headline = "Viewers drop early";
        action =
          "Shorten the intro, bring proof or offer earlier, and remove slow setup before the main value point.";
      } else if (
        videoCompletionRate > 0 &&
        videoCompletionRate < benchmarks.low_video_completion_rate
      ) {
        diagnosis = "late_offer";
        headline = "Message lands too late";
        action =
          "Move the product proof, CTA, or price framing earlier in the script.";
      } else if (
        linkCtr >= benchmarks.strong_link_ctr &&
        conversionRate > 0 &&
        conversionRate < benchmarks.min_conversion_rate
      ) {
        diagnosis = "post_click_drop";
        headline = "Clicks are there, conversion is weak";
        action =
          "Keep the core hook, but fix the landing page, offer clarity, or product-page trust signals.";
      }

      return {
        ...ad,
        diagnosis,
        headline,
        action,
      };
    })
    .sort((left, right) => toNumber(right.spend) - toNumber(left.spend))
    .slice(0, 8);

export const buildMetaDecisionBoard = ({
  overview = {},
  storeSnapshot = {},
}) => {
  const benchmarks = buildMetaBenchmarks({ overview, storeSnapshot });
  const campaigns = rankDecisionRows(
    overview?.campaigns,
    "campaign",
    benchmarks,
  ).slice(0, 12);
  const adsets = rankDecisionRows(overview?.adsets, "adset", benchmarks).slice(
    0,
    12,
  );
  const ads = rankDecisionRows(overview?.ads, "ad", benchmarks).slice(0, 16);
  const creativeDiagnostics = buildCreativeDiagnostics(
    overview?.ads,
    benchmarks,
  );

  const decisionSummary = campaigns.reduce(
    (summary, row) => {
      summary[`${row.decision}_count`] += 1;
      return summary;
    },
    {
      scale_count: 0,
      keep_count: 0,
      test_count: 0,
      pause_count: 0,
    },
  );

  return {
    benchmarks,
    roas_framework: {
      account_blended_roas: benchmarks.roas,
      scale_threshold: benchmarks.scale_roas,
      keep_threshold: benchmarks.keep_roas,
      pause_threshold: benchmarks.pause_roas,
      spend_gate: benchmarks.spend_gate,
      explanation: [
        `Scale after the item clears ROAS ${toFixedMetric(
          benchmarks.scale_roas,
        )}x with controlled frequency and enough purchases.`,
        `Keep stable items above ROAS ${toFixedMetric(
          benchmarks.keep_roas,
        )}x while testing only one major variable at a time.`,
        `Pause or cut hard once spend passes ${toFixedMetric(
          benchmarks.spend_gate,
        )} and ROAS stays below ${toFixedMetric(benchmarks.pause_roas)}x or conversions stay at zero.`,
      ],
    },
    summary: decisionSummary,
    campaigns,
    adsets,
    ads,
    scale_now: campaigns.filter((row) => row.decision === "scale").slice(0, 4),
    keep_running: campaigns
      .filter((row) => row.decision === "keep")
      .slice(0, 4),
    test_next: campaigns.filter((row) => row.decision === "test").slice(0, 4),
    pause_now: campaigns.filter((row) => row.decision === "pause").slice(0, 4),
    creative_diagnostics: creativeDiagnostics,
    playbook_notes: META_PLAYBOOK_NOTES,
  };
};

const buildQuestionDataPoints = (rows = [], formatter) =>
  normalizeArray(rows)
    .slice(0, 2)
    .map((row) => formatter(row))
    .filter(Boolean);

const buildQuestionSuggestion = ({
  id,
  category = "performance",
  priority = "medium",
  question,
  whyNow,
  sourceId = "",
  dataPoints = [],
}) => {
  const reference = getMetaReference(sourceId);

  return {
    id: normalizeText(id),
    category: normalizeText(category) || "performance",
    priority: normalizeText(priority) || "medium",
    question: normalizeText(question),
    why_now: normalizeText(whyNow),
    data_points: normalizeArray(dataPoints).slice(0, 3),
    source_id: reference?.id || normalizeText(sourceId),
    source_label: normalizeText(reference?.title || reference?.source_label),
    source_url: normalizeText(reference?.source_url),
    reference_note: normalizeText(reference?.insight),
  };
};

export const buildMetaQuestionSuggestions = ({
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
}) => {
  const suggestions = [];
  const seenIds = new Set();
  const pushSuggestion = (suggestion) => {
    if (
      !suggestion?.id ||
      !suggestion?.question ||
      seenIds.has(suggestion.id)
    ) {
      return;
    }

    seenIds.add(suggestion.id);
    suggestions.push(suggestion);
  };

  const summary = metaOverview?.summary || {};
  const benchmarks = decisionBoard?.benchmarks || {};
  const scaleNow = normalizeArray(decisionBoard?.scale_now);
  const pauseNow = normalizeArray(decisionBoard?.pause_now);
  const testNext = normalizeArray(decisionBoard?.test_next);
  const creativeDiagnostics = normalizeArray(
    decisionBoard?.creative_diagnostics,
  );
  const fatiguedCampaigns = normalizeArray(decisionBoard?.campaigns).filter(
    (row) => normalizeText(row?.primary_issue) === "fatigue",
  );
  const expensiveCampaigns = normalizeArray(decisionBoard?.campaigns).filter(
    (row) => normalizeText(row?.primary_issue) === "cost",
  );
  const conversionPressureCampaigns = normalizeArray(
    decisionBoard?.campaigns,
  ).filter((row) => normalizeText(row?.primary_issue) === "conversion");
  const weakCreativeDiagnostics = creativeDiagnostics.filter((row) =>
    ["weak_thumb_stop", "weak_hold", "late_offer"].includes(
      normalizeText(row?.diagnosis),
    ),
  );
  const postClickDrops = creativeDiagnostics.filter(
    (row) => normalizeText(row?.diagnosis) === "post_click_drop",
  );
  const orders = storeSnapshot?.orders || {};
  const catalog = storeSnapshot?.catalog || {};

  if (pauseNow.length > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "pause-now",
        category: "budget",
        priority: "high",
        question:
          "Which campaigns should we pause in the next 24 hours, and what exact metric is failing first: CTR, conversion rate, or creative hold?",
        whyNow: `${pauseNow.length} campaigns already clear the spend gate but still sit in the pause bucket.`,
        sourceId: "structure",
        dataPoints: buildQuestionDataPoints(
          pauseNow,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | ROAS ${toFixedMetric(row?.roas)}x | Spend ${toFixedMetric(row?.spend)}`,
        ),
      }),
    );
  }

  if (scaleNow.length > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "scale-winners",
        category: "scaling",
        priority: "high",
        question:
          "Which winner can take a controlled 10-15% budget increase without destabilizing learning, and what guardrail should we watch right after scaling?",
        whyNow: `${scaleNow.length} campaigns are above the current scale threshold and still look efficient.`,
        sourceId: "structure",
        dataPoints: buildQuestionDataPoints(
          scaleNow,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | ROAS ${toFixedMetric(row?.roas)}x | Frequency ${toFixedMetric(row?.frequency)}`,
        ),
      }),
    );
  }

  if (testNext.length > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "test-next",
        category: "testing",
        priority: "high",
        question:
          "For the mixed campaigns, what single variable should we test next first: hook, offer, landing page match, audience, or placement?",
        whyNow: `${testNext.length} campaigns are neither strong enough to scale nor weak enough to pause outright.`,
        sourceId: "testing",
        dataPoints: buildQuestionDataPoints(
          testNext,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | Issue ${normalizeText(row?.primary_issue) || "mixed"} | ROAS ${toFixedMetric(row?.roas)}x`,
        ),
      }),
    );
  }

  if (weakCreativeDiagnostics.length > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "creative-rebuild",
        category: "creative",
        priority: "high",
        question:
          "Which creatives need a new opening hook or earlier product proof because thumb-stop, hold, or completion is weak?",
        whyNow: `${weakCreativeDiagnostics.length} ads are showing early creative drop-off before the core message lands.`,
        sourceId: "reels",
        dataPoints: buildQuestionDataPoints(
          weakCreativeDiagnostics,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | ${normalizeText(row?.diagnosis)} | Hold ${toFixedMetric(row?.video_hold_rate)}%`,
        ),
      }),
    );
  }

  if (postClickDrops.length > 0 || conversionPressureCampaigns.length > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "post-click-diagnosis",
        category: "conversion",
        priority: "high",
        question:
          "Which ads are earning the click but losing after the click, and is the real issue offer framing, landing page match, or product-page trust?",
        whyNow:
          postClickDrops.length > 0
            ? `${postClickDrops.length} ads show strong click intent but weak post-click conversion.`
            : `${conversionPressureCampaigns.length} campaigns are flagged with conversion-side pressure.`,
        sourceId: "measurement",
        dataPoints: buildQuestionDataPoints(
          postClickDrops.length > 0
            ? postClickDrops
            : conversionPressureCampaigns,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | Link CTR ${toFixedMetric(row?.link_ctr)}% | CVR ${toFixedMetric(row?.conversion_rate)}%`,
        ),
      }),
    );
  }

  if (
    fatiguedCampaigns.length > 0 ||
    toNumber(summary?.frequency) >=
      Math.max(3, toNumber(benchmarks?.high_frequency))
  ) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "fatigue",
        category: "creative",
        priority: "medium",
        question:
          "Where is audience fatigue building, and should we rotate creative before we expand budget or audience size?",
        whyNow:
          fatiguedCampaigns.length > 0
            ? `${fatiguedCampaigns.length} campaigns are already flagged for fatigue through rising frequency.`
            : `Account frequency ${toFixedMetric(summary?.frequency)} is approaching the fatigue threshold.`,
        sourceId: "structure",
        dataPoints: buildQuestionDataPoints(
          fatiguedCampaigns,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | Frequency ${toFixedMetric(row?.frequency)} | ROAS ${toFixedMetric(row?.roas)}x`,
        ),
      }),
    );
  }

  if (
    expensiveCampaigns.length > 0 ||
    (toNumber(summary?.cpm) > 0 &&
      toNumber(summary?.link_ctr) > 0 &&
      toNumber(summary?.link_ctr) <
        Math.max(1.2, toNumber(benchmarks?.strong_link_ctr)))
  ) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "placements-and-cost",
        category: "delivery",
        priority: "medium",
        question:
          "Which campaigns are paying premium CPM without earning enough attention, and should placements or creative format change first?",
        whyNow:
          expensiveCampaigns.length > 0
            ? `${expensiveCampaigns.length} campaigns are flagged with cost pressure against current attention quality.`
            : `Account CPM is elevated while link CTR is still soft.`,
        sourceId: "placements",
        dataPoints: buildQuestionDataPoints(
          expensiveCampaigns,
          (row) =>
            `${normalizeText(row?.name) || normalizeText(row?.id)} | CPM ${toFixedMetric(row?.cpm)} | Link CTR ${toFixedMetric(row?.link_ctr)}%`,
        ),
      }),
    );
  }

  if (scaleNow.length > 0 && toNumber(catalog?.low_stock_count) > 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "inventory-guardrail",
        category: "operations",
        priority: toNumber(catalog?.low_stock_count) >= 5 ? "high" : "medium",
        question:
          "Which winners should stay capped because stock is tight, even if Meta performance says they can scale?",
        whyNow: `${catalog.low_stock_count} products are low on stock while there are live scale candidates in Meta.`,
        sourceId: "measurement",
        dataPoints: buildQuestionDataPoints(
          normalizeArray(storeSnapshot?.low_stock_products),
          (row) =>
            `${normalizeText(row?.title) || normalizeText(row?.id)} | Stock ${toFixedMetric(row?.inventory_quantity, 0)}`,
        ),
      }),
    );
  }

  if (
    toNumber(orders?.pending) >= 8 ||
    toNumber(orders?.cancellation_rate) >= 10 ||
    toNumber(orders?.refund_rate) >= 8
  ) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "commerce-friction",
        category: "operations",
        priority: "high",
        question:
          "Should we slow scaling until pending, canceled, or refunded orders are under control, even if front-end ROAS still looks healthy?",
        whyNow: `${toFixedMetric(orders?.pending, 0)} pending orders, ${toFixedMetric(orders?.cancellation_rate)}% cancellation rate, and ${toFixedMetric(orders?.refund_rate)}% refund rate can distort scaling decisions.`,
        sourceId: "measurement",
        dataPoints: [
          `Pending orders ${toFixedMetric(orders?.pending, 0)}`,
          `Cancellation rate ${toFixedMetric(orders?.cancellation_rate)}%`,
          `Refund rate ${toFixedMetric(orders?.refund_rate)}%`,
        ],
      }),
    );
  }

  if (toNumber(summary?.rows_count) === 0 || toNumber(summary?.spend) === 0) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "measurement-readiness",
        category: "measurement",
        priority: "high",
        question:
          "What is missing in our Meta setup before we trust optimization calls: sync freshness, conversion tracking, or Conversions API coverage?",
        whyNow:
          "There is not enough current Meta delivery data loaded to make reliable pause or scale decisions.",
        sourceId: "measurement",
      }),
    );
  }

  if (!suggestions.length) {
    pushSuggestion(
      buildQuestionSuggestion({
        id: "roas-pressure",
        category: "performance",
        priority: "medium",
        question:
          "Is ROAS pressure coming more from weak attention, poor post-click conversion, high CPM, or simple lack of delivery volume right now?",
        whyNow:
          "This is the fastest diagnostic split before making creative, budget, or landing-page changes.",
        sourceId: "testing",
        dataPoints: [
          `ROAS ${toFixedMetric(summary?.roas)}x`,
          `Link CTR ${toFixedMetric(summary?.link_ctr)}%`,
          `Conversion rate ${toFixedMetric(summary?.conversion_rate)}%`,
        ],
      }),
    );
  }

  const priorityRank = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return suggestions
    .sort(
      (left, right) =>
        (priorityRank[left.priority] ?? 99) -
        (priorityRank[right.priority] ?? 99),
    )
    .slice(0, 8);
};

const extractFirstJsonObject = (content) => {
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
};

export const fetchOpenRouterModels = async ({ apiKey = "" } = {}) => {
  const headers = {
    "Content-Type": "application/json",
  };

  if (normalizeText(apiKey)) {
    headers.Authorization = `Bearer ${normalizeText(apiKey)}`;
  }

  const response = await axios.get(`${OPENROUTER_BASE_URL}/models`, {
    headers,
    timeout: OPENROUTER_TIMEOUT_MS,
  });

  return normalizeArray(response?.data?.data).map((model) => ({
    id: normalizeText(model?.id),
    name: normalizeText(model?.name) || normalizeText(model?.id),
    context_length: toNumber(model?.context_length),
    pricing: parseJsonObject(model?.pricing, {}),
    architecture: parseJsonObject(model?.architecture, {}),
  }));
};

const buildOpenRouterHeaders = ({ apiKey, siteUrl = "", siteName = "" }) => {
  const headers = {
    Authorization: `Bearer ${normalizeText(apiKey)}`,
    "Content-Type": "application/json",
  };

  if (normalizeText(siteUrl)) {
    headers["HTTP-Referer"] = normalizeText(siteUrl);
  }

  if (normalizeText(siteName)) {
    headers["X-Title"] = normalizeText(siteName);
  }

  return headers;
};

const requestOpenRouterChatCompletion = async ({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  siteUrl = "",
  siteName = "",
  temperature = 0.2,
  messages = [],
  maxCompletionTokens = 900,
}) => {
  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: normalizeText(model) || DEFAULT_OPENROUTER_MODEL,
        temperature,
        max_completion_tokens: Math.max(
          128,
          toNumber(maxCompletionTokens) || 900,
        ),
        messages: normalizeArray(messages).filter(
          (message) =>
            normalizeText(message?.role) && normalizeText(message?.content),
        ),
      },
      {
        headers: buildOpenRouterHeaders({
          apiKey,
          siteUrl,
          siteName,
        }),
        timeout: OPENROUTER_TIMEOUT_MS,
      },
    );

    const choice = response?.data?.choices?.[0];
    const content = normalizeText(choice?.message?.content);

    if (!content) {
      throw createServiceError(
        502,
        "OpenRouter returned an empty reply. Try again in a moment.",
      );
    }

    return {
      model: response?.data?.model || model,
      content,
      raw: response?.data || {},
    };
  } catch (error) {
    if (error?.publicMessage) {
      throw error;
    }

    const providerStatus = toNumber(error?.response?.status);
    const providerMessage = normalizeText(
      error?.response?.data?.error?.message ||
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message,
    );

    if (providerStatus === 413) {
      throw createServiceError(
        413,
        "The AI request context is too large. Refresh data or ask a narrower question.",
        providerMessage,
      );
    }

    if (providerStatus === 401 || providerStatus === 403) {
      throw createServiceError(
        502,
        "OpenRouter rejected the saved API key or model settings.",
        providerMessage,
      );
    }

    if (providerStatus === 402) {
      throw createServiceError(
        502,
        "OpenRouter credits are unavailable for this request.",
        providerMessage,
      );
    }

    if (providerStatus === 429) {
      throw createServiceError(
        429,
        "OpenRouter rate limit was reached. Retry in a moment.",
        providerMessage,
      );
    }

    throw createServiceError(
      502,
      "OpenRouter is temporarily unavailable. Retry in a moment.",
      providerMessage,
    );
  }
};

const buildAiPrompt = ({
  overview,
  decisionBoard = {},
  storeSnapshot = {},
  focus = "",
}) => {
  const operationalRisks = buildAssistantOperationalRisks({
    storeSnapshot,
    metaOverview: overview,
    decisionBoard,
  });
  const growthOpportunities = buildAssistantGrowthOpportunities({
    storeSnapshot,
    metaOverview: overview,
    decisionBoard,
  });
  const audienceHypotheses = buildAssistantAudienceHypotheses({
    storeSnapshot,
    decisionBoard,
  });
  const campaignIdeas = buildAssistantCampaignIdeas({
    storeSnapshot,
    decisionBoard,
  });
  const marketSignals = buildAssistantMarketSignals({
    storeSnapshot,
    metaOverview: overview,
    decisionBoard,
  });
  const creativePriorities = buildAssistantCreativePriorities({
    decisionBoard,
  });

  return {
    system: [
      "You are Moon Profit AI, a senior store growth strategist and Meta performance operator.",
      "Analyze the whole commercial system: demand generation, campaign structure, creative, offer, landing-page match, stock readiness, order quality, refunds, and retention.",
      "Use only the provided context. When talking about market behavior, competitors, or audience psychology beyond direct data, label it clearly as a hypothesis or inference, never as a confirmed fact.",
      "Prefer real store units, products, cities, customers, campaigns, and creatives from the context instead of generic advice.",
      "Explain what is working, what is broken, what should scale, what should pause, what to test next, and what new campaigns or audience plays are missing.",
      "When suggesting a campaign, include objective, target audience, offer angle, creative direction, and guardrail.",
      "When explaining weak ROAS, connect it to CTR, link CTR, conversion rate, CPM, frequency, creative diagnostics, and store-side friction when available.",
      "Keep the language executive and commercial, but do not oversimplify away critical detail.",
      "Respond in valid JSON only.",
      "Required shape:",
      "{",
      '  "executive_summary": "short paragraph",',
      '  "store_diagnosis": {"primary_constraint":"...","growth_leverage":"...","confidence":"high|medium|low"},',
      '  "roas_explanation": ["..."],',
      '  "key_findings": ["..."],',
      '  "scale_now": ["..."],',
      '  "keep_running": ["..."],',
      '  "pause_now": ["..."],',
      '  "test_next": ["..."],',
      '  "opportunities": ["..."],',
      '  "risks": ["..."],',
      '  "market_signals": [{"signal":"...","observation":"...","implication":"...","type":"hypothesis|inference","confidence":"high|medium|low"}],',
      '  "audience_hypotheses": [{"segment":"...","targeting":"...","why_now":"...","offer_angle":"...","creative_angle":"...","confidence":"high|medium|low"}],',
      '  "campaign_gaps": [{"campaign_type":"...","objective":"...","target":"...","offer_angle":"...","creative_direction":"...","guardrail":"...","why_now":"..."}],',
      '  "creative_priorities": [{"creative":"...","diagnosis":"...","issue":"...","fix":"...","hook_direction":"...","placement_note":"..."}],',
      '  "actions": [{"title":"...","priority":"high|medium|low","reason":"...","expected_impact":"..."}],',
      '  "tests": [{"title":"...","hypothesis":"...","metric":"..."}]',
      "}",
    ].join(" "),
    user: JSON.stringify(
      {
        focus:
          normalizeText(focus) ||
          "Improve store growth decisions, campaign allocation, creative testing, and operational readiness.",
        store_snapshot: {
          financial: storeSnapshot?.financial || {},
          orders: storeSnapshot?.orders || {},
          catalog: storeSnapshot?.catalog || {},
          customers: storeSnapshot?.customers || {},
          top_products: buildAssistantProductRows(storeSnapshot?.top_products, 5),
          top_customers: buildAssistantCustomerRows(
            storeSnapshot?.top_customers,
            4,
          ),
          low_stock_products: buildAssistantProductRows(
            storeSnapshot?.low_stock_products,
            5,
          ),
          geography: {
            top_cities: buildAssistantGeographyRows({
              rows: storeSnapshot?.geography?.top_cities,
              labelKey: "city",
              limit: 4,
            }),
            top_provinces: buildAssistantGeographyRows({
              rows: storeSnapshot?.geography?.top_provinces,
              labelKey: "province",
              limit: 4,
            }),
            top_countries: buildAssistantGeographyRows({
              rows: storeSnapshot?.geography?.top_countries,
              labelKey: "country",
              limit: 4,
            }),
          },
        },
        meta_summary: overview?.summary || {},
        daily: normalizeArray(overview?.daily).slice(-14),
        top_campaigns: buildAssistantCampaignRows(overview?.campaigns, 10),
        top_ads: buildAssistantCreativeRows(overview?.ads, 10),
        top_accounts: normalizeArray(overview?.accounts).slice(0, 5),
        decision_board: {
          summary: decisionBoard?.summary || {},
          roas_framework: decisionBoard?.roas_framework || {},
          top_decisions: buildAssistantCampaignRows(decisionBoard?.campaigns, 8),
          creative_diagnostics: buildAssistantCreativeRows(
            decisionBoard?.creative_diagnostics,
            6,
          ),
        },
        growth_opportunities: growthOpportunities,
        operational_risks: operationalRisks,
        audience_hypotheses: audienceHypotheses,
        campaign_gaps: campaignIdeas,
        market_signals: marketSignals,
        creative_priorities: creativePriorities,
        assistant_questions: buildMetaQuestionSuggestions({
          storeSnapshot,
          metaOverview: overview,
          decisionBoard,
        }).slice(0, 6),
        meta_playbook_notes: META_PLAYBOOK_NOTES,
      },
      null,
      2,
    ),
  };
};

export const generateOpenRouterMetaAnalysis = async ({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  siteUrl = "",
  siteName = "",
  overview,
  decisionBoard = {},
  storeSnapshot = {},
  focus = "",
}) => {
  const prompt = buildAiPrompt({
    overview,
    decisionBoard,
    storeSnapshot,
    focus,
  });
  const completion = await requestOpenRouterChatCompletion({
    apiKey,
    model,
    siteUrl,
    siteName,
    temperature: 0.2,
    maxCompletionTokens: 1100,
    messages: [
      {
        role: "system",
        content: prompt.system,
      },
      {
        role: "user",
        content: prompt.user,
      },
    ],
  });
  const content = completion.content;

  return {
    model: completion.model,
    prompt,
    content,
    parsed: extractFirstJsonObject(content),
    raw: completion.raw,
  };
};

const sanitizeChatHistory = (history = []) =>
  normalizeArray(history)
    .slice(-10)
    .map((entry) => ({
      role:
        normalizeText(entry?.role).toLowerCase() === "assistant"
          ? "assistant"
          : "user",
      content: normalizeText(entry?.content),
    }))
    .filter((entry) => entry.content);

const buildAssistantCampaignRows = (rows = [], limit = 6) =>
  normalizeArray(rows)
    .slice(0, limit)
    .map((row) => ({
      id: normalizeText(row?.id),
      name: normalizeText(row?.name) || normalizeText(row?.id),
      objective: normalizeText(row?.objective),
      decision: normalizeText(row?.decision),
      spend: toNumber(row?.spend),
      roas: toNumber(row?.roas),
      link_ctr: toNumber(row?.link_ctr),
      conversion_rate: toNumber(row?.conversion_rate),
      frequency: toNumber(row?.frequency),
      purchases: toNumber(row?.purchases),
      why: normalizeArray(row?.why).slice(0, 2),
      action: normalizeText(row?.action),
    }));

const buildAssistantCreativeRows = (rows = [], limit = 5) =>
  normalizeArray(rows)
    .slice(0, limit)
    .map((row) => ({
      id: normalizeText(row?.id),
      name: normalizeText(row?.name) || normalizeText(row?.id),
      campaign_id: normalizeText(row?.campaign_id),
      adset_id: normalizeText(row?.adset_id),
      diagnosis: normalizeText(row?.diagnosis),
      headline: normalizeText(row?.headline),
      spend: toNumber(row?.spend),
      roas: toNumber(row?.roas),
      video_hold_rate: toNumber(row?.video_hold_rate),
      video_completion_rate: toNumber(row?.video_completion_rate),
      link_ctr: toNumber(row?.link_ctr),
      action: normalizeText(row?.action),
    }));

const buildAssistantProductRows = (rows = [], limit = 5) =>
  normalizeArray(rows)
    .slice(0, limit)
    .map((row) => ({
      id: normalizeText(row?.id || row?.product_id || row?.sku),
      title:
        normalizeText(row?.title || row?.name) ||
        normalizeText(row?.id || row?.product_id),
      vendor: normalizeText(row?.vendor),
      total_revenue: toNumber(row?.total_revenue),
      total_quantity: toNumber(row?.total_quantity),
      orders_count: toNumber(row?.orders_count),
      inventory_quantity: toNumber(row?.inventory_quantity),
    }));

const buildAssistantCustomerRows = (rows = [], limit = 4) =>
  normalizeArray(rows)
    .slice(0, limit)
    .map((row) => ({
      name: normalizeText(row?.name) || normalizeText(row?.email) || "Customer",
      email: normalizeText(row?.email),
      orders_count: toNumber(row?.orders_count),
      total_spent: toNumber(row?.total_spent),
    }));

const buildAssistantGeographyRows = ({
  rows = [],
  labelKey = "label",
  limit = 4,
}) =>
  normalizeArray(rows)
    .slice(0, limit)
    .map((row) => ({
      label: normalizeText(row?.[labelKey] || row?.label),
      orders_count: toNumber(row?.orders_count),
      revenue: toNumber(row?.revenue),
      share_of_orders: toNumber(row?.share_of_orders),
      share_of_revenue: toNumber(row?.share_of_revenue),
    }))
    .filter((row) => row.label);

const containsAssistantFragment = (message = "", fragments = []) => {
  const normalizedMessage = normalizeSearchText(message);
  if (!normalizedMessage) {
    return false;
  }

  return normalizeArray(fragments).some((fragment) =>
    normalizedMessage.includes(normalizeSearchText(fragment)),
  );
};

const buildAssistantRequestProfile = ({
  message = "",
  focusedScope = "account_overview",
}) => {
  const asksStrategy = containsAssistantFragment(message, [
    "strategy",
    "growth",
    "plan",
    "roadmap",
    "store",
    "overall",
    "وسع",
    "تكبر",
    "نمو",
    "خطة",
    "استراتيجية",
    "الستور",
    "المتجر",
    "السوق",
    "السوق كله",
    "system",
    "السيستم",
  ]);
  const asksAudience = containsAssistantFragment(message, [
    "audience",
    "target",
    "persona",
    "segment",
    "اودينس",
    "أودينس",
    "تارجت",
    "جمهور",
    "فئة",
    "مين",
    "من هم",
  ]);
  const asksCreative = containsAssistantFragment(message, [
    "creative",
    "hook",
    "angle",
    "script",
    "reels",
    "stories",
    "video",
    "content",
    "كريتيف",
    "هوك",
    "زاوية",
    "فيديو",
    "ريلز",
    "ستوري",
    "اعلان",
    "إعلان",
  ]);
  const asksCampaignIdeas = containsAssistantFragment(message, [
    "campaign",
    "campaigns",
    "funnel",
    "launch",
    "offer",
    "retarget",
    "retention",
    "remarketing",
    "campaign idea",
    "حملة",
    "حملات",
    "لانش",
    "عرض",
    "ريماركتنج",
    "اعادة استهداف",
    "استرجاع",
  ]);
  const asksMarket = containsAssistantFragment(message, [
    "market",
    "competitor",
    "competition",
    "auction",
    "saturated",
    "منافس",
    "منافسة",
    "سوق",
    "مزاد",
    "تشبع",
  ]);
  const asksDiagnostics = containsAssistantFragment(message, [
    "why",
    "diagnose",
    "analysis",
    "analyze",
    "what is wrong",
    "problem",
    "review",
    "حلل",
    "تحليل",
    "راجع",
    "غلط",
    "مشكلة",
    "ليه",
  ]);

  let responseMode = "operator_brief";
  if (
    focusedScope === "targeted" &&
    !asksStrategy &&
    !asksAudience &&
    !asksCreative &&
    !asksCampaignIdeas &&
    !asksMarket &&
    !asksDiagnostics &&
    normalizeText(message).length <= 140
  ) {
    responseMode = "entity_drilldown";
  } else if (
    asksStrategy ||
    asksAudience ||
    asksCreative ||
    asksCampaignIdeas ||
    asksMarket ||
    normalizeText(message).length > 140
  ) {
    responseMode = "strategy_deep_dive";
  }

  const requestedLenses = [];
  if (asksDiagnostics) {
    requestedLenses.push("diagnosis");
  }
  if (asksAudience) {
    requestedLenses.push("audience");
  }
  if (asksCreative) {
    requestedLenses.push("creative");
  }
  if (asksCampaignIdeas) {
    requestedLenses.push("campaigns");
  }
  if (asksMarket) {
    requestedLenses.push("market");
  }
  if (asksStrategy) {
    requestedLenses.push("store_growth");
  }
  if (!requestedLenses.length) {
    requestedLenses.push(
      responseMode === "entity_drilldown" ? "entity_decision" : "operator_plan",
    );
  }

  return {
    response_mode: responseMode,
    requested_lenses: requestedLenses.slice(0, 6),
    allow_new_campaign_ideas:
      responseMode !== "entity_drilldown" || asksCampaignIdeas,
    ask_market_hypotheses: asksMarket,
    ask_audience_strategy: asksAudience,
    ask_creative_strategy: asksCreative,
  };
};

const buildAssistantOperationalRisks = ({
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
}) => {
  const risks = [];
  const orders = storeSnapshot?.orders || {};
  const catalog = storeSnapshot?.catalog || {};
  const metaSummary = metaOverview?.summary || {};
  const benchmarks = decisionBoard?.benchmarks || {};
  const creativeDiagnostics = normalizeArray(
    decisionBoard?.creative_diagnostics,
  );
  const postClickDrops = creativeDiagnostics.filter(
    (row) => normalizeText(row?.diagnosis) === "post_click_drop",
  );
  const fatiguedCampaigns = normalizeArray(decisionBoard?.campaigns).filter(
    (row) => normalizeText(row?.primary_issue) === "fatigue",
  );

  if (toNumber(catalog?.low_stock_count) > 0) {
    risks.push({
      id: "inventory_pressure",
      severity: toNumber(catalog?.low_stock_count) >= 5 ? "high" : "medium",
      title: "Inventory can cap scaling",
      reason: `${toFixedMetric(catalog?.low_stock_count, 0)} SKUs are low on stock and ${toFixedMetric(catalog?.out_of_stock_count, 0)} are already out.`,
      action:
        "Protect best sellers before opening more budget or expanding audience size.",
    });
  }

  if (
    toNumber(orders?.pending) >= 8 ||
    toNumber(orders?.cancellation_rate) >= 10 ||
    toNumber(orders?.refund_rate) >= 8
  ) {
    risks.push({
      id: "order_quality",
      severity: "high",
      title: "Order quality is weakening true acquisition efficiency",
      reason: `${toFixedMetric(orders?.pending, 0)} pending orders, ${toFixedMetric(orders?.cancellation_rate)}% cancellations, and ${toFixedMetric(orders?.refund_rate)}% refunds are still in the system.`,
      action:
        "Fix confirmation, promise, shipping, and payment friction before pushing harder on paid traffic.",
    });
  }

  if (
    fatiguedCampaigns.length > 0 ||
    toNumber(metaSummary?.frequency) >=
      Math.max(3, toNumber(benchmarks?.high_frequency))
  ) {
    risks.push({
      id: "fatigue",
      severity: "medium",
      title: "Audience fatigue is building",
      reason:
        fatiguedCampaigns.length > 0
          ? `${fatiguedCampaigns.length} campaigns are already flagged with fatigue.`
          : `Frequency is ${toFixedMetric(metaSummary?.frequency)} which is near or above the fatigue guardrail.`,
      action:
        "Refresh creatives and widen audience entry points before adding more spend.",
    });
  }

  if (postClickDrops.length > 0) {
    risks.push({
      id: "post_click",
      severity: "medium",
      title: "The click is stronger than the conversion",
      reason: `${postClickDrops.length} ads are creating intent but leaking after the click.`,
      action:
        "Match the landing page hero, offer framing, social proof, and CTA to the ad promise.",
    });
  }

  if (toNumber(metaSummary?.rows_count) === 0 || toNumber(metaSummary?.spend) === 0) {
    risks.push({
      id: "measurement",
      severity: "high",
      title: "Meta data is too thin for reliable optimization",
      reason:
        "The current window has little or no synced Meta delivery data.",
      action:
        "Sync Meta first, then compare spend, ROAS, CTR, conversion rate, and creative diagnostics together.",
    });
  }

  return risks.slice(0, 5);
};

const buildAssistantGrowthOpportunities = ({
  storeSnapshot = {},
  decisionBoard = {},
}) => {
  const opportunities = [];
  const scaleNow = normalizeArray(decisionBoard?.scale_now);
  const creativeDiagnostics = normalizeArray(
    decisionBoard?.creative_diagnostics,
  );
  const topProducts = buildAssistantProductRows(storeSnapshot?.top_products, 3);
  const topCities = buildAssistantGeographyRows({
    rows: storeSnapshot?.geography?.top_cities,
    labelKey: "city",
    limit: 2,
  });
  const financial = storeSnapshot?.financial || {};
  const customers = storeSnapshot?.customers || {};
  const winnerCreative = creativeDiagnostics.find(
    (row) => normalizeText(row?.diagnosis) === "winner",
  );

  if (scaleNow[0]) {
    opportunities.push({
      id: "scale_winner",
      title: "There is a live scaling candidate",
      why_now: `${normalizeText(scaleNow[0]?.name) || normalizeText(scaleNow[0]?.id)} is already above the current scale threshold at ${toFixedMetric(scaleNow[0]?.roas)}x ROAS.`,
      play:
        "Increase budget in a controlled step, keep the winning creative stable, and watch frequency plus conversion rate after the increase.",
    });
  }

  if (topProducts[0] && toNumber(financial?.net_revenue) > 0) {
    const revenueShare =
      (toNumber(topProducts[0]?.total_revenue) /
        Math.max(0.01, toNumber(financial?.net_revenue))) *
      100;
    if (revenueShare >= 15) {
      opportunities.push({
        id: "hero_sku",
        title: "A hero SKU can anchor acquisition",
        why_now: `${topProducts[0].title} is contributing ${toFixedMetric(revenueShare)}% of net revenue in the current store snapshot.`,
        play:
          "Use the best seller as the hero offer, then build adjacent bundles or companion SKUs behind it.",
      });
    }
  }

  if (topCities[0] && toNumber(topCities[0]?.share_of_orders) >= 18) {
    opportunities.push({
      id: "geo_cluster",
      title: "Demand is clustering in one geography",
      why_now: `${topCities[0].label} is producing ${toFixedMetric(topCities[0]?.share_of_orders)}% of paid orders in the lookback window.`,
      play:
        "Test city-specific creative copy, shipping promise, or localized offer framing before scaling broader regions.",
    });
  }

  if (
    toNumber(customers?.active_customers_lookback) > 0 &&
    toNumber(customers?.repeat_customer_rate) < 30
  ) {
    opportunities.push({
      id: "retention_lift",
      title: "Retention still has headroom",
      why_now: `Repeat customer rate is ${toFixedMetric(customers?.repeat_customer_rate)}% across active customers in the lookback window.`,
      play:
        "Launch second-order reminders, bundles, or replenishment messaging instead of relying only on new-customer acquisition.",
    });
  }

  if (winnerCreative) {
    opportunities.push({
      id: "creative_system",
      title: "A winning creative can seed a full testing tree",
      why_now: `${normalizeText(winnerCreative?.name) || normalizeText(winnerCreative?.id)} is acting as a current winner.`,
      play:
        "Keep the control live, then branch into new hooks, proofs, and offers around the same core promise.",
    });
  }

  return opportunities.slice(0, 5);
};

const buildAssistantAudienceHypotheses = ({
  storeSnapshot = {},
  decisionBoard = {},
}) => {
  const hypotheses = [];
  const topProducts = buildAssistantProductRows(storeSnapshot?.top_products, 2);
  const topCities = buildAssistantGeographyRows({
    rows: storeSnapshot?.geography?.top_cities,
    labelKey: "city",
    limit: 2,
  });
  const topCustomers = buildAssistantCustomerRows(storeSnapshot?.top_customers, 2);
  const customers = storeSnapshot?.customers || {};
  const creativePriorities = normalizeArray(
    decisionBoard?.creative_diagnostics,
  ).filter((row) => normalizeText(row?.diagnosis) !== "winner");

  if (topProducts[0]) {
    hypotheses.push({
      segment: topCities[0]
        ? `Prospecting buyers similar to recent customers in ${topCities[0].label}`
        : "Prospecting buyers closest to recent purchasers",
      targeting: topCities[0]
        ? `Broad or lookalike prospecting seeded by conversions from ${topCities[0].label}`
        : "Broad prospecting plus purchaser lookalikes from recent converters",
      why_now: `${topProducts[0].title} is already the leading product in the store snapshot.`,
      offer_angle: `Lead with the clearest problem-solution message and proof for ${topProducts[0].title}.`,
      creative_angle:
        creativePriorities[0] &&
        ["weak_thumb_stop", "weak_hold"].includes(
          normalizeText(creativePriorities[0]?.diagnosis),
        )
          ? "Open with the outcome or proof in the first 2 seconds instead of a slow setup."
          : "Show the product result fast, then follow with social proof and offer clarity.",
      confidence: topCities[0] ? "high" : "medium",
    });
  }

  if (
    toNumber(customers?.active_customers_lookback) > 0 &&
    toNumber(customers?.repeat_customer_rate) < 35
  ) {
    hypotheses.push({
      segment: "Recent first-order buyers who have not made a second purchase yet",
      targeting:
        "Custom audiences from the last 30-45 day buyers, segmented by first-order products if possible.",
      why_now: `Repeat customer rate is only ${toFixedMetric(customers?.repeat_customer_rate)}% in the current lookback window.`,
      offer_angle:
        "Use bundles, replenishment timing, or a low-friction second-order incentive instead of deep discounting.",
      creative_angle:
        "Remind buyers what they already liked, then position the next logical purchase.",
      confidence: "high",
    });
  }

  if (topCities[0] && toNumber(topCities[0]?.share_of_revenue) >= 20) {
    hypotheses.push({
      segment: `${topCities[0].label} demand pocket`,
      targeting:
        "Localized city split or geo-priority budget test against the broader account baseline.",
      why_now: `${topCities[0].label} is driving ${toFixedMetric(topCities[0]?.share_of_revenue)}% of paid revenue in the snapshot.`,
      offer_angle:
        "Use localized delivery promise, urgency, or trust-building details that feel native to that market pocket.",
      creative_angle:
        "Mirror language, lifestyle, and product use cases that fit the dominant buyers from that city.",
      confidence: "medium",
    });
  }

  if (topCustomers[0] && toNumber(topCustomers[0]?.orders_count) >= 2) {
    hypotheses.push({
      segment: "High-value repeat buyers for VIP retention",
      targeting:
        "Build a small retention audience from the top repeat buyers and people similar to them.",
      why_now: `${topCustomers[0].name} and other repeat buyers are already showing stronger order depth than the account average.`,
      offer_angle:
        "Give early access, premium bundles, or limited launches instead of generic discount ads.",
      creative_angle:
        "Use exclusivity and status cues, not the same cold-acquisition message.",
      confidence: "medium",
    });
  }

  return hypotheses.slice(0, 4);
};

const buildAssistantCampaignIdeas = ({
  storeSnapshot = {},
  decisionBoard = {},
}) => {
  const campaignIdeas = [];
  const scaleNow = normalizeArray(decisionBoard?.scale_now);
  const topProducts = buildAssistantProductRows(storeSnapshot?.top_products, 2);
  const topCities = buildAssistantGeographyRows({
    rows: storeSnapshot?.geography?.top_cities,
    labelKey: "city",
    limit: 1,
  });
  const customers = storeSnapshot?.customers || {};
  const creativeDiagnostics = normalizeArray(
    decisionBoard?.creative_diagnostics,
  );
  const postClickDrop = creativeDiagnostics.find(
    (row) => normalizeText(row?.diagnosis) === "post_click_drop",
  );
  const weakCreative = creativeDiagnostics.find((row) =>
    ["weak_thumb_stop", "weak_hold", "late_offer"].includes(
      normalizeText(row?.diagnosis),
    ),
  );

  if (topProducts[0]) {
    campaignIdeas.push({
      campaign_type: "Hero SKU acquisition",
      objective: "Purchases",
      target:
        topCities[0] && toNumber(topCities[0]?.share_of_orders) >= 18
          ? `${topCities[0].label} buyers first, then broader purchaser lookalikes`
          : "Broad prospecting plus recent purchaser lookalikes",
      offer_angle: `${topProducts[0].title} as the hero product with one clear value proposition.`,
      creative_direction:
        "Lead with product proof early, then use social proof, outcome, and price/value framing.",
      guardrail:
        scaleNow[0]
          ? `Watch ${normalizeText(scaleNow[0]?.name) || normalizeText(scaleNow[0]?.id)} frequency and conversion rate while expanding spend.`
          : "Do not expand budget until the first winning angle is stable for another learning cycle.",
      why_now: `${topProducts[0].title} is already proving demand inside the store snapshot.`,
    });
  }

  if (
    toNumber(customers?.active_customers_lookback) > 0 &&
    toNumber(customers?.repeat_customer_rate) < 35
  ) {
    campaignIdeas.push({
      campaign_type: "Second-order retention",
      objective: "Repeat purchases",
      target: "Buyers from the last 30-45 days who have only placed one order.",
      offer_angle:
        "Bundle, replenishment reminder, or easy follow-on product instead of broad discounting.",
      creative_direction:
        "Reference the first purchase, then show the next best product or benefit stack.",
      guardrail:
        "Measure incremental repeat order rate, not just cheap clicks or engagement.",
      why_now: `Repeat customer rate is ${toFixedMetric(customers?.repeat_customer_rate)}%.`,
    });
  }

  if (postClickDrop) {
    campaignIdeas.push({
      campaign_type: "Offer-clarity retargeting",
      objective: "Recovered conversions",
      target: "Clickers and engaged viewers who reached the product page but did not purchase.",
      offer_angle:
        "Remove uncertainty with clearer pricing, proof, guarantee, or delivery explanation.",
      creative_direction:
        "Use the same winning hook but align the landing-page promise, hero image, and CTA.",
      guardrail:
        "If conversion rate does not improve, treat it as a landing-page or offer issue, not a top-of-funnel issue.",
      why_now: `${normalizeText(postClickDrop?.name) || normalizeText(postClickDrop?.id)} is winning attention but losing after the click.`,
    });
  }

  if (weakCreative) {
    campaignIdeas.push({
      campaign_type: "Creative angle testing",
      objective: "Message discovery",
      target: "Keep the current audience stable and rotate the message.",
      offer_angle:
        "Test distinct hooks around pain, proof, transformation, and urgency instead of micro-edits.",
      creative_direction:
        "Launch 3-4 clearly different concepts and keep placements broad enough for delivery to find efficient inventory.",
      guardrail:
        "Change one major variable at a time so the winner is actually explainable.",
      why_now: `${normalizeText(weakCreative?.name) || normalizeText(weakCreative?.id)} is signaling ${normalizeText(weakCreative?.diagnosis)}.`,
    });
  }

  return campaignIdeas.slice(0, 4);
};

const buildAssistantMarketSignals = ({
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
}) => {
  const signals = [];
  const summary = metaOverview?.summary || {};
  const benchmarks = decisionBoard?.benchmarks || {};
  const customers = storeSnapshot?.customers || {};
  const catalog = storeSnapshot?.catalog || {};
  const creativeDiagnostics = normalizeArray(
    decisionBoard?.creative_diagnostics,
  );
  const hasPostClickDrop = creativeDiagnostics.some(
    (row) => normalizeText(row?.diagnosis) === "post_click_drop",
  );

  if (
    toNumber(summary?.cpm) > toNumber(benchmarks?.cpm) * 1.25 &&
    toNumber(summary?.link_ctr) < Math.max(1.2, toNumber(benchmarks?.strong_link_ctr))
  ) {
    signals.push({
      signal: "Auction pressure or weak attention",
      observation: `CPM is ${toFixedMetric(summary?.cpm)} while link CTR is only ${toFixedMetric(summary?.link_ctr)}%.`,
      implication:
        "The market may be crowded, but the first fix is still stronger creative attention, not narrower targeting by default.",
      confidence: "medium",
      type: "hypothesis",
    });
  }

  if (hasPostClickDrop) {
    signals.push({
      signal: "Demand exists, but the offer path is leaking",
      observation:
        "The account has ads that earn the click yet lose after the click.",
      implication:
        "The bottleneck is likely offer clarity, product-page trust, or landing-page match rather than pure audience quality.",
      confidence: "high",
      type: "inference",
    });
  }

  if (toNumber(summary?.frequency) >= Math.max(3, toNumber(benchmarks?.high_frequency))) {
    signals.push({
      signal: "The reachable audience may be saturating",
      observation: `Frequency is ${toFixedMetric(summary?.frequency)} in the active window.`,
      implication:
        "Rotate messages before leaning harder into the same audience pool.",
      confidence: "medium",
      type: "inference",
    });
  }

  if (
    toNumber(catalog?.low_stock_count) > 0 &&
    normalizeArray(decisionBoard?.scale_now).length > 0
  ) {
    signals.push({
      signal: "Demand is ahead of supply on some winners",
      observation:
        "There are scaleable campaigns while low-stock products still exist in the store snapshot.",
      implication:
        "Operational readiness, not demand generation, may be the growth limiter right now.",
      confidence: "high",
      type: "inference",
    });
  }

  if (
    toNumber(customers?.active_customers_lookback) > 0 &&
    toNumber(customers?.repeat_customer_rate) < 30
  ) {
    signals.push({
      signal: "Retention is under-monetized",
      observation: `Repeat customer rate is ${toFixedMetric(customers?.repeat_customer_rate)}%.`,
      implication:
        "The store is still leaning too hard on acquisition instead of compounding revenue through follow-on orders.",
      confidence: "medium",
      type: "inference",
    });
  }

  return signals.slice(0, 5);
};

const buildAssistantCreativePriorities = ({ decisionBoard = {} }) => {
  const diagnosisPlaybook = {
    weak_thumb_stop: {
      issue: "The first impression is too soft.",
      fix: "Replace the opening frame with a sharper problem, result, or proof moment.",
      hook_direction:
        "Show the outcome or tension in the first second instead of warming up slowly.",
      placement_note:
        "Favor Reels and Stories-safe framing with the product visible early.",
    },
    weak_hold: {
      issue: "Viewers drop before the value lands.",
      fix: "Shorten the intro and move the proof before the explanation.",
      hook_direction:
        "Cut to a faster 6-15 second structure with earlier product demonstration.",
      placement_note:
        "Keep pacing high and avoid dense text overlays in vertical placements.",
    },
    late_offer: {
      issue: "The offer or CTA lands too late.",
      fix: "Move price, proof, or CTA earlier in the script.",
      hook_direction:
        "Surface the strongest commercial reason to buy before mid-video.",
      placement_note:
        "Use shorter edits for Reels and feed placements where completion drops quickly.",
    },
    post_click_drop: {
      issue: "The ad promise is stronger than the page conversion path.",
      fix: "Keep the hook, but align the page hero, trust stack, and CTA with the ad.",
      hook_direction:
        "Repeat the winning promise across ad creative and landing page above the fold.",
      placement_note:
        "Optimize the click destination before launching more variants of the same ad.",
    },
    winner: {
      issue: "This is currently a control creative.",
      fix: "Do not edit the winner aggressively while testing adjacent variants.",
      hook_direction:
        "Branch into new proofs and offers around the same winning message.",
      placement_note:
        "Use the winner as the benchmark across placements before rotating it out.",
    },
  };

  return normalizeArray(decisionBoard?.creative_diagnostics)
    .slice(0, 4)
    .map((row) => {
      const diagnosis = normalizeText(row?.diagnosis) || "winner";
      const playbook = diagnosisPlaybook[diagnosis] || diagnosisPlaybook.winner;

      return {
        creative: normalizeText(row?.name) || normalizeText(row?.id),
        diagnosis,
        issue: playbook.issue,
        fix: playbook.fix,
        hook_direction: playbook.hook_direction,
        placement_note: playbook.placement_note,
      };
    });
};

const tokenizeAssistantMessage = (message = "") =>
  Array.from(
    new Set(
      normalizeSearchText(message)
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  );

const scoreAssistantEntityMatch = (message = "", row = {}) => {
  const normalizedMessage = normalizeSearchText(message);
  if (!normalizedMessage) {
    return 0;
  }

  const entityValues = [
    row?.id,
    row?.name,
    row?.campaign_id,
    row?.adset_id,
    row?.headline,
    row?.objective,
  ]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean);

  if (!entityValues.length) {
    return 0;
  }

  const directMatch = entityValues.some(
    (value) =>
      value.length >= 4 &&
      (normalizedMessage.includes(value) || value.includes(normalizedMessage)),
  );
  if (directMatch) {
    return 100;
  }

  const messageTokens = tokenizeAssistantMessage(message);
  if (!messageTokens.length) {
    return 0;
  }

  return messageTokens.reduce((score, token) => {
    if (entityValues.some((value) => value.includes(token))) {
      return score + (token.length >= 6 ? 3 : 2);
    }

    return score;
  }, 0);
};

const uniqueAssistantRows = (rows = []) => {
  const seen = new Set();
  const uniqueRows = [];

  for (const row of normalizeArray(rows)) {
    const key = normalizeText(row?.id || row?.name);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueRows.push(row);
  }

  return uniqueRows;
};

const getAssistantFocusedContext = ({
  message = "",
  metaOverview = {},
  decisionBoard = {},
}) => {
  const scoredCampaigns = uniqueAssistantRows([
    ...normalizeArray(decisionBoard?.campaigns),
    ...normalizeArray(metaOverview?.campaigns),
  ])
    .map((row) => ({
      row,
      score: scoreAssistantEntityMatch(message, row),
    }))
    .filter((entry) => entry.score >= 3)
    .sort((left, right) => right.score - left.score);

  const scoredCreatives = uniqueAssistantRows([
    ...normalizeArray(decisionBoard?.creative_diagnostics),
    ...normalizeArray(metaOverview?.ads),
  ])
    .map((row) => ({
      row,
      score: scoreAssistantEntityMatch(message, row),
    }))
    .filter((entry) => entry.score >= 3)
    .sort((left, right) => right.score - left.score);

  const matchedCampaigns = scoredCampaigns.map((entry) => entry.row).slice(0, 4);
  const matchedCreatives = scoredCreatives.map((entry) => entry.row).slice(0, 4);
  const matchedCampaignIds = new Set(
    matchedCampaigns.map((row) => normalizeText(row?.id)).filter(Boolean),
  );

  const supportingCreatives = normalizeArray(decisionBoard?.creative_diagnostics)
    .filter((row) =>
      matchedCampaignIds.has(normalizeText(row?.campaign_id)) ||
      matchedCampaignIds.has(normalizeText(row?.id)),
    )
    .slice(0, 4);

  const hasFocusedScope =
    matchedCampaigns.length > 0 ||
    matchedCreatives.length > 0 ||
    supportingCreatives.length > 0;

  return {
    scope: hasFocusedScope ? "targeted" : "account_overview",
    matchedCampaigns,
    matchedCreatives:
      matchedCreatives.length > 0 ? matchedCreatives : supportingCreatives,
  };
};

export const buildAssistantContextSnapshot = ({
  message = "",
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
  recommendations = [],
  assistantQuestions = [],
}) => {
  const focusedContext = getAssistantFocusedContext({
    message,
    metaOverview,
    decisionBoard,
  });
  const requestProfile = buildAssistantRequestProfile({
    message,
    focusedScope: focusedContext.scope,
  });
  const useFocusedScope = focusedContext.scope === "targeted";
  const includeStrategicLayers =
    requestProfile.response_mode !== "entity_drilldown";
  const topCampaigns = buildAssistantCampaignRows(
    useFocusedScope ? focusedContext.matchedCampaigns : metaOverview?.campaigns,
    useFocusedScope ? 4 : 6,
  );
  const topAds = buildAssistantCreativeRows(
    useFocusedScope ? focusedContext.matchedCreatives : metaOverview?.ads,
    useFocusedScope ? 4 : 6,
  );
  const focusedCampaigns = buildAssistantCampaignRows(
    focusedContext.matchedCampaigns,
    4,
  );
  const focusedCreatives = buildAssistantCreativeRows(
    focusedContext.matchedCreatives,
    4,
  );
  const operationalRisks = includeStrategicLayers
    ? buildAssistantOperationalRisks({
        storeSnapshot,
        metaOverview,
        decisionBoard,
      })
    : [];
  const growthOpportunities = includeStrategicLayers
    ? buildAssistantGrowthOpportunities({
        storeSnapshot,
        metaOverview,
        decisionBoard,
      })
    : [];
  const audienceHypotheses =
    includeStrategicLayers && requestProfile.ask_audience_strategy
      ? buildAssistantAudienceHypotheses({
          storeSnapshot,
          decisionBoard,
        })
      : includeStrategicLayers
        ? buildAssistantAudienceHypotheses({
            storeSnapshot,
            decisionBoard,
          }).slice(0, 2)
        : [];
  const campaignIdeas =
    includeStrategicLayers && requestProfile.allow_new_campaign_ideas
      ? buildAssistantCampaignIdeas({
          storeSnapshot,
          decisionBoard,
        })
      : [];
  const marketSignals =
    includeStrategicLayers && requestProfile.ask_market_hypotheses
      ? buildAssistantMarketSignals({
          storeSnapshot,
          metaOverview,
          decisionBoard,
        })
      : includeStrategicLayers
        ? buildAssistantMarketSignals({
            storeSnapshot,
            metaOverview,
            decisionBoard,
          }).slice(0, 2)
        : [];
  const creativePriorities =
    includeStrategicLayers && requestProfile.ask_creative_strategy
      ? buildAssistantCreativePriorities({
          decisionBoard,
        })
      : includeStrategicLayers
        ? buildAssistantCreativePriorities({
            decisionBoard,
          }).slice(0, 2)
        : [];

  return {
    context_scope: focusedContext.scope,
    response_mode: requestProfile.response_mode,
    requested_lenses: requestProfile.requested_lenses,
    store_snapshot: {
      financial: storeSnapshot?.financial || {},
      orders: storeSnapshot?.orders || {},
      catalog: storeSnapshot?.catalog || {},
      customers: storeSnapshot?.customers || {},
      top_products: buildAssistantProductRows(storeSnapshot?.top_products, 5),
      top_customers: buildAssistantCustomerRows(storeSnapshot?.top_customers, 4),
      low_stock_products: buildAssistantProductRows(
        storeSnapshot?.low_stock_products,
        5,
      ),
      geography: {
        top_cities: buildAssistantGeographyRows({
          rows: storeSnapshot?.geography?.top_cities,
          labelKey: "city",
          limit: 4,
        }),
        top_provinces: buildAssistantGeographyRows({
          rows: storeSnapshot?.geography?.top_provinces,
          labelKey: "province",
          limit: 4,
        }),
        top_countries: buildAssistantGeographyRows({
          rows: storeSnapshot?.geography?.top_countries,
          labelKey: "country",
          limit: 4,
        }),
      },
    },
    meta_summary: metaOverview?.summary || {},
    decision_summary: decisionBoard?.summary || {},
    roas_framework: decisionBoard?.roas_framework || {},
    top_campaigns: topCampaigns,
    top_ads: topAds,
    focused_campaigns: focusedCampaigns,
    focused_creatives: focusedCreatives,
    decisions: buildAssistantCampaignRows(
      useFocusedScope ? [] : decisionBoard?.campaigns,
      useFocusedScope ? 0 : 6,
    ),
    creative_diagnostics: buildAssistantCreativeRows(
      useFocusedScope ? [] : decisionBoard?.creative_diagnostics,
      useFocusedScope ? 0 : 5,
    ),
    operational_risks: operationalRisks,
    growth_opportunities: growthOpportunities,
    audience_hypotheses: audienceHypotheses,
    campaign_opportunities: campaignIdeas,
    market_signals: marketSignals,
    creative_priorities: creativePriorities,
    recommendations: normalizeArray(recommendations).slice(
      0,
      requestProfile.response_mode === "strategy_deep_dive"
        ? 8
        : useFocusedScope
          ? 3
          : 6,
    ),
    assistant_questions: normalizeArray(assistantQuestions).slice(
      0,
      useFocusedScope && requestProfile.response_mode === "entity_drilldown"
        ? 0
        : 6,
    ),
    meta_playbook_notes: useFocusedScope
      ? []
      : META_PLAYBOOK_NOTES.slice(0, 4),
  };
};

export const generateOpenRouterStoreAssistantReply = async ({
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  siteUrl = "",
  siteName = "",
  message = "",
  history = [],
  storeSnapshot = {},
  metaOverview = {},
  decisionBoard = {},
  recommendations = [],
  assistantQuestions = [],
}) => {
  const normalizedMessage = normalizeText(message);
  const compactContext = buildAssistantContextSnapshot({
    message: normalizedMessage,
    storeSnapshot,
    metaOverview,
    decisionBoard,
    recommendations,
    assistantQuestions,
  });
  const responseMode = normalizeText(compactContext?.response_mode) || "operator_brief";
  const responseGuide =
    responseMode === "strategy_deep_dive"
      ? [
          "The user is asking for a broader strategic answer.",
          "Use short titled sections when helpful.",
          "Cover, in this order when relevant: direct verdict, what is working, what is broken, audience strategy, campaign opportunities, creative direction, market or competitor hypotheses, operational risks, and a 7-day action plan.",
          "When you mention market or competitor behavior beyond the data, label it clearly as a hypothesis or inference.",
          "When you propose a campaign, include objective, target audience, offer angle, creative direction, and guardrail.",
          "It is acceptable to use 6-10 concise bullets if that is what the question needs.",
        ].join(" ")
      : responseMode === "entity_drilldown"
        ? [
            "The user is asking about a narrow entity or issue.",
            "Stay tightly scoped to that campaign, ad set, ad, or issue.",
            "Start with one direct verdict sentence, then give no more than 5 short bullets.",
            "Only bring in wider store context if it changes the decision materially.",
          ].join(" ")
        : [
            "Default to an operator brief: one direct verdict sentence and up to 5 concise bullets.",
            "Keep the answer practical and decision-oriented.",
          ].join(" ");
  const prompt = {
    system: [
      "You are Moon Profit AI, the store's internal growth operator and Meta strategist.",
      "You help store operators decide what to pause, scale, restock, follow up on, fix, and launch next.",
      "Use the provided store snapshot, Meta data, decision board, and recommendations only.",
      "Reply in the same language as the user. Prefer Arabic when the user writes Arabic.",
      "Base every conclusion on the context. If something is not in the data, say it is missing.",
      "If the user asks about market conditions, competitors, or audience behavior beyond the data, clearly label the point as a hypothesis or inference.",
      "Be specific, commercial, and operational. Use real products, geographies, campaigns, creatives, and store constraints from the context when available.",
      "Answer only what the user asked. Do not volunteer unrelated inactive entities or vanity observations.",
      "If the user asks about one campaign, ad set, or ad, stay tightly focused on that entity.",
      "If the user seems to mean a specific campaign or ad but the context does not clearly identify one, say that plainly and ask for the exact name.",
      "Mention the metrics that actually change the decision. Do not omit critical metrics just to stay short.",
      "When relevant, answer in four buckets: pause, keep running, test next, and scale now.",
      "Explain ROAS in plain language using CTR, conversion rate, CPM, frequency, video diagnostics, and store-side friction when available.",
      responseGuide,
    ].join(" "),
    context: JSON.stringify(compactContext, null, 2),
  };

  const completion = await requestOpenRouterChatCompletion({
    apiKey,
    model,
    siteUrl,
    siteName,
    temperature: responseMode === "strategy_deep_dive" ? 0.18 : 0.15,
    maxCompletionTokens:
      responseMode === "strategy_deep_dive"
        ? 980
        : responseMode === "entity_drilldown"
          ? 520
          : 700,
    messages: [
      {
        role: "system",
        content: prompt.system,
      },
      {
        role: "user",
        content: `Context:\n${prompt.context}`,
      },
      ...sanitizeChatHistory(history),
      {
        role: "user",
        content: normalizedMessage,
      },
    ],
  });

  return {
    model: completion.model,
    prompt,
    content: completion.content,
    raw: completion.raw,
  };
};

export {
  DEFAULT_META_LOOKBACK_DAYS,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAdAccountId,
  extractActionMetric,
};
