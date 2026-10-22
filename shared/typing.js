// Pure typing engine with the STALL mechanic. Used by the client input and by the test suite.
//
// Rules:
//  - A correct key advances the cursor and confirms that character (confirmed text is locked).
//  - A wrong key records one error and parks a "wrong" character at the cursor.
//  - While a wrong character is parked, every further key is ignored (the car is stalled).
//  - Backspace removes the parked wrong character. It never un-confirms correct text.

export function createTypingState(seed = {}) {
  return {
    index: seed.index ?? 0,
    wrong: null,
    keystrokes: seed.keystrokes ?? 0,
    errors: seed.errors ?? 0,
  };
}

// Mobile keyboards like to "help". Fold their substitutions back to plain ASCII.
const SUBSTITUTIONS = {
  '‘': "'", '’': "'", '‚': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '.',
};

export function normalizeChar(ch) {
  if (SUBSTITUTIONS[ch]) return SUBSTITUTIONS[ch];
  if (/\s/.test(ch)) return ' ';
  return ch;
}

export const isStalled = (state) => state.wrong !== null;
export const isFinished = (state, passage) => state.index >= passage.length;

export function typeChar(state, passage, rawCh) {
  if (isFinished(state, passage)) return { state, event: 'ignored' };
  if (isStalled(state)) return { state, event: 'blocked' };
  const ch = normalizeChar(rawCh);
  if (ch === passage[state.index]) {
    const next = { ...state, index: state.index + 1, keystrokes: state.keystrokes + 1 };
    return { state: next, event: isFinished(next, passage) ? 'finished' : 'correct' };
  }
  return {
    state: { ...state, wrong: ch, keystrokes: state.keystrokes + 1, errors: state.errors + 1 },
    event: 'error',
  };
}

export function backspace(state) {
  if (isStalled(state)) return { state: { ...state, wrong: null }, event: 'fixed' };
  return { state, event: 'locked' };
}

/** What the hidden <input> should contain for a given state. */
export function displayValue(state, passage) {
  return passage.slice(0, state.index) + (state.wrong ?? '');
}

/**
 * Reconcile a raw <input> value against the state. Works for desktop keys, mobile IME
 * insertions, and multi-character deletions alike.
 */
export function reconcileInput(state, passage, value) {
  const prev = displayValue(state, passage);
  let common = 0;
  const max = Math.min(prev.length, value.length);
  while (common < max && prev[common] === value[common]) common++;

  let next = state;
  const events = [];
  for (let i = prev.length; i > common; i--) {
    const r = backspace(next);
    next = r.state;
    events.push(r.event);
  }
  for (const ch of value.slice(common)) {
    const r = typeChar(next, passage, ch);
    next = r.state;
    events.push(r.event);
  }
  return { state: next, events };
}
