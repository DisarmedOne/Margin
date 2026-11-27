import { h, iconEl, api, toast, plain, rich, sound } from '../ui.js';
import { t, tn, getLang } from '../i18n.js';

// "Wednesday 11 March" in the chosen language. Built from parts so the day never shifts with the time zone.
const longDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' });
};
const dayInput = (offset) => {
  const d = new Date(Date.now() + offset * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const countdown = (days) => {
  if (days < 0) return t('This exam date has passed.');
  if (days === 0) return t('Exam day');
  return tn(days, '{n} day to go|{n} days to go');
};

export default function exams(root, S, ctx) {
  const page = h('div.page');
  root.append(page);
  let alive = true;
  let keyHandler = null;
  const onKey = (e) => {
    if (e.repeat || e.target.tagName === 'INPUT') return;
    keyHandler?.(e);
  };
  window.addEventListener('keydown', onKey);

  let list = [];
  // The route remembers which exam is open, so coming back from a level lands on its plan.
  const open = (id) => {
    S.route = { name: 'exams', id };
    show();
  };

  function show() {
    keyHandler = null;
    const exam = list.find((x) => x.id === S.route.id);
    if (exam) detail(exam);
    else overview();
    root.scrollTop = 0;
  }

  const head = (label, title, side) => h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, label), h('h1.h1', {}, title)), side);
  const bar = (done, total) => h('div.mini-bar', {}, h('i', { style: `width:${total ? (done / total) * 100 : 0}%` }));
  const back = () => h('button.btn.ghost.sm.back', { onclick: () => open(null) }, iconEl('back'), t('Exams'));
  const paperTitle = (id) => plain(S.papers.find((p) => p.id === id)?.outline?.title ?? '');
  const chapterTitle = (id, ch) => plain(S.papers.find((p) => p.id === id)?.outline?.chapters[ch]?.title ?? '');

  // ---------- list ----------
  function overview() {
    const ready = S.papers.some((p) => p.status === 'ready');
    if (!list.length) {
      page.replaceChildren(
        h(
          'div.empty',
          {},
          h(
            'div.stack',
            {},
            h('p.label', {}, t('Exams')),
            h('h1.display', {}, t('No exam on the calendar.')),
            h('p.lede', {}, t('Pick a date and the papers on it. Margin tells you what to study each day, and ends with a practice exam.')),
            ready ? null : h('p.body', {}, t('Add a paper to your library first.')),
            h(
              'div.row',
              { style: 'margin-top: var(--s3)' },
              ready ? h('button.btn', { onclick: () => form() }, iconEl('plus'), t('New exam')) : h('button.btn', { onclick: () => ctx.go({ name: 'library' }) }, t('Go to your library')),
            ),
          ),
          h(
            'aside',
            {},
            h(
              'ol.steps',
              {},
              [
                [t('Set the date'), t('Name the exam and tick the papers it covers.')],
                [t('Follow the daily plan'), t('Chapters are shared over the days left. Miss a day and the rest adjusts.')],
                [t('Take the practice exam'), t('Mixed questions from your finished chapters show where you are weak.')],
              ].map(([title, text], i) => h('li', {}, h('span.n', {}, `0${i + 1}`), h('div', {}, h('b', {}, title), h('span', {}, text)))),
            ),
          ),
        ),
      );
      return;
    }
    page.replaceChildren(
      head(t('Exams'), t('Your exams'), ready ? h('button.btn', { onclick: () => form() }, iconEl('plus'), t('New exam')) : null),
      h(
        'ul.examlist',
        {},
        list.map((x) =>
          h(
            'li',
            {},
            h(
              `button${x.days < 0 ? '.past' : ''}`,
              { onclick: () => open(x.id) },
              h('span.stack', { style: '--gap: var(--s1)' }, h('span.ptitle', {}, x.name), h('span.small', {}, longDate(x.date))),
              h('span.stack', { style: '--gap: var(--s2)' }, h('span.small', {}, t('{done} of {total} chapters', { done: x.finished, total: x.total })), bar(x.finished, x.total)),
              h('span.label.when', {}, countdown(x.days)),
              iconEl('arrow', 'inline-arrow'),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- new or edit ----------
  function form(exam) {
    keyHandler = null;
    const ready = S.papers.filter((p) => p.status === 'ready');
    const name = h('input.input', { type: 'text', maxlength: '80', value: exam?.name ?? '', placeholder: t('For example: Psychology midterm'), id: 'exam-name' });
    const date = h('input.input', { type: 'date', min: dayInput(0), value: exam?.date ?? dayInput(14), id: 'exam-date', style: 'max-width: 220px' });
    const boxes = ready.map((p) => h('input', { type: 'checkbox', value: p.id, checked: exam ? exam.paperIds.includes(p.id) : ready.length === 1 }));
    const err = h('p.error-text', { role: 'alert' });
    const submit = h('button.btn', { type: 'submit' }, exam ? t('Save changes') : t('Make my plan'));
    page.replaceChildren(
      back(),
      head(t('Exams'), exam ? t('Edit exam') : t('New exam')),
      h(
        'form.examform',
        {
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            submit.disabled = true;
            err.textContent = '';
            try {
              const saved = await api(
                window.margin.saveExam({ id: exam?.id, name: name.value, date: date.value, paperIds: boxes.filter((b) => b.checked).map((b) => b.value) }),
              );
              list = await api(window.margin.listExams());
              if (alive) open(saved);
            } catch (x) {
              err.textContent = x.message;
              submit.disabled = false;
            }
          },
        },
        h('div.field', {}, h('label.label', { for: 'exam-name' }, t('Name')), name),
        h('div.field', {}, h('label.label', { for: 'exam-date' }, t('Exam date')), date),
        h(
          'fieldset.picks',
          {},
          h('legend.label', {}, t('Papers on the exam')),
          ready.map((p, i) => h('label', {}, boxes[i], h('span', {}, h('b', {}, plain(p.outline.title)), h('span.small', {}, tn(p.outline.chapters.length, '{n} chapter|{n} chapters'))))),
        ),
        err,
        h('div.row', {}, submit, h('button.btn.ghost', { type: 'button', onclick: show }, t('Cancel'))),
      ),
    );
    name.focus();
  }

  // ---------- one exam: today's plan ----------
  function detail(x) {
    const study = (item) => ctx.go({ name: 'level', id: item.paperId, ch: item.ch, exam: x.id });
    // Chapters unlock in order, so only the first unfinished chapter of each paper can be started.
    const started = new Set();
    const items = x.today.map((item) => {
      const ready = !item.done && !started.has(item.paperId);
      if (!item.done) started.add(item.paperId);
      return h(
        `li${item.done ? '.done' : ''}`,
        {},
        h('span.box', { 'aria-hidden': 'true' }, item.done ? iconEl('check') : null),
        h('span.stack', { style: '--gap: 2px' }, h('span.ptitle', {}, chapterTitle(item.paperId, item.ch)), h('span.small', {}, `${t('Chapter {n}', { n: item.ch + 1 })} · ${paperTitle(item.paperId)}`)),
        item.done ? h('span.label', {}, t('Done')) : h(`button.btn.sm${ready ? '' : '.secondary'}`, { onclick: () => study(item), disabled: !ready }, t('Start')),
      );
    });

    let todayBody;
    if (x.days < 0) todayBody = h('p.body', {}, t('Edit the exam to set a new date.'));
    else if (items.length) todayBody = h('ul.todaylist', {}, items);
    else todayBody = h('p.body', {}, x.finished === x.total ? t('Every chapter is finished. Review your cards and take the practice exam.') : t('Nothing new today.'));

    let armed = false;
    const remove = h(
      'button.btn.sm.ghost',
      {
        onclick: async () => {
          if (!armed) {
            armed = true;
            remove.textContent = t('Click again to remove');
            remove.classList.replace('ghost', 'danger');
            return;
          }
          try {
            await api(window.margin.removeExam(x.id));
            list = list.filter((e) => e.id !== x.id);
            if (alive) open(null);
          } catch (e) {
            toast(e.message);
          }
        },
      },
      t('Delete exam'),
    );

    const last = x.last;
    page.replaceChildren(
      back(),
      head(`${countdown(x.days)} · ${longDate(x.date)}`, x.name, h('button.btn.secondary', { onclick: () => form(x) }, t('Edit'))),
      h(
        'div.examgrid',
        {},
        h(
          'section',
          {},
          h('div.section-title', {}, h('h2.h3', {}, t('Today')), h('span.small', {}, t('{done} of {total} chapters', { done: x.finished, total: x.total }))),
          bar(x.finished, x.total),
          todayBody,
          x.cardsDue
            ? h('div.row', { style: 'margin-top: var(--s5)' }, h('button.btn.secondary', { onclick: () => ctx.go({ name: 'review', paperIds: x.paperIds }) }, tn(x.cardsDue, 'Review {n} card|Review {n} cards')))
            : null,
        ),
        h(
          'aside.next-card',
          {},
          h('p.label', {}, t('Practice exam')),
          h(
            'p.body',
            {},
            x.questions
              ? tn(x.questions, '{n} mixed question from your finished chapters.|{n} mixed questions from your finished chapters.')
              : t('Finish a chapter to unlock the practice exam.'),
          ),
          x.questions ? h('p.small', {}, t('No hints or answers until the end. It uses saved questions, so it costs nothing.')) : null,
          h('div', {}, h('button.btn', { disabled: !x.questions, onclick: () => practice(x) }, t('Start practice exam'))),
          last ? h('p.small', { style: 'color: var(--ink)' }, t('Last score: {right} of {total}', { right: last.right, total: last.total })) : null,
          last?.weak.length
            ? h('div.stack', { style: '--gap: var(--s1)' }, h('p.label', {}, t('Weak spots')), last.weak.map((w) => h('p.small', {}, chapterTitle(w.paperId, w.ch))))
            : null,
        ),
      ),
      h('div', { style: 'margin-top: var(--s7)' }, remove),
    );
  }

  // ---------- practice exam: answer everything first, see results at the end ----------
  async function practice(x) {
    let questions;
    try {
      questions = await api(window.margin.examQuestions(x.id));
    } catch (e) {
      return toast(e.message);
    }
    if (!alive || !questions.length) return;
    const answers = [];
    let i = 0;

    const ask = () => {
      const q = questions[i];
      let picked = null;
      const last = i === questions.length - 1;
      const next = h('button.btn.lg', { disabled: true, onclick: () => go() }, last ? t('Hand in') : t('Next question'), h('span.kbd', {}, 'Enter'));
      const buttons = q.options.map((text, k) =>
        h('button.option', { style: `--i:${k}`, 'aria-pressed': 'false', onclick: () => pick(k) }, h('span.k', {}, k + 1), h('span', {}, plain(text)), h('span.mark')),
      );
      function pick(k) {
        picked = k;
        buttons.forEach((b, j) => {
          b.classList.toggle('picked', j === k);
          b.setAttribute('aria-pressed', String(j === k));
        });
        next.disabled = false;
      }
      function go() {
        if (picked == null) return;
        answers.push(picked);
        i++;
        if (i < questions.length) ask();
        else results(x, questions, answers);
      }
      keyHandler = (e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= q.options.length) pick(n - 1);
        else if (e.key === 'Enter') {
          e.preventDefault();
          go();
        }
      };

      let armed = false;
      const leave = h(
        'button.btn.ghost.sm.back',
        {
          onclick: () => {
            if (armed || !answers.length) return show();
            armed = true;
            leave.lastChild.textContent = t('Leave? This run is lost');
          },
        },
        iconEl('back'),
        t('Leave'),
      );
      page.replaceChildren(
        leave,
        head(`${t('Practice exam')} · ${x.name}`, t('Exam question {n} of {total}', { n: i + 1, total: questions.length })),
        h('div.examq.stack', {}, h('h2.h2', {}, plain(q.prompt)), h('div.options', { role: 'group' }, buttons), h('div.actions', {}, next)),
      );
      root.scrollTop = 0;
    };
    ask();
  }

  async function results(x, questions, answers) {
    keyHandler = null;
    let res;
    try {
      res = await api(window.margin.finishExam(x.id, questions.map((q, k) => ({ paperId: q.paperId, ch: q.ch, right: answers[k] === q.answerIndex, card: toCard(q) }))));
      list = await api(window.margin.listExams());
      ctx.refreshProfile();
    } catch (e) {
      toast(e.message);
      return show();
    }
    if (!alive) return;
    sound.done();
    const missed = questions.map((q, k) => ({ q, picked: answers[k] })).filter(({ q, picked }) => picked !== q.answerIndex);
    page.replaceChildren(
      back(),
      h(
        'header.pagehead',
        {},
        h('div.stack', {}, h('p.label', {}, `${t('Practice exam')} · ${x.name}`), h('h1.display', {}, t('{right} of {total}', { right: res.right, total: res.total }))),
        h('button.btn', { onclick: () => open(x.id) }, t('Back to the plan')),
      ),
      h('div.section-title', {}, h('h2.h3', {}, t('By chapter'))),
      h(
        'div.calib',
        {},
        res.chapters.map((c) =>
          h(
            'div.r.examrow',
            {},
            h('span', {}, chapterTitle(c.paperId, c.ch)),
            h('span.bar', {}, h('i', { style: `width:${(c.right / c.total) * 100}%` })),
            h('span.num', {}, `${c.right}/${c.total}`),
          ),
        ),
      ),
      missed.length
        ? h(
            'div.stack',
            { style: 'margin-top: var(--s7)' },
            h('div.section-title', {}, h('h2.h3', {}, t('What you missed')), h('span.small', {}, t('Added to your review deck.'))),
            missed.map(({ q, picked }) =>
              h(
                'div.feedback.bad',
                {},
                h('p.h3', {}, plain(q.prompt)),
                h('p.small', {}, `${t('Your answer')}: ${plain(q.options[picked])}`),
                h('p.body', { style: 'color: var(--ink)' }, t('The answer is: {answer}', { answer: plain(q.options[q.answerIndex]) })),
                h('p.body', {}, rich(q.explanation)),
              ),
            ),
          )
        : h('p.lede', { style: 'margin-top: var(--s6)' }, t('Nothing missed. You are in good shape.')),
    );
    root.scrollTop = 0;
  }

  page.append(head(t('Exams'), t('Your exams')));
  api(window.margin.listExams())
    .then((data) => {
      if (!alive) return;
      list = data;
      show();
    })
    .catch((e) => toast(e.message));

  return () => {
    alive = false;
    window.removeEventListener('keydown', onKey);
  };
}

// The review card made from a missed question.
function toCard(q) {
  const answer = plain(q.options[q.answerIndex]);
  // A "spot the odd one out" prompt is meaningless without its options, so it becomes a true/false card.
  if (q.kind === 'spot') return { front: t('True or false, according to the paper: "{statement}"', { statement: answer }), back: `${t('False.')} ${q.explanation}` };
  return { front: plain(q.prompt), back: `${answer}. ${q.explanation}` };
}
