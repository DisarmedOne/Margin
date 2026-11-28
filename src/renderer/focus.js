// The focus timer (Pomodoro): 25 minutes of study, then a 5-minute break.
// Plain functions on a small state, so the rules can be tested. It lasts while Margin is open.
export const FOCUS_MS = 25 * 60e3;
export const BREAK_MS = 5 * 60e3;

export const idle = (rounds = 0) => ({ phase: 'idle', endsAt: null, left: null, rounds });
export const start = (s, now) => ({ phase: 'focus', endsAt: now + FOCUS_MS, left: null, rounds: s.rounds });
export const remaining = (s, now) => (s.phase === 'idle' ? FOCUS_MS : (s.left ?? Math.max(0, s.endsAt - now)));
export const pause = (s, now) => (s.phase === 'idle' || s.left !== null ? s : { ...s, left: remaining(s, now), endsAt: null });
export const resume = (s, now) => (s.left === null ? s : { ...s, endsAt: now + s.left, left: null });

// Moves on when time is up. `event` says what just finished.
export function tick(s, now) {
  if (s.phase === 'idle' || s.left !== null || now < s.endsAt) return { state: s, event: null };
  // The break starts now, even if the computer slept past the end of the focus time.
  if (s.phase === 'focus') return { state: { phase: 'break', endsAt: now + BREAK_MS, left: null, rounds: s.rounds + 1 }, event: 'break' };
  // The next round waits to be started.
  return { state: idle(s.rounds), event: 'done' };
}

export const minutes = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// The one timer the app shows.
export const timer = {
  state: idle(),
  start: () => (timer.state = start(timer.state, Date.now())),
  pause: () => (timer.state = pause(timer.state, Date.now())),
  resume: () => (timer.state = resume(timer.state, Date.now())),
  stop: () => (timer.state = idle(timer.state.rounds)),
  tick() {
    const { state, event } = tick(timer.state, Date.now());
    timer.state = state;
    return event;
  },
  left: () => minutes(remaining(timer.state, Date.now())),
};
