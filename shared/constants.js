// Shared game constants. Imported by both /server and /client so the rules can never drift.

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  COUNTDOWN: 'COUNTDOWN',
  RACING: 'RACING',
  RESULTS: 'RESULTS',
});

export const ROLE = Object.freeze({
  RACER: 'racer',
  SPECTATOR: 'spectator',
});

export const MAX_RACERS = 3;
export const MIN_RACERS = 2;

export const DURATIONS = Object.freeze([30, 60, 90, 120]);
export const DEFAULT_DURATION = 60;

// No 0/O/1/I so codes survive being read aloud or typed from a screenshot.
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{4}$/;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CAR_COLORS = Object.freeze([
  { id: 'coral', hex: '#FF5A3C' },
  { id: 'teal', hex: '#2EC4B6' },
  { id: 'amber', hex: '#FFC93C' },
]);

// Timing (milliseconds unless noted)
export const COUNTDOWN_MS = 3000;
export const COUNTDOWN_LEAD_MS = 400; // network headroom so "3" is visible for a full second everywhere
export const GO_FLASH_MS = 800;
export const RECONNECT_GRACE_MS = 15000;
export const ROOM_IDLE_MS = 10 * 60 * 1000;
export const PROGRESS_INTERVAL_MS = 150;
export const RACE_UPDATE_INTERVAL_MS = 100;
export const SAMPLE_INTERVAL_MS = 1000;
export const ROLLING_WINDOW_MS = 4000;

// Anti-cheat
export const MAX_WPM = 300;
export const MAX_CHARS_PER_TICK = 15;
export const WPM_CHECK_MIN_ELAPSED_MS = 3000; // avoid false positives on the first few keystrokes

// Characters allowed in passages: easy on every mobile keyboard's first two pages.
export const PASSAGE_CHARSET = /^[A-Za-z0-9 .,;:'"!?\-()/]+$/;

export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  INVALID_NICKNAME: 'INVALID_NICKNAME',
  INVALID_PHASE: 'INVALID_PHASE',
  NOT_HOST: 'NOT_HOST',
  NOT_RACER: 'NOT_RACER',
  PROGRESS_REJECTED: 'PROGRESS_REJECTED',
  SESSION_REPLACED: 'SESSION_REPLACED',
  SERVER_BUSY: 'SERVER_BUSY',
  INTERNAL: 'INTERNAL',
});
