// Check if there are any Bosta shipments in the database
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: "./backend/.env" });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in backend/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkShipments() {
  console.log("🔍 Checking Bosta shipments in database...\n");

  try {
    // Check if bosta_shipments table exists and has data
    const { data: shipments, error } = await supabase
      .from("bosta_shipments")
      .select("*")
      .limit(10);

    if (error) {
      console.error("❌ Error querying database:", error.message);
      return;
    }

    if (!shipments || shipments.length === 0) {
      console.log("📭 No Bosta shipments found in database");
      console.log("\n💡 To create a shipment:");
      console.log("   1. Go to Orders page");
      console.log("   2. Click on an order");
      console.log('   3. Use "Ship with Bosta" button');
      console.log("   4. Then you can scan the tracking number\n");
      return;
    }

    console.log(`✅ Found ${shipments.length} shipments:\n`);

    shipments.forEach((shipment, index) => {
      console.log(`${index + 1}. Tracking: ${shipment.tracking_number}`);
      console.log(`   Order ID: ${shipment.order_id || "N/A"}`);
      console.log(`   State: ${shipment.delivery_state_label || "Unknown"}`);
      console.log(`   COD: ${shipment.cod_amount || 0} EGP`);
      console.log(
        `   Created: ${new Date(shipment.created_at).toLocaleString()}`,
      );
      console.log("");
    });

    console.log(
      "\n💡 You can test with these tracking numbers in Bosta Scanner!",
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkShipments();
