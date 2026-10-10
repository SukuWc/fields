// Headless checks for rule 31 mark touches (src/mark-touch.js): one pending
// penalty per touch, latching, racing from the preparatory signal, clearing
// with a tack + gybe, and no effect on the boat-boat rules.
// Run: node --import ./test/register.mjs scripts/mark-touch-check.mjs

const info = { innerHTML: "" };
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() { return info; },
  getElementsByTagName() { return []; },
  currentScript: { src: "http://localhost/mark-touch-check.mjs" },
  createElement() { return { getContext() { return null; } }; },
};

const { Map } = await import("../src/map.js");
const { Boat } = await import("../src/boat.js");
const { Mark, markMassForBoat } = await import("../src/mark.js");
const {
  recordMarkTouches, resetMarkTouches, getMarkTouches, nameMarks, markTouchGuides,
  hullMarkClearance, MARK_TOUCH_REARM_M,
} = await import("../src/mark-touch.js");
const {
  evaluateAllPairs, recordContacts, resetContacts, resetRule15Memory, getIncidents,
  pendingPenaltyCount, pendingPenaltiesOf, pendingPenaltyReason, notePenaltyManeuver, penaltyGuides, faultBadgeText,
} = await import("../src/rules.js");
const { Course, Gate } = await import("../src/course.js");
const { StartLine, StartSequence, COMPRESSED_START_TIMINGS, START_COURSE_LAYOUT } = await import("../src/start.js");

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log("ok  ", message);
}

const DT = 1 / 30;

// A 4 m × 1.5 m box hull pointing north, centre (x, y).
function boatAt(x, y) {
  const b = {};
  place(b, x, y);
  return b;
}
function place(b, x, y) {
  b.x = x;
  b.y = y;
  b.hull_angle = Math.PI;
  b.hull = [{ x: x - 0.75, y: y - 2 }, { x: x + 0.75, y: y - 2 }, { x: x + 0.75, y: y + 2 }, { x: x - 0.75, y: y + 2 }];
}
const plainMark = (x, y, name) => ({ x, y, radius: 0.5, anchor: { x, y }, markName: name });

// --- Geometry ---
{
  const b = boatAt(0, 0);
  const m = plainMark(2, 0);
  assert(Math.abs(hullMarkClearance(b, m) - 0.75) < 1e-9, "hull-to-buoy clearance (0.75 m gap)");
  m.x = 1.0;
  assert(hullMarkClearance(b, m) < 0, "overlap is negative");
}

// --- Sustained touch is one penalty; a separate touch is another ---
{
  resetContacts();
  resetMarkTouches();
  const b = boatAt(0, 0);
  const m = plainMark(1.2, 0, "mark 2");
  let t = 0;
  for (let i = 0; i < 60; i++) {
    place(b, 0, -1 + i * 0.03); // slide along the buoy, touching all the way
    recordMarkTouches([b], [m], { simTime: (t += DT), nowMs: 0 });
  }
  assert(pendingPenaltyCount(b) === 1 && getMarkTouches().length === 1, "sustained contact (sliding along the buoy) is one penalty");
  assert(pendingPenaltyReason(b) === "Rule 31: touched mark 2", `reason recorded: "${pendingPenaltyReason(b)}"`);
  // Pull away less than the re-arm distance and back: still the same touch.
  place(b, -(MARK_TOUCH_REARM_M * 0.5), 0);
  recordMarkTouches([b], [m], { simTime: (t += DT) });
  place(b, 0, 0);
  recordMarkTouches([b], [m], { simTime: (t += DT) });
  assert(pendingPenaltyCount(b) === 1, `backing off < ${MARK_TOUCH_REARM_M} m and touching again does not stack`);
  place(b, -1, 0);
  recordMarkTouches([b], [m], { simTime: (t += DT) });
  place(b, 0, 0);
  recordMarkTouches([b], [m], { simTime: (t += DT) });
  assert(pendingPenaltyCount(b) === 2 && getMarkTouches().length === 2, "clear by more than the re-arm distance, touch again: a second penalty");
  const q = pendingPenaltiesOf(b);
  assert(q.every((e) => e.incident.rule === "31" && e.incident.kind === "mark"), "both queued as rule 31 mark touches");
  const labels = penaltyGuides([b], 0).filter((g) => g.type === "label").map((g) => g.lines[0].text);
  assert(labels.includes("FAULT x2 · Rule 31 · touched mark 2"), `FAULT badge shows the reason: ${labels.join(", ")}`);
  assert(markTouchGuides(0).some((g) => g.color === 0xff3b30), "touched buoy flashes red");
  assert(markTouchGuides(5000).length === 0, "flash ends");
  assert(getIncidents().length === 0, "no boat-boat incident from mark touches");
}

