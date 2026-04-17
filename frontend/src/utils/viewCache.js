const DB_NAME = "moon_profit_local_cache";
const STORE_NAME = "views";
const LOCAL_STORAGE_PREFIX = "moon_profit_view_cache::";
const LOCAL_STORAGE_MAX_CHARS = 1_500_000;
const LOCAL_STORAGE_PREVIEW_ARRAY_LIMIT = 500;

let openDbPromise = null;

const isBrowser = () => typeof window !== "undefined";

const openDatabase = () => {
  if (!isBrowser() || typeof window.indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  if (!openDbPromise) {
    openDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(() => null);
  }

  return openDbPromise;
};

const readFromLocalStorage = (key) => {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeToLocalStorage = (key, value) => {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(
      `${LOCAL_STORAGE_PREFIX}${key}`,
      JSON.stringify(buildLocalStoragePayload(value)),
    );
  } catch {
    // Ignore cache write failures.
  }
};

const getJsonLength = (value) => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const buildPreviewValue = (value) => {
  if (Array.isArray(value)) {
    return value.slice(0, LOCAL_STORAGE_PREVIEW_ARRAY_LIMIT);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  let didTrim = false;
  const preview = { ...value };

  for (const [field, fieldValue] of Object.entries(preview)) {
    if (
      Array.isArray(fieldValue) &&
      fieldValue.length > LOCAL_STORAGE_PREVIEW_ARRAY_LIMIT
    ) {
      preview[field] = fieldValue.slice(0, LOCAL_STORAGE_PREVIEW_ARRAY_LIMIT);
      didTrim = true;
    }
  }

  return didTrim
    ? {
        ...preview,
        __cache_preview: true,
        __cache_preview_limit: LOCAL_STORAGE_PREVIEW_ARRAY_LIMIT,
      }
    : preview;
};

const buildLocalStoragePayload = (payload) => {
  if (getJsonLength(payload) <= LOCAL_STORAGE_MAX_CHARS) {
    return payload;
  }

  const previewPayload = {
    ...payload,
    value: buildPreviewValue(payload?.value),
    storage: {
      ...(payload?.storage || {}),
      full: "indexeddb",
      localStorage: "preview",
    },
  };

  if (getJsonLength(previewPayload) <= LOCAL_STORAGE_MAX_CHARS) {
    return previewPayload;
  }

  return {
    key: payload?.key,
    value: null,
    updatedAt: payload?.updatedAt,
    storage: {
      ...(payload?.storage || {}),
      full: "indexeddb",
      localStorage: "metadata",
    },
  };
};

export const buildStoreScopedCacheKey = (scope, storeIdOverride = null) => {
  if (!isBrowser()) {
    return scope;
  }

  let currentUserId = "anonymous";
  try {
    const rawUser = window.localStorage.getItem("user");
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    currentUserId = String(parsedUser?.id || "").trim() || "anonymous";
  } catch {
    currentUserId = "anonymous";
  }

  const currentStoreId =
    String(
      (storeIdOverride ?? window.localStorage.getItem("currentStoreId")) || "",
    ).trim() || "global";
  return `${scope}::${currentUserId}::${currentStoreId}`;
};

export const peekCachedView = (key) => readFromLocalStorage(key);

export const readCachedView = async (key) => {
  const database = await openDatabase();
  if (!database) {
    return readFromLocalStorage(key);
  }

  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);

      request.onsuccess = () => {
        resolve(request.result || readFromLocalStorage(key));
      };
      request.onerror = () => {
        resolve(readFromLocalStorage(key));
      };
    } catch {
      resolve(readFromLocalStorage(key));
    }
  });
};

export const writeCachedView = async (key, value) => {
  const payload = {
    key,
    value,
    updatedAt: new Date().toISOString(),
  };

  writeToLocalStorage(key, payload);

  const database = await openDatabase();
  if (!database) {
    return payload;
  }

  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(payload);
      transaction.oncomplete = () => resolve(payload);
      transaction.onerror = () => resolve(payload);
    } catch {
      resolve(payload);
    }
  });
};

export const getCacheAgeMs = (cachedEntry) => {
  const updatedAt = cachedEntry?.updatedAt;
  if (!updatedAt) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Date.now() - timestamp);
};

export const isCacheFresh = (cachedEntry, maxAgeMs) =>
  getCacheAgeMs(cachedEntry) <= maxAgeMs;
