-- Add request-path indexes for auth, store resolution, and product listing
-- Run this SQL script on your Supabase database

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'store_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'updated_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_products_store_updated_at
      ON public.products (store_id, updated_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'user_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'products'
         AND column_name = 'updated_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_products_user_updated_at
      ON public.products (user_id, updated_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'store_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'created_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_orders_store_created_at
      ON public.orders (store_id, created_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'user_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name = 'created_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_orders_user_created_at
      ON public.orders (user_id, created_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'store_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'created_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_customers_store_created_at
      ON public.customers (store_id, created_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'user_id'
     )
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'customers'
         AND column_name = 'created_at'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_customers_user_created_at
      ON public.customers (user_id, created_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'permissions'
         AND column_name = 'user_id'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_permissions_user_id
      ON public.permissions (user_id)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_stores') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_stores'
         AND column_name = 'user_id'
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_user_stores_user_id
      ON public.user_stores (user_id)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.shopify_tokens') IS NOT NULL
     AND EXISTS (
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
END $$;

DO $$
BEGIN
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
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_shopify_tokens_store_updated_at
      ON public.shopify_tokens (store_id, updated_at DESC)
    ';
  END IF;
END $$;

-- Verify the new indexes
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_products_store_updated_at',
    'idx_products_user_updated_at',
    'idx_orders_store_created_at',
    'idx_orders_user_created_at',
    'idx_customers_store_created_at',
    'idx_customers_user_created_at',
    'idx_permissions_user_id',
    'idx_user_stores_user_id',
    'idx_shopify_tokens_user_store_updated_at',
    'idx_shopify_tokens_store_updated_at'
  )
ORDER BY indexname;
