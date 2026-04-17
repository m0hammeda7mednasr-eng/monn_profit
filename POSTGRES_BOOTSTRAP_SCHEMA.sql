-- Moon Profit portable PostgreSQL bootstrap schema.
-- Run this once on a fresh PostgreSQL database.
-- This creates the application tables, indexes, triggers, compatibility view,
-- and the order-profit function. It does NOT include old production data.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_current_user_id(user_id uuid)
returns void
language sql
as $$
  select set_config('app.current_user_id', user_id::text, true);
$$;

create or replace function public.set_current_store_id(store_id uuid)
returns void
language sql
as $$
  select set_config('app.current_store_id', store_id::text, true);
$$;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password text not null,
  name text not null default '',
  full_name text default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  created_by uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  shopify_access_token text,
  shopify_shop text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  can_view_dashboard boolean not null default true,
  can_view_products boolean not null default true,
  can_edit_products boolean not null default false,
  can_view_warehouse boolean not null default true,
  can_edit_warehouse boolean not null default false,
  can_view_suppliers boolean not null default false,
  can_edit_suppliers boolean not null default false,
  can_view_orders boolean not null default true,
  can_edit_orders boolean not null default false,
  can_view_customers boolean not null default true,
  can_edit_customers boolean not null default false,
  can_manage_users boolean not null default false,
  can_manage_settings boolean not null default false,
  can_view_profits boolean not null default false,
  can_manage_tasks boolean not null default false,
  can_view_all_reports boolean not null default false,
  can_view_activity_log boolean not null default false,
  can_print_barcode_labels boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.permissions.can_view_warehouse is
  'Allows opening warehouse stock and scan history views.';
comment on column public.permissions.can_edit_warehouse is
  'Allows using the warehouse scanner, changing stock movements, syncing warehouse stock to Shopify, and automatically includes barcode label printing access.';
comment on column public.permissions.can_view_orders is
  'Allows opening orders, missing orders, order details, and shipping issues list views.';
comment on column public.permissions.can_edit_orders is
  'Allows full order editing across order details, including status, payment method, fulfillment or restock, contact/address overrides, shipping issue follow-up, and internal notes. It also guarantees order view access.';
comment on column public.permissions.can_print_barcode_labels is
  'Allows printing barcode labels and is automatically included with warehouse scanner access.';

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text default '',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, store_id)
);

create table if not exists public.shopify_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  api_key text not null,
  api_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.shopify_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade,
  shop text not null,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  shopify_id text,
  title text not null default '',
  description text default '',
  vendor text default '',
  product_type text default '',
  price numeric(14, 2) not null default 0,
  cost_price numeric(14, 2) not null default 0,
  ads_cost numeric(14, 2) not null default 0,
  operation_cost numeric(14, 2) not null default 0,
  shipping_cost numeric(14, 2) not null default 0,
  currency text default 'USD',
  sku text default '',
  barcode text default '',
  image_url text default '',
  inventory_quantity integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  pending_sync boolean not null default false,
  sync_error text default '',
  local_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  shopify_id text,
  order_number text,
  customer_name text default '',
  customer_email text default '',
  customer_phone text default '',
  customer_id text,
  total_price numeric(14, 2) not null default 0,
  subtotal_price numeric(14, 2) not null default 0,
  total_tax numeric(14, 2) not null default 0,
  total_discounts numeric(14, 2) not null default 0,
  total_refunded numeric(14, 2) not null default 0,
  currency text default 'USD',
  financial_status text default '',
  fulfillment_status text default '',
  payment_method text default '',
  manual_payment_method text default '',
  status text default '',
  items_count integer not null default 0,
  cancelled_at timestamptz,
  notes jsonb not null default '[]'::jsonb,
  data jsonb not null default '{}'::jsonb,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  pending_sync boolean not null default false,
  sync_error text default '',
  local_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  shopify_id text,
  name text default '',
  email text default '',
  phone text default '',
  total_spent numeric(14, 2) not null default 0,
  orders_count integer not null default 0,
  default_address text default '',
  city text default '',
  country text default '',
  data jsonb not null default '{}'::jsonb,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  pending_sync boolean not null default false,
  sync_error text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  user_id uuid references public.users(id) on delete set null,
  comment_text text not null,
  comment_type text not null default 'general',
  is_internal boolean not null default false,
  is_pinned boolean not null default false,
  edited_at timestamptz,
  edited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.order_comments_with_user as
