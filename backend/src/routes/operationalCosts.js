import express from "express";
import { supabase } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { applyUserFilter } from "../helpers/dataFilter.js";
import { requireAdminRole } from "../middleware/permissions.js";

const router = express.Router();

router.use(authenticateToken, requireAdminRole);

const mapOperationalCostError = (error) => {
  switch (error?.code) {
    case "42P01":
      return {
        status: 500,
        error:
          "Table operational_costs does not exist. Run ADD_OPERATIONAL_COSTS_TABLE.sql first",
      };
    case "42501":
      return {
        status: 403,
        error:
          "Database denied access to operational_costs (check RLS/policies and ensure SUPABASE_SERVICE_ROLE_KEY is configured in backend)",
      };
    case "23503":
      return {
        status: 400,
        error: "Invalid product selected. Product does not exist or is inaccessible",
      };
    case "22P02":
      return {
        status: 400,
        error: "Invalid value format in request payload",
      };
    default:
      return null;
  }
};

const parsePositiveAmount = (value) => {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const sanitizeTextField = (value) => String(value || "").trim();
const VALID_APPLY_TO_VALUES = new Set(["per_unit", "per_order", "fixed"]);

const handleMappedError = (res, error) => {
  const mapped = mapOperationalCostError(error);
  if (!mapped) return false;
  res.status(mapped.status).json({
    error: mapped.error,
    code: error.code,
  });
  return true;
};

// Get all operational costs
router.get("/", async (req, res) => {
  try {
    const { product_id } = req.query;

    let query = supabase
      .from("operational_costs")
      .select(
        `
        *,
        product:products(id, title, image_url)
      `,
      )
      .limit(100)
      .order("created_at", { ascending: false });

    query = applyUserFilter(
      query,
      req.user.id,
      req.user.role,
      "operational_costs",
    );

    if (product_id) {
      query = query.eq("product_id", product_id);
    }

    const { data, error } = await query;
    if (error) {
      if (handleMappedError(res, error)) return;
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    console.error("Error fetching operational costs:", error);
    res.status(500).json({ error: "Failed to fetch operational costs" });
  }
});

// Get one operational cost
router.get("/:id", async (req, res) => {
  try {
    let query = supabase
      .from("operational_costs")
      .select(
        `
        *,
        product:products(id, title, image_url)
      `,
      )
      .eq("id", req.params.id);

    query = applyUserFilter(
      query,
      req.user.id,
      req.user.role,
      "operational_costs",
    );

    const { data, error } = await query.single();
    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ error: "Operational cost not found or not accessible" });
      }
      if (handleMappedError(res, error)) return;
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error fetching operational cost:", error);
    res.status(500).json({ error: "Failed to fetch operational cost" });
  }
});

// Create operational cost
router.post("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const { product_id, cost_name, cost_type, amount, apply_to, description } =
      req.body;

    if (!cost_name || !cost_type || amount === undefined) {
      return res
        .status(400)
        .json({ error: "cost_name, cost_type and amount are required" });
    }

    const parsedAmount = parsePositiveAmount(amount);
    if (parsedAmount === null) {
      return res
        .status(400)
        .json({ error: "Amount must be a valid number greater than or equal to 0" });
    }

    const normalizedCostName = sanitizeTextField(cost_name);
    const normalizedCostType = sanitizeTextField(cost_type);
    const normalizedApplyTo = sanitizeTextField(apply_to || "per_unit");

    if (!normalizedCostName || !normalizedCostType) {
      return res
        .status(400)
        .json({ error: "cost_name and cost_type must not be empty" });
    }

    if (!VALID_APPLY_TO_VALUES.has(normalizedApplyTo)) {
      return res.status(400).json({
        error: "apply_to must be one of: per_unit, per_order, fixed",
      });
    }

    if (product_id) {
      const { data: existingProduct, error: productError } = await supabase
        .from("products")
        .select("id")
        .eq("id", product_id)
        .maybeSingle();

      if (productError) {
        if (handleMappedError(res, productError)) return;
        throw productError;
      }

      if (!existingProduct) {
        return res
          .status(400)
          .json({ error: "Invalid product selected for this operational cost" });
      }
    }

    const { data, error } = await supabase
      .from("operational_costs")
      .insert({
        user_id: userId,
        product_id: product_id || null,
        cost_name: normalizedCostName,
        cost_type: normalizedCostType,
        amount: parsedAmount,
        apply_to: normalizedApplyTo,
        description: description === undefined ? null : sanitizeTextField(description),
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      if (handleMappedError(res, error)) return;
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    console.error("Error creating operational cost:", error);
    if (handleMappedError(res, error)) return;
    res.status(500).json({ error: "Failed to add operational cost" });
  }
});

// Update operational cost
router.put("/:id", async (req, res) => {
  try {
    const { cost_name, cost_type, amount, apply_to, description, is_active } =
      req.body;

    const updateData = {
      updated_at: new Date().toISOString(),
    };

    if (cost_name !== undefined) {
      const normalizedCostName = sanitizeTextField(cost_name);
      if (!normalizedCostName) {
        return res.status(400).json({ error: "cost_name must not be empty" });
      }
      updateData.cost_name = normalizedCostName;
    }

    if (cost_type !== undefined) {
      const normalizedCostType = sanitizeTextField(cost_type);
      if (!normalizedCostType) {
        return res.status(400).json({ error: "cost_type must not be empty" });
      }
      updateData.cost_type = normalizedCostType;
    }

    if (amount !== undefined) {
      const parsedAmount = parsePositiveAmount(amount);
      if (parsedAmount === null) {
        return res
          .status(400)
          .json({ error: "Amount must be a valid number greater than or equal to 0" });
      }
      updateData.amount = parsedAmount;
    }

    if (apply_to !== undefined) {
      const normalizedApplyTo = sanitizeTextField(apply_to);
      if (!VALID_APPLY_TO_VALUES.has(normalizedApplyTo)) {
        return res.status(400).json({
          error: "apply_to must be one of: per_unit, per_order, fixed",
        });
      }
      updateData.apply_to = normalizedApplyTo;
    }

    if (description !== undefined) {
      updateData.description = sanitizeTextField(description);
    }
    if (is_active !== undefined) updateData.is_active = is_active;

    let query = supabase
      .from("operational_costs")
      .update(updateData)
      .eq("id", req.params.id);

    query = applyUserFilter(
      query,
      req.user.id,
      req.user.role,
      "operational_costs",
    );

    const { data, error } = await query.select().single();
    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ error: "Operational cost not found or not accessible" });
      }
      if (handleMappedError(res, error)) return;
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error updating operational cost:", error);
    if (handleMappedError(res, error)) return;
    res.status(500).json({ error: "Failed to update operational cost" });
  }
});

// Delete operational cost
router.delete("/:id", async (req, res) => {
  try {
    let query = supabase
      .from("operational_costs")
      .delete()
      .eq("id", req.params.id);

    query = applyUserFilter(
      query,
      req.user.id,
      req.user.role,
      "operational_costs",
    );

    const { data, error } = await query.select("id");
    if (error) {
      if (handleMappedError(res, error)) return;
      throw error;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res
        .status(404)
        .json({ error: "Operational cost not found or not accessible" });
    }

    res.json({ message: "Operational cost deleted successfully" });
  } catch (error) {
    console.error("Error deleting operational cost:", error);
    if (handleMappedError(res, error)) return;
    res.status(500).json({ error: "Failed to delete operational cost" });
  }
});

export default router;
