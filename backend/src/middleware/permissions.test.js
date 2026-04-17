import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

jest.unstable_mockModule("../helpers/supabaseRetry.js", () => ({
  isTransientSupabaseError: jest.fn(() => false),
  withSupabaseRetry: jest.fn((callback) => callback()),
}));

const { supabase } = await import("../supabaseClient.js");
const {
  buildPermissionsForRole,
  clearUserAccessContextCache,
  normalizePermissions,
  peekUserAccessContext,
  primeUserAccessContext,
  requirePermission,
} = await import("./permissions.js");

describe("middleware/permissions warehouse access", () => {
  beforeEach(() => {
    clearUserAccessContextCache();
    supabase.from.mockReset();
  });

  it("makes order edit permission automatically include order view access", () => {
    const permissions = normalizePermissions({
      can_view_orders: false,
      can_edit_orders: true,
    });

    expect(permissions.can_view_orders).toBe(true);
    expect(permissions.can_edit_orders).toBe(true);
  });

  it("clears a single cached user without dropping other permission contexts", () => {
    primeUserAccessContext("user-a", {
      permissions: normalizePermissions({ can_edit_warehouse: true }),
    });
    primeUserAccessContext("user-b", {
      permissions: normalizePermissions({ can_edit_orders: true }),
    });

    clearUserAccessContextCache("user-a");

    expect(peekUserAccessContext("user-a")).toBeNull();
    expect(peekUserAccessContext("user-b")).toEqual(
      expect.objectContaining({
        permissions: expect.objectContaining({
          can_edit_orders: true,
        }),
      }),
    );
  });

  it("uses cached real permissions for safe GET fallback instead of default user access", async () => {
    primeUserAccessContext("scanner-user", {
      permissions: normalizePermissions({
        can_view_warehouse: false,
        can_edit_warehouse: true,
      }),
    });

    const middleware = requirePermission("can_edit_warehouse");
    const req = {
      method: "GET",
      authFallback: { source: "token-role" },
      user: {
        id: "scanner-user",
        role: "user",
      },
    };
    const res = {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.user.permissions).toEqual(
      expect.objectContaining({
        can_edit_warehouse: true,
        can_view_warehouse: true,
      }),
    );
  });

  it("does not grant default view permissions during safe GET fallback", async () => {
    const queryBuilder = {
      select: jest.fn(() => queryBuilder),
      eq: jest.fn(() => queryBuilder),
      limit: jest.fn(() => queryBuilder),
      abortSignal: jest.fn(() => queryBuilder),
      maybeSingle: jest.fn(async () => ({
        data: {
          can_view_orders: false,
          can_edit_orders: false,
        },
        error: null,
      })),
    };
    supabase.from.mockReturnValue(queryBuilder);

    const middleware = requirePermission("can_view_orders");
    const req = {
      method: "GET",
      authFallback: { source: "token-role" },
      user: {
        id: "restricted-user",
        role: "user",
      },
    };
    const res = {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
    };
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Access denied: insufficient permissions",
    });
  });

  it("falls back warehouse permissions to product permissions when warehouse columns are missing", () => {
    const permissions = normalizePermissions({
      can_view_products: false,
      can_edit_products: true,
    });

    expect(permissions.can_view_products).toBe(false);
    expect(permissions.can_edit_products).toBe(true);
    expect(permissions.can_view_warehouse).toBe(true);
    expect(permissions.can_edit_warehouse).toBe(true);
    expect(permissions.can_print_barcode_labels).toBe(true);
  });

  it("preserves explicit warehouse permissions when they are present", () => {
    const permissions = normalizePermissions({
      can_view_products: false,
      can_edit_products: true,
      can_view_warehouse: false,
      can_edit_warehouse: true,
      can_print_barcode_labels: false,
    });

    expect(permissions.can_view_warehouse).toBe(true);
    expect(permissions.can_edit_warehouse).toBe(true);
    expect(permissions.can_print_barcode_labels).toBe(true);
  });

  it("grants warehouse permissions to admins automatically", () => {
    const permissions = buildPermissionsForRole("admin");

    expect(permissions.can_view_warehouse).toBe(true);
    expect(permissions.can_edit_warehouse).toBe(true);
    expect(permissions.can_print_barcode_labels).toBe(true);
    expect(permissions.can_view_orders).toBe(true);
    expect(permissions.can_edit_orders).toBe(true);
  });
});
