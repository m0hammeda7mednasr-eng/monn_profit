// Vercel Serverless Function to proxy Bosta API requests
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const INLINE_WHITESPACE_PATTERN = /\s+/g;

const normalizeTrackingNumber = (value) =>
  String(value ?? "")
    .replace(ZERO_WIDTH_PATTERN, "")
    .trim()
    .replace(INLINE_WHITESPACE_PATTERN, "");

const isDemoTrackingNumber = (value) =>
  normalizeTrackingNumber(value).toUpperCase().startsWith("DEMO");

const formatStateName = (stateName) =>
  String(stateName || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) =>
      index > 0 && ["at", "for", "in", "of", "to"].includes(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");

const getStateLabel = (code, fallbackStateName) => {
  if (fallbackStateName) {
    return formatStateName(fallbackStateName);
  }

  const labels = {
    0: "Pending",
    10: "Pending",
    20: "In Transit",
    21: "Picked Up",
    22: "Heading to Customer",
    23: "Picked Up",
    24: "Received at Warehouse",
    25: "Fulfilled",
    30: "In Transit",
    40: "Delivered",
    41: "Out for Delivery",
    45: "Delivered",
    46: "Returned to Business",
    47: "Exception",
    48: "Terminated",
    49: "Cancelled",
    50: "Cancelled",
    60: "Returned",
    100: "Lost",
    101: "Damaged",
    102: "Investigation",
    103: "Awaiting Your Action",
    104: "Archived",
    105: "On Hold",
  };

  return labels[Number(code)] || "Unknown";
};

const isDeliveredState = (code, stateName) =>
  Number(code) === 40 ||
  Number(code) === 45 ||
  String(stateName || "").toUpperCase() === "DELIVERED";

const normalizeDisplayText = (value) => String(value || "").trim();

const getReceiverFullName = (receiver = {}) =>
  normalizeDisplayText(
    receiver?.fullName ||
      [receiver?.firstName, receiver?.lastName].filter(Boolean).join(" "),
  );

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getFirstPositiveAmount = (values = []) =>
  values.map(toNumber).find((value) => value > 0) || 0;

const getPricingAmount = (pricing = {}) => {
  if (!pricing || typeof pricing !== "object") {
    return 0;
  }

  return getFirstPositiveAmount([
    pricing?.priceAfterVat,
    pricing?.totalAfterVat,
    pricing?.totalWithVat,
    pricing?.amountAfterVat,
    pricing?.total,
    pricing?.priceBeforeVat,
    pricing?.shippingFee,
  ]);
};

const getPricingShippingFeeAmount = (pricing = {}) => {
  if (!pricing || typeof pricing !== "object") {
    return 0;
  }

  return getFirstPositiveAmount([
    pricing?.shippingFee,
    pricing?.shipping_fee,
  ]);
};

const getPricingAmountFromLogs = (delivery = {}) => {
  const logs = Array.isArray(delivery?.log) ? delivery.log : [];

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const pricing = logs[index]?.actionsList?.pricing;
    if (!pricing || typeof pricing !== "object") {
      continue;
    }

    const amount =
      getPricingAmount(pricing?.after) ||
      getPricingAmount(pricing?.before) ||
      getPricingAmount(pricing);

    if (amount > 0) {
      return amount;
    }
  }

  return 0;
};

const getShippingFeeAmountFromLogs = (delivery = {}) => {
  const logs = Array.isArray(delivery?.log) ? delivery.log : [];

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const pricing = logs[index]?.actionsList?.pricing;
    if (!pricing || typeof pricing !== "object") {
      continue;
    }

    const amount =
      getPricingShippingFeeAmount(pricing?.after) ||
      getPricingShippingFeeAmount(pricing?.before) ||
      getPricingShippingFeeAmount(pricing);

    if (amount > 0) {
      return amount;
    }
  }

  return 0;
};

const SHIPPING_TOTAL_AMOUNT_KEY_HINTS = [
  "estimateddues",
  "estimatedbostadues",
  "bostadues",
  "amountdue",
  "amounttobepaid",
  "feesaftervat",
  "netfees",
  "priceaftervat",
  "totalaftervat",
  "totalwithvat",
  "amountaftervat",
];

