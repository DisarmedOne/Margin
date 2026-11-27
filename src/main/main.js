const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme, Menu, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const mammoth = require('mammoth');
const store = require('./store');
const ai = require('./ai');
const srs = require('./srs');
const updater = require('./updater');
const account = require('./account');
const studyGroups = require('./groups');
const { cardsCsv } = require('./cards-csv');
const exam = require('./exam');
const extract = require('./extract');
const deck = require('./deck');
const paperLimit = require('./limit');

const MAX_BYTES = 30 * 1024 * 1024; // Claude's request limit is 32 MB including base64 overhead headroom
// Slide files are mostly pictures, which are not sent anywhere, so they may be much bigger.
const MAX_PPTX_BYTES = 100 * 1024 * 1024;
const ACCEPTED = ['.pdf', '.docx', '.pptx', '.html', '.htm', '.mhtml', '.mht', '.txt', '.md'];
const BAR = { light: { color: '#F2EFE7', symbolColor: '#45423C' }, dark: { color: '#161513', symbolColor: '#BDB7AA' } };

let win;
const S = () => store.state;

function isDark() {
  const t = S().settings.theme;
  return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors);
}

function paintTitleBar() {
  if (!win) return;
  const c = BAR[isDark() ? 'dark' : 'light'];
  win.setTitleBarOverlay({ ...c, height: 44 });
  win.setBackgroundColor(c.color);
}

function createWindow() {
  const c = BAR[isDark() ? 'dark' : 'light'];
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 660,
    show: false,
    backgroundColor: c.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...c, height: 44 },
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

const emit = (channel, payload) => win?.webContents.send(channel, payload);
const publicPaper = (p) => {
  const { levels, ...rest } = p;
  return { ...rest, levelsReady: Object.keys(levels) };
};
const findPaper = (id) => {
  const p = S().papers.find((x) => x.id === id);
  if (!p) throw new ai.MarginError('NOT_FOUND', 'That paper is no longer in your library.');
  return p;
};

// ---------- API keys ----------
// One encrypted key per provider; settings.provider picks which one Margin uses.
const CONSOLES = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
};

function readKey(provider = S().settings.provider) {
  const k = S().settings.keys[provider];
  if (!k) return null;
  try {
    return safeStorage.decryptString(Buffer.from(k, 'base64'));
  } catch {
    return null;
  }
}

