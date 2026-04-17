import { supabase } from "../supabaseClient.js";
import { ShopifyService } from "./shopifyService.js";
import { emitRealtimeEvent } from "./realtimeEventService.js";

const BATCH_SIZE = Math.max(
  25,
  parseInt(process.env.SHOPIFY_BACKGROUND_SYNC_BATCH_SIZE, 10) || 100,
);
const MAX_BATCHES_PER_STATE_PER_CYCLE = Math.max(
  1,
  parseInt(process.env.SHOPIFY_BACKGROUND_SYNC_MAX_BATCHES_PER_CYCLE, 10) || 5,
);
const TICK_INTERVAL_MS = Math.max(
  10 * 1000,
  parseInt(process.env.SHOPIFY_BACKGROUND_SYNC_INTERVAL_MS, 10) || 30 * 1000,
);
const FOLLOW_UP_DELAY_MS = Math.max(
  1000,
  parseInt(process.env.SHOPIFY_BACKGROUND_SYNC_FOLLOW_UP_DELAY_MS, 10) || 2000,
);
const RECENT_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const ENTITY_ORDER = ["orders", "products", "customers"];

const syncStates = new Map();
let syncTimer = null;
let cycleInFlight = false;
let followUpTimer = null;

const buildSyncKey = (token) =>
  `${String(token?.user_id || "").trim()}::${String(token?.store_id || "global").trim()}::${String(token?.shop || "").trim()}`;

const getEntityState = (state, entityName) => {
  if (!state.entities[entityName]) {
    state.entities[entityName] = {
      nextPageUrl: null,
      completedInitialSync: false,
      lastSyncedAt: null,
      requested: true,
    };
  }

  return state.entities[entityName];
};

const ensureStateForToken = (token) => {
  const key = buildSyncKey(token);
  if (!syncStates.has(key)) {
    syncStates.set(key, {
      key,
      token: {
        user_id: token.user_id,
        store_id: token.store_id || null,
        shop: token.shop,
        access_token: token.access_token,
      },
      inFlight: false,
      entities: {
        orders: {
          nextPageUrl: null,
          completedInitialSync: false,
          lastSyncedAt: null,
          requested: true,
        },
        products: {
          nextPageUrl: null,
          completedInitialSync: false,
          lastSyncedAt: null,
          requested: true,
        },
        customers: {
          nextPageUrl: null,
          completedInitialSync: false,
          lastSyncedAt: null,
          requested: true,
        },
      },
    });
  }

  const state = syncStates.get(key);
  state.token = {
    user_id: token.user_id,
    store_id: token.store_id || null,
    shop: token.shop,
    access_token: token.access_token,
  };
  return state;
};

const getLatestSyncTimestamp = (result) =>
  String(
    result?.latestRow?.updated_at ||
      result?.latestRow?.created_at ||
      new Date().toISOString(),
  ).trim();

const buildUpdatedAtMin = (entityState) => {
  const lastSyncedAt = Date.parse(entityState?.lastSyncedAt || "");
  if (!Number.isFinite(lastSyncedAt)) {
    return null;
  }

  return new Date(lastSyncedAt - RECENT_LOOKBACK_MS).toISOString();
};

const queueEntities = (token, entityNames = ENTITY_ORDER) => {
  const state = ensureStateForToken(token);
  entityNames.forEach((entityName) => {
    getEntityState(state, entityName).requested = true;
  });
  return state;
};

const pickNextEntity = (state) => {
  for (const entityName of ENTITY_ORDER) {
    const entityState = getEntityState(state, entityName);
    if (entityState.nextPageUrl) {
      return entityName;
    }
  }

  for (const entityName of ENTITY_ORDER) {
    const entityState = getEntityState(state, entityName);
    if (entityState.requested && !entityState.completedInitialSync) {
      return entityName;
    }
  }

  const ordersState = getEntityState(state, "orders");
  if (ordersState.requested) {
    return "orders";
  }

  return null;
};

const hasPendingWork = (state) =>
  ENTITY_ORDER.some((entityName) => {
    const entityState = getEntityState(state, entityName);
    return entityState.nextPageUrl || entityState.requested;
  });

