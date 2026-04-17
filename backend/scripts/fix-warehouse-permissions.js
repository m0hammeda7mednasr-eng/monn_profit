#!/usr/bin/env node

/**
 * Repair direct warehouse permission dependencies only.
 *
 * Current app rules:
 * - can_edit_warehouse implies can_view_warehouse
 * - can_edit_warehouse implies can_print_barcode_labels
 */

import { supabase } from "../src/supabaseClient.js";
import { fileURLToPath } from "url";
import { withSupabaseRetry } from "../src/helpers/supabaseRetry.js";

async function fixWarehousePermissions() {
  console.log("Repairing direct warehouse permission dependencies...");

  try {
    const { data: usersToFix, error: fetchError } = await withSupabaseRetry(
      ({ signal } = {}) =>
        supabase
          .from("permissions")
          .select(
            "user_id, can_view_warehouse, can_edit_warehouse, can_print_barcode_labels",
          )
          .eq("can_edit_warehouse", true)
          .or("can_view_warehouse.eq.false,can_print_barcode_labels.eq.false")
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (fetchError) {
      throw fetchError;
    }

    if (!usersToFix || usersToFix.length === 0) {
      console.log("No users require direct warehouse dependency repair.");
      return;
    }

    console.log(`Found ${usersToFix.length} users to repair.`);

    const { error: updateError } = await withSupabaseRetry(
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
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (updateError) {
      throw updateError;
    }

    console.log(
      `Repaired warehouse dependencies for ${usersToFix.length} users successfully.`,
    );
  } catch (error) {
    console.error("Warehouse permission repair failed:", error);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fixWarehousePermissions()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Script failed:", error);
      process.exit(1);
    });
}

export { fixWarehousePermissions };
