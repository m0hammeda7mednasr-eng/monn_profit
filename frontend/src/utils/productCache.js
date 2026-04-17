import api from "./api";
import { fetchAllPagesProgressively } from "./pagination";
import { HEAVY_VIEW_CACHE_FRESH_MS } from "./refreshPolicy";
import {
  buildStoreScopedCacheKey,
  isCacheFresh,
  peekCachedView,
  readCachedView,
  writeCachedView,
} from "./viewCache";

export const PRODUCT_CACHE_SCOPE = "products:list";
export const PRODUCT_CACHE_FRESH_MS = HEAVY_VIEW_CACHE_FRESH_MS;
export const PRODUCT_CACHE_PAGE_SIZE = 200;
export const PRODUCT_CACHE_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

export const buildProductsCacheKey = (storeIdOverride = null) =>
  buildStoreScopedCacheKey(PRODUCT_CACHE_SCOPE, storeIdOverride);

export const extractCachedProducts = (cachedEntry) => {
  const value = cachedEntry?.value || {};

  if (Array.isArray(value?.rows)) {
    return value.rows;
  }

  if (Array.isArray(value?.products)) {
    return value.products;
  }

  return [];
};

export const peekCachedProducts = (cacheKey) =>
  extractCachedProducts(peekCachedView(cacheKey));

export const readCachedProducts = async (cacheKey) => {
  const cached = await readCachedView(cacheKey);
  const rows = extractCachedProducts(cached);

  return {
    cached,
    rows,
    isFresh: isCacheFresh(cached, PRODUCT_CACHE_FRESH_MS),
    updatedAt: cached?.updatedAt ? new Date(cached.updatedAt) : null,
  };
};

export const writeProductsCache = async (cacheKey, rows) =>
  writeCachedView(cacheKey, {
    rows: Array.isArray(rows) ? rows : [],
  });

export const fetchProductPages = async ({
  limit = PRODUCT_CACHE_PAGE_SIZE,
  sortBy = "updated_at",
  sortDir = "desc",
  timeoutMs = PRODUCT_CACHE_REQUEST_TIMEOUT_MS,
  cacheRefresh = false,
  onPage = null,
} = {}) =>
  fetchAllPagesProgressively(
    ({ limit: pageLimit, offset }) =>
      api.get("/shopify/products", {
        params: {
          limit: pageLimit,
          offset,
          sort_by: sortBy,
          sort_dir: sortDir,
          ...(cacheRefresh ? { cache_refresh: "1" } : {}),
        },
        timeout: timeoutMs,
      }),
    {
      limit,
      onPage,
    },
  );
