import { h, iconEl, api, rich, plain, clock, sound, toast, aiName, tipRotator } from '../ui.js';
import { t, tn, getLang } from '../i18n.js';

// English keys; translated where they are shown.
const STAGES = ['Guess', 'Read', 'Practice', 'Explain', 'Exam'];
const KIND = { choice: 'Question', truefalse: 'True or false', cloze: 'Fill the gap', spot: 'Spot the odd one out' };
const RIGHT = ['Correct.', 'Right.', 'Exactly.', 'That is it.'];
const TEACH_VERDICT = ['Not there yet.', 'Partly there.', 'Solid.', 'Clear and complete.'];
const CONF = [
  ['guess', 'Guessing', 'G'],
  ['fairly', 'Fairly sure', 'F'],
  ['certain', 'Certain', 'C'],
];
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const multiplier = (combo) => (combo >= 5 ? 2 : combo >= 3 ? 1.5 : 1);
// Word count that also works for languages written without spaces (Chinese, Japanese).
const words = (s) => {
  try {
    return [...new Intl.Segmenter(getLang(), { granularity: 'word' }).segment(s)].filter((x) => x.isWordLike).length;
  } catch {
    return (s.trim().match(/\S+/g) || []).length;
  }
};

export default function level(root, S, ctx) {
  const { id, ch } = S.route;
  const paper = S.papers.find((p) => p.id === id);
  if (!paper || paper.status !== 'ready') {
    queueMicrotask(() => ctx.go({ name: 'library' }));
    return;
  }
  const chapters = paper.outline.chapters;
  const chapter = chapters[ch];
  const isLast = ch === chapters.length - 1;

  const game = {
    xp: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    total: 0,
    missed: [],
    calibration: { guess: { n: 0, right: 0 }, fairly: { n: 0, right: 0 }, certain: { n: 0, right: 0 } },
  };
  let stage = -1;
  let hasBoss = true;
  let alive = true;
  let keyHandler = null;
  const timers = [];

  // ---------- frame ----------
  const leaveText = document.createTextNode(t('Leave'));
  const leaveBtn = h('button.btn.ghost.sm', { onclick: leave }, iconEl('back'), leaveText);
  const stagebar = h('div.stagebar', { 'aria-label': t('Level progress') });
  const xpEl = h('span.xp.num', {}, '0 XP');
  const comboEl = h('span.combo', { title: t('Answers in a row') });
  const body = h('div');
  const tally = h('dl.tally');
  const notes = h(
    'aside.marginal',
    {},
    h('p.label', {}, t('Chapter {n} of {total}', { n: ch + 1, total: chapters.length })),
    h('p.mtitle', {}, plain(chapter.title)),
    h('ul.concepts', {}, chapter.concepts.map((c) => h('li', {}, plain(c)))),
    h('p.label', { style: 'margin-top: var(--s5)' }, t('This run')),
    tally,
  );
  const keys = [t('1–4 answer'), S.settings.confidence && t('G F C how sure'), t('Enter continue'), t('Esc leave')].filter(Boolean);
  root.append(
    h('div.levelbar', {}, h('div', {}, leaveBtn), stagebar, h('div.score', {}, comboEl, xpEl)),
    h('div.stagewrap', {}, body, notes),
    h('div.kbdhint', { 'aria-hidden': 'true' }, keys.map((k) => h('span', {}, k))),
  );

  function drawTally() {
    const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
    tally.replaceChildren(
      ...row(t('Correct'), t('{right} of {total}', { right: game.correct, total: game.total })),
      ...row(t('Run'), game.combo ? tn(game.combo, '{n} in a row|{n} in a row') : '—'),
      ...row(t('For review'), game.missed.length),
    );
  }
  drawTally();

  let armed = false;
  function leave() {
    const started = game.total > 0 || stage > 0;
    if (!started || stage === 99 || armed) return ctx.go({ name: 'paper', id });
    armed = true;
    leaveText.textContent = t('Leave? This run is lost');
    leaveBtn.classList.replace('ghost', 'danger');
    timers.push(
      setTimeout(() => {
        armed = false;
        leaveText.textContent = t('Leave');
        leaveBtn.classList.replace('danger', 'ghost');
      }, 3500),
    );
  }

  const onKey = (e) => {
    if (e.key === 'Escape') return leave();
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
    if (e.repeat) return;
    keyHandler?.(e);
  };
  window.addEventListener('keydown', onKey);

  function drawStages(active) {
    const list = hasBoss ? STAGES : STAGES.slice(0, 4);
    stagebar.replaceChildren(...list.map((name, i) => h(`div${i < active ? '.done' : i === active ? '.now' : ''}`, {}, h('i'), h('span', {}, t(name)))));
  }

  // Keeps newly shown feedback in view without a jump.
  function reveal(el) {
    const smooth = !document.documentElement.classList.contains('reduce-motion');
    requestAnimationFrame(() => el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' }));
  }

  // Each stage installs its own keyHandler; buttons built inside show(...) args set it before this runs.
  function show(...nodes) {
    // Each block of a step rises in a beat after the one before it.
    nodes.filter(Boolean).forEach((n, i) => n.style?.setProperty('--n', i));
    body.replaceChildren(h('section.stage', {}, h('div.stack', {}, ...nodes)));
    root.scrollTop = 0;
  }

  function gainXP(n) {
    game.xp += n;
    xpEl.textContent = `${game.xp} XP`;
    xpEl.classList.remove('bump');
    void xpEl.offsetWidth;
    xpEl.classList.add('bump');
    // A small "+15" that drifts up from the counter and fades.
    const f = h('span.xp-float', {}, `+${n}`);
    xpEl.parentElement.append(f);
    f.addEventListener('animationend', () => f.remove());
    if (document.documentElement.classList.contains('reduce-motion')) f.remove();
  }

  function drawCombo() {
    drawTally();
    const m = multiplier(game.combo);
    comboEl.textContent = m > 1 ? `×${m}` : game.combo >= 2 ? tn(game.combo, '{n} in a row|{n} in a row') : '';
  }

  function continueButton(label, onGo) {
    const b = h('button.btn.lg', { onclick: onGo }, label, h('span.kbd', {}, 'Enter'));
    keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onGo();
      }
    };
    return b;
  }

  const meta = (...items) => h('div.meta', {}, ...items);

  // ---------- option list ----------
  function optionList(options, twoCol, onChoose) {
    let locked = false;
    const buttons = options.map((text, i) =>
      h(
        'button.option',
        { style: `--i:${i}`, onclick: () => !locked && onChoose(i), 'aria-keyshortcuts': String(i + 1) },
        h('span.k', {}, i + 1),
        h('span', {}, plain(text)),
        h('span.mark'),
      ),
    );
    const el = h(`div.options${twoCol ? '.tf' : ''}`, { role: 'group' }, buttons);
    return {
      el,
      count: options.length,
      choose: (i) => !locked && onChoose(i),
      mark(i) {
        buttons.forEach((b, j) => b.classList.toggle('picked', i === j));
      },
      lock(picked, answer) {
        locked = true;
        el.classList.add('locked');
        buttons.forEach((b, j) => {
          b.classList.remove('picked');
          b.disabled = true;
          if (j === answer) {
            b.classList.add('right');
            b.querySelector('.mark').textContent = j === picked ? t('Your answer') : t('Answer');
          } else if (j === picked) {
            b.classList.add('wrong');
            b.querySelector('.mark').textContent = t('Your answer');
          } else b.classList.add('dim');
        });
      },
    };
  }

  function numberKeys(opts, e) {
    const n = Number(e.key);
    if (n >= 1 && n <= opts.count) {
      opts.choose(n - 1);
      return true;
    }
    return false;
  }

  // ---------- stages ----------
  function loadingView() {
    keyHandler = null;
    const elapsed = h('span', {}, '0:00');
    const started = Date.now();
    timers.push(setInterval(() => (elapsed.textContent = clock(Date.now() - started)), 1000));
    show(
      h('p.label', {}, t('Chapter {n} of {total}', { n: ch + 1, total: chapters.length })),
      h('h1.h1', {}, plain(chapter.title)),
      h('p.lede', {}, rich(chapter.summary)),
      h('p.status', { style: 'margin-top: var(--s4)' }, h('i.pulse'), `${t('Writing this level')} · `, elapsed),
      h(
        'p.small',
        { style: 'max-width: 60ch' },
        t('{ai} is writing questions from the paper. The first level of a paper takes 30 to 60 seconds; after that, the next chapter is prepared in the background while you play.', {
          ai: aiName(S),
        }),
      ),
      tips.el,
      h(
        'div.loading-level',
        { 'aria-hidden': 'true', style: 'margin-top: var(--s5)' },
        h('div.skel.title', { style: 'width: 80%; height: 24px' }),
        h('div.lines', {}, [0, 1, 2, 3].map(() => h('div.skel', { style: 'height: 56px' }))),
      ),
    );
  }
  const tips = tipRotator();

  function errorView(e) {
    keyHandler = null;
    show(
      h('p.label', {}, `${t('Chapter {n}', { n: ch + 1 })} · ${plain(chapter.title)}`),
      h('h1.h2', {}, t('This level could not be prepared.')),
      h('p.body', {}, e.message),
      h(
        'div.actions',
        {},
        h('button.btn', { onclick: run }, iconEl('retry'), t('Try again')),
        h('button.btn.secondary', { onclick: () => ctx.go({ name: 'paper', id }) }, t('Back to the route')),
      ),
    );
  }

  function hookStage(q) {
    return new Promise((resolve) => {
      drawStages(0);
      const slot = h('div');
      const opts = optionList(q.options, false, (i) => {
        opts.lock(i, q.answerIndex);
        const right = i === q.answerIndex;
        const gained = right ? 15 : 5;
        gainXP(gained);
        right ? sound.right() : sound.flip();
        slot.replaceChildren(
          h(
            `div.feedback${right ? '.good' : ''}`,
            {},
            h('p.verdict', {}, right ? t('Good instinct.') : t('Most people guess that too.')),
            h('p.body', {}, rich(q.explanation)),
            h('p.gain', {}, right ? t('+{n} XP for a right guess', { n: gained }) : t('+{n} XP for committing to a guess', { n: gained })),
          ),
          h('div.actions', {}, continueButton(t('Start reading'), resolve)),
        );
        reveal(slot);
      });
      show(
        meta(h('p.label', {}, `${t('Chapter {n}', { n: ch + 1 })} · ${t('Before you read')}`)),
        h('h1.h2', {}, plain(q.prompt)),
        h('p.body', {}, t('Take a guess. There is no penalty for being wrong, and committing to an answer first makes the reading stick.')),
        opts.el,
        slot,
      );
      keyHandler = (e) => numberKeys(opts, e);
    });
  }

  function readStage(passages) {
    return new Promise((resolve) => {
      let i = 0;
      const draw = () => {
        drawStages(1);
        const p = passages[i];
        const last = i === passages.length - 1;
        const next = () => {
          gainXP(2);
          if (last) resolve();
          else {
            i++;
            draw();
          }
        };
        const prev = () => {
          if (i > 0) {
            i--;
            draw();
          }
        };
        show(
          meta(
            h('p.label', {}, t('Passage {n} of {total}', { n: i + 1, total: passages.length })),
            h('div.passage-count', {}, passages.map((_, j) => h(`i${j <= i ? '.on' : ''}`))),
          ),
          h('h1.h2', {}, plain(p.heading)),
          h('p.reading', {}, rich(p.body)),
          h(
            'div.actions',
            {},
            continueButton(last ? t('Start practice') : t('Continue'), next),
            i > 0 ? h('button.btn.ghost', { onclick: prev }, t('Previous passage')) : null,
          ),
        );
        const enter = keyHandler;
        keyHandler = (e) => (e.key === 'ArrowLeft' ? prev() : enter(e));
      };
      draw();
    });
  }

  function promptEl(q) {
    if (q.kind !== 'cloze' || !q.prompt.includes('____')) return { el: h('h1.h2', {}, plain(q.prompt)), fill() {} };
    const [a, ...rest] = plain(q.prompt).split('____');
    const blank = h('span.blank', {}, ' ');
    return {
      el: h('h1.h2', {}, a, blank, rest.join('____')),
      fill(text) {
        blank.textContent = plain(text);
        blank.classList.add('filled');
      },
    };
  }

  function toCard(q) {
    const ans = plain(q.options[q.answerIndex]);
    // A "spot the odd one out" prompt is meaningless without its options, so turn it into a true/false card.
    if (q.kind === 'spot') return { front: t('True or false, according to the paper: "{statement}"', { statement: ans }), back: `${t('False.')} ${q.explanation}` };
    return { front: plain(q.prompt), back: `${ans}. ${q.explanation}` };
  }

  function questionStage(q, index, count, boss) {
    return new Promise((resolve) => {
      let picked = null;
      const slot = h('div');
      const prompt = promptEl(q);
      const commit = (confidence) => {
        if (picked == null) return;
        conf.remove();
        opts.lock(picked, q.answerIndex);
        if (q.kind === 'cloze') prompt.fill(q.options[q.answerIndex]);
        const right = picked === q.answerIndex;
        const cal = confidence ? game.calibration[confidence] : null; // null when the confidence step is turned off
        game.total++;
        if (cal) cal.n++;
        let gained = 0;
        let lucky = false;
        if (right) {
          game.correct++;
          if (cal) cal.right++;
          game.combo++;
          game.bestCombo = Math.max(game.bestCombo, game.combo);
          gained = Math.round((boss ? 20 : 10) * multiplier(game.combo)) + (confidence === 'certain' ? 5 : 0);
          lucky = Math.random() < 0.125;
          if (lucky) gained *= 2;
          gainXP(gained);
          lucky ? sound.bonus() : sound.right();
        } else {
          game.combo = 0;
          sound.wrong();
        }
        if (!right || confidence === 'guess') game.missed.push(toCard(q));
        drawCombo();

        const m = multiplier(game.combo);
        const gainText = right
          ? [
              `+${gained} XP`,
              m > 1 && t('{n} in a row, ×{m}', { n: game.combo, m }),
              confidence === 'certain' && t('certainty bonus'),
              lucky && t('bonus find, doubled'),
            ]
              .filter(Boolean)
              .join(' · ')
          : t('Combo reset. This one goes into your review deck.');
        let note = null;
        if (!right && confidence === 'certain') note = t('You were certain. Confident mistakes are the ones memory corrects most strongly, so give this explanation a second read.');
        if (right && confidence === 'guess') note = t('Right, but you were guessing. It will come back in Review to make sure it sticks.');

        const lastQ = index === count - 1;
        const nextBtn = continueButton(lastQ ? (boss ? t('See results') : t('Explain it back')) : t('Next question'), resolve);
        slot.replaceChildren(
          h(
            `div.feedback.${right ? 'good' : 'bad'}`,
            {},
            h('p.verdict', {}, right ? t(pickOne(RIGHT)) : t('Not quite.')),
            !right ? h('p.body', { style: 'color: var(--ink)' }, t('The answer is: {answer}', { answer: plain(q.options[q.answerIndex]) })) : null,
            h('p.body', {}, rich(q.explanation)),
            h('p.gain', {}, gainText),
            note ? h('p.note', {}, note) : null,
          ),
          h('div.actions', {}, nextBtn),
        );
        reveal(slot);
        if (right && S.settings.autoContinue) {
          nextBtn.classList.add('auto'); // the button fills like a short fuse, then moves on
          timers.push(setTimeout(resolve, 1800));
        }
      };

      const conf = h(
        'div.confidence',
        { style: 'display:none' },
        h('span.label', {}, t('How sure are you?')),
        CONF.map(([key, label, k]) => h('button.btn.secondary', { onclick: () => commit(key) }, t(label), h('span.kbd', {}, k))),
      );
      const opts = optionList(q.options, q.kind === 'truefalse', (i) => {
        picked = i;
        opts.mark(i);
        if (!S.settings.confidence) return commit(null);
        conf.style.display = 'flex';
        reveal(conf);
      });

      drawStages(boss ? 4 : 2);
      show(
        boss ? h('div.bossbanner', {}, h('span.label', {}, t('Chapter exam')), h('span.label', {}, t('Double XP'))) : null,
        meta(
          h(
            'p.label',
            {},
            boss ? t('Exam question {n} of {total}', { n: index + 1, total: count }) : `${t(KIND[q.kind])} · ${t('{n} of {total}', { n: index + 1, total: count })}`,
          ),
        ),
        prompt.el,
        opts.el,
        conf,
        slot,
      );
      keyHandler = (e) => {
        if (numberKeys(opts, e)) return;
        const c = CONF.find(([, , k]) => k.toLowerCase() === e.key.toLowerCase());
        if (c && picked != null) commit(c[0]);
      };
    });
  }

  function teachStage(tb) {
    return new Promise((resolve) => {
      drawStages(3);
      keyHandler = null;
      const ta = h('textarea.textarea', { placeholder: t('Start with the main idea, then say why it matters…'), 'aria-label': t('Your explanation'), spellcheck: 'true' });
      const minWords = t('at least 15 to submit');
      const counter = h('span.counter', {}, `${tn(0, '{n} word|{n} words')} · ${minWords}`);
      const err = h('p.error-text', { role: 'alert' });
      const submit = h('button.btn.lg', { disabled: true, onclick: () => grade() }, t('Check my explanation'), h('span.kbd', {}, 'Ctrl Enter'));
      const skip = h('button.btn.ghost', { onclick: () => resolve() }, t('Skip this step'));
      const controls = h('div.actions', {}, submit, skip);
      const slot = h('div');

      ta.addEventListener('input', () => {
        const w = words(ta.value);
        counter.textContent = `${tn(w, '{n} word|{n} words')}${w < 15 ? ` · ${minWords}` : ''}`;
        submit.disabled = w < 15;
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey && !submit.disabled) grade();
      });

      async function grade() {
        submit.disabled = true;
        skip.disabled = true;
        ta.readOnly = true;
        err.textContent = '';
        submit.firstChild.textContent = t('Reading your explanation…');
        try {
          const g = await api(window.margin.gradeTeachBack(id, ch, tb.prompt, ta.value));
          if (alive) result(g);
        } catch (e) {
          err.textContent = e.message;
          submit.firstChild.textContent = t('Try again');
          submit.disabled = false;
          skip.disabled = false;
          ta.readOnly = false;
        }
      }

      function result(g) {
        controls.remove();
        counter.remove();
        const gained = g.score * 15;
        gainXP(gained);
        g.score >= 2 ? sound.right() : sound.flip();
        if (g.score < 2) game.missed.push({ front: plain(tb.prompt), back: plain(tb.keyPoints.join(' ')) });
        drawTally();
        slot.replaceChildren(
          h(
            `div.feedback${g.score >= 2 ? '.good' : ''}`,
            {},
            h(
              'div.row',
              { style: 'gap: var(--s4)' },
              h('div.marks', { 'aria-label': t('{n} of {total}', { n: g.score, total: 3 }) }, [0, 1, 2].map((i) => h(`i${i < g.score ? '.on' : ''}`))),
              h('p.verdict', { style: 'color: var(--ink)' }, t(TEACH_VERDICT[g.score])),
            ),
            h('p.body', {}, rich(g.feedback)),
            h(
              'ul.checklist',
              {},
              g.covered.map((point) => h('li.yes', {}, iconEl('check'), point)),
              g.missed.map((point) => h('li.no', {}, iconEl('cross'), point)),
            ),
            h('p.gain', {}, gained ? `+${gained} XP` : t('No XP this time. The key points go into your review deck.')),
          ),
          h('div.actions', {}, continueButton(hasBoss ? t('Go to the exam') : t('See results'), resolve)),
        );
      }

      show(
        meta(h('p.label', {}, t('Explain it back'))),
        h('h1.h2', {}, plain(tb.prompt)),
        h('p.body', {}, t('Write it as if you were telling a friend. Three or four sentences is plenty. {ai} checks it against the chapter’s key points.', { ai: aiName(S) })),
        ta,
        h('div.spread', { style: 'align-items: center' }, counter, err),
        controls,
        slot,
      );
      ta.focus();
    });
  }

  function examIntro(count) {
    return new Promise((resolve) => {
      drawStages(4);
      show(
        h('p.label', {}, t('Chapter exam')),
        h('h1.h1', {}, tn(count, 'One harder question.|{n} harder questions.')),
        h('p.lede', {}, t('These ask you to connect ideas or apply them somewhere new. Exam answers are worth double, and your run carries over.')),
        h('div.actions', {}, continueButton(t('Start the exam'), resolve)),
      );
    });
  }

  async function summary() {
    stage = 99;
    drawStages(STAGES.length);
    keyHandler = null;
    let res;
    try {
      res = await api(
        window.margin.completeLevel(id, ch, {
          xp: game.xp,
          correct: game.correct,
          total: game.total,
          bestCombo: game.bestCombo,
          missed: game.missed,
          calibration: game.calibration,
        }),
      );
      ctx.upsertPaper(await api(window.margin.getPaper(id)));
    } catch (e) {
      toast(t('Progress could not be saved: {error}', { error: e.message }));
      return ctx.go({ name: 'paper', id });
    }
    if (!alive) return;
    ctx.setProfile(res.profile);
    sound.done();

    const p = res.profile;
    const acc = game.total ? game.correct / game.total : 0;
    const lede =
      acc >= 0.9
        ? t('Clean run. That is the material sticking.')
        : acc >= 0.6
          ? t('Good work. The questions you missed are already queued for review.')
          : t('A rough one, and that is useful: the mistakes you just made are the fastest route to remembering this.');

    const span = p.rank.next ? p.rank.next.xp - p.rank.floor : 1;
    const toPct = (xp) => (p.rank.next ? Math.max(0, Math.min(1, (xp - p.rank.floor) / span)) * 100 : 100);
    const before = h('i', { style: 'width:0' });
    const gain = h('i.gain', { style: 'width:0' });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        gain.style.width = `${toPct(p.xp)}%`;
        before.style.width = `${res.rankUp ? 0 : toPct(p.xp - game.xp)}%`;
      }),
    );

    const next = isLast
      ? h(
          'div.next-card',
          {},
          h('p.label', {}, t('Paper complete')),
          h('p.h3', {}, plain(paper.outline.title)),
          h('p.body', {}, rich(lv.nextTeaser)),
          h(
            'div.row',
            { style: 'margin-top: var(--s2)' },
            continueButton(t('Back to library'), () => ctx.go({ name: 'library' })),
            p.due ? h('button.btn.secondary', { onclick: () => ctx.go({ name: 'review' }) }, tn(p.due, 'Review {n} card|Review {n} cards')) : null,
          ),
        )
      : h(
          'div.next-card',
          {},
          h('p.label', {}, `${t('Up next')} · ${t('Chapter {n}', { n: ch + 2 })}`),
          h('p.h3', {}, plain(chapters[ch + 1].title)),
          h('p.body', {}, rich(lv.nextTeaser)),
          h(
            'div.row',
            { style: 'margin-top: var(--s2)' },
            continueButton(t('Start chapter {n}', { n: ch + 2 }), () => ctx.go({ name: 'level', id, ch: ch + 1 })),
            h('button.btn.secondary', { onclick: () => ctx.go({ name: 'paper', id }) }, t('Back to the route')),
          ),
        );
    const enter = keyHandler;

    show(
      h('p.label', {}, `${t('Chapter {n} of {total}', { n: ch + 1, total: chapters.length })} · ${t('Complete')}`),
      h('h1.display', {}, t('{title}, done.', { title: plain(chapter.title) })),
      h('p.lede', {}, lede),
      h(
        'div.stats',
        { style: 'margin-top: var(--s4)' },
        stat(t('Correct'), `${game.correct}/${game.total}`),
        countUp(stat(t('Earned'), '+0 XP'), game.xp, (v) => `+${v} XP`),
        stat(t('Longest run'), game.bestCombo),
        stat(t('To review'), tn(res.cardsAdded, '+{n} card|+{n} cards')),
      ),
      h(
        'div.rankline',
        { style: 'margin-top: var(--s4)' },
        h(
          'div.spread',
          { style: 'align-items: baseline' },
          h('p.label', {}, `${t('Rank')} · ${t(p.rank.name)}`),
          res.rankUp ? h('span.rankup', {}, `${t('New rank')} · ${t(res.rankUp)}`) : null,
        ),
        h('div.track', {}, gain, before),
        h('p.small', {}, p.rank.next ? t('{n} XP to {rank}', { n: p.rank.next.xp - p.xp, rank: t(p.rank.next.name) }) : t('You hold the top rank.')),
      ),
      h('div', { style: 'height: var(--s3)' }),
      next,
    );
    keyHandler = enter;
  }

  const stat = (k, v) => h('div', {}, h('p.label', {}, k), h('p.v', {}, v));

  // Ticks a stat's number up from 0 instead of showing it all at once.
  function countUp(el, to, fmt) {
    const v = el.querySelector('.v');
    if (document.documentElement.classList.contains('reduce-motion') || !to) {
      v.textContent = fmt(to);
      return el;
    }
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 900);
      v.textContent = fmt(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1 && alive) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return el;
  }

  // ---------- run ----------
  let lv;
  async function run() {
    const pending = api(window.margin.getLevel(id, ch));
    const slow = setTimeout(loadingView, 150); // cached levels open instantly, without a flash
    try {
      lv = await pending;
    } catch (e) {
      clearTimeout(slow);
      if (alive) errorView(e);
      return;
    }
    clearTimeout(slow);
    timers.forEach(clearInterval);
    tips.stop();
    if (!alive) return;
    if (!isLast) window.margin.prefetchLevel(id, ch + 1);
    hasBoss = lv.boss.length > 0;

    stage = 0;
    await hookStage(lv.hook);
    stage = 1;
    await readStage(lv.explainer);
    stage = 2;
    for (let i = 0; i < lv.challenges.length; i++) await questionStage(lv.challenges[i], i, lv.challenges.length, false);
    stage = 3;
    await teachStage(lv.teachBack);
    if (hasBoss) {
      stage = 4;
      await examIntro(lv.boss.length);
      for (let i = 0; i < lv.boss.length; i++) await questionStage(lv.boss[i], i, lv.boss.length, true);
    }
    if (alive) await summary();
  }

  drawStages(-1);
  run();

  return () => {
    alive = false;
    window.removeEventListener('keydown', onKey);
    timers.forEach((id2) => (clearTimeout(id2), clearInterval(id2)));
    tips.stop();
  };
}
