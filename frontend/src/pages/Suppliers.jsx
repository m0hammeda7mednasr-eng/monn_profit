import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Truck,
  Wallet,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLocale } from "../context/LocaleContext";
import { getErrorMessage, suppliersAPI } from "../utils/api";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
} from "../utils/helpers";
import {
  buildProductsCacheKey,
  fetchProductPages,
  peekCachedProducts,
  readCachedProducts,
  writeProductsCache,
} from "../utils/productCache";
import { extractArray } from "../utils/response";
import { subscribeToSharedDataUpdates } from "../utils/realtime";
import { decodeMaybeMojibake } from "../utils/text";

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "تحويل بنكي" },
  { value: "cash", label: "كاش" },
  { value: "wallet", label: "محفظة" },
  { value: "instapay", label: "إنستاباي" },
  { value: "other", label: "أخرى" },
];

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const PAYMENT_METHOD_LABELS = {
  bank_transfer: "تحويل بنكي",
  cash: "كاش",
  wallet: "محفظة",
  instapay: "إنستاباي",
  other: "أخرى",
};
const DELIVERY_ITEM_TYPE_OPTIONS = [
  { value: "model", label: "موديل" },
  { value: "fabric", label: "قماش" },
];
const DELIVERY_ITEM_TYPE_LABELS = {
  model: "موديل",
  fabric: "قماش",
};
const DELIVERY_MEASUREMENT_UNIT_OPTIONS = [
  { value: "piece", label: "قطعة" },
  { value: "meter", label: "متر" },
  { value: "kilo", label: "كيلو" },
];
const DELIVERY_MEASUREMENT_UNIT_LABELS = {
  piece: "قطعة",
  meter: "متر",
  kilo: "كيلو",
};
const SUPPLIER_UI_TRANSLATIONS = {
  en: {
    "الموردون والحسابات": "Suppliers & Accounts",
    "ملف المورد يركز على البيانات الأساسية، بينما تفاصيل الواردات والدفعات تُسجل داخل الحركات بكل تفاصيلها.":
      "Supplier profiles hold the master data, while deliveries and payments are recorded through detailed movements.",
    "موردو المصانع": "Factory Suppliers",
    "موردي القماش": "Fabric Suppliers",
    "كود المصنع": "Factory Code",
    "كود مورد القماش": "Fabric Supplier Code",
    "تفاصيل موردي القماش وروابطهم مع المصانع والأقمشة المرتبطة بكل مورد.":
      "Fabric supplier details, linked factories, and connected fabrics for each supplier.",
    "تحديث": "Refresh",
    "مورد جديد": "New Supplier",
    "مورد مصنع جديد": "New Factory Supplier",
    "مورد قماش جديد": "New Fabric Supplier",
    "إجمالي الموردين": "Total Suppliers",
    "مورد نشط": "Active suppliers",
    "إجمالي الوارد": "Total Deliveries",
    "قيمة كل الشحنات المسجلة": "Value of all recorded deliveries",
    "إجمالي المدفوع": "Total Paid",
    "كل الدفعات المسجلة للموردين": "All recorded supplier payments",
    "الرصيد المستحق": "Outstanding Balance",
    "المتبقي على حساب الموردين": "Remaining supplier balance",
    "تسجيل وارد جديد": "Record New Delivery",
    "ابدأ بالقماش ثم اختر موديله واربطه بالمنتج بشكل منظم وواضح":
      "Start with the fabric, then choose its model and link it to the product in a clean structured flow.",
    "تسجيل دفعة": "Record Payment",
    "سجل كل دفعة بطريقة السداد والحساب المستخدم وتفاصيل المرجع":
      "Record every payment with method, account used, and reference details.",
    "ابدأ باختيار القماش، وبعدها اختر موديله. ولو ربطت على مستوى المنتج الأساسي فالعلاقة هتظهر تلقائيًا على كل الفاريانتات.":
      "Start by choosing the fabric, then its model. If you link at the base product level, the relationship will appear automatically across all variants.",
    "كتالوج الموديلات": "Model Catalog",
    "عرض كل موديل وما تحته من أقمشة وخامات وواردات بشكل منظم":
      "View each model with its fabrics, materials, and deliveries in a structured layout.",
    "موديلات القماش": "Fabric Models",
    "ابدأ بالقماش لترى الموديلات المرتبطة به وكمياتها ووارداتها":
      "Start from the fabric to see linked models, quantities, and deliveries.",
    "الخامات وربط مورد القماش": "Fabric Codes and Fabric Supplier Link",
    "سجل خامات المصنع وربط كل خامة بمورد القماش المناسب لتظهر مباشرة داخل الواردات والربط على المنتجات.":
      "Register factory fabrics and link each one to the right fabric supplier so it appears directly in deliveries and product linking.",
    "إغلاق نموذج الخامة": "Close fabric form",
    "تعديل الخامة": "Edit fabric",
    "إضافة خامة": "Add fabric",
    "إضافة خامة جديدة": "Add new fabric",
    "موردو القماش المرتبطون": "Linked fabric suppliers",
    "عدد الموديلات المرتبطة": "Linked models count",
    "لا يوجد مورد قماش محدد": "No fabric supplier selected",
    "خامات نشطة": "Active fabrics",
    "لا توجد خامات مسجلة لهذا المصنع بعد.": "No fabrics are registered for this factory yet.",
    "عرّف الخامة مرة واحدة ثم اختر مورد القماش المناسب لها ليظهر الربط مباشرة داخل الواردات.":
      "Define the fabric once, then choose the right fabric supplier so the link appears directly in deliveries.",
    "كود الخامة": "Fabric Code",
    "اسم الخامة": "Fabric Name",
    "الخامة نشطة وتظهر في قائمة الربط": "Fabric is active and appears in the linking list",
    "جارٍ حفظ الخامة...": "Saving fabric...",
    "حفظ الخامة": "Save fabric",
    "هذه الصفحة مرجعية لبيانات مورد القماش فقط، أما إنشاء الربط مع خامات المصانع فيتم من صفحة المصنع.":
      "This page is for the fabric supplier profile only. Linking to factory fabrics is managed from the factory page.",
    "أكواد القماش": "Fabric Codes",
    "المصانع المرتبطة": "Linked Factories",
    "آخر نشاط": "Last Activity",
    "ملخص الربط": "Linking Summary",
    "مراجع الاستخدام": "Usage Reference",
    "عرض مرجعي للمصانع التي تستخدم خامات مرتبطة بهذا المورد.":
      "Reference view of factories that use fabrics linked to this supplier.",
    "لا توجد مصانع مرتبطة بهذا المورد حتى الآن.": "No factories are linked to this supplier yet.",
    "أكواد القماش المرتبطة": "Linked Fabric Codes",
    "الأكواد المرتبطة بهذا المورد مع توضيح المصنع الذي يستخدم كل كود.":
      "Codes linked to this supplier, with the factory that uses each code.",
    "لا توجد أكواد قماش مرتبطة بهذا المورد حتى الآن.":
      "No fabric codes are linked to this supplier yet.",
    "إنشاء الربط يتم من صفحة المصنع": "Linking is managed from the factory page",
    "المنتجات المستلمة من المورد": "Received Products from Supplier",
    "كل الأصناف المرتبطة بحركات الوارد للمورد الحالي":
      "All items linked to delivery movements for the current supplier.",
    "الدفعات المسجلة": "Recorded Payments",
    "كل المدفوعات المرتبطة بالمورد": "All payments linked to the supplier.",
    "الحركة المحاسبية": "Ledger Timeline",
    "Timeline مختصر للواردات والدفعات":
      "Compact timeline of deliveries and payments.",
    "حذف": "Remove",
    "ابحث باسم المورد أو الكود أو الهاتف":
      "Search by supplier name, code, or phone",
    "جاري تحميل الموردين...": "Loading suppliers...",
    "لا يوجد موردون مطابقون للبحث الحالي.":
      "No suppliers match the current search.",
    "الكود": "Code",
    "الوارد": "Deliveries",
    "المدفوع": "Paid",
    "الرصيد": "Balance",
    "الكمية": "Quantity",
    "الموديلات": "Models",
    "الأقمشة": "Fabrics",
    "المسؤول": "Contact",
    "الهاتف": "Phone",
    "العنوان": "Address",
    "الرصيد الافتتاحي": "Opening Balance",
    "آخر وارد": "Last Delivery",
    "آخر دفعة": "Last Payment",
    "إجمالي الأصناف": "Total Items",
    "النوع": "Type",
    "الوحدة": "Unit",
    "سعر المادة": "Material Price",
    "سعر القطعة": "Piece Cost",
    "التصنيع": "Manufacturing",
    "خدمة المصنع": "Factory Service",
    "تكلفة الوحدة": "Unit Cost",
    "الإجمالي": "Total",
    "ملاحظات": "Notes",
    "ملاحظات الوارد": "Delivery Notes",
    "ملاحظات الدفعة": "Payment Notes",
    "الربط الحالي": "Current Link",
    "المخزون الحالي": "Current Stock",
    "هذا الربط على مستوى المنتج كله، لذلك سيظهر تلقائيًا على كل الفاريانتات.":
      "This link is set at the base product level, so it will automatically apply to all variants.",
    "الإجمالي المحسوب": "Calculated Total",
    "إضافة صنف جديد": "Add New Item",
    "جارٍ الحفظ...": "Saving...",
    "حفظ الوارد": "Save Delivery",
    "حفظ الدفعة": "Save Payment",
    "المورد نشط ويظهر في القائمة": "Supplier is active and visible in the list",
    "حفظ بيانات المورد": "Save Supplier Details",
    "اسم القماش": "Fabric Name",
    "اسم المورد": "Supplier Name",
    "اسم المسؤول": "Contact Name",
    "تاريخ الوارد": "Delivery Date",
    "تاريخ الدفعة": "Payment Date",
    "رقم المرجع": "Reference Number",
    "المبلغ": "Amount",
    "طريقة الدفع": "Payment Method",
    "الحساب المستخدم": "Payment Account",
    "وصف سريع": "Short Description",
    "قماش مسجل": "Registered Fabric",
    "اختر قماشًا مسجلًا": "Choose a registered fabric",
    "لا توجد أقمشة مسجلة بعد": "No fabrics recorded yet",
    "اسم الموديل / الصنف": "Model / Item Name",
    "موديل مرتبط بهذا القماش": "Model linked to this fabric",
    "اختر القماش أولًا": "Choose the fabric first",
    "اختر موديلًا مرتبطًا بهذا القماش":
      "Choose a model linked to this fabric",
    "لا توجد موديلات مرتبطة بهذا القماش":
      "No models are linked to this fabric",
    "ابحث بالاسم أو SKU": "Search by name or SKU",
    "ربط متقدم بالمنتج / الفاريانت": "Advanced product / variant link",
    "اختر منتجًا أو فاريانت إذا احتجت":
      "Choose a product or variant if needed",
    "لا توجد نتائج مطابقة": "No matching results",
    "القطعة / الرولة": "Piece / Roll",
    "وحدة الخامة": "Material Unit",
    "ينتج كام قطعة من المتر / الكيلو":
      "How many pieces come from each meter / kilo",
    "تكلفة التصنيع": "Manufacturing Cost",
    "الخامة أو الوصف الفني": "Material or Technical Description",
    "سعر الوحدة": "Unit Price",
    "اللون": "Color",
    "القماش": "Fabric",
    "القطعة": "Piece Label",
    "الخامات": "Materials",
    "الألوان": "Colors",
    "الموديلات المرتبطة": "Linked Models",
    "الوصف": "Description",
    "العناصر": "Items",
    "الحساب": "Account",
    "المرجع": "Reference",
    "مرجع": "Ref",
    "التاريخ": "Date",
    "المنتج / النوع": "Product / Type",
    "التفاصيل": "Details",
    "الأسعار": "Prices",
    "الناتج": "Output",
    "سعر المتر": "Meter Price",
    "سعر الكيلو": "Kilo Price",
    "المنتج الأساسي - كل الفاريانتات": "Base product - all variants",
    "غير مربوط": "Not linked",
    "موديل": "Model",
    "قماش": "Fabric",
    "قطعة": "Piece",
    "متر": "Meter",
    "كيلو": "Kilogram",
    "تحويل بنكي": "Bank Transfer",
    "كاش": "Cash",
    "محفظة": "Wallet",
    "إنستاباي": "Instapay",
    "أخرى": "Other",
    "وارد": "Delivery",
    "دفعة": "Payment",
    "تسوية": "Adjustment",
    "فتح صفحة المنتج": "Open Product Page",
    "فتح المنتج": "Open Product",
    "تصنيع": "Manufacturing",
  },
};
const DEFAULT_VARIANT_TITLES = new Set(["default", "default title"]);
const normalizeText = (value) => String(value || "").trim();
const formatCount = (value) =>
  formatNumber(value, { maximumFractionDigits: 0 });
const getTodayValue = () => new Date().toISOString().slice(0, 10);
const formatPaymentMethodLabel = (value) =>
  PAYMENT_METHOD_LABELS[normalizeText(value).toLowerCase()] || normalizeText(value) || "-";
const normalizeVariantTitle = (value) => {
  const normalized = normalizeText(value);
  if (!normalized || DEFAULT_VARIANT_TITLES.has(normalized.toLowerCase())) {
    return "";
  }

  return normalized;
};
const buildCatalogOptionValue = (productId, variantId = "") =>
  `${normalizeText(productId)}::${normalizeText(variantId)}`;
const getDeliveryItemSelectionValue = (item) =>
  buildCatalogOptionValue(item?.product_id, item?.variant_id);
const normalizeDeliveryItemType = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return DELIVERY_ITEM_TYPE_LABELS[normalized] ? normalized : "model";
};
const normalizeDeliveryMeasurementUnit = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  return DELIVERY_MEASUREMENT_UNIT_LABELS[normalized] ? normalized : "piece";
};
const formatDeliveryItemTypeLabel = (value) =>
  DELIVERY_ITEM_TYPE_LABELS[normalizeDeliveryItemType(value)] || "موديل";
const formatDeliveryMeasurementUnitLabel = (value) =>
  DELIVERY_MEASUREMENT_UNIT_LABELS[normalizeDeliveryMeasurementUnit(value)] || "قطعة";
const NORMALIZED_SUPPLIER_UI_TRANSLATIONS = Object.fromEntries(
  Object.entries(SUPPLIER_UI_TRANSLATIONS.en).map(([source, translation]) => [
    decodeMaybeMojibake(source),
    decodeMaybeMojibake(translation),
  ]),
);
const translateSupplierUiText = (value, locale = "ar") => {
  const decodedValue = decodeMaybeMojibake(value);

  if (locale !== "en" || typeof decodedValue !== "string") {
    return decodedValue;
  }

  return NORMALIZED_SUPPLIER_UI_TRANSLATIONS[decodedValue] || decodedValue;
};
const getSupplierViewType = (pathname = "") =>
  pathname.startsWith("/suppliers/fabric-suppliers") ? "fabric" : "factory";
const getSupplierViewTitle = (supplierType) =>
  supplierType === "fabric" ? "موردي القماش" : "موردو المصانع";
const getSupplierCodeLabel = (supplierType) =>
  supplierType === "fabric" ? "كود مورد القماش" : "كود المصنع";

const buildSuppliersListPath = (supplierType = "factory") =>
  supplierType === "fabric" ? "/suppliers/fabric-suppliers" : "/suppliers";
const buildSupplierWorkspacePath = (supplierType = "factory", supplierId = "") => {
  const normalizedSupplierId = normalizeText(supplierId);
  const basePath = buildSuppliersListPath(supplierType);

  return normalizedSupplierId
    ? `${basePath}/${encodeURIComponent(normalizedSupplierId)}`
    : basePath;
};

const createEmptySupplierForm = () => ({
  supplier_type: "factory",
  code: "",
  name: "",
  contact_name: "",
  phone: "",
  address: "",
  notes: "",
  opening_balance: "",
  is_active: true,
});

const createEmptyFabricForm = () => ({
  fabric_supplier_id: "",
  code: "",
  name: "",
  notes: "",
  is_active: true,
});

