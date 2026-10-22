// Builds the HTTP + Socket.IO server. Exported as a factory so tests can spin up isolated
// instances with shortened timings.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { customAlphabet } from 'nanoid';
import { Server } from 'socket.io';
import {
  COUNTDOWN_LEAD_MS,
  COUNTDOWN_MS,
  ERROR_CODES,
  EVENTS,
  MAX_CHARS_PER_TICK,
  MAX_WPM,
  RACE_UPDATE_INTERVAL_MS,
  RECONNECT_GRACE_MS,
  ROLLING_WINDOW_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_IDLE_MS,
  WPM_CHECK_MIN_ELAPSED_MS,
} from '../../shared/index.js';
import { PASSAGES } from './passages.js';
import { createRaceRepository } from './raceRepository.js';
import { Room, RoomError } from './room.js';
import {
  createRateLimiter,
  isPlainObject,
  isPlayerId,
  parseRoomCode,
  sanitizeNickname,
} from './validate.js';

export const DEFAULT_CONFIG = Object.freeze({
  now: () => Date.now(),
  random: Math.random,
  passages: PASSAGES,
  countdownMs: COUNTDOWN_MS,
  countdownLeadMs: COUNTDOWN_LEAD_MS,
  graceMs: RECONNECT_GRACE_MS,
  roomIdleMs: ROOM_IDLE_MS,
  sweepMs: 60 * 1000,
  msPerRaceSecond: 1000, // tests shrink this to run 30-120s races in a few seconds
  raceUpdateMs: RACE_UPDATE_INTERVAL_MS,
  rollingWindowMs: ROLLING_WINDOW_MS,
  maxWpm: MAX_WPM,
  maxCharsPerTick: MAX_CHARS_PER_TICK,
  wpmCheckMinElapsedMs: WPM_CHECK_MIN_ELAPSED_MS,
  startSlopMs: 250,
  maxRooms: 5000,
  maxPayloadBytes: 4096,
  rateCapacity: 30,
  rateRefillPerSec: 15,
  staticDir: null,
  logger: console,
});

const makeCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export function createGameServer(overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    maxHttpBufferSize: cfg.maxPayloadBytes,
    pingInterval: 10000,
    pingTimeout: 8000,
  });
  const rooms = new Map();
  const repository = createRaceRepository();

  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

  if (cfg.staticDir && fs.existsSync(cfg.staticDir)) {
    const indexHtml = path.join(cfg.staticDir, 'index.html');
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get(['/', '/r/:roomId'], (_req, res) => res.sendFile(indexHtml));
  }

  // ------------------------------------------------------------------ rooms

  function createRoom() {
    if (rooms.size >= cfg.maxRooms) return null;
    let code;
    do code = makeCode();
    while (rooms.has(code));
    const room = new Room(code, cfg, {
      broadcast: (event, payload) => io.to(code).emit(event, payload),
      emitTo: (socketId, event, payload) => io.to(socketId).emit(event, payload),
      onRaceFinished: (records) => repository.saveRace(records),
    });
    rooms.set(code, room);
    return room;
  }

  function deleteRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    room.destroy();
    rooms.delete(code);
  }

  const sweeper = setInterval(() => {
    const now = cfg.now();
    for (const [code, room] of rooms) {
      if (!room.hasConnectedMembers() && now - room.lastActivity > cfg.roomIdleMs) deleteRoom(code);
    }
  }, cfg.sweepMs);
  sweeper.unref?.();

  // ------------------------------------------------------------------ sockets

  io.on('connection', (socket) => {
    const limiter = createRateLimiter({ capacity: cfg.rateCapacity, refillPerSec: cfg.rateRefillPerSec });
    let lastRateNotice = 0;

    // Guard: a client emitting "error" must never reach Node's unhandled-'error' behavior.
    socket.on('error', () => {});

    const sendError = (code, message, extra = {}) => socket.emit(EVENTS.ERROR, { code, message, ...extra });

    const currentRoom = () => (socket.data.roomCode ? rooms.get(socket.data.roomCode) : null);

    /** Wraps a handler with rate limiting, payload checks, and error mapping. */
    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = {};
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!limiter.take()) {
          const now = Date.now();
          if (now - lastRateNotice > 1000) {
            lastRateNotice = now;
            sendError(ERROR_CODES.RATE_LIMITED, 'Slow down a little');
          }
          reply({ ok: false, code: ERROR_CODES.RATE_LIMITED });
          return;
        }
        if (payload !== undefined && payload !== null && !isPlainObject(payload)) {
          reply({ ok: false, code: ERROR_CODES.BAD_REQUEST });
          return sendError(ERROR_CODES.BAD_REQUEST, 'Invalid payload');
        }
        try {
          handler(payload ?? {}, reply);
        } catch (err) {
          if (err instanceof RoomError) {
            reply({ ok: false, code: err.code });
            sendError(err.code, err.message);
          } else {
            cfg.logger.error(`[${event}]`, err);
            reply({ ok: false, code: ERROR_CODES.INTERNAL });
            sendError(ERROR_CODES.INTERNAL, 'Something went wrong');
          }
        }
      });
    };

    const requireMembership = () => {
      const room = currentRoom();
      const playerId = socket.data.playerId;
      if (!room || !playerId || !room.roleOf(playerId)) {
        throw new RoomError(ERROR_CODES.NOT_IN_ROOM, 'You are not in a room');
      }
      return { room, playerId };
    };

    const detachFromRoom = () => {
      const room = currentRoom();
      if (room) {
        socket.leave(room.code);
        room.disconnect(socket.id);
      }
      socket.data.roomCode = null;
    };

    on(EVENTS.TIME_SYNC, (p, reply) => {
      const t0 = Number.isFinite(p.t0) ? p.t0 : 0;
      reply({ t0, serverNow: cfg.now() });
    });

    on(EVENTS.CREATE_ROOM, (p, reply) => {
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const nickname = sanitizeNickname(p.nickname);
      if (!nickname) throw new RoomError(ERROR_CODES.INVALID_NICKNAME, 'Nickname must be 2 to 16 characters');
      const room = createRoom();
      if (!room) throw new RoomError(ERROR_CODES.SERVER_BUSY, 'Too many rooms right now, try again soon');
      const oldRoom = currentRoom();
      if (oldRoom) {
        socket.leave(oldRoom.code);
        oldRoom.leave(socket.data.playerId);
      }
      socket.data.playerId = p.playerId;
      socket.data.roomCode = room.code;
      socket.join(room.code);
      const joined = room.join({ playerId: p.playerId, nickname, socketId: socket.id });
      reply({
        ok: true,
        code: room.code,
        state: room.serialize(),
        adminToken: room.adminTokenFor(p.playerId),
        sessionToken: joined.sessionToken,
      });
    });

    on(EVENTS.JOIN_ROOM, (p, reply) => {
      const code = parseRoomCode(p.roomId);
      if (!code) throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not exist');
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const nickname = sanitizeNickname(p.nickname);
      if (!nickname) throw new RoomError(ERROR_CODES.INVALID_NICKNAME, 'Nickname must be 2 to 16 characters');
      const room = rooms.get(code);
      if (!room) throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not exist');
      if (socket.data.roomCode && socket.data.roomCode !== code) detachFromRoom();
      if (!room.verifySession(p.playerId, socket.id, p.sessionToken)) {
        throw new RoomError(ERROR_CODES.IDENTITY_INVALID, 'This player identity cannot be verified in this browser');
      }
      if (room.isKicked(p.playerId)) {
        const { status } = room.requestRejoin(p.playerId, nickname, socket.id);
        socket.data.rejoinRoomCode = code;
        socket.data.rejoinPlayerId = p.playerId;
        reply({ ok: false, code: ERROR_CODES.PLAYER_KICKED, rejoinStatus: status });
        return;
      }
      if (!room.canReconnectAsHost(p.playerId, socket.id, p.adminToken)) {
        throw new RoomError(ERROR_CODES.NOT_HOST, 'This host session cannot be claimed');
      }

      socket.data.playerId = p.playerId;
      socket.data.roomCode = code;
      socket.join(code);

      const { role, replacedSocketId, sessionToken } = room.join({
        playerId: p.playerId,
        nickname,
        socketId: socket.id,
      });
      if (replacedSocketId) {
        const old = io.sockets.sockets.get(replacedSocketId);
        if (old) {
          old.emit(EVENTS.ERROR, { code: ERROR_CODES.SESSION_REPLACED, message: 'This race was opened in another tab' });
          old.leave(code);
          old.data.roomCode = null;
        }
      }
      reply({ ok: true, role, state: room.serialize(), sessionToken });
    });

    on(EVENTS.SET_DURATION, (p, reply) => {
      const { room, playerId } = requireMembership();
      room.setDuration(playerId, p.duration);
      reply({ ok: true });
    });

    on(EVENTS.SET_READY, (p, reply) => {
      const { room, playerId } = requireMembership();
      room.setReady(playerId, p.ready);
      reply({ ok: true });
    });

    on(EVENTS.KICK_PLAYER, (p, reply) => {
      const { room, playerId } = requireMembership();
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const targetSocketId = room.kick(playerId, p.playerId);
      const targetSocket = targetSocketId && io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit(EVENTS.ROOM_KICKED, { roomCode: room.code });
        targetSocket.leave(room.code);
        targetSocket.data.roomCode = null;
      }
      reply({ ok: true });
    });

    on(EVENTS.REQUEST_REJOIN, (p, reply) => {
      const code = parseRoomCode(p.roomId);
      if (!code || !isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid room or player id');
      const nickname = sanitizeNickname(p.nickname);
      if (!nickname) throw new RoomError(ERROR_CODES.INVALID_NICKNAME, 'Nickname must be 2 to 16 characters');
      const room = rooms.get(code);
      if (!room) throw new RoomError(ERROR_CODES.ROOM_NOT_FOUND, 'That room code does not exist');
      if (!room.verifySession(p.playerId, socket.id, p.sessionToken)) {
        throw new RoomError(ERROR_CODES.IDENTITY_INVALID, 'This player identity cannot be verified in this browser');
      }
      if (!room.isKicked(p.playerId)) throw new RoomError(ERROR_CODES.NOT_IN_ROOM, 'You are not restricted from this room');

      const { status } = room.requestRejoin(p.playerId, nickname, socket.id, p.retry === true);
      socket.data.rejoinRoomCode = code;
      socket.data.rejoinPlayerId = p.playerId;
      reply({ ok: true, status });
    });

    on(EVENTS.APPROVE_REJOIN, (p, reply) => {
      const { room, playerId } = requireMembership();
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const requestSocketId = room.approveRejoin(playerId, p.playerId);
      const requestSocket = requestSocketId && io.sockets.sockets.get(requestSocketId);
      if (requestSocket) requestSocket.emit(EVENTS.REJOIN_APPROVED, { roomCode: room.code });
      reply({ ok: true });
    });

    on(EVENTS.DECLINE_REJOIN, (p, reply) => {
      const { room, playerId } = requireMembership();
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const requestSocketId = room.declineRejoin(playerId, p.playerId);
      const requestSocket = requestSocketId && io.sockets.sockets.get(requestSocketId);
      if (requestSocket) requestSocket.emit(EVENTS.REJOIN_DECLINED, { roomCode: room.code });
      reply({ ok: true });
    });

    on(EVENTS.UNBLOCK_PLAYER, (p, reply) => {
      const { room, playerId } = requireMembership();
      if (!isPlayerId(p.playerId)) throw new RoomError(ERROR_CODES.BAD_REQUEST, 'Invalid player id');
      const requestSocketId = room.unblockPlayer(playerId, p.playerId);
      const requestSocket = requestSocketId && io.sockets.sockets.get(requestSocketId);
      if (requestSocket) requestSocket.emit(EVENTS.REJOIN_APPROVED, { roomCode: room.code });
      reply({ ok: true });
    });

    on(EVENTS.PROGRESS, (p, reply) => {
      const { room, playerId } = requireMembership();
      const result = room.progress(playerId, p);
      if (!result.ok && result.reason !== 'not_active' && result.reason !== 'too_early') {
        sendError(ERROR_CODES.PROGRESS_REJECTED, 'Progress rejected', { reason: result.reason });
      }
      reply(result);
    });

    on(EVENTS.REMATCH, (_p, reply) => {
      const { room, playerId } = requireMembership();
      room.rematch(playerId);
      reply({ ok: true });
    });

    on(EVENTS.LEAVE, (_p, reply) => {
      const room = currentRoom();
      if (room && socket.data.playerId) {
        socket.leave(room.code);
        room.leave(socket.data.playerId);
      }
      socket.data.roomCode = null;
      reply({ ok: true });
    });

    socket.on('disconnect', () => {
      const rejoinRoom = socket.data.rejoinRoomCode && rooms.get(socket.data.rejoinRoomCode);
      if (rejoinRoom && socket.data.rejoinPlayerId) {
        rejoinRoom.disconnectRejoinRequest(socket.data.rejoinPlayerId, socket.id);
      }
      detachFromRoom();
    });
  });

  return {
    app,
    httpServer,
    io,
    rooms,
    repository,
    config: cfg,
    listen(port = 0) {
      return new Promise((resolve) => {
        httpServer.listen(port, () => resolve(httpServer.address().port));
      });
    },
    async close() {
      clearInterval(sweeper);
      for (const code of [...rooms.keys()]) deleteRoom(code);
      await new Promise((resolve) => io.close(() => resolve()));
    },
  };
}
