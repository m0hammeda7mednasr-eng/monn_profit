import { extractArray } from "./response";

const getPaginationMeta = (payload) => {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  if (payload.pagination && typeof payload.pagination === "object") {
    return payload.pagination;
  }

  if (payload.data && typeof payload.data === "object") {
    return payload.data.pagination || {};
  }

  return {};
};

export const fetchAllPagesProgressively = async (
  requestPage,
  { limit = 200, maxPages = 500, onPage = null } = {},
) => {
  const rows = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = await requestPage({ limit, offset, pageIndex });
    const payload = response?.data;
    const batch = extractArray(payload);
    const pagination = getPaginationMeta(payload);

    rows.push(...batch);

    const hasMore =
      typeof pagination.has_more === "boolean"
        ? pagination.has_more
        : batch.length === limit;

    if (typeof onPage === "function" && batch.length > 0) {
      const shouldContinue = await onPage({
        batch,
        rows: [...rows],
        pageIndex,
        pagination,
        hasMore,
        payload,
        response,
      });
      if (shouldContinue === false) {
        break;
      }
    }

    if (batch.length === 0) {
      break;
    }

    if (!hasMore) {
      break;
    }

    offset =
      typeof pagination.next_offset === "number"
        ? pagination.next_offset
        : offset + batch.length;
  }

  return rows;
};

export const fetchAllPages = async (requestPage, options = {}) =>
  await fetchAllPagesProgressively(requestPage, options);
