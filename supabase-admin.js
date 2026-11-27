-- =====================================================================
-- TASKFLOW – Admin upgrade
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query
-- (after supabase-setup.sql, which you have already run).
--
-- SAFE FOR YOUR EXISTING PROJECT:
--   • does NOT drop, rename or change any existing table
--   • does NOT delete or modify any user, task, category or setting
--   • only ADDS one small table (admin_users) and 4 read-only functions
--   • safe to run again
--
-- HOW ADMIN ACCESS IS SECURED
--   • Admins are listed in public.admin_users. That table has RLS turned on
--     with NO insert/update/delete policies and no API grants, so nobody can
--     make themselves admin from the browser. Only the SQL Editor (database
--     owner) can add admins (see step at the bottom of this file).
--   • The admin functions run inside the database (SECURITY DEFINER) and
--     first check is_admin() using the caller's verified login (auth.uid()).
--     Non-admins get "Not authorized" and receive no data.
--   • No service_role / secret key is ever needed in the browser.
--   • Admins see account details and task COUNTS only, never the
--     contents of other users' tasks.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Admin list
-- ---------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- Intentionally no policies: the table is invisible and read-only to the API.
revoke all on public.admin_users from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. is_admin() – true only for the signed-in caller if they are an admin
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------
-- 3. admin_list_users() – paged, searchable list of all accounts
-- ---------------------------------------------------------------------
drop function if exists public.admin_list_users(text, integer, integer);
create function public.admin_list_users(
  search_term text default null,
  page_size   integer default 20,
  page_offset integer default 0
)
returns table (
  id                  uuid,
  email               text,
  full_name           text,
  avatar_url          text,
  created_at          timestamptz,
  last_sign_in_at     timestamptz,
  email_confirmed_at  timestamptz,
  banned_until        timestamptz,
  is_admin            boolean,
  task_count          bigint,
  completed_count     bigint,
  total_count         bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  term text := nullif(trim(search_term), '');
  -- escape LIKE wildcards so a search for "a_b" or "50%" is literal
  pattern text := '%' || replace(replace(replace(coalesce(term, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.full_name,
    p.avatar_url,
    u.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    u.banned_until,
    exists (select 1 from public.admin_users a where a.user_id = u.id),
    coalesce(t.total, 0),
    coalesce(t.done, 0),
    count(*) over ()
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join lateral (
    select count(*) as total,
           count(*) filter (where tk.status = 'completed') as done
    from public.tasks tk
    where tk.user_id = u.id
  ) t on true
  where term is null
     or u.email ilike pattern
     or p.full_name ilike pattern
     or u.id::text = term
  order by u.created_at desc
  limit least(greatest(page_size, 1), 100)
  offset greatest(page_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. admin_user_stats() – totals, new / active users, 14-day sign-ups
--    tz = the admin's IANA time zone (e.g. 'Asia/Karachi') for day grouping
-- ---------------------------------------------------------------------
drop function if exists public.admin_user_stats(text);
create function public.admin_user_stats(tz text default 'UTC')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone tz)::date;
  result json;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select json_build_object(
    'total_users',     (select count(*) from auth.users),
    'new_today',       (select count(*) from auth.users where (created_at at time zone tz)::date = today),
    'new_7d',          (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d',         (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_7d',       (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'unconfirmed',     (select count(*) from auth.users where email_confirmed_at is null),
    'admins',          (select count(*) from public.admin_users),
    'total_tasks',     (select count(*) from public.tasks),
    'completed_tasks', (select count(*) from public.tasks where status = 'completed'),
    'signups_14d', (
      select json_agg(json_build_object('day', d::date, 'count', (
               select count(*) from auth.users u where (u.created_at at time zone tz)::date = d::date
             )) order by d)
      from generate_series(today - 13, today, interval '1 day') as d
    )
  ) into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. admin_get_user() – one account's profile + task statistics
-- ---------------------------------------------------------------------
drop function if exists public.admin_get_user(uuid, text);
create function public.admin_get_user(target_id uuid, tz text default 'UTC')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone tz)::date;
  result json;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select json_build_object(
    'id',                 u.id,
    'email',              u.email,
    'full_name',          p.full_name,
    'avatar_url',         p.avatar_url,
    'created_at',         u.created_at,
    'last_sign_in_at',    u.last_sign_in_at,
    'email_confirmed_at', u.email_confirmed_at,
    'banned_until',       u.banned_until,
    'profile_updated_at', p.updated_at,
    'is_admin',           exists (select 1 from public.admin_users a where a.user_id = u.id),
    'theme',              s.theme,
    'default_sort',       s.default_sort,
    'category_count',     (select count(*) from public.categories c where c.user_id = u.id),
    'tasks', (
      select json_build_object(
        'total',         count(*),
        'completed',     count(*) filter (where status = 'completed'),
        'pending',       count(*) filter (where status = 'pending'),
        'in_progress',   count(*) filter (where status = 'in_progress'),
        'overdue',       count(*) filter (where status <> 'completed' and due_date < today),
        'upcoming',      count(*) filter (where status <> 'completed' and due_date > today),
        'last_activity', max(updated_at)
      )
      from public.tasks tk where tk.user_id = u.id
    )
  )
  into result
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.user_settings s on s.user_id = u.id
  where u.id = target_id;

  return result; -- null when the user does not exist
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Permissions: only signed-in users may call; the functions themselves
--    reject everyone who is not in admin_users.
-- ---------------------------------------------------------------------
revoke all on function public.is_admin()                                   from public, anon;
revoke all on function public.admin_list_users(text, integer, integer)     from public, anon;
revoke all on function public.admin_user_stats(text)                       from public, anon;
revoke all on function public.admin_get_user(uuid, text)                   from public, anon;
grant execute on function public.is_admin()                                to authenticated;
grant execute on function public.admin_list_users(text, integer, integer)  to authenticated;
grant execute on function public.admin_user_stats(text)                    to authenticated;
grant execute on function public.admin_get_user(uuid, text)                to authenticated;

-- =====================================================================
-- 7. MAKE YOURSELF ADMIN  (ACTION REQUIRED – do this once)
--    1) Register your account in the TASKFLOW app first.
--    2) Replace the email below with YOUR email, remove the two dashes
--       at the start of the 3 lines, select ONLY those lines and click Run.
--
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'your-email@example.com'
-- on conflict (user_id) do nothing;
--
--    To remove an admin later:
-- delete from public.admin_users
-- where user_id = (select id from auth.users where email = 'their-email@example.com');
-- =====================================================================
