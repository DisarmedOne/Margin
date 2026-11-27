// Small DOM, text, icon and sound helpers shared by every view.
import { t, tn, getLang } from './i18n.js';

// Copy shown when entering or managing a key for each provider.
export const PROVIDER_COPY = {
  anthropic: {
    option: 'Anthropic (Claude)',
    keyLabel: 'Anthropic API key',
    placeholder: 'sk-ant-api03-…',
    console: 'Get a key from the Anthropic Console',
    note: 'Margin uses Claude Opus 5.5. Your Anthropic account is charged for what Margin sends and receives.',
  },
  gemini: {
    option: 'Google Gemini',
    keyLabel: 'Gemini API key',
    placeholder: 'AIza…',
    console: 'Get a key from Google AI Studio',
    note: 'Margin uses Gemini 4 Hydrogen. Google may charge you. In the EEA, Switzerland and the UK, Google’s terms require its paid service for apps like this. You must be 18 or over.',
  },
  openai: {
    option: 'OpenAI',
    keyLabel: 'OpenAI API key',
    placeholder: 'sk-proj-…',
    console: 'Get a key from the OpenAI dashboard',
    note: 'Margin uses GPT-6.2 Sol. Your OpenAI account is charged for what Margin sends and receives.',
  },
};

// Short name of the model family writing levels, for status copy ("Gemini is reading it").
export const aiName = (S) => ({ anthropic: 'Claude', gemini: 'Gemini', openai: 'GPT' })[S.key?.provider] ?? t('The AI');

export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'html') el.innerHTML = v; // only ever used with the static icon strings below
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Shown while the AI works, so a wait teaches something too.
export const TIPS = [
  'Trying to recall something strengthens it more than reading it again. That is why every level asks before it tells.',
  'A wrong guess before learning still helps: it makes the right answer stick when it arrives.',
  'Mistakes you were sure about are corrected more strongly than ones you guessed. Researchers call it the hypercorrection effect.',
  'Spacing reviews out beats cramming, even when cramming feels more productive.',
  'Explaining an idea in your own words shows you exactly which part you do not understand yet.',
  'Mixing topics in one session feels harder but leads to better long-term memory than one topic at a time.',
  'Feeling fluent while reading is a poor sign of what you will remember next week.',
  'Short sessions on more days beat one long session. Your streak is doing real work.',
  'Sleep after studying helps lock memories in. A level before bed is not a bad idea.',
  'Questions that make you work a little harder lead to stronger memories. Researchers call these desirable difficulties.',
  'Connecting a new idea to something you already know gives memory more ways to find it again.',
  'Rating your confidence makes you notice what you actually know, not what feels familiar.',
];

export function tipRotator() {
  const el = h('p.tip', {}, '');
  let i = Math.floor(Math.random() * TIPS.length);
  const show = () => {
    el.classList.remove('in');
    void el.offsetWidth;
    el.textContent = t(TIPS[i++ % TIPS.length]);
    el.classList.add('in');
  };
  show();
  const timer = setInterval(show, 7000);
  return { el: h('div.tipbox', {}, h('p.label', {}, t('While you wait')), el), stop: () => clearInterval(timer) };
}

// Model text with the ** markers removed, for titles, questions and options where a highlight would give answers away.
export const plain = (text = '') => String(text).replace(/\*\*/g, '');

// Turns **term** into a highlighted span. Everything else stays plain text.
export function rich(text = '') {
  const frag = document.createDocumentFragment();
  String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(h('span.term', {}, part.slice(2, -2)));
      else if (part) frag.append(document.createTextNode(part.replace(/\*\*/g, '')));
    });
  return frag;
}

const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" ${extra}>${body}</svg>`;

export const icon = {
  library: svg('<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5 1-4 15-3.5-1"/>'),
  review: svg('<rect x="3" y="7" width="14" height="13"/><path d="M7 4h14v13"/>'),
  progress: svg('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><rect x="14" y="5" width="4" height="4"/><rect x="8" y="15" width="4" height="4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  flame: svg('<path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.2 2.3-5 3.5-7.5.6 1.6 1.5 2.5 2.5 3 0-3 1-5.5 3.5-7.5-.3 3 3.5 5.8 3.5 11 0 4-2.5 7-6.5 7z"/>'),
  retry: svg('<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/>'),
  folder: svg('<path d="M3 6h7l2 2h9v11H3z"/>'),
};

export function iconEl(name, cls = '') {
  const svgEl = h('span', { html: icon[name] }).firstElementChild;
  if (cls) svgEl.setAttribute('class', cls);
  return svgEl;
}

export function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return t('just now');
  const m = Math.round(s / 60);
  if (m < 60) return tn(m, '{n} min ago|{n} min ago');
  const hr = Math.round(m / 60);
  if (hr < 24) return tn(hr, '{n} hour ago|{n} hours ago');
  const d = Math.round(hr / 24);
  if (d === 1) return t('yesterday');
  if (d < 7) return tn(d, '{n} day ago|{n} days ago');
  return new Date(ts).toLocaleDateString(getLang(), { day: 'numeric', month: 'short' });
}

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  const time = d.toLocaleTimeString(getLang(), { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return t('today at {time}', { time });
  if (d.toDateString() === tomorrow.toDateString()) return t('tomorrow at {time}', { time });
  return d.toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' });
}

let toastTimer;
export function toast(message) {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// Quiet synthesized cues. No audio files to ship.
let ctx;
let soundOn = true;
export function setSound(on) {
  soundOn = on;
}
function tone(freq, start, dur, type = 'sine', gain = 0.06) {
  ctx ??= new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
export const sound = {
  right: () => soundOn && (tone(660, 0, 0.12), tone(990, 0.07, 0.18)),
  wrong: () => soundOn && tone(196, 0, 0.22, 'triangle', 0.07),
  bonus: () => soundOn && [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.05, 0.16, 'sine', 0.045)),
  done: () => soundOn && [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.32, 'sine', 0.05)),
  flip: () => soundOn && tone(440, 0, 0.06, 'sine', 0.03),
};

// Unwraps { ok, data } from the main process; throws a plain Error with a readable message.
export async function api(promise) {
  const r = await promise;
  if (!r.ok) {
    // Errors carry their English template and values so they can be shown in the chosen language.
    const e = new Error(r.error.tkey ? t(r.error.tkey, r.error.vars) : r.error.message);
    e.code = r.error.code;
    throw e;
  }
  return r.data;
}
