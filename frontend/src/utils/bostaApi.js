/**
 * Bosta API Integration Utilities
 * Frontend helpers for Bosta shipping integration
 */

// Bosta order types
export const BOSTA_ORDER_TYPES = {
  DELIVER: 10,
  CASH_COLLECTION: 15,
  EXCHANGE: 30,
  CRP: 25,
};

// Package types
export const BOSTA_PACKAGE_TYPES = {
  SMALL: "SMALL",
  MEDIUM: "MEDIUM",
  LARGE: "LARGE",
  LIGHT_BULKY: "Light Bulky",
  HEAVY_BULKY: "Heavy Bulky",
};

// Delivery states
export const BOSTA_DELIVERY_STATES = {
  PENDING: 0,
  PICKED_UP: 10,
  IN_TRANSIT: 20,
  OUT_FOR_DELIVERY: 30,
  DELIVERED: 40,
  EXCEPTION: 47,
  CANCELLED: 50,
  RETURNED: 60,
};

// State labels in Arabic and English
export const BOSTA_STATE_LABELS = {
  [BOSTA_DELIVERY_STATES.PENDING]: {
    ar: "في الانتظار",
    en: "Pending",
  },
  [BOSTA_DELIVERY_STATES.PICKED_UP]: {
    ar: "تم الاستلام",
    en: "Picked Up",
  },
  [BOSTA_DELIVERY_STATES.IN_TRANSIT]: {
    ar: "في الطريق",
    en: "In Transit",
  },
  [BOSTA_DELIVERY_STATES.OUT_FOR_DELIVERY]: {
    ar: "خرج للتوصيل",
    en: "Out for Delivery",
  },
  [BOSTA_DELIVERY_STATES.DELIVERED]: {
    ar: "تم التوصيل",
    en: "Delivered",
  },
  [BOSTA_DELIVERY_STATES.EXCEPTION]: {
    ar: "مشكلة في التوصيل",
    en: "Exception",
  },
  [BOSTA_DELIVERY_STATES.CANCELLED]: {
    ar: "ملغي",
    en: "Cancelled",
  },
  [BOSTA_DELIVERY_STATES.RETURNED]: {
    ar: "مرتجع",
    en: "Returned",
  },
};

/**
 * Get Bosta state label
 */
export const getBostaStateLabel = (state, language = "ar") => {
  const stateInfo = BOSTA_STATE_LABELS[state];
  if (!stateInfo) {
    return language === "ar" ? "غير معروف" : "Unknown";
  }
  return stateInfo[language] || stateInfo.ar;
};

/**
 * Get Bosta state badge class
 */
export const getBostaStateBadgeClass = (state) => {
  switch (state) {
    case BOSTA_DELIVERY_STATES.DELIVERED:
      return "bg-green-100 text-green-800 border border-green-200";
    case BOSTA_DELIVERY_STATES.OUT_FOR_DELIVERY:
      return "bg-blue-100 text-blue-800 border border-blue-200";
    case BOSTA_DELIVERY_STATES.IN_TRANSIT:
    case BOSTA_DELIVERY_STATES.PICKED_UP:
      return "bg-yellow-100 text-yellow-800 border border-yellow-200";
    case BOSTA_DELIVERY_STATES.EXCEPTION:
      return "bg-red-100 text-red-800 border border-red-200";
    case BOSTA_DELIVERY_STATES.CANCELLED:
    case BOSTA_DELIVERY_STATES.RETURNED:
      return "bg-gray-100 text-gray-800 border border-gray-200";
    case BOSTA_DELIVERY_STATES.PENDING:
    default:
      return "bg-gray-100 text-gray-600 border border-gray-200";
  }
};

/**
 * Check if order has Bosta tracking
 */
export const hasBostaTracking = (order) => {
  const data = order?.data || order;
  return !!(data?.bosta_tracking_number || data?.bosta_delivery_id);
};

/**
 * Get Bosta tracking info from order
 */
export const getBostaTrackingInfo = (order) => {
  const data = order?.data || order;

  if (!hasBostaTracking(order)) {
    return null;
  }

  return {
    trackingNumber: data.bosta_tracking_number,
    deliveryId: data.bosta_delivery_id,
    status: data.bosta_status,
    lastUpdate: data.bosta_last_update,
    deliveredAt: data.bosta_delivered_at,
    shippedAt: data.bosta_shipped_at,
    deliveryAttempts: data.bosta_delivery_attempts || 0,
    codCollected: data.bosta_cod_collected,
    exceptionReason: data.bosta_exception_reason,
    exceptionCode: data.bosta_exception_code,
  };
};

