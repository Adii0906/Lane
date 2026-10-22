// One race room and its state machine:  LOBBY -> COUNTDOWN -> RACING -> RESULTS -> (rematch) LOBBY
// The room never touches sockets directly. It talks to the outside world through `hooks`,
// which keeps it easy to test and easy to reason about.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  CAR_COLORS,
  DEFAULT_DURATION,
  ERROR_CODES,
  EVENTS,
  MAX_RACERS,
  MIN_RACERS,
  PHASE,
  ROLE,
  accuracy,
  netWpm,
  rawWpm,
  rollingWpm,
  round1,
} from '../../shared/index.js';
import { isDuration, isNonNegInt, isPlainObject } from './validate.js';
import { pickPassage } from './passages.js';

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new RoomError(code, message);
};

export class Room {
  /**
   * @param {string} code
   * @param {object} cfg    timing + rule config (see app.js DEFAULT_CONFIG)
   * @param {object} hooks  { broadcast(event, payload), emitTo(socketId, event, payload), onRaceFinished(records) }
   */
  constructor(code, cfg, hooks) {
    this.code = code;
    this.cfg = cfg;
    this.hooks = hooks;
    this.phase = PHASE.LOBBY;
    this.hostId = null;
    this.adminToken = randomBytes(32).toString('base64url');
    this.duration = DEFAULT_DURATION;
    this.racers = new Map(); // playerId -> racer
    this.spectators = new Map(); // playerId -> spectator
    this.blockedPlayers = new Map();
    this.rejoinRequests = new Map();
    this.lastActivity = cfg.now();
    this.countdownEndsAt = null;
    this.passage = null;
    this.lastPassageId = null;
    this.race = null; // { startAt, endsAt, finishOrder }
    this.results = null;
    this.timers = { countdown: null, raceEnd: null, update: null, sample: null };
    this.joinSeq = 0;
  }

  // ---------------------------------------------------------------- membership

  touch() {
    this.lastActivity = this.cfg.now();
  }

  hasConnectedMembers() {
    for (const m of this.racers.values()) if (m.connected) return true;
    for (const m of this.spectators.values()) if (m.connected) return true;
    return false;
  }

  memberBySocket(socketId) {
    for (const m of this.racers.values()) if (m.socketId === socketId) return { member: m, role: ROLE.RACER };
    for (const m of this.spectators.values()) if (m.socketId === socketId) return { member: m, role: ROLE.SPECTATOR };
    return null;
  }

  roleOf(playerId) {
    if (this.racers.has(playerId)) return ROLE.RACER;
    if (this.spectators.has(playerId)) return ROLE.SPECTATOR;
    return null;
  }

  isKicked(playerId) {
    return this.blockedPlayers.has(playerId);
  }

