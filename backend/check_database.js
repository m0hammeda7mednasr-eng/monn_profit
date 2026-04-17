import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function checkProductCostFields() {
  try {
    console.log("🔍 Checking products table for cost fields...\n");

    // Check if columns exist
    const { data: columns, error: columnsError } = await supabase
      .from("information_schema.columns")
      .select("column_name, data_type, is_nullable, column_default")
      .eq("table_name", "products")
      .in("column_name", [
        "cost_price",
        "ads_cost",
        "operation_cost",
        "shipping_cost",
      ]);

    if (columnsError) {
      console.error("❌ Error checking columns:", columnsError);
      return;
    }

    console.log("📋 Cost-related columns in products table:");
    console.table(columns);

    // Get sample products with cost fields
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, title, cost_price, ads_cost, operation_cost, shipping_cost")
      .limit(10);

    if (productsError) {
      console.error("❌ Error fetching products:", productsError);
      return;
    }

    console.log("\n💰 Sample products with cost fields:");
    console.table(products);

    // Check for products with non-zero new cost fields
    const { data: productsWithCosts, error: costsError } = await supabase
      .from("products")
      .select("id, title, cost_price, ads_cost, operation_cost, shipping_cost")
      .or("ads_cost.gt.0,operation_cost.gt.0,shipping_cost.gt.0");

    if (costsError) {
      console.error("❌ Error fetching products with costs:", costsError);
      return;
    }

    console.log("\n🎯 Products with non-zero new cost fields:");
    if (productsWithCosts.length === 0) {
      console.log(
        "⚠️  No products found with ads_cost, operation_cost, or shipping_cost > 0",
      );
    } else {
      console.table(productsWithCosts);
    }
  } catch (error) {
    console.error("💥 Script error:", error);
  }
}

checkProductCostFields();
