import express from "express";
import { supabase } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { insertActivityLog } from "../services/activityLogService.js";

const router = express.Router();

router.use(authenticateToken, requirePermission("can_view_activity_log"));

// Get all activity logs (with role-based filtering)
router.get("/", async (req, res) => {
  try {
    const { entity_type } = req.query;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    let query = supabase
      .from("activity_log")
      .select(
        `
        *,
        user:users(id, name, email)
      `,
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by entity type if provided
    if (entity_type) {
      query = query.eq("entity_type", entity_type);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database error fetching activity log:", error);
      throw error;
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error fetching activity log:", err);
    res.status(500).json({ error: "Failed to fetch activity log" });
  }
});

// Get activity statistics — MUST be before /entity/:type/:id to avoid route conflict
router.get("/stats", async (req, res) => {
  try {
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Get activity counts by type and most active users in parallel
    const [activityByTypeResult, activeUsersResult] = await Promise.all([
      supabase
        .from("activity_log")
        .select("entity_type, action")
        .gte("created_at", sevenDaysAgo)
        .limit(5000),
      supabase
        .from("activity_log")
        .select("user_id, users(name)")
        .gte("created_at", sevenDaysAgo)
        .limit(5000),
    ]);

    const { data: activityByType, error: error1 } = activityByTypeResult;
    const { data: activeUsers, error: error2 } = activeUsersResult;

    if (error1) {
      console.error("Database error fetching activity by type:", error1);
      throw error1;
    }
    if (error2) {
      console.error("Database error fetching active users:", error2);
      throw error2;
    }

    // Process statistics
    const stats = {
      byType: {},
      byAction: {},
      activeUsers: {},
    };

    activityByType?.forEach((log) => {
      stats.byType[log.entity_type] = (stats.byType[log.entity_type] || 0) + 1;
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
    });

    activeUsers?.forEach((log) => {
      if (log.user_id) {
        stats.activeUsers[log.user_id] =
          (stats.activeUsers[log.user_id] || 0) + 1;
      }
    });

    res.json(stats);
  } catch (err) {
    console.error("Error fetching activity stats:", err);
    res.status(500).json({ error: "Failed to fetch activity statistics" });
  }
});

// Get activity log for specific entity (with role-based filtering)
router.get("/entity/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;

    if (!type || !id) {
      return res.status(400).json({ error: "Entity type and ID are required" });
    }

    const { data, error } = await supabase
      .from("activity_log")
      .select(
        `
        *,
        user:users(id, name, email)
      `,
      )
      .eq("entity_type", type)
      .eq("entity_id", id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Database error fetching entity activity:", error);
      throw error;
    }

    res.json(data || []);
  } catch (err) {
    console.error("Error fetching entity activity:", err);
    res.status(500).json({ error: "Failed to fetch entity activity" });
  }
});

// Manual activity log (for custom events)
router.post("/", async (req, res) => {
  try {
    const { action, entity_type, entity_id, entity_name, details } = req.body;

    // Validate required fields
    if (!action || !entity_type) {
      return res.status(400).json({
        error: "Action and entity_type are required",
      });
    }

    const { data, error } = await insertActivityLog(
      {
        user_id: req.user.id,
        action,
        entity_type,
        entity_id,
        entity_name,
        details,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"],
      },
      {
        returnRow: true,
      },
    );

    if (error) {
      console.error("Database error creating activity log:", error);
      throw error;
    }

    res.status(201).json(data);
  } catch (err) {
    console.error("Error creating activity log:", err);
    res.status(500).json({ error: "Failed to create activity log" });
  }
});

export default router;
