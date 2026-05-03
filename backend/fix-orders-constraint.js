import dotenv from "dotenv";
dotenv.config();
import { supabase } from "./src/supabaseClient.js";

async function fixOrdersConstraint() {
  console.log("🔧 Fixing orders unique constraint...");

  try {
    // Drop the partial unique index
    const { error: dropError } = await supabase.rpc("exec_sql", {
      sql: "DROP INDEX IF EXISTS idx_orders_store_shopify_unique;",
    });

    if (dropError) {
      console.log("⚠️  Could not drop index via RPC, trying direct SQL...");
      // Try direct SQL execution
      const { error: directDropError } = await supabase
        .from("_migrations")
        .select("*")
        .limit(1);

      if (directDropError) {
        console.log(
          "Note: Using Supabase client - index changes require database admin access",
        );
        console.log(
          "\nPlease run this SQL manually in your Supabase SQL Editor:",
        );
        console.log("\n--- START SQL ---");
        console.log("DROP INDEX IF EXISTS idx_orders_store_shopify_unique;");
        console.log("");
        console.log("CREATE UNIQUE INDEX idx_orders_store_shopify_unique");
        console.log("ON public.orders (");
        console.log(
          "  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),",
        );
        console.log("  COALESCE(shopify_id, '')");
        console.log(");");
        console.log("--- END SQL ---\n");
        return;
      }
    }

    // Create the new full unique index
    const { error: createError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE UNIQUE INDEX idx_orders_store_shopify_unique 
        ON public.orders (
          COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), 
          COALESCE(shopify_id, '')
        );
      `,
    });

    if (createError) {
      console.log("⚠️  Could not create index via RPC");
      console.log(
        "\nPlease run this SQL manually in your Supabase SQL Editor:",
      );
      console.log("\n--- START SQL ---");
      console.log("DROP INDEX IF EXISTS idx_orders_store_shopify_unique;");
      console.log("");
      console.log("CREATE UNIQUE INDEX idx_orders_store_shopify_unique");
      console.log("ON public.orders (");
      console.log(
        "  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),",
      );
      console.log("  COALESCE(shopify_id, '')");
      console.log(");");
      console.log("--- END SQL ---\n");
      return;
    }

    console.log(
      "✅ Successfully fixed orders unique constraint - bulk upserts will now work!",
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\nPlease run this SQL manually in your Supabase SQL Editor:");
    console.log("\n--- START SQL ---");
    console.log("DROP INDEX IF EXISTS idx_orders_store_shopify_unique;");
    console.log("");
    console.log("CREATE UNIQUE INDEX idx_orders_store_shopify_unique");
    console.log("ON public.orders (");
    console.log(
      "  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),",
    );
    console.log("  COALESCE(shopify_id, '')");
    console.log(");");
    console.log("--- END SQL ---\n");
  }
}

fixOrdersConstraint();
