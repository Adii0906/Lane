// Manual helper: drop typing bots into a room so you can race them in the browser alone.
//
//   node server/scripts/bots.js <ROOMCODE> [wpm ...] [--url http://localhost:3001]
//   e.g. node server/scripts/bots.js K7QX 45 70
//
// Each bot joins, readies up, waits for GO, then types at the given WPM with occasional mistakes.
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { EVENTS, PROGRESS_INTERVAL_MS, backspace, createTypingState, typeChar } from '../../shared/index.js';

const args = process.argv.slice(2);
const urlFlag = args.indexOf('--url');
const url = urlFlag >= 0 ? args.splice(urlFlag, 2)[1] : 'http://localhost:3001';
const [roomId, ...speeds] = args;
if (!roomId) {
  console.log('usage: node server/scripts/bots.js <ROOMCODE> [wpm ...] [--url http://localhost:3001]');
  process.exit(1);
}
const wpms = speeds.length ? speeds.map(Number) : [50];

function runBot(wpm, n) {
  const socket = io(url, { transports: ['websocket'] });
  const playerId = randomUUID();
  const nickname = `Bot ${n} (${wpm})`;
  let typing = null;
  let timer = null;

  socket.on('connect', async () => {
    const res = await socket.emitWithAck(EVENTS.JOIN_ROOM, { roomId, playerId, nickname });
    if (!res.ok) {
      console.log(`${nickname}: join failed (${res.code})`);
      return socket.close();
    }
    console.log(`${nickname}: joined as ${res.role}`);
    if (res.role === 'racer') socket.emit(EVENTS.SET_READY, { ready: true });
  });

  socket.on(EVENTS.ROOM_STATE, (state) => {
    if (state.phase === 'LOBBY' && timer === null) {
      const me = state.players.find((p) => p.id === playerId);
      if (me && !me.ready) socket.emit(EVENTS.SET_READY, { ready: true });
    }
  });

  socket.on(EVENTS.RACE_START, ({ passage, startAt }) => {
    typing = createTypingState();
    let budget = 0;
    const cps = (wpm * 5) / 60;
    setTimeout(() => {
      timer = setInterval(() => {
        budget += (cps * PROGRESS_INTERVAL_MS) / 1000;
        while (budget >= 1 && typing.index < passage.text.length) {
          budget -= 1;
          if (typing.wrong !== null) typing = backspace(typing).state;
          else if (Math.random() < 0.03) typing = typeChar(typing, passage.text, '#').state;
          else typing = typeChar(typing, passage.text, passage.text[typing.index]).state;
        }
        socket.emit(EVENTS.PROGRESS, {
          correctIndex: typing.index,
          errorCount: typing.errors,
          keystrokes: typing.keystrokes,
          stalled: typing.wrong !== null,
        });
      }, PROGRESS_INTERVAL_MS);
    }, Math.max(0, startAt - Date.now()));
  });

  socket.on(EVENTS.RACE_END, () => {
    clearInterval(timer);
    timer = null;
    console.log(`${nickname}: race over`);
  });
}

wpms.forEach((wpm, i) => runBot(wpm, i + 1));