const runEntitySync = async (state, entityName) => {
  const token = state.token;
  const entityState = getEntityState(state, entityName);
  const sharedOptions = {
    batchSize: BATCH_SIZE,
    pageUrl: entityState.nextPageUrl || null,
  };

  if (!entityState.nextPageUrl && entityState.completedInitialSync) {
    sharedOptions.updatedAtMin = buildUpdatedAtMin(entityState);
  }

  if (entityName === "orders") {
    return await ShopifyService.syncOrdersBatch(
      token.user_id,
      token.shop,
      token.access_token,
      token.store_id,
      sharedOptions,
    );
  }

  if (entityName === "products") {
    return await ShopifyService.syncProductsBatch(
      token.user_id,
      token.shop,
      token.access_token,
      token.store_id,
      sharedOptions,
    );
  }

  return await ShopifyService.syncCustomersBatch(
    token.user_id,
    token.shop,
    token.access_token,
    token.store_id,
    sharedOptions,
  );
};

const emitSyncUpdate = (state, entityName, result) => {
  if (!result || result.batchCount <= 0 || result.nextPageUrl) {
    return;
  }

  emitRealtimeEvent({
    type: "shopify.sync.batch_completed",
    source: `shopify_background_${entityName}`,
    userIds: [state.token.user_id],
    storeIds: state.token.store_id ? [state.token.store_id] : [],
    payload: {
      entity: entityName,
      batch_count: result.batchCount,
      persisted_count: result.persistedCount,
      has_more: Boolean(result.nextPageUrl),
    },
  });
};

const clearFollowUpTimer = () => {
  if (!followUpTimer) {
    return;
  }

  clearTimeout(followUpTimer);
  followUpTimer = null;
};

const scheduleFollowUpCycle = () => {
  if (followUpTimer) {
    return;
  }

  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    void runBackgroundShopifySyncCycle();
  }, FOLLOW_UP_DELAY_MS);
};

const runStateSync = async (state) => {
  if (state.inFlight) {
    return;
  }

  state.inFlight = true;
  let currentEntityName = null;

  try {
    for (
      let batchIndex = 0;
      batchIndex < MAX_BATCHES_PER_STATE_PER_CYCLE;
      batchIndex += 1
    ) {
      currentEntityName = pickNextEntity(state);
      if (!currentEntityName) {
        break;
      }

      const entityState = getEntityState(state, currentEntityName);
      const result = await runEntitySync(state, currentEntityName);
      entityState.nextPageUrl = result.nextPageUrl || null;
      entityState.lastSyncedAt = getLatestSyncTimestamp(result);

      if (!result.nextPageUrl) {
        entityState.completedInitialSync = true;
        if (currentEntityName !== "orders") {
          entityState.requested = false;
        }
      }

      emitSyncUpdate(state, currentEntityName, result);

      if (!result.nextPageUrl && currentEntityName === "orders") {
        break;
      }
    }
  } catch (error) {
    console.error(
      `Background Shopify sync failed for ${state.key} (${currentEntityName || "unknown"}):`,
      error.message,
    );
  } finally {
    state.inFlight = false;
  }
};

const loadActiveTokens = async () => {
  const { data, error } = await supabase
    .from("shopify_tokens")
    .select("user_id, store_id, shop, access_token, updated_at")
    .not("access_token", "is", null)
    .not("shop", "is", null)
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
};

export const queueShopifyBackgroundSync = (
  token,
  entityNames = ENTITY_ORDER,
) => {
  const state = queueEntities(token, entityNames);
  setTimeout(() => {
    void runBackgroundShopifySyncCycle();
  }, 0);
  return state;
};

export const runBackgroundShopifySyncCycle = async () => {
  if (cycleInFlight) {
    return;
  }

  cycleInFlight = true;
  clearFollowUpTimer();

  try {
    const tokens = await loadActiveTokens();
    const activeKeys = new Set();

    for (const token of tokens) {
      const state = ensureStateForToken(token);
      activeKeys.add(state.key);
      await runStateSync(state);
    }

    for (const key of Array.from(syncStates.keys())) {
      if (!activeKeys.has(key)) {
        syncStates.delete(key);
      }
    }
  } catch (error) {
    console.error("Background Shopify sync cycle failed:", error.message);
  } finally {
    cycleInFlight = false;
    if (Array.from(syncStates.values()).some((state) => hasPendingWork(state))) {
      scheduleFollowUpCycle();
    }
  }
};

export const startShopifyBackgroundSync = () => {
  if (syncTimer) {
    return;
  }

  syncTimer = setInterval(() => {
    void runBackgroundShopifySyncCycle();
  }, TICK_INTERVAL_MS);

  setTimeout(() => {
    void runBackgroundShopifySyncCycle();
  }, 15000);
};
