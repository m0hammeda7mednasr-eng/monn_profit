import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import OrderComments from "../components/OrderComments";
import {
  ArrowLeft,
  Package,
  User,
  MapPin,
  CreditCard,
  Truck,
  Clock,
  CheckCircle,
  AlertCircle,
  Copy,
  TrendingUp,
} from "lucide-react";
import api, { shopifyAPI } from "../utils/api";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { markSharedDataUpdated } from "../utils/realtime";
import {
  DEFAULT_SHIPPING_ISSUE_REASON,
  getShippingIssueBadgeClassName,
  getShippingIssueReasonLabel,
  getShippingIssueReasonOptions,
  isShippingIssueActive,
  normalizeShippingIssueReason,
} from "../utils/shippingIssues";

const PAYMENT_METHOD_LABELS = {
  shopify: "Shopify",
  instapay: "InstaPay",
  wallet: "Wallet",
  none: "None",
};
const FULFILLMENT_STATUS_LABELS = {
  fulfilled: "Fulfilled",
  partial: "Partially Fulfilled",
  unfulfilled: "Unfulfilled",
  restocked: "Restocked",
  scheduled: "Scheduled",
  on_hold: "On Hold",
  in_progress: "In Progress",
  open: "Open",
};

const parseOrderData = (orderValue) => {
  const rawData = orderValue?.data;
  if (typeof rawData === "string") {
    try {
      return JSON.parse(rawData);
    } catch {
      return {};
    }
  }

  return rawData && typeof rawData === "object" ? rawData : {};
};

const normalizeFulfillmentStatus = (value) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim();

  if (!normalized || normalized === "null") {
    return "unfulfilled";
  }

  return normalized;
};

const getFulfillmentStatusLabel = (status) =>
  FULFILLMENT_STATUS_LABELS[normalizeFulfillmentStatus(status)] ||
  normalizeFulfillmentStatus(status) ||
  "Unfulfilled";

const getLineItemId = (item) => String(item?.id || item?.line_item_id || "").trim();

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const toAmount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value) => String(value || "").trim();

const createOrderContactForm = (orderValue) => ({
  customer_phone: normalizeText(
    orderValue?.customer_phone || orderValue?.shipping_address?.phone,
  ),
  shipping_address: {
    address1: normalizeText(orderValue?.shipping_address?.address1),
    address2: normalizeText(orderValue?.shipping_address?.address2),
    city: normalizeText(orderValue?.shipping_address?.city),
    province: normalizeText(orderValue?.shipping_address?.province),
    country: normalizeText(orderValue?.shipping_address?.country),
    zip: normalizeText(orderValue?.shipping_address?.zip),
  },
});

const buildAddressLines = (address = {}) => {
  const lines = [];
  const primaryLine = [address?.address1, address?.address2]
    .map(normalizeText)
    .filter(Boolean)
    .join(" - ");
  const localityLine = [address?.city, address?.zip]
    .map(normalizeText)
    .filter(Boolean)
    .join(", ");
  const regionLine = [address?.province, address?.country]
    .map(normalizeText)
    .filter(Boolean)
    .join(", ");

  if (primaryLine) {
    lines.push(primaryLine);
  }
  if (localityLine) {
    lines.push(localityLine);
  }
  if (regionLine) {
    lines.push(regionLine);
  }

  return lines;
};

