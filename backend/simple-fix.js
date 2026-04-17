#!/usr/bin/env node

/**
 * Minimal direct dependency repair without embedded credentials.
 */

import { supabase } from "./src/supabaseClient.js";
import { withSupabaseRetry } from "./src/helpers/supabaseRetry.js";

async function quickFix() {
  console.log("Starting direct dependency repair...");

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

    console.log(
      JSON.stringify(
        {
          orderViewFixed: Array.isArray(orderFix) ? orderFix.length : 0,
          warehouseDependenciesFixed: Array.isArray(warehouseFix)
            ? warehouseFix.length
            : 0,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Direct dependency repair failed:", error);
    process.exit(1);
  }
}

quickFix();
