import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testBostaReal() {
  const trackingNumber = "2695867962";

  console.log(`🔍 Testing Bosta Tracking: ${trackingNumber}`);
  console.log("=".repeat(60));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    console.log("\n📦 Fetching from Bosta API...");
    const delivery = await bostaService.getDeliveryStatus(trackingNumber);

    console.log("\n✅ SUCCESS! Delivery found:");
    console.log(JSON.stringify(delivery, null, 2));

    console.log("\n📊 Summary:");
    console.log(`   Tracking: ${delivery.trackingNumber || trackingNumber}`);
    console.log(`   Delivery ID: ${delivery._id}`);
    console.log(
      `   State: ${delivery.state} (${bostaService.getStateLabel(delivery.state)})`,
    );
    console.log(`   Type: ${delivery.type}`);
    console.log(`   COD: ${delivery.cod || 0} EGP`);

    console.log("\n🎉 This tracking number works! Use it in the scanner.");
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (
      error.message.includes("<!DOCTYPE") ||
      error.message.includes("not valid JSON")
    ) {
      console.log("\n⚠️  This tracking number doesn't exist in Bosta system");
      console.log("The API returned HTML instead of JSON (404 page)");
    }
  }
}

testBostaReal();
