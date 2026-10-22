import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useRoom } from '../state/RoomContext.jsx';
import SoundToggle from './SoundToggle.jsx';
import styles from './AppShell.module.css';

export default function AppShell({ children }) {
  const { connection, notice, dismissNotice, room } = useRoom();

  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(dismissNotice, 4200);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo} aria-label="Lane home">
          <span className={styles.logoMark} aria-hidden="true" />
          Lane
        </Link>
        <div className={styles.headerRight}>
          {room && (
            <span className={styles.code} aria-label={`Room code ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
          )}
          <SoundToggle />
        </div>
      </header>

      {connection === 'offline' && (
        <div className={styles.banner} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          Connection lost. Reconnecting...
        </div>
      )}

      <main className={styles.main}>{children}</main>

      <div className={styles.toastRegion} aria-live="polite">
        {notice && (
          <button
            key={notice.id}
            type="button"
            className={`${styles.toast} ${notice.tone === 'warn' ? styles.toastWarn : ''}`}
            onClick={dismissNotice}
          >
            {notice.text}
          </button>
        )}
      </div>
    </div>
  );
}
