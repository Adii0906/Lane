// PHASE 2 acceptance tests: the race engine, driven by simulated bot clients.
// Race clocks are compressed (1 race-second = 100ms) so 30-120s races finish quickly.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  DURATIONS,
  ERROR_CODES,
  EVENTS,
  PASSAGE_CHARSET,
  PHASE,
  backspace,
  createTypingState,
  reconcileInput,
  typeChar,
} from '../../shared/index.js';
import { PASSAGES } from '../src/passages.js';
import { TypingBot } from './bot.js';
import { closeAll, makeRoom, sleep, startServer } from './helpers.js';

const SHORT = 'Lanes are drawn in white paint and the cars are bright.'; // 55 chars
const LONG = PASSAGES[0].text;
const MS_PER_SEC = 100;

async function startRace(clients, duration) {
  if (duration) await clients[0].emit(EVENTS.SET_DURATION, { duration });
  const started = clients[0].waitFor(EVENTS.RACE_START, () => true, 5000);
  for (const c of clients) await c.ready(true);
  return started;
}

describe('Phase 2: race engine', () => {
  describe('typing engine (stall mechanic)', () => {
    test('a wrong key stalls progress until backspace fixes it', () => {
      const text = 'abc';
      let s = createTypingState();
      s = typeChar(s, text, 'a').state;
      const err = typeChar(s, text, 'x');
      assert.equal(err.event, 'error');
      s = err.state;
      assert.equal(s.index, 1);
      assert.equal(s.errors, 1);

      // Further keys, even correct ones, are blocked.
      const blocked = typeChar(s, text, 'b');
      assert.equal(blocked.event, 'blocked');
      assert.equal(blocked.state.index, 1);

      const fixed = backspace(s);
      assert.equal(fixed.event, 'fixed');
      s = typeChar(fixed.state, text, 'b').state;
      s = typeChar(s, text, 'c').state;
      assert.equal(s.index, 3);
      assert.equal(s.keystrokes, 4);
      assert.equal(s.errors, 1);
    });

    test('backspace never un-confirms correct text', () => {
      let s = createTypingState();
      s = typeChar(s, 'hello', 'h').state;
      const r = backspace(s);
      assert.equal(r.event, 'locked');
      assert.equal(r.state.index, 1);
    });

    test('input reconciliation handles IME bursts, smart quotes and deletions', () => {
      const text = "it's ok";
      let { state } = reconcileInput(createTypingState(), text, 'it’s');
      assert.equal(state.index, 4);
      ({ state } = reconcileInput(state, text, "it'sX"));
      assert.equal(state.wrong, 'X');
      ({ state } = reconcileInput(state, text, "it'sXok"));
      assert.equal(state.index, 4, 'stalled: extra keys ignored');
      ({ state } = reconcileInput(state, text, "it's"));
      assert.equal(state.wrong, null);
      ({ state } = reconcileInput(state, text, "it's ok"));
      assert.equal(state.index, 7);
    });
  });

  describe('passages', () => {
    test('about 20 passages, mobile-friendly charset, too long to finish in 30s at 120 WPM', () => {
      assert.ok(PASSAGES.length >= 18 && PASSAGES.length <= 24);
      assert.deepEqual(new Set(PASSAGES.map((p) => p.kind)), new Set(['prose', 'quote', 'code']));
      for (const p of PASSAGES) {
        assert.match(p.text, PASSAGE_CHARSET, p.id);
        assert.ok(p.text.length > 300, `${p.id} too short`);
      }
    });
  });

  describe('races with bots', () => {
    let server;
    before(async () => {
      server = await startServer({
        countdownMs: 300,
        countdownLeadMs: 0,
        msPerRaceSecond: MS_PER_SEC,
        graceMs: 300,
        passages: [{ id: 'short', kind: 'prose', text: SHORT }],
        rateCapacity: 60,
        rateRefillPerSec: 40,
      });
    });
    after(async () => {
      await server.close();
    });

    test('countdown ends exactly when the race starts; everyone gets the same passage', async () => {
      const { clients } = await makeRoom(server, ['Ann', 'Ben']);
      const countdown = clients[0].waitFor(EVENTS.COUNTDOWN);
      const starts = clients.map((c) => c.waitFor(EVENTS.RACE_START, () => true, 3000));
      for (const c of clients) await c.ready(true);
      const cd = await countdown;
      const [a, b] = await Promise.all(starts);
      assert.equal(a.startAt, cd.endsAt);
      assert.equal(a.passage.text, b.passage.text);
      assert.equal(a.endsAt - a.startAt, 60 * MS_PER_SEC);
      closeAll(clients);
    });

    test('bots at different speeds finish in the right order', async () => {
      const { clients } = await makeRoom(server, ['Fast', 'Mid', 'Slow']);
      const ended = clients[0].waitFor(EVENTS.RACE_END, () => true, 15000);
      const start = await startRace(clients, 120);
      const bots = [
        new TypingBot(clients[0], { cps: 18 }),
        new TypingBot(clients[1], { cps: 11, errorEvery: 12 }),
        new TypingBot(clients[2], { cps: 6 }),
      ];
      bots.forEach((b) => b.start(start.passage.text));
      const result = await ended;
      bots.forEach((b) => b.stop());

      assert.equal(result.reason, 'all_finished');
      assert.deepEqual(result.rows.map((r) => r.nickname), ['Fast', 'Mid', 'Slow']);
      assert.deepEqual(result.rows.map((r) => r.position), [1, 2, 3]);
      assert.ok(result.rows.every((r) => r.finished));
      assert.ok(result.rows[0].netWpm > result.rows[1].netWpm && result.rows[1].netWpm > result.rows[2].netWpm);
      assert.equal(result.rows[0].accuracy, 1);
      assert.ok(result.rows[1].accuracy < 1, 'error bot loses accuracy');
      assert.ok(result.rows[1].rawWpm > result.rows[1].netWpm, 'raw counts mistakes too');
      assert.ok(result.rows[2].samples.length >= 1, 'per-second WPM samples recorded');

      const finishedEvents = clients[0].received(EVENTS.PLAYER_FINISHED);
      assert.deepEqual(finishedEvents.map((e) => e.position), [1, 2, 3]);
      assert.equal(bots.flatMap((b) => b.rejections).length, 0, 'honest bots never rejected');

      const records = server.repository.all().slice(-3);
      assert.deepEqual(Object.keys(records[0]).sort(), [
        'accuracy', 'durationSec', 'netWpm', 'nickname', 'passageId', 'playerId', 'position', 'rawWpm', 'timestamp',
      ]);
      assert.equal(records[0].durationSec, 120);
      closeAll(clients);
    });

    test('time-up ranking: most correct chars, tie broken by accuracy', async () => {
      const { clients } = await makeRoom(server, ['Clean', 'Sloppy', 'Behind']);
      const ended = clients[0].waitFor(EVENTS.RACE_END, () => true, 8000);
      const startAt = Date.now();
      await startRace(clients, 30);
      await sleep(400);
      // Same correct characters for Clean and Sloppy, but Sloppy needed more keystrokes.
      await clients[0].emit(EVENTS.PROGRESS, { correctIndex: 10, errorCount: 0, keystrokes: 10 });
      await clients[1].emit(EVENTS.PROGRESS, { correctIndex: 10, errorCount: 4, keystrokes: 14 });
      await clients[2].emit(EVENTS.PROGRESS, { correctIndex: 5, errorCount: 0, keystrokes: 5 });
      const result = await ended;
      assert.equal(result.reason, 'time');
      assert.ok(Date.now() - startAt >= 30 * MS_PER_SEC);
      assert.deepEqual(result.rows.map((r) => r.nickname), ['Clean', 'Sloppy', 'Behind']);
      assert.ok(result.rows.every((r) => !r.finished));
      closeAll(clients);
    });

    test('cheats are rejected: jumps, going backward, impossible counters, impossible speed', async () => {
      const longServer = await startServer({
        countdownMs: 300,
        countdownLeadMs: 0,
        msPerRaceSecond: MS_PER_SEC,
        passages: [{ id: 'long', kind: 'prose', text: LONG }],
      });
      const { clients } = await makeRoom(longServer, ['Cheat', 'Honest']);
      const [cheat] = clients;
      await startRace(clients, 120);
      await sleep(50);

      const jump = await cheat.emit(EVENTS.PROGRESS, { correctIndex: 40, errorCount: 0, keystrokes: 40 });
      assert.deepEqual(jump, { ok: false, reason: 'too_many_chars' });
      const rejectedEvent = cheat.events.find((e) => e.event === EVENTS.ERROR && e.payload.code === ERROR_CODES.PROGRESS_REJECTED);
      assert.ok(rejectedEvent);

      const ok = await cheat.emit(EVENTS.PROGRESS, { correctIndex: 5, errorCount: 0, keystrokes: 5 });
      assert.equal(ok.ok, true);
      const back = await cheat.emit(EVENTS.PROGRESS, { correctIndex: 3, errorCount: 0, keystrokes: 6 });
      assert.equal(back.reason, 'backward');
      const mismatch = await cheat.emit(EVENTS.PROGRESS, { correctIndex: 12, errorCount: 0, keystrokes: 8 });
      assert.equal(mismatch.reason, 'keystroke_mismatch');
      const junk = await cheat.emit(EVENTS.PROGRESS, { correctIndex: '9', errorCount: 0, keystrokes: 9 });
      assert.equal(junk.reason, 'invalid_values');

      // 8 chars per call is under the per-tick cap, but sustained it is far over 300 WPM.
      let idx = 5;
      let reason = null;
      for (let i = 0; i < 20 && !reason; i++) {
        idx += 8;
        const r = await cheat.emit(EVENTS.PROGRESS, { correctIndex: idx, errorCount: 0, keystrokes: idx });
        if (!r.ok) reason = r.reason;
      }
      assert.equal(reason, 'too_fast');

      const update = await clients[1].waitFor(EVENTS.RACE_UPDATE);
      const cheatRow = update.players.find((p) => p.id === cheat.playerId);
      assert.ok(cheatRow.correctIndex < 40 || cheatRow.correctIndex === idx - 8, 'server never took the jump');
      closeAll(clients);
      await longServer.close();
    });

    test('stall: a stalled racer is broadcast as stalled and does not move', async () => {
      const { clients } = await makeRoom(server, ['Stuck', 'Other']);
      await startRace(clients, 120);
      await sleep(50);
      await clients[0].emit(EVENTS.PROGRESS, { correctIndex: 4, errorCount: 1, keystrokes: 5, stalled: true });
      const update = await clients[1].waitFor(EVENTS.RACE_UPDATE, (u) => u.players.some((p) => p.stalled));
      const row = update.players.find((p) => p.id === clients[0].playerId);
      assert.equal(row.stalled, true);
      assert.equal(row.correctIndex, 4);
      closeAll(clients);
    });

    test('kicking a racer during a race marks them DNF and blocks further input', async () => {
      const { code, clients } = await makeRoom(server, ['Host', 'Guest']);
      await startRace(clients, 120);
      const kicked = clients[1].waitFor(EVENTS.ROOM_KICKED);
      const removed = await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: clients[1].playerId });
      assert.equal(removed.ok, true);
      await kicked;

      const state = await clients[0].waitForState(
        (s) => s.race?.progress[clients[1].playerId]?.dnf === true,
      );
      assert.equal(state.players.find((p) => p.id === clients[1].playerId).connected, false);
      const progress = await clients[1].emit(EVENTS.PROGRESS, { correctIndex: 1, errorCount: 0, keystrokes: 1 });
      assert.equal(progress.code, ERROR_CODES.NOT_IN_ROOM);
      const rejoin = await clients[1].join(code);
      assert.equal(rejoin.code, ERROR_CODES.PLAYER_KICKED);
      closeAll(clients);
    });

    test('rematch returns to the lobby with ready reset, and a second race works', async () => {
      const { clients } = await makeRoom(server, ['Ann', 'Ben']);
      const ended = clients[0].waitFor(EVENTS.RACE_END, () => true, 10000);
      const start = await startRace(clients, 120);
      const bots = clients.map((c) => new TypingBot(c, { cps: 20 }));
      bots.forEach((b) => b.start(start.passage.text));
      await ended;
      await clients[0].waitForState((s) => s.phase === PHASE.RESULTS && s.results);

      const res = await clients[1].emit(EVENTS.REMATCH);
      assert.equal(res.ok, true);
      const lobby = await clients[0].waitForState((s) => s.phase === PHASE.LOBBY);
      assert.ok(lobby.players.every((p) => !p.ready));
      assert.equal(lobby.results, null);
      assert.equal(lobby.duration, 120, 'timer choice survives a rematch');

      const again = await startRace(clients);
      assert.ok(again.startAt > start.startAt);
      const state = await clients[0].waitForState((s) => s.phase === PHASE.RACING);
      assert.equal(state.race.progress[clients[0].playerId].correctIndex, 0);
      closeAll(clients);
    });

    test('every timer option sets the race length', async () => {
      for (const duration of DURATIONS) {
        const { clients } = await makeRoom(server, ['Ann', 'Ben']);
        const start = await startRace(clients, duration);
        assert.equal(start.duration, duration);
        assert.equal(start.endsAt - start.startAt, duration * MS_PER_SEC);
        closeAll(clients);
      }
    });

    test('mid-race disconnect: car freezes, DNF after grace, result kept', async () => {
      const { clients } = await makeRoom(server, ['Stay', 'Drop']);
      const ended = clients[0].waitFor(EVENTS.RACE_END, () => true, 10000);
      const start = await startRace(clients, 120);
      await sleep(50);
      await clients[1].emit(EVENTS.PROGRESS, { correctIndex: 8, errorCount: 0, keystrokes: 8 });
      await sleep(150);
      clients[1].disconnect();
      const bot = new TypingBot(clients[0], { cps: 20 });
      bot.start(start.passage.text);
      const result = await ended;
      const drop = result.rows.find((r) => r.nickname === 'Drop');
      assert.equal(drop.dnf, true);
      assert.equal(drop.correctChars, 8);
      assert.equal(drop.position, 2);
      closeAll(clients);
    });

    test('progress outside a race is ignored with an error', async () => {
      const { clients } = await makeRoom(server, ['Ann', 'Ben']);
      const res = await clients[0].emit(EVENTS.PROGRESS, { correctIndex: 1, errorCount: 0, keystrokes: 1 });
      assert.equal(res.code, ERROR_CODES.INVALID_PHASE);
      const rematch = await clients[0].emit(EVENTS.REMATCH);
      assert.equal(rematch.code, ERROR_CODES.INVALID_PHASE);
      closeAll(clients);
    });
  });

  test('a long passage cannot be finished in 30 seconds at 120 WPM', () => {
    assert.ok(LONG.length > (120 * 5 * 30) / 60);
  });
});
