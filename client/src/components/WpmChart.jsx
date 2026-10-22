import { memo } from 'react';
import { carHex } from '../lib/colors.js';
import styles from './WpmChart.module.css';

const W = 640;
const H = 220;
const PAD = { top: 14, right: 16, bottom: 30, left: 40 };

function niceMax(v) {
  const step = v > 100 ? 40 : 20;
  return Math.max(step * 2, Math.ceil(v / step) * step);
}

function WpmChart({ rows }) {
  const longest = Math.max(1, ...rows.map((r) => r.samples.length));
  const peak = Math.max(0, ...rows.flatMap((r) => r.samples));
  const yMax = niceMax(peak);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (longest === 1 ? 0 : (i / (longest - 1)) * plotW);
  const y = (v) => PAD.top + plotH - (v / yMax) * plotH;
  const yTicks = [0, yMax / 2, yMax];
  const xStep = longest > 60 ? 30 : longest > 20 ? 10 : 5;
  const xTicks = [];
  for (let s = 0; s < longest; s += xStep) xTicks.push(s);

  if (peak === 0) return <p className={styles.empty}>Not enough typing to chart this race.</p>;

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="img" aria-label="Words per minute for each racer, sampled every second">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={styles.grid} />
            <text x={PAD.left - 8} y={y(t) + 4} className={styles.tick} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={x(s)} y={H - 8} className={styles.tick} textAnchor="middle">
            {s + 1}s
          </text>
        ))}
        {rows.map((r) =>
          r.samples.length > 1 ? (
            <polyline
              key={r.playerId}
              points={r.samples.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={carHex(r.color)}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
              className={styles.line}
            />
          ) : null,
        )}
      </svg>
      <ul className={styles.legend}>
        {rows.map((r) => (
          <li key={r.playerId} style={{ '--car': carHex(r.color) }}>
            <span className={styles.dot} aria-hidden="true" />
            {r.nickname}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default memo(WpmChart);
