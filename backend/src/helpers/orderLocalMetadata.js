const LOCAL_ORDER_METADATA_KEY = "_moon_profit_local_order";
export const DEFAULT_SHIPPING_ISSUE_REASON = "issue";
export const SHIPPING_ISSUE_REASON_VALUES = Object.freeze([
  "confirm_return",
  "part_with_phone",
  "delivered",
  "cancel",
  DEFAULT_SHIPPING_ISSUE_REASON,
  "part",
  "return_with_phone",
]);
const SHIPPING_ISSUE_REASON_SET = new Set(SHIPPING_ISSUE_REASON_VALUES);
const EDITABLE_SHIPPING_ADDRESS_FIELDS = [
  "address1",
  "address2",
  "city",
  "province",
  "country",
  "zip",
];

const hasOwn = (value, key) =>
  Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

const normalizeText = (value) => String(value ?? "").trim();
export const normalizeShippingIssueReason = (
  value,
  fallback = DEFAULT_SHIPPING_ISSUE_REASON,
) => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, "_");

  return SHIPPING_ISSUE_REASON_SET.has(normalized) ? normalized : fallback;
};

const toPlainObject = (value) => {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object" && !Array.isArray(value) ? value : {};
};

const clonePlainObject = (value) =>
  JSON.parse(JSON.stringify(toPlainObject(value) || {}));

const normalizeEditableShippingAddress = (value = {}) => {
  const source = toPlainObject(value);
  const normalized = {};

  for (const field of EDITABLE_SHIPPING_ADDRESS_FIELDS) {
    normalized[field] = normalizeText(source?.[field]);
  }

  return normalized;
};

const isSameEditableShippingAddress = (left = {}, right = {}) =>
  EDITABLE_SHIPPING_ADDRESS_FIELDS.every(
    (field) =>
      normalizeText(left?.[field]) === normalizeText(right?.[field]),
  );

const normalizePhoneChange = (value = {}) => {
  const source = toPlainObject(value);

  return {
    original: normalizeText(source?.original),
    edited: normalizeText(source?.edited),
    updated_at: normalizeText(source?.updated_at),
    updated_by: normalizeText(source?.updated_by),
    updated_by_name: normalizeText(source?.updated_by_name),
  };
};

const normalizeAddressChange = (value = {}) => {
  const source = toPlainObject(value);

  return {
    original: normalizeEditableShippingAddress(source?.original),
    edited: normalizeEditableShippingAddress(source?.edited),
    updated_at: normalizeText(source?.updated_at),
    updated_by: normalizeText(source?.updated_by),
    updated_by_name: normalizeText(source?.updated_by_name),
  };
};

const normalizeContactOverrides = (value = {}) => {
  const source = toPlainObject(value);
  const normalized = {};

  if (source?.customer_phone) {
    const phoneChange = normalizePhoneChange(source.customer_phone);
    if (phoneChange.original || phoneChange.edited) {
      normalized.customer_phone = phoneChange;
    }
  }

  if (source?.shipping_address) {
    const addressChange = normalizeAddressChange(source.shipping_address);
    if (
      Object.values(addressChange.original).some(Boolean) ||
      Object.values(addressChange.edited).some(Boolean)
    ) {
      normalized.shipping_address = addressChange;
    }
  }

  return normalized;
};

const normalizeShippingIssue = (value = {}) => {
  const source = toPlainObject(value);
  if (Object.keys(source).length === 0) {
    return null;
  }

  return {
    reason: normalizeShippingIssueReason(source?.reason),
    shipping_company_note: normalizeText(source?.shipping_company_note),
    customer_service_note: normalizeText(source?.customer_service_note),
    updated_at: normalizeText(source?.updated_at),
    updated_by: normalizeText(source?.updated_by),
    updated_by_name: normalizeText(source?.updated_by_name),
  };
};

const buildLocalMetadata = (value = {}) => {
  const source = toPlainObject(value);
  const contactOverrides = normalizeContactOverrides(source?.contact_overrides);
  const shippingIssue = normalizeShippingIssue(source?.shipping_issue);

  return {
    contact_overrides: contactOverrides,
    shipping_issue: shippingIssue,
  };
};

const buildPersistedLocalMetadata = (
  contactOverrides = {},
  shippingIssue = null,
) => {
  const persisted = {};

  if (Object.keys(contactOverrides).length > 0) {
    persisted.contact_overrides = contactOverrides;
  }

  if (shippingIssue) {
    persisted.shipping_issue = shippingIssue;
  }

  return persisted;
};

const setNestedValue = (target, path, value) => {
  const segments = Array.isArray(path) ? path : [];
  if (segments.length === 0) {
    return;
  }

  let current = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    current[segment] = toPlainObject(current[segment]);
    current = current[segment];
  }

  current[segments[segments.length - 1]] = value;
};

const applyCustomerPhoneOverride = (orderData, phoneValue) => {
  const normalizedPhone = normalizeText(phoneValue);
  setNestedValue(orderData, ["customer"], {
    ...toPlainObject(orderData?.customer),
    phone: normalizedPhone,
  });
  setNestedValue(orderData, ["shipping_address"], {
    ...toPlainObject(orderData?.shipping_address),
    phone: normalizedPhone,
  });
};

