import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

let currentUserRow = null;
let currentPermissionsRow = null;

const DEFAULT_PERMISSIONS = {
  can_view_dashboard: true,
  can_view_products: true,
  can_edit_products: false,
  can_view_warehouse: true,
  can_edit_warehouse: false,
  can_view_suppliers: false,
  can_edit_suppliers: false,
  can_view_orders: true,
  can_edit_orders: false,
  can_view_customers: true,
  can_edit_customers: false,
  can_manage_users: false,
  can_manage_settings: false,
  can_view_profits: false,
  can_manage_tasks: false,
  can_view_all_reports: false,
  can_view_activity_log: false,
  can_print_barcode_labels: true,
};

const normalizePermissions = jest.fn((value = null) => {
  const nextValue = {
    ...DEFAULT_PERMISSIONS,
    ...(value || {}),
  };

  if (nextValue.can_edit_orders) {
    nextValue.can_view_orders = true;
  }

  if (nextValue.can_edit_warehouse) {
    nextValue.can_view_warehouse = true;
    nextValue.can_print_barcode_labels = true;
  }

  if (!nextValue.can_view_orders) {
    nextValue.can_edit_orders = false;
  }

  if (!nextValue.can_view_warehouse) {
    nextValue.can_edit_warehouse = false;
  }

  return nextValue;
});

const normalizeRole = jest.fn((value) =>
  String(value || "").trim().toLowerCase() === "admin" ? "admin" : "user",
);

const buildPermissionsForRole = jest.fn((role) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole !== "admin") {
    return normalizePermissions();
  }

  return Object.keys(DEFAULT_PERMISSIONS).reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
});

const createMaybeSingleBuilder = (table) => {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    abortSignal: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => {
      if (table === "users") {
        return { data: currentUserRow, error: null };
      }

      if (table === "permissions") {
        return { data: currentPermissionsRow, error: null };
      }

      return { data: null, error: null };
    }),
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => createMaybeSingleBuilder(table)),
};

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

jest.unstable_mockModule("../middleware/auth.js", () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = {
      id: "user-1",
      email: "user@example.com",
      role: "user",
    };
    req.authFallback = {
      source: "token-role",
    };
    next();
  }),
}));

jest.unstable_mockModule("../middleware/permissions.js", () => ({
  buildPermissionsForRole,
  clearUserAccessContextCache: jest.fn(),
  requirePermission: jest.fn(() => (req, res, next) => next()),
  DEFAULT_PERMISSIONS,
  PERMISSION_KEYS: Object.keys(DEFAULT_PERMISSIONS),
  normalizePermissions,
  normalizeRole,
  primeUserAccessContext: jest.fn(),
}));

jest.unstable_mockModule("../helpers/supabaseRetry.js", () => ({
  isTransientSupabaseError: jest.fn(() => false),
  withSupabaseRetry: jest.fn((callback) => callback({ signal: undefined })),
}));

jest.unstable_mockModule("../models/index.js", () => ({
  getAccessibleStoreIds: jest.fn(async () => []),
}));

const usersRouter = (await import("./users.js")).default;

describe("routes/users /me", () => {
  beforeEach(() => {
    currentUserRow = {
      id: "user-1",
      email: "user@example.com",
      name: "Scanner User",
      role: "user",
      is_active: true,
      created_at: "2026-04-15T10:00:00.000Z",
    };
    currentPermissionsRow = {
      can_view_warehouse: false,
      can_edit_warehouse: true,
      can_print_barcode_labels: false,
      can_view_orders: false,
      can_edit_orders: true,
    };
    supabaseMock.from.mockClear();
    normalizePermissions.mockClear();
  });

  it("returns database permissions even when authentication fell back to the token role", async () => {
    const app = express();
    app.use("/users", usersRouter);

    const response = await request(app).get("/users/me");

    expect(response.status).toBe(200);
    expect(response.body.degraded).not.toBe(true);
    expect(response.body.role).toBe("user");
    expect(response.body.permissions).toEqual(
      expect.objectContaining({
        can_view_warehouse: true,
        can_edit_warehouse: true,
        can_print_barcode_labels: true,
        can_view_orders: true,
        can_edit_orders: true,
      }),
    );
    expect(supabaseMock.from).toHaveBeenCalledWith("users");
    expect(supabaseMock.from).toHaveBeenCalledWith("permissions");
  });
});
