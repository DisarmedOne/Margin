// Plain text out of PowerPoint files and saved web pages. Nothing in these files is ever run.
const JSZip = require('jszip');

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', euro: '€', pound: '£', copy: '©', reg: '®',
  deg: '°', plusmn: '±', times: '×', divide: '÷', minus: '−', le: '≤', ge: '≥', ne: '≠', asymp: '≈', rarr: '→', larr: '←',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ', pi: 'π', sigma: 'σ', Delta: 'Δ', Sigma: 'Σ', sum: '∑', radic: '√',
  sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾', micro: 'µ', szlig: 'ß', ccedil: 'ç', Ccedil: 'Ç', ntilde: 'ñ',
};
// Accented letters follow one naming pattern (&eacute; &Uuml;), so they are built instead of listed.
const MARKS = { acute: '́', grave: '̀', circ: '̂', uml: '̈', tilde: '̃', ring: '̊' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (Object.hasOwn(NAMED, e)) return NAMED[e];
    const m = e.match(/^([a-z])(acute|grave|circ|uml|tilde|ring)$/i);
    return m ? (m[1] + MARKS[m[2].toLowerCase()]).normalize('NFC') : whole;
  });
}

const tidy = (s) =>
  s
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// A whole tag, allowing ">" inside quoted attributes. "x < 5" in text is not a tag.
const TAG = /<[a-z/!?](?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
const strip = (html) =>
  tidy(
    decodeEntities(
      html
        .replace(/\s+/g, ' ')
        .replace(/<(?:\/?(?:p|div|section|article|main|h[1-6]|ul|ol|li|table|tr|blockquote|pre|figcaption|dt|dd)|br)\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi, '\n')
        .replace(/<\/t[dh]>/gi, ' ')
        .replace(TAG, ''),
    ),
  );

// shortcut: no real HTML parser. Menus built from plain <div>s stay in the text; add a parser if that hurts lessons.
function htmlToText(html) {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|nav|footer|aside|select|button)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const whole = strip(clean);
  // Prefer the page's own content area, unless it holds only a small part of the text.
  for (const tag of ['main', 'article']) {
    const found = clean.match(new RegExp(`<${tag}\\b[\\s\\S]*<\\/${tag}\\s*>`, 'i'));
    if (!found) continue;
    const inner = strip(found[0]);
    if (inner.length >= 400 && inner.length >= whole.length * 0.3) return inner;
  }
  return whole;
}

function decodeBytes(buffer, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(buffer);
  } catch {
    return new TextDecoder().decode(buffer);
  }
}

function readHtml(buffer) {
  const start = buffer.subarray(0, 4096).toString('latin1');
  return htmlToText(decodeBytes(buffer, start.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1]));
}

// A "single file" saved page: a mail-style bundle whose first HTML part is the page.
function readMhtml(buffer) {
  const raw = buffer.toString('latin1');
  const boundary = raw.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  if (!boundary) return '';
  for (const part of raw.split(`--${boundary}`)) {
    const split = part.match(/\r?\n\r?\n/);
    if (!split) continue;
    const headers = part.slice(0, split.index).replace(/\r?\n[ \t]+/g, ' ');
    if (!/content-type:\s*text\/html/i.test(headers)) continue;
    const body = part.slice(split.index + split[0].length);
    const encoding = headers.match(/content-transfer-encoding:\s*([\w-]+)/i)?.[1]?.toLowerCase();
    let bytes;
    if (encoding === 'base64') bytes = Buffer.from(body, 'base64');
    else if (encoding === 'quoted-printable') {
      bytes = Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    } else bytes = Buffer.from(body, 'latin1');
    return htmlToText(decodeBytes(bytes, headers.match(/charset="?([\w-]+)/i)?.[1]));
  }
  return '';
}

const MAX_SLIDES = 300;
const MAX_CHARS = 1_000_000; // far more than a real deck; stops a crafted file from filling memory

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
// Id -> target path for one part's relationship file. Targets are relative to ppt/ or ppt/slides/.
async function relations(zip, path, base) {
  const xml = (await zip.file(path)?.async('string')) ?? '';
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => {
    const target = attr(tag, 'Target') ?? '';
    const parts = target.startsWith('/') ? [] : base.split('/');
    for (const piece of target.split('/').filter(Boolean)) piece === '..' ? parts.pop() : parts.push(piece);
    return { id: attr(tag, 'Id'), type: attr(tag, 'Type') ?? '', path: parts.join('/') };
  });
}

// Each <a:p> is a paragraph and each <a:t> a run of text inside it.
const paragraphs = (xml) =>
  xml
    // Slide numbers and dates are fields, not content.
    .replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, '')
    .split(/<\/a:p>/)
    .map((p) => decodeEntities([...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).trim())
    .filter(Boolean);

// Slide text and speaker notes, in presentation order. Pictures are not read.
async function readPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentation) throw new Error('not a PowerPoint file');
  const byId = new Map((await relations(zip, 'ppt/_rels/presentation.xml.rels', 'ppt')).map((r) => [r.id, r.path]));
  const slides = [...presentation.matchAll(/<p:sldId\b[^>]*>/g)].map(([tag]) => byId.get(attr(tag, 'r:id'))).filter(Boolean);
  const out = [];
  let length = 0;
  for (const [i, path] of slides.slice(0, MAX_SLIDES).entries()) {
    const xml = await zip.file(path)?.async('string');
    if (!xml) continue;
    const lines = paragraphs(xml);
    const file = path.split('/').pop();
    const notes = (await relations(zip, `ppt/slides/_rels/${file}.rels`, 'ppt/slides')).find((r) => r.type.endsWith('/notesSlide'));
    const said = notes ? paragraphs((await zip.file(notes.path)?.async('string')) ?? '') : [];
    if (!lines.length && !said.length) continue;
    const block = [`Slide ${i + 1}`, ...lines, ...(said.length ? ['Speaker notes:', ...said] : [])].join('\n');
    out.push(block);
    length += block.length;
    if (length > MAX_CHARS) break;
  }
  return out.join('\n\n');
}

module.exports = { htmlToText, readHtml, readMhtml, readPptx };
