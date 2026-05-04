const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const INLINE_WHITESPACE_PATTERN = /\s+/g;

export const normalizeTrackingNumber = (value) =>
  String(value ?? "")
    .replace(ZERO_WIDTH_PATTERN, "")
    .trim()
    .replace(INLINE_WHITESPACE_PATTERN, "");

export const isDemoTrackingNumber = (value) =>
  normalizeTrackingNumber(value).toUpperCase().startsWith("DEMO");

export const getTrackingNumberValidationError = (
  value,
  { allowDemo = false } = {},
) => {
  const normalizedTrackingNumber = normalizeTrackingNumber(value);

  if (!normalizedTrackingNumber) {
    return "Tracking number is required";
  }

  if (!allowDemo && isDemoTrackingNumber(normalizedTrackingNumber)) {
    return "Demo tracking is disabled. Use a real Bosta tracking number instead of demo data.";
  }

  return "";
};

export const ensureValidTrackingNumber = (value, options) => {
  const normalizedTrackingNumber = normalizeTrackingNumber(value);
  const validationError = getTrackingNumberValidationError(
    normalizedTrackingNumber,
    options,
  );

  if (validationError) {
    throw new Error(validationError);
  }

  return normalizedTrackingNumber;
};
