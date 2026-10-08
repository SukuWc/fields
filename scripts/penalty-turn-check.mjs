// Headless checks for the penalty turn.
// A contact fault charges one pending penalty (FIFO). A tack immediately
// followed by a gybe, or a gybe immediately followed by a tack, within
// PENALTY_MANEUVER_WINDOW_S clears one. Holding a latched contact does not
// stack another. Q/E autopilot turns are the boat methods
// input_penalty_turn_ccw / input_penalty_turn_cw: CCW increases hull angle,
// CW decreases it. They stop on the starting heading and clear through the
// same tack/gybe detector a hand-sailed turn uses.
// Run: node --import ./test/register.mjs scripts/penalty-turn-check.mjs

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");

const info = { innerHTML: "" };
// planck-with-testbed's UMD wrapper names `window` even under Node, and its
// script resolver reads document if window exists. The boat module pulls that
// bundle in; the physics step only writes to #info.
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { href: "http://localhost/" };
globalThis.document = {
  getElementById() {
    return info;
  },
  getElementsByTagName() {
    return [];
  },
  currentScript: { src: "http://localhost/penalty-turn-check.mjs" },
  createElement() {
    return { getContext() { return null; } };
  },
};

const { ConstantWind } = await import("../src/wind.js");
const { Boat } = await import("../src/boat.js");
const {
  evaluateAllPairs,
  getIncidents,
  recordContacts,
  resetContacts,
  resetRule15Memory,
  headingForward,
  boatClearance,
  SIM_STEP_S,
  chargePendingPenalty,
  notePenaltyManeuver,
  updatePenaltyManeuvers,
  penaltyGuides,
  penaltyManeuverText,
  penaltyManeuverView,
  pendingPenaltyCount,
  pendingPenaltiesOf,
  PENALTY_MANEUVER_WINDOW_S,
  PENALTY_MANEUVER_HYST_DEG,
  PENALTY_CLEARED_MS,
} = await import("../src/rules.js");

const Vec2 = planck.Vec2;
const World = planck.World;

function assert(cond, message) {
  if (!cond) {
    console.error("FAIL", message);
    process.exitCode = 1;
    throw new Error(message);
  }
}

const wind = new ConstantWind(90, 15);
const getWind = (x, y) => wind.getWind(x, y);
const world = new World(Vec2(0, 0));
const STARBOARD = 5 * Math.PI / 4;
const PORT = 3 * Math.PI / 4;

const HULL = [
  Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25), Vec2(-0.75, 0.5),
  Vec2(-0.5, 1.75), Vec2(0.5, 1.75), Vec2(0.75, 0.5), Vec2(0.75, -0.25),
  Vec2(0.5, -1.25), Vec2(0, -2.25),
];

function makeBoat(x, y, hullAngle) {
  const hull = planck.Polygon(HULL);
  const body = world.createBody({
    type: "dynamic",
    position: Vec2(x, y),
    angle: hullAngle,
  });
  body.createFixture(hull, 6);
  return {
    x,
    y,
    hull_angle: hullAngle,
    hull_shape: hull,
    physics_model: body,
    tacking: false,
  };
}

function place(boat, x, y, hullAngle) {
  boat.physics_model.setTransform(Vec2(x, y), hullAngle);
  boat.x = x;
  boat.y = y;
  boat.hull_angle = hullAngle;
}

function step(boats, simTime) {
  const resolutions = evaluateAllPairs(boats, getWind, simTime);
  recordContacts(resolutions, simTime, boats);
  return resolutions;
}

function labelsOf(boats, nowMs) {
  return penaltyGuides(boats, nowMs).filter((g) => g.type === "label");
}

function faultText(boats, nowMs) {
  const fault = labelsOf(boats, nowMs).filter((g) => g.lines[0].id === "fault");
  return fault.length ? fault[0].lines[0].text : null;
}

function turnText(boats, nowMs) {
  const turn = labelsOf(boats, nowMs).filter((g) => g.lines[0].id === "turn");
  return turn.length ? turn[0].lines[0].text : null;
}

