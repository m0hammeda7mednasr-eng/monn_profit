const DEFAULT_LOCALE = "en";

export const INITIAL_ORDER_SCOPE_FILTERS = {
  dateFrom: "",
  dateTo: "",
  ordersLimit: "",
  paymentFilter: "all",
  fulfillmentFilter: "all",
  refundFilter: "all",
};

const ORDER_SCOPE_PRESET_DEFINITIONS = [
  {
    id: "all",
    labelKey: "all",
    filters: {},
  },
  {
    id: "paid",
    labelKey: "paid",
    filters: {
      paymentFilter: "paid_or_partial",
    },
  },
  {
    id: "pending",
    labelKey: "pending",
    filters: {
      paymentFilter: "pending_or_authorized",
    },
  },
  {
    id: "fulfilled",
    labelKey: "fulfilled",
    filters: {
      fulfillmentFilter: "fulfilled",
    },
  },
  {
    id: "refunds",
    labelKey: "refunds",
    filters: {
      refundFilter: "any",
    },
  },
];

const ORDER_SCOPE_DATE_PRESET_DEFINITIONS = [
  { id: "all", labelKey: "all" },
  { id: "today", labelKey: "today" },
  { id: "yesterday", labelKey: "yesterday" },
  { id: "weekly", labelKey: "weekly" },
  { id: "half_monthly", labelKey: "half_monthly" },
  { id: "monthly", labelKey: "monthly" },
];

