// Spaced repetition (SM-2 variant) plus rank and streak helpers. Pure functions, no Electron.
const MIN = 60e3;
const DAY = 864e5;

// rating: 0 Again, 1 Hard, 2 Good, 3 Easy
function schedule(card, rating, now = Date.now()) {
  let ease = card.ease ?? 2.5;
  let interval = card.interval ?? 0; // days
  let reps = card.reps ?? 0;
  let due;

  if (rating === 0) {
    reps = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
    due = now + 10 * MIN;
  } else {
    reps += 1;
    if (reps === 1) interval = rating === 3 ? 4 : 1;
    else if (reps === 2) interval = rating === 1 ? 3 : rating === 3 ? 8 : 6;
    else {
      const factor = rating === 1 ? 1.2 : rating === 3 ? ease * 1.3 : ease;
      interval = Math.max(interval + 1, Math.round(interval * factor));
    }
    if (rating === 1) ease = Math.max(1.3, ease - 0.15);
    if (rating === 3) ease += 0.15;
    due = now + interval * DAY;
  }
  return { ...card, ease, interval, reps, due, lastReviewed: now };
}

// Human label for when a card would come back, per rating.
function preview(card, now = Date.now()) {
  return [0, 1, 2, 3].map((r) => formatWait(schedule(card, r, now).due - now));
}

function formatWait(ms) {
  if (ms < 60 * MIN) return `${Math.round(ms / MIN)} min`;
  const days = Math.round(ms / DAY);
  if (days < 1) return `${Math.round(ms / (60 * MIN))} hr`;
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

const RANKS = [
  { name: 'Reader', xp: 0 },
  { name: 'Annotator', xp: 300 },
  { name: 'Close Reader', xp: 900 },
  { name: 'Reviewer', xp: 2000 },
  { name: 'Referee', xp: 4000 },
  { name: 'Editor', xp: 7500 },
  { name: 'Scholar', xp: 12500 },
];

function rankFor(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1] ?? null;
  return { index: i, name: RANKS[i].name, floor: RANKS[i].xp, next: next && { name: next.name, xp: next.xp } };
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Streak counts consecutive local days with at least one finished level or review.
function touchStreak(streak, now = Date.now()) {
  const today = dayKey(now);
  if (streak.last === today) return streak;
  const yesterday = dayKey(now - DAY);
  return { count: streak.last === yesterday ? streak.count + 1 : 1, last: today };
}

function liveStreak(streak, now = Date.now()) {
  return streak.last === dayKey(now) || streak.last === dayKey(now - DAY) ? streak.count : 0;
}

module.exports = { schedule, preview, formatWait, rankFor, RANKS, dayKey, touchStreak, liveStreak, DAY };