const SHIPPING_BASE_AMOUNT_KEY_HINTS = [
  "shipping",
  "shipmentfees",
  "shipment_fees",
  "deliveryfees",
  "delivery_fees",
  "dues",
  "fees",
];

const SHIPPING_AMOUNT_EXCLUDED_KEY_HINTS = [
  "cod",
  "cash",
  "collect",
  "collection",
  "amounttobecollected",
  "wallet",
  "discount",
  "refund",
  "returned",
];

const getDeepShippingAmount = (payload = {}) => {
  const seen = new Set();
  const candidates = [];

  const visit = (value, path = []) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...path, String(index)]));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const nextPath = [...path, key];
      const normalizedPath = nextPath.join(".").toLowerCase();
      const flatPath = normalizedPath.replace(/[^a-z0-9]/g, "");
      const numericValue = toNumber(child);
      const totalHint = SHIPPING_TOTAL_AMOUNT_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );
      const baseHint = SHIPPING_BASE_AMOUNT_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );
      const hasExcludedHint = SHIPPING_AMOUNT_EXCLUDED_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );

      if (numericValue > 0 && (totalHint || baseHint) && !hasExcludedHint) {
        candidates.push({
          amount: numericValue,
          score: totalHint ? 2 : 1,
        });
      }

      if (child && typeof child === "object") {
        visit(child, nextPath);
      }
    }
  };

  visit(payload);
  if (candidates.length === 0) {
    return 0;
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.amount - left.amount;
  });

  return candidates[0].amount;
};

const getDirectBostaShippingFeeAmount = (delivery = {}) =>
  getFirstPositiveAmount([
    delivery?.wallet?.cashCycle?.shipping_fees,
    delivery?.wallet?.cashCycle?.shippingFees,
    delivery?.pricing?.shippingFee,
    delivery?.pricing?.shipping_fee,
    delivery?.pricing?.after?.shippingFee,
    delivery?.pricing?.after?.shipping_fee,
    delivery?.pricing?.before?.shippingFee,
    delivery?.pricing?.before?.shipping_fee,
    delivery?.shippingFee,
    delivery?.shipping_fee,
    delivery?.expectedShippingCost,
    delivery?.expected_shipping_cost,
    delivery?.shippingCost,
    delivery?.shipping_cost,
  ]);

const getDirectBostaDuesAmount = (delivery = {}) =>
  getFirstPositiveAmount([
    delivery?.wallet?.cashCycle?.bosta_fees,
    delivery?.wallet?.cashCycle?.bostaFees,
    delivery?.estimatedDues,
    delivery?.estimated_dues,
    delivery?.estimatedBostaDues,
    delivery?.estimated_bosta_dues,
    delivery?.bostaDues,
    delivery?.bosta_dues,
    delivery?.dues,
    delivery?.amountDue,
    delivery?.amount_due,
    delivery?.amountToBePaid,
    delivery?.amount_to_be_paid,
    delivery?.shipmentFees,
    delivery?.shipment_fees,
    delivery?.expectedShippingCost,
    delivery?.expected_shipping_cost,
    delivery?.shippingCost,
    delivery?.shipping_cost,
  ]);

const getBostaShippingCost = (delivery = {}) => {
  const prioritizedCost =
    getDirectBostaShippingFeeAmount(delivery) ||
    getShippingFeeAmountFromLogs(delivery) ||
    getFirstPositiveAmount([delivery?.shipmentFees, delivery?.shipment_fees]) ||
    getDirectBostaDuesAmount(delivery) ||
    getPricingAmount(delivery?.pricing) ||
    getPricingAmount(delivery?.pricing?.after) ||
    getPricingAmount(delivery?.pricing?.before) ||
    getPricingAmountFromLogs(delivery) ||
    getDeepShippingAmount(delivery);

  if (prioritizedCost > 0) {
    return prioritizedCost;
  }

  return 0;
};

