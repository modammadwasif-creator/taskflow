-- =====================================================================
-- TASKFLOW – Supabase database setup
-- Run this whole file once in: Supabase Dashboard → SQL Editor → New query
-- It is safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- Public profile for each auth user (1:1 with auth.users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 100),
  avatar_url  text check (char_length(avatar_url) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Task categories (each user owns their own, including the defaults)
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  color       text not null default '#7c5cff' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at  timestamptz not null default now(),
  constraint categories_user_name_unique unique (user_id, name),
  -- lets tasks reference (category_id, user_id) so a task can never point
  -- at another user's category
  constraint categories_id_user_unique unique (id, user_id)
);

-- Tasks
create table if not exists public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (char_length(trim(title)) between 1 and 150),
  description   text check (char_length(description) <= 2000),
  category_id   uuid,
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status        text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  due_date      date,
  due_time      time,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,
  -- composite FK: the category must belong to the same user as the task
  constraint tasks_category_fk foreign key (category_id, user_id)
    references public.categories (id, user_id) on delete set null (category_id)
);

-- Per-user application settings (1 row per user)
create table if not exists public.user_settings (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references auth.users (id) on delete cascade,
  theme                     text not null default 'light' check (theme in ('light', 'dark')),
  notification_preferences  jsonb not null default
    '{"due_today_reminder": true, "overdue_alerts": true, "completion_celebration": true}'::jsonb,
  default_sort              text not null default 'newest' check (default_sort in ('newest', 'oldest', 'due_date')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. INDEXES (for the queries the app runs most)
-- ---------------------------------------------------------------------
create index if not exists tasks_user_id_idx          on public.tasks (user_id);
create index if not exists tasks_user_due_date_idx    on public.tasks (user_id, due_date);
create index if not exists tasks_user_status_idx      on public.tasks (user_id, status);
create index if not exists tasks_user_created_at_idx  on public.tasks (user_id, created_at desc);
create index if not exists tasks_user_completed_idx   on public.tasks (user_id, completed_at);
create index if not exists tasks_category_id_idx      on public.tasks (category_id);
create index if not exists categories_user_id_idx     on public.categories (user_id);

-- ---------------------------------------------------------------------
-- 3. TRIGGERS
-- ---------------------------------------------------------------------

-- 3a. Keep updated_at current on every UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- 3b. Maintain tasks.completed_at automatically from status
create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status <> 'completed' then
      new.completed_at := now();                              -- just completed
    else
      new.completed_at := coalesce(old.completed_at, now());  -- stays completed
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completed_at on public.tasks;
create trigger tasks_set_completed_at
  before insert or update on public.tasks
  for each row execute function public.set_task_completed_at();

-- 3c. On sign-up: create profile, settings and the 7 default categories.
-- SECURITY DEFINER so it can write rows for the new user; search_path is
-- pinned to avoid search-path hijacking.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.categories (user_id, name, color) values
    (new.id, 'Personal', '#7c5cff'),
    (new.id, 'Work',     '#3b82f6'),
    (new.id, 'Study',    '#06b6d4'),
    (new.id, 'Shopping', '#f59e0b'),
    (new.id, 'Health',   '#10b981'),
    (new.id, 'Meetings', '#ec4899'),
    (new.id, 'Other',    '#64748b')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY – every user sees and changes only their rows
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.tasks         enable row level security;
alter table public.user_settings enable row level security;

-- profiles (row id = auth user id)
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using ((select auth.uid()) = id);

-- categories
drop policy if exists "categories_select_own" on public.categories;
drop policy if exists "categories_insert_own" on public.categories;
drop policy if exists "categories_update_own" on public.categories;
drop policy if exists "categories_delete_own" on public.categories;
create policy "categories_select_own" on public.categories
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "categories_insert_own" on public.categories
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "categories_update_own" on public.categories
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "categories_delete_own" on public.categories
  for delete to authenticated using ((select auth.uid()) = user_id);

-- tasks
drop policy if exists "tasks_select_own" on public.tasks;
drop policy if exists "tasks_insert_own" on public.tasks;
drop policy if exists "tasks_update_own" on public.tasks;
drop policy if exists "tasks_delete_own" on public.tasks;
create policy "tasks_select_own" on public.tasks
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks_update_own" on public.tasks
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete to authenticated using ((select auth.uid()) = user_id);

-- user_settings
drop policy if exists "user_settings_select_own" on public.user_settings;
drop policy if exists "user_settings_insert_own" on public.user_settings;
drop policy if exists "user_settings_update_own" on public.user_settings;
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_settings_insert_own" on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "user_settings_update_own" on public.user_settings
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "user_settings_delete_own" on public.user_settings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous (logged-out) visitors get no table access at all.
revoke all on public.profiles, public.categories, public.tasks, public.user_settings from anon;
grant select, insert, update, delete
  on public.profiles, public.categories, public.tasks, public.user_settings to authenticated;

-- ---------------------------------------------------------------------
-- 5. BACKFILL – gives users who signed up BEFORE this script ran
--    their profile, settings and default categories. Harmless otherwise.
-- ---------------------------------------------------------------------
insert into public.profiles (id, full_name)
select u.id, nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')
from auth.users u
on conflict (id) do nothing;

insert into public.user_settings (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

insert into public.categories (user_id, name, color)
select u.id, d.name, d.color
from auth.users u
cross join (values
  ('Personal', '#7c5cff'), ('Work', '#3b82f6'), ('Study', '#06b6d4'),
  ('Shopping', '#f59e0b'), ('Health', '#10b981'), ('Meetings', '#ec4899'),
  ('Other', '#64748b')
) as d(name, color)
where not exists (select 1 from public.categories c where c.user_id = u.id)
on conflict (user_id, name) do nothing;

-- Done. ✔