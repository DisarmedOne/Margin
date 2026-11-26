const test = require('node:test');
const assert = require('node:assert');
const { schedule, rankFor, touchStreak, liveStreak, DAY } = require('./srs');

const T = new Date(2026, 0, 10, 12).getTime();

test('again brings a card back in 10 minutes and resets reps', () => {
  const c = schedule({ ease: 2.5, interval: 6, reps: 2 }, 0, T);
  assert.equal(c.reps, 0);
  assert.equal(c.due - T, 10 * 60e3);
  assert.ok(c.ease < 2.5);
});

test('good grows the interval 1, 6, then by ease', () => {
  let c = schedule({}, 2, T);
  assert.equal(c.interval, 1);
  c = schedule(c, 2, T);
  assert.equal(c.interval, 6);
  c = schedule(c, 2, T);
  assert.equal(c.interval, 15);
  assert.equal(c.due, T + 15 * DAY);
});

test('ease never drops below 1.3', () => {
  let c = { ease: 1.35 };
  for (let i = 0; i < 5; i++) c = schedule(c, 0, T);
  assert.equal(c.ease, 1.3);
});

test('rank thresholds', () => {
  assert.equal(rankFor(0).name, 'Reader');
  assert.equal(rankFor(299).name, 'Reader');
  assert.equal(rankFor(300).name, 'Annotator');
  assert.equal(rankFor(999999).next, null);
});

test('streak continues on consecutive days and breaks on a gap', () => {
  let s = touchStreak({ count: 0, last: null }, T);
  assert.equal(s.count, 1);
  assert.equal(touchStreak(s, T + 3600e3).count, 1);
  s = touchStreak(s, T + DAY);
  assert.equal(s.count, 2);
  assert.equal(liveStreak(s, T + 3 * DAY), 0);
  assert.equal(touchStreak(s, T + 3 * DAY).count, 1);
});
