export const parseAmount = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundAmount = (value) => Number(parseAmount(value).toFixed(2));
export const FIXED_OPENING_PACKAGE_FEE = 7.6;
export const BOSTA_VAT_RATE = 0.14;

export const getFallbackOrderCost = (order) =>
  order.line_items?.reduce((sum, item) => {
    const cost = parseFloat(item.cost_price || 0);
    const quantity = parseInt(item.quantity || 0, 10);
    return sum + cost * quantity;
  }, 0) || 0;

export const normalizeStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

const normalizeText = (value) => String(value || "").trim();
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseValidDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const dateOnlyMatch = normalized.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      0,
      0,
      0,
      0,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildDayBoundary = (value, endOfDay = false) => {
  const parsed = parseValidDate(value);
  if (!parsed) {
    return null;
  }

  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
};

const normalizeDateRange = (start, end) => {
  if (start && end && start > end) {
    return {
      start: new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
        0,
        0,
        0,
        0,
      ),
      end: new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        23,
        59,
        59,
        999,
      ),
    };
  }

  return { start, end };
};

const getReceiverName = (receiver = {}) =>
  normalizeText(
    receiver?.fullName ||
      [receiver?.firstName, receiver?.lastName].filter(Boolean).join(" "),
  );

export const getBostaFinancialDetails = (shipment = {}) => {
  const response = shipment?.bosta_response || {};
  const walletCashCycle = response?.wallet?.cashCycle || {};
  const pricing =
    response?.pricing?.after ||
    response?.pricing ||
    response?.tracking_response?.pricing;

  return {
    codAmount: parseAmount(shipment?.cod_amount ?? response?.cod),
    shippingFee: parseAmount(
      shipment?.shipping_cost ??
        shipment?.expected_shipping_cost ??
        walletCashCycle?.shipping_fees ??
        walletCashCycle?.shippingFees ??
        pricing?.shippingFee ??
        pricing?.shipping_fee ??
        response?.shipmentFees ??
        response?.shipment_fees,
    ),
    bostaDues: parseAmount(
      shipment?.estimated_bosta_dues ??
        shipment?.estimatedBostaDues ??
        shipment?.bosta_dues ??
        shipment?.bostaDues ??
      walletCashCycle?.bosta_fees ??
        walletCashCycle?.bostaFees ??
        response?.bosta_fees ??
        response?.bostaFees,
    ),
    depositedAmount: parseAmount(
      shipment?.deposited_amount ??
        shipment?.depositedAmount ??
      walletCashCycle?.deposited_amt ??
        walletCashCycle?.deposited_amount ??
        response?.depositedAmount,
    ),
    vatAmount: parseAmount(
      shipment?.vat_amount ?? shipment?.vatAmount ?? walletCashCycle?.vat,
    ),
    openingPackageFees: parseAmount(
      shipment?.opening_package_fees ??
        shipment?.openingPackageFees ??
      walletCashCycle?.opening_package_fees ??
        pricing?.openingPackageFee?.amount ??
        response?.pricing?.openingPackageFee?.amount,
    ),
    trackingUrl: normalizeText(
      shipment?.tracking_url || response?.TrackingURL || "",
    ),
    promisedDate:
      shipment?.delivery_promise_date ||
      response?.PromisedDate ||
      response?.scheduledAt ||
      null,
    lastStatusUpdate:
      shipment?.last_status_update ||
      shipment?.updated_at ||
      response?.updatedAt ||
      response?.CurrentStatus?.timestamp ||
      null,
    supportPhoneNumbers: normalizeStringList(
      shipment?.support_phone_numbers || response?.SupportPhoneNumbers,
    ),
  };
};

export const getEstimatedBostaDues = (shipment = {}) => {
  const financialDetails = getBostaFinancialDetails(shipment);
  const shippingFee = parseAmount(
    shipment?.shipping_fee ?? shipment?.shippingFee ?? financialDetails.shippingFee,
  );
  if (shippingFee <= 0) {
    return roundAmount(
      shipment?.estimated_bosta_dues ??
        shipment?.estimatedBostaDues ??
        financialDetails.bostaDues ??
        0,
    );
  }

  const openingPackageFees = roundAmount(FIXED_OPENING_PACKAGE_FEE);
  const vatAmount = roundAmount(
    (shippingFee + openingPackageFees) * BOSTA_VAT_RATE,
  );

  return roundAmount(shippingFee + openingPackageFees + vatAmount);
};

