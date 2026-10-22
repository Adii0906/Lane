// A typing bot built on the real shared typing engine, so it obeys the stall mechanic exactly
// like a human client does.
import { EVENTS, PROGRESS_INTERVAL_MS, backspace, createTypingState, typeChar } from '../../shared/index.js';

export class TypingBot {
  /**
   * @param {TestClient} client  a connected, joined TestClient
   * @param {object} opts { cps: chars per second, errorEvery: inject a wrong key every N chars (0 = never) }
   */
  constructor(client, { cps, errorEvery = 0 }) {
    this.client = client;
    this.cps = cps;
    this.errorEvery = errorEvery;
    this.state = createTypingState();
    this.budget = 0;
    this.timer = null;
    this.rejections = [];
  }

  start(passage) {
    this.passage = passage;
    this.timer = setInterval(() => this.tick(), PROGRESS_INTERVAL_MS);
  }

  tick() {
    this.budget += (this.cps * PROGRESS_INTERVAL_MS) / 1000;
    while (this.budget >= 1 && this.state.index < this.passage.length) {
      this.budget -= 1;
      if (this.state.wrong !== null) {
        this.state = backspace(this.state).state;
        continue;
      }
      const shouldErr = this.errorEvery > 0 && this.state.index > 0 && this.state.index % this.errorEvery === 0 && !this.justErred;
      if (shouldErr) {
        this.state = typeChar(this.state, this.passage, '#').state;
        this.justErred = true;
        continue;
      }
      this.justErred = false;
      this.state = typeChar(this.state, this.passage, this.passage[this.state.index]).state;
    }
    this.send();
    if (this.state.index >= this.passage.length) this.stop();
  }

  async send() {
    try {
      const res = await this.client.emit(EVENTS.PROGRESS, {
        correctIndex: this.state.index,
        errorCount: this.state.errors,
        keystrokes: this.state.keystrokes,
        stalled: this.state.wrong !== null,
      });
      if (!res.ok && res.reason !== 'not_active') this.rejections.push(res.reason ?? res.code);
    } catch {
      // socket closed at the end of a test
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
