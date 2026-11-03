// Mobile readout strip (plan M3): BSP · VMG · TWA · TWS in one row under the
// top of the screen on phones and touch-only devices, where the instrument
// panel (zone C) is hidden. Same values as the panel's Readout mode
// (instrument-readout.js: own boat by id, dashes where the frame has none).
// TWA shows as an angle off the wind with a tack chip: P (port, red) for
// twa > 0, S (starboard, green) for twa < 0 (rules.js convention); green /
// red are used for nothing else. Redrawn at 5 Hz. Client-only.
import { readoutValues, formatReadout } from './instrument-readout.js';

export const STRIP_CELLS = [
  { key: 'bs', label: 'BSP', unit: 'm/s' },
  { key: 'vmg', label: 'VMG', unit: 'm/s' },
  { key: 'twa', label: 'TWA', unit: '°' },
  { key: 'tws', label: 'TWS', unit: 'm/s' },
];
const UPDATE_MS = 200;

// Tack of a true-wind angle: 'port' (0 < twa < 180), 'stbd' (-180 < twa < 0),
// or null (head to wind, dead downwind, or no value).
export function tackOf(twa) {
  if (!Number.isFinite(twa)) return null;
  const a = ((((twa + 180) % 360) + 360) % 360) - 180;
  if (a > 0 && a < 180) return 'port';
  if (a < 0 && a > -180) return 'stbd';
  return null;
}

// Cell texts: { bs, vmg, twa, tws } strings and the tack, from readout values.
export function stripTexts(v) {
  const out = { tack: null };
  for (const c of STRIP_CELLS) out[c.key] = formatReadout(c.key, v ? v[c.key] : null);
  if (v && Number.isFinite(v.twa)) {
    out.twa = String(Math.abs(Number(formatReadout('twa', v.twa))));
    out.tack = tackOf(v.twa);
  }
  return out;
}

export function setupMobileStrip({ remote = false, lockstep = () => false } = {}, doc = document) {
  const root = doc.getElementById('mobile_strip');
  if (!root) return { onFrame() {}, setOwnId() {} };
  const cells = new Map();
  for (const c of STRIP_CELLS) {
    const el = doc.createElement('div');
    el.className = 'ms-cell';
    el.dataset.key = c.key;
    el.innerHTML = `<span class="ms-label">${c.label}</span><span class="ms-value"><b>–</b><small>${c.unit}</small></span>`;
    root.appendChild(el);
    cells.set(c.key, el.querySelector('b'));
  }
  const chip = doc.createElement('span');
  chip.className = 'ms-tack';
  chip.hidden = true;
  cells.get('twa').after(chip);
  let ownId = null; let last = 0;
  function render(state) {
    const t = stripTexts(readoutValues(state, { ownId, remote, lockstep: lockstep() }));
    for (const c of STRIP_CELLS) cells.get(c.key).textContent = t[c.key];
    chip.hidden = !t.tack;
    chip.className = 'ms-tack ' + (t.tack || '');
    chip.textContent = t.tack === 'port' ? 'P' : t.tack === 'stbd' ? 'S' : '';
    chip.title = t.tack === 'port' ? 'Port tack' : t.tack === 'stbd' ? 'Starboard tack' : '';
  }
  return {
    onFrame(state) {
      const now = Date.now();
      if (now - last < UPDATE_MS) return;
      last = now;
      render(state);
    },
    setOwnId(id) { ownId = id; last = 0; },
  };
}
