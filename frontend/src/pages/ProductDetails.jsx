import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Package,
  Edit2,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
  Clock,
  CheckCircle,
  AlertCircle,
  Copy,
  Image as ImageIcon,
  Printer,
} from "lucide-react";
import api from "../utils/api";
import BarcodeLabelModal from "../components/BarcodeLabelModal";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { normalizeBarcodeVariantTitle } from "../utils/barcodeLabels";
import {
  formatCurrency as formatMoney,
  formatDateTime,
  formatNumber,
} from "../utils/localeFormat";
import {
  buildRealizedOrdersProfitability,
  buildSavedUnitCostSnapshot,
} from "../utils/productProfitability";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatCount = (value) =>
  formatNumber(value, { maximumFractionDigits: 0 });
const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const formatTextList = (values, fallback = "-") => {
  const list = toArray(values)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return list.length > 0 ? list.join(", ") : fallback;
};

const PRODUCT_FIELD_LABELS = {
  price: "Price",
  inventory: "Shopify inventory",
  sku: "SKU",
  variants: "Variant changes",
  cost_price: "Cost price",
  ads_cost: "Ads cost",
  operation_cost: "Operation cost",
  shipping_cost: "Shipping cost",
  supplier_phone: "Supplier phone",
  supplier_location: "Supplier location",
};
const formatFieldList = (fields = []) => {
  const labels = Array.from(
    new Set(
      fields
        .map((field) => PRODUCT_FIELD_LABELS[field] || field)
        .filter(Boolean),
    ),
  );

  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
};
const buildSaveMessage = (result = {}) => {
  const shopifyFields = Array.isArray(result?.shopifyFields)
    ? result.shopifyFields
    : [];
  const localOnlyFields = Array.isArray(result?.localOnlyFields)
    ? result.localOnlyFields
    : [];

  if (shopifyFields.length > 0 && localOnlyFields.length > 0) {
    return `✅ تم الحفظ بنجاح! ${formatFieldList(shopifyFields)} تم مزامنتها مع Shopify. ${formatFieldList(localOnlyFields)} تم حفظها محلياً فقط.`;
  }

  if (shopifyFields.length > 0) {
    return `✅ تم الحفظ والمزامنة مع Shopify بنجاح! تم تحديث: ${formatFieldList(shopifyFields)}`;
  }

  if (localOnlyFields.length > 0) {
    return `✅ تم الحفظ محلياً بنجاح! تم تحديث: ${formatFieldList(localOnlyFields)}`;
  }

  return result?.shopifySync === "synced"
    ? "✅ تم الحفظ والمزامنة مع Shopify بنجاح!"
    : "✅ تم الحفظ محلياً بنجاح!";
};

