#!/usr/bin/env node

/**
 * Audit user permissions using the same dependency rules as the app.
 *
 * Usage:
 *   node scripts/test-permissions.js
 *   node scripts/test-permissions.js maha@gmail.com shrouk@gmail.com
 */

import { supabase } from "../src/supabaseClient.js";
import { getAccessibleStoreIds } from "../src/models/index.js";
import { fileURLToPath } from "url";
import { withSupabaseRetry } from "../src/helpers/supabaseRetry.js";
import {
  buildPermissionAuditReport,
  normalizeAuditEmail,
} from "../src/helpers/permissionAudit.js";

const targetEmails = process.argv
  .slice(2)
  .map(normalizeAuditEmail)
  .filter(Boolean);

const formatIssues = (issues = []) =>
  issues.length === 0
    ? "none"
    : issues.map((issue) => `${issue.severity}:${issue.code}`).join(", ");

async function testPermissions() {
  console.log("Permission audit starting...");

  try {
    const { data: users, error } = await withSupabaseRetry(
      ({ signal } = {}) =>
        supabase
          .from("users")
          .select(
            `
              id,
              name,
              email,
              role,
              is_active,
              permissions (*),
              user_stores (store_id)
            `,
          )
          .order("email", { ascending: true })
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (error) {
      throw error;
    }

    const scopedUsers = (users || []).filter((user) => {
      if (targetEmails.length === 0) {
        return true;
      }

      return targetEmails.includes(normalizeAuditEmail(user.email));
    });

    if (scopedUsers.length === 0) {
      console.log("No matching users found for the provided emails.");
      process.exitCode = 1;
      return;
    }

    const report = buildPermissionAuditReport(scopedUsers);
    const entriesWithResolvedStores = await Promise.all(
      report.entries.map(async (entry) => ({
        ...entry,
        resolvedStoreIds: await getAccessibleStoreIds(entry.id),
      })),
    );

    console.log("");
    console.log("Permission audit summary");
    console.log("========================");
    console.log(JSON.stringify(report.summary, null, 2));

    for (const entry of entriesWithResolvedStores) {
      console.log("");
      console.log(
        `${entry.name || "(no name)"} <${entry.email || "(no email)"}> role=${entry.role} active=${entry.isActive}`,
      );
      console.log(
        `  raw orders(view/edit): ${Boolean(entry.rawPermissions?.can_view_orders)}/${Boolean(entry.rawPermissions?.can_edit_orders)}`,
      );
      console.log(
        `  raw warehouse(view/edit): ${Boolean(entry.rawPermissions?.can_view_warehouse)}/${Boolean(entry.rawPermissions?.can_edit_warehouse)}`,
      );
      console.log(
        `  raw barcode: ${Boolean(entry.rawPermissions?.can_print_barcode_labels)}`,
      );
      console.log(`  direct store links: ${entry.storeLinks.length}`);
      console.log(`  resolved store scope: ${entry.resolvedStoreIds.length}`);
      console.log(
        `  effective orders(view/edit): ${entry.effectivePermissions.can_view_orders}/${entry.effectivePermissions.can_edit_orders}`,
      );
      console.log(
        `  effective warehouse(view/edit): ${entry.effectivePermissions.can_view_warehouse}/${entry.effectivePermissions.can_edit_warehouse}`,
      );
      console.log(
        `  effective barcode: ${entry.effectivePermissions.can_print_barcode_labels}`,
      );
      console.log(`  issues: ${formatIssues(entry.issues)}`);
    }

    console.log("");
    console.log("Permission audit completed");

    if (report.summary.usersWithBlockingIssues > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Permission audit failed:", error);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  testPermissions()
    .then(() => {
      if (typeof process.exitCode === "number" && process.exitCode !== 0) {
        process.exit(process.exitCode);
      }
    })
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { testPermissions };
