import { h, iconEl, api, ago, clock, toast, aiName, plain } from '../ui.js';
import { t, tn } from '../i18n.js';

export function nextChapter(p) {
  const n = p.outline.chapters.length;
  for (let i = 0; i < n; i++) if (!p.progress[i]?.done) return i;
  return -1;
}
export const doneCount = (p) => Object.values(p.progress).filter((x) => x.done).length;
// A paper's read error, in the chosen language when it came with a template.
export const paperError = (p) => (p.errorKey ? t(p.errorKey, p.errorVars) : p.error);

export default function library(root, S, ctx) {
  const page = h('div.page');
  root.append(page);

  if (!S.papers.length) {
    page.append(emptyLibrary(S, ctx));
    return;
  }

  const ready = S.papers.filter((p) => p.status === 'ready');
  const finishedChapters = ready.reduce((a, p) => a + doneCount(p), 0);

  page.append(
    h(
      'header.pagehead',
      {},
      h(
        'div.stack',
        {},
        h('p.label', {}, `${t('Library')} · ${tn(S.papers.length, '{n} paper|{n} papers')} · ${tn(finishedChapters, '{n} chapter finished|{n} chapters finished')}`),
        h('h1.h1', {}, t('Your papers')),
      ),
      h('button.btn', { onclick: ctx.pickFiles }, iconEl('plus'), t('Add paper')),
    ),
  );

  const resume = ready
    .filter((p) => nextChapter(p) >= 0)
    .sort((a, b) => b.touchedAt - a.touchedAt)[0];
  if (resume) page.append(continueCard(resume, ctx));

  const timers = [];
  const rows = S.papers.map((p) => paperRow(p, S, ctx, timers));
  page.append(
    h('p.label', { style: 'margin-bottom: var(--s3)' }, t('All papers')),
    h(
      'table.table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th.label', {}, t('Paper')),
          h('th.label', { style: 'width:200px' }, t('Progress')),
          h('th.label', { style: 'width:130px' }, t('Added')),
          h('th', { style: 'width:170px' }),
        ),
      ),
      h('tbody', {}, rows),
    ),
  );

  const tick = setInterval(() => timers.forEach((fn) => fn()), 1000);
  return () => clearInterval(tick);
}

function continueCard(p, ctx) {
  const n = p.outline.chapters.length;
  const next = nextChapter(p);
  const started = doneCount(p) > 0;
  return h(
    'section.continue',
    {},
    h(
      'div.stack',
      {},
      h('p.label', {}, started ? t('Pick up where you left off') : t('Ready when you are')),
      h('h2.h2', {}, plain(p.outline.title)),
      h('p.body', {}, t('Chapter {n} of {total}: {title}', { n: next + 1, total: n, title: plain(p.outline.chapters[next].title) })),
      h(
        'div.segments',
        { 'aria-label': t('{done} of {total} chapters finished', { done: doneCount(p), total: n }) },
        p.outline.chapters.map((_, i) => h(`i${p.progress[i]?.done ? '.done' : i === next ? '.now' : ''}`)),
      ),
    ),
    h(
      'div.row',
      {},
      h('button.btn.secondary', { onclick: () => ctx.go({ name: 'paper', id: p.id }) }, t('See route')),
      h(
        'button.btn.lg',
        { onclick: () => ctx.go({ name: 'level', id: p.id, ch: next }) },
        started ? t('Continue chapter {n}', { n: next + 1 }) : t('Start chapter {n}', { n: 1 }),
        iconEl('arrow'),
      ),
    ),
  );
}

