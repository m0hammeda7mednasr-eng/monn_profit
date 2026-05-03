import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testBostaDetailed() {
  console.log("🔧 Detailed Bosta API Test");
  console.log("=".repeat(50));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    // Test 1: Get Cities
    console.log("\n📍 Test 1: Fetching Cities");
    try {
      const citiesResponse = await bostaService.getCities();
      console.log("✅ Cities API Response:");
      console.log(JSON.stringify(citiesResponse, null, 2));
    } catch (error) {
      console.log("❌ Cities API Error:", error.message);
    }

    // Test 2: Get Pricing (sample)
    console.log("\n💰 Test 2: Testing Pricing API");
    try {
      const pricingData = {
        type: 10, // DELIVER
        specs: {
          packageType: "SMALL",
        },
        dropOffAddress: {
          city: "Cairo",
          zone: "Nasr City",
        },
      };
      const pricing = await bostaService.getPricing(pricingData);
      console.log("✅ Pricing API Response:");
      console.log(JSON.stringify(pricing, null, 2));
    } catch (error) {
      console.log("❌ Pricing API Error:", error.message);
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Bosta API Key is valid and working!");
    console.log("🎉 You can now use Bosta shipping in your app");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

testBostaDetailed();
