import { useNavigate } from 'react-router-dom';
import NicknameForm from '../components/NicknameForm.jsx';
import { saveNickname } from '../lib/identity.js';
import { useRoom } from '../state/RoomContext.jsx';
import styles from './Landing.module.css';

const STEPS = [
  'Create a race and copy the link',
  'Send it to 1-2 friends',
  'Everyone taps Ready',
  'After 3-2-1-GO, type to drive. Wrong key = your car stops until you fix it',
  'First to the finish wins',
];

export default function Landing() {
  const navigate = useNavigate();
  const { createRoom, pushNotice } = useRoom();

  async function handleCreate(nickname) {
    saveNickname(nickname);
    try {
      const code = await createRoom(nickname);
      navigate(`/r/${code}`);
    } catch {
      pushNotice('Could not create a race. Check your connection and try again.', 'warn');
    }
  }

  return (
    <div className={`${styles.page} fade-in`}>
      <section className={styles.hero}>
        <h1 className={styles.title}>
          Type to drive.
          <br />
          <span className={styles.accent}>Miss a key, stall out.</span>
        </h1>
        <p className={styles.lede}>A quick typing race for you and up to two friends. No sign up, just a link.</p>

        <div className={styles.strip} aria-hidden="true">
          <div className={styles.dashes} />
          <div className={styles.car} />
          <div className={styles.flag} />
        </div>

        <NicknameForm submitLabel="Create race" busyLabel="Creating..." onSubmit={handleCreate} />
      </section>

      <aside className={styles.howto} aria-labelledby="howto-title">
        <h2 id="howto-title" className={styles.howtoTitle}>
          How to play
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((step, i) => (
            <li key={step} className={styles.step}>
              <span className={styles.stepNum}>{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
