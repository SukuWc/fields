// Host-side presentation: turns the Sim's state after a step into plain data
// the client draws (readout and HUD strings, guide segments, body outlines,
// perf counters). No DOM or three.js; runs wherever the Sim runs (main
// thread for LocalHost, the worker for WorkerHost), so the client never
// touches Sim, planck or Boltzmann objects.
//
// The readout lines, guide order and colours are the old main.js present().
import { unionMaskBorderLines } from './boltzmann.js';
import { windArrowSegments } from './wind.js';
import { boatTelemetryHtml } from './info.js';
import { courseGuides, courseText } from './course.js';
import { finishGuides } from './finish.js';
import { leaderboardHtml } from './leaderboard.js';
import { startGuides, startHudHtml, startStatusText } from './start.js';
import { markTouchGuides } from './mark-touch.js';
import { contactGuides, penaltyGuides, markRoomGuides, boundaryRoomGuides } from './rules.js';
import { defaultCellUpdateTarget } from './domainTrack.js';

const now = () => performance.now();

// Smooth circle per boat disk. A field island has a mask and no disk, so
// only its staircase is drawn. The light staircase is the union of every
// mask at that level: overlapping boats share one border, and a detached
// curl island keeps its own outline. A rectangle with no disk and no mask
// still uses its four sides.
export function pushRefinementGuides(guides, domains, bm) {
  const masked = [];
  for (const domain of domains) {
    if (domain.mask && !domain.disk) {
      masked.push(domain);
      continue;
    }
    // Auto layout: only the finest boat level has a fixed disk. A coarser
    // level's disk is just its grading-shell floor, so its circle is not
    // drawn; its real extent is the mask outline below.
    const shellOnly = bm.amrMode === 'auto' && domain.disk && domain.domains.length > 0;
    for (const seg of shellOnly ? [] : domain.worldBorderLines(bm)) {
      if (domain.disk && seg.dim) continue;
      guides.push({
        color: seg.dim ? 0x8899aa : 0x000000,
        opacity: seg.dim ? 0.35 : 1,
        type: 'guide',
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
      });
    }
    if (domain.disk) masked.push(domain);
  }
  for (const seg of unionMaskBorderLines(masked, bm)) {
    // Full-opacity light line: the 0.35 gray sat on the dark speed field
    // and the merged border could not be told from the black per-boat circles.
    guides.push({ color: 0x9ad0ff, opacity: 1, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
  }
  const children = [];
  for (const domain of domains) children.push(...domain.domains);
  if (children.length) pushRefinementGuides(guides, children, bm);
}

// Readout, HUD and guides for the step just taken (rec = sim.step's record).
// view: { camera_position_x, camera_position_y, show_forces, ... } (the
// client's View or a plain copy of it). Returns
//   { dist: string | null (null = leave as is), info: string,
//     startHud: { html, flash } | null (null = hidden),
//     results: string | null (null = hidden), guides: [] }
export function presentStep(sim, rec, view) {
  sim.activate();
  const map = sim.map, bm = sim.bm;
  const guides = [];
  const racing = sim.players;
  let info = '';
  const out = { dist: null, info: '', startHud: null, results: null, guides };

  if (rec.distSum !== null) out.dist = "Dist: " + Math.floor(rec.distSum * 100) / 100 + "<br>";

  // Each boat's step used to reset the readout and append "Phys Time", so the
  // last boat with telemetry leads, followed by one Phys Time per later boat.
  const k = rec.telemetryIndex;
  info = k >= 0 ? boatTelemetryHtml(racing[k].telemetry) : '';
  for (let i = Math.max(0, k); i < rec.physTimes.length; i++) info += "Phys Time: " + rec.physTimes[i] + "<br>";
  for (const player of racing) guides.push(...player.graphics_model_render(view));
  for (const mark of sim.marks) guides.push(...mark.graphics_model_render());
  // Spawned (player) boats carry a name badge.
  for (const b of racing) {
    if (b.spawnName) guides.push({ type: 'label', badge: true, x: b.x, y: b.y + 4, lines: [{ text: b.spawnName, role: 'markno', id: 'name' }] });
  }

  const startSeq = sim.startSequence;
  if (startSeq) {
    guides.push(...startGuides(startSeq, racing[0], now()));
    out.startHud = { html: startHudHtml(startSeq, racing[0]), flash: !!startSeq.flashing };
    if (racing[0]) info += 'Start: ' + startStatusText(startSeq, racing[0]) + '<br>';
  }

  const course = sim.course;
  if (course && racing[0]) {
    const progress = course.progressFor(racing[0]);
    guides.push(...courseGuides(course, progress, now()));
    info += courseText(progress) + '<br>';
  }

  const results = sim.raceResults;
  if (course && course.finish && results) {
    guides.push(...finishGuides(course, racing[0] ? course.progressFor(racing[0]) : null, results, racing, rec.raceClock, now()));
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
    guides.push(...boundary.guides());
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
  guides.push(...boundaryRoomGuides(resolutions, racing));
  for (const r of resolutions) {
    const m = r.markRoom;
    if (!m) continue;
    info += 'Rule 18.2: boat ' + racing.indexOf(m.giveWay) + ' gives mark-room to boat ' + racing.indexOf(m.rightOfWay) + ' (' + m.basis + ' at the zone)' + (m.decisive ? ' · decides fault' : '') + '<br>';
  }
  guides.push(...markRoomGuides(resolutions, racing));
  for (let i = 0; i < resolutions.length; i++) {
    const pairGuides = resolutions[i].guides;
    if (pairGuides && pairGuides.length) guides.push(...pairGuides);
  }
  guides.push(...markTouchGuides());
  guides.push(...contactGuides());
  guides.push(...penaltyGuides(racing));

  if (!map.devMode) pushRefinementGuides(guides, bm.domains, bm);
  if (map.devMode) {
    const wind = map.get_wind(0, 0);
    // wind.direction is where the wind comes from. The arrow points downwind,
    // along (vx, vy), matching the lattice flow and the sail-drag push.
    const flowDeg = Math.atan2(wind.vy, wind.vx) * 180 / Math.PI;
    const ox = view.camera_position_x - 14;
    const oy = view.camera_position_y + 4;
    for (const seg of windArrowSegments(ox, oy, flowDeg, 8)) {
      guides.push({ color: 0x66eeff, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
    }
  }
  out.info = info;
  return out;
}

// Outlines of the planck bodies, as the renderer used to read them from the
// world: [{ id, kind: 'circle' | 'edge' | 'polygon', stroke, pts: [x, y, ...] }].
// ids is a WeakMap fixture → id kept by the caller (stable across steps).
const COLOR_BY_TYPE = { circle: 0x00ff00, edge: 0xff0000, polygon: 0x0000ff };
let _nextFixtureId = 1;
export function bodyOutlines(world, ids) {
  const out = [];
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      if (body.render && body.render.hidden) continue;
      const kind = fixture.getType();
      if (kind !== 'circle' && kind !== 'edge' && kind !== 'polygon') continue;
      let id = ids.get(fixture);
      if (id === undefined) { id = _nextFixtureId++; ids.set(fixture, id); }
      const stroke = body.render && typeof body.render.stroke === 'number' ? body.render.stroke : COLOR_BY_TYPE[kind];
      const shape = fixture.getShape();
      let pts;
      if (kind === 'circle') {
        const radius = shape.m_radius;
        const p = body.getPosition();
        pts = new Array(74);
        for (let i = 0; i < 36; i++) {
          const a = i * 10 / 180 * Math.PI;
          pts[i * 2] = radius * Math.cos(a) + p.x;
          pts[i * 2 + 1] = radius * Math.sin(a) + p.y;
        }
        pts[72] = pts[0]; pts[73] = pts[1];
      } else if (kind === 'edge') {
        const v1 = shape.m_vertex1, v2 = shape.m_vertex2, p = body.m_xf.p;
        pts = [v1.x + p.x, v1.y + p.y, v2.x + p.x, v2.y + p.y];
      } else {
        const vertices = shape.m_vertices;
        const n = vertices.length;
        const angle = body.getAngle() + Math.PI;
        const com = body.getLocalCenter();
        const cx = fixture.m_body.c_position.c.x;
        const cy = fixture.m_body.c_position.c.y;
        const c = Math.cos(angle), s = Math.sin(angle);
        pts = new Array((n + 1) * 2);
        for (let i = 0; i <= n; i++) {
          const v = vertices[i % n];
          pts[i * 2] = (v.x + com.x) * c + (v.y - com.y) * s + cx;
          pts[i * 2 + 1] = (v.x + com.x) * s - (v.y - com.y) * c + cy;
        }
      }
      out.push({ id, kind, stroke, pts });
    }
  }
  return out;
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
