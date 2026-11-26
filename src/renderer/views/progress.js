import { h, iconEl } from '../ui.js';
import { t, tn, getLang } from '../i18n.js';

const BANDS = [
  ['guess', 'Guessing'],
  ['fairly', 'Fairly sure'],
  ['certain', 'Certain'],
];

export default function progress(root, S, ctx) {
  const p = S.profile;
  const page = h('div.page');
  root.append(page);

  if (!p.levelsDone && !p.reviewsDone) {
    page.append(
      h(
        'div.empty',
        {},
        h(
          'div.stack',
          {},
          h('p.label', {}, t('Progress · nothing yet')),
          h('h1.display', {}, t('No numbers yet.')),
          h('p.lede', {}, t('Finish your first chapter and this page starts keeping score: your rank, your streak, and how well your confidence matches your answers.')),
          h('div.row', { style: 'margin-top: var(--s3)' }, h('button.btn', { onclick: () => ctx.go({ name: 'library' }) }, t('Start a chapter'), iconEl('arrow'))),
        ),
        h('aside', {}, h('p.label', { style: 'margin-bottom: var(--s3)' }, t('Ranks to earn')), ladder(p)),
      ),
    );
    return;
  }

  const acc = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;
  const span = p.rank.next ? p.rank.next.xp - p.rank.floor : 1;
  const into = p.rank.next ? ((p.xp - p.rank.floor) / span) * 100 : 100;

  page.append(
    h(
      'header.pagehead',
      {},
      h('div.stack', {}, h('p.label', {}, t('Progress · current rank')), h('h1.display', {}, t(p.rank.name))),
      h(
        'div.stack',
        { style: 'text-align:right; --gap: var(--s1)' },
        h('p.label', {}, t('Total')),
        h('p.num', { style: 'font-size: var(--t-h2); color: var(--ink); font-weight: 600' }, `${p.xp.toLocaleString(getLang())} XP`),
      ),
    ),
    h(
      'div.rankline',
      { style: 'margin-bottom: var(--s6)' },
      h('div.track', {}, h('i', { style: `width:${into}%` })),
      h(
        'p.small',
        {},
        p.rank.next ? t('{n} XP to {rank}', { n: (p.rank.next.xp - p.xp).toLocaleString(getLang()), rank: t(p.rank.next.name) }) : t('You hold the top rank.'),
      ),
    ),
    h(
      'div.stats',
      {},
      stat(t('Day streak'), p.streak),
      stat(t('Chapters finished'), p.levelsDone),
      stat(t('Questions answered'), p.answered),
      stat(t('Accuracy'), p.answered ? `${acc}%` : '—'),
    ),
    h(
      'div.prog-grid',
      {},
      h('section', {}, sectionTitle(t('Calibration'), t('Right answers, by how sure you said you were')), calibration(p)),
      h('section', {}, sectionTitle(t('Last 14 days'), t('XP per day')), days(p)),
      h('section', {}, sectionTitle(t('Ranks'), tn(p.ranks.length, '{n} in all|{n} in all')), ladder(p)),
      h(
        'section',
        {},
        sectionTitle(t('Review deck'), ''),
        h('div.stats', { style: 'grid-template-columns: repeat(2, 1fr)' }, stat(t('Cards'), p.deckSize), stat(t('Due now'), p.due)),
        h('p.small', { style: 'margin-top: var(--s3)' }, tn(p.reviewsDone, '{n} review done so far.|{n} reviews done so far.')),
      ),
    ),
  );
}

const stat = (k, v) => h('div', {}, h('p.label', {}, k), h('p.v', {}, v));
const sectionTitle = (title, sub) => h('div.section-title', {}, h('h2.h3', {}, title), h('span.small', {}, sub));

function calibration(p) {
  const rows = BANDS.map(([k, label]) => {
    const c = p.calibration[k];
    const pct = c.n ? Math.round((c.right / c.n) * 100) : null;
    return h(
      'div.r',
      {},
      h('span', {}, t(label)),
      h('div.bar', {}, h('i', { style: `width:${pct ?? 0}%` })),
      h('span.num.small', { style: 'text-align:right' }, pct == null ? '—' : `${pct}%`),
    );
  });
  const cert = p.calibration.certain;
  let read = t('Answer a few more questions with a confidence rating to see a pattern.');
  if (cert.n >= 5) {
    const pct = Math.round((cert.right / cert.n) * 100);
    read =
      pct >= 85
        ? t('When you say certain, you are right {pct}% of the time. Your confidence is well tuned.', { pct })
        : t('When you say certain, you are right {pct}% of the time. Slowing down on the answers that feel obvious will pay off.', { pct });
  }
  return h('div.calib', {}, rows, h('p.small', {}, read));
}

function days(p) {
  const list = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    list.push({ key, xp: p.daily[key] || 0, d });
  }
  const max = Math.max(1, ...list.map((x) => x.xp));
  const lang = getLang();
  return h(
    'div',
    {},
    h(
      'div.days',
      { role: 'img', 'aria-label': t('XP earned on each of the last 14 days') },
      list.map((x) =>
        h(
          'div',
          { title: `${x.d.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' })}: ${x.xp} XP` },
          h(`i${x.xp ? (x.key === p.today ? '.today' : '') : '.zero'}`, { style: `height:${x.xp ? Math.max(4, (x.xp / max) * 100) : 2}%` }),
        ),
      ),
    ),
    h('div.dayaxis', {}, h('span.label', {}, list[0].d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })), h('span.label', {}, t('Today'))),
  );
}

function ladder(p) {
  return h(
    'ul.ladder',
    {},
    p.ranks.map((r, i) =>
      h(`li${i < p.rank.index ? '.past' : i === p.rank.index ? '.at' : ''}`, {}, h('span', {}, t(r.name)), h('span.num.small', {}, `${r.xp.toLocaleString(getLang())} XP`)),
    ),
  );
}
