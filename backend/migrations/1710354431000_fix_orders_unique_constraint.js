/**
 * Migration: Fix Orders Unique Constraint
 * Replaces partial unique index with full index using COALESCE
 * This allows bulk upsert operations to work properly
 */

/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the partial unique index for orders
  pgm.sql(`
    DROP INDEX IF EXISTS idx_orders_store_shopify_unique;
  `);

  // Create a full unique index using COALESCE to handle NULLs
  // This allows upsert to work properly with onConflict
  pgm.sql(`
    CREATE UNIQUE INDEX idx_orders_store_shopify_unique 
    ON public.orders (
      COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), 
      COALESCE(shopify_id, '')
    );
  `);

  console.log(
    "✅ Fixed orders unique constraint - now supports bulk upsert operations",
  );
};

exports.down = (pgm) => {
  // Revert to partial index
  pgm.sql(`
    DROP INDEX IF EXISTS idx_orders_store_shopify_unique;
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_shopify_unique 
    ON public.orders (store_id, shopify_id) 
    WHERE store_id IS NOT NULL AND shopify_id IS NOT NULL;
  `);

  console.log("✅ Reverted to partial unique index");
};
