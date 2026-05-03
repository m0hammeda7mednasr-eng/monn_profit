# اختبار Bosta Scanner / Testing Bosta Scanner

## 🎯 للاختبار السريع / Quick Test

استخدم رقم التتبع التجريبي:

```
DEMO123456789
```

Use the demo tracking number:

```
DEMO123456789
```

---

## كيفية الاختبار / How to Test

### الطريقة 1: استخدام رقم تجريبي / Method 1: Use Demo Number

1. افتح Bosta Scanner
2. اكتب: `DEMO123456789`
3. اضغط "سكان"

النتيجة المتوقعة:

- ✅ الحالة: Delivered (تم التوصيل)
- ✅ تكلفة الشحن: 50 جنيه
- ✅ COD: 500 جنيه

Expected Result:

- ✅ Status: Delivered
- ✅ Shipping Cost: 50 EGP
- ✅ COD: 500 EGP

---

### الطريقة 2: استخدام شحنة حقيقية / Method 2: Use Real Shipment

للاختبار بشحنة حقيقية من بوسطة:

1. **إنشاء شحنة في بوسطة:**
   - اذهب إلى Bosta Dashboard
   - أنشئ شحنة جديدة
   - احصل على tracking number

2. **استخدام الـ tracking number:**
   - افتح Bosta Scanner
   - اكتب الـ tracking number
   - اضغط "سكان"

To test with a real Bosta shipment:

1. **Create shipment in Bosta:**
   - Go to Bosta Dashboard
   - Create a new shipment
   - Get the tracking number

2. **Use the tracking number:**
   - Open Bosta Scanner
   - Enter the tracking number
   - Click "Scan"

---

## 🔍 التحقق من الشحنات الموجودة / Check Existing Shipments

### API Endpoint

```
GET /api/bosta/shipments
```

يرجع آخر 10 شحنات في النظام.
Returns the last 10 shipments in the system.

### Demo Endpoint

```
GET /api/bosta/demo-shipment
```

يرجع شحنة تجريبية للاختبار.
Returns a demo shipment for testing.

---

## ⚠️ ملاحظات مهمة / Important Notes

### الأرقام في الصورة / Numbers in Screenshot

الأرقام الموجودة في الصورة (مثل `2695687962`) هي:

- ❌ **ليست** tracking numbers من بوسطة
- ❌ **لن تعمل** في Bosta Scanner
- ✅ هي أرقام من نظام شحن آخر

The numbers in the screenshot (like `2695687962`) are:

- ❌ **NOT** Bosta tracking numbers
- ❌ **Will NOT work** in Bosta Scanner
- ✅ They are from a different shipping system

### Bosta Tracking Numbers

أرقام التتبع من بوسطة عادة:

- تبدأ بحروف وأرقام
- مثال: `BOS123456789`
- أو أرقام فقط من نظام بوسطة

Bosta tracking numbers usually:

- Start with letters and numbers
- Example: `BOS123456789`
- Or numbers only from Bosta system

---

## 🧪 سيناريوهات الاختبار / Test Scenarios

### 1. شحنة تجريبية / Demo Shipment

```
Tracking: DEMO123456789
Expected: ✅ Success - Shows delivered status
```

### 2. رقم غير موجود / Non-existent Number

```
Tracking: 9999999999
Expected: ❌ Error - "Tracking number not found"
```

### 3. رقم فارغ / Empty Number

```
Tracking: (empty)
Expected: ❌ Error - "Please enter tracking number"
```

---

## 📊 البيانات المتوقعة / Expected Data

عند استخدام `DEMO123456789`:

| الحقل / Field | القيمة / Value         |
| ------------- | ---------------------- |
| Tracking #    | DEMO123456789          |
| Status        | Delivered (تم التوصيل) |
| Order         | Unknown (غير معروف)    |
| Customer      | Unknown (غير معروف)    |
| Revenue       | 0 EGP                  |
| Cost          | 0 EGP                  |
| Shipping      | 50 EGP                 |
| Net Profit    | 0 EGP                  |
| Real Profit   | -50 EGP                |

---

## 🚀 الخطوات التالية / Next Steps

بعد الاختبار الناجح:

1. **إنشاء شحنات حقيقية:**
   - استخدم Bosta Dashboard
   - أنشئ شحنات لأوردرات حقيقية
   - احصل على tracking numbers صحيحة

2. **ربط الشحنات بالأوردرات:**
   - عند إنشاء شحنة من النظام
   - سيتم ربطها تلقائياً بالأوردر
   - سيظهر الربح الحقيقي بشكل صحيح

After successful testing:

1. **Create real shipments:**
   - Use Bosta Dashboard
   - Create shipments for real orders
   - Get valid tracking numbers

2. **Link shipments to orders:**
   - When creating shipment from the system
   - It will be automatically linked to the order
   - Real profit will be calculated correctly

---

## 💡 نصائح / Tips

- ✅ استخدم `DEMO` للاختبار السريع
- ✅ تأكد من Bosta API Key في Settings
- ✅ تحقق من الاتصال بالإنترنت
- ❌ لا تستخدم أرقام من أنظمة شحن أخرى

- ✅ Use `DEMO` for quick testing
- ✅ Ensure Bosta API Key is in Settings
- ✅ Check internet connection
- ❌ Don't use numbers from other shipping systems

---

تاريخ التحديث / Last Updated: 2026-05-04
