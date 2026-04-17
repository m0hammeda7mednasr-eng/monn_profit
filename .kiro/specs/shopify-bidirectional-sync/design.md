# وثيقة التصميم التقني: نظام المزامنة الثنائية مع Shopify

## نظرة عامة

نظام المزامنة الثنائية مع Shopify هو نظام متكامل يتيح التعديل على المنتجات والطلبات مع مزامنة فورية ثنائية الاتجاه مع Shopify. يدعم النظام تعديل الأسعار والمخزون، إدارة الطلبات والتعليقات، والمزامنة التلقائية للتحديثات من وإلى Shopify باستخدام Webhooks وآليات حل التعارضات.

النظام مبني على معمارية ثلاثية الطبقات (Backend: Node.js + Express، Frontend: React، Database: Supabase PostgreSQL) مع دعم للعمليات الفورية (real-time) وشبه الفورية باستخدام Shopify Admin REST API و Webhooks.

## المعمارية العامة

```mermaid
graph TB
    subgraph "Frontend Layer"
        UI[React UI Components]
        OptimisticUI[Optimistic UI Updates]
        StateManager[State Management]
    end

    subgraph "Backend Layer"
        API[Express API Server]
        SyncService[Sync Service]
        WebhookHandler[Webhook Handler]
        ConflictResolver[Conflict Resolver]
        RateLimiter[Rate Limiter]
    end

    subgraph "Data Layer"
        DB[(Supabase PostgreSQL)]
        SyncLog[Sync Operations Log]
        ConflictQueue[Conflict Resolution Queue]
    end

    subgraph "External Services"
        ShopifyAPI[Shopify Admin REST API]
        ShopifyWebhooks[Shopify Webhooks]
    end

    UI --> API
    OptimisticUI --> StateManager
    StateManager --> UI

    API --> SyncService
    API --> WebhookHandler
    SyncService --> RateLimiter
    RateLimiter --> ShopifyAPI
    WebhookHandler --> ConflictResolver
    ConflictResolver --> ConflictQueue

    SyncService --> DB
    WebhookHandler --> DB
    ConflictResolver --> DB
    SyncService --> SyncLog
```

    ShopifyAPI --> ShopifyWebhooks
    ShopifyWebhooks --> WebhookHandler

````

## مخططات التسلسل الرئيسية

### 1. تدفق تعديل المنتج (Product Update Flow)

```mermaid
sequenceDiagram
    participant User as المستخدم
    participant UI as واجهة المستخدم
    participant API as Backend API
    participant DB as قاعدة البيانات
    participant RateLimiter as Rate Limiter
    participant Shopify as Shopify API
    participant SyncLog as سجل المزامنة

    User->>UI: تعديل السعر/المخزون
    UI->>UI: Optimistic Update (عرض فوري)
    UI->>API: POST /api/products/:id/update

    API->>DB: حفظ التعديل مع pending_sync=true
    API->>DB: إنشاء سجل في sync_operations
    API-->>UI: تأكيد الحفظ المحلي

    API->>RateLimiter: طلب إرسال التحديث
    RateLimiter->>Shopify: PUT /admin/api/2024-01/products/:id.json

    alt نجاح المزامنة
        Shopify-->>RateLimiter: 200 OK
        RateLimiter-->>API: نجح التحديث
        API->>DB: تحديث pending_sync=false
        API->>SyncLog: تسجيل نجاح العملية
        API-->>UI: تأكيد المزامنة
        UI->>UI: تحديث الحالة النهائية
    else فشل المزامنة
        Shopify-->>RateLimiter: 4xx/5xx Error
        RateLimiter-->>API: فشل التحديث
        API->>DB: تحديث sync_error مع رسالة الخطأ
        API->>SyncLog: تسجيل الفشل
        API-->>UI: إشعار بالفشل
        UI->>UI: Rollback للقيمة الأصلية
        UI->>User: عرض رسالة الخطأ
    end
````

````

### 2. تدفق استقبال Webhook من Shopify

```mermaid
sequenceDiagram
    participant Shopify as Shopify
    participant Webhook as Webhook Handler
    participant Validator as HMAC Validator
    participant ConflictResolver as Conflict Resolver
    participant DB as قاعدة البيانات
    participant SyncLog as سجل المزامنة
    participant UI as واجهة المستخدم

    Shopify->>Webhook: POST /api/webhooks/products/update
    Webhook->>Validator: التحقق من HMAC Signature

    alt توقيع صحيح
        Validator-->>Webhook: توقيع صالح
        Webhook->>DB: جلب البيانات الحالية
        Webhook->>ConflictResolver: فحص التعارضات

        alt لا يوجد تعارض
            ConflictResolver-->>Webhook: لا يوجد تعارض
            Webhook->>DB: تحديث البيانات
            Webhook->>SyncLog: تسجيل التحديث من Shopify
            Webhook-->>Shopify: 200 OK
            Webhook->>UI: إرسال تحديث real-time (WebSocket)
        else يوجد تعارض
            ConflictResolver-->>Webhook: تعارض مكتشف
            ConflictResolver->>DB: حفظ في conflict_queue
            Webhook->>SyncLog: تسجيل التعارض
            Webhook-->>Shopify: 200 OK (تأكيد الاستلام)
            ConflictResolver->>ConflictResolver: تطبيق استراتيجية الحل
        end
    else توقيع غير صحيح
        Validator-->>Webhook: توقيع غير صالح
        Webhook->>SyncLog: تسجيل محاولة غير مصرح بها
        Webhook-->>Shopify: 401 Unauthorized
    end
````

### 3. تدفق تعديل الطلب (Order Update Flow)

```mermaid
sequenceDiagram
    participant User as المستخدم
    participant UI as واجهة المستخدم
    participant API as Backend API
    participant DB as قاعدة البيانات
    participant Shopify as Shopify API
    participant SyncLog as سجل المزامنة

    User->>UI: تغيير حالة الطلب / إضافة تعليق
    UI->>API: POST /api/orders/:id/update

    API->>DB: حفظ التعديل محلياً
    API->>Shopify: PUT /admin/api/2024-01/orders/:id.json

    alt نجاح التحديث
        Shopify-->>API: 200 OK
        API->>DB: تأكيد المزامنة
        API->>SyncLog: تسجيل النجاح
        API-->>UI: تأكيد التحديث
    else فشل التحديث
        Shopify-->>API: Error
        API->>DB: تسجيل الخطأ
        API->>SyncLog: تسجيل الفشل
        API-->>UI: رسالة خطأ
    end
```

### 4. تدفق معالجة Refund والإرجاع التلقائي للمخزون

```mermaid
sequenceDiagram
    participant Shopify as Shopify
    participant Webhook as Webhook Handler
    participant RefundProcessor as Refund Processor
    participant DB as قاعدة البيانات
    participant InventoryService as Inventory Service
    participant SyncLog as سجل المزامنة

    Shopify->>Webhook: POST /api/webhooks/refunds/create
    Webhook->>RefundProcessor: معالجة الاسترجاع
    RefundProcessor->>DB: جلب تفاصيل الطلب والمنتجات

    loop لكل منتج في الطلب المسترجع
        RefundProcessor->>InventoryService: حساب الكمية المسترجعة
        InventoryService->>DB: تحديث inventory_quantity
        InventoryService->>SyncLog: تسجيل تحديث المخزون
    end

    RefundProcessor->>DB: تحديث حالة الطلب
    RefundProcessor-->>Webhook: اكتمال المعالجة
    Webhook-->>Shopify: 200 OK
```

## المكونات والواجهات

### 1. Product Update Service

**الغرض**: إدارة تحديثات المنتجات والمزامنة مع Shopify

**الواجهة**:

```typescript
interface ProductUpdateService {
  updateProduct(
    userId: string,
    productId: string,
    updates: ProductUpdates,
  ): Promise<UpdateResult>;
  updatePrice(
    userId: string,
    productId: string,
    newPrice: number,
  ): Promise<UpdateResult>;
  updateInventory(
    userId: string,
    productId: string,
    newQuantity: number,
  ): Promise<UpdateResult>;
  syncToShopify(userId: string, productId: string): Promise<SyncResult>;
  handleShopifyUpdate(webhookData: ShopifyWebhookPayload): Promise<void>;
}

interface ProductUpdates {
  price?: number;
  inventory_quantity?: number;
  title?: string;
  description?: string;
}

interface UpdateResult {
  success: boolean;
  localUpdate: boolean;
  shopifySync: boolean;
  error?: string;
  conflictDetected?: boolean;
}

interface SyncResult {
  success: boolean;
  syncedAt: Date;
  shopifyResponse?: any;
  error?: string;
}
```

**المسؤوليات**:

- تطبيق التحديثات المحلية على قاعدة البيانات
- إرسال التحديثات إلى Shopify مع مراعاة Rate Limiting
- معالجة Webhooks الواردة من Shopify
- كشف وحل التعارضات
- تسجيل جميع العمليات في Audit Log

### 2. Order Management Service

**الغرض**: إدارة الطلبات والتعليقات والحالات

**الواجهة**:

```typescript
interface OrderManagementService {
  getOrderDetails(userId: string, orderId: string): Promise<OrderDetails>;
  updateOrderStatus(
    userId: string,
    orderId: string,
    newStatus: OrderStatus,
  ): Promise<UpdateResult>;
  addOrderNote(
    userId: string,
    orderId: string,
    note: string,
  ): Promise<NoteResult>;
  cancelOrder(
    userId: string,
    orderId: string,
    reason: string,
  ): Promise<CancelResult>;
  handleRefund(webhookData: RefundWebhookPayload): Promise<void>;
}

interface OrderDetails {
  id: string;
  shopify_id: string;
  order_number: number;
  customer: CustomerInfo;
  line_items: LineItem[];
  total_price: number;
  status: OrderStatus;
  fulfillment_status: FulfillmentStatus;
  notes: OrderNote[];
  created_at: Date;
  updated_at: Date;
}

interface OrderNote {
  id: string;
  author: string;
  content: string;
  created_at: Date;
  synced_to_shopify: boolean;
}

type OrderStatus =
  | "pending"
  | "authorized"
  | "paid"
  | "partially_paid"
  | "refunded"
  | "voided"
  | "partially_refunded";
type FulfillmentStatus = "fulfilled" | "partial" | "unfulfilled" | "restocked";
```

**المسؤوليات**:

- جلب تفاصيل الطلبات الكاملة
- تحديث حالات الطلبات والمزامنة مع Shopify
- إدارة التعليقات والملاحظات
- معالجة عمليات الإلغاء والاسترجاع
- تحديث المخزون تلقائياً عند الاسترجاع

### 3. Webhook Handler Service

**الغرض**: استقبال ومعالجة Webhooks من Shopify

