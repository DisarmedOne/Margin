// Single JSON file under userData. Paper sources live in papers/<id>/.
const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = () => path.join(app.getPath('userData'), 'data');
const file = () => path.join(root(), 'state.json');

const fresh = () => ({
  version: 1,
  settings: {
    sound: true, motion: 'full', theme: 'system', provider: 'anthropic', keys: {}, language: 'en', dailyGoal: 60,
    readingSize: 'm', confidence: true, autoContinue: false, levelLength: 'standard',
    reviewSize: 30, prepareAhead: true,
  },
  profile: {
    xp: 0,
    streak: { count: 0, last: null },
    answered: 0,
    correct: 0,
    levelsDone: 0,
    reviewsDone: 0,
    calibration: { guess: { n: 0, right: 0 }, fairly: { n: 0, right: 0 }, certain: { n: 0, right: 0 } },
    daily: {},
  },
  papers: [],
  cards: [],
});

const store = {
  state: null,

  async load() {
    await fs.mkdir(root(), { recursive: true });
    try {
      const saved = JSON.parse(await fs.readFile(file(), 'utf8'));
      const base = fresh();
      this.state = {
        ...base,
        ...saved,
        settings: { ...base.settings, ...saved.settings },
        profile: { ...base.profile, ...saved.profile },
      };
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep the unreadable file instead of silently overwriting it.
        await fs.rename(file(), `${file()}.broken-${Date.now()}`).catch(() => {});
      }
      this.state = fresh();
    }
    // A paper that was mid-outline when the app closed can't resume; mark it for retry.
    for (const p of this.state.papers) {
      if (p.status === 'reading') {
        p.status = 'error';
        p.error = 'Margin was closed while reading this paper.';
      }
    }
    return this.state;
  },

  _queue: Promise.resolve(),
  save() {
    // Serialise writes; write to a temp file then rename so a crash never leaves half a file.
    this._queue = this._queue.then(async () => {
      const tmp = `${file()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.state));
      await fs.rename(tmp, file());
    });
    return this._queue;
  },

  paperDir(id) {
    return path.join(root(), 'papers', id);
  },

  root,
};

module.exports = store;