function paperRow(p, S, ctx, timers) {
  if (p.status === 'reading') {
    const elapsed = h('span', {}, clock(Date.now() - p.startedAt));
    timers.push(() => (elapsed.textContent = clock(Date.now() - p.startedAt)));
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        h('p.ptitle', {}, p.fileName),
        h('p.status', { style: 'margin-top: 6px' }, h('i.pulse'), `${t('{ai} is reading it', { ai: aiName(S) })} · `, elapsed),
        h('p.small', { style: 'margin-top: 4px' }, t('Usually under a minute. Keep studying while you wait.')),
      ),
      h('td', {}, h('div.skel.line', { style: 'width:120px' }), h('div.skel.line', { style: 'width:96px; height:4px; margin-top:12px' })),
      h('td.small', {}, ago(p.addedAt)),
      h('td'),
    );
  }

  if (p.status === 'error') {
    return h(
      'tr',
      {},
      h(
        'td',
        {},
        h('p.ptitle', {}, p.fileName),
        h('p.status.err', { style: 'margin-top: 6px' }, t('Could not read this paper')),
        h('p.small', { style: 'margin-top: 4px; max-width: 52ch' }, paperError(p)),
      ),
      h('td.small', {}, '—'),
      h('td.small', {}, ago(p.addedAt)),
      h(
        'td',
        {},
        h(
          'div.row',
          { style: 'justify-content:flex-end; gap: var(--s2)' },
          h(
            'button.btn.sm.secondary',
            {
              onclick: async () => {
                try {
                  ctx.upsertPaper(await api(window.margin.retryPaper(p.id)));
                } catch (e) {
                  toast(e.message);
                }
              },
            },
            iconEl('retry'),
            t('Retry'),
          ),
          removeButton(p, ctx),
        ),
      ),
    );
  }

  const n = p.outline.chapters.length;
  const d = doneCount(p);
  return h(
    'tr.click',
    { onclick: () => ctx.go({ name: 'paper', id: p.id }), tabindex: 0, onkeydown: (e) => e.key === 'Enter' && ctx.go({ name: 'paper', id: p.id }) },
    h('td', {}, h('p.ptitle', {}, plain(p.outline.title)), h('p.small', {}, [p.outline.field, p.outline.authors].filter(Boolean).join(' · '))),
    h(
      'td',
      {},
      h('p.small', { style: 'color: var(--ink-2)' }, d === n ? t('Finished') : t('{done} of {total} chapters', { done: d, total: n })),
      h('div.mini-bar', {}, h('i', { style: `width:${(d / n) * 100}%` })),
    ),
    h('td.small', {}, ago(p.addedAt)),
    h('td', { style: 'text-align:right' }, h('span.small', {}, `${t('Open route')} `, iconEl('arrow', 'inline-arrow'))),
  );
}

export function removeButton(p, ctx, label = t('Remove')) {
  let armed = false;
  const b = h(
    'button.btn.sm.ghost',
    {
      onclick: async (e) => {
        e.stopPropagation();
        if (!armed) {
          armed = true;
          b.textContent = t('Click again to remove');
          b.classList.replace('ghost', 'danger');
          setTimeout(() => {
            armed = false;
            b.textContent = label;
            b.classList.replace('danger', 'ghost');
          }, 3500);
          return;
        }
        try {
          await ctx.removePaper(p.id);
        } catch (err) {
          toast(err.message);
        }
      },
    },
    label,
  );
  return b;
}

function emptyLibrary(S, ctx) {
  const zone = h(
    'div.dropzone',
    {},
    iconEl('upload', 'icon'),
    h(
      'div.stack',
      { style: '--gap: var(--s1)' },
      h('p.h3', {}, t('Drop a PDF, Word or text file here')),
      h('p.small', {}, t('Up to 30 MB. Scanned PDFs work too, since the AI reads the page images.')),
    ),
    h('button.btn', { onclick: ctx.pickFiles }, t('Choose a file')),
  );
  return h(
    'div.empty',
    {},
    h(
      'div.stack',
      {},
      h('p.label', {}, t('Library · empty')),
      h('h1.display', {}, t('Nothing on the desk yet.')),
      h('p.lede', {}, t('Add a paper and Margin turns it into a short route of chapters. Each chapter is a ten-minute level you can finish in one sitting.')),
      h('div', { style: 'height: var(--s3)' }),
      zone,
    ),
    h(
      'aside',
      {},
      h('p.label', { style: 'margin-bottom: var(--s3)' }, t('How a paper becomes a level')),
      h(
        'ol.steps',
        {},
        step('01', t('{ai} reads the whole paper', { ai: aiName(S) }), t('It maps the argument into four to seven chapters, in the order they are easiest to learn.')),
        step('02', t('You guess before you read'), t('A question up front primes you to notice the answer. A wrong guess still helps.')),
        step('03', t('You answer, then explain'), t('Quick questions, a few sentences in your own words, then a short exam.')),
        step('04', t('Misses come back later'), t('Anything you got wrong returns in Review, spaced to arrive just before you would forget it.')),
      ),
    ),
  );
}

const step = (n, title, text) => h('li', {}, h('span.n', {}, n), h('div', {}, h('b', {}, title), h('span', {}, text)));
