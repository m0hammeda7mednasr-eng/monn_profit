import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Copy,
  Edit2,
  Image as ImageIcon,
  Package,
  Printer,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import BarcodeLabelModal from "../components/BarcodeLabelModal";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import api from "../utils/api";
import { normalizeBarcodeVariantTitle } from "../utils/barcodeLabels";
import {
  formatCurrency as formatMoney,
  formatDateTime,
} from "../utils/localeFormat";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const PRODUCT_FIELD_LABELS = {
  price: "Price",
  inventory: "Shopify inventory",
  sku: "SKU",
  variants: "Variant changes",
  cost_price: "Cost price",
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
    return `Saved successfully. ${formatFieldList(shopifyFields)} synced to Shopify, and ${formatFieldList(localOnlyFields)} was saved locally.`;
  }

  if (shopifyFields.length > 0) {
    return `Saved and synced to Shopify: ${formatFieldList(shopifyFields)}.`;
  }

  if (localOnlyFields.length > 0) {
    return `Saved locally: ${formatFieldList(localOnlyFields)}.`;
  }

  return result?.shopifySync === "synced"
    ? "Saved and synced to Shopify."
    : "Saved successfully.";
};

const cloneVariantDrafts = (variants = []) =>
  variants.map((variant) => ({
    id: String(variant.id || ""),
    price: String(variant.price ?? ""),
    sku: String(variant.sku || ""),
    inventory_quantity: String(toNumber(variant.inventory_quantity)),
  }));

const getSyncState = (product, select) => {
  if (product?.pending_sync) {
    return {
      label: select("بانتظار المزامنة", "Pending sync"),
      tone: "text-amber-700 bg-amber-50 border-amber-200",
      icon: Clock,
    };
  }

  if (product?.sync_error) {
    return {
      label: select("فشل في المزامنة", "Sync failed"),
      tone: "text-rose-700 bg-rose-50 border-rose-200",
      icon: AlertCircle,
    };
  }

  if (product?.last_synced_at) {
    return {
      label: select("تمت المزامنة", "Synced"),
      tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
      icon: CheckCircle,
    };
  }

  return {
    label: select("لم تتم المزامنة بعد", "Not synced yet"),
    tone: "text-slate-700 bg-slate-50 border-slate-200",
    icon: Clock,
  };
};