const formatPublicTrackingShipment = (publicTracking, trackingNumber) => {
  const currentStatus = publicTracking?.CurrentStatus || {};
  const transitEvents = Array.isArray(publicTracking?.TransitEvents)
    ? publicTracking.TransitEvents
    : [];
  const currentCode = Number(currentStatus.code || 0);
  const currentState = currentStatus.state;
  const businessReference = normalizeDisplayText(
    publicTracking?.BusinessReference ||
      publicTracking?.businessReference ||
      publicTracking?.shopifyOrderId,
  );
  const customerName = getReceiverFullName(
    publicTracking?.receiver || publicTracking?.Receiver,
  );
  const codAmount = Number(publicTracking?.cod || 0);

  return {
    tracking_number: publicTracking?.TrackingNumber || trackingNumber,
    delivery_id: publicTracking?._id || null,
    order_id: null,
    bosta_order_type: publicTracking?.type || null,
    delivery_state: currentCode,
    delivery_state_label: getStateLabel(currentCode, currentState),
    expected_shipping_cost: 0,
    shipping_cost: 0,
    cod_amount: codAmount,
    order_total: codAmount,
    product_cost: 0,
    revenue: codAmount,
    total_cost: 0,
    net_profit: codAmount,
    real_net_profit: codAmount,
    is_delivered: isDeliveredState(currentCode, currentState),
    business_reference: businessReference || null,
    customer_name: customerName || null,
    order_name: businessReference || publicTracking?.TrackingNumber || trackingNumber,
    has_order_match: false,
    scan_data_source: "vercel_public_bosta_fallback",
    scan_resolution_message:
      "Backend data is unavailable, so this result is based on Bosta tracking only.",
    created_at: transitEvents[0]?.timestamp || null,
    updated_at: currentStatus.timestamp || null,
    last_status_update: currentStatus.timestamp || null,
    delivery_promise_date: publicTracking?.PromisedDate || null,
    tracking_url: publicTracking?.TrackingURL || null,
    support_phone_numbers: publicTracking?.SupportPhoneNumbers || [],
    tracking_events: transitEvents.map((event) => ({
      state: event.state,
      code: event.code,
      label: getStateLabel(event.code, event.state),
      timestamp: event.timestamp,
    })),
    bosta_response: publicTracking,
  };
};

