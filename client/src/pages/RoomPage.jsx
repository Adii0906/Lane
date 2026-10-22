import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ERROR_CODES, PHASE } from '@shared/index.js';
import Lobby from '../components/Lobby.jsx';
import NicknameForm from '../components/NicknameForm.jsx';
import Race from '../components/Race.jsx';
import Results from '../components/Results.jsx';
import { getNickname, saveNickname } from '../lib/identity.js';
import { useRoom } from '../state/RoomContext.jsx';
import styles from './RoomPage.module.css';

export default function RoomPage() {
  const { roomId = '' } = useParams();
  const code = roomId.toUpperCase();
  const [nickname, setNickname] = useState(getNickname);
  const { room, joinStatus, joinRoom, leaveRoom, retryJoin } = useRoom();

  const screen = !room ? 'none' : room.phase === PHASE.COUNTDOWN || room.phase === PHASE.RACING ? 'race' : room.phase;
  useEffect(() => {
    window.scrollTo(0, 0); // each phase starts at the top
  }, [screen]);

  useEffect(() => {
    if (!nickname) return undefined;
    joinRoom(code, nickname);
    return () => leaveRoom(code);
  }, [code, nickname, joinRoom, leaveRoom]);

  if (!nickname || joinStatus.error === ERROR_CODES.INVALID_NICKNAME) {
    return (
      <section className={`${styles.gate} fade-in`}>
        <p className={styles.kicker}>You are invited to race</p>
        <h1 className={styles.gateTitle}>Room {code}</h1>
        <p className={styles.muted}>Pick a nickname so your friends know which car is yours.</p>
        <NicknameForm
          autoFocus
          submitLabel="Join race"
          busyLabel="Joining..."
          onSubmit={(name) => {
            saveNickname(name);
            if (name === nickname) retryJoin(code, name);
            setNickname(name);
          }}
        />
      </section>
    );
  }

  if (joinStatus.error === ERROR_CODES.ROOM_NOT_FOUND) {
    return (
      <Message title="Room not found" body={`There is no race with the code ${code}. It may have expired after being empty for a while.`}>
        <Link to="/" className={styles.primary}>
          Create a new race
        </Link>
      </Message>
    );
  }

  if (joinStatus.error === ERROR_CODES.SESSION_REPLACED) {
    return (
      <Message title="Opened in another tab" body="This race is now active in a different tab or window.">
        <button type="button" className={styles.primary} onClick={() => retryJoin(code, nickname)}>
          Race in this tab instead
        </button>
      </Message>
    );
  }

  if (!room || room.code !== code) {
    return (
      <div className={styles.loading} role="status">
        <span className={styles.loadingCar} aria-hidden="true" />
        Joining room {code}...
      </div>
    );
  }

  const isRaceScreen = room.phase === PHASE.COUNTDOWN || room.phase === PHASE.RACING;
  return (
    <div key={isRaceScreen ? 'race' : room.phase} className="fade-in">
      {room.phase === PHASE.LOBBY && <Lobby />}
      {isRaceScreen && <Race />}
      {room.phase === PHASE.RESULTS && <Results />}
    </div>
  );
}

function Message({ title, body, children }) {
  return (
    <section className={`${styles.gate} fade-in`}>
      <h1 className={styles.gateTitle}>{title}</h1>
      <p className={styles.muted}>{body}</p>
      <div>{children}</div>
    </section>
  );
}
