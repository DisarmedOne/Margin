import { h, iconEl, api, toast, aiName } from '../ui.js';
import { t, tn } from '../i18n.js';

const MAX_FILES = 10; // the same limit as src/main/sources.js, which enforces it

const fresh = () => ({ step: 0, goal: null, note: '', files: [], busy: false, error: '' });
// Kept here so leaving the screen, or changing language, does not lose what was chosen.
let draft = fresh();

const goals = () => [
  ['exam', t('Prepare for an exam'), t('More of what is likely to be tested.')],
  ['understand', t('Really understand it'), t('Why things work and how ideas connect.')],
  ['refresh', t('Refresh what I know'), t('The essentials and quick recall.')],
];

const size = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const why = (f) => (f.errorKey ? t(f.errorKey, f.errorVars) : f.error);

// Three short steps: the aim (optional), the files, and a last look before anything is sent.
export default function add(root, S, ctx) {
  const page = h('div.page');
  root.append(page);
  let alive = true;

  const usable = () => draft.files.filter((f) => !f.error);
  const go = (step) => {
    draft.step = step;
    draft.error = '';
    draw();
    root.scrollTop = 0;
  };

  async function addPaths(paths) {
    const known = new Set(draft.files.map((f) => f.path));
    const added = [...new Set(paths)].filter((p) => !known.has(p));
    if (!added.length) return;
    try {
      const looked = await api(window.margin.inspectFiles(added));
      draft.files.push(...looked.filter((f) => !draft.files.some((x) => x.path === f.path)));
      draft.error = '';
    } catch (e) {
      toast(e.message);
    }
    if (alive) draw();
  }

  async function choose() {
    try {
      await addPaths(await api(window.margin.pickFiles()));
    } catch (e) {
      toast(e.message);
    }
  }

  async function create() {
    if (draft.busy) return;
    const sending = draft;
    sending.busy = true;
    sending.error = '';
    draw();
    try {
      const paper = await api(window.margin.addPaper(usable().map((f) => f.path), { goal: sending.goal, note: sending.note }));
      ctx.upsertPaper(paper);
      if (draft === sending) draft = fresh();
      if (alive) ctx.go({ name: 'library' });
    } catch (e) {
      sending.busy = false;
      sending.error = e.message;
      if (alive) draw();
    }
  }

  const cancel = () => {
    draft = fresh();
    ctx.go({ name: 'library' });
  };

  const nav = (back, next) =>
    h(
      'div.row.steps-nav',
      {},
      back ? h('button.btn.secondary', { type: 'button', onclick: back, disabled: draft.busy }, iconEl('back'), t('Back')) : null,
      next,
      h('button.link.quiet', { type: 'button', onclick: cancel, disabled: draft.busy }, t('Cancel')),
    );

  function aimStep() {
    const note = h('textarea.textarea', { id: 'add-note', maxlength: '300', rows: '3', placeholder: t('For example: the test is about chapters 3 and 4.') });
    note.value = draft.note;
    const next = h('button.btn', { type: 'button', onclick: () => go(1) });
    const label = () => next.replaceChildren(draft.goal || draft.note.trim() ? t('Next') : t('Skip'), iconEl('arrow'));
    const choices = goals().map(([id, name, about]) =>
      h(
        'button.choice',
        {
          type: 'button',
          'aria-pressed': String(draft.goal === id),
          onclick: () => {
            // A second click clears the choice: this step is optional.
            draft.goal = draft.goal === id ? null : id;
            choices.forEach((b, i) => b.setAttribute('aria-pressed', String(goals()[i][0] === draft.goal)));
            label();
          },
        },
        h('b', {}, name),
        h('span', {}, about),
      ),
    );
    note.addEventListener('input', () => {
      draft.note = note.value;
      label();
    });
    label();
    return [h('div.choices', {}, choices), h('div.field', {}, h('label.label', { for: 'add-note' }, t('Anything to focus on? (optional)')), note), nav(null, next)];
  }

  function filesStep() {
    const ready = usable().length;
    const over = ready > MAX_FILES;
    return [
      h(
        'div.dropzone',
        {},
        iconEl('upload', 'icon'),
        h(
          'div.stack',
          { style: '--gap: var(--s1)' },
          h('p.h3', {}, t('Drop your files here')),
          h('p.small', {}, t('PDF, Word, PowerPoint, Excel, pictures, saved web pages and text files. Not sound or video.')),
        ),
        h('button.btn', { type: 'button', onclick: choose }, iconEl('plus'), t('Choose files')),
      ),
      draft.files.length
        ? h(
            'ul.filelist',
            {},
            draft.files.map((f) =>
              h(
                `li${f.error ? '.bad' : ''}`,
                {},
                iconEl('doc'),
                h('div', {}, h('b', {}, f.name), h('span', {}, f.error ? why(f) : size(f.size))),
                h(
                  'button.btn.sm.ghost',
                  {
                    type: 'button',
                    'aria-label': `${t('Remove')} ${f.name}`,
                    onclick: () => {
                      draft.files = draft.files.filter((x) => x !== f);
                      draft.error = '';
                      draw();
                    },
                  },
                  t('Remove'),
                ),
              ),
            ),
          )
        : null,
      h('p.small', {}, t('Up to {max} files. PDFs and pictures together up to 20 MB. From Word, PowerPoint, Excel and web pages, only the text is read.', { max: MAX_FILES })),
      over ? h('p.error-text', { role: 'alert' }, t('Add up to {max} files at a time.', { max: MAX_FILES })) : null,
      nav(() => go(0), h('button.btn', { type: 'button', onclick: () => go(2), disabled: !ready || over }, t('Next'), iconEl('arrow'))),
    ];
  }

  function checkStep() {
    const files = usable();
    const skipped = draft.files.length - files.length;
    const aim = goals().find(([id]) => id === draft.goal)?.[1];
    const fact = (name, value) => h('div', {}, h('dt', {}, name), h('dd', {}, value));
    return [
      h(
        'dl.summary',
        {},
        fact(t('Your aim'), aim || t('Not chosen')),
        draft.note.trim() ? fact(t('Focus'), draft.note.trim()) : null,
        fact(t('Files'), h('ul', {}, files.map((f) => h('li', {}, f.name)))),
      ),
      skipped ? h('p.small', {}, tn(skipped, '{n} file cannot be used and is left out.|{n} files cannot be used and are left out.')) : null,
      h('p.body', {}, t('These files become one paper and use one of your places.')),
      h(
        'p.small',
        {},
        t('What is read from these files, including pictures, is sent to {ai}. Leave out names, grades and anything private. Larger sets cost more of your AI credit.', { ai: aiName(S) }),
      ),
      draft.error ? h('p.error-text', { role: 'alert' }, draft.error) : null,
      nav(
        () => go(1),
        h('button.btn.lg', { type: 'button', onclick: create, disabled: draft.busy }, draft.busy ? t('Adding…') : t('Make my lessons')),
      ),
    ];
  }

  function draw() {
    if (draft.step === 2 && !usable().length) draft.step = 1;
    const [title, content] = [
      [t('What are you trying to do?'), aimStep],
      [t('Add your material'), filesStep],
      [t('Ready?'), checkStep],
    ][draft.step];
    page.replaceChildren(
      h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, t('New paper · step {n} of 3', { n: draft.step + 1 })), h('h1.h1', {}, title))),
      h('div.walkthrough', {}, content()),
    );
  }

  // Files dropped on the window arrive with the route, and are taken from it once.
  const dropped = S.route.paths;
  if (dropped) {
    delete S.route.paths;
    if (!draft.busy) draft.step = 1;
  }
  draw();
  if (dropped && !draft.busy) addPaths(dropped);

  return () => {
    alive = false;
  };
}
