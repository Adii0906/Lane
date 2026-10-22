// Canvas race track. Deliberately NOT driven by React state: a requestAnimationFrame loop reads
// the latest race_update from a ref every frame. React only re-renders this when the racer list changes.

import { memo, useEffect, useRef } from 'react';
import { PHASE } from '@shared/index.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { TrackRenderer } from '../lib/trackRenderer.js';
import { sound } from '../lib/sound.js';
import { useRoom } from '../state/RoomContext.jsx';
import styles from './Track.module.css';

function Track({ players, localId }) {
  const canvasRef = useRef(null);
  const { raceRef, room } = useRoom();
  const reducedMotion = useReducedMotion();

  // Values the RAF loop reads; updated on render without restarting the loop.
  const liveRef = useRef({});
  liveRef.current = { players, localId, reducedMotion, phase: room.phase };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const renderer = new TrackRenderer(ctx);

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(width, height, dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    window.addEventListener('resize', fit);

    let raf = 0;
    let last = performance.now();
    const loop = (t) => {
      const dt = (t - last) / 1000;
      last = t;
      const live = liveRef.current;
      const racing = live.phase === PHASE.RACING;
      renderer.frame(dt, {
        players: live.players,
        localId: live.localId,
        reducedMotion: live.reducedMotion,
        racing,
        update: raceRef.current.update,
        localStalled: racing && raceRef.current.local?.stalled,
      });
      const isRacer = live.players.some((p) => p.id === live.localId);
      sound.setEngine(renderer.viewSpeed ?? 0, racing && isRacer);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', fit);
      sound.setEngine(0, false);
    };
  }, [raceRef]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      role="img"
      aria-label={`Race track with ${players.length} cars`}
    />
  );
}

export default memo(Track);
