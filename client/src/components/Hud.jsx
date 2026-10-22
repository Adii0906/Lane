import { PHASE } from '@shared/index.js';
import { useCountUp } from '../hooks/useCountUp.js';
import { useServerClock } from '../hooks/useServerClock.js';
import { useRaceHud, useRoom } from '../state/RoomContext.jsx';
import styles from './Hud.module.css';

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Live position: finishers by finish order, everyone else by progress. */
function placeOf(players, id) {
  const sorted = [...players].sort((a, b) => {
    if (a.finished && b.finished) return a.position - b.position;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.correctIndex - a.correctIndex;
  });
  return sorted.findIndex((p) => p.id === id) + 1;
}

export default function Hud() {
  const { room, playerId, me } = useRoom();
  const hud = useRaceHud();
  const racing = room.phase === PHASE.RACING;
  const t = useServerClock(200, racing);

  const remaining = racing ? room.race.endsAt - Math.max(t, room.race.startAt) : room.duration * 1000;
  const lowTime = racing && remaining <= 10000;

  const self = hud?.players.find((p) => p.id === playerId);
  const leader = hud?.players.reduce((best, p) => (!best || p.correctIndex > best.correctIndex ? p : best), null);
  const focus = self ?? leader;
  const speed = useCountUp(focus ? Math.round(focus.wpm) : 0, 350);
  const place = hud && me ? placeOf(hud.players, playerId) : null;

  return (
    <div className={styles.hud}>
      <div className={`${styles.cell} ${styles.timer} ${lowTime ? styles.low : ''}`}>
        <span className={styles.label}>Time</span>
        <span className={styles.value} role="timer" aria-live="off">
          {formatTime(remaining)}
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>{self ? 'Speed' : 'Leader speed'}</span>
        <span className={styles.value}>
          {Math.round(speed)}
          <small className={styles.unit}> wpm</small>
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.label}>{me ? 'Place' : 'Racers'}</span>
        <span className={styles.value}>
          {me ? (place ? `${place}/${room.players.length}` : '-') : room.players.length}
        </span>
      </div>
    </div>
  );
}
