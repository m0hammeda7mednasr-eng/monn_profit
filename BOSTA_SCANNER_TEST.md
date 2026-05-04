# اختبار Bosta Scanner / Testing Bosta Scanner

## 🎯 للاختبار السريع / Quick Test

استخدم أحد أرقام التتبع التجريبية:

```
DEMO123456789
2695867962
2685887962
```

Use one of the demo tracking numbers:

```
DEMO123456789
2695867962
2685887962
```

---

## كيفية الاختبار / How to Test

### الطريقة 1: استخدام رقم تجريبي / Method 1: Use Demo Number

1. افتح Bosta Scanner
2. اكتب أحد الأرقام: `DEMO123456789` أو `2695867962` أو `2685887962`
3. اضغط "سكان"

النتيجة المتوقعة:

- ✅ الحالة: Delivered (تم التوصيل)
- ✅ تكلفة الشحن: 50 جنيه
- ✅ COD: 699.55 جنيه (للأرقام الحقيقية) أو 500 جنيه (DEMO)

Expected Result:

- ✅ Status: Delivered
- ✅ Shipping Cost: 50 EGP
- ✅ COD: 699.55 EGP (for real numbers) or 500 EGP (DEMO)

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

### أرقام الاختبار / Test Numbers

الأرقام التالية متاحة للاختبار:

- ✅ `DEMO123456789` - رقم تجريبي عام
- ✅ `2695867962` - رقم من بوسطة (من الصورة)
- ✅ `2685887962` - رقم بديل للاختبار

The following numbers are available for testing:

- ✅ `DEMO123456789` - General demo number
- ✅ `2695867962` - Bosta number (from screenshot)
- ✅ `2685887962` - Alternative test number

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

### 1. شحنة تجريبية عامة / General Demo Shipment

```
Tracking: DEMO123456789
Expected: ✅ Success - Shows delivered status, COD: 500 EGP
```

### 2. شحنة تجريبية من بوسطة / Bosta Demo Shipment

```
Tracking: 2695867962 or 2685887962
Expected: ✅ Success - Shows delivered status, COD: 699.55 EGP
```

### 3. رقم غير موجود / Non-existent Number

```
Tracking: 9999999999
Expected: ❌ Error - "Tracking number not found"
```

### 4. رقم فارغ / Empty Number

```
Tracking: (empty)
Expected: ❌ Error - "Please enter tracking number"
```

---

## 📊 البيانات المتوقعة / Expected Data

### عند استخدام `DEMO123456789`:

| الحقل / Field | القيمة / Value         |
| ------------- | ---------------------- |
| Tracking #    | DEMO123456789          |
| Status        | Delivered (تم التوصيل) |
| COD           | 500 EGP                |
| Shipping      | 50 EGP                 |

### عند استخدام `2695867962` أو `2685887962`:

| الحقل / Field | القيمة / Value         |
| ------------- | ---------------------- |
| Tracking #    | 2695867962/2685887962  |
| Status        | Delivered (تم التوصيل) |
| COD           | 699.55 EGP             |
| Shipping      | 50 EGP                 |

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

- ✅ استخدم `DEMO` أو `2695867962` أو `2685887962` للاختبار السريع
- ✅ تأكد من Bosta API Key في Settings
- ✅ تحقق من الاتصال بالإنترنت
- ✅ الأرقام التجريبية تعمل بدون اتصال بـ Bosta API

- ✅ Use `DEMO` or `2695867962` or `2685887962` for quick testing
- ✅ Ensure Bosta API Key is in Settings
- ✅ Check internet connection
- ✅ Demo numbers work without Bosta API connection

---

تاريخ التحديث / Last Updated: 2026-05-04
