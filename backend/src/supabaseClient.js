// backend/src/supabaseClient.js
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const DEFAULT_SUPABASE_QUERY_TIMEOUT_MS = 15 * 1000;
const MAX_SUPABASE_QUERY_TIMEOUT_MS = 15 * 1000;

const getSupabaseQueryTimeoutMs = () => {
  const parsed = Number(process.env.SUPABASE_QUERY_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUPABASE_QUERY_TIMEOUT_MS;
  }

  return Math.min(parsed, MAX_SUPABASE_QUERY_TIMEOUT_MS);
};

const fetchWithTimeout = async (input, init = {}) => {
  const timeoutMs = getSupabaseQueryTimeoutMs();
  const controller = new AbortController();
  let timeout = null;

  const abortFromCaller = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    const fetchPromise = fetch(input, {
      ...init,
      signal: controller.signal,
    });

    const timeoutPromise = new Promise((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new DOMException(
            `Supabase request timed out after ${timeoutMs}ms`,
            "AbortError",
          ),
        );
      }, timeoutMs);
    });

    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (init.signal) {
      init.signal.removeEventListener("abort", abortFromCaller);
    }
  }
};

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Supabase URL or Key is not defined. Please check your .env file.",
  );
} else if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Falling back to SUPABASE_KEY.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    fetch: fetchWithTimeout,
  },
});
