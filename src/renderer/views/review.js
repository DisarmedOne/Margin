import { h, api, when, sound, toast, plain } from '../ui.js';
import { t, tn } from '../i18n.js';

const RATINGS = ['Again', 'Hard', 'Good', 'Easy'];
const RULES = [
  ['Again', 'you blanked. It returns in ten minutes.'],
  ['Hard', 'you got there slowly. A short wait.'],
  ['Good', 'you knew it. The gap grows.'],
  ['Easy', 'instant. The gap grows faster.'],
];

// How long until a card returns, in the chosen language.
function wait(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return tn(min, '{n} min|{n} min');
  const days = Math.round(ms / 864e5);
  if (days < 1) return tn(Math.round(min / 60), '{n} hour|{n} hours');
  if (days < 30) return tn(days, '{n} day|{n} days');
  return tn(Math.round(days / 30), '{n} month|{n} months');
}

export default function review(root, S, ctx) {
  const page = h('div.page');
  root.append(page);
  let alive = true;
  let keyHandler = null;
  const stops = [];
  const onKey = (e) => !e.repeat && keyHandler?.(e);
  window.addEventListener('keydown', onKey);

  page.append(h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, t('Review')), h('div.skel.title', { style: 'width: 260px; height: 36px' }))));

  api(window.margin.dueCards(S.route.paperIds))
    .then((cards) => alive && (cards.length ? session(cards) : empty()))
    .catch((e) => toast(e.message));

  function empty() {
    const p = S.profile;
    keyHandler = null;
    if (!p.deckSize) {
      page.replaceChildren(
        h(
          'div.empty',
          {},
          h(
            'div.stack',
            {},
            h('p.label', {}, t('Review · empty deck')),
            h('h1.display', {}, t('No cards yet.')),
            h(
              'p.lede',
              {},
              t('Finish a chapter and its key ideas land here, along with every question you missed or guessed. They come back a day later, then a week, then a month, each time just before you would forget.'),
            ),
            h('div.row', { style: 'margin-top: var(--s3)' }, h('button.btn', { onclick: () => ctx.go({ name: 'library' }) }, t('Go to your library'))),
          ),
          h(
            'aside',
            {},
            h('p.label', { style: 'margin-bottom: var(--s3)' }, t('How rating works')),
            h(
              'ol.steps',
              {},
              RULES.map(([name, rest], i) => h('li', {}, h('span.n', {}, String(i + 1).padStart(2, '0')), h('div', {}, h('b', {}, t(name)), h('span', {}, t(rest))))),
            ),
          ),
        ),
      );
      return;
    }
    page.replaceChildren(
      h(
        'header.pagehead',
        {},
        h('div.stack', {}, h('p.label', {}, `${t('Review')} · ${tn(p.deckSize, '{n} card in your deck|{n} cards in your deck')}`), h('h1.h1', {}, t('All caught up.'))),
      ),
      h(
        'div.quiet-empty',
        {},
        h('p.h3', {}, p.nextDue ? t('The next card is due {when}.', { when: when(p.nextDue) }) : t('Nothing is scheduled.')),
        h('p.body', {}, t('Short, regular reviews beat one long cram. Come back when cards are due; the sidebar shows the count.')),
        h('button.btn.secondary', { onclick: () => ctx.go({ name: 'library' }) }, t('Study a new chapter')),
      ),
      lightningCard(),
    );
  }

  // ---------- lightning round: 60 seconds of multiple choice built from the deck ----------
  function lightningCard() {
    const p = S.profile;
    if (p.deckSize < 4) return h('div');
    return h(
      'div.quiet-empty.lightning-card',
      { style: 'margin-top: var(--s5)' },
      h('p.label', {}, p.bestLightning ? `${t('Lightning round')} · ${t('best {n}', { n: p.bestLightning })}` : t('Lightning round')),
      h('p.h3', {}, t('Sixty seconds. As many cards as you can.')),
      h('p.body', {}, t('Four answers per card, taken from your own deck. It does not change when cards come due, so play as often as you like.')),
      h('button.btn', { onclick: lightning }, t('Start the round')),
    );
  }

  async function lightning() {
    let pool;
    try {
      pool = await api(window.margin.cardPool());
    } catch (e) {
      return toast(e.message);
    }
    if (!alive) return;
    const DURATION = 60e3;
    const end = Date.now() + DURATION;
    let score = 0;
    let run = 0;
    let i = 0;
    let over = false;
    const bar = h('i');
    const secs = h('span.num');
    const scoreEl = h('p.v', {}, '0');
    const host = h('div');
    page.replaceChildren(
      h(
        'header.pagehead',
        {},
        h('div.stack', {}, h('p.label', {}, `${t('Review')} · ${t('Lightning round')}`), h('h1.h1', {}, t('Go.'))),
        h('div.stack', { style: 'text-align: right; --gap: var(--s1)' }, h('p.label', {}, t('Score')), scoreEl),
      ),
      h('div.timer', {}, h('div.timer-track', {}, bar), secs),
      host,
    );
    const tick = setInterval(() => {
      const left = end - Date.now();
      bar.style.width = `${Math.max(0, (left / DURATION) * 100)}%`;
      secs.textContent = `${Math.max(0, Math.ceil(left / 1000))}s`;
      bar.parentElement.classList.toggle('low', left < 10e3);
      if (left <= 0) finish();
    }, 100);
    stops.push(() => clearInterval(tick));

    const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const next = () => {
      if (over) return;
      const card = pool[i++ % pool.length];
      const others = shuffle(pool.filter((c) => c.id !== card.id && plain(c.back) !== plain(card.back))).slice(0, 3);
      const opts = shuffle([card, ...others]);
      let locked = false;
      const buttons = opts.map((o, k) =>
        h('button.option', { style: `--i:${k}`, onclick: () => pick(k) }, h('span.k', {}, k + 1), h('span', {}, plain(o.back)), h('span.mark')),
      );
      const pick = (k) => {
        if (locked || over) return;
        locked = true;
        const right = opts[k] === card;
        buttons.forEach((b, j) => {
          b.disabled = true;
          if (opts[j] === card) b.classList.add('right');
          else if (j === k) b.classList.add('wrong');
          else b.classList.add('dim');
        });
        if (right) {
          score++;
          run++;
          scoreEl.textContent = score;
          scoreEl.classList.remove('bump');
          void scoreEl.offsetWidth;
          scoreEl.classList.add('bump');
          sound.right();
        } else {
          run = 0;
          sound.wrong();
        }
        setTimeout(next, right ? 280 : 900);
      };
      keyHandler = (e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= opts.length) pick(n - 1);
      };
      host.replaceChildren(
        h('article.flash.flash-lightning', {}, h('div.face', {}, h('p.q', {}, plain(card.front)), h('div.options', { style: 'margin-top: 0' }, buttons))),
        h('p.label', { style: 'margin-top: var(--s3); color: var(--accent); min-height: 1.3em' }, run >= 3 ? tn(run, '{n} in a row|{n} in a row') : ''),
      );
    };

    const finish = async () => {
      if (over) return;
      over = true;
      clearInterval(tick);
      keyHandler = null;
      let res;
      try {
        res = await api(window.margin.finishLightning(score));
        ctx.setProfile(res.profile);
      } catch (e) {
        toast(e.message);
      }
      if (!alive) return;
      sound.done();
      page.replaceChildren(
        h(
          'header.pagehead',
          {},
          h('div.stack', {}, h('p.label', {}, `${t('Lightning round')} · ${t('Time')}`), h('h1.display', {}, tn(score, '{n} right.|{n} right.'))),
          res?.isBest && score ? h('span.rankup', {}, t('New best')) : null,
        ),
        h(
          'div.stats',
          { style: 'grid-template-columns: repeat(3, 1fr)' },
          stat(t('Score'), score),
          stat(t('Earned'), `+${score * 2} XP`),
          stat(t('Best'), S.profile.bestLightning ?? score),
        ),
        h(
          'div.row',
          { style: 'margin-top: var(--s6)' },
          h('button.btn', { onclick: lightning }, t('Play again')),
          h('button.btn.secondary', { onclick: () => ctx.go({ name: 'review' }) }, t('Back to review')),
        ),
      );
    };

    next();
  }

  function session(cards) {
    let i = 0;
    let again = 0;
    const counter = h('p.label');
    const host = h('div');
    page.replaceChildren(
      h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, t('Review')), h('h1.h1', {}, tn(cards.length, '{n} card due|{n} cards due'))), counter),
      host,
    );

    const draw = () => {
      const c = cards[i];
      counter.textContent = t('Card {n} of {total}', { n: i + 1, total: cards.length });
      const answer = h('p.a', { style: 'display:none' }, plain(c.back));
      const footer = h('footer');
      const reveal = () => {
        answer.style.display = '';
        sound.flip();
        footer.replaceChildren(
          h(
            'div.ratings',
            {},
            RATINGS.map((r, n) =>
              h(`button.btn${n === 2 ? '' : '.secondary'}`, { onclick: () => rate(n) }, h('span', {}, t(r)), h('small', {}, `${n + 1} · ${wait(c.previewMs[n])}`)),
            ),
          ),
        );
        keyHandler = (e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= 4) rate(n - 1);
        };
      };
      footer.append(h('button.btn.lg', { onclick: reveal, style: 'width: 100%' }, t('Show answer'), h('span.kbd', {}, t('Space'))));
      keyHandler = (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          reveal();
        }
      };
      host.replaceChildren(
        h(
          'article.flash',
          {},
          h(
            'header',
            {},
            h('span.label', {}, c.paperTitle.length > 60 ? `${c.paperTitle.slice(0, 58)}…` : c.paperTitle),
            h('span.label', {}, t('Chapter {n}', { n: c.chapter + 1 })),
          ),
          h('div.face', {}, h('p.q', {}, plain(c.front)), answer),
          footer,
        ),
      );
    };

    let busy = false;
    const rate = async (n) => {
      if (busy) return;
      busy = true;
      try {
        ctx.setProfile(await api(window.margin.rateCard(cards[i].id, n)));
      } catch (e) {
        toast(e.message);
      }
      busy = false;
      if (n === 0) again++;
      i++;
      if (!alive) return;
      i < cards.length ? draw() : done(cards.length, again);
    };

    draw();
  }

  function done(count, again) {
    keyHandler = null;
    sound.done();
    const p = S.profile;
    page.replaceChildren(
      h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, `${t('Review')} · ${t('Session complete')}`), h('h1.display', {}, t('Done for now.')))),
      h(
        'div.stats',
        {},
        stat(t('Reviewed'), count),
        stat(t('Knew it'), count - again),
        stat(t('Again'), again),
        stat(t('Streak'), tn(p.streak, '{n} day|{n} days')),
      ),
      h(
        'div.row',
        { style: 'margin-top: var(--s6); gap: var(--s5)' },
        h('button.btn', { onclick: () => ctx.go({ name: 'library' }) }, t('Back to library')),
        p.due
          ? h('button.btn.secondary', { onclick: () => ctx.go({ name: 'review' }) }, tn(p.due, '{n} more due|{n} more due'))
          : h('p.small', {}, p.nextDue ? t('Next card due {when}.', { when: when(p.nextDue) }) : ''),
      ),
      lightningCard(),
    );
  }

  const stat = (k, v) => h('div', {}, h('p.label', {}, k), h('p.v', {}, v));

  return () => {
    alive = false;
    stops.forEach((s) => s());
    window.removeEventListener('keydown', onKey);
  };
}
