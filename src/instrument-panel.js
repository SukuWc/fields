// Instrument panel (zone C, #hud_instruments; UI overhaul PR 5): a mode
// selector Readout | Chart | Instrument and, for now, Readout mode only.
// Chart mode is the next PR; Instrument mode is disabled ("coming later").
// The mode is remembered in this browser (localStorage 'fields.instrumentMode').
// Values: instrument-readout.js (frame state only, own boat by id).
import { READOUT_TILES, readoutValues, formatReadout } from './instrument-readout.js';

const STORE_KEY = 'fields.instrumentMode';
const MODES = ['readout', 'chart', 'instrument'];
const ENABLED = new Set(['readout']);
const UPDATE_MS = 200;

export function setupInstrumentPanel({ remote = false, lockstep = () => false } = {}, doc = document) {
  const root = doc.getElementById('instrument_panel');
  if (!root) return { onFrame() {}, setOwnId() {} };
  const buttons = Array.from(root.querySelectorAll('.instr-mode'));
  const tiles = new Map();
  const grid = root.querySelector('.instr-tiles');
  for (const t of READOUT_TILES) {
    const el = doc.createElement('div');
    el.className = 'instr-tile';
    el.dataset.key = t.key;
    el.innerHTML = `<span class="instr-label">${t.label}</span><span class="instr-value">–</span><span class="instr-unit">${t.unit}</span>`;
    if (t.key === 'aws') el.title = 'Apparent wind speed: not in the frame yet in m/s (needs sim work)';
    if (t.key === 'next') el.title = 'Straight-line distance to the next mark (gate: its midpoint). The leaderboard shows the sailed distance (beats at 50°).';
    grid.appendChild(el);
    tiles.set(t.key, { el, value: el.querySelector('.instr-value'), unit: el.querySelector('.instr-unit') });
  }
  const note = root.querySelector('.instr-note');
  const select = (mode, remember) => {
    if (!ENABLED.has(mode)) mode = 'readout';
    root.dataset.mode = mode;
    for (const b of buttons) b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    if (remember) { try { localStorage.setItem(STORE_KEY, mode); } catch { /* no storage */ } }
  };
  for (const b of buttons) b.addEventListener('click', () => { if (!b.disabled) select(b.dataset.mode, true); });
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { /* no storage */ }
  select(MODES.includes(stored) ? stored : 'readout', false);

  let ownId = null;
  let last = 0;
  let lastState = null;
  const render = () => {
    const v = readoutValues(lastState, { ownId, remote, lockstep: lockstep() });
    root.classList.toggle('no-boat', !v);
    if (note) note.textContent = v ? '' : (remote ? 'Spectating: join to see your instruments' : 'No boat');
    for (const t of READOUT_TILES) {
      const tile = tiles.get(t.key);
      const val = v ? v[t.key] : null;
      tile.value.textContent = formatReadout(t.key, val);
      tile.el.classList.toggle('missing', val === null || val === undefined);
      if (t.key === 'next') tile.unit.textContent = v && v.nextLabel ? (val !== null ? 'm · ' : '') + v.nextLabel : 'm';
    }
  };
  render();
  return {
    setOwnId(id) { ownId = id || null; render(); },
    onFrame(state) {
      lastState = state;
      const now = performance.now();
      if (now - last < UPDATE_MS) return;
      last = now;
      render();
    },
  };
}
