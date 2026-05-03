# دليل استخدام Bosta Scanner / Bosta Scanner Guide

## نظرة عامة / Overview

Bosta Scanner هو أداة لمسح أرقام التتبع (Tracking Numbers) من بوسطة وحساب صافي الربح الحقيقي بعد خصم تكلفة الشحن.

Bosta Scanner is a tool to scan Bosta tracking numbers and calculate real net profit after deducting shipping costs.

---

## كيفية الاستخدام / How to Use

### 1. التأكد من إعداد بوسطة / Ensure Bosta is Configured

قبل استخدام الـ Scanner، تأكد من:

- إعداد Bosta API Key في Settings
- اختبار الاتصال بنجاح

Before using the Scanner, make sure:

- Bosta API Key is configured in Settings
- Connection test is successful

### 2. الحصول على رقم التتبع / Get Tracking Number

رقم التتبع يمكن الحصول عليه من:

- ✅ بوسطة مباشرة (Bosta Dashboard)
- ✅ إيميل التأكيد من بوسطة
- ✅ SMS من بوسطة
- ✅ الباركود على الشحنة

Tracking number can be obtained from:

- ✅ Bosta Dashboard
- ✅ Bosta confirmation email
- ✅ Bosta SMS
- ✅ Barcode on the shipment

### 3. مسح رقم التتبع / Scan Tracking Number

1. افتح صفحة "Bosta Scanner" من القائمة الجانبية
2. اكتب أو امسح رقم التتبع في الحقل
3. اضغط "سكان" / "Scan"

4. Open "Bosta Scanner" page from sidebar
5. Type or scan the tracking number in the field
6. Click "Scan"

---

## ما الذي يحدث؟ / What Happens?

### الخطوة 1: جلب بيانات الشحنة / Step 1: Fetch Shipment Data

النظام يبحث عن الشحنة في:

1. **قاعدة البيانات المحلية** - الشحنات التي تم إنشاؤها من النظام
2. **Bosta API** - إذا لم تكن موجودة محلياً

The system searches for the shipment in:

1. **Local Database** - Shipments created from the system
2. **Bosta API** - If not found locally

### الخطوة 2: جلب بيانات الأوردر / Step 2: Fetch Order Data

إذا كانت الشحنة مرتبطة بأوردر في النظام:

- يجلب تفاصيل الأوردر
- يحسب التكلفة الإجمالية للمنتجات
- يحسب الإيرادات

If the shipment is linked to an order in the system:

- Fetches order details
- Calculates total product cost
- Calculates revenue

### الخطوة 3: حساب الأرباح / Step 3: Calculate Profits

```
الإيرادات (Revenue) = سعر الأوردر الكلي
التكلفة (Cost) = مجموع تكلفة المنتجات
تكلفة الشحن (Shipping Cost) = التكلفة المتوقعة من بوسطة

صافي الربح (Net Profit) = الإيرادات - التكلفة
الربح الحقيقي (Real Net Profit) = صافي الربح - تكلفة الشحن
```

---

## الأعمدة في الجدول / Table Columns

| العمود / Column                 | الوصف / Description                      |
| ------------------------------- | ---------------------------------------- |
| **رقم التتبع / Tracking #**     | رقم التتبع من بوسطة                      |
| **الحالة / Status**             | حالة الشحنة (تم التوصيل، في الطريق، إلخ) |
| **الأوردر / Order**             | رقم الأوردر المرتبط                      |
| **العميل / Customer**           | اسم العميل                               |
| **الإيرادات / Revenue**         | إجمالي سعر الأوردر                       |
| **التكلفة / Cost**              | تكلفة المنتجات                           |
| **الشحن / Shipping**            | تكلفة الشحن من بوسطة                     |
| **صافي الربح / Net Profit**     | الربح قبل خصم الشحن                      |
| **الربح الحقيقي / Real Profit** | الربح بعد خصم الشحن                      |

---

## حالات الشحنة / Shipment States

| الحالة / State       | اللون / Color    | الوصف / Description |
| -------------------- | ---------------- | ------------------- |
| **Delivered**        | 🟢 أخضر / Green  | تم التوصيل بنجاح    |
| **Out for Delivery** | 🔵 أزرق / Blue   | في الطريق للتوصيل   |
| **Exception**        | 🔴 أحمر / Red    | مشكلة في التوصيل    |
| **Cancelled**        | ⚪ رمادي / Gray  | تم الإلغاء          |
| **Other**            | 🟡 أصفر / Yellow | حالات أخرى          |

---

## الأخطاء الشائعة / Common Errors

### ❌ "Tracking number not found"

**السبب / Cause:**

- رقم التتبع غير صحيح
- الشحنة غير موجودة في نظام بوسطة

**الحل / Solution:**

- تأكد من رقم التتبع
- تحقق من بوسطة Dashboard

### ❌ "Bosta service not configured"

**السبب / Cause:**

- لم يتم إعداد Bosta API Key

**الحل / Solution:**

- اذهب إلى Settings
- أضف Bosta API Key
- اختبر الاتصال

### ❌ "Failed to fetch shipment data"

**السبب / Cause:**

- مشكلة في الاتصال بالإنترنت
- مشكلة في Bosta API

**الحل / Solution:**

- تحقق من الاتصال بالإنترنت
- حاول مرة أخرى بعد قليل

---

## نصائح / Tips

### ✅ للحصول على أفضل النتائج / For Best Results

1. **استخدم الباركود Scanner** - أسرع وأدق
2. **تأكد من تكلفة المنتجات** - لحساب دقيق للربح
3. **حدث تكلفة الشحن** - في إعدادات الشحنة إذا تغيرت

### ✅ للشحنات بدون أوردر / For Shipments Without Orders

إذا كانت الشحنة غير مرتبطة بأوردر في النظام:

- سيظهر "غير معروف" في الأوردر والعميل
- الإيرادات والتكلفة ستكون 0
- يمكنك رؤية حالة الشحنة فقط

If the shipment is not linked to an order:

- "Unknown" will show for order and customer
- Revenue and cost will be 0
- You can only see shipment status

---

## مثال عملي / Practical Example

### السيناريو / Scenario

- أوردر بقيمة 500 جنيه
- تكلفة المنتجات: 300 جنيه
- تكلفة الشحن من بوسطة: 50 جنيه

### الحسابات / Calculations

```
الإيرادات = 500 جنيه
التكلفة = 300 جنيه
صافي الربح = 500 - 300 = 200 جنيه
الربح الحقيقي = 200 - 50 = 150 جنيه ✅
```

---

## الدعم / Support

إذا واجهت أي مشاكل:

1. تحقق من الـ Console في المتصفح (F12)
2. تأكد من إعدادات بوسطة
3. جرب tracking number آخر

If you face any issues:

1. Check browser Console (F12)
2. Verify Bosta settings
3. Try another tracking number

---

تاريخ التحديث / Last Updated: 2026-05-04