**الواجهة**:

```typescript
interface WebhookHandlerService {
  validateWebhook(req: Request): boolean;
  handleProductUpdate(payload: ProductWebhookPayload): Promise<void>;
  handleProductDelete(payload: ProductWebhookPayload): Promise<void>;
  handleOrderUpdate(payload: OrderWebhookPayload): Promise<void>;
  handleRefundCreate(payload: RefundWebhookPayload): Promise<void>;
  handleInventoryUpdate(payload: InventoryWebhookPayload): Promise<void>;
}

interface ProductWebhookPayload {
  id: number;
  title: string;
  variants: ProductVariant[];
  updated_at: string;
}

interface RefundWebhookPayload {
  id: number;
  order_id: number;
  refund_line_items: RefundLineItem[];
  transactions: RefundTransaction[];
}

interface RefundLineItem {
  line_item_id: number;
  quantity: number;
  restock_type: "no_restock" | "cancel" | "return" | "legacy_restock";
}
```

**المسؤوليات**:

- التحقق من صحة HMAC Signature للـ Webhooks
- توجيه الـ Webhooks للمعالجات المناسبة
- معالجة تحديثات المنتجات والطلبات
- معالجة عمليات الاسترجاع وتحديث المخزون
- تسجيل جميع الأحداث الواردة

### 4. Conflict Resolution Service

**الغرض**: كشف وحل التعارضات في المزامنة الثنائية

**الواجهة**:

```typescript
interface ConflictResolutionService {
  detectConflict(localData: any, shopifyData: any): ConflictInfo | null;
  resolveConflict(
    conflict: ConflictInfo,
    strategy: ResolutionStrategy,
  ): Promise<ResolutionResult>;
  queueConflict(conflict: ConflictInfo): Promise<void>;
  getConflictQueue(userId: string): Promise<ConflictInfo[]>;
}

interface ConflictInfo {
  id: string;
  entity_type: "product" | "order";
  entity_id: string;
  local_value: any;
  shopify_value: any;
  local_updated_at: Date;
  shopify_updated_at: Date;
  detected_at: Date;
  status: "pending" | "resolved" | "manual_review";
}

type ResolutionStrategy =
  | "shopify_wins" // Shopify هو المصدر الموثوق
  | "local_wins" // التطبيق المحلي هو المصدر الموثوق
  | "latest_wins" // آخر تحديث يفوز
  | "manual_review"; // يتطلب مراجعة يدوية

interface ResolutionResult {
  success: boolean;
  strategy_used: ResolutionStrategy;
  final_value: any;
  applied_at: Date;
}
```

**المسؤوليات**:

- كشف التعارضات بين البيانات المحلية و Shopify
- تطبيق استراتيجيات الحل التلقائي
- إدارة قائمة انتظار التعارضات
- توفير واجهة للمراجعة اليدوية

### 5. Rate Limiter Service

**الغرض**: إدارة معدل الطلبات لـ Shopify API

**الواجهة**:

```typescript
interface RateLimiterService {
  canMakeRequest(userId: string): Promise<boolean>;
  waitForSlot(userId: string): Promise<void>;
  recordRequest(userId: string): Promise<void>;
  getRequestStats(userId: string): Promise<RateLimitStats>;
}

interface RateLimitStats {
  requests_made: number;
  requests_remaining: number;
  reset_at: Date;
  current_rate: number; // requests per second
}
```

**المسؤوليات**:

- تتبع عدد الطلبات لكل مستخدم
- ضمان عدم تجاوز حد 2 طلب/ثانية
- إدارة قائمة انتظار الطلبات
- توفير إحصائيات الاستخدام

### 6. Sync Operations Logger

**الغرض**: تسجيل جميع عمليات المزامنة للمراجعة والتدقيق

**الواجهة**:

```typescript
interface SyncOperationsLogger {
  logOperation(operation: SyncOperation): Promise<void>;
  getOperationHistory(
    userId: string,
    filters: OperationFilters,
  ): Promise<SyncOperation[]>;
  getFailedOperations(userId: string): Promise<SyncOperation[]>;
  retryFailedOperation(operationId: string): Promise<RetryResult>;
}

interface SyncOperation {
  id: string;
  user_id: string;
  operation_type:
    | "product_update"
    | "order_update"
    | "webhook_received"
    | "conflict_resolved";
  entity_type: "product" | "order";
  entity_id: string;
  direction: "to_shopify" | "from_shopify";
  status: "success" | "failed" | "pending";
  request_data?: any;
  response_data?: any;
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
}

interface OperationFilters {
  start_date?: Date;
  end_date?: Date;
  operation_type?: string;
  status?: string;
  entity_type?: string;
}
```

**المسؤوليات**:

- تسجيل جميع عمليات المزامنة
- توفير سجل تدقيق كامل
- تتبع العمليات الفاشلة
- دعم إعادة المحاولة للعمليات الفاشلة

## نماذج البيانات

### تحديثات جدول Products

```sql
-- إضافة أعمدة جديدة لدعم المزامنة الثنائية
ALTER TABLE products ADD COLUMN IF NOT EXISTS pending_sync BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS local_updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_updated_at TIMESTAMP;

-- إنشاء index للبحث السريع عن المنتجات التي تحتاج مزامنة
CREATE INDEX IF NOT EXISTS idx_products_pending_sync ON products(pending_sync) WHERE pending_sync = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_last_synced ON products(last_synced_at);
```

### تحديثات جدول Orders

```sql
-- إضافة أعمدة جديدة لدعم إدارة الطلبات
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pending_sync BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS local_updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_updated_at TIMESTAMP;

-- إنشاء index
CREATE INDEX IF NOT EXISTS idx_orders_pending_sync ON orders(pending_sync) WHERE pending_sync = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_notes ON orders USING GIN(notes);
```

### جدول جديد: sync_operations

```sql
CREATE TABLE IF NOT EXISTS sync_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(20) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('to_shopify', 'from_shopify')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  request_data JSONB,
  response_data JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Indexes
CREATE INDEX idx_sync_ops_user_id ON sync_operations(user_id);
CREATE INDEX idx_sync_ops_status ON sync_operations(status);
CREATE INDEX idx_sync_ops_entity ON sync_operations(entity_type, entity_id);
CREATE INDEX idx_sync_ops_created_at ON sync_operations(created_at DESC);
```

### جدول جديد: conflict_queue

```sql
CREATE TABLE IF NOT EXISTS conflict_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  local_value JSONB NOT NULL,
  shopify_value JSONB NOT NULL,
  local_updated_at TIMESTAMP NOT NULL,
  shopify_updated_at TIMESTAMP NOT NULL,
  detected_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'manual_review')),
  resolution_strategy VARCHAR(30),
  resolved_at TIMESTAMP,
  resolved_value JSONB
);

-- Indexes
CREATE INDEX idx_conflict_queue_user_id ON conflict_queue(user_id);
CREATE INDEX idx_conflict_queue_status ON conflict_queue(status);
CREATE INDEX idx_conflict_queue_entity ON conflict_queue(entity_type, entity_id);
```

### جدول جديد: webhook_events

```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  topic VARCHAR(100) NOT NULL,
  shopify_id VARCHAR(255),
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  error_message TEXT,
  received_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed);
CREATE INDEX idx_webhook_events_topic ON webhook_events(topic);
CREATE INDEX idx_webhook_events_received_at ON webhook_events(received_at DESC);
```

### جدول جديد: rate_limit_tracking

```sql
CREATE TABLE IF NOT EXISTS rate_limit_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  endpoint VARCHAR(255) NOT NULL,
  response_status INTEGER
);

-- Index للتنظيف التلقائي للسجلات القديمة
CREATE INDEX idx_rate_limit_timestamp ON rate_limit_tracking(request_timestamp);
CREATE INDEX idx_rate_limit_user_id ON rate_limit_tracking(user_id, request_timestamp DESC);
```

## الخوارزميات الرئيسية بالكود الزائف

### خوارزمية 1: تحديث المنتج مع المزامنة

```pascal
ALGORITHM updateProductWithSync(userId, productId, updates)
INPUT: userId (UUID), productId (UUID), updates (ProductUpdates)
OUTPUT: result (UpdateResult)

BEGIN
  ASSERT userId ≠ NULL AND productId ≠ NULL
  ASSERT updates.price ≥ 0 OR updates.inventory_quantity ≥ 0

  // الخطوة 1: حفظ التحديث محلياً
  transaction ← BEGIN_TRANSACTION()

  TRY
    // جلب البيانات الحالية
    currentProduct ← database.products.findById(productId, userId)
    ASSERT currentProduct ≠ NULL

    // حفظ القيم القديمة للـ Rollback
    oldValues ← {
      price: currentProduct.price,
      inventory_quantity: currentProduct.inventory_quantity
    }

    // تطبيق التحديثات
    currentProduct.price ← updates.price OR currentProduct.price
    currentProduct.inventory_quantity ← updates.inventory_quantity OR currentProduct.inventory_quantity
    currentProduct.local_updated_at ← NOW()
    currentProduct.pending_sync ← TRUE

    // حفظ في قاعدة البيانات
    database.products.update(currentProduct)

    // تسجيل العملية
    syncOperation ← {
      user_id: userId,
      operation_type: 'product_update',
      entity_type: 'product',
      entity_id: productId,
      direction: 'to_shopify',
      status: 'pending',
      request_data: updates
    }
    operationId ← database.sync_operations.insert(syncOperation)

    COMMIT_TRANSACTION(transaction)

    // الخطوة 2: المزامنة مع Shopify (async)
    ASYNC_EXECUTE(syncToShopify(userId, productId, updates, operationId, oldValues))

    RETURN {
      success: TRUE,
      localUpdate: TRUE,
      shopifySync: 'pending',
      operationId: operationId
    }

  CATCH error
    ROLLBACK_TRANSACTION(transaction)
    RETURN {
      success: FALSE,
      localUpdate: FALSE,
      error: error.message
    }
  END TRY
END
```

**المواصفات الرسمية**:

**Preconditions**:

- `userId` و `productId` يجب أن يكونا معرّفات صالحة وغير NULL
- `updates.price` إذا كان موجوداً يجب أن يكون ≥ 0
- `updates.inventory_quantity` إذا كان موجوداً يجب أن يكون ≥ 0
- المنتج يجب أن يكون موجوداً في قاعدة البيانات
- المستخدم يجب أن يملك صلاحية تعديل المنتج

**Postconditions**:

- إذا نجحت العملية: البيانات المحلية محدثة و `pending_sync = TRUE`
- سجل في `sync_operations` تم إنشاؤه بحالة 'pending'
- `local_updated_at` تم تحديثه إلى الوقت الحالي
- إذا فشلت: لا تغيير في قاعدة البيانات (Rollback كامل)