select
  oc.*,
  u.name as user_name,
  u.email as user_email,
  u.role as user_role,
  eu.name as edited_by_name,
  eu.email as edited_by_email
from public.order_comments oc
left join public.users u on u.id = oc.user_id
left join public.users eu on eu.id = oc.edited_by;

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint access_requests_user_id_fkey references public.users(id) on delete cascade,
  permission_requested text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes text default '',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint daily_reports_user_id_fkey references public.users(id) on delete cascade,
  title text not null,
  description text default '',
  tasks_completed text default '',
  notes text default '',
  report_date date not null default current_date,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  type text not null default 'general',
  title text not null default '',
  message text not null default '',
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid constraint activity_log_user_id_fkey references public.users(id) on delete set null,
  action text not null default '',
  entity_type text default '',
  entity_id text,
  description text default '',
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.operational_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  cost_name text not null,
  cost_type text not null,
  amount numeric(14, 2) not null default 0,
  apply_to text not null default 'per_unit' check (apply_to in ('per_unit', 'per_order', 'fixed')),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  entity_type text default '',
  entity_id text,
  operation_type text default '',
  direction text default '',
  status text not null default 'pending',
  details jsonb not null default '{}'::jsonb,
  error_message text default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouse_inventory (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sku text not null,
  product_id uuid references public.products(id) on delete set null,
  shopify_id text default '',
  variant_id text default '',
  shopify_inventory_quantity integer not null default 0,
  quantity integer not null default 0 check (quantity >= 0),
  last_scanned_at timestamptz default now(),
  last_movement_type text default 'in' check (last_movement_type in ('in', 'out')),
  last_movement_quantity integer not null default 0 check (last_movement_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_type text not null default 'factory' check (supplier_type in ('factory', 'fabric')),
  code text default '',
  name text not null,
  contact_name text default '',
  phone text default '',
  address text default '',
  notes text default '',
  opening_balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  entry_type text not null check (entry_type in ('delivery', 'payment', 'adjustment')),
  entry_date date not null default current_date,
  reference_code text default '',
  description text default '',
  amount numeric(14, 2) not null default 0,
  payment_method text default '',
  payment_account text default '',
  items jsonb not null default '[]'::jsonb,
  notes text default '',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_fabrics (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  fabric_supplier_id uuid references public.suppliers(id) on delete set null,
  code text default '',
  name text not null,
  notes text default '',
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id text,
  product_shopify_id text default '',
  product_name text not null default '',
  variant_title text default '',
  sku text default '',
  notes text default '',
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  assigned_to uuid references public.users(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  assigned_by uuid references public.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  comment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  file_name text not null,
  file_url text not null,
  storage_path text default '',
  mime_type text default '',
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  meta_access_token text default '',
  meta_business_id text default '',
  meta_ad_account_ids jsonb not null default '[]'::jsonb,
  meta_page_id text default '',
  meta_pixel_id text default '',
  openrouter_api_key text default '',
  openrouter_model text not null default 'openai/gpt-4o-mini',
  openrouter_site_url text default '',
  openrouter_site_name text default '',
  is_meta_connected boolean not null default false,
  is_openrouter_connected boolean not null default false,
  last_meta_sync_at timestamptz,
  last_meta_sync_status text not null default 'idle',
  last_meta_sync_error text default '',
  last_ai_analysis_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  triggered_by uuid references public.users(id) on delete set null,
  sync_type text not null default 'manual',
  status text not null default 'running',
  date_start date,
  date_stop date,
  payload_summary jsonb not null default '{}'::jsonb,
  error_message text default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  object_type text not null default 'ad',
  object_id text not null,
  object_name text default '',
  level text not null default 'ad',
  account_id text default '',
  account_name text default '',
  campaign_id text default '',
  campaign_name text default '',
  adset_id text default '',
  adset_name text default '',
  ad_id text default '',
  ad_name text default '',
  objective text default '',
  currency text default '',
  date_start date,
  date_stop date,
  metrics jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meta_entities (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  object_type text not null,
  object_id text not null,
  name text default '',
  account_id text default '',
  account_name text default '',
  campaign_id text default '',
  campaign_name text default '',
  adset_id text default '',
  adset_name text default '',
  ad_id text default '',
  ad_name text default '',
  objective text default '',
  status text default '',
  effective_status text default '',
  is_active boolean not null default false,
  currency text default '',
  timezone_name text default '',
  optimization_goal text default '',
  billing_event text default '',
  daily_budget numeric default 0,
  lifetime_budget numeric default 0,
  start_time timestamptz,
  end_time timestamptz,
  stop_time timestamptz,
  updated_time timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meta_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  model text not null default 'openai/gpt-4o-mini',
  focus_area text default '',
  prompt_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  recommendation_text text default '',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_stores_name_unique on public.stores (name);
create index if not exists idx_users_created_by on public.users (created_by);
create index if not exists idx_user_stores_store_id on public.user_stores (store_id);
create index if not exists idx_shopify_tokens_user_store on public.shopify_tokens (user_id, store_id);
create index if not exists idx_shopify_tokens_shop on public.shopify_tokens (shop);
create unique index if not exists idx_shopify_tokens_user_shop_unique on public.shopify_tokens (user_id, shop);
create unique index if not exists idx_products_store_shopify_unique on public.products (store_id, shopify_id) where store_id is not null and shopify_id is not null;
create unique index if not exists idx_orders_store_shopify_unique on public.orders (store_id, shopify_id) where store_id is not null and shopify_id is not null;
create unique index if not exists idx_customers_store_shopify_unique on public.customers (store_id, shopify_id) where store_id is not null and shopify_id is not null;
create index if not exists idx_products_store_updated_at on public.products (store_id, updated_at desc);
create index if not exists idx_products_store_sku on public.products (store_id, sku);
create index if not exists idx_orders_store_created_at on public.orders (store_id, created_at desc);
create index if not exists idx_orders_store_updated_at on public.orders (store_id, updated_at desc);
create index if not exists idx_orders_order_number on public.orders (order_number);
create index if not exists idx_orders_customer_email on public.orders (customer_email);
create index if not exists idx_customers_store_created_at on public.customers (store_id, created_at desc);
create index if not exists idx_order_comments_order_created_at on public.order_comments (order_id, created_at asc);
create index if not exists idx_access_requests_user_status on public.access_requests (user_id, status);
create index if not exists idx_daily_reports_user_date on public.daily_reports (user_id, report_date desc);
create index if not exists idx_notifications_user_created_at on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_user_is_read_created_at on public.notifications (user_id, is_read, created_at desc);
create index if not exists idx_notifications_type_user_entity_created_at on public.notifications (type, user_id, entity_id, created_at desc);
create index if not exists idx_activity_log_user_created_at on public.activity_log (user_id, created_at desc);
create index if not exists idx_operational_costs_user_created_at on public.operational_costs (user_id, created_at desc);
create index if not exists idx_operational_costs_product_user_active on public.operational_costs (product_id, user_id) where is_active = true;
create index if not exists idx_sync_operations_entity on public.sync_operations (entity_type, entity_id, created_at desc);
create unique index if not exists warehouse_inventory_store_id_sku_unique on public.warehouse_inventory (store_id, sku);
create index if not exists warehouse_inventory_store_product_idx on public.warehouse_inventory (store_id, product_id);
create index if not exists warehouse_inventory_store_last_scanned_idx on public.warehouse_inventory (store_id, last_scanned_at);
create index if not exists warehouse_scan_events_store_created_idx on public.warehouse_scan_events (store_id, created_at);
create index if not exists warehouse_scan_events_store_sku_idx on public.warehouse_scan_events (store_id, sku);
create index if not exists idx_suppliers_store_id on public.suppliers (store_id);
create index if not exists idx_suppliers_supplier_type on public.suppliers (supplier_type);
create index if not exists idx_supplier_entries_supplier_id on public.supplier_entries (supplier_id);
create index if not exists idx_supplier_entries_entry_date on public.supplier_entries (entry_date desc);
create index if not exists idx_supplier_fabrics_supplier_id on public.supplier_fabrics (supplier_id);
create unique index if not exists idx_supplier_fabrics_supplier_code_unique on public.supplier_fabrics (supplier_id, code) where nullif(btrim(code), '') is not null;
create index if not exists idx_supplier_products_supplier_id on public.supplier_products (supplier_id);
create index if not exists idx_supplier_products_product_id on public.supplier_products (product_id);
create index if not exists idx_supplier_products_store_product on public.supplier_products (store_id, product_id);
create unique index if not exists idx_supplier_products_unique_link on public.supplier_products (supplier_id, product_id, coalesce(variant_id, ''));
create index if not exists idx_tasks_assigned_to_created_at on public.tasks (assigned_to, created_at desc);
create index if not exists idx_tasks_store_updated_at on public.tasks (store_id, updated_at desc);
create index if not exists idx_task_comments_task_created_at on public.task_comments (task_id, created_at asc);
create index if not exists idx_task_attachments_task_created_at on public.task_attachments (task_id, created_at desc);
create unique index if not exists idx_meta_integrations_store_unique on public.meta_integrations (store_id);
create index if not exists idx_meta_sync_runs_store_started_at on public.meta_sync_runs (store_id, started_at desc);
create unique index if not exists idx_meta_insight_snapshots_unique on public.meta_insight_snapshots (integration_id, object_type, object_id, date_start, date_stop);
create unique index if not exists idx_meta_entities_unique on public.meta_entities (integration_id, object_type, object_id);
create index if not exists idx_meta_ai_analyses_store_created_at on public.meta_ai_analyses (store_id, created_at desc);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
drop trigger if exists permissions_set_updated_at on public.permissions;
create trigger permissions_set_updated_at before update on public.permissions for each row execute function public.set_updated_at();
drop trigger if exists stores_set_updated_at on public.stores;
create trigger stores_set_updated_at before update on public.stores for each row execute function public.set_updated_at();
drop trigger if exists user_stores_set_updated_at on public.user_stores;
create trigger user_stores_set_updated_at before update on public.user_stores for each row execute function public.set_updated_at();
drop trigger if exists shopify_credentials_set_updated_at on public.shopify_credentials;
create trigger shopify_credentials_set_updated_at before update on public.shopify_credentials for each row execute function public.set_updated_at();
drop trigger if exists shopify_tokens_set_updated_at on public.shopify_tokens;
create trigger shopify_tokens_set_updated_at before update on public.shopify_tokens for each row execute function public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
drop trigger if exists order_comments_set_updated_at on public.order_comments;
create trigger order_comments_set_updated_at before update on public.order_comments for each row execute function public.set_updated_at();
drop trigger if exists access_requests_set_updated_at on public.access_requests;
create trigger access_requests_set_updated_at before update on public.access_requests for each row execute function public.set_updated_at();
drop trigger if exists daily_reports_set_updated_at on public.daily_reports;
create trigger daily_reports_set_updated_at before update on public.daily_reports for each row execute function public.set_updated_at();
drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at before update on public.notifications for each row execute function public.set_updated_at();
drop trigger if exists operational_costs_set_updated_at on public.operational_costs;
create trigger operational_costs_set_updated_at before update on public.operational_costs for each row execute function public.set_updated_at();
drop trigger if exists sync_operations_set_updated_at on public.sync_operations;
create trigger sync_operations_set_updated_at before update on public.sync_operations for each row execute function public.set_updated_at();
drop trigger if exists warehouse_inventory_set_updated_at on public.warehouse_inventory;
create trigger warehouse_inventory_set_updated_at before update on public.warehouse_inventory for each row execute function public.set_updated_at();
drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at before update on public.suppliers for each row execute function public.set_updated_at();
drop trigger if exists supplier_entries_set_updated_at on public.supplier_entries;
create trigger supplier_entries_set_updated_at before update on public.supplier_entries for each row execute function public.set_updated_at();
drop trigger if exists supplier_fabrics_set_updated_at on public.supplier_fabrics;
create trigger supplier_fabrics_set_updated_at before update on public.supplier_fabrics for each row execute function public.set_updated_at();
drop trigger if exists supplier_products_set_updated_at on public.supplier_products;
create trigger supplier_products_set_updated_at before update on public.supplier_products for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists task_comments_set_updated_at on public.task_comments;
create trigger task_comments_set_updated_at before update on public.task_comments for each row execute function public.set_updated_at();
drop trigger if exists meta_integrations_set_updated_at on public.meta_integrations;
create trigger meta_integrations_set_updated_at before update on public.meta_integrations for each row execute function public.set_updated_at();

create or replace function public.calculate_order_net_profit(order_id_param uuid)
returns table (
  total_revenue numeric,
  total_cost numeric,
  total_operational_costs numeric,
  gross_profit numeric,
  net_profit numeric,
  profit_margin numeric
)
language sql
stable
as $$
  with selected_order as (
    select *
    from public.orders
    where id = order_id_param
    limit 1
  ),
  line_items as (
    select
      nullif(item ->> 'product_id', '') as product_shopify_id,
      coalesce(nullif(item ->> 'quantity', '')::numeric, 0) as quantity
    from selected_order o,
    lateral jsonb_array_elements(coalesce(o.data -> 'line_items', '[]'::jsonb)) item
  ),
  product_costs as (
    select
      sum(coalesce(p.cost_price, 0) * greatest(li.quantity, 1)) as product_cost,
      sum(coalesce(p.ads_cost, 0) * greatest(li.quantity, 1)) as ads_cost,
      sum(coalesce(p.operation_cost, 0) * greatest(li.quantity, 1)) as operation_cost,
      sum(coalesce(p.shipping_cost, 0) * greatest(li.quantity, 1)) as shipping_cost
    from line_items li
    left join public.products p
      on p.shopify_id = li.product_shopify_id
  ),
  active_operational_costs as (
    select coalesce(sum(amount), 0) as amount
    from public.operational_costs
    where is_active = true
      and (product_id is null or product_id in (
        select p.id
        from public.products p
        join line_items li on li.product_shopify_id = p.shopify_id
      ))
  ),
  totals as (
    select
      coalesce(o.total_price, 0) as revenue,
      coalesce(pc.product_cost, 0) as product_cost,
      coalesce(pc.ads_cost, 0) + coalesce(pc.operation_cost, 0) + coalesce(pc.shipping_cost, 0) + coalesce(aoc.amount, 0) as operational_cost
    from selected_order o
    left join product_costs pc on true
    left join active_operational_costs aoc on true
  )
  select
    revenue as total_revenue,
    product_cost as total_cost,
    operational_cost as total_operational_costs,
    revenue - product_cost as gross_profit,
    revenue - product_cost - operational_cost as net_profit,
    case
      when revenue > 0 then round(((revenue - product_cost - operational_cost) / revenue) * 100, 2)
      else 0
    end as profit_margin
  from totals;
$$;

commit;
