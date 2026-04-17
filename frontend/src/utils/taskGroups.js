const TASK_META_PREFIX = "\n\n<!--TASK_META:";
const TASK_META_SUFFIX = "-->";

const normalizeText = (value) => String(value || "").trim();

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
    return {
      cleanDescription: raw.slice(0, start).trim(),
      meta: {
        group_id: normalizeText(parsed?.group_id) || null,
        group_name: normalizeText(parsed?.group_name) || null,
      },
    };
  } catch {
    return {
      cleanDescription: raw,
      meta: null,
    };
  }
};

export const normalizeTaskRecord = (task) => {
  if (!task) {
    return task;
  }

  const parsed = parseTaskMeta(task.description);
  const groupId = task.group_id || parsed.meta?.group_id || null;
  const groupName = task.group_name || parsed.meta?.group_name || null;

  return {
    ...task,
    description: parsed.cleanDescription,
    group_id: groupId,
    group_name: groupName,
    is_group_task: Boolean(groupId),
  };
};

const summarizeGroupStatus = (tasks) => {
  if (tasks.every((task) => task.status === "completed")) {
    return "completed";
  }

  if (tasks.every((task) => task.status === "cancelled")) {
    return "cancelled";
  }

  if (
    tasks.some((task) => task.status === "in_progress") ||
    tasks.some((task) => task.status === "completed")
  ) {
    return "in_progress";
  }

  return "pending";
};

const sortByCreatedAtDesc = (left, right) =>
  new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime();

export const buildTaskGroups = (tasks = []) => {
  const normalizedTasks = (tasks || []).map(normalizeTaskRecord);
  const grouped = new Map();

  for (const task of normalizedTasks) {
    const key = task.group_id || task.id;
    const current = grouped.get(key) || [];
    current.push(task);
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .map((taskList) => taskList.sort(sortByCreatedAtDesc))
    .sort((left, right) => sortByCreatedAtDesc(left[0], right[0]))
    .map((taskList) => {
      const [primaryTask] = taskList;
      const attachments = taskList
        .flatMap((task) => task.attachments || [])
        .sort((left, right) => sortByCreatedAtDesc(left, right));
      const assignees = taskList.map((task) => ({
        id: task.assigned_to,
        name: task.assigned_to_user?.name || "User",
        email: task.assigned_to_user?.email || "",
        status: task.status,
        task_id: task.id,
      }));
      const isGroup = taskList.length > 1;

      return {
        ...primaryTask,
        id: primaryTask.id,
        primary_task_id: primaryTask.id,
        is_group: isGroup,
        group_id: primaryTask.group_id || null,
        group_name: primaryTask.group_name || null,
        status: isGroup ? summarizeGroupStatus(taskList) : primaryTask.status,
        task_count: taskList.length,
        completed_count: taskList.filter((task) => task.status === "completed").length,
        assignees,
        child_tasks: taskList,
        attachments,
      };
    });
};

export const extractTaskIdsForUpload = (responseData, fallbackTask = null) => {
  if (Array.isArray(responseData?.created_tasks)) {
    return responseData.created_tasks.map((task) => task.id).filter(Boolean);
  }

  if (Array.isArray(responseData?.updated_tasks)) {
    return responseData.updated_tasks.map((task) => task.id).filter(Boolean);
  }

  if (Array.isArray(fallbackTask?.child_tasks)) {
    return fallbackTask.child_tasks.map((task) => task.id).filter(Boolean);
  }

  if (responseData?.id) {
    return [responseData.id];
  }

  if (fallbackTask?.id) {
    return [fallbackTask.id];
  }

  return [];
};
