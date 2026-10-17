// Host-side presentation: readout and HUD strings, body outlines and perf
// counters (drawn geometry comes from scene-state.js / scene-build.js).
// No DOM or three.js; runs wherever the Sim runs (main thread for LocalHost, the worker for WorkerHost), so the client never
// touches Sim, planck or Boltzmann objects.
//
// The readout lines are the old main.js present().
import { boatTelemetryHtml } from './info.js';
import { courseText } from './course.js';
import { leaderboardHtml } from './leaderboard.js';
import { startHudHtml, startStatusText } from './start.js';
import { defaultCellUpdateTarget } from './domainTrack.js';
import { sceneFrame, bodyScene } from './scene-state.js';
import { buildGuides, buildBodies, pushRefinementGuides } from './scene-build.js';

export { pushRefinementGuides };

const now = () => performance.now();

// Readout and HUD text for the step just taken (rec = sim.step's record).
// Returns { dist: string | null (null = leave as is), info: string,
//   startHud: { html, flash } | null (null = hidden),
//   results: string | null (null = hidden) }.
// Drawn geometry is not built here: the host sends compact state
// (scene-state.js) and the client builds the guides (scene-build.js).
export function presentHud(sim, rec) {
  sim.activate();
  const racing = sim.players;
  let info = '';
  const out = { dist: null, info: '', startHud: null, results: null };

  if (rec.distSum !== null) out.dist = "Dist: " + Math.floor(rec.distSum * 100) / 100 + "<br>";

  // Each boat's step used to reset the readout and append "Phys Time", so the
  // last boat with telemetry leads, followed by one Phys Time per later boat.
  const k = rec.telemetryIndex;
  info = k >= 0 ? boatTelemetryHtml(racing[k].telemetry) : '';
  for (let i = Math.max(0, k); i < rec.physTimes.length; i++) info += "Phys Time: " + rec.physTimes[i] + "<br>";
  const startSeq = sim.startSequence;
  if (startSeq) {
    out.startHud = { html: startHudHtml(startSeq, racing[0]), flash: !!startSeq.flashing };
    if (racing[0]) info += 'Start: ' + startStatusText(startSeq, racing[0]) + '<br>';
  }

  const course = sim.course;
  if (course && racing[0]) {
    const progress = course.progressFor(racing[0]);
    info += courseText(progress) + '<br>';
  }

  if (course) out.results = leaderboardHtml(sim.leaderboard, 0);

  // Rules readout, as the step saw it before recording this tick's contacts.
  let showPenaltyKeys = false;
  rec.boats.forEach((b, i) => {
    const twaText = b.twa === null ? '?' : String(Math.round(b.twa));
    info += 'Boat ' + i + ' TWA ' + twaText + (b.tacking ? ' tacking' + (b.tackingOnto ? ' onto ' + b.tackingOnto : '') : '') + '<br>';
    if (b.pending > 0 || b.penaltyTurn) {
      showPenaltyKeys = true;
      let line = 'Boat ' + i + (b.pending === 0 && b.justCleared ? ' CLEARED' : ' penalty ' + b.pending);
      if (b.penaltyTurn) {
        const left = Math.max(0, Math.ceil(b.penaltyTurn.remainingDeg));
        line += ' · ' + (b.penaltyTurn.dir < 0 ? 'CW ' : 'CCW ') + left + '°';
      }
      if (b.reason) line += ' · ' + b.reason;
      if (b.maneuvers) line += ' · ' + b.maneuvers;
      else if (b.pending > 0) line += ' · needs tack + gybe';
      info += line + '<br>';
    } else if (b.justCleared) {
      showPenaltyKeys = true;
      info += 'Boat ' + i + ' CLEARED<br>';
    }
  });
  if (showPenaltyKeys) info += 'Q CCW · E CW<br>';

  const boundary = sim.boundary;
  if (boundary) {
    for (let i = 0; i < racing.length; i++) {
      const d = boundary.distanceOf(racing[i]);
      info += 'Boat ' + i + ' boundary ' + (d.side > 0 ? 'east' : 'west') + ' ' + d.dist.toFixed(1) + ' m' + (d.dist < 0 ? ' OUTSIDE' : d.dist <= boundary.zone ? ' (zone)' : '') + '<br>';
    }
  }
  const resolutions = rec.resolutions;
  for (const r of resolutions) {
    const b = r.boundaryRoom;
    if (!b) continue;
    info += 'Boundary room: boat ' + racing.indexOf(b.giveWay) + ' gives boat ' + racing.indexOf(b.rightOfWay) + ' room to tack or gybe away (' + b.basis + ')' + (b.decisive ? ' · decides fault' : '') + '<br>';
  }
  for (const r of resolutions) {
    const m = r.markRoom;
    if (!m) continue;
    info += 'Rule 18.2: boat ' + racing.indexOf(m.giveWay) + ' gives mark-room to boat ' + racing.indexOf(m.rightOfWay) + ' (' + m.basis + ' at the zone)' + (m.decisive ? ' · decides fault' : '') + '<br>';
  }
  out.info = info;
  return out;
}


// HUD plus the guides built from state, as one call (scripts and checks
// that want the old presentStep shape). view: { camera_position_x, ... }.
export function presentStep(sim, rec, view, nowMs = now()) {
  const ids = sim._sceneIds || (sim._sceneIds = new WeakMap());
  const { state, statics } = sceneFrame(sim, rec, view, nowMs, ids);
  const out = presentHud(sim, rec);
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
