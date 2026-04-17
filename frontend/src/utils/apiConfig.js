export const DEFAULT_DEV_API_BASE = "http://localhost:5000/api";
export const DEFAULT_PROD_API_BASE = "/api";

export const normalizeApiBase = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");

export const resolveApiBase = (env = process.env) => {
  const configuredBase = normalizeApiBase(
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
