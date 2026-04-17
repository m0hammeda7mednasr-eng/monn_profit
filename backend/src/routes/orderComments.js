import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isUuid = (value) => UUID_REGEX.test(String(value || "").trim());
const SCHEMA_COMPATIBILITY_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

const isSchemaCompatibilityError = (error) => {
  if (!error) return false;

  if (SCHEMA_COMPATIBILITY_CODES.has(String(error.code || ""))) {
    return true;
  }

  const message = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find the") ||
    message.includes("relation") ||
    message.includes("column")
  );
};

const isNoRowsError = (error) => {
  if (!error) return false;
  if (String(error.code || "") === "PGRST116") return true;
  const message = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return message.includes("0 rows") || message.includes("no rows");
};

const isMissingCommentsTableError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    message.includes("order_comments") ||
    message.includes("order_comments_with_user")
  );
};

const parseLegacyNotes = (notesValue) => {
  if (!notesValue) return [];
  if (Array.isArray(notesValue)) return notesValue;

  if (typeof notesValue === "string") {
    try {
      const parsed = JSON.parse(notesValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
};

const mapLegacyNotesToComments = (legacyNotes) =>
  legacyNotes
    .map((note, index) => {
      const createdAt = note?.created_at || note?.createdAt || new Date().toISOString();
      return {
        id: note?.id || `legacy-${index}-${createdAt}`,
        order_id: note?.order_id || null,
        user_id: note?.user_id || null,
        comment_text: note?.content || note?.comment_text || "",
        comment_type: "general",
        is_internal: false,
        is_pinned: false,
        created_at: createdAt,
        updated_at: createdAt,
        user_name: note?.author || "System",
        user_role: note?.role || "user",
        is_legacy: true,
      };
    })
    .filter((note) => note.comment_text)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

const getOrderByReference = async (userId, orderReference) => {
  const normalizedReference = String(orderReference || "").trim();
  if (!normalizedReference) return null;

  const selectedColumns = [
    "id, shopify_id, notes, user_id, store_id",
    "id, shopify_id, notes, user_id",
    "id, shopify_id, notes, store_id",
    "id, shopify_id, notes",
  ];

  const queryBuilders = [];
  for (const columns of selectedColumns) {
    queryBuilders.push(() => {
      let query = supabase.from("orders").select(columns);
      query = isUuid(normalizedReference)
        ? query.eq("id", normalizedReference)
        : query.eq("shopify_id", normalizedReference);
      return query.eq("user_id", userId).limit(1).single();
    });
  }

  for (const columns of selectedColumns) {
    queryBuilders.push(() => {
      let query = supabase.from("orders").select(columns);
      query = isUuid(normalizedReference)
        ? query.eq("id", normalizedReference)
        : query.eq("shopify_id", normalizedReference);
      return query.limit(1).single();
    });
  }

  let lastSchemaError = null;
  for (const build of queryBuilders) {
    const { data, error } = await build();
    if (!error) return data || null;
    if (isNoRowsError(error)) {
      continue;
    }
    if (!isSchemaCompatibilityError(error)) {
      throw error;
    }
    lastSchemaError = error;
  }

  if (lastSchemaError) {
    console.warn("Order lookup fallback exhausted in order comments:", lastSchemaError.message);
  }

  return null;
};

const addLegacyComment = async ({
  order,
  commentText,
  userId,
  userName,
  userRole,
}) => {
  const existingNotes = parseLegacyNotes(order?.notes);
  const now = new Date().toISOString();
  const newNote = {
    id: `legacy-${Date.now()}`,
    content: commentText.trim(),
    author: userName || "User",
    user_id: userId,
    role: userRole || "user",
    created_at: now,
    synced_to_shopify: false,
    source: "legacy_fallback",
  };

  const updatedNotes = [newNote, ...existingNotes];
  const { error } = await supabase
    .from("orders")
    .update({
      notes: JSON.stringify(updatedNotes),
      pending_sync: true,
      local_updated_at: now,
    })
    .eq("id", order.id);

  if (error) throw error;

  return {
    id: newNote.id,
    order_id: order.shopify_id || null,
    user_id: newNote.user_id,
    comment_text: newNote.content,
    comment_type: "general",
    is_internal: false,
    is_pinned: false,
    created_at: newNote.created_at,
    updated_at: newNote.created_at,
    user_name: newNote.author,
    user_role: newNote.role,
    is_legacy: true,
  };
};

// Get all comments for a specific order
router.get(
  "/order/:orderId",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderByReference(req.user.id, orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const normalizedShopifyOrderId = String(order.shopify_id || "").trim();
    if (!normalizedShopifyOrderId) {
      const legacyComments = mapLegacyNotesToComments(parseLegacyNotes(order.notes));
      return res.json({
        success: true,
        data: legacyComments,
        total: legacyComments.length,
        mode: "legacy",
      });
    }

    let query = supabase
      .from("order_comments_with_user")
      .select("*")
      .eq("order_id", normalizedShopifyOrderId)
      .order("created_at", { ascending: true });

    const { data: comments, error } = await query;

    if (error) {
      if (isMissingCommentsTableError(error)) {
        const legacyComments = mapLegacyNotesToComments(parseLegacyNotes(order.notes));
        return res.json({
          success: true,
          data: legacyComments,
          total: legacyComments.length,
          mode: "legacy",
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data: comments || [],
      total: comments ? comments.length : 0,
      mode: "table",
    });
  } catch (error) {
    console.error("Error fetching order comments:", error);
    res.status(500).json({ error: error.message });
  }
  },
);

// Add a new comment to an order
router.post("/", authenticateToken, requirePermission("can_view_orders"), async (req, res) => {
  try {
    const {
      order_id,
      comment_text,
      comment_type = "general",
      is_internal = false,
      is_pinned = false,
    } = req.body;

    if (!order_id || !comment_text) {
      return res.status(400).json({
        error: "order_id and comment_text are required",
      });
    }

    const order = await getOrderByReference(req.user.id, order_id);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const finalIsInternal = req.user.role === "admin" ? Boolean(is_internal) : false;
    const normalizedShopifyOrderId = String(order.shopify_id || "").trim();
    const userName = req.user?.name || req.user?.email || "User";

    if (!normalizedShopifyOrderId) {
      const fallbackComment = await addLegacyComment({
        order,
        commentText: comment_text,
        userId: req.user.id,
        userName,
        userRole: req.user.role,
      });

      return res.status(201).json({
        success: true,
        message: "Comment added successfully",
        data: fallbackComment,
        mode: "legacy",
      });
    }

    const { data: newComment, error } = await supabase
      .from("order_comments")
      .insert([
        {
          order_id: normalizedShopifyOrderId,
          user_id: req.user.id,
          comment_text: comment_text.trim(),
          comment_type,
          is_internal: finalIsInternal,
          is_pinned: Boolean(is_pinned),
        },
      ])
      .select()
      .single();

    if (error) {
      if (isMissingCommentsTableError(error)) {
        const fallbackComment = await addLegacyComment({
          order,
          commentText: comment_text,
          userId: req.user.id,
          userName,
          userRole: req.user.role,
        });

        return res.status(201).json({
          success: true,
          message: "Comment added successfully",
          data: fallbackComment,
          mode: "legacy",
        });
      }

      throw error;
    }

    const { data: commentWithUser, error: fetchError } = await supabase
      .from("order_comments_with_user")
      .select("*")
      .eq("id", newComment.id)
      .single();

    if (fetchError) throw fetchError;

    res.status(201).json({
      success: true,
      message: "Comment added successfully",
      data: commentWithUser,
      mode: "table",
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update a comment
router.put(
  "/:commentId",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
  try {
    const { commentId } = req.params;
    const { comment_text, comment_type, is_internal, is_pinned } = req.body;

    if (!comment_text) {
      return res.status(400).json({
        error: "comment_text is required",
      });
    }

    const { data: existingComment, error: fetchError } = await supabase
      .from("order_comments")
      .select("user_id")
      .eq("id", commentId)
      .single();

    if (fetchError) throw fetchError;

    if (!existingComment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const isOwner = existingComment.user_id === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: "You can only edit your own comments",
      });
    }

    const updateData = {
      comment_text: comment_text.trim(),
      edited_at: new Date().toISOString(),
      edited_by: req.user.id,
    };

    if (isAdmin) {
      if (comment_type !== undefined) updateData.comment_type = comment_type;
      if (is_internal !== undefined) updateData.is_internal = is_internal;
      if (is_pinned !== undefined) updateData.is_pinned = is_pinned;
    }

    const { error } = await supabase
      .from("order_comments")
      .update(updateData)
      .eq("id", commentId);

    if (error) throw error;

    const { data: commentWithUser, error: fetchUpdatedError } = await supabase
      .from("order_comments_with_user")
      .select("*")
      .eq("id", commentId)
      .single();

    if (fetchUpdatedError) throw fetchUpdatedError;

    res.json({
      success: true,
      message: "Comment updated successfully",
      data: commentWithUser,
    });
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ error: error.message });
  }
  },
);

// Delete a comment
router.delete(
  "/:commentId",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
  try {
    const { commentId } = req.params;

    const { data: existingComment, error: fetchError } = await supabase
      .from("order_comments")
      .select("user_id")
      .eq("id", commentId)
      .single();

    if (fetchError) throw fetchError;

    if (!existingComment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    const isOwner = existingComment.user_id === req.user.id;
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: "You can only delete your own comments",
      });
    }

    const { error } = await supabase
      .from("order_comments")
      .delete()
      .eq("id", commentId);

    if (error) throw error;

    res.json({
      success: true,
      message: "Comment deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: error.message });
  }
  },
);

// Pin/Unpin a comment (Admin only)
router.patch(
  "/:commentId/pin",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Only admins can pin/unpin comments",
      });
    }

    const { commentId } = req.params;
    const { is_pinned } = req.body;

    const { data: updatedComment, error } = await supabase
      .from("order_comments")
      .update({ is_pinned: !!is_pinned })
      .eq("id", commentId)
      .select()
      .single();

    if (error) throw error;

    if (!updatedComment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    res.json({
      success: true,
      message: `Comment ${is_pinned ? "pinned" : "unpinned"} successfully`,
      data: updatedComment,
    });
  } catch (error) {
    console.error("Error pinning comment:", error);
    res.status(500).json({ error: error.message });
  }
  },
);