// Signed short-way degrees.
function wrapDeg(delta) {
  let x = (delta + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

// TWA path, one physics step (SIM_STEP_S) per sample. `from` and `to` are
// unwrapped degrees, so 60 → -120 is a tack and 60 → 240 a gybe. Returns the
// maneuvers seen, as "tack" / "gybe" strings, and the clears.
function sweepTwa(boat, from, to, stepDeg = 2, nowMs = 0) {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / stepDeg));
  const seen = [];
  let clears = 0;
  for (let i = 1; i <= n; i++) {
    const r = notePenaltyManeuver(boat, wrapDeg(from + (to - from) * i / n), { nowMs });
    if (r.maneuver) seen.push(r.maneuver.kind + (r.maneuver.dir > 0 ? "+" : "-"));
    if (r.cleared) clears++;
  }
  return { seen, clears };
}

// Sit on one TWA for `seconds` of simulation time.
function hold(boat, twa, seconds, nowMs = 0) {
  const n = Math.round(seconds / SIM_STEP_S);
  for (let i = 0; i < n; i++) notePenaltyManeuver(boat, twa, { nowMs });
}

// A bare boat object for the detector, settled on port close-hauled-ish.
function fresh(twa = 60) {
  const boat = { x: 0, y: 0, hull_angle: 0 };
  notePenaltyManeuver(boat, twa, { nowMs: 0 });
  return boat;
}

function charge(boat, time) {
  chargePendingPenalty(boat, { time, finalRule: "Rule 10", faultBoat: boat });
}

// --- Rule 10 contact charges one pending penalty ---

resetRule15Memory();
resetContacts();
const port = makeBoat(0, 0, PORT);
const starboard = makeBoat(0.4, 0.2, STARBOARD);
assert(boatClearance(port, starboard) === 0, "opposite-tack hulls start overlapped");
let t = 0;
step([port, starboard], t);
assert(getIncidents().length === 1, "one contact, one incident");
assert(pendingPenaltyCount(port) === 1, "the fault boat has one pending penalty");
assert(pendingPenaltyCount(starboard) === 0, "the right-of-way boat is not charged");
assert(pendingPenaltiesOf(port)[0].incident === getIncidents()[0], "the pending entry is that incident");
assert(faultText([port, starboard], 0) === "FAULT", "one pending penalty shows FAULT");

t += SIM_STEP_S;
step([port, starboard], t);
assert(getIncidents().length === 1, "holding the overlap does not open a second incident");
assert(pendingPenaltyCount(port) === 1, "holding contact does not stack another penalty");

// A second closure stacks, and the FIFO order holds when tack + gybe clears.
place(starboard, 8, 0, STARBOARD);
assert(boatClearance(port, starboard) > 0.25, "pulled apart far enough to rearm");
t += SIM_STEP_S;
step([port, starboard], t);
place(starboard, 0.4, 0.2, STARBOARD);
t += SIM_STEP_S;
step([port, starboard], t);
assert(getIncidents().length === 2, "a new closure after separating is a new incident");
assert(pendingPenaltyCount(port) === 2, "a second collision stacks a second penalty");
assert(faultText([port], 0) === "FAULT x2", "the badge shows the stack count");
const firstIncident = getIncidents()[0];
const secondIncident = getIncidents()[1];
notePenaltyManeuver(port, 60, { nowMs: 1000 });
let r = sweepTwa(port, 60, -60, 2, 1000);
assert(r.clears === 0 && pendingPenaltyCount(port) === 2, "the tack alone leaves both pending");
r = sweepTwa(port, -60, -240, 2, 1000);
assert(r.clears === 1 && pendingPenaltyCount(port) === 1, "tack + gybe clears one of two");
assert(pendingPenaltiesOf(port)[0].incident === secondIncident, "FIFO clears the oldest incident");
assert(pendingPenaltiesOf(port)[0].incident !== firstIncident, "the first incident is the one removed");
assert(labelsOf([port], 1000).some((g) => g.lines[0].id === "cleared" && g.lines[0].text === "CLEARED"), "clearing flashes CLEARED");
assert(faultText([port], 1000) === "FAULT", "the remaining penalty is a plain FAULT");
assert(!labelsOf([port], 1000 + PENALTY_CLEARED_MS + 1).some((g) => g.lines[0].id === "cleared"), "the cleared flash expires");

// --- Tack and gybe detector ---

