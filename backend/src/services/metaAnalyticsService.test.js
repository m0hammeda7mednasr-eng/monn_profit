import axios from "axios";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
  aggregateMetaSnapshotRows,
  buildAssistantContextSnapshot,
  buildMetaDecisionBoard,
  buildMetaOverview,
  buildMetaQuestionSuggestions,
  extractActionMetric,
  fetchMetaAdAccounts,
  fetchMetaCampaigns,
  normalizeAdAccountId,
} from "./metaAnalyticsService.js";

describe("services/metaAnalyticsService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes numeric ad account ids into Meta account format", () => {
    expect(normalizeAdAccountId("1234567890")).toBe("act_1234567890");
    expect(normalizeAdAccountId("act_987654321")).toBe("act_987654321");
  });

  it("extracts action totals from Meta actions arrays", () => {
    const actions = [
      { action_type: "purchase", value: "2" },
      { action_type: "lead", value: "4" },
      { action_type: "purchase", value: "3" },
    ];

    expect(extractActionMetric(actions, ["purchase"])).toBe(5);
    expect(extractActionMetric(actions, ["lead"])).toBe(4);
  });

  it("aggregates stored snapshot rows into campaign and account summaries", () => {
    const payload = aggregateMetaSnapshotRows([
      {
        account_id: "act_1",
        account_name: "Primary Account",
        campaign_id: "cmp_1",
        campaign_name: "Scale Winners",
        ad_id: "ad_1",
        ad_name: "Creative A",
        date_start: "2026-03-01",
        metrics: {
          spend: 150,
          impressions: 10000,
          reach: 8000,
          clicks: 250,
          inline_link_clicks: 180,
          purchases: 5,
          purchase_value: 900,
          leads: 2,
        },
      },
      {
        account_id: "act_1",
        account_name: "Primary Account",
        campaign_id: "cmp_1",
        campaign_name: "Scale Winners",
        ad_id: "ad_2",
        ad_name: "Creative B",
        date_start: "2026-03-02",
        metrics: {
          spend: 50,
          impressions: 4000,
          reach: 3000,
          clicks: 90,
          inline_link_clicks: 70,
          purchases: 1,
          purchase_value: 180,
          leads: 1,
        },
      },
    ]);

    expect(payload.summary.spend).toBe(200);
    expect(payload.summary.clicks).toBe(340);
    expect(payload.summary.purchases).toBe(6);
    expect(payload.summary.roas).toBeCloseTo(5.4, 4);
    expect(payload.accounts).toHaveLength(1);
    expect(payload.campaigns).toHaveLength(1);
    expect(payload.ads).toHaveLength(2);
    expect(payload.daily).toHaveLength(2);
    expect(payload.campaigns[0].name).toBe("Scale Winners");
    expect(payload.campaigns[0].spend).toBe(200);
  });

  it("aggregates video engagement metrics from stored snapshots", () => {
    const payload = aggregateMetaSnapshotRows([
      {
        account_id: "act_1",
        account_name: "Primary Account",
        campaign_id: "cmp_video",
        campaign_name: "Video Push",
        ad_id: "ad_video",
        ad_name: "Video A",
        date_start: "2026-03-01",
        metrics: {
          spend: 120,
          impressions: 4000,
          reach: 3000,
          clicks: 80,
          inline_link_clicks: 60,
          purchases: 2,
          purchase_value: 320,
          video_plays: 1000,
          thruplays: 280,
          video_p100_watched: 90,
        },
      },
    ]);

    expect(payload.summary.video_plays).toBe(1000);
    expect(payload.summary.thruplays).toBe(280);
    expect(payload.summary.video_play_rate).toBeCloseTo(25, 4);
    expect(payload.summary.video_hold_rate).toBeCloseTo(28, 4);
    expect(payload.summary.video_completion_rate).toBeCloseTo(9, 4);
  });

  it("classifies campaigns into scale, keep, test, and pause buckets", () => {
    const overview = {
      summary: {
        spend: 530,
        impressions: 22000,
        reach: 18000,
        clicks: 520,
        inline_link_clicks: 380,
        purchases: 12,
        purchase_value: 1240,
        ctr: 2.36,
        link_ctr: 1.73,
        cpm: 24.09,
        frequency: 1.22,
        conversion_rate: 3.16,
        cost_per_purchase: 44.16,
        roas: 2.34,
      },
      campaigns: [
        {
          id: "cmp_scale",
          name: "Scale Winner",
          spend: 180,
          purchases: 5,
          roas: 3.1,
          link_ctr: 2.2,
          conversion_rate: 4.4,
          frequency: 1.4,
          cpm: 21,
        },
        {
          id: "cmp_pause",
          name: "Wasted Spend",
          spend: 95,
          purchases: 0,
          roas: 0,
          link_ctr: 0.5,
          conversion_rate: 0,
          frequency: 1.7,
          cpm: 29,
          video_hold_rate: 12,
        },
        {
          id: "cmp_test",
          name: "Needs Testing",
          spend: 120,
          purchases: 2,
          roas: 1.6,
          link_ctr: 1.1,
          conversion_rate: 1.2,
          frequency: 4.1,
          cpm: 31,
        },
        {
          id: "cmp_keep",
          name: "Stable Keeper",
          spend: 135,
          purchases: 3,
          roas: 2.1,
          link_ctr: 1.6,
          conversion_rate: 3.1,
          frequency: 1.8,
          cpm: 24,
        },
      ],
      adsets: [],
      ads: [
        {
          id: "ad_scale",
          name: "Control Creative",
          spend: 90,
          purchases: 2,
          roas: 3.2,
          link_ctr: 2.1,
          conversion_rate: 4.3,
          frequency: 1.3,
          video_plays: 1400,
          thruplays: 420,
          video_hold_rate: 30,
          video_completion_rate: 10,
        },
        {
          id: "ad_hold",
          name: "Weak Hook Creative",
          spend: 70,
          purchases: 0,
          roas: 0,
          link_ctr: 0.7,
          conversion_rate: 0,
          frequency: 1.4,
          video_plays: 1000,
          thruplays: 120,
          video_hold_rate: 12,
          video_completion_rate: 4,
        },
      ],
    };

    const decisionBoard = buildMetaDecisionBoard({
      overview,
      storeSnapshot: {
        financial: {
          average_order_value: 120,
        },
      },
    });

    expect(decisionBoard.scale_now[0].id).toBe("cmp_scale");
    expect(decisionBoard.pause_now[0].id).toBe("cmp_pause");
    expect(decisionBoard.test_next[0].id).toBe("cmp_test");
    expect(decisionBoard.keep_running[0].id).toBe("cmp_keep");
    expect(decisionBoard.creative_diagnostics[0].diagnosis).toBe("winner");
    expect(decisionBoard.creative_diagnostics[1].diagnosis).toBe("weak_hold");
  });

  it("keeps catalog campaigns and active ads visible even without insight rows", () => {
    const overview = buildMetaOverview({
      snapshots: [
        {
          account_id: "act_1",
          account_name: "Primary Account",
          campaign_id: "cmp_live",
          campaign_name: "Live Campaign",
          adset_id: "adset_live",
          adset_name: "Live Adset",
          ad_id: "ad_live",
          ad_name: "Live Ad",
          date_start: "2026-03-01",
          metrics: {
            spend: 100,
            impressions: 5000,
            reach: 4200,
            clicks: 140,
            inline_link_clicks: 110,
            purchases: 3,
            purchase_value: 360,
          },
        },
      ],
      campaigns: [
        {
          object_id: "cmp_live",
          name: "Live Campaign",
          account_id: "act_1",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
        {
          object_id: "cmp_zero",
          name: "Zero Spend Active",
          account_id: "act_1",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
      ],
      adsets: [
        {
          object_id: "adset_live",
          name: "Live Adset",
          campaign_id: "cmp_live",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
        {
          object_id: "adset_zero",
          name: "Zero Spend Adset",
          campaign_id: "cmp_zero",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
      ],
      ads: [
        {
          object_id: "ad_live",
          name: "Live Ad",
          campaign_id: "cmp_live",
          adset_id: "adset_live",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
        {
          object_id: "ad_zero",
          name: "Zero Spend Ad",
          campaign_id: "cmp_zero",
          adset_id: "adset_zero",
          effective_status: "ACTIVE",
          status: "ACTIVE",
        },
      ],
    });

    expect(overview.summary.campaigns_count).toBe(2);
    expect(overview.summary.active_campaigns_count).toBe(2);
    expect(overview.campaigns).toHaveLength(2);
    expect(overview.campaigns[1].id).toBe("cmp_zero");
    expect(overview.campaigns[1].spend).toBe(0);
    expect(overview.ads).toHaveLength(2);
    expect(overview.ads[1].id).toBe("ad_zero");
    expect(overview.ads[1].is_active).toBe(true);
  });

  it("builds context-aware operator questions from performance and store state", () => {
    const overview = {
      summary: {
        rows_count: 6,
        spend: 530,
        impressions: 22000,
        reach: 18000,
        clicks: 520,
        inline_link_clicks: 380,
        purchases: 12,
        purchase_value: 1240,
        ctr: 2.36,
        link_ctr: 1.73,
        cpm: 24.09,
        frequency: 3.9,
        conversion_rate: 3.16,
        cost_per_purchase: 44.16,
        roas: 2.34,
      },
      campaigns: [
        {
          id: "cmp_scale",
          name: "Scale Winner",
          spend: 180,
          purchases: 5,
          roas: 3.1,
          link_ctr: 2.2,
          conversion_rate: 4.4,
          frequency: 1.4,
          cpm: 21,
        },
        {
          id: "cmp_pause",
          name: "Wasted Spend",
          spend: 95,
          purchases: 0,
          roas: 0,
          link_ctr: 0.5,
          conversion_rate: 0,
          frequency: 1.7,
          cpm: 29,
          video_hold_rate: 12,
        },
        {
          id: "cmp_test",
          name: "Needs Testing",
          spend: 120,
          purchases: 2,
          roas: 1.6,
          link_ctr: 1.1,
          conversion_rate: 1.2,
          frequency: 4.1,
          cpm: 31,
        },
      ],
      adsets: [],
      ads: [
        {
          id: "ad_hold",
          name: "Weak Hook Creative",
          spend: 70,
          purchases: 0,
          roas: 0,
          link_ctr: 0.7,
          conversion_rate: 0,
          frequency: 1.4,
          video_plays: 1000,
          thruplays: 120,
          video_hold_rate: 12,
          video_completion_rate: 4,
        },
        {
          id: "ad_drop",
          name: "Click But No Sale",
          spend: 90,
          purchases: 1,
          roas: 1.1,
          link_ctr: 2.8,
          conversion_rate: 0.5,
          frequency: 1.8,
          video_plays: 1200,
          thruplays: 300,
          video_hold_rate: 25,
          video_completion_rate: 9,
        },
      ],
    };
    const storeSnapshot = {
      financial: {
        average_order_value: 120,
      },
      orders: {
        pending: 10,
        cancellation_rate: 11,
        refund_rate: 4,
      },
      catalog: {
        low_stock_count: 3,
      },
      low_stock_products: [
        {
          id: "prod_low",
          title: "Low Stock Product",
          inventory_quantity: 2,
        },
      ],
    };

    const decisionBoard = buildMetaDecisionBoard({
      overview,
      storeSnapshot,
    });
    const suggestions = buildMetaQuestionSuggestions({
      storeSnapshot,
      metaOverview: overview,
      decisionBoard,
    });

    expect(suggestions.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "pause-now",
        "scale-winners",
        "test-next",
        "creative-rebuild",
        "post-click-diagnosis",
        "commerce-friction",
      ]),
    );
    expect(suggestions[0].question).toContain("pause");
  });

  it("builds a compact assistant context snapshot instead of sending full raw datasets", () => {
    const snapshot = buildAssistantContextSnapshot({
      storeSnapshot: {
        financial: { net_revenue: 1200 },
        orders: { total: 22 },
        catalog: { low_stock_count: 3 },
        customers: {
          total_customers: 80,
          active_customers_lookback: 28,
          repeat_customers_lookback: 6,
          repeat_customer_rate: 21.43,
        },
        top_products: Array.from({ length: 8 }, (_, index) => ({
          id: `product-${index}`,
          title: `Product ${index}`,
          total_revenue: 400 - index * 10,
        })),
        top_customers: Array.from({ length: 5 }, (_, index) => ({
          name: `Customer ${index}`,
          email: `customer-${index}@example.com`,
          orders_count: 1 + (index % 3),
          total_spent: 600 - index * 40,
        })),
        low_stock_products: Array.from({ length: 7 }, (_, index) => ({
          id: `low-${index}`,
          title: `Low ${index}`,
          inventory_quantity: 1 + index,
        })),
        geography: {
          top_cities: Array.from({ length: 4 }, (_, index) => ({
            city: `City ${index}`,
            orders_count: 12 - index,
            revenue: 500 - index * 25,
            share_of_orders: 20 - index,
            share_of_revenue: 22 - index,
          })),
          top_provinces: [
            {
              province: "Province A",
              orders_count: 15,
              revenue: 620,
              share_of_orders: 27,
              share_of_revenue: 29,
            },
          ],
          top_countries: [
            {
              country: "Egypt",
              orders_count: 22,
              revenue: 1200,
              share_of_orders: 100,
              share_of_revenue: 100,
            },
          ],
        },
      },
      metaOverview: {
        summary: {
          spend: 500,
          roas: 2.4,
          cpm: 18,
          link_ctr: 1.1,
          frequency: 3.7,
        },
        campaigns: Array.from({ length: 9 }, (_, index) => ({
          id: `cmp-${index}`,
          name: `Campaign ${index}`,
          spend: 100 + index,
          roas: 2 + index / 10,
        })),
        ads: Array.from({ length: 9 }, (_, index) => ({
          id: `ad-${index}`,
          name: `Ad ${index}`,
          spend: 50 + index,
          roas: 1.5 + index / 10,
          diagnosis: index === 0 ? "winner" : "weak_hold",
        })),
      },
      decisionBoard: {
        summary: { scale_count: 2, pause_count: 1 },
        roas_framework: { scale_threshold: 2.8 },
        benchmarks: {
          cpm: 12,
          strong_link_ctr: 1.4,
          high_frequency: 3.5,
        },
        scale_now: [
          {
            id: "decision-0",
            name: "Decision 0",
            roas: 3.2,
            purchases: 4,
          },
        ],
        campaigns: Array.from({ length: 10 }, (_, index) => ({
          id: `decision-${index}`,
          name: `Decision ${index}`,
          decision: index < 2 ? "scale" : "keep",
          why: ["Reason one", "Reason two", "Reason three"],
          action: "Do something",
        })),
        creative_diagnostics: Array.from({ length: 7 }, (_, index) => ({
          id: `creative-${index}`,
          name: `Creative ${index}`,
          diagnosis: index === 0 ? "winner" : "weak_hold",
          action: "Protect it",
        })),
      },
      recommendations: Array.from({ length: 9 }, (_, index) => ({
        title: `Rec ${index}`,
      })),
      assistantQuestions: Array.from({ length: 8 }, (_, index) => ({
        id: `question-${index}`,
        question: `Question ${index}`,
      })),
    });

    expect(snapshot.top_campaigns).toHaveLength(6);
    expect(snapshot.top_ads).toHaveLength(6);
    expect(snapshot.decisions).toHaveLength(6);
    expect(snapshot.creative_diagnostics).toHaveLength(5);
    expect(snapshot.recommendations).toHaveLength(6);
    expect(snapshot.assistant_questions).toHaveLength(6);
    expect(snapshot.store_snapshot.top_products).toHaveLength(5);
    expect(snapshot.store_snapshot.low_stock_products).toHaveLength(5);
    expect(snapshot.store_snapshot.top_customers).toHaveLength(4);
    expect(snapshot.store_snapshot.geography.top_cities).toHaveLength(4);
    expect(snapshot.response_mode).toBe("operator_brief");
    expect(snapshot.requested_lenses).toContain("operator_plan");
    expect(snapshot.operational_risks.length).toBeGreaterThan(0);
    expect(snapshot.growth_opportunities.length).toBeGreaterThan(0);
    expect(snapshot.campaign_opportunities.length).toBeGreaterThan(0);
    expect(snapshot.market_signals.length).toBeGreaterThan(0);
    expect(snapshot.creative_priorities.length).toBeGreaterThan(0);
    expect(snapshot.decisions[0].why).toHaveLength(2);
  });

  it("surfaces a clear error when Meta rejects the saved access token", async () => {
    jest.spyOn(axios, "get").mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: 190,
            type: "OAuthException",
            message: "Invalid OAuth access token.",
          },
        },
      },
    });

    await expect(
      fetchMetaAdAccounts({
        accessToken: "bad-token",
      }),
    ).rejects.toMatchObject({
      status: 400,
      publicMessage:
        "Meta rejected the saved access token. Reconnect Meta and try again.",
    });
  });

  it("surfaces a clear error when the selected ad account is invalid", async () => {
    jest.spyOn(axios, "get").mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: 100,
            message:
              "Unsupported get request. Object with ID 'act_123456' does not exist.",
          },
        },
      },
    });

    await expect(
      fetchMetaCampaigns({
        accessToken: "token",
        adAccountId: "act_123456",
      }),
    ).rejects.toMatchObject({
      status: 400,
      publicMessage:
        "One of the selected Meta business or ad account IDs is invalid or no longer accessible.",
    });
  });
});
