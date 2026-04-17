create extension if not exists pgcrypto;

create table if not exists public.meta_integrations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
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
  last_meta_sync_at timestamptz null,
  last_meta_sync_status text not null default 'idle'
    check (last_meta_sync_status in ('idle', 'running', 'completed', 'failed')),
  last_meta_sync_error text default '',
  last_ai_analysis_at timestamptz null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_sync_runs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null,
  triggered_by uuid null,
  sync_type text not null default 'manual'
    check (sync_type in ('manual', 'scheduled', 'webhook')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  date_start date null,
  date_stop date null,
  payload_summary jsonb not null default '{}'::jsonb,
  error_message text default '',
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null,
  object_type text not null default 'ad'
    check (object_type in ('account', 'campaign', 'adset', 'ad')),
  object_id text not null,
  object_name text default '',
  level text not null default 'ad'
    check (level in ('account', 'campaign', 'adset', 'ad')),
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
  date_start date null,
  date_stop date null,
  metrics jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meta_entities (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null,
  object_type text not null
    check (object_type in ('account', 'campaign', 'adset', 'ad')),
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
  start_time timestamptz null,
  end_time timestamptz null,
  stop_time timestamptz null,
  updated_time timestamptz null,
  raw_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.meta_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.meta_integrations(id) on delete cascade,
  store_id uuid not null,
  user_id uuid null,
  model text not null default 'openai/gpt-4o-mini',
  focus_area text default '',
  prompt_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  recommendation_text text default '',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_meta_integrations_store_unique
  on public.meta_integrations(store_id);
create unique index if not exists idx_meta_integrations_id_store_unique
  on public.meta_integrations(id, store_id);
create index if not exists idx_meta_sync_runs_store_id
  on public.meta_sync_runs(store_id);
create index if not exists idx_meta_sync_runs_integration_id
  on public.meta_sync_runs(integration_id);
create index if not exists idx_meta_sync_runs_started_at
  on public.meta_sync_runs(started_at desc);
create index if not exists idx_meta_sync_runs_store_started_at
  on public.meta_sync_runs(store_id, started_at desc);
create index if not exists idx_meta_insight_snapshots_store_id
  on public.meta_insight_snapshots(store_id);
create index if not exists idx_meta_insight_snapshots_integration_id
  on public.meta_insight_snapshots(integration_id);
create index if not exists idx_meta_insight_snapshots_date_start
  on public.meta_insight_snapshots(date_start desc);
create index if not exists idx_meta_insight_snapshots_store_date_start
  on public.meta_insight_snapshots(store_id, date_start desc);
create index if not exists idx_meta_insight_snapshots_campaign_id
  on public.meta_insight_snapshots(campaign_id);
create index if not exists idx_meta_insight_snapshots_ad_id
  on public.meta_insight_snapshots(ad_id);
create unique index if not exists idx_meta_insight_snapshots_unique
  on public.meta_insight_snapshots(
    integration_id,
    object_type,
    object_id,
    date_start,
    date_stop
  );
create index if not exists idx_meta_entities_store_id
  on public.meta_entities(store_id);
create index if not exists idx_meta_entities_integration_id
  on public.meta_entities(integration_id);
create index if not exists idx_meta_entities_object_type
  on public.meta_entities(object_type);
create index if not exists idx_meta_entities_is_active
  on public.meta_entities(is_active);
create index if not exists idx_meta_entities_campaign_id
  on public.meta_entities(campaign_id);
create index if not exists idx_meta_entities_adset_id
  on public.meta_entities(adset_id);
create index if not exists idx_meta_entities_updated_time
  on public.meta_entities(updated_time desc);
create index if not exists idx_meta_entities_store_active_updated_time
  on public.meta_entities(store_id, is_active desc, updated_time desc);
create unique index if not exists idx_meta_entities_unique
  on public.meta_entities(integration_id, object_type, object_id);
create index if not exists idx_meta_ai_analyses_store_id
  on public.meta_ai_analyses(store_id);
create index if not exists idx_meta_ai_analyses_integration_id
  on public.meta_ai_analyses(integration_id);
create index if not exists idx_meta_ai_analyses_created_at
  on public.meta_ai_analyses(created_at desc);
create index if not exists idx_meta_ai_analyses_store_created_at
  on public.meta_ai_analyses(store_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meta_integrations_set_updated_at on public.meta_integrations;
create trigger meta_integrations_set_updated_at
before update on public.meta_integrations
for each row
execute function public.set_updated_at();

do $$
begin
  if to_regclass('public.stores') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'meta_integrations_store_id_fkey'
    ) then
    alter table public.meta_integrations
      add constraint meta_integrations_store_id_fkey
      foreign key (store_id)
      references public.stores(id)
      on delete cascade
      not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_sync_runs_integration_store_fkey'
  ) then
    alter table public.meta_sync_runs
      add constraint meta_sync_runs_integration_store_fkey
      foreign key (integration_id, store_id)
      references public.meta_integrations(id, store_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_insight_snapshots_integration_store_fkey'
  ) then
    alter table public.meta_insight_snapshots
      add constraint meta_insight_snapshots_integration_store_fkey
      foreign key (integration_id, store_id)
      references public.meta_integrations(id, store_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_entities_integration_store_fkey'
  ) then
    alter table public.meta_entities
      add constraint meta_entities_integration_store_fkey
      foreign key (integration_id, store_id)
      references public.meta_integrations(id, store_id)
      on delete cascade
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'meta_ai_analyses_integration_store_fkey'
  ) then
    alter table public.meta_ai_analyses
      add constraint meta_ai_analyses_integration_store_fkey
      foreign key (integration_id, store_id)
      references public.meta_integrations(id, store_id)
      on delete cascade
      not valid;
  end if;
end;
$$;

alter table public.meta_integrations enable row level security;
alter table public.meta_sync_runs enable row level security;
alter table public.meta_insight_snapshots enable row level security;
alter table public.meta_entities enable row level security;
alter table public.meta_ai_analyses enable row level security;

drop policy if exists meta_integrations_service_access on public.meta_integrations;
create policy meta_integrations_service_access
on public.meta_integrations
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists meta_sync_runs_service_access on public.meta_sync_runs;
create policy meta_sync_runs_service_access
on public.meta_sync_runs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists meta_insight_snapshots_service_access on public.meta_insight_snapshots;
create policy meta_insight_snapshots_service_access
on public.meta_insight_snapshots
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists meta_entities_service_access on public.meta_entities;
create policy meta_entities_service_access
on public.meta_entities
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists meta_ai_analyses_service_access on public.meta_ai_analyses;
create policy meta_ai_analyses_service_access
on public.meta_ai_analyses
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