const createEmptyDeliveryItem = () => ({
  item_type: "model",
  product_id: "",
  variant_id: "",
  variant_title: "",
  fabric_id: "",
  fabric_code: "",
  fabric_supplier_id: "",
  product_name: "",
  sku: "",
  catalog_query: "",
  material: "",
  color: "",
  piece_label: "",
  fabric_name: "",
  measurement_unit: "piece",
  pieces_per_unit: "",
  price_per_meter: "",
  price_per_kilo: "",
  piece_cost: "",
  manufacturing_cost: "",
  factory_service_cost: "",
  quantity: "1",
  unit_cost: "",
  total_cost: "",
  notes: "",
});

const createEmptyDeliveryForm = () => ({
  entry_date: getTodayValue(),
  reference_code: "",
  description: "",
  notes: "",
  items: [createEmptyDeliveryItem()],
});

const createEmptyPaymentForm = () => ({
  entry_date: getTodayValue(),
  reference_code: "",
  description: "",
  notes: "",
  payment_method: "cash",
  payment_account: "",
  amount: "",
});

const getDeliveryItemTotal = (item) => {
  const explicitTotal = toNumber(item?.total_cost);
  if (explicitTotal > 0) {
    return explicitTotal;
  }

  return toNumber(item?.quantity) * getDeliveryItemSuggestedUnitCost(item);
};

const getDeliveryItemMaterialUnitPrice = (item) => {
  const measurementUnit = normalizeDeliveryMeasurementUnit(item?.measurement_unit);
  if (measurementUnit === "meter") {
    return toNumber(item?.price_per_meter);
  }

  if (measurementUnit === "kilo") {
    return toNumber(item?.price_per_kilo);
  }

  return toNumber(item?.piece_cost);
};

const getDeliveryItemPieceCost = (item) => {
  const explicitPieceCost = toNumber(item?.piece_cost);
  if (explicitPieceCost > 0) {
    return explicitPieceCost;
  }

  const measurementUnit = normalizeDeliveryMeasurementUnit(item?.measurement_unit);
  if (measurementUnit !== "meter" && measurementUnit !== "kilo") {
    return 0;
  }

  const piecesPerUnit = toNumber(item?.pieces_per_unit);
  if (piecesPerUnit <= 0) {
    return 0;
  }

  return getDeliveryItemMaterialUnitPrice(item) / piecesPerUnit;
};

const getDeliveryItemSuggestedUnitCost = (item) => {
  const explicitUnitCost = toNumber(item?.unit_cost);
  if (explicitUnitCost > 0) {
    return explicitUnitCost;
  }

  const itemType = normalizeDeliveryItemType(item?.item_type);
  const materialUnitPrice = getDeliveryItemMaterialUnitPrice(item);
  const pieceCost = getDeliveryItemPieceCost(item);

  if (itemType === "fabric") {
    return materialUnitPrice > 0 ? materialUnitPrice : pieceCost;
  }

  return (
    (pieceCost > 0 ? pieceCost : materialUnitPrice) +
    toNumber(item?.manufacturing_cost) +
    toNumber(item?.factory_service_cost)
  );
};

const buildSupplierFormFromRecord = (supplier) => ({
  supplier_type: supplier?.supplier_type || "factory",
  code: supplier?.code || "",
  name: supplier?.name || "",
  contact_name: supplier?.contact_name || "",
  phone: supplier?.phone || "",
  address: supplier?.address || "",
  notes: supplier?.notes || "",
  opening_balance:
    supplier?.opening_balance !== null && supplier?.opening_balance !== undefined
      ? String(supplier.opening_balance)
      : "",
  is_active: supplier?.is_active !== false,
});

const buildFabricFormFromRecord = (fabric) => ({
  fabric_supplier_id: fabric?.fabric_supplier_id || "",
  code: fabric?.code || "",
  name: fabric?.name || fabric?.fabric_name || "",
  notes: fabric?.notes || "",
  is_active: fabric?.is_active !== false,
});

const isSuppliersRelatedUpdate = (event) =>
  String(event?.source || "").toLowerCase().includes("/suppliers");
const isProductsRelatedUpdate = (event) => {
  const source = String(event?.source || "").toLowerCase();
  return source.includes("/shopify/products") || source.includes("/products/");
};
const buildProductCatalogOptions = (products = []) => {
  const options = [];

  for (const product of products) {
    const productId = normalizeText(product?.id || product?.shopify_id);
    const productTitle = normalizeText(product?.title) || "منتج بدون اسم";
    const variants = Array.isArray(product?.variants) ? product.variants : [];

    options.push({
      value: buildCatalogOptionValue(productId, ""),
      product_id: productId,
      variant_id: "",
      variant_title: "",
      product_name: productTitle,
      sku: normalizeText(product?.sku),
      inventory_quantity: toNumber(product?.inventory_quantity),
      label: `${productTitle} | المنتج الأساسي`,
      searchText: [productTitle, product?.vendor, product?.product_type, product?.sku]
        .join(" ")
        .toLowerCase(),
    });

    for (const variant of variants) {
      const variantId = normalizeText(variant?.id);
      const variantTitle = normalizeVariantTitle(variant?.title);
      const sku = normalizeText(variant?.sku || product?.sku);
      const displayName = [productTitle, variantTitle].filter(Boolean).join(" - ");

      options.push({
        value: buildCatalogOptionValue(productId, variantId),
        product_id: productId,
        variant_id: variantId,
        variant_title: variantTitle,
        product_name: productTitle,
        sku,
        inventory_quantity: toNumber(
          variant?.inventory_quantity ?? product?.inventory_quantity,
        ),
        label: sku ? `${displayName} | ${sku}` : displayName,
        searchText: [productTitle, variantTitle, product?.vendor, product?.product_type, sku]
          .join(" ")
          .toLowerCase(),
      });
    }
  }

  return options.sort((left, right) => left.label.localeCompare(right.label, "ar"));
};
const filterCatalogOptions = (options, query, limit = 80) => {
  const keyword = normalizeText(query).toLowerCase();
  const filtered = keyword
    ? options.filter((option) => option.searchText.includes(keyword))
    : options;
  return filtered.slice(0, limit);
};
const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const formatTextList = (values, fallback = "-") => {
  const list = toArray(values).map(normalizeText).filter(Boolean);
  return list.length > 0 ? list.join("، ") : fallback;
};
const buildProductDetailsPath = (productId) => {
  const normalized = normalizeText(productId);
  return normalized ? `/products/${encodeURIComponent(normalized)}` : "";
};
const buildSupplierFabricOptionValue = (fabric) => {
  const fabricId = normalizeText(fabric?.id || fabric?.fabric_id);
  if (fabricId) {
    return `id:${fabricId}`;
  }

  const fabricCode = normalizeText(fabric?.code || fabric?.fabric_code);
  if (fabricCode) {
    return `code:${fabricCode.toLowerCase()}`;
  }

  const fabricName = normalizeText(fabric?.name || fabric?.fabric_name);
  if (fabricName) {
    return `name:${fabricName.toLowerCase()}`;
  }

  return "";
};
const getSupplierFabricLookupKeys = (fabric) => {
  const keys = [];
  const fabricId = normalizeText(fabric?.id || fabric?.fabric_id);
  const fabricCode = normalizeText(fabric?.code || fabric?.fabric_code);
  const fabricName = normalizeText(fabric?.name || fabric?.fabric_name);

  if (fabricId) {
    keys.push(`id:${fabricId}`);
  }
  if (fabricCode) {
    keys.push(`code:${fabricCode.toLowerCase()}`);
  }
  if (fabricName) {
    keys.push(`name:${fabricName.toLowerCase()}`);
  }

  return keys;
};
const formatSupplierFabricDisplay = (fabric = {}) => {
  const fabricCode = normalizeText(fabric?.code || fabric?.fabric_code);
  const fabricName = normalizeText(fabric?.name || fabric?.fabric_name);

  if (fabricCode && fabricName) {
    return `${fabricCode} | ${fabricName}`;
  }

  return fabricCode || fabricName || "-";
};
const PRODUCT_LEVEL_LINK_LABEL = "المنتج الأساسي - كل الفاريانتات";
const getLinkedScopeLabel = (record = {}) => {
  const variantTitle = normalizeVariantTitle(record?.variant_title);
  if (variantTitle) {
    return variantTitle;
  }

  if (normalizeText(record?.product_id)) {
    return PRODUCT_LEVEL_LINK_LABEL;
  }

  return "غير مربوط";
};
const buildSupplierFabricOptions = (supplier) => {
  const seen = new Set();

  return toArray(supplier?.fabric_records)
    .filter((fabric) => fabric?.is_active !== false)
    .map((fabric) => ({
      value: buildSupplierFabricOptionValue(fabric),
      fabric_id: normalizeText(fabric?.id),
      fabric_code: normalizeText(fabric?.code),
      fabric_name: normalizeText(fabric?.name || fabric?.fabric_name),
      fabric_supplier_id: normalizeText(fabric?.fabric_supplier_id),
      fabric_supplier_name: normalizeText(fabric?.fabric_supplier_name),
      fabric_supplier_code: normalizeText(fabric?.fabric_supplier_code),
      label: formatSupplierFabricDisplay(fabric),
    }))
    .filter((fabric) => {
      if (!fabric.value || seen.has(fabric.value)) {
        return false;
      }

      seen.add(fabric.value);
      return true;
    })
    .sort((left, right) => left.label.localeCompare(right.label, "ar"));
};
const buildSupplierFabricModelOptions = (supplier, catalogOptions = []) => {
  const baseProductOptionsById = new Map(
    catalogOptions
      .filter(
        (option) =>
          normalizeText(option?.product_id) && !normalizeText(option?.variant_id),
      )
      .map((option) => [normalizeText(option.product_id), option]),
  );
  const lookup = new Map();

  for (const group of toArray(supplier?.fabric_catalog)) {
    const fabricKeys = getSupplierFabricLookupKeys(group);
    if (fabricKeys.length === 0) {
      continue;
    }

    const suggestions = [];
    const seenValues = new Set();

    for (const product of toArray(group?.products)) {
      const productId = normalizeText(product?.product_id);
      if (!productId) {
        continue;
      }

      const fallbackProductName =
        normalizeText(product?.product_name) || "منتج بدون اسم";
      const baseOption = baseProductOptionsById.get(productId) || {
        value: buildCatalogOptionValue(productId, ""),
        product_id: productId,
        variant_id: "",
        variant_title: "",
        product_name: fallbackProductName,
        sku: normalizeText(product?.sku),
        inventory_quantity: 0,
      };

      if (seenValues.has(baseOption.value)) {
        continue;
      }

      seenValues.add(baseOption.value);
      suggestions.push({
        ...baseOption,
        label: baseOption.sku
          ? `${baseOption.product_name} | ${PRODUCT_LEVEL_LINK_LABEL} | ${baseOption.sku}`
          : `${baseOption.product_name} | ${PRODUCT_LEVEL_LINK_LABEL}`,
      });
    }

    const sortedSuggestions = suggestions.sort((left, right) =>
      String(left.product_name || "").localeCompare(
        String(right.product_name || ""),
        "ar",
      ),
    );

    fabricKeys.forEach((key) => lookup.set(key, sortedSuggestions));
  }

  return lookup;
};
const findSupplierFabricOptionByItem = (fabricOptions = [], item = {}) =>
  (fabricOptions || []).find((option) =>
    getSupplierFabricLookupKeys({
      id: option?.fabric_id,
      code: option?.fabric_code,
      name: option?.fabric_name,
    }).some((key) =>
      getSupplierFabricLookupKeys({
        fabric_id: item?.fabric_id,
        fabric_code: item?.fabric_code,
        fabric_name: item?.fabric_name,
      }).includes(key),
    ),
  ) || null;

const isDeliveryItemDirty = (item) =>
  Boolean(
    normalizeText(item?.product_name) ||
    normalizeText(item?.catalog_query) ||
    normalizeText(item?.material) ||
    normalizeText(item?.color) ||
    normalizeText(item?.piece_label) ||
    normalizeText(item?.fabric_code) ||
    normalizeText(item?.fabric_name) ||
      normalizeText(item?.pieces_per_unit) ||
      normalizeText(item?.price_per_meter) ||
      normalizeText(item?.price_per_kilo) ||
      normalizeText(item?.piece_cost) ||
      normalizeText(item?.manufacturing_cost) ||
      normalizeText(item?.factory_service_cost) ||
      normalizeText(item?.unit_cost) ||
      normalizeText(item?.total_cost) ||
      normalizeText(item?.notes) ||
      normalizeText(item?.sku) ||
      (normalizeText(item?.quantity) && normalizeText(item?.quantity) !== "1"),
  );

