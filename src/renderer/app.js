import { h, iconEl, api, toast, setSound, plain, sound } from './ui.js';
import { t, tn, setLang } from './i18n.js';
import welcome from './views/welcome.js';
import library from './views/library.js';
import paper from './views/paper.js';
import level from './views/level.js';
import review from './views/review.js';
import progress from './views/progress.js';
import settings from './views/settings.js';
import exams from './views/exams.js';
import signin from './views/signin.js';
import add from './views/add.js';
import practice from './views/practice.js';
import { timer } from './focus.js';
import groups from './views/groups.js';
import cards from './views/cards.js';

const views = { add, practice, welcome, library, paper, level, review, progress, settings, exams, signin, groups, cards };
const FOCUS = new Set(['signin', 'welcome', 'level']);

const S = { settings: null, key: null, profile: null, papers: [], providers: {}, languages: {}, route: { name: 'library' } };
let cleanup = null;

const todayXp = (p) => p?.daily?.[p.today] || 0;

const ctx = {
  go(route) {
    S.route = route;
    render();
  },
  // The first screen once signed in, or after "Not now".
  enter() {
    ctx.go({ name: S.key.set ? 'library' : 'welcome' });
  },
  async refreshProfile() {
    S.profile = await api(window.margin.profile());
    renderSidebar();
  },
  setProfile(p) {
    const goal = S.settings.dailyGoal;
    const before = todayXp(S.profile);
    S.profile = p;
    renderSidebar();
    if (before < goal && todayXp(p) >= goal) {
      sound.bonus();
      toast(t('Daily goal reached: {goal} XP. See you tomorrow, or keep going.', { goal }));
    }
  },
  applySettings(s) {
    S.settings = s;
    if (S.profile) renderSidebar();
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = s.theme;
    const reduce = s.motion === 'reduced' || (s.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    root.classList.toggle('reduce-motion', reduce);
    root.dataset.size = s.readingSize || 'm';
    setSound(s.sound);
  },
  // Switching language reloads the strings, then redraws the whole window in place.
  async setLanguage(code) {
    await setLang(code);
    translateStatic();
    render();
  },
  upsertPaper(p) {
    const i = S.papers.findIndex((x) => x.id === p.id);
    if (i >= 0) S.papers[i] = p;
    else S.papers.unshift(p);
  },
  // Dropped files go to the upload walkthrough.
  addFiles(paths) {
    ctx.go({ name: 'add', paths });
  },
  async removePaper(id) {
    ctx.setProfile(await api(window.margin.removePaper(id)));
    S.papers = S.papers.filter((p) => p.id !== id);
    ctx.go({ name: 'library' });
  },
  addPaper() {
    ctx.go({ name: 'add' });
  },
};

function render() {
  // Checked here, in one place: nothing opens until someone has signed in or chosen "Not now".
  if (!S.account && !S.guest) S.route = { name: 'signin' };
  const swap = () => {
    cleanup?.();
    cleanup = null;
    const view = document.getElementById('view');
    view.replaceChildren();
    view.scrollTop = 0;
    document.getElementById('shell').classList.toggle('focus', FOCUS.has(S.route.name));
    renderSidebar();
    checkPlan();
    cleanup = views[S.route.name](view, S, ctx) || null;
  };
  // Cross-fade between pages instead of snapping; the sidebar stays put (see ::view-transition in styles.css).
  const animate = document.startViewTransition && !document.documentElement.classList.contains('reduce-motion');
  if (animate) document.startViewTransition(swap);
  else swap();
}

// Asked again only when the signed-in account changes.
let planFor = null;
function checkPlan() {
  const who = S.account?.email ?? '';
  if (who === planFor) return;
  planFor = who;
  const had = S.unlimited;
  S.unlimited = false;
  if (had) renderSidebar();
  if (!who) return;
  window.margin.paperUsage().then((r) => {
    if (planFor !== who || !r.ok || !r.data.unlimited) return;
    S.unlimited = true;
    renderSidebar();
  });
}

function renderSidebar() {
  const side = document.getElementById('sidebar');
  if (!S.profile) return;
  const p = S.profile;
  const navItem = (name, label, ic, count) =>
    h(
      'button',
      {
        'aria-current': S.route.name === name || (name === 'library' && (S.route.name === 'paper' || S.route.name === 'add')) || (name === 'review' && S.route.name === 'cards') ? 'page' : null,
        onclick: () => ctx.go({ name }),
      },
      iconEl(ic),
      label,
      count ? h('span.count', {}, count > 99 ? '99+' : count) : null,
    );

  const span = p.rank.next ? p.rank.next.xp - p.rank.floor : 1;
  const into = p.rank.next ? (p.xp - p.rank.floor) / span : 1;
  const goal = S.settings.dailyGoal || 60;
  const today = todayXp(p);
  const met = today >= goal;

  side.replaceChildren(
    h('div.wordmark', {}, h('b', {}, 'Margin'), h('i'), h('span.ver', {}, 'v' + S.version)),
    h(
      'nav.nav',
      { 'aria-label': t('Main') },
      navItem('library', t('Library'), 'library'),
      navItem('review', t('Review'), 'review', p.due),
      navItem('exams', t('Exams'), 'exams'),
      navItem('practice', t('Study tools'), 'timer'),
      navItem('groups', t('Groups'), 'groups'),
      navItem('progress', t('Progress'), 'progress'),
      navItem('settings', t('Settings'), 'settings'),
    ),
    h(
      'div.sidecard',
      {},
      // Shown while the focus timer runs; leads back to it.
      timer.state.phase === 'idle'
        ? null
        : h(
            'button.focuschip',
            { type: 'button', onclick: () => ctx.go({ name: 'practice' }) },
            h('span', {}, timer.state.left !== null ? t('Paused') : timer.state.phase === 'break' ? t('Break') : t('Focusing')),
            h('b', { 'data-focus-time': '' }, timer.left()),
          ),
      // Everyone is on the free plan until paid plans exist, except accounts without a limit.
      S.unlimited ? null : h(
        'div.plan',
        {},
        h('span.label', {}, t('Free plan')),
        h('button.btn.sm', { type: 'button', onclick: () => window.margin.openPricing() }, t('Upgrade')),
      ),
      h(
        `div.goal${met ? '.met' : ''}`,
        { title: met ? t('Daily goal reached') : t("{n} XP to today's goal", { n: goal - today }) },
        h('div.row', {}, h('span.label', {}, t('Today')), h('span.num.small', {}, met ? t('{n} XP · goal met', { n: today }) : `${today} / ${goal} XP`)),
        h('div.track', {}, h('i', { style: `width:${Math.min(100, Math.round((today / goal) * 100))}%` })),
      ),
      h('p.label', { style: 'margin-top: var(--s3)' }, t('Rank')),
      h('p.rank', {}, t(p.rank.name)),
      h(
        'div.track',
        { title: p.rank.next ? t('{n} XP to {rank}', { n: p.rank.next.xp - p.xp, rank: t(p.rank.next.name) }) : t('Top rank') },
        h('i', { style: `width:${Math.round(into * 100)}%` }),
      ),
      h(
        'div.row',
        {},
        h('span.num.small', {}, `${p.xp.toLocaleString()} XP`),
        h(
          `span.streak${p.streak ? '' : '.cold'}`,
          { title: p.streak ? tn(p.streak, '{n}-day streak|{n}-day streak') : t('Finish a level or a review today to start a streak') },
          iconEl('flame'),
          p.streak ? tn(p.streak, '{n} day|{n} days') : t('No streak'),
        ),
      ),
    ),
  );
}

function wireDragDrop() {
  let depth = 0;
  const allowed = () => S.key?.set && !FOCUS.has(S.route.name);
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (!allowed()) return;
    depth++;
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dropping');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    if (!allowed()) return;
    const paths = [...e.dataTransfer.files].map((f) => window.margin.pathForFile(f)).filter(Boolean);
    if (paths.length) ctx.addFiles(paths);
  });
}

