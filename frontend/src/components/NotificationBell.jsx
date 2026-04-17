import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, CheckCheck, CircleDot } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "../utils/api";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { formatDateTime, formatRelativeTime } from "../utils/localeFormat";

let notificationsEndpointUnsupported = false;
let unreadCountRequestInFlight = false;
const NETWORK_RETRY_PAUSE_MS = 45000;
const NOTIFICATION_POLL_INTERVAL_MS = 120000;

const TYPE_LABELS = {
  system: "System",
  task: "Task",
  report: "Report",
  access_request: "Access",
  comment: "Comment",
  order: "Order",
  order_missing: "Order Attention",
  order_missing_escalated: "Critical Order Alert",
  low_stock: "Low Stock",
};

const formatTimestamp = (value, locale) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));

  if (diffMinutes < 60) {
    return formatRelativeTime(value, { style: "short" }, locale);
  }

  if (diffMinutes < 24 * 60) {
    return formatRelativeTime(value, { style: "short" }, locale);
  }

  return formatDateTime(value, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }, locale);
};

const getTypeLabel = (type) => {
  const normalized = String(type || "").toLowerCase();
  return TYPE_LABELS[normalized] || (normalized ? normalized : "Notification");
};

const isTemporaryConnectionIssue = (error) => {
  const status = Number(error?.response?.status || 0);
  return !error?.response || status >= 500 || error?.code === "ECONNABORTED";
};

const getMissingOrdersRoute = (item) => {
  const missingReason = String(item?.metadata?.missing_reason || "")
    .trim()
    .toLowerCase();

  if (missingReason === "in_stock_without_action") {
    return "/orders/in-stock-follow-up";
  }

  return "/orders/missing";
};

