import { supabase } from "../supabaseClient.js";

const USER_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const userLookupCache = new Map();

const normalizeUserId = (userId) => String(userId || "").trim();

const getCachedUserLookup = (userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const cached = userLookupCache.get(normalizedUserId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.checkedAt > USER_LOOKUP_CACHE_TTL_MS) {
    userLookupCache.delete(normalizedUserId);
    return null;
  }

  return cached.exists;
};

const rememberUserLookup = (userId, exists) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return;
  }

  userLookupCache.set(normalizedUserId, {
    exists: Boolean(exists),
    checkedAt: Date.now(),
  });
};

const isActivityLogUserForeignKeyError = (error) => {
  const text = String(
    error?.message || error?.details || error?.hint || "",
  ).toLowerCase();

  return (
    text.includes("activity_log_user_id_fkey") ||
    (text.includes("foreign key") &&
      text.includes("activity_log") &&
      text.includes("user_id"))
  );
};

export const resolveActivityLogUserId = async (userId) => {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return null;
  }

  const cachedLookup = getCachedUserLookup(normalizedUserId);
  if (cachedLookup !== null) {
    return cachedLookup ? normalizedUserId : null;
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("id", normalizedUserId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Failed to verify activity log user:", error.message);
      rememberUserLookup(normalizedUserId, false);
      return null;
    }

    const exists = Boolean(data?.id);
    rememberUserLookup(normalizedUserId, exists);
    return exists ? normalizedUserId : null;
  } catch (error) {
    console.warn("Activity log user verification exception:", error.message);
    rememberUserLookup(normalizedUserId, false);
    return null;
  }
};

export const insertActivityLog = async (
  payload = {},
  { returnRow = false } = {},
) => {
  const resolvedUserId = await resolveActivityLogUserId(payload.user_id);
  const nextPayload = {
    ...payload,
    user_id: resolvedUserId,
  };

  const performInsert = async (entry) => {
    let query = supabase.from("activity_log").insert(entry);
    if (returnRow) {
      query = query.select().single();
    }
    return query;
  };

  let result = await performInsert(nextPayload);

  if (
    result?.error &&
    nextPayload.user_id &&
    isActivityLogUserForeignKeyError(result.error)
  ) {
    rememberUserLookup(nextPayload.user_id, false);
    result = await performInsert({
      ...nextPayload,
      user_id: null,
    });
  }

  return result;
};
