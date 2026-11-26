// Lists every English string the UI can show, so translations can be checked for gaps.
// Run with: node build/i18n-keys.js [--missing <code>]
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory() && f.name !== 'locales') walk(p);
    else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p);
  }
})(root);

const keys = new Set();
const str = `'((?:\\\\.|[^'\\\\])*)'`;
const patterns = [
  new RegExp(`\\bt\\(\\s*${str}`, 'g'),
  new RegExp(`\\btn\\([^,]+,\\s*${str}`, 'g'),
  new RegExp(`MarginError\\('\\w+',\\s*${str}`, 'g'),
  new RegExp(`\\berr\\('\\w+',\\s*${str}`, 'g'),
];
// Constant lists whose entries are translated where shown.
const listNames = ['STAGES', 'RIGHT', 'TEACH_VERDICT', 'RATINGS', 'TIPS'];

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const re of patterns) for (const m of src.matchAll(re)) keys.add(m[1].replace(/\\'/g, "'"));
  for (const name of listNames) {
    const block = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (block) for (const m of block[1].matchAll(new RegExp(str, 'g'))) keys.add(m[1].replace(/\\'/g, "'"));
  }
  const kind = src.match(/const KIND = \{([^}]*)\}/);
  if (kind) for (const m of kind[1].matchAll(new RegExp(`:\\s*${str}`, 'g'))) keys.add(m[1]);
  for (const name of ['CONF', 'BANDS', 'RULES']) {
    const block = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (block) for (const m of block[1].matchAll(/\['([^']*)', '([^']*)'/g)) (name === 'RULES' ? [m[1], m[2]] : [m[2]]).forEach((k) => keys.add(k));
  }
  const copy = src.match(/PROVIDER_COPY = \{([\s\S]*?)\n\};/);
  if (copy) for (const m of copy[1].matchAll(new RegExp(`(?:option|keyLabel|console|note):\\s*${str}`, 'g'))) keys.add(m[1].replace(/\\'/g, "'"));
  const ranks = src.match(/const RANKS = \[([\s\S]*?)\];/);
  if (ranks) for (const m of ranks[1].matchAll(/name: '([^']*)'/g)) keys.add(m[1]);
  const hints = src.matchAll(/keyHint: '([^']*)'/g);
  for (const m of hints) keys.add(`That does not look like a {name} key. ${m[1]}`);
}
keys.delete('That does not look like a {name} key. ');

const list = [...keys].sort();
const i = process.argv.indexOf('--missing');
if (i > 0) {
  const code = process.argv[i + 1];
  const src = fs.readFileSync(path.join(root, 'renderer', 'locales', `${code}.js`), 'utf8');
  const dict = new Function(src.replace(/^\s*export default/m, 'return'))();
  const missing = list.filter((k) => !(k in dict));
  const extra = Object.keys(dict).filter((k) => !keys.has(k));
  console.log(JSON.stringify({ code, total: list.length, missing, extra }, null, 1));
} else {
  console.log(JSON.stringify(list, null, 1));
  console.error(`${list.length} strings`);
}
