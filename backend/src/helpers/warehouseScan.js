const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const calculateScannedQuantity = ({
  currentQuantity,
  movementType,
  quantity,
}) => {
  const normalizedCurrent = toNumber(currentQuantity);
  const normalizedQuantity = Math.max(0, toNumber(quantity));

  if (movementType === "in") {
    return normalizedCurrent + normalizedQuantity;
  }

  if (movementType === "out") {
    return normalizedCurrent - normalizedQuantity;
  }

  return normalizedCurrent;
};

export const resolveTrackedWarehouseQuantity = ({
  currentWarehouseQuantity,
  movementType,
  quantity,
}) => {
  const nextTrackedQuantity = calculateScannedQuantity({
    currentQuantity: currentWarehouseQuantity,
    movementType,
    quantity,
  });

  return Math.max(0, nextTrackedQuantity);
};

export const buildMirroredInventoryRow = ({
  product,
  quantity,
  scannedAt = null,
  movementType = null,
  movementQuantity = 0,
  createdAt = null,
  updatedAt = null,
}) => ({
  id: null,
  store_id: product?.store_id || null,
  product_id: product?.product_id || null,
  sku: product?.warehouse_code || product?.sku || "",
  quantity: Math.max(0, toNumber(quantity)),
  last_scanned_at: scannedAt,
  last_movement_type: movementType,
  last_movement_quantity: Math.max(0, toNumber(movementQuantity)),
  created_at: createdAt,
  updated_at: updatedAt,
});
