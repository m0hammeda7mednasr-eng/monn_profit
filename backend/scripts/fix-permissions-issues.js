#!/usr/bin/env node

/**
 * Repair direct permission dependencies and print a compact summary.
 */

import { supabase } from "../src/supabaseClient.js";
import { fileURLToPath } from "url";
import { withSupabaseRetry } from "../src/helpers/supabaseRetry.js";
import { buildPermissionAuditReport } from "../src/helpers/permissionAudit.js";

const loadUsersWithPermissions = async () => {
  const { data, error } = await withSupabaseRetry(
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
            permissions (*)
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

  return data || [];
};

async function fixPermissionsIssues() {
  console.log("Repairing permission dependencies...");

  try {
    const { data: orderFix, error: orderError } = await withSupabaseRetry(
      ({ signal } = {}) =>
        supabase
          .from("permissions")
          .update({
            can_view_orders: true,
            updated_at: new Date().toISOString(),
          })
          .eq("can_edit_orders", true)
          .eq("can_view_orders", false)
          .select("user_id")
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (orderError) {
      throw orderError;
    }

    const { data: warehouseFix, error: warehouseError } = await withSupabaseRetry(
      ({ signal } = {}) =>
        supabase
          .from("permissions")
          .update({
            can_view_warehouse: true,
            can_print_barcode_labels: true,
            updated_at: new Date().toISOString(),
          })
          .eq("can_edit_warehouse", true)
          .or("can_view_warehouse.eq.false,can_print_barcode_labels.eq.false")
          .select("user_id")
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (warehouseError) {
      throw warehouseError;
    }

    const report = buildPermissionAuditReport(await loadUsersWithPermissions());

    console.log("");
    console.log(
      JSON.stringify(
        {
          orderViewFixed: Array.isArray(orderFix) ? orderFix.length : 0,
          warehouseDependenciesFixed: Array.isArray(warehouseFix)
            ? warehouseFix.length
            : 0,
          auditSummary: report.summary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Permission repair failed:", error);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fixPermissionsIssues()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { fixPermissionsIssues };
