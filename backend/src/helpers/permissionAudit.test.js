import { describe, expect, it } from "@jest/globals";

import {
  buildPermissionAuditEntry,
  buildPermissionAuditReport,
  normalizeAuditEmail,
} from "./permissionAudit.js";

describe("helpers/permissionAudit", () => {
  it("flags broken direct dependencies and lowercase email issues", () => {
    const entry = buildPermissionAuditEntry({
      id: "user-1",
      name: "Shrouk",
      email: "Shrouk@gmail.com",
      role: "user",
      is_active: true,
      permissions: {
        can_view_orders: false,
        can_edit_orders: true,
        can_view_warehouse: false,
        can_edit_warehouse: true,
        can_print_barcode_labels: false,
      },
      user_stores: [{ store_id: "store-1" }],
    });

    expect(entry.normalizedEmail).toBe("shrouk@gmail.com");
    expect(entry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "broken_order_dependency" }),
        expect.objectContaining({
          code: "broken_warehouse_view_dependency",
        }),
        expect.objectContaining({ code: "broken_barcode_dependency" }),
        expect.objectContaining({ code: "email_not_normalized" }),
      ]),
    );
    expect(entry.hasBlockingIssues).toBe(true);
    expect(entry.effectivePermissions).toEqual(
      expect.objectContaining({
        can_view_orders: true,
        can_edit_orders: true,
        can_view_warehouse: true,
        can_edit_warehouse: true,
        can_print_barcode_labels: true,
      }),
    );
  });

  it("flags duplicate emails when compared case-insensitively", () => {
    const report = buildPermissionAuditReport([
      {
        id: "user-1",
        name: "Maha",
        email: "maha@gmail.com",
        role: "user",
        is_active: true,
        permissions: { can_view_orders: true },
        user_stores: [{ store_id: "store-1" }],
      },
      {
        id: "user-2",
        name: "MAHA duplicate",
        email: "Maha@gmail.com",
        role: "user",
        is_active: true,
        permissions: { can_view_orders: true },
        user_stores: [{ store_id: "store-2" }],
      },
    ]);

    expect(report.summary.duplicateEmailGroups).toBe(1);
    expect(report.entries.every((entry) => entry.hasBlockingIssues)).toBe(true);
    expect(
      report.entries.flatMap((entry) => entry.issues).filter(
        (issue) => issue.code === "duplicate_email_casefold",
      ),
    ).toHaveLength(2);
  });

  it("normalizes email input safely", () => {
    expect(normalizeAuditEmail("  Maha@Example.COM  ")).toBe(
      "maha@example.com",
    );
    expect(normalizeAuditEmail(null)).toBe("");
  });

  it("flags missing store access for non-admin users", () => {
    const report = buildPermissionAuditReport([
      {
        id: "user-3",
        name: "No Store User",
        email: "nostore@example.com",
        role: "user",
        is_active: true,
        permissions: {
          can_view_orders: true,
          can_edit_orders: false,
          can_view_warehouse: false,
          can_edit_warehouse: false,
          can_print_barcode_labels: true,
        },
        user_stores: [],
      },
    ]);

    expect(report.summary.usersWithoutDirectStoreLinks).toBe(1);
    expect(report.entries[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_direct_store_links" }),
      ]),
    );
    expect(report.entries[0].hasBlockingIssues).toBe(false);
  });

  it("flags legacy warehouse schema when warehouse columns are missing", () => {
    const report = buildPermissionAuditReport([
      {
        id: "user-4",
        name: "Legacy Schema User",
        email: "legacy@example.com",
        role: "user",
        is_active: true,
        permissions: {
          can_view_products: true,
          can_edit_products: true,
          can_view_orders: true,
          can_edit_orders: true,
        },
        user_stores: [{ store_id: "store-1" }],
      },
    ]);

    expect(report.summary.legacyWarehousePermissionSchemaUsers).toBe(1);
    expect(report.entries[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "legacy_warehouse_permission_schema",
        }),
      ]),
    );
    expect(report.entries[0].hasBlockingIssues).toBe(true);
  });
});