export default function OrderDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useAuth();
  const { currencyLabel, formatCurrency, formatDateTime, select } = useLocale();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingPaymentMethod, setUpdatingPaymentMethod] = useState(false);
  const [updatingFulfillment, setUpdatingFulfillment] = useState(false);
  const [profitData, setProfitData] = useState(null);
  const [profitLoading, setProfitLoading] = useState(false);
  const [profitError, setProfitError] = useState("");
  const [selectedLineItemIds, setSelectedLineItemIds] = useState([]);
  const [editingContact, setEditingContact] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactForm, setContactForm] = useState(createOrderContactForm(null));
  const [shippingIssueDraftReason, setShippingIssueDraftReason] = useState(
    DEFAULT_SHIPPING_ISSUE_REASON,
  );
  const [updatingShippingIssue, setUpdatingShippingIssue] = useState(false);
  const canEditOrders = hasPermission("can_edit_orders");

  const showNotification = useCallback((message, type = "info") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  const fetchOrderDetails = useCallback(async () => {
    setLoading(true);
    try {
      const response = await shopifyAPI.getOrderDetails(id);
      setSelectedLineItemIds([]);
      setOrder(response.data);
    } catch (error) {
      console.error("Error fetching order details:", error);
      showNotification("فشل تحميل تفاصيل الطلب", "error");
    } finally {
      setLoading(false);
    }
  }, [id, showNotification]);

  const fetchOrderProfit = useCallback(async () => {
    if (!isAdmin) {
      setProfitData(null);
      setProfitError("");
      setProfitLoading(false);
      return;
    }

    try {
      setProfitLoading(true);
      setProfitError("");
      const response = await shopifyAPI.getOrderProfit(id);
      setProfitData(response.data);
    } catch (error) {
      console.error("Error fetching order profit:", error);
      setProfitData(null);
      setProfitError(
        error?.response?.data?.error || "تعذر حساب صافي الربح لهذا الطلب حالياً",
      );
    } finally {
      setProfitLoading(false);
    }
  }, [id, isAdmin]);

  const refreshOrderView = useCallback(async () => {
    await fetchOrderDetails();
    if (isAdmin) {
      await fetchOrderProfit();
    } else {
      setProfitData(null);
      setProfitError("");
      setProfitLoading(false);
    }
  }, [fetchOrderDetails, fetchOrderProfit, isAdmin]);

  useEffect(() => {
    refreshOrderView();
  }, [refreshOrderView]);

  useEffect(() => {
    setContactForm(createOrderContactForm(order));
  }, [order]);

  useEffect(() => {
    setShippingIssueDraftReason(
      normalizeShippingIssueReason(order?.shipping_issue?.reason),
    );
  }, [order]);


  const handleStatusChange = async (newStatus) => {
    if (newStatus === order?.status) return;

    let voidReason = "";
    if (newStatus === "voided") {
      const promptValue = window.prompt("Please enter the reason for voiding this order:");
      if (promptValue === null) return;
      voidReason = promptValue.trim();
      if (!voidReason) {
        showNotification("Void reason is required", "error");
        return;
      }
    }

    setUpdatingStatus(true);
    try {
      await api.post(`/shopify/orders/${id}/update-status`, {
        status: newStatus,
        void_reason: voidReason,
      });
      markSharedDataUpdated();
      showNotification(
        newStatus === "voided"
          ? "Order voided on Shopify successfully"
          : "Order status updated successfully",
        "success",
      );
      await refreshOrderView();
    } catch (error) {
      console.error("Error updating status:", error);
      showNotification(
        error?.response?.data?.error || "Failed to update order status",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  };

  const getOrderFinancialStatus = (orderValue) => {
    const parsedData = parseOrderData(orderValue);
    return String(
      parsedData?.financial_status || orderValue?.financial_status || orderValue?.status || "",
    )
      .toLowerCase()
      .trim();
  };

  const getOrderFulfillmentStatus = (orderValue) => {
    const parsedData = parseOrderData(orderValue);
    return normalizeFulfillmentStatus(
      orderValue?.fulfillment_status || parsedData?.fulfillment_status,
    );
  };

  const getFulfillmentStatusColor = (status) => {
    const normalized = normalizeFulfillmentStatus(status);
    if (normalized === "fulfilled") return "bg-green-100 text-green-800";
    if (normalized === "partial") return "bg-amber-100 text-amber-800";
    if (normalized === "restocked") return "bg-rose-100 text-rose-800";
    if (
      normalized === "scheduled" ||
      normalized === "on_hold" ||
      normalized === "in_progress" ||
      normalized === "open"
    ) {
      return "bg-sky-100 text-sky-800";
    }
    return "bg-slate-100 text-slate-700";
  };

  const getFulfillableQuantity = (orderValue) =>
    Array.isArray(orderValue?.line_items)
      ? orderValue.line_items.reduce((sum, item) => {
          const quantity = Number(item?.fulfillable_quantity || 0);
          return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0);
        }, 0)
      : 0;

  const canCancelFulfillment = (orderValue) => {
    const fulfillments = Array.isArray(orderValue?.fulfillments)
      ? orderValue.fulfillments.filter((fulfillment) => fulfillment?.id)
      : [];
    return fulfillments.length > 0;
  };

  const selectedLineItemIdSet = useMemo(
    () => new Set(selectedLineItemIds),
    [selectedLineItemIds],
  );

  const fulfilledQuantityByLineItemId = useMemo(() => {
    const quantityMap = new Map();
    const fulfillments = Array.isArray(order?.fulfillments)
      ? order.fulfillments
      : [];

    for (const fulfillment of fulfillments) {
      const lineItems = Array.isArray(fulfillment?.line_items)
        ? fulfillment.line_items
        : [];

      for (const lineItem of lineItems) {
        const lineItemId = getLineItemId(lineItem);
        const quantity = toPositiveNumber(lineItem?.quantity);
        if (!lineItemId || quantity <= 0) {
          continue;
        }

        quantityMap.set(lineItemId, (quantityMap.get(lineItemId) || 0) + quantity);
      }
    }

    return quantityMap;
  }, [order]);

  const selectedLineItems = useMemo(
    () =>
      Array.isArray(order?.line_items)
        ? order.line_items.filter((item) =>
            selectedLineItemIdSet.has(getLineItemId(item)),
          )
        : [],
    [order, selectedLineItemIdSet],
  );

  const allOrderLineItemsSelected =
    Array.isArray(order?.line_items) &&
    order.line_items.length > 0 &&
    order.line_items.every((item) => selectedLineItemIdSet.has(getLineItemId(item)));

  const clearSelectedLineItems = () => {
    setSelectedLineItemIds([]);
  };

  const toggleSelectAllLineItems = () => {
    if (!Array.isArray(order?.line_items) || order.line_items.length === 0) {
      return;
    }

    if (allOrderLineItemsSelected) {
      setSelectedLineItemIds([]);
      return;
    }

    setSelectedLineItemIds(
      order.line_items
        .map((item) => getLineItemId(item))
        .filter(Boolean),
    );
  };

  const toggleLineItemSelection = (lineItemId) => {
    const normalizedLineItemId = String(lineItemId || "").trim();
    if (!normalizedLineItemId) {
      return;
    }

    setSelectedLineItemIds((current) =>
      current.includes(normalizedLineItemId)
        ? current.filter((value) => value !== normalizedLineItemId)
        : [...current, normalizedLineItemId],
    );
  };

  const getFulfillmentOptions = (orderValue) => {
    const currentStatus = getOrderFulfillmentStatus(orderValue);
    const options = [
      {
        value: currentStatus,
        label: `${getFulfillmentStatusLabel(currentStatus)} (Current)`,
      },
    ];

    if (getFulfillableQuantity(orderValue) > 0 && currentStatus !== "fulfilled") {
      options.push({
        value: "fulfilled",
        label: "Fulfill on Shopify",
      });
    }

    if (
      currentStatus !== "unfulfilled" &&
      currentStatus !== "restocked" &&
      canCancelFulfillment(orderValue)
    ) {
      options.push({
        value: "unfulfilled",
        label: "Cancel fulfillment on Shopify",
      });
    }

    return options.filter(
      (option, index, list) =>
        list.findIndex((entry) => entry.value === option.value) === index,
    );
  };

  const getFulfillmentHelperText = (orderValue) => {
    const currentStatus = getOrderFulfillmentStatus(orderValue);
    const remainingQuantity = getFulfillableQuantity(orderValue);
    const selectedItemsCount = selectedLineItems.length;

    if (selectedItemsCount > 0) {
      return `Action will apply to ${selectedItemsCount} selected item(s) only. Clear selection to apply to the whole order.`;
    }

    if (currentStatus === "partial" && remainingQuantity > 0) {
      return `${remainingQuantity} item(s) still need fulfillment on Shopify`;
    }

    if (remainingQuantity > 0 && currentStatus !== "fulfilled") {
      return `${remainingQuantity} item(s) can be fulfilled now`;
    }

    if (currentStatus === "fulfilled" && canCancelFulfillment(orderValue)) {
      return "You can cancel the latest Shopify fulfillment from here";
    }

    if (currentStatus === "fulfilled") {
      return "This order is already fulfilled on Shopify";
    }

    return "Fulfillment stays synced with the Shopify order";
  };

  const isShopifyPaidOrder = (orderValue) => {
    const status = getOrderFinancialStatus(orderValue);
    return status === "paid" || status === "partially_paid";
  };

  const getEffectivePaymentMethod = (orderValue) => {
    if (!orderValue) return "none";
    if (isShopifyPaidOrder(orderValue)) return "shopify";
    const normalized = String(orderValue.payment_method || "").toLowerCase().trim();
    if (normalized === "instapay" || normalized === "wallet") {
      return normalized;
    }
    return "none";
  };

  const handlePaymentMethodChange = async (paymentMethod) => {
    if (!order || !canEditOrders) return;

    const currentMethod = getEffectivePaymentMethod(order);
    if (paymentMethod === currentMethod) return;

    setUpdatingPaymentMethod(true);
    try {
      const response = await api.post(`/shopify/orders/${id}/payment-method`, {
        payment_method: paymentMethod,
      });
      const nextMethod = String(response?.data?.payment_method || paymentMethod)
        .toLowerCase()
        .trim();
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              payment_method: nextMethod,
            }
          : prev,
      );
      markSharedDataUpdated();
      showNotification("Payment method updated successfully", "success");
    } catch (error) {
      console.error("Error updating payment method:", error);
      showNotification(
        error?.response?.data?.error || "Failed to update payment method",
        "error",
      );
    } finally {
      setUpdatingPaymentMethod(false);
    }
  };

  const handleFulfillmentChange = async (fulfillmentStatus) => {
    if (!order || !canEditOrders) return;

    const currentStatus = getOrderFulfillmentStatus(order);
    if (fulfillmentStatus === currentStatus) return;

    setUpdatingFulfillment(true);
    try {
      const payload = {
        fulfillment_status: fulfillmentStatus,
      };

      if (selectedLineItems.length > 0) {
        payload.line_items = selectedLineItems.map((item) => ({
          id: getLineItemId(item),
        }));
      }

      await api.post(`/shopify/orders/${id}/update-fulfillment`, payload);
      markSharedDataUpdated();
      showNotification("Fulfillment updated successfully", "success");
      clearSelectedLineItems();
      await refreshOrderView();
    } catch (error) {
      console.error("Error updating fulfillment:", error);
      showNotification(
        error?.response?.data?.error || "Failed to update fulfillment",
        "error",
      );
    } finally {
      setUpdatingFulfillment(false);
    }
  };

  const handleContactFieldChange = (field, value) => {
    setContactForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleShippingAddressFieldChange = (field, value) => {
    setContactForm((current) => ({
      ...current,
      shipping_address: {
        ...current.shipping_address,
        [field]: value,
      },
    }));
  };

  const handleCancelContactEdit = () => {
    setEditingContact(false);
    setContactForm(createOrderContactForm(order));
  };

  const handleSaveContactDetails = async () => {
    if (!order || !canEditOrders) return;

    setSavingContact(true);
    try {
      const response = await api.post(`/shopify/orders/${id}/update-contact`, {
        customer_phone: contactForm.customer_phone,
        shipping_address: contactForm.shipping_address,
      });

      if (response?.data?.order) {
        setOrder(response.data.order);
        if (isAdmin) {
          await fetchOrderProfit();
        }
      } else {
        await refreshOrderView();
      }

      setEditingContact(false);
      markSharedDataUpdated();
      showNotification("تم حفظ تعديل الهاتف والعنوان", "success");
    } catch (error) {
      console.error("Error updating contact details:", error);
      showNotification(
        error?.response?.data?.error || "فشل حفظ تعديل الهاتف والعنوان",
        "error",
      );
    } finally {
      setSavingContact(false);
    }
  };

  const shippingIssueOptions = useMemo(
    () => getShippingIssueReasonOptions(select),
    [select],
  );

  const shippingIssueActive = isShippingIssueActive(order);
  const currentShippingIssueReason = normalizeShippingIssueReason(
    order?.shipping_issue?.reason,
  );
  const hasShippingIssueReasonChanged =
    shippingIssueActive &&
    currentShippingIssueReason !== shippingIssueDraftReason;

  const handleSaveShippingIssue = async () => {
    if (!order || !canEditOrders) return;
    if (shippingIssueActive && !hasShippingIssueReasonChanged) return;

    setUpdatingShippingIssue(true);
    try {
      const response = await api.post(`/shopify/orders/${id}/shipping-issue`, {
        active: true,
        reason: shippingIssueDraftReason,
      });

      if (response?.data?.order) {
        setOrder(response.data.order);
      }

      markSharedDataUpdated();
      showNotification(
        shippingIssueActive
          ? select("تم تحديث سبب مشكلة الشحن", "Shipping issue updated")
          : select("تم نقل الأوردر لمشاكل الشحن", "Order moved to Shipping Issues"),
        "success",
      );
    } catch (error) {
      console.error("Error updating shipping issue:", error);
      showNotification(
        error?.response?.data?.error ||
          select("فشل تحديث مشكلة الشحن", "Failed to update shipping issue"),
        "error",
      );
    } finally {
      setUpdatingShippingIssue(false);
    }
  };

  const handleReturnOrderToOrders = async () => {
    if (!order || !canEditOrders) return;

    setUpdatingShippingIssue(true);
    try {
      const response = await api.post(`/shopify/orders/${id}/shipping-issue`, {
        active: false,
      });

      if (response?.data?.order) {
        setOrder(response.data.order);
      }

      markSharedDataUpdated();
      showNotification(
        select("تم إرجاع الأوردر لقائمة الأوردرات", "Order returned to Orders"),
        "success",
      );
    } catch (error) {
      console.error("Error returning order to main orders:", error);
      showNotification(
        error?.response?.data?.error ||
          select("فشل إرجاع الأوردر لقائمة الأوردرات", "Failed to return order to Orders"),
        "error",
      );
    } finally {
      setUpdatingShippingIssue(false);
    }
  };

  const handleCopyOrderReference = async () => {
    try {
      await navigator.clipboard.writeText(
        String(order?.order_number || order?.shopify_id || id || ""),
      );
      showNotification(
        select("تم نسخ رقم الطلب", "Order reference copied"),
        "success",
      );
    } catch {
      showNotification(select("فشل نسخ رقم الطلب", "Failed to copy order reference"), "error");
    }
  };

  const getStatusColor = (status) => {
    if (!status) return "bg-gray-100 text-gray-800";
    const statusLower = status.toLowerCase();
    switch (statusLower) {
      case "paid":
      case "completed":
        return "bg-green-100 text-green-800";
      case "pending":
      case "authorized":
        return "bg-yellow-100 text-yellow-800";
      case "partially_paid":
      case "partially_refunded":
        return "bg-blue-100 text-blue-800";
      case "refunded":
      case "voided":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPaymentMethodColor = (method) => {
    const normalized = String(method || "").toLowerCase();
    if (normalized === "shopify") return "bg-emerald-100 text-emerald-800";
    if (normalized === "instapay") return "bg-blue-100 text-blue-800";
    if (normalized === "wallet") return "bg-violet-100 text-violet-800";
    return "bg-slate-100 text-slate-700";
  };

  const formatDate = (dateString) =>
    formatDateTime(dateString, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const getSyncStatusIcon = () => {
    if (order?.pending_sync) {
      return (
        <Clock
          size={16}
          className="text-yellow-500"
          title="في انتظار المزامنة"
        />
      );
    }
    if (order?.sync_error) {
      return (
        <AlertCircle
          size={16}
          className="text-red-500"
          title={order.sync_error}
        />
      );
    }
    if (order?.last_synced_at) {
      return (
        <CheckCircle
          size={16}
          className="text-green-500"
          title="تمت المزامنة"
        />
      );
    }
    return null;
  };

  const phoneEditAudit = order?.contact_edits?.customer_phone || null;
  const shippingAddressEditAudit = order?.contact_edits?.shipping_address || null;
  const currentShippingAddressLines = buildAddressLines(order?.shipping_address);
  const originalShippingAddressLines = buildAddressLines(
    shippingAddressEditAudit?.original,
  );
  const hasContactEdits = Boolean(phoneEditAudit || shippingAddressEditAudit);
  const orderProfitSummary = useMemo(() => {
    const revenue = toAmount(profitData?.total_revenue);
    const productCost = toAmount(profitData?.total_cost);
    const operationalCosts = toAmount(profitData?.total_operational_costs);
    const grossProfit = toAmount(profitData?.gross_profit);
    const netProfit = toAmount(profitData?.net_profit);
    const margin = toAmount(profitData?.profit_margin);

    return {
      revenue,
      productCost,
      operationalCosts,
      grossProfit,
      netProfit,
      margin,
      totalCosts: productCost + operationalCosts,
      statusTone:
        netProfit > 0
          ? {
              wrapper: "border-emerald-200 bg-emerald-50/90",
              text: "text-emerald-900",
              subtle: "text-emerald-700",
              badge: "bg-emerald-600 text-white",
              label: "طلب مربح",
            }
          : netProfit < 0
            ? {
                wrapper: "border-rose-200 bg-rose-50/90",
                text: "text-rose-900",
                subtle: "text-rose-700",
                badge: "bg-rose-600 text-white",
                label: "طلب خاسر",
              }
            : {
                wrapper: "border-slate-200 bg-slate-50/90",
                text: "text-slate-900",
                subtle: "text-slate-700",
                badge: "bg-slate-700 text-white",
                label: "بدون ربح",
              },
    };
  }, [profitData]);

  if (loading) {
    return (
      <div className="flex h-screen bg-transparent">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">جاري تحميل تفاصيل الطلب...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-screen bg-transparent">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Package size={64} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-lg">لم يتم العثور على الطلب</p>
            <button
              onClick={() => navigate("/orders")}
              className="mt-4 text-blue-600 hover:text-blue-700"
            >
              العودة إلى الطلبات
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-transparent">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-8">
          {/* Notification */}
          {notification && (
            <div
              className={`fixed top-4 right-4 z-50 px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 ${
                notification.type === "success"
                  ? "bg-green-500 text-white"
                  : notification.type === "error"
                    ? "bg-red-500 text-white"
                    : "bg-blue-500 text-white"
              }`}
            >
              {notification.type === "success" && <CheckCircle size={20} />}
              {notification.type === "error" && <AlertCircle size={20} />}
              <span>{notification.message}</span>
            </div>
          )}

          {/* Header */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/orders")}
                className="app-button-secondary rounded-2xl p-2.5 text-slate-700"
              >
                <ArrowLeft size={24} />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-gray-800">
                    طلب #{order.order_number || order.shopify_id}
                  </h1>
                  {getSyncStatusIcon()}
                  <button
                    onClick={handleCopyOrderReference}
                    className="app-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700"
                    title={select("نسخ رقم الطلب", "Copy order reference")}
                  >
                    <Copy size={14} />
                    {select("نسخ", "Copy")}
                  </button>
                </div>
                <p className="text-gray-600">
                  تم الإنشاء في {formatDate(order.created_at)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 w-full md:w-auto md:min-w-[900px]">
              <div className="min-w-[210px]">
                <label className="block text-xs text-gray-500 mb-1">
                  Payment Method
                </label>
                <select
                  value={getEffectivePaymentMethod(order)}
                  onChange={(e) => handlePaymentMethodChange(e.target.value)}
                  disabled={!canEditOrders || updatingPaymentMethod || isShopifyPaidOrder(order)}
                  className="app-input w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {isShopifyPaidOrder(order) && (
                    <option value="shopify">{PAYMENT_METHOD_LABELS.shopify}</option>
                  )}
                  <option value="none">{PAYMENT_METHOD_LABELS.none}</option>
                  <option value="instapay">{PAYMENT_METHOD_LABELS.instapay}</option>
                  <option value="wallet">{PAYMENT_METHOD_LABELS.wallet}</option>
                </select>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getPaymentMethodColor(
                      getEffectivePaymentMethod(order),
                    )}`}
                  >
                    {PAYMENT_METHOD_LABELS[getEffectivePaymentMethod(order)] ||
                      PAYMENT_METHOD_LABELS.none}
                  </span>
                  {isShopifyPaidOrder(order) && (
                    <span className="text-[11px] text-gray-500">
                      Locked: paid on Shopify
                    </span>
                  )}
                </div>
              </div>

              <div className="min-w-[210px]">
                <label className="block text-xs text-gray-500 mb-1">
                  Payment Status
                </label>
                <select
                  value={order.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={!canEditOrders || updatingStatus}
                  className="app-input w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  <option value="pending">Pending</option>
                  <option value="authorized">Authorized</option>
                  <option value="paid">Paid</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="refunded">Refunded</option>
                  <option value="voided">Voided</option>
                  <option value="partially_refunded">Partially Refunded</option>
                </select>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(
                      getOrderFinancialStatus(order),
                    )}`}
                  >
                    {getOrderFinancialStatus(order) || "unknown"}
                  </span>
                </div>
              </div>

              <div className="min-w-[210px]">
                <label className="block text-xs text-gray-500 mb-1">
                  Fulfillment
                </label>
                <select
                  value={getOrderFulfillmentStatus(order)}
                  onChange={(e) => handleFulfillmentChange(e.target.value)}
                  disabled={!canEditOrders || updatingFulfillment}
                  className="app-input w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {getFulfillmentOptions(order).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getFulfillmentStatusColor(
                      getOrderFulfillmentStatus(order),
                    )}`}
                  >
                    {getFulfillmentStatusLabel(getOrderFulfillmentStatus(order))}
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {getFulfillmentHelperText(order)}
                  </span>
                </div>
              </div>

              <div className="min-w-[220px]">
                <label className="block text-xs text-gray-500 mb-1">
                  {select("مشاكل الشحن", "Shipping Issues")}
                </label>
                <select
                  value={shippingIssueDraftReason}
                  onChange={(e) => setShippingIssueDraftReason(e.target.value)}
                  disabled={!canEditOrders || updatingShippingIssue}
                  className="app-input w-full px-4 py-2.5 text-sm disabled:opacity-50"
                >
                  {shippingIssueOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      shippingIssueActive
                        ? getShippingIssueBadgeClassName(currentShippingIssueReason)
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {shippingIssueActive
                      ? getShippingIssueReasonLabel(currentShippingIssueReason, select)
                      : select("في الأوردرات", "In Orders")}
                  </span>
                  {shippingIssueActive ? (
                    <>
                      <button
                        type="button"
                        onClick={handleSaveShippingIssue}
                        disabled={
                          !canEditOrders ||
                          updatingShippingIssue ||
                          !hasShippingIssueReasonChanged
                        }
                        className="text-[11px] font-semibold text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {select("تحديث", "Update")}
                      </button>
                      <button
                        type="button"
                        onClick={handleReturnOrderToOrders}
                        disabled={!canEditOrders || updatingShippingIssue}
                        className="text-[11px] font-semibold text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {select("رجوع للأوردرات", "Return to Orders")}
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate("/orders/shipping-issues")}
                        className="text-[11px] font-semibold text-slate-600"
                      >
                        {select("فتح الصفحة", "Open page")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSaveShippingIssue}
                      disabled={!canEditOrders || updatingShippingIssue}
                      className="text-[11px] font-semibold text-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {select("نقل لمشاكل الشحن", "Move to Shipping Issues")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Line Items */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Package size={20} />
                  المنتجات ({order.line_items?.length || 0})
                </h2>
                {canEditOrders && (order.line_items?.length || 0) > 0 && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Apply fulfill/restock to selected items only.
                      </span>
                      {selectedLineItems.length > 0 && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                          {selectedLineItems.length} selected
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={toggleSelectAllLineItems}
                        className="app-button-secondary rounded-xl px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        {allOrderLineItemsSelected ? "Unselect all" : "Select all"}
                      </button>
                      <button
                        type="button"
                        onClick={clearSelectedLineItems}
                        disabled={selectedLineItems.length === 0}
                        className="app-button-secondary rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-4">
                  {order.line_items?.map((item, index) => {
                    const lineItemId = getLineItemId(item);
                    const isSelected = selectedLineItemIdSet.has(lineItemId);
                    const fulfillableQuantity = toPositiveNumber(
                      item?.fulfillable_quantity,
                    );
                    const fulfilledQuantity =
                      fulfilledQuantityByLineItemId.get(lineItemId) || 0;

                    return (
                    <div
                      key={index}
                      className={`flex gap-4 rounded-lg border p-4 transition ${
                        isSelected
                          ? "border-sky-300 bg-sky-50/60"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {canEditOrders && (
                        <div className="pt-1">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleLineItemSelection(lineItemId)}
                            className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                          />
                        </div>
                      )}
                      <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                        {item.image_url ? (
                          <img
                            src={item.image_url}
                            alt={item.title}
                            className="w-full h-full object-cover rounded-lg"
                          />
                        ) : (
                          <Package size={32} className="text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-800">
                          {item.title}
                        </h3>
                        {item.variant_title && (
                          <p className="text-sm text-gray-600">
                            {item.variant_title}
                          </p>
                        )}
                        {item.sku && (
                          <p className="text-xs text-gray-500">
                            SKU: {item.sku}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-4">
                          <span className="text-sm text-gray-600">
                            الكمية: {item.quantity}
                          </span>
                          <span className="text-xs text-slate-500">
                            Fulfillable: {fulfillableQuantity}
                          </span>
                          <span className="text-xs text-slate-500">
                            Fulfilled: {fulfilledQuantity}
                          </span>
                          <span className="text-sm font-semibold text-gray-800">
                            {formatCurrency(item.price)}
                          </span>
                        </div>
                        {isSelected && (
                          <p className="mt-2 text-xs font-medium text-sky-700">
                            Fulfillment actions will target this item only.
                          </p>
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-lg font-bold text-gray-800">
                          {(item.quantity * parseFloat(item.price)).toFixed(2)}{" "}
                          {currencyLabel}
                        </p>
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Order Totals */}
                <div className="mt-6 pt-6 border-t space-y-2">
                  <div className="flex justify-between text-gray-600">
                    <span>المجموع الفرعي:</span>
                    <span>
                      {formatCurrency(order.subtotal_price)}
                    </span>
                  </div>
                  {order.total_tax > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>الضرائب:</span>
                      <span>
                        {formatCurrency(order.total_tax)}
                      </span>
                    </div>
                  )}
                  {order.total_shipping > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>الشحن:</span>
                      <span>
                        {formatCurrency(order.total_shipping)}
                      </span>
                    </div>
                  )}
                  {order.total_discounts > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>الخصم:</span>
                      <span>
                        {formatCurrency(-Math.abs(order.total_discounts || 0))}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-xl font-bold text-gray-800 pt-2 border-t">
                    <span>الإجمالي:</span>
                    <span>
                      {formatCurrency(order.total_price)}
                    </span>
                  </div>

                  {/* Refunds Section */}
                  {order.refunds && order.refunds.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-red-200 bg-red-50 rounded-lg p-4">
                      <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
                        <AlertCircle size={18} />
                        المرتجعات ({order.refunds.length})
                      </h3>
                      <div className="space-y-3">
                        {order.refunds.map((refund, idx) => (
                          <div
                            key={idx}
                            className="bg-white rounded p-3 border border-red-200"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <span className="text-sm text-gray-600">
                                {formatDate(refund.created_at)}
                              </span>
                              <span className="font-semibold text-red-600">
                                -
                                {refund.transactions
                                  ?.reduce(
                                    (sum, t) => sum + parseFloat(t.amount || 0),
                                    0,
                                  )
                                  .toFixed(2)}{" "}
                                {currencyLabel}
                              </span>
                            </div>
                            {refund.note && (
                              <p className="text-sm text-gray-700">
                                {refund.note}
                              </p>
                            )}
                            {refund.refund_line_items &&
                              refund.refund_line_items.length > 0 && (
                                <div className="mt-2 text-xs text-gray-600">
                                  <p className="font-medium">المنتجات:</p>
                                  {refund.refund_line_items.map((item, i) => (
                                    <p key={i}>
                                      • {item.line_item?.title} (الكمية:{" "}
                                      {item.quantity})
                                    </p>
                                  ))}
                                </div>
                              )}
                          </div>
                        ))}
                        <div className="flex justify-between text-red-800 font-bold pt-2 border-t border-red-200">
                          <span>إجمالي المرتجعات:</span>
                          <span>
                            {formatCurrency(-Math.abs(order.total_refunded || 0))}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cancellation Info */}
                  {order.cancelled_at && (
                    <div className="mt-4 pt-4 border-t border-red-200 bg-red-50 rounded-lg p-4">
                      <h3 className="font-bold text-red-800 mb-2 flex items-center gap-2">
                        <AlertCircle size={18} />
                        طلب ملغي
                      </h3>
                      <div className="space-y-1 text-sm">
                        <p className="text-gray-700">
                          <span className="font-medium">تاريخ الإلغاء:</span>{" "}
                          {formatDate(order.cancelled_at)}
                        </p>
                        {(order.void_reason || order.cancel_reason) && (
                          <p className="text-gray-700">
                            <span className="font-medium">السبب:</span>{" "}
                            {order.void_reason || order.cancel_reason}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {isAdmin && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <div
                        className={`rounded-2xl border p-4 shadow-sm ${orderProfitSummary.statusTone.wrapper}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3
                              className={`font-bold flex items-center gap-2 ${orderProfitSummary.statusTone.text}`}
                            >
                              <TrendingUp size={18} />
                              صافي ربح الطلب
                            </h3>
                            <p className={`mt-1 text-xs ${orderProfitSummary.statusTone.subtle}`}>
                              يظهر للأدمن فقط ويعتمد على إيراد الطلب وتكلفة المنتجات والتكاليف التشغيلية
                            </p>
                          </div>
                          {profitData ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${orderProfitSummary.statusTone.badge}`}
                            >
                              {orderProfitSummary.netProfit > 0 ? (
                                <CheckCircle size={14} />
                              ) : orderProfitSummary.netProfit < 0 ? (
                                <AlertCircle size={14} />
                              ) : null}
                              {orderProfitSummary.statusTone.label}
                            </span>
                          ) : null}
                        </div>

                        {profitLoading ? (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-600">
                            جاري حساب صافي الربح...
                          </div>
                        ) : profitError ? (
                          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                            {profitError}
                          </div>
                        ) : profitData ? (
                          <div className="mt-4 space-y-4">
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              <ProfitSummaryMetric
                                label="الإيراد"
                                value={formatCurrency(orderProfitSummary.revenue)}
                                tone="text-sky-700"
                              />
                              <ProfitSummaryMetric
                                label="إجمالي التكاليف"
                                value={formatCurrency(orderProfitSummary.totalCosts)}
                                tone="text-amber-700"
                              />
                              <ProfitSummaryMetric
                                label="الربح الإجمالي"
                                value={formatCurrency(orderProfitSummary.grossProfit)}
                                tone="text-indigo-700"
                              />
                              <ProfitSummaryMetric
                                label="صافي الربح"
                                value={formatCurrency(orderProfitSummary.netProfit)}
                                tone={orderProfitSummary.statusTone.text}
                              />
                            </div>

                            <div className="rounded-2xl border border-white/80 bg-white/75 p-4">
                              <div className="grid gap-3 md:grid-cols-2">
                                <ProfitDetailRow
                                  label="تكلفة المنتجات"
                                  value={formatCurrency(orderProfitSummary.productCost)}
                                  tone="text-amber-700"
                                />
                                <ProfitDetailRow
                                  label="التكاليف التشغيلية"
                                  value={formatCurrency(orderProfitSummary.operationalCosts)}
                                  tone="text-rose-700"
                                />
                                <ProfitDetailRow
                                  label="هامش الربح"
                                  value={`${orderProfitSummary.margin.toFixed(2)}%`}
                                  tone={orderProfitSummary.statusTone.text}
                                />
                                <ProfitDetailRow
                                  label="النتيجة"
                                  value={orderProfitSummary.statusTone.label}
                                  tone={orderProfitSummary.statusTone.text}
                                />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-600">
                            لا توجد بيانات ربحية متاحة لهذا الطلب بعد.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Comments Section */}
              <OrderComments
                orderId={order.shopify_id || ""}
                legacyOrderId={order.id}
                orderNumber={order.order_number || order.name}
              />
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Customer Info */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <User size={18} />
                  معلومات العميل
                </h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-600">الاسم</p>
                    <p className="font-semibold text-gray-800">
                      {order.customer_name || "غير معروف"}
                    </p>
                  </div>
                  {order.customer_email && (
                    <div>
                      <p className="text-sm text-gray-600">البريد الإلكتروني</p>
                      <p className="text-gray-800">{order.customer_email}</p>
                    </div>
                  )}
                  {order.customer_phone && (
                    <div>
                      <p className="text-sm text-gray-600">الهاتف</p>
                      <p className="text-gray-800">{order.customer_phone}</p>
                    </div>
                  )}
                  {order.customer_info && (
                    <>
                      {order.customer_info.orders_count > 0 && (
                        <div>
                          <p className="text-sm text-gray-600">عدد الطلبات</p>
                          <p className="text-gray-800">
                            {order.customer_info.orders_count}
                          </p>
                        </div>
                      )}
                      {order.customer_info.total_spent && (
                        <div>
                          <p className="text-sm text-gray-600">
                            إجمالي المشتريات
                          </p>
                          <p className="text-gray-800">
                            {formatCurrency(order.customer_info.total_spent)}
                          </p>
                        </div>
                      )}
                      {order.customer_info.tags && (
                        <div>
                          <p className="text-sm text-gray-600">التصنيفات</p>
                          <p className="text-gray-800">
                            {order.customer_info.tags}
                          </p>
                        </div>
                      )}
                      {order.customer_info.note && (
                        <div>
                          <p className="text-sm text-gray-600">ملاحظة</p>
                          <p className="text-gray-800 text-sm">
                            {order.customer_info.note}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Shipping Address */}
              {order.shipping_address && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <MapPin size={18} />
                    عنوان الشحن
                  </h2>
                  <div className="text-gray-700 space-y-1">
                    {(order.shipping_address.first_name ||
                      order.shipping_address.last_name) && (
                      <p className="font-semibold">
                        {order.shipping_address.first_name}{" "}
                        {order.shipping_address.last_name}
                      </p>
                    )}
                    {order.shipping_address.company && (
                      <p className="text-sm text-gray-600">
                        {order.shipping_address.company}
                      </p>
                    )}
                    {order.shipping_address.address1 && (
                      <p>{order.shipping_address.address1}</p>
                    )}
                    {order.shipping_address.address2 && (
                      <p>{order.shipping_address.address2}</p>
                    )}
                    {order.shipping_address.city && (
                      <p>
                        {order.shipping_address.city}
                        {order.shipping_address.zip &&
                          `, ${order.shipping_address.zip}`}
                      </p>
                    )}
                    {order.shipping_address.province && (
                      <p>{order.shipping_address.province}</p>
                    )}
                    {order.shipping_address.country && (
                      <p>{order.shipping_address.country}</p>
                    )}
                    {order.shipping_address.phone && (
                      <p className="mt-2 text-sm">
                        📞 {order.shipping_address.phone}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="app-surface rounded-[28px] p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">
                      تعديل الهاتف والعنوان
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      التعديل هنا محلي داخل النظام مع الاحتفاظ بالأصل والمعدل.
                    </p>
                  </div>
                  {canEditOrders && (
                    <button
                      type="button"
                      onClick={() =>
                        editingContact
                          ? handleCancelContactEdit()
                          : setEditingContact(true)
                      }
                      className="app-button-secondary rounded-xl px-3 py-2 text-sm font-semibold text-slate-700"
                    >
                      {editingContact ? "إلغاء" : "تعديل"}
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-700">
                        الهاتف الحالي
                      </p>
                      {phoneEditAudit && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          تم التعديل
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {order.customer_phone || "-"}
                    </p>
                    {phoneEditAudit?.original && (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2">
                        <p className="text-xs text-slate-500">الرقم الأصلي</p>
                        <p className="mt-1 text-sm text-slate-700">
                          {phoneEditAudit.original}
                        </p>
                        {(phoneEditAudit.updated_by_name ||
                          phoneEditAudit.updated_at) && (
                          <p className="mt-2 text-[11px] text-slate-400">
                            {phoneEditAudit.updated_by_name || "System"}
                            {phoneEditAudit.updated_at
                              ? ` | ${formatDate(phoneEditAudit.updated_at)}`
                              : ""}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-700">
                        العنوان الحالي
                      </p>
                      {shippingAddressEditAudit && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          تم التعديل
                        </span>
                      )}
                    </div>
                    {currentShippingAddressLines.length > 0 ? (
                      <div className="mt-2 space-y-1 text-sm text-slate-800">
                        {currentShippingAddressLines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">لا يوجد عنوان</p>
                    )}
                    {shippingAddressEditAudit && originalShippingAddressLines.length > 0 && (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2">
                        <p className="text-xs text-slate-500">العنوان الأصلي</p>
                        <div className="mt-1 space-y-1 text-sm text-slate-700">
                          {originalShippingAddressLines.map((line) => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                        {(shippingAddressEditAudit.updated_by_name ||
                          shippingAddressEditAudit.updated_at) && (
                          <p className="mt-2 text-[11px] text-slate-400">
                            {shippingAddressEditAudit.updated_by_name || "System"}
                            {shippingAddressEditAudit.updated_at
                              ? ` | ${formatDate(shippingAddressEditAudit.updated_at)}`
                              : ""}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {!hasContactEdits && !editingContact && (
                    <p className="text-sm text-slate-500">
                      لا توجد تعديلات محلية مسجلة على بيانات التواصل لهذا الطلب.
                    </p>
                  )}

                  {editingContact && (
                    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
                      <div className="grid gap-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-600">
                            رقم الهاتف
                          </span>
                          <input
                            type="text"
                            value={contactForm.customer_phone}
                            onChange={(event) =>
                              handleContactFieldChange(
                                "customer_phone",
                                event.target.value,
                              )
                            }
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              العنوان 1
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.address1}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "address1",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                          <label className="block sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              العنوان 2
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.address2}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "address2",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              المدينة
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.city}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "city",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              المحافظة
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.province}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "province",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              الدولة
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.country}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "country",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              الكود البريدي
                            </span>
                            <input
                              type="text"
                              value={contactForm.shipping_address.zip}
                              onChange={(event) =>
                                handleShippingAddressFieldChange(
                                  "zip",
                                  event.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveContactDetails}
                          disabled={savingContact}
                          className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savingContact ? "جارٍ الحفظ..." : "حفظ التعديل"}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelContactEdit}
                          disabled={savingContact}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Billing Address */}
              {order.billing_address && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <CreditCard size={18} />
                    عنوان الفواتير
                  </h2>
                  <div className="text-gray-700 space-y-1">
                    {(order.billing_address.first_name ||
                      order.billing_address.last_name) && (
                      <p className="font-semibold">
                        {order.billing_address.first_name}{" "}
                        {order.billing_address.last_name}
                      </p>
                    )}
                    {order.billing_address.company && (
                      <p className="text-sm text-gray-600">
                        {order.billing_address.company}
                      </p>
                    )}
                    {order.billing_address.address1 && (
                      <p>{order.billing_address.address1}</p>
                    )}
                    {order.billing_address.address2 && (
                      <p>{order.billing_address.address2}</p>
                    )}
                    {order.billing_address.city && (
                      <p>
                        {order.billing_address.city}
                        {order.billing_address.zip &&
                          `, ${order.billing_address.zip}`}
                      </p>
                    )}
                    {order.billing_address.province && (
                      <p>{order.billing_address.province}</p>
                    )}
                    {order.billing_address.country && (
                      <p>{order.billing_address.country}</p>
                    )}
                    {order.billing_address.phone && (
                      <p className="mt-2 text-sm">
                        📞 {order.billing_address.phone}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Payment Status */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <CreditCard size={18} />
                  حالة الدفع
                </h2>
                <div className="space-y-3">
                  <span
                    className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${getStatusColor(getOrderFinancialStatus(order))}`}
                  >
                    {getOrderFinancialStatus(order) || "unknown"}
                  </span>
                  {order.payment_gateway_names &&
                    order.payment_gateway_names.length > 0 && (
                      <div>
                        <p className="text-sm text-gray-600">طريقة الدفع</p>
                        <p className="text-gray-800">
                          {order.payment_gateway_names.join(", ")}
                        </p>
                      </div>
                    )}
                  {order.processing_method && (
                    <div>
                      <p className="text-sm text-gray-600">طريقة المعالجة</p>
                      <p className="text-gray-800">{order.processing_method}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Fulfillment Status */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Truck size={18} />
                  حالة التوصيل
                </h2>
                <div className="space-y-3">
                  <span
                    className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${getFulfillmentStatusColor(
                      getOrderFulfillmentStatus(order),
                    )}`}
                  >
                    {getFulfillmentStatusLabel(getOrderFulfillmentStatus(order))}
                  </span>
                  <p className="text-sm text-gray-600">
                    {getFulfillmentHelperText(order)}
                  </p>
                  <div className="text-sm text-gray-700 space-y-1">
                    <p>
                      Fulfillable items:{" "}
                      <span className="font-semibold">
                        {getFulfillableQuantity(order)}
                      </span>
                    </p>
                    <p>
                      Shopify fulfillments:{" "}
                      <span className="font-semibold">
                        {Array.isArray(order.fulfillments) ? order.fulfillments.length : 0}
                      </span>
                    </p>
                  </div>
                  {order.fulfillments && order.fulfillments.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm text-gray-600 font-medium">
                        معلومات الشحن:
                      </p>
                      {order.fulfillments.map((fulfillment, idx) => (
                        <div
                          key={idx}
                          className="text-sm bg-gray-50 p-2 rounded"
                        >
                          {fulfillment.tracking_company && (
                            <p>الشركة: {fulfillment.tracking_company}</p>
                          )}
                          {fulfillment.tracking_number && (
                            <p>رقم التتبع: {fulfillment.tracking_number}</p>
                          )}
                          {fulfillment.tracking_url && (
                            <a
                              href={fulfillment.tracking_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              تتبع الشحنة
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Shipping Method */}
              {order.shipping_lines && order.shipping_lines.length > 0 && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    طريقة الشحن
                  </h2>
                  {order.shipping_lines.map((line, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="font-semibold text-gray-800">
                        {line.title}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatCurrency(line.price)}
                      </p>
                      {line.code && (
                        <p className="text-xs text-gray-500">
                          الكود: {line.code}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Discount Codes */}
              {order.discount_codes && order.discount_codes.length > 0 && (
              <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    أكواد الخصم
                  </h2>
                  {order.discount_codes.map((discount, idx) => (
                    <div
                      key={idx}
                      className="bg-green-50 p-3 rounded-lg space-y-1"
                    >
                      <p className="font-semibold text-green-800">
                        {discount.code}
                      </p>
                      <p className="text-sm text-green-700">
                        {formatCurrency(discount.amount)}
                      </p>
                      {discount.type && (
                        <p className="text-xs text-green-600">
                          النوع: {discount.type}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Tags */}
              {order.tags && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    التصنيفات
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {order.tags.split(",").map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer Note */}
              {order.customer_note && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    ملاحظة العميل
                  </h2>
                  <p className="text-gray-700 text-sm whitespace-pre-wrap">
                    {order.customer_note}
                  </p>
                </div>
              )}

              {/* Source Information */}
              {order.source_name && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    مصدر الطلب
                  </h2>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-700">
                      <span className="font-medium">المصدر:</span>{" "}
                      {order.source_name}
                    </p>
                    {order.referring_site && (
                      <p className="text-gray-700">
                        <span className="font-medium">الموقع المُحيل:</span>{" "}
                        {order.referring_site}
                      </p>
                    )}
                    {order.landing_site && (
                      <p className="text-gray-700">
                        <span className="font-medium">صفحة الهبوط:</span>{" "}
                        {order.landing_site}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Sync Status */}
              {order.last_synced_at && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    حالة المزامنة
                  </h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {getSyncStatusIcon()}
                      <span className="text-gray-600">
                        {order.pending_sync
                          ? "في انتظار المزامنة"
                          : order.sync_error
                            ? "فشلت المزامنة"
                            : "تمت المزامنة"}
                      </span>
                    </div>
                    {order.last_synced_at && (
                      <p className="text-gray-600">
                        آخر مزامنة: {formatDate(order.last_synced_at)}
                      </p>
                    )}
                    {order.sync_error && (
                      <p className="text-red-600 text-xs">{order.sync_error}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ProfitSummaryMetric({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm shadow-black/5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function ProfitDetailRow({ label, value, tone = "text-slate-900" }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className={`text-sm font-bold ${tone}`}>{value}</span>
    </div>
  );
}
