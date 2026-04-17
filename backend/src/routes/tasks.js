import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { supabase } from "../supabaseClient.js";
import { authenticateToken } from "../middleware/auth.js";
import { applyUserFilter } from "../helpers/dataFilter.js";
import {
  getUserPermissions,
  requirePermission,
} from "../middleware/permissions.js";
import fileUploadService from "../services/fileUploadService.js";
import notificationService from "../services/notificationService.js";

const router = express.Router();

const TASK_ATTACHMENT_BUCKET = "task-attachments";
const TASK_META_PREFIX = "\n\n<!--TASK_META:";
const TASK_META_SUFFIX = "-->";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type"));
    }
  },
});

const collectUploadedFiles = (req) => {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (req.files && typeof req.files === "object") {
    return [...(req.files.files || []), ...(req.files["files[]"] || [])];
  }

  return [];
};

const TASK_BASE_SELECT = "*";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getErrorText = (error) =>
  `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;

const withErrorDetails = (fallbackMessage, error) => {
  if (!error?.message) {
    return fallbackMessage;
  }

  return `${fallbackMessage}: ${error.message}`;
};

const normalizeNullableDateValue = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return text;
};

const normalizeOptionalText = (value) => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
};

const uniqueIds = (values = []) =>
  Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || "").trim())
        .filter((value) => UUID_REGEX.test(value)),
    ),
  );

const normalizeAssigneeIds = (payload = {}) => {
  if (Array.isArray(payload.assigned_to_ids)) {
    return uniqueIds(payload.assigned_to_ids);
  }

  if (payload.assigned_to !== undefined) {
    return uniqueIds([payload.assigned_to]);
  }

  return [];
};

const normalizeTaskIds = (value) => {
  if (Array.isArray(value)) {
    return uniqueIds(value);
  }

  if (typeof value === "string") {
    return uniqueIds(value.split(","));
  }

  return [];
};

const parseTaskMeta = (description) => {
  const raw = typeof description === "string" ? description : "";
  const start = raw.lastIndexOf(TASK_META_PREFIX);

  if (start === -1 || !raw.endsWith(TASK_META_SUFFIX)) {
    return {
      cleanDescription: raw,
      meta: null,
    };
  }

  const jsonText = raw
    .slice(start + TASK_META_PREFIX.length, raw.length - TASK_META_SUFFIX.length)
    .trim();

  try {
    const parsed = JSON.parse(jsonText);
    const groupId = String(parsed?.group_id || "").trim();
    const groupName = normalizeOptionalText(parsed?.group_name);

    if (!UUID_REGEX.test(groupId)) {
      return {
        cleanDescription: raw,
        meta: null,
      };
    }

    return {
      cleanDescription: raw.slice(0, start).trim(),
      meta: {
        group_id: groupId,
        group_name: groupName || null,
      },
    };
  } catch {
    return {
      cleanDescription: raw,
      meta: null,
    };
  }
};

const buildTaskDescription = (description, taskMeta = null) => {
  const cleanDescription = normalizeOptionalText(description);

  if (!taskMeta?.group_id || !UUID_REGEX.test(taskMeta.group_id)) {
    return cleanDescription;
  }

  const serializedMeta = JSON.stringify({
    group_id: taskMeta.group_id,
    group_name: normalizeOptionalText(taskMeta.group_name) || null,
  });

  return `${cleanDescription}${TASK_META_PREFIX}${serializedMeta}${TASK_META_SUFFIX}`;
};

const decorateTaskRecord = (task) => {
  if (!task) {
    return task;
  }

  const { cleanDescription, meta } = parseTaskMeta(task.description);

  return {
    ...task,
    description: cleanDescription,
    group_id: meta?.group_id || null,
    group_name: meta?.group_name || null,
    is_group_task: Boolean(meta?.group_id),
  };
};

const decorateTaskCollection = (tasks) => {
  if (Array.isArray(tasks)) {
    return tasks.map(decorateTaskRecord);
  }

  return decorateTaskRecord(tasks);
};

const resolveStoreIdFromRequest = (req) => {
  const raw = req.headers["x-store-id"];
  if (typeof raw !== "string") {
    return undefined;
  }

  const value = raw.trim();
  if (!value || !UUID_REGEX.test(value)) {
    return undefined;
  }

  return value;
};

const isMissingTaskUserIdFieldError = (error) =>
  getErrorText(error).toLowerCase().includes('has no field "user_id"');

const taskUserIdMigrationHint =
  "Tasks schema is missing `user_id`. Run QUICK_FIX_TASKS_USER_ID_AND_RLS_CONTEXT.sql (or UPDATE_DB_FOR_RBAC.sql) to add compatibility columns.";

const extractMissingColumn = (error) => {
  const text = getErrorText(error);
  const patterns = [
    /column ['"]?([a-zA-Z0-9_]+)['"]? does not exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /"([a-zA-Z0-9_]+)" of relation/i,
    /has no field ['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
};

const executeWithMissingColumnFallback = async (payload, runner) => {
  let currentPayload = { ...payload };
  let lastError = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await runner(currentPayload);

    if (!error) {
      return { data, error: null, payload: currentPayload };
    }

    lastError = error;
    const missingColumn = extractMissingColumn(error);

    if (!missingColumn || !(missingColumn in currentPayload)) {
      return { data: null, error, payload: currentPayload };
    }

    delete currentPayload[missingColumn];
  }

  return { data: null, error: lastError, payload: currentPayload };
};

const normalizeUserRow = (row = {}) => ({
  id: row.id,
  name: row.name || row.full_name || row.email || "User",
  email: row.email || "",
  role: row.role || "user",
});

const fetchUsersByIds = async (ids) => {
  const userIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (userIds.length === 0) {
    return new Map();
  }

  const variants = [
    () => supabase.from("users").select("id, name, email, role").in("id", userIds),
    () =>
      supabase
        .from("users")
        .select("id, full_name, email, role")
        .in("id", userIds),
    () => supabase.from("users").select("id, email").in("id", userIds),
  ];

  let lastError = null;

  for (const queryFactory of variants) {
    const { data, error } = await queryFactory();
    if (!error) {
      const map = new Map();
      for (const row of data || []) {
        map.set(row.id, normalizeUserRow(row));
      }
      return map;
    }
    lastError = error;
  }

  throw lastError || new Error("Failed to fetch users");
};

const enrichItemsWithUsers = async (items, userIdField, targetField) => {
  const list = Array.isArray(items) ? items : [items];
  const ids = list.map((item) => item?.[userIdField]).filter(Boolean);
  const usersMap = await fetchUsersByIds(ids);

  const enriched = list.map((item) => ({
    ...item,
    [targetField]: usersMap.get(item?.[userIdField]) || null,
  }));

  return Array.isArray(items) ? enriched : enriched[0];
};

const enrichTasksWithUsers = async (tasks) => {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const ids = list
    .flatMap((task) => [task?.assigned_to, task?.assigned_by])
    .filter(Boolean);
  const usersMap = await fetchUsersByIds(ids);

  const enriched = list.map((task) => ({
    ...task,
    assigned_to_user: usersMap.get(task?.assigned_to) || null,
    assigned_by_user: usersMap.get(task?.assigned_by) || null,
  }));

  return decorateTaskCollection(Array.isArray(tasks) ? enriched : enriched[0]);
};

const getTaskBase = async (taskId) => {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_BASE_SELECT)
    .eq("id", taskId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  if (!data) {
    return null;
  }

  return await enrichTasksWithUsers(data);
};

const canManageTasks = async (user) => {
  if (user.role === "admin") {
    return true;
  }

  const permissions = await getUserPermissions(user.id);
  return Boolean(permissions.can_manage_tasks);
};

const resolveTaskAccess = async (taskId, user) => {
  const task = await getTaskBase(taskId);
  if (!task) {
    return { task: null, canManage: false, error: "Task not found", code: 404 };
  }

  const canManage = await canManageTasks(user);

  if (!canManage && task.assigned_to !== user.id) {
    return {
      task: null,
      canManage,
      error: "Access denied: insufficient permissions",
      code: 403,
    };
  }

  return { task, canManage, error: null, code: 200 };
};

const attachTaskAttachments = async (tasks) => {
  const taskList = Array.isArray(tasks) ? tasks : [tasks];
  const taskIds = taskList.map((task) => task.id).filter(Boolean);

  if (taskIds.length === 0) {
    return Array.isArray(tasks) ? [] : null;
  }

  const { data: attachments, error } = await supabase
    .from("task_attachments")
    .select("*")
    .in("task_id", taskIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const enrichedAttachments = await enrichItemsWithUsers(
    attachments || [],
    "uploaded_by",
    "uploader",
  );

  const grouped = new Map();
  for (const item of enrichedAttachments || []) {
    const current = grouped.get(item.task_id) || [];
    current.push(item);
    grouped.set(item.task_id, current);
  }

  const withAttachments = taskList.map((task) => ({
    ...task,
    attachments: grouped.get(task.id) || [],
  }));

  return Array.isArray(tasks) ? withAttachments : withAttachments[0];
};

const createTaskNotification = async ({
  userId,
  title,
  message,
  taskId,
  metadata = {},
}) => {
  if (!userId) {
    return;
  }

  try {
    await notificationService.createNotification({
      userId,
      type: "task",
      title,
      message,
      entityType: "task",
      entityId: taskId,
      metadata,
    });
  } catch (error) {
    // Notifications are best-effort and must not break core task flows.
    console.error("Task notification error (non-blocking):", error);
  }
};

const fetchTaskAssignees = async () => {
  const variants = [
    {
      query: () =>
        supabase
          .from("users")
          .select("id, name, email, role")
          .order("name", { ascending: true }),
      map: normalizeUserRow,
    },
    {
      query: () =>
        supabase
          .from("users")
          .select("id, full_name, email, role")
          .order("full_name", { ascending: true }),
      map: normalizeUserRow,
    },
    {
      query: () =>
        supabase
          .from("users")
          .select("id, email")
          .order("email", { ascending: true }),
      map: normalizeUserRow,
    },
  ];

  let lastError = null;

  for (const variant of variants) {
    const { data, error } = await variant.query();
    if (!error) {
      return (data || []).map(variant.map);
    }
    lastError = error;
  }

  throw lastError || new Error("Failed to fetch assignees");
};

const buildTaskInsertPayload = ({
  title,
  description,
  assigneeId,
  assignedBy,
  priority,
  status,
  dueDate,
  storeId,
  taskMeta = null,
}) => ({
  title,
  description: buildTaskDescription(description, taskMeta),
  assigned_to: assigneeId,
  user_id: assigneeId,
  assigned_by: assignedBy,
  priority: priority || "medium",
  status: status || "pending",
  due_date: dueDate,
  store_id: storeId,
});

const insertTaskRow = async (payload) => {
  return await executeWithMissingColumnFallback(payload, (insertPayload) =>
    supabase.from("tasks").insert(insertPayload).select(TASK_BASE_SELECT).single(),
  );
};

const buildTaskUpdatePayload = ({
  existingTask,
  body,
  assigneeId,
  storeId,
  taskMeta,
  forceDescriptionRewrite = false,
}) => {
  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (body.title !== undefined) payload.title = body.title;
  if (body.priority !== undefined) payload.priority = body.priority;
  if (body.status !== undefined) payload.status = body.status;
  if (body.due_date !== undefined) {
    payload.due_date = normalizeNullableDateValue(body.due_date);
  }

  if (assigneeId !== undefined) {
    payload.assigned_to = assigneeId;
    payload.user_id = assigneeId;
  } else if (body.assigned_to !== undefined) {
    payload.assigned_to = body.assigned_to;
    payload.user_id = body.assigned_to;
  }

  if (storeId) {
    payload.store_id = storeId;
  }

  const shouldRewriteDescription =
    forceDescriptionRewrite || body.description !== undefined;

  if (shouldRewriteDescription) {
    const baseDescription =
      body.description !== undefined ? body.description : existingTask.description;
    payload.description = buildTaskDescription(baseDescription, taskMeta);
  }

  if (body.status === "completed") {
    payload.completed_at = new Date().toISOString();
  } else if (body.status !== undefined && body.status !== "completed") {
    payload.completed_at = null;
  }

  return payload;
};

const updateTaskRow = async (taskId, payload) => {
  return await executeWithMissingColumnFallback(payload, (updatePayload) =>
    supabase
      .from("tasks")
      .update(updatePayload)
      .eq("id", taskId)
      .select(TASK_BASE_SELECT)
      .single(),
  );
};

const fetchTasksByIds = async (taskIds) => {
  const normalizedTaskIds = normalizeTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_BASE_SELECT)
    .in("id", normalizedTaskIds);

  if (error) {
    throw error;
  }

  const withUsers = await enrichTasksWithUsers(data || []);
  return await attachTaskAttachments(withUsers || []);
};

const deleteTasksCascade = async (taskIds) => {
  const normalizedTaskIds = normalizeTaskIds(taskIds);
  if (normalizedTaskIds.length === 0) {
    return;
  }

  const { data: attachments, error: attachmentsError } = await supabase
    .from("task_attachments")
    .select("*")
    .in("task_id", normalizedTaskIds);

  if (attachmentsError) {
    throw attachmentsError;
  }

  for (const attachment of attachments || []) {
    if (attachment.storage_path) {
      await fileUploadService.deleteFile(
        attachment.storage_path,
        TASK_ATTACHMENT_BUCKET,
      );
    }
  }

  const { error: deleteAttachmentsError } = await supabase
    .from("task_attachments")
    .delete()
    .in("task_id", normalizedTaskIds);
  if (deleteAttachmentsError) {
    throw deleteAttachmentsError;
  }

  const { error: deleteCommentsError } = await supabase
    .from("task_comments")
    .delete()
    .in("task_id", normalizedTaskIds);
  if (deleteCommentsError) {
    throw deleteCommentsError;
  }

  const { error: deleteTasksError } = await supabase
    .from("tasks")
    .delete()
    .in("id", normalizedTaskIds);
  if (deleteTasksError) {
    throw deleteTasksError;
  }
};

// Get all tasks (Manager/Admin sees all, non-admin sees assigned tasks only)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userCanManage = await canManageTasks(req.user);

    let query = supabase
      .from("tasks")
      .select(TASK_BASE_SELECT)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!userCanManage) {
      query = applyUserFilter(query, req.user.id, req.user.role, "tasks");
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database error fetching tasks:", error);
      return res
        .status(500)
        .json({ error: withErrorDetails("Failed to fetch tasks", error) });
    }

    const withUsers = await enrichTasksWithUsers(data || []);
    const withAttachments = await attachTaskAttachments(withUsers || []);
    res.json(withAttachments || []);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res
      .status(500)
      .json({ error: withErrorDetails("Failed to fetch tasks", error) });
  }
});

// Get users who can be assigned tasks (Managers/Admins only)
router.get(
  "/assignees",
  authenticateToken,
  requirePermission("can_manage_tasks"),
  async (req, res) => {
    try {
      const assignees = await fetchTaskAssignees();
      res.json(assignees);
    } catch (error) {
      console.error("Error fetching task assignees:", error);
      res
        .status(500)
        .json({ error: withErrorDetails("Failed to fetch assignees", error) });
    }
  },
);

// Get single task
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const access = await resolveTaskAccess(req.params.id, req.user);

    if (access.error) {
      return res.status(access.code).json({ error: access.error });
    }

    const withAttachments = await attachTaskAttachments(access.task);
    res.json(withAttachments);
  } catch (error) {
    console.error("Error fetching task:", error);
    res
      .status(500)
      .json({ error: withErrorDetails("Failed to fetch task", error) });
  }
});

// Create new task (Managers/Admins only)
router.post(
  "/",
  authenticateToken,
  requirePermission("can_manage_tasks"),
  async (req, res) => {
    try {
      const { title, description, priority, due_date } = req.body;
      const normalizedDueDate = normalizeNullableDateValue(due_date);
      const assigneeIds = normalizeAssigneeIds(req.body);
      const isGroupTask = assigneeIds.length > 1;
      const groupMeta = isGroupTask
        ? {
            group_id: randomUUID(),
            group_name:
              normalizeOptionalText(req.body.group_name) ||
              normalizeOptionalText(title),
          }
        : null;

      if (!title || assigneeIds.length === 0) {
        return res
          .status(400)
          .json({ error: "Title and at least one assigned user are required" });
      }

      const assigneesMap = await fetchUsersByIds(assigneeIds);
      if (assigneesMap.size !== assigneeIds.length) {
        return res.status(400).json({ error: "Invalid assigned user" });
      }

      const storeId = resolveStoreIdFromRequest(req);
      const createdTasks = [];

      for (const assigneeId of assigneeIds) {
        const insertPayload = buildTaskInsertPayload({
          title,
          description,
          assigneeId,
          assignedBy: req.user.id,
          priority,
          dueDate: normalizedDueDate,
          storeId,
          taskMeta: groupMeta,
        });

        const { data, error } = await insertTaskRow(insertPayload);

        if (error) {
          if (isMissingTaskUserIdFieldError(error)) {
            return res.status(500).json({
              error: `Failed to create task: ${taskUserIdMigrationHint}`,
            });
          }

          if (error.code === "23503" || error.code === "22P02") {
            return res.status(400).json({ error: "Invalid assigned user" });
          }

          console.error("Database error creating task:", error);
          return res
            .status(500)
            .json({ error: withErrorDetails("Failed to create task", error) });
        }

        createdTasks.push(data);

        if (assigneeId !== req.user.id) {
          await createTaskNotification({
            userId: assigneeId,
            title: isGroupTask ? "Task group assignment" : "Task assigned",
            message: isGroupTask
              ? `You have been added to task group: ${groupMeta?.group_name || title}`
              : `A new task has been assigned: ${title}`,
            taskId: data.id,
            metadata: {
              assigned_by: req.user.id,
              group_id: groupMeta?.group_id || null,
            },
          });
        }
      }

      const withUsers = await enrichTasksWithUsers(createdTasks);
      const withAttachments = await attachTaskAttachments(withUsers);

      if (withAttachments.length === 1) {
        return res.status(201).json(withAttachments[0]);
      }

      return res.status(201).json({
        is_group: true,
        group_id: groupMeta?.group_id || null,
        group_name: groupMeta?.group_name || null,
        primary_task_id: withAttachments[0]?.id || null,
        created_tasks: withAttachments,
      });
    } catch (error) {
      console.error("Error creating task:", error);
      res
        .status(500)
        .json({ error: withErrorDetails("Failed to create task", error) });
    }
  },
);

// Update task
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const access = await resolveTaskAccess(req.params.id, req.user);

    if (access.error) {
      return res.status(access.code).json({ error: access.error });
    }

    const existingTask = access.task;
    const isManager = access.canManage;
    const statusOnlyAllowed = !isManager && req.user.role !== "admin";
    const applyToTaskIds = normalizeTaskIds(req.body.apply_to_task_ids);

    const hasRestrictedFields =
      req.body.title !== undefined ||
      req.body.description !== undefined ||
      req.body.assigned_to !== undefined ||
      req.body.assigned_to_ids !== undefined ||
      req.body.group_name !== undefined ||
      req.body.priority !== undefined ||
      req.body.due_date !== undefined;

    if (statusOnlyAllowed && hasRestrictedFields) {
      return res.status(403).json({
        error: "Access denied: you can only update task status",
      });
    }

    if (isManager && applyToTaskIds.length > 1) {
      const groupTasks = await fetchTasksByIds(applyToTaskIds);

      if (groupTasks.length !== applyToTaskIds.length) {
        return res.status(404).json({ error: "One or more tasks were not found" });
      }

      const desiredAssigneeIds =
        normalizeAssigneeIds(req.body).length > 0
          ? normalizeAssigneeIds(req.body)
          : uniqueIds(groupTasks.map((task) => task.assigned_to));

      if (desiredAssigneeIds.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one assigned user is required" });
      }

      const assigneesMap = await fetchUsersByIds(desiredAssigneeIds);
      if (assigneesMap.size !== desiredAssigneeIds.length) {
        return res.status(400).json({ error: "Invalid assigned user" });
      }

      const storeId = resolveStoreIdFromRequest(req);
      const shouldRemainGroup = desiredAssigneeIds.length > 1;
      const groupMeta = shouldRemainGroup
        ? {
            group_id: existingTask.group_id || randomUUID(),
            group_name:
              normalizeOptionalText(req.body.group_name) ||
              existingTask.group_name ||
              normalizeOptionalText(req.body.title) ||
              existingTask.title,
          }
        : null;

      const existingByAssignee = new Map(
        groupTasks.map((task) => [task.assigned_to, task]),
      );

      const finalTaskIds = [];

      for (const assigneeId of desiredAssigneeIds) {
        const matchingTask = existingByAssignee.get(assigneeId);

        if (matchingTask) {
          const updatePayload = buildTaskUpdatePayload({
            existingTask: matchingTask,
            body: req.body,
            assigneeId,
            storeId,
            taskMeta: groupMeta,
            forceDescriptionRewrite: true,
          });

          const { data, error } = await updateTaskRow(matchingTask.id, updatePayload);

          if (error) {
            if (isMissingTaskUserIdFieldError(error)) {
              return res.status(500).json({
                error: `Failed to update task: ${taskUserIdMigrationHint}`,
              });
            }

            console.error("Database error updating grouped task:", error);
            return res.status(500).json({
              error: withErrorDetails("Failed to update task group", error),
            });
          }

          finalTaskIds.push(data.id);
          continue;
        }

        const insertPayload = buildTaskInsertPayload({
          title: req.body.title !== undefined ? req.body.title : existingTask.title,
          description:
            req.body.description !== undefined
              ? req.body.description
              : existingTask.description,
          assigneeId,
          assignedBy: existingTask.assigned_by || req.user.id,
          priority:
            req.body.priority !== undefined
              ? req.body.priority
              : existingTask.priority,
          status:
            req.body.status !== undefined ? req.body.status : "pending",
          dueDate:
            req.body.due_date !== undefined
              ? normalizeNullableDateValue(req.body.due_date)
              : existingTask.due_date,
          storeId: storeId || existingTask.store_id || undefined,
          taskMeta: groupMeta,
        });

        const { data, error } = await insertTaskRow(insertPayload);

        if (error) {
          if (isMissingTaskUserIdFieldError(error)) {
            return res.status(500).json({
              error: `Failed to update task: ${taskUserIdMigrationHint}`,
            });
          }

          console.error("Database error creating grouped task member:", error);
          return res.status(500).json({
            error: withErrorDetails("Failed to update task group", error),
          });
        }

        finalTaskIds.push(data.id);

        if (assigneeId !== req.user.id) {
          await createTaskNotification({
            userId: assigneeId,
            title: shouldRemainGroup ? "Task group assignment" : "Task assigned",
            message: shouldRemainGroup
              ? `You have been added to task group: ${groupMeta?.group_name || data.title}`
              : `A task has been assigned to you: ${data.title}`,
            taskId: data.id,
            metadata: {
              assigned_by: req.user.id,
              group_id: groupMeta?.group_id || null,
            },
          });
        }
      }

      const removedTaskIds = groupTasks
        .filter((task) => !desiredAssigneeIds.includes(task.assigned_to))
        .map((task) => task.id);

      if (removedTaskIds.length > 0) {
        await deleteTasksCascade(removedTaskIds);
      }

      const updatedTasks = await fetchTasksByIds(finalTaskIds);
      return res.json({
        is_group: updatedTasks.length > 1,
        group_id: groupMeta?.group_id || null,
        group_name: groupMeta?.group_name || null,
        primary_task_id: updatedTasks[0]?.id || existingTask.id,
        updated_tasks: updatedTasks,
      });
    }

    const updatePayload = statusOnlyAllowed
      ? buildTaskUpdatePayload({
          existingTask,
          body: {
            status: req.body.status || existingTask.status,
          },
        })
      : buildTaskUpdatePayload({
          existingTask,
          body: req.body,
          storeId: resolveStoreIdFromRequest(req),
        });

    const { data, error } = await updateTaskRow(req.params.id, updatePayload);

    if (error) {
      if (isMissingTaskUserIdFieldError(error)) {
        return res.status(500).json({
          error: `Failed to update task: ${taskUserIdMigrationHint}`,
        });
      }

      console.error("Database error updating task:", error);
      return res
        .status(500)
        .json({ error: withErrorDetails("Failed to update task", error) });
    }

    if (updatePayload.status && updatePayload.status !== existingTask.status) {
      const statusNotificationRecipient =
        req.user.id === existingTask.assigned_to
          ? existingTask.assigned_by
          : existingTask.assigned_to;

      if (
        statusNotificationRecipient &&
        statusNotificationRecipient !== req.user.id
      ) {
        await createTaskNotification({
          userId: statusNotificationRecipient,
          title: "Task status updated",
          message: `Task "${existingTask.title}" status changed to "${updatePayload.status}"`,
          taskId: existingTask.id,
          metadata: {
            updated_by: req.user.id,
            old_status: existingTask.status,
            new_status: updatePayload.status,
          },
        });
      }
    }

    if (
      updatePayload.assigned_to &&
      updatePayload.assigned_to !== existingTask.assigned_to &&
      updatePayload.assigned_to !== req.user.id
    ) {
      await createTaskNotification({
        userId: updatePayload.assigned_to,
        title: "Task assigned",
        message: `A task has been assigned to you: ${data.title}`,
        taskId: data.id,
        metadata: {
          assigned_by: req.user.id,
        },
      });
    }

    const withUsers = await enrichTasksWithUsers(data);
    const withAttachments = await attachTaskAttachments(withUsers);
    res.json(withAttachments);
  } catch (error) {
    console.error("Error updating task:", error);
    res
      .status(500)
      .json({ error: withErrorDetails("Failed to update task", error) });
  }
});

// Delete task (Managers/Admins only)
router.delete(
  "/:id",
  authenticateToken,
  requirePermission("can_manage_tasks"),
  async (req, res) => {
    try {
      const taskIds = normalizeTaskIds(req.body?.task_ids);
      const targetTaskIds =
        taskIds.length > 0 ? taskIds : normalizeTaskIds([req.params.id]);

      await deleteTasksCascade(targetTaskIds);

      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  },
);

// Get task comments
router.get("/:id/comments", authenticateToken, async (req, res) => {
  try {
    const access = await resolveTaskAccess(req.params.id, req.user);
    if (access.error) {
      return res.status(access.code).json({ error: access.error });
    }

    const { data, error } = await supabase
      .from("task_comments")
      .select("*")
      .eq("task_id", req.params.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Database error fetching comments:", error);
      return res.status(500).json({ error: "Failed to fetch comments" });
    }

    const withUsers = await enrichItemsWithUsers(data || [], "user_id", "user");
    res.json(withUsers);
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// Add task comment
router.post("/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { comment } = req.body;

    if (!comment || comment.trim() === "") {
      return res.status(400).json({ error: "Comment is required" });
    }

    const access = await resolveTaskAccess(req.params.id, req.user);
    if (access.error) {
      return res.status(access.code).json({ error: access.error });
    }

    const { data, error } = await supabase
      .from("task_comments")
      .insert({
        task_id: req.params.id,
        user_id: req.user.id,
        comment: comment.trim(),
      })
      .select("*")
      .single();

    if (error) {
      console.error("Database error adding comment:", error);
      return res.status(500).json({ error: "Failed to add comment" });
    }

    const withUser = await enrichItemsWithUsers(data, "user_id", "user");
    res.status(201).json(withUser);
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// Get task attachments
router.get("/:id/attachments", authenticateToken, async (req, res) => {
  try {
    const access = await resolveTaskAccess(req.params.id, req.user);
    if (access.error) {
      return res.status(access.code).json({ error: access.error });
    }

    const { data, error } = await supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", req.params.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database error fetching task attachments:", error);
      return res.status(500).json({ error: "Failed to fetch attachments" });
    }

    const withUploader = await enrichItemsWithUsers(
      data || [],
      "uploaded_by",
      "uploader",
    );
    res.json(withUploader);
  } catch (error) {
    console.error("Error fetching task attachments:", error);
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

// Upload task attachments
router.post(
  "/:id/attachments",
  authenticateToken,
  upload.fields([
    { name: "files", maxCount: 10 },
    { name: "files[]", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const uploadedFilesInput = collectUploadedFiles(req);

      if (uploadedFilesInput.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const access = await resolveTaskAccess(req.params.id, req.user);
      if (access.error) {
        return res.status(access.code).json({ error: access.error });
      }

      const fileUploads = uploadedFilesInput.map((file) => ({
        buffer: file.buffer,
        name: file.originalname,
        mimeType: file.mimetype,
      }));

      await fileUploadService.ensureBucket(TASK_ATTACHMENT_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
      });

      const uploadedFiles = await fileUploadService.uploadMultipleFiles(
        fileUploads,
        req.user.id,
        {
          bucketName: TASK_ATTACHMENT_BUCKET,
          prefix: `tasks/${req.params.id}`,
        },
      );

      const rows = uploadedFiles.map((file) => ({
        task_id: req.params.id,
        uploaded_by: req.user.id,
        file_name: file.fileName,
        file_url: file.url,
        storage_path: file.storagePath,
        mime_type: file.mimeType,
        size_bytes: file.size,
      }));

      const { data, error } = await supabase
        .from("task_attachments")
        .insert(rows)
        .select("*");

      if (error) {
        console.error("Database error creating task attachments:", error);
        return res.status(500).json({ error: "Failed to save attachments" });
      }

      const counterpartId =
        req.user.id === access.task.assigned_to
          ? access.task.assigned_by
          : access.task.assigned_to;

      if (counterpartId && counterpartId !== req.user.id) {
        await createTaskNotification({
          userId: counterpartId,
          title: "Task attachment added",
          message: `New attachment added to task "${access.task.title}"`,
          taskId: access.task.id,
          metadata: {
            added_by: req.user.id,
            attachments_count: rows.length,
          },
        });
      }

      const withUploader = await enrichItemsWithUsers(
        data || [],
        "uploaded_by",
        "uploader",
      );
      res.status(201).json(withUploader);
    } catch (error) {
      console.error("Error uploading task attachments:", error);
      res.status(500).json({ error: "Failed to upload attachments" });
    }
  },
);

// Delete task attachment
router.delete(
  "/:taskId/attachments/:attachmentId",
  authenticateToken,
  async (req, res) => {
    try {
      const { taskId, attachmentId } = req.params;
      const access = await resolveTaskAccess(taskId, req.user);

      if (access.error) {
        return res.status(access.code).json({ error: access.error });
      }

      const { data: attachment, error: attachmentError } = await supabase
        .from("task_attachments")
        .select("*")
        .eq("id", attachmentId)
        .eq("task_id", taskId)
        .single();

      if (attachmentError && attachmentError.code !== "PGRST116") {
        console.error("Database error fetching attachment:", attachmentError);
        return res.status(500).json({ error: "Failed to fetch attachment" });
      }

      if (!attachment) {
        return res.status(404).json({ error: "Attachment not found" });
      }

      if (
        !access.canManage &&
        req.user.role !== "admin" &&
        attachment.uploaded_by !== req.user.id
      ) {
        return res.status(403).json({
          error: "Access denied: insufficient permissions",
        });
      }

      if (attachment.storage_path) {
        await fileUploadService.deleteFile(
          attachment.storage_path,
          TASK_ATTACHMENT_BUCKET,
        );
      }

      const { error } = await supabase
        .from("task_attachments")
        .delete()
        .eq("id", attachmentId);

      if (error) {
        console.error("Database error deleting attachment:", error);
        return res.status(500).json({ error: "Failed to delete attachment" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting task attachment:", error);
      res.status(500).json({ error: "Failed to delete attachment" });
    }
  },
);

export default router;
