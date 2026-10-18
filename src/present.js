// Host-side helpers: perf counters, and presentHud / presentStep /
// bodyOutlines, which build in one call what clients build from the scene
// state (scene-state.js → scene-build.js, hud.js), for scripts and checks.
// No DOM or three.js; runs wherever the Sim runs (main thread for LocalHost, the worker for WorkerHost), so the client never
// touches Sim, planck or Boltzmann objects.
import { hudState, hudFromState } from './hud.js';
import { defaultCellUpdateTarget } from './domainTrack.js';
import { sceneFrame, bodyScene } from './scene-state.js';
import { buildGuides, buildBodies, pushRefinementGuides } from './scene-build.js';

export { pushRefinementGuides };

const now = () => performance.now();

// Readout and HUD text for the step just taken (rec = sim.step's record),
// as the client writes it from the HUD state (hud.js).
export function presentHud(sim, rec) {
  sim.activate();
  return hudFromState(hudState(sim, rec));
}


// HUD plus the guides built from state, as one call (scripts and checks
// that want the old presentStep shape). view: { camera_position_x, ... }.
export function presentStep(sim, rec, view, nowMs = now()) {
  const ids = sim._sceneIds || (sim._sceneIds = new WeakMap());
  const { state, statics } = sceneFrame(sim, rec, view, nowMs, ids);
  const out = hudFromState(state.hud);
  out.guides = buildGuides(state, statics, view);
  return out;
}

// Outlines of the planck bodies, as the renderer draws them:
// [{ id, kind: 'circle' | 'edge' | 'polygon', stroke, pts: [x, y, ...] }].
// ids is a WeakMap fixture → id kept by the caller (stable across steps).
export function bodyOutlines(world, ids) {
  const { statics, bt } = bodyScene(world, ids);
  return buildBodies(statics, bt);
}

// Perf overlay counters (perf-overlay.js formats them): active cells per
// level, the refinement budget state, dev mode.
export function perfStats(bm, map) {
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
  const def = defaultCellUpdateTarget(bm);
  return {
    levels,
    target: bm.cellUpdateTarget === 'default' ? def : bm.cellUpdateTarget,
    defaultTarget: def,
    curlScale: bm.curlScale,
    devMode: !!map.devMode,
  };
}
