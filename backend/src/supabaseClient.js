// backend/src/supabaseClient.js
import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const DEFAULT_SUPABASE_QUERY_TIMEOUT_MS = 15 * 1000;
const MAX_SUPABASE_QUERY_TIMEOUT_MS = 15 * 1000;

const looksLikePlaceholder = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    normalized.includes("your-project.supabase.co") ||
    normalized.includes("your_supabase_url") ||
    normalized.includes("your_supabase_service_role_key") ||
    normalized.includes("your_supabase_anon_key") ||
    normalized.includes("shpat_or_admin_api_access_token") ||
    normalized.includes("your-store.myshopify.com")
  );
};

export const getSupabaseConfigStatus = () => {
  const issues = [];

  if (!supabaseUrl) {
    issues.push("SUPABASE_URL is missing");
  } else if (looksLikePlaceholder(supabaseUrl)) {
    issues.push("SUPABASE_URL still uses a placeholder value");
  }

  if (!supabaseKey) {
    issues.push(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY is missing",
    );
  } else if (looksLikePlaceholder(supabaseKey)) {
    issues.push(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY still uses a placeholder value",
    );
  }

  return {
    configured: issues.length === 0,
    issues,
  };
};

export const getSupabaseConfigErrorMessage = () => {
  const status = getSupabaseConfigStatus();
  if (status.configured) {
    return "";
  }

  return "Local database is not configured. Update backend/.env with real SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY values.";
};

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

const supabaseConfigStatus = getSupabaseConfigStatus();

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Supabase URL or Key is not defined. Please check your .env file.",
  );
} else if (!supabaseConfigStatus.configured) {
  console.warn(
    "Supabase credentials still look like placeholders. DB-backed local features will fail until backend/.env is updated.",
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
