import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testBostaConnection() {
  console.log("🔧 Testing Bosta API Connection...");
  console.log("API Key:", process.env.BOSTA_API_KEY ? "✓ Found" : "✗ Missing");

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    console.log("\n📍 Fetching cities from Bosta API...");
    const cities = await bostaService.getCities();

    console.log(`\n✅ SUCCESS! Connected to Bosta API`);
    console.log(`📊 Found ${cities.length || 0} cities`);

    if (cities.length > 0) {
      console.log("\n🏙️  Sample cities:");
      cities.slice(0, 5).forEach((city) => {
        console.log(`   - ${city.name || city._id} (ID: ${city._id})`);
      });
    }

    console.log("\n🎉 Bosta integration is working perfectly!");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR: Failed to connect to Bosta API");
    console.error("Message:", error.message);
    console.error("\nPlease check:");
    console.error("1. API Key is correct");
    console.error("2. You have internet connection");
    console.error("3. Bosta API is accessible");
    process.exit(1);
  }
}

testBostaConnection();
