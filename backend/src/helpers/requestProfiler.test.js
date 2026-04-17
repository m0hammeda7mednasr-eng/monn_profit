import { describe, expect, it } from "@jest/globals";

import {
  buildServerTimingValue,
  sanitizeServerTimingToken,
  summarizeProfileSegments,
} from "./requestProfiler.js";

describe("helpers/requestProfiler", () => {
  it("sanitizes server timing tokens into header-safe values", () => {
    expect(sanitizeServerTimingToken(" Dashboard DB ")).toBe("dashboard-db");
    expect(sanitizeServerTimingToken("")).toBe("metric");
  });

  it("aggregates repeated segments by category or timing key", () => {
    const summary = summarizeProfileSegments([
      {
        name: "dashboard.products.batch",
        category: "db",
        serverTimingKey: "db",
        durationMs: 40,
      },
      {
        name: "dashboard.orders.batch",
        category: "db",
        serverTimingKey: "db",
        durationMs: 35,
      },
      {
        name: "dashboard.products.compute",
        category: "app",
        serverTimingKey: "app",
        durationMs: 18,
      },
    ]);

    expect(summary).toEqual([
      expect.objectContaining({
        token: "db",
        durationMs: 75,
        count: 2,
      }),
      expect.objectContaining({
        token: "app",
        durationMs: 18,
        count: 1,
      }),
    ]);
  });

  it("builds a server timing header with total plus summarized segments", () => {
    const value = buildServerTimingValue({
      totalDurationMs: 140.238,
      segments: [
        {
          name: "dashboard.orders.batch",
          category: "db",
          serverTimingKey: "db",
          durationMs: 82.5,
        },
        {
          name: "dashboard.analytics.compute",
          category: "app",
          serverTimingKey: "app",
          durationMs: 31.245,
        },
      ],
    });

    expect(value).toContain('total;dur=140.24;desc="Total request time"');
    expect(value).toContain('db;dur=82.5;desc="db"');
    expect(value).toContain('app;dur=31.25;desc="app"');
  });
});
