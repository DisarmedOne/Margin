import { h, api, toast } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { NATIVE } from './settings.js';
import { specimens } from './welcome.js';

// The address a code was sent to. Kept here so redrawing the screen doesn't lose the code step.
let codeSentTo = null;
// null, 'browser' (waiting for the user over there) or 'connecting' (fetching the session).
let googleStep = null;

// The age box starts unticked. Kept here so redrawing the screen doesn't clear it.
let adult = false;

// Shown first until someone signs in or chooses "Not now". Signing in is also how an account is created.
export default function signin(root, S, ctx) {
  const holder = h('div', { style: 'max-width: 420px' });

  const skip = h(
    'button.link.quiet',
    {
      type: 'button',
      onclick: async () => {
        if (!adult) return;
        try {
          S.guest = await api(window.margin.skipSignIn());
          ctx.enter();
        } catch (e) {
          toast(e.message);
        }
      },
    },
    t('Not now'),
  );
  const ageBox = h('input', {
    type: 'checkbox',
    onchange: (e) => {
      adult = e.target.checked;
      lock();
    },
  });
  ageBox.checked = adult;
  // Signing in and "Not now" both wait for the age box.
  const lock = () => {
    for (const b of [...holder.querySelectorAll('[data-adult]'), skip]) b.disabled = !adult;
  };

  const draw = () => {
    if (S.account) return ctx.enter();
    holder.replaceChildren(signInForm());
    lock();
  };

  async function google() {
    if (!adult) return;
    googleStep = 'browser';
    draw();
    // The wait can outlast this drawing of the screen (changing language redraws it).
    const refresh = () => {
      if (holder.isConnected) draw();
      else if (S.route.name === 'signin') ctx.go(S.route);
    };
    window.margin.onGoogleReturn(() => {
      googleStep = 'connecting';
      refresh();
    });
    try {
      S.account = await api(window.margin.signInWithGoogle());
      codeSentTo = null;
    } catch (e) {
      if (e.code !== 'CANCELLED') toast(e.message);
    }
    googleStep = null;
    refresh();
  }

  function signInForm() {
    if (googleStep === 'connecting') {
      return h('div.connecting', { role: 'status' }, h('p.small', {}, t('Connecting…')), h('div.connecting-bar', { 'aria-hidden': 'true' }, h('i')));
    }

    if (googleStep === 'browser') {
      return h(
        'div.stack',
        { style: '--gap: var(--s3)' },
        h('p.small', { style: 'color: var(--ink)', role: 'status' }, t('Finish signing in with Google in your browser.')),
        h('div', {}, h('button.btn.sm.secondary', { onclick: () => window.margin.cancelGoogle() }, t('Cancel'))),
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
    const btn = h('button.btn.sm', { type: 'submit', 'data-adult': '' }, idle);

    // Runs one request with the button locked, showing any problem under the field.
    const run = async (busy, work) => {
      btn.disabled = true;
      btn.textContent = busy;
      err.textContent = '';
      try {
        await work();
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = !adult;
        btn.textContent = idle;
      }
    };

    const submit = (e) => {
      e.preventDefault();
      if (!adult) return;
      if (asking) {
        run(t('Sending…'), async () => {
          codeSentTo = await api(window.margin.sendCode(input.value));
          draw();
          holder.querySelector('input[autocomplete="one-time-code"]')?.focus();
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
      asking ? h('div', {}, h('button.btn.sm.secondary', { type: 'button', onclick: google, 'data-adult': '' }, t('Continue with Google'))) : null,
      asking ? h('p.small', {}, t('Or use your email')) : null,
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

  draw();
  root.append(
    h(
      'div.welcome',
      {},
      h(
        'section.left',
        { style: 'padding-top: var(--s5); padding-bottom: var(--s4); gap: var(--s3)' }, // keeps "Not now" and the privacy link in view at the smallest window size
        h('div.spread', { style: 'align-items: center; margin-bottom: var(--s5)' }, h('div.wordmark', { style: 'padding:0' }, h('b', {}, 'Margin'), h('i')), langPicker),
        h('h1.h1', {}, t('Sign in to Margin')),
        h('p.lede', {}, t('A free Steelfable account is optional, except for study groups. New here? The same steps create one.')),
        h('label.agecheck', {}, ageBox, h('span', {}, t('I am 18 or older.'))),
        holder,
        h('div', {}, skip),
        // Said before anyone gives an email address.
        h(
          'p.hint',
          { style: 'max-width: 52ch' },
          `${t('For people aged 18 and over.')} ${t('Your papers and progress stay on this computer.')} `,
          h('button.link.quiet', { type: 'button', onclick: () => window.margin.openPrivacy() }, t('Privacy policy')),
        ),
      ),
      specimens(),
    ),
  );
}
