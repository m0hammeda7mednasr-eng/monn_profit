export const DEFAULT_CLIENT_PERMISSIONS = {
  can_view_dashboard: true,
  can_view_products: true,
  can_edit_products: false,
  can_view_warehouse: true,
  can_edit_warehouse: false,
  can_view_suppliers: true,
  can_edit_suppliers: false,
  can_view_orders: true,
  can_edit_orders: false,
  can_view_customers: true,
  can_edit_customers: false,
  can_manage_users: false,
  can_manage_settings: false,
  can_view_profits: false,
  can_manage_tasks: false,
  can_view_all_reports: false,
  can_view_activity_log: false,
  can_print_barcode_labels: true,
};

const CLIENT_PERMISSION_FALLBACK_KEYS = {
  can_view_warehouse: ["can_view_products"],
  can_edit_warehouse: ["can_edit_products"],
};

export const applyPermissionDependencies = (permissions = {}) => {
  const normalized = {
    ...permissions,
  };

  if (normalized.can_edit_orders) {
    normalized.can_view_orders = true;
  }

  if (normalized.can_edit_warehouse) {
    normalized.can_view_warehouse = true;
    normalized.can_print_barcode_labels = true;
  }

  if (!normalized.can_view_orders) {
    normalized.can_edit_orders = false;
  }

  if (!normalized.can_view_warehouse) {
    normalized.can_edit_warehouse = false;
  }

  return normalized;
};

export const normalizeClientPermissions = (rawPermissions = null) => {
  const normalized = Object.keys(DEFAULT_CLIENT_PERMISSIONS).reduce(
    (acc, key) => {
      if (Object.prototype.hasOwnProperty.call(rawPermissions || {}, key)) {
        acc[key] = Boolean(rawPermissions[key]);
        return acc;
      }

      const fallbackKey = (CLIENT_PERMISSION_FALLBACK_KEYS[key] || []).find(
        (candidateKey) =>
          Object.prototype.hasOwnProperty.call(
            rawPermissions || {},
            candidateKey,
          ),
      );

      acc[key] = fallbackKey
        ? Boolean(rawPermissions[fallbackKey])
        : DEFAULT_CLIENT_PERMISSIONS[key];
      return acc;
    },
    {},
  );

  return applyPermissionDependencies(normalized);
};

export const setPermissionWithDependencies = (
  currentPermissions = {},
  key,
  value,
) => {
  const nextPermissions = {
    ...currentPermissions,
    [key]: value,
  };

  if (key === "can_view_orders" && !value) {
    nextPermissions.can_edit_orders = false;
  }

  if (key === "can_view_warehouse" && !value) {
    nextPermissions.can_edit_warehouse = false;
  }

  if (key === "can_print_barcode_labels" && !value) {
    nextPermissions.can_edit_warehouse = false;
  }

  return applyPermissionDependencies(nextPermissions);
};
