import { h, iconEl, api, clock, toast, aiName, rich, plain, tipRotator } from '../ui.js';
import { t } from '../i18n.js';
import { nextChapter, doneCount, removeButton, paperError } from './library.js';

export default function paper(root, S, ctx) {
  const p = S.papers.find((x) => x.id === S.route.id);
  const page = h('div.page');
  root.append(page);
  const back = h('button.btn.ghost.sm.back', { onclick: () => ctx.go({ name: 'library' }) }, iconEl('back'), t('Library'));
  page.append(back);

  if (!p) {
    page.append(
      h(
        'div.quiet-empty',
        {},
        h('p.h3', {}, t('This paper is no longer in your library.')),
        h('button.btn', { onclick: () => ctx.go({ name: 'library' }) }, t('Back to library')),
      ),
    );
    return;
  }

  if (p.status === 'reading') return readingState(page, p, S);
  if (p.status === 'error') return errorState(page, p, ctx);

  const o = p.outline;
  const n = o.chapters.length;
  const cur = nextChapter(p);
  const done = doneCount(p);
  if (cur >= 0) window.margin.prefetchLevel(p.id, cur); // have the next level ready before they click

  page.append(
    h(
      'header.paperhead',
      {},
      h(
        'div.stack',
        {},
        h('p.label', {}, o.field),
        h('h1.h1', {}, plain(o.title)),
        o.authors ? h('p.small', {}, o.authors) : null,
        h('p.lede', { style: 'margin-top: var(--s3)' }, rich(o.oneLiner)),
      ),
      h(
        'div.facts',
        {},
        fact(t('Chapters'), n),
        fact(t('Study time'), t('about {n} min', { n: o.studyMinutes })),
        fact(t('Finished'), t('{done} of {total}', { done, total: n })),
        fact(t('Source'), p.fileName.length > 22 ? `${p.fileName.slice(0, 20)}…` : p.fileName),
      ),
    ),
  );

  const route = h('ol.route', { 'aria-label': t('Study route') });
  o.chapters.forEach((c, i) => {
    const prog = p.progress[i];
    const state = prog?.done ? 'done' : i === cur ? 'current' : 'locked';
    let act;
    if (state === 'done') {
      act = [
        h('p.label', {}, t('{right} / {total} correct', { right: prog.correct, total: prog.total })),
        h('button.btn.sm.secondary', { onclick: () => ctx.go({ name: 'level', id: p.id, ch: i }) }, iconEl('retry'), t('Replay')),
      ];
    } else if (state === 'current') {
      act = [
        h('button.btn', { onclick: () => ctx.go({ name: 'level', id: p.id, ch: i }) }, done ? t('Continue') : t('Start'), iconEl('arrow')),
        h('p.small', {}, t('About 10 minutes')),
      ];
    } else {
      act = [h('p.small.row', { style: 'gap: 6px' }, iconEl('lock'), t('Unlocks after chapter {n}', { n: i }))];
    }
    route.append(
      h(
        `li.${state}`,
        { style: `--i:${i}` },
        h('div.node', {}, h('span.n', {}, state === 'done' ? iconEl('check') : String(i + 1).padStart(2, '0'))),
        h('div', {}, h('p.ctitle', {}, plain(c.title)), h('p.body', {}, rich(c.summary)), h('div.tags', {}, c.concepts.map((k) => h('span.tag', {}, plain(k))))),
        h('div.act', {}, act),
      ),
    );
  });

  page.append(
    h(
      'div.spread',
      { style: 'margin-bottom: var(--s3); align-items: baseline' },
      h('p.label', {}, t('Route')),
      h('p.small', {}, cur < 0 ? t('Every chapter finished. Replays still earn XP.') : t('Chapters unlock in order.')),
    ),
    route,
    h('div', { style: 'margin-top: var(--s7)' }, removeButton(p, ctx, t('Remove this paper'))),
  );
}

const fact = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));

function readingState(page, p, S) {
  const elapsed = h('span', {}, clock(Date.now() - p.startedAt));
  const tips = tipRotator();
  page.append(
    h(
      'header.paperhead',
      {},
      h(
        'div.stack',
        {},
        h('p.status', {}, h('i.pulse'), `${t('Reading')} · `, elapsed),
        h('h1.h1', {}, p.fileName),
        h(
          'p.lede',
          {},
          t('{ai} is reading the whole paper and planning a route through it. This usually takes under a minute. You can leave this page; Margin will let you know when it is ready.', {
            ai: aiName(S),
          }),
        ),
        tips.el,
      ),
      h('div.facts', {}, [1, 2, 3, 4].map(() => h('div', {}, h('span.skel.line', { style: 'width:70px' }), h('span.skel.line', { style: 'width:40px' })))),
    ),
    h(
      'ol.route',
      { 'aria-hidden': 'true' },
      [0.72, 0.55, 0.64, 0.5].map((w) =>
        h(
          'li.locked',
          {},
          h('div.node', {}, h('span.n', {})),
          h('div.stack', { style: '--gap: var(--s3)' }, h('div.skel.title', { style: `width:${w * 100}%` }), h('div.skel.line', { style: 'width:90%' }), h('div.skel.line', { style: 'width:70%' })),
          h('div'),
        ),
      ),
    ),
  );
  const timer = setInterval(() => (elapsed.textContent = clock(Date.now() - p.startedAt)), 1000);
  return () => (clearInterval(timer), tips.stop());
}

function errorState(page, p, ctx) {
  page.append(
    h(
      'div.quiet-empty',
      {},
      h('p.status.err', {}, t('Could not read this paper')),
      h('h1.h2', {}, p.fileName),
      h('p.body', {}, paperError(p)),
      h(
        'div.row',
        { style: 'margin-top: var(--s3)' },
        h(
          'button.btn',
          {
            onclick: async () => {
              try {
                ctx.upsertPaper(await api(window.margin.retryPaper(p.id)));
                ctx.go({ name: 'paper', id: p.id });
              } catch (e) {
                toast(e.message);
              }
            },
          },
          iconEl('retry'),
          t('Try again'),
        ),
        removeButton(p, ctx, t('Remove')),
      ),
    ),
  );
}
