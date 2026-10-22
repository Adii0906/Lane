import { useEffect, useRef, useState } from 'react';
import { PHASE } from '@shared/index.js';
import { sound } from '../lib/sound.js';
import { useRoom } from '../state/RoomContext.jsx';
import Countdown from './Countdown.jsx';
import Hud from './Hud.jsx';
import Track from './Track.jsx';
import TypingArea from './TypingArea.jsx';
import styles from './Race.module.css';

const ordinal = (n) => ['1st', '2nd', '3rd'][n - 1] ?? `${n}th`;

export default function Race() {
  const { room, me, now, playerId, lastFinish, pushNotice } = useRoom();
  const typingRef = useRef(null);
  const isRacing = room.phase === PHASE.RACING;
  const startAt = room.race?.startAt ?? room.countdownEndsAt;
  const seed = room.race?.progress?.[playerId] ?? null;
  const [go, setGo] = useState(() => isRacing && now() >= startAt);

  useEffect(() => {
    if (!isRacing) {
      setGo(false);
      return undefined;
    }
    const wait = startAt - now();
    if (wait <= 0) {
      setGo(true);
      return undefined;
    }
    const id = setTimeout(() => setGo(true), wait);
    return () => clearTimeout(id);
  }, [isRacing, startAt, now]);

  useEffect(() => {
    if (!lastFinish) return;
    if (lastFinish.playerId === playerId) {
      sound.finish();
      pushNotice(`You finished ${ordinal(lastFinish.position)}!`);
    } else {
      pushNotice(`${lastFinish.nickname} finished ${ordinal(lastFinish.position)}`);
    }
  }, [lastFinish, playerId, pushNotice]);

  const focusTyping = () => typingRef.current?.focus();
  const canType = Boolean(me) && isRacing && go && !seed?.dnf;

  return (
    <div className={styles.race}>
      <Hud />
      <div className={styles.trackWrap} onPointerUp={focusTyping}>
        <Track players={room.players} localId={playerId} />
        <Countdown endsAt={startAt} phase={room.phase} />
      </div>

      {me && room.passage ? (
        <TypingArea
          key={`${startAt}-${room.passage.id}`}
          ref={typingRef}
          passage={room.passage}
          seed={seed}
          active={canType}
          waiting={!go}
        />
      ) : (
        <p className={styles.spectating}>
          You are spectating this race. You can join the next one from the lobby.
        </p>
      )}
    </div>
  );
}
