-- Baby Diary v2.0 Cloud Sharing setup
-- Run this in Supabase SQL Editor.

create table if not exists public.app_snapshots (
  family_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.invite_codes (
  code text primary key,
  family_id text not null references public.app_snapshots(family_id) on delete cascade,
  baby_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by text
);

alter table public.app_snapshots enable row level security;
alter table public.invite_codes enable row level security;

drop policy if exists "anon read app snapshots" on public.app_snapshots;
drop policy if exists "anon insert app snapshots" on public.app_snapshots;
drop policy if exists "anon update app snapshots" on public.app_snapshots;
drop policy if exists "anon read invite codes" on public.invite_codes;
drop policy if exists "anon insert invite codes" on public.invite_codes;
drop policy if exists "anon update invite codes" on public.invite_codes;

-- Beta policy: anonymous access for invite-code based beta testing.
-- For production, replace this with authenticated users or private access tokens.
create policy "anon read app snapshots"
on public.app_snapshots for select
to anon
using (true);

create policy "anon insert app snapshots"
on public.app_snapshots for insert
to anon
with check (true);

create policy "anon update app snapshots"
on public.app_snapshots for update
to anon
using (true)
with check (true);

create policy "anon read invite codes"
on public.invite_codes for select
to anon
using (true);

create policy "anon insert invite codes"
on public.invite_codes for insert
to anon
with check (true);

create policy "anon update invite codes"
on public.invite_codes for update
to anon
using (true)
with check (true);