// --- Clears with a tack + gybe (One-Turn Penalty, RRS 44.1) ---
{
  resetContacts();
  resetMarkTouches();
  const b = boatAt(0, 0);
  const m = plainMark(1.2, 0);
  recordMarkTouches([b], [m], { simTime: 0 });
  assert(pendingPenaltyCount(b) === 1 && pendingPenaltyReason(b) === "Rule 31: touched mark", "touch charged (unnamed mark)");
  const seq = [45, 30, 15, 5, -5, -15, -30, -45, -90, -150, -175, 175, 150, 90];
  let cleared = null;
  for (const twa of seq) {
    const r = notePenaltyManeuver(b, twa, { dtS: 0.2, nowMs: 0 });
    if (r && r.cleared) cleared = r.cleared;
  }
  assert(pendingPenaltyCount(b) === 0 && cleared && cleared.incident.rule === "31", "a tack and a gybe in a row clear the rule 31 penalty");
}

// --- Racing from the preparatory signal ---
{
  resetContacts();
  resetMarkTouches();
  const L = START_COURSE_LAYOUT;
  const rc = plainMark(L.committee.x, L.committee.y);
  const pin = plainMark(L.pin.x, L.pin.y);
  const wm = plainMark(L.windward.x, L.windward.y);
  const ga = plainMark(L.gate[0].x, L.gate[0].y);
  const gb = plainMark(L.gate[1].x, L.gate[1].y);
  const line = new StartLine(rc, pin, L.windward);
  const s = new StartSequence(line, { timings: COMPRESSED_START_TIMINGS, lead: 0 });
  const course = new Course([wm, new Gate(ga, gb)], { start: line.mid, startSequence: s });
  nameMarks(course, s);
  assert([rc, pin, wm, ga, gb].map((m) => m.markName).join(",") === "RC,pin,mark 1,gate 2,gate 2", "marks named for the reason text");
  const marks = [rc, pin, wm, ga, gb];
  const b = boatAt(L.pin.x - 1.2, L.pin.y);
  const away = () => place(b, L.pin.x - 4, L.pin.y);
  const touch = () => place(b, L.pin.x - 1.2, L.pin.y);
  s.step(5); // −55 s: warning period
  assert(!s.racing, "not racing before the preparatory signal");
  recordMarkTouches([b], marks, { simTime: 5, racing: s.racing });
  assert(pendingPenaltyCount(b) === 0, "touching the pin before the preparatory signal: no penalty");
  away();
  recordMarkTouches([b], marks, { simTime: 6, racing: s.racing });
  while (s.clock < -COMPRESSED_START_TIMINGS.prep + 0.5) s.step(DT);
  assert(s.racing, "racing from the preparatory signal");
  touch();
  recordMarkTouches([b], marks, { simTime: 20, racing: s.racing });
  assert(pendingPenaltyCount(b) === 1 && pendingPenaltyReason(b) === "Rule 31: touched pin", `touching the pin after it: "${pendingPenaltyReason(b)}"`);
  place(b, L.gate[1].x + 1.2, L.gate[1].y);
  recordMarkTouches([b], marks, { simTime: 21, racing: s.racing });
  assert(pendingPenaltyCount(b) === 2 && pendingPenaltiesOf(b)[1].incident.reason === "Rule 31: touched gate 2", "gate mark touch charged too");
}

