-- Margin paper limit. Run the whole file once in Supabase: SQL Editor > New query > Run.
-- It is safe to run again after an update, and doing so keeps the counts.
--
-- Each email address can have 3 different papers read, ever. Removing a paper, reinstalling Margin
-- or deleting the account does not give a place back. To change the number, edit paper_max below
-- and run the file again.
--
-- Stored per paper: a scrambled form of the email address, a scrambled fingerprint of the file,
-- and the time. No address, file name or text. These rows deliberately outlive the account,
-- so the privacy policy has to say so.
--
-- To give one address its places back (for testing), run this by itself:
--   delete from public.paper_usage where email_key = public.paper_email_key('someone@example.com');
--
-- This limits what the Margin app does. It cannot protect a shared AI key: that needs the AI
-- requests to go through a server which calls paper_claim itself.

create table if not exists public.paper_usage (
  email_key bytea not null, -- no link to auth.users on purpose: deleting the account must not reset the count
  paper_key bytea not null,
  at timestamptz not null default now(),
  primary key (email_key, paper_key)
);

-- A random secret mixed into the scrambling, so addresses cannot be guessed back from the table alone.
create table if not exists public.paper_secret (
  one boolean primary key default true check (one),
  secret text not null default gen_random_uuid()::text || gen_random_uuid()::text
);
insert into public.paper_secret default values on conflict do nothing;

alter table public.paper_usage enable row level security;
alter table public.paper_secret enable row level security;
revoke all on public.paper_usage, public.paper_secret from anon, authenticated;

-- ---------- helpers (not callable from outside) ----------
create or replace function public.paper_max() returns integer
language sql immutable set search_path = '' as $$ select 3 $$;

-- Spellings that reach the same inbox count as one: capitals, "+anything", and dots in Gmail addresses.
create or replace function public.paper_email_key(p_email text) returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare
  v_name text := split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1);
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
begin
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_domain := 'gmail.com';
    v_name := replace(v_name, '.', '');
  end if;
  return sha256(convert_to((select secret from public.paper_secret) || '|' || v_name || '@' || v_domain, 'UTF8'));
end $$;

-- The signed-in person's address, read from the account itself and never taken from the app.
create or replace function public.paper_me() returns bytea
language plpgsql stable security definer set search_path = '' as $$
declare v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null or v_email = '' then raise exception 'margin:signin'; end if;
  return public.paper_email_key(v_email);
end $$;

create or replace function public.paper_count(p_email_key bytea) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.paper_usage where email_key = p_email_key
$$;

create or replace function public.paper_file_key(p_email_key bytea, p_fingerprint text) returns bytea
language plpgsql immutable set search_path = '' as $$
begin
  if p_fingerprint !~ '^[0-9a-f]{64}$' or p_fingerprint is null then raise exception 'margin:paper'; end if;
  -- Mixed with the person's own key, so two people with the same file cannot be matched up.
  return sha256(p_email_key || convert_to(p_fingerprint, 'UTF8'));
end $$;

-- ---------- called by the app ----------
-- How many places are used, and whether this file already has one. Changes nothing.
create or replace function public.paper_status(p_fingerprint text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me bytea := public.paper_me();
begin
  return jsonb_build_object(
    'used', public.paper_count(v_me),
    'max', public.paper_max(),
    'known', p_fingerprint is not null and exists (
      select 1 from public.paper_usage where email_key = v_me and paper_key = public.paper_file_key(v_me, p_fingerprint))
  );
end $$;

-- Takes a place for a file that has been read. The same file never takes a second one.
create or replace function public.paper_claim(p_fingerprint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me bytea := public.paper_me();
  v_paper bytea := public.paper_file_key(v_me, p_fingerprint);
begin
  -- One claim at a time per address, so two at once cannot both take the last place.
  perform pg_advisory_xact_lock(hashtextextended(encode(v_me, 'hex'), 0));
  if not exists (select 1 from public.paper_usage where email_key = v_me and paper_key = v_paper) then
    if public.paper_count(v_me) >= public.paper_max() then
      return jsonb_build_object('error', 'full', 'used', public.paper_count(v_me), 'max', public.paper_max());
    end if;
    insert into public.paper_usage (email_key, paper_key) values (v_me, v_paper);
  end if;
  return jsonb_build_object('used', public.paper_count(v_me), 'max', public.paper_max());
end $$;

revoke all on function
  public.paper_max(), public.paper_email_key(text), public.paper_me(), public.paper_count(bytea),
  public.paper_file_key(bytea, text), public.paper_status(text), public.paper_claim(text)
from public, anon, authenticated;
grant execute on function public.paper_status(text), public.paper_claim(text) to authenticated;

notify pgrst, 'reload schema';
