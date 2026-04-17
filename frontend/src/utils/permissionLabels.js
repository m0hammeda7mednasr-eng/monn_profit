import { decodeMaybeMojibake } from "./text";

const PERMISSION_COPY = {
  ar: {
    labels: {
      can_view_dashboard: "عرض لوحة التحكم",
      can_view_products: "عرض المنتجات",
      can_edit_products: "إدارة المنتجات",
      can_view_warehouse: "عرض المخزن",
      can_edit_warehouse: "إدارة حركات المخزن",
      can_view_suppliers: "عرض الموردين",
      can_edit_suppliers: "إدارة الموردين وحساباتهم",
      can_view_orders: "عرض الطلبات",
      can_edit_orders: "تعديل الطلبات",
      can_view_customers: "عرض العملاء",
      can_edit_customers: "تعديل العملاء",
      can_manage_users: "إدارة المستخدمين والصلاحيات",
      can_manage_settings: "إدارة الإعدادات",
      can_view_profits: "عرض الأرباح",
      can_manage_tasks: "إدارة المهام",
      can_view_all_reports: "عرض جميع التقارير",
      can_view_activity_log: "عرض سجل النشاط",
      can_print_barcode_labels: "طباعة ليبلات الباركود",
    },
    descriptions: {
      can_view_dashboard: "يعرض لوحة التحكم والإحصائيات الرئيسية للمتجر.",
      can_view_products:
        "يعرض المنتجات وتفاصيلها وتحليل المنتجات وصفحات الباركود.",
      can_edit_products:
        "يسمح بتعديل المنتجات وSKU والسعر ومخزون Shopify فقط.",
      can_view_warehouse:
        "يعرض شاشة المخزن والرصيد المحلي المنفصل عن Shopify وسجل المسح.",
      can_edit_warehouse:
        "يسمح باستخدام السكانر وتعديل حركات المخزن ومزامنة رصيد المخزن إلى Shopify، ويتضمن أيضًا صلاحية طباعة الباركود.",
      can_view_suppliers:
        "يعرض قوائم الموردين والحسابات وحركاتهم بدون تعديل.",
      can_edit_suppliers:
        "يسمح بإدارة الموردين وإضافتهم وتعديلهم وتسجيل الوارد والمدفوعات.",
      can_view_orders:
        "يعرض الطلبات والطلبات الخارجة عن المخزون وتفاصيل الطلب وصور المنتجات داخل الطلب.",
      can_edit_orders:
        "يسمح بتعديل تفاصيل الأوردر بالكامل، ويشمل الحالة والدفع والتنفيذ أو restock وتعديلات الهاتف والعنوان ومشكلة الشحن والمتابعة الداخلية، ويضمن أيضًا فتح شاشات الطلبات وتفاصيلها.",
      can_view_customers:
        "يعرض قائمة العملاء وبيانات التواصل والطلبات المرتبطة بهم.",
      can_edit_customers:
        "يسمح بتعديل بيانات العملاء والإجراءات المرتبطة بهم.",
      can_manage_users:
        "يسمح بإدارة المستخدمين والصلاحيات وطلبات الوصول.",
      can_manage_settings:
        "يسمح بالدخول إلى الإعدادات وإدارة المزامنة والتكوين العام.",
      can_view_profits: "يعرض صافي الربح وهوامش الربحية والتكلفة.",
      can_manage_tasks: "يسمح بإدارة المهام وتعيينها ومتابعتها.",
      can_view_all_reports: "يعرض جميع التقارير وتقارير الموظفين.",
      can_view_activity_log:
        "يعرض سجل النشاط والعمليات التي تمت داخل النظام.",
      can_print_barcode_labels:
        "يسمح بطباعة ليبلات الباركود، ويتم منحه تلقائيًا مع صلاحية السكانر/إدارة المخزن.",
    },
  },
  en: {
    labels: {
      can_view_dashboard: "View Dashboard",
      can_view_products: "View Products",
      can_edit_products: "Manage Products",
      can_view_warehouse: "View Warehouse",
      can_edit_warehouse: "Manage Warehouse Movements",
      can_view_suppliers: "View Suppliers",
      can_edit_suppliers: "Manage Suppliers and Accounts",
      can_view_orders: "View Orders",
      can_edit_orders: "Edit Orders",
      can_view_customers: "View Customers",
      can_edit_customers: "Edit Customers",
      can_manage_users: "Manage Users and Permissions",
      can_manage_settings: "Manage Settings",
      can_view_profits: "View Profits",
      can_manage_tasks: "Manage Tasks",
      can_view_all_reports: "View All Reports",
      can_view_activity_log: "View Activity Log",
      can_print_barcode_labels: "Print Barcode Labels",
    },
    descriptions: {
      can_view_dashboard: "Shows the main dashboard and key store metrics.",
      can_view_products:
        "Shows products, product details, product analysis, and barcode label views.",
      can_edit_products:
        "Allows editing products, SKU, price, and Shopify stock.",
      can_view_warehouse:
        "Shows warehouse stock, the separate warehouse balance, and scan history.",
      can_edit_warehouse:
        "Allows using the scanner, changing warehouse movements, syncing warehouse stock to Shopify, and automatically includes barcode label printing access.",
      can_view_suppliers:
        "Shows supplier lists, balances, and supplier activity without editing.",
      can_edit_suppliers:
        "Allows creating and editing suppliers plus recording deliveries and payments.",
      can_view_orders:
        "Shows orders, missing orders, order details, shipping issues list, and product images inside orders.",
      can_edit_orders:
        "Allows full order editing across order details, including status, payment method, fulfillment or restock, contact/address overrides, shipping issue follow-up, and internal notes. It also guarantees access to order views.",
      can_view_customers:
        "Shows the customer list, contact details, and linked orders.",
      can_edit_customers: "Allows updating customer data and related actions.",
      can_manage_users:
        "Allows managing users, permissions, and access requests.",
      can_manage_settings:
        "Allows entering settings and managing sync plus general configuration.",
      can_view_profits: "Shows net profit, margins, and cost breakdowns.",
      can_manage_tasks:
        "Allows managing, assigning, and following up on tasks.",
      can_view_all_reports: "Shows all reports and employee reports.",
      can_view_activity_log:
        "Shows the activity log and operations done inside the system.",
      can_print_barcode_labels:
        "Allows printing barcode labels and is automatically included with warehouse scanner access.",
    },
  },
};

const normalizeLocale = (locale) =>
  String(locale || "")
    .trim()
    .toLowerCase() === "ar"
    ? "ar"
    : "en";

const buildFallbackLabel = (key) =>
  String(key || "")
    .replace(/_/g, " ")
    .replace(/^can\s+/i, "")
    .trim();

export const getPermissionLabel = (key, locale = "ar") => {
  const normalizedLocale = normalizeLocale(locale);
  return decodeMaybeMojibake(
    PERMISSION_COPY[normalizedLocale]?.labels?.[key] ||
      PERMISSION_COPY.ar.labels?.[key] ||
      buildFallbackLabel(key),
  );
};

export const getPermissionDescription = (key, locale = "ar") => {
  const normalizedLocale = normalizeLocale(locale);
  return decodeMaybeMojibake(
    PERMISSION_COPY[normalizedLocale]?.descriptions?.[key] ||
      PERMISSION_COPY.ar.descriptions?.[key] ||
      "",
  );
};
