import { memo } from 'react';
import { carHex } from '../lib/colors.js';
import styles from './PlayerCard.module.css';

function PlayerCard({ player, lane, isYou = false }) {
  if (!player) {
    return (
      <div className={`${styles.card} ${styles.empty}`}>
        <span className={styles.lane}>Lane {lane}</span>
        <span className={styles.waiting}>Waiting for friends...</span>
      </div>
    );
  }

  const color = carHex(player.color);
  return (
    <div
      className={`${styles.card} ${player.ready ? styles.isReady : ''} ${player.connected ? '' : styles.offline}`}
      style={{ '--car': color }}
    >
      <div className={styles.head}>
        <span className={styles.lane}>Lane {lane}</span>
        <span className={styles.badges}>
          {player.isHost && <span className={styles.badge}>Host</span>}
          {isYou && <span className={`${styles.badge} ${styles.you}`}>You</span>}
        </span>
      </div>
      <div className={styles.body}>
        <span className={styles.swatch} aria-hidden="true" />
        <span className={styles.name}>{player.nickname}</span>
      </div>
      <div className={styles.state}>
        {!player.connected ? (
          'Reconnecting...'
        ) : player.ready ? (
          <>
            <span className={styles.check} aria-hidden="true" /> Ready
          </>
        ) : (
          'Not ready'
        )}
      </div>
    </div>
  );
}

export default memo(PlayerCard);
