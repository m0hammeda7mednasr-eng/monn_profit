import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import bcryptjs from "bcryptjs";

let currentUser = null;

const createUsersBuilder = () => {
  const state = {
    emailPattern: "",
  };

  const builder = {
    select: jest.fn(() => builder),
    ilike: jest.fn((column, value) => {
      if (column === "email") {
        state.emailPattern = String(value || "");
      }
      return builder;
    }),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => {
      if (
        currentUser &&
        String(currentUser.email || "").toLowerCase() ===
          state.emailPattern.toLowerCase()
      ) {
        return { data: currentUser, error: null };
      }

      return { data: null, error: null };
    }),
  };

  return builder;
};

const supabaseMock = {
  from: jest.fn((table) => {
    if (table === "users") {
      return createUsersBuilder();
    }

    throw new Error(`Unexpected table: ${table}`);
  }),
};

const buildPermissionsForRole = jest.fn((role, permissions) =>
  role === "admin"
    ? { can_view_orders: true, can_edit_orders: true }
    : { ...(permissions || {}) },
);
const getUserPermissions = jest.fn(async () => ({
  can_view_orders: true,
  can_edit_orders: true,
}));
const normalizeRole = jest.fn((value) =>
  String(value || "").trim().toLowerCase() === "admin" ? "admin" : "user",
);
const primeUserAccessContext = jest.fn();

jest.unstable_mockModule("../supabaseClient.js", () => ({
  supabase: supabaseMock,
}));

jest.unstable_mockModule("../middleware/permissions.js", () => ({
  buildPermissionsForRole,
  getUserPermissions,
  normalizeRole,
  primeUserAccessContext,
}));

jest.unstable_mockModule("../helpers/supabaseRetry.js", () => ({
  isTransientSupabaseError: jest.fn(() => false),
  withSupabaseRetry: jest.fn((callback) => callback()),
}));

const authRouter = (await import("./auth.js")).default;

describe("routes/auth login email normalization", () => {
  beforeEach(async () => {
    process.env.JWT_SECRET = "test-secret-key";
    currentUser = {
      id: "user-1",
      email: "shrouk@gmail.com",
      name: "Shrouk",
      password: await bcryptjs.hash("secret123", 10),
      role: "user",
    };
    supabaseMock.from.mockClear();
    buildPermissionsForRole.mockClear();
    getUserPermissions.mockClear();
    primeUserAccessContext.mockClear();
  });

  it("allows login when the typed email casing differs from the stored email", async () => {
    const app = express();
    app.use(express.json());
    app.use("/auth", authRouter);

    const response = await request(app).post("/auth/login").send({
      email: "Shrouk@gmail.com",
      password: "secret123",
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(
      expect.objectContaining({
        id: "user-1",
        email: "shrouk@gmail.com",
        name: "Shrouk",
        role: "user",
      }),
    );
    expect(getUserPermissions).toHaveBeenCalledWith("user-1", {
      useCache: false,
    });
    expect(primeUserAccessContext).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        role: "user",
        permissions: expect.objectContaining({
          can_view_orders: true,
          can_edit_orders: true,
        }),
      }),
    );
  });
});
