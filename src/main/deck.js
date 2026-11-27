// Rules for flashcards people write or change, and for when a review reminder is due. No Electron here.
const FRONT = 300;
const BACK = 1000;

// Returns the trimmed text, or null when either side is empty.
function cardText(input) {
  const front = String(input?.front ?? '').trim().slice(0, FRONT);
  const back = String(input?.back ?? '').trim().slice(0, BACK);
  return front && back ? { front, back } : null;
}

// At most one reminder a day, and none while the learner is already looking at Margin.
const shouldRemind = ({ enabled, due, lastDay, today, focused }) => Boolean(enabled && due > 0 && !focused && lastDay !== today);

module.exports = { cardText, shouldRemind, FRONT, BACK };
