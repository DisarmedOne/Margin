const test = require('node:test');
const assert = require('node:assert');
const { cardsCsv } = require('./cards-csv');

test('flashcard CSV quotes text, drops bold marks and disarms formulas', () => {
  const csv = cardsCsv([{ paperId: 'a', front: 'The **testing** effect, "defined"', back: '=HYPERLINK("x")' }], { a: 'Paper' });
  assert.equal(csv, '﻿"The testing effect, ""defined"""," =HYPERLINK(""x"")","Paper"\r\n');
});