export default function Suppliers() {
  const { hasPermission } = useAuth();
  const { locale, isRTL } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { supplierId: routeSupplierIdParam } = useParams();
  const canManageSuppliers = hasPermission("can_edit_suppliers");
  const supplierViewType = getSupplierViewType(location.pathname);
  const isFactorySuppliersView = supplierViewType === "factory";
  const routeSupplierId = normalizeText(routeSupplierIdParam);
  const isDetailRoute = Boolean(routeSupplierId);
  const suppliersListPath = useMemo(
    () => buildSuppliersListPath(supplierViewType),
    [supplierViewType],
  );
  const productCatalogCacheKey = useMemo(() => buildProductsCacheKey(), []);
  const initialProductCatalogRows = useMemo(
    () => peekCachedProducts(productCatalogCacheKey),
    [productCatalogCacheKey],
  );

  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [message, setMessage] = useState({ type: "", text: "" });
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState("");
  const [supplierForm, setSupplierForm] = useState(createEmptySupplierForm);
  const [showFabricForm, setShowFabricForm] = useState(false);
  const [editingFabricId, setEditingFabricId] = useState("");
  const [fabricForm, setFabricForm] = useState(createEmptyFabricForm);
  const [deliveryForm, setDeliveryForm] = useState(createEmptyDeliveryForm);
  const [paymentForm, setPaymentForm] = useState(createEmptyPaymentForm);
  const [productCatalogRows, setProductCatalogRows] = useState(
    () => initialProductCatalogRows,
  );
  const [relatedSuppliers, setRelatedSuppliers] = useState([]);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingFabric, setSavingFabric] = useState(false);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingProductLinks, setSavingProductLinks] = useState(false);
  const productCatalogRowsRef = useRef([]);

  useEffect(() => {
    productCatalogRowsRef.current = productCatalogRows;
  }, [productCatalogRows]);

  const productCatalogOptions = useMemo(
    () => buildProductCatalogOptions(productCatalogRows),
    [productCatalogRows],
  );
  const productCatalogByValue = useMemo(
    () => new Map(productCatalogOptions.map((option) => [option.value, option])),
    [productCatalogOptions],
  );

  const loadSuppliers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await suppliersAPI.list({ type: supplierViewType });
      const list = extractArray(response?.data);
      setSuppliers(list);
      setSelectedSupplierId((current) => {
        if (routeSupplierId) {
          return routeSupplierId;
        }
        if (current && list.some((supplier) => supplier.id === current)) {
          return current;
        }
        return list[0]?.id || "";
      });
    } catch (requestError) {
      console.error("Error loading suppliers:", requestError);
      setSuppliers([]);
      setSelectedSupplierId("");
      setSelectedSupplier(null);
      setError(
        requestError?.response?.data?.error || "فشل تحميل بيانات الموردين",
      );
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [routeSupplierId, supplierViewType]);

  const loadSupplierDetail = useCallback(async (supplierId, { silent = false } = {}) => {
    if (!supplierId) {
      setSelectedSupplier(null);
      return;
    }

    try {
      if (!silent) {
        setDetailLoading(true);
      }

      const response = await suppliersAPI.getById(supplierId, {
        type: supplierViewType,
      });
      setSelectedSupplier(response?.data?.supplier || null);
    } catch (requestError) {
      console.error("Error loading supplier detail:", requestError);
      setSelectedSupplier(null);
      setError(
        requestError?.response?.data?.error || "فشل تحميل تفاصيل المورد",
      );
      setError(getErrorMessage(requestError));
    } finally {
      if (!silent) {
        setDetailLoading(false);
      }
    }
  }, [supplierViewType]);

  const loadRelatedSuppliers = useCallback(async () => {
    if (!canManageSuppliers || !isFactorySuppliersView) {
      setRelatedSuppliers([]);
      return;
    }

    try {
      const response = await suppliersAPI.list({ type: "fabric" });
      setRelatedSuppliers(extractArray(response?.data));
    } catch (requestError) {
      console.error("Error loading related suppliers:", requestError);
      setRelatedSuppliers([]);
    }
  }, [canManageSuppliers, isFactorySuppliersView]);

  const loadProductCatalog = useCallback(async ({ silent = false, force = false } = {}) => {
    if (!canManageSuppliers || !isFactorySuppliersView) {
      setProductCatalogRows([]);
      setCatalogError("");
      return;
    }

    try {
      if (!force) {
        const { rows: cachedRows, isFresh } =
          await readCachedProducts(productCatalogCacheKey);
        if (cachedRows.length > 0) {
          setProductCatalogRows(cachedRows);
          if (isFresh) {
            setCatalogError("");
            return;
          }
        }
      }

      if (!silent) {
        setCatalogLoading(productCatalogRowsRef.current.length === 0);
      }
      setCatalogError("");

      const rows = await fetchProductPages({
        sortBy: "title",
        sortDir: "asc",
        cacheRefresh: force,
      });

      setProductCatalogRows(rows);
      await writeProductsCache(productCatalogCacheKey, rows);
    } catch (requestError) {
      console.error("Error loading supplier product catalog:", requestError);
      if (productCatalogRowsRef.current.length === 0) {
        setProductCatalogRows([]);
      }
      setCatalogError(getErrorMessage(requestError));
    } finally {
      if (!silent) {
        setCatalogLoading(false);
      }
    }
  }, [
    canManageSuppliers,
    isFactorySuppliersView,
    productCatalogCacheKey,
  ]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    if (routeSupplierId) {
      setSelectedSupplierId((current) =>
        current === routeSupplierId ? current : routeSupplierId,
      );
    }
  }, [routeSupplierId]);

  useEffect(() => {
    if (!isDetailRoute) {
      setSelectedSupplier(null);
      setDetailLoading(false);
      return;
    }

    loadSupplierDetail(selectedSupplierId);
  }, [isDetailRoute, loadSupplierDetail, selectedSupplierId]);

  useEffect(() => {
    if (!isDetailRoute) {
      return;
    }

    loadProductCatalog();
  }, [isDetailRoute, loadProductCatalog]);

  useEffect(() => {
    if (!isDetailRoute) {
      setRelatedSuppliers([]);
      return;
    }

    loadRelatedSuppliers();
  }, [isDetailRoute, loadRelatedSuppliers]);

  useEffect(() => {
    if (routeSupplierId) {
      return;
    }

    const requestedSupplierId = normalizeText(
      new URLSearchParams(location.search).get("supplier"),
    );
    if (!requestedSupplierId) {
      return;
    }

    if (!suppliers.some((supplier) => supplier.id === requestedSupplierId)) {
      return;
    }

    navigate(buildSupplierWorkspacePath(supplierViewType, requestedSupplierId), {
      replace: true,
    });
  }, [location.search, navigate, routeSupplierId, supplierViewType, suppliers]);

  useEffect(() => {
    const unsubscribe = subscribeToSharedDataUpdates((event) => {
      if (isSuppliersRelatedUpdate(event)) {
        loadSuppliers();
        if (isDetailRoute && selectedSupplierId) {
          loadSupplierDetail(selectedSupplierId, { silent: true });
          loadRelatedSuppliers();
        }
      }

      if (isDetailRoute && isProductsRelatedUpdate(event)) {
        loadProductCatalog({ silent: true, force: true });
      }
    });

    return () => unsubscribe();
  }, [
    loadProductCatalog,
    loadRelatedSuppliers,
    loadSupplierDetail,
    loadSuppliers,
    isDetailRoute,
    selectedSupplierId,
  ]);

  const filteredSuppliers = useMemo(() => {
    const keyword = String(searchTerm || "").trim().toLowerCase();
    if (!keyword) {
      return suppliers;
    }

    return suppliers.filter((supplier) =>
      [
        supplier?.name,
        supplier?.code,
        supplier?.contact_name,
        supplier?.phone,
        supplier?.address,
      ].some((value) => String(value || "").toLowerCase().includes(keyword)),
    );
  }, [searchTerm, suppliers]);

  const summary = useMemo(
    () =>
      suppliers.reduce(
        (acc, supplier) => {
          acc.total_suppliers += 1;
          if (supplier?.is_active !== false) {
            acc.active_suppliers += 1;
          }
          acc.total_deliveries += toNumber(supplier?.total_deliveries);
          acc.total_payments += toNumber(supplier?.total_payments);
          acc.outstanding_balance += toNumber(supplier?.outstanding_balance);
          return acc;
        },
        {
          total_suppliers: 0,
          active_suppliers: 0,
          total_deliveries: 0,
          total_payments: 0,
          outstanding_balance: 0,
        },
      ),
    [suppliers],
  );

  const selectedSupplierSummary = useMemo(
    () =>
      suppliers.find(
        (supplier) => normalizeText(supplier?.id) === normalizeText(routeSupplierId),
      ) || null,
    [routeSupplierId, suppliers],
  );
  const activeSupplierPreview = selectedSupplier || selectedSupplierSummary;

  const openSupplierWorkspace = (supplierId) => {
    const normalizedSupplierId = normalizeText(supplierId);
    if (!normalizedSupplierId) {
      return;
    }

    navigate(buildSupplierWorkspacePath(supplierViewType, normalizedSupplierId));
  };

  const startCreatingSupplier = () => {
    setEditingSupplierId("");
    setSupplierForm(() => ({
      ...createEmptySupplierForm(),
      supplier_type: supplierViewType,
    }));
    setShowSupplierForm(true);
  };

  const startEditingSupplier = () => {
    if (!selectedSupplier) {
      return;
    }

    setEditingSupplierId(selectedSupplier.id);
    setSupplierForm(buildSupplierFormFromRecord(selectedSupplier));
    setShowSupplierForm(true);
  };

  const closeSupplierForm = () => {
    setEditingSupplierId("");
    setSupplierForm({
      ...createEmptySupplierForm(),
      supplier_type: supplierViewType,
    });
    setShowSupplierForm(false);
  };

  const backToSuppliersList = () => {
    closeSupplierForm();
    navigate(suppliersListPath);
  };

  const refreshCurrentView = async () => {
    await loadSuppliers();

    if (isDetailRoute && selectedSupplierId) {
      await Promise.all([
        loadSupplierDetail(selectedSupplierId, { silent: true }),
        loadRelatedSuppliers(),
        loadProductCatalog({ silent: true, force: true }),
      ]);
    }
  };

  const startCreatingSupplierFlow = () => {
    startCreatingSupplier();
    if (isDetailRoute) {
      navigate(suppliersListPath);
    }
  };

  const startCreatingFabric = () => {
    setEditingFabricId("");
    setFabricForm(createEmptyFabricForm());
    setShowFabricForm(true);
  };

  const startEditingFabric = (fabric) => {
    if (!fabric) {
      return;
    }

    setEditingFabricId(fabric.id || "");
    setFabricForm(buildFabricFormFromRecord(fabric));
    setShowFabricForm(true);
  };

  const closeFabricForm = () => {
    setEditingFabricId("");
    setFabricForm(createEmptyFabricForm());
    setShowFabricForm(false);
  };

  const saveSupplier = async () => {
    if (!supplierForm.name.trim()) {
      setMessage({ type: "error", text: "اسم المورد مطلوب" });
      return;
    }

    try {
      setSavingSupplier(true);
      setMessage({ type: "", text: "" });

      const payload = {
        ...supplierForm,
        supplier_type: supplierViewType,
        opening_balance: supplierForm.opening_balance || 0,
      };

      let nextSupplierId = editingSupplierId;
      if (editingSupplierId) {
        await suppliersAPI.update(editingSupplierId, payload);
      } else {
        const response = await suppliersAPI.create(payload);
        nextSupplierId = response?.data?.id || "";
      }

      await loadSuppliers();
      if (nextSupplierId) {
        setSelectedSupplierId(nextSupplierId);
        await loadSupplierDetail(nextSupplierId);
        navigate(buildSupplierWorkspacePath(supplierViewType, nextSupplierId));
      }
      setMessage({
        type: "success",
        text: editingSupplierId
          ? "تم تحديث بيانات المورد"
          : "تم إضافة المورد بنجاح",
      });
      closeSupplierForm();
    } catch (requestError) {
      console.error("Error saving supplier:", requestError);
      setMessage({
        type: "error",
        text: requestError?.response?.data?.error || "فشل حفظ بيانات المورد",
      });
    } finally {
      setSavingSupplier(false);
    }
  };

  const saveFabric = async () => {
    if (!selectedSupplierId) {
      setMessage({ type: "error", text: "اختر موردًا أولًا" });
      return;
    }

    if (!normalizeText(fabricForm.name)) {
      setMessage({ type: "error", text: "اسم القماش مطلوب" });
      return;
    }

    try {
      setSavingFabric(true);
      setMessage({ type: "", text: "" });

      const payload = {
        ...fabricForm,
        fabric_supplier_id: normalizeText(fabricForm.fabric_supplier_id),
      };

      if (editingFabricId) {
        await suppliersAPI.updateFabric(selectedSupplierId, editingFabricId, payload);
      } else {
        await suppliersAPI.addFabric(selectedSupplierId, payload);
      }

      await Promise.all([loadSuppliers(), loadSupplierDetail(selectedSupplierId)]);
      setMessage({
        type: "success",
        text: editingFabricId ? "تم تحديث بيانات القماش" : "تم إضافة القماش بنجاح",
      });
      closeFabricForm();
    } catch (requestError) {
      console.error("Error saving supplier fabric:", requestError);
      setMessage({
        type: "error",
        text:
          requestError?.response?.data?.error || "فشل حفظ بيانات القماش",
      });
    } finally {
      setSavingFabric(false);
    }
  };

  const updateDeliveryItem = (index, field, value) => {
    setDeliveryForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [field]: value,
              ...(field === "fabric_code" || field === "fabric_name"
                ? { fabric_id: "", fabric_supplier_id: "" }
                : {}),
            }
          : item,
      ),
    }));
  };

  const selectDeliveryProduct = (index, selectedValue) => {
    const selectedOption = productCatalogByValue.get(selectedValue);

    setDeliveryForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        if (!selectedOption) {
          return {
            ...item,
            product_id: "",
            variant_id: "",
            variant_title: "",
            product_name: "",
            sku: "",
          };
        }

        return {
          ...item,
          product_id: selectedOption.product_id,
          variant_id: selectedOption.variant_id,
          variant_title: selectedOption.variant_title,
          product_name: selectedOption.product_name,
          sku: selectedOption.sku,
          catalog_query: selectedOption.label,
        };
      }),
    }));
  };

  const selectDeliveryFabric = (index, selectedValue) => {
    const selectedFabric = buildSupplierFabricOptions(selectedSupplier).find(
      (option) => option.value === selectedValue,
    );

    setDeliveryForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }

        if (!selectedFabric) {
          return {
            ...item,
            fabric_id: "",
            fabric_code: "",
            fabric_supplier_id: "",
          };
        }

        return {
          ...item,
          fabric_id: selectedFabric.fabric_id,
          fabric_code: selectedFabric.fabric_code,
          fabric_name: selectedFabric.fabric_name,
          fabric_supplier_id: selectedFabric.fabric_supplier_id,
        };
      }),
    }));
  };

  const addDeliveryItem = () => {
    setDeliveryForm((current) => ({
      ...current,
      items: [...current.items, createEmptyDeliveryItem()],
    }));
  };

  const removeDeliveryItem = (index) => {
    setDeliveryForm((current) => ({
      ...current,
      items:
        current.items.length > 1
          ? current.items.filter((_, itemIndex) => itemIndex !== index)
          : current.items,
    }));
  };

  const saveDelivery = async () => {
    if (!selectedSupplierId) {
      setMessage({ type: "error", text: "اختر مورد أولًا" });
      return;
    }

    const normalizedItems = deliveryForm.items.filter(isDeliveryItemDirty);

    if (normalizedItems.length === 0) {
      setMessage({
        type: "error",
        text: "أضف موديلًا أو قماشًا واحدًا على الأقل داخل الوارد",
      });
      return;
    }

    if (normalizedItems.some((item) => !normalizeText(item?.product_name))) {
      setMessage({
        type: "error",
        text: "اكتب اسم الموديل أو القماشة أو اخترها من الكتالوج قبل حفظ الوارد",
      });
      return;
    }

    if (normalizedItems.some((item) => toNumber(item?.quantity) <= 0)) {
      setMessage({
        type: "error",
        text: "كمية كل صنف يجب أن تكون أكبر من صفر",
      });
      return;
    }

    try {
      setSavingDelivery(true);
      setMessage({ type: "", text: "" });

      await suppliersAPI.addDelivery(selectedSupplierId, {
        ...deliveryForm,
        items: normalizedItems.map((item) => ({
          ...item,
          piece_cost: item.piece_cost || getDeliveryItemPieceCost(item),
          unit_cost: item.unit_cost || getDeliveryItemSuggestedUnitCost(item),
          total_cost: item.total_cost || getDeliveryItemTotal(item),
        })),
      });

      await Promise.all([loadSuppliers(), loadSupplierDetail(selectedSupplierId)]);
      setDeliveryForm(createEmptyDeliveryForm());
      setMessage({ type: "success", text: "تم تسجيل الوارد بنجاح" });
    } catch (requestError) {
      console.error("Error saving delivery:", requestError);
      setMessage({
        type: "error",
        text: requestError?.response?.data?.error || "فشل تسجيل الوارد",
      });
    } finally {
      setSavingDelivery(false);
    }
  };

  const savePayment = async () => {
    if (!selectedSupplierId) {
      setMessage({ type: "error", text: "اختر مورد أولًا" });
      return;
    }

    if (toNumber(paymentForm.amount) <= 0) {
      setMessage({ type: "error", text: "قيمة الدفعة يجب أن تكون أكبر من صفر" });
      return;
    }

    try {
      setSavingPayment(true);
      setMessage({ type: "", text: "" });
      await suppliersAPI.addPayment(selectedSupplierId, paymentForm);
      await Promise.all([loadSuppliers(), loadSupplierDetail(selectedSupplierId)]);
      setPaymentForm(createEmptyPaymentForm());
      setMessage({ type: "success", text: "تم تسجيل الدفعة بنجاح" });
    } catch (requestError) {
      console.error("Error saving payment:", requestError);
      setMessage({
        type: "error",
        text: requestError?.response?.data?.error || "فشل تسجيل الدفعة",
      });
    } finally {
      setSavingPayment(false);
    }
  };

  const saveSupplierProductLinks = async (links) => {
    if (!selectedSupplierId) {
      setMessage({ type: "error", text: "اختر موردًا أولًا" });
      return;
    }

    try {
      setSavingProductLinks(true);
      setMessage({ type: "", text: "" });
      await suppliersAPI.updateProductLinks(selectedSupplierId, { links });
      await Promise.all([
        loadSuppliers(),
        loadSupplierDetail(selectedSupplierId),
        loadProductCatalog({ silent: true, force: true }),
      ]);
      setMessage({
        type: "success",
        text: "تم حفظ ربط المنتجات بالمورد",
      });
    } catch (requestError) {
      console.error("Error saving supplier product links:", requestError);
      setMessage({
        type: "error",
        text:
          requestError?.response?.data?.error ||
          "فشل حفظ ربط المنتجات بالمورد",
      });
    } finally {
      setSavingProductLinks(false);
    }
  };

  if (typeof window !== "undefined") {
    return (
    <div className="flex min-h-screen bg-transparent">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section className="app-toolbar rounded-[30px] p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                  <Truck size={14} />
                  {translateSupplierUiText(
                    isFactorySuppliersView ? "Ù…ÙˆØ±Ø¯Ùˆ Ø§Ù„Ù…ØµØ§Ù†Ø¹" : "Ù…ÙˆØ±Ø¯ÙŠ Ø§Ù„Ù‚Ù…Ø§Ø´",
                    locale,
                  )}
                </div>
                <h1 className="mt-4 flex items-center gap-3 text-3xl font-semibold tracking-[-0.04em] text-slate-900">
                  <Truck className="text-sky-700" size={28} />
                  {translateSupplierUiText(
                    getSupplierViewTitle(supplierViewType),
                    locale,
                  )}
                </h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                  {isFactorySuppliersView
                    ? translateSupplierUiText(
                        "ملف المورد يركز على البيانات الأساسية، بينما تفاصيل الواردات والدفعات تُسجل داخل الحركات بكل تفاصيلها.",
                        locale,
                      )
                    : translateSupplierUiText(
                        "تفاصيل موردي القماش وروابطهم مع المصانع والأقمشة المرتبطة بكل مورد.",
                        locale,
                      )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={refreshCurrentView}
                  className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  <RefreshCw size={18} />
                  {translateSupplierUiText("تحديث", locale)}
                </button>
                {canManageSuppliers ? (
                  <button
                    onClick={startCreatingSupplierFlow}
                    className="app-button-primary inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    <Plus size={18} />
                    {translateSupplierUiText(
                      supplierViewType === "fabric"
                        ? "مورد قماش جديد"
                        : "مورد مصنع جديد",
                      locale,
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
              <AlertCircle size={18} />
              {error}
            </div>
          ) : null}

          {message.text ? (
            <div
              className={`flex items-center gap-2 rounded-xl border p-4 ${
                message.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {message.type === "success" ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
              {message.text}
            </div>
          ) : null}

          {isDetailRoute ? (
            <>
              <section className="app-surface rounded-[30px] p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <button
                      onClick={backToSuppliersList}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <ArrowLeft size={16} />
                      رجوع إلى قائمة الموردين
                    </button>

                    <div className="mt-4">
                      <div className="app-chip inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-slate-700">
                        <Building2 size={14} />
                        {translateSupplierUiText(
                          isFactorySuppliersView ? "Ù…ÙˆØ±Ø¯Ùˆ Ø§Ù„Ù…ØµØ§Ù†Ø¹" : "Ù…ÙˆØ±Ø¯ÙŠ Ø§Ù„Ù‚Ù…Ø§Ø´",
                          locale,
                        )}
                      </div>
                      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-slate-900">
                        {activeSupplierPreview?.name || "Ù…Ù„Ù Ø§Ù„Ù…ÙˆØ±Ø¯"}
                      </h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {translateSupplierUiText(getSupplierCodeLabel(supplierViewType), locale)}:{" "}
                        {activeSupplierPreview?.code || "-"}
                      </p>
                    </div>
                  </div>

                  {activeSupplierPreview ? (
                    <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[420px]">
                      <KeyValueCompact
                        label={isFactorySuppliersView ? "Ø§Ù„ÙˆØ§Ø±Ø¯" : "Ø§Ù„Ù‚ÙŠÙ…Ø©"}
                        value={formatCurrency(activeSupplierPreview.total_deliveries)}
                      />
                      <KeyValueCompact
                        label={isFactorySuppliersView ? "Ø§Ù„Ø±ØµÙŠØ¯" : "Ø§Ù„Ù…Ù†ØªØ¬Ø§Øª"}
                        value={
                          isFactorySuppliersView
                            ? formatCurrency(activeSupplierPreview.outstanding_balance)
                            : formatCount(activeSupplierPreview.products_count)
                        }
                      />
                      <KeyValueCompact
                        label={isFactorySuppliersView ? "Ø§Ù„Ø£ØµÙ†Ø§Ù" : "Ø§Ù„Ù…ØµØ§Ù†Ø¹"}
                        value={
                          isFactorySuppliersView
                            ? formatCount(activeSupplierPreview.received_items_count)
                            : formatCount(activeSupplierPreview.linked_factories_count)
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </section>

              {canManageSuppliers && showSupplierForm ? (
                <section className="app-surface rounded-[28px] p-4 sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {editingSupplierId ? "ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ù…ÙˆØ±Ø¯" : "Ø¥Ø¶Ø§ÙØ© Ù…ÙˆØ±Ø¯"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…ÙˆØ±Ø¯ Ø§Ù„Ø£Ø³Ø§Ø³ÙŠØ© ÙˆØ¥Ø¯Ø§Ø±ØªÙ‡ Ø¨ØªØªÙ… Ù…Ù† Ø¯Ø§Ø®Ù„ Ù…Ù„ÙÙ‡ Ù…Ø¨Ø§Ø´Ø±Ø©.
                      </p>
                    </div>
                    <button
                      onClick={closeSupplierForm}
                      className="app-button-secondary rounded-2xl px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      Ø¥ØºÙ„Ø§Ù‚
                    </button>
                  </div>

                  <SupplierForm
                    form={supplierForm}
                    setForm={setSupplierForm}
                    supplierType={supplierViewType}
                    saving={savingSupplier}
                    onSave={saveSupplier}
                  />
                </section>
              ) : null}

              <div className="space-y-6">
                {renderDetails({
                  selectedSupplierId,
                  selectedSupplier,
                  supplierViewType,
                  detailLoading,
                  canEditProducts: canManageSuppliers,
                  startEditingSupplier,
                  showFabricForm,
                  editingFabricId,
                  fabricForm,
                  setFabricForm,
                  savingFabric,
                  startCreatingFabric,
                  startEditingFabric,
                  saveFabric,
                  closeFabricForm,
                  relatedSuppliers,
                  deliveryForm,
                  setDeliveryForm,
                  updateDeliveryItem,
                  selectDeliveryFabric,
                  selectDeliveryProduct,
                  removeDeliveryItem,
                  addDeliveryItem,
                  saveDelivery,
                  savingDelivery,
                  paymentForm,
                  setPaymentForm,
                  savePayment,
                  savingPayment,
                  savingProductLinks,
                  saveSupplierProductLinks,
                  catalogLoading,
                  catalogError,
                  productCatalogOptions,
                  productCatalogByValue,
                })}
              </div>
            </>
          ) : (
            <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title={isFactorySuppliersView ? "إجمالي المصانع" : "إجمالي موردي القماش"}
              value={formatCount(summary.total_suppliers)}
              subtitle={`${formatCount(summary.active_suppliers)} ${translateSupplierUiText("مورد نشط", locale)}`}
              icon={Building2}
              tone="sky"
            />
            <SummaryCard
              title={isFactorySuppliersView ? "إجمالي الوارد" : "القيمة المرتبطة"}
              value={formatCurrency(summary.total_deliveries)}
              subtitle={isFactorySuppliersView ? "قيمة كل الشحنات المسجلة" : "إجمالي القيمة المرتبطة بالأقمشة والموديلات"}
              icon={Package}
              tone="blue"
            />
            <SummaryCard
              title={isFactorySuppliersView ? "إجمالي المدفوع" : "إجمالي الأقمشة المرتبطة"}
              value={
                isFactorySuppliersView
                  ? formatCurrency(summary.total_payments)
                  : formatCount(
                      suppliers.reduce(
                        (acc, supplier) => acc + toNumber(supplier?.registered_fabrics_count),
                        0,
                      ),
                    )
              }
              subtitle={
                isFactorySuppliersView
                  ? "كل الدفعات المسجلة للموردين"
                  : "عدد أكواد الأقمشة المرتبطة بموردي القماش"
              }
              icon={Wallet}
              tone="emerald"
            />
            <SummaryCard
              title={isFactorySuppliersView ? "الرصيد المستحق" : "المصانع المرتبطة"}
              value={
                isFactorySuppliersView
                  ? formatCurrency(summary.outstanding_balance)
                  : formatCount(
                      suppliers.reduce(
                        (acc, supplier) => acc + toNumber(supplier?.linked_factories_count),
                        0,
                      ),
                    )
              }
              subtitle={
                isFactorySuppliersView
                  ? "المتبقي على حساب الموردين"
                  : "إجمالي المصانع المرتبطة بموردي القماش"
              }
              icon={CreditCard}
              tone="amber"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-12">
            <div className="space-y-6 xl:col-span-12">
              <div className="app-surface rounded-[28px] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      {translateSupplierUiText(
                        isFactorySuppliersView ? "Ù…ÙˆØ±Ø¯Ùˆ Ø§Ù„Ù…ØµØ§Ù†Ø¹" : "Ù…ÙˆØ±Ø¯ÙŠ Ø§Ù„Ù‚Ù…Ø§Ø´",
                        locale,
                      )}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatCount(filteredSuppliers.length)} / {formatCount(suppliers.length)}
                    </p>
                  </div>
                  <div className="app-chip px-3 py-1 text-xs font-semibold text-slate-600">
                    {translateSupplierUiText("Ø¢Ø®Ø± Ù†Ø´Ø§Ø·", locale)}
                  </div>
                </div>
                <div className="relative">
                  <Search
                    className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${
                      isRTL ? "right-3" : "left-3"
                    }`}
                    size={16}
                  />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={translateSupplierUiText(
                      "ابحث باسم المورد أو الكود أو الهاتف",
                      locale,
                    )}
                    className={`app-input py-3 ${
                      isRTL ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left"
                    }`}
                  />
                </div>

                <div className="mt-4 space-y-3">
                  {loading ? (
                    <EmptyState text="جاري تحميل الموردين..." />
                  ) : filteredSuppliers.length === 0 ? (
                    <EmptyState text="لا يوجد موردون مطابقون للبحث الحالي." />
                  ) : (
                    filteredSuppliers.map((supplier) => (
                        <button
                          key={supplier.id}
                          onClick={() => openSupplierWorkspace(supplier.id)}
                          className="w-full rounded-[24px] border border-slate-200 bg-white/80 p-4 text-right transition hover:border-sky-300 hover:bg-white"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                                  <Building2 size={18} />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-base font-semibold text-slate-900">
                                    {supplier.name}
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {translateSupplierUiText(
                                      getSupplierCodeLabel(supplierViewType),
                                      locale,
                                    )}
                                    : {supplier.code || "-"}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                supplier.is_active !== false
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {supplier.is_active !== false ? "نشط" : "مؤرشف"}
                            </span>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-3">
                            {isFactorySuppliersView ? (
                              <>
                                <KeyValueCompact label="الوارد" value={formatCurrency(supplier.total_deliveries)} />
                                <KeyValueCompact label="المدفوع" value={formatCurrency(supplier.total_payments)} />
                                <KeyValueCompact label="الرصيد" value={formatCurrency(supplier.outstanding_balance)} />
                                <KeyValueCompact label="الكمية" value={formatCount(supplier.received_quantity)} />
                                <KeyValueCompact label="الموديلات" value={formatCount(supplier.products_count)} />
                                <KeyValueCompact label="الأقمشة" value={formatCount(supplier.fabrics_count)} />
                              </>
                            ) : (
                              <>
                                <KeyValueCompact label="الأقمشة" value={formatCount(supplier.registered_fabrics_count)} />
                                <KeyValueCompact label="المصانع" value={formatCount(supplier.linked_factories_count)} />
                                <KeyValueCompact label="المنتجات" value={formatCount(supplier.products_count)} />
                                <KeyValueCompact label="الواردات" value={formatCount(supplier.deliveries_count)} />
                                <KeyValueCompact label="الكمية" value={formatCount(supplier.received_quantity)} />
                                <KeyValueCompact label="القيمة" value={formatCurrency(supplier.total_deliveries)} />
                              </>
                            )}
                          </div>
                        </button>
                    ))
                  )}
                </div>
              </div>

              {canManageSuppliers ? (
                <div className="app-surface rounded-[28px] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">
                        {editingSupplierId ? "تعديل المورد" : "إضافة مورد"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        بيانات المورد الأساسية فقط. تفاصيل الدفع تُسجل داخل الدفعات.
                      </p>
                    </div>
                    {showSupplierForm ? (
                      <button
                        onClick={closeSupplierForm}
                        className="app-button-secondary rounded-2xl px-3 py-2 text-sm font-semibold text-slate-600"
                      >
                        إغلاق
                      </button>
                    ) : null}
                  </div>

                  {!showSupplierForm ? (
                    <div className="space-y-3">
                      <button
                        onClick={startCreatingSupplier}
                        className="app-button-primary w-full rounded-2xl px-4 py-3 text-sm font-semibold text-white"
                      >
                        إنشاء مورد جديد
                      </button>
                      {selectedSupplier ? (
                        <button
                          onClick={startEditingSupplier}
                          className="app-button-secondary w-full rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700"
                        >
                          تعديل المورد الحالي
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <SupplierForm
                      form={supplierForm}
                      setForm={setSupplierForm}
                      supplierType={supplierViewType}
                      saving={savingSupplier}
                      onSave={saveSupplier}
                    />
                  )}
                </div>
              ) : null}
            </div>

          </section>
            </>
          )}
        </div>
      </main>
    </div>
    );
  }
}


function renderDetails({
  selectedSupplierId,
  selectedSupplier,
  supplierViewType,
  detailLoading,
  canEditProducts,
  startEditingSupplier,
  showFabricForm,
  editingFabricId,
  fabricForm,
  setFabricForm,
  savingFabric,
  startCreatingFabric,
  startEditingFabric,
  saveFabric,
  closeFabricForm,
  relatedSuppliers,
  deliveryForm,
  setDeliveryForm,
  updateDeliveryItem,
  selectDeliveryFabric,
  selectDeliveryProduct,
  removeDeliveryItem,
  addDeliveryItem,
  saveDelivery,
  savingDelivery,
  paymentForm,
  setPaymentForm,
  savePayment,
  savingPayment,
  savingProductLinks,
  saveSupplierProductLinks,
  catalogLoading,
  catalogError,
  productCatalogOptions,
  productCatalogByValue,
}) {
  if (!selectedSupplierId) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
        اختر موردًا من القائمة أو أضف موردًا جديدًا للبدء.
      </div>
    );
  }

  if (detailLoading && !selectedSupplier) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
        جاري تحميل تفاصيل المورد...
      </div>
    );
  }

  if (!selectedSupplier) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
        تعذر تحميل المورد الحالي.
      </div>
    );
  }

  const isFactorySuppliersView = supplierViewType === "factory";

  if (!isFactorySuppliersView) {
    return (
      <FabricSupplierDetails
        supplier={selectedSupplier}
        canEditProducts={canEditProducts}
        startEditingSupplier={startEditingSupplier}
      />
    );
  }

  if (typeof window !== "undefined") {
    return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard
          title="إجمالي الوارد"
          value={formatCurrency(selectedSupplier.total_deliveries)}
          subtitle={`${formatCount(selectedSupplier.deliveries_count)} حركة وارد`}
          icon={Package}
          tone="blue"
        />
        <SummaryCard
          title="إجمالي المدفوع"
          value={formatCurrency(selectedSupplier.total_payments)}
          subtitle={`${formatCount(selectedSupplier.payments_count)} دفعة`}
          icon={Wallet}
          tone="emerald"
        />
        <SummaryCard
          title="الرصيد الحالي"
          value={formatCurrency(selectedSupplier.outstanding_balance)}
          subtitle={`رصيد افتتاحي ${formatCurrency(selectedSupplier.opening_balance)}`}
          icon={CreditCard}
          tone="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={selectedSupplier.name}
          subtitle={`كود المصنع: ${selectedSupplier.code || "-"}`}
          action={
            canEditProducts ? (
              <button
                onClick={startEditingSupplier}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                تعديل المورد
              </button>
            ) : null
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLine label="المسؤول" value={selectedSupplier.contact_name} />
            <DetailLine label="الهاتف" value={selectedSupplier.phone} />
            <DetailLine label="العنوان" value={selectedSupplier.address} />
            <DetailLine
              label="الحالة"
              value={selectedSupplier.is_active !== false ? "نشط" : "مؤرشف"}
            />
            <DetailLine
              label="آخر وارد"
              value={formatDateTime(selectedSupplier.last_delivery_at)}
            />
            <DetailLine
              label="آخر دفعة"
              value={formatDateTime(selectedSupplier.last_payment_at)}
            />
            <DetailLine
              label="أكواد الأقمشة المسجلة"
              value={formatCount(selectedSupplier.registered_fabrics_count)}
            />
            <DetailLine
              label="موردي القماش المرتبطين"
              value={formatCount(selectedSupplier.linked_fabric_suppliers_count)}
            />
          </div>
          {selectedSupplier.notes ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              {selectedSupplier.notes}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard
          title="ملخص المتابعة"
          subtitle="الكميات والحساب الحالي لهذا المورد"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLine
              label="الأصناف المستلمة"
              value={formatCount(selectedSupplier.received_items_count)}
            />
            <DetailLine
              label="إجمالي الكمية"
              value={formatCount(selectedSupplier.received_quantity)}
            />
            <DetailLine
              label="إجمالي الوارد"
              value={formatCurrency(selectedSupplier.total_deliveries)}
            />
            <DetailLine
              label="إجمالي المدفوع"
              value={formatCurrency(selectedSupplier.total_payments)}
            />
            <DetailLine
              label="عدد الموديلات"
              value={formatCount(selectedSupplier.products_count)}
            />
            <DetailLine
              label="عدد الأقمشة"
              value={formatCount(selectedSupplier.fabrics_count)}
            />
          </div>
        </SectionCard>
      </div>

      <SupplierFabricsSection
        supplier={selectedSupplier}
        fabricSuppliers={relatedSuppliers}
        showForm={showFabricForm}
        editingFabricId={editingFabricId}
        form={fabricForm}
        setForm={setFabricForm}
        saving={savingFabric}
        onStartCreate={startCreatingFabric}
        onStartEdit={startEditingFabric}
        onSave={saveFabric}
        onCancel={closeFabricForm}
        canManage={canEditProducts}
      />

      <SupplierCatalogWorkspace supplier={selectedSupplier} />

      <SupplierProductLinksSection
        supplier={selectedSupplier}
        catalogOptions={productCatalogOptions}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        canManage={canEditProducts}
        saving={savingProductLinks}
        onSave={saveSupplierProductLinks}
      />

      {canEditProducts ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <DeliveryForm
            supplier={selectedSupplier}
            form={deliveryForm}
            setForm={setDeliveryForm}
            updateItem={updateDeliveryItem}
            selectFabric={selectDeliveryFabric}
            selectProduct={selectDeliveryProduct}
            removeItem={removeDeliveryItem}
            addItem={addDeliveryItem}
            onSave={saveDelivery}
            saving={savingDelivery}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            catalogOptions={productCatalogOptions}
            catalogByValue={productCatalogByValue}
          />
          <PaymentForm
            form={paymentForm}
            setForm={setPaymentForm}
            onSave={savePayment}
            saving={savingPayment}
          />
        </div>
      ) : null}

      <ReceivedItemsTable items={selectedSupplier.received_items || []} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PaymentsList payments={selectedSupplier.payments || []} />
        <EntriesTimeline entries={selectedSupplier.entries || []} />
      </div>
    </>
    );
  }
}


