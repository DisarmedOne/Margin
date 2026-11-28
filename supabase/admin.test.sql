-- Checks the admin rules with made-up users, then undoes everything.
-- Run after admin.sql, in a new SQL Editor query. It always ends in an "error": that is how it
-- throws the test data away. Success reads: ALL ADMIN CHECKS PASSED (nothing was kept)
do $$
declare
  boss uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  r jsonb;
  stopped boolean;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at) values
    (boss, 'authenticated', 'authenticated', boss || '@test.invalid', now(), now()),
    (bob, 'authenticated', 'authenticated', bob || '@test.invalid', now(), now());
  insert into public.admins (user_id) values (boss);
  delete from public.admin_mail_log; -- undone with everything else

  -- Bob is not an admin: every door is shut
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', bob::text, true);
  stopped := false;
  begin perform public.admin_overview(); exception when others then stopped := sqlerrm = 'margin:forbidden'; end;
  assert stopped, 'overview closed';
  stopped := false;
  begin perform public.admin_mail_start('a', 'b', bob); exception when others then stopped := sqlerrm = 'margin:forbidden'; end;
  assert stopped, 'mail closed';
  stopped := false;
  begin perform public.admin_mail_done(1, true); exception when others then stopped := sqlerrm = 'margin:forbidden'; end;
  assert stopped, 'mail result closed';

  -- Boss
  perform set_config('request.jwt.claims', json_build_object('sub', boss, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', boss::text, true);
  r := public.admin_overview();
  assert r ->> 'me' = boss::text, 'knows who is asking';
  assert (r -> 'totals' ->> 'accounts')::int >= 2, 'counts accounts';
  assert r -> 'users' -> 0 ? 'papers', 'shows paper count';
  r := public.admin_mail_start('support@steelfable.com', 'Hello', bob);
  assert r -> 'emails' = jsonb_build_array(bob || '@test.invalid'), 'one account, its own address';
  perform public.admin_mail_done((r ->> 'id')::bigint, true);
  assert public.admin_overview() -> 'mail' -> 0 ->> 'sent' = 'true', 'logged';
  assert public.admin_mail_start('a', 'b', gen_random_uuid()) ->> 'error' = 'nobody', 'unknown account';
  insert into public.admin_mail_log (sender, subject, to_everyone, recipients, sent) values ('a', 'b', true, 89, true);
  assert public.admin_mail_start('a', 'b', bob) ->> 'error' = 'limit', 'daily limit';

  assert not has_table_privilege('authenticated', 'public.admins', 'insert'), 'nobody can make themselves admin';
  assert not has_table_privilege('authenticated', 'public.admin_mail_log', 'select'), 'log closed';
  assert not has_function_privilege('anon', 'public.admin_overview()', 'execute'), 'signed-out users cannot call';
  assert not has_function_privilege('authenticated', 'public.admin_require()', 'execute'), 'helper closed';

  raise exception 'ALL ADMIN CHECKS PASSED (nothing was kept)';
end $$;