  canReconnectAsHost(playerId, socketId, token) {
    if (playerId !== this.hostId) return true;
    const host = this.racers.get(playerId);
    if (host?.connected && host.socketId === socketId) return true;
    if (typeof token !== 'string' || token.length !== this.adminToken.length) return false;
    const candidate = Buffer.from(token);
    const expected = Buffer.from(this.adminToken);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  adminTokenFor(playerId) {
    return playerId === this.hostId ? this.adminToken : null;
  }

  verifySession(playerId, socketId, token) {
    const member = this.racers.get(playerId) ?? this.spectators.get(playerId);
    const expectedToken = member?.sessionToken ?? this.blockedPlayers.get(playerId)?.sessionToken;
    if (!expectedToken || (member?.connected && member.socketId === socketId)) return true;
    if (typeof token !== 'string' || token.length !== expectedToken.length) return false;
    const candidate = Buffer.from(token);
    const expected = Buffer.from(expectedToken);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }

  requestRejoin(playerId, nickname, socketId, retry = false) {
    const blocked = this.blockedPlayers.get(playerId);
    if (!blocked) return { status: 'approved' };
    const existing = this.rejoinRequests.get(playerId);
    if (existing?.status === 'pending') {
      existing.socketId = socketId;
      existing.nickname = nickname;
      blocked.nickname = nickname;
      this.broadcastAdminState();
      return { status: 'pending' };
    }
    if (existing?.status === 'declined' && !retry) return { status: 'declined' };

    this.rejoinRequests.set(playerId, {
      id: playerId,
      nickname,
      requestedAt: this.cfg.now(),
      status: 'pending',
      socketId,
    });
    blocked.nickname = nickname;
    this.touch();
    this.broadcastAdminState();
    return { status: 'pending' };
  }

  disconnectRejoinRequest(playerId, socketId) {
    const request = this.rejoinRequests.get(playerId);
    if (request?.socketId === socketId) request.socketId = null;
  }

  /** Returns { role, replacedSocketId } */
  join({ playerId, nickname, socketId }) {
    if (this.isKicked(playerId)) fail(ERROR_CODES.PLAYER_KICKED, 'You were removed from this room');
    this.touch();
    let replacedSocketId = null;

    const existing = this.racers.get(playerId) ?? this.spectators.get(playerId);
    if (existing) {
      if (existing.socketId && existing.socketId !== socketId && existing.connected) {
        replacedSocketId = existing.socketId;
      }
      this.clearGrace(existing);
      existing.socketId = socketId;
      existing.connected = true;
      existing.left = false;
      if (this.phase === PHASE.LOBBY) existing.nickname = nickname;
      if (this.spectators.has(playerId)) this.promoteSpectators();
      this.ensureHost();
      this.broadcastState();
      return {
        role: this.roleOf(playerId),
        replacedSocketId,
        sessionToken: existing.sessionToken,
      };
    }

    const member = {
      id: playerId,
      nickname,
      socketId,
      connected: true,
      joinedAt: this.cfg.now(),
      joinSeq: this.joinSeq++,
      graceTimer: null,
      sessionToken: randomBytes(32).toString('base64url'),
    };

    if (this.phase === PHASE.LOBBY && this.racers.size < MAX_RACERS) {
      this.addRacer(member);
    } else {
      // Full lobby, or a race already counting down / running: watch instead.
      this.spectators.set(playerId, member);
    }
    this.ensureHost();
    this.broadcastState();
    return { role: this.roleOf(playerId), replacedSocketId, sessionToken: member.sessionToken };
  }

  addRacer(member) {
    const used = new Set([...this.racers.values()].map((r) => r.color));
    const color = CAR_COLORS.find((c) => !used.has(c.id)).id;
    this.racers.set(member.id, { ...member, color, ready: false, ...this.freshRaceFields() });
  }

  freshRaceFields() {
    return {
      correctIndex: 0,
      errorCount: 0,
      keystrokes: 0,
      stalled: false,
      finishedAt: null,
      dnf: false,
      leftAt: null,
      lastTickAt: null,
      history: [],
      samples: [],
    };
  }

  /** Socket dropped. Hold the seat for the grace period. */
  disconnect(socketId) {
    const found = this.memberBySocket(socketId);
    if (!found) return;
    const { member, role } = found;
    this.touch();
    member.connected = false;
    member.socketId = null;

    if (role === ROLE.RACER) {
      member.ready = false;
      member.stalled = false;
      if (this.phase === PHASE.COUNTDOWN) this.cancelCountdown(`${member.nickname} disconnected`);
      member.graceTimer = setTimeout(() => this.onGraceExpired(member.id), this.cfg.graceMs);
      this.ensureHost();
    } else {
      member.graceTimer = setTimeout(() => {
        const s = this.spectators.get(member.id);
        if (s && !s.connected) {
          this.spectators.delete(member.id);
          this.broadcastState();
        }
      }, this.cfg.graceMs);
    }
    this.broadcastState();
  }

  clearGrace(member) {
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = null;
  }

  onGraceExpired(playerId) {
    const r = this.racers.get(playerId);
    if (!r || r.connected) return;
    r.graceTimer = null;
    if (this.phase === PHASE.RACING) {
      // Car stays frozen on the track; the result is kept and ranked as DNF.
      if (!r.finishedAt) {
        r.dnf = true;
        r.leftAt = r.leftAt ?? this.cfg.now();
      }
      this.broadcastState();
      this.checkRaceEnd();
      return;
    }
    this.removeRacer(playerId);
  }

  /** Explicit "leave" from the client. No grace period. */
  leave(playerId) {
    this.touch();
    if (this.spectators.has(playerId)) {
      const s = this.spectators.get(playerId);
      this.clearGrace(s);
      this.spectators.delete(playerId);
      this.broadcastState();
      return;
    }
    const r = this.racers.get(playerId);
    if (!r) return;
    this.clearGrace(r);
    if (this.phase === PHASE.RACING) {
      r.connected = false;
      r.socketId = null;
      if (!r.finishedAt) {
        r.dnf = true;
        r.leftAt = this.cfg.now();
      }
      r.left = true;
      this.ensureHost();
      this.broadcastState();
      this.checkRaceEnd();
      return;
    }
    if (this.phase === PHASE.COUNTDOWN) {
      this.racers.delete(playerId);
      this.cancelCountdown(`${r.nickname} left`);
      this.ensureHost();
      this.promoteSpectators();
      this.broadcastState();
      return;
    }
    this.removeRacer(playerId);
  }

  removeRacer(playerId) {
    const r = this.racers.get(playerId);
    if (!r) return;
    this.clearGrace(r);
    this.racers.delete(playerId);
    this.ensureHost();
    if (this.phase === PHASE.LOBBY) this.promoteSpectators();
    this.broadcastState();
  }

  kick(adminId, playerId) {
    if (adminId !== this.hostId) fail(ERROR_CODES.NOT_HOST, 'Only the host can remove a player');
    if (adminId === playerId) fail(ERROR_CODES.BAD_REQUEST, 'The host cannot remove themselves');
    if (this.blockedPlayers.has(playerId)) fail(ERROR_CODES.NOT_IN_ROOM, 'That player is not in this room');
    const racer = this.racers.get(playerId);
    const spectator = this.spectators.get(playerId);
    const member = racer ?? spectator;
    if (!member) fail(ERROR_CODES.NOT_IN_ROOM, 'That player is not in this room');

    this.touch();
    this.blockedPlayers.set(playerId, {
      id: playerId,
      nickname: member.nickname,
      kickedAt: this.cfg.now(),
      sessionToken: member.sessionToken,
    });
    this.rejoinRequests.delete(playerId);
    const socketId = member.socketId;
    this.clearGrace(member);

    if (spectator) {
      this.spectators.delete(playerId);
    } else if (this.phase === PHASE.RACING) {
      racer.connected = false;
      racer.socketId = null;
      racer.left = true;
      if (!racer.finishedAt) {
        racer.dnf = true;
        racer.leftAt = this.cfg.now();
      }
    } else {
      this.racers.delete(playerId);
      if (this.phase === PHASE.COUNTDOWN) this.cancelCountdown(`${racer.nickname} was removed by the host`);
      if (this.phase === PHASE.RESULTS && this.results) {
        this.results.rows = this.results.rows
          .filter((row) => row.playerId !== playerId)
          .map((row, index) => ({ ...row, position: index + 1 }));
      }
    }

    this.ensureHost();
    if (this.phase === PHASE.LOBBY) this.promoteSpectators();
    this.broadcastState();
    if (this.phase === PHASE.RACING) this.checkRaceEnd();
    return socketId;
  }

  approveRejoin(adminId, playerId) {
    if (adminId !== this.hostId) fail(ERROR_CODES.NOT_HOST, 'Only the host can approve a rejoin request');
    const blocked = this.blockedPlayers.get(playerId);
    if (!blocked) fail(ERROR_CODES.NOT_IN_ROOM, 'That player is not restricted');
    const request = this.rejoinRequests.get(playerId);
    const socketId = request?.socketId ?? null;
    this.blockedPlayers.delete(playerId);
    this.rejoinRequests.delete(playerId);
    this.touch();
    this.broadcastState();
    return socketId;
  }

  declineRejoin(adminId, playerId) {
    if (adminId !== this.hostId) fail(ERROR_CODES.NOT_HOST, 'Only the host can decline a rejoin request');
    const request = this.rejoinRequests.get(playerId);
    if (!request || request.status !== 'pending') fail(ERROR_CODES.NOT_IN_ROOM, 'No pending request from that player');
    request.status = 'declined';
    this.touch();
    this.broadcastAdminState();
    return request.socketId;
  }

  unblockPlayer(adminId, playerId) {
    if (adminId !== this.hostId) fail(ERROR_CODES.NOT_HOST, 'Only the host can allow a player to rejoin');
    if (!this.blockedPlayers.has(playerId)) fail(ERROR_CODES.NOT_IN_ROOM, 'That player is not restricted');
    const request = this.rejoinRequests.get(playerId);
    const socketId = request?.socketId ?? null;
    this.blockedPlayers.delete(playerId);
    this.rejoinRequests.delete(playerId);
    this.touch();
    this.broadcastState();
    return socketId;
  }

  /** Host = longest-present racer, preferring connected ones. */
  ensureHost() {
    if (this.hostId && this.racers.has(this.hostId)) {
      const host = this.racers.get(this.hostId);
      const anotherConnectedRacer = [...this.racers.values()].some((r) => r.connected && r.id !== host.id);
      if (host.connected || (!host.left && !anotherConnectedRacer)) return;
    }
    const candidates = [...this.racers.values()]
      .filter((r) => !r.left)
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.joinSeq - b.joinSeq);
    const nextHost = candidates[0] ?? null;
    if (nextHost?.id === this.hostId) return;
    this.hostId = nextHost?.id ?? null;
    this.adminToken = randomBytes(32).toString('base64url');
    if (nextHost?.connected && nextHost.socketId) {
      this.hooks.emitTo(nextHost.socketId, EVENTS.ROOM_ADMIN, {
        roomCode: this.code,
        token: this.adminToken,
      });
    }
  }