const cloneVariantDrafts = (variants = []) =>
  variants.map((variant) => ({
    id: String(variant.id || ""),
    price: String(variant.price ?? ""),
    sku: String(variant.sku || ""),
    inventory_quantity: String(toNumber(variant.inventory_quantity)),
  }));

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, hasPermission } = useAuth();
  const { select, currencyLabel } = useLocale();
  const canEditProducts = hasPermission("can_edit_products");
  const canPrintBarcodeLabels = hasPermission("can_print_barcode_labels");
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [barcodeModalTargetKey, setBarcodeModalTargetKey] = useState("");
  const [lowStockAlertsSaving, setLowStockAlertsSaving] = useState(false);

  // Editable fields
  const [editedProduct, setEditedProduct] = useState({});
  const [editedVariants, setEditedVariants] = useState([]);
  const [fulfilledProfitSummary, setFulfilledProfitSummary] = useState(null);
  const [fulfilledProfitError, setFulfilledProfitError] = useState("");

  const hasMultipleVariants = (product?.variants?.length || 0) > 1;
  const editedVariantsById = useMemo(
    () =>
      new Map(editedVariants.map((variant) => [String(variant.id), variant])),
    [editedVariants],
  );

  const displayedInventoryQuantity = useMemo(() => {
    if (!product) return 0;

    if (hasMultipleVariants) {
      return editing
        ? editedVariants.reduce(
            (sum, variant) => sum + toNumber(variant.inventory_quantity),
            0,
          )
        : toNumber(product.inventory_quantity);
    }

    return editing
      ? toNumber(editedProduct.inventory_quantity)
      : toNumber(product.inventory_quantity);
  }, [
    editedProduct.inventory_quantity,
    editedVariants,
    editing,
    hasMultipleVariants,
    product,
  ]);

  const displayedWarehouseInventoryQuantity = useMemo(() => {
    if (!product) return 0;

    return toNumber(
      product.total_warehouse_inventory ?? product.warehouse_inventory_quantity,
    );
  }, [product]);

  const profitabilitySnapshot = useMemo(
    () =>
      buildSavedUnitCostSnapshot(editing ? editedProduct : product, {
        quantity: displayedInventoryQuantity,
      }),
    [displayedInventoryQuantity, editedProduct, editing, product],
  );
  const profitabilityTone =
    profitabilitySnapshot.unitProfit >= 0
      ? {
          wrapper:
            "border-emerald-200 bg-emerald-50/90 text-emerald-900",
          badge: "bg-emerald-100 text-emerald-700",
          subtle: "text-emerald-700",
        }
      : {
          wrapper: "border-rose-200 bg-rose-50/90 text-rose-900",
          badge: "bg-rose-100 text-rose-700",
          subtle: "text-rose-700",
        };
  const realizedOrdersProfitability = useMemo(() => {
    return buildRealizedOrdersProfitability(
      fulfilledProfitSummary,
      profitabilitySnapshot.totalUnitCost,
    );
  }, [fulfilledProfitSummary, profitabilitySnapshot.totalUnitCost]);

  const barcodeTargets = useMemo(() => {
    if (!product) {
      return [];
    }

    const productTitle = String(product.title || "").trim();
    const productVendor = String(product.vendor || "").trim();
    const variants =
      Array.isArray(product.variants) && product.variants.length > 0
        ? product.variants
        : [product];

    return variants
      .map((variant, index) => {
        const resolvedSku = String(
          variant?.sku || (!hasMultipleVariants ? product?.sku : "") || "",
        ).trim();
        const resolvedBarcode = String(
          variant?.barcode ||
            (!hasMultipleVariants ? product?.barcode : "") ||
            "",
        ).trim();

        return {
          key: String(
            variant?.id || product?.id || `product-barcode-target-${index}`,
          ),
          title: productTitle,
          subtitle: normalizeBarcodeVariantTitle(variant?.title, productTitle),
          sku: resolvedSku,
          barcode: resolvedBarcode,
          vendor: productVendor,
        };
      })
      .filter((target) => target.sku || target.barcode);
  }, [hasMultipleVariants, product]);

  const hasPrintableBarcodeTarget = barcodeTargets.length > 0;

  const showNotification = useCallback((message, type = "info") => {
    setNotification({ message, type });

    // Play notification sound for success
    if (type === "success") {
      try {
        // Create a simple success sound
        const audioContext = new (
          window.AudioContext || window.webkitAudioContext
        )();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(
          1000,
          audioContext.currentTime + 0.1,
        );

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(
          0.01,
          audioContext.currentTime + 0.3,
        );

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
      } catch (error) {
        // Ignore audio errors
      }
    }

    // Much longer timeout for success messages to ensure visibility
    const timeout = type === "success" ? 12000 : 7000;
    setTimeout(() => setNotification(null), timeout);
  }, []);

  const fetchProductDetails = useCallback(async () => {
    setLoading(true);
    try {
      const requests = [api.get(`/shopify/products/${id}/details`)];
      if (isAdmin) {
        requests.push(api.get(`/dashboard/products/${id}/fulfilled-profit`));
      }

      const results = await Promise.allSettled(requests);
      const productResult = results[0];

      if (productResult?.status !== "fulfilled") {
        throw productResult?.reason || new Error("Failed to load product");
      }

      const nextProduct = productResult.value.data;
      setProduct(nextProduct);
      setEditedProduct(nextProduct);
      setEditedVariants(cloneVariantDrafts(nextProduct?.variants || []));

      if (isAdmin) {
        const fulfilledProfitResult = results[1];
        if (fulfilledProfitResult?.status === "fulfilled") {
          setFulfilledProfitSummary(fulfilledProfitResult.value.data || null);
          setFulfilledProfitError("");
        } else {
          setFulfilledProfitSummary(null);
          setFulfilledProfitError(
            fulfilledProfitResult?.reason?.response?.data?.error ||
              "تعذر تحميل الربح المحقق من الأوردرات الناجحة",
          );
        }
      } else {
        setFulfilledProfitSummary(null);
        setFulfilledProfitError("");
      }
    } catch (error) {
      console.error("Error fetching product details:", error);
      showNotification("فشل تحميل تفاصيل المنتج", "error");
    } finally {
      setLoading(false);
    }
  }, [id, isAdmin, showNotification]);

  useEffect(() => {
    fetchProductDetails();
  }, [id, fetchProductDetails]);

  useEffect(() => {
    if (!product || searchParams.get("mode") !== "edit") {
      return;
    }

    if (canEditProducts) {
      setEditing(true);
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("mode");
    setSearchParams(nextSearchParams, { replace: true });
  }, [canEditProducts, product, searchParams, setSearchParams]);

  const handleSave = async () => {
    if (!canEditProducts) return;
    setSaving(true);
    try {
      const payload = {};
      const nextPrice = parseFloat(editedProduct.price);
      const nextInventory = parseInt(editedProduct.inventory_quantity, 10);
      const nextSku = String(editedProduct.sku || "").trim();
      const nextSupplierPhone = String(
        editedProduct.supplier_phone || "",
      ).trim();
      const nextSupplierLocation = String(
        editedProduct.supplier_location || "",
      ).trim();

      if (
        !hasMultipleVariants &&
        Number.isFinite(nextPrice) &&
        nextPrice !== toNumber(product.price)
      ) {
        payload.price = nextPrice;
      }

      if (
        !hasMultipleVariants &&
        Number.isFinite(nextInventory) &&
        nextInventory !== toNumber(product.inventory_quantity)
      ) {
        payload.inventory = nextInventory;
      }

      if (isAdmin) {
        const nextCostPrice = parseFloat(editedProduct.cost_price || 0);
        if (
          Number.isFinite(nextCostPrice) &&
          nextCostPrice !== toNumber(product.cost_price)
        ) {
          payload.cost_price = nextCostPrice;
        }

        const nextAdsCost = parseFloat(editedProduct.ads_cost || 0);
        if (
          Number.isFinite(nextAdsCost) &&
          nextAdsCost !== toNumber(product.ads_cost)
        ) {
          payload.ads_cost = nextAdsCost;
        }

        const nextOperationCost = parseFloat(editedProduct.operation_cost || 0);
        if (
          Number.isFinite(nextOperationCost) &&
          nextOperationCost !== toNumber(product.operation_cost)
        ) {
          payload.operation_cost = nextOperationCost;
        }

        const nextShippingCost = parseFloat(editedProduct.shipping_cost || 0);
        if (
          Number.isFinite(nextShippingCost) &&
          nextShippingCost !== toNumber(product.shipping_cost)
        ) {
          payload.shipping_cost = nextShippingCost;
        }
      }

      if (
        !hasMultipleVariants &&
        nextSku !== String(product.sku || "").trim()
      ) {
        payload.sku = nextSku;
      }

      if (nextSupplierPhone !== String(product.supplier_phone || "").trim()) {
        payload.supplier_phone = nextSupplierPhone;
      }

      if (
        nextSupplierLocation !== String(product.supplier_location || "").trim()
      ) {
        payload.supplier_location = nextSupplierLocation;
      }

      const originalVariantsById = new Map(
        (product.variants || []).map((variant) => [
          String(variant.id || ""),
          {
            inventory_quantity: toNumber(variant.inventory_quantity),
            price: toNumber(variant.price),
            sku: String(variant.sku || "").trim(),
          },
        ]),
      );

      const variantUpdates = editedVariants
        .map((variant) => {
          const variantId = String(variant.id || "");
          const originalVariant = originalVariantsById.get(variantId);

          if (!originalVariant) {
            return null;
          }

          const nextVariantUpdate = {
            id: variant.id,
          };

          if (
            toNumber(variant.inventory_quantity) !==
            originalVariant.inventory_quantity
          ) {
            nextVariantUpdate.inventory_quantity = toNumber(
              variant.inventory_quantity,
            );
          }

          if (toNumber(variant.price) !== originalVariant.price) {
            nextVariantUpdate.price = toNumber(variant.price);
          }

          if (String(variant.sku || "").trim() !== originalVariant.sku) {
            nextVariantUpdate.sku = String(variant.sku || "").trim();
          }

          return Object.keys(nextVariantUpdate).length > 1
            ? nextVariantUpdate
            : null;
        })
        .filter(Boolean);

      if (variantUpdates.length > 0) {
        payload.variant_updates = variantUpdates;
      }

      if (Object.keys(payload).length === 0) {
        showNotification("لا توجد تغييرات للحفظ", "info");
        setSaving(false);
        return;
      }

      const response = await api.post(
        `/shopify/products/${id}/update`,
        payload,
      );
      const saveResult = response.data || {};

      // Show detailed success message
      const updatedFields = Object.keys(payload).filter(
        (key) => key !== "variant_updates",
      );
      const variantUpdatesCount = payload.variant_updates
        ? payload.variant_updates.length
        : 0;

      let detailedMessage = buildSaveMessage(saveResult);
      if (updatedFields.length > 0) {
        detailedMessage += ` تم تحديث: ${formatFieldList(updatedFields)}`;
      }
      if (variantUpdatesCount > 0) {
        detailedMessage += ` وتم تحديث ${variantUpdatesCount} متغير`;
      }

      showNotification(detailedMessage, "success");

      // Add a brief flash effect to indicate success
      document.body.style.backgroundColor = "#10b981";
      setTimeout(() => {
        document.body.style.backgroundColor = "";
      }, 200);
      setEditing(false);

      if (saveResult.shopifySync === "synced") {
        setTimeout(() => {
          fetchProductDetails();
        }, 1500);
      } else {
        fetchProductDetails();
      }
    } catch (error) {
      console.error("Error saving product:", error);
      showNotification(error.response?.data?.error || "فشل الحفظ", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedProduct(product);
    setEditedVariants(cloneVariantDrafts(product?.variants || []));
    setEditing(false);
  };

  const handleVariantFieldChange = (variantId, field, value) => {
    setEditedVariants((currentVariants) =>
      currentVariants.map((variant) =>
        String(variant.id) === String(variantId)
          ? {
              ...variant,
              [field]: value,
            }
          : variant,
      ),
    );
  };

  const openBarcodeModal = useCallback(
    (targetKey = "") => {
      if (!canPrintBarcodeLabels) {
        showNotification(
          select(
            "صلاحية طباعة الباركود غير مفعلة لهذا الحساب.",
            "Barcode label printing is not enabled for this account.",
          ),
          "error",
        );
        return;
      }

      if (!hasPrintableBarcodeTarget) {
        showNotification(
          select(
            "لا يوجد SKU أو باركود صالح للطباعة لهذا المنتج.",
            "This product does not have a printable SKU or barcode yet.",
          ),
          "error",
        );
        return;
      }

      setBarcodeModalTargetKey(targetKey);
      setIsBarcodeModalOpen(true);
    },
    [canPrintBarcodeLabels, hasPrintableBarcodeTarget, select, showNotification],
  );

  const toggleLowStockAlerts = useCallback(async () => {
    if (!product || !isAdmin || !canEditProducts || lowStockAlertsSaving) {
      return;
    }

    const nextSuppressed = !Boolean(product?.suppress_low_stock_alerts);
    setLowStockAlertsSaving(true);

    try {
      await api.post(`/shopify/products/${id}/update`, {
        suppress_low_stock_alerts: nextSuppressed,
      });

      setProduct((currentProduct) =>
        currentProduct
          ? {
              ...currentProduct,
              suppress_low_stock_alerts: nextSuppressed,
            }
          : currentProduct,
      );
      setEditedProduct((currentEditedProduct) =>
        currentEditedProduct
          ? {
              ...currentEditedProduct,
              suppress_low_stock_alerts: nextSuppressed,
            }
          : currentEditedProduct,
      );

      showNotification(
        nextSuppressed
          ? select(
              "تم إيقاف تنبيهات المخزون المنخفض لهذا المنتج.",
              "Low-stock alerts were turned off for this product.",
            )
          : select(
              "تم تشغيل تنبيهات المخزون المنخفض لهذا المنتج من جديد.",
              "Low-stock alerts were turned back on for this product.",
            ),
        "success",
      );
    } catch (error) {
      console.error("Error updating low-stock alert preference:", error);
      showNotification(
        error?.response?.data?.error ||
          select(
            "فشل تحديث إعداد تنبيهات المخزون المنخفض.",
            "Failed to update the low-stock alert setting.",
          ),
        "error",
      );
    } finally {
      setLowStockAlertsSaving(false);
    }
  }, [
    canEditProducts,
    id,
    isAdmin,
    lowStockAlertsSaving,
    product,
    select,
    showNotification,
  ]);

  const handleCopyProductReference = async () => {
    try {
      await navigator.clipboard.writeText(String(product?.id || id || ""));
      showNotification(
        select("تم نسخ معرف المنتج", "Product ID copied"),
        "success",
      );
    } catch {
      showNotification(
        select("فشل نسخ معرف المنتج", "Failed to copy product ID"),
        "error",
      );
    }
  };

  const getSyncStatusIcon = () => {
    if (product?.pending_sync) {
      return (
        <Clock
          size={20}
          className="text-yellow-500"
          title="في انتظار المزامنة"
        />
      );
    }
    if (product?.sync_error) {
      return (
        <AlertCircle
          size={20}
          className="text-red-500"
          title={product.sync_error}
        />
      );
    }
    if (product?.last_synced_at) {
      return (
        <CheckCircle
          size={20}
          className="text-green-500"
          title="تمت المزامنة"
        />
      );
    }
    return null;
  };

  const formatDate = (dateString) =>
    formatDateTime(dateString, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  if (loading) {
    return (
      <div className="flex h-screen bg-transparent">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">جاري تحميل تفاصيل المنتج...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex h-screen bg-transparent">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Package size={64} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-lg">لم يتم العثور على المنتج</p>
            <button
              onClick={() => navigate("/products")}
              className="mt-4 text-blue-600 hover:text-blue-700"
            >
              العودة إلى المنتجات
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
              className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-50 px-8 py-6 rounded-2xl shadow-2xl flex items-center gap-4 border-2 animate-in slide-in-from-top-5 duration-500 ${
                notification.type === "success"
                  ? "bg-emerald-500 text-white border-emerald-400"
                  : notification.type === "error"
                    ? "bg-red-500 text-white border-red-400"
                    : "bg-blue-500 text-white border-blue-400"
              }`}
              style={{ minWidth: "400px", maxWidth: "600px" }}
            >
              {notification.type === "success" && (
                <div className="flex-shrink-0">
                  <CheckCircle size={32} className="animate-pulse" />
                </div>
              )}
              {notification.type === "error" && (
                <div className="flex-shrink-0">
                  <AlertCircle size={32} />
                </div>
              )}
              <div className="flex-1">
                <div className="text-lg font-bold mb-1">
                  {notification.type === "success" ? "تم بنجاح!" : "خطأ!"}
                </div>
                <div className="text-sm leading-relaxed opacity-95">
                  {notification.message}
                </div>
              </div>
              <button
                onClick={() => setNotification(null)}
                className="flex-shrink-0 text-white/80 hover:text-white transition-colors"
              >
                <X size={24} />
              </button>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/products")}
                className="app-button-secondary rounded-2xl p-2.5 text-slate-700"
              >
                <ArrowLeft size={24} />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-gray-800">
                    {product.title}
                  </h1>
                  {getSyncStatusIcon()}
                  <button
                    onClick={handleCopyProductReference}
                    className="app-button-secondary inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700"
                    title={select("نسخ معرف المنتج", "Copy product ID")}
                  >
                    <Copy size={14} />
                    {select("نسخ", "Copy")}
                  </button>
                </div>
                <p className="text-gray-600">
                  تم الإنشاء في {formatDate(product.created_at)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {canPrintBarcodeLabels && hasPrintableBarcodeTarget && (
                <button
                  onClick={() => openBarcodeModal(barcodeTargets[0]?.key || "")}
                  className="app-button-secondary flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  <Printer size={16} />
                  {select("طباعة ليبل", "Print label")}
                </button>
              )}
              {canEditProducts &&
                (editing ? (
                  <>
                    <button
                      onClick={handleCancel}
                      disabled={saving}
                      className="app-button-secondary flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      <X size={16} />
                      إلغاء
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="app-button-primary flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          جاري الحفظ...
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          حفظ التغييرات
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setEditing(true)}
                    className="app-button-primary flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    <Edit2 size={16} />
                    تعديل
                  </button>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* Product Image */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-4">
                  صورة المنتج
                </h2>
                <div className="flex h-96 w-full items-center justify-center overflow-hidden rounded-[24px] bg-slate-100">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.title}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImageIcon size={64} className="text-gray-400" />
                  )}
                </div>
              </div>

              {/* Product Description */}
              {product.body_html && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    الوصف
                  </h2>
                  <div
                    className="prose max-w-none text-gray-700"
                    dangerouslySetInnerHTML={{ __html: product.body_html }}
                  />
                </div>
              )}

              <ProductSupplyChainSection
                sourcing={product.supply_chain}
                onOpenSupplier={(supplierId, supplierType = "factory") =>
                  navigate(
                    supplierId
                      ? `${
                          supplierType === "fabric"
                            ? "/suppliers/fabric-suppliers"
                            : "/suppliers"
                        }/${encodeURIComponent(supplierId)}`
                      : supplierType === "fabric"
                        ? "/suppliers/fabric-suppliers"
                        : "/suppliers",
                  )
                }
              />

              {/* Variants */}
              {product.variants && product.variants.length > 0 && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    الأشكال ({product.variants.length})
                  </h2>
                  {hasMultipleVariants && (
                    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      تعديلات المخزون هنا تخص Shopify لكل Variant. مخزون
                      المخزن/السكانر يظهر منفصلًا للمرجعية فقط.
                    </div>
                  )}
                  <div className="space-y-3">
                    {product.variants.map((variant, index) => {
                      const variantDraft =
                        editedVariantsById.get(String(variant.id || "")) || {};
                      const displayedVariantPrice =
                        editing && hasMultipleVariants
                          ? (variantDraft.price ?? variant.price)
                          : variant.price;
                      const displayedVariantSku =
                        editing && hasMultipleVariants
                          ? (variantDraft.sku ?? variant.sku)
                          : variant.sku;
                      const displayedVariantInventory = toNumber(
                        editing && hasMultipleVariants
                          ? (variantDraft.inventory_quantity ??
                              variant.inventory_quantity)
                          : variant.inventory_quantity,
                      );
                      const displayedVariantWarehouseInventory = toNumber(
                        variant.warehouse_inventory_quantity,
                      );

                      return (
                        <div
                          key={index}
                          className="rounded-[24px] border border-slate-200 bg-white/80 p-4 transition hover:border-slate-300 hover:bg-white"
                          data-variant-inventory={displayedVariantInventory}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <p className="font-semibold text-gray-800">
                                {variant.title}
                              </p>
                              {(displayedVariantSku ||
                                (editing && hasMultipleVariants)) && (
                                <p className="text-sm text-gray-600">
                                  SKU: {displayedVariantSku || "-"}
                                </p>
                              )}
                              {variant.barcode && (
                                <p className="text-sm text-gray-600">
                                  Barcode: {variant.barcode}
                                </p>
                              )}
                              {variant.weight && (
                                <p className="text-sm text-gray-600">
                                  الوزن: {variant.weight} {variant.weight_unit}
                                </p>
                              )}
                              <div className="flex gap-4 mt-2">
                                {variant.option1 && (
                                  <span className="app-chip px-2.5 py-1 text-xs text-slate-700">
                                    {variant.option1}
                                  </span>
                                )}
                                {variant.option2 && (
                                  <span className="app-chip px-2.5 py-1 text-xs text-slate-700">
                                    {variant.option2}
                                  </span>
                                )}
                                {variant.option3 && (
                                  <span className="app-chip px-2.5 py-1 text-xs text-slate-700">
                                    {variant.option3}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-left">
                              <p className="text-lg font-bold text-gray-800">
                                {formatMoney(displayedVariantPrice)}
                              </p>
                              {variant.compare_at_price &&
                                parseFloat(variant.compare_at_price) >
                                  parseFloat(displayedVariantPrice) && (
                                  <p className="text-sm text-gray-500 line-through">
                                    {formatMoney(variant.compare_at_price)}
                                  </p>
                                )}
                              <p
                                className={`text-sm ${
                                  toNumber(
                                    editing
                                      ? (editedVariantsById.get(
                                          String(variant.id || ""),
                                        )?.inventory_quantity ??
                                          variant.inventory_quantity)
                                      : variant.inventory_quantity,
                                  ) > 10
                                    ? "text-green-600"
                                    : toNumber(
                                          editing
                                            ? (editedVariantsById.get(
                                                String(variant.id || ""),
                                              )?.inventory_quantity ??
                                                variant.inventory_quantity)
                                            : variant.inventory_quantity,
                                        ) > 0
                                      ? "text-yellow-600"
                                      : "text-red-600"
                                }`}
                              >
                                Shopify: {displayedVariantInventory}
                              </p>
                              <p className="text-sm text-slate-600">
                                Warehouse: {displayedVariantWarehouseInventory}
                              </p>
                              {displayedVariantInventory !==
                              displayedVariantWarehouseInventory ? (
                                <p className="mt-1 text-xs text-amber-700">
                                  فيه فرق بين Shopify والمخزن لهذا الـ Variant.
                                </p>
                              ) : null}
                              {canPrintBarcodeLabels &&
                              (variant.barcode || displayedVariantSku) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    openBarcodeModal(
                                      String(
                                        variant.id ||
                                          barcodeTargets[0]?.key ||
                                          "",
                                      ),
                                    )
                                  }
                                  className="mt-3 app-button-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700"
                                >
                                  <Printer size={14} />
                                  {select("طباعة ليبل", "Print label")}
                                </button>
                              )}
                              {editing &&
                                canEditProducts &&
                                hasMultipleVariants && (
                                  <div className="mt-3 space-y-3">
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-600">
                                        SKU
                                      </label>
                                      <input
                                        type="text"
                                        value={
                                          variantDraft.sku ??
                                          String(variant.sku || "")
                                        }
                                        onChange={(event) =>
                                          handleVariantFieldChange(
                                            variant.id,
                                            "sku",
                                            event.target.value,
                                          )
                                        }
                                        className="app-input w-full px-3 py-2.5 text-sm"
                                        placeholder="SKU-001"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-600">
                                        {select("تعديل السعر", "Edit price")}
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={
                                          variantDraft.price ??
                                          String(variant.price ?? "")
                                        }
                                        onChange={(event) =>
                                          handleVariantFieldChange(
                                            variant.id,
                                            "price",
                                            event.target.value,
                                          )
                                        }
                                        className="app-input w-full px-3 py-2.5 text-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-1 block text-xs font-medium text-gray-600">
                                        تعديل مخزون هذا الـ Variant
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={
                                          editedVariantsById.get(
                                            String(variant.id || ""),
                                          )?.inventory_quantity ??
                                          String(
                                            toNumber(
                                              variant.inventory_quantity,
                                            ),
                                          )
                                        }
                                        onChange={(event) =>
                                          handleVariantFieldChange(
                                            variant.id,
                                            "inventory_quantity",
                                            event.target.value,
                                          )
                                        }
                                        className="app-input w-full px-3 py-2.5 text-sm"
                                      />
                                    </div>
                                  </div>
                                )}
                              {variant.requires_shipping && (
                                <p className="text-xs text-gray-500 mt-1">
                                  يتطلب شحن
                                </p>
                              )}
                              {variant.taxable && (
                                <p className="text-xs text-gray-500">
                                  خاضع للضريبة
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Product Images Gallery */}
              {product.images && product.images.length > 1 && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    معرض الصور ({product.images.length})
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {product.images.map((image, index) => (
                      <div
                        key={index}
                        className="relative aspect-square overflow-hidden rounded-[22px] bg-slate-100 transition hover:shadow-lg"
                      >
                        <img
                          src={image.src}
                          alt={image.alt || `صورة ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        {image.alt && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-2">
                            {image.alt}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Product Options */}
              {product.options && product.options.length > 0 && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    خيارات المنتج
                  </h2>
                  <div className="space-y-4">
                    {product.options.map((option, index) => (
                      <div
                        key={index}
                        className="border-b border-gray-200 pb-4 last:border-0"
                      >
                        <p className="font-semibold text-gray-800 mb-2">
                          {option.name}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {option.values.map((value, vIndex) => (
                            <span
                              key={vIndex}
                              className="px-3 py-1 bg-blue-50 text-blue-800 rounded-lg text-sm"
                            >
                              {value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SEO Information */}
              {(product.seo_title ||
                product.seo_description ||
                product.handle) && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-4">
                    معلومات SEO
                  </h2>
                  <div className="space-y-3">
                    {product.handle && (
                      <div>
                        <p className="text-sm text-gray-600">Handle (URL)</p>
                        <p className="font-mono text-gray-800 bg-gray-50 px-3 py-2 rounded">
                          {product.handle}
                        </p>
                      </div>
                    )}
                    {product.seo_title && (
                      <div>
                        <p className="text-sm text-gray-600">عنوان SEO</p>
                        <p className="text-gray-800">{product.seo_title}</p>
                      </div>
                    )}
                    {product.seo_description && (
                      <div>
                        <p className="text-sm text-gray-600">وصف SEO</p>
                        <p className="text-gray-700 text-sm">
                          {product.seo_description}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Price & Inventory */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">
                  السعر والمخزون
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      السعر ({currencyLabel})
                    </label>
                    {editing && !hasMultipleVariants ? (
                      <input
                        type="number"
                        value={editedProduct.price}
                        onChange={(e) =>
                          setEditedProduct({
                            ...editedProduct,
                            price: e.target.value,
                          })
                        }
                        min="0"
                        step="0.01"
                        className="app-input w-full px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-gray-800">
                          {formatMoney(product.price)}
                        </p>
                        {editing && hasMultipleVariants && (
                          <p className="mt-2 text-sm text-slate-600">
                            Edit each variant price in the variants section.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {isAdmin && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          سعر التكلفة ({currencyLabel})
                        </label>
                        {editing ? (
                          <input
                            type="number"
                            value={editedProduct.cost_price || 0}
                            onChange={(e) =>
                              setEditedProduct({
                                ...editedProduct,
                                cost_price: e.target.value,
                              })
                            }
                            min="0"
                            step="0.01"
                            className="app-input w-full px-3 py-2.5 text-sm"
                          />
                        ) : (
                          <p className="text-2xl font-bold text-gray-800">
                            {formatMoney(product.cost_price || 0)}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          تكلفة الإعلانات ({currencyLabel})
                        </label>
                        {editing ? (
                          <input
                            type="number"
                            value={editedProduct.ads_cost || 0}
                            onChange={(e) =>
                              setEditedProduct({
                                ...editedProduct,
                                ads_cost: e.target.value,
                              })
                            }
                            min="0"
                            step="0.01"
                            className="app-input w-full px-3 py-2.5 text-sm"
                          />
                        ) : (
                          <p className="text-2xl font-bold text-gray-800">
                            {formatMoney(product.ads_cost || 0)}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          تكلفة التشغيل ({currencyLabel})
                        </label>
                        {editing ? (
                          <input
                            type="number"
                            value={editedProduct.operation_cost || 0}
                            onChange={(e) =>
                              setEditedProduct({
                                ...editedProduct,
                                operation_cost: e.target.value,
                              })
                            }
                            min="0"
                            step="0.01"
                            className="app-input w-full px-3 py-2.5 text-sm"
                          />
                        ) : (
                          <p className="text-2xl font-bold text-gray-800">
                            {formatMoney(product.operation_cost || 0)}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          تكلفة الشحن ({currencyLabel})
                        </label>
                        {editing ? (
                          <input
                            type="number"
                            value={editedProduct.shipping_cost || 0}
                            onChange={(e) =>
                              setEditedProduct({
                                ...editedProduct,
                                shipping_cost: e.target.value,
                              })
                            }
                            min="0"
                            step="0.01"
                            className="app-input w-full px-3 py-2.5 text-sm"
                          />
                        ) : (
                          <p className="text-2xl font-bold text-gray-800">
                            {formatMoney(product.shipping_cost || 0)}
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {isAdmin && profitabilitySnapshot.hasValues && (
                    <div className="pt-4 border-t border-gray-200">
                      <div
                        className={`rounded-2xl border p-4 shadow-sm ${profitabilityTone.wrapper}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">
                              {editing ? "معاينة الربحية المباشرة" : "ملخص الربحية"}
                            </p>
                            <p className={`mt-1 text-xs ${profitabilityTone.subtle}`}>
                              التكلفة تشمل سعر التكلفة والإعلانات والتشغيل والشحن
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${profitabilityTone.badge}`}
                          >
                            {profitabilitySnapshot.unitProfit >= 0
                              ? "المنتج مربح"
                              : "المنتج بخسارة"}
                          </span>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <ProfitMetric
                            label="إجمالي التكلفة لكل وحدة"
                            value={formatMoney(
                              profitabilitySnapshot.totalUnitCost,
                            )}
                            tone={profitabilityTone.subtle}
                          />
                          <ProfitMetric
                            label="الربح لكل وحدة"
                            value={formatMoney(profitabilitySnapshot.unitProfit)}
                            tone={profitabilityTone.subtle}
                          />
                          <ProfitMetric
                            label="هامش الربح"
                            value={`${profitabilitySnapshot.profitMargin.toFixed(2)}%`}
                            tone={profitabilityTone.subtle}
                          />
                          <ProfitMetric
                            label="Saved Cost Mix / Unit"
                            value={`${formatMoney(
                              profitabilitySnapshot.costPrice,
                            )} + ${formatMoney(
                              profitabilitySnapshot.adsCost,
                            )} + ${formatMoney(
                              profitabilitySnapshot.operationCost,
                            )} + ${formatMoney(
                              profitabilitySnapshot.shippingCost,
                            )}`}
                            tone={profitabilityTone.subtle}
                          />
                          {realizedOrdersProfitability.hasData ? (
                            <>
                              <ProfitMetric
                                label="Saved Costs On Fulfilled Units"
                                value={formatMoney(
                                  realizedOrdersProfitability.savedProductCostsTotal,
                                )}
                                tone={profitabilityTone.subtle}
                              />
                              <ProfitMetric
                                label="Tracked Extra Costs"
                                value={formatMoney(
                                  realizedOrdersProfitability.totalOperationalCosts,
                                )}
                                tone={profitabilityTone.subtle}
                              />
                              <ProfitMetric
                                label="إيراد الأوردرات الناجحة"
                                value={formatMoney(
                                  realizedOrdersProfitability.totalRevenue,
                                )}
                                tone={profitabilityTone.subtle}
                              />
                              <ProfitMetric
                                label="صافي ربح الأوردرات الناجحة"
                                value={formatMoney(
                                  realizedOrdersProfitability.netProfit,
                                )}
                                tone={
                                  realizedOrdersProfitability.netProfit >= 0
                                    ? "text-emerald-700"
                                    : "text-rose-700"
                                }
                              />
                              <ProfitMetric
                                label="الوحدات المتسلمة / عدد الأوردرات"
                                value={`${formatCount(
                                  realizedOrdersProfitability.fulfilledUnits,
                                )} / ${formatCount(
                                  realizedOrdersProfitability.successfulOrdersCount,
                                )}`}
                                tone={profitabilityTone.subtle}
                              />
                            </>
                          ) : (
                            <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-white/70 bg-white/70 px-4 py-4 text-sm text-slate-600">
                              {fulfilledProfitError ||
                                "هنا هيظهر الربح المحقق من الأوردرات اللي اتعملت واتسلمت بنجاح، مش الربح المحتمل من الستوك."}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {hasMultipleVariants
                        ? "إجمالي مخزون Shopify"
                        : "مخزون Shopify"}
                    </label>
                    {editing && !hasMultipleVariants ? (
                      <input
                        type="number"
                        value={editedProduct.inventory_quantity}
                        onChange={(e) =>
                          setEditedProduct({
                            ...editedProduct,
                            inventory_quantity: e.target.value,
                          })
                        }
                        min="0"
                        step="1"
                        className="app-input w-full px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <>
                        <p
                          className={`text-2xl font-bold ${
                            displayedInventoryQuantity > 10
                              ? "text-green-600"
                              : displayedInventoryQuantity > 0
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {displayedInventoryQuantity}
                        </p>
                        {editing && hasMultipleVariants && (
                          <p className="mt-2 text-sm text-slate-600">
                            عدل مخزون Shopify لكل Variant من قسم الأشكال.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-medium text-slate-700">
                      مخزون المخزن
                    </p>
                    <p
                      className={`mt-2 text-2xl font-bold ${
                        displayedWarehouseInventoryQuantity > 0
                          ? "text-emerald-600"
                          : "text-slate-500"
                      }`}
                    >
                      {displayedWarehouseInventoryQuantity}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      هذا الرصيد يأتي من الـ warehouse/scanner ولا يتعدل من هذه الصفحة.
                    </p>
                  </div>
                </div>
              </div>

              {/* Product Info */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">
                  معلومات المنتج
                </h2>
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    SKU and inventory edits here sync to Shopify. Warehouse stock
                    is tracked separately in Warehouse and Scanner pages.
                  </div>
                  {product.vendor && (
                    <div>
                      <p className="text-sm text-gray-600">Vendor في Shopify</p>
                      <p className="font-semibold text-gray-800">
                        {product.vendor}
                      </p>
                    </div>
                  )}
                  {product.product_type && (
                    <div>
                      <p className="text-sm text-gray-600">النوع</p>
                      <p className="font-semibold text-gray-800">
                        {product.product_type}
                      </p>
                    </div>
                  )}
                  {(editing && !hasMultipleVariants) || product.sku ? (
                    <div>
                      <p className="text-sm text-gray-600">SKU</p>
                      {editing && !hasMultipleVariants ? (
                        <input
                          type="text"
                          value={editedProduct.sku || ""}
                          onChange={(e) =>
                            setEditedProduct({
                              ...editedProduct,
                              sku: e.target.value,
                            })
                          }
                          className="app-input w-full px-3 py-2.5 text-sm"
                          placeholder="SKU-001"
                        />
                      ) : (
                        <p className="font-semibold text-gray-800">
                          {product.sku || "-"}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Primary SKU syncs to Shopify.
                      </p>
                    </div>
                  ) : null}
                  {editing && hasMultipleVariants && (
                    <div>
                      <p className="text-sm text-gray-600">SKU</p>
                      <p className="font-semibold text-gray-800">
                        Edit each variant SKU in the variants section.
                      </p>
                    </div>
                  )}
                  {(editing || product.supplier_phone) && (
                    <div>
                      <p className="text-sm text-gray-600">Supplier Phone</p>
                      {editing ? (
                        <input
                          type="text"
                          value={editedProduct.supplier_phone || ""}
                          onChange={(e) =>
                            setEditedProduct({
                              ...editedProduct,
                              supplier_phone: e.target.value,
                            })
                          }
                          className="app-input w-full px-3 py-2.5 text-sm"
                          placeholder="01000000000"
                        />
                      ) : (
                        <p className="font-semibold text-gray-800">
                          {product.supplier_phone || "-"}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Saved locally on this product. Not synced to Shopify.
                      </p>
                    </div>
                  )}
                  {(editing || product.supplier_location) && (
                    <div>
                      <p className="text-sm text-gray-600">Supplier Location</p>
                      {editing ? (
                        <input
                          type="text"
                          value={editedProduct.supplier_location || ""}
                          onChange={(e) =>
                            setEditedProduct({
                              ...editedProduct,
                              supplier_location: e.target.value,
                            })
                          }
                          className="app-input w-full px-3 py-2.5 text-sm"
                          placeholder="Warehouse, city, or supplier location"
                        />
                      ) : (
                        <p className="font-semibold text-gray-800">
                          {product.supplier_location || "-"}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Saved locally on this product. Not synced to Shopify.
                      </p>
                    </div>
                  )}
                  {product.barcode && (
                    <div>
                      <p className="text-sm text-gray-600">Barcode</p>
                      <p className="font-semibold text-gray-800">
                        {product.barcode}
                      </p>
                    </div>
                  )}
                  {product.weight && (
                    <div>
                      <p className="text-sm text-gray-600">الوزن</p>
                      <p className="font-semibold text-gray-800">
                        {product.weight} {product.weight_unit || "kg"}
                      </p>
                    </div>
                  )}
                  {product.weight_min !== undefined &&
                    product.weight_max !== undefined && (
                      <div>
                        <p className="text-sm text-gray-600">نطاق الوزن</p>
                        <p className="font-semibold text-gray-800">
                          {product.weight_min} - {product.weight_max} جرام
                        </p>
                      </div>
                    )}
                  {product.total_shopify_inventory !== undefined && (
                    <div>
                      <p className="text-sm text-gray-600">إجمالي مخزون Shopify</p>
                      <p className="font-semibold text-gray-800">
                        {product.total_shopify_inventory} وحدة
                      </p>
                    </div>
                  )}
                  {product.total_warehouse_inventory !== undefined && (
                    <div>
                      <p className="text-sm text-gray-600">إجمالي مخزون المخزن</p>
                      <p className="font-semibold text-gray-800">
                        {product.total_warehouse_inventory} وحدة
                      </p>
                    </div>
                  )}
                  {product.requires_shipping !== undefined && (
                    <div>
                      <p className="text-sm text-gray-600">يتطلب شحن</p>
                      <p className="font-semibold text-gray-800">
                        {product.requires_shipping ? "نعم" : "لا"}
                      </p>
                    </div>
                  )}
                  {product.taxable !== undefined && (
                    <div>
                      <p className="text-sm text-gray-600">خاضع للضريبة</p>
                      <p className="font-semibold text-gray-800">
                        {product.taxable ? "نعم" : "لا"}
                      </p>
                    </div>
                  )}
                  {product.inventory_tracked !== undefined && (
                    <div>
                      <p className="text-sm text-gray-600">تتبع المخزون</p>
                      <p className="font-semibold text-gray-800">
                        {product.inventory_tracked ? "نعم" : "لا"}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Price Range */}
              {product.price_varies && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    نطاق السعر
                  </h2>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-gray-600">أقل سعر</p>
                      <p className="text-xl font-bold text-gray-800">
                        {formatMoney(product.price_min)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">أعلى سعر</p>
                      <p className="text-xl font-bold text-gray-800">
                        {formatMoney(product.price_max)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Sale Information */}
              {product.on_sale && product.compare_at_price_min && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    معلومات التخفيض
                  </h2>
                  <div className="bg-red-50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-red-500 text-white text-xs font-bold rounded">
                        تخفيض
                      </span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">السعر الأصلي</p>
                      <p className="text-lg font-bold text-gray-500 line-through">
                        {formatMoney(product.compare_at_price_min)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">السعر بعد التخفيض</p>
                      <p className="text-xl font-bold text-red-600">
                        {formatMoney(product.price_min)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">نسبة التخفيض</p>
                      <p className="text-lg font-bold text-red-600">
                        {(
                          ((product.compare_at_price_min - product.price_min) /
                            product.compare_at_price_min) *
                          100
                        ).toFixed(0)}
                        %
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tags */}
              {product.tags && product.tags.length > 0 && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    الوسوم
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {product.tags.split(",").map((tag, index) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                      >
                        {tag.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Product Health */}
              <div className="app-surface rounded-[28px] p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">
                      {select("صحة المنتج", "Product health")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {select(
                        "ملخص سريع لحالة التوفر والمتابعة التشغيلية لهذا المنتج.",
                        "A quick read on availability and operational follow-up for this product.",
                      )}
                    </p>
                  </div>
                  {isAdmin && canEditProducts && (
                    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                      <ShieldCheck size={14} />
                      {select("تحكم إداري", "Admin control")}
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm text-gray-600">حالة المنتج</p>
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                        product.status === "active"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {product.status === "active" ? "نشط" : "غير نشط"}
                    </span>
                  </div>
                  {product.published_at && (
                    <div>
                      <p className="text-sm text-gray-600">تاريخ النشر</p>
                      <p className="text-gray-800 text-sm">
                        {formatDate(product.published_at)}
                      </p>
                    </div>
                  )}
                  {product.published_scope && (
                    <div>
                      <p className="text-sm text-gray-600">نطاق النشر</p>
                      <p className="text-gray-800">{product.published_scope}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-600">حالة المخزون</p>
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                        displayedInventoryQuantity > 10
                          ? "bg-green-100 text-green-800"
                          : displayedInventoryQuantity > 0
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                      }`}
                    >
                      {displayedInventoryQuantity > 10
                        ? "متوفر"
                        : displayedInventoryQuantity > 0
                          ? "كمية قليلة"
                          : "نفذ من المخزون"}
                    </span>
                  </div>

                  {isAdmin && canEditProducts && (
                    <div className="pt-3">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div
                              className={`mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl ${
                                product?.suppress_low_stock_alerts
                                  ? "bg-slate-900 text-white"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {product?.suppress_low_stock_alerts ? (
                                <BellOff size={18} />
                              ) : (
                                <Bell size={18} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">
                                {select(
                                  "تنبيهات المخزون المنخفض",
                                  "Low-stock alerts",
                                )}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-slate-600">
                                {product?.suppress_low_stock_alerts
                                  ? select(
                                      "متوقفة لهذا المنتج. سيظل المخزون ظاهرًا هنا، لكن المنتج لن يدخل في التنبيهات أو قوائم ضغط المخزون.",
                                      "Paused for this product. Inventory still appears here, but the product stays out of alerts and stock-pressure lists.",
                                    )
                                  : select(
                                      "شغالة بشكل طبيعي. المنتج يدخل في تنبيهات المخزون المنخفض وكل القوائم التشغيلية المرتبطة بها.",
                                      "Active normally. The product participates in low-stock alerts and all related operational lists.",
                                    )}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                              product?.suppress_low_stock_alerts
                                ? "bg-slate-900 text-white"
                                : "bg-emerald-100 text-emerald-700"
                            }`}
                          >
                            {product?.suppress_low_stock_alerts
                              ? select("متوقفة", "Paused")
                              : select("شغالة", "Active")}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={toggleLowStockAlerts}
                          disabled={lowStockAlertsSaving}
                          className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            product?.suppress_low_stock_alerts
                              ? "app-button-primary text-white"
                              : "border border-slate-300 bg-white text-slate-900 hover:bg-slate-100"
                          }`}
                        >
                          {lowStockAlertsSaving ? (
                            <RefreshCw size={16} className="animate-spin" />
                          ) : product?.suppress_low_stock_alerts ? (
                            <Bell size={16} />
                          ) : (
                            <BellOff size={16} />
                          )}
                          {product?.suppress_low_stock_alerts
                            ? select(
                                "تشغيل تنبيهات المخزون المنخفض",
                                "Turn low-stock alerts on",
                              )
                            : select(
                                "إيقاف تنبيهات المخزون المنخفض",
                                "Turn low-stock alerts off",
                              )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sync Status */}
              {product.last_synced_at && (
                <div className="app-surface rounded-[28px] p-6">
                  <h2 className="text-lg font-bold text-gray-800 mb-4">
                    حالة المزامنة
                  </h2>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      {getSyncStatusIcon()}
                      <span className="text-gray-600">
                        {product.pending_sync
                          ? "في انتظار المزامنة"
                          : product.sync_error
                            ? "فشلت المزامنة"
                            : "تمت المزامنة"}
                      </span>
                    </div>
                    {product.last_synced_at && (
                      <p className="text-gray-600">
                        آخر مزامنة: {formatDate(product.last_synced_at)}
                      </p>
                    )}
                    {product.sync_error && (
                      <p className="text-red-600 text-xs">
                        {product.sync_error}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <div className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-gray-800 mb-4">
                  التواريخ
                </h2>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-gray-600">تاريخ الإنشاء</p>
                    <p className="text-gray-800">
                      {formatDate(product.created_at)}
                    </p>
                  </div>
                  {product.updated_at && (
                    <div>
                      <p className="text-gray-600">آخر تحديث</p>
                      <p className="text-gray-800">
                        {formatDate(product.updated_at)}
                      </p>
                    </div>
                  )}
                  {product.local_updated_at && (
                    <div>
                      <p className="text-gray-600">آخر تحديث محلي</p>
                      <p className="text-gray-800">
                        {formatDate(product.local_updated_at)}
                      </p>
                    </div>
                  )}
                  {product.shopify_updated_at && (
                    <div>
                      <p className="text-gray-600">آخر تحديث من Shopify</p>
                      <p className="text-gray-800">
                        {formatDate(product.shopify_updated_at)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <BarcodeLabelModal
        open={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        targets={barcodeTargets}
        defaultTargetKey={barcodeModalTargetKey}
      />
    </div>
  );
}

function ProductSupplyChainSection({ sourcing, onOpenSupplier }) {
  const { select, isRTL, languageTag } = useLocale();
  if (!sourcing) {
    return null;
  }

  const factorySuppliers = toArray(
    sourcing.factory_suppliers || sourcing.suppliers,
  );
  const fabricSuppliers = toArray(sourcing.fabric_suppliers);
  const fabrics = toArray(sourcing.fabrics);
  const variants = toArray(sourcing.variants);
  const deliveries = toArray(sourcing.deliveries);
  const textAlignClass = isRTL ? "text-right" : "text-left";
  const miniStatsAlignClass = isRTL ? "text-right" : "text-left";

  return (
    <div className="app-surface rounded-[28px] p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className={textAlignClass}>
          <h2 className="text-xl font-bold text-gray-800">
            {select("سلسلة التوريد", "Supply Chain")}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {select(
              "المصانع ومورّدو القماش والأقمشة والواردات المرتبطة بهذا المنتج بشكل مباشر.",
              "Factories, fabric suppliers, fabrics, and deliveries linked to this product.",
            )}
          </p>
        </div>
        <button
          onClick={() => onOpenSupplier("", "factory")}
          className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
        >
          {select("فتح شاشة الموردين", "Open suppliers")}
        </button>
      </div>

      {sourcing.deliveries_count > 0 ? (
        <>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SupplyMetric
              label={select("عدد المصانع", "Factories")}
              value={formatCount(factorySuppliers.length)}
            />
            <SupplyMetric
              label={select("عدد مورّدي القماش", "Fabric Suppliers")}
              value={formatCount(
                sourcing.fabric_supplier_count || fabricSuppliers.length,
              )}
            />
            <SupplyMetric
              label={select("عدد الواردات", "Deliveries")}
              value={formatCount(sourcing.deliveries_count)}
            />
            <SupplyMetric
              label={select("إجمالي التكلفة", "Total Cost")}
              value={formatMoney(sourcing.total_cost)}
            />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="space-y-3">
              <h3
                className={`text-base font-semibold text-gray-800 ${textAlignClass}`}
              >
                {select("المصانع", "Factories")}
              </h3>
              {factorySuppliers.map((supplier) => (
                <div
                  key={supplier.supplier_id || supplier.name}
                  className="rounded-xl border border-gray-200 bg-gray-50 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className={textAlignClass}>
                      <div className="text-sm font-semibold text-gray-900">
                        {supplier.name || "-"}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {supplier.code
                          ? `${select("الكود", "Code")}: ${supplier.code}`
                          : select("بدون كود", "No code")}
                        {supplier.phone ? ` | ${supplier.phone}` : ""}
                      </div>
                    </div>
                    {supplier.supplier_id ? (
                      <button
                        onClick={() =>
                          onOpenSupplier(supplier.supplier_id, "factory")
                        }
                        className="app-button-secondary rounded-xl px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        {select("فتح المورد", "Open supplier")}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <SupplyInlineStat
                      label={select("الكمية", "Quantity")}
                      value={formatCount(supplier.total_quantity)}
                    />
                    <SupplyInlineStat
                      label={select("التكلفة", "Cost")}
                      value={formatMoney(supplier.total_cost)}
                    />
                    <SupplyInlineStat
                      label={select("الأقمشة", "Fabrics")}
                      value={formatTextList(supplier.fabrics)}
                    />
                    <SupplyInlineStat
                      label={select("المتغيرات", "Variants")}
                      value={formatTextList(supplier.variants)}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div
                  className={`text-sm font-semibold text-gray-900 ${textAlignClass}`}
                >
                  {select("مورّدو القماش", "Fabric Suppliers")}
                </div>
                {fabricSuppliers.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {fabricSuppliers.map((supplier) => (
                      <div
                        key={supplier.supplier_id || supplier.name}
                        className="rounded-lg border border-gray-200 bg-white p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className={textAlignClass}>
                            <div className="text-sm font-medium text-gray-900">
                              {supplier.name || "-"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {supplier.code
                                ? `${select("الكود", "Code")}: ${supplier.code}`
                                : select("بدون كود", "No code")}
                            </div>
                          </div>
                          {supplier.supplier_id ? (
                            <button
                              onClick={() =>
                                onOpenSupplier(supplier.supplier_id, "fabric")
                              }
                              className="app-button-secondary rounded-xl px-3 py-2 text-sm font-semibold text-slate-700"
                            >
                              {select("فتح المورد", "Open supplier")}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <SupplyInlineStat
                            label={select("الأقمشة", "Fabrics")}
                            value={formatTextList(supplier.fabrics)}
                          />
                          <SupplyInlineStat
                            label={select("التكلفة", "Cost")}
                            value={formatMoney(supplier.total_cost)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-gray-500">
                    {select(
                      "لا يوجد مورّدو قماش مرتبطون بهذا المنتج حتى الآن.",
                      "No fabric suppliers are linked to this product yet.",
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div
                  className={`text-sm font-semibold text-gray-900 ${textAlignClass}`}
                >
                  {select("الأقمشة المرتبطة", "Linked Fabrics")}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {fabrics.length > 0 ? (
                    fabrics.map((fabric) => (
                      <span
                        key={fabric.key || fabric.fabric_name}
                        className="rounded-full bg-white px-3 py-1 text-sm text-gray-700 border border-gray-200"
                      >
                        {fabric.fabric_code
                          ? `${fabric.fabric_code} | ${fabric.fabric_name}`
                          : fabric.fabric_name}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-gray-500">
                      {select("لا توجد أقمشة مسجلة.", "No fabrics recorded.")}
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div
                  className={`text-sm font-semibold text-gray-900 ${textAlignClass}`}
                >
                  {select("تفاصيل المتغيرات", "Variant Details")}
                </div>
                {variants.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {variants.map((variant) => (
                      <div
                        key={
                          variant.key ||
                          `${variant.product_name}-${variant.variant_title}`
                        }
                        className="rounded-lg border border-gray-200 bg-white p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {variant.variant_title ||
                                variant.product_name ||
                                "-"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {variant.sku
                                ? `SKU: ${variant.sku}`
                                : select("بدون SKU", "No SKU")}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-gray-800">
                            {formatCount(variant.total_quantity)}{" "}
                            {select("قطعة", "pcs")}
                          </div>
                        </div>
                        <div className="mt-2 text-xs text-gray-600">
                          {select("الخامات", "Materials")}:{" "}
                          {formatTextList(variant.fabrics)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-gray-500">
                    {select(
                      "لا توجد متغيرات أو موردون مسجلون لهذا المنتج حتى الآن.",
                      "No variants or supplier links are recorded for this product yet.",
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <h3
              className={`text-base font-semibold text-gray-800 ${textAlignClass}`}
            >
              {select("آخر الواردات", "Recent Deliveries")}
            </h3>
            {deliveries.map((delivery) => (
              <details
                key={delivery.id}
                className="rounded-xl border border-gray-200 bg-gray-50"
              >
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className={textAlignClass}>
                      <div className="text-sm font-semibold text-gray-900">
                        {delivery.supplier_name ||
                          select("مورد غير محدد", "Unknown supplier")}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {delivery.entry_date
                          ? formatDateTime(
                              delivery.entry_date,
                              {
                                year: "numeric",
                                month: "2-digit",
                                day: "2-digit",
                              },
                              languageTag,
                            )
                          : select("بدون تاريخ", "No date")}
                        {delivery.reference_code
                          ? ` | ${select("مرجع", "Ref")}: ${delivery.reference_code}`
                          : ""}
                      </div>
                    </div>
                    <div
                      className={`grid grid-cols-2 gap-2 text-xs sm:min-w-[220px] ${miniStatsAlignClass}`}
                    >
                      <SupplyMiniStat
                        label={select("الكمية", "Quantity")}
                        value={formatCount(delivery.quantity)}
                      />
                      <SupplyMiniStat
                        label={select("التكلفة", "Cost")}
                        value={formatMoney(delivery.total_cost)}
                      />
                    </div>
                  </div>
                </summary>
                <div className="border-t border-gray-200 bg-white p-4">
                  <div className="space-y-3">
                    {toArray(delivery.items).map((item, index) => (
                      <div
                        key={`${delivery.id}-${index}`}
                        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {item.variant_title || item.product_name || "-"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {item.sku
                                ? `SKU: ${item.sku}`
                                : select("بدون SKU", "No SKU")}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-gray-800">
                            {formatMoney(item.total_cost)}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <SupplyInlineStat
                            label={select("القماش", "Fabric")}
                            value={
                              item.fabric_code
                                ? `${item.fabric_code} | ${item.fabric_name || item.material || "-"}`
                                : item.fabric_name || item.material || "-"
                            }
                          />
                          <SupplyInlineStat
                            label={select("مورد القماش", "Fabric Supplier")}
                            value={item.fabric_supplier_name || "-"}
                          />
                          <SupplyInlineStat
                            label={select("الكمية", "Quantity")}
                            value={formatCount(item.quantity)}
                          />
                          <SupplyInlineStat
                            label={select("الوصف", "Description")}
                            value={item.material || "-"}
                          />
                          <SupplyInlineStat
                            label={select("تكلفة الوحدة", "Unit Cost")}
                            value={formatMoney(item.unit_cost)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
          {select(
            "لا توجد حركات موردين مرتبطة بهذا المنتج حتى الآن.",
            "No supplier movements are linked to this product yet.",
          )}
        </div>
      )}
    </div>
  );
}

function ProfitMetric({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-white/75 px-4 py-3 shadow-sm shadow-black/5">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className={`mt-2 text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function SupplyMetric({ label, value }) {
  const { isRTL } = useLocale();

  return (
    <div
      className={`rounded-xl border border-sky-100 bg-sky-50 p-4 ${
        isRTL ? "text-right" : "text-left"
      }`}
    >
      <div className="text-xs font-medium text-sky-700">{label}</div>
      <div className="mt-2 text-lg font-bold text-sky-900">{value}</div>
    </div>
  );
}

function SupplyInlineStat({ label, value }) {
  const { isRTL } = useLocale();

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white px-3 py-2 ${
        isRTL ? "text-right" : "text-left"
      }`}
    >
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-gray-800">{value}</div>
    </div>
  );
}

function SupplyMiniStat({ label, value }) {
  const { isRTL } = useLocale();

  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white px-3 py-2 ${
        isRTL ? "text-right" : "text-left"
      }`}
    >
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-gray-800">{value}</div>
    </div>
  );
}
