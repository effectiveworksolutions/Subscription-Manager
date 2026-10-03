-- ═══════════════════════════════════════════════════════════════════════
--  SubTracker — Supabase database schema
--  Run this once in: Supabase dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════════

-- The one table. Each row belongs to exactly one user.
create table if not exists public.subscriptions (
  id              uuid primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  emoji           text,
  category        text not null default 'other',
  price           numeric(10,2) not null default 0,
  cycle           text not null default 'monthly' check (cycle in ('monthly','yearly')),
  status          text not null default 'active' check (status in ('active','trial','paused','cancelled')),
  start_date      date,
  payment_method  text,
  url             text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Fast lookups by owner
create index if not exists subscriptions_user_id_idx on public.subscriptions (user_id);

-- ── Row Level Security ─────────────────────────────────────────────────
-- This is what keeps every user's data private. With RLS on, the database
-- itself refuses to return or modify rows that don't belong to the caller,
-- even if someone has the public anon key.
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own subscriptions"   on public.subscriptions;
drop policy if exists "Users can insert own subscriptions" on public.subscriptions;
drop policy if exists "Users can update own subscriptions" on public.subscriptions;
drop policy if exists "Users can delete own subscriptions" on public.subscriptions;

create policy "Users can read own subscriptions"
  on public.subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own subscriptions"
  on public.subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own subscriptions"
  on public.subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own subscriptions"
  on public.subscriptions for delete
  using (auth.uid() = user_id);

-- ── Optional: keep updated_at honest on server-side edits ──────────────
-- The app sends updated_at itself (needed for conflict resolution), so this
-- trigger only fills it in when a row is changed without one.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- Done. Now copy your Project URL and anon key into docs/config.js.
