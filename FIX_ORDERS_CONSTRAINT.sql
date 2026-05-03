-- Fix Orders Unique Constraint
-- This migration fixes the orders table unique constraint to support bulk upsert operations
-- The partial index doesn't work with Supabase's onConflict parameter
-- So we replace it with a full index using COALESCE to handle NULL values

-- Drop the existing partial unique index
DROP INDEX IF EXISTS idx_orders_store_shopify_unique;

-- Create a full unique index using COALESCE to handle NULLs
-- This allows bulk upsert operations to work properly with onConflict
CREATE UNIQUE INDEX idx_orders_store_shopify_unique 
ON public.orders (
  COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), 
  COALESCE(shopify_id, '')
);

-- Verify the index was created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'orders' 
  AND indexname = 'idx_orders_store_shopify_unique';
