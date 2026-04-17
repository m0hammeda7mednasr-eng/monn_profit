const TRANSIENT_SUPABASE_ERROR_CODES = new Set([
  "PGRST000",
  "PGRST001",
  "PGRST002",
  "PGRST003",
  "ETIMEDOUT",
  "ECONNRESET",
]);

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildTimeoutError = (timeoutMs) => ({
  code: "ETIMEDOUT",
  message: `Supabase request timed out after ${timeoutMs}ms`,
});

const executeOperation = async (operation, timeoutMs = 0) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await operation({});
  }

  const controller = new AbortController();
  let timeout = null;

  try {
    const operationPromise = Promise.resolve(
      operation({ signal: controller.signal }),
    ).catch((error) => {
      if (
        error?.name === "AbortError" ||
        String(error?.message || "").toLowerCase().includes("aborted")
      ) {
        return {
          data: null,
          error: buildTimeoutError(timeoutMs),
        };
      }

      throw error;
    });

    const timeoutPromise = new Promise((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve({
          data: null,
          error: buildTimeoutError(timeoutMs),
        });
      }, timeoutMs);
    });

    return await Promise.race([operationPromise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const isTransientSupabaseError = (error) => {
  if (!error) {
    return false;
  }

  if (error?.name === "AbortError") {
    return true;
  }

  const code = String(error.code || "").trim().toUpperCase();
  if (TRANSIENT_SUPABASE_ERROR_CODES.has(code)) {
    return true;
  }

  const text =
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`
      .toLowerCase();

  return (
    text.includes("schema cache") ||
    text.includes("abort") ||
    text.includes("aborted") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("connection terminated") ||
    text.includes("connection reset")
  );
};

export const withSupabaseRetry = async (
  operation,
  { attempts = 3, baseDelayMs = 250, timeoutMs = 0 } = {},
) => {
  let lastResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await executeOperation(operation, timeoutMs);
    lastResult = result;

    if (!result?.error) {
      return result;
    }

    if (!isTransientSupabaseError(result.error) || attempt === attempts) {
      return result;
    }

    await sleep(baseDelayMs * attempt);
  }

  return lastResult;
};
