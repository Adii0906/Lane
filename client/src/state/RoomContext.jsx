// The single owner of the socket and all room state. Components read from here and call actions;
// they never touch the socket themselves.
//
// Two contexts on purpose:
//   RoomContext - lobby/room state and actions (changes on room events)
//   HudContext  - throttled race numbers (changes ~5x per second during a race)
// so HUD ticks never re-render the passage or the lobby.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ERROR_CODES, EVENTS, PHASE, ROLE } from '@shared/index.js';
import { getPlayerId } from '../lib/identity.js';
import { sound } from '../lib/sound.js';

const RoomContext = createContext(null);
const HudContext = createContext(null);

const HUD_THROTTLE_MS = 200;
const LEAVE_DEBOUNCE_MS = 80;

async function measureClockOffset(socket) {
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const res = await socket.timeout(2000).emitWithAck(EVENTS.TIME_SYNC, { t0 });
      const t1 = Date.now();
      const rtt = t1 - t0;
      samples.push({ rtt, offset: res.serverNow + rtt / 2 - t1 });
    } catch {
      /* lost ping: skip */
    }
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a.rtt - b.rtt);
  return samples[0].offset; // the fastest round trip has the least asymmetric delay
}

export function RoomProvider({ children }) {
  const playerId = getPlayerId();
  const socketRef = useRef(null);
  const offsetRef = useRef(0);
  const joinRef = useRef(null); // { roomId, nickname } we want to be in
  const leaveTimerRef = useRef(null);
  const raceRef = useRef({ update: null, finishes: [], local: { stalled: false } });
  const hudStampRef = useRef(0);

  const [connection, setConnection] = useState('connecting'); // connecting | connected | offline
  const [room, setRoom] = useState(null);
  const [joinStatus, setJoinStatus] = useState({ state: 'idle', error: null });
  const [notice, setNotice] = useState(null);
  const [hud, setHud] = useState(null);
  const [lastFinish, setLastFinish] = useState(null);

  const now = useCallback(() => Date.now() + offsetRef.current, []);
  const pushNotice = useCallback((text, tone = 'info') => {
    setNotice({ id: `${Date.now()}-${Math.random()}`, text, tone });
  }, []);

  const emitJoin = useCallback(
    async (target) => {
      const socket = socketRef.current;
      setJoinStatus((s) => ({ ...s, state: 'joining' }));
      let res;
      try {
        res = await socket.timeout(5000).emitWithAck(EVENTS.JOIN_ROOM, {
          roomId: target.roomId,
          playerId,
          nickname: target.nickname,
        });
      } catch {
        return; // connection dropped mid-join; the reconnect handler retries
      }
      if (joinRef.current !== target) return;
      if (!res.ok) {
        if (res.code === ERROR_CODES.ROOM_NOT_FOUND || res.code === ERROR_CODES.INVALID_NICKNAME) {
          joinRef.current = null;
        }
        setJoinStatus({ state: 'error', error: res.code });
        return;
      }
      setRoom(res.state);
      setJoinStatus({ state: 'joined', error: null });
      if (res.role === ROLE.SPECTATOR) {
        pushNotice(
          res.state.phase === PHASE.LOBBY
            ? 'This race is full. You are watching and will get a seat if one opens.'
            : 'A race is in progress. You are watching and can join the next one.',
        );
      }
    },
    [playerId, pushNotice],
  );

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
    socketRef.current = socket;

    socket.on('connect', async () => {
      setConnection('connected');
      if (joinRef.current) emitJoin(joinRef.current);
      const offset = await measureClockOffset(socket);
      if (offset !== null) offsetRef.current = offset;
    });
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));

    socket.on(EVENTS.ROOM_STATE, (state) => {
      if (!joinRef.current || state.code !== joinRef.current.roomId) return;
      setRoom(state);
    });
    socket.on(EVENTS.RACE_START, () => {
      raceRef.current.update = null;
      raceRef.current.finishes = [];
      setHud(null);
      setLastFinish(null);
    });
    socket.on(EVENTS.RACE_UPDATE, (update) => {
      raceRef.current.update = update;
      const t = performance.now();
      if (t - hudStampRef.current >= HUD_THROTTLE_MS) {
        hudStampRef.current = t;
        setHud(update);
      }
    });
    socket.on(EVENTS.PLAYER_FINISHED, (finish) => {
      raceRef.current.finishes.push(finish);
      setLastFinish(finish);
    });
    socket.on(EVENTS.COUNTDOWN_CANCEL, ({ reason }) => {
      sound.cancel();
      pushNotice(`Countdown stopped: ${reason}`, 'warn');
    });
    socket.on(EVENTS.ERROR, (err) => {
      switch (err?.code) {
        case ERROR_CODES.PROGRESS_REJECTED:
          console.warn('Progress rejected by server:', err.reason);
          break;
        case ERROR_CODES.SESSION_REPLACED:
          joinRef.current = null;
          setRoom(null);
          setJoinStatus({ state: 'error', error: ERROR_CODES.SESSION_REPLACED });
          break;
        case ERROR_CODES.ROOM_NOT_FOUND:
        case ERROR_CODES.INVALID_NICKNAME:
          break; // surfaced through the join result
        default:
          if (err?.message) pushNotice(err.message, 'warn');
      }
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [emitJoin, pushNotice]);

  // ------------------------------------------------------------------ actions

  const createRoom = useCallback(async () => {
    const res = await socketRef.current.timeout(5000).emitWithAck(EVENTS.CREATE_ROOM, { playerId });
    if (!res.ok) throw new Error(res.code);
    return res.code;
  }, [playerId]);

  const joinRoom = useCallback(
    (roomId, nickname) => {
      const current = joinRef.current;
      if (current && current.roomId === roomId && leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current); // StrictMode remount / quick navigation: keep the seat
        leaveTimerRef.current = null;
      }
      if (current && current.roomId !== roomId) {
        // Moving straight to another room ("New room"): leave the old one now, not on a debounce.
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
        socketRef.current?.emit(EVENTS.LEAVE);
      }
      if (current && current.roomId === roomId && current.nickname === nickname) return;
      if (current?.roomId !== roomId) setRoom(null);
      const target = { roomId, nickname };
      joinRef.current = target;
      setJoinStatus({ state: 'joining', error: null });
      if (socketRef.current?.connected) emitJoin(target);
    },
    [emitJoin],
  );

  const leaveRoom = useCallback((roomId) => {
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      if (joinRef.current?.roomId !== roomId) return;
      joinRef.current = null;
      socketRef.current?.emit(EVENTS.LEAVE);
      setRoom(null);
      setJoinStatus({ state: 'idle', error: null });
    }, LEAVE_DEBOUNCE_MS);
  }, []);

  const retryJoin = useCallback(
    (roomId, nickname) => {
      joinRef.current = null;
      joinRoom(roomId, nickname);
    },
    [joinRoom],
  );

  const emitQuiet = useCallback((event, payload) => {
    socketRef.current?.timeout(5000).emitWithAck(event, payload).catch(() => {});
  }, []);

  const setReady = useCallback((ready) => emitQuiet(EVENTS.SET_READY, { ready }), [emitQuiet]);
  const setDuration = useCallback((duration) => emitQuiet(EVENTS.SET_DURATION, { duration }), [emitQuiet]);
  const rematch = useCallback(() => emitQuiet(EVENTS.REMATCH, {}), [emitQuiet]);
  const sendProgress = useCallback((p) => socketRef.current?.emit(EVENTS.PROGRESS, p), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const me = room?.players.find((p) => p.id === playerId) ?? null;

  const value = useMemo(
    () => ({
      playerId,
      connection,
      room,
      me,
      role: me ? ROLE.RACER : ROLE.SPECTATOR,
      isHost: room?.hostId === playerId,
      joinStatus,
      notice,
      lastFinish,
      raceRef,
      now,
      createRoom,
      joinRoom,
      leaveRoom,
      retryJoin,
      setReady,
      setDuration,
      rematch,
      sendProgress,
      pushNotice,
      dismissNotice,
    }),
    [
      playerId, connection, room, me, joinStatus, notice, lastFinish, now, createRoom, joinRoom,
      leaveRoom, retryJoin, setReady, setDuration, rematch, sendProgress, pushNotice, dismissNotice,
    ],
  );

  return (
    <RoomContext.Provider value={value}>
      <HudContext.Provider value={hud}>{children}</HudContext.Provider>
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>');
  return ctx;
}

/** Latest race_update, throttled. Only HUD components should use this. */
export const useRaceHud = () => useContext(HudContext);
