// Quick test to check API endpoints
import fetch from "node-fetch";

async function testAPI() {
  try {
    // Test shipping issues endpoint
    console.log("Testing shipping issues endpoint...");
    const response = await fetch(
      "http://localhost:5000/api/shopify/orders/shipping-issues",
      {
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
      },
    );

    console.log("Shipping issues response status:", response.status);

    if (response.status === 401) {
      console.log("❌ Authentication required - this is expected");
    } else if (response.status === 403) {
      console.log("❌ Permission denied - this indicates the permission issue");
    } else {
      console.log("✅ Endpoint accessible");
    }
  } catch (error) {
    console.error("Error testing API:", error.message);
  }
}

testAPI();
