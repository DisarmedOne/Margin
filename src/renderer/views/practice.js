// Study tools: the brain dump and the focus timer. Neither uses the AI.
import { h, iconEl, api, toast, plain } from '../ui.js';
import { t, tn } from '../i18n.js';
import { timer } from '../focus.js';

// Kept here so looking at another screen does not throw away what was written.
let dump = null; // { paperId, ch, text, step: 'write' | 'check' | 'done', got: Set, saved }

export default function practice(root, S, ctx) {
  const page = h('div.page');
  root.append(page);

  const finished = () =>
    S.papers
      .filter((p) => p.status === 'ready')
      .flatMap((p) => p.outline.chapters.map((c, ch) => ({ p, c, ch })).filter(({ ch }) => p.progress[ch]?.done));

  const timerBox = h('section.tool');
  function drawTimer() {
    const s = timer.state;
    const running = s.phase !== 'idle';
    const act = (fn) => () => {
      fn();
      window.dispatchEvent(new Event('focus-change'));
    };
    timerBox.replaceChildren(
      h('p.label', {}, t('Focus timer')),
      h('p.h3', {}, s.phase === 'break' ? t('Take a short break.') : t('Study for 25 minutes, then rest for 5.')),
      h('p.bigtime', { 'data-focus-time': '' }, timer.left()),
      h(
        'div.row',
        {},
        running
          ? h('button.btn', { type: 'button', onclick: act(s.left === null ? timer.pause : timer.resume) }, s.left === null ? t('Pause') : t('Resume'))
          : h('button.btn', { type: 'button', onclick: act(timer.start) }, t('Start focusing')),
        running ? h('button.btn.secondary', { type: 'button', onclick: act(timer.stop) }, t('Stop')) : null,
      ),
      h(
        'p.small',
        {},
        `${tn(s.rounds, '{n} round finished|{n} rounds finished')}. ${t('This is a Pomodoro timer. It runs while Margin is open and never interrupts a question.')}`,
      ),
    );
  }

  const dumpBox = h('section.tool');
  function drawDump() {
    const chapters = finished();
    const found = dump && chapters.find((x) => x.p.id === dump.paperId && x.ch === dump.ch);
    if (dump && !found) dump = null;
    const head = [h('p.label', {}, t('Brain dump'))];

    if (!dump) {
      if (!chapters.length) {
        dumpBox.replaceChildren(
          ...head,
          h('p.h3', {}, t('Write down everything you remember.')),
          h('p.body', {}, t('Finish a chapter first. Then come back and see how much of it stayed with you.')),
        );
        return;
      }
      const pick = h(
        'select.select',
        { 'aria-label': t('Chapter') },
        chapters.map((x, i) => h('option', { value: String(i) }, `${plain(x.p.outline.title)}: ${plain(x.c.title)}`)),
      );
      dumpBox.replaceChildren(
        ...head,
        h('p.h3', {}, t('Write down everything you remember.')),
        h('p.body', {}, t('Pick a chapter you finished and write from memory, without looking. Then compare it with the key ideas and see what slipped.')),
        pick,
        h(
          'div',
          {},
          h(
            'button.btn',
            {
              type: 'button',
              onclick: () => {
                const x = chapters[Number(pick.value)];
                dump = { paperId: x.p.id, ch: x.ch, text: '', step: 'write', got: new Set(), saved: false };
                drawDump();
                dumpBox.querySelector('textarea').focus();
              },
            },
            t('Start writing'),
          ),
        ),
      );
      return;
    }

    const { p, c } = found;
    const ideas = c.concepts.map(plain);
    const again = h('button.btn.secondary', { type: 'button', onclick: () => ((dump = null), drawDump()) }, t('Choose another chapter'));

    if (dump.step === 'write') {
      const compare = h('button.btn', { type: 'button', onclick: () => ((dump.step = 'check'), drawDump()) }, t('Compare'), iconEl('arrow'));
      const box = h('textarea.textarea.dump', { 'aria-label': t('What you remember'), rows: '10', maxlength: '10000', placeholder: t('Close your notes. Write everything you remember, in your own words.') });
      box.value = dump.text;
      compare.disabled = !dump.text.trim();
      box.addEventListener('input', () => {
        dump.text = box.value;
        compare.disabled = !box.value.trim();
      });
      dumpBox.replaceChildren(...head, h('p.h3', {}, plain(c.title)), box, h('div.row', {}, compare, again));
      return;
    }

    const written = h('div.written', {}, dump.text);
    if (dump.step === 'check') {
      dumpBox.replaceChildren(
        ...head,
        h('p.h3', {}, plain(c.title)),
        written,
        h('p.body', {}, plain(c.summary)),
        h('p.label', {}, t('Tick the ideas your text covered')),
        h(
          'div.ticks',
          {},
          ideas.map((idea, i) => {
            const input = h('input', { type: 'checkbox' });
            input.checked = dump.got.has(i);
            input.addEventListener('change', () => (input.checked ? dump.got.add(i) : dump.got.delete(i)));
            return h('label', {}, input, h('span', {}, idea));
          }),
        ),
        h(
          'div.row',
          {},
          h('button.btn', { type: 'button', onclick: () => ((dump.step = 'done'), drawDump()) }, t('See result')),
          h('button.btn.secondary', { type: 'button', onclick: () => ((dump.step = 'write'), drawDump()) }, t('Back')),
        ),
      );
      return;
    }

    const missed = ideas.filter((_, i) => !dump.got.has(i));
    const add = h(
      'button.btn',
      {
        type: 'button',
        onclick: async () => {
          add.disabled = true;
          const run = dump;
          try {
            // One at a time. Ones already added are not added twice if a later one fails.
            run.added ??= 0;
            while (run.added < missed.length) {
              const view = await api(
                window.margin.saveCard({
                  front: t('What do you remember about “{concept}” in “{chapter}”?', { concept: missed[run.added], chapter: plain(c.title) }),
                  back: plain(c.summary),
                  paperId: p.id,
                }),
              );
              run.added++;
              ctx.setProfile(view.profile);
            }
            run.saved = true;
            if (dump === run) drawDump();
          } catch (e) {
            add.disabled = false;
            toast(e.message);
          }
        },
      },
      t('Add missed ideas to Review'),
    );
    const result = [
      ...head,
      h('p.h3', {}, t('You covered {got} of {total} ideas.', { got: dump.got.size, total: ideas.length })),
      missed.length ? h('div', {}, h('p.label', {}, t('What slipped')), h('ul.slipped', {}, missed.map((m) => h('li', {}, m)))) : h('p.body', {}, t('Nothing slipped this time.')),
      dump.saved ? h('p.small', { role: 'status' }, t('Added to Review.')) : null,
      h('div.row', {}, missed.length && !dump.saved ? add : null, again),
    ];
    // replaceChildren would print a missing item as the word "null".
    dumpBox.replaceChildren(...result.filter(Boolean));
  }

  const redraw = () => drawTimer();
  window.addEventListener('focus-change', redraw);
  drawDump();
  drawTimer();
  page.append(
    h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, t('Study tools')), h('h1.h1', {}, t('Other ways to study.')))),
    h('div.tools', {}, dumpBox, timerBox),
  );
  return () => window.removeEventListener('focus-change', redraw);
}
