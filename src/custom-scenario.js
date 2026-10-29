// Custom scenario from the room TOML (`scenario = "custom"` + `[custom]`).
// Only statics: marks, start line + sequence, course, finish, boundary.
// No boats or scripts: players join with spawnBoat (sim.js spawnPoint puts
// them below the start line). World metres, origin at the map centre, +Y up
// (wind_angle_deg = 90 is wind from +Y). Validation is pure (no Sim) so the
// page, SimCore and the server run the same checks (room-config.js).
import { Mark, DEFAULT_MARK_MASS } from './mark.js';
import { Course, Gate, PORT, STARBOARD } from './course.js';
import { StartLine, StartSequence, RRS_START_TIMINGS, COMPRESSED_START_TIMINGS } from './start.js';
import { FinishLine, RaceResults } from './finish.js';
import { Boundary, BOUNDARY_INSET_M, BOUNDARY_ZONE_M } from './boundary.js';
import { nameMarks } from './mark-touch.js';
import { WALL_INSET_M } from './map-size.js';

export const CUSTOM_SCENARIO = 'custom';
export const CUSTOM_MAX_MARKS = 16;
export const CUSTOM_MAX_LAPS = 20;
export const CUSTOM_WALL_MARGIN_M = 3;   // marks this far inside the walls
export const CUSTOM_MARK_MIN_GAP_M = 3;  // between mark anchors
export const CUSTOM_OBSTACLE_GAP_M = 3;  // clear of map.js fixed circles
export const CUSTOM_LINE_MIN_M = 5;      // start / finish line length
export const CUSTOM_GATE_MIN_M = 6;      // gate width
// map.js physics_model_init: two fixed circles near the centre on every map.
export const MAP_OBSTACLES = [{ x: 0, y: 14.5, r: 0.5 }, { x: 0, y: 20, r: 5 }];

const ID_RE = /^[a-z0-9_]{1,12}$/;
const TOP_KEYS = ['title', 'description', 'marks', 'start', 'course', 'finish', 'boundary'];
const START_KEYS = ['committee', 'pin', 'timings', 'lead_s'];
const COURSE_KEYS = ['laps', 'legs'];
const FINISH_KEYS = ['committee', 'pin'];
const BOUNDARY_KEYS = ['inset_m', 'zone_m', 'y_min_m', 'y_max_m'];

const isTable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v) => String(Math.round(v * 10) / 10);

function noUnknown(obj, keys, path) {
  const bad = Object.keys(obj).filter((k) => !keys.includes(k));
  if (bad.length) throw 'unknown key(s) in [' + path + ']: ' + bad.join(', ');
}

/**
 * Validate the TOML `[custom]` table against a map size.
 * Returns the normalised layout (plain JSON) or throws a message string.
 * Layout: { title, description, marks: [{ id, x, y }], start, course, finish, boundary }
 */