**Loop Invariants**: N/A (لا توجد حلقات في هذه الخوارزمية)

### خوارزمية 2: المزامنة مع Shopify (Async)

```pascal
ALGORITHM syncToShopify(userId, productId, updates, operationId, oldValues)
INPUT: userId, productId, updates, operationId, oldValues
OUTPUT: void (async operation)

BEGIN
  ASSERT operationId ≠ NULL

  TRY
    // الخطوة 1: التحقق من Rate Limit
    canProceed ← rateLimiter.waitForSlot(userId)
    ASSERT canProceed = TRUE

    // الخطوة 2: جلب بيانات Shopify
    shopifyToken ← database.shopify_tokens.findByUser(userId)
    ASSERT shopifyToken ≠ NULL

    product ← database.products.findById(productId)
    shopifyProductId ← product.shopify_id

    // الخطوة 3: إرسال التحديث إلى Shopify
    shopifyPayload ← buildShopifyPayload(updates)

    response ← HTTP_PUT(
      url: "https://{shop}/admin/api/2024-01/products/{shopifyProductId}.json",
      headers: {
        "X-Shopify-Access-Token": shopifyToken.access_token,
        "Content-Type": "application/json"
      },
      body: shopifyPayload
    )

    // الخطوة 4: معالجة الاستجابة
    IF response.status = 200 THEN
      // نجاح المزامنة
      database.products.update({
        id: productId,
        pending_sync: FALSE,
        last_synced_at: NOW(),
        sync_error: NULL,
        shopify_updated_at: response.data.updated_at
      })

      database.sync_operations.update({
        id: operationId,
        status: 'success',
        response_data: response.data,
        completed_at: NOW()
      })

      rateLimiter.recordRequest(userId)

    ELSE IF response.status = 429 THEN
      // Rate limit exceeded - إعادة المحاولة
      WAIT(1000) // انتظر ثانية واحدة
      RETRY syncToShopify(userId, productId, updates, operationId, oldValues)

    ELSE
      // فشل المزامنة
      THROW ShopifySyncError(response.status, response.data)
    END IF

  CATCH error
    // الخطوة 5: معالجة الأخطاء
    database.products.update({
      id: productId,
      pending_sync: TRUE,
      sync_error: error.message
    })

    database.sync_operations.update({
      id: operationId,
      status: 'failed',
      error_message: error.message,
      completed_at: NOW()
    })

    // إشعار المستخدم بالفشل
    notificationService.sendError(userId, {
      type: 'sync_failed',
      entity: 'product',
      entityId: productId,
      error: error.message
    })
  END TRY
END
```

**المواصفات الرسمية**:

**Preconditions**:

- `operationId` يجب أن يكون معرّف صالح لعملية في `sync_operations`
- `userId` يجب أن يملك `shopify_token` صالح
- `productId` يجب أن يملك `shopify_id` صالح
- Rate limiter يجب أن يسمح بالطلب

**Postconditions**:

- إذا نجحت: `pending_sync = FALSE` و `last_synced_at` محدث
- إذا فشلت: `pending_sync = TRUE` و `sync_error` يحتوي على رسالة الخطأ
- في كل الحالات: `sync_operations` محدث بالحالة النهائية
- Rate limiter تم تحديثه بالطلب الجديد

**Loop Invariants**: N/A

### خوارزمية 3: معالجة Webhook من Shopify

```pascal
ALGORITHM handleShopifyWebhook(request)
INPUT: request (HTTP Request)
OUTPUT: response (HTTP Response)

BEGIN
  // الخطوة 1: التحقق من صحة الـ Webhook
  hmacHeader ← request.headers['X-Shopify-Hmac-Sha256']
  topic ← request.headers['X-Shopify-Topic']
  shopDomain ← request.headers['X-Shopify-Shop-Domain']
  payload ← request.body

  ASSERT hmacHeader ≠ NULL AND topic ≠ NULL

  // التحقق من HMAC Signature
  isValid ← validateHMAC(payload, hmacHeader, SHOPIFY_API_SECRET)

  IF isValid = FALSE THEN
    LOG_WARNING("Invalid webhook signature from " + shopDomain)
    RETURN HTTP_RESPONSE(401, "Unauthorized")
  END IF

  // الخطوة 2: حفظ الـ Webhook للمعالجة
  userId ← findUserByShop(shopDomain)

  webhookEvent ← {
    user_id: userId,
    topic: topic,
    shopify_id: payload.id,
    payload: payload,
    processed: FALSE,
    received_at: NOW()
  }

  eventId ← database.webhook_events.insert(webhookEvent)

  // الخطوة 3: معالجة الـ Webhook بشكل async
  ASYNC_EXECUTE(processWebhookEvent(eventId, userId, topic, payload))

  // الخطوة 4: إرجاع استجابة فورية لـ Shopify
  RETURN HTTP_RESPONSE(200, "OK")
END
```

**المواصفات الرسمية**:

**Preconditions**:

- `request` يجب أن يحتوي على headers صالحة من Shopify
- `X-Shopify-Hmac-Sha256` يجب أن يكون موجوداً
- `X-Shopify-Topic` يجب أن يكون موجوداً
- `X-Shopify-Shop-Domain` يجب أن يكون موجوداً

**Postconditions**:

- إذا كان التوقيع صحيحاً: webhook محفوظ في `webhook_events`
- استجابة 200 OK مرسلة إلى Shopify خلال 5 ثوانٍ
- المعالجة الفعلية تتم بشكل async
- إذا كان التوقيع خاطئاً: استجابة 401 Unauthorized

**Loop Invariants**: N/A

### خوارزمية 4: معالجة حدث Webhook (Async)

```pascal
ALGORITHM processWebhookEvent(eventId, userId, topic, payload)
INPUT: eventId, userId, topic, payload
OUTPUT: void (async operation)

BEGIN
  TRY
    // الخطوة 1: تحديد نوع الحدث
    MATCH topic WITH
      CASE "products/update":
        processProductUpdate(userId, payload)
      CASE "products/delete":
        processProductDelete(userId, payload)
      CASE "orders/updated":
        processOrderUpdate(userId, payload)
      CASE "refunds/create":
        processRefundCreate(userId, payload)
      CASE "inventory_levels/update":
        processInventoryUpdate(userId, payload)
      DEFAULT:
        LOG_INFO("Unhandled webhook topic: " + topic)
    END MATCH

    // الخطوة 2: تحديث حالة الـ Webhook
    database.webhook_events.update({
      id: eventId,
      processed: TRUE,
      processed_at: NOW()
    })

  CATCH error
    database.webhook_events.update({
      id: eventId,
      processed: FALSE,
      error_message: error.message
    })

    LOG_ERROR("Webhook processing failed: " + error.message)
  END TRY
END

PROCEDURE processProductUpdate(userId, payload)
BEGIN
  shopifyId ← payload.id

  // جلب المنتج المحلي
  localProduct ← database.products.findByShopifyId(shopifyId, userId)

  IF localProduct = NULL THEN
    // منتج جديد - إنشاؤه
    createProductFromShopify(userId, payload)
    RETURN
  END IF

  // الخطوة 2: فحص التعارضات
  hasConflict ← detectConflict(localProduct, payload)

  IF hasConflict THEN
    // حفظ التعارض للمراجعة
    conflict ← {
      user_id: userId,
      entity_type: 'product',
      entity_id: localProduct.id,
      local_value: {
        price: localProduct.price,
        inventory_quantity: localProduct.inventory_quantity
      },
      shopify_value: {
        price: payload.variants[0].price,
        inventory_quantity: payload.variants[0].inventory_quantity
      },
      local_updated_at: localProduct.local_updated_at,
      shopify_updated_at: payload.updated_at,
      detected_at: NOW(),
      status: 'pending'
    }

    database.conflict_queue.insert(conflict)

    // تطبيق استراتيجية الحل التلقائي
    resolveConflict(conflict, 'latest_wins')
  ELSE
    // لا يوجد تعارض - تحديث مباشر
    updateProductFromShopify(localProduct, payload)
  END IF
END
```

**المواصفات الرسمية**:

**Preconditions**:

- `eventId` يجب أن يكون معرّف صالح في `webhook_events`
- `userId` يجب أن يكون معرّف مستخدم صالح
- `topic` يجب أن يكون نوع webhook صالح من Shopify
- `payload` يجب أن يحتوي على بيانات صالحة من Shopify

**Postconditions**:

- `webhook_events.processed` يتم تحديثه إلى TRUE عند النجاح
- إذا كان هناك تعارض: سجل في `conflict_queue`
- البيانات المحلية محدثة حسب استراتيجية الحل
- إذا فشلت المعالجة: `error_message` يحتوي على تفاصيل الخطأ

**Loop Invariants**: N/A

### خوارزمية 5: كشف وحل التعارضات

```pascal
ALGORITHM detectConflict(localProduct, shopifyPayload)
INPUT: localProduct (Product), shopifyPayload (ShopifyProduct)
OUTPUT: hasConflict (boolean)

BEGIN
  // فحص إذا كان هناك تحديث محلي معلق
  IF localProduct.pending_sync = FALSE THEN
    RETURN FALSE  // لا يوجد تحديث محلي معلق
  END IF

  // مقارنة timestamps
  localTime ← localProduct.local_updated_at
  shopifyTime ← PARSE_DATE(shopifyPayload.updated_at)

  // إذا كان الفرق أقل من 5 ثوانٍ، اعتبره نفس التحديث
  timeDiff ← ABS(localTime - shopifyTime)
  IF timeDiff < 5_SECONDS THEN
    RETURN FALSE
  END IF

  // مقارنة القيم
  shopifyPrice ← shopifyPayload.variants[0].price
  shopifyInventory ← shopifyPayload.variants[0].inventory_quantity

  priceChanged ← (localProduct.price ≠ shopifyPrice)
  inventoryChanged ← (localProduct.inventory_quantity ≠ shopifyInventory)

  RETURN (priceChanged OR inventoryChanged)
END

ALGORITHM resolveConflict(conflict, strategy)
INPUT: conflict (ConflictInfo), strategy (ResolutionStrategy)
OUTPUT: result (ResolutionResult)

BEGIN
  ASSERT conflict ≠ NULL AND strategy ≠ NULL

  finalValue ← NULL

  MATCH strategy WITH
    CASE 'shopify_wins':
      // Shopify هو المصدر الموثوق
      finalValue ← conflict.shopify_value

    CASE 'local_wins':
      // التطبيق المحلي هو المصدر الموثوق
      finalValue ← conflict.local_value
      // إعادة محاولة المزامنة مع Shopify
      ASYNC_EXECUTE(syncToShopify(conflict.user_id, conflict.entity_id, finalValue))

    CASE 'latest_wins':
      // آخر تحديث يفوز
      IF conflict.shopify_updated_at > conflict.local_updated_at THEN
        finalValue ← conflict.shopify_value
      ELSE
        finalValue ← conflict.local_value
        ASYNC_EXECUTE(syncToShopify(conflict.user_id, conflict.entity_id, finalValue))
      END IF

    CASE 'manual_review':
      // يتطلب مراجعة يدوية
      database.conflict_queue.update({
        id: conflict.id,
        status: 'manual_review'
      })
      RETURN {
        success: FALSE,
        strategy_used: 'manual_review',
        requires_manual_review: TRUE
      }
  END MATCH

  // تطبيق القيمة النهائية
  IF conflict.entity_type = 'product' THEN
    database.products.update({
      id: conflict.entity_id,
      price: finalValue.price,
      inventory_quantity: finalValue.inventory_quantity,
      pending_sync: FALSE,
      last_synced_at: NOW()
    })
  END IF

  // تحديث حالة التعارض
  database.conflict_queue.update({
    id: conflict.id,
    status: 'resolved',
    resolution_strategy: strategy,
    resolved_at: NOW(),
    resolved_value: finalValue
  })

  RETURN {
    success: TRUE,
    strategy_used: strategy,
    final_value: finalValue,
    applied_at: NOW()
  }
END
```

