/* eslint-disable camelcase */

exports.shorthands = undefined;

const repairSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS data jsonb,
  ADD COLUMN IF NOT EXISTS shopify_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS local_updated_at timestamptz;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS data jsonb,
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS shopify_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS local_updated_at timestamptz;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS data jsonb,
  ADD COLUMN IF NOT EXISTS shopify_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_sync boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sync_error text;

CREATE TABLE IF NOT EXISTS public.warehouse_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  last_scanned_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  last_movement_type text DEFAULT 'in' CHECK (last_movement_type IN ('in', 'out')),
  last_movement_quantity integer NOT NULL DEFAULT 0 CHECK (last_movement_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.warehouse_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('in', 'out')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  scan_code text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, shopify_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.products
  WHERE store_id IS NOT NULL
    AND shopify_id IS NOT NULL
)
DELETE FROM public.products p
USING ranked
WHERE p.id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, shopify_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.orders
  WHERE store_id IS NOT NULL
    AND shopify_id IS NOT NULL
)
DELETE FROM public.orders o
USING ranked
WHERE o.id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, shopify_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.customers
  WHERE store_id IS NOT NULL
    AND shopify_id IS NOT NULL
)
DELETE FROM public.customers c
USING ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, sku
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.warehouse_inventory
  WHERE store_id IS NOT NULL
    AND sku IS NOT NULL
)
DELETE FROM public.warehouse_inventory wi
USING ranked
WHERE wi.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_store_shopify_unique
  ON public.products (store_id, shopify_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_store_shopify_unique
  ON public.orders (store_id, shopify_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_store_shopify_unique
  ON public.customers (store_id, shopify_id);

CREATE UNIQUE INDEX IF NOT EXISTS warehouse_inventory_store_id_sku_unique
  ON public.warehouse_inventory (store_id, sku);

CREATE INDEX IF NOT EXISTS warehouse_inventory_store_product_idx
  ON public.warehouse_inventory (store_id, product_id);

CREATE INDEX IF NOT EXISTS warehouse_inventory_store_last_scanned_idx
  ON public.warehouse_inventory (store_id, last_scanned_at);

CREATE INDEX IF NOT EXISTS warehouse_scan_events_store_created_idx
  ON public.warehouse_scan_events (store_id, created_at);

CREATE INDEX IF NOT EXISTS warehouse_scan_events_store_sku_idx
  ON public.warehouse_scan_events (store_id, sku);
`;

exports.up = (pgm) => {
  pgm.sql(repairSql);
};

exports.down = () => {};
