// Host side of the scene: the compact game state the client draws from.
// Runs wherever the Sim runs (LocalHost: main thread, WorkerHost: the
// worker, apps/server). Instead of drawn geometry (guide segments, body
// outlines) a frame carries `state`, a few numbers per object, and the host
// sends `statics` (shapes and layouts that only change on restart, spawn,
// resolution change) once per change. scene-build.js turns state + statics
// into the guides and outlines the renderer draws, with the same code in
// every host mode.
//
// sceneState(sim, rec, view, nowMs) → state:
//   t      host clock (ms) for pulses and flash ages
//   hud    readout / HUD values (hud.js hudState; marked exact: no rounding)
//   boats  per racing boat: Boat.renderState (boat-draw.js); id (boat id),
//          vx, vy, w (ghost prediction, 1e-3)
//   ts, ep sim time (Sim.rulesTime) and scenario epoch, for boat trails
//   bc     own boat colours (spawnBoat color) or null per boat, when any
//   aw     per boat: whole seconds until an absent owner's boat is removed
//          (server grace period, apps/server/room.js) or null, when any
//   mk     mark buoy positions [[x, y], ...] (anchors in statics.marks)
//   start  startGuideState (start.js) for boat 0
//   course courseGuideState (course.js) for boat 0
//   finish finishGuideState (finish.js)
//   br, mr boundary-room / mark-room badges: [[entitled, giving boat id]]
//          (rules.js roomGuideState)
//   pair   rule-resolver pair overlays: [rules.js pairStateFor] (only
//          during encounters; boat ids and rule codes, host-protocol.js)
//   mt, cf mark-touch and contact flashes ([{ ..., age }])
//   pen    penaltyGuideState (rules.js)
//   amr    refinement domains (outline only): { mode, d: [domain] } with
//          domain = { x, y, w, h (parent cells), dx, rx, ry (root origin),
//          k: [cx, cy, radius] | 0 (disk), m: run lengths of the mask | null,
//          c: [children] }; absent in dev mode
//   wind   dev mode: flow direction (deg) for the wind arrow
//   ladder downwind-distance ladder polylines from the first mark
//          (ladder-lines.js): [[x0,y0,…], …] for 20 m and 40 m when
//          sim.options.ladder is on and a mark exists
//   gust   moving-column 1σ ellipses (gusts.js): [[x,y,σ_along,σ_cross,ax,ay], …]
//          for each alive column; (ax,ay) = along-wind unit, cross = (−ay,ax)
//   bt     transforms of the moving bodies, flat, in statics.bodies order
// sceneStatics(sim) → statics:
//   lat    { w, h, res } root lattice (for the refinement outlines)
//   defs   per racing boat: Boat.renderDef + name (spawned boats)
//   marks  mark anchors [[x, y], ...]
//   hulls  { [boat id]: { v (local hull vertices), com } } for ghost boats
//          and the rule overlays' stern marks
//   start, finish  line geometry; course courseStatics; boundary { x, zone, yMin, yMax }
//   bodies [{ id, kind, stroke, pts }] (static bodies: final outline) or
//          { id, kind, stroke, r | v (local vertices), com? } (moving bodies)
import { lineState, startGuideState } from './start.js';
import { courseStatics, courseGuideState } from './course.js';
import { finishLineState, finishGuideState } from './finish.js';
import { roomGuideState, contactFlashState, penaltyGuideState, pairStateFor } from './rules.js';
import { markTouchState } from './mark-touch.js';
import { hudState } from './hud.js';
import { markExact } from './host-protocol.js';
import { ladderState } from './ladder-lines.js';
import { gustState } from './gusts.js';

// Mask (Uint8Array, refined = 1) → run lengths, alternating starting with
// unrefined, base 36, comma separated.
export function encodeMaskRuns(mask) {
  const runs = [];
  let cur = 0, n = 0;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] === 1 ? 1 : 0;
    if (v === cur) { n++; continue; }
    runs.push(n.toString(36));
    cur = v;
    n = 1;
  }
  runs.push(n.toString(36));
  return runs.join(',');
}

function domainState(d) {
  return {
    x: d.cx0, y: d.cy0, w: d.cx1 - d.cx0, h: d.cy1 - d.cy0, dx: d.dx, rx: d.cx0_root, ry: d.cy0_root,
    k: d.disk ? [d.disk.cx, d.disk.cy, d.disk.radius] : 0,
    m: d.mask ? encodeMaskRuns(d.mask) : null,
    c: d.domains.map(domainState),
  };
}

const COLOR_BY_TYPE = { circle: 0x00ff00, edge: 0xff0000, polygon: 0x0000ff };
let _nextFixtureId = 1;

// Body outlines split into statics (shapes) and per-frame transforms.
// ids: WeakMap fixture → id, shared with present.js bodyOutlines.
export function bodyScene(world, ids) {
  const statics = [];
  const bt = [];
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      if (body.render && body.render.hidden) continue;
      const kind = fixture.getType();
      if (kind !== 'circle' && kind !== 'edge' && kind !== 'polygon') continue;
      let id = ids.get(fixture);
      if (id === undefined) { id = _nextFixtureId++; ids.set(fixture, id); }
      const stroke = body.render && typeof body.render.stroke === 'number' ? body.render.stroke : COLOR_BY_TYPE[kind];
      const shape = fixture.getShape();
      const moving = !body.isStatic();
      const e = { id, kind, stroke };
      if (kind === 'circle') {
        e.r = shape.m_radius;
        const p = body.getPosition();
        if (moving) bt.push(p.x, p.y); else e.at = [p.x, p.y];
      } else if (kind === 'edge') {
        const v1 = shape.m_vertex1, v2 = shape.m_vertex2, p = body.m_xf.p;
        e.v = [v1.x, v1.y, v2.x, v2.y];
        if (moving) bt.push(p.x, p.y); else e.at = [p.x, p.y];
      } else {
        const v = [];
        for (const q of shape.m_vertices) v.push(q.x, q.y);
        e.v = v;
        const com = body.getLocalCenter();
        e.com = [com.x, com.y];
        const c = fixture.m_body.c_position.c;
        if (moving) bt.push(body.getAngle(), c.x, c.y); else e.at = [body.getAngle(), c.x, c.y];
      }
      if (moving) e.mv = 1;
      statics.push(e);
    }
  }
  return { statics, bt };
}

