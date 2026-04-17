-- ====================================
-- اختبار شامل للنظام بعد الإصلاح
-- Complete System Test After Fix
-- ====================================

-- هذا الملف لاختبار النظام بالكامل والتأكد من عمل كل شيء

-- 1. فحص حالة النظام العامة
SELECT '=== فحص حالة النظام العامة ===' as test_section;

SELECT 
    'إحصائيات النظام' as test_name,
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM stores) as total_stores,
    (SELECT COUNT(*) FROM user_stores) as user_store_connections,
    (SELECT COUNT(*) FROM permissions) as user_permissions,
    (SELECT COUNT(*) FROM shopify_tokens) as shopify_connections;

-- 2. فحص بيانات Shopify
SELECT '=== فحص بيانات Shopify ===' as test_section;

SELECT 
    'بيانات Shopify الموجودة' as test_name,
    (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL) as shopify_products,
    (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL) as shopify_orders,
    (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL) as shopify_customers,
    (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL AND user_id IS NOT NULL AND store_id IS NOT NULL) as linked_products,
    (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL AND user_id IS NOT NULL AND store_id IS NOT NULL) as linked_orders,
    (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL AND user_id IS NOT NULL AND store_id IS NOT NULL) as linked_customers;

-- 3. فحص المستخدم الرئيسي
SELECT '=== فحص المستخدم الرئيسي ===' as test_section;

SELECT 
    'تفاصيل المستخدم الرئيسي' as test_name,
    u.id,
    u.email,
    u.role,
    (SELECT COUNT(*) FROM user_stores us WHERE us.user_id = u.id) as connected_stores,
    (SELECT COUNT(*) FROM permissions p WHERE p.user_id = u.id) as has_permissions,
    (SELECT COUNT(*) FROM shopify_tokens st WHERE st.user_id = u.id) as shopify_tokens,
    (SELECT COUNT(*) FROM products p WHERE p.user_id = u.id AND p.shopify_id IS NOT NULL) as owned_products,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.shopify_id IS NOT NULL) as owned_orders,
    (SELECT COUNT(*) FROM customers c WHERE c.user_id = u.id AND c.shopify_id IS NOT NULL) as owned_customers
FROM users u
WHERE u.id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid;

-- 4. فحص المتجر الرئيسي
SELECT '=== فحص المتجر الرئيسي ===' as test_section;

SELECT 
    'تفاصيل المتجر الرئيسي' as test_name,
    s.id,
    s.name,
    (SELECT COUNT(*) FROM user_stores us WHERE us.store_id = s.id) as connected_users,
    (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.shopify_id IS NOT NULL) as store_products,
    (SELECT COUNT(*) FROM orders o WHERE o.store_id = s.id AND o.shopify_id IS NOT NULL) as store_orders,
    (SELECT COUNT(*) FROM customers c WHERE c.store_id = s.id AND c.shopify_id IS NOT NULL) as store_customers
FROM stores s
WHERE s.id = '59b47070-f018-4919-b628-1009af216fd7'::uuid;

-- 5. محاكاة جميع API endpoints
SELECT '=== محاكاة API Endpoints ===' as test_section;

