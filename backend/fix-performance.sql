-- Safe performance indexes for the current hot paths.
-- This script is defensive: it only creates indexes when the table/columns exist.

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders (user_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'shopify_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_shopify_id ON public.orders (shopify_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_store_created_at ON public.orders (store_id, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_user_created_at ON public.orders (user_id, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_store_updated_at ON public.orders (store_id, updated_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_user_updated_at ON public.orders (user_id, updated_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'local_updated_at'
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_local_updated_at
        ON public.orders (local_updated_at DESC)
        WHERE local_updated_at IS NOT NULL
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'local_updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_store_local_updated_at
        ON public.orders (store_id, local_updated_at DESC)
        WHERE local_updated_at IS NOT NULL
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'local_updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_user_local_updated_at
        ON public.orders (user_id, local_updated_at DESC)
        WHERE local_updated_at IS NOT NULL
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('shopify_id', 'store_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_shopify_store_lookup ON public.orders (shopify_id, store_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('shopify_id', 'user_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_shopify_user_lookup ON public.orders (shopify_id, user_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'fulfillment_status', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_store_unfulfilled_created_at
        ON public.orders (store_id, created_at DESC)
        WHERE fulfillment_status IS NULL OR fulfillment_status <> ''fulfilled''
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('fulfillment_status', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_unfulfilled_created_at
        ON public.orders (created_at DESC)
        WHERE fulfillment_status IS NULL OR fulfillment_status <> ''fulfilled''
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'fulfillment_status', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_user_unfulfilled_created_at
        ON public.orders (user_id, created_at DESC)
        WHERE fulfillment_status IS NULL OR fulfillment_status <> ''fulfilled''
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'customer_email', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_store_customer_email_updated_at
        ON public.orders (store_id, customer_email, updated_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'customer_email', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_user_customer_email_updated_at
        ON public.orders (user_id, customer_email, updated_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('store_id', 'order_number')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_store_order_number ON public.orders (store_id, order_number DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('user_id', 'order_number')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_orders_user_order_number ON public.orders (user_id, order_number DESC)';
    END IF;
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_user_id ON public.products (user_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('store_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_store_updated_at ON public.products (store_id, updated_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('user_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_user_updated_at ON public.products (user_id, updated_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('shopify_id', 'store_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_shopify_store_lookup ON public.products (shopify_id, store_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name IN ('shopify_id', 'user_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_products_shopify_user_lookup ON public.products (shopify_id, user_id)';
    END IF;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name = 'user_id'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_user_id ON public.customers (user_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name IN ('store_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_store_created_at ON public.customers (store_id, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name IN ('user_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_user_created_at ON public.customers (user_id, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name IN ('shopify_id', 'store_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_shopify_store_lookup ON public.customers (shopify_id, store_id)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customers'
        AND column_name IN ('shopify_id', 'user_id')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_customers_shopify_user_lookup ON public.customers (shopify_id, user_id)';
    END IF;
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
        AND column_name IN ('user_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON public.notifications (user_id, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
        AND column_name IN ('user_id', 'is_read', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_notifications_user_is_read_created_at
        ON public.notifications (user_id, is_read, created_at DESC)
      ';
    END IF;
  END IF;

  IF to_regclass('public.permissions') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'permissions'
         AND column_name = 'user_id'
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON public.permissions (user_id)';
  END IF;

  IF to_regclass('public.user_stores') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_stores'
         AND column_name = 'user_id'
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_user_stores_user_id ON public.user_stores (user_id)';
  END IF;

  IF to_regclass('public.order_comments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'order_comments'
         AND column_name IN ('order_id', 'created_at')
       GROUP BY table_name
       HAVING COUNT(*) = 2
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_order_comments_order_created_at ON public.order_comments (order_id, created_at ASC)';
  END IF;

  IF to_regclass('public.sync_operations') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sync_operations'
        AND column_name IN ('operation_type', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sync_operations_type_created_at ON public.sync_operations (operation_type, created_at DESC)';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sync_operations'
        AND column_name IN ('entity_id', 'operation_type', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_sync_operations_entity_type_created_at
        ON public.sync_operations (entity_id, operation_type, created_at DESC)
      ';
    END IF;
  END IF;

  IF to_regclass('public.shopify_tokens') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shopify_tokens'
        AND column_name IN ('user_id', 'store_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_shopify_tokens_user_store_updated_at
        ON public.shopify_tokens (user_id, store_id, updated_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shopify_tokens'
        AND column_name IN ('store_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_shopify_tokens_store_updated_at
        ON public.shopify_tokens (store_id, updated_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shopify_tokens'
        AND column_name IN ('user_id', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_shopify_tokens_user_updated_at
        ON public.shopify_tokens (user_id, updated_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shopify_tokens'
        AND column_name IN ('user_id', 'shop')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_shopify_tokens_user_shop
        ON public.shopify_tokens (user_id, shop)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shopify_tokens'
        AND column_name IN ('shop', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_shopify_tokens_shop_updated_at_hot_path
        ON public.shopify_tokens (shop, updated_at DESC)
      ';
    END IF;
  END IF;

  IF to_regclass('public.operational_costs') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'operational_costs'
        AND column_name IN ('user_id', 'created_at')
      GROUP BY table_name
      HAVING COUNT(*) = 2
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_operational_costs_user_created_at
        ON public.operational_costs (user_id, created_at DESC)
      ';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'operational_costs'
        AND column_name IN ('product_id', 'user_id', 'is_active')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_operational_costs_product_user_active
        ON public.operational_costs (product_id, user_id)
        WHERE is_active = true
      ';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
    EXECUTE 'ANALYZE public.orders';
  END IF;
  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'ANALYZE public.products';
  END IF;
  IF to_regclass('public.customers') IS NOT NULL THEN
    EXECUTE 'ANALYZE public.customers';
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'ANALYZE public.notifications';
  END IF;
  IF to_regclass('public.shopify_tokens') IS NOT NULL THEN
    EXECUTE 'ANALYZE public.shopify_tokens';
  END IF;
END $$;
