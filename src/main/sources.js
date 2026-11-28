// The files behind a paper. One document is stored as before (source.pdf or source.txt);
// several files, or any picture, are stored as a "set" that the AI reads together.
const fs = require('node:fs/promises');
const path = require('node:path');
const mammoth = require('mammoth');
const extract = require('./extract');
const { fingerprint } = require('./limit');
const { MarginError } = require('./ai');

const IMAGES = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const ACCEPTED = ['.pdf', '.docx', '.pptx', '.xlsx', '.csv', '.html', '.htm', '.mhtml', '.mht', '.txt', '.md', ...IMAGES];

const MB = 1024 * 1024;
const MAX_FILES = 10;
const MAX_BYTES = 30 * MB; // Claude's request limit is 32 MB including base64 overhead headroom
const MAX_OFFICE_BYTES = 100 * MB; // only their text is sent, and pictures make these files big
const MAX_IMAGE_BYTES = 5 * MB; // the smallest per-picture limit among the AI services
// A set is read in full for every chapter, so its size decides what each level costs.
const MAX_SET_BYTES = 20 * MB; // PDFs and pictures together
const MAX_SET_CHARS = 600_000; // all text together

const unsupported = () =>
  new MarginError('TYPE', 'Margin reads PDF, Word, PowerPoint, Excel (.xlsx and .csv), pictures, saved web pages, Markdown and plain text files.');

// The type is read from the file's first bytes, so a renamed file cannot be sent as the wrong kind.
function imageType(b) {
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a/.test(b.toString('latin1', 0, 6))) return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// Whether one file can be added at all, judged by its name and size.
async function checkFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ACCEPTED.includes(ext)) throw unsupported();
  const { size } = await fs.stat(filePath);
  if (IMAGES.includes(ext)) {
    if (size > MAX_IMAGE_BYTES) throw new MarginError('TOO_BIG', 'This picture is over 5 MB. Try a smaller copy.');
  } else if (ext === '.pptx') {
    if (size > MAX_OFFICE_BYTES) throw new MarginError('TOO_BIG', 'This PowerPoint is over 100 MB. Try a smaller copy.');
  } else if (ext === '.xlsx') {
    if (size > MAX_OFFICE_BYTES) throw new MarginError('TOO_BIG', 'This file is over 100 MB. Try a smaller copy.');
  } else if (size > MAX_BYTES) throw new MarginError('TOO_BIG', 'This file is over 30 MB. Try a smaller copy.');
  return { ext, size };
}

async function textOf(filePath, ext) {
  if (ext === '.docx') return (await mammoth.extractRawText({ path: filePath })).value;
  if (ext === '.pptx') {
    try {
      return await extract.readPptx(await fs.readFile(filePath));
    } catch {
      throw new MarginError('TYPE', 'Could not open this PowerPoint file. Save it again as .pptx and retry.');
    }
  }
  if (ext === '.xlsx') {
    try {
      return await extract.readXlsx(await fs.readFile(filePath));
    } catch {
      throw new MarginError('TYPE', 'Could not open this Excel file. Save it again as .xlsx and retry.');
    }
  }
  if (ext === '.html' || ext === '.htm') return extract.readHtml(await fs.readFile(filePath));
  if (ext === '.mhtml' || ext === '.mht') return extract.readMhtml(await fs.readFile(filePath));
  return fs.readFile(filePath, 'utf8');
}

const tooShort = () => new MarginError('EMPTY', 'This file has almost no text in it. Margin needs at least a few paragraphs.');

// Copies one or more files into `dir`. Returns how it was stored and a fingerprint for the paper limit.
async function store(filePaths, dir) {
  const unique = [...new Set(filePaths)];
  if (!unique.length) throw new MarginError('EMPTY', 'Add at least one file.');
  if (unique.length > MAX_FILES) throw new MarginError('TOO_MANY', 'Add up to {max} files at a time.', { max: MAX_FILES });
  const files = [];
  for (const filePath of unique) files.push({ filePath, ...(await checkFile(filePath)) });

  // One document on its own is stored and counted exactly as before.
  if (files.length === 1 && !IMAGES.includes(files[0].ext)) {
    const [{ filePath, ext }] = files;
    if (ext === '.pdf') {
      await fs.copyFile(filePath, path.join(dir, 'source.pdf'));
      return { kind: 'pdf', fingerprint: fingerprint(await fs.readFile(path.join(dir, 'source.pdf'))) };
    }
    const text = await textOf(filePath, ext);
    if (text.trim().length < 400) throw tooShort();
    await fs.writeFile(path.join(dir, 'source.txt'), text);
    return { kind: 'text', fingerprint: fingerprint(text) };
  }

  const parts = [];
  const prints = new Set();
  let bytes = 0;
  let chars = 0;
  let pictures = false;
  for (const { filePath, ext } of files) {
    const name = path.basename(filePath);
    const image = IMAGES.includes(ext);
    let data;
    let mime;
    if (image || ext === '.pdf') {
      data = await fs.readFile(filePath);
      mime = image ? imageType(data) : 'application/pdf';
      if (!mime) throw new MarginError('TYPE', 'Could not open {file} as a picture.', { file: name });
    } else {
      data = await textOf(filePath, ext);
      if (!data.trim()) throw new MarginError('EMPTY', 'Margin found no text in {file}.', { file: name });
    }
    const print = fingerprint(data);
    if (prints.has(print)) continue; // the same content twice would only cost twice
    prints.add(print);
    const kind = image ? 'image' : ext === '.pdf' ? 'pdf' : 'text';
    if (kind === 'text') chars += data.length;
    else {
      bytes += data.length;
      pictures = true;
    }
    if (bytes > MAX_SET_BYTES) throw new MarginError('TOO_BIG', 'Together, the PDFs and pictures are over 20 MB. Remove some and try again.');
    if (chars > MAX_SET_CHARS) throw new MarginError('TOO_BIG', 'Together, these files have too much text. Remove some and try again.');
    const file = `part-${parts.length + 1}${kind === 'text' ? '.txt' : ext}`;
    await fs.writeFile(path.join(dir, file), data);
    parts.push({ kind, name, file, mime });
  }
  if (!pictures && chars < 400) throw tooShort();
  await fs.writeFile(path.join(dir, 'parts.json'), JSON.stringify(parts));
  // The same files in any order count as the same paper.
  return { kind: 'set', files: parts.length, fingerprint: fingerprint([...prints].sort().join('\n')) };
}

// What the AI is given.
async function load(kind, dir) {
  if (kind === 'pdf') return { kind, data: (await fs.readFile(path.join(dir, 'source.pdf'))).toString('base64') };
  if (kind === 'text') return { kind, data: await fs.readFile(path.join(dir, 'source.txt'), 'utf8') };
  const parts = JSON.parse(await fs.readFile(path.join(dir, 'parts.json'), 'utf8'));
  return {
    kind: 'set',
    parts: await Promise.all(
      parts.map(async (p) => ({ kind: p.kind, name: p.name, mime: p.mime, data: await fs.readFile(path.join(dir, p.file), p.kind === 'text' ? 'utf8' : 'base64') })),
    ),
  };
}

module.exports = { ACCEPTED, MAX_FILES, checkFile, store, load, imageType };
