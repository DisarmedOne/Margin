-- Checks the group rules with three made-up users, then undoes everything.
-- Run after groups.sql, in a new SQL Editor query. It always ends in an "error": that is how it
-- throws the test data away. Success reads: ALL GROUP CHECKS PASSED (nothing was kept)
do $$
declare
  ann uuid := gen_random_uuid();
  bob uuid := gen_random_uuid();
  cat uuid := gen_random_uuid();
  g uuid;
  invite text;
  r jsonb;
  bob_member uuid;
  i integer;
  stopped boolean;
begin
  insert into auth.users (id, aud, role, email) values
    (ann, 'authenticated', 'authenticated', ann || '@test.invalid'),
    (bob, 'authenticated', 'authenticated', bob || '@test.invalid'),
    (cat, 'authenticated', 'authenticated', cat || '@test.invalid');

  -- act as Ann
  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ann::text, true);
  g := public.group_create('  Study   crew ', 'Ann', current_date + 10, 5);
  r := public.groups_mine();
  assert r -> 0 ->> 'name' = 'Study crew', 'name is tidied';
  assert (r -> 0 ->> 'weeklyGoal')::int = 100, 'goal is clamped';
  invite := r -> 0 ->> 'code';
  assert invite ~ '^[23456789A-HJKMNP-Z]{8}$', 'invite code shape';
  assert r::text not like '%test.invalid%' and r::text not like '%' || ann || '%', 'no email or account id leaves';

  -- Bob: sees nothing until he joins; a wrong code does not work
  perform set_config('request.jwt.claims', json_build_object('sub', bob, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', bob::text, true);
  assert public.groups_mine() = '[]'::jsonb, 'outsiders see nothing';
  assert public.group_join('WRONGCODE', 'Bob') ->> 'error' = 'code', 'wrong code';
  assert public.group_join(lower(substr(invite, 1, 4)) || '-' || substr(invite, 5), 'Bob') ->> 'id' = g::text, 'join, however it is typed';
  perform public.group_report(current_date, 250, 3, current_date);
  stopped := false;
  begin perform public.group_delete(g); exception when others then stopped := sqlerrm = 'margin:owner'; end;
  assert stopped, 'members cannot delete the group';
  stopped := false;
  begin perform public.group_update(g, 'x', null, 500); exception when others then stopped := sqlerrm = 'margin:owner'; end;
  assert stopped, 'members cannot edit the group';
  select id into bob_member from public.group_members where user_id = bob;

  -- guessing is limited (2 attempts used above)
  for i in 1..8 loop perform public.group_join('WRONGCODE', 'Bob'); end loop;
  assert public.group_join(invite, 'Bob') ->> 'error' = 'rate', 'guessing is limited';

  -- Ann removes Bob: the old code stops working
  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', ann::text, true);
  perform public.group_remove_member(g, bob_member);
  assert jsonb_array_length(public.groups_mine() -> 0 -> 'members') = 1, 'member removed';
  assert public.groups_mine() -> 0 ->> 'code' <> invite, 'code replaced';
  invite := public.groups_mine() -> 0 ->> 'code';

  -- Cat joins; when Ann's account is deleted, Cat becomes owner. When Cat leaves, the group is gone.
  perform set_config('request.jwt.claims', json_build_object('sub', cat, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', cat::text, true);
  assert public.group_join(invite, 'Cat') ? 'id', 'second join';
  delete from auth.users where id = ann;
  r := public.groups_mine();
  assert jsonb_array_length(r -> 0 -> 'members') = 1 and (r -> 0 ->> 'owner')::boolean, 'ownership moves on';
  perform public.group_leave(g);
  assert not exists (select 1 from public.groups where id = g), 'empty group is deleted';

  -- the tables and helpers are closed to the app's roles
  assert not has_table_privilege('authenticated', 'public.group_members', 'select'), 'table closed';
  assert not has_function_privilege('anon', 'public.groups_mine()', 'execute'), 'signed-out users cannot call';
  assert not has_function_privilege('authenticated', 'public.group_new_invite()', 'execute'), 'helpers closed';

  raise exception 'ALL GROUP CHECKS PASSED (nothing was kept)';
end $$;
