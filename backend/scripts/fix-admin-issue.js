import { supabase } from "./src/supabaseClient.js";

async function checkAndFixAdminIssue() {
  console.log("🔍 Checking current users and their roles...");

  try {
    // Check current users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, email, name, role, is_active, created_at")
      .order("created_at", { ascending: true });

    if (usersError) {
      console.error("❌ Error fetching users:", usersError);
      return;
    }

    console.log(`📊 Found ${users?.length || 0} users:`);
    users?.forEach((user) => {
      console.log(
        `  - ${user.email} (${user.name}) - Role: ${user.role || "NULL"} - Active: ${user.is_active}`,
      );
    });

    // Check for admin users
    const adminUsers = users?.filter((user) => user.role === "admin") || [];
    console.log(`👨‍💼 Admin users: ${adminUsers.length}`);

    if (adminUsers.length === 0) {
      console.log("⚠️  No admin users found! Making all users admin...");

      if (users && users.length > 0) {
        // Make all users admin
        const { data: updateResult, error: updateError } = await supabase
          .from("users")
          .update({ role: "admin" })
          .neq("role", "admin");

        if (updateError) {
          console.error("❌ Error updating users to admin:", updateError);
        } else {
          console.log("✅ Successfully made all users admin!");
        }

        // Update permissions for all users
        for (const user of users) {
          const { data: permissionData, error: permissionError } =
            await supabase.from("permissions").upsert(
              {
                user_id: user.id,
                can_view_dashboard: true,
                can_view_products: true,
                can_edit_products: true,
                can_view_warehouse: true,
                can_edit_warehouse: true,
                can_view_suppliers: true,
                can_edit_suppliers: true,
                can_view_orders: true,
                can_edit_orders: true,
                can_view_customers: true,
                can_edit_customers: true,
                can_manage_users: true,
                can_manage_settings: true,
                can_view_profits: true,
              },
              {
                onConflict: "user_id",
              },
            );

          if (permissionError) {
            console.error(
              `❌ Error updating permissions for ${user.email}:`,
              permissionError,
            );
          } else {
            console.log(`✅ Updated permissions for ${user.email}`);
          }
        }
      } else {
        console.log(
          "⚠️  No users found in database! You need to register a user first.",
        );
        console.log(
          "💡 Go to http://localhost:3000/register to create an account",
        );
      }
    } else {
      console.log("✅ Admin users already exist!");
      adminUsers.forEach((admin) => {
        console.log(`  👨‍💼 Admin: ${admin.email} (${admin.name})`);
      });
    }

    // Final verification
    console.log("\n🔍 Final verification - checking admin users...");
    const { data: finalUsers, error: finalError } = await supabase
      .from("users")
      .select("id, email, name, role")
      .eq("role", "admin");

    if (finalError) {
      console.error("❌ Error in final verification:", finalError);
    } else {
      console.log(`✅ Final result: ${finalUsers?.length || 0} admin users`);
      finalUsers?.forEach((admin) => {
        console.log(`  👨‍💼 ${admin.email} (${admin.name})`);
      });
    }
  } catch (error) {
    console.error("❌ Unexpected error:", error);
  }
}

checkAndFixAdminIssue();
