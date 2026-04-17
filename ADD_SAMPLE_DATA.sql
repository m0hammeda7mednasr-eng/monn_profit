-- ====================================
-- إضافة بيانات تجريبية
-- Add Sample Data
-- ====================================

-- هذا الملف هيضيف بيانات تجريبية عشان نشوف حاجة في Dashboard

-- 1. إنشاء المستخدم والمتجر
INSERT INTO users (id, email, password, name, role, created_at, updated_at)
VALUES (
    'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid,
    'midoooahmed28@gmail.com',
    '$2a$10$dummy.hash.for.admin.user.placeholder.only',
    'Admin User',
    'admin',
    NOW(),
    NOW()
) ON CONFLICT (email) DO UPDATE SET
    role = 'admin',
    name = 'Admin User',
    updated_at = NOW();

INSERT INTO stores (id, name, created_at, updated_at)
VALUES (
    '59b47070-f018-4919-b628-1009af216fd7'::uuid,
    'Main Store',
    NOW(),
    NOW()
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = NOW();

-- 2. ربط المستخدم بالمتجر
INSERT INTO user_stores (user_id, store_id)
VALUES (
    'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid,
    '59b47070-f018-4919-b628-1009af216fd7'::uuid
) ON CONFLICT (user_id, store_id) DO NOTHING;

-- 3. إضافة الصلاحيات
INSERT INTO permissions (
    user_id,
    can_view_products,
    can_edit_products,
    can_view_orders,
    can_edit_orders,
    can_view_customers,
    can_edit_customers,
    can_manage_settings
)
VALUES (
    'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid,
    true, true, true, true, true, true, true
) ON CONFLICT (user_id) DO UPDATE SET
    can_view_products = true,
    can_edit_products = true,
    can_view_orders = true,
    can_edit_orders = true,
    can_view_customers = true,
    can_edit_customers = true,
    can_manage_settings = true;

-- 4. إضافة منتجات تجريبية
INSERT INTO products (id, title, description, price, cost_price, currency, sku, inventory_quantity, shopify_id, user_id, store_id, created_at, updated_at)
VALUES 
    (gen_random_uuid(), 'iPhone 15 Pro', 'Latest iPhone model with advanced features', 999.99, 600.00, 'USD', 'IPH15PRO', 50, '12345678901', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'Samsung Galaxy S24', 'Premium Android smartphone', 899.99, 540.00, 'USD', 'SGS24', 30, '12345678902', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'MacBook Air M3', 'Lightweight laptop with M3 chip', 1299.99, 780.00, 'USD', 'MBAM3', 20, '12345678903', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'AirPods Pro 2', 'Wireless earbuds with noise cancellation', 249.99, 150.00, 'USD', 'APP2', 100, '12345678904', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'iPad Pro 12.9"', 'Professional tablet for creative work', 1099.99, 660.00, 'USD', 'IPADPRO129', 25, '12345678905', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW());

-- 5. إضافة عملاء تجريبيين
INSERT INTO customers (id, name, email, phone, total_spent, orders_count, shopify_id, user_id, store_id, created_at, updated_at)
VALUES 
    (gen_random_uuid(), 'أحمد محمد', 'ahmed@example.com', '+201234567890', 2599.98, 3, '87654321001', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'فاطمة علي', 'fatima@example.com', '+201234567891', 1899.99, 2, '87654321002', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'محمد حسن', 'mohamed@example.com', '+201234567892', 1549.98, 2, '87654321003', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'سارة أحمد', 'sara@example.com', '+201234567893', 999.99, 1, '87654321004', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), 'عمر خالد', 'omar@example.com', '+201234567894', 1349.98, 2, '87654321005', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW());

-- 6. إضافة طلبات تجريبية
INSERT INTO orders (id, order_number, customer_name, customer_email, total_price, subtotal_price, currency, status, fulfillment_status, items_count, shopify_id, user_id, store_id, created_at, updated_at)
VALUES 
    (gen_random_uuid(), '1001', 'أحمد محمد', 'ahmed@example.com', 999.99, 999.99, 'USD', 'paid', 'fulfilled', 1, '55555555001', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW() - INTERVAL '5 days', NOW()),
    (gen_random_uuid(), '1002', 'فاطمة علي', 'fatima@example.com', 899.99, 899.99, 'USD', 'paid', 'fulfilled', 1, '55555555002', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW() - INTERVAL '4 days', NOW()),
    (gen_random_uuid(), '1003', 'محمد حسن', 'mohamed@example.com', 1299.99, 1299.99, 'USD', 'paid', 'fulfilled', 1, '55555555003', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW() - INTERVAL '3 days', NOW()),
    (gen_random_uuid(), '1004', 'سارة أحمد', 'sara@example.com', 249.99, 249.99, 'USD', 'paid', 'pending', 1, '55555555004', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW() - INTERVAL '2 days', NOW()),
    (gen_random_uuid(), '1005', 'عمر خالد', 'omar@example.com', 1099.99, 1099.99, 'USD', 'paid', 'fulfilled', 1, '55555555005', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW() - INTERVAL '1 day', NOW()),
    (gen_random_uuid(), '1006', 'أحمد محمد', 'ahmed@example.com', 1349.98, 1349.98, 'USD', 'paid', 'fulfilled', 2, '55555555006', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), '1007', 'فاطمة علي', 'fatima@example.com', 1000.00, 1000.00, 'USD', 'pending', 'unfulfilled', 1, '55555555007', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW()),
    (gen_random_uuid(), '1008', 'محمد حسن', 'mohamed@example.com', 249.99, 249.99, 'USD', 'paid', 'fulfilled', 1, '55555555008', 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid, '59b47070-f018-4919-b628-1009af216fd7'::uuid, NOW(), NOW());

-- 7. فحص النتائج
SELECT 'فحص البيانات التجريبية المضافة' as status;

SELECT 
    'إحصائيات البيانات التجريبية' as data_type,
    (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL) as products_count,
    (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL) as orders_count,
    (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL) as customers_count,
    (SELECT COALESCE(SUM(CAST(total_price AS DECIMAL)), 0) FROM orders WHERE shopify_id IS NOT NULL AND status = 'paid') as total_sales;

-- محاكاة Dashboard Stats
WITH dashboard_stats AS (
    SELECT 
        (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_products,
        (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_orders,
        (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_customers,
        (SELECT COALESCE(SUM(CAST(total_price AS DECIMAL)), 0) FROM orders WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid AND status = 'paid') as total_sales
)
SELECT 
    'محاكاة Dashboard Stats' as api_simulation,
    total_products,
    total_orders,
    total_customers,
    total_sales,
    CASE 
        WHEN total_products > 0 AND total_orders > 0 AND total_customers > 0 THEN 'Dashboard سيعرض البيانات ✅'
        ELSE 'Dashboard لن يعرض البيانات ❌'
    END as expected_result
FROM dashboard_stats;

SELECT 'تم إضافة البيانات التجريبية بنجاح! 🎯' as final_message;
SELECT 'الآن Dashboard سيعرض البيانات فوراً!' as next_step;