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

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getPricingAmount = (pricing = {}) => {
  if (!pricing || typeof pricing !== "object") {
    return 0;
  }

  const candidates = [
    pricing?.priceAfterVat,
    pricing?.totalAfterVat,
    pricing?.totalWithVat,
    pricing?.amountAfterVat,
    pricing?.total,
    pricing?.priceBeforeVat,
    pricing?.shippingFee,
  ].map(toNumber);

  return candidates.find((value) => value > 0) || 0;
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

const SHIPPING_AMOUNT_KEY_HINTS = [
  "shipping",
  "shipmentfees",
  "shipment_fees",
  "deliveryfees",
  "delivery_fees",
  "dues",
  "estimateddues",
  "feesaftervat",
  "netfees",
  "priceaftervat",
  "totalaftervat",
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
      const hasShippingHint = SHIPPING_AMOUNT_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );
      const hasExcludedHint = SHIPPING_AMOUNT_EXCLUDED_KEY_HINTS.some(
        (hint) => normalizedPath.includes(hint) || flatPath.includes(hint),
      );

      if (numericValue > 0 && hasShippingHint && !hasExcludedHint) {
        candidates.push(numericValue);
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

  return candidates.reduce(
    (lowestPositive, amount) =>
      amount > 0 && amount < lowestPositive ? amount : lowestPositive,
    candidates[0],
  );
};

const getBostaShippingCost = (delivery = {}) => {
  const prioritizedCost =
    getPricingAmount(delivery?.pricing) ||
    getPricingAmount(delivery?.pricing?.after) ||
    getPricingAmount(delivery?.pricing?.before) ||
    getPricingAmountFromLogs(delivery) ||
    getDeepShippingAmount(delivery);

  if (prioritizedCost > 0) {
    return prioritizedCost;
  }

  return toNumber(
    delivery?.estimatedDues ??
      delivery?.amountToBeCollected ??
      delivery?.dues ??
      delivery?.shipmentFees ??
      delivery?.expectedShippingCost ??
      delivery?.shippingCost,
  );
};

const formatPublicTrackingShipment = (publicTracking, trackingNumber) => {
  const currentStatus = publicTracking?.CurrentStatus || {};
  const transitEvents = Array.isArray(publicTracking?.TransitEvents)
    ? publicTracking.TransitEvents
    : [];
  const currentCode = Number(currentStatus.code || 0);
  const currentState = currentStatus.state;

  return {
    tracking_number: publicTracking?.TrackingNumber || trackingNumber,
    delivery_id: publicTracking?._id || null,
    order_id: null,
    bosta_order_type: publicTracking?.type || null,
    delivery_state: currentCode,
    delivery_state_label: getStateLabel(currentCode, currentState),
    expected_shipping_cost: 0,
    cod_amount: Number(publicTracking?.cod || 0),
    is_delivered: isDeliveredState(currentCode, currentState),
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

    // Call Bosta API
    const bostaResponse = await fetch(
      `https://app.bosta.co/api/v2/deliveries/${trackingNumber}`,
      {
        headers: {
          Authorization: bostaApiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!bostaResponse.ok) {
      console.error(`Bosta API returned ${bostaResponse.status}`);

      try {
        const publicShipment = await fetchPublicTrackingShipment(trackingNumber);
        return res.status(200).json(publicShipment);
      } catch (publicError) {
        console.error("Bosta public tracking fallback failed:", publicError);
      }

      if (bostaResponse.status === 404) {
        return res.status(404).json({
          error: "Tracking number not found in Bosta",
          tracking_number: trackingNumber,
        });
      }

      const errorText = await bostaResponse.text();
      console.error("Bosta API error:", errorText);

      return res.status(bostaResponse.status).json({
        error: "Failed to fetch from Bosta API",
        status: bostaResponse.status,
        details: errorText,
      });
    }

    const responseText = await bostaResponse.text();
    let bostaData = null;
    try {
      bostaData = responseText ? JSON.parse(responseText) : null;
    } catch {
      throw new Error("Bosta business API returned a non-JSON response");
    }

    console.log("Successfully fetched from Bosta API");

    // Format response to match our schema
    const shipment = {
      tracking_number: bostaData.trackingNumber || trackingNumber,
      delivery_id: bostaData._id,
      order_id: null,
      bosta_order_type: bostaData.type,
      delivery_state: bostaData.state?.value || 0,
      delivery_state_label: bostaData.state?.label || "Unknown",
      expected_shipping_cost: getBostaShippingCost(bostaData),
      cod_amount: bostaData.cod || 0,
      is_delivered: bostaData.state?.value === 40,
      created_at: bostaData.createdAt,
      updated_at: bostaData.updatedAt,
      receiver: bostaData.receiver,
      dropOffAddress: bostaData.dropOffAddress,
      notes: bostaData.notes,
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