  /** In LOBBY, fill free seats with the longest-waiting connected spectators. */
  promoteSpectators() {
    if (this.phase !== PHASE.LOBBY) return;
    const waiting = [...this.spectators.values()]
      .filter((s) => s.connected)
      .sort((a, b) => a.joinSeq - b.joinSeq);
    for (const s of waiting) {
      if (this.racers.size >= MAX_RACERS) break;
      this.spectators.delete(s.id);
      this.addRacer(s);
    }
    this.ensureHost();
  }

  // ---------------------------------------------------------------- lobby intents

  setDuration(playerId, duration) {
    if (this.phase !== PHASE.LOBBY) fail(ERROR_CODES.INVALID_PHASE, 'The timer can only change in the lobby');
    if (playerId !== this.hostId) fail(ERROR_CODES.NOT_HOST, 'Only the host can change the timer');
    if (!isDuration(duration)) fail(ERROR_CODES.BAD_REQUEST, 'Invalid duration');
    this.touch();
    this.duration = duration;
    this.broadcastState();
  }

  setReady(playerId, ready) {
    const r = this.racers.get(playerId);
    if (!r) fail(ERROR_CODES.NOT_RACER, 'Spectators cannot ready up');
    if (typeof ready !== 'boolean') fail(ERROR_CODES.BAD_REQUEST, 'ready must be a boolean');
    this.touch();

    if (this.phase === PHASE.LOBBY) {
      r.ready = ready;
      this.broadcastState();
      this.maybeStartCountdown();
      return;
    }
    if (this.phase === PHASE.COUNTDOWN) {
      if (!ready) {
        r.ready = false;
        this.cancelCountdown(`${r.nickname} is not ready`);
      }
      return;
    }
    fail(ERROR_CODES.INVALID_PHASE, 'Ready is only available in the lobby');
  }

