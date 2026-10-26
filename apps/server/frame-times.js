// Per-room ring buffer of completed-tick wall times (physics + field encode).
// Cap ≈ 180 s × 30 Hz. Paused rooms (empty persistent: Room.stop) add nothing —
// the buffer keeps prior samples until overwritten after the clock resumes.
export const FRAME_TIME_WINDOW_S = 180;
export const FRAME_TIME_HZ = 30;
export const FRAME_TIME_CAP = FRAME_TIME_WINDOW_S * FRAME_TIME_HZ; // 5400

export class FrameTimeHistory {
  constructor({ capacity = FRAME_TIME_CAP, sampleHz = FRAME_TIME_HZ, windowS = FRAME_TIME_WINDOW_S } = {}) {
    this.capacity = capacity;
    this.sampleHz = sampleHz;
    this.windowS = windowS;
    this._ms = new Float32Array(capacity);
    this._len = 0;
    this._head = 0; // next write index
    this._endAt = 0; // Date.now() of the newest sample
  }

  get length() { return this._len; }

  get latestMs() {
    if (!this._len) return null;
    return this._ms[(this._head - 1 + this.capacity) % this.capacity];
  }

  // Record one completed tick. wallMs defaults to Date.now() (graphable epoch).
  push(ms, wallMs = Date.now()) {
    const v = Number(ms);
    this._ms[this._head] = Number.isFinite(v) ? v : 0;
    this._head = (this._head + 1) % this.capacity;
    if (this._len < this.capacity) this._len++;
    this._endAt = wallMs;
  }

  // Oldest → newest. Client: sample i at endAt - (n - 1 - i) * (1000 / sampleHz).
  snapshot() {
    const n = this._len;
    const times = new Array(n);
    const start = n === this.capacity ? this._head : 0;
    for (let i = 0; i < n; i++) {
      times[i] = Math.round(this._ms[(start + i) % this.capacity] * 100) / 100;
    }
    const latest = this.latestMs;
    return {
      sampleHz: this.sampleHz,
      windowS: this.windowS,
      endAt: n ? this._endAt : null,
      times,
      latestMs: latest == null ? null : Math.round(latest * 100) / 100,
    };
  }
}
