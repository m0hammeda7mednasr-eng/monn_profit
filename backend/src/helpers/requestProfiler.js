import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import { performance } from "perf_hooks";

const requestProfilerStorage = new AsyncLocalStorage();
const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1000;
const MAX_SERVER_TIMING_ENTRIES = 7;
const MAX_SLOW_LOG_ENTRIES = 5;

const toFiniteDuration = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const roundDuration = (value) =>
  Number.parseFloat(toFiniteDuration(value).toFixed(2));

export const sanitizeServerTimingToken = (value) => {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9!#$%&'*+.^_`|~-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "metric";
};

const escapeServerTimingDescription = (value) =>
  String(value || "").replace(/"/g, "");

export const summarizeProfileSegments = (
  segments = [],
  { limit = MAX_SERVER_TIMING_ENTRIES } = {},
) => {
  const summary = new Map();

  for (const segment of segments) {
    const key = String(segment?.serverTimingKey || segment?.category || segment?.name || "")
      .trim()
      .toLowerCase();
    if (!key) {
      continue;
    }

    const current = summary.get(key) || {
      token: sanitizeServerTimingToken(key),
      description: String(
        segment?.serverTimingDescription || segment?.category || segment?.name || key,
      ).trim(),
      durationMs: 0,
      count: 0,
    };

    current.durationMs += toFiniteDuration(segment?.durationMs);
    current.count += 1;
    summary.set(key, current);
  }

  return Array.from(summary.values())
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, Math.max(0, limit))
    .map((entry) => ({
      ...entry,
      durationMs: roundDuration(entry.durationMs),
    }));
};

export const buildServerTimingValue = ({
  totalDurationMs = 0,
  segments = [],
} = {}) => {
  const items = [
    {
      token: "total",
      description: "Total request time",
      durationMs: roundDuration(totalDurationMs),
    },
    ...summarizeProfileSegments(segments, {
      limit: Math.max(0, MAX_SERVER_TIMING_ENTRIES - 1),
    }),
  ].filter((entry) => entry.durationMs > 0);

  return items
    .map(
      (entry) =>
        `${sanitizeServerTimingToken(entry.token)};dur=${entry.durationMs};desc="${escapeServerTimingDescription(entry.description)}"`,
    )
    .join(", ");
};

const getSlowRequestThresholdMs = () => {
  const parsed = Number(process.env.SLOW_REQUEST_THRESHOLD_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
};

const createProfilerFacade = (context) => ({
  get requestId() {
    return context.requestId;
  },
  setMeta(key, value) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      return;
    }

    context.meta[normalizedKey] = value;
  },
  incrementCounter(key, amount = 1) {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) {
      return;
    }

    const nextValue =
      Number(context.counters[normalizedKey] || 0) + Number(amount || 0);
    context.counters[normalizedKey] = Number.isFinite(nextValue) ? nextValue : 0;
  },
  record(name, durationMs, options = {}) {
    const normalizedName = String(name || "").trim();
    const normalizedDurationMs = toFiniteDuration(durationMs);
    if (!normalizedName || normalizedDurationMs <= 0) {
      return;
    }

    context.segments.push({
      name: normalizedName,
      durationMs: roundDuration(normalizedDurationMs),
      category: String(options.category || "app").trim() || "app",
      serverTimingKey: String(
        options.serverTimingKey || options.category || normalizedName,
      )
        .trim()
        .toLowerCase(),
      serverTimingDescription: String(
        options.serverTimingDescription || options.category || normalizedName,
      ).trim(),
      detail: String(options.detail || "").trim(),
    });
  },
  measure(name, fn, options = {}) {
    const startedAt = performance.now();
    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).finally(() => {
          this.record(name, performance.now() - startedAt, options);
        });
      }

      this.record(name, performance.now() - startedAt, options);
      return result;
    } catch (error) {
      this.record(name, performance.now() - startedAt, options);
      throw error;
    }
  },
  getSummary() {
    return summarizeProfileSegments(context.segments, {
      limit: MAX_SLOW_LOG_ENTRIES,
    });
  },
});

const createProfilerContext = (req) => {
  const requestId =
    String(req.headers["x-request-id"] || "").trim() || crypto.randomUUID();

  return {
    requestId,
    method: String(req.method || "GET").toUpperCase(),
    path: String(req.originalUrl || req.url || "/").split("?")[0],
    startedAt: performance.now(),
    segments: [],
    counters: {},
    meta: {},
  };
};

const formatSlowRequestLog = (context, totalDurationMs, statusCode) => {
  const topSegments = summarizeProfileSegments(context.segments, {
    limit: MAX_SLOW_LOG_ENTRIES,
  });
  const metricsText = topSegments
    .map((entry) => `${entry.token}=${entry.durationMs}ms`)
    .join(" ");
  const countersText = Object.entries(context.counters || {})
    .filter(([, value]) => Number(value) > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

  return [
    `[perf] ${context.method} ${context.path}`,
    `status=${statusCode}`,
    `requestId=${context.requestId}`,
    `total=${roundDuration(totalDurationMs)}ms`,
    metricsText,
    countersText,
  ]
    .filter(Boolean)
    .join(" ");
};

const applyResponseTimingHeaders = (context, res) => {
  if (res.locals?.requestTimingHeadersApplied) {
    return;
  }

  const totalDurationMs = performance.now() - context.startedAt;
  const serverTiming = buildServerTimingValue({
    totalDurationMs,
    segments: context.segments,
  });

  res.setHeader("X-Request-Id", context.requestId);
  res.setHeader("X-Response-Time", `${roundDuration(totalDurationMs)}ms`);
  if (serverTiming) {
    res.setHeader("Server-Timing", serverTiming);
  }

  if (res.locals) {
    res.locals.requestTimingHeadersApplied = true;
  }
};

export const requestProfilingMiddleware = (req, res, next) => {
  const context = createProfilerContext(req);
  const profiler = createProfilerFacade(context);
  const originalWriteHead = res.writeHead.bind(res);
  const slowRequestThresholdMs = getSlowRequestThresholdMs();
  const shouldLogAllRequests = process.env.LOG_ALL_REQUESTS === "true";

  req.requestId = context.requestId;
  req.performance = profiler;
  res.locals = res.locals || {};
  res.locals.requestId = context.requestId;

  res.writeHead = (...args) => {
    applyResponseTimingHeaders(context, res);
    return originalWriteHead(...args);
  };

  res.on("finish", () => {
    const totalDurationMs = performance.now() - context.startedAt;
    if (shouldLogAllRequests || totalDurationMs >= slowRequestThresholdMs) {
      const statusCode = Number(res.statusCode || 0);
      const logMethod =
        statusCode >= 500 || totalDurationMs >= slowRequestThresholdMs * 2
          ? console.warn
          : console.info;
      logMethod(formatSlowRequestLog(context, totalDurationMs, statusCode));
    }
  });

  requestProfilerStorage.run({ context, profiler }, next);
};

const noopProfiler = {
  requestId: "",
  setMeta() {},
  incrementCounter() {},
  record() {},
  measure(name, fn) {
    return fn();
  },
  getSummary() {
    return [];
  },
};

export const getRequestProfiler = () =>
  requestProfilerStorage.getStore()?.profiler || noopProfiler;

export const measureAsync = (name, fn, options = {}) =>
  getRequestProfiler().measure(name, fn, options);

export const measureSync = (name, fn, options = {}) =>
  getRequestProfiler().measure(name, fn, options);
