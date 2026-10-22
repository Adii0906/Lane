// Metric definitions. The server is authoritative; the client only uses these for display math.
//
//   correct chars   = characters confirmed correct, counted by position in the passage
//   net WPM         = (correct chars / 5) / elapsed minutes
//   raw WPM         = (total keystrokes / 5) / elapsed minutes
//   accuracy        = correct keystrokes / total keystrokes   (0 when nothing was typed)
//   speedometer WPM = net WPM over a rolling ROLLING_WINDOW_MS window

import { ROLLING_WINDOW_MS } from './constants.js';

const MS_PER_MIN = 60000;

export function netWpm(correctChars, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  return correctChars / 5 / (elapsedMs / MS_PER_MIN);
}

export function rawWpm(keystrokes, elapsedMs) {
  if (elapsedMs <= 0) return 0;
  return keystrokes / 5 / (elapsedMs / MS_PER_MIN);
}

export function accuracy(correctKeystrokes, totalKeystrokes) {
  if (totalKeystrokes <= 0) return 0;
  return Math.max(0, Math.min(1, correctKeystrokes / totalKeystrokes));
}

/**
 * Rolling WPM from a history of { t, i } samples (time ms, correct index), oldest first.
 * The span is floored at 1s so the first keystrokes do not spike the needle.
 */
export function rollingWpm(history, nowMs, windowMs = ROLLING_WINDOW_MS) {
  if (!history.length) return 0;
  const boundary = nowMs - windowMs;
  let base = history[0];
  for (const sample of history) {
    if (sample.t <= boundary) base = sample;
    else break;
  }
  const latest = history[history.length - 1];
  const span = Math.max(1000, nowMs - base.t);
  return netWpm(latest.i - base.i, span);
}

export const round1 = (n) => Math.round(n * 10) / 10;
