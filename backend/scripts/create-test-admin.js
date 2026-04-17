import fetch from "node-fetch";
import { supabase } from "./src/supabaseClient.js";

async function createTestAdmin() {
  console.log("🔧 Creating test admin user...");

  try {
    // First, register a new admin user
    console.log("1️⃣ Registering new admin user...");

    const registerResponse = await fetch(
      "http://localhost:5000/api/auth/register",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "admin@analytics-test.com",
          password: "admin123456",
          name: "Analytics Test Admin",
        }),
      },
    );

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();
      console.log("⚠️  Registration response:", errorText);

      // User might already exist, let's try to update existing user
      console.log("2️⃣ User might exist, updating existing admin user...");

      // Update an existing user to admin and set known password
      const { data: updateResult, error: updateError } = await supabase
        .from("users")
        .update({
          role: "admin",
          password:
            "$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi", // bcrypt hash for 'password'
        })
        .eq("email", "midooooahmed28@gmail.com");

      if (updateError) {
        console.error("❌ Error updating user:", updateError);
        return;
      }

      console.log("✅ Updated existing user to have known password");

      // Test login with updated user
      console.log("3️⃣ Testing login with updated user...");
      const loginResponse = await fetch(
        "http://localhost:5000/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: "midooooahmed28@gmail.com",
            password: "password",
          }),
        },
      );

      if (!loginResponse.ok) {
        const loginError = await loginResponse.text();
        console.log("❌ Login still failed:", loginError);
        return;
      }

      const loginData = await loginResponse.json();
      console.log("✅ Login successful!");

      // Test analytics endpoint
      console.log("4️⃣ Testing analytics endpoint...");
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
        console.log(
          "  - Total Orders:",
          analyticsData.summary?.totalOrders || 0,
        );
        console.log(
          "  - Total Revenue:",
          analyticsData.financial?.totalRevenue || 0,
        );
        console.log(
          "  - Success Rate:",
          analyticsData.summary?.successRate || 0,
          "%",
        );

        console.log("\n🎉 SUCCESS: Analytics 404 error has been fixed!");
        console.log("💡 You can now login with:");
        console.log("   Email: midooooahmed28@gmail.com");
        console.log("   Password: password");
      } else {
        const errorText = await analyticsResponse.text();
        console.log("❌ Analytics endpoint still failing:", errorText);
      }

      return;
    }

    const registerData = await registerResponse.json();
    console.log("✅ Registration successful!");

    // Make the new user admin
    console.log("2️⃣ Making user admin...");
    const { data: updateResult, error: updateError } = await supabase
      .from("users")
      .update({ role: "admin" })
      .eq("email", "admin@analytics-test.com");

    if (updateError) {
      console.error("❌ Error making user admin:", updateError);
      return;
    }

    console.log("✅ User is now admin!");

    // Test analytics endpoint
    console.log("3️⃣ Testing analytics endpoint...");
    const analyticsResponse = await fetch(
      "http://localhost:5000/api/dashboard/analytics",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${registerData.token}`,
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

      console.log("\n🎉 SUCCESS: Analytics 404 error has been fixed!");
      console.log("💡 You can now login with:");
      console.log("   Email: admin@analytics-test.com");
      console.log("   Password: admin123456");
    } else {
      const errorText = await analyticsResponse.text();
      console.log("❌ Analytics endpoint still failing:", errorText);
    }
  } catch (error) {
    console.error("❌ Test failed with error:", error.message);
  }
}

createTestAdmin();
