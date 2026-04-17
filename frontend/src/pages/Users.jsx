import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FileText,
  Shield,
  UserPlus,
  Users as UsersIcon,
  X,
} from "lucide-react";
import api, { getErrorMessage } from "../utils/api";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import {
  getPermissionDescription,
  getPermissionLabel,
} from "../utils/permissionLabels";
import {
  DEFAULT_CLIENT_PERMISSIONS,
  normalizeClientPermissions,
  setPermissionWithDependencies,
} from "../utils/permissionState";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";

const POLLING_INTERVAL_MS = 30000;
const TABS = ["users", "requests", "reports"];

const getTabFromQuery = (value) => (TABS.includes(value) ? value : "users");

const formatRoleLabel = (role, locale) =>
  role === "admin"
    ? locale === "ar"
      ? "مدير"
      : "Admin"
    : locale === "ar"
      ? "مستخدم"
      : "User";

const formatStatusLabel = (status, locale) => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved")
    return locale === "ar" ? "موافق عليه" : "Approved";
  if (normalized === "rejected") return locale === "ar" ? "مرفوض" : "Rejected";
  return locale === "ar" ? "قيد المراجعة" : "Pending Review";
};

export default function Users() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, refreshAuth } = useAuth();
  const { locale, select, formatDate, formatNumber } = useLocale();
  const [users, setUsers] = useState([]);
  const [accessRequests, setAccessRequests] = useState([]);
  const [dailyReports, setDailyReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [activeTab, setActiveTab] = useState(
    getTabFromQuery(searchParams.get("tab")),
  );
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "user",
  });
  const [editRole, setEditRole] = useState("user");
  const [permissions, setPermissions] = useState({
    ...DEFAULT_CLIENT_PERMISSIONS,
  });

  const pendingRequests = useMemo(
    () => accessRequests.filter((item) => item.status === "pending").length,
    [accessRequests],
  );

  const loadUsers = useCallback(async () => {
    const response = await api.get("/users");
    setUsers(extractArray(response.data));
  }, []);

  const loadAccessRequests = useCallback(async () => {
    const response = await api.get("/access-requests/all");
    setAccessRequests(extractArray(response.data));
  }, []);

  const loadDailyReports = useCallback(async () => {
    const response = await api.get("/daily-reports/all");
    setDailyReports(extractArray(response.data));
  }, []);

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadUsers(),
        loadAccessRequests(),
        loadDailyReports(),
      ]);
    } catch (error) {
      setMessage({
        type: "error",
        text: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [loadAccessRequests, loadDailyReports, loadUsers]);

  useEffect(() => {
    loadPage();

    const interval = setInterval(() => {
      loadUsers();
      loadAccessRequests();
      loadDailyReports();
    }, POLLING_INTERVAL_MS);

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      loadUsers();
      loadAccessRequests();
      loadDailyReports();
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadAccessRequests, loadDailyReports, loadPage, loadUsers]);

  useEffect(() => {
    setActiveTab(getTabFromQuery(searchParams.get("tab")));
  }, [searchParams]);

  const setTab = (tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const handleDeleteUser = async (userId) => {
    const confirmed = window.confirm(
      select(
        "هل أنت متأكد من حذف هذا المستخدم؟",
        "Are you sure you want to delete this user?",
      ),
    );

    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/users/${userId}`);
      setMessage({
        type: "success",
        text: select("تم حذف المستخدم بنجاح", "User deleted successfully"),
      });
      await loadUsers();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleApproveRequest = async (requestId, status) => {
    try {
      await api.put(`/access-requests/${requestId}`, {
        status,
        admin_notes: "",
      });
      setMessage({
        type: "success",
        text:
          status === "approved"
            ? select("تمت الموافقة على الطلب", "Request approved")
            : select("تم رفض الطلب", "Request rejected"),
      });
      await Promise.all([loadAccessRequests(), loadUsers()]);
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleAddUser = async (event) => {
    event.preventDefault();

    try {
      await api.post("/users/create", { ...newUser, permissions });
      setMessage({
        type: "success",
        text: select("تمت إضافة المستخدم بنجاح", "User added successfully"),
      });
      setShowAddModal(false);
      setNewUser({ name: "", email: "", password: "", role: "user" });
      setPermissions({ ...DEFAULT_CLIENT_PERMISSIONS });
      await loadUsers();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const handleEditUser = async (event) => {
    event.preventDefault();

    try {
      await api.put(`/users/${selectedUser.id}`, {
        role: editRole,
        permissions,
      });
      if (
        selectedUser?.id &&
        user?.id &&
        String(selectedUser.id) === String(user.id)
      ) {
        await refreshAuth();
      }
      setMessage({
        type: "success",
        text: select("تم تحديث المستخدم بنجاح", "User updated successfully"),
      });
      setShowEditModal(false);
      await loadUsers();
    } catch (error) {
      setMessage({ type: "error", text: getErrorMessage(error) });
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setEditRole(user.role || "user");
    setPermissions(
      normalizeClientPermissions(
        Array.isArray(user.permissions) ? user.permissions[0] || {} : user.permissions,
      ),
    );
    setShowEditModal(true);
  };

  return (
    <div className="flex min-h-screen bg-transparent">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section className="app-toolbar rounded-[30px] p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                  <UsersIcon size={14} />
                  {select("إدارة الفريق", "Team workspace")}
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-slate-900">
                  {select("إدارة المستخدمين", "User Management")}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                  {select(
                    "تابع المستخدمين وطلبات الصلاحيات والتقارير اليومية من واجهة أوضح وأسهل في المراجعة.",
                    "Review users, access requests, and daily reports from a clearer management workspace.",
                  )}
                </p>
              </div>

              <button
                onClick={() => setShowAddModal(true)}
                className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
              >
                <UserPlus size={18} />
                {select("إضافة مستخدم", "Add user")}
              </button>
            </div>
          </section>

          {message.text ? (
            <div
              className={`rounded-[24px] border px-4 py-3 text-sm ${
                message.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {message.text}
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title={select("المستخدمون", "Users")}
              value={formatNumber(users.length, { maximumFractionDigits: 0 })}
              subtitle={select(
                "إجمالي الحسابات داخل النظام",
                "All accounts in the system",
              )}
              icon={UsersIcon}
            />
            <MetricCard
              title={select("طلبات معلقة", "Pending requests")}
              value={formatNumber(pendingRequests, {
                maximumFractionDigits: 0,
              })}
              subtitle={select(
                "طلبات صلاحيات تحتاج مراجعة",
                "Access requests waiting for review",
              )}
              icon={Shield}
            />
            <MetricCard
              title={select("تقارير يومية", "Daily reports")}
              value={formatNumber(dailyReports.length, {
                maximumFractionDigits: 0,
              })}
              subtitle={select(
                "تقارير الفريق المرفوعة",
                "Submitted team reports",
              )}
              icon={FileText}
            />
          </section>

          <div className="flex flex-wrap gap-2">
            <TabButton
              active={activeTab === "users"}
              label={`${select("المستخدمون", "Users")} (${formatNumber(users.length, { maximumFractionDigits: 0 })})`}
              onClick={() => setTab("users")}
            />
            <TabButton
              active={activeTab === "requests"}
              label={`${select("طلبات الصلاحيات", "Access Requests")} (${formatNumber(pendingRequests, { maximumFractionDigits: 0 })})`}
              onClick={() => setTab("requests")}
            />
            <TabButton
              active={activeTab === "reports"}
              label={`${select("التقارير اليومية", "Daily Reports")} (${formatNumber(dailyReports.length, { maximumFractionDigits: 0 })})`}
              onClick={() => setTab("reports")}
            />
          </div>

          {loading ? (
            <div className="app-surface rounded-[28px] p-8 text-center text-slate-500">
              {select("جارٍ تحميل البيانات...", "Loading data...")}
            </div>
          ) : null}

          {!loading && activeTab === "users" ? (
            <div className="app-table-shell rounded-[30px]">
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[860px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4">
                        {select("المستخدم", "User")}
                      </th>
                      <th className="px-6 py-4">{select("البريد", "Email")}</th>
                      <th className="px-6 py-4">{select("الدور", "Role")}</th>
                      <th className="px-6 py-4">
                        {select("الحالة", "Status")}
                      </th>
                      <th className="px-6 py-4">
                        {select("إجراءات", "Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                              <UsersIcon size={16} />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">
                                {user.name}
                              </p>
                              <p className="text-xs text-slate-400">
                                #{user.id}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-600">
                          {user.email}
                        </td>
                        <td className="px-6 py-4">
                          <span className="app-chip px-3 py-1 text-xs font-semibold text-slate-700">
                            {formatRoleLabel(user.role, locale)}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                              user.is_active
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {user.is_active
                              ? select("نشط", "Active")
                              : select("موقوف", "Inactive")}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => openEditModal(user)}
                              className="app-button-secondary rounded-xl px-3 py-2 text-xs font-semibold text-slate-700"
                            >
                              {select("تعديل", "Edit")}
                            </button>
                            {user.role !== "admin" ? (
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                              >
                                {select("حذف", "Delete")}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!loading && activeTab === "requests" ? (
            <div className="app-table-shell rounded-[30px]">
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[960px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4">
                        {select("المستخدم", "User")}
                      </th>
                      <th className="px-6 py-4">
                        {select("الصلاحية", "Permission")}
                      </th>
                      <th className="px-6 py-4">{select("السبب", "Reason")}</th>
                      <th className="px-6 py-4">{select("التاريخ", "Date")}</th>
                      <th className="px-6 py-4">
                        {select("الحالة", "Status")}
                      </th>
                      <th className="px-6 py-4">
                        {select("إجراءات", "Actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accessRequests.length === 0 ? (
                      <tr>
                        <td
                          colSpan="6"
                          className="px-6 py-12 text-center text-slate-500"
                        >
                          {select(
                            "لا توجد طلبات صلاحيات",
                            "No access requests",
                          )}
                        </td>
                      </tr>
                    ) : (
                      accessRequests.map((request) => (
                        <tr key={request.id}>
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium text-slate-900">
                                {request.users?.name ||
                                  select("غير معروف", "Unknown")}
                              </p>
                              <p className="text-xs text-slate-400">
                                {request.users?.email}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="space-y-2">
                              <span className="app-chip inline-flex px-3 py-1 text-xs font-semibold text-slate-700">
                                {getPermissionLabel(
                                  request.permission_requested,
                                  locale,
                                )}
                              </span>
                              <p className="max-w-sm text-xs leading-5 text-slate-500">
                                {getPermissionDescription(
                                  request.permission_requested,
                                  locale,
                                )}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {request.reason}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {formatDate(request.created_at)}
                          </td>
                          <td className="px-6 py-4">
                            <span className="app-chip px-3 py-1 text-xs font-semibold text-slate-700">
                              {formatStatusLabel(request.status, locale)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {request.status === "pending" ? (
                              <div className="flex gap-2">
                                <button
                                  onClick={() =>
                                    handleApproveRequest(request.id, "approved")
                                  }
                                  className="rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                                >
                                  {select("موافقة", "Approve")}
                                </button>
                                <button
                                  onClick={() =>
                                    handleApproveRequest(request.id, "rejected")
                                  }
                                  className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
                                >
                                  {select("رفض", "Reject")}
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">
                                {select("تمت المراجعة", "Reviewed")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!loading && activeTab === "reports" ? (
            <div className="app-table-shell rounded-[30px]">
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[920px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-4">
                        {select("المستخدم", "User")}
                      </th>
                      <th className="px-6 py-4">
                        {select("العنوان", "Title")}
                      </th>
                      <th className="px-6 py-4">
                        {select("المحتوى", "Content")}
                      </th>
                      <th className="px-6 py-4">{select("التاريخ", "Date")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dailyReports.length === 0 ? (
                      <tr>
                        <td
                          colSpan="4"
                          className="px-6 py-12 text-center text-slate-500"
                        >
                          {select("لا توجد تقارير يومية", "No daily reports")}
                        </td>
                      </tr>
                    ) : (
                      dailyReports.map((report) => (
                        <tr key={report.id}>
                          <td className="px-6 py-4">
                            <div>
                              <p className="font-medium text-slate-900">
                                {report.users?.name ||
                                  select("غير معروف", "Unknown")}
                              </p>
                              <p className="text-xs text-slate-400">
                                {report.users?.email}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-slate-900">
                            {report.title}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            <div className="line-clamp-2">{report.content}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {formatDate(report.created_at, {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {showAddModal ? (
        <UserModal
          title={select("إضافة مستخدم", "Add User")}
          onClose={() => setShowAddModal(false)}
        >
          <form onSubmit={handleAddUser} className="space-y-4">
            <Field
              label={select("الاسم", "Name")}
              value={newUser.name}
              onChange={(value) =>
                setNewUser((current) => ({ ...current, name: value }))
              }
            />
            <Field
              label={select("البريد الإلكتروني", "Email")}
              type="email"
              value={newUser.email}
              onChange={(value) =>
                setNewUser((current) => ({ ...current, email: value }))
              }
            />
            <Field
              label={select("كلمة المرور", "Password")}
              type="password"
              value={newUser.password}
              onChange={(value) =>
                setNewUser((current) => ({ ...current, password: value }))
              }
            />
            <SelectField
              label={select("الدور", "Role")}
              value={newUser.role}
              onChange={(value) =>
                setNewUser((current) => ({ ...current, role: value }))
              }
              options={[
                { value: "user", label: select("مستخدم", "User") },
                { value: "admin", label: select("مدير", "Admin") },
              ]}
            />
            <PermissionGrid
              locale={locale}
              permissions={permissions}
              setPermissions={setPermissions}
            />
            <div className="flex gap-3">
              <button
                type="submit"
                className="app-button-primary flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white"
              >
                {select("حفظ المستخدم", "Save user")}
              </button>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="app-button-secondary flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700"
              >
                {select("إلغاء", "Cancel")}
              </button>
            </div>
          </form>
        </UserModal>
      ) : null}

      {showEditModal && selectedUser ? (
        <UserModal
          title={`${select("تعديل المستخدم", "Edit User")}: ${selectedUser.name}`}
          onClose={() => setShowEditModal(false)}
        >
          <form onSubmit={handleEditUser} className="space-y-4">
            <SelectField
              label={select("الدور", "Role")}
              value={editRole}
              onChange={setEditRole}
              options={[
                { value: "user", label: select("مستخدم", "User") },
                { value: "admin", label: select("مدير", "Admin") },
              ]}
            />
            <PermissionGrid
              locale={locale}
              permissions={permissions}
              setPermissions={setPermissions}
            />
            <div className="flex gap-3">
              <button
                type="submit"
                className="app-button-primary flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-white"
              >
                {select("حفظ التغييرات", "Save changes")}
              </button>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="app-button-secondary flex-1 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700"
              >
                {select("إلغاء", "Cancel")}
              </button>
            </div>
          </form>
        </UserModal>
      ) : null}
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="app-surface rounded-[28px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="metric-number mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-900">
            {value}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{subtitle}</p>
        </div>
        <div className="rounded-[20px] bg-slate-100 p-3 text-slate-600">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-slate-900 text-white shadow-lg shadow-slate-300/50"
          : "app-button-secondary text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function UserModal({ children, onClose, title }) {
  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="app-modal-panel max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[30px] p-6 sm:p-8">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-900">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-2xl bg-slate-100 p-2 text-slate-500 hover:bg-slate-200"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, onChange, type = "text", value }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="app-input px-4 py-3 text-sm"
        required
      />
    </label>
  );
}

function SelectField({ label, onChange, options, value }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="app-input px-4 py-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PermissionGrid({ locale, permissions, setPermissions }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          {locale === "ar" ? "الصلاحيات" : "Permissions"}
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          {locale === "ar"
            ? "اختر ما يمكن للمستخدم الوصول إليه داخل النظام."
            : "Choose what this user can access in the system."}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {Object.keys(permissions).map((key) => (
          <label
            key={key}
            className={`cursor-pointer rounded-[22px] border px-4 py-3 transition ${
              permissions[key]
                ? "border-sky-200 bg-sky-50"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={permissions[key]}
                onChange={(event) =>
                  setPermissions((current) =>
                    setPermissionWithDependencies(
                      current,
                      key,
                      event.target.checked,
                    ),
                  )
                }
                className="mt-1 h-4 w-4"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {getPermissionLabel(key, locale)}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {getPermissionDescription(key, locale)}
                </p>
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