const applyShippingAddressOverride = (orderData, shippingAddress = {}) => {
  setNestedValue(orderData, ["shipping_address"], {
    ...toPlainObject(orderData?.shipping_address),
    ...normalizeEditableShippingAddress(shippingAddress),
  });
};

export const extractOrderLocalMetadata = (orderData) => {
  const data = toPlainObject(orderData);
  return buildLocalMetadata(data?.[LOCAL_ORDER_METADATA_KEY]);
};

export const applyOrderLocalMetadata = (
  orderData,
  metadataInput = extractOrderLocalMetadata(orderData),
) => {
  const nextData = clonePlainObject(orderData);
  const metadata = buildLocalMetadata(metadataInput);
  const contactOverrides = metadata.contact_overrides || {};
  const shippingIssue = metadata.shipping_issue || null;

  if (contactOverrides.customer_phone?.edited) {
    applyCustomerPhoneOverride(nextData, contactOverrides.customer_phone.edited);
  }

  if (contactOverrides.shipping_address?.edited) {
    applyShippingAddressOverride(nextData, contactOverrides.shipping_address.edited);
  }

  const persistedMetadata = buildPersistedLocalMetadata(
    contactOverrides,
    shippingIssue,
  );

  if (Object.keys(persistedMetadata).length > 0) {
    nextData[LOCAL_ORDER_METADATA_KEY] = persistedMetadata;
  } else {
    delete nextData[LOCAL_ORDER_METADATA_KEY];
  }

  return nextData;
};

export const mergeOrderLocalMetadata = (
  orderData,
  updates = {},
  options = {},
) => {
  const nextData = applyOrderLocalMetadata(orderData);
  const currentMetadata = extractOrderLocalMetadata(nextData);
  const nextMetadata = buildLocalMetadata(currentMetadata);
  const nextContactOverrides = {
    ...(nextMetadata.contact_overrides || {}),
  };
  let nextShippingIssue = nextMetadata.shipping_issue
    ? normalizeShippingIssue(nextMetadata.shipping_issue)
    : null;
  const updatedAt =
    normalizeText(options?.updatedAt) || new Date().toISOString();
  const updatedBy = normalizeText(options?.updatedBy);
  const updatedByName = normalizeText(options?.updatedByName);

  if (hasOwn(updates, "customer_phone")) {
    const originalPhone =
      nextContactOverrides.customer_phone?.original ||
      normalizeText(nextData?.customer?.phone || nextData?.shipping_address?.phone);
    const editedPhone = normalizeText(updates.customer_phone);

    if (editedPhone && editedPhone !== originalPhone) {
      nextContactOverrides.customer_phone = {
        original: originalPhone,
        edited: editedPhone,
        updated_at: updatedAt,
        updated_by: updatedBy,
        updated_by_name: updatedByName,
      };
      applyCustomerPhoneOverride(nextData, editedPhone);
    } else {
      delete nextContactOverrides.customer_phone;
      applyCustomerPhoneOverride(nextData, originalPhone);
    }
  }

  if (hasOwn(updates, "shipping_address")) {
    const originalAddress =
      nextContactOverrides.shipping_address?.original ||
      normalizeEditableShippingAddress(nextData?.shipping_address);
    const editedAddress = normalizeEditableShippingAddress(
      updates?.shipping_address,
    );

    if (!isSameEditableShippingAddress(originalAddress, editedAddress)) {
      nextContactOverrides.shipping_address = {
        original: originalAddress,
        edited: editedAddress,
        updated_at: updatedAt,
        updated_by: updatedBy,
        updated_by_name: updatedByName,
      };
      applyShippingAddressOverride(nextData, editedAddress);
    } else {
      delete nextContactOverrides.shipping_address;
      applyShippingAddressOverride(nextData, originalAddress);
    }
  }

  if (hasOwn(updates, "shipping_issue")) {
    if (updates.shipping_issue === null) {
      nextShippingIssue = null;
    } else {
      const shippingIssueInput = toPlainObject(updates.shipping_issue);
      nextShippingIssue = {
        reason: normalizeShippingIssueReason(shippingIssueInput?.reason),
        shipping_company_note: normalizeText(
          shippingIssueInput?.shipping_company_note,
        ),
        customer_service_note: normalizeText(
          shippingIssueInput?.customer_service_note,
        ),
        updated_at: updatedAt,
        updated_by: updatedBy,
        updated_by_name: updatedByName,
      };
    }
  }

  const persistedMetadata = buildPersistedLocalMetadata(
    nextContactOverrides,
    nextShippingIssue,
  );

  if (Object.keys(persistedMetadata).length > 0) {
    nextData[LOCAL_ORDER_METADATA_KEY] = persistedMetadata;
  } else {
    delete nextData[LOCAL_ORDER_METADATA_KEY];
  }

  return nextData;
};

export const preserveOrderLocalMetadata = (incomingData, existingData) =>
  applyOrderLocalMetadata(incomingData, extractOrderLocalMetadata(existingData));

export const getEditableShippingAddressFromOrderData = (orderData) =>
  normalizeEditableShippingAddress(toPlainObject(orderData)?.shipping_address);