**المواصفات الرسمية**:

**Preconditions (detectConflict)**:

- `localProduct` و `shopifyPayload` يجب أن يكونا كائنات صالحة
- `localProduct.local_updated_at` يجب أن يكون timestamp صالح
- `shopifyPayload.updated_at` يجب أن يكون timestamp صالح

**Postconditions (detectConflict)**:

- يرجع TRUE إذا كان هناك تعارض حقيقي
- يرجع FALSE إذا كان التحديث من نفس المصدر أو لا يوجد تعارض

**Preconditions (resolveConflict)**:

- `conflict` يجب أن يكون كائن تعارض صالح
- `strategy` يجب أن يكون واحد من الاستراتيجيات المدعومة
- `conflict.entity_id` يجب أن يكون موجوداً في قاعدة البيانات

**Postconditions (resolveConflict)**:

- البيانات المحلية محدثة بالقيمة النهائية
- `conflict_queue` محدث بحالة 'resolved'
- إذا كانت الاستراتيجية 'local_wins' أو 'latest_wins' (local): مزامنة async مع Shopify
- إذا كانت 'manual_review': لا تغيير في البيانات

**Loop Invariants**: N/A

### خوارزمية 6: معالجة Refund وإرجاع المخزون

```pascal
ALGORITHM processRefundCreate(userId, refundPayload)
INPUT: userId (UUID), refundPayload (RefundWebhookPayload)
OUTPUT: void

BEGIN
  ASSERT userId ≠ NULL AND refundPayload ≠ NULL

  orderId ← refundPayload.order_id
  refundLineItems ← refundPayload.refund_line_items

  // الخطوة 1: جلب الطلب المحلي
  localOrder ← database.orders.findByShopifyId(orderId, userId)
  ASSERT localOrder ≠ NULL

  // الخطوة 2: معالجة كل منتج مسترجع
  FOR EACH refundItem IN refundLineItems DO
    ASSERT refundItem.quantity > 0

    lineItemId ← refundItem.line_item_id
    quantity ← refundItem.quantity
    restockType ← refundItem.restock_type

    // جلب تفاصيل المنتج من الطلب
    orderData ← localOrder.data
    lineItem ← findLineItem(orderData.line_items, lineItemId)

    IF lineItem ≠ NULL THEN
      productId ← lineItem.product_id
      variantId ← lineItem.variant_id

      // الخطوة 3: تحديث المخزون حسب نوع الإرجاع
      IF restockType IN ['return', 'cancel', 'legacy_restock'] THEN
        localProduct ← database.products.findByShopifyId(productId, userId)

        IF localProduct ≠ NULL THEN
          // إرجاع الكمية للمخزون
          newInventory ← localProduct.inventory_quantity + quantity

          database.products.update({
            id: localProduct.id,
            inventory_quantity: newInventory,
            local_updated_at: NOW(),
            shopify_updated_at: NOW()
          })

          // تسجيل العملية
          database.sync_operations.insert({
            user_id: userId,
            operation_type: 'inventory_restock',
            entity_type: 'product',
            entity_id: localProduct.id,
            direction: 'from_shopify',
            status: 'success',
            request_data: {
              refund_id: refundPayload.id,
              quantity: quantity,
              restock_type: restockType
            },
            completed_at: NOW()
          })
        END IF
      END IF
    END IF
  END FOR

  // الخطوة 4: تحديث حالة الطلب
  database.orders.update({
    id: localOrder.id,
    status: 'refunded',
    local_updated_at: NOW(),
    shopify_updated_at: NOW()
  })

  LOG_INFO("Refund processed successfully for order " + orderId)
END
```

**المواصفات الرسمية**:

**Preconditions**:

- `userId` يجب أن يكون معرّف مستخدم صالح
- `refundPayload` يجب أن يحتوي على `order_id` و `refund_line_items` صالحة
- `refund_line_items` يجب أن تحتوي على عنصر واحد على الأقل
- كل `refundItem.quantity` يجب أن يكون > 0
- الطلب يجب أن يكون موجوداً في قاعدة البيانات

**Postconditions**:

- لكل منتج مسترجع مع `restock_type` صالح: `inventory_quantity` زاد بالكمية المسترجعة
- حالة الطلب محدثة إلى 'refunded'
- سجل في `sync_operations` لكل عملية إرجاع مخزون
- `local_updated_at` و `shopify_updated_at` محدثة

**Loop Invariants**:

- لكل تكرار: جميع المنتجات المعالجة سابقاً تم تحديث مخزونها بشكل صحيح
- مجموع الكميات المسترجعة = مجموع الزيادات في المخزون

## الوظائف الرئيسية مع المواصفات الرسمية

### Function 1: updateProductPrice()

```typescript
async function updateProductPrice(
  userId: string,
  productId: string,
  newPrice: number,
): Promise<UpdateResult>;
```

**Preconditions**:

- `userId` معرّف UUID صالح لمستخدم موجود
- `productId` معرّف UUID صالح لمنتج موجود
- `newPrice` رقم موجب (≥ 0)
- المستخدم يملك صلاحية تعديل المنتج
- المنتج يملك `shopify_id` صالح

**Postconditions**:

- `products.price` محدث بالقيمة الجديدة
- `products.pending_sync` = TRUE
- `products.local_updated_at` = NOW()
- سجل جديد في `sync_operations` بحالة 'pending'
- عملية مزامنة async بدأت مع Shopify
- يرجع `UpdateResult` مع `success = TRUE` و `localUpdate = TRUE`

**Loop Invariants**: N/A

---

### Function 2: updateProductInventory()

```typescript
async function updateProductInventory(
  userId: string,
  productId: string,
  newQuantity: number,
): Promise<UpdateResult>;
```

**Preconditions**:

- `userId` معرّف UUID صالح لمستخدم موجود
- `productId` معرّف UUID صالح لمنتج موجود
- `newQuantity` عدد صحيح غير سالب (≥ 0)
- المستخدم يملك صلاحية تعديل المنتج
- المنتج يملك `shopify_id` صالح

**Postconditions**:

- `products.inventory_quantity` محدث بالقيمة الجديدة
- `products.pending_sync` = TRUE
- `products.local_updated_at` = NOW()
- سجل جديد في `sync_operations` بحالة 'pending'
- عملية مزامنة async بدأت مع Shopify
- يرجع `UpdateResult` مع `success = TRUE`

**Loop Invariants**: N/A

---

### Function 3: addOrderNote()

```typescript
async function addOrderNote(
  userId: string,
  orderId: string,
  noteContent: string,
): Promise<NoteResult>;
```

**Preconditions**:

- `userId` معرّف UUID صالح لمستخدم موجود
- `orderId` معرّف UUID صالح لطلب موجود
- `noteContent` نص غير فارغ (length > 0)
- المستخدم يملك صلاحية تعديل الطلب
- الطلب يملك `shopify_id` صالح

**Postconditions**:

- تعليق جديد مضاف إلى `orders.notes` (JSONB array)
- التعليق يحتوي على: `id`, `author`, `content`, `created_at`, `synced_to_shopify = FALSE`
- `orders.local_updated_at` = NOW()
- عملية مزامنة async بدأت لإرسال التعليق إلى Shopify
- يرجع `NoteResult` مع `success = TRUE` و `noteId`

**Loop Invariants**: N/A

---

### Function 4: updateOrderStatus()

```typescript
async function updateOrderStatus(
  userId: string,
  orderId: string,
  newStatus: OrderStatus,
): Promise<UpdateResult>;
```

**Preconditions**:

- `userId` معرّف UUID صالح لمستخدم موجود
- `orderId` معرّف UUID صالح لطلب موجود
- `newStatus` واحد من القيم الصالحة: 'pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'voided', 'partially_refunded'
- المستخدم يملك صلاحية تعديل الطلب
- الطلب يملك `shopify_id` صالح
- الانتقال من الحالة الحالية إلى `newStatus` صالح حسب قواعد Shopify

**Postconditions**:

- `orders.status` محدث بالحالة الجديدة
- `orders.local_updated_at` = NOW()
- `orders.pending_sync` = TRUE
- سجل جديد في `sync_operations` بحالة 'pending'
- عملية مزامنة async بدأت مع Shopify
- يرجع `UpdateResult` مع `success = TRUE`

**Loop Invariants**: N/A

### Function 5: validateWebhookSignature()

```typescript
function validateWebhookSignature(
  payload: string,
  hmacHeader: string,
  apiSecret: string,
): boolean;
```

**Preconditions**:

- `payload` نص JSON صالح من Shopify
- `hmacHeader` قيمة header من `X-Shopify-Hmac-Sha256`
- `apiSecret` مفتاح API السري الصالح

**Postconditions**:

- يرجع TRUE إذا كان التوقيع صحيحاً
- يرجع FALSE إذا كان التوقيع غير صحيح
- لا تأثيرات جانبية (pure function)

**Loop Invariants**: N/A

---

### Function 6: rateLimitCheck()

```typescript
async function rateLimitCheck(userId: string): Promise<boolean>;
```

**Preconditions**:

- `userId` معرّف UUID صالح لمستخدم موجود

**Postconditions**:

- يرجع TRUE إذا كان المستخدم يمكنه إرسال طلب الآن
- يرجع FALSE إذا تجاوز المستخدم الحد (2 requests/second)
- يحدث `rate_limit_tracking` بالطلبات الأخيرة
- ينظف السجلات القديمة (أكثر من دقيقة)