export function validateCustomLayout(raw, mapW, mapH) {
  if (raw === undefined || raw === null) raw = {};
  if (!isTable(raw)) throw '[custom] must be a table';
  noUnknown(raw, TOP_KEYS, 'custom');
  const out = { title: 'Custom course', description: '', marks: [], start: null, course: null, finish: null, boundary: null };
  if ('title' in raw) {
    if (typeof raw.title !== 'string' || raw.title.length > 80) throw 'custom.title must be a string (max 80 characters)';
    out.title = raw.title;
  }
  if ('description' in raw) {
    if (typeof raw.description !== 'string' || raw.description.length > 2000) throw 'custom.description must be a string (max 2000 characters)';
    out.description = raw.description;
  }

  // Marks: id = [x, y].
  const marks = raw.marks === undefined ? {} : raw.marks;
  if (!isTable(marks)) throw 'custom.marks must be a table of id = [x, y]';
  const ids = Object.keys(marks);
  if (ids.length > CUSTOM_MAX_MARKS) throw 'custom.marks: at most ' + CUSTOM_MAX_MARKS + ' marks';
  const xMax = mapW / 2 - WALL_INSET_M - CUSTOM_WALL_MARGIN_M;
  const yMax = mapH / 2 - WALL_INSET_M - CUSTOM_WALL_MARGIN_M;
  const byId = new Map();
  for (const id of ids) {
    if (!ID_RE.test(id)) throw 'mark id "' + id + '": use 1–12 of a-z 0-9 _';
    const p = marks[id];
    if (!Array.isArray(p) || p.length !== 2 || !num(p[0]) || !num(p[1])) throw 'custom.marks.' + id + ' must be [x, y] in metres';
    const [x, y] = p;
    if (Math.abs(x) > xMax || Math.abs(y) > yMax) {
      throw 'mark ' + id + ' (' + fmt(x) + ', ' + fmt(y) + ') is outside this ' + mapW + ' x ' + mapH + ' m room (|x| ≤ ' + fmt(xMax) + ', |y| ≤ ' + fmt(yMax) + ')';
    }
    for (const o of MAP_OBSTACLES) {
      const d = Math.hypot(x - o.x, y - o.y) - o.r;
      if (d < CUSTOM_OBSTACLE_GAP_M) throw 'mark ' + id + ' is ' + fmt(Math.max(0, d)) + ' m from the fixed obstacle at (' + o.x + ', ' + o.y + ') (min ' + CUSTOM_OBSTACLE_GAP_M + ' m)';
    }
    for (const m of out.marks) {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < CUSTOM_MARK_MIN_GAP_M) throw 'marks ' + m.id + ' and ' + id + ' are ' + fmt(d) + ' m apart (min ' + CUSTOM_MARK_MIN_GAP_M + ' m)';
    }
    const m = { id, x, y };
    out.marks.push(m);
    byId.set(id, m);
  }

  // Each mark has at most one role.
  const roles = new Map();
  // group: marks may be reused within the same group only (a course mark
  // rounded on several legs; the start line reused as the finish line).
  const use = (id, role, path, group = null) => {
    if (typeof id !== 'string') throw path + ' must be a mark id';
    if (!byId.has(id)) throw path + ': no mark "' + id + '"';
    const prev = roles.get(id);
    if (prev && !(group && prev.group === group)) throw 'mark ' + id + ' is used twice (' + prev.role + ' and ' + role + ')';
    if (!prev) roles.set(id, { role, group });
    return byId.get(id);
  };
  const lineLen = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  if (raw.start !== undefined) {
    const s = raw.start;
    if (!isTable(s)) throw '[custom.start] must be a table';
    noUnknown(s, START_KEYS, 'custom.start');
    const c = use(s.committee, 'start committee', 'custom.start.committee', 'start committee');
    const p = use(s.pin, 'start pin', 'custom.start.pin', 'start pin');
    const L = lineLen(c, p);
    if (L < CUSTOM_LINE_MIN_M) throw 'start line ' + c.id + '–' + p.id + ' is ' + fmt(L) + ' m long (min ' + CUSTOM_LINE_MIN_M + ' m)';
    let timings;
    const t = s.timings === undefined ? 'compressed' : s.timings;
    const tErr = 'custom.start.timings: "rrs", "compressed" or { warning, prep, one_minute } with warning > prep > one_minute > 0';
    if (t === 'rrs') timings = 'rrs';
    else if (t === 'compressed') timings = 'compressed';
    else if (isTable(t)) {
      const bad = Object.keys(t).filter((k) => !['warning', 'prep', 'one_minute'].includes(k));
      if (bad.length) throw tErr;
      const { warning, prep, one_minute: om } = t;
      if (!num(warning) || !num(prep) || !num(om) || !(warning > prep && prep > om && om > 0) || warning > 600) throw tErr;
      timings = { warning, prep, one_minute: om };
    } else throw tErr;
    const lead = s.lead_s === undefined ? 0 : s.lead_s;
    if (!num(lead) || lead < 0 || lead > 60) throw 'custom.start.lead_s must be 0..60';
    out.start = { committee: c.id, pin: p.id, timings, lead_s: lead };
  }

  if (raw.course !== undefined) {
    const c = raw.course;
    if (!isTable(c)) throw '[custom.course] must be a table';
    noUnknown(c, COURSE_KEYS, 'custom.course');
    let laps = null;
    if (c.laps !== undefined) {
      if (!Number.isInteger(c.laps) || c.laps < 1 || c.laps > CUSTOM_MAX_LAPS) throw 'custom.course.laps must be an integer 1..' + CUSTOM_MAX_LAPS + ' (leave it out to loop)';
      laps = c.laps;
    }
    if (!Array.isArray(c.legs)) throw 'custom.course.legs must be a list of { mark = "id", round = "port" } or { gate = ["a", "b"] }';
    const legs = c.legs.map((leg, i) => {
      const path = 'custom.course.legs[' + i + ']';
      if (!isTable(leg)) throw path + ': give mark = "id" or gate = ["a", "b"]';
      if ('gate' in leg) {
        noUnknown(leg, ['gate'], path);
        const g = leg.gate;
        if (!Array.isArray(g) || g.length !== 2) throw path + '.gate must be ["a", "b"]';
        const a = use(g[0], 'gate ' + (i + 1), path + '.gate[0]', 'gate ' + g[0] + '/' + g[1]);
        const b = use(g[1], 'gate ' + (i + 1), path + '.gate[1]', 'gate ' + g[0] + '/' + g[1]);
        if (a === b) throw path + '.gate needs two different marks';
        const w = lineLen(a, b);
        if (w < CUSTOM_GATE_MIN_M) throw 'gate ' + a.id + '–' + b.id + ' is ' + fmt(w) + ' m wide (min ' + CUSTOM_GATE_MIN_M + ' m)';
        return { gate: [a.id, b.id] };
      }
      if ('mark' in leg) {
        noUnknown(leg, ['mark', 'round'], path);
        const round = leg.round === undefined ? 'port' : leg.round;
        if (round !== 'port' && round !== 'starboard') throw path + '.round must be "port" or "starboard"';
        const m = use(leg.mark, 'course leg ' + (i + 1), path + '.mark', 'mark ' + round);
        return { mark: m.id, round };
      }
      throw path + ': give mark = "id" or gate = ["a", "b"]';
    });
    out.course = { laps, legs };
  }

  if (raw.finish !== undefined) {
    const f = raw.finish;
    if (!isTable(f)) throw '[custom.finish] must be a table';
    noUnknown(f, FINISH_KEYS, 'custom.finish');
    if (!out.course || out.course.laps === null) throw 'custom.finish needs custom.course with a finite laps';
    // The finish may reuse the start line (same committee and pin).
    const c = use(f.committee, 'finish boat', 'custom.finish.committee', 'start committee');
    const p = use(f.pin, 'finish pin', 'custom.finish.pin', 'start pin');
    const L = lineLen(c, p);
    if (L < CUSTOM_LINE_MIN_M) throw 'finish line ' + c.id + '–' + p.id + ' is ' + fmt(L) + ' m long (min ' + CUSTOM_LINE_MIN_M + ' m)';
    out.finish = { committee: c.id, pin: p.id };
  }
  if (out.course && out.course.legs.length < (out.finish ? 1 : 2)) throw 'custom.course needs at least 2 legs (1 with a finish)';

  if (raw.boundary !== undefined) {
    const b = raw.boundary;
    if (!isTable(b)) throw '[custom.boundary] must be a table';
    noUnknown(b, BOUNDARY_KEYS, 'custom.boundary');
    const insetMax = Math.min(BOUNDARY_INSET_M, mapW * 0.08);
    const zoneMax = Math.min(BOUNDARY_ZONE_M, mapW * 0.2);
    const inset = b.inset_m === undefined ? insetMax : b.inset_m;
    const zone = b.zone_m === undefined ? zoneMax : b.zone_m;
    if (!num(inset) || inset < 0 || inset > insetMax + 1e-9) throw 'custom.boundary.inset_m must be 0..' + fmt(insetMax) + ' m (8% of the map width, at most ' + BOUNDARY_INSET_M + ')';
    if (!num(zone) || zone < 2 || zone > zoneMax + 1e-9) throw 'custom.boundary.zone_m must be 2..' + fmt(zoneMax) + ' m (20% of the map width, at most ' + BOUNDARY_ZONE_M + ')';
    const yLim = mapH / 2;
    const y0 = b.y_min_m === undefined ? -yLim : b.y_min_m;
    const y1 = b.y_max_m === undefined ? yLim : b.y_max_m;
    if (!num(y0) || !num(y1) || !(y0 < y1)) throw 'custom.boundary: y_min_m must be less than y_max_m';
    out.boundary = { inset_m: inset, zone_m: zone, y_min_m: y0, y_max_m: y1 };
  }
  return out;
}