function FabricSupplierDetails({
  supplier,
  canEditProducts,
  startEditingSupplier,
}) {
  const { locale } = useLocale();
  const linkedFabricRecords = toArray(
    supplier?.linked_fabric_records || supplier?.fabric_records,
  );
  const linkedFactories = toArray(supplier?.linked_factory_suppliers);
  const linkedFactoriesSummary = linkedFactories.map((linkedSupplier) => ({
    ...linkedSupplier,
    linked_fabrics_count: linkedFabricRecords.filter(
      (fabric) =>
        normalizeText(fabric?.supplier_id) === normalizeText(linkedSupplier?.id),
    ).length,
  }));

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard
          title="أكواد القماش"
          value={formatCount(supplier.registered_fabrics_count)}
          subtitle={`${formatCount(linkedFabricRecords.length)} كود مرتبط`}
          icon={Package}
          tone="blue"
        />
        <SummaryCard
          title="المصانع المرتبطة"
          value={formatCount(linkedFactories.length)}
          subtitle="إنشاء الربط يتم من صفحة المصنع"
          icon={Truck}
          tone="sky"
        />
        <SummaryCard
          title="آخر نشاط"
          value={formatDateTime(supplier.last_delivery_at)}
          subtitle={supplier.is_active !== false ? "نشط" : "مؤرشف"}
          icon={Wallet}
          tone="emerald"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title={supplier.name}
          subtitle={`كود مورد القماش: ${supplier.code || "-"}`}
          action={
            canEditProducts ? (
              <button
                onClick={startEditingSupplier}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                تعديل المورد
              </button>
            ) : null
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLine label="المسؤول" value={supplier.contact_name} />
            <DetailLine label="الهاتف" value={supplier.phone} />
            <DetailLine label="العنوان" value={supplier.address} />
            <DetailLine
              label="الحالة"
              value={supplier.is_active !== false ? "نشط" : "مؤرشف"}
            />
            <DetailLine
              label="آخر نشاط"
              value={formatDateTime(supplier.last_delivery_at)}
            />
            <DetailLine
              label="أكواد الأقمشة"
              value={formatCount(supplier.registered_fabrics_count)}
            />
          </div>
          {supplier.notes ? (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              {supplier.notes}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard
          title="ملخص الربط"
          subtitle="هذه الصفحة مرجعية لبيانات مورد القماش فقط، أما إنشاء الربط مع خامات المصانع فيتم من صفحة المصنع."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLine
              label="أكواد القماش"
              value={formatCount(supplier.registered_fabrics_count)}
            />
            <DetailLine
              label="المصانع المرتبطة"
              value={formatCount(linkedFactories.length)}
            />
            <DetailLine
              label="عدد الموديلات المرتبطة"
              value={formatCount(supplier.products_count)}
            />
            <DetailLine
              label="آخر نشاط"
              value={formatDateTime(supplier.last_delivery_at)}
            />
          </div>
        </SectionCard>
      </div>

      <SupplierCatalogWorkspace supplier={supplier} />

      <SectionCard
        title="مراجع الاستخدام"
        subtitle="عرض مرجعي للمصانع التي تستخدم خامات مرتبطة بهذا المورد."
      >
        {linkedFactoriesSummary.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {linkedFactoriesSummary.map((linkedSupplier) => (
              <div
                key={linkedSupplier.id || linkedSupplier.name}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {linkedSupplier.name || "-"}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {linkedSupplier.code ? `كود المصنع: ${linkedSupplier.code}` : "بدون كود"}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600">
                    {formatCount(linkedSupplier.linked_fabrics_count)}{" "}
                    {translateSupplierUiText("أكواد القماش", locale)}
                  </span>
                </div>
                {linkedSupplier.phone ? (
                  <div className="mt-3 text-xs text-slate-500">
                    {linkedSupplier.phone}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="لا توجد مصانع مرتبطة بهذا المورد حتى الآن." />
        )}
      </SectionCard>

      <SectionCard
        title="أكواد القماش المرتبطة"
        subtitle="الأكواد المرتبطة بهذا المورد مع توضيح المصنع الذي يستخدم كل كود."
      >
        {linkedFabricRecords.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {linkedFabricRecords.map((fabric) => (
              <div
                key={fabric.id || `${fabric.code}-${fabric.name}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {formatSupplierFabricDisplay(fabric)}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {fabric.supplier_name
                        ? fabric.supplier_code
                          ? `المصنع: ${fabric.supplier_code} | ${fabric.supplier_name}`
                          : `المصنع: ${fabric.supplier_name}`
                        : "-"}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      fabric.is_active !== false
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {fabric.is_active !== false ? "نشط" : "مؤرشف"}
                  </span>
                </div>
                {fabric.notes ? (
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                    {fabric.notes}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="لا توجد أكواد قماش مرتبطة بهذا المورد حتى الآن." />
        )}
      </SectionCard>
    </>
  );
}

function SupplierProductLinksSection({
  supplier,
  catalogOptions = [],
  catalogLoading = false,
  catalogError = "",
  canManage = false,
  saving = false,
  onSave,
}) {
  const productLinks = useMemo(
    () => toArray(supplier?.product_links),
    [supplier?.product_links],
  );
  const [draftValues, setDraftValues] = useState([]);
  const [selectedOptionValue, setSelectedOptionValue] = useState("");

  const optionByValue = useMemo(() => {
    const map = new Map();

    for (const option of catalogOptions || []) {
      map.set(option.value, option);
    }

    for (const link of productLinks) {
      const value = buildCatalogOptionValue(link?.product_id, link?.variant_id);
      if (!value || map.has(value)) {
        continue;
      }

      const label = [
        normalizeText(link?.product_name) || "منتج",
        normalizeText(link?.variant_title),
        normalizeText(link?.sku),
      ]
        .filter(Boolean)
        .join(" | ");

      map.set(value, {
        value,
        product_id: normalizeText(link?.product_id),
        variant_id: normalizeText(link?.variant_id),
        product_name: normalizeText(link?.product_name),
        variant_title: normalizeText(link?.variant_title),
        sku: normalizeText(link?.sku),
        label: label || value,
        searchText: label.toLowerCase(),
      });
    }

    return map;
  }, [catalogOptions, productLinks]);

  useEffect(() => {
    setDraftValues(
      productLinks
        .map((link) => buildCatalogOptionValue(link?.product_id, link?.variant_id))
        .filter(Boolean),
    );
    setSelectedOptionValue("");
  }, [supplier?.id, productLinks]);

  const availableOptions = useMemo(
    () =>
      (catalogOptions || []).filter((option) => !draftValues.includes(option.value)),
    [catalogOptions, draftValues],
  );

  const linkedOptions = useMemo(
    () =>
      draftValues
        .map((value) => optionByValue.get(value))
        .filter(Boolean)
        .sort((left, right) => left.label.localeCompare(right.label, "ar")),
    [draftValues, optionByValue],
  );

  const addSelectedProduct = () => {
    if (!selectedOptionValue || draftValues.includes(selectedOptionValue)) {
      return;
    }

    setDraftValues((current) => [...current, selectedOptionValue]);
    setSelectedOptionValue("");
  };

  const removeLinkedProduct = (value) => {
    setDraftValues((current) => current.filter((item) => item !== value));
  };

  const saveLinks = () => {
    const links = draftValues
      .map((value) => optionByValue.get(value))
      .filter(Boolean)
      .map((option) => ({
        product_id: option.product_id,
        variant_id: option.variant_id || null,
      }));

    onSave?.(links);
  };

  return (
    <SectionCard
      title="ربط المنتجات بالمورد"
      subtitle="اختار المنتجات الموجودة في السيستم. لو المنتج له مورد واحد هيظهر كوده تلقائيًا على الليبل، ولو له أكتر من مورد هتختار المورد وقت الطباعة."
      action={
        canManage ? (
          <button
            type="button"
            onClick={saveLinks}
            disabled={saving}
            className="app-button-primary rounded-2xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "جارٍ الحفظ..." : "حفظ ربط المنتجات"}
          </button>
        ) : null
      }
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <DetailLineCompact label="كود المورد في الليبل" value={supplier?.code || "-"} />
        <DetailLineCompact label="اسم المورد في التفاصيل" value={supplier?.name || "-"} />
        <DetailLineCompact label="المنتجات المرتبطة" value={formatCount(linkedOptions.length)} />
      </div>

      {canManage ? (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <select
              value={selectedOptionValue}
              disabled={catalogLoading || availableOptions.length === 0}
              onChange={(event) => setSelectedOptionValue(event.target.value)}
              className="app-input px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option value="">
                {catalogLoading
                  ? "جاري تحميل المنتجات..."
                  : availableOptions.length === 0
                    ? "كل المنتجات المتاحة مرتبطة"
                    : "اختار منتج أو فاريانت"}
              </option>
              {availableOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addSelectedProduct}
              disabled={!selectedOptionValue || catalogLoading}
              className="app-button-secondary rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              إضافة المنتج
            </button>
          </div>
          {catalogError ? (
            <p className="mt-3 text-sm text-red-600">{catalogError}</p>
          ) : null}
        </div>
      ) : null}

      {linkedOptions.length > 0 ? (
        <div className="space-y-3">
          {linkedOptions.map((option) => (
            <div
              key={option.value}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {option.product_name || option.label}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {[
                    option.variant_title || "المنتج الأساسي",
                    option.sku ? `SKU: ${option.sku}` : "",
                    supplier?.code ? `Supplier code: ${supplier.code}` : "",
                  ]
                    .filter(Boolean)
                    .join(" | ")}
                </div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() => removeLinkedProduct(option.value)}
                  className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  حذف
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="لا توجد منتجات مرتبطة بهذا المورد حتى الآن." />
      )}
    </SectionCard>
  );
}

function SupplierForm({ form, setForm, supplierType, saving, onSave }) {
  const { locale } = useLocale();
  if (typeof window !== "undefined") {
    return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="اسم المورد" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
        <TextInput label={getSupplierCodeLabel(supplierType)} value={form.code} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
        <TextInput label="اسم المسؤول" value={form.contact_name} onChange={(value) => setForm((current) => ({ ...current, contact_name: value }))} />
        <TextInput label="الهاتف" value={form.phone} onChange={(value) => setForm((current) => ({ ...current, phone: value }))} />
        <TextInput label="العنوان" value={form.address} onChange={(value) => setForm((current) => ({ ...current, address: value }))} />
        <TextInput label="الرصيد الافتتاحي" type="number" value={form.opening_balance} onChange={(value) => setForm((current) => ({ ...current, opening_balance: value }))} />
      </div>
      <TextArea label="ملاحظات" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
      <label className="app-note flex items-center gap-2 px-3 py-3 text-sm text-slate-700">
        <input type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
        {translateSupplierUiText("المورد نشط ويظهر في القائمة", locale)}
      </label>
      <button
        onClick={onSave}
        disabled={saving}
        className="app-button-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Save size={18} />
        {saving
          ? translateSupplierUiText("جارٍ الحفظ...", locale)
          : translateSupplierUiText("حفظ بيانات المورد", locale)}
      </button>
    </div>
    );
  }

}

function SupplierFabricsSection({
  supplier,
  fabricSuppliers,
  showForm,
  editingFabricId,
  form,
  setForm,
  saving,
  onStartCreate,
  onStartEdit,
  onSave,
  onCancel,
  canManage,
}) {
  const { locale } = useLocale();
  const fabricRecords = toArray(supplier?.fabric_records);
  const fabricSupplierOptions = [
    { value: "", label: "بدون ربط بمورد قماش" },
    ...toArray(fabricSuppliers).map((relatedSupplier) => ({
      value: relatedSupplier.id,
      label: relatedSupplier.code
        ? `${relatedSupplier.code} | ${relatedSupplier.name}`
        : relatedSupplier.name,
    })),
  ];
  const activeFabricsCount = fabricRecords.filter(
    (fabric) => fabric?.is_active !== false,
  ).length;
  const linkedFabricSuppliersCount = new Set(
    fabricRecords
      .map((fabric) => normalizeText(fabric?.fabric_supplier_id))
      .filter(Boolean),
  ).size;

  return (
    <SectionCard
      title="الخامات وربط مورد القماش"
      subtitle="سجل خامات المصنع وربط كل خامة بمورد القماش المناسب لتظهر مباشرة داخل الواردات والربط على المنتجات."
      action={
        canManage ? (
          <button
            onClick={showForm ? onCancel : onStartCreate}
            className="app-button-secondary inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <Plus size={16} />
            {showForm
              ? "إغلاق نموذج الخامة"
              : editingFabricId
                ? "تعديل الخامة"
                : "إضافة خامة"}
          </button>
        ) : null
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailLineCompact
              label="إجمالي الأكواد"
              value={formatCount(fabricRecords.length)}
            />
            <DetailLineCompact
              label="خامات نشطة"
              value={formatCount(activeFabricsCount)}
            />
            <DetailLineCompact
              label="موردو القماش المرتبطون"
              value={formatCount(linkedFabricSuppliersCount)}
            />
          </div>

          {fabricRecords.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {fabricRecords.map((fabric) => (
                <div
                  key={fabric.id || `${fabric.code}-${fabric.name}`}
                  className="app-note rounded-[24px] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {fabric.name || fabric.fabric_name || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        كود الخامة: {fabric.code || "-"}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        fabric.is_active !== false
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {fabric.is_active !== false ? "نشط" : "مؤرشف"}
                    </span>
                  </div>

                  {fabric.notes ? (
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                      {fabric.notes}
                    </div>
                  ) : null}

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <DetailLineCompact
                      label="آخر تحديث"
                      value={formatDateTime(fabric.updated_at || fabric.created_at)}
                    />
                    <DetailLineCompact
                      label="مورد القماش"
                      value={
                        fabric.fabric_supplier_name
                          ? fabric.fabric_supplier_code
                            ? `${fabric.fabric_supplier_code} | ${fabric.fabric_supplier_name}`
                            : fabric.fabric_supplier_name
                          : "لا يوجد مورد قماش محدد"
                      }
                    />
                    <DetailLineCompact
                      label="عدد الموديلات المرتبطة"
                      value={formatCount(
                        toArray(supplier?.fabric_catalog).find((group) =>
                          getSupplierFabricLookupKeys(group).some((key) =>
                            getSupplierFabricLookupKeys(fabric).includes(key),
                          ),
                        )?.products?.length || 0,
                      )}
                    />
                  </div>

                  {canManage ? (
                    <button
                      onClick={() => onStartEdit(fabric)}
                      className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-sky-700 hover:text-sky-800"
                    >
                      <Save size={14} />
                      {translateSupplierUiText("تعديل", locale)}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="لا توجد خامات مسجلة لهذا المصنع بعد." />
          )}
        </div>

        {canManage && showForm ? (
          <div className="app-note rounded-[24px] p-4">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-slate-900">
                {editingFabricId ? "تعديل الخامة" : "إضافة خامة جديدة"}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                عرّف الخامة مرة واحدة ثم اختر مورد القماش المناسب لها ليظهر الربط مباشرة داخل الواردات.
              </p>
            </div>

            <div className="space-y-3">
              <TextInput
                label="كود الخامة"
                value={form.code}
                onChange={(value) =>
                  setForm((current) => ({ ...current, code: value }))
                }
              />
              <TextInput
                label="اسم الخامة"
                value={form.name}
                onChange={(value) =>
                  setForm((current) => ({ ...current, name: value }))
                }
              />
              <SelectInput
                label="مورد القماش"
                value={form.fabric_supplier_id}
                options={fabricSupplierOptions}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    fabric_supplier_id: value,
                  }))
                }
              />
              <TextArea
                label="ملاحظات"
                value={form.notes}
                onChange={(value) =>
                  setForm((current) => ({ ...current, notes: value }))
                }
              />
              <label className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 shadow-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                الخامة نشطة وتظهر في قائمة الربط
              </label>
              <button
                onClick={onSave}
                disabled={saving}
                className="app-button-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save size={18} />
                {saving ? "جارٍ حفظ الخامة..." : "حفظ الخامة"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function DeliveryForm({
  supplier,
  form,
  setForm,
  updateItem,
  selectFabric,
  selectProduct,
  removeItem,
  addItem,
  onSave,
  saving,
  catalogLoading,
  catalogError,
  catalogOptions,
  catalogByValue,
}) {
  const { locale } = useLocale();
  const supplierFabricOptions = buildSupplierFabricOptions(supplier);
  const fabricModelOptionsByFabric = buildSupplierFabricModelOptions(
    supplier,
    catalogOptions,
  );

  return (
    <SectionCard
      title="تسجيل وارد جديد"
      subtitle="ابدأ بالقماش ثم اختر موديله واربطه بالمنتج بشكل منظم وواضح"
      action={
        <span className="text-xs text-slate-500">
          {catalogLoading
            ? "جاري تحميل المنتجات..."
            : `${formatCount(catalogOptions.length)} منتج متاح`}
        </span>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="تاريخ الوارد" type="date" value={form.entry_date} onChange={(value) => setForm((current) => ({ ...current, entry_date: value }))} />
          <TextInput label="رقم المرجع" value={form.reference_code} onChange={(value) => setForm((current) => ({ ...current, reference_code: value }))} />
        </div>
        <TextInput label="وصف سريع" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        {catalogError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            {catalogError}
          </div>
        ) : null}
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-800">
          ابدأ باختيار القماش، وبعدها اختر موديله. ولو ربطت على مستوى المنتج الأساسي فالعلاقة هتظهر تلقائيًا على كل الفاريانتات.
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          {form.items.map((item, index) => {
            const filteredOptions = filterCatalogOptions(catalogOptions, item.catalog_query);
            const selectedValue = getDeliveryItemSelectionValue(item);
            const selectedOption = catalogByValue.get(selectedValue);
            const itemType = normalizeDeliveryItemType(item?.item_type);
            const measurementUnit = normalizeDeliveryMeasurementUnit(item?.measurement_unit);
            const materialUnitPrice = getDeliveryItemMaterialUnitPrice(item);
            const pieceCost = getDeliveryItemPieceCost(item);
            const suggestedUnitCost = getDeliveryItemSuggestedUnitCost(item);
            const selectedFabricOption = findSupplierFabricOptionByItem(
              supplierFabricOptions,
              item,
            );
            const selectedFabricValue = selectedFabricOption?.value || "";
            const relatedModelOptions =
              fabricModelOptionsByFabric.get(selectedFabricValue) || [];
            const relatedModelValue =
              !normalizeText(item.variant_id) &&
              relatedModelOptions.some((option) => option.value === selectedValue)
                ? selectedValue
                : "";

            return (
              <div key={`delivery-item-${index}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-sm font-medium text-slate-800">صنف الوارد #{index + 1}</div>
                  {form.items.length > 1 ? (
                    <button onClick={() => removeItem(index)} className="text-xs text-rose-600 hover:text-rose-700">
                      حذف
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <SelectInput
                    label="نوع الصنف"
                    value={item.item_type}
                    options={DELIVERY_ITEM_TYPE_OPTIONS}
                    onChange={(value) => updateItem(index, "item_type", value)}
                  />
                  <SelectInput
                    label="قماش مسجل"
                    value={selectedFabricValue}
                    disabled={supplierFabricOptions.length === 0}
                    options={[
                      {
                        value: "",
                        label:
                          supplierFabricOptions.length > 0
                            ? "اختر قماشًا مسجلًا"
                            : "لا توجد أقمشة مسجلة بعد",
                      },
                      ...supplierFabricOptions,
                    ]}
                    onChange={(value) => selectFabric(index, value)}
                  />
                  <TextInput
                    label="اسم الموديل / الصنف"
                    value={item.product_name}
                    onChange={(value) => updateItem(index, "product_name", value)}
                  />
                  <SelectInput
                    label="موديل مرتبط بهذا القماش"
                    value={relatedModelValue}
                    disabled={
                      catalogLoading ||
                      !selectedFabricValue ||
                      relatedModelOptions.length === 0
                    }
                    options={[
                      {
                        value: "",
                        label: !selectedFabricValue
                          ? "اختر القماش أولًا"
                          : relatedModelOptions.length > 0
                            ? "اختر موديلًا مرتبطًا بهذا القماش"
                            : "لا توجد موديلات مرتبطة بهذا القماش",
                      },
                      ...relatedModelOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      })),
                    ]}
                    onChange={(value) => selectProduct(index, value)}
                  />
                  <TextInput label="ابحث بالاسم أو SKU" value={item.catalog_query} onChange={(value) => updateItem(index, "catalog_query", value)} />
                  <SelectInput
                    label="ربط متقدم بالمنتج / الفاريانت"
                    value={selectedValue}
                    disabled={catalogLoading}
                    options={[
                      {
                        value: "",
                        label: catalogLoading
                          ? "جاري تحميل المنتجات..."
                          : filteredOptions.length > 0
                            ? "اختر منتجًا أو فاريانت إذا احتجت"
                            : "لا توجد نتائج مطابقة",
                      },
                      ...filteredOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                      })),
                    ]}
                    onChange={(value) => selectProduct(index, value)}
                  />
                  <TextInput label="اللون" value={item.color} onChange={(value) => updateItem(index, "color", value)} />
                  <TextInput label="كود القماش" value={item.fabric_code} onChange={(value) => updateItem(index, "fabric_code", value)} />
                  <TextInput label="اسم القماش" value={item.fabric_name} onChange={(value) => updateItem(index, "fabric_name", value)} />
                  <TextInput label="القطعة / الرولة" value={item.piece_label} onChange={(value) => updateItem(index, "piece_label", value)} />
                  <SelectInput
                    label="وحدة الخامة"
                    value={item.measurement_unit}
                    options={DELIVERY_MEASUREMENT_UNIT_OPTIONS}
                    onChange={(value) => updateItem(index, "measurement_unit", value)}
                  />
                  <TextInput
                    label="ينتج كام قطعة من المتر / الكيلو"
                    type="number"
                    value={item.pieces_per_unit}
                    onChange={(value) => updateItem(index, "pieces_per_unit", value)}
                  />
                  <TextInput label="سعر المتر" type="number" value={item.price_per_meter} onChange={(value) => updateItem(index, "price_per_meter", value)} />
                  <TextInput label="سعر الكيلو" type="number" value={item.price_per_kilo} onChange={(value) => updateItem(index, "price_per_kilo", value)} />
                  <TextInput label="سعر القطعة" type="number" value={item.piece_cost} onChange={(value) => updateItem(index, "piece_cost", value)} />
                  <TextInput label="تكلفة التصنيع" type="number" value={item.manufacturing_cost} onChange={(value) => updateItem(index, "manufacturing_cost", value)} />
                  <TextInput label="خدمة المصنع" type="number" value={item.factory_service_cost} onChange={(value) => updateItem(index, "factory_service_cost", value)} />
                  <TextInput label="الخامة أو الوصف الفني" value={item.material} onChange={(value) => updateItem(index, "material", value)} />
                  <TextInput label="الكمية" type="number" value={item.quantity} onChange={(value) => updateItem(index, "quantity", value)} />
                  <TextInput label="سعر الوحدة" type="number" value={item.unit_cost} onChange={(value) => updateItem(index, "unit_cost", value)} />
                  <TextInput label="الإجمالي" type="number" value={item.total_cost} onChange={(value) => updateItem(index, "total_cost", value)} />
                </div>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  <div className="text-xs text-slate-500">
                    {translateSupplierUiText("الربط الحالي", locale)}
                  </div>
                  <div className="mt-1 font-medium text-slate-900">{item.product_name || "-"}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {translateSupplierUiText(getLinkedScopeLabel(item), locale)}
                    {item.sku ? ` | SKU: ${item.sku}` : ""}
                    {item.fabric_code ? ` | كود القماش: ${item.fabric_code}` : ""}
                    {selectedFabricOption?.fabric_supplier_name
                      ? ` | مورد القماش: ${
                          selectedFabricOption.fabric_supplier_code
                            ? `${selectedFabricOption.fabric_supplier_code} | ${selectedFabricOption.fabric_supplier_name}`
                            : selectedFabricOption.fabric_supplier_name
                        }`
                      : ""}
                    {selectedOption
                      ? ` | ${translateSupplierUiText("المخزون الحالي", locale)}: ${formatCount(selectedOption.inventory_quantity)}`
                      : ""}
                  </div>
                  {normalizeText(item.product_id) && !normalizeText(item.variant_id) ? (
                    <div className="mt-2 text-xs font-medium text-sky-700">
                      {translateSupplierUiText(
                        "هذا الربط على مستوى المنتج كله، لذلك سيظهر تلقائيًا على كل الفاريانتات.",
                        locale,
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <DetailStat label="النوع" value={formatDeliveryItemTypeLabel(itemType)} />
                  <DetailStat label="الوحدة" value={formatDeliveryMeasurementUnitLabel(measurementUnit)} />
                  <DetailStat label="سعر المادة" value={formatCurrency(materialUnitPrice)} />
                  <DetailStat label="سعر القطعة" value={formatCurrency(pieceCost)} />
                  <DetailStat label="التصنيع" value={formatCurrency(item.manufacturing_cost)} />
                  <DetailStat label="خدمة المصنع" value={formatCurrency(item.factory_service_cost)} />
                  <DetailStat label="تكلفة الوحدة" value={formatCurrency(item.unit_cost || suggestedUnitCost)} />
                  <DetailStat label="الإجمالي" value={formatCurrency(getDeliveryItemTotal(item))} />
                </div>
                <TextInput label="ملاحظات الصنف" value={item.notes} onChange={(value) => updateItem(index, "notes", value)} />
                <div className="mt-2 text-xs text-slate-500">
                  {translateSupplierUiText("الإجمالي المحسوب", locale)}: {formatCurrency(getDeliveryItemTotal(item))}
                </div>
              </div>
            );
          })}
          <button onClick={addItem} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <Plus size={16} />
            {translateSupplierUiText("إضافة صنف جديد", locale)}
          </button>
        </div>
        <TextArea label="ملاحظات الوارد" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={18} />
          {saving
            ? translateSupplierUiText("جارٍ الحفظ...", locale)
            : translateSupplierUiText("حفظ الوارد", locale)}
        </button>
      </div>
    </SectionCard>
    );
  }

function PaymentForm({ form, setForm, onSave, saving }) {
  const { locale } = useLocale();
  return (
    <SectionCard
      title="تسجيل دفعة"
      subtitle="سجل كل دفعة بطريقة السداد والحساب المستخدم وتفاصيل المرجع"
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="تاريخ الدفعة" type="date" value={form.entry_date} onChange={(value) => setForm((current) => ({ ...current, entry_date: value }))} />
          <TextInput label="رقم المرجع" value={form.reference_code} onChange={(value) => setForm((current) => ({ ...current, reference_code: value }))} />
          <TextInput label="المبلغ" type="number" value={form.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} />
          <SelectInput
            label="طريقة الدفع"
            value={form.payment_method}
            options={PAYMENT_METHOD_OPTIONS.map((option) => ({
              ...option,
              label: PAYMENT_METHOD_LABELS[option.value] || option.label,
            }))}
            onChange={(value) => setForm((current) => ({ ...current, payment_method: value }))}
          />
          <TextInput label="الحساب المستخدم" value={form.payment_account} onChange={(value) => setForm((current) => ({ ...current, payment_account: value }))} />
          <TextInput label="وصف سريع" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        </div>
        <TextArea label="ملاحظات الدفعة" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} />
        <button
          onClick={onSave}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={18} />
          {saving
            ? translateSupplierUiText("جارٍ الحفظ...", locale)
            : translateSupplierUiText("حفظ الدفعة", locale)}
        </button>
      </div>
    </SectionCard>
    );
  }

function LegacySupplierCatalogExplorer({ supplier }) {
  const { locale } = useLocale();
  const productCatalog = toArray(supplier?.product_catalog);
  const fabricCatalog = toArray(supplier?.fabric_catalog);

  return (
    <div className="space-y-4">
      <div className="grid gap-6 xl:grid-cols-2">
      <div>
      <SectionCard
        title="كتالوج الموديلات"
        subtitle="عرض كل موديل وما تحته من أقمشة وخامات وواردات بشكل منظم"
      >
        {productCatalog.length > 0 ? (
          <div className="space-y-3">
            {productCatalog.map((group) => (
              <details
                key={group.key}
                className="rounded-2xl border border-slate-200 bg-slate-50"
              >
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {group.product_name || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText(getLinkedScopeLabel(group), locale)}
                        {group.sku ? ` | SKU: ${group.sku}` : ""}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-left text-xs sm:min-w-[220px]">
                      <KeyValueCompact
                        label="الكمية"
                        value={formatCount(group.total_quantity)}
                      />
                      <KeyValueCompact
                        label="الإجمالي"
                        value={formatCurrency(group.total_cost)}
                      />
                      <KeyValueCompact
                        label="الواردات"
                        value={formatCount(group.deliveries_count)}
                      />
                      <KeyValueCompact
                        label="الأقمشة"
                        value={formatCount(toArray(group.fabrics).length)}
                      />
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-200 bg-white p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailLineCompact
                      label="آخر وارد"
                      value={formatDateTime(group.last_delivery_at)}
                    />
                    <DetailLineCompact
                      label="الوحدات"
                      value={formatTextList(group.measurement_units)}
                    />
                    <DetailLineCompact
                      label="الأقمشة"
                      value={formatTextList(group.fabrics)}
                    />
                    <DetailLineCompact
                      label="الخامات"
                      value={formatTextList(group.materials)}
                    />
                    <DetailLineCompact
                      label="الألوان"
                      value={formatTextList(group.colors)}
                    />
                    <DetailLineCompact
                      label="نوع الصنف"
                      value={formatTextList(
                        toArray(group.item_types).map(formatDeliveryItemTypeLabel),
                      )}
                    />
                  </div>

                  {group.product_id ? (
                    <div className="mt-4">
                      <Link
                        to={buildProductDetailsPath(group.product_id)}
                        className="inline-flex rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100"
                      >
                        {translateSupplierUiText("فتح صفحة المنتج", locale)}
                      </Link>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-3">
                    {toArray(group.items).map((item, index) => (
                      <div
                        key={`${group.key}-${item.delivery_id || "row"}-${index}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {item.product_name || "-"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {formatDateTime(item.entry_date)}
                              {item.reference_code
                                ? ` | ${translateSupplierUiText("مرجع", locale)}: ${item.reference_code}`
                                : ""}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-slate-800">
                            {formatCurrency(item.total_cost)}
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <DetailLineCompact
                            label="القماش"
                            value={formatSupplierFabricDisplay(item) || item.material || "-"}
                          />
                          <DetailLineCompact
                            label="مورد القماش"
                            value={
                              item.fabric_supplier_name
                                ? item.fabric_supplier_code
                                  ? `${item.fabric_supplier_code} | ${item.fabric_supplier_name}`
                                  : item.fabric_supplier_name
                                : "-"
                            }
                          />
                          <DetailLineCompact
                            label="الوصف"
                            value={item.material || "-"}
                          />
                          <DetailLineCompact
                            label="الكمية"
                            value={formatCount(item.quantity)}
                          />
                          <DetailLineCompact
                            label="تكلفة الوحدة"
                            value={formatCurrency(item.unit_cost)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState text="لا توجد موديلات مرتبطة بحركات المورد الحالي حتى الآن." />
        )}
      </SectionCard>
      </div>

      <div>
      <SectionCard
        title="موديلات القماش"
        subtitle="ابدأ بالقماش لترى الموديلات المرتبطة به وكمياتها ووارداتها"
      >
        {fabricCatalog.length > 0 ? (
          <div className="space-y-3">
            {fabricCatalog.map((group) => (
              <details
                key={group.key}
                className="rounded-2xl border border-slate-200 bg-slate-50"
              >
                <summary className="cursor-pointer list-none p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">
                        {formatSupplierFabricDisplay(group)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {group.fabric_code ? `كود القماش: ${group.fabric_code} | ` : ""}
                        {group.fabric_supplier_name
                          ? `مورد القماش: ${
                              group.fabric_supplier_code
                                ? `${group.fabric_supplier_code} | ${group.fabric_supplier_name}`
                                : group.fabric_supplier_name
                            } | `
                          : ""}
                        {formatTextList(
                          toArray(group.measurement_units).map(
                            formatDeliveryMeasurementUnitLabel,
                          ),
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-left text-xs sm:min-w-[220px]">
                      <KeyValueCompact
                        label="الكمية"
                        value={formatCount(group.total_quantity)}
                      />
                      <KeyValueCompact
                        label="الإجمالي"
                        value={formatCurrency(group.total_cost)}
                      />
                      <KeyValueCompact
                        label="الواردات"
                        value={formatCount(group.deliveries_count)}
                      />
                      <KeyValueCompact
                        label="الموديلات"
                        value={formatCount(toArray(group.products).length)}
                      />
                    </div>
                  </div>
                </summary>

                <div className="border-t border-slate-200 bg-white p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailLineCompact
                      label="آخر وارد"
                      value={formatDateTime(group.last_delivery_at)}
                    />
                    <DetailLineCompact
                      label="الخامات"
                      value={formatTextList(group.materials)}
                    />
                    <DetailLineCompact
                      label="الألوان"
                      value={formatTextList(group.colors)}
                    />
                    <DetailLineCompact
                      label="الموديلات المرتبطة"
                      value={formatTextList(
                        toArray(group.products).map((product) => product.product_name),
                      )}
                    />
                  </div>

                  <div className="mt-4 space-y-2">
                    {toArray(group.products).map((product) => (
                      <div
                        key={`${group.key}-${product.key}`}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-medium text-slate-900">
                              {product.product_name || "-"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">
                              {translateSupplierUiText(getLinkedScopeLabel(product), locale)}
                              {product.sku ? ` | SKU: ${product.sku}` : ""}
                            </div>
                          </div>
                          {product.product_id ? (
                            <Link
                              to={buildProductDetailsPath(product.product_id)}
                              className="text-sm font-medium text-sky-700 hover:text-sky-800"
                            >
                              {translateSupplierUiText("فتح المنتج", locale)}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <EmptyState text="لا توجد أقمشة مرتبطة بحركات المورد الحالي حتى الآن." />
        )}
      </SectionCard>
      </div>
      </div>
    </div>
  );
}

void LegacySupplierCatalogExplorer;


const buildCatalogSearchString = (values = []) =>
  values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map(normalizeText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

const buildWorkspaceProductSearchText = (group = {}) =>
  buildCatalogSearchString([
    group.product_name,
    group.variant_title,
    group.sku,
    toArray(group.fabrics),
    toArray(group.materials),
    toArray(group.colors),
    toArray(group.measurement_units),
    toArray(group.items).flatMap((item) => [
      item.product_name,
      item.variant_title,
      item.sku,
      item.fabric_name,
      item.fabric_code,
      item.fabric_supplier_name,
      item.fabric_supplier_code,
      item.material,
      item.color,
      item.reference_code,
    ]),
  ]);

const buildWorkspaceFabricSearchText = (group = {}) =>
  buildCatalogSearchString([
    group.fabric_name,
    group.fabric_code,
    group.fabric_supplier_name,
    group.fabric_supplier_code,
    toArray(group.materials),
    toArray(group.colors),
    toArray(group.measurement_units),
    toArray(group.products).flatMap((product) => [
      product.product_name,
      product.variant_title,
      product.sku,
    ]),
    toArray(group.items).flatMap((item) => [
      item.product_name,
      item.fabric_name,
      item.fabric_code,
      item.material,
      item.color,
      item.reference_code,
    ]),
  ]);

const buildWorkspaceLinkedFabrics = (group = {}) => {
  const lookup = new Map();

  toArray(group.items).forEach((item) => {
    const label = formatSupplierFabricDisplay(item) || item.material || "-";
    const key =
      normalizeText(item.fabric_id) ||
      normalizeText(item.fabric_code).toLowerCase() ||
      normalizeText(label).toLowerCase();

    if (!key) {
      return;
    }

    const existing = lookup.get(key) || {
      key,
      label,
      supplierLabel: item.fabric_supplier_name
        ? item.fabric_supplier_code
          ? `${item.fabric_supplier_code} | ${item.fabric_supplier_name}`
          : item.fabric_supplier_name
        : "",
      quantity: 0,
      units: new Set(),
    };

    existing.quantity += toNumber(item.quantity);
    if (item.measurement_unit) {
      existing.units.add(formatDeliveryMeasurementUnitLabel(item.measurement_unit));
    }

    lookup.set(key, existing);
  });

  return Array.from(lookup.values())
    .map((entry) => ({
      ...entry,
      units: Array.from(entry.units),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "ar"));
};

const buildWorkspaceRecentItems = (group = {}, limit = 6) =>
  toArray(group.items).slice(0, limit);

function SupplierCatalogWorkspace({ supplier }) {
  const { locale, isRTL } = useLocale();
  const t = (ar, en) => (locale === "en" ? en : ar);
  const productCatalog = toArray(supplier?.product_catalog);
  const fabricCatalog = toArray(supplier?.fabric_catalog);
  const [activeView, setActiveView] = useState("models");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedProductKey, setSelectedProductKey] = useState("");
  const [selectedFabricKey, setSelectedFabricKey] = useState("");

  useEffect(() => {
    setCatalogSearch("");
    setActiveView(
      productCatalog.length > 0 || fabricCatalog.length === 0 ? "models" : "fabrics",
    );
  }, [supplier?.id, productCatalog.length, fabricCatalog.length]);

  const normalizedSearch = normalizeText(catalogSearch).toLowerCase();

  const filteredProductCatalog = useMemo(() => {
    if (!normalizedSearch) {
      return productCatalog;
    }

    return productCatalog.filter((group) =>
      buildWorkspaceProductSearchText(group).includes(normalizedSearch),
    );
  }, [normalizedSearch, productCatalog]);

  const filteredFabricCatalog = useMemo(() => {
    if (!normalizedSearch) {
      return fabricCatalog;
    }

    return fabricCatalog.filter((group) =>
      buildWorkspaceFabricSearchText(group).includes(normalizedSearch),
    );
  }, [fabricCatalog, normalizedSearch]);

  useEffect(() => {
    setSelectedProductKey((current) =>
      filteredProductCatalog.some((group) => group.key === current)
        ? current
        : filteredProductCatalog[0]?.key || "",
    );
  }, [filteredProductCatalog]);

  useEffect(() => {
    setSelectedFabricKey((current) =>
      filteredFabricCatalog.some((group) => group.key === current)
        ? current
        : filteredFabricCatalog[0]?.key || "",
    );
  }, [filteredFabricCatalog]);

  const selectedProduct =
    filteredProductCatalog.find((group) => group.key === selectedProductKey) ||
    filteredProductCatalog[0] ||
    null;
  const selectedFabric =
    filteredFabricCatalog.find((group) => group.key === selectedFabricKey) ||
    filteredFabricCatalog[0] ||
    null;
  const visibleCount =
    activeView === "models"
      ? filteredProductCatalog.length
      : filteredFabricCatalog.length;

  return (
    <SectionCard
      title={t("كتالوج الموديلات والأقمشة", "Models & Fabrics Catalog")}
      subtitle={t(
        "كروت بسيطة من بره، وداخل كل موديل أو قماش كل التفاصيل المرتبطة به بشكل أوضح واحترافي.",
        "Simple cards outside, with a clearer professional detail view inside every model or fabric.",
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <CatalogWorkspaceModeButton
              active={activeView === "models"}
              label={t("الموديلات", "Models")}
              count={filteredProductCatalog.length}
              onClick={() => setActiveView("models")}
            />
            <CatalogWorkspaceModeButton
              active={activeView === "fabrics"}
              label={t("الأقمشة", "Fabrics")}
              count={filteredFabricCatalog.length}
              onClick={() => setActiveView("fabrics")}
            />
          </div>

          <div className="relative w-full xl:max-w-md">
            <Search
              className={`absolute top-1/2 -translate-y-1/2 text-slate-400 ${
                isRTL ? "right-3" : "left-3"
              }`}
              size={16}
            />
            <input
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder={
                activeView === "models"
                  ? t(
                      "ابحث باسم الموديل أو SKU أو القماش",
                      "Search by model name, SKU, or fabric",
                    )
                  : t(
                      "ابحث باسم القماش أو الكود أو الموديل",
                      "Search by fabric name, code, or model",
                    )
              }
              className={`app-input py-3 ${
                isRTL ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left"
              }`}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DetailStat
            label={t("إجمالي الموديلات", "Total models")}
            value={formatCount(productCatalog.length)}
          />
          <DetailStat
            label={t("إجمالي الأقمشة", "Total fabrics")}
            value={formatCount(fabricCatalog.length)}
          />
          <DetailStat
            label={t("النتائج المعروضة", "Visible results")}
            value={formatCount(visibleCount)}
          />
          <DetailStat
            label={t("آخر نشاط", "Last activity")}
            value={formatDateTime(supplier?.last_delivery_at)}
          />
        </div>

        {activeView === "models" ? (
          filteredProductCatalog.length > 0 ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3 xl:max-h-[920px] xl:overflow-y-auto xl:pe-1">
                {filteredProductCatalog.map((group) => (
                  <button
                    key={group.key}
                    onClick={() => setSelectedProductKey(group.key)}
                    className={`w-full rounded-[24px] border p-4 text-right transition ${
                      group.key === selectedProduct?.key
                        ? "border-sky-300 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(232,244,255,0.92))] shadow-[0_18px_35px_-28px_rgba(14,116,144,0.45)]"
                        : "border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-slate-900">
                          {group.product_name || "-"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {translateSupplierUiText(getLinkedScopeLabel(group), locale)}
                          {group.sku ? ` | SKU: ${group.sku}` : ""}
                        </div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {formatCount(group.deliveries_count)} {t("وارد", "deliveries")}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
                      <KeyValueCompact label="الكمية" value={formatCount(group.total_quantity)} />
                      <KeyValueCompact label="الإجمالي" value={formatCurrency(group.total_cost)} />
                      <KeyValueCompact
                        label="الأقمشة"
                        value={formatCount(toArray(group.fabrics).length)}
                      />
                      <KeyValueCompact
                        label="آخر نشاط"
                        value={formatDateTime(group.last_delivery_at)}
                      />
                    </div>
                  </button>
                ))}
              </div>

              <CatalogWorkspaceProductDetail group={selectedProduct} locale={locale} />
            </div>
          ) : (
            <EmptyState
              text={t(
                "لا توجد موديلات مطابقة للبحث الحالي.",
                "No models match the current search.",
              )}
            />
          )
        ) : filteredFabricCatalog.length > 0 ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3 xl:max-h-[920px] xl:overflow-y-auto xl:pe-1">
              {filteredFabricCatalog.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setSelectedFabricKey(group.key)}
                  className={`w-full rounded-[24px] border p-4 text-right transition ${
                    group.key === selectedFabric?.key
                      ? "border-emerald-300 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(220,252,231,0.92))] shadow-[0_18px_35px_-28px_rgba(5,150,105,0.35)]"
                      : "border-slate-200 bg-white/90 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-slate-900">
                        {formatSupplierFabricDisplay(group)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {group.fabric_code ? `كود: ${group.fabric_code}` : "-"}
                        {group.fabric_supplier_name
                          ? ` | ${
                              group.fabric_supplier_code
                                ? `${group.fabric_supplier_code} | ${group.fabric_supplier_name}`
                                : group.fabric_supplier_name
                            }`
                          : ""}
                      </div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                      {formatCount(toArray(group.products).length)} {t("موديل", "models")}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600 sm:grid-cols-4">
                    <KeyValueCompact label="الكمية" value={formatCount(group.total_quantity)} />
                    <KeyValueCompact label="الإجمالي" value={formatCurrency(group.total_cost)} />
                    <KeyValueCompact
                      label="الواردات"
                      value={formatCount(group.deliveries_count)}
                    />
                    <KeyValueCompact
                      label="آخر نشاط"
                      value={formatDateTime(group.last_delivery_at)}
                    />
                  </div>
                </button>
              ))}
            </div>

            <CatalogWorkspaceFabricDetail group={selectedFabric} locale={locale} />
          </div>
        ) : (
          <EmptyState
            text={t(
              "لا توجد أقمشة مطابقة للبحث الحالي.",
              "No fabrics match the current search.",
            )}
          />
        )}
      </div>
    </SectionCard>
  );
}

function CatalogWorkspaceModeButton({ active, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
        active
          ? "border-sky-200 bg-sky-50 text-sky-700 shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-2 py-0.5 text-xs ${
          active ? "bg-white text-sky-700" : "bg-slate-100 text-slate-600"
        }`}
      >
        {formatCount(count)}
      </span>
    </button>
  );
}

function CatalogWorkspaceProductDetail({ group, locale }) {
  const t = (ar, en) => (locale === "en" ? en : ar);

  if (!group) {
    return (
      <EmptyState
        text={t("اختر موديلًا من القائمة لعرض تفاصيله.", "Choose a model to view its details.")}
      />
    );
  }

  const linkedFabrics = buildWorkspaceLinkedFabrics(group);
  const recentItems = buildWorkspaceRecentItems(group);

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
              {t("ملف الموديل", "Model profile")}
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">
              {group.product_name || "-"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {translateSupplierUiText(getLinkedScopeLabel(group), locale)}
              {group.sku ? ` | SKU: ${group.sku}` : ""}
            </p>
          </div>

          {group.product_id ? (
            <Link
              to={buildProductDetailsPath(group.product_id)}
              className="inline-flex items-center rounded-2xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
            >
              {t("فتح صفحة المنتج", "Open product page")}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DetailStat label="الكمية" value={formatCount(group.total_quantity)} />
          <DetailStat label="الإجمالي" value={formatCurrency(group.total_cost)} />
          <DetailStat label="الواردات" value={formatCount(group.deliveries_count)} />
          <DetailStat
            label="الأقمشة المرتبطة"
            value={formatCount(linkedFabrics.length)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DetailLineCompact label="آخر وارد" value={formatDateTime(group.last_delivery_at)} />
          <DetailLineCompact
            label="الوحدات"
            value={formatTextList(
              toArray(group.measurement_units).map(formatDeliveryMeasurementUnitLabel),
            )}
          />
          <DetailLineCompact label="الخامات" value={formatTextList(group.materials)} />
          <DetailLineCompact label="الألوان" value={formatTextList(group.colors)} />
          <DetailLineCompact
            label="أنواع البنود"
            value={formatTextList(
              toArray(group.item_types).map(formatDeliveryItemTypeLabel),
            )}
          />
          <DetailLineCompact label="الأقمشة" value={formatTextList(group.fabrics)} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">
              {t("الأقمشة المرتبطة بالموديل", "Fabrics linked to this model")}
            </h4>
            <span className="text-xs text-slate-500">
              {formatCount(linkedFabrics.length)} {t("قماش", "fabric(s)")}
            </span>
          </div>

          {linkedFabrics.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {linkedFabrics.map((fabric) => (
                <div
                  key={fabric.key}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {fabric.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {fabric.supplierLabel || t("بدون مورد قماش محدد", "No fabric supplier")}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-600">
                    <KeyValueCompact label="الكمية" value={formatCount(fabric.quantity)} />
                    <KeyValueCompact label="الوحدات" value={formatTextList(fabric.units)} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              text={t(
                "لا توجد أقمشة مرتبطة بهذا الموديل حتى الآن.",
                "No fabrics are linked to this model yet.",
              )}
            />
          )}
        </div>

        <CatalogWorkspaceMovements
          title={t("آخر الحركات على الموديل", "Latest model movements")}
          items={recentItems}
          locale={locale}
          emptyText={t(
            "لا توجد حركات وارد مرتبطة بهذا الموديل.",
            "No delivery movements are linked to this model.",
          )}
        />
      </div>
    </div>
  );
}

function CatalogWorkspaceFabricDetail({ group, locale }) {
  const t = (ar, en) => (locale === "en" ? en : ar);

  if (!group) {
    return (
      <EmptyState
        text={t("اختر قماشًا من القائمة لعرض تفاصيله.", "Choose a fabric to view its details.")}
      />
    );
  }

  const recentItems = buildWorkspaceRecentItems(group);

  return (
    <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              {t("ملف القماش", "Fabric profile")}
            </div>
            <h3 className="mt-3 text-xl font-semibold text-slate-900">
              {formatSupplierFabricDisplay(group)}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {group.fabric_code ? `كود: ${group.fabric_code}` : t("بدون كود", "No code")}
              {group.fabric_supplier_name
                ? ` | ${
                    group.fabric_supplier_code
                      ? `${group.fabric_supplier_code} | ${group.fabric_supplier_name}`
                      : group.fabric_supplier_name
                  }`
                : ""}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div className="text-xs text-slate-500">{t("آخر نشاط", "Last activity")}</div>
            <div className="mt-1 font-semibold text-slate-900">
              {formatDateTime(group.last_delivery_at)}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DetailStat label="الكمية" value={formatCount(group.total_quantity)} />
          <DetailStat label="الإجمالي" value={formatCurrency(group.total_cost)} />
          <DetailStat label="الواردات" value={formatCount(group.deliveries_count)} />
          <DetailStat
            label="الموديلات المرتبطة"
            value={formatCount(toArray(group.products).length)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <DetailLineCompact
            label="الوحدات"
            value={formatTextList(
              toArray(group.measurement_units).map(formatDeliveryMeasurementUnitLabel),
            )}
          />
          <DetailLineCompact label="الخامات" value={formatTextList(group.materials)} />
          <DetailLineCompact label="الألوان" value={formatTextList(group.colors)} />
          <DetailLineCompact
            label="الموديلات"
            value={formatTextList(
              toArray(group.products).map((product) => product.product_name),
            )}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900">
              {t("الموديلات المرتبطة بهذا القماش", "Models linked to this fabric")}
            </h4>
            <span className="text-xs text-slate-500">
              {formatCount(toArray(group.products).length)} {t("موديل", "model(s)")}
            </span>
          </div>

          {toArray(group.products).length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {toArray(group.products).map((product) => (
                <div
                  key={`${group.key}-${product.key}`}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {product.product_name || "-"}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText(getLinkedScopeLabel(product), locale)}
                        {product.sku ? ` | SKU: ${product.sku}` : ""}
                      </div>
                    </div>
                    {product.product_id ? (
                      <Link
                        to={buildProductDetailsPath(product.product_id)}
                        className="text-xs font-semibold text-sky-700 hover:text-sky-800"
                      >
                        {t("فتح", "Open")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              text={t(
                "لا توجد موديلات مرتبطة بهذا القماش حتى الآن.",
                "No models are linked to this fabric yet.",
              )}
            />
          )}
        </div>

        <CatalogWorkspaceMovements
          title={t("آخر الحركات على القماش", "Latest fabric movements")}
          items={recentItems}
          locale={locale}
          emptyText={t(
            "لا توجد حركات وارد مرتبطة بهذا القماش.",
            "No delivery movements are linked to this fabric.",
          )}
        />
      </div>
    </div>
  );
}

function CatalogWorkspaceMovements({ title, items, locale, emptyText }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
        <span className="text-xs text-slate-500">{formatCount(items.length)}</span>
      </div>

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={`${item.delivery_id || item.reference_code || "movement"}-${index}`}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">
                    {item.product_name || item.fabric_name || "-"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatDateTime(item.entry_date)}
                    {item.reference_code
                      ? ` | ${translateSupplierUiText("مرجع", locale)}: ${item.reference_code}`
                      : ""}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-800">
                  {formatCurrency(item.total_cost)}
                </div>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DetailLineCompact
                  label="القماش"
                  value={formatSupplierFabricDisplay(item) || item.material || "-"}
                />
                <DetailLineCompact label="الوصف" value={item.material || "-"} />
                <DetailLineCompact
                  label="الكمية"
                  value={`${formatCount(item.quantity)} ${translateSupplierUiText(
                    formatDeliveryMeasurementUnitLabel(item.measurement_unit),
                    locale,
                  )}`}
                />
                <DetailLineCompact
                  label="تكلفة الوحدة"
                  value={formatCurrency(item.unit_cost)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </div>
  );
}

function ReceivedItemsTable({ items }) {
  const { locale } = useLocale();
  return (
    <SectionCard title="المنتجات المستلمة من المورد" subtitle="كل الأصناف المرتبطة بحركات الوارد للمورد الحالي">
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-600">
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("التاريخ", locale)}</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("المنتج / النوع", locale)}</th>
                <th className="px-3 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("التفاصيل", locale)}</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("الكمية", locale)}</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("الأسعار", locale)}</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("الإجمالي", locale)}</th>
                <th className="px-3 py-2 font-semibold">{translateSupplierUiText("المرجع", locale)}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.delivery_id}-${item.sku}-${index}`} className="border-b border-slate-100 text-slate-700">
                  <td className="px-3 py-3">{formatDateTime(item.entry_date)}</td>
                  <td className="px-3 py-3 font-medium text-slate-900">
                    <div>
                      {item.product_id ? (
                        <Link
                          to={buildProductDetailsPath(item.product_id)}
                          className="text-sky-700 hover:text-sky-800 hover:underline"
                        >
                          {item.product_name}
                        </Link>
                      ) : (
                        item.product_name
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {translateSupplierUiText(getLinkedScopeLabel(item), locale)} | {translateSupplierUiText(formatDeliveryItemTypeLabel(item.item_type), locale)}
                    </div>
                    {item.color ? (
                      <div className="mt-1 text-xs text-slate-500">{translateSupplierUiText("اللون", locale)}: {item.color}</div>
                    ) : null}
                    {item.fabric_name ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("القماش", locale)}: {formatSupplierFabricDisplay(item)}
                      </div>
                    ) : null}
                    {item.fabric_supplier_name ? (
                      <div className="mt-1 text-xs text-slate-500">
                        مورد القماش:{" "}
                        {item.fabric_supplier_code
                          ? `${item.fabric_supplier_code} | ${item.fabric_supplier_name}`
                          : item.fabric_supplier_name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{item.sku || "-"}</td>
                  <td className="px-3 py-3">
                    <div>{item.material || "-"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {translateSupplierUiText("الوحدة", locale)}: {translateSupplierUiText(formatDeliveryMeasurementUnitLabel(item.measurement_unit), locale)}
                    </div>
                    {item.piece_label ? (
                      <div className="mt-1 text-xs text-slate-500">{translateSupplierUiText("القطعة", locale)}: {item.piece_label}</div>
                    ) : null}
                    {toNumber(item.pieces_per_unit) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("الناتج", locale)}: {formatCount(item.pieces_per_unit)} {translateSupplierUiText("قطعة", locale)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{formatCount(item.quantity)}</td>
                  <td className="px-3 py-3">
                    <div>{formatCurrency(item.unit_cost)}</div>
                    {toNumber(item.price_per_meter) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("سعر المتر", locale)}: {formatCurrency(item.price_per_meter)}
                      </div>
                    ) : null}
                    {toNumber(item.price_per_kilo) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("سعر الكيلو", locale)}: {formatCurrency(item.price_per_kilo)}
                      </div>
                    ) : null}
                    {toNumber(item.piece_cost) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("سعر القطعة", locale)}: {formatCurrency(item.piece_cost)}
                      </div>
                    ) : null}
                    {toNumber(item.manufacturing_cost) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("تصنيع", locale)}: {formatCurrency(item.manufacturing_cost)}
                      </div>
                    ) : null}
                    {toNumber(item.factory_service_cost) > 0 ? (
                      <div className="mt-1 text-xs text-slate-500">
                        {translateSupplierUiText("خدمة المصنع", locale)}: {formatCurrency(item.factory_service_cost)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">{formatCurrency(item.total_cost)}</td>
                  <td className="px-3 py-3">{item.reference_code || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState text="لا توجد حركات وارد مسجلة لهذا المورد حتى الآن." />
      )}
    </SectionCard>
  );
}

function PaymentsList({ payments }) {
  const { locale } = useLocale();
  return (
    <SectionCard title="الدفعات المسجلة" subtitle="كل المدفوعات المرتبطة بالمورد">
      {payments.length > 0 ? (
        <div className="space-y-3">
          {payments.map((payment) => (
            <div key={payment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{formatCurrency(payment.amount)}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDateTime(payment.entry_date)}</div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  {translateSupplierUiText(formatPaymentMethodLabel(payment.payment_method), locale)}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-600">
                <DetailLineCompact label="الحساب" value={payment.payment_account || "-"} />
                <DetailLineCompact label="المرجع" value={payment.reference_code || "-"} />
                <DetailLineCompact label="الوصف" value={payment.description || payment.notes || "-"} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="لا توجد دفعات مسجلة للمورد الحالي." />
      )}
    </SectionCard>
  );
}

function EntriesTimeline({ entries }) {
  const { locale } = useLocale();
  return (
    <SectionCard title="الحركة المحاسبية" subtitle="Timeline مختصر للواردات والدفعات">
      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {translateSupplierUiText(
                      entry.entry_type === "delivery"
                        ? "وارد"
                        : entry.entry_type === "payment"
                          ? "دفعة"
                          : "تسوية",
                      locale,
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {formatDateTime(entry.entry_date)}
                  </div>
                </div>
                <div
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    entry.entry_type === "payment"
                      ? "bg-emerald-100 text-emerald-700"
                      : entry.entry_type === "delivery"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {formatCurrency(entry.amount)}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-slate-600">
                <DetailLineCompact label="المرجع" value={entry.reference_code || "-"} />
                <DetailLineCompact label="الوصف" value={entry.description || entry.notes || "-"} />
                <DetailLineCompact
                  label="العناصر"
                  value={entry.entry_type === "delivery" ? formatCount(entry.items?.length || 0) : "-"}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="لا توجد حركات مسجلة لهذا المورد بعد." />
      )}
    </SectionCard>
  );
}

function SummaryCard({ title, value, subtitle, icon: Icon, tone = "sky" }) {
  const { locale } = useLocale();
  const tones = {
    sky: "bg-sky-50 text-sky-700",
    blue: "bg-cyan-50 text-cyan-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="app-surface rounded-[28px] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-500">
            {translateSupplierUiText(title, locale)}
          </div>
          <div className="metric-number mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-900">
            {value}
          </div>
          <div className="mt-2 text-xs leading-5 text-slate-500">
            {translateSupplierUiText(subtitle, locale)}
          </div>
        </div>
        <div className={`rounded-[20px] p-3 ${tones[tone] || tones.sky}`}>
          <Icon size={22} />
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, subtitle, action, children }) {
  const { locale } = useLocale();
  return (
    <section className="app-surface rounded-[30px] p-5 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-slate-900">
            {translateSupplierUiText(title, locale)}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {translateSupplierUiText(subtitle, locale)}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TextInput({ label, value, onChange, type = "text" }) {
  const { locale, isRTL } = useLocale();
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {translateSupplierUiText(label, locale)}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`app-input px-4 py-3 text-sm ${
          isRTL ? "text-right" : "text-left"
        }`}
      />
    </label>
  );
}

function SelectInput({ label, value, options, onChange, disabled = false }) {
  const { locale, isRTL } = useLocale();
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {translateSupplierUiText(label, locale)}
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`app-input px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 ${
          isRTL ? "text-right" : "text-left"
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {translateSupplierUiText(option.label, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailStat({ label, value }) {
  const { locale } = useLocale();
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="text-[11px] text-slate-500">
        {translateSupplierUiText(label, locale)}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-900">
        {translateSupplierUiText(value || "-", locale)}
      </div>
    </div>
  );
}

function TextArea({ label, value, onChange }) {
  const { locale, isRTL } = useLocale();
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        {translateSupplierUiText(label, locale)}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className={`app-input px-4 py-3 text-sm ${
          isRTL ? "text-right" : "text-left"
        }`}
      />
    </label>
  );
}

function DetailLine({ label, value }) {
  const { locale } = useLocale();
  return (
    <div className="app-note px-4 py-3">
      <div className="text-xs text-slate-500">
        {translateSupplierUiText(label, locale)}
      </div>
      <div className="mt-2 text-sm font-medium text-slate-900">
        {translateSupplierUiText(value || "-", locale)}
      </div>
    </div>
  );
}

function DetailLineCompact({ label, value }) {
  const { locale } = useLocale();
  return (
    <div className="app-note flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="text-xs text-slate-500">
        {translateSupplierUiText(label, locale)}
      </div>
      <div className="text-xs font-medium text-slate-700">
        {translateSupplierUiText(value || "-", locale)}
      </div>
    </div>
  );
}

function KeyValueCompact({ label, value }) {
  const { locale } = useLocale();
  return (
    <div className="app-note px-3 py-2.5">
      <div className="text-[11px] text-slate-500">
        {translateSupplierUiText(label, locale)}
      </div>
      <div className="metric-number mt-1 text-sm font-semibold text-slate-800">
        {value}
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  const { locale } = useLocale();
  return (
    <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm leading-6 text-slate-500">
      {translateSupplierUiText(text, locale)}
    </div>
  );
}
