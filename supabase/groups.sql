-- Margin study groups. Run the whole file once in Supabase: SQL Editor > New query > Run.
-- It is safe to run again after an update.
--
-- Who can see what is decided here, not in the app. The tables are closed to everyone; the only
-- way in is through the functions below, and each one checks the signed-in user first.
-- A group never receives email addresses, papers or lessons.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  code text not null unique,
  exam_date date,
  weekly_goal integer not null default 1000 check (weekly_goal between 100 and 100000),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(), -- what other members see; account ids stay private
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade, -- deleting the account removes this
  display_name text not null check (char_length(display_name) between 1 and 24),
  is_owner boolean not null default false,
  joined_at timestamptz not null default now(),
  week date,
  week_xp integer not null default 0,
  streak integer not null default 0,
  active_on date,
  unique (group_id, user_id)
);

create table if not exists public.group_join_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists group_join_attempts_user on public.group_join_attempts (user_id, at);
create index if not exists group_members_user on public.group_members (user_id);

-- Row level security with no policies: no direct reading or writing, for anyone signed in or not.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_join_attempts enable row level security;
revoke all on public.groups, public.group_members, public.group_join_attempts from anon, authenticated;

-- When someone leaves (or deletes their account): drop an empty group, otherwise keep an owner.
create or replace function public.group_after_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_members where group_id = old.group_id) then
    delete from public.groups where id = old.group_id;
  elsif not exists (select 1 from public.group_members where group_id = old.group_id and is_owner) then
    update public.group_members set is_owner = true
    where id = (select id from public.group_members where group_id = old.group_id order by joined_at, id limit 1);
  end if;
  return null;
end $$;
drop trigger if exists group_after_leave on public.group_members;
create trigger group_after_leave after delete on public.group_members
  for each row execute function public.group_after_leave();

-- ---------- helpers (not callable from outside) ----------
create or replace function public.group_me() returns uuid
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'margin:signin'; end if;
  return auth.uid();
end $$;

create or replace function public.group_clean(p_text text, p_max integer) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(regexp_replace(coalesce(p_text, ''), '[[:cntrl:][:space:]]+', ' ', 'g'));
begin
  if v = '' or char_length(v) > p_max then raise exception 'margin:name'; end if;
  return v;
end $$;

-- Eight characters without look-alikes (no 0/O, 1/I/L). Bytes 6 and 8 of a random uuid are not random, so they are skipped.
create or replace function public.group_new_invite() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea;
  result text;
  i integer;
begin
  loop
    bytes := uuid_send(gen_random_uuid());
    result := '';
    foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
      result := result || substr(alphabet, get_byte(bytes, i) % char_length(alphabet) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.groups where code = result);
  end loop;
  return result;
end $$;

create or replace function public.group_require_owner(p_group uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = public.group_me() and is_owner) then
    raise exception 'margin:owner';
  end if;
end $$;

-- ---------- what the app calls ----------
create or replace function public.groups_mine() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id, 'name', g.name, 'code', g.code, 'examDate', g.exam_date, 'weeklyGoal', g.weekly_goal,
    'owner', mine.is_owner,
    'members', (
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.display_name, 'owner', m.is_owner, 'me', m.user_id = mine.user_id,
        'week', m.week, 'weekXp', m.week_xp, 'streak', m.streak, 'activeOn', m.active_on
      ) order by lower(m.display_name), m.id)
      from public.group_members m where m.group_id = g.id)
  ) order by mine.joined_at, g.id), '[]'::jsonb)
  from public.group_members mine join public.groups g on g.id = mine.group_id
  where mine.user_id = public.group_me()
$$;

create or replace function public.group_create(p_name text, p_display text, p_exam_date date, p_goal integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.group_me();
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(me::text));
  if (select count(*) from public.group_members where user_id = me) >= 5 then raise exception 'margin:limit'; end if;
  insert into public.groups (name, code, exam_date, weekly_goal)
  values (public.group_clean(p_name, 40), public.group_new_invite(), p_exam_date, least(100000, greatest(100, coalesce(p_goal, 1000))))
  returning id into new_id;
  insert into public.group_members (group_id, user_id, display_name, is_owner)
  values (new_id, me, public.group_clean(p_display, 24), true);
  return new_id;
