// Performance overlay: active cells per refinement level, total cells, and
// the time spent iterating the fluid field (Boltzmann.physics_model_step up
// to, but not including, paintTexture; see Boltzmann.field_ms).
//
// Off by default (#perf checkbox, ?perf=1). While off nothing runs: no rAF
// loop, no sampling, no DOM writes. While on, main.js reports each field step
// with recordFieldStep(); a rAF loop closes each frame into a 30-frame
// window, and the text is rebuilt a few times per second. Cell counts read
// array lengths on the domain tree, so they cost O(number of grids).

const WINDOW_FRAMES = 30;
const REFRESH_MS = 250;

let _bm = null;
let _map = null;
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

// Active (collided and streamed) cells per level. Level 0 is the root grid
// minus the nodes a level-1 grid covers deeply; each finer level counts the
// same way inside its parent. Sibling grids on one level are summed.
export function countCellsByLevel(bm) {
  const levels = [{ cells: bm.streamCells ? bm.streamCells.length : 0, grids: 1 }];
  let current = bm.domains || [];
  let depth = 1;
  while (current.length) {
    const next = [];
    let cells = 0;
    for (const d of current) {
      cells += d.streamCells ? d.streamCells.length : 0;
      if (d.domains && d.domains.length) next.push(...d.domains);
    }
    levels[depth] = { cells, grids: current.length };
    current = next;
    depth++;
  }
  return levels;
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function render() {
  const levels = countCellsByLevel(_bm);
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

  let ms = 0;
  let steps = 0;
  for (let i = 0; i < ringFill; i++) {
    ms += frameMs[i];
    steps += frameSteps[i];
  }
  if (_map && _map.devMode) {
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

export function setupPerfOverlay(map, bm) {
  _map = map;
  _bm = bm;
  el = document.getElementById('perf_overlay_hud');
  const box = document.getElementById('perf');
  if (!el || !box) return;
  box.addEventListener('change', () => setEnabled(box.checked));
  // installUrlSettings applies ?perf=1 through the change event above.
  setEnabled(false);
}
