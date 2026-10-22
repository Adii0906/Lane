import {
  DURATIONS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  ROOM_CODE_PATTERN,
  UUID_PATTERN,
} from '../../shared/index.js';

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Control characters, zero-width characters, line/paragraph separators, BOM.
const INVISIBLE_CHARS = new RegExp(
  '[' +
    [
      [0x00, 0x1f],
      [0x7f, 0x9f],
      [0x200b, 0x200f],
      [0x2028, 0x202f],
      [0xfeff, 0xfeff],
    ]
      .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`)
      .join('') +
    ']',
  'g',
);

export function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .normalize('NFKC')
    .replace(INVISIBLE_CHARS, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  if (chars.length < NICKNAME_MIN || chars.length > NICKNAME_MAX) return null;
  return cleaned;
}

export function parseRoomCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

export const isPlayerId = (v) => typeof v === 'string' && UUID_PATTERN.test(v);

export const isDuration = (v) => DURATIONS.includes(v);

export const isNonNegInt = (v, max = Number.MAX_SAFE_INTEGER) =>
  Number.isInteger(v) && v >= 0 && v <= max;

/** Token bucket. `take()` returns false when the socket is over its budget. */
export function createRateLimiter({ capacity, refillPerSec, now = Date.now }) {
  let tokens = capacity;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
