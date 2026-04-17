-- Add runtime observability and hot-path indexes for dashboard profitability,
-- notifications, and Shopify token lookups.
-- Run this SQL script on your Supabase database if you are not using
-- node-pg-migrate for backend migrations.

DO $$
BEGIN
  IF to_regclass('public.operational_costs') IS NOT NULL
     AND EXISTS (
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
END $$;

DO $$
BEGIN
  IF to_regclass('public.operational_costs') IS NOT NULL
     AND EXISTS (
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
END $$;

DO $$
BEGIN
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
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
      ON public.notifications (user_id, created_at DESC)
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL
     AND EXISTS (
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
END $$;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'notifications'
         AND column_name IN ('type', 'user_id', 'entity_id', 'created_at')
       GROUP BY table_name
       HAVING COUNT(*) = 4
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_notifications_type_user_entity_created_at
      ON public.notifications (type, user_id, entity_id, created_at DESC)
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
         AND column_name IN ('user_id', 'updated_at')
       GROUP BY table_name
       HAVING COUNT(*) = 2
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_shopify_tokens_user_updated_at
      ON public.shopify_tokens (user_id, updated_at DESC)
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
         AND column_name IN ('user_id', 'shop')
       GROUP BY table_name
       HAVING COUNT(*) = 2
     ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS idx_shopify_tokens_user_shop
      ON public.shopify_tokens (user_id, shop)
    ';
  END IF;
END $$;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_operational_costs_user_created_at',
    'idx_operational_costs_product_user_active',
    'idx_notifications_user_created_at',
    'idx_notifications_user_is_read_created_at',
    'idx_notifications_type_user_entity_created_at',
    'idx_shopify_tokens_user_updated_at',
    'idx_shopify_tokens_user_shop'
  )
ORDER BY indexname;
