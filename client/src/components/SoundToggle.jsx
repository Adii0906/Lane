import { useSyncExternalStore } from 'react';
import { sound } from '../lib/sound.js';
import styles from './SoundToggle.module.css';

export default function SoundToggle() {
  const enabled = useSyncExternalStore(sound.subscribe, sound.getEnabled, () => false);
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={enabled}
      onClick={() => sound.setEnabled(!enabled)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {enabled ? (
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <span>{enabled ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}
