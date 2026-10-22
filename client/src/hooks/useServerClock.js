import { useEffect, useState } from 'react';
import { useRoom } from '../state/RoomContext.jsx';

/** Server-synced "now", re-rendering every `intervalMs`. Use for countdowns and timers only. */
export function useServerClock(intervalMs = 250, active = true) {
  const { now } = useRoom();
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!active) return undefined;
    setT(now());
    const id = setInterval(() => setT(now()), intervalMs);
    return () => clearInterval(id);
  }, [now, intervalMs, active]);
  return t;
}
