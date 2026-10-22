# Lane

A real-time typing race for 2 to 3 friends. Correct typing drives your car. A wrong key stalls it until you fix the mistake with backspace. No login: share a link and race.

## Run locally

Requires Node 18.18 or newer.

```bash
npm i
npm run dev
```

- Client (Vite): http://localhost:5173
- Server (Express + Socket.IO): http://localhost:3001 (Vite proxies `/socket.io` to it)

Open the client in two browser windows (or a normal and a private window, so each gets its own guest id) to race yourself.

Racing alone? Drop bots into your room:

```bash
node server/scripts/bots.js <ROOMCODE> 45 70   # two bots at 45 and 70 WPM
```

## Tests

```bash
npm test
```

Runs the Phase 1 and Phase 2 acceptance suites against real in-process servers with real Socket.IO clients (race clocks are compressed so 30 to 120 second races finish in a few seconds).

| Suite | Covers |
| --- | --- |
| `server/test/phase1.rooms.test.js` | 3 racers join, 4th spectates, 1 player cannot start, all-ready starts countdown, un-ready and disconnect cancel it, join during countdown spectates, host promotion, spectator promotion, refresh restores seat, seat freed after grace, host-only timer, validation, rate limiting |
| `server/test/phase2.race.test.js` | stall mechanic and input reconciliation, passage rules, synced countdown, bots finishing in order, time-up ranking with accuracy tie-break, cheat rejection (jumps, backward, counter mismatch, over 300 WPM), stalled broadcast, rematch reset, every timer option, mid-race DNF |

## Production build

```bash
npm i
npm run build    # builds client/dist
npm start        # Express serves client/dist and Socket.IO on $PORT (default 3001)
```

`/` and `/r/:roomId` both return `index.html`; React Router takes over from there.

## Deploy to Render

1. Push this folder to a GitHub repo.
2. In Render: **New > Web Service**, connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Instance type:** any (Free works; it sleeps when idle, and since state is in memory, sleeping ends open rooms)
4. Leave `PORT` alone: Render sets it and the server reads it.
5. WebSockets need no extra setting: Render web services support them out of the box. Socket.IO falls back to long-polling if a network blocks WebSockets.
6. Run a **single instance**. Room state lives in memory, so scaling out needs the Redis step listed below.

## How it is built

```
/shared   constants, event names, metric formulas, typing engine (used by both sides)
/server   Express + Socket.IO; Room state machine; repository seam for persistence
/client   React + Vite; one RoomProvider owns the socket; Canvas track on requestAnimationFrame
```

- **Server is the source of truth.** Clients send intents (`set_ready`, `progress { correctIndex, errorCount, keystrokes }`). The server validates every event against the room phase, recomputes WPM on its own clock, rejects impossible progress, and decides positions and finish order.
- **State machine:** `LOBBY -> COUNTDOWN -> RACING -> RESULTS -> (rematch) LOBBY`, in `server/src/room.js`.
- **Clock sync:** on every connect the client runs 5 `time_sync` pings and keeps the offset from the fastest round trip. Countdown, GO and the race timer all derive from server timestamps plus that offset.
- **Rendering:** the track canvas never re-renders through React. A RAF loop reads the latest `race_update` from a ref and lerps each car toward its server position. HUD numbers come from a separate, throttled context so they never re-render the passage.
- **Typing:** one hidden input, diffed on every `input` event (works with mobile keyboards and IME bursts). The passage renders as three memoized chunks (typed / current word / untyped).

### Metric definitions

- correct chars: characters confirmed correct, counted by position
- net WPM = (correct chars / 5) / elapsed minutes
- raw WPM = (total keystrokes / 5) / elapsed minutes
- accuracy = correct keystrokes / total keystrokes
- speedometer and results chart: net WPM over a rolling 4 second window, sampled every second

### Assumptions I made

- Confirmed correct characters are locked: backspace only removes the stalled wrong key. This makes "index never goes backward" a hard server rule.
- While stalled, extra keys are ignored (not counted as keystrokes), so accuracy reflects mistakes, not frustration mashing.
- Joining during a countdown makes you a spectator and does not cancel it; joins that take a seat can only happen in the lobby, where they are not ready and so block the start anyway.
- The passage is sent with the `countdown` event so players can read the first words during 3-2-1; typing is still blocked until GO.
- Ranking puts DNF racers after everyone who was still connected at the end, ordered by their characters.
- Rematch can be triggered by anyone in the room. The timer choice carries over.
- A second tab with the same guest id takes over the seat; the old tab shows "Opened in another tab".

## Known limitations and next steps

- **In-memory only.** Restarting the server ends all rooms. Finished races go to `server/src/raceRepository.js` (in-memory array, capped at 10,000 records).
- **Single instance.** To scale out, add the Socket.IO Redis adapter and move room state into Redis (or pin rooms to nodes).
- **Anti-cheat is plausibility only.** It catches jumps, impossible speed and inconsistent counters, but cannot tell a fast human from a careful bot. Server-side per-keystroke replay would close that gap.
- **Fonts load from Google Fonts.** Self-host them if you need offline or strict CSP.
- **Login plugs in at the player id.** Guests already have a stable UUID in `localStorage` (`client/src/lib/identity.js`). An auth layer can map an account to that UUID on first login, so existing race history attaches to the account.
- **Saved stats** replace `createRaceRepository()` with a database-backed module exposing the same `saveRace / all / byPlayer` methods (for example Postgres with a `races` table matching the record shape). Nothing else changes.
- **Leaderboards** read from that table (best net WPM per player per passage or per duration) behind a new `GET /api/leaderboard` route in `server/src/app.js`.