/** TOML-shaped object for a normalised layout (inverse of validateCustomLayout). */
export function customLayoutToToml(L) {
  const t = { title: L.title };
  if (L.description) t.description = L.description;
  if (L.marks.length) { t.marks = {}; for (const m of L.marks) t.marks[m.id] = [m.x, m.y]; }
  if (L.start) t.start = { ...L.start };
  if (L.course) {
    t.course = {};
    if (L.course.laps !== null) t.course.laps = L.course.laps;
    t.course.legs = L.course.legs.map((l) => ({ ...l }));
  }
  if (L.finish) t.finish = { ...L.finish };
  if (L.boundary) t.boundary = { ...L.boundary };
  return t;
}

function startTimings(t) {
  if (t === 'rrs') return RRS_START_TIMINGS;
  if (t === 'compressed' || !t) return COMPRESSED_START_TIMINGS;
  return { warning: t.warning, prep: t.prep, oneMinute: t.one_minute, xFlag: t.prep };
}

/**
 * Build a validated layout on the Sim (scenario frame 0): marks, start line
 * and sequence, course, finish + results, boundary. Returns the built parts.
 */
export function buildCustomLayout(sim, L) {
  const map = sim.map;
  const byId = new Map();
  for (const m of L.marks) {
    const mark = new Mark(map, m.x, m.y, { mass: DEFAULT_MARK_MASS });
    mark.customId = m.id;
    byId.set(m.id, mark);
    sim.marks.push(mark);
  }
  let elements = null, sides = null;
  if (L.course) {
    elements = L.course.legs.map((l) => (l.gate ? new Gate(byId.get(l.gate[0]), byId.get(l.gate[1])) : byId.get(l.mark)));
    sides = L.course.legs.map((l) => (l.round === 'starboard' ? STARBOARD : PORT));
  }
  const anchor = (el) => (el instanceof Gate ? el.anchor : el.anchor);
  let line = null;
  if (L.start) {
    const courseSide = elements ? anchor(elements[0]) : null;
    line = new StartLine(byId.get(L.start.committee), byId.get(L.start.pin), courseSide);
    sim.startSequence = new StartSequence(line, { timings: startTimings(L.start.timings), lead: L.start.lead_s });
  }
  if (elements) {
    let finish = null;
    if (L.finish) finish = new FinishLine(byId.get(L.finish.committee), byId.get(L.finish.pin), anchor(elements[elements.length - 1]));
    const opts = { sides, laps: L.course.laps ?? undefined, finish };
    if (line) { opts.start = line.mid; opts.startSequence = sim.startSequence; }
    sim.course = new Course(elements, opts);
    if (finish) sim.raceResults = new RaceResults(sim.course);
  }
  nameMarks(sim.course, sim.startSequence);
  if (L.boundary) {
    sim.boundary = new Boundary(map.width, { inset: L.boundary.inset_m, zone: L.boundary.zone_m, yMin: L.boundary.y_min_m, yMax: L.boundary.y_max_m });
  }
  return { marks: byId, line, course: sim.course, boundary: sim.boundary };
}

/** Scenario entry for Sim.loadScenario('custom'). */
export function customScenario(sim, L) {
  return {
    title: L.title,
    description: L.description || '',
    frames: { 0: () => buildCustomLayout(sim, L) },
  };
}
