// Study groups. The rules live in the database (supabase/groups.sql); this calls its functions.
// Sent to a group: a display name the person typed, this week's XP, the streak and the last day studied.
// Never papers, lessons or the email address.
const { MarginError } = require('./ai');
const account = require('./account');
const srs = require('./srs');
const { daysUntil, validDate } = require('./exam');

// What the database says -> what the person reads. Errors are MarginError so they get translated.
function problem(kind) {
  if (kind === 'signin') return new MarginError('SIGNIN', 'Your sign-in has expired. Sign out, then sign in again.');
  if (kind === 'name') return new MarginError('GROUP', 'Names need 1 to 24 characters, and group names up to 40.');
  if (kind === 'limit') return new MarginError('GROUP', 'You can be in up to 5 groups. Leave one first.');
  if (kind === 'full') return new MarginError('GROUP', 'That group is full. A group holds 20 people.');
  if (kind === 'rate') return new MarginError('GROUP', 'Too many codes tried. Wait an hour, then try again.');
  if (kind === 'code') return new MarginError('GROUP', 'No group has that code. Check it with the person who sent it.');
  if (kind === 'owner') return new MarginError('GROUP', 'Only the person who runs the group can do that.');
  if (kind === 'off') return new MarginError('GROUP', 'Groups are not switched on yet. Try again later.');
  if (kind === 'offline') return new MarginError('OFFLINE', 'Cannot reach {name}. Check your internet connection.', { name: 'Steelfable' });
  return new MarginError('SERVER', '{name} is having trouble right now. Try again in a minute.', { name: 'Steelfable' });
}

async function rpc(name, args, token) {
  let res;
  try {
    res = await fetch(`${account.PROJECT}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: account.KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(20e3),
    });
  } catch {
    throw problem('offline');
  }
  if (res.ok) return res.status === 204 ? null : res.json();
  const body = await res.json().catch(() => null);
  const ours = /^margin:(\w+)$/.exec(body?.message ?? '');
  if (ours) throw problem(ours[1]);
  if (res.status === 401) throw problem('signin');
  if (res.status === 404) throw problem('off'); // the functions have not been created yet
  throw problem('server');
}

// The Monday that starts this week, on this computer's calendar.
function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return srs.dayKey(d.getTime());
}

function myStats(profile, now = Date.now()) {
  const week = weekStart(now);
  const today = srs.dayKey(now);
  const xp = Object.entries(profile.daily).reduce((sum, [day, n]) => (day >= week && day <= today ? sum + n : sum), 0);
  return {
    p_week: week,
    p_week_xp: Math.round(xp),
    p_streak: srs.liveStreak(profile.streak, now),
    p_active_on: profile.daily[today] > 0 ? today : profile.streak.last,
  };
}

// Numbers can be old if someone has not opened Margin lately; they are only shown while still true.
function view(groups, now = Date.now()) {
  const week = weekStart(now);
  const today = srs.dayKey(now);
  const yesterday = srs.dayKey(now - srs.DAY);
  return groups.map((g) => {
    const members = g.members.map((m) => ({
      id: m.id,
      name: m.name,
      owner: m.owner,
      me: m.me,
      weekXp: m.week === week ? m.weekXp : 0,
      streak: m.activeOn >= yesterday ? m.streak : 0, // >= covers friends whose day has already turned
      today: m.activeOn >= today,
    }));
    return { ...g, members, days: g.examDate ? daysUntil(g.examDate, now) : null, weekXp: members.reduce((sum, m) => sum + m.weekXp, 0) };
  });
}

// What an owner (or someone creating a group) typed. The database checks all of it again.
function details(input) {
  const examDate = String(input?.examDate ?? '');
  if (examDate && !validDate(examDate)) throw new MarginError('GROUP', 'Pick today or a later date.');
  return { p_name: String(input?.name ?? ''), p_exam_date: examDate || null, p_goal: Math.round(Number(input?.goal)) || 1000 };
}

// getToken() returns a current access token; getProfile() this computer's study numbers.
function client(getToken, getProfile) {
  const call = async (name, args = {}) => rpc(name, args, await getToken());
  const report = () => call('group_report', myStats(getProfile()));
  const list = async () => view(await call('groups_mine'));
  // Fresh numbers go out first, but only for someone who is already in a group.
  const refresh = async () => {
    let groups = await list();
    if (!groups.length) return groups;
    await report();
    return list();
  };
  const then = async (work) => {
    await work;
    return refresh();
  };
  return {
    report,
    list: refresh,
    create: (input) => then(call('group_create', { ...details(input), p_display: String(input?.display ?? '') })),
    join: async (code, display) => {
      const r = await call('group_join', { p_code: String(code ?? ''), p_display: String(display ?? '') });
      if (r?.error) throw problem(r.error);
      return refresh();
    },
    update: (id, input) => then(call('group_update', { p_group: id, ...details(input) })),
    rename: (id, display) => then(call('group_set_display', { p_group: id, p_display: String(display ?? '') })),
    leave: (id) => then(call('group_leave', { p_group: id })),
    removeMember: (id, member) => then(call('group_remove_member', { p_group: id, p_member: member })),
    replaceCode: (id) => then(call('group_replace_code', { p_group: id })),
    remove: (id) => then(call('group_delete', { p_group: id })),
  };
}

module.exports = { client, view, myStats, weekStart };
