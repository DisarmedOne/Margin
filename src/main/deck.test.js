const test = require('node:test');
const assert = require('node:assert');
const { cardText, shouldRemind, FRONT } = require('./deck');

test('a card needs both sides, and long text is cut', () => {
  assert.deepEqual(cardText({ front: '  Q  ', back: 'A\n' }), { front: 'Q', back: 'A' });
  assert.equal(cardText({ front: 'Q', back: '   ' }), null);
  assert.equal(cardText(), null);
  assert.equal(cardText({ front: 'x'.repeat(999), back: 'A' }).front.length, FRONT);
});

test('reminders come once a day, only when on, due and out of sight', () => {
  const base = { enabled: true, due: 2, lastDay: '2026-01-01', today: '2026-01-02', focused: false };
  assert.equal(shouldRemind(base), true);
  for (const change of [{ enabled: false }, { due: 0 }, { focused: true }, { lastDay: base.today }]) {
    assert.equal(shouldRemind({ ...base, ...change }), false);
  }
});
