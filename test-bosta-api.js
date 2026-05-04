// Test script to verify Bosta API connection
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config({ path: "./backend/.env" });

const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const TEST_TRACKING_NUMBERS = [
  "2695867962",
  "2685887962",
  "5456047775",
  "2338863853",
];

async function testBostaAPI() {
  console.log("🔍 Testing Bosta API Connection...\n");
  console.log(`API Key: ${BOSTA_API_KEY ? "✅ Found" : "❌ Missing"}\n`);

  if (!BOSTA_API_KEY) {
    console.error("❌ BOSTA_API_KEY not found in backend/.env");
    process.exit(1);
  }

  for (const trackingNumber of TEST_TRACKING_NUMBERS) {
    console.log(`\n📦 Testing tracking number: ${trackingNumber}`);
    console.log("─".repeat(50));

    try {
      const response = await fetch(
        `https://app.bosta.co/api/v2/deliveries/${trackingNumber}`,
        {
          headers: {
            Authorization: BOSTA_API_KEY,
            "Content-Type": "application/json",
          },
        },
      );

      console.log(`Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const data = await response.json();
        console.log("✅ SUCCESS - Shipment found!");
        console.log(`   Tracking: ${data.trackingNumber}`);
        console.log(`   State: ${data.state?.label || "Unknown"}`);
        console.log(`   COD: ${data.cod || 0} EGP`);
        console.log(
          `   Receiver: ${data.receiver?.firstName || "N/A"} ${data.receiver?.lastName || ""}`,
        );
        console.log(`   City: ${data.dropOffAddress?.city?.name || "N/A"}`);
      } else {
        const errorText = await response.text();
        console.log(`❌ FAILED - ${errorText}`);
      }
    } catch (error) {
      console.log(`❌ ERROR - ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Test completed");
}

testBostaAPI();
