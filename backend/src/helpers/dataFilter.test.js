import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import {
  applyUserFilter,
  requiresUserFiltering,
  getUserIdColumn,
  getEntityTypes,
  isShopifyData,
  isUserGeneratedData,
} from "./dataFilter.js";

// Mock the server
jest.mock("../server.js", () => ({}));

describe("Data Filter Helper", () => {
  let mockQuery;

  beforeEach(() => {
    // Create a mock Supabase query builder
    mockQuery = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
    };
  });

  describe("applyUserFilter", () => {
    describe("Admin role behavior", () => {
      it("should return unmodified query for admin with user-generated data", () => {
        const result = applyUserFilter(mockQuery, "admin-id", "admin", "tasks");

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with daily_reports", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "daily_reports",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with access_requests", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "access_requests",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with activity_log", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "activity_log",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with operational_costs", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "operational_costs",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });
    });

    describe("Employee role behavior with user-generated data", () => {
      it("should apply filter with 'assigned_to' column for tasks", () => {
        const userId = "employee-id";
        const result = applyUserFilter(mockQuery, userId, "employee", "tasks");

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).toHaveBeenCalledWith("assigned_to", userId);
      });

      it("should apply filter with 'user_id' column for daily_reports", () => {
        const userId = "employee-id";
        const result = applyUserFilter(
          mockQuery,
          userId,
          "employee",
          "daily_reports",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).toHaveBeenCalledWith("user_id", userId);
      });

      it("should apply filter with 'user_id' column for access_requests", () => {
        const userId = "employee-id";
        const result = applyUserFilter(
          mockQuery,
          userId,
          "employee",
          "access_requests",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).toHaveBeenCalledWith("user_id", userId);
      });

      it("should apply filter with 'user_id' column for activity_log", () => {
        const userId = "employee-id";
        const result = applyUserFilter(
          mockQuery,
          userId,
          "employee",
          "activity_log",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).toHaveBeenCalledWith("user_id", userId);
      });

      it("should apply filter with 'user_id' column for operational_costs", () => {
        const userId = "employee-id";
        const result = applyUserFilter(
          mockQuery,
          userId,
          "employee",
          "operational_costs",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).toHaveBeenCalledWith("user_id", userId);
      });
    });

    describe("Shopify data behavior (no filtering)", () => {
      it("should return unmodified query for employee with products", () => {
        const result = applyUserFilter(
          mockQuery,
          "employee-id",
          "employee",
          "products",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for employee with orders", () => {
        const result = applyUserFilter(
          mockQuery,
          "employee-id",
          "employee",
          "orders",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for employee with customers", () => {
        const result = applyUserFilter(
          mockQuery,
          "employee-id",
          "employee",
          "customers",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with products", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "products",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with orders", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "orders",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });

      it("should return unmodified query for admin with customers", () => {
        const result = applyUserFilter(
          mockQuery,
          "admin-id",
          "admin",
          "customers",
        );

        expect(result).toBe(mockQuery);
        expect(mockQuery.eq).not.toHaveBeenCalled();
      });
    });

    describe("Input validation", () => {
      it("should throw error when query parameter is missing", () => {
        expect(() => {
          applyUserFilter(null, "user-id", "employee", "tasks");
        }).toThrow("Query parameter is required");
      });

      it("should throw error when userId parameter is missing", () => {
        expect(() => {
          applyUserFilter(mockQuery, null, "employee", "tasks");
        }).toThrow("User ID parameter is required");
      });

      it("should throw error when role parameter is missing", () => {
        expect(() => {
          applyUserFilter(mockQuery, "user-id", null, "tasks");
        }).toThrow("Role parameter is required");
      });

      it("should throw error when entityType parameter is missing", () => {
        expect(() => {
          applyUserFilter(mockQuery, "user-id", "employee", null);
        }).toThrow("Entity type parameter is required");
      });

      it("should throw error for unknown entity type", () => {
        expect(() => {
          applyUserFilter(mockQuery, "user-id", "employee", "unknown_entity");
        }).toThrow("Unknown entity type: unknown_entity");
      });
    });
  });

  describe("requiresUserFiltering", () => {
    it("should return true for user-generated data entities", () => {
      expect(requiresUserFiltering("tasks")).toBe(true);
      expect(requiresUserFiltering("daily_reports")).toBe(true);
      expect(requiresUserFiltering("access_requests")).toBe(true);
      expect(requiresUserFiltering("activity_log")).toBe(true);
      expect(requiresUserFiltering("operational_costs")).toBe(true);
    });

    it("should return false for Shopify data entities", () => {
      expect(requiresUserFiltering("products")).toBe(false);
      expect(requiresUserFiltering("orders")).toBe(false);
      expect(requiresUserFiltering("customers")).toBe(false);
    });

    it("should throw error for unknown entity type", () => {
      expect(() => {
        requiresUserFiltering("unknown_entity");
      }).toThrow("Unknown entity type: unknown_entity");
    });
  });

  describe("getUserIdColumn", () => {
    it("should return correct column names for user-generated data", () => {
      expect(getUserIdColumn("tasks")).toBe("assigned_to");
      expect(getUserIdColumn("daily_reports")).toBe("user_id");
      expect(getUserIdColumn("access_requests")).toBe("user_id");
      expect(getUserIdColumn("activity_log")).toBe("user_id");
      expect(getUserIdColumn("operational_costs")).toBe("user_id");
    });

    it("should return null for Shopify data entities", () => {
      expect(getUserIdColumn("products")).toBe(null);
      expect(getUserIdColumn("orders")).toBe(null);
      expect(getUserIdColumn("customers")).toBe(null);
    });

    it("should throw error for unknown entity type", () => {
      expect(() => {
        getUserIdColumn("unknown_entity");
      }).toThrow("Unknown entity type: unknown_entity");
    });
  });

  describe("getEntityTypes", () => {
    it("should return all configured entity types", () => {
      const entityTypes = getEntityTypes();

      expect(entityTypes).toContain("tasks");
      expect(entityTypes).toContain("daily_reports");
      expect(entityTypes).toContain("access_requests");
      expect(entityTypes).toContain("activity_log");
      expect(entityTypes).toContain("operational_costs");
      expect(entityTypes).toContain("products");
      expect(entityTypes).toContain("orders");
      expect(entityTypes).toContain("customers");
      expect(entityTypes).toHaveLength(8);
    });
  });

  describe("isShopifyData", () => {
    it("should return true for Shopify data entities", () => {
      expect(isShopifyData("products")).toBe(true);
      expect(isShopifyData("orders")).toBe(true);
      expect(isShopifyData("customers")).toBe(true);
    });

    it("should return false for user-generated data entities", () => {
      expect(isShopifyData("tasks")).toBe(false);
      expect(isShopifyData("daily_reports")).toBe(false);
      expect(isShopifyData("access_requests")).toBe(false);
      expect(isShopifyData("activity_log")).toBe(false);
      expect(isShopifyData("operational_costs")).toBe(false);
    });

    it("should return false for unknown entities", () => {
      expect(isShopifyData("unknown_entity")).toBe(false);
    });
  });

  describe("isUserGeneratedData", () => {
    it("should return true for user-generated data entities", () => {
      expect(isUserGeneratedData("tasks")).toBe(true);
      expect(isUserGeneratedData("daily_reports")).toBe(true);
      expect(isUserGeneratedData("access_requests")).toBe(true);
      expect(isUserGeneratedData("activity_log")).toBe(true);
      expect(isUserGeneratedData("operational_costs")).toBe(true);
    });

    it("should return false for Shopify data entities", () => {
      expect(isUserGeneratedData("products")).toBe(false);
      expect(isUserGeneratedData("orders")).toBe(false);
      expect(isUserGeneratedData("customers")).toBe(false);
    });

    it("should return false for unknown entities", () => {
      expect(isUserGeneratedData("unknown_entity")).toBe(false);
    });
  });
});
