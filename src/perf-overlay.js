// Performance overlay: active cells per refinement level, total cells, and
// the time spent iterating the fluid field (Boltzmann.physics_model_step up
// to, but not including, paintTexture; see Boltzmann.field_ms).
//
// Off by default (#perf checkbox, ?perf=1). While off nothing runs: no rAF
// loop, no sampling, no DOM writes. While on, main.js reports each field step
// with recordFieldStep(); a rAF loop closes each frame into a 30-frame
// window, and the text is rebuilt a few times per second. Cell counts read
// array lengths on the domain tree, so they cost O(number of grids).

import { CURL_TAU_ON, CURL_TAU_OFF } from './domainTrack.js';

const WINDOW_FRAMES = 30;
const REFRESH_MS = 250;

// Counters come from the host (present.js perfStats), so the overlay never
// reads the lattice itself.
let _getStats = null;
let el = null;
let enabled = false;
let rafId = 0;
let lastRefresh = 0;

// Steps and time since the last animation frame.
let pendingMs = 0;
let pendingSteps = 0;
// Ring of closed frames.
const frameMs = new Float64Array(WINDOW_FRAMES);
const frameSteps = new Uint16Array(WINDOW_FRAMES);
let ringPos = 0;
let ringFill = 0;
let lastStepMs = 0;

export function isPerfOverlayOn() {
  return enabled;
}

export function recordFieldStep(ms) {
  if (!enabled || !Number.isFinite(ms)) return;
  pendingMs += ms;
  pendingSteps++;
  lastStepMs = ms;
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

// Refinement budget readout: tuning state, scale, effective curl threshold,
// cell updates per root step against the target. st: present.js perfStats.
export function budgetLines(st, updates) {
  const t = st.target;
  const on = Number.isFinite(t);
  const s = on && st.curlScale > 1 ? st.curlScale : 1;
  const num = typeof document !== 'undefined' && document.getElementById('cellBudget');
  if (num) num.placeholder = String(st.defaultTarget);
  return [
    'budget ' + (on ? 'on' : 'off') + '  x' + s.toFixed(2),
    'curl tau ' + (CURL_TAU_ON * s).toFixed(4) + ' / ' + (CURL_TAU_OFF * s).toFixed(4),
    'load ' + fmt(updates) + ' / ' + (on ? fmt(Math.round(t)) + ' (' + Math.round(100 * updates / t) + '%)' : 'none'),
  ];
}

function render() {
  const st = _getStats();
  if (!st) return;
  const levels = st.levels;
  let total = 0;
  let updates = 0;
  const lines = ['PERF'];
  for (let i = 0; i < levels.length; i++) {
    const { cells, grids } = levels[i];
    total += cells;
    // A level-L grid runs 2^L sub-steps per coarse step (Lagrava time refinement).
    updates += cells * (1 << i);
    const gridNote = i === 0 ? '' : ' (' + grids + (grids === 1 ? ' grid)' : ' grids)');
    lines.push('L' + i + ' ' + pad(fmt(cells), 7) + gridNote);
  }
  lines.push('total ' + pad(fmt(total), 7) + ' cells');
  lines.push('upd/step ' + pad(fmt(updates), 7));
  lines.push(...budgetLines(st, updates));

  let ms = 0;
  let steps = 0;
  for (let i = 0; i < ringFill; i++) {
    ms += frameMs[i];
    steps += frameSteps[i];
  }
  if (st.devMode) {
    lines.push('field paused (dev mode)');
  } else if (ringFill === 0 || steps === 0) {
    lines.push('field  -- ms/step');
  } else {
    lines.push('field ' + pad((ms / steps).toFixed(2), 6) + ' ms/step');
    lines.push('      ' + pad((ms / ringFill).toFixed(2), 6) + ' ms/frame');
    lines.push('      ' + pad((steps / ringFill).toFixed(2), 6) + ' steps/frame');
    lines.push('last  ' + pad(lastStepMs.toFixed(2), 6) + ' ms');
  }
  el.textContent = lines.join('\n');
}

function tick(now) {
  if (!enabled) return;
  frameMs[ringPos] = pendingMs;
  frameSteps[ringPos] = pendingSteps;
  ringPos = (ringPos + 1) % WINDOW_FRAMES;
  if (ringFill < WINDOW_FRAMES) ringFill++;
  pendingMs = 0;
  pendingSteps = 0;
  if (now - lastRefresh >= REFRESH_MS) {
    lastRefresh = now;
    render();
  }
  rafId = requestAnimationFrame(tick);
}

function setEnabled(on) {
  if (on === enabled && el.style.display) return;
  enabled = on;
  el.style.display = on ? 'block' : 'none';
  if (on) {
    pendingMs = 0;
    pendingSteps = 0;
    ringPos = 0;
    ringFill = 0;
    lastRefresh = 0;
    render();
    rafId = requestAnimationFrame(tick);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

// getStats(): the latest perfStats from the host, or null before the first.
export function setupPerfOverlay(getStats) {
  _getStats = getStats;
  el = document.getElementById('perf_overlay_hud');
  const box = document.getElementById('perf');
  if (!el || !box) return;
  box.addEventListener('change', () => setEnabled(box.checked));
  // installUrlSettings applies ?perf=1 through the change event above.
  setEnabled(false);
}