  maybeStartCountdown() {
    if (this.phase !== PHASE.LOBBY) return;
    const racers = [...this.racers.values()];
    if (racers.length < MIN_RACERS) return;
    if (!racers.every((r) => r.ready && r.connected)) return;
    this.startCountdown();
  }

  startCountdown() {
    this.phase = PHASE.COUNTDOWN;
    this.passage = pickPassage(this.cfg.passages, this.lastPassageId, this.cfg.random);
    this.countdownEndsAt = this.cfg.now() + this.cfg.countdownMs + this.cfg.countdownLeadMs;
    this.timers.countdown = setTimeout(() => this.startRace(), this.countdownEndsAt - this.cfg.now());
    this.hooks.broadcast(EVENTS.COUNTDOWN, {
      endsAt: this.countdownEndsAt,
      passage: { id: this.passage.id, text: this.passage.text },
    });
    this.broadcastState();
  }

  cancelCountdown(reason) {
    if (this.phase !== PHASE.COUNTDOWN) return;
    clearTimeout(this.timers.countdown);
    this.timers.countdown = null;
    this.phase = PHASE.LOBBY;
    this.countdownEndsAt = null;
    this.passage = null;
    this.promoteSpectators();
    this.hooks.broadcast(EVENTS.COUNTDOWN_CANCEL, { reason });
    this.broadcastState();
  }

