import React, {
  createContext,
  useCallback,
  useEffect,
  useState,
  useContext,
} from "react";

const StoreContext = createContext(null);
const STORE_ID_UPDATED_EVENT = "moon-profit:store-id-updated";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeStoreId = (value) => {
  const normalized = String(value || "").trim();
  return UUID_REGEX.test(normalized) ? normalized : null;
};

const readCurrentStoreId = () =>
  typeof window !== "undefined"
    ? normalizeStoreId(window.localStorage.getItem("currentStoreId"))
    : null;

export const StoreProvider = ({ children }) => {
  const [currentStoreId, setCurrentStoreId] = useState(readCurrentStoreId);

  const syncStoreIdFromStorage = useCallback(() => {
    const nextStoreId = readCurrentStoreId();
    setCurrentStoreId((current) => (current === nextStoreId ? current : nextStoreId));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncStoreIdFromStorage();
      }
    };

    syncStoreIdFromStorage();
    window.addEventListener("storage", syncStoreIdFromStorage);
    window.addEventListener(STORE_ID_UPDATED_EVENT, syncStoreIdFromStorage);
    window.addEventListener("focus", syncStoreIdFromStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("storage", syncStoreIdFromStorage);
      window.removeEventListener(STORE_ID_UPDATED_EVENT, syncStoreIdFromStorage);
      window.removeEventListener("focus", syncStoreIdFromStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncStoreIdFromStorage]);

  const setStoreId = (storeId) => {
    const normalizedStoreId = normalizeStoreId(storeId);
    setCurrentStoreId(normalizedStoreId);

    if (normalizedStoreId) {
      localStorage.setItem("currentStoreId", normalizedStoreId);
    } else {
      localStorage.removeItem("currentStoreId");
    }

    window.dispatchEvent(new Event(STORE_ID_UPDATED_EVENT));
  };

  const clearStoreId = () => {
    setCurrentStoreId(null);
    localStorage.removeItem("currentStoreId");
    window.dispatchEvent(new Event(STORE_ID_UPDATED_EVENT));
  };

  return (
    <StoreContext.Provider value={{ currentStoreId, setStoreId, clearStoreId }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  return useContext(StoreContext);
};
