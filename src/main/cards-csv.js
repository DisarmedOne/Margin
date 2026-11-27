// The review deck as CSV (front, back, paper) for Anki or a spreadsheet.
const cell = (value) => {
  let s = String(value ?? '').replace(/\*\*/g, '');
  // Card text comes from AI reading arbitrary files: never let a spreadsheet run it as a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = ` ${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

// The leading byte-order mark makes Excel read the file as UTF-8.
const cardsCsv = (cards, titles) => '﻿' + cards.map((c) => [c.front, c.back, titles[c.paperId] ?? ''].map(cell).join(',')).join('\r\n') + '\r\n';

module.exports = { cardsCsv };
