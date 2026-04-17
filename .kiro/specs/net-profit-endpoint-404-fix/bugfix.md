# Bugfix Requirements Document

## Introduction

صفحة صافي الربح (NetProfit page) تعرض خطأ 404 عند محاولة تحميل المصاريف التشغيلية. المشكلة تحدث لأن الصفحة تستخدم `axios` مباشرة بدلاً من استخدام الـ `api` instance المُعد مسبقاً والذي يحتوي على الـ baseURL الصحيح للـ Backend (`http://localhost:5000/api`). هذا يؤدي إلى إرسال الطلبات إلى Frontend port (3000) بدلاً من Backend port (5000).

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN المستخدم يفتح صفحة صافي الربح (`/net-profit`) THEN النظام يرسل GET request إلى `http://localhost:3000/api/operational-costs` (Frontend port) بدلاً من Backend port

1.2 WHEN النظام يحاول تحميل المصاريف التشغيلية THEN يظهر خطأ 404 في Console: `GET http://localhost:3000/api/operational-costs 404 (Not Found)`

1.3 WHEN الصفحة تحاول عرض البيانات THEN تظهر رسالة خطأ: `Error fetching operational costs: AxiosError: Request failed with status code 404`

1.4 WHEN المستخدم يحاول إضافة أو تعديل أو حذف مصروف تشغيلي THEN جميع العمليات تفشل بنفس خطأ 404

### Expected Behavior (Correct)

2.1 WHEN المستخدم يفتح صفحة صافي الربح THEN النظام SHALL يرسل GET request إلى `http://localhost:5000/api/operational-costs` (Backend port الصحيح)

2.2 WHEN النظام يحمل المصاريف التشغيلية بنجاح THEN النظام SHALL يعرض قائمة المصاريف التشغيلية للمستخدم

2.3 WHEN المستخدم يضيف مصروف تشغيلي جديد THEN النظام SHALL يرسل POST request إلى Backend الصحيح ويحفظ البيانات

2.4 WHEN المستخدم يعدل أو يحذف مصروف THEN النظام SHALL يرسل PUT/DELETE request إلى Backend الصحيح وينفذ العملية

### Unchanged Behavior (Regression Prevention)

3.1 WHEN المستخدم يستخدم أي صفحة أخرى في التطبيق (Dashboard, Orders, Products, إلخ) THEN النظام SHALL CONTINUE TO يعمل بشكل طبيعي دون أي تأثير

3.2 WHEN النظام يحمل بيانات المنتجات في صفحة صافي الربح THEN النظام SHALL CONTINUE TO يستخدم endpoint `/api/dashboard/products` بشكل صحيح

3.3 WHEN المستخدم يقوم بتسجيل الدخول أو استخدام أي API endpoint آخر THEN النظام SHALL CONTINUE TO يستخدم الـ baseURL الصحيح من `api.js`

3.4 WHEN النظام يتعامل مع authentication tokens THEN النظام SHALL CONTINUE TO يضيف Authorization header بشكل صحيح
