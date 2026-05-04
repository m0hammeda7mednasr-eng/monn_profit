import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testRealTracking() {
  const trackingNumbers = [
    ...process.argv.slice(2),
    ...String(process.env.BOSTA_TEST_TRACKING_NUMBERS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];

  if (trackingNumbers.length === 0) {
    console.error(
      "Provide real tracking numbers via CLI args or `BOSTA_TEST_TRACKING_NUMBERS=123,456`.",
    );
    process.exit(1);
  }

  console.log("🔍 Testing Real Bosta Tracking Numbers");
  console.log("=".repeat(60));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    for (const trackingNumber of trackingNumbers) {
      console.log(`\n📦 Testing: ${trackingNumber}`);

      try {
        const delivery = await bostaService.getDeliveryStatus(trackingNumber);

        console.log(`✅ Found!`);
        console.log(`   Delivery ID: ${delivery._id}`);
        console.log(
          `   State: ${delivery.state} (${bostaService.getStateLabel(delivery.state)})`,
        );
        console.log(`   Type: ${delivery.type}`);
        console.log(`   COD: ${delivery.cod || 0} EGP`);

        // Stop after first successful one
        console.log("\n🎉 Success! This tracking number works!");
        console.log(
          `\nUse this tracking number in the scanner: ${trackingNumber}`,
        );
        break;
      } catch (error) {
        console.log(
          `❌ Not found or error: ${error.message.substring(0, 50)}...`,
        );
      }
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  }
}

testRealTracking();
