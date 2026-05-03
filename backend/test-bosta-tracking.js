import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testTracking() {
  console.log("🔍 Testing Bosta Tracking Number: 2905183849");
  console.log("=".repeat(50));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    console.log("\n📦 Fetching delivery status from Bosta API...");
    const delivery = await bostaService.getDeliveryStatus("2905183849");

    console.log("\n✅ Delivery found!");
    console.log(JSON.stringify(delivery, null, 2));
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (error.message.includes("404")) {
      console.log("\n⚠️  This tracking number doesn't exist in Bosta system");
      console.log("Please try with a valid tracking number from Bosta");
    }
  }
}

testTracking();
