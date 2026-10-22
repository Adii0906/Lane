import { CAR_COLORS } from '@shared/constants.js';

export const PAINT = '#F1EEE4';
export const ASPHALT = '#1E2024';
export const ERROR_RED = '#E5484D';

export const carHex = (id) => CAR_COLORS.find((c) => c.id === id)?.hex ?? PAINT;

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two hex colors, k in [0, 1]. */
export function mix(a, b, k) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
