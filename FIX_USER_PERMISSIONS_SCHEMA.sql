-- Repair missing permission columns so the current Users UI and middleware
-- match the deployed database schema.

alter table public.permissions
  add column if not exists can_view_dashboard boolean not null default true,
  add column if not exists can_view_products boolean not null default true,
  add column if not exists can_edit_products boolean not null default false,
  add column if not exists can_view_warehouse boolean not null default true,
  add column if not exists can_edit_warehouse boolean not null default false,
  add column if not exists can_view_suppliers boolean not null default true,
  add column if not exists can_edit_suppliers boolean not null default false,
  add column if not exists can_view_orders boolean not null default true,
  add column if not exists can_edit_orders boolean not null default false,
  add column if not exists can_view_customers boolean not null default true,
  add column if not exists can_edit_customers boolean not null default false,
  add column if not exists can_manage_users boolean not null default false,
  add column if not exists can_manage_settings boolean not null default false,
  add column if not exists can_view_profits boolean not null default false,
  add column if not exists can_manage_tasks boolean not null default false,
  add column if not exists can_view_all_reports boolean not null default false,
  add column if not exists can_view_activity_log boolean not null default false,
  add column if not exists can_print_barcode_labels boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

update public.permissions
set
  can_view_dashboard = coalesce(can_view_dashboard, true),
  can_view_products = coalesce(can_view_products, true),
  can_edit_products = coalesce(can_edit_products, false),
  can_view_warehouse = coalesce(can_view_warehouse, can_view_products, true),
  can_edit_warehouse = coalesce(can_edit_warehouse, can_edit_products, false),
  can_view_suppliers = coalesce(can_view_suppliers, true),
  can_edit_suppliers = coalesce(can_edit_suppliers, false),
  can_view_orders = coalesce(can_view_orders, true),
  can_edit_orders = coalesce(can_edit_orders, false),
  can_view_customers = coalesce(can_view_customers, true),
  can_edit_customers = coalesce(can_edit_customers, false),
  can_manage_users = coalesce(can_manage_users, false),
  can_manage_settings = coalesce(can_manage_settings, false),
  can_view_profits = coalesce(can_view_profits, false),
  can_manage_tasks = coalesce(can_manage_tasks, false),
  can_view_all_reports = coalesce(can_view_all_reports, false),
  can_view_activity_log = coalesce(can_view_activity_log, false),
  can_print_barcode_labels = coalesce(can_print_barcode_labels, true),
  updated_at = now();

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'permissions'
  and column_name in (
    'can_view_dashboard',
    'can_view_products',
    'can_edit_products',
    'can_view_warehouse',
    'can_edit_warehouse',
    'can_view_suppliers',
    'can_edit_suppliers',
    'can_view_orders',
    'can_edit_orders',
    'can_view_customers',
    'can_edit_customers',
    'can_manage_users',
    'can_manage_settings',
    'can_view_profits',
    'can_manage_tasks',
    'can_view_all_reports',
    'can_view_activity_log',
    'can_print_barcode_labels',
    'updated_at'
  )
order by column_name;
