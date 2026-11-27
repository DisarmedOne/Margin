import { h, iconEl, api, toast } from '../ui.js';
import { t, tn, getLang } from '../i18n.js';

const longDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(getLang(), { weekday: 'long', day: 'numeric', month: 'long' });
};
const countdown = (days) => {
  if (days < 0) return t('This exam date has passed.');
  if (days === 0) return t('Exam day');
  return tn(days, '{n} day to go|{n} days to go');
};

export default function groups(root, S, ctx) {
  const page = h('div.page');
  root.append(page);
  let alive = true;
  let list = [];

  const open = (id) => {
    S.route = { name: 'groups', id };
    show();
  };
  const adding = () => open('new');

  function show() {
    const group = list.find((g) => g.id === S.route.id);
    if (group) detail(group);
    else if (S.route.id === 'new' || !list.length) join();
    else overview();
    root.scrollTop = 0;
  }

  const head = (label, title, side) => h('header.pagehead', {}, h('div.stack', {}, h('p.label', {}, label), h('h1.h1', {}, title)), side);
  const back = () => h('button.btn.ghost.sm.back', { onclick: () => open(null) }, iconEl('back'), t('Groups'));
  const bar = (done, goal) => h('div.goalbar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(goal), 'aria-valuenow': String(Math.min(done, goal)) }, h('i', { style: `width:${Math.min(100, (done / goal) * 100)}%` }));
  const goalText = (g) => (g.weekXp >= g.weeklyGoal ? t('Weekly goal reached: {done} XP', { done: g.weekXp }) : t('{done} of {goal} XP this week', { done: g.weekXp, goal: g.weeklyGoal }));
  const field = (label, input) => h('div.field', {}, h('label.label', { for: input.id }, label), input);
  const text = (id, value, max, placeholder) => h('input.input', { type: 'text', id, value: value ?? '', maxlength: String(max), placeholder, autocomplete: 'off' });
  const nameField = (id, value) => text(id, value, 24, t('What your group sees'));

  // Runs a change with its button locked; the fresh list comes back from the same call.
  async function change(button, error, work, after) {
    if (button) button.disabled = true;
    if (error) error.textContent = '';
    try {
      list = await api(work());
      if (alive) after();
    } catch (e) {
      if (error) error.textContent = e.message;
      else toast(e.message);
      if (button) button.disabled = false;
    }
  }

  // A second click is needed for anything that cannot be undone.
  function twice(label, run) {
    let armed = false;
    const b = h(
      'button.btn.sm.ghost',
      {
        type: 'button',
        onclick: () => {
          if (armed) return run(b);
          armed = true;
          b.textContent = t('Click again to confirm');
          b.classList.replace('ghost', 'danger');
          setTimeout(() => {
            armed = false;
            b.textContent = label;
            b.classList.replace('danger', 'ghost');
          }, 3500);
        },
      },
      label,
    );
    return b;
  }

  // Said before anyone creates or joins a group.
  const shares = () =>
    h(
      'div.shares.stack',
      { style: '--gap: var(--s2)' },
      h('p.body', {}, t('Your group sees the name you choose, your XP this week, your streak and whether you studied today. It never sees your email, papers or lessons.')),
      h(
        'p.small',
        {},
        `${t('By creating or joining a group you agree to the terms.')} `,
        h('button.link.quiet', { type: 'button', onclick: () => window.margin.openTerms() }, t('Terms')),
        ' · ',
        h('button.link.quiet', { type: 'button', onclick: () => window.margin.openPrivacy() }, t('Privacy policy')),
      ),
    );

  const dateInput = (id, value) => h('input.input', { type: 'date', id, value: value ?? '', style: 'max-width: 220px' });
  const goalInput = (id, value) => h('input.input', { type: 'number', id, value: String(value ?? 1000), min: '100', max: '100000', step: '100', style: 'max-width: 160px' });

  // ---------- join or create ----------
  function join() {
    const code = text('join-code', '', 12, 'ABCD2345');
    const joinName = nameField('join-name');
    const joinErr = h('p.error-text', { role: 'alert' });
    const joinBtn = h('button.btn', { type: 'submit' }, t('Join group'));
    const name = text('group-name', '', 40, t('For example: Psychology study crew'));
    const myName = nameField('create-name');
    const date = dateInput('group-date');
    const goal = goalInput('group-goal');
    const createErr = h('p.error-text', { role: 'alert' });
    const createBtn = h('button.btn', { type: 'submit' }, t('Create group'));
    const firstOf = () => open(list.at(-1)?.id ?? null);

    page.replaceChildren(
      ...[
        list.length ? back() : null,
        head(t('Groups'), t('Study together.')),
        shares(),
        h(
          'div.groupforms',
          {},
          h(
            'form',
            {
              novalidate: true,
              onsubmit: (e) => {
                e.preventDefault();
                change(joinBtn, joinErr, () => window.margin.joinGroup(code.value, joinName.value), firstOf);
              },
            },
            h('div.section-title', {}, h('h2.h3', {}, t('Join with a code'))),
            field(t('Invite code'), code),
            field(t('Your name'), joinName),
            joinErr,
            h('div', {}, joinBtn),
          ),
          h(
            'form',
            {
              novalidate: true,
              onsubmit: (e) => {
                e.preventDefault();
                change(createBtn, createErr, () => window.margin.createGroup({ name: name.value, display: myName.value, examDate: date.value, goal: goal.value }), firstOf);
              },
            },
            h('div.section-title', {}, h('h2.h3', {}, t('Start a group'))),
            field(t('Group name'), name),
            field(t('Your name'), myName),
            field(t('Shared exam date (optional)'), date),
            field(t('Weekly XP goal for the whole group'), goal),
            createErr,
            h('div', {}, createBtn),
          ),
        ),
      ].filter(Boolean),
    );
  }

  // ---------- list ----------
  function overview() {
    page.replaceChildren(
      head(t('Groups'), t('Your groups'), h('button.btn', { onclick: adding }, iconEl('plus'), t('Add a group'))),
      h(
        'ul.examlist',
        {},
        list.map((g) =>
          h(
            'li',
            {},
            h(
              'button',
              { onclick: () => open(g.id) },
              h('span.stack', { style: '--gap: var(--s1)' }, h('span.ptitle', {}, g.name), h('span.small', {}, tn(g.members.length, '{n} member|{n} members'))),
              h('span.stack', { style: '--gap: var(--s2)' }, h('span.small', {}, goalText(g)), h('div.mini-bar', {}, h('i', { style: `width:${Math.min(100, (g.weekXp / g.weeklyGoal) * 100)}%` }))),
              h('span.label.when', {}, g.days === null ? '' : countdown(g.days)),
              iconEl('arrow', 'inline-arrow'),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- one group ----------
  function detail(g) {
    const me = g.members.find((m) => m.me);
    const copy = h(
      'button.btn.sm.secondary',
      {
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(g.code);
            toast(t('Code copied.'));
          } catch {
            toast(t('Select the code and copy it.'));
          }
        },
      },
      t('Copy'),
    );

    page.replaceChildren(
      back(),
      head(g.days === null ? t('Group') : `${countdown(g.days)} · ${longDate(g.examDate)}`, g.name, h('button.btn.secondary', { onclick: () => settings(g, me) }, g.owner ? t('Manage') : t('My name'))),
      h(
        'div.examgrid',
        {},
        h(
          'section',
          {},
          h('div.section-title', {}, h('h2.h3', {}, t('This week together')), h('span.small', {}, goalText(g))),
          bar(g.weekXp, g.weeklyGoal),
          h(
            'table.members',
            { style: 'margin-top: var(--s6)' },
            h('thead', {}, h('tr', {}, h('th.label', {}, t('Member')), h('th.label', {}, t('Today')), h('th.label.num', {}, t('Streak')), h('th.label.num', {}, t('XP this week')))),
            h(
              'tbody',
              {},
              // Listed by name, not ranked: the goal is shared.
              g.members.map((m) =>
                h(
                  'tr',
                  {},
                  h('td.who', {}, m.name, m.me ? h('span.small', {}, ` · ${t('you')}`) : null),
                  h('td.small', {}, h(`i.dot${m.today ? '.on' : ''}`, { 'aria-hidden': 'true' }), m.today ? t('Studied') : t('Not yet')),
                  h('td.num', {}, String(m.streak)),
                  h('td.num', {}, String(m.weekXp)),
                ),
              ),
            ),
          ),
        ),
        h(
          'aside.next-card',
          {},
          h('p.label', {}, t('Invite code')),
          h('div.invite', {}, h('code', {}, g.code), copy),
          h('p.small', {}, t('Anyone with this code can join, so share it only with people you know.')),
          h('button.link.quiet', { onclick: () => window.margin.openSupport() }, t('Report a problem')),
        ),
      ),
      h('div.row', { style: 'margin-top: var(--s7)' }, twice(t('Leave group'), (b) => change(b, null, () => window.margin.leaveGroup(g.id), () => open(null)))),
    );
  }

  // ---------- my name, and for the owner everything else ----------
  function settings(g, me) {
    const again = () => settings(list.find((x) => x.id === g.id), list.find((x) => x.id === g.id)?.members.find((m) => m.me));
    const myName = nameField('my-name', me.name);
    const name = text('edit-name', g.name, 40);
    const date = dateInput('edit-date', g.examDate);
    const goal = goalInput('edit-goal', g.weeklyGoal);
    const err = h('p.error-text', { role: 'alert' });
    const save = h('button.btn', { type: 'submit' }, t('Save changes'));

    const form = h(
      'form.examform',
      {
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const work = async () => {
            let r = await window.margin.renameInGroup(g.id, myName.value);
            if (r.ok && g.owner) r = await window.margin.updateGroup(g.id, { name: name.value, examDate: date.value, goal: goal.value });
            return r;
          };
          change(save, err, work, () => open(g.id));
        },
      },
      field(t('Your name'), myName),
      g.owner ? [field(t('Group name'), name), field(t('Shared exam date (optional)'), date), field(t('Weekly XP goal for the whole group'), goal)] : null,
      err,
      h('div.row', {}, save, h('button.btn.ghost', { type: 'button', onclick: () => open(g.id) }, t('Cancel'))),
    );

    const owner = g.owner
      ? h(
          'div.stack',
          { style: 'margin-top: var(--s7); max-width: 560px' },
          h('div.section-title', {}, h('h2.h3', {}, t('Members'))),
          g.members
            .filter((m) => !m.me)
            .map((m) => h('div.spread', { style: 'align-items: center' }, h('span.body', {}, m.name), twice(t('Remove'), (b) => change(b, null, () => window.margin.removeGroupMember(g.id, m.id), again)))),
          h('p.small', {}, t('Removing someone also changes the invite code.')),
          h(
            'div.row',
            {},
            twice(t('New invite code'), (b) => change(b, null, () => window.margin.replaceGroupCode(g.id), () => open(g.id))),
            twice(t('Delete group'), (b) => change(b, null, () => window.margin.deleteGroup(g.id), () => open(null))),
          ),
        )
      : null;

    page.replaceChildren(...[back(), head(t('Group'), g.name), form, owner].filter(Boolean));
    root.scrollTop = 0;
  }

  const loading = () => page.replaceChildren(head(t('Groups'), t('Study together.')), h('p.status', {}, h('i.pulse'), t('Loading your groups…')));

  function load() {
    loading();
    api(window.margin.listGroups())
      .then((data) => {
        if (!alive) return;
        list = data;
        // One group opens straight away.
        if (!S.route.id && list.length === 1) S.route = { name: 'groups', id: list[0].id };
        show();
      })
      .catch((e) => {
        if (!alive) return;
        page.replaceChildren(head(t('Groups'), t('Study together.')), h('div.quiet-empty', {}, h('p.body', {}, e.message), h('button.btn', { onclick: load }, iconEl('retry'), t('Try again'))));
      });
  }
  if (S.account) load();
  else {
    page.replaceChildren(
      head(t('Groups'), t('Study together.')),
      h('div.quiet-empty', {}, h('p.body', {}, t('Sign in to use study groups.')), h('button.btn', { onclick: () => ctx.go({ name: 'signin' }) }, t('Sign in'))),
    );
  }

  return () => {
    alive = false;
  };
}