// --- Scenario 11 in planck: exactly one penalty after the hit ---
{
  resetRule15Memory();
  resetContacts();
  resetMarkTouches();
  const map = new Map(75, 75, 90, 15, null);
  map.physics_model_init();
  map.setDevMode(true);
  const heading = 5 * Math.PI / 4 + 5 * Math.PI / 180;
  const fx = Math.sin(heading);
  const fy = -Math.cos(heading);
  const boat = new Boat(map, 12, -10, heading);
  boat.physics_model.setLinearVelocity({ x: fx * 1.9, y: fy * 1.9 });
  const mark = new Mark(map, 12 + fx * 9, -10 + fy * 9, { mass: markMassForBoat(boat.physics_model) });
  boat.input_autopilot_enabled_toggle();
  let simTime = 0;
  let firstAt = null;
  for (let i = 0; i < 20 * 30; i++) {
    boat.physics_model_step();
    mark.physics_model_step();
    map.world.step(DT);
    simTime += DT;
    const res = evaluateAllPairs([boat], (x, y) => map.get_wind(x, y), simTime);
    recordContacts(res, simTime, [boat]);
    const c = recordMarkTouches([boat], [mark], { simTime });
    if (c.length && firstAt === null) firstAt = simTime;
  }
  assert(firstAt !== null && firstAt < 6, `scenario 11 hit charged at ${firstAt && firstAt.toFixed(2)} s`);
  assert(pendingPenaltyCount(boat) === 1 && pendingPenaltyReason(boat) === "Rule 31: touched mark", `exactly one rule 31 penalty after the hit (${pendingPenaltyCount(boat)})`);
  assert(getIncidents().length === 0, "no boat-boat incident");
  assert(Number.isFinite(boat.x) && Number.isFinite(boat.y), "boat stays finite");
}

// --- Boat-boat rules unaffected: two boats colliding still charge as before ---
{
  resetRule15Memory();
  resetContacts();
  resetMarkTouches();
  const map = new Map(75, 75, 90, 15, null);
  map.physics_model_init();
  map.setDevMode(true);
  // Port boat crossing a starboard boat (rule 10): port is at fault.
  const stbd = new Boat(map, 0, 0, 5 * Math.PI / 4);
  const port = new Boat(map, -6, 0.5, 3 * Math.PI / 4);
  const mark = new Mark(map, 20, 20, { mass: markMassForBoat(stbd.physics_model) });
  let simTime = 0;
  let hit = false;
  for (let i = 0; i < 20 * 30 && !hit; i++) {
    stbd.physics_model_step();
    port.physics_model_step();
    mark.physics_model_step();
    map.world.step(DT);
    simTime += DT;
    const res = evaluateAllPairs([stbd, port], (x, y) => map.get_wind(x, y), simTime);
    recordContacts(res, simTime, [stbd, port]);
    recordMarkTouches([stbd, port], [mark], { simTime });
    hit = getIncidents().length > 0;
  }
  const inc = getIncidents()[0];
  assert(hit && inc.finalRule !== "31" && getMarkTouches().length === 0, `boat-boat contact still makes a pair incident (rule ${inc && inc.finalRule}), no mark touch`);
  const fault = inc.faultBoat;
  assert(pendingPenaltyCount(fault) === 1 && pendingPenaltyReason(fault) === null, "boat-boat penalty charged as before, plain FAULT badge");
  assert(faultBadgeText(fault) === "FAULT", "badge text unchanged for boat-boat faults");
}

if (!process.exitCode) console.log("mark-touch-check: all passed");