const fetchPublicTrackingShipment = async (trackingNumber) => {
  const response = await fetch(
    `https://tracking.bosta.co/shipments/track/${encodeURIComponent(
      trackingNumber,
    )}`,
    {
      headers: {
        Accept: "application/json",
      },
    },
  );
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Bosta tracking returned a non-JSON response`);
  }

  if (!response.ok) {
    throw new Error(
      data?.message || data?.error || `Bosta tracking returned ${response.status}`,
    );
  }

  return formatPublicTrackingShipment(data, trackingNumber);
};

const fetchBostaTrackingDetailsSafely = async (trackingNumber, apiKey) => {
  try {
    const response = await fetch(
      `https://app.bosta.co/api/v2/deliveries/${encodeURIComponent(
        trackingNumber,
      )}/tracking`,
      {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
      },
    );
    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Bosta tracking details returned a non-JSON response");
    }

    if (!response.ok) {
      throw new Error(
        data?.message ||
          data?.error ||
          `Bosta tracking details returned ${response.status}`,
      );
    }

    return data;
  } catch (error) {
    console.warn("Could not fetch Bosta business tracking details:", error.message);
    return null;
  }
};

const fetchBostaBusinessDelivery = async ({
  trackingNumber,
  apiKey,
  baseUrl,
  extraHeaders = {},
}) => {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "")}/deliveries/${encodeURIComponent(trackingNumber)}`,
    {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    },
  );
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Bosta business API returned a non-JSON response (${response.status})`,
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message || data?.error || `Bosta business API returned ${response.status}`,
    );
  }

  return data;
};

const fetchBostaBusinessDeliveryWithFallback = async (trackingNumber, apiKey) => {
  try {
    return await fetchBostaBusinessDelivery({
      trackingNumber,
      apiKey,
      baseUrl: "https://app.bosta.co/api/v2",
    });
  } catch (primaryError) {
    console.warn("Bosta v2 delivery lookup failed:", primaryError.message);
    return await fetchBostaBusinessDelivery({
      trackingNumber,
      apiKey,
      baseUrl: "https://app.bosta.co/api/v0",
      extraHeaders: {
        "X-Requested-By": "nodejs-sdk",
      },
    });
  }
};

const mergeBostaDeliveryPayloads = (delivery, tracking) => {
  if (!tracking || typeof tracking !== "object") {
    return delivery;
  }

  return {
    ...(delivery && typeof delivery === "object" ? delivery : {}),
    tracking_response: tracking,
  };
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const trackingNumber = normalizeTrackingNumber(req.query?.trackingNumber);

  if (!trackingNumber) {
    return res.status(400).json({ error: "Tracking number is required" });
  }

  if (isDemoTrackingNumber(trackingNumber)) {
    return res.status(410).json({
      error: "Demo tracking is disabled",
      message: "Use a real Bosta tracking number instead of demo data.",
    });
  }

  // Get Bosta API key from environment
  const bostaApiKey = process.env.BOSTA_API_KEY;

  if (!bostaApiKey) {
    console.error("BOSTA_API_KEY not configured");
    try {
      const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
      return res.status(200).json(publicShipment);
    } catch (publicError) {
      return res.status(500).json({
        error: "Bosta API key not configured",
        message: "Please add BOSTA_API_KEY to Vercel environment variables",
        publicTrackingError: publicError.message,
      });
    }
  }

  try {
    console.log(`Fetching shipment ${trackingNumber} from Bosta API`);

    const bostaData = await fetchBostaBusinessDeliveryWithFallback(
      trackingNumber,
      bostaApiKey,
    );
    console.log("Successfully fetched from Bosta API");
    const bostaTrackingData = await fetchBostaTrackingDetailsSafely(
      trackingNumber,
      bostaApiKey,
    );
    const mergedBostaData = mergeBostaDeliveryPayloads(
      bostaData,
      bostaTrackingData,
    );
    const deliveryStateCode = Number(
      bostaData?.state?.code || bostaData?.state?.value || 0,
    );
    const deliveryStateName =
      bostaData?.state?.value || bostaData?.state?.label || "";
    const businessReference = normalizeDisplayText(
      bostaData?.businessReference ||
        bostaData?.BusinessReference ||
        bostaData?.shopifyOrderId,
    );
    const customerName = getReceiverFullName(bostaData?.receiver);
    const shippingCost = getBostaShippingCost(mergedBostaData);
    const codAmount = Number(bostaData?.cod || 0);

    // Format response to match our schema
    const shipment = {
      tracking_number: bostaData.trackingNumber || trackingNumber,
      delivery_id: bostaData._id,
      order_id: null,
      bosta_order_type: bostaData.type,
      delivery_state: deliveryStateCode,
      delivery_state_label: getStateLabel(
        deliveryStateCode,
        deliveryStateName,
      ),
      expected_shipping_cost: shippingCost,
      shipping_cost: shippingCost,
      cod_amount: codAmount,
      order_total: codAmount,
      product_cost: 0,
      revenue: codAmount,
      total_cost: 0,
      net_profit: codAmount,
      real_net_profit: Number((codAmount - shippingCost).toFixed(2)),
      is_delivered: isDeliveredState(deliveryStateCode, deliveryStateName),
      business_reference: businessReference || null,
      customer_name: customerName || null,
      order_name:
        businessReference || bostaData.trackingNumber || trackingNumber,
      has_order_match: false,
      scan_data_source: "vercel_bosta_fallback",
      scan_resolution_message:
        "Backend data is unavailable, so this result is based on Bosta shipment data only.",
      created_at: bostaData.createdAt,
      updated_at: bostaData.updatedAt,
      receiver: bostaData.receiver,
      dropOffAddress: bostaData.dropOffAddress,
      notes: bostaData.notes,
      bosta_response: mergedBostaData,
    };

    return res.status(200).json(shipment);
  } catch (error) {
    console.error("Error fetching from Bosta:", error);
    try {
      const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
      return res.status(200).json(publicShipment);
    } catch (publicError) {
      return res.status(500).json({
        error: "Internal server error",
        message: error.message,
        publicTrackingError: publicError.message,
      });
    }
  }
}
