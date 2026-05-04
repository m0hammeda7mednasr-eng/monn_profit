const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g;
const INLINE_WHITESPACE_PATTERN = /\s+/g;

export const normalizeTrackingNumber = (value) =>
  String(value ?? "")
    .replace(ZERO_WIDTH_PATTERN, "")
    .trim()
    .replace(INLINE_WHITESPACE_PATTERN, "");

export const isDemoTrackingNumber = (value) =>
  normalizeTrackingNumber(value).toUpperCase().startsWith("DEMO");
