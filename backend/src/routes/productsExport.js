/**
 * Products Export Routes
 * Export products data to Excel
 */

import express from "express";
import ExcelJS from "exceljs";
import { requireAuth } from "../middleware/auth.js";
import { requirePermissions } from "../middleware/permissions.js";
import { supabase } from "../supabaseClient.js";

const router = express.Router();

/**
 * GET /api/products/export
 * Export all products to Excel
 */
router.get(
  "/export",
  requireAuth,
  requirePermissions(["can_view_products"]),
  async (req, res) => {
    try {
      const db = supabase;

      // Fetch all products with variants
      const { data: products, error } = await db
        .from("products")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Products");

      // Define columns
      worksheet.columns = [
        { header: "Product ID", key: "product_id", width: 15 },
        { header: "Product Title", key: "product_title", width: 30 },
        { header: "Variant ID", key: "variant_id", width: 15 },
        { header: "Variant Title", key: "variant_title", width: 25 },
        { header: "SKU", key: "sku", width: 20 },
        { header: "Barcode", key: "barcode", width: 20 },
        { header: "Price", key: "price", width: 12 },
        { header: "Cost Price", key: "cost_price", width: 12 },
        { header: "Inventory Quantity", key: "inventory_quantity", width: 18 },
        { header: "Vendor", key: "vendor", width: 20 },
        { header: "Product Type", key: "product_type", width: 20 },
        { header: "Tags", key: "tags", width: 30 },
        { header: "Status", key: "status", width: 12 },
        { header: "Created At", key: "created_at", width: 20 },
        { header: "Updated At", key: "updated_at", width: 20 },
      ];

      // Style header row
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0E7490" },
      };
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

      // Add data rows
      for (const product of products) {
        const productData =
          typeof product.data === "string"
            ? JSON.parse(product.data)
            : product.data;

        const variants = productData.variants || [];

        if (variants.length === 0) {
          // Product without variants
          worksheet.addRow({
            product_id: productData.id,
            product_title: productData.title,
            variant_id: "",
            variant_title: "",
            sku: "",
            barcode: "",
            price: productData.price || "",
            cost_price: "",
            inventory_quantity: "",
            vendor: productData.vendor || "",
            product_type: productData.product_type || "",
            tags: (productData.tags || []).join(", "),
            status: productData.status || "",
            created_at: productData.created_at || "",
            updated_at: productData.updated_at || "",
          });
        } else {
          // Product with variants
          for (const variant of variants) {
            worksheet.addRow({
              product_id: productData.id,
              product_title: productData.title,
              variant_id: variant.id,
              variant_title: variant.title,
              sku: variant.sku || "",
              barcode: variant.barcode || "",
              price: variant.price || "",
              cost_price: variant.cost_price || "",
              inventory_quantity: variant.inventory_quantity || 0,
              vendor: productData.vendor || "",
              product_type: productData.product_type || "",
              tags: (productData.tags || []).join(", "),
              status: productData.status || "",
              created_at: productData.created_at || "",
              updated_at: productData.updated_at || "",
            });
          }
        }
      }

      // Auto-filter
      worksheet.autoFilter = {
        from: "A1",
        to: `O${worksheet.rowCount}`,
      };

      // Freeze header row
      worksheet.views = [{ state: "frozen", ySplit: 1 }];

      // Set response headers
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=products-export-${new Date().toISOString().split("T")[0]}.xlsx`,
      );

      // Write to response
      await workbook.xlsx.write(res);
      res.end();

      // Log export
      await db.from("activity_log").insert({
        user_id: req.user.id,
        action: "products_exported",
        entity_type: "products",
        entity_id: "export",
        details: {
          product_count: products.length,
          exported_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to export products:", error);
      res.status(500).json({
        error: "Failed to export products",
        message: error.message,
      });
    }
  },
);

export default router;
