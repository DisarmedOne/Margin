-- Steelfable admin dashboard. Run after groups.sql and papers.sql: SQL Editor > New query > Run.
-- It is safe to run again after an update.
--
-- Nobody is an admin until you add them. To make an account an admin, sign in to it once, then
-- run this by itself with that address:
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com' on conflict do nothing;
-- To remove an admin:
--   delete from public.admins where user_id in (select id from auth.users where email = 'you@example.com');
--
-- There is deliberately no function that adds an admin: only the SQL Editor can.

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- One row per email send from the dashboard. No message text and no addresses are kept here.
create table if not exists public.admin_mail_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_id uuid references auth.users (id) on delete set null,
  sender text not null,
  subject text not null,
  to_everyone boolean not null,
  recipients integer not null,
  sent boolean -- null while sending, or if the result never came back
);

alter table public.admins enable row level security;
alter table public.admin_mail_log enable row level security;
revoke all on public.admins, public.admin_mail_log from anon, authenticated;

-- ---------- helper (not callable from outside) ----------
create or replace function public.admin_require() returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'margin:forbidden';
  end if;
  return auth.uid();
end $$;

-- ---------- called by the dashboard ----------
-- shortcut: returns the newest 500 accounts in one answer; add pages when there are more.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.admin_require();
begin
  return jsonb_build_object(
    'me', v_me,
    'totals', (select jsonb_build_object(
        'accounts', count(*),
        'new7', count(*) filter (where created_at > now() - interval '7 days'),
        'signedIn7', count(*) filter (where last_sign_in_at > now() - interval '7 days'))
      from auth.users),
    'groups', (select count(*) from public.groups),
    'users', coalesce((select jsonb_agg(to_jsonb(u) order by u."createdAt" desc) from (
        select a.id,
               a.email,
               a.created_at as "createdAt",
               a.last_sign_in_at as "lastSignIn",
               coalesce(a.raw_app_meta_data ->> 'provider', 'email') as provider,
               case when coalesce(a.email, '') = '' then 0
                    else public.paper_count(public.paper_email_key(a.email)) end as papers,
               (select count(*) from public.group_members m where m.user_id = a.id) as groups,
               (select max(m.active_on) from public.group_members m where m.user_id = a.id) as "lastStudied"
        from auth.users a order by a.created_at desc limit 500) u), '[]'::jsonb),
    'mail', coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from (
        select at, sender, subject, to_everyone as "toEveryone", recipients, sent
        from public.admin_mail_log order by at desc limit 20) l), '[]'::jsonb)
  );
end $$;

-- Picks the recipients here, from real accounts, so the website can never send to an arbitrary address.
-- p_user is one account; leave it out to write to every account.
create or replace function public.admin_mail_start(p_sender text, p_subject text, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.admin_require();
  v_emails text[];
  v_today integer;
  v_id bigint;
begin
  select array_agg(email order by created_at) into v_emails from auth.users
   where coalesce(email, '') <> '' and email_confirmed_at is not null and (p_user is null or id = p_user);
  if v_emails is null then return jsonb_build_object('error', 'nobody'); end if;
  -- One send at a time, so two together cannot both pass the daily limit.
  perform pg_advisory_xact_lock(hashtext('admin_mail'));
  -- 90 of Resend's 100 free emails a day: the rest stays free for sign-in codes.
  select coalesce(sum(recipients), 0) into v_today from public.admin_mail_log
   where at > now() - interval '24 hours' and sent is distinct from false;
  if v_today + cardinality(v_emails) > 90 then
    return jsonb_build_object('error', 'limit', 'left', greatest(90 - v_today, 0), 'needed', cardinality(v_emails));
  end if;
  insert into public.admin_mail_log (admin_id, sender, subject, to_everyone, recipients)
  values (v_me, left(p_sender, 100), left(p_subject, 200), p_user is null, cardinality(v_emails))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'emails', to_jsonb(v_emails));
end $$;

create or replace function public.admin_mail_done(p_id bigint, p_sent boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.admin_require();
begin
  update public.admin_mail_log set sent = p_sent where id = p_id and admin_id = v_me and sent is null;
end $$;

revoke all on function
  public.admin_require(), public.admin_overview(), public.admin_mail_start(text, text, uuid), public.admin_mail_done(bigint, boolean)
from public, anon, authenticated;
grant execute on function public.admin_overview(), public.admin_mail_start(text, text, uuid), public.admin_mail_done(bigint, boolean) to authenticated;

notify pgrst, 'reload schema';
