const HEARTBEAT_INTERVAL_MS = 25000;

const clients = new Map();
let heartbeatTimer = null;
let nextClientId = 1;

const normalizeStringList = (values) => {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
};

const writeEvent = (res, eventName, payload) => {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const stopHeartbeatIfIdle = () => {
  if (clients.size > 0 || !heartbeatTimer) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

const ensureHeartbeat = () => {
  if (heartbeatTimer || clients.size === 0) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    for (const [clientId, client] of clients.entries()) {
      if (client.res.writable) {
        try {
          // Use a simple comment as a more robust keep-alive signal
          client.res.write(`:ping\n\n`);
        } catch (e) {
          console.error(`Heartbeat: Error writing to client ${clientId}, removing.`, e);
          clients.delete(clientId);
        }
      } else {
        console.log(`Heartbeat: Client ${clientId} is not writable, removing.`);
        clients.delete(clientId);
      }
    }

    stopHeartbeatIfIdle();
  }, HEARTBEAT_INTERVAL_MS);
};

const matchesStoreScope = (client, storeIds) => {
  if (storeIds.length === 0) {
    return true;
  }

  if (!client.storeId) {
    return true;
  }

  return storeIds.includes(client.storeId);
};

export const registerRealtimeClient = ({ res, userId, storeId = null }) => {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) {
    return () => {};
  }

  const clientId = `client_${nextClientId}`;
  nextClientId += 1;

  clients.set(clientId, {
    res,
    userId: normalizedUserId,
    storeId: String(storeId || "").trim() || null,
  });
  ensureHeartbeat();

  return () => {
    clients.delete(clientId);
    stopHeartbeatIfIdle();
  };
};

export const emitRealtimeEvent = ({
  eventName = "data_updated",
  type = "data.updated",
  source = "unknown",
  userIds = [],
  storeIds = [],
  payload = {},
  broadcast = false,
} = {}) => {
  const normalizedUserIds = normalizeStringList(userIds);
  const normalizedStoreIds = normalizeStringList(storeIds);

  if (!broadcast && normalizedUserIds.length === 0) {
    return 0;
  }

  const eventPayload = {
    type,
    source,
    at: new Date().toISOString(),
    ...payload,
  };

  let sentCount = 0;
  for (const [clientId, client] of clients.entries()) {
    const userMatches =
      broadcast || normalizedUserIds.includes(String(client.userId || ""));
    if (!userMatches) {
      continue;
    }

    if (!matchesStoreScope(client, normalizedStoreIds)) {
      continue;
    }

    if (client.res.writable) {
      try {
        writeEvent(client.res, eventName, eventPayload);
        sentCount += 1;
      } catch (e) {
        console.error(`Event Emit: Error writing to client ${clientId}, removing.`, e);
        clients.delete(clientId);
      }
    } else {
      console.log(`Event Emit: Client ${clientId} is not writable, removing.`);
      clients.delete(clientId);
    }
  }

  stopHeartbeatIfIdle();
  return sentCount;
};
