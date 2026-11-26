const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const mammoth = require('mammoth');
const store = require('./store');
const ai = require('./ai');
const srs = require('./srs');
const updater = require('./updater');

const MAX_BYTES = 30 * 1024 * 1024; // Claude's request limit is 32 MB including base64 overhead headroom
const ACCEPTED = ['.pdf', '.docx', '.txt', '.md'];
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

async function addPaper(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ACCEPTED.includes(ext)) {
    throw new ai.MarginError('TYPE', 'Margin reads PDF, Word (.docx), Markdown and plain text files.');
  }
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_BYTES) throw new ai.MarginError('TOO_BIG', 'This file is over 30 MB. Try a smaller copy.');

  const id = crypto.randomUUID();
  const dir = store.paperDir(id);
  await fs.mkdir(dir, { recursive: true });
  let kind = 'pdf';
  try {
    if (ext === '.pdf') {
      await fs.copyFile(filePath, path.join(dir, 'source.pdf'));
    } else {
      kind = 'text';
      const text = ext === '.docx' ? (await mammoth.extractRawText({ path: filePath })).value : await fs.readFile(filePath, 'utf8');
      if (text.trim().length < 400) {
        throw new ai.MarginError('EMPTY', 'This file has almost no text in it. Margin needs at least a few paragraphs.');
      }
      await fs.writeFile(path.join(dir, 'source.txt'), text);
    }
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }

  const paper = {
    id,
    fileName: path.basename(filePath),
    kind,
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
    const doc = await loadDoc(paper);
    paper.outline = await timed('outline', () => ai.outline(doc));
    paper.status = 'ready';
  } catch (e) {
    paper.status = 'error';
    const f = ai.friendly(e);
    paper.error = f.message;
    paper.errorKey = f.tkey ?? null;
    paper.errorVars = f.vars ?? null;
  }
  if (!S().papers.includes(paper)) return; // removed while reading
  await store.save();
  emit('paper', publicPaper(paper));
  if (paper.status === 'ready') prefetchAll(paper);
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

// Write every chapter's level in the background, in order, so the learner rarely waits.
// Sequential rather than parallel to stay inside free-tier rate limits.
async function prefetchAll(paper) {
  for (let i = 0; i < paper.outline.chapters.length; i++) {
    if (!S().papers.includes(paper)) return;
    try {
      await getLevel(paper.id, i);
    } catch {
      return; // the learner sees the error, with a retry, when they open that chapter
    }
  }
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
  const upsert = (id, front, back, dueNow) => {
    const existing = S().cards.find((c) => c.id === id);
    if (existing) {
      if (dueNow) existing.due = Date.now();
      return;
    }
    S().cards.push({ id, paperId, chapter: index, front, back, ease: 2.5, interval: 0, reps: 0, due: Date.now(), created: Date.now() });
    added++;
  };
  lv?.cards.forEach((c, i) => upsert(`${paperId}:${index}:c${i}`, c.front, c.back, false));
  for (const m of result.missed || []) {
    const h = crypto.createHash('sha1').update(m.front).digest('hex').slice(0, 10);
    upsert(`${paperId}:${index}:m${h}`, m.front, m.back, true);
  }

  await store.save();
  return { profile: profileView(), cardsAdded: added, rankUp: srs.rankFor(p.xp).name !== rankBefore ? srs.rankFor(p.xp).name : null };
}

// ---------- Review ----------
function dueCards() {
  const now = Date.now();
  const titles = Object.fromEntries(S().papers.map((p) => [p.id, p.outline?.title ?? p.fileName]));
  return S()
    .cards.filter((c) => c.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, 30)
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
    const { sound, motion, theme, language, dailyGoal, readingSize, confidence, autoContinue, levelLength } = S().settings;
    return { sound, motion, theme, language, dailyGoal, readingSize, confidence, autoContinue, levelLength };
  };
  handle('boot', () => ({
    settings: publicSettings(),
    key: keyStatus(),
    profile: profileView(),
    papers: S().papers.map(publicPaper),
    providers: providerList(),
    languages: ai.LANGUAGES,
  }));
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
    return { profile: profileView(), isBest };
  });
  handle('key:set', setKey);
  handle('provider:use', useProvider);
  handle('settings:set', async (patch) => {
    const allowed = {
      sound: 'boolean', motion: 'string', theme: 'string', language: 'string', dailyGoal: 'number',
      readingSize: 'string', confidence: 'boolean', autoContinue: 'boolean', levelLength: 'string',
    };
    for (const [k, v] of Object.entries(patch)) if (typeof v === allowed[k]) S().settings[k] = v;
    if ('motion' in patch) S().settings.motionChosen = true;
    ai.setLevelLength(S().settings.levelLength);
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
      filters: [{ name: 'Papers', extensions: ['pdf', 'docx', 'txt', 'md'] }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('papers:add', addPaper);
  handle('papers:get', (id) => publicPaper(findPaper(id)));
  handle('papers:retry', (id) => {
    const p = findPaper(id);
    runOutline(p);
    return publicPaper(p);
  });
  handle('papers:remove', async (id) => {
    S().papers = S().papers.filter((p) => p.id !== id);
    S().cards = S().cards.filter((c) => c.paperId !== id);
    await store.save();
    await fs.rm(store.paperDir(id), { recursive: true, force: true });
    return profileView();
  });
  handle('level:get', (id, index) => getLevel(id, index));
  handle('level:prefetch', (id, index) => {
    getLevel(id, index).catch(() => {}); // errors surface when the learner actually opens it
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
  // Finish writing levels for papers that were read before Margin last closed.
  for (const p of S().papers) if (p.status === 'ready' && readKey()) prefetchAll(p);
  registerIpc();
  nativeTheme.on('updated', paintTitleBar);
  createWindow();
  updater.start();
});

app.on('window-all-closed', () => app.quit());
