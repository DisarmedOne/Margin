const test = require('node:test');
const assert = require('node:assert');
const { daysUntil, validDate, planFor, pickQuestions } = require('./exam');

const at = (d, h = 12) => new Date(2026, 2, d, h).getTime(); // March 2026
const paper = (id, n, progress = {}) => ({
  id,
  status: 'ready',
  outline: { chapters: Array.from({ length: n }, (_, i) => ({ title: `${id}${i}` })) },
  progress,
  levels: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, { challenges: [{ prompt: `${id}${i}a` }, { prompt: `${id}${i}b` }], boss: [{ prompt: `${id}${i}c` }] }])),
});
const exam = { date: '2026-03-11', paperIds: ['a', 'b'] };

test('days until the exam count calendar days, also across a clock change', () => {
  assert.equal(daysUntil('2026-03-11', at(1, 23)), 10);
  assert.equal(daysUntil('2026-04-02', at(27, 0)), 6);
  assert.equal(daysUntil('2026-03-01', at(2)), -1);
  assert.ok(validDate('2026-03-11'));
  assert.ok(!validDate('2026-02-30'));
  assert.ok(!validDate('11-03-2026'));
});

test('the plan alternates papers and spreads what is left over the study days', () => {
  const plan = planFor(exam, [paper('a', 9), paper('b', 9)], at(1)); // 10 days out: 9 study days
  assert.equal(plan.total, 18);
  assert.deepEqual(plan.today, [{ paperId: 'a', ch: 0, done: false }, { paperId: 'b', ch: 0, done: false }]);
});

test('finishing a chapter ticks it off without pulling in another', () => {
  const plan = planFor(exam, [paper('a', 9, { 0: { done: true, doneAt: at(1, 9) } }), paper('b', 9)], at(1));
  assert.deepEqual(plan.today, [{ paperId: 'a', ch: 0, done: true }, { paperId: 'b', ch: 0, done: false }]);
});

test('missed days raise the daily share, and the last day takes everything left', () => {
  const papers = [paper('a', 9), paper('b', 9)];
  assert.equal(planFor(exam, papers, at(6)).today.length, 5); // 18 over 4 study days
  assert.equal(planFor(exam, papers, at(11)).today.length, 18);
  assert.equal(planFor(exam, papers, at(12)).today.length, 0); // the date has passed
});

test('practice questions come from finished chapters and cover each of them', () => {
  const papers = [paper('a', 3, { 0: { done: true }, 1: { done: true } }), paper('b', 3, { 2: { done: true } })];
  const qs = pickQuestions(exam, papers, 6);
  assert.equal(qs.length, 6);
  const count = {};
  for (const q of qs) count[q.paperId + q.ch] = (count[q.paperId + q.ch] || 0) + 1;
  assert.deepEqual(count, { a0: 2, a1: 2, b2: 2 });
  assert.equal(pickQuestions(exam, papers, 50).length, 9);
  assert.equal(pickQuestions(exam, [paper('a', 3)], 20).length, 0);
});
