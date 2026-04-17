import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import {
  getJwtSecret,
  __resetJwtHelperStateForTests,
} from "./jwt.js";

describe("getJwtSecret", () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NODE_ENV = "production";
    __resetJwtHelperStateForTests();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (typeof originalJwtSecret === "undefined") {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalJwtSecret;
    }

    if (typeof originalServiceRoleKey === "undefined") {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    }

    if (typeof originalNodeEnv === "undefined") {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("returns JWT_SECRET when configured", () => {
    process.env.JWT_SECRET = "dedicated-app-secret";

    expect(getJwtSecret()).toBe("dedicated-app-secret");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("returns test secret in test environment when JWT_SECRET is missing", () => {
    process.env.NODE_ENV = "test";

    expect(getJwtSecret()).toBe("test-secret-key");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("falls back to SUPABASE_SERVICE_ROLE_KEY when JWT_SECRET is missing", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(getJwtSecret()).toBe("service-role-secret");
    expect(console.warn).toHaveBeenCalledWith(
      "JWT_SECRET is not set. Falling back to SUPABASE_SERVICE_ROLE_KEY for application JWT signing. Configure JWT_SECRET explicitly in production.",
    );
  });

  it("warns only once when using the service role fallback repeatedly", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";

    expect(getJwtSecret()).toBe("service-role-secret");
    expect(getJwtSecret()).toBe("service-role-secret");

    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when no JWT secret source is configured", () => {
    expect(() => getJwtSecret()).toThrow(
      "JWT_SECRET is not configured. Set JWT_SECRET explicitly or provide SUPABASE_SERVICE_ROLE_KEY as a temporary fallback.",
    );
  });
});
