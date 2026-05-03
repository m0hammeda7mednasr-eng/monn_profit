import { useEffect, useState } from "react";
import api, { shopifyAPI } from "../utils/api.js";
import Sidebar from "../components/Sidebar";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  Link as LinkIcon,
  Save,
  Store,
  Truck,
} from "lucide-react";
import { markSharedDataUpdated } from "../utils/realtime";

const normalizeShopDomain = (value) => {
  let raw = String(value || "")
    .trim()
    .toLowerCase();

  if (!raw) return "";

  raw = raw.replace(/^https?:\/\//, "").replace(/^www\./, "");

  if (raw.startsWith("admin.shopify.com/store/")) {
    const parts = raw.split("/");
    const storeSlug = String(parts[2] || "")
      .trim()
      .toLowerCase();
    return storeSlug ? `${storeSlug}.myshopify.com` : "";
  }

  raw = raw.split(/[/?#]/)[0];
  if (raw.endsWith(".myshopify.com")) {
    return raw;
  }

  const slug = raw.replace(/[^a-z0-9-]/g, "");
  return slug ? `${slug}.myshopify.com` : "";
};

export default function Settings() {
  const [shopifyConfig, setShopifyConfig] = useState({
    shop: "",
    apiKey: "",
    apiSecret: "",
    redirectUri: "Loading...",
    webhookAddress: "",
  });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("connected") === "true") {
      const connectedShop = String(query.get("shop") || "").trim();
      const connectedStoreId = String(query.get("store_id") || "").trim();
      const syncStatus = String(query.get("sync_status") || "").trim();
      const syncCountsRaw = String(query.get("sync_counts") || "").trim();

      if (connectedStoreId) {
        localStorage.setItem("currentStoreId", connectedStoreId);
      }

      let syncCounts = null;
      if (syncCountsRaw) {
        try {
          syncCounts = JSON.parse(syncCountsRaw);
        } catch {
          syncCounts = null;
        }
      }

      const syncSuffix =
        syncStatus === "completed" && syncCounts
          ? ` Initial sync completed: ${syncCounts.products} products, ${syncCounts.orders} orders, ${syncCounts.customers} customers.`
          : syncStatus === "queued"
            ? " Background sync started and will continue automatically in batches."
            : syncStatus === "failed"
              ? " Connection saved, but initial sync failed. Run Sync Shopify."
              : "";

      setMessage({
        type: syncStatus === "failed" ? "info" : "success",
        text: `Shopify store connected successfully${connectedShop ? `: ${connectedShop}` : ""}.${syncSuffix}`,
      });
      markSharedDataUpdated();
      window.history.replaceState({}, document.title, "/settings");
    } else if (query.get("error")) {
      const rawErrorMessage = String(query.get("error_message") || "").trim();
      setMessage({
        type: "error",
        text:
          rawErrorMessage ||
          "Shopify connection failed. Check credentials and try again.",
      });
      window.history.replaceState({}, document.title, "/settings");
    }

    loadShopifyStatus();
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const { data } = await api.get("/shopify/get-credentials");
      if (data.hasCredentials) {
        setShopifyConfig((prev) => ({ ...prev, apiKey: data.apiKey || "" }));
      }
    } catch (error) {
      console.error("Failed to load credentials:", error);
    }
  };

  const loadShopifyStatus = async () => {
    try {
      const { data } = await api.get("/shopify/status");
      setConnected(Boolean(data.connected));
      if (data.connected && data.store_id) {
        localStorage.setItem("currentStoreId", data.store_id);
      } else if (!data.connected) {
        localStorage.removeItem("currentStoreId");
      }
      setShopifyConfig((prev) => ({
        ...prev,
        shop: data.shop || prev.shop,
        redirectUri: data.redirectUri || prev.redirectUri,
        webhookAddress: data.webhookAddress || prev.webhookAddress,
      }));
    } catch (error) {
      console.error("Connection check failed:", error);
      setMessage({
        type: "error",
        text: "Failed to load Shopify connection status.",
      });
    }
  };

  const handleChange = (event) => {
    setShopifyConfig({
      ...shopifyConfig,
      [event.target.name]: event.target.value,
    });
  };

  const handleSaveCredentials = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      if (!shopifyConfig.apiKey || !shopifyConfig.apiSecret) {
        throw new Error("Client ID and Client Secret are required");
      }

      await api.post("/shopify/save-credentials", {
        apiKey: shopifyConfig.apiKey,
        apiSecret: shopifyConfig.apiSecret,
      });

      setMessage({
        type: "success",
        text: "Credentials saved successfully. You can connect your store now.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage({ type: "", text: "" });

    try {
      if (!shopifyConfig.shop) {
        throw new Error("Store domain is required");
      }

      const shop = normalizeShopDomain(shopifyConfig.shop);
      if (!shop) {
        throw new Error("Invalid store domain");
      }

      const { data } = await api.post("/shopify/auth-url", { shop });
      if (data.authUrl) {
        setMessage({ type: "info", text: "Redirecting to Shopify..." });
        window.location.href = data.authUrl;
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error.response?.data?.error || "Failed to start Shopify connection.",
      });
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setLoading(true);
    setMessage({ type: "info", text: "Syncing Shopify data..." });

    try {
      const { data } = await shopifyAPI.sync();
      markSharedDataUpdated();
      await loadShopifyStatus();
      setMessage({
        type: "success",
        text:
          data?.mode === "background"
            ? "Background sync started. Shopify data will save automatically in batches."
            : `Sync completed: ${data.counts.products} products, ${data.counts.orders} orders, ${data.counts.customers} customers.`,
      });
    } catch (error) {
      const backendCode = error.response?.data?.code;
      const backendMessage = String(error.response?.data?.error || "");
      const notConnected =
        backendCode === "SHOPIFY_NOT_CONNECTED" ||
        backendMessage.toLowerCase().includes("not connected");

      if (notConnected) {
        setMessage({
          type: "error",
          text: "This account/store is not connected to Shopify yet.",
        });
      } else {
        setMessage({
          type: "error",
          text: backendMessage || "Sync failed.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = window.confirm(
      "Disconnect Shopify from this store? Webhooks and token access will be removed.",
    );
    if (!confirmed) return;

    setDisconnecting(true);
    setMessage({ type: "", text: "" });

    try {
      const response = await api.post("/shopify/disconnect", {});
      markSharedDataUpdated();
      localStorage.removeItem("currentStoreId");
      setConnected(false);
      setShopifyConfig((prev) => ({
        ...prev,
        shop: "",
      }));
      setMessage({
        type: "success",
        text: response?.data?.message || "Shopify disconnected successfully.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to disconnect Shopify.",
      });
    } finally {
      setDisconnecting(false);
      await loadShopifyStatus();
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shopifyConfig.redirectUri).then(() => {
      setMessage({ type: "info", text: "Redirect URI copied." });
      setTimeout(() => setMessage({ type: "", text: "" }), 2000);
    });
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Settings</h1>
          <p className="text-gray-600">
            Manage Shopify connection and synchronization
          </p>
        </div>

        {message.text && (
          <div
            className={`border rounded-lg p-4 mb-6 flex items-center gap-3 transition-opacity ${
              message.type === "error"
                ? "bg-red-50 border-red-200"
                : message.type === "info"
                  ? "bg-blue-50 border-blue-200"
                  : "bg-green-50 border-green-200"
            }`}
          >
            {message.type === "success" ? (
              <CheckCircle className="text-green-600" size={20} />
            ) : (
              <AlertCircle
                className={
                  message.type === "error"
                    ? "text-red-600"
                    : message.type === "info"
                      ? "text-blue-600"
                      : "text-green-600"
                }
                size={20}
              />
            )}
            <p
              className={`font-medium ${
                message.type === "error"
                  ? "text-red-800"
                  : message.type === "info"
                    ? "text-blue-800"
                    : "text-green-800"
              }`}
            >
              {message.text}
            </p>
          </div>
        )}

        {connected && (
          <div className="bg-green-50 border-l-4 border-green-500 rounded-r-lg p-4 mb-6 flex items-center gap-3">
            <CheckCircle className="text-green-600" size={24} />
            <div>
              <p className="text-green-800 font-semibold">
                Connected to {shopifyConfig.shop}
              </p>
              <p className="text-green-700 text-sm">
                Store is ready for data synchronization.
              </p>
              {shopifyConfig.webhookAddress && (
                <p className="text-green-700 text-xs mt-1">
                  Webhook endpoint: {shopifyConfig.webhookAddress}
                </p>
              )}
            </div>
          </div>
        )}

        {connected && (
          <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={handleSync}
              disabled={loading || disconnecting}
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-6 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <RefreshIcon spinning={loading} />
              {loading ? "Syncing..." : "Sync Data"}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting || loading}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-6 rounded-lg disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect Shopify"}
            </button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow-lg p-8 max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <Store className="text-green-600" size={32} />
            <div>
              <h2 className="text-2xl font-bold text-gray-800">
                Shopify Connection
              </h2>
              <p className="text-gray-600 text-sm">
                Configure app credentials, connect store, and sync
                products/orders/customers.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                OAuth Redirect URI (add in Shopify app setup)
              </h3>
              <div className="flex items-center gap-2 bg-gray-200 p-2 rounded">
                <code className="text-xs text-gray-900 break-all flex-1">
                  {shopifyConfig.redirectUri}
                </code>
                <button onClick={copyToClipboard} title="Copy URI">
                  <Copy
                    size={14}
                    className="cursor-pointer hover:text-green-600"
                  />
                </button>
              </div>
            </div>

            <form
              onSubmit={handleSaveCredentials}
              className="space-y-4 pt-4 border-t"
            >
              <h3 className="font-semibold text-lg">Credentials</h3>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client ID (API Key)
                </label>
                <input
                  type="text"
                  name="apiKey"
                  value={shopifyConfig.apiKey}
                  onChange={handleChange}
                  placeholder="Shopify app Client ID"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  disabled={connected}
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Client Secret (API Secret)
                </label>
                <input
                  type="password"
                  name="apiSecret"
                  onChange={handleChange}
                  autoComplete="current-password"
                  placeholder="Shopify app Client Secret"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  disabled={connected}
                />
              </div>

              {!connected && (
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save size={18} />
                  {saving ? "Saving..." : "Save Credentials"}
                </button>
              )}
            </form>

            {!connected && (
              <form
                onSubmit={handleConnect}
                className="space-y-4 pt-4 border-t"
              >
                <h3 className="font-semibold text-lg">Connect Store</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Store Domain
                  </label>
                  <input
                    type="text"
                    name="shop"
                    value={shopifyConfig.shop}
                    onChange={handleChange}
                    placeholder="your-store.myshopify.com"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    required
                    disabled={connected}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !shopifyConfig.apiKey}
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <LinkIcon size={20} />
                  {loading ? "Connecting..." : "Connect Store"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Bosta Configuration */}
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-3xl mt-8">
          <BostaConfiguration />
        </div>
      </main>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : ""}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function BostaConfiguration() {
  const [bostaConfig, setBostaConfig] = useState({
    apiKey: "",
    businessLocationId: "",
    apiBaseUrl: "https://app.bosta.co/api/v2",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [hasConfig, setHasConfig] = useState(false);

  useEffect(() => {
    loadBostaConfig();
  }, []);

  const loadBostaConfig = async () => {
    try {
      const { data } = await api.get("/api/bosta/config");
      if (data.hasConfig) {
        setBostaConfig({
          apiKey: data.apiKey || "",
          businessLocationId: data.businessLocationId || "",
          apiBaseUrl: data.apiBaseUrl || "https://app.bosta.co/api/v2",
        });
        setHasConfig(true);
      }
    } catch (error) {
      console.error("Failed to load Bosta config:", error);
    }
  };

  const handleChange = (e) => {
    setBostaConfig({
      ...bostaConfig,
      [e.target.name]: e.target.value,
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage({ type: "", text: "" });

    try {
      if (!bostaConfig.apiKey) {
        throw new Error("Bosta API Key is required");
      }

      await api.post("/api/bosta/config", {
        apiKey: bostaConfig.apiKey,
        businessLocationId: bostaConfig.businessLocationId,
        apiBaseUrl: bostaConfig.apiBaseUrl,
      });

      setHasConfig(true);
      setMessage({
        type: "success",
        text: "Bosta configuration saved successfully!",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage({ type: "", text: "" });

    try {
      const { data } = await api.get("/api/bosta/cities");
      setMessage({
        type: "success",
        text: `Bosta API connection successful! Found ${data.length || 0} cities.`,
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to connect to Bosta API",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Truck className="text-orange-600" size={32} />
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bosta Shipping</h2>
          <p className="text-gray-600 text-sm">
            Configure Bosta API for shipping integration
          </p>
        </div>
      </div>

      {message.text && (
        <div
          className={`border rounded-lg p-4 mb-6 flex items-center gap-3 ${
            message.type === "error"
              ? "bg-red-50 border-red-200"
              : "bg-green-50 border-green-200"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle className="text-green-600" size={20} />
          ) : (
            <AlertCircle className="text-red-600" size={20} />
          )}
          <p
            className={`font-medium ${
              message.type === "error" ? "text-red-800" : "text-green-800"
            }`}
          >
            {message.text}
          </p>
        </div>
      )}

      {hasConfig && (
        <div className="bg-green-50 border-l-4 border-green-500 rounded-r-lg p-4 mb-6 flex items-center gap-3">
          <CheckCircle className="text-green-600" size={24} />
          <div>
            <p className="text-green-800 font-semibold">Bosta API Configured</p>
            <p className="text-green-700 text-sm">
              Ready to create shipments and track deliveries
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Bosta API Key *
          </label>
          <input
            type="password"
            name="apiKey"
            value={bostaConfig.apiKey}
            onChange={handleChange}
            placeholder="Enter your Bosta API Key"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
            required
            autoComplete="off"
          />
          <p className="text-xs text-gray-500 mt-1">
            Get your API key from Bosta dashboard
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Business Location ID (Optional)
          </label>
          <input
            type="text"
            name="businessLocationId"
            value={bostaConfig.businessLocationId}
            onChange={handleChange}
            placeholder="Default pickup location ID"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg"
          />
          <p className="text-xs text-gray-500 mt-1">
            Your default pickup location for shipments
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            API Base URL
          </label>
          <input
            type="text"
            name="apiBaseUrl"
            value={bostaConfig.apiBaseUrl}
            onChange={handleChange}
            placeholder="https://app.bosta.co/api/v2"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save size={18} />
            {saving ? "Saving..." : "Save Configuration"}
          </button>

          {hasConfig && (
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
