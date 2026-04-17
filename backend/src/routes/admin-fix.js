import express from "express";

import { supabase } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/permissions.js";
import { withSupabaseRetry } from "../helpers/supabaseRetry.js";
import {
  buildPermissionAuditReport,
  normalizeAuditEmail,
} from "../helpers/permissionAudit.js";

const router = express.Router();

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

  return data || [];
};

const filterUsersByEmails = (users, emails = []) => {
  const normalizedEmails = (Array.isArray(emails) ? emails : [])
    .map(normalizeAuditEmail)
    .filter(Boolean);

  if (normalizedEmails.length === 0) {
    return users;
  }

  return (Array.isArray(users) ? users : []).filter((user) =>
    normalizedEmails.includes(normalizeAuditEmail(user.email)),
  );
};

router.use(authenticateToken, requireAdminRole);

router.get("/permissions-state", async (req, res) => {
  try {
    const emails = String(req.query.emails || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const users = filterUsersByEmails(await loadUsersWithPermissions(), emails);
    const report = buildPermissionAuditReport(users);

    res.json({
      success: true,
      ...report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching permissions state:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

router.post("/fix-permissions", async (req, res) => {
  try {
    const results = {
      orderViewFixed: 0,
      warehouseViewFixed: 0,
      barcodeFixed: 0,
      errors: [],
    };

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
      results.errors.push(`Order dependency repair failed: ${orderError.message}`);
    } else {
      results.orderViewFixed = Array.isArray(orderFix) ? orderFix.length : 0;
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
          .select("user_id, can_view_warehouse, can_print_barcode_labels")
          .abortSignal(signal),
      {
        attempts: 2,
        timeoutMs: 20000,
      },
    );

    if (warehouseError) {
      results.errors.push(
        `Warehouse dependency repair failed: ${warehouseError.message}`,
      );
    } else {
      const fixedRows = Array.isArray(warehouseFix) ? warehouseFix : [];
      results.warehouseViewFixed = fixedRows.length;
      results.barcodeFixed = fixedRows.length;
    }

    const report = buildPermissionAuditReport(await loadUsersWithPermissions());

    res.json({
      success: results.errors.length === 0,
      results,
      ...report,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Permissions fix failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