export const calculateScannerProfitSnapshot = ({
  orderTotal = 0,
  productCost = 0,
  shipment = {},
} = {}) => {
  const financialDetails = getBostaFinancialDetails(shipment);
  const normalizedOrderTotal = roundAmount(orderTotal);
  const normalizedProductCost = roundAmount(productCost);
  const shippingFee = roundAmount(
    shipment?.shipping_fee ?? shipment?.shippingFee ?? financialDetails.shippingFee,
  );
  const openingPackageFees =
    shippingFee > 0 ? roundAmount(FIXED_OPENING_PACKAGE_FEE) : 0;
  const vatAmount =
    shippingFee > 0
      ? roundAmount((shippingFee + openingPackageFees) * BOSTA_VAT_RATE)
      : 0;
  const estimatedBostaDues = roundAmount(
    shippingFee > 0
      ? shippingFee + openingPackageFees + vatAmount
      : getEstimatedBostaDues(shipment),
  );
  const netProfit = roundAmount(
    normalizedOrderTotal - estimatedBostaDues - normalizedProductCost,
  );

  return {
    orderTotal: normalizedOrderTotal,
    productCost: normalizedProductCost,
    estimatedBostaDues,
    shippingFee,
    openingPackageFees,
    vatAmount,
    netProfit,
  };
};

export const normalizeScannedItem = (item = {}) => {
  const financialDetails = getBostaFinancialDetails(item);
  const snapshot = calculateScannerProfitSnapshot({
    orderTotal:
      item?.order_total ??
      item?.orderTotal ??
      item?.revenue ??
      financialDetails.codAmount,
    productCost: item?.product_cost ?? item?.productCost ?? item?.total_cost,
    shipment: item,
  });

  return {
    ...item,
    order_total: snapshot.orderTotal,
    revenue: snapshot.orderTotal,
    product_cost: snapshot.productCost,
    total_cost: snapshot.productCost,
    estimated_bosta_dues: snapshot.estimatedBostaDues,
    shipping_fee: snapshot.shippingFee,
    shipping_cost: snapshot.shippingFee,
    opening_package_fees: snapshot.openingPackageFees,
    vat_amount: snapshot.vatAmount,
    bosta_dues: roundAmount(item?.bosta_dues ?? financialDetails.bostaDues),
    deposited_amount: roundAmount(
      item?.deposited_amount ?? financialDetails.depositedAmount,
    ),
    cod_amount: roundAmount(item?.cod_amount ?? financialDetails.codAmount),
    net_profit: snapshot.netProfit,
    real_net_profit: snapshot.netProfit,
  };
};

export const resolveBostaScannerFallback = (
  shipment = {},
  select = (_, englishText) => englishText,
) => {
  const response = shipment?.bosta_response || {};
  const receiver =
    shipment?.receiver ||
    response?.receiver ||
    response?.data?.receiver ||
    response?.tracking_response?.receiver ||
    {};
  const businessReference = normalizeText(
    shipment?.business_reference ||
      shipment?.order_name ||
      response?.businessReference ||
      response?.BusinessReference ||
      response?.tracking_response?.businessReference ||
      response?.tracking_response?.data?.businessReference,
  );
  const customerName =
    normalizeText(shipment?.customer_name) ||
    getReceiverName(receiver) ||
    select("غير معروف", "Unknown");
  const hasOrderMatch = Boolean(
    shipment?.has_order_match || normalizeText(shipment?.order_id),
  );
  const orderName =
    normalizeText(shipment?.order_name) ||
    businessReference ||
    (hasOrderMatch
      ? select("تم ربط الأوردر", "Matched order")
      : select("غير مربوط", "Unlinked"));
  const scanDataSource = normalizeText(
    shipment?.scan_data_source || shipment?.data_source,
  );
  const scanResolutionMessage =
    normalizeText(shipment?.scan_resolution_message) ||
    (hasOrderMatch
      ? ""
      : businessReference
        ? `${select(
            "الشحنة موجودة في بوسطة لكن لم يتم ربطها بأوردر داخلي بعد. المرجع الحالي:",
            "Shipment was found in Bosta, but no internal order match was found yet. Current reference:",
          )} ${businessReference}`
        : select(
            "النتيجة الحالية معتمدة على تتبع بوسطة فقط، لذلك بيانات الأوردر والتكلفة غير مكتملة.",
            "This result is based on Bosta tracking only, so order and cost data are still incomplete.",
          ));

  return {
    businessReference,
    customerName,
    orderName,
    hasOrderMatch,
    isBostaOnly: !hasOrderMatch,
    scanDataSource,
    scanResolutionMessage,
  };
};

export const isScannerItemFinanciallyResolved = (item = {}) =>
  Boolean(
    item?.has_order_match ||
      normalizeText(item?.order_id) ||
      normalizeText(item?.scan_data_source) === "database_enriched" ||
      normalizeText(item?.scan_data_source) === "shopify_lookup",
  );