**Loop Invariants**: N/A

---

## أمثلة الاستخدام

### مثال 1: تحديث سعر منتج

```typescript
// Frontend: Optimistic UI Update
const handlePriceUpdate = async (productId: string, newPrice: number) => {
  // 1. تحديث فوري في الواجهة
  setProducts((prev) =>
    prev.map((p) =>
      p.id === productId ? { ...p, price: newPrice, syncing: true } : p,
    ),
  );

  try {
    // 2. إرسال التحديث للـ Backend
    const result = await api.post(`/api/products/${productId}/update-price`, {
      price: newPrice,
    });

    if (result.success) {
      // 3. تأكيد الحفظ المحلي
      showNotification("تم حفظ السعر محلياً، جاري المزامنة مع Shopify...");

      // 4. انتظار تأكيد المزامنة (via WebSocket أو polling)
      await waitForSyncConfirmation(productId);

      // 5. تحديث الحالة النهائية
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId ? { ...p, syncing: false, synced: true } : p,
        ),
      );
      showNotification("تم المزامنة مع Shopify بنجاح!");
    }
  } catch (error) {
    // Rollback في حالة الفشل
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId
          ? { ...p, price: p.originalPrice, syncing: false }
          : p,
      ),
    );
    showError("فشل تحديث السعر: " + error.message);
  }
};

// Backend: Product Update Handler
router.post("/products/:id/update-price", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price } = req.body;
  const userId = req.user.id;

  try {
    const result = await productUpdateService.updatePrice(userId, id, price);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### مثال 2: معالجة Webhook من Shopify

```typescript
// Backend: Webhook Endpoint
router.post("/webhooks/products/update", async (req, res) => {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  const topic = req.headers["x-shopify-topic"];
  const shop = req.headers["x-shopify-shop-domain"];

  // 1. التحقق من التوقيع
  const isValid = webhookHandler.validateWebhook(req);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. حفظ الـ Webhook
  const userId = await findUserByShop(shop);
  const eventId = await webhookHandler.saveEvent(userId, topic, req.body);

  // 3. معالجة async
  webhookHandler.processEvent(eventId).catch((err) => {
    console.error("Webhook processing error:", err);
  });

  // 4. استجابة فورية
  res.status(200).json({ received: true });
});

// Webhook Processing Service
async function processProductUpdateWebhook(userId: string, payload: any) {
  const shopifyId = payload.id;
  const localProduct = await db.products.findByShopifyId(shopifyId, userId);

  if (!localProduct) {
    // منتج جديد
    await createProductFromShopify(userId, payload);
    return;
  }

  // فحص التعارضات
  const conflict = await conflictResolver.detectConflict(localProduct, payload);

  if (conflict) {
    // حفظ التعارض
    await db.conflict_queue.insert(conflict);

    // حل تلقائي باستخدام "latest_wins"
    await conflictResolver.resolveConflict(conflict, "latest_wins");
  } else {
    // تحديث مباشر
    await db.products.update({
      id: localProduct.id,
      price: payload.variants[0].price,
      inventory_quantity: payload.variants[0].inventory_quantity,
      shopify_updated_at: payload.updated_at,
      pending_sync: false,
    });
  }
}
```

### مثال 3: إضافة تعليق على طلب

```typescript
// Frontend: Add Order Note
const handleAddNote = async (orderId: string, noteContent: string) => {
  try {
    const result = await api.post(`/api/orders/${orderId}/notes`, {
      content: noteContent,
    });

    if (result.success) {
      // تحديث الواجهة
      setOrder((prev) => ({
        ...prev,
        notes: [...prev.notes, result.note],
      }));
      showNotification("تم إضافة التعليق وجاري المزامنة مع Shopify");
    }
  } catch (error) {
    showError("فشل إضافة التعليق: " + error.message);
  }
};