const ORDER_SCOPE_TRANSLATIONS = {
  ar: {
    presets: {
      all: {
        label: "\u0643\u0644 \u0627\u0644\u0637\u0644\u0628\u0627\u062a",
        description: "\u0639\u0631\u0636 \u0643\u0627\u0645\u0644 \u0628\u062f\u0648\u0646 \u0623\u064a \u062a\u0642\u064a\u064a\u062f.",
      },
      paid: {
        label: "\u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629",
        description:
          "\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629 \u0623\u0648 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629 \u062c\u0632\u0626\u064a\u064b\u0627.",
      },
      pending: {
        label: "\u0642\u064a\u062f \u0627\u0644\u062a\u062d\u0635\u064a\u0644",
        description:
          "\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0645\u0639\u0644\u0642\u0629 \u0623\u0648 \u0627\u0644\u0645\u0635\u0631\u062d \u0628\u0647\u0627.",
      },
      fulfilled: {
        label: "\u062a\u0645 \u062a\u0633\u0644\u064a\u0645\u0647",
        description:
          "\u0627\u0644\u0637\u0644\u0628\u0627\u062a \u0627\u0644\u062a\u064a \u062a\u0645 \u062a\u0633\u0644\u064a\u0645\u0647\u0627 \u0641\u0639\u0644\u064a\u064b\u0627.",
      },
      refunds: {
        label: "\u0645\u0631\u062a\u062c\u0639\u0627\u062a",
        description: "\u0623\u064a \u0637\u0644\u0628 \u064a\u062d\u062a\u0648\u064a \u0639\u0644\u0649 \u0627\u0633\u062a\u0631\u062c\u0627\u0639.",
      },
    },
    datePresets: {
      all: "\u0643\u0644 \u0627\u0644\u0641\u062a\u0631\u0627\u062a",
      today: "\u064a\u0648\u0645\u064a: \u0627\u0644\u064a\u0648\u0645",
      yesterday: "\u0623\u0645\u0633",
      weekly: "\u0623\u0633\u0628\u0648\u0639\u064a: \u0622\u062e\u0631 7 \u0623\u064a\u0627\u0645",
      half_monthly:
        "\u0646\u0635\u0641 \u0634\u0647\u0631\u064a: \u0622\u062e\u0631 15 \u064a\u0648\u0645",
      monthly: "\u0634\u0647\u0631\u064a: \u0622\u062e\u0631 30 \u064a\u0648\u0645",
      custom: "\u062a\u062e\u0635\u064a\u0635 \u064a\u062f\u0648\u064a",
    },
    labels: {
      start: "\u0627\u0644\u0628\u062f\u0627\u064a\u0629",
      now: "\u0627\u0644\u0622\u0646",
      period: "\u0627\u0644\u0641\u062a\u0631\u0629",
      ordersLimit: "\u0639\u062f\u062f \u0627\u0644\u0623\u0648\u0631\u062f\u0631\u0627\u062a",
      ordersLimitHint:
        "\u0627\u062a\u0631\u0643\u0647\u0627 \u0641\u0627\u0631\u063a\u0629 \u0644\u062a\u062d\u0644\u064a\u0644 \u0643\u0644 \u0637\u0644\u0628\u0627\u062a \u0627\u0644\u0646\u0637\u0627\u0642\u060c \u0623\u0648 \u0627\u0643\u062a\u0628 \u0645\u062b\u0644\u064b\u0627 1000 \u0623\u0648 4000.",
      payment: "\u0627\u0644\u062f\u0641\u0639",
      fulfillment: "\u0627\u0644\u062a\u0633\u0644\u064a\u0645",
      refund: "\u0627\u0644\u0627\u0633\u062a\u0631\u062c\u0627\u0639",
      recentOrders: "\u0622\u062e\u0631",
      orders: "\u0623\u0648\u0631\u062f\u0631",
      paid_or_partial:
        "\u0645\u062f\u0641\u0648\u0639 + \u0645\u062f\u0641\u0648\u0639 \u062c\u0632\u0626\u064a\u064b\u0627",
      pending_or_authorized:
        "\u0645\u0639\u0644\u0642 + \u0645\u0635\u0631\u062d \u0628\u0647",
      paid: "\u0645\u062f\u0641\u0648\u0639",
      partially_paid: "\u0645\u062f\u0641\u0648\u0639 \u062c\u0632\u0626\u064a\u064b\u0627",
      pending: "\u0645\u0639\u0644\u0642",
      authorized: "\u0645\u0635\u0631\u062d \u0628\u0647",
      refunded: "\u0645\u0633\u062a\u0631\u062f",
      partially_refunded: "\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u062c\u0632\u0626\u064a",
      voided: "\u0645\u0644\u063a\u064a",
      fulfilled: "\u062a\u0645 \u0627\u0644\u062a\u0633\u0644\u064a\u0645",
      partial: "\u062a\u0633\u0644\u064a\u0645 \u062c\u0632\u0626\u064a",
      unfulfilled: "\u063a\u064a\u0631 \u0645\u0633\u0644\u0651\u0645",
      any: "\u064a\u0648\u062c\u062f \u0627\u0633\u062a\u0631\u062c\u0627\u0639",
      full: "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0643\u0627\u0645\u0644",
      none: "\u0628\u062f\u0648\u0646 \u0627\u0633\u062a\u0631\u062c\u0627\u0639",
    },
  },
  en: {
    presets: {
      all: {
        label: "All Orders",
        description: "Full view with no restrictions.",
      },
      paid: {
        label: "Paid Sales",
        description: "Paid and partially paid orders.",
      },
      pending: {
        label: "Pending Collection",
        description: "Pending and authorized orders.",
      },
      fulfilled: {
        label: "Fulfilled",
        description: "Orders that have been fulfilled.",
      },
      refunds: {
        label: "Refunds",
        description: "Any order containing a refund.",
      },
    },
    datePresets: {
      all: "All Periods",
      today: "Daily: Today",
      yesterday: "Yesterday",
      weekly: "Weekly: Last 7 Days",
      half_monthly: "Half-Monthly: Last 15 Days",
      monthly: "Monthly: Last 30 Days",
      custom: "Manual Range",
    },
    labels: {
      start: "Start",
      now: "Now",
      period: "Period",
      ordersLimit: "Orders Count",
      ordersLimitHint:
        "Leave empty to analyze the full scoped orders, or enter a count like 1000 or 4000.",
      payment: "Payment",
      fulfillment: "Fulfillment",
      refund: "Refund",
      recentOrders: "Latest",
      orders: "orders",
      paid_or_partial: "Paid + Partially Paid",
      pending_or_authorized: "Pending + Authorized",
      paid: "Paid",
      partially_paid: "Partially Paid",
      pending: "Pending",
      authorized: "Authorized",
      refunded: "Refunded",
      partially_refunded: "Partially Refunded",
      voided: "Voided",
      fulfilled: "Fulfilled",
      partial: "Partially Fulfilled",
      unfulfilled: "Unfulfilled",
      any: "Has refund",
      full: "Full refund",
      none: "No refund",
    },
  },
};

const getOrderScopeTranslations = (locale = DEFAULT_LOCALE) =>
  ORDER_SCOPE_TRANSLATIONS[locale] || ORDER_SCOPE_TRANSLATIONS.en;

const hasValue = (value) => String(value || "").trim().length > 0;

const formatDateInputValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDateByDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};

