import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCountUp } from '../hooks/useCountUp.js';
import { carHex } from '../lib/colors.js';
import { useRoom } from '../state/RoomContext.jsx';
import WpmChart from './WpmChart.jsx';
import styles from './Results.module.css';

const ORDINAL = ['1st', '2nd', '3rd'];

function Stat({ label, value, suffix = '', decimals = 0 }) {
  const shown = useCountUp(value, 900);
  return (
    <div className={styles.stat}>
      <span className={styles.statValue}>
        {shown.toFixed(decimals)}
        {suffix && <small>{suffix}</small>}
      </span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export default function Results() {
  const { room, playerId, rematch, createRoom, pushNotice } = useRoom();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { rows, reason } = room.results;
  const winner = rows[0];
  const youWon = winner?.playerId === playerId;

  async function newRoom() {
    setBusy(true);
    try {
      const code = await createRoom();
      navigate(`/r/${code}`);
    } catch {
      pushNotice('Could not create a new room. Try again.', 'warn');
      setBusy(false);
    }
  }

  return (
    <div className={styles.results}>
      <header className={styles.head}>
        <p className={styles.kicker}>{reason === 'time' ? "Time's up" : 'Race complete'}</p>
        <h1 className={styles.title}>{youWon ? 'You win!' : `${winner?.nickname ?? 'Nobody'} wins`}</h1>
      </header>

      <ol className={styles.rows}>
        {rows.map((row, i) => (
          <li
            key={row.playerId}
            className={`${styles.row} ${i === 0 ? styles.first : ''}`}
            style={{ '--car': carHex(row.color), animationDelay: `${i * 90}ms` }}
          >
            <span className={styles.place}>{ORDINAL[row.position - 1] ?? row.position}</span>
            <span className={styles.who}>
              <span className={styles.swatch} aria-hidden="true" />
              <span className={styles.name}>
                {row.nickname}
                {row.playerId === playerId && <span className={styles.you}>You</span>}
              </span>
              <span className={styles.note}>
                {row.dnf ? 'Did not finish' : row.finished ? `Finished in ${(row.finishMs / 1000).toFixed(1)}s` : `${row.correctChars} chars`}
              </span>
            </span>
            <span className={styles.stats}>
              <Stat label="Net WPM" value={row.netWpm} />
              <Stat label="Raw WPM" value={row.rawWpm} />
              <Stat label="Accuracy" value={row.accuracy * 100} suffix="%" />
            </span>
          </li>
        ))}
      </ol>

      <section className={styles.chartCard} aria-labelledby="chart-title">
        <h2 id="chart-title" className={styles.chartTitle}>
          Speed over time
        </h2>
        <WpmChart rows={rows} />
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={rematch}>
          Race again
        </button>
        <button type="button" className={styles.secondary} onClick={newRoom} disabled={busy}>
          {busy ? 'Creating...' : 'New room'}
        </button>
      </div>
    </div>
  );
}
