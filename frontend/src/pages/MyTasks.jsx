import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  Paperclip,
  Upload,
  User,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import api, { getErrorMessage } from "../utils/api";
import { extractArray } from "../utils/response";
import {
  markSharedDataUpdated,
  subscribeToSharedDataUpdates,
} from "../utils/realtime";
import { normalizeTaskRecord } from "../utils/taskGroups";
import { formatDate, formatNumber } from "../utils/localeFormat";

const POLLING_INTERVAL_MS = 30000;

export default function MyTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: "", text: "" });

  const fetchTasks = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }

      const response = await api.get("/tasks");
      setTasks(extractArray(response.data).map(normalizeTaskRecord));
    } catch (error) {
      if (!silent) {
        setMessage({ type: "error", text: getErrorMessage(error) });
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTasks();

    const interval = setInterval(() => {
      fetchTasks({ silent: true });
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchTasks({ silent: true });
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [fetchTasks]);

  const groupedTasks = useMemo(
    () => ({
      pending: tasks.filter((item) => item.status === "pending"),
      in_progress: tasks.filter((item) => item.status === "in_progress"),
      completed: tasks.filter((item) => item.status === "completed"),
    }),
    [tasks],
  );

  const handleStatusChange = async (taskId, status) => {
    try {
      await api.put(`/tasks/${taskId}`, { status });
      markSharedDataUpdated();
      await fetchTasks();
      setMessage({ type: "success", text: "Task status updated successfully" });
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleFileUpload = async (taskId, fileList) => {
    try {
      if (!fileList || fileList.length === 0) return;

      const payload = new FormData();
      Array.from(fileList).forEach((file) => payload.append("files", file));
      await api.post(`/tasks/${taskId}/attachments`, payload, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      markSharedDataUpdated();
      await fetchTasks();
      setMessage({ type: "success", text: "Attachments uploaded successfully" });
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex-1 p-8">Loading...</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">My Tasks</h1>
          <p className="text-slate-600 mt-1">
            Tasks assigned to you, with status updates and attachments
          </p>
        </div>

        {message.text && (
          <div
            className={`px-4 py-3 rounded-lg ${
              message.type === "error"
                ? "bg-red-50 border border-red-200 text-red-700"
                : "bg-emerald-50 border border-emerald-200 text-emerald-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TaskColumn
            title="Pending"
            icon={Clock}
            color="text-yellow-600"
            tasks={groupedTasks.pending}
            onStatusChange={handleStatusChange}
            onUpload={handleFileUpload}
          />
          <TaskColumn
            title="In Progress"
            icon={AlertCircle}
            color="text-blue-600"
            tasks={groupedTasks.in_progress}
            onStatusChange={handleStatusChange}
            onUpload={handleFileUpload}
          />
          <TaskColumn
            title="Completed"
            icon={CheckCircle}
            color="text-emerald-600"
            tasks={groupedTasks.completed}
            onStatusChange={handleStatusChange}
            onUpload={handleFileUpload}
          />
        </div>
      </main>
    </div>
  );
}

function TaskColumn({ title, icon: Icon, color, tasks, onStatusChange, onUpload }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h2 className={`text-lg font-bold mb-3 flex items-center gap-2 ${color}`}>
        <Icon size={18} />
        {title} ({formatNumber(tasks.length, { maximumFractionDigits: 0 })})
      </h2>
      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onStatusChange={onStatusChange}
            onUpload={onUpload}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, onStatusChange, onUpload }) {
  return (
    <div className="border rounded-lg p-3 bg-slate-50">
      {task.group_name && (
        <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">
          {task.group_name}
        </span>
      )}
      <h3 className="font-semibold text-slate-900">{task.title}</h3>

      {task.description && (
        <p className="text-sm text-slate-600 mt-2">{task.description}</p>
      )}

      <div className="text-xs text-slate-600 mt-2 space-y-1">
        {task.assigned_by_user && (
          <p className="flex items-center gap-1">
            <User size={12} />
            Assigned by: {task.assigned_by_user.name}
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
          <p className="text-xs font-medium text-slate-700 flex items-center gap-1">
            <Paperclip size={12} />
            Attachments ({formatNumber(task.attachments.length, {
              maximumFractionDigits: 0,
            })})
          </p>
          <div className="mt-1 space-y-1">
            {task.attachments.map((item) => (
              <a
                key={item.id}
                href={item.file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-sky-700 hover:text-sky-900 flex items-center gap-1"
              >
                <Upload size={11} />
                {item.file_name}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm"
        >
          <option value="pending">pending</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
        </select>

        <label className="w-full border rounded px-2 py-1 text-sm flex items-center gap-2 cursor-pointer bg-white hover:bg-slate-100">
          <Upload size={14} />
          Add attachments
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"
            className="hidden"
            onChange={(e) => onUpload(task.id, e.target.files)}
          />
        </label>
      </div>
    </div>
  );
}
