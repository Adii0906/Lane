// Guest identity. A random UUID that survives refreshes so a future account system can claim it.
import { NICKNAME_MAX, NICKNAME_MIN } from '@shared/constants.js';

const ID_KEY = 'lane.playerId';
const NAME_KEY = 'lane.nickname';
const HOST_TOKEN_PREFIX = 'lane.hostToken.';
const ROOM_SESSION_PREFIX = 'lane.roomSession.';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: identity lasts for this tab only */
  }
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let cachedId = null;
export function getPlayerId() {
  if (cachedId) return cachedId;
  let id = safeGet(ID_KEY);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = uuid();
    safeSet(ID_KEY, id);
  }
  cachedId = id;
  return id;
}

export const getNickname = () => safeGet(NAME_KEY) ?? '';
export const saveNickname = (name) => safeSet(NAME_KEY, name);
export const getHostToken = (roomId) => safeGet(`${HOST_TOKEN_PREFIX}${roomId}`);
export const saveHostToken = (roomId, token) => safeSet(`${HOST_TOKEN_PREFIX}${roomId}`, token);
export const getRoomSessionToken = (roomId) => safeGet(`${ROOM_SESSION_PREFIX}${roomId}`);
export const saveRoomSessionToken = (roomId, token) => safeSet(`${ROOM_SESSION_PREFIX}${roomId}`, token);

/** Mirrors the server sanitizer closely enough for instant feedback. The server still decides. */
export function cleanNickname(raw) {
  return raw.replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
}

export function nicknameError(raw) {
  const len = Array.from(cleanNickname(raw)).length;
  if (len < NICKNAME_MIN) return `At least ${NICKNAME_MIN} characters`;
  if (len > NICKNAME_MAX) return `At most ${NICKNAME_MAX} characters`;
  return null;
}
