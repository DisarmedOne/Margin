const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

// groups.js needs only MarginError from ./ai; stand it in so no AI libraries load.
const load = Module._load;
Module._load = (name, ...rest) =>
  name === './ai' ? { MarginError: class extends Error { constructor(code, message) { super(message); this.code = code; } } } : load(name, ...rest);
const { client, view, myStats, weekStart } = require('./groups');

const at = (d, h = 12) => new Date(2026, 2, d, h).getTime(); // 2 March 2026 is a Monday
const profile = { daily: { '2026-03-01': 99, '2026-03-02': 40, '2026-03-05': 25 }, streak: { count: 3, last: '2026-03-05' } };

test('the week runs Monday to Sunday and only this week counts', () => {
  assert.equal(weekStart(at(2, 0)), '2026-03-02');
  assert.equal(weekStart(at(8, 23)), '2026-03-02');
  assert.deepEqual(myStats(profile, at(5)), { p_week: '2026-03-02', p_week_xp: 65, p_streak: 3, p_active_on: '2026-03-05' });
});

test('old numbers are not shown as current', () => {
  const member = (o) => ({ id: 'm', name: 'A', owner: false, me: false, week: '2026-03-02', weekXp: 50, streak: 4, activeOn: '2026-03-05', ...o });
  const [g] = view([{ id: 'g', examDate: '2026-03-09', members: [member(), member({ week: '2026-02-23', activeOn: '2026-02-27' }), member({ activeOn: '2026-03-04' })] }], at(5));
  assert.equal(g.days, 4);
  assert.equal(g.weekXp, 100);
  assert.deepEqual(g.members.map((m) => [m.weekXp, m.streak, m.today]), [[50, 4, true], [0, 0, false], [50, 4, false]]);
});

test('study numbers are sent only by someone in a group, and database errors become plain messages', async () => {
  const real = globalThis.fetch;
  const calls = [];
  let groups = [];
  globalThis.fetch = async (url, init) => {
    const name = url.split('/rpc/')[1];
    calls.push(name);
    assert.equal(init.headers.authorization, 'Bearer token');
    if (name === 'groups_mine') return Response.json(groups);
    if (name === 'group_join') return Response.json({ error: 'full' });
    if (name === 'group_delete') return Response.json({ message: 'margin:owner' }, { status: 400 });
    if (name === 'group_leave') return Response.json({ code: 'PGRST202' }, { status: 404 });
    return new Response(null, { status: 204 });
  };
  const api = client(async () => 'token', () => profile);
  assert.deepEqual(await api.list(), []);
  assert.deepEqual(calls, ['groups_mine']);
  groups = [{ id: 'g', examDate: null, members: [] }];
  calls.length = 0;
  await api.list();
  assert.deepEqual(calls, ['groups_mine', 'group_report', 'groups_mine']);
  await assert.rejects(api.join('x', 'A'), /full/);
  await assert.rejects(api.remove('g'), /runs the group/);
  await assert.rejects(api.leave('g'), /not switched on/);
  assert.throws(() => api.create({ name: 'x', examDate: 'soon' }), /date/);
  globalThis.fetch = real;
});
