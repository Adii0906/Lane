// PHASE 1 acceptance tests: rooms, invites, ready-up.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ERROR_CODES, EVENTS, PHASE, ROLE, ROOM_CODE_PATTERN } from '../../shared/index.js';
import { TestClient, closeAll, makeRoom, sleep, startServer } from './helpers.js';

let server;
before(async () => {
  server = await startServer({ countdownMs: 2000, countdownLeadMs: 0, graceMs: 400 });
});
after(async () => {
  await server.close();
});

describe('Phase 1: rooms, invites, ready-up', () => {
  test('room codes are 4 chars from the unambiguous alphabet', async () => {
    const c = await new TestClient(server.url, 'Coder').connect();
    for (let i = 0; i < 20; i++) {
      const code = await c.create();
      assert.match(code, ROOM_CODE_PATTERN);
      assert.doesNotMatch(code, /[01OI]/);
    }
    c.disconnect();
  });

  test('3 clients join as racers; the 4th becomes a spectator', async () => {
    const { code, clients } = await makeRoom(server, ['Ann', 'Ben', 'Cat']);
    const fourth = await new TestClient(server.url, 'Dan').connect();
    const res = await fourth.join(code);
    assert.equal(res.ok, true);
    assert.equal(res.role, ROLE.SPECTATOR);
    const state = await clients[0].waitForState((s) => s.spectatorCount === 1);
    assert.equal(state.players.length, 3);
    assert.deepEqual(new Set(state.players.map((p) => p.color)), new Set(['coral', 'teal', 'amber']));
    assert.equal(state.players[0].isHost, true);
    closeAll([...clients, fourth]);
  });

  test('the room creator becomes host immediately', async () => {
    const creator = await new TestClient(server.url, 'Creator').connect();
    const code = await creator.create();
    assert.equal(creator.state.players.length, 1);
    assert.equal(creator.state.players[0].id, creator.playerId);
    assert.equal(creator.state.hostId, creator.playerId);
    creator.disconnect();
    assert.match(code, ROOM_CODE_PATTERN);
  });

  test('the host can reclaim their room with the private admin token', async () => {
    const host = await new TestClient(server.url, 'Host').connect();
    const code = await host.create();
    const token = host.adminToken;
    assert.equal(typeof token, 'string');
    host.disconnect();

    const reconnected = await new TestClient(server.url, 'Host', host.playerId).connect();
    reconnected.adminToken = token;
    reconnected.sessionTokens.set(code, host.sessionTokens.get(code));
    const res = await reconnected.join(code);
    assert.equal(res.ok, true);
    assert.equal(res.state.hostId, reconnected.playerId);
    closeAll([host, reconnected]);
  });

  test('only the host can kick, and kicked racers must request rejoin approval', async () => {
    const { code, clients } = await makeRoom(server, ['Host', 'Guest', 'Third']);
    const takeover = await clients[1].emit(EVENTS.JOIN_ROOM, {
      roomId: code,
      playerId: clients[0].playerId,
      nickname: 'Host',
      sessionToken: clients[0].sessionTokens.get(code),
    });
    assert.equal(takeover.ok, false);
    assert.equal(takeover.code, ERROR_CODES.NOT_HOST);

    const denied = await clients[1].emit(EVENTS.KICK_PLAYER, { playerId: clients[2].playerId });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, ERROR_CODES.NOT_HOST);

    const kicked = clients[2].waitFor(EVENTS.ROOM_KICKED);
    const removed = await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: clients[2].playerId });
    assert.equal(removed.ok, true);
    await kicked;
    const state = await clients[0].waitForState((s) => s.players.length === 2);
    assert.equal(state.players.some((p) => p.id === clients[2].playerId), false);

    const rejoin = await clients[2].join(code);
    assert.equal(rejoin.ok, false);
    assert.equal(rejoin.code, ERROR_CODES.PLAYER_KICKED);
    assert.equal(rejoin.rejoinStatus, 'pending');
    const adminState = clients[0].adminState;
    assert.equal(adminState.rejoinRequests.filter((request) => request.id === clients[2].playerId).length, 1);
    const duplicate = await clients[2].join(code);
    assert.equal(duplicate.rejoinStatus, 'pending');
    assert.equal(clients[0].adminState.rejoinRequests.filter((request) => request.id === clients[2].playerId).length, 1);

    const anotherTab = await new TestClient(server.url, 'Guest', clients[2].playerId).connect();
    anotherTab.sessionTokens.set(code, clients[2].sessionTokens.get(code));
    const tabRequest = await anotherTab.join(code);
    assert.equal(tabRequest.rejoinStatus, 'pending');
    assert.equal(clients[0].adminState.rejoinRequests.filter((request) => request.id === clients[2].playerId).length, 1);
    closeAll([anotherTab]);
    closeAll(clients);
  });

  test('the host can decline and later approve a rejoin request', async () => {
    const { code, clients } = await makeRoom(server, ['Host', 'Guest']);
    const kickedEvent = clients[1].waitFor(EVENTS.ROOM_KICKED);
    await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: clients[1].playerId });
    await kickedEvent;

    const firstRequest = await clients[1].join(code);
    assert.equal(firstRequest.rejoinStatus, 'pending');
    const forgedIdentity = await new TestClient(server.url, 'Guest', clients[1].playerId).connect();
    const forgedRequest = await forgedIdentity.join(code);
    assert.equal(forgedRequest.code, ERROR_CODES.IDENTITY_INVALID);
    assert.equal(clients[0].adminState.rejoinRequests.filter((request) => request.id === clients[1].playerId).length, 1);
    forgedIdentity.disconnect();

    clients[1].nickname = 'New Name';
    const changedNameRequest = await clients[1].join(code);
    assert.equal(changedNameRequest.rejoinStatus, 'pending');
    assert.equal(clients[0].adminState.blockedPlayers.some((player) => player.id === clients[1].playerId), true);
    assert.equal(
      clients[0].adminState.rejoinRequests.find((request) => request.id === clients[1].playerId).nickname,
      'New Name',
    );

    const unauthorized = await clients[1].emit(EVENTS.APPROVE_REJOIN, { playerId: clients[1].playerId });
    assert.equal(unauthorized.code, ERROR_CODES.NOT_IN_ROOM);

    const declinedEvent = clients[1].waitFor(EVENTS.REJOIN_DECLINED);
    const declined = await clients[0].emit(EVENTS.DECLINE_REJOIN, { playerId: clients[1].playerId });
    assert.equal(declined.ok, true);
    await declinedEvent;
    const declinedJoin = await clients[1].join(code);
    assert.equal(declinedJoin.rejoinStatus, 'declined');
    assert.equal(clients[0].adminState.rejoinRequests.some((request) => request.id === clients[1].playerId), false);

    const requestedAgain = await clients[1].emit(EVENTS.REQUEST_REJOIN, {
      roomId: code,
      playerId: clients[1].playerId,
      nickname: clients[1].nickname,
      sessionToken: clients[1].sessionTokens.get(code),
      retry: true,
    });
    assert.deepEqual(requestedAgain, { ok: true, status: 'pending' });
    const approvedEvent = clients[1].waitFor(EVENTS.REJOIN_APPROVED);
    const approved = await clients[0].emit(EVENTS.APPROVE_REJOIN, { playerId: clients[1].playerId });
    assert.equal(approved.ok, true);
    await approvedEvent;

    const rejoined = await clients[1].join(code);
    assert.equal(rejoined.ok, true);
    assert.equal(rejoined.state.players.some((player) => player.id === clients[1].playerId), true);
    assert.equal(clients[0].adminState.blockedPlayers.some((player) => player.id === clients[1].playerId), false);
    closeAll(clients);
  });

  test('the host can unblock a declined player without a new request', async () => {
    const { code, clients } = await makeRoom(server, ['Host', 'Guest']);
    await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: clients[1].playerId });
    await clients[1].waitFor(EVENTS.ROOM_KICKED);
    await clients[1].join(code);
    await clients[0].emit(EVENTS.DECLINE_REJOIN, { playerId: clients[1].playerId });
    await clients[1].waitFor(EVENTS.REJOIN_DECLINED);

    const allowed = await clients[0].emit(EVENTS.UNBLOCK_PLAYER, { playerId: clients[1].playerId });
    assert.equal(allowed.ok, true);
    const rejoined = await clients[1].join(code);
    assert.equal(rejoined.ok, true);
    closeAll(clients);
  });

  test('the host can remove a spectator from the invite link', async () => {
    const { code, clients } = await makeRoom(server, ['Host', 'Guest', 'Third']);
    const watcher = await new TestClient(server.url, 'Watcher').connect();
    await watcher.join(code);
    const kicked = watcher.waitFor(EVENTS.ROOM_KICKED);
    const removed = await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: watcher.playerId });
    assert.equal(removed.ok, true);
    await kicked;
    const state = await clients[0].waitForState((s) => s.spectatorCount === 0);
    assert.equal(state.spectators.some((p) => p.id === watcher.playerId), false);
    closeAll([...clients, watcher]);
  });

  test('kicking a racer during countdown cancels the start', async () => {
    const { clients } = await makeRoom(server, ['Host', 'Guest']);
    await clients[0].ready(true);
    const cancel = clients[0].waitFor(EVENTS.COUNTDOWN_CANCEL);
    await clients[1].ready(true);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);

    const kicked = clients[1].waitFor(EVENTS.ROOM_KICKED);
    await clients[0].emit(EVENTS.KICK_PLAYER, { playerId: clients[1].playerId });
    await Promise.all([cancel, kicked]);
    const state = await clients[0].waitForState((s) => s.phase === PHASE.LOBBY && s.players.length === 1);
    assert.equal(state.hostId, clients[0].playerId);
    closeAll(clients);
  });

  test('a connected racer takes over when the host disconnects', async () => {
    const { clients } = await makeRoom(server, ['Host', 'Guest']);
    clients[0].disconnect();
    const state = await clients[1].waitForState((s) => s.hostId === clients[1].playerId);
    assert.equal(state.players.find((p) => p.id === clients[0].playerId).connected, false);
    closeAll(clients);
  });

  test('a single racer can toggle ready but the race never starts', async () => {
    const { clients } = await makeRoom(server, ['Solo']);
    const res = await clients[0].ready(true);
    assert.equal(res.ok, true);
    await sleep(250);
    assert.equal(clients[0].state.phase, PHASE.LOBBY);
    assert.equal(clients[0].state.players[0].ready, true);
    assert.equal(clients[0].received(EVENTS.COUNTDOWN).length, 0);
    closeAll(clients);
  });

  test('all racers ready starts the countdown automatically', async () => {
    const { clients } = await makeRoom(server, ['Ann', 'Ben']);
    await clients[0].ready(true);
    assert.equal(clients[0].state.phase, PHASE.LOBBY);
    const countdown = clients[1].waitFor(EVENTS.COUNTDOWN);
    await clients[1].ready(true);
    const payload = await countdown;
    assert.ok(payload.endsAt > Date.now());
    assert.ok(payload.passage.text.length > 300);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);
    closeAll(clients);
  });

  test('un-ready during countdown cancels it and returns to the lobby', async () => {
    const { clients } = await makeRoom(server, ['Ann', 'Ben', 'Cat']);
    for (const c of clients) await c.ready(true);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);
    const cancel = clients[0].waitFor(EVENTS.COUNTDOWN_CANCEL);
    await clients[2].ready(false);
    const { reason } = await cancel;
    assert.match(reason, /Cat/);
    const state = await clients[0].waitForState((s) => s.phase === PHASE.LOBBY);
    assert.equal(state.players.find((p) => p.nickname === 'Cat').ready, false);
    closeAll(clients);
  });

  test('disconnect during countdown cancels it', async () => {
    const { clients } = await makeRoom(server, ['Ann', 'Ben']);
    for (const c of clients) await c.ready(true);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);
    const cancel = clients[0].waitFor(EVENTS.COUNTDOWN_CANCEL);
    clients[1].disconnect();
    await cancel;
    await clients[0].waitForState((s) => s.phase === PHASE.LOBBY);
    closeAll(clients);
  });

  test('joining during countdown makes you a spectator', async () => {
    const { code, clients } = await makeRoom(server, ['Ann', 'Ben']);
    for (const c of clients) await c.ready(true);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);
    const late = await new TestClient(server.url, 'Late').connect();
    const res = await late.join(code);
    assert.equal(res.role, ROLE.SPECTATOR);
    assert.equal(clients[0].state.phase, PHASE.COUNTDOWN);
    closeAll([...clients, late]);
  });

  test('host leaves: the longest-present racer is promoted', async () => {
    const { clients } = await makeRoom(server, ['Host', 'Second', 'Third']);
    assert.equal(clients[0].state.hostId, clients[0].playerId);
    await clients[0].emit(EVENTS.LEAVE);
    const state = await clients[1].waitForState((s) => s.players.length === 2);
    assert.equal(state.hostId, clients[1].playerId);
    assert.equal(state.players.find((p) => p.id === clients[1].playerId).isHost, true);
    closeAll(clients);
  });

  test('spectator is promoted to racer when a lobby seat frees up', async () => {
    const { code, clients } = await makeRoom(server, ['Ann', 'Ben', 'Cat']);
    const watcher = await new TestClient(server.url, 'Dan').connect();
    await watcher.join(code);
    await clients[2].emit(EVENTS.LEAVE);
    const state = await watcher.waitForState((s) => s.players.some((p) => p.id === watcher.playerId));
    assert.equal(state.players.length, 3);
    assert.equal(state.spectatorCount, 0);
    closeAll([...clients, watcher]);
  });

  test('refresh within the grace period restores the same seat', async () => {
    const { code, clients } = await makeRoom(server, ['Ann', 'Ben']);
    const before = clients[1].state.players.find((p) => p.id === clients[1].playerId);
    clients[1].disconnect();
    await clients[0].waitForState((s) => s.players.some((p) => p.id === clients[1].playerId && !p.connected));

    const again = await new TestClient(server.url, 'Ben', clients[1].playerId).connect();
    again.sessionTokens.set(code, clients[1].sessionTokens.get(code));
    const res = await again.join(code);
    assert.equal(res.role, ROLE.RACER);
    const seat = res.state.players.find((p) => p.id === again.playerId);
    assert.equal(seat.color, before.color);
    assert.equal(seat.connected, true);
    assert.equal(res.state.players.length, 2);
    closeAll([...clients, again]);
  });

  test('after the grace period the seat is freed', async () => {
    const { clients } = await makeRoom(server, ['Ann', 'Ben']);
    clients[1].disconnect();
    const state = await clients[0].waitForState((s) => s.players.length === 1, 2000);
    assert.equal(state.players[0].id, clients[0].playerId);
    closeAll(clients);
  });

  test('only the host can change the timer, and only in the lobby', async () => {
    const { clients } = await makeRoom(server, ['Host', 'Guest']);
    assert.equal(clients[0].state.duration, 60);

    const denied = clients[1].waitFor(EVENTS.ERROR, (e) => e.code === ERROR_CODES.NOT_HOST);
    const res = await clients[1].emit(EVENTS.SET_DURATION, { duration: 30 });
    assert.equal(res.ok, false);
    await denied;
    assert.equal(clients[1].state.duration, 60);

    const bad = await clients[0].emit(EVENTS.SET_DURATION, { duration: 45 });
    assert.equal(bad.ok, false);

    await clients[0].emit(EVENTS.SET_DURATION, { duration: 90 });
    await clients[1].waitForState((s) => s.duration === 90);

    for (const c of clients) await c.ready(true);
    await clients[0].waitForState((s) => s.phase === PHASE.COUNTDOWN);
    const late = await clients[0].emit(EVENTS.SET_DURATION, { duration: 30 });
    assert.equal(late.ok, false);
    assert.equal(late.code, ERROR_CODES.INVALID_PHASE);
    closeAll(clients);
  });

  test('errors: unknown room, invalid nickname, invalid id', async () => {
    const c = await new TestClient(server.url, 'Ann').connect();
    const missing = await c.join('ZZZZ');
    assert.equal(missing.code, ERROR_CODES.ROOM_NOT_FOUND);
    const code = await c.create();
    const badName = await c.emit(EVENTS.JOIN_ROOM, { roomId: code, playerId: c.playerId, nickname: ' x ' });
    assert.equal(badName.code, ERROR_CODES.INVALID_NICKNAME);
    const badId = await c.emit(EVENTS.JOIN_ROOM, { roomId: code, playerId: 'admin', nickname: 'Ann' });
    assert.equal(badId.code, ERROR_CODES.BAD_REQUEST);
    const html = await c.emit(EVENTS.JOIN_ROOM, { roomId: code, playerId: c.playerId, nickname: '<b>Zed</b>' });
    assert.equal(html.ok, true);
    assert.equal(html.state.players[0].nickname, 'bZed/b');
    c.disconnect();
  });

  test('events from a non-member are rejected', async () => {
    const c = await new TestClient(server.url, 'Ann').connect();
    const res = await c.emit(EVENTS.SET_READY, { ready: true });
    assert.equal(res.code, ERROR_CODES.NOT_IN_ROOM);
    c.disconnect();
  });

  test('flooding a socket gets rate limited', async () => {
    const c = await new TestClient(server.url, 'Ann').connect();
    const results = await Promise.all(Array.from({ length: 60 }, () => c.emit(EVENTS.TIME_SYNC, { t0: 1 })));
    assert.ok(results.some((r) => r.ok === false && r.code === ERROR_CODES.RATE_LIMITED));
    c.disconnect();
  });
});
