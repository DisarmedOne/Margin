import { h, api, toast, iconEl, PROVIDER_COPY } from '../ui.js';
import { t } from '../i18n.js';

// The address a code was sent to. Kept here so leaving Settings doesn't lose the code step.
let codeSentTo = null;

export default function settings(root, S, ctx) {
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

  function accountBlock() {
    if (S.account) {
      return h(
        'div.stack',
        { style: '--gap: var(--s3)' },
        h('p.small', { style: 'color: var(--ink)' }, t('Signed in as {email}.', { email: S.account.email })),
        h(
          'div',
          {},
          h(
            'button.btn.sm.secondary',
            {
              onclick: async () => {
                try {
                  S.account = await api(window.margin.signOut());
                  toast(t('Signed out.'));
                  draw();
                } catch (e) {
                  toast(e.message);
                }
              },
            },
            t('Sign out'),
          ),
        ),
      );
    }

    const asking = !codeSentTo;
    const label = asking ? t('Email address') : t('Sign-in code');
    const input = h(
      'input.input',
      asking
        ? { type: 'email', autocomplete: 'email', placeholder: 'name@example.com', 'aria-label': label }
        : { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '12', 'aria-label': label },
    );
    const err = h('p.error-text', { role: 'alert' });
    const idle = asking ? t('Email me a code') : t('Sign in');
    const btn = h('button.btn.sm', { type: 'submit' }, idle);

    // Runs one request with the button locked, showing any problem under the field.
    const run = async (busy, work) => {
      btn.disabled = true;
      btn.textContent = busy;
      err.textContent = '';
      try {
        await work();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
        btn.textContent = idle;
      }
    };

    const submit = (e) => {
      e.preventDefault();
      if (asking) {
        run(t('Sending…'), async () => {
          codeSentTo = await api(window.margin.sendCode(input.value));
          draw();
          page.querySelector('input[autocomplete="one-time-code"]')?.focus();
        });
      } else {
        run(t('Checking…'), async () => {
          S.account = await api(window.margin.verifyCode(codeSentTo, input.value));
          codeSentTo = null;
          draw();
        });
      }
    };

    return h(
      'form.field',
      { onsubmit: submit, novalidate: true },
      asking ? null : h('p.small', { style: 'color: var(--ink)' }, t('Enter the code we sent to {email}.', { email: codeSentTo })),
      h('label.label', {}, label),
      input,
      err,
      h('div.row', {}, btn),
      asking
        ? null
        : h(
            'div.row',
            {},
            h(
              'button.link.quiet',
              {
                type: 'button',
                onclick: () =>
                  run(t('Sending…'), async () => {
                    await api(window.margin.sendCode(codeSentTo));
                    toast(t('New code sent.'));
                    draw();
                  }),
              },
              t('Send a new code'),
            ),
            h('button.link.quiet', { type: 'button', onclick: () => { codeSentTo = null; draw(); } }, t('Use a different email')),
          ),
    );
  }

  function draw() {
    page.replaceChildren(
      h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, t('Settings')), h('h1.h1', {}, t('Preferences')))),
      h(
        'div.settings',
        {},
        group(t('Account')),
        row(t('Steelfable account'), t('Optional for now. Your papers and progress stay on this computer.'), accountBlock()),
        group(t('Learning')),
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
        group(t('Look and feel')),
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
        group(t('AI and data')),
        row(t('AI provider'), t('Which service writes your levels. Each key is stored encrypted on this computer. Levels already written stay as they are.'), providerBlock()),
        row(
          t('Your data'),
          t('Papers, levels and progress live in a folder on this computer. Only the paper itself is sent to your AI provider, to write levels.'),
          h('div', {}, h('button.btn.sm.secondary', { onclick: () => window.margin.openData() }, iconEl('folder'), t('Open data folder'))),
        ),
        row(
          t('Model'),
          t('New levels are written by this model.'),
          h('p.num.small', { style: 'color: var(--ink)' }, `${S.providers[S.key.provider].modelName} · ${S.providers[S.key.provider].model}`),
        ),
        h('p.small.num.muted', {}, `Margin ${S.version}`),
      ),
    );
  }

  draw();
}

// Each language named in itself, so people can find their own.
export const NATIVE = {
  en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', nl: 'Nederlands', pt: 'Português', it: 'Italiano', ru: 'Русский',
  zh: '中文（简体）', ja: '日本語', ko: '한국어', ar: 'العربية', hi: 'हिन्दी', tr: 'Türkçe', pl: 'Polski',
};

const group = (title) => h('p.label.setting-group', {}, title);

const row = (title, hint, control) => h('section.setting', {}, h('div.stack', {}, h('h3', {}, title), h('p.small', {}, hint)), h('div', {}, control));
