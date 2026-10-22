import { useEffect, useRef, useState } from 'react';
import styles from './InviteBox.module.css';

export default function InviteBox({ code }) {
  const link = `${window.location.origin}/r/${code}`;
  const [copied, setCopied] = useState(false);
  const inputRef = useRef(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      inputRef.current?.select(); // fallback: let the player copy manually
      try {
        setCopied(document.execCommand('copy'));
      } catch {
        /* nothing else to try */
      }
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Lane typing race', text: `Race me on Lane! Room ${code}`, url: link });
    } catch {
      /* user cancelled */
    }
  }

  return (
    <div className={styles.box}>
      <label className={styles.label} htmlFor="invite-link">
        Invite friends
      </label>
      <div className={styles.row}>
        <input
          ref={inputRef}
          id="invite-link"
          className={styles.link}
          value={link}
          readOnly
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className={styles.button} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {canShare && (
          <button type="button" className={`${styles.button} ${styles.share}`} onClick={share}>
            Share
          </button>
        )}
      </div>
    </div>
  );
}