export const getOrderScopePresets = (
  locale = DEFAULT_LOCALE,
  baseFilters = INITIAL_ORDER_SCOPE_FILTERS,
) => {
  const translations = getOrderScopeTranslations(locale);

  return ORDER_SCOPE_PRESET_DEFINITIONS.map((preset) => ({
    id: preset.id,
    filters: {
      ...baseFilters,
      ...preset.filters,
    },
    label: translations.presets[preset.labelKey].label,
    description: translations.presets[preset.labelKey].description,
  }));
};

export const getOrderScopeDatePresetRange = (
  presetId,
  now = new Date(),
) => {
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);

  switch (presetId) {
    case "today":
      return {
        dateFrom: formatDateInputValue(today),
        dateTo: formatDateInputValue(today),
      };
    case "yesterday": {
      const yesterday = shiftDateByDays(today, -1);
      return {
        dateFrom: formatDateInputValue(yesterday),
        dateTo: formatDateInputValue(yesterday),
      };
    }
    case "weekly": {
      const fromDate = shiftDateByDays(today, -6);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    case "half_monthly": {
      const fromDate = shiftDateByDays(today, -14);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    case "monthly": {
      const fromDate = shiftDateByDays(today, -29);
      return {
        dateFrom: formatDateInputValue(fromDate),
        dateTo: formatDateInputValue(today),
      };
    }
    default:
      return {
        dateFrom: "",
        dateTo: "",
      };
  }
};

export const resolveOrderScopeDatePreset = (
  filters = {},
  now = new Date(),
) => {
  const normalizedDateFrom = String(filters.dateFrom || "").trim();
  const normalizedDateTo = String(filters.dateTo || "").trim();

  if (!normalizedDateFrom && !normalizedDateTo) {
    return "all";
  }

  for (const presetId of ORDER_SCOPE_DATE_PRESET_DEFINITIONS.map(
    (preset) => preset.id,
  ).filter((value) => value !== "all")) {
    const presetRange = getOrderScopeDatePresetRange(presetId, now);
    if (
      presetRange.dateFrom === normalizedDateFrom &&
      presetRange.dateTo === normalizedDateTo
    ) {
      return presetId;
    }
  }

  return "custom";
};

export const applyOrderScopeDatePreset = (
  filters = {},
  presetId,
  now = new Date(),
) => {
  if (presetId === "custom") {
    return {
      ...INITIAL_ORDER_SCOPE_FILTERS,
      ...filters,
    };
  }

  return {
    ...INITIAL_ORDER_SCOPE_FILTERS,
    ...filters,
    ...getOrderScopeDatePresetRange(presetId, now),
  };
};

export const getOrderScopeDatePresets = (locale = DEFAULT_LOCALE) => {
  const translations = getOrderScopeTranslations(locale);

  return [
    ...ORDER_SCOPE_DATE_PRESET_DEFINITIONS.map((preset) => ({
      id: preset.id,
      label: translations.datePresets[preset.labelKey],
    })),
    {
      id: "custom",
      label: translations.datePresets.custom,
    },
  ];
};

export const hasActiveOrderScopeFilters = (filters = {}) =>
  hasValue(filters.dateFrom) ||
  hasValue(filters.dateTo) ||
  hasValue(filters.ordersLimit) ||
  String(filters.paymentFilter || "all") !== "all" ||
  String(filters.fulfillmentFilter || "all") !== "all" ||
  String(filters.refundFilter || "all") !== "all";

export const hasActiveOrdersListFilters = (filters = {}) =>
  hasValue(filters.searchTerm) ||
  hasValue(filters.dateFrom) ||
  hasValue(filters.dateTo) ||
  hasValue(filters.orderNumberFrom) ||
  hasValue(filters.orderNumberTo) ||
  hasValue(filters.amountMin) ||
  hasValue(filters.amountMax) ||
  String(filters.paymentFilter || "all") !== "all" ||
  String(filters.paymentMethodFilter || "all") !== "all" ||
  String(filters.fulfillmentFilter || "all") !== "all" ||
  String(filters.refundFilter || "all") !== "all" ||
  Boolean(filters.cancelledOnly) ||
  Boolean(filters.fulfilledOnly) ||
  Boolean(filters.paidOnly);

export const buildOrderScopeApiParams = (filters = {}) => {
  const params = {};

  if (hasValue(filters.dateFrom)) {
    params.date_from = filters.dateFrom;
  }
  if (hasValue(filters.dateTo)) {
    params.date_to = filters.dateTo;
  }
  if (hasValue(filters.ordersLimit)) {
    params.orders_limit = String(filters.ordersLimit).replace(/[^\d]/g, "");
  }
  if (String(filters.paymentFilter || "all") !== "all") {
    params.payment_status = filters.paymentFilter;
  }
  if (String(filters.fulfillmentFilter || "all") !== "all") {
    params.fulfillment_status = filters.fulfillmentFilter;
  }
  if (String(filters.refundFilter || "all") !== "all") {
    params.refund_filter = filters.refundFilter;
  }

  return params;
};

export const buildOrdersListApiParams = (filters = {}) => {
  const params = {};

  if (hasValue(filters.searchTerm)) {
    params.search = String(filters.searchTerm).trim();
  }
  if (hasValue(filters.dateFrom)) {
    params.date_from = filters.dateFrom;
  }
  if (hasValue(filters.dateTo)) {
    params.date_to = filters.dateTo;
  }
  if (hasValue(filters.orderNumberFrom)) {
    params.order_number_from = String(filters.orderNumberFrom)
      .replace(/[^\d]/g, "")
      .trim();
  }
  if (hasValue(filters.orderNumberTo)) {
    params.order_number_to = String(filters.orderNumberTo)
      .replace(/[^\d]/g, "")
      .trim();
  }
  if (hasValue(filters.amountMin)) {
    params.min_total = String(filters.amountMin).trim();
  }
  if (hasValue(filters.amountMax)) {
    params.max_total = String(filters.amountMax).trim();
  }
  if (String(filters.paymentFilter || "all") !== "all") {
    params.payment_status = filters.paymentFilter;
  }
  if (String(filters.paymentMethodFilter || "all") !== "all") {
    params.payment_method = filters.paymentMethodFilter;
  }
  if (String(filters.fulfillmentFilter || "all") !== "all") {
    params.fulfillment_status = filters.fulfillmentFilter;
  }
  if (String(filters.refundFilter || "all") !== "all") {
    params.refund_filter = filters.refundFilter;
  }
  if (filters.cancelledOnly) {
    params.cancelled_only = "true";
  }
  if (filters.fulfilledOnly) {
    params.fulfilled_only = "true";
  }
  if (filters.paidOnly) {
    params.paid_only = "true";
  }

  return params;
};

const shallowMatch = (filters = {}, candidate = {}) =>
  Object.entries(candidate).every(
    ([key, value]) => String(filters?.[key] || "") === String(value || ""),
  );

export const getActiveOrderScopePresetId = (
  filters = {},
  baseFilters = INITIAL_ORDER_SCOPE_FILTERS,
) => {
  const normalized = {
    ...baseFilters,
    ...filters,
  };

  const matchingPreset = ORDER_SCOPE_PRESET_DEFINITIONS.find((preset) =>
    shallowMatch(normalized, {
      ...baseFilters,
      ...preset.filters,
    }),
  );

  return matchingPreset?.id || null;
};

export const getOrderScopeSummary = (
  filters = {},
  locale = DEFAULT_LOCALE,
) => {
  const parts = [];
  const translations = getOrderScopeTranslations(locale);
  const labels = translations.labels;
  const datePresetId = resolveOrderScopeDatePreset(filters);

  if (datePresetId !== "all") {
    if (datePresetId !== "custom") {
      parts.push(`${labels.period}: ${translations.datePresets[datePresetId]}`);
    } else if (hasValue(filters.dateFrom) || hasValue(filters.dateTo)) {
      const from = filters.dateFrom || labels.start;
      const to = filters.dateTo || labels.now;
      parts.push(`${labels.period}: ${from} -> ${to}`);
    }
  }

  if (hasValue(filters.ordersLimit)) {
    parts.push(
      `${labels.ordersLimit}: ${labels.recentOrders} ${filters.ordersLimit} ${labels.orders}`,
    );
  }

  if (String(filters.paymentFilter || "all") !== "all") {
    parts.push(
      `${labels.payment}: ${labels[filters.paymentFilter] || filters.paymentFilter}`,
    );
  }

  if (String(filters.fulfillmentFilter || "all") !== "all") {
    parts.push(
      `${
        labels.fulfillment
      }: ${labels[filters.fulfillmentFilter] || filters.fulfillmentFilter}`,
    );
  }

  if (String(filters.refundFilter || "all") !== "all") {
    parts.push(
      `${labels.refund}: ${labels[filters.refundFilter] || filters.refundFilter}`,
    );
  }

  return parts;
};
