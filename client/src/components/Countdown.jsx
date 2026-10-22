import { useEffect, useRef, useState } from 'react';
import { GO_FLASH_MS, PHASE } from '@shared/index.js';
import { sound } from '../lib/sound.js';
import { useRoom } from '../state/RoomContext.jsx';
import styles from './Countdown.module.css';

/** Big 3-2-1-GO driven entirely by the server-synced clock, so every player sees GO together. */
export default function Countdown({ endsAt, phase }) {
  const { now } = useRoom();
  const [label, setLabel] = useState(null);
  const lastRef = useRef(null);

  useEffect(() => {
    if (!endsAt) return undefined;
    let raf = 0;
    const tick = () => {
      const remaining = endsAt - now();
      let next = null;
      if (remaining > 0) next = String(Math.min(3, Math.ceil(remaining / 1000)));
      else if (remaining > -GO_FLASH_MS && (phase === PHASE.RACING || phase === PHASE.COUNTDOWN)) next = 'GO';
      if (next !== lastRef.current) {
        lastRef.current = next;
        setLabel(next);
        if (next) sound.beep(next === 'GO');
      }
      if (remaining > -GO_FLASH_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [endsAt, now, phase]);

  if (!label) return null;
  return (
    <div className={styles.overlay} aria-live="assertive">
      <span key={label} className={`${styles.number} ${label === 'GO' ? styles.go : ''}`}>
        {label === 'GO' ? 'GO!' : label}
      </span>
    </div>
  );
}