// Ghost hulls (ghost-boat.js): body-local hull outline per boat id.
export function hullStatics(racing) {
  const out = {};
  for (const b of racing) { const h = b.hullDef && b.hullDef(); if (h) out[b.boatId] = h; }
  return out;
}

export function sceneStatics(sim, ids, bodies = bodyScene(sim.map.world, ids)) {
  const racing = sim.players;
  const bm = sim.bm;
  const st = {
    lat: { w: bm.width, h: bm.height, res: bm.resolution },
    defs: racing.map((b) => (b.spawnName ? { ...b.renderDef(), name: b.spawnName } : b.renderDef())),
    marks: sim.marks.map((m) => [m.anchor.x, m.anchor.y]),
    bodies: bodies.statics,
    hulls: hullStatics(racing),
  };
  if (sim.startSequence) st.start = lineState(sim.startSequence.line);
  const course = sim.course;
  // A custom (TOML) layout sends its course before any boat joins, so the
  // statics are ready when the first player spawns.
  if (course && (racing[0] || sim.scenarioIndex === 'custom')) st.course = courseStatics(course);
  if (course && course.finish && sim.raceResults) st.finish = finishLineState(course.finish);
  if (sim.boundary) st.boundary = sim.boundary.boundaryState();
  return st;
}

export function sceneState(sim, rec, view, nowMs, ids, bodies = bodyScene(sim.map.world, ids)) {
  sim.activate();
  const map = sim.map, bm = sim.bm;
  const racing = sim.players;
  const s = { t: nowMs, boats: racing.map((b) => b.renderState(view)) };
  // Boat trails (boat-trails.js): sim time, scenario epoch, own boat colours.
  s.ts = sim.rulesTime;
  s.ep = sim.epoch || 0;
  if (racing.some((b) => Number.isFinite(b.spawnColor))) s.bc = racing.map((b) => (Number.isFinite(b.spawnColor) ? b.spawnColor : null));
  if (racing.some((b) => b.awayUntil != null)) s.aw = racing.map((b) => (b.awayUntil != null ? Math.max(0, Math.ceil((b.awayUntil - nowMs) / 1000)) : null));
  s.hud = markExact(hudState(sim, rec));
  if (sim.marks.length) s.mk = sim.marks.map((m) => { const p = m.physics_model.getPosition(); return [p.x, p.y]; });
  // Ladder lines (ladder-lines.js): live field sample so sail wake warps them.
  if (sim.options.ladder && sim.marks.length) {
    const m = sim.marks[0];
    const p = m.physics_model.getPosition();
    s.ladder = ladderState((x, y) => map.get_wind(x, y), p.x, p.y);
  }
  // Moving-column gust 1σ outlines (gusts.js): centre + σ axes + along unit.
  if (sim.gusts && sim.gusts.columns.length) {
    const g = gustState(sim.gusts, map);
    if (g) s.gust = g;
  }
  const seq = sim.startSequence;
  if (seq) s.start = startGuideState(seq, racing[0]);
  const course = sim.course;
  if (course && racing[0]) s.course = courseGuideState(course, course.progressFor(racing[0]));
  const results = sim.raceResults;
  if (course && course.finish && results) s.finish = finishGuideState(course, racing[0] ? course.progressFor(racing[0]) : null, results, racing, rec.raceClock);
  const res = rec.resolutions;
  const br = roomGuideState(res, racing, 'boundaryRoom');
  if (br.length) s.br = br;
  const mr = roomGuideState(res, racing, 'markRoom');
  if (mr.length) s.mr = mr;
  const pair = [];
  for (let i = 0; i < res.length; i++) {
    const p = res[i].pairState && pairStateFor(res[i].pairState, racing);
    if (p) pair.push(p);
  }
  if (pair.length) s.pair = pair;
  const mt = markTouchState(nowMs);
  if (mt.length) s.mt = mt;
  const cf = contactFlashState(nowMs);
  if (cf.length) s.cf = cf;
  const pen = penaltyGuideState(racing, nowMs);
  // Penalty badges and finish labels carry numbers that end up as text.
  if (pen.boats.length || pen.cleared.length) s.pen = markExact(pen);
  if (s.finish) markExact(s.finish.labels);
  if (!map.devMode) s.amr = { mode: bm.amrMode, d: bm.domains.map(domainState) };
  else {
    const wind = map.get_wind(0, 0);
    s.wind = Math.atan2(wind.vy, wind.vx) * 180 / Math.PI;
  }
  s.bt = bodies.bt;
  return s;
}

// Both at once (one walk over the bodies).
export function sceneFrame(sim, rec, view, nowMs, ids) {
  const bodies = bodyScene(sim.map.world, ids);
  const state = sceneState(sim, rec, view, nowMs, ids, bodies);
  return { state, statics: sceneStatics(sim, ids, bodies) };
}
