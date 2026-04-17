import {
  DEFAULT_DEV_API_BASE,
  DEFAULT_PROD_API_BASE,
  getEventsStreamUrl,
  normalizeApiBase,
  resolveApiBase,
} from "./apiConfig";

describe("apiConfig", () => {
  test("normalizeApiBase trims whitespace and trailing slashes", () => {
    expect(normalizeApiBase(" https://example.com/api/// ")).toBe(
      "https://example.com/api",
    );
  });

  test("resolveApiBase prefers explicit env values", () => {
    expect(
      resolveApiBase({
        NODE_ENV: "production",
        REACT_APP_API_BASE_URL: " https://custom.example.com/api/ ",
      }),
    ).toBe("https://custom.example.com/api");
  });

  test("resolveApiBase uses production fallback for production builds", () => {
    expect(
      resolveApiBase({
        NODE_ENV: "production",
      }),
    ).toBe(DEFAULT_PROD_API_BASE);
  });

  test("resolveApiBase uses local fallback outside production", () => {
    expect(
      resolveApiBase({
        NODE_ENV: "development",
      }),
    ).toBe(DEFAULT_DEV_API_BASE);
  });

  test("getEventsStreamUrl appends the realtime endpoint", () => {
    expect(
      getEventsStreamUrl({
        NODE_ENV: "production",
      }),
    ).toBe(`${DEFAULT_PROD_API_BASE}/events/stream`);
  });
});