// Tack then gybe (counter-clockwise: TWA falls through 0°, then through -180°).
let b = fresh(60);
charge(b, 1);
r = sweepTwa(b, 60, -60);
assert(r.seen.join() === "tack+", "port to starboard through head to wind is one CCW tack, got " + r.seen);
assert(pendingPenaltyCount(b) === 1, "a tack alone does not clear");
assert(penaltyManeuverView(b).first === "tack", "the tack waits for a gybe");
assert(/^Tack ✓ · Gybe … \d+\.\ds$/.test(turnText([b], 0)), "manual label shows the tack done, got " + turnText([b], 0));
r = sweepTwa(b, -60, -240);
assert(r.seen.join() === "gybe+", "starboard to port through dead downwind is one CCW gybe, got " + r.seen);
assert(r.clears === 1 && pendingPenaltyCount(b) === 0, "tack then gybe clears one");
assert(faultText([b], 0) === null && turnText([b], 0) === null, "no badge or progress label once clear");

// Gybe then tack (clockwise: TWA rises through 180°, then through 0°).
b = fresh(120);
charge(b, 2);
r = sweepTwa(b, 120, 240);
assert(r.seen.join() === "gybe-" && pendingPenaltyCount(b) === 1, "a gybe alone does not clear");
assert(/^Gybe ✓ · Tack … \d+\.\ds$/.test(turnText([b], 0)), "manual label shows the gybe done, got " + turnText([b], 0));
r = sweepTwa(b, 240, 420);
assert(r.seen.join() === "tack-" && r.clears === 1 && pendingPenaltyCount(b) === 0, "gybe then tack clears one");

// Tack alone, then tack back: never clears, and only the last tack waits.
b = fresh(60);
charge(b, 3);
r = sweepTwa(b, 60, -60);
r = sweepTwa(b, -60, 60);
assert(r.seen.join() === "tack-" && pendingPenaltyCount(b) === 1, "tack, tack back does not clear");
assert(penaltyManeuverView(b).first === "tack" && penaltyManeuverView(b).dir === -1, "the tack back is the new candidate");
// Tack, tack, gybe: clears on the gybe. The second tack and the gybe are
// consecutive and the same rotation (clockwise), so that pair is valid on
// its own; the first tack was discarded when the second replaced it.
r = sweepTwa(b, 60, 240);
assert(r.seen.join() === "gybe-" && r.clears === 1 && pendingPenaltyCount(b) === 0, "tack, tack, gybe clears on the gybe (last tack + gybe is a valid pair)");

// Gybe, gybe back, tack: the same rule from the other side.
b = fresh(120);
charge(b, 4);
sweepTwa(b, 120, 240);
r = sweepTwa(b, 240, 120);
assert(r.seen.join() === "gybe+" && pendingPenaltyCount(b) === 1, "gybe, gybe back does not clear");
r = sweepTwa(b, 120, -60);
assert(r.seen.join() === "tack+" && r.clears === 1, "gybe, gybe, tack clears on the tack (last gybe + tack is a valid pair)");

// Outside the window: the first maneuver expires, the second becomes the
// candidate, and a prompt third one pairs with it.
b = fresh(60);
charge(b, 5);
sweepTwa(b, 60, -60);
hold(b, -60, PENALTY_MANEUVER_WINDOW_S + 0.5);
assert(penaltyManeuverView(b).first === null, "a candidate older than the window is dropped");
r = sweepTwa(b, -60, -240);
assert(r.seen.join() === "gybe+" && r.clears === 0 && pendingPenaltyCount(b) === 1, "a gybe after the window does not clear");
assert(penaltyManeuverView(b).first === "gybe", "the late gybe starts a new candidate");
r = sweepTwa(b, -240, -420);
assert(r.clears === 1 && pendingPenaltyCount(b) === 0, "a tack soon after that gybe clears");
// Just inside the window still counts. Sweeping 180° at 2° a step is 3 s.
b = fresh(60);
charge(b, 6);
sweepTwa(b, 60, -60);
const sweepS = 90 * SIM_STEP_S;
hold(b, -60, PENALTY_MANEUVER_WINDOW_S - sweepS - 0.5);
r = sweepTwa(b, -60, -240);
assert(r.clears === 1, "a gybe just inside the window clears");

// No pending penalty: maneuvers do nothing, and do not carry into a charge.
b = fresh(60);
r = sweepTwa(b, 60, -60);
r = sweepTwa(b, -60, -240);
assert(r.seen.join() === "gybe+" && r.clears === 0, "with nothing pending a tack + gybe clears nothing");
assert(penaltyManeuverView(b).first === null && pendingPenaltyCount(b) === 0, "nothing pending keeps no candidate and invents no penalty");
charge(b, 7);
r = sweepTwa(b, -240, -420);
assert(r.seen.join() === "tack+" && r.clears === 0, "a gybe sailed before the charge does not pair with a tack after it");
r = sweepTwa(b, -420, -600);
assert(r.clears === 1, "tack + gybe after the charge clears");

