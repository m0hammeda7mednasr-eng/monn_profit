import { getEventsStreamUrl } from "./apiConfig";
import { shouldAutoRefreshView } from "./refreshPolicy";

const SHARED_DATA_EVENT_KEY = "shared_data_updated_at";
const SHARED_DATA_EVENT_NAME = "moon_profit_shared_data_updated";
const SHARED_DATA_CHANNEL_NAME = "moon_profit_shared_data_channel";
const RECONNECT_DELAY_MS = 4000;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EVENTS_STREAM_URL = getEventsStreamUrl();

let subscriberCount = 0;
let eventSource = null;
let reconnectTimer = null;
let broadcastChannel = null;

const hasWindow = () => typeof window !== "undefined";

const safeJsonParse = (value) => {
  if (!value || typeof value !== "string") {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const normalizeStoreId = (value) => {
  const normalized = String(value || "").trim();
  return UUID_REGEX.test(normalized) ? normalized : null;
};

const emitLocalSharedUpdate = (detail = {}) => {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SHARED_DATA_EVENT_NAME, {
      detail: {
        at: new Date().toISOString(),
        type: "data.updated",
        ...detail,
      },
    }),
  );
};

const ensureBroadcastChannel = () => {
  if (!hasWindow() || typeof window.BroadcastChannel === "undefined") {
    return null;
  }

  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(SHARED_DATA_CHANNEL_NAME);
  }

  return broadcastChannel;
};

const clearReconnectTimer = () => {
  if (!reconnectTimer) {
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = null;
};

const closeServerStream = () => {
  if (!eventSource) {
    return;
  }

  try {
    eventSource.close();
  } catch {
    // ignore
  }
  eventSource = null;
};

const scheduleReconnect = () => {
  if (!hasWindow() || reconnectTimer || subscriberCount <= 0) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openServerStream();
  }, RECONNECT_DELAY_MS);
};

const handleServerMessage = (event) => {
  const payload = safeJsonParse(event?.data);
  emitLocalSharedUpdate({
    ...payload,
    source: payload.source || "server",
  });
};

const openServerStream = () => {
  if (
    !hasWindow() ||
    subscriberCount <= 0 ||
    eventSource ||
    typeof window.EventSource === "undefined"
  ) {
    return;
  }

  const token = localStorage.getItem("token");
  if (!token) {
    return;
  }

  const params = new URLSearchParams();
  params.set("token", token);

  const storeId = normalizeStoreId(localStorage.getItem("currentStoreId"));
  if (storeId) {
    params.set("store_id", storeId);
  }

  eventSource = new EventSource(`${EVENTS_STREAM_URL}?${params.toString()}`);
  eventSource.addEventListener("data_updated", handleServerMessage);
  eventSource.onmessage = handleServerMessage;
  eventSource.onerror = () => {
    closeServerStream();
    scheduleReconnect();
  };
};

const releaseStreamIfIdle = () => {
  if (subscriberCount > 0) {
    return;
  }

  clearReconnectTimer();
  closeServerStream();
};

export const markSharedDataUpdated = (detail = {}) => {
  if (!hasWindow()) {
    return;
  }

  try {
    localStorage.setItem(SHARED_DATA_EVENT_KEY, String(Date.now()));
  } catch (error) {
    console.error("Failed to mark shared data update:", error);
  }

  emitLocalSharedUpdate({
    source: "local",
    ...detail,
  });

  const channel = ensureBroadcastChannel();
  try {
    channel?.postMessage({
      source: "local",
      at: new Date().toISOString(),
      type: "data.updated",
      ...detail,
    });
  } catch (error) {
    console.error("Failed to broadcast shared data update:", error);
  }
};

export const subscribeToSharedDataUpdates = (onUpdate) => {
  if (
    !hasWindow() ||
    typeof onUpdate !== "function" ||
    !shouldAutoRefreshView()
  ) {
    return () => {};
  }

  subscriberCount += 1;
  openServerStream();

  const onStorage = (event) => {
    if (event.key !== SHARED_DATA_EVENT_KEY || !event.newValue) {
      return;
    }

    onUpdate({
      source: "storage",
      at: new Date().toISOString(),
      type: "data.updated",
    });
  };

  const onWindowEvent = (event) => {
    onUpdate(event.detail || { source: "local", type: "data.updated" });
  };

  const onFocus = () => {
    openServerStream();
  };

  const channel = ensureBroadcastChannel();
  const onBroadcastMessage = (event) => {
    if (!event?.data) {
      return;
    }
    onUpdate(event.data);
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(SHARED_DATA_EVENT_NAME, onWindowEvent);
  window.addEventListener("focus", onFocus);
  channel?.addEventListener("message", onBroadcastMessage);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SHARED_DATA_EVENT_NAME, onWindowEvent);
    window.removeEventListener("focus", onFocus);
    channel?.removeEventListener("message", onBroadcastMessage);

    subscriberCount = Math.max(0, subscriberCount - 1);
    releaseStreamIfIdle();
  };
};