async function setKey(provider, key) {
  key = String(key || '').trim().replace(/^["']|["']$/g, '');
  provider = ai.detectProvider(key) ?? provider;
  const meta = ai.PROVIDERS[provider];
  if (!meta) throw new ai.MarginError('FORMAT', 'Unknown provider.');
  if (!meta.keyPattern.test(key)) {
    throw new ai.MarginError('FORMAT', 'That does not look like a {name} key. ' + meta.keyHint, { name: meta.label });
  }
  await ai.verifyKey(provider, key);
  S().settings.keys[provider] = safeStorage.encryptString(key).toString('base64');
  S().settings.provider = provider;
  ai.configure(provider, key);
  await store.save();
  return keyStatus();
}

async function useProvider(provider) {
  const key = readKey(provider);
  if (!key) throw new ai.MarginError('NO_KEY', 'Add a {name} key first.', { name: ai.PROVIDERS[provider].label });
  S().settings.provider = provider;
  ai.configure(provider, key);
  await store.save();
  return keyStatus();
}

function keyStatus() {
  const provider = S().settings.provider;
  const k = readKey(provider);
  const saved = Object.fromEntries(Object.keys(ai.PROVIDERS).map((p) => [p, !!readKey(p)]));
  return { provider, set: !!k, last4: k ? k.slice(-4) : null, saved };
}

const providerList = () =>
  Object.fromEntries(Object.entries(ai.PROVIDERS).map(([id, p]) => [id, { label: p.label, model: p.model, modelName: p.modelName }]));

// ---------- Papers ----------
async function loadDoc(paper) {
  const dir = store.paperDir(paper.id);
  if (paper.kind === 'pdf') return { kind: 'pdf', data: (await fs.readFile(path.join(dir, 'source.pdf'))).toString('base64') };
  return { kind: 'text', data: await fs.readFile(path.join(dir, 'source.txt'), 'utf8') };
}

// Files that passed the check but have no place yet, so several added at once cannot all use the last one.
const unclaimed = new Set();

// One check at a time, so each one sees the reservations made before it.
let reserving = Promise.resolve();
function reserve(key) {
  const run = reserving.then(async () => {
    const known = await limiter().check(key, [...unclaimed].filter((k) => k !== key).length);
    if (!known) unclaimed.add(key);
  });
  reserving = run.catch(() => {});
  return run;
}

async function textOf(filePath, ext) {
  if (ext === '.docx') return (await mammoth.extractRawText({ path: filePath })).value;
  if (ext === '.pptx') {
    try {
      return await extract.readPptx(await fs.readFile(filePath));
    } catch {
      throw new ai.MarginError('TYPE', 'Could not open this PowerPoint file. Save it again as .pptx and retry.');
    }
  }
  if (ext === '.html' || ext === '.htm') return extract.readHtml(await fs.readFile(filePath));
  if (ext === '.mhtml' || ext === '.mht') return extract.readMhtml(await fs.readFile(filePath));
  return fs.readFile(filePath, 'utf8');
}

async function addPaper(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ACCEPTED.includes(ext)) {
    throw new ai.MarginError('TYPE', 'Margin reads PDF, Word (.docx), PowerPoint (.pptx), saved web pages, Markdown and plain text files.');
  }
  const stat = await fs.stat(filePath);
  if (ext === '.pptx') {
    if (stat.size > MAX_PPTX_BYTES) throw new ai.MarginError('TOO_BIG', 'This PowerPoint is over 100 MB. Try a smaller copy.');
  } else if (stat.size > MAX_BYTES) throw new ai.MarginError('TOO_BIG', 'This file is over 30 MB. Try a smaller copy.');

  const id = crypto.randomUUID();
  const dir = store.paperDir(id);
  await fs.mkdir(dir, { recursive: true });
  let kind = 'pdf';
  let fingerprint;
  try {
    if (ext === '.pdf') {
      await fs.copyFile(filePath, path.join(dir, 'source.pdf'));
      fingerprint = paperLimit.fingerprint(await fs.readFile(path.join(dir, 'source.pdf')));
    } else {
      kind = 'text';
      const text = await textOf(filePath, ext);
      if (text.trim().length < 400) {
        throw new ai.MarginError('EMPTY', 'This file has almost no text in it. Margin needs at least a few paragraphs.');
      }
      await fs.writeFile(path.join(dir, 'source.txt'), text);
      fingerprint = paperLimit.fingerprint(text);
    }
    await reserve(fingerprint);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }

  const paper = {
    id,
    fileName: path.basename(filePath),
    kind,
    fingerprint,
    addedAt: Date.now(),
    touchedAt: Date.now(),
    status: 'reading',
    startedAt: Date.now(),
    error: null,
    outline: null,
    levels: {},
    progress: {},
  };
  S().papers.unshift(paper);
  await store.save();
  runOutline(paper);
  return publicPaper(paper);
}

async function runOutline(paper) {
  paper.status = 'reading';
  paper.startedAt = Date.now();
  paper.error = null;
  emit('paper', publicPaper(paper));
  try {
    // An outline that is already there only still needs its place, so the AI is not paid twice.
    if (!paper.outline) {
      if (paper.fingerprint) await reserve(paper.fingerprint);
      const doc = await loadDoc(paper);
      paper.outline = await timed('outline', () => ai.outline(doc));
    }
    // The place is taken only now, so a paper that could not be read costs none.
    if (paper.fingerprint) await limiter().claim(paper.fingerprint);
    paper.status = 'ready';
    unclaimed.delete(paper.fingerprint);
  } catch (e) {
    unclaimed.delete(paper.fingerprint);
    paper.status = 'error';
    const f = ai.friendly(e);
    paper.error = f.message;
    paper.errorKey = f.tkey ?? null;
    paper.errorVars = f.vars ?? null;
  }
  if (!S().papers.includes(paper)) return; // removed while reading
  await store.save();
  emit('paper', publicPaper(paper));
  if (paper.status === 'ready') prepareFirst(paper);
}

// One line per AI call in data/margin.log, so slow or failing calls can be diagnosed later.
async function timed(what, fn) {
  const t = Date.now();
  const line = (result) => `${new Date().toISOString()} ${S().settings.provider} ${what} ${((Date.now() - t) / 1000).toFixed(1)}s ${result}\n`;
  try {
    const out = await fn();
    fs.appendFile(path.join(store.root(), 'margin.log'), line('ok')).catch(() => {});
    return out;
  } catch (e) {
    const f = ai.friendly(e);
    fs.appendFile(path.join(store.root(), 'margin.log'), line(`error ${f.code}: ${e.message}`)).catch(() => {});
    throw e;
  }
}

// Write only the first level ahead of time. Every level costs money, so the others are written
// one step ahead of the learner (the paper and level screens ask for the next one), never all at once.
function prepareFirst(paper) {
  if (!S().settings.prepareAhead) return;
  getLevel(paper.id, 0).catch(() => {}); // the learner sees the error, with a retry, when they open it
}

const inflight = new Map();
function getLevel(paperId, index) {
  const paper = findPaper(paperId);
  if (paper.status !== 'ready') throw new ai.MarginError('NOT_READY', 'This paper is still being read.');
  if (paper.levels[index]) return Promise.resolve(paper.levels[index]);
  const key = `${paperId}:${index}`;
  if (!inflight.has(key)) {
    const job = timed(`level ${index + 1}`, async () => {
      const lv = await ai.level(await loadDoc(paper), paper.outline, index);
      paper.levels[index] = lv;
      await store.save();
      return lv;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return inflight.get(key);
}

// Adds a review card, or brings an existing one forward. Returns how many were added.
function upsertCard(paperId, chapter, key, front, back, dueNow) {
  const id = `${paperId}:${chapter}:${key}`;
  const existing = S().cards.find((c) => c.id === id);
  if (existing) {
    if (dueNow) existing.due = Date.now();
    return 0;
  }
  if (S().removedCards.includes(id)) return 0; // the learner deleted it, so replaying must not bring it back
  S().cards.push({ id, paperId, chapter, front, back, ease: 2.5, interval: 0, reps: 0, due: Date.now(), created: Date.now() });
  return 1;
}
const missedKey = (front) => `m${crypto.createHash('sha1').update(front).digest('hex').slice(0, 10)}`;

async function completeLevel(paperId, index, result) {
  const paper = findPaper(paperId);
  const lv = paper.levels[index];
  const p = S().profile;
  const prev = paper.progress[index];
  const xp = Math.max(0, Math.round(result.xp || 0));

  paper.progress[index] = {
    done: true,
    correct: Math.max(result.correct, prev?.correct ?? 0),
    total: result.total,
    bestCombo: Math.max(result.bestCombo || 0, prev?.bestCombo ?? 0),
    plays: (prev?.plays ?? 0) + 1,
    // When it was first finished; the exam plan uses it to tick off today's chapters.
    doneAt: prev?.done ? prev.doneAt : Date.now(),
  };
  paper.touchedAt = Date.now();

  const rankBefore = srs.rankFor(p.xp).name;
  p.xp += xp;
  p.levelsDone += 1;
  p.answered += result.total;
  p.correct += result.correct;
  for (const [band, v] of Object.entries(result.calibration || {})) {
    if (p.calibration[band]) {
      p.calibration[band].n += v.n;
      p.calibration[band].right += v.right;
    }
  }
  const today = srs.dayKey();
  p.daily[today] = (p.daily[today] || 0) + xp;
  p.streak = srs.touchStreak(p.streak);

  // Flashcards from the level, plus every missed question, go into the review deck.
  let added = 0;
  lv?.cards.forEach((c, i) => (added += upsertCard(paperId, index, `c${i}`, c.front, c.back, false)));
  for (const m of result.missed || []) added += upsertCard(paperId, index, missedKey(m.front), m.front, m.back, true);

  await store.save();
  reportSoon();
  return { profile: profileView(), cardsAdded: added, rankUp: srs.rankFor(p.xp).name !== rankBefore ? srs.rankFor(p.xp).name : null };
}

// ---------- Review ----------
// paperIds narrows the session to one exam's papers.
function dueCards(paperIds) {
  const now = Date.now();
  const titles = Object.fromEntries(S().papers.map((p) => [p.id, p.outline?.title ?? p.fileName]));
  return S()
    .cards.filter((c) => c.due <= now && (!Array.isArray(paperIds) || paperIds.includes(c.paperId)))
    .sort((a, b) => a.due - b.due)
    .slice(0, S().settings.reviewSize)
    // Raw wait times per rating; the renderer words them in the learner's language.
    .map((c) => ({ ...c, paperTitle: titles[c.paperId] ?? '', previewMs: [0, 1, 2, 3].map((r) => srs.schedule(c, r, now).due - now) }));
}

async function rateCard(id, rating) {
  const i = S().cards.findIndex((c) => c.id === id);
  if (i < 0) return profileView();
  S().cards[i] = srs.schedule(S().cards[i], rating);
  const p = S().profile;
  p.xp += rating === 0 ? 1 : 3;
  p.reviewsDone += 1;
  const today = srs.dayKey();
  p.daily[today] = (p.daily[today] || 0) + (rating === 0 ? 1 : 3);
  p.streak = srs.touchStreak(p.streak);
  await store.save();
  reportSoon();
  return profileView();
}

function profileView() {
  const p = S().profile;
  const now = Date.now();
  const upcoming = S().cards.filter((c) => c.due > now).sort((a, b) => a.due - b.due)[0];
  return {
    ...p,
    streak: srs.liveStreak(p.streak),
    rank: srs.rankFor(p.xp),
    ranks: srs.RANKS,
    due: S().cards.filter((c) => c.due <= now).length,
    deckSize: S().cards.length,
    nextDue: upcoming?.due ?? null,
    today: srs.dayKey(),
  };
}

async function exportCards() {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export flashcards',
    defaultPath: path.join(app.getPath('documents'), 'Margin flashcards.csv'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (r.canceled) return null;
  const titles = Object.fromEntries(S().papers.map((p) => [p.id, p.outline?.title ?? p.fileName]));
  try {
    await fs.writeFile(r.filePath, cardsCsv(S().cards, titles));
  } catch {
    throw new ai.MarginError('SAVE', 'Could not save the file. Close it if it is open, or choose another folder.');
  }
  return S().cards.length;
}

// ---------- The learner's own cards ----------
function deckView() {
  const titles = Object.fromEntries(S().papers.map((p) => [p.id, p.outline?.title ?? p.fileName]));
  const cards = [...S().cards]
    .sort((a, b) => b.created - a.created)
    .map((c) => ({ id: c.id, front: c.front, back: c.back, paperId: c.paperId, paperTitle: titles[c.paperId] ?? '' }));
  return { cards, profile: profileView() };
}

async function saveCard(input) {
  const text = deck.cardText(input);
  if (!text) throw new ai.MarginError('CARD', 'A card needs a question and an answer.');
  if (input.id) {
    const card = S().cards.find((c) => c.id === input.id);
    if (!card) throw new ai.MarginError('NOT_FOUND', 'That card is no longer in your deck.');
    Object.assign(card, text); // keeps its review schedule
  } else {
    const paperId = S().papers.some((p) => p.id === input.paperId) ? input.paperId : null;
    const now = Date.now();
    S().cards.push({ id: `own:${crypto.randomUUID()}`, paperId, chapter: null, ...text, ease: 2.5, interval: 0, reps: 0, due: now, created: now });
  }
  await store.save();
  return deckView();
}

async function removeCard(id) {
  if (S().cards.some((c) => c.id === id)) {
    S().cards = S().cards.filter((c) => c.id !== id);
    if (!id.startsWith('own:')) S().removedCards.push(id);
    await store.save();
  }
  return deckView();
}

// ---------- Review reminder ----------
// Only while Margin is running. The wording comes from the same translation files as the window.
async function translator() {
  const code = S().settings.language;
  if (code === 'en') return (key) => key;
  try {
    // The app is CommonJS, so the language file (an ES module) is loaded from its text.
    const source = await fs.readFile(path.join(__dirname, '../renderer/locales', `${code}.js`), 'utf8');
    const dict = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default;
    return (key) => dict[key] ?? key;
  } catch {
    return (key) => key;
  }
}

let reminder = null; // held so a click still works after this function returns
async function remind() {
  const today = srs.dayKey();
  const wanted = deck.shouldRemind({
    enabled: S().settings.reminder && Notification.isSupported(),
    due: profileView().due,
    lastDay: S().lastReminder,
    today,
    focused: win?.isFocused(),
  });
  if (!wanted) return;
  S().lastReminder = today;
  await store.save();
  const t = await translator();
  reminder = new Notification({ title: 'Margin', body: t('You have flashcards ready to review.') });
  reminder.on('click', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    emit('open-review');
  });
  reminder.show();
}

// Windows only shows notifications from an app whose Start menu shortcut carries its id.
function setNotificationId() {
  const id = 'app.margin.study';
  app.setAppUserModelId(app.isPackaged ? id : process.execPath);
  if (!app.isPackaged || process.platform !== 'win32') return;
  const link = path.join(app.getPath('appData'), 'Microsoft/Windows/Start Menu/Programs/Margin.lnk');
  try {
    shell.writeShortcutLink(link, 'update', { target: process.execPath, appUserModelId: id });
  } catch {
    /* no shortcut to update */
  }
}

// ---------- Exams ----------
const findExam = (id) => {
  const e = S().exams.find((x) => x.id === id);
  if (!e) throw new ai.MarginError('NOT_FOUND', 'That exam is no longer saved.');
  return e;
};

function listExams() {
  const now = Date.now();
  return S()
    .exams.map((e) => {
      const paperIds = e.paperIds.filter((id) => S().papers.some((p) => p.id === id));
      return {
        id: e.id,
        name: e.name,
        date: e.date,
        paperIds,
        last: e.results.at(-1) ?? null,
        ...exam.planFor(e, S().papers, now),
        cardsDue: S().cards.filter((c) => c.due <= now && paperIds.includes(c.paperId)).length,
        questions: exam.pickQuestions(e, S().papers).length,
      };
    })
    // Coming exams first, soonest at the top; past ones after them.
    .sort((a, b) => (a.days < 0) - (b.days < 0) || a.date.localeCompare(b.date));
}

async function saveExam(input) {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  const date = String(input?.date ?? '');
  const paperIds = S()
    .papers.filter((p) => p.status === 'ready' && input?.paperIds?.includes(p.id))
    .map((p) => p.id);
  if (!name) throw new ai.MarginError('EXAM', 'Give the exam a name.');
  if (!exam.validDate(date) || exam.daysUntil(date) < 0) throw new ai.MarginError('EXAM', 'Pick today or a later date.');
  if (!paperIds.length) throw new ai.MarginError('EXAM', 'Choose at least one paper.');
  let saved = input.id ? findExam(input.id) : null;
  if (!saved) {
    saved = { id: crypto.randomUUID(), results: [] };
    S().exams.push(saved);
  }
  Object.assign(saved, { name, date, paperIds });
  await store.save();
  return saved.id;
}

async function removeExam(id) {
  S().exams = S().exams.filter((e) => e.id !== id);
  await store.save();
  return true;
}

async function finishExam(id, answers) {
  const e = findExam(id);
  const valid = (Array.isArray(answers) ? answers : []).slice(0, exam.QUESTIONS).filter((a) => e.paperIds.includes(a.paperId) && Number.isInteger(a.ch));
  const chapters = new Map();
  for (const a of valid) {
    const key = `${a.paperId}:${a.ch}`;
    const c = chapters.get(key) ?? { paperId: a.paperId, ch: a.ch, right: 0, total: 0 };
    c.total++;
    if (a.right) c.right++;
    else if (a.card?.front) upsertCard(a.paperId, a.ch, missedKey(String(a.card.front)), String(a.card.front), String(a.card.back), true);
    chapters.set(key, c);
  }
  const byWeakness = [...chapters.values()].sort((a, b) => a.right / a.total - b.right / b.total);
  const result = {
    at: Date.now(),
    right: valid.filter((a) => a.right).length,
    total: valid.length,
    weak: byWeakness.filter((c) => c.right < c.total).slice(0, 3),
  };
  e.results = [...e.results, result].slice(-10);
  S().profile.streak = srs.touchStreak(S().profile.streak);
  await store.save();
  reportSoon();
  return { ...result, chapters: byWeakness };
}

// ---------- Steelfable account ----------
// Only the email is shown to the page; the session stays here, encrypted like the API keys.
const publicAccount = () => (S().account ? { email: S().account.email } : null);

async function saveAccount(r) {
  S().account = { email: r.email, session: safeStorage.encryptString(JSON.stringify(r.session)).toString('base64') };
  await store.save();
  return publicAccount();
}

const accountVerify = async (email, code) => saveAccount(await account.verifyCode(email, code));

async function accountGoogle() {
  const r = await account.signInWithGoogle((url) => shell.openExternal(url), {
    onReturn: () => {
      emit('google-return');
      win?.focus();
    },
  });
  return saveAccount(r);
}

const readSession = (saved) => JSON.parse(safeStorage.decryptString(Buffer.from(saved.session, 'base64')));

// ---------- Study groups ----------
// Renewing replaces the saved sign-in, so only one renewal may run at a time.
let renewing = null;
async function accessToken() {
  const saved = S().account;
  if (!saved) throw new ai.MarginError('SIGNIN', 'Your sign-in has expired. Sign out, then sign in again.');
  let session;
  try {
    session = readSession(saved);
  } catch {
    throw new ai.MarginError('SIGNIN', 'Your sign-in has expired. Sign out, then sign in again.');
  }
  if (session.expires_at * 1000 > Date.now() + 60e3) return session.access_token;
  renewing ??= (async () => {
    try {
      const fresh = await account.refresh(session);
      saved.session = safeStorage.encryptString(JSON.stringify(fresh)).toString('base64');
      await store.save();
      return fresh.access_token;
    } catch (e) {
      if (e.code === 'OFFLINE' || e.code === 'SERVER' || e.code === 'RATE') throw e;
      throw new ai.MarginError('SIGNIN', 'Your sign-in has expired. Sign out, then sign in again.');
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

const groupsApi = studyGroups.client(accessToken, () => S().profile);
const limitApi = paperLimit.client(accessToken);
const guestLimit = paperLimit.local(() => S().guestPapers, () => store.save());
// Signed in, the server counts; without an account, this computer does.
const limiter = () => (S().account ? limitApi : guestLimit);

// Remembers whether this account is in a group, so study numbers are only ever sent by someone who is.
async function groupResult(work) {
  const list = await work;
  if (S().account) {
    S().account.inGroups = list.length > 0;
    await store.save();
  }
  return list;
}

// After studying, send fresh numbers quietly a little later. A failure only means they arrive next time.
let reportTimer = null;
function reportSoon(delay = 20e3) {
  clearTimeout(reportTimer);
  if (!S().account?.inGroups) return;
  reportTimer = setTimeout(() => groupsApi.report().catch(() => {}), delay);
}

// The local sign-in is only removed once the server has confirmed the account is gone.
async function accountDelete() {
  const saved = S().account;
  if (!saved) return null;
  let session;
  try {
    session = readSession(saved);
  } catch {
    throw new ai.MarginError('SIGNIN', 'Sign out, sign in again, then delete your account.');
  }
  await account.deleteAccount(session, async (renewed) => {
    saved.session = safeStorage.encryptString(JSON.stringify(renewed)).toString('base64');
    await store.save();
  });
  delete S().account;
  S().guest = false;
  await store.save();
  return null;
}

async function accountSignOut() {
  const saved = S().account;
  delete S().account;
  S().guest = false;
  await store.save();
  try {
    await account.signOut(readSession(saved));
  } catch {
    /* nothing saved, or it can no longer be read */
  }
  return null;
}

// ---------- IPC ----------
// Every handler resolves to { ok, data } or { ok: false, error } so the renderer gets clean messages.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: ai.friendly(e) };
    }
  });
}

function registerIpc() {
  const publicSettings = () => {
    const { sound, motion, theme, language, dailyGoal, readingSize, confidence, autoContinue, levelLength, reviewSize, prepareAhead, reminder } = S().settings;
    return { sound, motion, theme, language, dailyGoal, readingSize, confidence, autoContinue, levelLength, reviewSize, prepareAhead, reminder };
  };
  handle('boot', () => ({
    settings: publicSettings(),
    key: keyStatus(),
    profile: profileView(),
    papers: S().papers.map(publicPaper),
    providers: providerList(),
    languages: ai.LANGUAGES,
    version: app.getVersion(),
    account: publicAccount(),
    guest: S().guest,
  }));
  handle('account:skip', async () => {
    S().guest = true;
    await store.save();
    return true;
  });
  handle('account:send', account.sendCode);
  handle('account:verify', accountVerify);
  handle('account:google', accountGoogle);
  handle('account:google-cancel', () => account.cancelGoogle());
  handle('account:signout', accountSignOut);
  handle('account:delete', accountDelete);
  handle('review:pool', () => {
    // Random cards for the lightning round; scheduling is untouched.
    const cards = [...S().cards].sort(() => Math.random() - 0.5).slice(0, 40);
    return cards.map((c) => ({ id: c.id, front: c.front, back: c.back }));
  });
  handle('review:lightning', async (score) => {
    const p = S().profile;
    const n = Math.max(0, Math.min(200, Math.round(score) || 0));
    const isBest = n > (p.bestLightning ?? 0);
    p.bestLightning = Math.max(p.bestLightning ?? 0, n);
    p.xp += n * 2;
    const today = srs.dayKey();
    p.daily[today] = (p.daily[today] || 0) + n * 2;
    if (n) p.streak = srs.touchStreak(p.streak);
    await store.save();
    reportSoon();
    return { profile: profileView(), isBest };
  });
  handle('key:set', setKey);
  handle('provider:use', useProvider);
  handle('settings:set', async (patch) => {
    const allowed = {
      sound: 'boolean', motion: 'string', theme: 'string', language: 'string', dailyGoal: 'number',
      readingSize: 'string', confidence: 'boolean', autoContinue: 'boolean', levelLength: 'string',
      reviewSize: 'number', prepareAhead: 'boolean', reminder: 'boolean',
    };
    for (const [k, v] of Object.entries(patch)) if (typeof v === allowed[k]) S().settings[k] = v;
    if ('motion' in patch) S().settings.motionChosen = true;
    ai.setLevelLength(S().settings.levelLength);
    if (![10, 30, 50].includes(S().settings.reviewSize)) S().settings.reviewSize = 30;
    if (!ai.LANGUAGES[S().settings.language]) S().settings.language = 'en';
    S().settings.dailyGoal = Math.min(500, Math.max(10, Math.round(S().settings.dailyGoal) || 60));
    ai.setLanguage(S().settings.language);
    await store.save();
    paintTitleBar();
    return publicSettings();
  });
  handle('papers:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add a paper',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Papers', extensions: ACCEPTED.map((e) => e.slice(1)) }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('papers:add', addPaper);
  handle('papers:usage', () => limiter().usage());
  handle('papers:get', (id) => publicPaper(findPaper(id)));
  handle('papers:retry', (id) => {
    const p = findPaper(id);
    runOutline(p);
    return publicPaper(p);
  });
  handle('papers:remove', async (id) => {
    S().papers = S().papers.filter((p) => p.id !== id);
    S().cards = S().cards.filter((c) => c.paperId !== id);
    S().removedCards = S().removedCards.filter((c) => !c.startsWith(`${id}:`));
    await store.save();
    await fs.rm(store.paperDir(id), { recursive: true, force: true });
    return profileView();
  });
  handle('level:get', (id, index) => getLevel(id, index));
  handle('level:prefetch', (id, index) => {
    if (S().settings.prepareAhead) getLevel(id, index).catch(() => {}); // errors surface when the learner actually opens it
    return true;
  });
  handle('level:complete', completeLevel);
  handle('teach:grade', async (id, index, prompt, answer) => {
    const paper = findPaper(id);
    const lv = paper.levels[index];
    return ai.grade({ chapter: paper.outline.chapters[index], keyPoints: lv.teachBack.keyPoints, prompt, answer: String(answer).slice(0, 4000) });
  });
  handle('review:due', dueCards);
  handle('review:rate', rateCard);
  handle('profile:get', profileView);
  handle('open:console', (provider) => CONSOLES[provider] && shell.openExternal(CONSOLES[provider]));
  handle('open:data', () => shell.openPath(store.root()));
  const group = (channel, name) => handle(channel, (...args) => groupResult(groupsApi[name](...args)));
  group('groups:list', 'list');
  group('groups:create', 'create');
  group('groups:join', 'join');
  group('groups:update', 'update');
  group('groups:rename', 'rename');
  group('groups:leave', 'leave');
  group('groups:remove-member', 'removeMember');
  group('groups:code', 'replaceCode');
  group('groups:delete', 'remove');
  handle('exam:list', listExams);
  handle('exam:save', saveExam);
  handle('exam:remove', removeExam);
  handle('exam:questions', (id) => exam.pickQuestions(findExam(id), S().papers));
  handle('exam:finish', finishExam);
  handle('cards:export', exportCards);
  handle('cards:list', deckView);
  handle('cards:save', saveCard);
  handle('cards:remove', removeCard);
  handle('update:check', () => updater.check());
  handle('open:support', () => shell.openExternal('mailto:support@steelfable.com'));
  handle('open:website', () => shell.openExternal('https://steelfable.com/margin/'));
  handle('update:pending', () => updater.pending());
  handle('update:install', () => updater.install());
  handle('open:terms', () => shell.openExternal('https://steelfable.com/terms/'));
  handle('open:privacy', () => shell.openExternal('https://steelfable.com/privacy/'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await store.load();
  const st = S().settings;
  if (st.apiKey) {
    // 1.0.0 stored a single Anthropic key.
    st.keys.anthropic ??= st.apiKey;
    delete st.apiKey;
    await store.save();
  }
  if (!ai.PROVIDERS[st.provider]) st.provider = 'anthropic';
  ai.configure(st.provider, readKey());
  ai.setLanguage(st.language);
  ai.setLevelLength(st.levelLength);
  // Up to 1.3.0 motion followed Windows, which turns every animation off on PCs with animation effects disabled.
  if (st.motion === 'system' && !st.motionChosen) st.motion = 'full';
  // One line per Gemini request in margin.log: real token counts and what they cost.
  ai.onUsage((u) => {
    const line = `${new Date().toISOString()} gemini usage input=${u.input} cached=${u.cached} answer=${u.answer} thinking=${u.thinking} cost=$${u.dollars.toFixed(4)}\n`;
    fs.appendFile(path.join(store.root(), 'margin.log'), line).catch(() => {});
  });
  registerIpc();
  nativeTheme.on('updated', paintTitleBar);
  setNotificationId();
  createWindow();
  updater.start();
  setTimeout(() => remind().catch(() => {}), 60e3);
  setInterval(() => remind().catch(() => {}), 15 * 60e3);
  reportSoon(5e3);
});

app.on('window-all-closed', () => app.quit());
