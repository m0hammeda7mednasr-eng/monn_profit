create extension if not exists pgcrypto;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  supplier_type text not null default 'factory' check (supplier_type in ('factory', 'fabric')),
  code text default '',
  name text not null,
  contact_name text default '',
  phone text default '',
  address text default '',
  notes text default '',
  opening_balance numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_entries (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  store_id uuid not null,
  entry_type text not null check (entry_type in ('delivery', 'payment', 'adjustment')),
  entry_date date not null default current_date,
  reference_code text default '',
  description text default '',
  amount numeric(12, 2) not null default 0,
  payment_method text default '',
  payment_account text default '',
  items jsonb not null default '[]'::jsonb,
  notes text default '',
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_fabrics (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  store_id uuid not null,
  fabric_supplier_id uuid null references public.suppliers(id) on delete set null,
  code text default '',
  name text not null,
  notes text default '',
  is_active boolean not null default true,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.suppliers
  add column if not exists supplier_type text not null default 'factory';

alter table if exists public.supplier_fabrics
  add column if not exists fabric_supplier_id uuid null;

create index if not exists idx_suppliers_store_id on public.suppliers(store_id);
create index if not exists idx_suppliers_supplier_type on public.suppliers(supplier_type);
create index if not exists idx_suppliers_name on public.suppliers(name);
create index if not exists idx_supplier_entries_store_id on public.supplier_entries(store_id);
create index if not exists idx_supplier_entries_supplier_id on public.supplier_entries(supplier_id);
create index if not exists idx_supplier_entries_entry_date on public.supplier_entries(entry_date desc);
create index if not exists idx_supplier_fabrics_store_id on public.supplier_fabrics(store_id);
create index if not exists idx_supplier_fabrics_supplier_id on public.supplier_fabrics(supplier_id);
create index if not exists idx_supplier_fabrics_fabric_supplier_id on public.supplier_fabrics(fabric_supplier_id);
create index if not exists idx_supplier_fabrics_name on public.supplier_fabrics(name);
create unique index if not exists idx_supplier_fabrics_supplier_code_unique
  on public.supplier_fabrics(supplier_id, code)
  where nullif(btrim(code), '') is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'supplier_fabrics_fabric_supplier_id_fkey'
  ) then
    alter table public.supplier_fabrics
      add constraint supplier_fabrics_fabric_supplier_id_fkey
      foreign key (fabric_supplier_id)
      references public.suppliers(id)
      on delete set null;
  end if;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_entries_set_updated_at on public.supplier_entries;
create trigger supplier_entries_set_updated_at
before update on public.supplier_entries
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_fabrics_set_updated_at on public.supplier_fabrics;
create trigger supplier_fabrics_set_updated_at
before update on public.supplier_fabrics
for each row
execute function public.set_updated_at();

alter table public.suppliers enable row level security;
alter table public.supplier_entries enable row level security;
alter table public.supplier_fabrics enable row level security;

drop policy if exists suppliers_service_access on public.suppliers;
create policy suppliers_service_access
on public.suppliers
for all
using (auth.role() in ('service_role', 'authenticated'))
with check (auth.role() in ('service_role', 'authenticated'));

drop policy if exists supplier_entries_service_access on public.supplier_entries;
create policy supplier_entries_service_access
on public.supplier_entries
for all
using (auth.role() in ('service_role', 'authenticated'))
with check (auth.role() in ('service_role', 'authenticated'));

drop policy if exists supplier_fabrics_service_access on public.supplier_fabrics;
create policy supplier_fabrics_service_access
on public.supplier_fabrics
for all
using (auth.role() in ('service_role', 'authenticated'))
with check (auth.role() in ('service_role', 'authenticated'));
