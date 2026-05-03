# تبسيط إعدادات بوسطة / Bosta Configuration Simplified

## التغييرات المطبقة / Changes Applied

تم تبسيط إعدادات بوسطة لتتطلب **API Key فقط** بدون الحاجة لـ:

- ❌ Business Location ID
- ❌ API Base URL

### الملفات المعدلة / Modified Files

#### 1. Frontend - Settings Page

**File:** `frontend/src/pages/Settings.jsx`

**التغييرات:**

- إزالة حقل Business Location ID
- إزالة حقل API Base URL
- الإعدادات الآن تحتاج API Key فقط

#### 2. Frontend - Bosta Shipping Component

**File:** `frontend/src/components/BostaShipping.jsx`

**التغييرات:**

- إزالة Business Location ID من خيارات الشحن
- تبسيط واجهة المستخدم

#### 3. Backend - Bosta Service

**File:** `backend/src/services/bostaService.js`

**التغييرات:**

- إزالة `defaultBusinessLocationId` من الـ constructor
- إزالة `businessLocationId` من payload الشحن
- إزالة `businessLocationId` من `convertShopifyOrderToBosta`
- إزالة `business_location_id` من `saveShipment`

#### 4. Backend - Bosta Routes

**File:** `backend/src/routes/bosta.js`

**التغييرات:**

- تبسيط `/config` GET endpoint - يرجع API key فقط
- تبسيط `/config` POST endpoint - يحفظ API key فقط
- إزالة `businessLocationId` من `/orders/:orderId/ship`

---

## كيفية الاستخدام / How to Use

### 1. إعداد بوسطة / Bosta Setup

1. اذهب إلى Settings
2. في قسم "Bosta Shipping"
3. أدخل الـ **Bosta API Key** فقط
4. اضغط "Save Configuration"
5. اضغط "Test Connection" للتأكد

### 2. شحن طلب / Ship an Order

عند شحن طلب مع بوسطة، ستحتاج فقط إلى:

- ✅ Package Type (نوع الطرد)
- ✅ Allow Open Package (السماح بفتح الطرد)
- ✅ Enable FlexShip (تفعيل FlexShip)

**لا تحتاج:**

- ❌ Business Location ID

---

## Environment Variables

الآن تحتاج فقط:

```env
BOSTA_API_KEY=your_api_key_here
```

**لم تعد بحاجة لـ:**

```env
# BOSTA_BUSINESS_LOCATION_ID=xxx  ❌ Not needed anymore
# BOSTA_API_BASE_URL=xxx          ❌ Not needed anymore
```

---

## API Changes

### GET /api/bosta/config

**قبل:**

```json
{
  "hasConfig": true,
  "apiKey": "********",
  "businessLocationId": "123",
  "apiBaseUrl": "https://app.bosta.co/api/v2"
}
```

**بعد:**

```json
{
  "hasConfig": true,
  "apiKey": "********"
}
```

### POST /api/bosta/config

**قبل:**

```json
{
  "apiKey": "xxx",
  "businessLocationId": "123",
  "apiBaseUrl": "https://app.bosta.co/api/v2"
}
```

**بعد:**

```json
{
  "apiKey": "xxx"
}
```

### POST /api/bosta/orders/:orderId/ship

**قبل:**

```json
{
  "businessLocationId": "123",
  "packageType": "SMALL",
  "allowOpenPackage": false,
  "flexShip": false
}
```

**بعد:**

```json
{
  "packageType": "SMALL",
  "allowOpenPackage": false,
  "flexShip": false
}
```

---

## ملاحظات / Notes

- ✅ جميع التغييرات متوافقة مع الإصدارات السابقة
- ✅ الـ API الخاص ببوسطة يستخدم الـ default base URL تلقائياً
- ✅ إذا كنت بحاجة لـ Business Location ID في المستقبل، يمكن إضافته بسهولة
- ✅ الكود أبسط وأسهل في الصيانة

---

تاريخ التطبيق: 2026-05-04
