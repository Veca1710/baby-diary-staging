-- Supabase setup for v43 snapshot sync

create table if not exists app_snapshots (
  family_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table app_snapshots enable row level security;

drop policy if exists "anon_select" on app_snapshots;
drop policy if exists "anon_insert" on app_snapshots;
drop policy if exists "anon_update" on app_snapshots;
drop policy if exists "Allow anon read app_snapshots" on app_snapshots;
drop policy if exists "Allow anon insert app_snapshots" on app_snapshots;
drop policy if exists "Allow anon update app_snapshots" on app_snapshots;

create policy "anon_select"
on app_snapshots
for select
to anon
using (true);

create policy "anon_insert"
on app_snapshots
for insert
to anon
with check (true);

create policy "anon_update"
on app_snapshots
for update
to anon
using (true)
with check (true);
