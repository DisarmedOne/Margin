const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The renderer uses ES modules, which this CommonJS package loads through a data address.
const load = () => import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(__dirname, '../renderer/focus.js'), 'utf8')));

test('the focus timer runs 25 minutes, then a 5 minute break, then waits', async () => {
  const f = await load();
  let s = f.start(f.idle(), 0);
  assert.equal(f.minutes(f.remaining(s, 0)), '25:00');
  assert.equal(f.tick(s, f.FOCUS_MS - 1).event, null);
  s = f.pause(s, 60e3);
  assert.equal(f.tick(s, 10 * f.FOCUS_MS).event, null, 'a paused timer does not run out');
  s = f.resume(s, 1000e3);
  assert.equal(f.remaining(s, 1000e3), f.FOCUS_MS - 60e3);
  let r = f.tick(s, 1000e3 + f.FOCUS_MS);
  assert.deepEqual([r.event, r.state.phase, r.state.rounds], ['break', 'break', 1]);
  r = f.tick(r.state, r.state.endsAt);
  assert.deepEqual([r.event, r.state.phase, r.state.rounds], ['done', 'idle', 1]);
  assert.equal(f.minutes(999), '0:01');
});
