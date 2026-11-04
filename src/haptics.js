// Haptics (mobile plan): a short buzz when your own boat tacks and a
// double buzz when it gets a new penalty. Player setting 'vibrate' (on by
// default, ?vibrate=0 to turn off). Where navigator.vibrate is missing
// (desktop, iOS Safari) every call quietly does nothing.

export const TACK_PATTERN = 30;
export const PENALTY_PATTERN = [80, 60, 80];

export function canVibrate(nav = globalThis.navigator) {
  return !!nav && typeof nav.vibrate === 'function';
}

export function buzz(pattern, nav = globalThis.navigator) {
  if (!canVibrate(nav)) return false;
  try { return nav.vibrate(pattern) !== false; } catch { return false; }
}

// Tack = the TWA changes sign through head to wind (|TWA| < 90 on both
// sides). A gybe (through dead downwind) does not count. TWA > 0 is port.
export class TackDetector {
  constructor() { this.last = null; this.boat = null; }
  update(boatId, twa) {
    if (boatId !== this.boat) { this.boat = boatId; this.last = null; }
    if (!Number.isFinite(twa) || twa === 0) return false;
    const prev = this.last;
    this.last = twa;
    return prev !== null && Math.sign(prev) !== Math.sign(twa) && Math.abs(prev) < 90 && Math.abs(twa) < 90;
  }
  reset() { this.last = null; this.boat = null; }
}

// enabled(): reads the setting live (the #vibrate checkbox).
export function createHaptics({ enabled = () => true, nav = globalThis.navigator } = {}) {
  const tacks = new TackDetector();
  return {
    // Own-boat readout each frame ({ boatId, twa } or null).
    onReadout(r) {
      if (!r) { tacks.reset(); return false; }
      return tacks.update(r.boatId, r.twa) && enabled() ? buzz(TACK_PATTERN, nav) : false;
    },
    onOwnPenalty() { return enabled() ? buzz(PENALTY_PATTERN, nav) : false; },
  };
}
