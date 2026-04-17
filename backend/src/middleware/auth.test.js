import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import jwt from "jsonwebtoken";
import { authenticateToken } from "./auth.js";

jest.mock("../server.js", () => ({}));

describe("Authentication Middleware", () => {
  let req;
  let res;
  let next;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    process.env.JWT_SECRET = "test-secret-key";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it("populates req.user for admin role", async () => {
    const token = jwt.sign(
      {
        id: "admin-user-id",
        email: "admin@example.com",
        role: "admin",
      },
      process.env.JWT_SECRET,
    );
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(req.user).toEqual({
      id: "admin-user-id",
      email: "admin@example.com",
      role: "admin",
      isAdmin: true,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("normalizes non-admin role to user", async () => {
    const token = jwt.sign(
      {
        id: "employee-user-id",
        email: "employee@example.com",
        role: "employee",
      },
      process.env.JWT_SECRET,
    );
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(req.user).toEqual({
      id: "employee-user-id",
      email: "employee@example.com",
      role: "user",
      isAdmin: false,
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when header is missing", async () => {
    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "No token provided" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid token", async () => {
    req.headers.authorization = "Bearer invalid-token";

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for expired token", async () => {
    const token = jwt.sign(
      {
        id: "user-id",
        email: "user@example.com",
        role: "user",
        exp: Math.floor(Date.now() / 1000) - 3600,
      },
      process.env.JWT_SECRET,
    );
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Token expired" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid payload", async () => {
    const token = jwt.sign({ username: "bad" }, process.env.JWT_SECRET);
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token payload" });
    expect(next).not.toHaveBeenCalled();
  });
});
