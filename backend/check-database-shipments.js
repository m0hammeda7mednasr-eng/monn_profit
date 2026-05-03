import dotenv from "dotenv";
dotenv.config();
import { supabase } from "./src/supabaseClient.js";

async function checkDatabaseShipments() {
  console.log("🔍 Checking for Bosta shipments in database...");
  console.log("=".repeat(60));

  try {
    const { data: shipments, error } = await supabase
      .from("bosta_shipments")
      .select(
        "tracking_number, order_id, delivery_state, delivery_state_label, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("❌ Database error:", error.message);
      return;
    }

    if (!shipments || shipments.length === 0) {
      console.log("\n⚠️  No Bosta shipments found in database");
      console.log("\nTo test the scanner, you need to:");
      console.log("1. Create a real shipment in Bosta");
      console.log("2. Or use Bosta's test/sandbox environment");
      console.log("3. Get a valid tracking number from Bosta dashboard");
      return;
    }

    console.log(`\n✅ Found ${shipments.length} shipments in database:\n`);

    shipments.forEach((shipment, index) => {
      console.log(`${index + 1}. Tracking: ${shipment.tracking_number}`);
      console.log(`   Order ID: ${shipment.order_id || "N/A"}`);
      console.log(`   State: ${shipment.delivery_state_label || "Unknown"}`);
      console.log(
        `   Created: ${new Date(shipment.created_at).toLocaleString()}`,
      );
      console.log("");
    });

    console.log("🎯 You can use any of these tracking numbers in the scanner!");
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkDatabaseShipments();