/**
 * Check if order is eligible for Bosta shipping
 */
export const isEligibleForBostaShipping = (order) => {
  const data = order?.data || order;

  // Must have shipping address
  if (!data?.shipping_address) {
    return false;
  }

  // Must not already be shipped with Bosta
  if (hasBostaTracking(order)) {
    return false;
  }

  // Must be from Egypt (Bosta only supports Egypt)
  const country =
    data.shipping_address?.country_code || data.shipping_address?.country;
  if (country && country.toUpperCase() !== "EG") {
    return false;
  }

  return true;
};

/**
 * Format address for Bosta API
 */
export const formatAddressForBosta = (shippingAddress) => {
  if (!shippingAddress) {
    return null;
  }

  return {
    firstLine: shippingAddress.address1 || "",
    secondLine: shippingAddress.address2 || "",
    city: shippingAddress.city || "",
    zone: shippingAddress.province || "",
    district: shippingAddress.city || "", // May need mapping
    buildingNumber: "",
    floor: "",
    apartment: "",
    geoLocation: {
      latitude: 0,
      longitude: 0,
    },
  };
};

/**
 * Calculate COD amount for order
 */
export const calculateCODAmount = (order) => {
  const data = order?.data || order;

  // Check if it's a COD order
  const isCOD =
    data?.financial_status === "pending" ||
    data?.gateway === "cash_on_delivery" ||
    data?.payment_gateway_names?.includes("Cash on Delivery");

  if (!isCOD) {
    return 0;
  }

  return parseFloat(data?.total_price || 0);
};

/**
 * Get package type suggestion based on order
 */
export const suggestPackageType = (order) => {
  const data = order?.data || order;
  const lineItems = data?.line_items || [];

  // Calculate total quantity and weight
  const totalQuantity = lineItems.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0,
  );
  const totalWeight = lineItems.reduce((sum, item) => {
    const weight = parseFloat(item.grams || 0) / 1000; // Convert to kg
    return sum + weight * (item.quantity || 0);
  }, 0);

  // Simple logic for package type suggestion
  if (totalWeight > 10 || totalQuantity > 10) {
    return BOSTA_PACKAGE_TYPES.LARGE;
  } else if (totalWeight > 3 || totalQuantity > 3) {
    return BOSTA_PACKAGE_TYPES.MEDIUM;
  } else {
    return BOSTA_PACKAGE_TYPES.SMALL;
  }
};

/**
 * Generate order description for Bosta
 */
export const generateOrderDescription = (order) => {
  const data = order?.data || order;
  const lineItems = data?.line_items || [];

  if (lineItems.length === 0) {
    return "طلب من المتجر الإلكتروني";
  }

  const description = lineItems
    .map((item) => `${item.quantity}x ${item.name || item.title}`)
    .join(", ");

  // Bosta has a 200 character limit
  return description.length > 200
    ? description.substring(0, 197) + "..."
    : description;
};

/**
 * API helper functions
 */

/**
 * Get cities from Bosta API
 */
export const fetchBostaCities = async () => {
  const response = await fetch("/api/bosta/cities", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch cities");
  }

  return response.json();
};

/**
 * Get zones for a city
 */
export const fetchBostaZones = async (cityId) => {
  const response = await fetch(`/api/bosta/cities/${cityId}/zones`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch zones");
  }

  return response.json();
};

/**
 * Get districts for a zone
 */
export const fetchBostaDistricts = async (zoneId) => {
  const response = await fetch(`/api/bosta/zones/${zoneId}/districts`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch districts");
  }

  return response.json();
};

/**
 * Get pricing for delivery
 */
export const fetchBostaPricing = async (pricingData) => {
  const response = await fetch("/api/bosta/pricing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(pricingData),
  });

  if (!response.ok) {
    throw new Error("Failed to get pricing");
  }

  return response.json();
};

/**
 * Ship order with Bosta
 */
export const shipOrderWithBosta = async (orderId, shippingOptions) => {
  const response = await fetch(`/api/bosta/orders/${orderId}/ship`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(shippingOptions),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to ship order");
  }

  return response.json();
};

/**
 * Get delivery status
 */
export const fetchDeliveryStatus = async (trackingNumber) => {
  const response = await fetch(`/api/bosta/deliveries/${trackingNumber}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to get delivery status");
  }

  return response.json();
};

/**
 * Cancel delivery
 */
export const cancelDelivery = async (trackingNumber, reason) => {
  const response = await fetch(
    `/api/bosta/deliveries/${trackingNumber}/cancel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ reason }),
    },
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Failed to cancel delivery");
  }

  return response.json();
};
