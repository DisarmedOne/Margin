-- Checks the paper limit with made-up users, then undoes everything.
-- Run after papers.sql, in a new SQL Editor query. It always ends in an "error": that is how it
-- throws the test data away. Success reads: ALL PAPER CHECKS PASSED (nothing was kept)
do $$
declare
  ann uuid := gen_random_uuid();
  again uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  tag text := replace(gen_random_uuid()::text, '-', '');
  r jsonb;
  i integer;
  stopped boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ann, 'authenticated', 'authenticated', 'ann.' || tag || '@gmail.com'),
    (bob, 'authenticated', 'authenticated', 'bob' || tag || '@test.invalid');

  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ann::text, true);
  assert public.paper_status() ->> 'used' = '0', 'starts empty';
  for i in 1..5 loop
    r := public.paper_claim(repeat(i::text, 64));
    assert (r ->> 'used')::int = i and not r ? 'error', 'claim counts';
  end loop;
  assert public.paper_claim(repeat('6', 64)) ->> 'error' = 'full', 'sixth is refused';
  r := public.paper_claim(repeat('1', 64));
  assert not r ? 'error' and r ->> 'used' = '5', 'the same file takes no second place';
  assert (public.paper_status(repeat('1', 64)) ->> 'known')::boolean, 'known file';
  assert not (public.paper_status(repeat('7', 64)) ->> 'known')::boolean, 'unknown file';
  stopped := false;
  begin perform public.paper_claim('not a fingerprint'); exception when others then stopped := sqlerrm = 'margin:paper'; end;
  assert stopped, 'bad fingerprint';

  -- Ann deletes the account and signs up again with another spelling of the same inbox: still full
  delete from auth.users where id = ann;
  insert into auth.users (id, aud, role, email) values (again, 'authenticated', 'authenticated', 'A.N.N' || tag || '+new@googlemail.com');
  perform set_config('request.jwt.claims', json_build_object('sub', again, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', again::text, true);
  assert public.paper_status() ->> 'used' = '5', 'count survives deletion and respelling';

  -- Bob has his own five
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', bob::text, true);
  assert public.paper_status() ->> 'used' = '0', 'separate people, separate counts';

  assert not has_table_privilege('authenticated', 'public.paper_usage', 'select'), 'counts closed';
  assert not has_table_privilege('authenticated', 'public.paper_secret', 'select'), 'secret closed';
  assert not has_function_privilege('anon', 'public.paper_claim(text)', 'execute'), 'signed-out users cannot call';
  assert not has_function_privilege('authenticated', 'public.paper_email_key(text)', 'execute'), 'helpers closed';

  raise exception 'ALL PAPER CHECKS PASSED (nothing was kept)';
end $$;
