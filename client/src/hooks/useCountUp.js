import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './useReducedMotion.js';

/** Tweens a displayed number toward `target`. Snaps instantly under reduced motion. */
export function useCountUp(target, duration = 500) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (prefersReducedMotion() || duration <= 0) {
      valueRef.current = target;
      setValue(target);
      return undefined;
    }
    fromRef.current = valueRef.current;
    const start = performance.now();
    let raf = 0;
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      const v = fromRef.current + (target - fromRef.current) * eased;
      valueRef.current = v;
      setValue(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
