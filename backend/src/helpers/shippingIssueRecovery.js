import {
  applyOrderLocalMetadata,
  DEFAULT_SHIPPING_ISSUE_REASON,
  extractOrderLocalMetadata,
} from "./orderLocalMetadata.js";

export const SHIPPING_ISSUE_UPDATE_OPERATION =
  "order_shipping_issue_update";
const DEFAULT_FETCH_CHUNK_SIZE = 200;

const normalizeText = (value) => String(value ?? "").trim();

const parseJsonField = (value) => {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return typeof value === "object" ? value : {};
};

const normalizeRecoveredShippingIssue = (issue, fallback = {}) => {
  if (!issue) {
    return null;
  }

  return {
    reason:
      normalizeText(issue?.reason) || DEFAULT_SHIPPING_ISSUE_REASON,
    shipping_company_note: normalizeText(issue?.shipping_company_note),
    customer_service_note: normalizeText(issue?.customer_service_note),
    updated_at:
      normalizeText(issue?.updated_at) ||
      normalizeText(fallback?.updated_at) ||
      new Date().toISOString(),
    updated_by:
      normalizeText(issue?.updated_by) ||
      normalizeText(fallback?.updated_by) ||
      "shipping-issue-history-recovery",
    updated_by_name:
      normalizeText(issue?.updated_by_name) ||
      normalizeText(fallback?.updated_by_name) ||
      "Shipping issue history recovery",
  };
};

const serializeIssue = (issue) =>
  JSON.stringify(issue || null);

export const fetchLatestShippingIssueOperationsByOrderId = async (
  supabaseClient,
  orderIds = [],
  { chunkSize = DEFAULT_FETCH_CHUNK_SIZE } = {},
) => {
  const normalizedIds = Array.from(
    new Set(
      (orderIds || [])
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
  const latestByOrderId = new Map();

  if (!supabaseClient || normalizedIds.length === 0) {
    return latestByOrderId;
  }

  for (let index = 0; index < normalizedIds.length; index += chunkSize) {
    const chunk = normalizedIds.slice(index, index + chunkSize);
    const { data, error } = await supabaseClient
      .from("sync_operations")
      .select("entity_id, created_at, request_data")
      .eq("operation_type", SHIPPING_ISSUE_UPDATE_OPERATION)
      .in("entity_id", chunk)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    for (const row of data || []) {
      const entityId = normalizeText(row?.entity_id);
      if (!entityId || latestByOrderId.has(entityId)) {
        continue;
      }

      latestByOrderId.set(entityId, row);
    }
  }

  return latestByOrderId;
};

export const buildShippingIssueRecoveryPlan = (
  orders = [],
  latestOperationByOrderId = new Map(),
) =>
  (orders || []).reduce((plan, order) => {
    const orderId = normalizeText(order?.id);
    if (!orderId) {
      return plan;
    }

    const latestOperation = latestOperationByOrderId.get(orderId);
    if (!latestOperation) {
      return plan;
    }

    const orderData = parseJsonField(order?.data);
    const metadata = extractOrderLocalMetadata(orderData);
    const currentIssue = metadata?.shipping_issue || null;
    const nextIssue = normalizeRecoveredShippingIssue(
      latestOperation?.request_data?.new_shipping_issue,
      {
        updated_at: latestOperation?.created_at,
      },
    );
    const nextData = applyOrderLocalMetadata(orderData, {
      ...metadata,
      shipping_issue: nextIssue,
    });
    const normalizedNextIssue =
      extractOrderLocalMetadata(nextData)?.shipping_issue || null;

    if (serializeIssue(currentIssue) === serializeIssue(normalizedNextIssue)) {
      return plan;
    }

    plan.push({
      order_id: orderId,
      order_number: order?.order_number || null,
      shopify_id: order?.shopify_id || null,
      before_issue: currentIssue,
      after_issue: normalizedNextIssue,
      source_created_at: latestOperation?.created_at || null,
      after_data: nextData,
    });

    return plan;
  }, []);

export const applyShippingIssueRecoveryPlan = async (
  supabaseClient,
  recoveryPlan = [],
) => {
  if (!supabaseClient || !Array.isArray(recoveryPlan) || recoveryPlan.length === 0) {
    return;
  }

  for (const item of recoveryPlan) {
    const updatePayload = {
      data: item.after_data,
      local_updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseClient
      .from("orders")
      .update(updatePayload)
      .eq("id", item.order_id);

    if (error) {
      throw error;
    }
  }
};

export const applyShippingIssueRecoveryPlanToRows = (
  orders = [],
  recoveryPlan = [],
) => {
  if (!Array.isArray(orders) || orders.length === 0 || !Array.isArray(recoveryPlan)) {
    return Array.isArray(orders) ? orders : [];
  }

  const recoveredDataByOrderId = new Map(
    recoveryPlan.map((item) => [item.order_id, item.after_data]),
  );

  return orders.map((order) => {
    const orderId = normalizeText(order?.id);
    if (!orderId || !recoveredDataByOrderId.has(orderId)) {
      return order;
    }

    return {
      ...order,
      data: recoveredDataByOrderId.get(orderId),
    };
  });
};

export const recoverShippingIssuesFromHistory = async ({
  supabaseClient,
  orders = [],
  persist = false,
} = {}) => {
  const candidateOrderIds = (orders || [])
    .map((order) => normalizeText(order?.id))
    .filter(Boolean);

  if (!supabaseClient || candidateOrderIds.length === 0) {
    return {
      orders,
      repairedCount: 0,
      recoveryPlan: [],
    };
  }

  const latestOperationByOrderId =
    await fetchLatestShippingIssueOperationsByOrderId(
      supabaseClient,
      candidateOrderIds,
    );
  const recoveryPlan = buildShippingIssueRecoveryPlan(
    orders,
    latestOperationByOrderId,
  );

  if (persist && recoveryPlan.length > 0) {
    await applyShippingIssueRecoveryPlan(supabaseClient, recoveryPlan);
  }

  return {
    orders: applyShippingIssueRecoveryPlanToRows(orders, recoveryPlan),
    repairedCount: recoveryPlan.length,
    recoveryPlan,
  };
};
