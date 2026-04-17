import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import { requireAdminRole } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseJsonField = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
};

const getOrderLineItems = (order) => {
  if (Array.isArray(order?.line_items)) {
    return order.line_items;
  }

  const data = parseJsonField(order?.data);
  return Array.isArray(data?.line_items) ? data.line_items : [];
};

const buildTopProducts = (orders = [], products = []) => {
  const revenueByProduct = new Map();

  for (const order of orders) {
    for (const item of getOrderLineItems(order)) {
      const key = String(item.product_id || item.id || item.sku || item.title || "")
        .trim();
      if (!key) continue;

      const current = revenueByProduct.get(key) || {
        name: item.title || item.name || item.sku || "Unknown product",
        sales: 0,
        quantity: 0,
      };

      const quantity = toNumber(item.quantity);
      current.quantity += quantity;
      current.sales += toNumber(item.price) * quantity;
      revenueByProduct.set(key, current);
    }
  }

  if (revenueByProduct.size > 0) {
    return Array.from(revenueByProduct.values())
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5)
      .map((item) => ({
        name: item.name,
        sales: parseFloat(item.sales.toFixed(2)),
        quantity: parseFloat(item.quantity.toFixed(2)),
      }));
  }

  return [...products]
    .sort((a, b) => toNumber(b.price) - toNumber(a.price))
    .slice(0, 5)
    .map((product) => ({
      name: product.title || product.name || "Unknown product",
      sales: parseFloat(toNumber(product.price).toFixed(2)),
      quantity: toNumber(product.inventory_quantity),
    }));
};

const getDateRange = (range) => {
  const now = new Date();
  const startDate = new Date();

  switch (range) {
    case "today":
      startDate.setHours(0, 0, 0, 0);
      break;
    case "7days":
      startDate.setDate(now.getDate() - 7);
      break;
    case "30days":
      startDate.setDate(now.getDate() - 30);
      break;
    case "90days":
      startDate.setDate(now.getDate() - 90);
      break;
    case "year":
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate.setDate(now.getDate() - 7);
  }

  return { startDate: startDate.toISOString(), endDate: now.toISOString() };
};

router.get("/", authenticateToken, requireAdminRole, async (req, res) => {
  try {
    const { range = "7days" } = req.query;
    const { startDate, endDate } = getDateRange(range);

    const [ordersResult, customersResult, productsResult] = await Promise.all([
      supabase
        .from("orders")
        .select("*")
        .gte("created_at", startDate)
        .lte("created_at", endDate)
        .limit(5000),
      supabase
        .from("customers")
        .select("*")
        .gte("created_at", startDate)
        .lte("created_at", endDate)
        .limit(5000),
      supabase
        .from("products")
        .select("*")
        .limit(2000),
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (customersResult.error) throw customersResult.error;
    if (productsResult.error) throw productsResult.error;

    const orders = ordersResult.data;
    const customers = customersResult.data;
    const products = productsResult.data;

    const totalSales = (orders || []).reduce(
      (sum, order) => sum + toNumber(order.total_price),
      0,
    );
    const totalOrders = orders?.length || 0;
    const newCustomers = customers?.length || 0;
    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    const dailySalesMap = {};
    for (const order of orders || []) {
      const date = new Date(order.created_at).toISOString().split("T")[0];
      dailySalesMap[date] = (dailySalesMap[date] || 0) + toNumber(order.total_price);
    }

    const dailySales = Object.entries(dailySalesMap)
      .map(([date, sales]) => ({
        date,
        sales: parseFloat(sales.toFixed(2)),
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const statusMap = {};
    for (const order of orders || []) {
      const status = order.status || "pending";
      statusMap[status] = (statusMap[status] || 0) + 1;
    }

    const ordersByStatus = Object.entries(statusMap).map(([name, value]) => ({
      name,
      value,
    }));

    const customerGrowthMap = {};
    for (const customer of customers || []) {
      const date = new Date(customer.created_at).toISOString().split("T")[0];
      customerGrowthMap[date] = (customerGrowthMap[date] || 0) + 1;
    }

    let cumulativeCustomers = 0;
    const customerGrowth = Object.entries(customerGrowthMap)
      .map(([date, count]) => {
        cumulativeCustomers += count;
        return { date, customers: cumulativeCustomers };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      summary: {
        totalSales: parseFloat(totalSales.toFixed(2)),
        totalOrders,
        newCustomers,
        avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      },
      dailySales,
      ordersByStatus,
      topProducts: buildTopProducts(orders || [], products || []),
      customerGrowth,
    });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get(
  "/download",
  authenticateToken,
  requireAdminRole,
  async (req, res) => {
    try {
      const { range = "7days" } = req.query;
      const { startDate, endDate } = getDateRange(range);

      const { data: orders, error } = await supabase
        .from("orders")
        .select("*")
        .gte("created_at", startDate)
        .lte("created_at", endDate);

      if (error) throw error;

      let csv = "date,order_number,customer,total,status\n";
      for (const order of orders || []) {
        const date = new Date(order.created_at).toISOString().split("T")[0];
        csv += `${date},${order.order_number || order.id},${order.customer_name || "Unknown"},${toNumber(order.total_price)},${order.status || "pending"}\n`;
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=report-${range}.csv`,
      );
      res.send(csv);
    } catch (error) {
      console.error("Error downloading report:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
