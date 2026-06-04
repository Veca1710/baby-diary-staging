create table if not exists public.baby_snapshots (
  shared_baby_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.baby_invite_codes (
  code text primary key,
  shared_baby_id text not null references public.baby_snapshots(shared_baby_id) on delete cascade,
  baby_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by text
);

alter table public.baby_snapshots enable row level security;
alter table public.baby_invite_codes enable row level security;

drop policy if exists "anon read baby snapshots" on public.baby_snapshots;
drop policy if exists "anon insert baby snapshots" on public.baby_snapshots;
drop policy if exists "anon update baby snapshots" on public.baby_snapshots;
drop policy if exists "anon read baby invite codes" on public.baby_invite_codes;
drop policy if exists "anon insert baby invite codes" on public.baby_invite_codes;
drop policy if exists "anon update baby invite codes" on public.baby_invite_codes;

create policy "anon read baby snapshots" on public.baby_snapshots for select to anon using (true);
create policy "anon insert baby snapshots" on public.baby_snapshots for insert to anon with check (true);
create policy "anon update baby snapshots" on public.baby_snapshots for update to anon using (true) with check (true);
create policy "anon read baby invite codes" on public.baby_invite_codes for select to anon using (true);
create policy "anon insert baby invite codes" on public.baby_invite_codes for insert to anon with check (true);
create policy "anon update baby invite codes" on public.baby_invite_codes for update to anon using (true) with check (true);