// Shown once a new version has downloaded. A native <dialog> gives focus trapping and Esc (= Later).
function showUpdate({ version, current }) {
  if (document.querySelector('.update')) return;
  const dialog = h(
    'dialog.update',
    {
      'aria-labelledby': 'update-title',
      // Keeps level and review shortcuts from reacting to keys meant for this prompt.
      onkeydown: (e) => e.stopPropagation(),
      onclose: () => dialog.remove(),
    },
    h('p.label', {}, t('Update ready')),
    h('h2.h2', { id: 'update-title' }, t('Margin {version} is ready', { version })),
    h('p.body', {}, t('Restart now to update, or choose Later and it installs when you close Margin. Your papers and progress stay as they are.')),
    h('p.update-ver', {}, h('span', {}, 'v' + current), h('i'), h('b', {}, 'v' + version)),
    h(
      'div.update-actions',
      {},
      h('button.btn', { onclick: () => api(window.margin.installUpdate()).catch((e) => toast(e.message)) }, t('Restart now')),
      // Focus starts here, so a stray Enter cannot restart the app in the middle of a level.
      h('button.btn.ghost', { autofocus: true, onclick: () => dialog.close() }, t('Later')),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
}

function translateStatic() {
  document.querySelector('.drop-overlay .label').textContent = t('Drop to add');
  document.querySelector('.drop-overlay .h2').textContent = t('Let go of the file anywhere');
}

async function boot() {
  const data = await api(window.margin.boot());
  Object.assign(S, data);
  await setLang(data.settings.language);
  ctx.applySettings(data.settings);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => ctx.applySettings(S.settings));

  window.margin.onPaper((p) => {
    const before = S.papers.find((x) => x.id === p.id);
    ctx.upsertPaper(p);
    const r = S.route;
    if (r.name === 'library' || (r.name === 'paper' && r.id === p.id)) render();
    else if (before?.status === 'reading' && p.status === 'ready') toast(t('"{title}" is ready to study.', { title: plain(p.outline.title) }));
    else if (before?.status === 'reading' && p.status === 'error') toast(t('Could not read {file}.', { file: p.fileName }));
  });

  wireDragDrop();
  window.addEventListener('focus-change', renderSidebar);
  setInterval(() => {
    const event = timer.tick();
    if (event) {
      sound.done();
      toast(event === 'break' ? t('25 minutes done. Take a 5 minute break.') : t('Break over. Start the next round when you are ready.'));
      window.dispatchEvent(new Event('focus-change'));
    } else if (timer.state.phase !== 'idle') {
      for (const el of document.querySelectorAll('[data-focus-time]')) el.textContent = timer.left();
    }
  }, 500);
  translateStatic();
  ctx.enter();
  window.margin.onUpdate(showUpdate);
  // A clicked reminder opens Review, but never pulls someone out of a level or a practice test.
  window.margin.onOpenReview(() => !['level', 'exams'].includes(S.route.name) && ctx.go({ name: 'review' }));
}

boot().catch((e) => {
  document.getElementById('view').replaceChildren(
    h('div.page', {}, h('p.label', {}, t('Startup error')), h('h1.h1', {}, t('Margin could not start.')), h('p.body', {}, e.message)),
  );
});
