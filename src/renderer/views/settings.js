import { h, api, toast, iconEl, PROVIDER_COPY } from '../ui.js';
import { t } from '../i18n.js';

// The open section, kept so leaving Settings and coming back lands in the same place.
let tab = 'account';
// Result of the last "Check for updates", shown under the button.
let updateNote = null;

export default function settings(root, S, ctx) {
  let confirmingDelete = false;
  const page = h('div.page');
  root.append(page);

  const save = async (patch) => {
    try {
      ctx.applySettings(await api(window.margin.setSettings(patch)));
      if ('language' in patch) return ctx.setLanguage(patch.language); // redraws everything in the new language
      draw();
    } catch (e) {
      toast(e.message);
    }
  };

  const seg = (key, options) =>
    h(
      'div.seg',
      { role: 'group' },
      options.map(([value, label]) => h('button', { 'aria-pressed': String(S.settings[key] === value), onclick: () => save({ [key]: value }) }, label)),
    );

  // Provider switch: a provider with a saved key switches at once; one without opens the key form.
  function providerBlock() {
    const wrap = h('div.stack', { style: '--gap: var(--s3)' });
    const seg = h(
      'div.seg',
      { role: 'group' },
      Object.keys(S.providers).map((id) =>
        h(
          'button',
          {
            'aria-pressed': String(S.key.provider === id),
            onclick: async () => {
              if (id === S.key.provider) return;
              if (!S.key.saved[id]) return openForm(id);
              try {
                S.key = await api(window.margin.useProvider(id));
                toast(t('Now using {model}.', { model: S.providers[id].modelName }));
                draw();
              } catch (e) {
                toast(e.message);
              }
            },
          },
          S.providers[id].label,
          S.key.saved[id] ? null : h('span.muted', {}, ` · ${t('no key')}`),
        ),
      ),
    );
    const status = h(
      'p.small',
      {},
      S.key.set ? t('Using {model}. Key ends in …{last4}.', { model: S.providers[S.key.provider].modelName, last4: S.key.last4 }) : t('No key saved for this provider.'),
    );
    const change = h('button.btn.sm.secondary', { onclick: () => openForm(S.key.provider) }, S.key.set ? t('Replace key') : t('Add key'));
    wrap.append(seg, status, h('div', {}, change));

    function openForm(id) {
      const copy = PROVIDER_COPY[id];
      wrap.querySelector('form')?.remove();
      change.remove();
      const saveLabel = t('Save {provider} key', { provider: S.providers[id].label });
      const input = h('input.input', { type: 'password', placeholder: copy.placeholder, autocomplete: 'off', 'aria-label': t(copy.keyLabel) });
      const err = h('p.error-text', { role: 'alert' });
      const btn = h('button.btn.sm', { type: 'submit' }, saveLabel);
      wrap.append(
        h(
          'form.field',
          {
            onsubmit: async (e) => {
              e.preventDefault();
              btn.disabled = true;
              btn.textContent = t('Checking…');
              err.textContent = '';
              try {
                S.key = await api(window.margin.setKey(id, input.value));
                toast(t('Key saved. Now using {model}.', { model: S.providers[S.key.provider].modelName }));
                draw();
              } catch (x) {
                err.textContent = x.message;
                btn.disabled = false;
                btn.textContent = saveLabel;
              }
            },
          },
          h('label.label', {}, t(copy.keyLabel)),
          input,
          h('button.link.quiet', { type: 'button', style: 'justify-self: start', onclick: () => window.margin.openConsole(id) }, t(copy.console)),
          h('p.hint', {}, t(copy.note)),
          err,
          h('div.row', {}, btn, h('button.btn.sm.ghost', { type: 'button', onclick: draw }, t('Cancel'))),
        ),
      );
      input.focus();
    }
    return wrap;
  }

  // Deleting can't be undone, so it takes a second, clearly worded click.
  function deleteConfirm() {
    const err = h('p.error-text', { role: 'alert' });
    const cancel = h('button.btn.sm.ghost', { onclick: () => { confirmingDelete = false; draw(); } }, t('Cancel'));
    const confirm = h(
      'button.btn.sm.danger',
      {
        onclick: async () => {
          confirm.disabled = cancel.disabled = true;
          confirm.textContent = t('Deleting…');
          err.textContent = '';
          try {
            S.account = await api(window.margin.deleteAccount());
            S.guest = false;
            toast(t('Your account has been deleted.'));
            ctx.go({ name: 'signin' });
          } catch (e) {
            err.textContent = e.message;
            confirm.disabled = cancel.disabled = false;
            confirm.textContent = t('Delete my account');
          }
        },
      },
      t('Delete my account'),
    );
    return h(
      'div.stack',
      { style: '--gap: var(--s3)' },
      h('p.small', { style: 'color: var(--ink)' }, t('Signed in as {email}.', { email: S.account.email })),
      h('p.small', {}, t('This permanently deletes your Steelfable account and cannot be undone. Your papers and progress stay on this computer. A scrambled record of your email and the papers you added is kept, so the paper limit still applies.')),
      err,
      h('div.row', {}, confirm, cancel),
    );
  }

  function accountBlock() {
    if (!S.account) {
      return h(
        'div.stack',
        { style: '--gap: var(--s3)' },
        h('p.small', { style: 'color: var(--ink)' }, t('Not signed in.')),
        h('div', {}, h('button.btn.sm.secondary', { onclick: () => ctx.go({ name: 'signin' }) }, t('Sign in'))),
      );
    }
    if (confirmingDelete) return deleteConfirm();
    return h(
      'div.stack',
      { style: '--gap: var(--s3)' },
      h('p.small', { style: 'color: var(--ink)' }, t('Signed in as {email}.', { email: S.account.email })),
      h(
        'div.row',
        {},
        h(
          'button.btn.sm.secondary',
          {
            onclick: async () => {
              try {
                S.account = await api(window.margin.signOut());
                S.guest = false;
                toast(t('Signed out.'));
                ctx.go({ name: 'signin' });
              } catch (e) {
                toast(e.message);
              }
            },
          },
          t('Sign out'),
        ),
        h('button.link.quiet', { onclick: () => { confirmingDelete = true; draw(); } }, t('Delete account')),
      ),
    );
  }

  async function exportCards() {
    try {
      const n = await api(window.margin.exportCards());
      if (n !== null) toast(t('Flashcards saved: {n}', { n }));
    } catch (e) {
      toast(e.message);
    }
  }

  async function checkUpdates() {
    updateNote = t('Checking…');
    draw();
    try {
      const r = await api(window.margin.checkUpdate());
      if (r.status === 'current') updateNote = t('You have the latest version.');
      else if (r.status === 'downloading') updateNote = t('Downloading version {version}. Margin will tell you when it is ready.', r);
      else if (r.status === 'ready') updateNote = t('Margin {version} is ready', r);
      else updateNote = t('Updates only work in the installed app.');
    } catch (e) {
      updateNote = e.message;
    }
    if (page.isConnected) draw();
  }

  const button = (label, onclick, attrs = {}) => h('div', {}, h('button.btn.sm.secondary', { type: 'button', onclick, ...attrs }, label));

  const accountRows = () => [
        row(
          t('Steelfable account'),
          t('Your papers and progress stay on this computer.'),
          // Shown beside the sign-in form, so people can read it before giving an email address.
          h('div.stack', { style: '--gap: var(--s3)' }, accountBlock(), h('div', {}, h('button.link.quiet', { type: 'button', onclick: () => window.margin.openPrivacy() }, t('Privacy policy')))),
        ),
  ];

  const learningRows = () => [
        row(
          t('Language'),
          t('Menus and buttons, plus everything the AI writes: levels, questions and feedback. Levels already written stay in their language.'),
          h(
            'select.select',
            { style: 'max-width: 280px', 'aria-label': t('Language'), onchange: (e) => save({ language: e.target.value }) },
            Object.keys(S.languages).map((code) => h('option', { value: code, selected: S.settings.language === code }, NATIVE[code])),
          ),
        ),
        row(
          t('Daily goal'),
          t('XP to earn each day. The sidebar shows how close you are.'),
          seg('dailyGoal', [
            [30, `${t('Light')} · 30`],
            [60, `${t('Steady')} · 60`],
            [120, `${t('Intense')} · 120`],
          ]),
        ),
        row(
          t('Level length'),
          t('How many questions new levels have. Quick suits a short break; deep suits exam prep.'),
          seg('levelLength', [
            ['quick', `${t('Quick')} · 4`],
            ['standard', `${t('Standard')} · 6`],
            ['deep', `${t('Deep')} · 8`],
          ]),
        ),
        row(
          t('Ask how sure I am'),
          t('After each answer, rate your confidence. It sharpens memory and feeds the calibration chart, but skipping it is faster.'),
          seg('confidence', [
            [true, t('Ask')],
            [false, t('Skip')],
          ]),
        ),
        row(
          t('Auto-continue'),
          t('Move on by itself shortly after a right answer. Wrong answers always wait for you.'),
          seg('autoContinue', [
            [false, t('Off')],
            [true, t('On')],
          ]),
        ),
        row(
          t('Cards per review'),
          t('How many due cards one review session holds. The rest wait for the next one.'),
          seg('reviewSize', [
            [10, '10'],
            [30, '30'],
            [50, '50'],
          ]),
        ),
        row(
          t('Review reminder'),
          t('A Windows notification, at most once a day, when cards are due. It only works while Margin is open or minimised.'),
          seg('reminder', [
            [false, t('Off')],
            [true, t('On')],
          ]),
        ),
  ];

  const lookRows = () => [
        row(
          t('Reading size'),
          t('Text size for passages, questions and answers.'),
          seg('readingSize', [
            ['s', t('Small')],
            ['m', t('Medium')],
            ['l', t('Large')],
          ]),
        ),
        row(
          t('Theme'),
          t('Paper by day, ink by night.'),
          seg('theme', [
            ['system', t('Follow Windows')],
            ['light', t('Light theme')],
            ['dark', t('Dark theme')],
          ]),
        ),
        row(
          t('Motion'),
          t('Full gives smooth transitions between screens. Reduced keeps everything still.'),
          seg('motion', [
            ['full', t('Full')],
            ['reduced', t('Reduced')],
            ['system', t('Follow Windows')],
          ]),
        ),
        row(
          t('Sound'),
          t('Short tones for right and wrong answers.'),
          seg('sound', [
            [true, t('On')],
            [false, t('Off')],
          ]),
        ),
  ];

  const aiRows = () => [
        row(t('AI provider'), t('Which service writes your levels. Each key is stored encrypted on this computer. Levels already written stay as they are.'), providerBlock()),
        row(
          t('Your data'),
          t('Papers, levels and progress live in a folder on this computer. To write and grade lessons, your paper and written explanations are sent to your AI provider.'),
          h('div', {}, h('button.btn.sm.secondary', { onclick: () => window.margin.openData() }, iconEl('folder'), t('Open data folder'))),
        ),
        row(
          t('Model'),
          t('New levels are written by this model.'),
          h('p.num.small', { style: 'color: var(--ink)' }, `${S.providers[S.key.provider].modelName} · ${S.providers[S.key.provider].model}`),
        ),
        row(
          t('Prepare levels ahead'),
          t('Writes upcoming levels in the background so you rarely wait. Off writes each level only when you open it, so nothing is spent on chapters you skip.'),
          seg('prepareAhead', [
            [true, t('On')],
            [false, t('Off')],
          ]),
        ),
        row(
          t('Flashcards'),
          S.profile.deckSize ? t('Save your review deck as a CSV file, for Anki, a spreadsheet or a backup.') : t('No flashcards yet. Finish a level to start your deck.'),
          button(t('Export flashcards'), exportCards, { disabled: !S.profile.deckSize }),
        ),
  ];

  const aboutRows = () => [
    row(
      t('Updates'),
      t('Margin checks each time it opens. You have version {version}.', { version: S.version }),
      h('div.stack', { style: '--gap: var(--s3)' }, button(t('Check for updates'), checkUpdates), h('p.small', { role: 'status', style: 'color: var(--ink)' }, updateNote)),
    ),
    row(
      t('Help and feedback'),
      t('Something broken or confusing? Write to {email}.', { email: 'support@steelfable.com' }),
      button(t('Email support'), () => window.margin.openSupport()),
    ),
    row(t('Website'), t('News and downloads on steelfable.com.'), button(t('Open website'), () => window.margin.openWebsite())),
    row(t('Privacy policy'), t('What Steelfable and Margin collect, and how to delete it.'), button(t('Privacy policy'), () => window.margin.openPrivacy())),
    h('p.small.num.muted', {}, `Margin ${S.version}`),
  ];

  const SECTIONS = [
    ['account', t('Account'), accountRows],
    ['learning', t('Learning'), learningRows],
    ['look', t('Look and feel'), lookRows],
    ['ai', t('AI and data'), aiRows],
    ['about', t('About'), aboutRows],
  ];

  function openTab(id) {
    tab = id;
    draw();
    page.querySelector(`#tab-${id}`).focus();
  }

  // Standard tab keys: arrows move between sections, Home and End jump to the ends.
  function tabKeys(e) {
    const i = SECTIONS.findIndex(([id]) => id === tab);
    const last = SECTIONS.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    openTab(SECTIONS[next][0]);
  }

  function draw() {
    const [, , rows] = SECTIONS.find(([id]) => id === tab);
    page.replaceChildren(
      h('header.pagehead.tabbed', {}, h('div.stack', {}, h('p.label', {}, t('Settings')), h('h1.h1', {}, t('Preferences')))),
      h(
        'div.tabs',
        { role: 'tablist', 'aria-label': t('Settings'), onkeydown: tabKeys },
        SECTIONS.map(([id, label]) =>
          h(
            'button',
            { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': String(id === tab), 'aria-controls': 'tabpanel', tabindex: id === tab ? '0' : '-1', onclick: () => id !== tab && openTab(id) },
            label,
          ),
        ),
      ),
      h('div.settings', { id: 'tabpanel', role: 'tabpanel', 'aria-labelledby': `tab-${tab}` }, rows()),
    );
  }

  draw();
}

// Each language named in itself, so people can find their own.
export const NATIVE = {
  en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', nl: 'Nederlands', pt: 'Português', it: 'Italiano', ru: 'Русский',
  zh: '中文（简体）', ja: '日本語', ko: '한국어', ar: 'العربية', hi: 'हिन्दी', tr: 'Türkçe', pl: 'Polski',
};

const row = (title, hint, control) => h('section.setting', {}, h('div.stack', {}, h('h3', {}, title), h('p.small', {}, hint)), h('div', {}, control));
