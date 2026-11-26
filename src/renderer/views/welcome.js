import { h, api, toast, rich, PROVIDER_COPY } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { NATIVE } from './settings.js';

export default function welcome(root, S, ctx) {
  let provider = 'anthropic';
  const form = h('form.stack', { style: '--gap: var(--s3)' });
  const note = h('p.hint', { id: 'key-hint', style: 'max-width: 52ch; margin-top: var(--s2)' });

  // Anthropic is the default; "I have a different API key" reveals the provider picker.
  function drawForm(showPicker) {
    const copy = PROVIDER_COPY[provider];
    const input = h('input.input', {
      type: 'password',
      id: 'key',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: copy.placeholder,
      'aria-describedby': 'key-hint',
    });
    const error = h('p.error-text', { role: 'alert' });
    const button = h('button.btn.lg', { type: 'submit' }, t('Connect and continue'));
    const picker = showPicker
      ? h(
          'div.stack',
          { style: '--gap: var(--s3); margin-bottom: var(--s4)' },
          h('label.label', { for: 'provider' }, t('Provider')),
          h(
            'select.select',
            {
              id: 'provider',
              onchange: (e) => {
                provider = e.target.value;
                drawForm(true);
                form.querySelector('#key').focus();
              },
            },
            Object.keys(S.providers).map((id) => h('option', { value: id, selected: id === provider }, t(PROVIDER_COPY[id].option))),
          ),
        )
      : null;

    form.onsubmit = async (e) => {
      e.preventDefault();
      error.textContent = '';
      button.disabled = true;
      button.textContent = t('Checking the key…');
      try {
        S.key = await api(window.margin.setKey(provider, input.value));
        if (S.key.provider !== provider) {
          const p = S.providers[S.key.provider];
          toast(t('That is a {provider} key, so Margin will use {model}.', { provider: p.label, model: p.modelName }));
        }
        await ctx.refreshProfile();
        ctx.go({ name: 'library' });
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
        button.textContent = t('Connect and continue');
        input.focus();
      }
    };

    form.replaceChildren(
      h('div', {}, picker),
      h('label.label', { for: 'key' }, t(copy.keyLabel)),
      input,
      error,
      h('div.row', { style: 'margin-top: var(--s2); gap: var(--s5)' }, button, h('button.link', { type: 'button', onclick: () => window.margin.openConsole(provider) }, t(copy.console))),
      h(
        'div',
        { style: showPicker ? 'display:none' : '' },
        h(
          'button.link.quiet',
          {
            type: 'button',
            style: 'justify-self: start; margin-top: var(--s3)',
            onclick: () => {
              provider = 'gemini';
              drawForm(true);
              form.querySelector('#provider').focus();
            },
          },
          t('I have a different API key'),
        ),
      ),
    );
    note.textContent = `${t(copy.note)} ${t('The key is encrypted with Windows data protection and stays on this computer.')}`;
    return input;
  }
  const firstInput = drawForm(false);

  // Language can be chosen before anything else, so the whole setup reads in it.
  const langPicker = h(
    'select.select.lang-picker',
    {
      'aria-label': t('Language'),
      onchange: async (e) => {
        ctx.applySettings(await api(window.margin.setSettings({ language: e.target.value })));
        ctx.setLanguage(e.target.value);
      },
    },
    Object.keys(S.languages).map((code) => h('option', { value: code, selected: getLang() === code }, NATIVE[code])),
  );

  root.append(
    h(
      'div.welcome',
      {},
      h(
        'section.left',
        {},
        h('div.spread', { style: 'align-items: center; margin-bottom: var(--s5)' }, h('div.wordmark', { style: 'padding:0' }, h('b', {}, 'Margin'), h('i')), langPicker),
        h('h1.display', { style: 'max-width: 12ch' }, t('Study papers by playing them.')),
        h('p.lede', {}, t('Give Margin a paper. It maps the argument into a short route of chapters and turns each one into a ten-minute level: guess first, read a little, answer, explain it back.')),
        h('div', { style: 'height: var(--s4)' }),
        form,
        note,
      ),
      h(
        'aside.right',
        {},
        h('p.label', {}, t('What a level looks like')),
        h(
          'div.specimen',
          {},
          h('p.label', {}, t('Before you read · Guess')),
          h('p.h3', {}, t('Two groups study the same text. One re-reads it, the other quizzes itself. Who remembers more a week later?')),
          h(
            'div.options',
            { style: 'margin-top: var(--s2)' },
            specimenOption('1', t('The group that re-read'), ''),
            specimenOption('2', t('The group that quizzed itself'), 'right'),
            specimenOption('3', t('No real difference'), ''),
          ),
        ),
        h(
          'div.specimen',
          {},
          h('p.label', {}, t('Passage {n} of {total}', { n: 1, total: 4 })),
          h('p.h3', {}, t('Recall is the workout')),
          h('p.reading', {}, rich(t('Pulling an answer out of memory changes the memory. This is the **testing effect**, and it is why every Margin level asks before it tells.'))),
        ),
      ),
    ),
  );
  firstInput.focus();
}

function specimenOption(k, text, state) {
  return h(
    `div.option${state ? `.${state}` : ''}`,
    { style: 'cursor: default; font-size: 14px; padding: var(--s3)' },
    h('span.k', {}, k),
    h('span', {}, text),
    state === 'right' ? h('span.mark', {}, t('Correct')) : h('span'),
  );
}
