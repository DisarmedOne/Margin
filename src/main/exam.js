// Exam mode: the daily plan and the mixed practice exam. Pure functions, no Electron.
// No schedule is stored. The plan is worked out from what is left and how many days remain,
// so a missed day spreads itself over the rest without any bookkeeping.
const { dayKey } = require('./srs');

const QUESTIONS = 20;

// Whole calendar days from today to a 'YYYY-MM-DD' date. UTC arithmetic keeps clock changes out of it.
const stamp = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const daysUntil = (date, now = Date.now()) => Math.round((stamp(date) - stamp(dayKey(now))) / 864e5);

const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(stamp(s)).toISOString().startsWith(s);

const examPapers = (exam, papers) => exam.paperIds.map((id) => papers.find((p) => p.id === id)).filter((p) => p?.status === 'ready');

// Chapters taken one from each paper in turn: mixes subjects and keeps each paper's own order.
function chapters(exam, papers) {
  const lists = examPapers(exam, papers).map((p) => p.outline.chapters.map((c, ch) => ({ paperId: p.id, ch, progress: p.progress[ch] })));
  const out = [];
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function planFor(exam, papers, now = Date.now()) {
  const days = daysUntil(exam.date, now);
  const all = chapters(exam, papers);
  const today = dayKey(now);
  const finishedToday = all.filter((c) => c.progress?.done && c.progress.doneAt && dayKey(c.progress.doneAt) === today);
  const left = all.filter((c) => !c.progress?.done);
  // The day before the exam is kept free for the practice exam when there is room for that.
  const studyDays = Math.max(1, days - 1);
  // Counted from how the day started, so finishing a level does not pull more into today.
  const quota = days < 0 ? 0 : Math.ceil((left.length + finishedToday.length) / studyDays);
  const next = left.slice(0, Math.max(0, quota - finishedToday.length));
  const item = (done) => (c) => ({ paperId: c.paperId, ch: c.ch, done });
  return {
    days,
    total: all.length,
    finished: all.length - left.length,
    today: [...finishedToday.map(item(true)), ...next.map(item(false))],
  };
}

const shuffle = (list, random) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Questions from finished chapters only, taken from each chapter in turn so all of them are covered.
function pickQuestions(exam, papers, max = QUESTIONS, random = Math.random) {
  const byId = Object.fromEntries(papers.map((p) => [p.id, p]));
  const pools = shuffle(
    chapters(exam, papers)
      .filter((c) => c.progress?.done && byId[c.paperId].levels[c.ch])
      .map((c) => {
        const lv = byId[c.paperId].levels[c.ch];
        return shuffle([...lv.challenges, ...(lv.boss ?? [])], random).map((q) => ({ ...q, paperId: c.paperId, ch: c.ch }));
      }),
    random,
  );
  const out = [];
  for (let i = 0; out.length < max && pools.some((p) => i < p.length); i++) {
    for (const p of pools) if (i < p.length && out.length < max) out.push(p[i]);
  }
  return shuffle(out, random);
}

module.exports = { daysUntil, validDate, planFor, pickQuestions, QUESTIONS };