// Backend: Add Note Handler
router.post("/orders/:id/notes", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;

  try {
    const result = await orderManagementService.addOrderNote(
      userId,
      id,
      content,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Service Implementation
async function addOrderNote(
  userId: string,
  orderId: string,
  content: string,
): Promise<NoteResult> {
  const order = await db.orders.findById(orderId, userId);
  if (!order) throw new Error("Order not found");

  const note = {
    id: uuid(),
    author: userId,
    content: content,
    created_at: new Date(),
    synced_to_shopify: false,
  };

  // إضافة التعليق محلياً
  const notes = [...(order.notes || []), note];
  await db.orders.update({
    id: orderId,
    notes: notes,
    local_updated_at: new Date(),
  });

  // مزامنة مع Shopify async
  syncNoteToShopify(userId, order.shopify_id, note).catch((err) => {
    console.error("Failed to sync note:", err);
  });

  return { success: true, note: note };
}
```

## خصائص الصحة (Correctness Properties)

### خاصية 1: ضمان المزامنة النهائية (Eventual Consistency)

```
∀ product ∈ Products, ∀ update ∈ Updates:
  IF update.applied_locally = TRUE
  THEN ∃ t ∈ Time: (
    (update.synced_to_shopify = TRUE AT time t) ∨
    (update.sync_error ≠ NULL AT time t)
  )
```

**الوصف**: كل تحديث محلي يجب أن ينتهي إما بمزامنة ناجحة مع Shopify أو برسالة خطأ واضحة.

---

### خاصية 2: عدم فقدان البيانات (No Data Loss)

```
∀ update ∈ Updates:
  IF update.status = 'failed'
  THEN ∃ log ∈ sync_operations: (
    log.entity_id = update.entity_id ∧
    log.status = 'failed' ∧
    log.error_message ≠ NULL ∧
    log.request_data = update.data
  )
```

**الوصف**: كل عملية فاشلة يجب أن تُسجل بالكامل مع البيانات الأصلية لإمكانية إعادة المحاولة.

---

### خاصية 3: صحة التوقيع (Signature Validity)

```
∀ webhook ∈ IncomingWebhooks:
  IF webhook.processed = TRUE
  THEN validateHMAC(webhook.payload, webhook.hmac, API_SECRET) = TRUE
```

**الوصف**: لا يتم معالجة أي webhook إلا إذا كان التوقيع صحيحاً.

---

### خاصية 4: احترام Rate Limit

```
∀ user ∈ Users, ∀ time_window ∈ [t, t+1s]:
  COUNT(requests WHERE user_id = user.id AND timestamp ∈ time_window) ≤ 2
```

**الوصف**: لا يتجاوز عدد الطلبات لأي مستخدم 2 طلب في الثانية الواحدة.

---

### خاصية 5: صحة حل التعارضات (Conflict Resolution Correctness)

```
∀ conflict ∈ Conflicts:
  IF conflict.status = 'resolved'
  THEN ∃ strategy ∈ ResolutionStrategies: (
    conflict.resolution_strategy = strategy ∧
    conflict.resolved_value = apply(strategy, conflict.local_value, conflict.shopify_value) ∧
    conflict.resolved_at ≠ NULL
  )
```

**الوصف**: كل تعارض محلول يجب أن يكون له استراتيجية واضحة وقيمة نهائية صحيحة.

---

### خاصية 6: صحة إرجاع المخزون (Inventory Restock Correctness)

```
∀ refund ∈ Refunds, ∀ item ∈ refund.line_items:
  IF item.restock_type ∈ ['return', 'cancel', 'legacy_restock']
  THEN ∃ product ∈ Products: (
    product.id = item.product_id ∧
    product.inventory_quantity_after = product.inventory_quantity_before + item.quantity
  )
```

**الوصف**: عند حدوث refund مع إرجاع للمخزون، يجب أن تزيد الكمية بشكل صحيح.

---

### خاصية 7: Idempotency للـ Webhooks

```
∀ webhook ∈ Webhooks:
  process(webhook) = process(webhook) ∘ process(webhook)
```

**الوصف**: معالجة نفس الـ webhook عدة مرات يجب أن تعطي نفس النتيجة (idempotent).

---

### خاصية 8: Atomicity للتحديثات المحلية

```
∀ update ∈ Updates:
  (update.applied_to_db = TRUE ∧ update.logged_in_sync_ops = TRUE) ∨
  (update.applied_to_db = FALSE ∧ update.logged_in_sync_ops = FALSE)
```

**الوصف**: التحديث المحلي والتسجيل في sync_operations يجب أن يحدثا معاً أو لا يحدثا (atomic transaction).

## معالجة الأخطاء

### سيناريو الخطأ 1: فشل المزامنة مع Shopify

**الشرط**: فشل إرسال التحديث إلى Shopify API

**الاستجابة**:

1. حفظ رسالة الخطأ في `products.sync_error` أو `orders.sync_error`
2. الإبقاء على `pending_sync = TRUE`
3. تسجيل الفشل في `sync_operations` مع تفاصيل الخطأ
4. إرسال إشعار للمستخدم عبر الواجهة
5. إضافة العملية لقائمة إعادة المحاولة

**الاسترداد**:

- إعادة محاولة تلقائية بعد 30 ثانية (مع exponential backoff)
- إمكانية إعادة المحاولة يدوياً من واجهة المستخدم
- عرض قائمة بالعمليات الفاشلة في لوحة التحكم

---

### سيناريو الخطأ 2: تجاوز Rate Limit

**الشرط**: تجاوز حد 2 طلب/ثانية لـ Shopify API

**الاستجابة**:

1. إيقاف الطلب الحالي
2. إضافة الطلب لقائمة الانتظار
3. انتظار الوقت المناسب (حساب الوقت المتبقي)
4. إعادة المحاولة تلقائياً

**الاسترداد**:

- استخدام queue system لإدارة الطلبات
- عرض مؤشر "في قائمة الانتظار" للمستخدم
- معالجة الطلبات بالترتيب (FIFO)

---

### سيناريو الخطأ 3: Webhook بتوقيع غير صحيح

**الشرط**: استقبال webhook بـ HMAC signature غير صالح

**الاستجابة**:

1. رفض الـ webhook فوراً (401 Unauthorized)
2. تسجيل المحاولة في security log
3. عدم معالجة البيانات
4. إشعار المسؤول إذا تكررت المحاولات

**الاسترداد**:

- لا يوجد استرداد (رفض نهائي)
- مراجعة إعدادات API Secret إذا تكررت المشكلة

---

### سيناريو الخطأ 4: تعارض في البيانات

**الشرط**: تحديث محلي وتحديث من Shopify في نفس الوقت

**الاستجابة**:

1. كشف التعارض بمقارنة timestamps
2. حفظ التعارض في `conflict_queue`
3. تطبيق استراتيجية الحل التلقائي (latest_wins)
4. إشعار المستخدم بالتعارض والحل المطبق

**الاسترداد**:

- حل تلقائي باستخدام الاستراتيجية المحددة
- إمكانية المراجعة اليدوية من واجهة إدارة التعارضات
- الاحتفاظ بسجل كامل للقيم المتعارضة

---

### سيناريو الخطأ 5: فشل معالجة Webhook

**الشرط**: خطأ أثناء معالجة webhook (database error, parsing error, etc.)

**الاستجابة**:

1. تسجيل الخطأ في `webhook_events.error_message`
2. الإبقاء على `processed = FALSE`
3. إرجاع 200 OK لـ Shopify (لتجنب إعادة الإرسال المتكررة)
4. إضافة الـ webhook لقائمة إعادة المعالجة

**الاسترداد**:

- إعادة معالجة تلقائية بعد 5 دقائق
- إمكانية إعادة المعالجة يدوياً
- عرض قائمة بالـ webhooks الفاشلة في لوحة التحكم

---

### سيناريو الخطأ 6: انقطاع الاتصال بقاعدة البيانات

**الشرط**: فشل الاتصال بـ Supabase

**الاستجابة**:

1. إرجاع خطأ 503 Service Unavailable
2. عدم تطبيق أي تحديثات
3. تسجيل الخطأ في application logs
4. إشعار فريق الدعم

**الاسترداد**:

- إعادة محاولة الاتصال تلقائياً (connection pool retry)
- عرض رسالة صيانة للمستخدم
- التحقق من حالة Supabase

## استراتيجية الاختبار

### اختبار الوحدات (Unit Testing)

**الوظائف المستهدفة**:

- `updateProductPrice()` - اختبار تحديث السعر محلياً
- `updateProductInventory()` - اختبار تحديث المخزون
- `validateWebhookSignature()` - اختبار التحقق من التوقيع
- `detectConflict()` - اختبار كشف التعارضات
- `resolveConflict()` - اختبار حل التعارضات
- `rateLimitCheck()` - اختبار فحص Rate Limit

**حالات الاختبار الرئيسية**:

1. تحديث سعر صالح → نجاح
2. تحديث سعر سالب → فشل مع رسالة خطأ
3. تحديث منتج غير موجود → فشل
4. webhook بتوقيع صحيح → TRUE
5. webhook بتوقيع خاطئ → FALSE
6. تعارض مع timestamps مختلفة → كشف التعارض
7. تحديثات متزامنة (< 5 ثوانٍ) → لا يوجد تعارض
8. 3 طلبات في ثانية واحدة → الثالث يفشل

**أدوات الاختبار**:

- Jest للاختبارات
- Supertest لاختبار API endpoints
- Mock functions لـ Shopify API calls

---

### اختبار الخصائص (Property-Based Testing)

**مكتبة الاختبار**: fast-check (JavaScript/TypeScript)

**الخصائص المستهدفة**:

#### Property Test 1: Idempotency للـ Webhooks

```typescript
import fc from "fast-check";

test("Processing same webhook multiple times gives same result", () => {
  fc.assert(
    fc.asyncProperty(
      fc.record({
        id: fc.integer(),
        title: fc.string(),
        price: fc.double({ min: 0, max: 10000 }),
        inventory: fc.integer({ min: 0, max: 1000 }),
      }),
      async (webhookPayload) => {
        // معالجة أولى
        const result1 = await processWebhook(webhookPayload);

        // معالجة ثانية لنفس الـ webhook
        const result2 = await processWebhook(webhookPayload);

        // النتيجة يجب أن تكون نفسها
        expect(result1).toEqual(result2);

        // البيانات في قاعدة البيانات يجب أن تكون نفسها
        const product = await db.products.findByShopifyId(webhookPayload.id);
        expect(product.price).toBe(webhookPayload.price);
      },
    ),
  );
});
```

#### Property Test 2: Rate Limit Enforcement

```typescript
test("Rate limiter never allows more than 2 requests per second", () => {
  fc.assert(
    fc.asyncProperty(
      fc.array(fc.integer(), { minLength: 5, maxLength: 20 }),
      async (requestTimestamps) => {
        const userId = "test-user-id";

        // محاكاة طلبات متعددة
        const results = [];
        for (const timestamp of requestTimestamps) {
          const canProceed = await rateLimiter.canMakeRequest(
            userId,
            timestamp,
          );
          results.push({ timestamp, canProceed });
        }

        // فحص: في أي نافذة ثانية واحدة، لا يوجد أكثر من 2 طلب مسموح
        for (let i = 0; i < results.length; i++) {
          const windowStart = results[i].timestamp;
          const windowEnd = windowStart + 1000;

          const allowedInWindow = results.filter(
            (r) =>
              r.timestamp >= windowStart &&
              r.timestamp < windowEnd &&
              r.canProceed,
          ).length;

          expect(allowedInWindow).toBeLessThanOrEqual(2);
        }
      },
    ),
  );
});
```

#### Property Test 3: Inventory Restock Correctness

```typescript
test("Refund always increases inventory by refunded quantity", () => {
  fc.assert(
    fc.asyncProperty(
      fc.record({
        productId: fc.uuid(),
        initialInventory: fc.integer({ min: 0, max: 1000 }),
        refundQuantity: fc.integer({ min: 1, max: 50 }),
        restockType: fc.constantFrom("return", "cancel", "legacy_restock"),
      }),
      async ({ productId, initialInventory, refundQuantity, restockType }) => {
        // إعداد المنتج
        await db.products.update({
          id: productId,
          inventory_quantity: initialInventory,
        });

        // معالجة refund
        await processRefund({
          line_items: [
            {
              product_id: productId,
              quantity: refundQuantity,
              restock_type: restockType,
            },
          ],
        });

        // التحقق من الزيادة الصحيحة
        const product = await db.products.findById(productId);
        expect(product.inventory_quantity).toBe(
          initialInventory + refundQuantity,
        );
      },
    ),
  );
});
```

#### Property Test 4: Conflict Resolution Consistency

```typescript
test("Conflict resolution always produces deterministic result", () => {
  fc.assert(
    fc.asyncProperty(
      fc.record({
        localPrice: fc.double({ min: 0, max: 10000 }),
        shopifyPrice: fc.double({ min: 0, max: 10000 }),
        localTime: fc.date(),
        shopifyTime: fc.date(),
        strategy: fc.constantFrom("shopify_wins", "local_wins", "latest_wins"),
      }),
      async ({
        localPrice,
        shopifyPrice,
        localTime,
        shopifyTime,
        strategy,
      }) => {
        const conflict = {
          local_value: { price: localPrice },
          shopify_value: { price: shopifyPrice },
          local_updated_at: localTime,
          shopify_updated_at: shopifyTime,
        };

        // حل التعارض مرتين
        const result1 = await resolveConflict(conflict, strategy);
        const result2 = await resolveConflict(conflict, strategy);

        // النتيجة يجب أن تكون نفسها
        expect(result1.final_value).toEqual(result2.final_value);

        // التحقق من صحة الاستراتيجية
        if (strategy === "shopify_wins") {
          expect(result1.final_value.price).toBe(shopifyPrice);
        } else if (strategy === "local_wins") {
          expect(result1.final_value.price).toBe(localPrice);
        } else if (strategy === "latest_wins") {
          const expectedPrice =
            shopifyTime > localTime ? shopifyPrice : localPrice;
          expect(result1.final_value.price).toBe(expectedPrice);
        }
      },
    ),
  );
});
```

### اختبار التكامل (Integration Testing)

**السيناريوهات المستهدفة**:

#### سيناريو 1: تدفق تحديث المنتج الكامل

1. المستخدم يحدث سعر منتج من الواجهة
2. Backend يحفظ التحديث محلياً
3. Backend يرسل التحديث إلى Shopify
4. Shopify يرجع تأكيد النجاح
5. Backend يحدث حالة المزامنة
6. Frontend يستقبل تأكيد المزامنة

**التحقق**:

- البيانات المحلية محدثة بشكل صحيح
- Shopify API استقبل الطلب الصحيح
- `sync_operations` يحتوي على سجل ناجح
- `pending_sync` = FALSE

---

#### سيناريو 2: استقبال ومعالجة Webhook

1. Shopify يرسل webhook لتحديث منتج
2. Backend يتحقق من التوقيع
3. Backend يحفظ الـ webhook
4. Backend يعالج التحديث
5. قاعدة البيانات محدثة
6. Frontend يستقبل التحديث (WebSocket)

**التحقق**:

- Webhook تم التحقق منه بشكل صحيح
- البيانات المحلية محدثة
- `webhook_events.processed` = TRUE
- لا توجد تعارضات غير محلولة

---

#### سيناريو 3: معالجة Refund وإرجاع المخزون

1. Shopify يرسل webhook لـ refund
2. Backend يعالج الـ refund
3. المخزون يزيد بالكمية المسترجعة
4. حالة الطلب تتحدث إلى 'refunded'
5. `sync_operations` يسجل العملية

**التحقق**:

- المخزون زاد بالكمية الصحيحة
- حالة الطلب محدثة
- سجل في `sync_operations`

---

#### سيناريو 4: حل التعارضات

1. تحديث محلي لسعر منتج
2. Shopify webhook يصل بتحديث مختلف
3. النظام يكتشف التعارض
4. التعارض يُحفظ في `conflict_queue`
5. استراتيجية 'latest_wins' تُطبق
6. القيمة النهائية تُحفظ

**التحقق**:

- التعارض تم كشفه
- الاستراتيجية طُبقت بشكل صحيح
- القيمة النهائية صحيحة حسب timestamps
- `conflict_queue.status` = 'resolved'

---

### اختبار الأداء (Performance Testing)

**المقاييس المستهدفة**:

1. **زمن الاستجابة للتحديثات المحلية**: < 200ms
2. **زمن المزامنة مع Shopify**: < 2 ثانية
3. **معالجة Webhook**: < 500ms
4. **كشف التعارضات**: < 100ms
5. **Throughput**: 100 تحديث/دقيقة لكل مستخدم

**أدوات الاختبار**:

- Apache JMeter أو Artillery لاختبار الحمل
- New Relic أو Datadog للمراقبة
- PostgreSQL EXPLAIN ANALYZE لتحليل الاستعلامات

**سيناريوهات الحمل**:

1. 10 مستخدمين متزامنين يحدثون منتجات
2. 50 webhook في الدقيقة
3. 100 عملية مزامنة متزامنة
4. 1000 منتج في قاعدة البيانات

---

### اختبار الأمان (Security Testing)

**الاختبارات المطلوبة**:

1. **HMAC Signature Validation**:
   - webhook بتوقيع صحيح → قبول
   - webhook بتوقيع خاطئ → رفض
   - webhook بدون توقيع → رفض
   - محاولة replay attack → رفض

2. **Authorization**:
   - مستخدم يحاول تحديث منتج مستخدم آخر → رفض
   - مستخدم بدون token → رفض
   - token منتهي الصلاحية → رفض

3. **Input Validation**:
   - سعر سالب → رفض
   - مخزون سالب → رفض
   - SQL injection في البحث → حماية
   - XSS في التعليقات → تنظيف

4. **Rate Limiting**:
   - تجاوز الحد → رفض الطلبات الزائدة
   - DDoS simulation → حماية

**أدوات الاختبار**:

- OWASP ZAP للاختبار الأمني
- Burp Suite لاختبار الثغرات
- Jest للاختبارات الآلية

## اعتبارات الأداء

### 1. تحسين استعلامات قاعدة البيانات

**Indexes المطلوبة**:

```sql
-- للبحث السريع عن المنتجات المعلقة
CREATE INDEX idx_products_pending_sync ON products(pending_sync) WHERE pending_sync = TRUE;

-- للبحث بـ Shopify ID
CREATE INDEX idx_products_shopify_id ON products(shopify_id);
CREATE INDEX idx_orders_shopify_id ON orders(shopify_id);

-- للبحث الزمني
CREATE INDEX idx_sync_ops_created_at ON sync_operations(created_at DESC);
CREATE INDEX idx_webhook_events_received_at ON webhook_events(received_at DESC);

-- للبحث في JSONB
CREATE INDEX idx_orders_notes ON orders USING GIN(notes);
```

**Query Optimization**:

- استخدام `SELECT` محدد بدلاً من `SELECT *`
- Pagination للقوائم الطويلة
- Caching للبيانات المتكررة (Redis)
- Connection pooling لـ Supabase

---

### 2. Rate Limiting Strategy

**التنفيذ**:

```typescript
class RateLimiter {
  private requestQueue: Map<string, number[]> = new Map();
  private readonly MAX_REQUESTS_PER_SECOND = 2;

  async canMakeRequest(userId: string): Promise<boolean> {
    const now = Date.now();
    const userRequests = this.requestQueue.get(userId) || [];

    // تنظيف الطلبات القديمة (أكثر من ثانية)
    const recentRequests = userRequests.filter((t) => now - t < 1000);

    if (recentRequests.length >= this.MAX_REQUESTS_PER_SECOND) {
      return false;
    }

    recentRequests.push(now);
    this.requestQueue.set(userId, recentRequests);
    return true;
  }

  async waitForSlot(userId: string): Promise<void> {
    while (!(await this.canMakeRequest(userId))) {
      await sleep(100); // انتظر 100ms
    }
  }
}
```

**Optimization**:

- استخدام Redis لتتبع Rate Limits عبر multiple servers
- Sliding window algorithm لدقة أفضل
- Priority queue للطلبات المهمة

---

### 3. Webhook Processing Optimization

**Async Processing**:

- معالجة Webhooks في background jobs
- استخدام Bull Queue أو RabbitMQ
- Parallel processing للـ webhooks المستقلة

**Batching**:

- تجميع التحديثات المتعددة في batch واحد
- Bulk updates لقاعدة البيانات
- تقليل عدد الطلبات لـ Shopify

---

### 4. Caching Strategy

**Redis Caching**:

```typescript
// Cache للمنتجات المتكررة
const cacheKey = `product:${productId}`;
let product = await redis.get(cacheKey);

if (!product) {
  product = await db.products.findById(productId);
  await redis.setex(cacheKey, 300, JSON.stringify(product)); // 5 دقائق
}

// Invalidate cache عند التحديث
await redis.del(`product:${productId}`);
```

**Cache Invalidation**:

- عند تحديث محلي → invalidate فوراً
- عند webhook → invalidate بعد المعالجة
- TTL قصير للبيانات الحساسة (1-5 دقائق)

---

### 5. Database Connection Pooling

**Supabase Configuration**:

```typescript
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: {
    poolSize: 20, // عدد الاتصالات المتزامنة
  },
  auth: {
    persistSession: false,
  },
});
```

---

### 6. Optimistic UI Updates

**Frontend Strategy**:

```typescript
// تحديث فوري في الواجهة
const optimisticUpdate = (productId, newPrice) => {
  setProducts((prev) =>
    prev.map((p) =>
      p.id === productId ? { ...p, price: newPrice, syncing: true } : p,
    ),
  );
};

// Rollback في حالة الفشل
const rollbackUpdate = (productId, originalPrice) => {
  setProducts((prev) =>
    prev.map((p) =>
      p.id === productId
        ? { ...p, price: originalPrice, syncing: false, error: true }
        : p,
    ),
  );
};
```

---

### 7. Monitoring & Metrics

**Key Performance Indicators (KPIs)**:

- Average sync time
- Sync success rate
- Webhook processing time
- Conflict resolution rate
- Rate limit hits
- Database query time

**Monitoring Tools**:

- Application Performance Monitoring (APM): New Relic, Datadog
- Database monitoring: Supabase Dashboard
- Error tracking: Sentry
- Logging: Winston + CloudWatch

**Alerts**:

- Sync failure rate > 5%
- Average sync time > 5 seconds
- Webhook processing time > 1 second
- Database connection pool exhausted
- Rate limit exceeded frequently

## اعتبارات الأمان

### 1. HMAC Signature Verification

**التنفيذ**:

```typescript
import crypto from "crypto";

function validateWebhookSignature(
  payload: string,
  hmacHeader: string,
  apiSecret: string,
): boolean {
  const hash = crypto
    .createHmac("sha256", apiSecret)
    .update(payload, "utf8")
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader));
}
```

**Best Practices**:

- استخدام `crypto.timingSafeEqual()` لمنع timing attacks
- التحقق من التوقيع قبل أي معالجة
- تسجيل المحاولات الفاشلة
- Rate limiting للـ webhook endpoints

---

### 2. API Token Security

**التخزين الآمن**:

- تخزين Shopify access tokens مشفرة في قاعدة البيانات
- استخدام environment variables للـ API secrets
- عدم تسجيل tokens في logs
- Rotation دورية للـ tokens

**Encryption**:

```typescript
import { createCipheriv, createDecipheriv } from "crypto";

