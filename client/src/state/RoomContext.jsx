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
import {
  getHostToken,
  getNickname,
  getPlayerId,
  getRoomSessionToken,
  saveHostToken,
  saveRoomSessionToken,
} from '../lib/identity.js';
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
  const [rejoinStatus, setRejoinStatus] = useState(null);
  const [adminState, setAdminState] = useState({ blockedPlayers: [], rejoinRequests: [] });

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
          adminToken: getHostToken(target.roomId),
          sessionToken: getRoomSessionToken(target.roomId),
        });
      } catch {
        return; // connection dropped mid-join; the reconnect handler retries
      }
      if (joinRef.current !== target) return;
      if (!res.ok) {
        if (
          res.code === ERROR_CODES.ROOM_NOT_FOUND ||
          res.code === ERROR_CODES.INVALID_NICKNAME ||
          res.code === ERROR_CODES.PLAYER_KICKED ||
          res.code === ERROR_CODES.NOT_HOST
        ) {
          if (res.code !== ERROR_CODES.PLAYER_KICKED) joinRef.current = null;
        }
        if (res.code === ERROR_CODES.PLAYER_KICKED) {
          setRejoinStatus(res.rejoinStatus ?? 'pending');
          setAdminState({ blockedPlayers: [], rejoinRequests: [] });
          return;
        }
        if (res.code === ERROR_CODES.IDENTITY_INVALID) joinRef.current = null;
        setJoinStatus({ state: 'error', error: res.code });
        return;
      }
      if (res.sessionToken) saveRoomSessionToken(target.roomId, res.sessionToken);
      setRoom(res.state);
      setRejoinStatus(null);
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
    socket.on(EVENTS.ROOM_KICKED, () => {
      setRoom(null);
      setRejoinStatus('pending');
      setJoinStatus({ state: 'error', error: null });
    });
    socket.on(EVENTS.ROOM_ADMIN, ({ roomCode, token }) => {
      if (typeof roomCode === 'string' && typeof token === 'string') saveHostToken(roomCode, token);
    });
    socket.on(EVENTS.ROOM_ADMIN_STATE, (state) => {
      if (joinRef.current?.roomId === state.roomCode) {
        setAdminState({
          blockedPlayers: state.blockedPlayers ?? [],
          rejoinRequests: state.rejoinRequests ?? [],
        });
      }
    });
    socket.on(EVENTS.REJOIN_APPROVED, ({ roomCode }) => {
      if (joinRef.current?.roomId !== roomCode) return;
      emitJoin(joinRef.current);
    });
    socket.on(EVENTS.REJOIN_DECLINED, ({ roomCode }) => {
      if (joinRef.current?.roomId === roomCode) setRejoinStatus('declined');
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
          setRejoinStatus(null);
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

  const createRoom = useCallback(async (nickname = getNickname()) => {
    const res = await socketRef.current
      .timeout(5000)
      .emitWithAck(EVENTS.CREATE_ROOM, { playerId, nickname });
    if (!res.ok) throw new Error(res.code);
    if (res.adminToken) saveHostToken(res.code, res.adminToken);
    if (res.sessionToken) saveRoomSessionToken(res.code, res.sessionToken);
    joinRef.current = { roomId: res.code, nickname };
    setRoom(res.state);
    setJoinStatus({ state: 'joined', error: null });
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
      if (current?.roomId !== roomId) setAdminState({ blockedPlayers: [], rejoinRequests: [] });
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
  const kickPlayer = useCallback(
    async (targetId) => {
      try {
        const response = await socketRef.current
          .timeout(5000)
          .emitWithAck(EVENTS.KICK_PLAYER, { playerId: targetId });
        if (!response.ok) pushNotice('That player could not be removed.', 'warn');
      } catch {
        pushNotice('Could not reach the server to remove that player.', 'warn');
      }
    },
    [pushNotice],
  );
  const manageRejoin = useCallback(
    async (event, targetId) => {
      try {
        const response = await socketRef.current.timeout(5000).emitWithAck(event, { playerId: targetId });
        if (!response.ok) pushNotice('That player-management action could not be completed.', 'warn');
      } catch {
        pushNotice('Could not reach the server to update room access.', 'warn');
      }
    },
    [pushNotice],
  );
  const approveRejoin = useCallback(
    (targetId) => manageRejoin(EVENTS.APPROVE_REJOIN, targetId),
    [manageRejoin],
  );
  const declineRejoin = useCallback(
    (targetId) => manageRejoin(EVENTS.DECLINE_REJOIN, targetId),
    [manageRejoin],
  );
  const unblockPlayer = useCallback(
    (targetId) => manageRejoin(EVENTS.UNBLOCK_PLAYER, targetId),
    [manageRejoin],
  );
  const requestRejoin = useCallback(async (retry = false) => {
    const target = joinRef.current;
    if (!target) return;
    try {
      const response = await socketRef.current.timeout(5000).emitWithAck(EVENTS.REQUEST_REJOIN, {
        roomId: target.roomId,
        playerId,
        nickname: target.nickname,
        sessionToken: getRoomSessionToken(target.roomId),
        retry,
      });
      if (response.ok) setRejoinStatus(response.status);
      else pushNotice('Could not send the rejoin request.', 'warn');
    } catch {
      pushNotice('Could not reach the server to request a rejoin.', 'warn');
    }
  }, [playerId, pushNotice]);
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
      kickPlayer,
      adminState,
      rejoinStatus,
      approveRejoin,
      declineRejoin,
      unblockPlayer,
      requestRejoin,
      rematch,
      sendProgress,
      pushNotice,
      dismissNotice,
    }),
    [
      playerId, connection, room, me, joinStatus, notice, lastFinish, now, createRoom, joinRoom,
      leaveRoom, retryJoin, setReady, setDuration, kickPlayer, adminState, rejoinStatus, approveRejoin,
      declineRejoin, unblockPlayer, requestRejoin, rematch, sendProgress, pushNotice, dismissNotice,
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