// Stacking: two pending need two pairs. The maneuver that completes a pair
// is used up, so tack, gybe, tack clears only once.
b = fresh(60);
charge(b, 8);
charge(b, 9);
assert(faultText([b], 0) === "FAULT x2", "two pending show FAULT x2");
sweepTwa(b, 60, -60);
sweepTwa(b, -60, -240);
assert(pendingPenaltyCount(b) === 1, "first pair clears one of two");
r = sweepTwa(b, -240, -420);
assert(r.clears === 0 && pendingPenaltyCount(b) === 1, "the next tack alone does not clear the second");
r = sweepTwa(b, -420, -600);
assert(r.clears === 1 && pendingPenaltyCount(b) === 0, "a second full pair clears the second");
assert(pendingPenaltiesOf(b).length === 0, "queue empty");

// Hysteresis: wobbling inside the band around 0° is not a maneuver, and a
// noisy crossing counts once. Same at 180°.
const band = PENALTY_MANEUVER_HYST_DEG;
b = fresh(60);
charge(b, 10);
r = sweepTwa(b, 60, band / 2);
for (let i = 0; i < 20; i++) notePenaltyManeuver(b, (i % 2 ? 1 : -1) * band / 2, { nowMs: 0 });
r = sweepTwa(b, band / 2, 60);
assert(r.seen.length === 0 && penaltyManeuverView(b).first === null, "a luff that flickers across head to wind and falls back is not a tack");
let seen = [];
r = sweepTwa(b, 60, -band * 0.8); seen.push(...r.seen);
for (let i = 0; i < 30; i++) {
  const x = notePenaltyManeuver(b, (i % 2 ? 1 : -1) * band * 0.8, { nowMs: 0 });
  if (x.maneuver) seen.push(x.maneuver.kind);
}
r = sweepTwa(b, -band * 0.8, -60); seen.push(...r.seen);
assert(seen.length === 1 && seen[0].startsWith("tack"), "a noisy crossing of head to wind is one tack, got " + seen);
seen = [];
r = sweepTwa(b, -60, -180 + band * 0.8); seen.push(...r.seen);
for (let i = 0; i < 30; i++) {
  const x = notePenaltyManeuver(b, (i % 2 ? 1 : -1) * (180 - band * 0.8), { nowMs: 0 });
  if (x.maneuver) seen.push(x.maneuver.kind);
}
r = sweepTwa(b, -180 + band * 0.8, -240); seen.push(...r.seen);
assert(seen.length === 1 && seen[0].startsWith("gybe"), "a noisy crossing of dead downwind is one gybe, got " + seen);
assert(pendingPenaltyCount(b) === 0, "that tack + gybe cleared the penalty");

// Both tacking: hulls touch, no single fault boat, no penalty.
resetRule15Memory();
resetContacts();
port.tacking = true;
starboard.tacking = true;
place(port, 0, 0, PORT);
place(starboard, 0.3, 0.2, STARBOARD);
t = 0;
step([port, starboard], t);
assert(getIncidents().length === 0, "both tacking records no incident");
assert(pendingPenaltyCount(port) === 0 && pendingPenaltyCount(starboard) === 0, "both tacking charges no penalty");

// --- Boat wiring: TWA comes from Map.get_wind ---

function makeSailingBoat(x, y, hullAngle, speed = 2.2) {
  const own = new World(Vec2(0, 0));
  const map = { world: own, get_wind: getWind };
  const boat = new Boat(map, x, y, hullAngle);
  const fwd = headingForward(hullAngle);
  boat.physics_model.setLinearVelocity(Vec2(fwd.x * speed, fwd.y * speed));
  boat._world = own;
  return boat;
}

// Wind from 90° (+Y), so TWA = 180° − heading. Heading 90° → 270° tacks at
// 180°; 270° → 450° gybes at 360°.
function turnHeading(boat, fromDeg, toDeg, stepDeg = 2) {
  const n = Math.ceil(Math.abs(toDeg - fromDeg) / stepDeg);
  for (let i = 1; i <= n; i++) {
    boat.hull_angle = (fromDeg + (toDeg - fromDeg) * i / n) * Math.PI / 180;
    updatePenaltyManeuvers(boat, { nowMs: 0 });
  }
}

