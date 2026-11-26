// Built-in translations. English strings are the keys; locales/<code>.js maps them to translations.
// Plural keys are written "one form|other form" and may map to an object of Intl.PluralRules categories.
let lang = 'en';
let dict = {};

export async function setLang(code) {
  if (code && code !== 'en') {
    try {
      dict = (await import(`./locales/${code}.js`)).default;
      lang = code;
    } catch {
      dict = {};
      lang = 'en';
    }
  } else {
    dict = {};
    lang = 'en';
  }
  document.documentElement.lang = lang;
}

export const getLang = () => lang;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);

export function t(key, vars) {
  const s = dict[key];
  return fill(typeof s === 'string' ? s : key, vars);
}

export function tn(n, key, vars) {
  const entry = dict[key];
  let s;
  if (entry && typeof entry === 'object') s = entry[new Intl.PluralRules(lang).select(n)] ?? entry.other;
  else if (typeof entry === 'string') s = entry;
  else {
    const [one, other] = key.split('|');
    s = n === 1 ? one : other;
  }
  return fill(s, { n: n.toLocaleString(lang), ...vars });
}
