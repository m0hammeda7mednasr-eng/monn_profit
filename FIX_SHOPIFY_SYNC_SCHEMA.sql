-- Repair missing Shopify sync schema pieces on Supabase/Postgres.
-- Run this once against the target database if Shopify sync is failing with:
-- - no unique or exclusion constraint matching the ON CONFLICT specification
-- - missing orders.customer_phone
-- - missing customers.last_synced_at
-- - missing warehouse_scan_events / warehouse_inventory

create extension if not exists pgcrypto;

alter table public.products
  add column if not exists data jsonb,
  add column if not exists shopify_updated_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists pending_sync boolean not null default false,
  add column if not exists sync_error text,
  add column if not exists local_updated_at timestamptz;

alter table public.orders
  add column if not exists data jsonb,
  add column if not exists customer_phone text,
  add column if not exists shopify_updated_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists pending_sync boolean not null default false,
  add column if not exists sync_error text,
  add column if not exists local_updated_at timestamptz;

alter table public.customers
  add column if not exists data jsonb,
  add column if not exists shopify_updated_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists pending_sync boolean not null default false,
  add column if not exists sync_error text;

create table if not exists public.warehouse_inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text not null,
  product_id uuid references public.products(id) on delete set null,
  quantity integer not null default 0 check (quantity >= 0),
  last_scanned_at timestamptz default current_timestamp,
  last_movement_type text default 'in' check (last_movement_type in ('in', 'out')),
  last_movement_quantity integer not null default 0 check (last_movement_quantity >= 0),
  created_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp
);

create table if not exists public.warehouse_scan_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text not null,
  product_id uuid references public.products(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  movement_type text not null check (movement_type in ('in', 'out')),
  quantity integer not null default 1 check (quantity > 0),
  scan_code text not null,
  note text,
  created_at timestamptz not null default current_timestamp
);

with ranked as (
  select
    id,
    row_number() over (
      partition by store_id, shopify_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.products
  where store_id is not null
    and shopify_id is not null
)
delete from public.products p
using ranked
where p.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by store_id, shopify_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.orders
  where store_id is not null
    and shopify_id is not null
)
delete from public.orders o
using ranked
where o.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by store_id, shopify_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.customers
  where store_id is not null
    and shopify_id is not null
)
delete from public.customers c
using ranked
where c.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by store_id, sku
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.warehouse_inventory
  where store_id is not null
    and sku is not null
)
delete from public.warehouse_inventory wi
using ranked
where wi.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_products_store_shopify_unique
  on public.products (store_id, shopify_id);

create unique index if not exists idx_orders_store_shopify_unique
  on public.orders (store_id, shopify_id);

create unique index if not exists idx_customers_store_shopify_unique
  on public.customers (store_id, shopify_id);

create unique index if not exists warehouse_inventory_store_id_sku_unique
  on public.warehouse_inventory (store_id, sku);

create index if not exists warehouse_inventory_store_product_idx
  on public.warehouse_inventory (store_id, product_id);

create index if not exists warehouse_inventory_store_last_scanned_idx
  on public.warehouse_inventory (store_id, last_scanned_at);

create index if not exists warehouse_scan_events_store_created_idx
  on public.warehouse_scan_events (store_id, created_at);

create index if not exists warehouse_scan_events_store_sku_idx
  on public.warehouse_scan_events (store_id, sku);

-- Verification
select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_products_store_shopify_unique',
    'idx_orders_store_shopify_unique',
    'idx_customers_store_shopify_unique',
    'warehouse_inventory_store_id_sku_unique',
    'warehouse_inventory_store_product_idx',
    'warehouse_inventory_store_last_scanned_idx',
    'warehouse_scan_events_store_created_idx',
    'warehouse_scan_events_store_sku_idx'
  )
order by indexname;
