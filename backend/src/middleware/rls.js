import { supabase } from "../supabaseClient.js";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../helpers/jwt.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NON_BLOCKING_RLS_ERROR_CODES = new Set([
  "PGRST202",
  "PGRST204",
  "PGRST205",
  "42883",
  "22P02",
  "42703",
]);

const getErrorText = (error) =>
  `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();

const isNonBlockingRlsError = (error) => {
  if (!error) return false;

  if (NON_BLOCKING_RLS_ERROR_CODES.has(String(error.code || ""))) {
    return true;
  }

  const text = getErrorText(error);
  return (
    text.includes("could not find the function") ||
    text.includes("function") ||
    text.includes("does not exist") ||
    text.includes("invalid input syntax for type uuid")
  );
};

const extractUserIdFromToken = (req) => {
  if (req.user?.id) {
    return req.user.id;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded?.id || !UUID_REGEX.test(String(decoded.id))) {
      return null;
    }
    return String(decoded.id);
  } catch {
    return null;
  }
};

const callRlsRpcSafely = async (rpcName, payload) => {
  const { error } = await supabase.rpc(rpcName, payload);

  if (error) {
    if (isNonBlockingRlsError(error)) {
      console.warn(`RLS context skipped (${rpcName}):`, error.message);
      return;
    }

    console.warn(`RLS context failed (${rpcName}):`, error.message);
  }
};

export const setRlsContext = async (req, res, next) => {
  const userId = extractUserIdFromToken(req);
  const storeIdRaw = req.headers["x-store-id"];
  const storeId =
    typeof storeIdRaw === "string" && UUID_REGEX.test(storeIdRaw.trim())
      ? storeIdRaw.trim()
      : null;

  try {
    const promises = [];
    if (userId) {
      promises.push(callRlsRpcSafely("set_current_user_id", { user_id: userId }));
    }

    if (storeId) {
      promises.push(callRlsRpcSafely("set_current_store_id", { store_id: storeId }));
    }

    if (promises.length > 0) {
      Promise.all(promises).catch((err) => {
        console.warn("RLS context background setup failed:", err?.message || err);
      });
    }

    next();
  } catch (err) {
    console.error("Exception while setting RLS context:", err);
    next();
  }
};