  // ---------------------------------------------------------------- race

  startRace() {
    this.timers.countdown = null;
    const startAt = this.countdownEndsAt;
    const endsAt = startAt + this.duration * this.cfg.msPerRaceSecond;
    this.phase = PHASE.RACING;
    this.lastPassageId = this.passage.id;
    this.race = { startAt, endsAt, finishOrder: [] };
    for (const r of this.racers.values()) {
      Object.assign(r, this.freshRaceFields());
      r.lastTickAt = startAt;
      r.history = [{ t: startAt, i: 0 }];
    }

    this.timers.raceEnd = setTimeout(() => this.endRace('time'), Math.max(0, endsAt - this.cfg.now()));
    this.timers.update = setInterval(() => this.broadcastRaceUpdate(), this.cfg.raceUpdateMs);
    this.timers.sample = setInterval(() => this.takeSamples(), this.cfg.msPerRaceSecond);

    this.hooks.broadcast(EVENTS.RACE_START, {
      passage: { id: this.passage.id, text: this.passage.text },
      startAt,
      endsAt,
      duration: this.duration,
    });
    this.broadcastState();
  }

  /** Validate and apply a progress intent. Returns { ok, reason? }. */
  progress(playerId, payload) {
    if (this.phase !== PHASE.RACING) fail(ERROR_CODES.INVALID_PHASE, 'No race in progress');
    const r = this.racers.get(playerId);
    if (!r) fail(ERROR_CODES.NOT_RACER, 'Spectators cannot type');
    if (r.finishedAt || r.dnf) return { ok: false, reason: 'not_active' };
    if (!isPlainObject(payload)) fail(ERROR_CODES.BAD_REQUEST, 'Invalid progress payload');

    const now = this.cfg.now();
    if (now < this.race.startAt - this.cfg.startSlopMs) return { ok: false, reason: 'too_early' };

    const len = this.passage.text.length;
    const { correctIndex, errorCount, keystrokes } = payload;
    if (!isNonNegInt(correctIndex, len) || !isNonNegInt(errorCount, 100000) || !isNonNegInt(keystrokes, 100000)) {
      return { ok: false, reason: 'invalid_values' };
    }
    const delta = correctIndex - r.correctIndex;
    if (delta < 0) return { ok: false, reason: 'backward' };
    if (delta > this.cfg.maxCharsPerTick) return { ok: false, reason: 'too_many_chars' };
    if (keystrokes < r.keystrokes || errorCount < r.errorCount) return { ok: false, reason: 'counter_backward' };
    // Every confirmed character costs exactly one correct keystroke.
    if (keystrokes - errorCount < correctIndex) return { ok: false, reason: 'keystroke_mismatch' };
    if (keystrokes - r.keystrokes > this.cfg.maxCharsPerTick * 2) return { ok: false, reason: 'too_many_keys' };

    const elapsed = now - this.race.startAt;
    const wpmCheck = netWpm(correctIndex, Math.max(elapsed, this.cfg.wpmCheckMinElapsedMs));
    if (wpmCheck > this.cfg.maxWpm) return { ok: false, reason: 'too_fast' };

    this.touch();
    r.correctIndex = correctIndex;
    r.errorCount = errorCount;
    r.keystrokes = keystrokes;
    r.stalled = payload.stalled === true && correctIndex < len;
    r.lastTickAt = now;
    if (delta > 0) {
      r.history.push({ t: now, i: correctIndex });
      const cutoff = now - this.cfg.rollingWindowMs - 2000;
      while (r.history.length > 2 && r.history[1].t < cutoff) r.history.shift();
    }

    if (correctIndex === len) {
      r.finishedAt = now;
      r.stalled = false;
      this.race.finishOrder.push(r.id);
      const position = this.race.finishOrder.length;
      this.hooks.broadcast(EVENTS.PLAYER_FINISHED, {
        playerId: r.id,
        nickname: r.nickname,
        position,
        netWpm: round1(netWpm(len, now - this.race.startAt)),
      });
      this.checkRaceEnd();
    }
    return { ok: true };
  }