const getNotificationRoute = (item, isAdmin) => {
  if (
    item?.type === "order_missing" ||
    item?.type === "order_missing_escalated"
  ) {
    return getMissingOrdersRoute(item);
  }

  const metadataRoute = String(item?.metadata?.route || "").trim();
  if (metadataRoute) {
    return metadataRoute;
  }

  const type = String(item?.entity_type || "").toLowerCase();
  const entityId = item?.entity_id;

  if (type === "order" && entityId) return `/orders/${entityId}`;
  if (type === "task") return isAdmin ? "/tasks" : "/my-tasks";
  if (type === "daily_report" || type === "report") {
    return isAdmin ? "/reports" : "/my-reports";
  }
  if (type === "access_request") {
    return isAdmin ? "/users?tab=requests" : "/request-access";
  }
  if (type === "user" && isAdmin) return "/users";

  return null;
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { isRTL, locale, t } = useLocale();
  const containerRef = useRef(null);
  const pollingPausedUntilRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasTemporaryConnectionIssue, setHasTemporaryConnectionIssue] = useState(false);
  const [notificationsApiAvailable, setNotificationsApiAvailable] = useState(
    !notificationsEndpointUnsupported,
  );

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !item.is_read),
    [notifications],
  );

  const disableNotificationsApi = useCallback(() => {
    notificationsEndpointUnsupported = true;
    setNotificationsApiAvailable(false);
    setUnreadCount(0);
    setNotifications([]);
    setOpen(false);
  }, []);

  const pausePollingTemporarily = useCallback(() => {
    pollingPausedUntilRef.current = Date.now() + NETWORK_RETRY_PAUSE_MS;
    setHasTemporaryConnectionIssue(true);
  }, []);

  const isPollingPaused = () => Date.now() < pollingPausedUntilRef.current;

  const fetchUnreadCount = useCallback(async () => {
    if (
      !notificationsApiAvailable ||
      notificationsEndpointUnsupported ||
      unreadCountRequestInFlight ||
      isPollingPaused()
    ) {
      return;
    }

    unreadCountRequestInFlight = true;
    try {
      const { data } = await api.get("/notifications/unread-count");
      setUnreadCount(data?.unread_count || 0);
      setHasTemporaryConnectionIssue(false);
    } catch (error) {
      if (error?.response?.status === 404) {
        disableNotificationsApi();
      } else if (isTemporaryConnectionIssue(error)) {
        pausePollingTemporarily();
      }
    } finally {
      unreadCountRequestInFlight = false;
    }
  }, [disableNotificationsApi, notificationsApiAvailable, pausePollingTemporarily]);

  const fetchNotifications = useCallback(async () => {
    if (
      !notificationsApiAvailable ||
      notificationsEndpointUnsupported ||
      isPollingPaused()
    ) {
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.get("/notifications?limit=15");
      setNotifications(Array.isArray(data) ? data : []);
      setHasTemporaryConnectionIssue(false);
    } catch (error) {
      if (error?.response?.status === 404) {
        disableNotificationsApi();
      } else if (isTemporaryConnectionIssue(error)) {
        pausePollingTemporarily();
      }
    } finally {
      setLoading(false);
    }
  }, [disableNotificationsApi, notificationsApiAvailable, pausePollingTemporarily]);

  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_read: true } : item,
        ),
      );
      fetchUnreadCount();
      return true;
    } catch (error) {
      if (error?.response?.status === 404) {
        disableNotificationsApi();
      }
      return false;
    }
  };

  const markAllAsRead = async () => {
    try {
      await api.put("/notifications/read-all");
      setNotifications((prev) =>
        prev.map((item) => ({ ...item, is_read: true })),
      );
      setUnreadCount(0);
    } catch (error) {
      if (error?.response?.status === 404) {
        disableNotificationsApi();
      }
    }
  };

  const handleNotificationClick = async (item) => {
    if (!item?.is_read) {
      setNotifications((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, is_read: true } : entry,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await markAsRead(item.id);
    }

    const route = getNotificationRoute(item, isAdmin);
    if (route) {
      navigate(route);
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!notificationsApiAvailable || notificationsEndpointUnsupported) {
      return;
    }

    fetchUnreadCount();
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      fetchUnreadCount();
    }, NOTIFICATION_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUnreadCount, notificationsApiAvailable]);

  useEffect(() => {
    if (!notificationsApiAvailable || notificationsEndpointUnsupported) {
      return;
    }

    const unsubscribe = subscribeToSharedDataUpdates(() => {
      fetchUnreadCount();
      if (open) {
        fetchNotifications();
      }
    });

    return () => unsubscribe();
  }, [fetchNotifications, fetchUnreadCount, notificationsApiAvailable, open]);

  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [fetchNotifications, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative z-[120]">
      <button
        disabled={!notificationsApiAvailable}
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-2 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
        title={
          notificationsApiAvailable
            ? t("notifications.title", "Notifications")
            : t("notifications.unavailable", "Notifications unavailable")
        }
      >
        <Bell size={18} className="text-white" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] min-w-5 h-5 px-1 rounded-full bg-red-500 text-white flex items-center justify-center font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-2 w-[18rem] sm:w-[19rem] max-w-[calc(100vw-1rem)] bg-white text-gray-800 rounded-2xl shadow-2xl border border-slate-200 z-[160] overflow-hidden ${
            isRTL ? "right-0 origin-top-right" : "left-0 origin-top-left"
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="min-w-0">
              <p className="font-semibold text-sm text-slate-800">
                {t("notifications.title", "Notifications")}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {hasTemporaryConnectionIssue
                  ? t("notifications.reconnecting", "Reconnecting...")
                  : unreadCount > 0
                    ? `${unreadCount} ${t("notifications.unread", "unread")}`
                    : t("notifications.allCaughtUp", "All caught up")}
              </p>
            </div>
            {unreadNotifications.length > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 shrink-0"
              >
                <CheckCheck size={14} />
                {t("notifications.markAllRead", "Mark all read")}
              </button>
            )}
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-sm text-gray-500 text-center">
                {t("notifications.loading", "Loading...")}
              </p>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-500">
                <BellOff size={18} className="mx-auto mb-2 text-slate-400" />
                {t("notifications.empty", "No notifications")}
              </div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`w-full px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                    item.is_read ? "bg-white" : "bg-blue-50/60"
                  } ${isRTL ? "text-right" : "text-left"}`}
                >
                  <div className="flex items-start gap-2.5">
                    <CircleDot
                      size={14}
                      className={`mt-0.5 shrink-0 ${
                        item.is_read ? "text-slate-300" : "text-blue-600"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm text-slate-800 truncate">
                          {item.title ||
                            t("notifications.fallbackTitle", "Notification")}
                        </p>
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-medium text-slate-600">
                          {getTypeLabel(item.type)}
                        </span>
                      </div>
                      {item.message ? (
                        <p
                          className="text-xs text-slate-600 mt-1 leading-5"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {item.message}
                        </p>
                      ) : null}
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <p className="text-[11px] text-slate-400">
                          {formatTimestamp(item.created_at, locale)}
                        </p>
                        {getNotificationRoute(item, isAdmin) && (
                          <span className="text-[11px] text-blue-600 font-medium">
                            {t("notifications.openDetails", "Open details")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
