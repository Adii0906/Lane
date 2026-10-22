import { useId, useState } from 'react';
import { NICKNAME_MAX } from '@shared/constants.js';
import { cleanNickname, getNickname, nicknameError } from '../lib/identity.js';
import styles from './NicknameForm.module.css';

/** Nickname input + primary action. Used on the landing page and the room join gate. */
export default function NicknameForm({ submitLabel, busyLabel, onSubmit, autoFocus = false }) {
  const [name, setName] = useState(getNickname);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const error = nicknameError(name);
  const showError = touched && error;

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (error || busy) return;
    setBusy(true);
    try {
      await onSubmit(cleanNickname(name));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId} className={styles.label}>
        Your nickname
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          className={styles.input}
          value={name}
          maxLength={NICKNAME_MAX + 4}
          autoComplete="nickname"
          autoCapitalize="words"
          spellCheck={false}
          placeholder="e.g. Turbo"
          autoFocus={autoFocus}
          aria-invalid={Boolean(showError)}
          aria-describedby={showError ? errorId : undefined}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
      <p id={errorId} className={styles.error} role={showError ? 'alert' : undefined}>
        {showError ? error : ' '}
      </p>
    </form>
  );
}
