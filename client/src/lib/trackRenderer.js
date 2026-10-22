// Canvas 2D race track. Pure drawing + per-frame simulation; no React in here.
// The Track component owns the RAF loop and feeds this renderer a snapshot every frame.

import { ASPHALT, ERROR_RED, PAINT, carHex, mix } from './colors.js';

const LANES = 3;
const CONFETTI_COLORS = ['#FF5A3C', '#2EC4B6', '#FFC93C', '#F1EEE4'];
const BG = '#26292E';
const STAND = '#31353C';
const STAND_DARK = '#2B2F35';
const ROAD = '#1E2024';
const ROAD_EDGE = '#17191C';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

export class TrackRenderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.w = 0;
    this.h = 0;
    this.cars = new Map();
    this.puffs = [];
    this.confetti = [];
    this.time = 0;
    this.scroll = 0;
    this.roadSpeed = 0; // px/s of the road scroll, eased
    this.celebrated = false;
    this.flagWave = 0;
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout = this.computeLayout();
  }

  computeLayout() {
    const { w, h } = this;
    const skyH = Math.round(h * 0.22);
    const curb = Math.max(6, Math.round(h * 0.035));
    const roadTop = skyH + curb;
    const roadBottom = h - curb;
    const laneH = (roadBottom - roadTop) / LANES;
    const carL = Math.round(Math.min(laneH * 1.62, w * 0.15, 110));
    const pad = Math.max(10, Math.round(w * 0.02));
    const startX = pad + carL + 6;
    const finishX = w - Math.max(26, Math.round(w * 0.05));
    return { skyH, curb, roadTop, roadBottom, laneH, carL, startX, finishX };
  }

  /**
   * @param {number} dt seconds since last frame
   * @param {object} snap { players, update, localId, localStalled, reducedMotion, racing }
   */
  frame(dt, snap) {
    if (!this.layout || this.w === 0) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.simulate(dt, snap);
    this.draw(snap);
  }

  // ---------------------------------------------------------------- simulation

  carState(id) {
    let c = this.cars.get(id);
    if (!c) {
      c = { p: 0, speed: 0, prevSpeed: 0, wheel: 0, tilt: 0, flash: 0, puffClock: 0, sputterClock: 0 };
      this.cars.set(id, c);
    }
    return c;
  }

  simulate(dt, snap) {
    const { players, update, localId, localStalled, reducedMotion, racing } = snap;
    const rows = new Map((update?.players ?? []).map((r) => [r.id, r]));
    const { carL, startX, finishX, roadTop, laneH } = this.layout;

    let focusSpeed = 0;
    let leaderSpeed = 0;
    let leaderIdx = -1;

    players.forEach((pl, lane) => {
      const row = rows.get(pl.id);
      const c = this.carState(pl.id);
      const isLocal = pl.id === localId;
      const stalled = racing && ((isLocal && localStalled) || row?.stalled) && !row?.finished;
      const targetP = row ? clamp(row.progress, 0, 1) : 0;
      const targetSpeed = !racing || !row || stalled || row.finished || row.dnf ? 0 : row.wpm;

      c.p = damp(c.p, targetP, 6, dt);
      c.prevSpeed = c.speed;
      c.speed = damp(c.speed, targetSpeed, stalled ? 14 : 3, dt);
      c.stalled = stalled;
      c.finished = Boolean(row?.finished);
      c.position = row?.position ?? null;
      c.dimmed = row ? row.dnf || !row.connected : !pl.connected;

      const accel = (c.speed - c.prevSpeed) / Math.max(dt, 1e-3);
      c.tilt = damp(c.tilt, clamp(-accel * 0.004, -0.07, 0.07), 8, dt);
      c.wheel += c.speed * 0.2 * dt;
      c.flash = stalled ? 0.55 + 0.45 * Math.sin(this.time * 18) : damp(c.flash, 0, 10, dt);

      // world position for particles
      const x = startX + c.p * (finishX - startX);
      const groundY = roadTop + laneH * (lane + 0.88);
      c.x = x;
      c.groundY = groundY;

      // Exhaust: rate scales with WPM. Idle puffs during the countdown.
      const rate = racing ? (c.speed > 2 ? 2 + c.speed / 9 : 0) : 1.2;
      c.puffClock += dt * rate;
      while (c.puffClock >= 1 && !c.finished && !c.dimmed) {
        c.puffClock -= 1;
        this.spawnPuff(x - carL - 2, groundY - carL * 0.14, c.speed, false);
      }
      if (stalled) {
        c.sputterClock += dt * 10;
        while (c.sputterClock >= 1) {
          c.sputterClock -= 1;
          this.spawnPuff(x - carL - 2, groundY - carL * 0.14, 20, true);
        }
      }

      if (isLocal) focusSpeed = c.speed;
      if (row && row.correctIndex > leaderIdx) {
        leaderIdx = row.correctIndex;
        leaderSpeed = c.speed;
      }
    });

    // The road scroll follows the local car (or the leader for spectators).
    const viewSpeed = players.some((p) => p.id === localId) ? focusSpeed : leaderSpeed;
    this.viewSpeed = viewSpeed;
    this.roadSpeed = damp(this.roadSpeed, viewSpeed * 4, localStalled ? 10 : 2.5, dt);
    if (!reducedMotion) this.scroll += this.roadSpeed * dt;

    // Confetti for the winner, once.
    const winner = update?.players.find((r) => r.position === 1);
    if (winner && !this.celebrated) {
      this.celebrated = true;
      if (!reducedMotion) this.spawnConfetti();
    }
    this.flagWave = damp(this.flagWave, winner ? 1 : 0.35, 2, dt);

    this.updateParticles(dt);
  }

  spawnPuff(x, y, speed, dark) {
    if (this.puffs.length > 160) this.puffs.shift();
    const scale = this.layout.carL / 90;
    this.puffs.push({
      x,
      y: y + (Math.random() - 0.5) * 3,
      vx: -(20 + speed * 1.2) * scale - Math.random() * 10,
      vy: -6 - Math.random() * 10,
      r: (2 + Math.random() * 2) * scale,
      grow: (dark ? 10 : 6 + speed * 0.08) * scale,
      life: 0,
      max: dark ? 0.45 : 0.7 + Math.random() * 0.3,
      dark,
    });
  }

  spawnConfetti() {
    const { finishX, roadTop } = this.layout;
    for (let i = 0; i < 140; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = 120 + Math.random() * 260;
      this.confetti.push({
        x: finishX + (Math.random() - 0.5) * 20,
        y: roadTop + 10,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 14,
        size: 4 + Math.random() * 5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        life: 0,
        max: 2 + Math.random() * 1.2,
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.puffs) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += p.grow * dt;
    }
    this.puffs = this.puffs.filter((p) => p.life < p.max);
    for (const c of this.confetti) {
      c.life += dt;
      c.vy += 420 * dt;
      c.vx *= 1 - 1.2 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
    }
    this.confetti = this.confetti.filter((c) => c.life < c.max && c.y < this.h + 20);
  }

  // ---------------------------------------------------------------- drawing

  draw(snap) {
    const { ctx, w, h } = this;
    const L = this.layout;
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(snap.reducedMotion);
    this.drawRoad();
    this.drawFinish();

    const players = snap.players;
    // speed lines + puffs sit behind cars
    players.forEach((pl) => this.drawSpeedLines(this.cars.get(pl.id)));
    this.drawPuffs();
    players.forEach((pl, lane) => {
      const c = this.cars.get(pl.id);
      if (c) this.drawCar(c, carHex(pl.color), lane, pl, pl.id === snap.localId, snap.reducedMotion);
    });
    this.drawConfetti();
    if (!players.length) {
      ctx.fillStyle = PAINT;
      ctx.font = '600 15px "Bricolage Grotesque", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for racers...', w / 2, L.roadTop + (L.roadBottom - L.roadTop) / 2);
    }
  }

  drawBackground(reduced) {
    const { ctx, w } = this;
    const { skyH, curb, roadTop, roadBottom } = this.layout;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, skyH);

    // Far layer: grandstands (slow parallax)
    const far = reduced ? 0 : this.scroll * 0.18;
    const standW = 120;
    const offset = -(far % standW);
    for (let x = offset - standW; x < w + standW; x += standW) {
      const i = Math.floor((x - offset + far) / standW);
      const hh = skyH * (0.45 + ((i * 37) % 5) * 0.08);
      ctx.fillStyle = STAND;
      ctx.fillRect(x + 4, skyH - hh, standW - 14, hh);
      ctx.fillStyle = STAND_DARK;
      for (let r = skyH - hh + 6; r < skyH - 4; r += 7) ctx.fillRect(x + 8, r, standW - 22, 2);
    }

    // Near layer: fence posts (faster parallax)
    const near = reduced ? 0 : this.scroll * 0.5;
    ctx.fillStyle = '#3A3E46';
    ctx.fillRect(0, skyH - 5, w, 3);
    const postGap = 34;
    for (let x = -(near % postGap); x < w; x += postGap) ctx.fillRect(x, skyH - 14, 3, 12);

    // Curbs: painted blocks that scroll with the road
    const road = reduced ? 0 : this.scroll;
    const block = 22;
    const shift = -(road % (block * 2));
    for (const y of [skyH, roadBottom]) {
      ctx.fillStyle = PAINT;
      ctx.fillRect(0, y, w, curb);
      ctx.fillStyle = '#FF5A3C';
      for (let x = shift; x < w; x += block * 2) ctx.fillRect(x, y, block, curb);
    }
    void roadTop;
  }

  drawRoad() {
    const { ctx, w } = this;
    const { roadTop, roadBottom, laneH, startX, carL } = this.layout;
    ctx.fillStyle = ROAD;
    ctx.fillRect(0, roadTop, w, roadBottom - roadTop);
    ctx.fillStyle = ROAD_EDGE;
    ctx.fillRect(0, roadTop, w, 3);

    // Dashed lane separators scroll with the local player's speed.
    const dash = 26;
    const gap = 22;
    const period = dash + gap;
    const shift = -(this.scroll % period);
    ctx.fillStyle = 'rgba(241, 238, 228, 0.75)';
    for (let lane = 1; lane < LANES; lane++) {
      const y = Math.round(roadTop + laneH * lane) - 1.5;
      for (let x = shift; x < w; x += period) ctx.fillRect(x, y, dash, 3);
    }

    // Start line and painted lane numbers.
    ctx.fillStyle = 'rgba(241, 238, 228, 0.9)';
    ctx.fillRect(startX, roadTop, 3, roadBottom - roadTop);
    ctx.fillStyle = 'rgba(241, 238, 228, 0.12)';
    ctx.font = `800 ${Math.round(laneH * 0.62)}px "Bricolage Grotesque", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let lane = 0; lane < LANES; lane++) {
      ctx.fillText(String(lane + 1), startX - carL / 2, roadTop + laneH * (lane + 0.5));
    }
    ctx.textBaseline = 'alphabetic';
  }

  drawFinish() {
    const { ctx } = this;
    const { roadTop, roadBottom, finishX, skyH } = this.layout;
    const sq = Math.max(6, Math.round((roadBottom - roadTop) / 14));
    for (let row = 0; row * sq < roadBottom - roadTop; row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 ? ASPHALT : PAINT;
        ctx.fillRect(finishX + col * sq, roadTop + row * sq, sq, Math.min(sq, roadBottom - roadTop - row * sq));
      }
    }

    // Waving checkered flag on a pole above the finish line.
    const poleX = finishX + sq;
    const top = Math.max(4, skyH * 0.12);
    ctx.fillStyle = PAINT;
    ctx.fillRect(poleX - 1, top, 2, skyH - top);
    const fw = Math.min(30, skyH * 0.9);
    const fh = fw * 0.66;
    const cols = 4;
    const rows = 3;
    const amp = 2.5 * this.flagWave;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = poleX - fw + (c * fw) / cols;
        const wave = Math.sin(this.time * 7 + c * 1.1) * amp * ((cols - c) / cols);
        ctx.fillStyle = (r + c) % 2 ? ASPHALT : PAINT;
        ctx.fillRect(x, top + (r * fh) / rows + wave, fw / cols + 0.5, fh / rows + 0.5);
      }
    }
  }

  drawSpeedLines(c) {
    if (!c || c.speed < 55 || c.dimmed) return;
    const { ctx } = this;
    const { carL } = this.layout;
    const k = clamp((c.speed - 55) / 60, 0, 1);
    ctx.fillStyle = `rgba(241, 238, 228, ${0.18 + 0.32 * k})`;
    for (let i = 0; i < 3; i++) {
      const len = carL * (0.35 + 0.5 * k) * (1 - i * 0.18);
      const y = c.groundY - carL * (0.12 + i * 0.12);
      const jitter = ((this.time * 60 + i * 23) % 14) - 7;
      ctx.fillRect(c.x - carL - len - 6 + jitter, y, len, 2);
    }
  }

  drawPuffs() {
    const { ctx } = this;
    for (const p of this.puffs) {
      const k = p.life / p.max;
      ctx.fillStyle = p.dark ? `rgba(12, 13, 15, ${0.55 * (1 - k)})` : `rgba(241, 238, 228, ${0.32 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCar(c, color, lane, player, isLocal, reduced) {
    const { ctx } = this;
    const { carL: L } = this.layout;
    const H = L * 0.4;
    const r = L * 0.13;
    const shake = c.stalled && !reduced ? Math.sin(this.time * 70) * 1.6 : 0;
    const x = c.x - L + shake; // rear of the car
    const y = c.groundY;
    const body = c.flash > 0.01 ? mix(color, ERROR_RED, c.flash * 0.7) : color;

    ctx.save();
    ctx.globalAlpha = c.dimmed ? 0.4 : 1;

    // shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + L * 0.5, y + 1, L * 0.5, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // tilt pivots around the rear wheel contact point
    ctx.translate(x + L * 0.2, y);
    ctx.rotate(reduced ? 0 : c.tilt);
    ctx.translate(-(x + L * 0.2), -y);

    // body
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x + L * 0.03, y - H * 0.18);
    ctx.lineTo(x + L * 0.02, y - H * 0.62);
    ctx.lineTo(x + L * 0.1, y - H * 0.66);
    ctx.lineTo(x + L * 0.11, y - H * 0.98); // spoiler post
    ctx.lineTo(x + L * 0.21, y - H * 0.98);
    ctx.lineTo(x + L * 0.2, y - H * 0.7);
    ctx.lineTo(x + L * 0.38, y - H * 0.72);
    ctx.quadraticCurveTo(x + L * 0.5, y - H * 1.2, x + L * 0.64, y - H * 0.74);
    ctx.lineTo(x + L * 0.88, y - H * 0.56);
    ctx.quadraticCurveTo(x + L * 1.0, y - H * 0.48, x + L * 1.0, y - H * 0.3);
    ctx.lineTo(x + L * 0.98, y - H * 0.18);
    ctx.closePath();
    ctx.fill();

    // canopy
    ctx.fillStyle = ASPHALT;
    ctx.beginPath();
    ctx.moveTo(x + L * 0.42, y - H * 0.74);
    ctx.quadraticCurveTo(x + L * 0.5, y - H * 1.1, x + L * 0.6, y - H * 0.76);
    ctx.closePath();
    ctx.fill();

    // paint stripe + number roundel
    ctx.fillStyle = PAINT;
    ctx.fillRect(x + L * 0.06, y - H * 0.46, L * 0.88, Math.max(2, H * 0.09));
    ctx.beginPath();
    ctx.arc(x + L * 0.3, y - H * 0.42, H * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ASPHALT;
    ctx.font = `800 ${Math.round(H * 0.3)}px "Bricolage Grotesque", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(lane + 1), x + L * 0.3, y - H * 0.41);
    ctx.textBaseline = 'alphabetic';

    // wheels with spinning hubs
    for (const wx of [x + L * 0.2, x + L * 0.8]) this.drawWheel(wx, y - r, r, c.wheel);
    ctx.restore();

    // label above the car
    const labelY = y - H * 1.08 - 3;
    ctx.save();
    ctx.globalAlpha = c.dimmed ? 0.55 : 1;
    ctx.font = `${isLocal ? 800 : 600} ${Math.max(11, Math.round(L * 0.15))}px "Bricolage Grotesque", sans-serif`;
    ctx.textAlign = 'center';
    let label = player.nickname;
    if (c.finished && c.position) label = `${['1st', '2nd', '3rd'][c.position - 1] ?? ''} ${label}`;
    else if (c.stalled) label = `STALL  ${label}`;
    else if (c.dimmed) label = `${label} (offline)`;
    ctx.fillStyle = c.stalled ? '#FF8A8D' : isLocal ? PAINT : '#B4B0A5';
    ctx.fillText(label, x + L * 0.5, labelY);
    ctx.restore();
  }

  drawWheel(cx, cy, r, angle) {
    const { ctx } = this;
    ctx.fillStyle = '#121315';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9A968C';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#121315';
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = angle + (i * Math.PI * 2) / 3;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
    }
    ctx.stroke();
  }

  drawConfetti() {
    const { ctx } = this;
    for (const c of this.confetti) {
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, (c.life - c.max * 0.6) / (c.max * 0.4));
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
      ctx.restore();
    }
  }
}