  speedOf(r, now) {
    if (r.finishedAt || r.dnf || !r.connected) return 0;
    return rollingWpm(r.history, now, this.cfg.rollingWindowMs);
  }

  broadcastRaceUpdate() {
    if (this.phase !== PHASE.RACING) return;
    const now = this.cfg.now();
    const len = this.passage.text.length;
    this.hooks.broadcast(EVENTS.RACE_UPDATE, {
      t: now,
      players: [...this.racers.values()].map((r) => ({
        id: r.id,
        progress: r.correctIndex / len,
        correctIndex: r.correctIndex,
        wpm: round1(this.speedOf(r, now)),
        netWpm: round1(netWpm(r.correctIndex, (r.finishedAt ?? now) - this.race.startAt)),
        stalled: r.stalled,
        finished: Boolean(r.finishedAt),
        position: r.finishedAt ? this.race.finishOrder.indexOf(r.id) + 1 : null,
        dnf: r.dnf,
        connected: r.connected,
      })),
    });
  }

  takeSamples() {
    if (this.phase !== PHASE.RACING) return;
    const now = this.cfg.now();
    for (const r of this.racers.values()) {
      if (r.finishedAt || r.dnf) continue;
      r.samples.push(round1(this.speedOf(r, now)));
    }
  }

  checkRaceEnd() {
    if (this.phase !== PHASE.RACING) return;
    const racers = [...this.racers.values()];
    if (racers.every((r) => r.finishedAt || r.dnf)) this.endRace('all_finished');
  }

  computeResults(endAt) {
    const { startAt } = this.race;
    const rows = [...this.racers.values()].map((r) => {
      const stopAt = r.finishedAt ?? (r.dnf && r.leftAt ? Math.min(r.leftAt, endAt) : endAt);
      const elapsed = Math.max(1, stopAt - startAt);
      const correctKeys = r.keystrokes - r.errorCount;
      return {
        playerId: r.id,
        nickname: r.nickname,
        color: r.color,
        finished: Boolean(r.finishedAt),
        finishMs: r.finishedAt ? r.finishedAt - startAt : null,
        dnf: r.dnf,
        correctChars: r.correctIndex,
        netWpm: round1(netWpm(r.correctIndex, elapsed)),
        rawWpm: round1(rawWpm(r.keystrokes, elapsed)),
        accuracy: Math.round(accuracy(correctKeys, r.keystrokes) * 1000) / 1000,
        samples: r.samples.slice(),
      };
    });

    const group = (row) => (row.finished ? 0 : row.dnf ? 2 : 1);
    rows.sort((a, b) => {
      if (group(a) !== group(b)) return group(a) - group(b);
      if (a.finished) return a.finishMs - b.finishMs;
      return b.correctChars - a.correctChars || b.accuracy - a.accuracy;
    });
    rows.forEach((row, i) => (row.position = i + 1));
    return rows;
  }