export const canReuseScannedItem = (item = {}) =>
  Boolean(normalizeText(item?.tracking_number)) &&
  !Boolean(item?.is_pending) &&
  !Boolean(item?.has_error);

export const getBostaScannerItemTimestamp = (item = {}) =>
  parseValidDate(
    item?.scanned_at ||
      item?.last_status_update ||
      item?.updated_at ||
      item?.created_at,
  );

export const getBostaScannerTimeRange = (
  filters = {},
  nowInput = new Date(),
) => {
  const preset = normalizeText(filters?.timePreset || "details").toLowerCase();
  const now = parseValidDate(nowInput) || new Date();

  if (preset === "daily") {
    return {
      preset,
      ...normalizeDateRange(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0,
        ),
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          23,
          59,
          59,
          999,
        ),
      ),
    };
  }

  if (preset === "monthly") {
    return {
      preset,
      ...normalizeDateRange(
        new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      ),
    };
  }

  if (preset === "custom") {
    return {
      preset,
      ...normalizeDateRange(
        buildDayBoundary(filters?.customFrom, false),
        buildDayBoundary(filters?.customTo, true),
      ),
    };
  }

  return {
    preset: "details",
    start: null,
    end: null,
  };
};

export const getBostaScannerStatusKey = (item = {}) => {
  if (item?.is_pending) {
    return "pending";
  }

  if (item?.has_error) {
    return "failed";
  }

  const state = parseInt(item?.delivery_state, 10);
  if ([40, 45].includes(state)) {
    return "delivered";
  }

  if ([30, 41].includes(state)) {
    return "in_transit";
  }

  if ([47, 100, 101].includes(state)) {
    return "exception";
  }

  if ([48, 49, 50, 60].includes(state)) {
    return "cancelled";
  }

  return "other";
};

const buildBostaScannerSearchText = (item = {}) =>
  [
    item?.tracking_number,
    item?.order_name,
    item?.customer_name,
    item?.business_reference,
    item?.delivery_state_label,
    item?.scan_data_source,
    item?.scan_resolution_message,
    ...(Array.isArray(item?.support_phone_numbers)
      ? item.support_phone_numbers
      : []),
  ]
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean)
    .join(" ");

export const filterBostaScannerItems = (items = [], filters = {}) => {
  const normalizedSearchTerm = normalizeText(filters?.searchTerm).toLowerCase();
  const normalizedStatus = normalizeText(filters?.status || "all").toLowerCase();
  const activeTimeRange = getBostaScannerTimeRange(filters, filters?.now);

  return (Array.isArray(items) ? items : []).filter((item) => {
    const itemTimestamp = getBostaScannerItemTimestamp(item);

    if (
      (activeTimeRange.start || activeTimeRange.end) &&
      !itemTimestamp
    ) {
      return false;
    }

    if (activeTimeRange.start && itemTimestamp < activeTimeRange.start) {
      return false;
    }

    if (activeTimeRange.end && itemTimestamp > activeTimeRange.end) {
      return false;
    }

    if (
      normalizedStatus &&
      normalizedStatus !== "all" &&
      getBostaScannerStatusKey(item) !== normalizedStatus
    ) {
      return false;
    }

    if (!normalizedSearchTerm) {
      return true;
    }

    return buildBostaScannerSearchText(item).includes(normalizedSearchTerm);
  });
};

const formatExportDateValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
};

export const buildBostaScannerExportRows = (items = []) =>
  (Array.isArray(items) ? items : []).map((item) => [
    normalizeText(item?.tracking_number),
    getBostaScannerStatusKey(item),
    normalizeText(item?.delivery_state_label),
    normalizeText(item?.order_name),
    normalizeText(item?.business_reference),
    normalizeText(item?.customer_name),
    roundAmount(item?.cod_amount).toFixed(2),
    roundAmount(item?.order_total ?? item?.revenue).toFixed(2),
    roundAmount(item?.product_cost ?? item?.total_cost).toFixed(2),
    roundAmount(item?.estimated_bosta_dues ?? item?.bosta_dues).toFixed(2),
    roundAmount(item?.shipping_fee ?? item?.shipping_cost).toFixed(2),
    roundAmount(item?.opening_package_fees).toFixed(2),
    roundAmount(item?.vat_amount).toFixed(2),
    roundAmount(item?.net_profit).toFixed(2),
    formatExportDateValue(item?.scanned_at),
    formatExportDateValue(item?.last_status_update),
    formatExportDateValue(item?.promised_date),
    normalizeText(item?.scan_data_source),
    normalizeText(item?.scan_resolution_message),
    normalizeText(item?.tracking_url),
  ]);
