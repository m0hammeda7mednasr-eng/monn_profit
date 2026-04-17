const namespaces = new Map();

const DEFAULT_MAX_ENTRIES = 200;
const BYPASS_QUERY_KEYS = new Set([
  "_",
  "t",
  "ts",
  "cache_bust",
  "cacheBust",
  "cache_refresh",
  "cacheRefresh",
]);
const BYPASS_QUERY_VALUES = new Set(["1", "true", "yes", "refresh", "reload", "bypass"]);

const getNamespace = (namespace) => {
  const name = String(namespace || "default").trim() || "default";
  if (!namespaces.has(name)) {
    namespaces.set(name, {
      entries: new Map(),
      inFlight: new Map(),
    });
  }

  return namespaces.get(name);
};

const pruneNamespace = (cache, maxEntries) => {
  const safeMaxEntries = Math.max(1, Number(maxEntries) || DEFAULT_MAX_ENTRIES);

  while (cache.entries.size > safeMaxEntries) {
    const oldestKey = cache.entries.keys().next().value;
    if (!oldestKey) {
      break;
    }
    cache.entries.delete(oldestKey);
  }
};

export const stableCacheStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCacheStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableCacheStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const normalizeCacheQuery = (query = {}) => {
  const normalized = {};

  for (const [key, value] of Object.entries(query || {})) {
    if (BYPASS_QUERY_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item ?? ""));
    } else if (value !== undefined) {
      normalized[key] = String(value ?? "");
    }
  }

  return normalized;
};

export const shouldBypassHeavyCache = (req) => {
  const query = req?.query || {};
  const headers = req?.headers || {};
  const cacheControl = String(headers["cache-control"] || "").toLowerCase();

  if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) {
    return true;
  }

  for (const key of BYPASS_QUERY_KEYS) {
    const value = query[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return true;
    }
  }

  const cacheMode = String(query.cache || query.cache_mode || "").trim().toLowerCase();
  if (BYPASS_QUERY_VALUES.has(cacheMode)) {
    return true;
  }

  const syncRecent = String(query.sync_recent || "").trim().toLowerCase();
  return syncRecent === "force";
};

export const readHeavyCacheEntry = (namespace, key, ttlMs) => {
  const cache = getNamespace(namespace);
  const entryKey = String(key || "");
  const entry = cache.entries.get(entryKey);

  if (!entry) {
    return null;
  }

  const ageMs = Date.now() - Number(entry.updatedAtMs || 0);
  if (!Number.isFinite(ageMs) || ageMs > Number(ttlMs || 0)) {
    cache.entries.delete(entryKey);
    return null;
  }

  return {
    value: entry.value,
    ageMs: Math.max(0, ageMs),
    updatedAtMs: entry.updatedAtMs,
  };
};

export const writeHeavyCacheEntry = (
  namespace,
  key,
  value,
  { maxEntries = DEFAULT_MAX_ENTRIES } = {},
) => {
  const cache = getNamespace(namespace);
  const entryKey = String(key || "");
  if (!entryKey) {
    return;
  }

  cache.entries.set(entryKey, {
    value,
    updatedAtMs: Date.now(),
  });
  pruneNamespace(cache, maxEntries);
};

export const getHeavyCacheInFlight = (namespace, key) => {
  const cache = getNamespace(namespace);
  return cache.inFlight.get(String(key || "")) || null;
};

export const setHeavyCacheInFlight = (namespace, key, promise) => {
  const cache = getNamespace(namespace);
  const entryKey = String(key || "");
  if (!entryKey || !promise) {
    return promise;
  }

  cache.inFlight.set(entryKey, promise);
  Promise.resolve(promise).finally(() => {
    if (cache.inFlight.get(entryKey) === promise) {
      cache.inFlight.delete(entryKey);
    }
  });

  return promise;
};

export const clearHeavyCacheByPrefix = (namespace, prefix = "") => {
  const cache = getNamespace(namespace);
  const normalizedPrefix = String(prefix || "");

  for (const key of cache.entries.keys()) {
    if (!normalizedPrefix || String(key).startsWith(normalizedPrefix)) {
      cache.entries.delete(key);
    }
  }

  for (const key of cache.inFlight.keys()) {
    if (!normalizedPrefix || String(key).startsWith(normalizedPrefix)) {
      cache.inFlight.delete(key);
    }
  }
};

export const clearHeavyCacheNamespace = (namespace) => {
  const cache = getNamespace(namespace);
  cache.entries.clear();
  cache.inFlight.clear();
};
