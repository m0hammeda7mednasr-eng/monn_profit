import {
  getLineItemBookedAmount,
  parseOrderData,
} from "./orderAnalytics.js";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeText = (value) => String(value || "").trim();

const normalizeKey = (value) => normalizeText(value).toLowerCase();

export const getOrderLineItems = (order) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }

  const data = parseOrderData(order);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const getLineItemVariantTitle = (item) => {
  const rawVariantTitle = normalizeText(
    item?.variant_title || item?.variant_name || item?.name,
  );

  if (!rawVariantTitle || rawVariantTitle.toLowerCase() === "default title") {
    return "";
  }

  return rawVariantTitle;
};

const getLineItemTitle = (item) =>
  normalizeText(
    item?.title || item?.product_title || item?.name || item?.sku || "Unknown product",
  );

const buildProductRowKey = (item) => {
  const variantId = normalizeText(item?.variant_id);
  if (variantId) {
    return `variant:${variantId}`;
  }

  const productId = normalizeText(item?.product_id);
  if (productId) {
    return `product:${productId}`;
  }

  const sku = normalizeKey(item?.sku);
  if (sku) {
    return `sku:${sku}`;
  }

  const title = normalizeKey(getLineItemTitle(item));
  const variantTitle = normalizeKey(getLineItemVariantTitle(item));
  if (title || variantTitle) {
    return `title:${title}|variant:${variantTitle}`;
  }

  return "";
};

const compareProductRows = (left, right) => {
  if (right.orders_count !== left.orders_count) {
    return right.orders_count - left.orders_count;
  }

  if (right.quantity_sold !== left.quantity_sold) {
    return right.quantity_sold - left.quantity_sold;
  }

  if (right.gross_sales !== left.gross_sales) {
    return right.gross_sales - left.gross_sales;
  }

  return left.product_title.localeCompare(right.product_title);
};

export const buildProductsSummaryExportPayload = (orders = []) => {
  const productMap = new Map();
  let totalUnitsSold = 0;
  let grossSales = 0;

  for (const order of orders) {
    const orderId = normalizeText(order?.id);
    if (!orderId) {
      continue;
    }

    const seenProductKeysInOrder = new Set();

    for (const item of getOrderLineItems(order)) {
      const productKey = buildProductRowKey(item);
      if (!productKey) {
        continue;
      }

      const quantity = Math.max(0, toNumber(item?.quantity));
      const lineSales = getLineItemBookedAmount(item);
      const existing = productMap.get(productKey) || {
        key: productKey,
        product_id: normalizeText(item?.product_id),
        variant_id: normalizeText(item?.variant_id),
        sku: normalizeText(item?.sku),
        product_title: getLineItemTitle(item),
        variant_title: getLineItemVariantTitle(item),
        orders_count: 0,
        quantity_sold: 0,
        gross_sales: 0,
      };

      existing.quantity_sold += quantity;
      existing.gross_sales += lineSales;

      if (!seenProductKeysInOrder.has(productKey)) {
        existing.orders_count += 1;
        seenProductKeysInOrder.add(productKey);
      }

      productMap.set(productKey, existing);
      totalUnitsSold += quantity;
      grossSales += lineSales;
    }
  }

  const products = Array.from(productMap.values())
    .map((row) => ({
      ...row,
      quantity_sold: parseFloat(row.quantity_sold.toFixed(2)),
      gross_sales: parseFloat(row.gross_sales.toFixed(2)),
    }))
    .sort(compareProductRows);

  return {
    summary: {
      orders_count: orders.length,
      products_count: products.length,
      total_units_sold: parseFloat(totalUnitsSold.toFixed(2)),
      gross_sales: parseFloat(grossSales.toFixed(2)),
    },
    products,
  };
};
