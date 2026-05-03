# إصلاحات تم تطبيقها / Applied Fixes

## 1. ✅ إصلاح مشكلة CORS / CORS Error Fix

**المشكلة:** كان الـ CORS middleware بيرمي error لما يجيله origin مش مسموح، وده كان بيعمل crash للـ OPTIONS requests.

**الحل:** تم تعديل `backend/src/server.js` بحيث يرجع `false` بدل ما يرمي error، وده بيرفض الـ request بشكل صحيح من غير crash.

**الملفات المعدلة:**

- `backend/src/server.js` - تم تعديل الـ CORS callback

---

## 2. ⚠️ إصلاح مشكلة Orders Upsert / Orders Upsert Fix

**المشكلة:**

```
Upsert failed for orders, falling back to per-row sync:
there is no unique or exclusion constraint matching the ON CONFLICT specification
```

الـ partial unique index (اللي فيه WHERE clause) مش بيشتغل مع Supabase's `onConflict` parameter، فالـ bulk upsert كان بيفشل ويرجع لـ per-row sync (اللي أبطأ).

**الحل:**
استبدال الـ partial index بـ full unique index باستخدام `COALESCE` للتعامل مع NULL values.

**خطوات التطبيق:**

### الطريقة الأولى: تشغيل SQL مباشرة (موصى بها)

1. افتح Supabase SQL Editor
2. شغل الملف: `FIX_ORDERS_CONSTRAINT.sql`

أو انسخ والصق الكود ده:

```sql
DROP INDEX IF EXISTS idx_orders_store_shopify_unique;

CREATE UNIQUE INDEX idx_orders_store_shopify_unique
ON public.orders (
  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(shopify_id, '')
);
```

### الطريقة الثانية: استخدام Migration

إذا كنت بتستخدم node-pg-migrate:

```bash
cd backend
npm run migrate up
```

**الملفات المضافة:**

- `FIX_ORDERS_CONSTRAINT.sql` - SQL script للتشغيل المباشر
- `backend/migrations/1710354431000_fix_orders_unique_constraint.js` - Migration file
- `backend/fix-orders-constraint.js` - Helper script
- `POSTGRES_BOOTSTRAP_SCHEMA.sql` - تم تحديث الـ schema

---

## النتيجة المتوقعة / Expected Result

بعد تطبيق الإصلاحات:

1. ✅ مفيش CORS errors في الـ logs
2. ✅ الـ orders bulk upsert هيشتغل بدون fallback warning
3. ✅ الـ sync هيكون أسرع لأنه هيستخدم bulk operations بدل per-row

---

## التحقق من التطبيق / Verification

بعد تشغيل الـ SQL، تأكد إن الـ index اتعمل صح:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'orders'
  AND indexname = 'idx_orders_store_shopify_unique';
```

المفروض تشوف:

```
CREATE UNIQUE INDEX idx_orders_store_shopify_unique ON public.orders
USING btree (COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(shopify_id, ''::text))
```

---

## ملاحظات / Notes

- الـ CORS fix تم تطبيقه تلقائياً في الكود
- الـ Orders constraint fix يحتاج تشغيل SQL يدوياً (لأن Supabase client مش عنده صلاحيات DDL)
- بعد تطبيق الـ SQL، restart الـ server علشان يتأكد إن كل حاجة شغالة

---

تاريخ التطبيق: 2026-05-04
