import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  Edit,
  Paperclip,
  Plus,
  Save,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useLocale } from "../context/LocaleContext";
import api, { getErrorMessage } from "../utils/api";
import { extractArray } from "../utils/response";
import {
  markSharedDataUpdated,
  subscribeToSharedDataUpdates,
} from "../utils/realtime";
import {
  buildTaskGroups,
  extractTaskIdsForUpload,
} from "../utils/taskGroups";
import { formatDate, formatNumber } from "../utils/localeFormat";

const POLLING_INTERVAL_MS = 30000;
let assigneesEndpointUnsupported = false;
let assigneesProbeInFlight = false;

const EMPTY_FORM = {
  title: "",
  description: "",
  assignment_mode: "single",
  assigned_to: "",
  assigned_to_ids: [],
  group_name: "",
  priority: "medium",
  due_date: "",
};

const getSelectedAssigneeIds = (formData) =>
  formData.assignment_mode === "group"
    ? Array.from(new Set(formData.assigned_to_ids.filter(Boolean)))
    : formData.assigned_to
      ? [formData.assigned_to]
      : [];

export default function Tasks() {
  const { select } = useLocale();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [files, setFiles] = useState([]);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [assigneesEndpointAvailable, setAssigneesEndpointAvailable] = useState(
    !assigneesEndpointUnsupported,
  );

  const loadPageData = useCallback(
    async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setLoading(true);
        }

        const shouldUseAssigneesEndpoint =
          assigneesEndpointAvailable &&
          !assigneesEndpointUnsupported &&
          !assigneesProbeInFlight;

        const assigneesRequest = shouldUseAssigneesEndpoint
          ? (() => {
              assigneesProbeInFlight = true;
              return api.get("/tasks/assignees").finally(() => {
                assigneesProbeInFlight = false;
              });
            })()
          : api.get("/users");

        const [tasksResult, assigneesResult] = await Promise.allSettled([
          api.get("/tasks"),
          assigneesRequest,
        ]);

        if (tasksResult.status === "fulfilled") {
          const rawTasks = extractArray(tasksResult.value.data);
          setTasks(buildTaskGroups(rawTasks));
        } else if (!silent) {
          setTasks([]);
          setMessage({
            type: "error",
            text: getErrorMessage(tasksResult.reason),
          });
        }

        if (assigneesResult.status === "fulfilled") {
          setUsers(extractArray(assigneesResult.value.data));
        } else {
          const status = assigneesResult.reason?.response?.status;

          if (assigneesEndpointAvailable && (status === 404 || status === 500)) {
            assigneesEndpointUnsupported = true;
            setAssigneesEndpointAvailable(false);

            try {
              const fallbackUsersResponse = await api.get("/users");
              setUsers(extractArray(fallbackUsersResponse.data));
            } catch {
              setUsers([]);
            }
          } else {
            setUsers([]);
          }

          if (!silent && status !== 403) {
            setMessage({
              type: "error",
              text: "Unable to load assignable users list",
            });
          }
        }
      } catch (error) {
        if (!silent) {
          setMessage({ type: "error", text: getErrorMessage(error) });
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [assigneesEndpointAvailable],
  );

  useEffect(() => {
    loadPageData();

    const interval = setInterval(() => {
      loadPageData({ silent: true });
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      loadPageData({ silent: true });
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadPageData]);

  const groupedTasks = useMemo(
    () => ({
      pending: tasks.filter((item) => item.status === "pending"),
      in_progress: tasks.filter((item) => item.status === "in_progress"),
      completed: tasks.filter((item) => item.status === "completed"),
    }),
    [tasks],
  );

  const resetModalState = () => {
    setEditingTask(null);
    setFormData(EMPTY_FORM);
    setFiles([]);
  };

  const openCreateModal = () => {
    resetModalState();
    setShowModal(true);
  };

  const openEditModal = (task) => {
    const childTasks = Array.isArray(task.child_tasks) ? task.child_tasks : [task];
    const assigneeIds = childTasks
      .map((item) => item.assigned_to)
      .filter(Boolean);

    setEditingTask(task);
    setFormData({
      title: task.title || "",
      description: task.description || "",
      assignment_mode: task.is_group ? "group" : "single",
      assigned_to: !task.is_group ? assigneeIds[0] || "" : "",
      assigned_to_ids: assigneeIds,
      group_name: task.group_name || "",
      priority: task.priority || "medium",
      due_date: task.due_date ? String(task.due_date).split("T")[0] : "",
    });
    setFiles([]);
    setShowModal(true);
  };

  const toggleAssignee = (userId) => {
    setFormData((prev) => {
      const nextIds = prev.assigned_to_ids.includes(userId)
        ? prev.assigned_to_ids.filter((value) => value !== userId)
        : [...prev.assigned_to_ids, userId];

      return {
        ...prev,
        assigned_to_ids: nextIds,
      };
    });
  };

  const uploadTaskFiles = async (taskIds, fileList) => {
    if (!fileList || fileList.length === 0) return;

    const normalizedTaskIds = Array.from(
      new Set((Array.isArray(taskIds) ? taskIds : [taskIds]).filter(Boolean)),
    );

    if (normalizedTaskIds.length === 0) return;

    await Promise.all(
      normalizedTaskIds.map(async (taskId) => {
        const payload = new FormData();
        fileList.forEach((file) => payload.append("files", file));
        await api.post(`/tasks/${taskId}/attachments`, payload, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
      }),
    );
  };

  const buildSubmitPayload = () => {
    const selectedAssigneeIds = getSelectedAssigneeIds(formData);

    if (!formData.title.trim()) {
      throw new Error("Task title is required");
    }

    if (formData.assignment_mode === "group" && selectedAssigneeIds.length < 2) {
      throw new Error("Select at least two assignees to create a task group");
    }

    if (formData.assignment_mode === "single" && selectedAssigneeIds.length !== 1) {
      throw new Error("Select one assignee for a single task");
    }

    const payload = {
      title: formData.title.trim(),
      description: formData.description.trim(),
      priority: formData.priority,
      due_date: formData.due_date || null,
    };

    if (formData.assignment_mode === "group") {
      payload.assigned_to_ids = selectedAssigneeIds;
      payload.group_name = formData.group_name.trim() || formData.title.trim();
    } else {
      payload.assigned_to = selectedAssigneeIds[0];
    }

    if (editingTask?.is_group) {
      payload.apply_to_task_ids = editingTask.child_tasks.map((task) => task.id);
      payload.group_name = formData.group_name.trim() || formData.title.trim();
      payload.assigned_to_ids = selectedAssigneeIds;
    }

    return payload;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const payload = buildSubmitPayload();

      if (editingTask) {
        const { data } = await api.put(
          `/tasks/${editingTask.primary_task_id || editingTask.id}`,
          payload,
        );
        const uploadIds = extractTaskIdsForUpload(data, editingTask);
        await uploadTaskFiles(uploadIds, files);
        setMessage({ type: "success", text: "Task updated successfully" });
      } else {
        const { data } = await api.post("/tasks", payload);
        const uploadIds = extractTaskIdsForUpload(data);
        await uploadTaskFiles(uploadIds, files);
        setMessage({ type: "success", text: "Task created successfully" });
      }

      setShowModal(false);
      resetModalState();
      markSharedDataUpdated();
      await loadPageData();
    } catch (error) {
      setMessage({
        type: "error",
        text: error?.response ? getErrorMessage(error) : error.message,
      });
    }
  };

  const handleDeleteTask = async (task) => {
    const confirmText = task.is_group
      ? "Delete this task group and all linked member tasks?"
      : "Delete this task?";

    if (!window.confirm(confirmText)) {
      return;
    }

    try {
      const taskIds = task.is_group
        ? task.child_tasks.map((item) => item.id)
        : [task.id];

      await api.delete(`/tasks/${task.primary_task_id || task.id}`, {
        data: taskIds.length > 1 ? { task_ids: taskIds } : undefined,
      });
      markSharedDataUpdated();
      setMessage({ type: "success", text: "Task deleted successfully" });
      await loadPageData();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleStatusChange = async (taskId, status) => {
    try {
      await api.put(`/tasks/${taskId}`, { status });
      markSharedDataUpdated();
      await loadPageData();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 p-8">
          {select("\u062c\u0627\u0631\u064d \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u0647\u0627\u0645...", "Loading tasks...")}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Task Control Center</h1>
            <p className="mt-1 text-slate-600">
              Create single tasks or coordinated task groups for multiple teammates
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2 text-white hover:bg-sky-800"
          >
            <Plus size={18} />
            New Task
          </button>
        </div>

        {message.text && (
          <div
            className={`rounded-lg border px-4 py-3 ${
              message.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <TaskColumn
            title="Pending"
            icon={Clock}
            color="text-yellow-600"
            tasks={groupedTasks.pending}
            onEdit={openEditModal}
            onDelete={handleDeleteTask}
            onStatusChange={handleStatusChange}
          />
          <TaskColumn
            title="In Progress"
            icon={AlertCircle}
            color="text-blue-600"
            tasks={groupedTasks.in_progress}
            onEdit={openEditModal}
            onDelete={handleDeleteTask}
            onStatusChange={handleStatusChange}
          />
          <TaskColumn
            title="Completed"
            icon={CheckCircle}
            color="text-emerald-600"
            tasks={groupedTasks.completed}
            onEdit={openEditModal}
            onDelete={handleDeleteTask}
            onStatusChange={handleStatusChange}
          />
        </div>
      </main>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {editingTask
                    ? select("\u062a\u0639\u062f\u064a\u0644 \u0645\u0647\u0645\u0629", "Edit Task")
                    : select("\u0625\u0646\u0634\u0627\u0621 \u0645\u0647\u0645\u0629", "Create Task")}
                </h2>
                <p className="text-sm text-slate-500">
                  {select(
                    "\u0627\u062e\u062a\u0631 \u0625\u0633\u0646\u0627\u062f\u064b\u0627 \u0641\u0631\u062f\u064a\u064b\u0627 \u0623\u0648 \u062a\u0633\u0644\u064a\u0645\u064b\u0627 \u062c\u0645\u0627\u0639\u064a\u064b\u0627 \u0645\u0646\u0638\u0645\u064b\u0627.",
                    "Choose single assignment or coordinated group delivery",
                  )}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.4fr,0.8fr]">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Task title
                  </label>
                  <input
                    value={formData.title}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    required
                    className="w-full rounded-lg border px-3 py-2"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Work mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          assignment_mode: "single",
                          assigned_to_ids:
                            prev.assigned_to_ids.length > 0
                              ? [prev.assigned_to_ids[0]]
                              : prev.assigned_to
                                ? [prev.assigned_to]
                                : [],
                        }))
                      }
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                        formData.assignment_mode === "single"
                          ? "border-sky-600 bg-sky-50 text-sky-700"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      Single Task
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormData((prev) => ({
                          ...prev,
                          assignment_mode: "group",
                          assigned_to_ids: getSelectedAssigneeIds(prev),
                        }))
                      }
                      className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                        formData.assignment_mode === "group"
                          ? "border-sky-600 bg-sky-50 text-sky-700"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      Task Group
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Priority
                  </label>
                  <select
                    value={formData.priority}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        priority: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={formData.due_date}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        due_date: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border px-3 py-2"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Group label
                  </label>
                  <input
                    value={formData.group_name}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        group_name: event.target.value,
                      }))
                    }
                    disabled={formData.assignment_mode !== "group" && !editingTask?.is_group}
                    placeholder="Optional team label"
                    className="w-full rounded-lg border px-3 py-2 disabled:bg-slate-50"
                  />
                </div>
              </div>

              {formData.assignment_mode === "single" && !editingTask?.is_group ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Assign to
                  </label>
                  <select
                    value={formData.assigned_to}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        assigned_to: event.target.value,
                        assigned_to_ids: event.target.value ? [event.target.value] : [],
                      }))
                    }
                    required
                    className="w-full rounded-lg border px-3 py-2"
                  >
                    <option value="">Select a teammate</option>
                    {users.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.email})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        Group assignees
                      </p>
                      <p className="text-xs text-slate-500">
                        Select every teammate who should receive their own linked task
                      </p>
                    </div>
                    <div className="rounded-full bg-slate-900 px-3 py-1 text-xs text-white">
                      {formatNumber(getSelectedAssigneeIds(formData).length, {
                        maximumFractionDigits: 0,
                      })} selected
                    </div>
                  </div>

                  <div className="grid max-h-64 grid-cols-1 gap-2 overflow-auto md:grid-cols-2">
                    {users.map((item) => {
                      const checked = formData.assigned_to_ids.includes(item.id);
                      return (
                        <label
                          key={item.id}
                          className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 ${
                            checked
                              ? "border-sky-600 bg-sky-50"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleAssignee(item.id)}
                            className="mt-1"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {item.name}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {item.email}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Task attachments
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"
                  onChange={(event) =>
                    setFiles(Array.from(event.target.files || []))
                  }
                  className="w-full rounded-lg border px-3 py-2"
                />
                {files.length > 0 && (
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    {files.map((file, index) => (
                      <p key={`${file.name}-${index}`}>- {file.name}</p>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-3 text-white hover:bg-emerald-700"
              >
                <Save size={18} />
                {select("\u062d\u0641\u0638", "Save")}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskColumn({
  title,
  icon: Icon,
  color,
  tasks,
  onEdit,
  onDelete,
  onStatusChange,
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <h2 className={`mb-3 flex items-center gap-2 text-lg font-bold ${color}`}>
        <Icon size={18} />
        {title} ({formatNumber(tasks.length, { maximumFractionDigits: 0 })})
      </h2>
      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onEdit={onEdit}
            onDelete={onDelete}
            onStatusChange={onStatusChange}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, onEdit, onDelete, onStatusChange }) {
  const priorityClass = {
    low: "bg-slate-100 text-slate-700",
    medium: "bg-sky-100 text-sky-700",
    high: "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
  };

  const statusChipClass = {
    pending: "bg-yellow-100 text-yellow-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-slate-200 text-slate-700",
  };

  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {task.is_group && (
              <span className="rounded-full bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white">
                Task Group
              </span>
            )}
            {task.group_name && (
              <span className="rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">
                {task.group_name}
              </span>
            )}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-slate-900">{task.title}</h3>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            priorityClass[task.priority] || priorityClass.medium
          }`}
        >
          {task.priority}
        </span>
      </div>

      {task.description && (
        <p className="mt-2 line-clamp-2 text-sm text-slate-600">{task.description}</p>
      )}

      <div className="mt-3 space-y-2 text-xs text-slate-600">
        {task.is_group ? (
          <>
            <p className="flex items-center gap-1">
              <Users size={12} />
              {formatNumber(task.completed_count, {
                maximumFractionDigits: 0,
              })}/{formatNumber(task.task_count, {
                maximumFractionDigits: 0,
              })} completed
            </p>
            <div className="flex flex-wrap gap-2">
              {(task.assignees || []).map((assignee) => (
                <span
                  key={`${task.id}-${assignee.task_id}`}
                  className={`rounded-full px-2 py-1 text-[11px] ${
                    statusChipClass[assignee.status] || statusChipClass.pending
                  }`}
                >
                  {assignee.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="flex items-center gap-1">
            <User size={12} />
            {task.assigned_to_user?.name || "-"}
          </p>
        )}

        {task.due_date && (
          <p className="flex items-center gap-1">
            <Calendar size={12} />
            {formatDate(task.due_date)}
          </p>
        )}
      </div>

      {Array.isArray(task.attachments) && task.attachments.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="flex items-center gap-1 text-xs font-medium text-slate-700">
            <Paperclip size={12} />
            Attachments ({formatNumber(task.attachments.length, {
              maximumFractionDigits: 0,
            })})
          </p>
          <div className="mt-1 space-y-1">
            {task.attachments.slice(0, 3).map((item) => (
              <a
                key={item.id}
                href={item.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900"
              >
                <Upload size={11} />
                {item.file_name}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        {!task.is_group && (
          <select
            value={task.status}
            onChange={(event) => onStatusChange(task.id, event.target.value)}
            className="flex-1 rounded border px-2 py-1 text-sm"
          >
            <option value="pending">pending</option>
            <option value="in_progress">in_progress</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
        )}

        <button
          onClick={() => onEdit(task)}
          className="rounded bg-sky-100 px-2 py-1 text-sky-700 hover:bg-sky-200"
        >
          <Edit size={14} />
        </button>
        <button
          onClick={() => onDelete(task)}
          className="rounded bg-red-100 px-2 py-1 text-red-700 hover:bg-red-200"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
