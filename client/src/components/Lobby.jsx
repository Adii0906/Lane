import { DURATIONS, MAX_RACERS, MIN_RACERS } from '@shared/constants.js';
import { useRoom } from '../state/RoomContext.jsx';
import InviteBox from './InviteBox.jsx';
import PlayerCard from './PlayerCard.jsx';
import styles from './Lobby.module.css';

export default function Lobby() {
  const { room, me, isHost, setReady, setDuration, playerId } = useRoom();
  const racers = room.players;
  const emptySlots = Math.max(0, MAX_RACERS - racers.length);
  const notReady = racers.filter((p) => !p.ready);

  let status;
  if (racers.length < MIN_RACERS) status = 'Need at least 2 players';
  else if (notReady.length === 0) status = 'Everyone is ready...';
  else if (notReady.length === 1 && notReady[0].id === playerId) status = 'Waiting for you';
  else status = `Waiting for ${notReady.map((p) => (p.id === playerId ? 'you' : p.nickname)).join(', ')}`;

  return (
    <div className={styles.lobby}>
      <div className={styles.top}>
        <div>
          <p className={styles.kicker}>Lobby</p>
          <h1 className={styles.title}>Get your friends on the grid</h1>
        </div>
        <InviteBox code={room.code} />
      </div>

      <section aria-label="Racers" className={styles.grid}>
        {racers.map((p, i) => (
          <PlayerCard key={p.id} player={p} lane={i + 1} isYou={p.id === playerId} />
        ))}
        {Array.from({ length: emptySlots }, (_, i) => (
          <PlayerCard key={`empty-${i}`} lane={racers.length + i + 1} />
        ))}
      </section>

      <div className={styles.controls}>
        <fieldset className={styles.timer} disabled={!isHost}>
          <legend className={styles.legend}>
            Race timer {isHost ? '' : <span className={styles.hostOnly}>(host picks)</span>}
          </legend>
          <div className={styles.segments} role="radiogroup" aria-label="Race timer">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={room.duration === d}
                className={styles.segment}
                onClick={() => isHost && setDuration(d)}
              >
                {d}s
              </button>
            ))}
          </div>
        </fieldset>

        <div className={styles.readyBlock}>
          {me ? (
            <button
              type="button"
              className={`${styles.ready} ${me.ready ? styles.readyOn : ''}`}
              aria-pressed={me.ready}
              onClick={() => setReady(!me.ready)}
            >
              <span className={styles.readyLight} aria-hidden="true" />
              {me.ready ? 'Ready!' : 'Tap when ready'}
            </button>
          ) : (
            <p className={styles.spectating}>You are watching. A seat opens if someone leaves.</p>
          )}
          <p className={styles.status} aria-live="polite">
            {status}
          </p>
        </div>
      </div>

      {room.spectatorCount > 0 && (
        <p className={styles.spectators}>
          {room.spectatorCount} {room.spectatorCount === 1 ? 'person is' : 'people are'} watching
        </p>
      )}
    </div>
  );
}
