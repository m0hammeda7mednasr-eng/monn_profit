const DEFAULT_BACKEND_API_BASE_URL =
  "https://monnprofit-production.up.railway.app/api";

const normalizeApiBaseUrl = (value) =>
  String(value || "")
    .trim()
    .replace(/\/+$/, "");

const resolveBackendApiBaseUrl = () => {
  const configured =
    process.env.BACKEND_API_BASE_URL ||
    process.env.RAILWAY_API_BASE_URL ||
    process.env.RENDER_API_BASE_URL;
  return normalizeApiBaseUrl(configured || DEFAULT_BACKEND_API_BASE_URL);
};

const buildTargetUrl = (req) => {
  const base = resolveBackendApiBaseUrl();
  const pathSegments = Array.isArray(req.query?.proxy)
    ? req.query.proxy
    : [req.query?.proxy].filter(Boolean);
  const path = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(`${base}/${path}`);

  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === "proxy") return;
    if (Array.isArray(value)) {
      value.forEach((entry) => url.searchParams.append(key, String(entry)));
      return;
    }
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
];

export default async function handler(req, res) {
  const targetUrl = buildTargetUrl(req);

  const headers = {};
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }
  if (req.headers["content-type"]) {
    headers["Content-Type"] = req.headers["content-type"];
  }
  if (req.headers["x-store-id"]) {
    headers["x-store-id"] = req.headers["x-store-id"];
  }

  const hasBody = !["GET", "HEAD"].includes(String(req.method || "").toUpperCase());
  const body =
    hasBody && req.body !== undefined
      ? typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body)
      : undefined;

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    FORWARDED_RESPONSE_HEADERS.forEach((headerName) => {
      const headerValue = upstreamResponse.headers.get(headerName);
      if (headerValue) {
        res.setHeader(headerName, headerValue);
      }
    });

    const responseText = await upstreamResponse.text();
    res.status(upstreamResponse.status).send(responseText);
  } catch (error) {
    res.status(502).json({
      error: "Backend proxy request failed",
      message: error?.message || "Unknown proxy error",
      target: targetUrl,
    });
  }
}
