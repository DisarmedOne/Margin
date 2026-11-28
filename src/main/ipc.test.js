const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const all = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

// Electron throws on a second handler for a channel, which stops the app from starting properly.
test('every app channel is handled once, and everything the window calls is handled', () => {
  // Study group channels are registered through group().
  const handled = all(read('main.js'), /\b(?:handle|group)\('([^']+)'/g);
  assert.deepEqual(handled.filter((c, i) => handled.indexOf(c) !== i), []);
  const preload = read('preload.js');
  assert.deepEqual(all(preload, /\bcall\('([^']+)'/g).filter((c) => !handled.includes(c)), []);
  const names = all(preload, /^  (\w+):/gm);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});
