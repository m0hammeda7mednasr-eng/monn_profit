import { buildStoreScopedCacheKey } from "./viewCache";

const STORAGE_SCOPE = "shipping-issue-note-drafts";

const hasWindow = () => typeof window !== "undefined";

const normalizeText = (value) =>
  typeof value === "string" ? value : String(value ?? "");

const normalizeComparableText = (value) => normalizeText(value).trim();

const getStorageKey = () => buildStoreScopedCacheKey(STORAGE_SCOPE);

const hasAnyDraftValue = (draft = {}) =>
  Boolean(
    normalizeComparableText(draft?.shipping_company_note) ||
      normalizeComparableText(draft?.customer_service_note),
  );

const getOrderNoteSnapshot = (order = {}) => ({
  shipping_company_note: normalizeText(
    order?.shipping_issue?.shipping_company_note,
  ),
  customer_service_note: normalizeText(
    order?.shipping_issue?.customer_service_note,
  ),
});

const getDraftNoteSnapshot = (draft = {}) => ({
  shipping_company_note: normalizeText(draft?.shipping_company_note),
  customer_service_note: normalizeText(draft?.customer_service_note),
});

const getDraftBaseSnapshot = (draft = {}) => ({
  shipping_company_note: normalizeText(draft?.base_shipping_company_note),
  customer_service_note: normalizeText(draft?.base_customer_service_note),
});

const areNoteSnapshotsEqual = (left = {}, right = {}) =>
  normalizeComparableText(left?.shipping_company_note) ===
    normalizeComparableText(right?.shipping_company_note) &&
  normalizeComparableText(left?.customer_service_note) ===
    normalizeComparableText(right?.customer_service_note);

export const buildShippingIssueDraftRecord = (order, draft = {}) => {
  const nextDraft = getDraftNoteSnapshot(draft);
  if (!hasAnyDraftValue(nextDraft)) {
    return null;
  }

  const baseSnapshot = getOrderNoteSnapshot(order);
  return {
    ...nextDraft,
    base_shipping_company_note: baseSnapshot.shipping_company_note,
    base_customer_service_note: baseSnapshot.customer_service_note,
    updated_at: new Date().toISOString(),
  };
};

export const resolveShippingIssueDraft = (order, draft) => {
  const normalizedDraft = getDraftNoteSnapshot(draft);
  if (!hasAnyDraftValue(normalizedDraft)) {
    return {
      status: "invalid",
      draft: null,
    };
  }

  const currentNotes = getOrderNoteSnapshot(order);
  if (areNoteSnapshotsEqual(currentNotes, normalizedDraft)) {
    return {
      status: "synced",
      draft: normalizedDraft,
    };
  }

  const draftBase = getDraftBaseSnapshot(draft);
  if (areNoteSnapshotsEqual(currentNotes, draftBase)) {
    return {
      status: "hydrate",
      draft: normalizedDraft,
    };
  }

  return {
    status: "stale",
    draft: normalizedDraft,
  };
};

export const readShippingIssueDrafts = () => {
  if (!hasWindow()) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey());
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce((accumulator, [orderId, draft]) => {
      if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
        return accumulator;
      }

      const normalizedDraft = {
        shipping_company_note: normalizeText(draft.shipping_company_note),
        customer_service_note: normalizeText(draft.customer_service_note),
        base_shipping_company_note: normalizeText(
          draft.base_shipping_company_note,
        ),
        base_customer_service_note: normalizeText(
          draft.base_customer_service_note,
        ),
        updated_at: normalizeText(draft.updated_at),
      };

      if (!hasAnyDraftValue(normalizedDraft)) {
        return accumulator;
      }

      accumulator[String(orderId)] = normalizedDraft;
      return accumulator;
    }, {});
  } catch {
    return {};
  }
};

export const writeShippingIssueDrafts = (draftsByOrderId = {}) => {
  if (!hasWindow()) {
    return;
  }

  try {
    const nextDrafts = Object.entries(draftsByOrderId).reduce(
      (accumulator, [orderId, draft]) => {
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
          return accumulator;
        }

        const normalizedDraft = {
          shipping_company_note: normalizeText(draft.shipping_company_note),
          customer_service_note: normalizeText(draft.customer_service_note),
          base_shipping_company_note: normalizeText(
            draft.base_shipping_company_note,
          ),
          base_customer_service_note: normalizeText(
            draft.base_customer_service_note,
          ),
          updated_at: normalizeText(draft.updated_at),
        };

        if (!hasAnyDraftValue(normalizedDraft)) {
          return accumulator;
        }

        accumulator[String(orderId)] = normalizedDraft;
        return accumulator;
      },
      {},
    );

    if (Object.keys(nextDrafts).length === 0) {
      window.localStorage.removeItem(getStorageKey());
      return;
    }

    window.localStorage.setItem(getStorageKey(), JSON.stringify(nextDrafts));
  } catch {
    // Ignore local draft persistence errors.
  }
};
