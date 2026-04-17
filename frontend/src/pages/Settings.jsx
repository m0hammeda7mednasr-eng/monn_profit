import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { metaAnalyticsAPI, shopifyAPI } from "../utils/api.js";
import Sidebar from "../components/Sidebar";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle,
  Copy,
  Link as LinkIcon,
  Megaphone,
  Save,
  Sparkles,
  Store,
} from "lucide-react";
import { markSharedDataUpdated } from "../utils/realtime";
import { formatDateTime } from "../utils/helpers";

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
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [metaStatus, setMetaStatus] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [savingMetaConfig, setSavingMetaConfig] = useState(false);
  const [savingOpenRouterConfig, setSavingOpenRouterConfig] = useState(false);
  const [metaConfig, setMetaConfig] = useState({
    access_token: "",
    business_id: "",
    ad_account_ids: "",
    page_id: "",
    pixel_id: "",
  });
  const [openRouterConfig, setOpenRouterConfig] = useState({
    api_key: "",
    model: "",
    site_url: typeof window !== "undefined" ? window.location.origin : "",
    site_name: "Moon Profit",
  });

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
    loadIntegrationStatus();
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

  const loadIntegrationStatus = async () => {
    try {
      setIntegrationsLoading(true);
      const [statusResponse, modelsResponse] = await Promise.allSettled([
        metaAnalyticsAPI.getStatus(),
        metaAnalyticsAPI.getModels(),
      ]);

      const integration =
        statusResponse.status === "fulfilled"
          ? statusResponse.value?.data?.integration || null
          : null;

      setMetaStatus(
        statusResponse.status === "fulfilled" ? statusResponse.value?.data || null : null,
      );
      setMetaConfig({
        access_token: "",
        business_id: integration?.meta?.business_id || "",
        ad_account_ids: (integration?.meta?.ad_account_ids || []).join(", "),
        page_id: integration?.meta?.page_id || "",
        pixel_id: integration?.meta?.pixel_id || "",
      });
      setOpenRouterConfig((current) => ({
        ...current,
        api_key: "",
        model: integration?.openrouter?.model || current.model || "",
        site_url: integration?.openrouter?.site_url || current.site_url,
        site_name: integration?.openrouter?.site_name || current.site_name,
      }));

      if (modelsResponse.status === "fulfilled") {
        const rows = Array.isArray(modelsResponse.value?.data?.data)
          ? modelsResponse.value.data.data
          : [];
        setAvailableModels(rows);
        if (rows.length > 0) {
          setOpenRouterConfig((current) => ({
            ...current,
            model: current.model || rows[0]?.id || "",
          }));
        }
      } else {
        setAvailableModels([]);
      }
    } catch (error) {
      console.error("Failed to load Meta/OpenRouter settings:", error);
    } finally {
      setIntegrationsLoading(false);
    }
  };

  const handleChange = (event) => {
    setShopifyConfig({
      ...shopifyConfig,
      [event.target.name]: event.target.value,
    });
  };

  const handleMetaConfigChange = (key, value) => {
    setMetaConfig((current) => ({ ...current, [key]: value }));
  };

  const handleOpenRouterConfigChange = (key, value) => {
    setOpenRouterConfig((current) => ({ ...current, [key]: value }));
  };

  const handleSaveMetaConfig = async (event) => {
    event.preventDefault();
    setSavingMetaConfig(true);
    setMessage({ type: "", text: "" });

    try {
      await metaAnalyticsAPI.saveMetaConfig({
        access_token: metaConfig.access_token,
        business_id: metaConfig.business_id,
        ad_account_ids: String(metaConfig.ad_account_ids || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        page_id: metaConfig.page_id,
        pixel_id: metaConfig.pixel_id,
      });

      setMessage({
        type: "success",
        text: "Meta Business Suite settings saved successfully.",
      });
      await loadIntegrationStatus();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to save Meta settings.",
      });
    } finally {
      setSavingMetaConfig(false);
    }
  };

  const handleSaveOpenRouterConfig = async (event) => {
    event.preventDefault();
    setSavingOpenRouterConfig(true);
    setMessage({ type: "", text: "" });

    try {
      await metaAnalyticsAPI.saveOpenRouterConfig({
        api_key: openRouterConfig.api_key,
        model: openRouterConfig.model,
        site_url: openRouterConfig.site_url,
        site_name: openRouterConfig.site_name,
      });

      setMessage({
        type: "success",
        text: "OpenRouter settings saved successfully.",
      });
      await loadIntegrationStatus();
    } catch (error) {
      setMessage({
        type: "error",
        text: error.response?.data?.error || "Failed to save OpenRouter settings.",
      });
    } finally {
      setSavingOpenRouterConfig(false);
    }
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
        text: error.response?.data?.error || "Failed to start Shopify connection.",
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
          <p className="text-gray-600">Manage Shopify connection and synchronization</p>
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
              <p className="text-green-800 font-semibold">Connected to {shopifyConfig.shop}</p>
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
              <h2 className="text-2xl font-bold text-gray-800">Shopify Connection</h2>
              <p className="text-gray-600 text-sm">
                Configure app credentials, connect store, and sync products/orders/customers.
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
                  <Copy size={14} className="cursor-pointer hover:text-green-600" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveCredentials} className="space-y-4 pt-4 border-t">
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
              <form onSubmit={handleConnect} className="space-y-4 pt-4 border-t">
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

        <div className="mt-6 grid max-w-6xl gap-6 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="rounded-2xl bg-white p-8 shadow-lg">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Megaphone className="mt-1 text-sky-600" size={28} />
                <div>
                  <h2 className="text-2xl font-bold text-gray-800">
                    Integrations & AI
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Move all Meta Business Suite and OpenRouter configuration here,
                    then use the Meta & Analytics command center for decisions,
                    recommendations, and AI chat.
                  </p>
                </div>
              </div>
              <Link
                to="/meta-analytics"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Open Command Center
                <ArrowRight size={16} />
              </Link>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <StatusCard
                title="Meta Sync"
                value={
                  metaStatus?.integration?.meta?.configured
                    ? metaStatus?.integration?.meta?.connected
                      ? "Connected"
                      : "Configured"
                    : "Not configured"
                }
                subtitle={
                  metaStatus?.integration?.meta?.last_sync_at
                    ? `Last sync ${formatDateTime(metaStatus.integration.meta.last_sync_at, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "Set token and ad accounts to start pulling campaigns"
                }
                tone="sky"
                icon={<Megaphone size={18} />}
              />
              <StatusCard
                title="OpenRouter"
                value={
                  metaStatus?.integration?.openrouter?.configured
                    ? metaStatus?.integration?.openrouter?.connected
                      ? "Ready"
                      : "Configured"
                    : "Not configured"
                }
                subtitle={
                  metaStatus?.integration?.openrouter?.model ||
                  "Choose the model used by AI briefs and chat"
                }
                tone="violet"
                icon={<Bot size={18} />}
              />
              <StatusCard
                title="Command Center"
                value={integrationsLoading ? "Loading..." : "Available"}
                subtitle="Use it for action suggestions, ad checks, and store-wide AI chat."
                tone="emerald"
                icon={<Sparkles size={18} />}
              />
            </div>

            <div className="grid gap-6 2xl:grid-cols-2">
              <form
                onSubmit={handleSaveMetaConfig}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Meta Business Suite
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Save the token and account scope used for campaign sync and
                    recommendations.
                  </p>
                </div>

                <div className="space-y-4">
                  <FieldLabel label="Business ID">
                    <input
                      type="text"
                      value={metaConfig.business_id}
                      onChange={(event) =>
                        handleMetaConfigChange("business_id", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="123456789012345"
                    />
                  </FieldLabel>

                  <FieldLabel label="Page ID">
                    <input
                      type="text"
                      value={metaConfig.page_id}
                      onChange={(event) =>
                        handleMetaConfigChange("page_id", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="Optional page reference"
                    />
                  </FieldLabel>

                  <FieldLabel
                    label="Access Token"
                    hint={`Current token: ${metaStatus?.integration?.meta?.masked_access_token || "not saved"}`}
                  >
                    <input
                      type="password"
                      value={metaConfig.access_token}
                      onChange={(event) =>
                        handleMetaConfigChange("access_token", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="Leave blank to keep current token"
                    />
                  </FieldLabel>

                  <FieldLabel
                    label="Ad Account IDs"
                    hint="Comma-separated. Leave empty to use all visible ad accounts."
                  >
                    <textarea
                      rows={3}
                      value={metaConfig.ad_account_ids}
                      onChange={(event) =>
                        handleMetaConfigChange("ad_account_ids", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="act_1234567890, act_0987654321"
                    />
                  </FieldLabel>

                  <FieldLabel label="Pixel ID">
                    <input
                      type="text"
                      value={metaConfig.pixel_id}
                      onChange={(event) =>
                        handleMetaConfigChange("pixel_id", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="Optional pixel reference"
                    />
                  </FieldLabel>
                </div>

                <button
                  type="submit"
                  disabled={savingMetaConfig}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <Save size={16} />
                  {savingMetaConfig ? "Saving..." : "Save Meta Settings"}
                </button>
              </form>

              <form
                onSubmit={handleSaveOpenRouterConfig}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
              >
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-slate-900">
                    OpenRouter
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    This powers AI briefs, quick suggestions, and the store-wide operator chat.
                  </p>
                </div>

                <div className="space-y-4">
                  <FieldLabel
                    label="API Key"
                    hint={`Current key: ${metaStatus?.integration?.openrouter?.masked_api_key || "not saved"}`}
                  >
                    <input
                      type="password"
                      value={openRouterConfig.api_key}
                      onChange={(event) =>
                        handleOpenRouterConfigChange("api_key", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="Leave blank to keep current key"
                    />
                  </FieldLabel>

                  <FieldLabel label="Model">
                    <select
                      value={openRouterConfig.model}
                      onChange={(event) =>
                        handleOpenRouterConfigChange("model", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                    >
                      {availableModels.length === 0 ? (
                        <option value={openRouterConfig.model || ""}>
                          {openRouterConfig.model || "Save key to load models"}
                        </option>
                      ) : (
                        availableModels.slice(0, 80).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name || model.id}
                          </option>
                        ))
                      )}
                    </select>
                  </FieldLabel>

                  <FieldLabel label="Site URL">
                    <input
                      type="url"
                      value={openRouterConfig.site_url}
                      onChange={(event) =>
                        handleOpenRouterConfigChange("site_url", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="https://moon-profit.example"
                    />
                  </FieldLabel>

                  <FieldLabel label="Site Name">
                    <input
                      type="text"
                      value={openRouterConfig.site_name}
                      onChange={(event) =>
                        handleOpenRouterConfigChange("site_name", event.target.value)
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      placeholder="Moon Profit"
                    />
                  </FieldLabel>
                </div>

                <button
                  type="submit"
                  disabled={savingOpenRouterConfig}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  <Save size={16} />
                  {savingOpenRouterConfig ? "Saving..." : "Save OpenRouter Settings"}
                </button>
              </form>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 p-8 text-white shadow-lg">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-200">
              Suggested Workflow
            </p>
            <h2 className="mt-3 text-2xl font-bold">
              Keep setup in Settings. Do decisions in Meta & Analytics.
            </h2>
            <div className="mt-6 space-y-4 text-sm leading-6 text-slate-200">
              <div>
                <p className="font-semibold text-white">1. Connect the data sources</p>
                <p>Save Shopify, Meta, and OpenRouter once. That keeps credentials out of the reporting screen.</p>
              </div>
              <div>
                <p className="font-semibold text-white">2. Sync Meta, then inspect the store signals</p>
                <p>Open the command center to see spend, top campaigns, low stock pressure, and sales signals together.</p>
              </div>
              <div>
                <p className="font-semibold text-white">3. Ask the AI what to stop, scale, restock, or fix</p>
                <p>The assistant now answers against store context, not just ad metrics, so its advice is operational instead of generic.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FieldLabel({ label, hint = "", children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </label>
  );
}

function StatusCard({ title, value, subtitle, icon, tone = "sky" }) {
  const toneClasses = {
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };

  return (
    <div
      className={`rounded-2xl border p-4 ${toneClasses[tone] || toneClasses.sky}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <div className="rounded-xl bg-white/80 p-2 shadow-sm">{icon}</div>
      </div>
      <p className="text-lg font-bold">{value}</p>
      <p className="mt-2 text-xs opacity-80">{subtitle}</p>
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