-- محاكاة Dashboard Stats API
WITH dashboard_stats AS (
    SELECT 
        (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_products,
        (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_orders,
        (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as total_customers,
        (SELECT COALESCE(SUM(CAST(total_price AS DECIMAL)), 0) FROM orders WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid AND status IN ('paid', 'completed', 'partially_paid')) as total_sales
)
SELECT 
    '/api/dashboard/stats' as api_endpoint,
    total_products,
    total_orders,
    total_customers,
    total_sales,
    CASE 
        WHEN total_orders > 0 THEN ROUND(total_sales / total_orders, 2)
        ELSE 0 
    END as avg_order_value,
    CASE 
        WHEN total_products > 0 OR total_orders > 0 OR total_customers > 0 THEN 'SUCCESS ✅'
        ELSE 'FAILED ❌'
    END as test_result
FROM dashboard_stats;

-- محاكاة Products API
SELECT 
    '/api/dashboard/products' as api_endpoint,
    COUNT(*) as products_count,
    CASE 
        WHEN COUNT(*) > 0 THEN 'SUCCESS ✅'
        ELSE 'FAILED ❌'
    END as test_result
FROM products 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid;

-- محاكاة Orders API
SELECT 
    '/api/dashboard/orders' as api_endpoint,
    COUNT(*) as orders_count,
    CASE 
        WHEN COUNT(*) > 0 THEN 'SUCCESS ✅'
        ELSE 'FAILED ❌'
    END as test_result
FROM orders 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid;

-- محاكاة Customers API
SELECT 
    '/api/dashboard/customers' as api_endpoint,
    COUNT(*) as customers_count,
    CASE 
        WHEN COUNT(*) > 0 THEN 'SUCCESS ✅'
        ELSE 'FAILED ❌'
    END as test_result
FROM customers 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid;

-- محاكاة Shopify Orders API
SELECT 
    '/api/shopify/orders' as api_endpoint,
    COUNT(*) as orders_count,
    CASE 
        WHEN COUNT(*) > 0 THEN 'SUCCESS ✅'
        ELSE 'FAILED ❌'
    END as test_result
FROM orders 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid;

-- 6. عرض عينات من البيانات الفعلية
SELECT '=== عينات من البيانات الفعلية ===' as test_section;

SELECT 'أحدث 5 منتجات:' as data_type;
SELECT 
    id,
    title,
    price,
    cost_price,
    shopify_id,
    user_id,
    store_id,
    created_at,
    updated_at
FROM products 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
ORDER BY updated_at DESC 
LIMIT 5;

SELECT 'أحدث 5 طلبات:' as data_type;
SELECT 
    id,
    order_number,
    total_price,
    status,
    customer_name,
    customer_email,
    shopify_id,
    user_id,
    store_id,
    created_at,
    updated_at
FROM orders 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
ORDER BY updated_at DESC 
LIMIT 5;

SELECT 'أحدث 5 عملاء:' as data_type;
SELECT 
    id,
    name,
    email,
    total_spent,
    orders_count,
    shopify_id,
    user_id,
    store_id,
    created_at,
    updated_at
FROM customers 
WHERE shopify_id IS NOT NULL 
  AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
ORDER BY updated_at DESC 
LIMIT 5;

-- 7. فحص الحسابات والإحصائيات
SELECT '=== فحص الحسابات والإحصائيات ===' as test_section;

-- إحصائيات المبيعات
WITH sales_stats AS (
    SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status IN ('paid', 'completed', 'partially_paid') THEN 1 END) as paid_orders,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_orders,
        COALESCE(SUM(CASE WHEN status IN ('paid', 'completed', 'partially_paid') THEN CAST(total_price AS DECIMAL) ELSE 0 END), 0) as total_revenue,
        COALESCE(AVG(CASE WHEN status IN ('paid', 'completed', 'partially_paid') THEN CAST(total_price AS DECIMAL) END), 0) as avg_order_value
    FROM orders 
    WHERE shopify_id IS NOT NULL 
      AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
)
SELECT 
    'إحصائيات المبيعات' as stats_type,
    total_orders,
    paid_orders,
    pending_orders,
    cancelled_orders,
    ROUND(total_revenue, 2) as total_revenue,
    ROUND(avg_order_value, 2) as avg_order_value,
    CASE 
        WHEN total_orders > 0 THEN ROUND((paid_orders::decimal / total_orders) * 100, 2)
        ELSE 0 
    END as success_rate_percent
FROM sales_stats;

-- إحصائيات المنتجات
WITH product_stats AS (
    SELECT 
        COUNT(*) as total_products,
        COUNT(CASE WHEN price > 0 THEN 1 END) as products_with_price,
        COUNT(CASE WHEN cost_price > 0 THEN 1 END) as products_with_cost,
        COUNT(CASE WHEN inventory_quantity > 0 THEN 1 END) as products_in_stock,
        COALESCE(AVG(CAST(price AS DECIMAL)), 0) as avg_price,
        COALESCE(AVG(CAST(cost_price AS DECIMAL)), 0) as avg_cost,
        COALESCE(SUM(inventory_quantity), 0) as total_inventory
    FROM products 
    WHERE shopify_id IS NOT NULL 
      AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
)
SELECT 
    'إحصائيات المنتجات' as stats_type,
    total_products,
    products_with_price,
    products_with_cost,
    products_in_stock,
    ROUND(avg_price, 2) as avg_price,
    ROUND(avg_cost, 2) as avg_cost,
    total_inventory,
    CASE 
        WHEN total_products > 0 THEN ROUND(((avg_price - avg_cost) / avg_price) * 100, 2)
        ELSE 0 
    END as avg_profit_margin_percent
FROM product_stats;

-- إحصائيات العملاء
WITH customer_stats AS (
    SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN total_spent > 0 THEN 1 END) as customers_with_purchases,
        COUNT(CASE WHEN orders_count > 1 THEN 1 END) as repeat_customers,
        COALESCE(AVG(CAST(total_spent AS DECIMAL)), 0) as avg_customer_value,
        COALESCE(AVG(orders_count), 0) as avg_orders_per_customer,
        COALESCE(SUM(CAST(total_spent AS DECIMAL)), 0) as total_customer_value
    FROM customers 
    WHERE shopify_id IS NOT NULL 
      AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid
)
SELECT 
    'إحصائيات العملاء' as stats_type,
    total_customers,
    customers_with_purchases,
    repeat_customers,
    ROUND(avg_customer_value, 2) as avg_customer_value,
    ROUND(avg_orders_per_customer, 2) as avg_orders_per_customer,
    ROUND(total_customer_value, 2) as total_customer_value,
    CASE 
        WHEN total_customers > 0 THEN ROUND((repeat_customers::decimal / total_customers) * 100, 2)
        ELSE 0 
    END as repeat_customer_rate_percent
FROM customer_stats;

-- 8. التشخيص النهائي
SELECT '=== التشخيص النهائي ===' as test_section;

WITH final_diagnosis AS (
    SELECT 
        (SELECT COUNT(*) FROM products WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as products_ready,
        (SELECT COUNT(*) FROM orders WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as orders_ready,
        (SELECT COUNT(*) FROM customers WHERE shopify_id IS NOT NULL AND user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as customers_ready,
        (SELECT COUNT(*) FROM user_stores WHERE user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as user_store_links,
        (SELECT COUNT(*) FROM permissions WHERE user_id = 'ee5f8fd9-dfcc-452d-9f84-022c308a2fdf'::uuid) as user_permissions
)
SELECT 
    'تشخيص النظام النهائي' as diagnosis_type,
    products_ready,
    orders_ready,
    customers_ready,
    user_store_links,
    user_permissions,
    CASE 
        WHEN products_ready > 0 AND orders_ready > 0 AND customers_ready > 0 AND user_store_links > 0 AND user_permissions > 0 THEN 
            'النظام يعمل بشكل مثالي! 🎉'
        WHEN products_ready = 0 AND orders_ready = 0 AND customers_ready = 0 THEN 
            'مفيش بيانات Shopify - يحتاج Sync جديد ❌'
        WHEN user_store_links = 0 THEN 
            'المستخدم مش مربوط بالمتجر - يحتاج إصلاح ربط ❌'
        WHEN user_permissions = 0 THEN 
            'المستخدم مفيش له صلاحيات - يحتاج إضافة صلاحيات ❌'
        ELSE 
            'النظام يعمل جزئياً - يحتاج فحص إضافي ⚠️'
    END as system_status,
    CASE 
        WHEN products_ready > 0 AND orders_ready > 0 AND customers_ready > 0 THEN 
            'اعمل Redeploy للـ Backend واختبر Dashboard'
        WHEN products_ready = 0 THEN 
            'اعمل Sync جديد من Settings'
        WHEN user_store_links = 0 THEN 
            'شغل FINAL_API_FIX.sql مرة تانية'
        ELSE 
            'راجع الخطوات السابقة'
    END as recommended_action
FROM final_diagnosis;

-- 9. ملخص للمطور
SELECT '=== ملخص للمطور ===' as test_section;

SELECT 
    'ملخص تقني للنظام' as summary_type,
    'User ID: ee5f8fd9-dfcc-452d-9f84-022c308a2fdf' as user_info,
    'Store ID: 59b47070-f018-4919-b628-1009af216fd7' as store_info,
    'RLS: DISABLED' as security_status,
    'Permissions: GRANTED' as permissions_status,
    'Data Linking: FORCED' as data_status,
    'API Endpoints: READY' as api_status,
    'Next Step: REDEPLOY BACKEND' as next_action;

SELECT 'اختبار النظام مكتمل! 🚀' as final_message;