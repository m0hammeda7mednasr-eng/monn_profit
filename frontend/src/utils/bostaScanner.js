export const parseAmount = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

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
      walletCashCycle?.bosta_fees ??
        walletCashCycle?.bostaFees ??
        response?.bosta_fees ??
        response?.bostaFees,
    ),
    depositedAmount: parseAmount(
      walletCashCycle?.deposited_amt ??
        walletCashCycle?.deposited_amount ??
        response?.depositedAmount,
    ),
    vatAmount: parseAmount(walletCashCycle?.vat),
    openingPackageFees: parseAmount(
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