end $$;

-- Problems are returned, not raised: raising would undo the record of the attempt and with it the limit.
create or replace function public.group_join(p_code text, p_display text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.group_me();
  who text := public.group_clean(p_display, 24);
  target public.groups%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(me::text));
  delete from public.group_join_attempts where user_id = me and at < now() - interval '1 hour';
  if (select count(*) from public.group_join_attempts where user_id = me) >= 10 then
    return jsonb_build_object('error', 'rate');
  end if;
  insert into public.group_join_attempts (user_id) values (me);

  select * into target from public.groups where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) for update;
  if not found then return jsonb_build_object('error', 'code'); end if;
  if exists (select 1 from public.group_members where group_id = target.id and user_id = me) then
    return jsonb_build_object('id', target.id);
  end if;
  if (select count(*) from public.group_members where user_id = me) >= 5 then return jsonb_build_object('error', 'limit'); end if;
  if (select count(*) from public.group_members where group_id = target.id) >= 20 then return jsonb_build_object('error', 'full'); end if;
  insert into public.group_members (group_id, user_id, display_name) values (target.id, me, who);
  return jsonb_build_object('id', target.id);
end $$;

-- The app's own numbers. They are for friendly goals: someone determined could fake them.
create or replace function public.group_report(p_week date, p_week_xp integer, p_streak integer, p_active_on date) returns void
language sql security definer set search_path = '' as $$
  update public.group_members set
    week = p_week,
    week_xp = least(100000, greatest(0, coalesce(p_week_xp, 0))),
    streak = least(3650, greatest(0, coalesce(p_streak, 0))),
    active_on = p_active_on
  where user_id = public.group_me()
$$;

create or replace function public.group_update(p_group uuid, p_name text, p_exam_date date, p_goal integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.group_require_owner(p_group);
  update public.groups set
    name = public.group_clean(p_name, 40), exam_date = p_exam_date,
    weekly_goal = least(100000, greatest(100, coalesce(p_goal, 1000)))
  where id = p_group;
end $$;

create or replace function public.group_set_display(p_group uuid, p_display text) returns void
language sql security definer set search_path = '' as $$
  update public.group_members set display_name = public.group_clean(p_display, 24)
  where group_id = p_group and user_id = public.group_me()
$$;

create or replace function public.group_leave(p_group uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.group_members where group_id = p_group and user_id = public.group_me()
$$;

-- Removing someone also replaces the invite code, so the old one cannot bring them back.
create or replace function public.group_remove_member(p_group uuid, p_member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.group_require_owner(p_group);
  delete from public.group_members where id = p_member and group_id = p_group and user_id <> public.group_me();
  if found then update public.groups set code = public.group_new_invite() where id = p_group; end if;
end $$;

create or replace function public.group_replace_code(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.group_require_owner(p_group);
  update public.groups set code = public.group_new_invite() where id = p_group;
end $$;

create or replace function public.group_delete(p_group uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.group_require_owner(p_group);
  delete from public.groups where id = p_group;
end $$;

-- Only signed-in users may call the app's functions. The helpers are for the functions above only.
revoke execute on function
  public.group_after_leave(), public.group_me(), public.group_clean(text, integer), public.group_new_invite(), public.group_require_owner(uuid),
  public.groups_mine(), public.group_create(text, text, date, integer), public.group_join(text, text),
  public.group_report(date, integer, integer, date), public.group_update(uuid, text, date, integer), public.group_set_display(uuid, text),
  public.group_leave(uuid), public.group_remove_member(uuid, uuid), public.group_replace_code(uuid), public.group_delete(uuid)
from public, anon, authenticated;

grant execute on function
  public.groups_mine(), public.group_create(text, text, date, integer), public.group_join(text, text),
  public.group_report(date, integer, integer, date), public.group_update(uuid, text, date, integer), public.group_set_display(uuid, text),
  public.group_leave(uuid), public.group_remove_member(uuid, uuid), public.group_replace_code(uuid), public.group_delete(uuid)
to authenticated;
