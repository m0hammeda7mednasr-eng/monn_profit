import {
  buildPermissionsForRole,
  normalizePermissions,
  normalizeRole,
} from "../middleware/permissions.js";

export const normalizeAuditEmail = (value) =>
  String(value || "").trim().toLowerCase();

const normalizePermissionsRow = (permissions) => {
  if (Array.isArray(permissions)) {
    return permissions[0] || null;
  }

  return permissions || null;
};

const normalizeStoreLinks = (storeLinks) =>
  Array.isArray(storeLinks)
    ? storeLinks.filter((link) => String(link?.store_id || "").trim())
    : [];

const createIssue = (code, message, severity = "warning") => ({
  code,
  message,
  severity,
});

export const buildPermissionAuditEntry = (userRecord = {}) => {
  const role = normalizeRole(userRecord.role);
  const rawPermissions = normalizePermissionsRow(userRecord.permissions);
  const storeLinks = normalizeStoreLinks(userRecord.user_stores);
  const effectivePermissions =
    role === "admin"
      ? buildPermissionsForRole("admin")
      : normalizePermissions(rawPermissions);
  const normalizedEmail = normalizeAuditEmail(userRecord.email);
  const issues = [];

  if (role !== "admin" && !rawPermissions) {
    issues.push(
      createIssue(
        "missing_permissions_row",
        "User does not have a permissions row.",
        "error",
      ),
    );
  }

  if (rawPermissions?.can_edit_orders && !rawPermissions?.can_view_orders) {
    issues.push(
      createIssue(
        "broken_order_dependency",
        "Order edit is enabled while order view is disabled.",
        "error",
      ),
    );
  }

  if (rawPermissions?.can_edit_warehouse && !rawPermissions?.can_view_warehouse) {
    issues.push(
      createIssue(
        "broken_warehouse_view_dependency",
        "Warehouse scanner/edit is enabled while warehouse view is disabled.",
        "error",
      ),
    );
  }

  if (
    rawPermissions?.can_edit_warehouse &&
    !rawPermissions?.can_print_barcode_labels
  ) {
    issues.push(
      createIssue(
        "broken_barcode_dependency",
        "Warehouse scanner/edit is enabled while barcode printing is disabled.",
        "error",
      ),
    );
  }

  if (!userRecord?.is_active) {
    issues.push(
      createIssue(
        "inactive_user",
        "User account is inactive.",
        "warning",
      ),
    );
  }

  if (role !== "admin" && storeLinks.length === 0) {
    issues.push(
      createIssue(
        "missing_direct_store_links",
        "User does not have direct user_stores links and may be relying on fallback store scope.",
        "warning",
      ),
    );
  }

  const hasWarehouseColumns =
    rawPermissions &&
    Object.prototype.hasOwnProperty.call(rawPermissions, "can_view_warehouse") &&
    Object.prototype.hasOwnProperty.call(rawPermissions, "can_edit_warehouse") &&
    Object.prototype.hasOwnProperty.call(
      rawPermissions,
      "can_print_barcode_labels",
    );

  if (role !== "admin" && rawPermissions && !hasWarehouseColumns) {
    issues.push(
      createIssue(
        "legacy_warehouse_permission_schema",
        "Warehouse and barcode permission columns are missing from the live permissions schema.",
        "error",
      ),
    );
  }

  if (String(userRecord?.email || "").trim() && userRecord.email !== normalizedEmail) {
    issues.push(
      createIssue(
        "email_not_normalized",
        "Email is not stored in lowercase.",
        "warning",
      ),
    );
  }

  return {
    id: userRecord.id || "",
    name: userRecord.name || "",
    email: String(userRecord.email || "").trim(),
    normalizedEmail,
    role,
    isActive: Boolean(userRecord?.is_active),
    storeLinks,
    rawPermissions,
    effectivePermissions,
    issues,
    hasBlockingIssues: issues.some((issue) => issue.severity === "error"),
  };
};

export const attachDuplicateEmailIssues = (entries = []) => {
  const groupedEntries = new Map();

  for (const entry of entries) {
    const key = normalizeAuditEmail(entry?.email);
    if (!key) {
      continue;
    }

    const list = groupedEntries.get(key) || [];
    list.push(entry);
    groupedEntries.set(key, list);
  }

  return entries.map((entry) => {
    const duplicates = groupedEntries.get(normalizeAuditEmail(entry?.email)) || [];
    if (duplicates.length <= 1) {
      return entry;
    }

    return {
      ...entry,
      issues: [
        ...entry.issues,
        createIssue(
          "duplicate_email_casefold",
          "Another user exists with the same email when compared case-insensitively.",
          "error",
        ),
      ],
      hasBlockingIssues: true,
    };
  });
};

export const summarizePermissionAudit = (entries = []) => {
  const summary = {
    totalUsers: entries.length,
    inactiveUsers: 0,
    missingPermissionsRows: 0,
    usersWithoutDirectStoreLinks: 0,
    usersWithBlockingIssues: 0,
    usersWithWarnings: 0,
    legacyWarehousePermissionSchemaUsers: 0,
    brokenOrderDependencies: 0,
    brokenWarehouseViewDependencies: 0,
    brokenBarcodeDependencies: 0,
    emailNormalizationWarnings: 0,
    duplicateEmailGroups: 0,
  };
  const duplicateKeys = new Set();

  for (const entry of entries) {
    if (!entry.isActive) {
      summary.inactiveUsers += 1;
    }

    if (entry.hasBlockingIssues) {
      summary.usersWithBlockingIssues += 1;
    }

    if (entry.issues.length > 0) {
      summary.usersWithWarnings += 1;
    }

    for (const issue of entry.issues) {
      if (issue.code === "missing_permissions_row") {
        summary.missingPermissionsRows += 1;
      }
      if (issue.code === "missing_direct_store_links") {
        summary.usersWithoutDirectStoreLinks += 1;
      }
      if (issue.code === "legacy_warehouse_permission_schema") {
        summary.legacyWarehousePermissionSchemaUsers += 1;
      }
      if (issue.code === "broken_order_dependency") {
        summary.brokenOrderDependencies += 1;
      }
      if (issue.code === "broken_warehouse_view_dependency") {
        summary.brokenWarehouseViewDependencies += 1;
      }
      if (issue.code === "broken_barcode_dependency") {
        summary.brokenBarcodeDependencies += 1;
      }
      if (issue.code === "email_not_normalized") {
        summary.emailNormalizationWarnings += 1;
      }
      if (issue.code === "duplicate_email_casefold") {
        duplicateKeys.add(normalizeAuditEmail(entry.email));
      }
    }
  }

  summary.duplicateEmailGroups = duplicateKeys.size;
  return summary;
};

export const buildPermissionAuditReport = (userRecords = []) => {
  const entries = attachDuplicateEmailIssues(
    (Array.isArray(userRecords) ? userRecords : []).map(buildPermissionAuditEntry),
  );

  return {
    entries,
    summary: summarizePermissionAudit(entries),
  };
};