const wired = makeSailingBoat(40, 0, Math.PI / 2);
charge(wired, 11);
turnHeading(wired, 90, 90);
turnHeading(wired, 90, 270);
assert(penaltyManeuverView(wired).first === "tack", "heading through the wind-from bearing is a tack via Map.get_wind");
turnHeading(wired, 270, 450);
assert(pendingPenaltyCount(wired) === 0, "continuing round through dead downwind is the gybe that clears");

// --- Q/E autopilot: cancel keys ---

const hand = makeSailingBoat(28, 0, 0);
charge(hand, 12);
hand.input_penalty_turn_ccw();
assert(hand.penalty_turn && hand.penalty_turn.dir === 1, "CCW autopilot aims to increase heading");
const handStart = hand.penalty_turn;
hand.input_penalty_turn_ccw();
assert(hand.penalty_turn === handStart, "the same key again does not restart the circle");
hand.input_rudder_left();
assert(hand.penalty_turn === null, "rudder left cancels the penalty autopilot");
assert(pendingPenaltyCount(hand) === 1, "cancelling does not clear the penalty");
hand.input_penalty_turn_cw();
assert(hand.penalty_turn && hand.penalty_turn.dir === -1, "CW autopilot aims to decrease heading");
hand.input_autopilot_heading_increase();
assert(hand.penalty_turn === null, "heading keys cancel the penalty autopilot");
hand.input_penalty_turn_ccw();
hand.input_autopilot_tack_toggle();
assert(hand.penalty_turn === null, "tack cancels the penalty autopilot");
hand.input_penalty_turn_cw();
hand.input_autopilot_enabled_toggle();
assert(hand.penalty_turn === null, "the autopilot toggle cancels the penalty turn");
hand.input_penalty_turn_ccw();
hand.input_rudder_right();
assert(hand.penalty_turn === null, "rudder right cancels the penalty autopilot");

// The rudder command has to yaw the hull the way the key asked.
function yawOver(boat, frames) {
  const h0 = boat.physics_model.getAngle();
  for (let i = 0; i < frames; i++) {
    boat.physics_model_step();
    boat._world.step(1 / 30, 8, 3);
  }
  return wrapDeg((boat.physics_model.getAngle() - h0) * 180 / Math.PI);
}

const yawCw = makeSailingBoat(-20, 10, -Math.PI / 2);
charge(yawCw, 13);
yawCw.input_penalty_turn_cw();
const cwYaw = yawOver(yawCw, 60);
assert(cwYaw < -15, "CW autopilot decreases hull angle, got " + cwYaw.toFixed(1) + "°");

const yawCcw = makeSailingBoat(-20, -10, -Math.PI / 2);
charge(yawCcw, 14);
yawCcw.input_penalty_turn_ccw();
const ccwYaw = yawOver(yawCcw, 60);
assert(ccwYaw > 15, "CCW autopilot increases hull angle, got " + ccwYaw.toFixed(1) + "°");

// --- Q/E autopilot: full circle, no overshoot, exactly one clear ---

// Sail the circle, then HOLD_S more on the heading autopilot. Heading is
// Planck's unwrapped angle, so overshoot is how far past ±360° it went.
const HOLD_S = 5;
function runCircle(h0, dir, pending, speed = 2.2) {
  const boat = makeSailingBoat(0, 0, h0, speed);
  for (let i = 0; i < pending; i++) charge(boat, 20 + i);
  dir > 0 ? boat.input_penalty_turn_ccw() : boat.input_penalty_turn_cw();
  const start = boat.physics_model.getAngle();
  let count = pendingPenaltyCount(boat);
  let clears = 0;
  let doneFrame = -1;
  let errAtDone = NaN;
  let maxOver = -Infinity;
  const limit = 30 * 30;
  for (let i = 0; i < limit; i++) {
    boat.physics_model_step();
    boat._world.step(1 / 30, 8, 3);
    const turned = (boat.physics_model.getAngle() - start) * 180 / Math.PI;
    maxOver = Math.max(maxOver, dir * turned - 360);
    const now = pendingPenaltyCount(boat);
    if (now < count) clears += count - now;
    count = now;
    if (doneFrame < 0 && !boat.penalty_turn) {
      doneFrame = i;
      errAtDone = turned - dir * 360;
    }
    if (doneFrame >= 0 && i - doneFrame >= HOLD_S * 30) break;
  }
  const finalErr = (boat.physics_model.getAngle() - start) * 180 / Math.PI - dir * 360;
  return { boat, doneFrame, errAtDone, finalErr, maxOver, clears, left: pendingPenaltyCount(boat) };
}

