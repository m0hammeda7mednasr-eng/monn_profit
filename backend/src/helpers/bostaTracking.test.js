import { describe, expect, test } from "@jest/globals";
import {
  ensureValidTrackingNumber,
  getTrackingNumberValidationError,
  isDemoTrackingNumber,
  normalizeTrackingNumber,
} from "./bostaTracking.js";

describe("bostaTracking helpers", () => {
  test("normalizeTrackingNumber trims and removes inline whitespace", () => {
    expect(normalizeTrackingNumber("  BOS 123 \n 456 \t ")).toBe("BOS123456");
  });

  test("isDemoTrackingNumber detects legacy demo values", () => {
    expect(isDemoTrackingNumber(" demo123456 ")).toBe(true);
    expect(isDemoTrackingNumber("BOS123456")).toBe(false);
  });

  test("getTrackingNumberValidationError validates required and demo values", () => {
    expect(getTrackingNumberValidationError("")).toBe(
      "Tracking number is required",
    );
    expect(getTrackingNumberValidationError("DEMO123")).toBe(
      "Demo tracking is disabled. Use a real Bosta tracking number instead of demo data.",
    );
  });

  test("ensureValidTrackingNumber returns sanitized real tracking number", () => {
    expect(ensureValidTrackingNumber(" \n BOS-123 \t ")).toBe("BOS-123");
  });

  test("ensureValidTrackingNumber throws for demo values", () => {
    expect(() => ensureValidTrackingNumber("DEMO123")).toThrow(
      "Demo tracking is disabled. Use a real Bosta tracking number instead of demo data.",
    );
  });
});