// Get comment statistics for an order
router.get(
  "/order/:orderId/stats",
  authenticateToken,
  requirePermission("can_view_orders"),
  async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getOrderByReference(req.user.id, orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const normalizedShopifyOrderId = String(order.shopify_id || "").trim();
    if (!normalizedShopifyOrderId) {
      const legacyComments = mapLegacyNotesToComments(parseLegacyNotes(order.notes));
      return res.json({
        success: true,
        data: {
          total: legacyComments.length,
          by_type: { general: legacyComments.length },
          internal_count: 0,
          unique_contributors: new Set(
            legacyComments.map((comment) => comment.user_name || "User"),
          ).size,
        },
      });
    }

    let query = supabase
      .from("order_comments")
      .select("comment_type, is_internal, user_id")
      .eq("order_id", normalizedShopifyOrderId);

    const { data: comments, error } = await query;

    if (error) {
      if (isMissingCommentsTableError(error)) {
        const legacyComments = mapLegacyNotesToComments(parseLegacyNotes(order.notes));
        return res.json({
          success: true,
          data: {
            total: legacyComments.length,
            by_type: { general: legacyComments.length },
            internal_count: 0,
            unique_contributors: new Set(
              legacyComments.map((comment) => comment.user_name || "User"),
            ).size,
          },
          mode: "legacy",
        });
      }
      throw error;
    }

    const stats = {
      total: comments.length,
      by_type: {},
      internal_count: 0,
      unique_contributors: new Set(),
    };

    comments.forEach((comment) => {
      stats.by_type[comment.comment_type] =
        (stats.by_type[comment.comment_type] || 0) + 1;

      if (comment.is_internal) {
        stats.internal_count += 1;
      }

      stats.unique_contributors.add(comment.user_id);
    });

    stats.unique_contributors = stats.unique_contributors.size;

    res.json({
      success: true,
      data: stats,
      mode: "table",
    });
  } catch (error) {
    console.error("Error fetching comment stats:", error);
    res.status(500).json({ error: error.message });
  }
  },
);

export default router;
