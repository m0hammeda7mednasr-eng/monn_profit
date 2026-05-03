# Bosta Shipping Integration

تم تطوير تكامل شامل مع API شركة بوسطة للشحن في مصر. هذا التكامل يوفر إدارة كاملة لعمليات الشحن من إنشاء الشحنات إلى تتبع حالتها.

## المميزات الرئيسية

### 1. إدارة الشحنات

- إنشاء شحنات فردية أو متعددة
- دعم جميع أنواع الطلبات (توصيل عادي، تحصيل نقدي، استبدال، إرجاع)
- تحويل تلقائي من طلبات Shopify إلى تنسيق Bosta
- حفظ بيانات الشحنة في قاعدة البيانات المحلية

### 2. تتبع الشحنات

- تحديث تلقائي لحالة الشحنة عبر Webhooks
- عرض تفاصيل الشحنة والحالة الحالية
- تسجيل محاولات التوصيل والاستثناءات
- تتبع المبالغ المحصلة (COD)

### 3. إدارة العناوين

- جلب قائمة المدن والمناطق والأحياء من Bosta
- تنسيق العناوين تلقائياً حسب متطلبات Bosta
- دعم العناوين باللغة العربية

### 4. التسعير والخيارات

- حساب تكلفة الشحن
- خيارات الطرد (صغير، متوسط، كبير، إلخ)
- إعدادات FlexShip و Allow Open Package
- دعم مواقع العمل المتعددة

## الملفات المضافة

### Backend Files

#### Services

- `backend/src/services/bostaService.js` - الخدمة الرئيسية للتكامل مع Bosta API
- `backend/src/services/bostaService.test.js` - اختبارات الوحدة للخدمة

#### Routes

- `backend/src/routes/bosta.js` - API endpoints للتكامل مع Bosta

#### Migrations

- `backend/migrations/1710354430000_add_bosta_shipments_table.js` - إنشاء جداول قاعدة البيانات

### Frontend Files

#### Components

- `frontend/src/components/BostaShipping.jsx` - مكون React لإدارة الشحن

#### Utilities

- `frontend/src/utils/bostaApi.js` - دوال مساعدة للتكامل مع Bosta API

## إعداد البيئة

أضف المتغيرات التالية إلى ملف `.env`:

```env
# Bosta Shipping Integration
BOSTA_API_KEY=your_bosta_api_key
BOSTA_API_BASE_URL=https://app.bosta.co/api/v2
BOSTA_BUSINESS_LOCATION_ID=your_default_business_location_id
```

## قاعدة البيانات

### جدول bosta_shipments

يحتوي على معلومات الشحنات:

- معلومات الطلب والتتبع
- حالة الشحنة ومحاولات التوصيل
- بيانات العنوان والتسعير
- استجابات Bosta API والـ webhooks

### جدول bosta_webhook_logs

يسجل جميع الـ webhooks الواردة من Bosta لأغراض التشخيص.

## API Endpoints

### إدارة الشحنات

- `POST /api/bosta/deliveries` - إنشاء شحنة واحدة
- `POST /api/bosta/deliveries/bulk` - إنشاء شحنات متعددة
- `GET /api/bosta/deliveries/:trackingNumber` - جلب حالة الشحنة
- `POST /api/bosta/deliveries/:trackingNumber/cancel` - إلغاء الشحنة

### إدارة الطلبات

- `POST /api/bosta/orders/:orderId/ship` - شحن طلب Shopify مع Bosta

### البيانات المرجعية

- `GET /api/bosta/cities` - جلب قائمة المدن
- `GET /api/bosta/cities/:cityId/zones` - جلب مناطق المدينة
- `GET /api/bosta/zones/:zoneId/districts` - جلب أحياء المنطقة
- `POST /api/bosta/pricing` - حساب تكلفة الشحن

### Webhooks

- `POST /api/bosta/webhook` - استقبال تحديثات حالة الشحنة

## استخدام المكونات

### مكون BostaShipping

```jsx
import BostaShipping from "../components/BostaShipping";

function OrderDetails({ order, onOrderUpdate }) {
  return (
    <div>
      {/* معلومات الطلب الأخرى */}

      <BostaShipping
        order={order}
        onOrderUpdate={onOrderUpdate}
        language="ar"
      />
    </div>
  );
}
```

### استخدام API utilities

```javascript
import {
  shipOrderWithBosta,
  fetchDeliveryStatus,
  isEligibleForBostaShipping,
} from "../utils/bostaApi";

// فحص إمكانية الشحن
if (isEligibleForBostaShipping(order)) {
  // شحن الطلب
  const result = await shipOrderWithBosta(order.id, {
    packageType: "SMALL",
    allowOpenPackage: false,
    flexShip: true,
  });

  // تتبع الشحنة
  const status = await fetchDeliveryStatus(result.trackingNumber);
}
```

