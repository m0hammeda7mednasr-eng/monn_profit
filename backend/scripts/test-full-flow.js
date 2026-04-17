import fetch from "node-fetch";

async function testFullFlow() {
  console.log("🔍 Testing full request flow...");

  try {
    // Test 1: Health check (should work)
    console.log("1️⃣ Testing health endpoint...");
    const healthResponse = await fetch("http://localhost:5000/api/health");
    console.log(`   Health status: ${healthResponse.status}`);

    // Test 2: Dashboard stats without auth (should return 401)
    console.log("2️⃣ Testing dashboard stats without auth...");
    const statsNoAuthResponse = await fetch(
      "http://localhost:5000/api/dashboard/stats",
    );
    console.log(`   Stats no auth status: ${statsNoAuthResponse.status}`);
    const statsNoAuthText = await statsNoAuthResponse.text();
    console.log(`   Stats no auth response: ${statsNoAuthText}`);

    // Test 3: Analytics without auth (should return 401, not 404)
    console.log("3️⃣ Testing analytics without auth...");
    const analyticsNoAuthResponse = await fetch(
      "http://localhost:5000/api/dashboard/analytics",
    );
    console.log(
      `   Analytics no auth status: ${analyticsNoAuthResponse.status}`,
    );
    const analyticsNoAuthText = await analyticsNoAuthResponse.text();
    console.log(`   Analytics no auth response: ${analyticsNoAuthText}`);

    // Test 4: Login and get token
    console.log("4️⃣ Logging in...");
    const loginResponse = await fetch("http://localhost:5000/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "admin@analytics-test.com",
        password: "admin123456",
      }),
    });

    if (!loginResponse.ok) {
      const loginError = await loginResponse.text();
      console.log(`   ❌ Login failed: ${loginError}`);
      return;
    }

    const loginData = await loginResponse.json();
    console.log("   ✅ Login successful");
    console.log(`   Token starts with: ${loginData.token.substring(0, 20)}...`);

    // Test 5: Dashboard stats with auth (should work)
    console.log("5️⃣ Testing dashboard stats with auth...");
    const statsAuthResponse = await fetch(
      "http://localhost:5000/api/dashboard/stats",
      {
        headers: {
          Authorization: `Bearer ${loginData.token}`,
        },
      },
    );
    console.log(`   Stats with auth status: ${statsAuthResponse.status}`);
    if (statsAuthResponse.ok) {
      const statsData = await statsAuthResponse.json();
      console.log(`   Stats data keys: ${Object.keys(statsData)}`);
    } else {
      const statsError = await statsAuthResponse.text();
      console.log(`   Stats error: ${statsError}`);
    }

    // Test 6: Analytics with auth (this is the main test)
    console.log("6️⃣ Testing analytics with auth...");
    const analyticsAuthResponse = await fetch(
      "http://localhost:5000/api/dashboard/analytics",
      {
        headers: {
          Authorization: `Bearer ${loginData.token}`,
        },
      },
    );
    console.log(
      `   Analytics with auth status: ${analyticsAuthResponse.status}`,
    );

    if (analyticsAuthResponse.ok) {
      const analyticsData = await analyticsAuthResponse.json();
      console.log(
        "   ✅ Analytics working! Data keys:",
        Object.keys(analyticsData),
      );
      console.log("\n🎉 SUCCESS: Analytics 404 error has been FIXED!");
    } else {
      const analyticsError = await analyticsAuthResponse.text();
      console.log(`   ❌ Analytics error: ${analyticsError}`);

      // Additional debugging
      console.log("\n🔍 Additional debugging...");
      console.log(
        "   Response headers:",
        Object.fromEntries(analyticsAuthResponse.headers.entries()),
      );
    }

    // Test 7: Try different URL variations
    console.log("7️⃣ Testing URL variations...");

    const variations = [
      "http://localhost:5000/api/dashboard/analytics/",
      "http://localhost:5000/dashboard/analytics",
      "http://localhost:5000/analytics",
    ];

    for (const url of variations) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${loginData.token}`,
        },
      });
      console.log(`   ${url} -> ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
  }
}

testFullFlow();
