import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function createTestShipment() {
  console.log("🚀 Creating Test Shipment in Bosta");
  console.log("=".repeat(60));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    // Create a test delivery
    const testDelivery = {
      type: 10, // DELIVER
      specs: {
        packageDetails: {
          description: "Test order from Moon Profit system",
          itemsCount: 1,
        },
        packageType: "Parcel", // Try Parcel
      },
      dropOffAddress: {
        firstLine: "123 Test Street",
        city: "Cairo",
        zone: "Nasr City",
        district: "Nasr City",
      },
      cod: 100, // 100 EGP COD
      businessReference: `TEST-${Date.now()}`,
      allowOpenPackage: false,
      flexShip: false,
    };

    console.log("\n📦 Creating delivery...");
    console.log("Details:", JSON.stringify(testDelivery, null, 2));

    const result = await bostaService.createDelivery(testDelivery);

    console.log("\n✅ SUCCESS! Shipment created:");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n🎯 Use this tracking number in the scanner:");
    console.log(`   ${result.trackingNumber}`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.log("\nThis might be because:");
    console.log("1. The API key doesn't have permission to create shipments");
    console.log("2. Missing required fields in the delivery data");
    console.log("3. Bosta account needs to be configured properly");

    console.log("\n💡 Alternative: Use the DEMO tracking number:");
    console.log("   DEMO123456789");
  }
}

createTestShipment();