function fmt(res) {
  return "done " + (res.doneFrame * SIM_STEP_S).toFixed(1) + " s, error at hand-off " + res.errAtDone.toFixed(2)
    + "°, after " + HOLD_S + " s hold " + res.finalErr.toFixed(2) + "°, max past 360° " + res.maxOver.toFixed(2) + "°";
}

// Scenario 10's start: starboard beam reach, heading −90°, 2.2 m/s.
const summary = [];
for (const dir of [-1, 1]) {
  const res = runCircle(-Math.PI / 2, dir, 1);
  const name = dir < 0 ? "CW" : "CCW";
  assert(res.doneFrame >= 0, name + " autopilot finishes the circle");
  assert(Math.abs(res.errAtDone) <= 3, name + " hands back within ±3° of the start heading, got " + res.errAtDone.toFixed(2));
  assert(Math.abs(res.finalErr) <= 3, name + " holds the start heading afterwards, got " + res.finalErr.toFixed(2));
  assert(res.maxOver <= 3, name + " does not overshoot 360° by more than 3°, got " + res.maxOver.toFixed(2));
  assert(res.clears === 1 && res.left === 0, name + " clears exactly one penalty");
  assert(res.boat.autopilot_enabled === true, name + " leaves the heading autopilot holding");
  summary.push(name + ": " + fmt(res));
}

// Other start headings and a slow boat: still within ±3°, one clear each.
// Two pending, so a second clear in one circle would show.
let worstErr = 0;
let worstOver = -Infinity;
for (const deg of [90, 135, 225, 17, -52, 126]) {
  for (const dir of [-1, 1]) {
    for (const speed of [2.2, 1.0]) {
      const res = runCircle(deg * Math.PI / 180, dir, 2, speed);
      const name = (dir < 0 ? "CW" : "CCW") + " from " + deg + "° at " + speed + " m/s";
      assert(res.doneFrame >= 0, name + " finishes");
      assert(Math.abs(res.errAtDone) <= 3 && Math.abs(res.finalErr) <= 3, name + " ends within ±3°: " + fmt(res));
      assert(res.maxOver <= 3, name + " overshoot " + res.maxOver.toFixed(2));
      assert(res.clears === 1 && res.left === 1, name + " clears exactly one of two");
      worstErr = Math.max(worstErr, Math.abs(res.errAtDone), Math.abs(res.finalErr));
      worstOver = Math.max(worstOver, res.maxOver);
    }
  }
}

// Stacking with the autopilot: a second circle takes the second penalty.
{
  const res = runCircle(-Math.PI / 2, 1, 2);
  assert(res.left === 1, "one circle leaves one of two");
  const boat = res.boat;
  boat.input_penalty_turn_ccw();
  for (let i = 0; i < 30 * 30 && boat.penalty_turn; i++) {
    boat.physics_model_step();
    boat._world.step(1 / 30, 8, 3);
  }
  assert(boat.penalty_turn === null && pendingPenaltyCount(boat) === 0, "a second circle clears the second");
}

// No penalty: the autopilot still sails the circle, ends, and clears nothing.
{
  const res = runCircle(-Math.PI / 2, -1, 0);
  assert(res.doneFrame >= 0 && res.clears === 0 && res.left === 0, "a practice circle ends with nothing to clear");
  assert(Math.abs(res.finalErr) <= 3, "a practice circle also stops on the start heading");
}

console.log("penalty turn checks passed");
console.log("window " + PENALTY_MANEUVER_WINDOW_S + " s, hysteresis band ±" + PENALTY_MANEUVER_HYST_DEG + "°");
console.log("yaw after 2 s: CW " + cwYaw.toFixed(1) + "°  CCW " + ccwYaw.toFixed(1) + "°");
for (const line of summary) console.log(line);
console.log("other starts (24 runs): worst heading error " + worstErr.toFixed(2) + "°, worst past 360° " + worstOver.toFixed(2) + "°");