## أنواع الطلبات المدعومة

### 1. التوصيل العادي (DELIVER - 10)

للطلبات المدفوعة مسبقاً عبر الإنترنت.

### 2. التحصيل النقدي (CASH_COLLECTION - 15)

للطلبات التي يتم دفعها عند الاستلام.

### 3. الاستبدال (EXCHANGE - 30)

لاستبدال منتج بآخر.

### 4. إرجاع العميل (CRP - 25)

لاستلام مرتجعات من العملاء.

## حالات الشحنة

- **في الانتظار (0)** - تم إنشاء الشحنة
- **تم الاستلام (10)** - تم استلام الطرد من التاجر
- **في الطريق (20)** - الطرد في طريقه للعميل
- **خرج للتوصيل (30)** - المندوب في طريقه للعميل
- **تم التوصيل (40)** - تم تسليم الطرد بنجاح
- **مشكلة في التوصيل (47)** - حدثت مشكلة في التوصيل
- **ملغي (50)** - تم إلغاء الشحنة
- **مرتجع (60)** - تم إرجاع الطرد للتاجر

## الأمان والصلاحيات

### Row Level Security (RLS)

- المستخدمون يمكنهم رؤية شحنات طلباتهم فقط
- سجلات الـ webhooks متاحة للمديرين فقط

### الصلاحيات المطلوبة

- `can_view_orders` - لعرض حالة الشحنات
- `can_edit_orders` - لإنشاء وإلغاء الشحنات

## معالجة الأخطاء

### أخطاء شائعة من Bosta API

- **3001** - المدينة غير موجودة
- **3002** - المنطقة غير موجودة
- **3003** - الحي غير موجود
- **3006** - مبلغ التحصيل مطلوب للطلبات النقدية
- **3007** - مبلغ التحصيل يجب أن يكون أقل من 30,000 جنيه

### معالجة الأخطاء في الكود

```javascript
try {
  const delivery = await bostaService.createDelivery(orderData);
} catch (error) {
  if (error.message.includes("3001")) {
    // معالجة خطأ المدينة غير الموجودة
  } else if (error.message.includes("3007")) {
    // معالجة خطأ تجاوز حد التحصيل
  }
}
```

## التشخيص والمراقبة

### Activity Logs

جميع العمليات يتم تسجيلها في `activity_log`:

- إنشاء الشحنات
- تحديث الحالة
- إلغاء الشحنات
- معالجة الـ webhooks

### Webhook Logs

جميع الـ webhooks الواردة يتم حفظها في `bosta_webhook_logs` مع:

- البيانات المستلمة
- حالة المعالجة
- أي أخطاء حدثت

## الاختبارات

تشغيل اختبارات Bosta service:

```bash
cd backend
npm test -- bostaService.test.js
```

## التطوير المستقبلي

### مميزات مقترحة

1. **تكامل مع المخازن** - ربط مع خدمة الـ fulfillment
2. **تقارير الشحن** - إحصائيات مفصلة عن الشحنات
3. **إشعارات العملاء** - إرسال SMS/Email للعملاء
4. **تحسين التسعير** - مقارنة أسعار مع شركات شحن أخرى
5. **جدولة الاستلام** - حجز مواعيد استلام تلقائية

### تحسينات تقنية

1. **Retry Logic** - إعادة المحاولة للطلبات الفاشلة
2. **Rate Limiting** - تحديد معدل الطلبات لـ API
3. **Caching** - تخزين مؤقت للمدن والمناطق
4. **Bulk Operations** - عمليات مجمعة للشحنات الكبيرة

## الدعم الفني

للمساعدة في التكامل مع Bosta:

- **التوثيق الرسمي**: https://docs.bosta.co/
- **الدعم الفني**: techsupport@bosta.co
- **خدمة العملاء**: support@bosta.co

## الخلاصة

تم تطوير تكامل شامل ومتكامل مع Bosta يوفر:

- ✅ إدارة كاملة للشحنات
- ✅ تتبع تلقائي للحالة
- ✅ واجهة مستخدم سهلة الاستخدام
- ✅ أمان وصلاحيات محكمة
- ✅ معالجة شاملة للأخطاء
- ✅ تسجيل ومراقبة العمليات
- ✅ اختبارات شاملة

التكامل جاهز للاستخدام في الإنتاج ويدعم جميع احتياجات الشحن للمتاجر الإلكترونية في مصر.
