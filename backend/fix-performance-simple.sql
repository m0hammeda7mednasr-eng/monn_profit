-- Minimal indexes to stabilize the slowest list and search paths.
-- Use this file first if you want the lowest-risk subset.

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL THEN
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
        AND column_name IN ('store_id', 'customer_email', 'updated_at')
      GROUP BY table_name
      HAVING COUNT(*) = 3
    ) THEN
      EXECUTE '
        CREATE INDEX IF NOT EXISTS idx_orders_store_customer_email_updated_at
        ON public.orders (store_id, customer_email, updated_at DESC)
      ';
    END IF;
  END IF;

  IF to_regclass('public.products') IS NOT NULL
     AND EXISTS (
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

  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
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

  IF to_regclass('public.notifications') IS NOT NULL
     AND EXISTS (
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

  IF to_regclass('public.shopify_tokens') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'shopify_tokens'
         AND column_name IN ('store_id', 'updated_at')
       GROUP BY table_name
       HAVING COUNT(*) = 2
     ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shopify_tokens_store_updated_at ON public.shopify_tokens (store_id, updated_at DESC)';
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
END $$;