const getInventoryStatus = (quantity, select) => {
  if (quantity <= 0) {
    return {
      label: select("نفذ من المخزون", "Out of stock"),
      tone: "text-rose-700 bg-rose-50 border-rose-200",
    };
  }

  if (quantity < 10) {
    return {
      label: select("كمية قليلة", "Low stock"),
      tone: "text-amber-700 bg-amber-50 border-amber-200",
    };
  }

  return {
    label: select("متوفر", "In stock"),
    tone: "text-emerald-700 bg-emerald-50 border-emerald-200",
  };
};

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
  const [editedProduct, setEditedProduct] = useState({});
  const [editedVariants, setEditedVariants] = useState([]);
  const [lowStockAlertsSaving, setLowStockAlertsSaving] = useState(false);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [barcodeModalTargetKey, setBarcodeModalTargetKey] = useState("");

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

  const displayedProductPrice = useMemo(() => {
    if (!product) return 0;

    return editing && !hasMultipleVariants
      ? toNumber(editedProduct.price)
      : toNumber(product.price);
  }, [editedProduct.price, editing, hasMultipleVariants, product]);

  const displayedCostPrice = useMemo(() => {
    if (!product) return 0;

    return isAdmin && editing
      ? toNumber(editedProduct.cost_price)
      : toNumber(product.cost_price);
  }, [editedProduct.cost_price, editing, isAdmin, product]);

  const estimatedUnitMargin = useMemo(
    () => displayedProductPrice - displayedCostPrice,
    [displayedCostPrice, displayedProductPrice],
  );

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
  const syncState = getSyncState(product, select);
  const inventoryState = getInventoryStatus(displayedInventoryQuantity, select);
  const SyncIcon = syncState.icon;

  const showNotification = useCallback((message, type = "info") => {
    setNotification({ message, type });
    window.setTimeout(() => setNotification(null), type === "success" ? 8000 : 5000);
  }, []);

  const fetchProductDetails = useCallback(async () => {
    setLoading(true);

    try {
      const response = await api.get(`/shopify/products/${id}/details`);
      const nextProduct = response.data;
      setProduct(nextProduct);
      setEditedProduct(nextProduct);
      setEditedVariants(cloneVariantDrafts(nextProduct?.variants || []));
    } catch (error) {
      console.error("Error fetching product details:", error);
      showNotification(
        select("فشل تحميل تفاصيل المنتج", "Failed to load product details"),
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [id, select, showNotification]);

  useEffect(() => {
    fetchProductDetails();
  }, [fetchProductDetails]);

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
    if (!canEditProducts || !product) {
      return;
    }

    setSaving(true);

    try {
      const payload = {};
      const nextPrice = parseFloat(editedProduct.price);
      const nextInventory = parseInt(editedProduct.inventory_quantity, 10);
      const nextSku = String(editedProduct.sku || "").trim();

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
      }

      if (
        !hasMultipleVariants &&
        nextSku !== String(product.sku || "").trim()
      ) {
        payload.sku = nextSku;
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
          const originalVariant = originalVariantsById.get(String(variant.id || ""));
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
        showNotification(select("لا توجد تغييرات للحفظ", "No changes to save"));
        setSaving(false);
        return;
      }

      const response = await api.post(`/shopify/products/${id}/update`, payload);
      const saveResult = response.data || {};
      const updatedFields = Object.keys(payload).filter(
        (key) => key !== "variant_updates",
      );
      const variantUpdatesCount = payload.variant_updates?.length || 0;

      let detailedMessage = buildSaveMessage(saveResult);
      if (updatedFields.length > 0) {
        detailedMessage += ` Updated: ${formatFieldList(updatedFields)}.`;
      }
      if (variantUpdatesCount > 0) {
        detailedMessage += ` ${variantUpdatesCount} variant(s) updated.`;
      }

      showNotification(detailedMessage, "success");
      setEditing(false);

      if (saveResult.shopifySync === "synced") {
        window.setTimeout(fetchProductDetails, 1000);
      } else {
        fetchProductDetails();
      }
    } catch (error) {
      console.error("Error saving product:", error);
      showNotification(
        error?.response?.data?.error || select("فشل الحفظ", "Save failed"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedProduct(product || {});
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

    const nextSuppressed = !Boolean(product.suppress_low_stock_alerts);
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
              "تم تشغيل تنبيهات المخزون المنخفض لهذا المنتج.",
              "Low-stock alerts were turned on for this product.",
            ),
        "success",
      );
    } catch (error) {
      console.error("Error updating low-stock alerts:", error);
      showNotification(
        error?.response?.data?.error ||
          select(
            "فشل تحديث تنبيهات المخزون المنخفض.",
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
      showNotification(select("تم نسخ معرف المنتج", "Product ID copied"), "success");
    } catch {
      showNotification(
        select("فشل نسخ معرف المنتج", "Failed to copy product ID"),
        "error",
      );
    }
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
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-sky-600" />
            <p className="text-slate-600">
              {select("جاري تحميل تفاصيل المنتج...", "Loading product details...")}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex h-screen bg-slate-100">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Package size={56} className="mx-auto text-slate-300" />
            <h1 className="mt-5 text-2xl font-bold text-slate-900">
              {select("المنتج غير موجود", "Product not found")}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {select(
                "قد يكون المنتج تم حذفه أو لا يمكنك الوصول إليه.",
                "The product may have been removed or you do not have access to it.",
              )}
            </p>
            <button
              type="button"
              onClick={() => navigate("/products")}
              className="app-button-primary mt-6 inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white"
            >
              <ArrowLeft size={16} />
              {select("الرجوع للمنتجات", "Back to products")}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const variants =
    Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants
      : [product];

  return (
    <div className="flex h-screen bg-slate-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-6 lg:p-8">
          {notification ? (
            <div
              className={`fixed right-4 top-4 z-50 rounded-2xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
                notification.type === "success"
                  ? "bg-emerald-600"
                  : notification.type === "error"
                    ? "bg-rose-600"
                    : "bg-sky-600"
              }`}
            >
              {notification.message}
            </div>
          ) : null}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => navigate("/products")}
                  className="app-button-secondary flex h-11 w-11 items-center justify-center rounded-2xl text-slate-700"
                >
                  <ArrowLeft size={20} />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="truncate text-3xl font-bold text-slate-900">
                      {product.title}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${syncState.tone}`}
                    >
                      <SyncIcon size={14} />
                      {syncState.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {select("تم الإنشاء في", "Created on")} {formatDate(product.created_at)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyProductReference}
                className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                <Copy size={16} />
                {select("نسخ المعرف", "Copy ID")}
              </button>

              {canPrintBarcodeLabels && hasPrintableBarcodeTarget ? (
                <button
                  type="button"
                  onClick={() => openBarcodeModal(barcodeTargets[0]?.key || "")}
                  className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  <Printer size={16} />
                  {select("طباعة ليبل", "Print label")}
                </button>
              ) : null}

              {canEditProducts ? (
                editing ? (
                  <>
                    <button
                      type="button"
                      onClick={handleCancel}
                      disabled={saving}
                      className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      <X size={16} />
                      {select("إلغاء", "Cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" />
                          {select("جاري الحفظ...", "Saving...")}
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          {select("حفظ التغييرات", "Save changes")}
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    <Edit2 size={16} />
                    {select("تعديل", "Edit")}
                  </button>
                )
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <div className="space-y-6">
              <section className="app-surface rounded-[28px] p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {select("صورة المنتج", "Product image")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {select(
                        "عرض بسيط للصورة الأساسية فقط.",
                        "Showing the main product image only.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex h-80 items-center justify-center overflow-hidden rounded-[24px] bg-slate-100">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.title}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImageIcon size={64} className="text-slate-400" />
                  )}
                </div>
              </section>

              {product.body_html ? (
                <section className="app-surface rounded-[28px] p-6">
                  <h2 className="text-xl font-bold text-slate-900">
                    {select("الوصف", "Description")}
                  </h2>
                  <div
                    className="prose mt-5 max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: product.body_html }}
                  />
                </section>
              ) : null}

              <section className="app-surface rounded-[28px] p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {select("الأشكال", "Variants")} ({variants.length})
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {select(
                        "تم حذف الوزن والتفاصيل الزيادة والتركيز هنا على السعر والمخزون فقط.",
                        "Weight and extra metadata were removed so this section stays focused on price and stock.",
                      )}
                    </p>
                  </div>
                  {hasMultipleVariants ? (
                    <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                      {select(
                        "عدّل سعر ومخزون كل شكل من هنا",
                        "Edit each variant price and stock here",
                      )}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 space-y-4">
                  {variants.map((variant, index) => {
                    const variantDraft =
                      editedVariantsById.get(String(variant.id || "")) || {};
                    const displayedVariantPrice =
                      editing && hasMultipleVariants
                        ? variantDraft.price ?? variant.price
                        : variant.price;
                    const displayedVariantSku =
                      editing && hasMultipleVariants
                        ? variantDraft.sku ?? variant.sku
                        : variant.sku;
                    const displayedVariantInventory = toNumber(
                      editing && hasMultipleVariants
                        ? variantDraft.inventory_quantity ??
                          variant.inventory_quantity
                        : variant.inventory_quantity,
                    );
                    const variantStockState = getInventoryStatus(
                      displayedVariantInventory,
                      select,
                    );

                    return (
                      <div
                        key={String(variant.id || `variant-${index}`)}
                        className="rounded-[24px] border border-slate-200 bg-white p-5"
                      >
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold text-slate-900">
                                {variant.title}
                              </h3>
                              <span
                                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${variantStockState.tone}`}
                              >
                                {variantStockState.label}
                              </span>
                            </div>

                            {(displayedVariantSku || !hasMultipleVariants) && (
                              <p className="mt-2 text-sm text-slate-600">
                                SKU: {displayedVariantSku || "-"}
                              </p>
                            )}

                            <div className="mt-3 flex flex-wrap gap-2">
                              {[variant.option1, variant.option2, variant.option3]
                                .map((value) => String(value || "").trim())
                                .filter(Boolean)
                                .map((value) => (
                                  <span
                                    key={`${variant.id || index}-${value}`}
                                    className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                                  >
                                    {value}
                                  </span>
                                ))}
                            </div>
                          </div>

                          <div className="w-full max-w-sm space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <StatCard
                                label={select("سعر البيع", "Selling price")}
                                value={formatMoney(displayedVariantPrice)}
                              />
                              <StatCard
                                label={select("مخزون Shopify", "Shopify stock")}
                                value={String(displayedVariantInventory)}
                              />
                            </div>

                            {canPrintBarcodeLabels &&
                            (variant.barcode || displayedVariantSku) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openBarcodeModal(
                                    String(
                                      variant.id || barcodeTargets[0]?.key || "",
                                    ),
                                  )
                                }
                                className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700"
                              >
                                <Printer size={14} />
                                {select("طباعة ليبل", "Print label")}
                              </button>
                            ) : null}

                            {editing && canEditProducts && hasMultipleVariants ? (
                              <div className="space-y-3 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                                <Field label="SKU">
                                  <input
                                    type="text"
                                    value={variantDraft.sku ?? String(variant.sku || "")}
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
                                </Field>

                                <Field
                                  label={select("سعر البيع", "Selling price")}
                                >
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={
                                      variantDraft.price ?? String(variant.price ?? "")
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
                                </Field>

                                <Field
                                  label={select("مخزون Shopify", "Shopify stock")}
                                >
                                  <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={
                                      variantDraft.inventory_quantity ??
                                      String(toNumber(variant.inventory_quantity))
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
                                </Field>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            <div className="space-y-6">
              <section className="app-surface rounded-[28px] p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {select("التسعير", "Pricing")}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {select(
                        "تم تبسيط الشاشة لتظهر سعر البيع وسعر التكلفة فقط.",
                        "This section now focuses on selling price and cost price only.",
                      )}
                    </p>
                  </div>
                  {hasMultipleVariants ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {select("منتج متعدد الأشكال", "Multi-variant")}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 space-y-4">
                  <Field label={`${select("سعر البيع", "Selling price")} (${currencyLabel})`}>
                    {editing && !hasMultipleVariants ? (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editedProduct.price ?? ""}
                        onChange={(event) =>
                          setEditedProduct((current) => ({
                            ...current,
                            price: event.target.value,
                          }))
                        }
                        className="app-input w-full px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <ValueDisplay value={formatMoney(product.price)} />
                    )}
                  </Field>

                  {isAdmin ? (
                    <Field label={`${select("سعر التكلفة", "Cost price")} (${currencyLabel})`}>
                      {editing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={editedProduct.cost_price ?? 0}
                          onChange={(event) =>
                            setEditedProduct((current) => ({
                              ...current,
                              cost_price: event.target.value,
                            }))
                          }
                          className="app-input w-full px-3 py-2.5 text-sm"
                        />
                      ) : (
                        <ValueDisplay value={formatMoney(product.cost_price || 0)} />
                      )}
                    </Field>
                  ) : null}

                  {hasMultipleVariants ? (
                    <div className="rounded-[22px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                      {select(
                        "سعر البيع لكل شكل يتعدل من قسم الأشكال، وسعر التكلفة الرئيسي ظاهر هنا فقط.",
                        "Variant selling prices are edited in the variants section, while the main cost price stays here.",
                      )}
                    </div>
                  ) : null}

                  {isAdmin ? (
                    <div
                      className={`rounded-[22px] border px-4 py-4 ${
                        estimatedUnitMargin >= 0
                          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                          : "border-rose-200 bg-rose-50 text-rose-900"
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em]">
                        {select("هامش تقريبي", "Estimated margin")}
                      </p>
                      <p className="mt-2 text-2xl font-bold">
                        {formatMoney(estimatedUnitMargin)}
                      </p>
                      <p className="mt-2 text-sm">
                        {select(
                          "فرق مباشر بين سعر البيع وسعر التكلفة فقط.",
                          "Direct difference between selling price and cost price only.",
                        )}
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-slate-900">
                  {select("المخزون", "Stock")}
                </h2>
                <div className="mt-5 space-y-4">
                  <Field
                    label={
                      hasMultipleVariants
                        ? select("إجمالي مخزون Shopify", "Total Shopify stock")
                        : select("مخزون Shopify", "Shopify stock")
                    }
                  >
                    {editing && !hasMultipleVariants ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editedProduct.inventory_quantity ?? ""}
                        onChange={(event) =>
                          setEditedProduct((current) => ({
                            ...current,
                            inventory_quantity: event.target.value,
                          }))
                        }
                        className="app-input w-full px-3 py-2.5 text-sm"
                      />
                    ) : (
                      <ValueDisplay value={String(displayedInventoryQuantity)} />
                    )}
                  </Field>

                  <Field label={select("مخزون المخزن", "Warehouse stock")}>
                    <ValueDisplay value={String(displayedWarehouseInventoryQuantity)} />
                  </Field>

                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {select("حالة المخزون", "Stock state")}
                    </p>
                    <span
                      className={`mt-3 inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${inventoryState.tone}`}
                    >
                      {inventoryState.label}
                    </span>
                    {displayedInventoryQuantity !==
                    displayedWarehouseInventoryQuantity ? (
                      <p className="mt-3 text-sm text-amber-700">
                        {select(
                          "يوجد فرق بين مخزون Shopify ومخزون المخزن.",
                          "There is a difference between Shopify stock and warehouse stock.",
                        )}
                      </p>
                    ) : null}
                  </div>

                  {isAdmin && canEditProducts ? (
                    <button
                      type="button"
                      onClick={toggleLowStockAlerts}
                      disabled={lowStockAlertsSaving}
                      className="app-button-secondary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                    >
                      {lowStockAlertsSaving ? (
                        <RefreshCw size={16} className="animate-spin" />
                      ) : null}
                      {product.suppress_low_stock_alerts
                        ? select(
                            "تشغيل تنبيهات المخزون المنخفض",
                            "Turn low-stock alerts on",
                          )
                        : select(
                            "إيقاف تنبيهات المخزون المنخفض",
                            "Turn low-stock alerts off",
                          )}
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="app-surface rounded-[28px] p-6">
                <h2 className="text-lg font-bold text-slate-900">
                  {select("ملخص سريع", "Quick summary")}
                </h2>
                <div className="mt-5 space-y-4">
                  {product.product_type ? (
                    <SummaryRow
                      label={select("النوع", "Type")}
                      value={product.product_type}
                    />
                  ) : null}

                  <SummaryRow
                    label="SKU"
                    value={
                      hasMultipleVariants
                        ? select(
                            "يوجد SKU لكل شكل داخل قسم الأشكال.",
                            "Each variant SKU is shown inside the variants section.",
                          )
                        : product.sku || "-"
                    }
                  />

                  <SummaryRow
                    label={select("الحالة", "Status")}
                    value={
                      product.status === "active"
                        ? select("نشط", "Active")
                        : select("غير نشط", "Inactive")
                    }
                  />

                  <SummaryRow
                    label={select("آخر تحديث", "Last update")}
                    value={formatDate(
                      product.local_updated_at ||
                        product.shopify_updated_at ||
                        product.updated_at ||
                        product.created_at,
                    )}
                  />
                </div>
              </section>
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

function Field({ children, label }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
    </label>
  );
}

function ValueDisplay({ value }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-lg font-semibold text-slate-900">
      {value}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