  endRace(reason) {
    if (this.phase !== PHASE.RACING) return;
    this.takeSamples();
    this.clearRaceTimers();
    const now = this.cfg.now();
    const endAt = Math.min(now, this.race.endsAt);
    const results = this.computeResults(endAt);
    this.phase = PHASE.RESULTS;
    this.results = {
      reason,
      passageId: this.passage.id,
      durationSec: this.duration,
      rows: results,
    };

    this.hooks.onRaceFinished(
      results.map((row) => ({
        playerId: row.playerId,
        nickname: row.nickname,
        netWpm: row.netWpm,
        rawWpm: row.rawWpm,
        accuracy: row.accuracy,
        position: row.position,
        durationSec: this.duration,
        passageId: this.passage.id,
        timestamp: now,
      })),
    );

    this.hooks.broadcast(EVENTS.RACE_END, this.results);
    this.broadcastState();
  }

  rematch(playerId) {
    if (this.phase !== PHASE.RESULTS) fail(ERROR_CODES.INVALID_PHASE, 'Rematch is only available after a race');
    if (!this.roleOf(playerId)) fail(ERROR_CODES.NOT_IN_ROOM, 'Not in this room');
    this.touch();
    for (const r of [...this.racers.values()]) {
      // Drop seats whose owners left or timed out. Keep anyone still inside the grace window.
      if (r.left || (!r.connected && !r.graceTimer)) {
        this.racers.delete(r.id);
        continue;
      }
      Object.assign(r, this.freshRaceFields(), { ready: false });
    }
    this.phase = PHASE.LOBBY;
    this.race = null;
    this.results = null;
    this.passage = null;
    this.countdownEndsAt = null;
    this.ensureHost();
    this.promoteSpectators();
    this.broadcastState();
  }

  // ---------------------------------------------------------------- output

  clearRaceTimers() {
    clearTimeout(this.timers.raceEnd);
    clearInterval(this.timers.update);
    clearInterval(this.timers.sample);
    this.timers.raceEnd = this.timers.update = this.timers.sample = null;
  }

  destroy() {
    clearTimeout(this.timers.countdown);
    this.clearRaceTimers();
    for (const m of [...this.racers.values(), ...this.spectators.values()]) this.clearGrace(m);
  }

  serialize() {
    const racers = [...this.racers.values()].sort((a, b) => a.joinSeq - b.joinSeq);
    const showPassage = this.phase === PHASE.COUNTDOWN || this.phase === PHASE.RACING;
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      duration: this.duration,
      players: racers.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        color: r.color,
        ready: r.ready,
        connected: r.connected,
        kicked: this.blockedPlayers.has(r.id),
        isHost: r.id === this.hostId,
      })),
      spectators: [...this.spectators.values()].map((s) => ({
        id: s.id,
        nickname: s.nickname,
        connected: s.connected,
      })),
      spectatorCount: [...this.spectators.values()].filter((s) => s.connected).length,
      countdownEndsAt: this.phase === PHASE.COUNTDOWN ? this.countdownEndsAt : null,
      passage: showPassage && this.passage ? { id: this.passage.id, text: this.passage.text } : null,
      race:
        this.phase === PHASE.RACING
          ? {
              startAt: this.race.startAt,
              endsAt: this.race.endsAt,
              duration: this.duration,
              progress: Object.fromEntries(
                racers.map((r) => [
                  r.id,
                  {
                    correctIndex: r.correctIndex,
                    errorCount: r.errorCount,
                    keystrokes: r.keystrokes,
                    finished: Boolean(r.finishedAt),
                    dnf: r.dnf,
                  },
                ]),
              ),
            }
          : null,
      results: this.phase === PHASE.RESULTS ? this.results : null,
    };
  }

  broadcastState() {
    this.hooks.broadcast(EVENTS.ROOM_STATE, this.serialize());
    this.broadcastAdminState();
  }

  broadcastAdminState() {
    const host = this.racers.get(this.hostId);
    if (!host?.connected || !host.socketId) return;
    this.hooks.emitTo(host.socketId, EVENTS.ROOM_ADMIN_STATE, {
      roomCode: this.code,
      blockedPlayers: [...this.blockedPlayers.values()].map(({ id, nickname, kickedAt }) => ({ id, nickname, kickedAt })),
      rejoinRequests: [...this.rejoinRequests.values()]
        .filter((request) => request.status === 'pending')
        .map(({ id, nickname, requestedAt }) => ({ id, nickname, requestedAt })),
    });
  }
}
