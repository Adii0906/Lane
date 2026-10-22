import { randomUUID } from 'node:crypto';
import { io as connect } from 'socket.io-client';
import { EVENTS } from '../../shared/index.js';
import { createGameServer } from '../src/app.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startServer(overrides = {}) {
  const server = createGameServer({ logger: { error() {} }, ...overrides });
  const port = await server.listen(0);
  return { ...server, url: `http://localhost:${port}` };
}

/** A scriptable Socket.IO client that records everything it receives. */
export class TestClient {
  constructor(url, nickname, playerId = randomUUID()) {
    this.url = url;
    this.nickname = nickname;
    this.playerId = playerId;
    this.events = [];
    this.waiters = [];
    this.state = null;
    this.socket = null;
  }

  async connect() {
    this.socket = connect(this.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.onAny((event, payload) => {
      this.events.push({ event, payload });
      if (event === EVENTS.ROOM_STATE) this.state = payload;
      for (const w of [...this.waiters]) {
        if (w.event === event && w.pred(payload)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(payload);
        }
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('connect_error', reject);
    });
    return this;
  }

  emit(event, payload = {}) {
    return this.socket.timeout(2000).emitWithAck(event, payload);
  }

  waitFor(event, pred = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const waiter = { event, pred, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for ${event}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  waitForState(pred, timeoutMs = 3000) {
    if (this.state && pred(this.state)) return Promise.resolve(this.state);
    return this.waitFor(EVENTS.ROOM_STATE, pred, timeoutMs);
  }

  received(event) {
    return this.events.filter((e) => e.event === event).map((e) => e.payload);
  }

  async create() {
    const res = await this.emit(EVENTS.CREATE_ROOM, { playerId: this.playerId });
    return res.code;
  }

  async join(roomId) {
    const res = await this.emit(EVENTS.JOIN_ROOM, { roomId, playerId: this.playerId, nickname: this.nickname });
    if (res.ok) this.state = res.state;
    return res;
  }

  ready(ready = true) {
    return this.emit(EVENTS.SET_READY, { ready });
  }

  disconnect() {
    this.socket?.disconnect();
  }
}

export async function makeRoom(server, names) {
  const clients = [];
  for (const name of names) clients.push(await new TestClient(server.url, name).connect());
  const code = await clients[0].create();
  for (const c of clients) {
    const res = await c.join(code);
    if (!res.ok) throw new Error(`join failed: ${res.code}`);
  }
  return { code, clients };
}

export const closeAll = (clients) => clients.forEach((c) => c.disconnect());
