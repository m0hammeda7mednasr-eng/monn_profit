import dotenv from "dotenv";
dotenv.config();
import BostaService from "./src/services/bostaService.js";

async function testTracking() {
  const trackingNumber = String(
    process.argv[2] || process.env.BOSTA_TEST_TRACKING_NUMBER || "",
  ).trim();

  if (!trackingNumber) {
    console.error(
      "Provide a real tracking number via `node test-bosta-tracking.js <tracking>` or `BOSTA_TEST_TRACKING_NUMBER`.",
    );
    process.exit(1);
  }

  console.log(`Testing Bosta Tracking Number: ${trackingNumber}`);
  console.log("=".repeat(50));

  try {
    const bostaService = new BostaService({
      apiKey: process.env.BOSTA_API_KEY,
    });

    console.log("\nFetching delivery status from Bosta API...");
    const delivery = await bostaService.getDeliveryStatus(trackingNumber);

    console.log("\nDelivery found!");
    console.log(JSON.stringify(delivery, null, 2));
  } catch (error) {
    console.error("\nError:", error.message);

    if (error.message.includes("404")) {
      console.log("\nThis tracking number doesn't exist in Bosta system");
      console.log("Please try with a valid tracking number from Bosta");
    }
  }
}

testTracking();