function encryptToken(token: string): string {
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, IV);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
}

function decryptToken(encryptedToken: string): string {
  const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, IV);
  let decrypted = decipher.update(encryptedToken, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

---

### 3. Input Validation & Sanitization

**Validation Rules**:

```typescript
const productUpdateSchema = {
  price: {
    type: "number",
    min: 0,
    max: 1000000,
    required: false,
  },
  inventory_quantity: {
    type: "integer",
    min: 0,
    max: 1000000,
    required: false,
  },
  title: {
    type: "string",
    minLength: 1,
    maxLength: 255,
    required: false,
  },
};

function validateProductUpdate(data: any): ValidationResult {
  // التحقق من النوع والقيود
  // تنظيف HTML tags
  // منع SQL injection
  // منع XSS
}
```

**Sanitization**:

- استخدام parameterized queries لمنع SQL injection
- تنظيف HTML من التعليقات والملاحظات
- Escape special characters
- Validate UUIDs format

---

### 4. Authorization & Access Control

**Row Level Security (RLS)**:

```sql
-- التأكد من أن المستخدم يصل فقط لبياناته
CREATE POLICY "Users can only access their own products"
ON products FOR ALL
USING (user_id = auth.uid());

CREATE POLICY "Users can only access their own orders"
ON orders FOR ALL
USING (user_id = auth.uid());
```

**JWT Verification**:

```typescript
function verifyToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
}
```

---

### 5. Rate Limiting & DDoS Protection

**API Rate Limiting**:

```typescript
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // 100 طلب لكل IP
  message: "Too many requests from this IP",
});

app.use("/api/", apiLimiter);
```

**Webhook Rate Limiting**:

```typescript
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 60, // 60 webhook في الدقيقة
  keyGenerator: (req) => req.headers["x-shopify-shop-domain"],
});

app.use("/api/webhooks/", webhookLimiter);
```

---

### 6. Audit Logging

**Security Events to Log**:

- Failed authentication attempts
- Invalid webhook signatures
- Unauthorized access attempts
- Data modifications (who, what, when)
- API rate limit violations

**Log Structure**:

```typescript
interface SecurityLog {
  timestamp: Date;
  event_type:
    | "auth_failed"
    | "invalid_webhook"
    | "unauthorized_access"
    | "rate_limit_exceeded";
  user_id?: string;
  ip_address: string;
  user_agent: string;
  details: any;
}
```

---

### 7. HTTPS & Transport Security

**Requirements**:

- جميع الاتصالات عبر HTTPS فقط
- TLS 1.2 أو أحدث
- Valid SSL certificates
- HSTS headers

**Express Configuration**:

```typescript
app.use((req, res, next) => {
  if (
    req.headers["x-forwarded-proto"] !== "https" &&
    process.env.NODE_ENV === "production"
  ) {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);
```

---

### 8. Error Handling & Information Disclosure

**Safe Error Messages**:

```typescript
// ❌ خطأ - يكشف معلومات حساسة
res.status(500).json({
  error:
    "Database connection failed: Connection to postgres://user:pass@host:5432/db failed",
});

// ✅ صحيح - رسالة عامة
res.status(500).json({
  error: "An internal error occurred. Please try again later.",
  errorId: "ERR-12345", // للمراجعة في logs
});
```

**Logging vs User Messages**:

- Log detailed errors internally
- Return generic messages to users
- Use error IDs for correlation
- Never expose stack traces in production

## الاعتماديات (Dependencies)

### Backend Dependencies

**Core Dependencies**:

```json
{
  "express": "^4.18.2",
  "axios": "^1.6.0",
  "@supabase/supabase-js": "^2.38.0",
  "jsonwebtoken": "^9.0.2",
  "dotenv": "^16.3.1"
}
```

**New Dependencies للمزامنة الثنائية**:

```json
{
  "bull": "^4.11.5", // Queue management للـ background jobs
  "ioredis": "^5.3.2", // Redis client للـ caching و rate limiting
  "express-rate-limit": "^7.1.5", // API rate limiting
  "helmet": "^7.1.0", // Security headers
  "winston": "^3.11.0", // Logging
  "joi": "^17.11.0" // Input validation
}
```

**Development Dependencies**:

```json
{
  "jest": "^29.7.0",
  "supertest": "^6.3.3",
  "fast-check": "^3.15.0", // Property-based testing
  "@types/node": "^20.10.0",
  "@types/express": "^4.17.21",
  "ts-node": "^10.9.2",
  "typescript": "^5.3.3"
}
```

---

### Frontend Dependencies

**Existing Dependencies**:

```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "axios": "^1.6.0",
  "lucide-react": "^0.294.0"
}
```

**New Dependencies**:

```json
{
  "socket.io-client": "^4.6.0", // Real-time updates via WebSocket
  "react-query": "^3.39.3", // Data fetching & caching
  "zustand": "^4.4.7" // State management
}
```

---

### External Services

**Shopify Admin REST API**:

- Version: 2024-01
- Rate Limit: 2 requests/second
- Authentication: OAuth 2.0 + Access Token
- Endpoints Used:
  - `GET /admin/api/2024-01/products.json`
  - `PUT /admin/api/2024-01/products/{id}.json`
  - `GET /admin/api/2024-01/orders.json`
  - `PUT /admin/api/2024-01/orders/{id}.json`
  - `POST /admin/api/2024-01/orders/{id}/notes.json`

**Shopify Webhooks**:

- Topics Required:
  - `products/create`
  - `products/update`
  - `products/delete`
  - `orders/updated`
  - `refunds/create`
  - `inventory_levels/update`
- Verification: HMAC SHA256
- Delivery: HTTPS POST

**Supabase (PostgreSQL)**:

- Version: PostgreSQL 15
- Features Used:
  - Row Level Security (RLS)
  - JSONB columns
  - Indexes (B-tree, GIN)
  - Triggers (optional)

**Redis** (Optional but Recommended):

- Version: 7.x
- Use Cases:
  - Rate limiting tracking
  - Caching frequently accessed data
  - Session management
  - Queue management (with Bull)

---

### Infrastructure Requirements

**Minimum Server Requirements**:

- CPU: 2 cores
- RAM: 4 GB
- Storage: 20 GB SSD
- Network: 100 Mbps

**Recommended for Production**:

- CPU: 4+ cores
- RAM: 8+ GB
- Storage: 50+ GB SSD
- Network: 1 Gbps
- Load Balancer
- Auto-scaling capability

**Environment Variables**:

```bash
# Existing
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
JWT_SECRET=...
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:5000

# New for Bidirectional Sync
REDIS_URL=redis://localhost:6379
SHOPIFY_API_VERSION=2024-01
WEBHOOK_SECRET=...
ENCRYPTION_KEY=...
ENCRYPTION_IV=...
LOG_LEVEL=info
NODE_ENV=production
```

---

### Third-Party Services (Optional)

**Monitoring & Logging**:

- New Relic APM
- Datadog
- Sentry (Error tracking)
- CloudWatch Logs

**Infrastructure**:

- AWS / Azure / Google Cloud
- Vercel / Netlify (Frontend)
- Heroku / Railway (Backend)
- Upstash Redis (Managed Redis)

---

### Development Tools

**Required**:

- Node.js 18+ / 20+
- npm / yarn / pnpm
- Git
- PostgreSQL client (psql)
- Redis client (redis-cli)

**Recommended**:

- VS Code with extensions:
  - ESLint
  - Prettier
  - TypeScript
  - REST Client
- Postman / Insomnia (API testing)
- ngrok / Cloudflare Tunnel (Webhook testing)
- Docker (للبيئة المحلية)

---

### API Documentation

**Shopify API Documentation**:

- https://shopify.dev/docs/api/admin-rest
- https://shopify.dev/docs/api/webhooks

**Supabase Documentation**:

- https://supabase.com/docs

**Bull Queue Documentation**:

- https://github.com/OptimalBits/bull

**Redis Documentation**:

- https://redis.io/docs/

## خطة التنفيذ المقترحة

### المرحلة 1: إعداد البنية التحتية (أسبوع 1)

**المهام**:

1. إنشاء الجداول الجديدة في قاعدة البيانات:
   - `sync_operations`
   - `conflict_queue`
   - `webhook_events`
   - `rate_limit_tracking`

2. تحديث الجداول الموجودة:
   - إضافة أعمدة المزامنة لـ `products`
   - إضافة أعمدة المزامنة لـ `orders`

3. إعداد Redis:
   - تثبيت وتكوين Redis
   - إعداد connection pooling

4. تكوين Webhooks في Shopify:
   - تسجيل webhook endpoints
   - إعداد ngrok/Cloudflare Tunnel للتطوير

**المخرجات**:

- قاعدة بيانات محدثة بالجداول الجديدة
- Redis جاهز للاستخدام
- Webhooks مسجلة في Shopify

---

### المرحلة 2: تطوير خدمات Backend الأساسية (أسبوع 2-3)

**المهام**:

1. تطوير `ProductUpdateService`:
   - `updatePrice()`
   - `updateInventory()`
   - `syncToShopify()`

2. تطوير `RateLimiterService`:
   - `canMakeRequest()`
   - `waitForSlot()`
   - `recordRequest()`

3. تطوير `SyncOperationsLogger`:
   - `logOperation()`
   - `getOperationHistory()`
   - `retryFailedOperation()`

4. إنشاء API endpoints:
   - `POST /api/products/:id/update-price`
   - `POST /api/products/:id/update-inventory`
   - `GET /api/sync-operations`
   - `POST /api/sync-operations/:id/retry`

**المخرجات**:

- خدمات Backend جاهزة للتحديثات المحلية
- API endpoints للتحديثات
- Rate limiting مطبق

---

### المرحلة 3: تطوير معالجة Webhooks (أسبوع 3-4)

**المهام**:

1. تطوير `WebhookHandlerService`:
   - `validateWebhook()`
   - `handleProductUpdate()`
   - `handleOrderUpdate()`
   - `handleRefundCreate()`

2. تطوير `ConflictResolutionService`:
   - `detectConflict()`
   - `resolveConflict()`
   - `queueConflict()`

3. إنشاء webhook endpoints:
   - `POST /api/webhooks/products/create`
   - `POST /api/webhooks/products/update`
   - `POST /api/webhooks/products/delete`
   - `POST /api/webhooks/orders/updated`
   - `POST /api/webhooks/refunds/create`

4. إعداد background job processing (Bull Queue)

**المخرجات**:

- معالجة Webhooks جاهزة
- كشف وحل التعارضات مطبق
- Background jobs للمعالجة الـ async

---

### المرحلة 4: تطوير إدارة الطلبات (أسبوع 4-5)

**المهام**:

1. تطوير `OrderManagementService`:
   - `getOrderDetails()`
   - `updateOrderStatus()`
   - `addOrderNote()`
   - `cancelOrder()`

2. إنشاء API endpoints:
   - `GET /api/orders/:id/details`
   - `POST /api/orders/:id/update-status`
   - `POST /api/orders/:id/notes`
   - `POST /api/orders/:id/cancel`

3. تطوير معالجة Refunds:
   - `processRefundCreate()`
   - إرجاع المخزون التلقائي

**المخرجات**:

- إدارة الطلبات كاملة
- إضافة التعليقات والملاحظات
- معالجة Refunds وإرجاع المخزون

---

### المرحلة 5: تطوير Frontend (أسبوع 5-6)

**المهام**:

1. تحديث صفحة المنتجات:
   - إضافة أزرار تعديل السعر والمخزون
   - Optimistic UI updates
   - عرض حالة المزامنة

2. تحديث صفحة الطلبات:
   - عرض تفاصيل الطلب الكاملة
   - إضافة تعليقات
   - تغيير حالة الطلب

3. إنشاء صفحة سجل المزامنة:
   - عرض جميع عمليات المزامنة
   - فلترة حسب الحالة والنوع
   - إعادة محاولة العمليات الفاشلة

4. إنشاء صفحة إدارة التعارضات:
   - عرض التعارضات المعلقة
   - حل يدوي للتعارضات
   - عرض سجل التعارضات المحلولة

5. إضافة Real-time updates (WebSocket):
   - تحديثات فورية عند استقبال webhooks
   - إشعارات للمستخدم

**المخرجات**:

- واجهة مستخدم محدثة بالميزات الجديدة
- Optimistic UI للتحديثات
- Real-time updates

---

### المرحلة 6: الاختبار (أسبوع 6-7)

**المهام**:

1. كتابة Unit Tests:
   - اختبار جميع الخدمات
   - اختبار API endpoints
   - Coverage > 80%

2. كتابة Property-Based Tests:
   - Idempotency للـ webhooks
   - Rate limiting
   - Conflict resolution
   - Inventory restock

3. Integration Testing:
   - تدفق تحديث المنتج الكامل
   - معالجة Webhooks
   - حل التعارضات
   - معالجة Refunds

4. Performance Testing:
   - Load testing
   - Stress testing
   - Database query optimization

5. Security Testing:
   - HMAC validation
   - Authorization
   - Input validation
   - Rate limiting

**المخرجات**:

- Test suite كامل
- Coverage report
- Performance benchmarks
- Security audit report

---

### المرحلة 7: النشر والمراقبة (أسبوع 7-8)

**المهام**:

1. إعداد بيئة Production:
   - تكوين servers
   - إعداد Load balancer
   - تكوين Redis cluster

2. إعداد Monitoring:
   - Application monitoring (New Relic/Datadog)
   - Error tracking (Sentry)
   - Log aggregation (CloudWatch)
   - Alerts configuration

3. النشر التدريجي:
   - Staging deployment
   - Beta testing مع مستخدمين محددين
   - Production deployment
   - Monitoring post-deployment

4. Documentation:
   - API documentation
   - User guide
   - Admin guide
   - Troubleshooting guide

**المخرجات**:

- نظام منشور في Production
- Monitoring و Alerts مفعلة
- Documentation كاملة

---

### المرحلة 8: الصيانة والتحسين (مستمر)

**المهام**:

1. مراقبة الأداء والأخطاء
2. تحسين الاستعلامات البطيئة
3. معالجة التعارضات المتكررة
4. تحديث Documentation
5. جمع feedback من المستخدمين
6. تطوير ميزات إضافية

**المخرجات**:

- نظام مستقر ومحسّن
- Feedback loop مع المستخدمين
- خطة للميزات المستقبلية

---

## الجدول الزمني الإجمالي

| المرحلة                | المدة        | الأسبوع |
| ---------------------- | ------------ | ------- |
| إعداد البنية التحتية   | 1 أسبوع      | 1       |
| خدمات Backend الأساسية | 2 أسبوع      | 2-3     |
| معالجة Webhooks        | 2 أسبوع      | 3-4     |
| إدارة الطلبات          | 2 أسبوع      | 4-5     |
| تطوير Frontend         | 2 أسبوع      | 5-6     |
| الاختبار               | 2 أسبوع      | 6-7     |
| النشر والمراقبة        | 2 أسبوع      | 7-8     |
| **الإجمالي**           | **8 أسابيع** |         |

**ملاحظة**: الجدول الزمني قابل للتعديل حسب حجم الفريق والأولويات.
