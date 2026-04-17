import fetch from "node-fetch";

async function testAnalyticsEndpoint() {
  console.log("🔍 Testing Analytics Endpoint...");

  try {
    // First, login to get a token
    console.log("1️⃣ Logging in to get admin token...");

    const loginResponse = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "midooooahmed28@gmail.com",
        password: "password123", // You might need to adjust this
      }),
    });

    if (!loginResponse.ok) {
      console.log("❌ Login failed, trying another admin...");

      // Try with another admin
      const loginResponse2 = await fetch(
        "http://localhost:5000/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "testadmin@example.com",
            password: "admin123",
          }),
        },
      );

      if (!loginResponse2.ok) {
        const errorText = await loginResponse2.text();
        console.log("❌ Second login also failed:", errorText);
        console.log(
          "💡 You may need to check the password or create a new admin user",
        );
        return;
      }

      const loginData2 = await loginResponse2.json();
      console.log("✅ Login successful with testadmin@example.com");

      // Test analytics endpoint
      console.log("2️⃣ Testing analytics endpoint...");
      const analyticsResponse = await fetch(
        "http://localhost:5000/api/dashboard/analytics",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${loginData2.token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log(`📊 Analytics response status: ${analyticsResponse.status}`);

      if (analyticsResponse.ok) {
        const analyticsData = await analyticsResponse.json();
        console.log(
          "✅ Analytics endpoint working! Data keys:",
          Object.keys(analyticsData),
        );
      } else {
        const errorText = await analyticsResponse.text();
        console.log("❌ Analytics endpoint failed:", errorText);
      }

      return;
    }

    const loginData = await loginResponse.json();
    console.log("✅ Login successful with midooooahmed28@gmail.com");

    // Test analytics endpoint
    console.log("2️⃣ Testing analytics endpoint...");
    const analyticsResponse = await fetch(
      "http://localhost:5000/api/dashboard/analytics",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${loginData.token}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log(`📊 Analytics response status: ${analyticsResponse.status}`);

    if (analyticsResponse.ok) {
      const analyticsData = await analyticsResponse.json();
      console.log(
        "✅ Analytics endpoint working! Data keys:",
        Object.keys(analyticsData),
      );
      console.log("📈 Sample data:");
      console.log("  - Total Orders:", analyticsData.summary?.totalOrders || 0);
      console.log(
        "  - Total Revenue:",
        analyticsData.financial?.totalRevenue || 0,
      );
      console.log(
        "  - Success Rate:",
        analyticsData.summary?.successRate || 0,
        "%",
      );
    } else {
      const errorText = await analyticsResponse.text();
      console.log("❌ Analytics endpoint failed:", errorText);
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
  }
}

testAnalyticsEndpoint();
