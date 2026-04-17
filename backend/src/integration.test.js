import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import jwt from "jsonwebtoken";
import { authenticateToken } from "./middleware/auth.js";
import { applyUserFilter } from "./helpers/dataFilter.js";

jest.mock("./server.js", () => ({}));

describe("Integration Tests - Middleware and Helper", () => {
  let req;
  let res;
  let next;
  let mockQuery;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    req = {
      headers: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();

    mockQuery = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
    };

    process.env.JWT_SECRET = "test-secret-key";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it("authenticates employee and applies data filter correctly", async () => {
    const token = jwt.sign(
      {
        id: "employee-123",
        email: "employee@example.com",
        role: "employee",
      },
      process.env.JWT_SECRET,
    );
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: "employee-123",
      email: "employee@example.com",
      role: "user",
      isAdmin: false,
    });

    const filteredQuery = applyUserFilter(
      mockQuery,
      req.user.id,
      req.user.role,
      "tasks",
    );

    expect(filteredQuery).toBe(mockQuery);
    expect(mockQuery.eq).toHaveBeenCalledWith("assigned_to", "employee-123");
  });

  it("authenticates admin and does not apply data filters", async () => {
    const token = jwt.sign(
      {
        id: "admin-789",
        email: "admin@example.com",
        role: "admin",
      },
      process.env.JWT_SECRET,
    );
    req.headers.authorization = `Bearer ${token}`;

    await authenticateToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.isAdmin).toBe(true);

    const filteredQuery = applyUserFilter(
      mockQuery,
      req.user.id,
      req.user.role,
      "tasks",
    );

    expect(filteredQuery).toBe(mockQuery);
    expect(mockQuery.eq).not.toHaveBeenCalled();
  });

  it("rejects invalid token before applying filters", async () => {
    req.headers.authorization = "Bearer invalid-token";

    await authenticateToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
