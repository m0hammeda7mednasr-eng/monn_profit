export const DEFAULT_DEV_API_BASE = "http://localhost:5000/api";
export const DEFAULT_PROD_API_BASE = "/api";

export const normalizeApiBase = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");

const ensureApiPath = (value) => {
  const normalized = normalizeApiBase(value);

  if (!normalized) {
    return "";
  }

  try {
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, "");

    if (!path) {
      url.pathname = "/api";
      return normalizeApiBase(url.toString());
    }
  } catch {
    // Relative API bases like /api are valid for Vercel rewrites.
  }

  return normalized;
};

export const resolveApiBase = (env = process.env) => {
  const configuredBase = ensureApiPath(
    env.REACT_APP_API_BASE_URL || env.REACT_APP_API_URL,
  );

  if (configuredBase) {
    return configuredBase;
  }

  return env.NODE_ENV === "production"
    ? DEFAULT_PROD_API_BASE
    : DEFAULT_DEV_API_BASE;
};

export const getEventsStreamUrl = (env = process.env) =>
  `${resolveApiBase(env)}/events/stream`;
