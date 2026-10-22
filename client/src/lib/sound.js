// Tiny WebAudio sound kit. Muted by default; the AudioContext is only created after the player
// turns sound on (a user gesture), so browsers never block it.

class SoundKit {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.listeners = new Set();
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getEnabled = () => this.enabled;

  setEnabled(on) {
    this.enabled = on;
    if (on) this.ensure();
    if (this.ctx) {
      if (on) this.ctx.resume();
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
    this.listeners.forEach((fn) => fn());
  }

  ensure() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  get live() {
    return this.enabled && this.ctx;
  }

  tone(freq, { duration = 0.12, type = 'square', gain = 0.18, delay = 0 } = {}) {
    if (!this.live) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  beep(isGo = false) {
    this.tone(isGo ? 880 : 440, { duration: isGo ? 0.35 : 0.14, gain: 0.16 });
  }

  cancel() {
    this.tone(220, { duration: 0.18, type: 'triangle', gain: 0.14 });
  }

  /** Engine sputter: three choppy low blips. */
  stall() {
    if (!this.live) return;
    [0, 0.07, 0.15].forEach((d, i) => this.tone(70 - i * 10, { duration: 0.06, type: 'sawtooth', gain: 0.22, delay: d }));
  }

  finish() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { duration: 0.22, type: 'triangle', gain: 0.14, delay: i * 0.09 }));
  }

  /** Continuous engine hum. Call every frame with the current speed; pitch follows WPM. */
  setEngine(wpm, running) {
    if (!this.live) {
      if (this.engine && !this.enabled) this.stopEngine();
      return;
    }
    if (running && !this.engine) this.startEngine();
    if (!running && this.engine) return this.stopEngine();
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const base = 48 + Math.min(wpm, 160) * 0.9;
    this.engine.a.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.b.frequency.setTargetAtTime(base * 1.505, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(300 + wpm * 6, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(0.05 + Math.min(wpm, 120) / 1200, t, 0.1);
  }

  startEngine() {
    const a = this.ctx.createOscillator();
    const b = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    a.type = 'sawtooth';
    b.type = 'square';
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    gain.gain.value = 0.0001;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.master);
    a.start();
    b.start();
    this.engine = { a, b, filter, gain };
  }

  stopEngine() {
    if (!this.engine) return;
    const { a, b, gain } = this.engine;
    const t = this.ctx.currentTime;
    gain.gain.setTargetAtTime(0.0001, t, 0.08);
    a.stop(t + 0.3);
    b.stop(t + 0.3);
    this.engine = null;
  }
}

export const sound = new SoundKit();
