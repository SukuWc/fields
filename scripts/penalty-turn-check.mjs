// Headless checks for the 360° penalty turn.
// A contact fault charges one pending penalty (FIFO). One circle clears one.
// Holding a latched contact does not stack another. Q/E autopilot turns are
// the boat methods input_penalty_turn_ccw / input_penalty_turn_cw: CCW
// increases hull angle, CW decreases it. Both finish through notePenaltyHeading,
// the same path a hand-sailed circle uses.
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
  notePenaltyHeading,
  penaltyGuides,
  penaltyTurnView,
  pendingPenaltyCount,
  pendingPenaltiesOf,
  PENALTY_TURN_LOCK_DEG,
  PENALTY_TURN_REVERSE_DEG,
  PENALTY_TURN_COMPLETE_DEG,
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

// Signed short-way degrees, matching notePenaltyHeading.
function wrapDeg(delta) {
  let x = (delta + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

function spin(boat, fromRad, dir, degrees, stepDeg, nowMs) {
  const n = Math.round(degrees / stepDeg);
  let heading = fromRad;
  for (let i = 1; i <= n; i++) {
    heading = fromRad + dir * i * stepDeg * Math.PI / 180;
    notePenaltyHeading(boat, heading, { nowMs });
  }
  return heading;
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

// Wiggles under the lock threshold must not clear.
let wiggle = 0;
notePenaltyHeading(port, wiggle, { nowMs: 0 });
for (let i = 0; i < 40; i++) {
  wiggle = (i % 2 === 0) ? 8 * Math.PI / 180 : 0;
  notePenaltyHeading(port, wiggle, { nowMs: 0 });
}
assert(pendingPenaltyCount(port) === 1, "heading wiggles do not clear a penalty");
assert(penaltyTurnView(port).locked === false, "a return to the start never locks a direction");

// A second closure stacks. The circle already started is discarded only when
// the queue was empty, so this one leaves the (unlocked) wiggle total alone
// and adds a second penalty.
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

// A slow hand-sailed circle, through every heading, clears only the oldest.
// Tacking state is ignored: the turn is hull heading.
const slowSteps = Math.round(PENALTY_TURN_COMPLETE_DEG / 0.5);
port.tacking = true;
const afterSlow = spin(port, 0, 1, PENALTY_TURN_COMPLETE_DEG, 0.5, 1000);
assert(slowSteps === 720, "the slow circle is 0.5° samples");
assert(pendingPenaltyCount(port) === 1, "one circle clears one penalty");
assert(pendingPenaltiesOf(port)[0].incident === secondIncident, "FIFO clears the oldest incident");
assert(pendingPenaltiesOf(port)[0].incident !== firstIncident, "the first incident is the one removed");
port.tacking = false;
const clearedNow = labelsOf([port], 1000);
assert(clearedNow.some((g) => g.lines[0].id === "cleared" && g.lines[0].text === "CLEARED"), "clearing flashes CLEARED");
assert(faultText([port], 1000) === "FAULT", "the remaining penalty is a plain FAULT");
assert(!labelsOf([port], 1000 + PENALTY_CLEARED_MS + 1).some((g) => g.lines[0].id === "cleared"), "the cleared flash expires");

// A committed turn that reverses by the threshold is abandoned.
let heading = afterSlow;
notePenaltyHeading(port, heading, { nowMs: 2000 });
heading = spin(port, heading, 1, PENALTY_TURN_LOCK_DEG + 15, 5, 2000);
assert(penaltyTurnView(port).locked === true, "past the lock threshold the sense is committed");
const committed = penaltyTurnView(port).progressDeg;
heading = spin(port, heading, -1, PENALTY_TURN_REVERSE_DEG, 5, 2000);
assert(penaltyTurnView(port).locked === false, "a 30° reversal resets the turn");
assert(penaltyTurnView(port).progressDeg === 0, "the abandoned degrees do not carry over");
assert(committed > PENALTY_TURN_LOCK_DEG, "the reset threw away a real committed arc");
assert(pendingPenaltyCount(port) === 1, "an abandoned turn does not clear");
// The rest of a circle from the reset is required. 350° is short.
heading = spin(port, heading, 1, PENALTY_TURN_COMPLETE_DEG - 10, 5, 2000);
assert(pendingPenaltyCount(port) === 1, "a short circle after a reset does not clear");
heading = spin(port, heading, 1, 10, 5, 2000);
assert(pendingPenaltyCount(port) === 0, "the fresh circle clears the remaining penalty");
assert(faultText([port], 2000) === null, "no FAULT badge once the stack is empty");

// A new collision while a circle is already underway stacks and keeps the arc.
resetRule15Memory();
resetContacts();
place(port, 0, 0, PORT);
place(starboard, 0.4, 0.2, STARBOARD);
port.tacking = false;
starboard.tacking = false;
t = 0;
step([port, starboard], t);
assert(pendingPenaltyCount(port) === 1, "rearmed pair charges again");
heading = 0;
notePenaltyHeading(port, heading, { nowMs: 3000 });
heading = spin(port, heading, -1, 80, 5, 3000);
const mid = penaltyTurnView(port).progressDeg;
assert(mid < -70, "the in-progress circle is most of 80° clockwise");
place(starboard, 8, 0, STARBOARD);
t += SIM_STEP_S;
step([port, starboard], t);
place(starboard, 0.4, 0.2, STARBOARD);
t += SIM_STEP_S;
step([port, starboard], t);
assert(pendingPenaltyCount(port) === 2, "contact during a turn stacks");
assert(Math.abs(penaltyTurnView(port).progressDeg - mid) < 1e-6, "stacking does not reset the circle in progress");
heading = spin(port, heading, -1, PENALTY_TURN_COMPLETE_DEG - 80, 5, 3000);
assert(pendingPenaltyCount(port) === 1, "finishing that circle clears one of the two");

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

// --- Autopilot CW and CCW, same clear path ---

function makeSailingBoat(x, y, hullAngle) {
  const own = new World(Vec2(0, 0));
  const map = { world: own, get_wind: getWind };
  const boat = new Boat(map, x, y, hullAngle);
  const fwd = headingForward(hullAngle);
  boat.physics_model.setLinearVelocity(Vec2(fwd.x * 2.2, fwd.y * 2.2));
  boat._world = own;
  return boat;
}

function sailByMethod(boat, dir, degrees, stepDeg) {
  const start = boat.hull_angle;
  const n = Math.round(degrees / stepDeg);
  for (let i = 1; i <= n; i++) {
    boat.hull_angle = start + dir * i * stepDeg * Math.PI / 180;
    boat.samplePenaltyHeading();
  }
}

const cwBoat = makeSailingBoat(20, 0, 0);
chargePendingPenalty(cwBoat, { time: 4, finalRule: "Rule 10", faultBoat: cwBoat });
cwBoat.samplePenaltyHeading();
cwBoat.input_penalty_turn_cw();
assert(cwBoat.penalty_turn && cwBoat.penalty_turn.dir === -1, "CW autopilot aims to decrease heading");
sailByMethod(cwBoat, -1, 100, 5);
const cwPartial = penaltyTurnView(cwBoat).progressDeg;
assert(cwPartial < -90, "CW autopilot progress follows the decreasing heading");
cwBoat.input_penalty_turn_cw();
assert(Math.abs(penaltyTurnView(cwBoat).progressDeg - cwPartial) < 1e-6, "the same CW key again does not restart the circle");
sailByMethod(cwBoat, -1, PENALTY_TURN_COMPLETE_DEG - 100, 5);
assert(pendingPenaltyCount(cwBoat) === 0, "CW autopilot clears one pending penalty");
assert(cwBoat.penalty_turn === null, "CW autopilot ends when the circle completes");

const ccwBoat = makeSailingBoat(24, 0, 0);
chargePendingPenalty(ccwBoat, { time: 5, finalRule: "Rule 10", faultBoat: ccwBoat });
chargePendingPenalty(ccwBoat, { time: 6, finalRule: "Rule 10", faultBoat: ccwBoat });
assert(pendingPenaltyCount(ccwBoat) === 2, "two charges stack before the autopilot");
ccwBoat.samplePenaltyHeading();
ccwBoat.input_penalty_turn_ccw();
assert(ccwBoat.penalty_turn && ccwBoat.penalty_turn.dir === 1, "CCW autopilot aims to increase heading");
sailByMethod(ccwBoat, 1, PENALTY_TURN_COMPLETE_DEG, 5);
assert(pendingPenaltyCount(ccwBoat) === 1, "CCW autopilot clears one of two");
assert(ccwBoat.penalty_turn === null, "CCW autopilot ends on the completing sample");
assert(pendingPenaltiesOf(ccwBoat)[0].incident.time === 6, "CCW also clears FIFO, leaving the later charge");

// Helm cancels the autopilot. The circle already sailed stays available to
// finish by hand.
const hand = makeSailingBoat(28, 0, 0);
chargePendingPenalty(hand, { time: 7, finalRule: "Rule 10", faultBoat: hand });
hand.samplePenaltyHeading();
hand.input_penalty_turn_ccw();
sailByMethod(hand, 1, 90, 5);
hand.input_rudder_left();
assert(hand.penalty_turn === null, "rudder left cancels the penalty autopilot");
assert(pendingPenaltyCount(hand) === 1, "cancelling does not clear the penalty");
assert(penaltyTurnView(hand).locked === true, "the arc sailed before the cancel still counts");
hand.input_penalty_turn_cw();
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

// No penalty: the autopilot still sails the circle and then drops the flag.
const practice = makeSailingBoat(32, 0, 0);
practice.samplePenaltyHeading();
practice.input_penalty_turn_cw();
sailByMethod(practice, -1, PENALTY_TURN_COMPLETE_DEG, 5);
assert(practice.penalty_turn === null, "a practice circle ends with nothing to clear");
assert(pendingPenaltyCount(practice) === 0, "a practice circle does not invent a penalty");

// The rudder command has to yaw the hull the way the key asked. This is the
// sign check; the circle above is what clears the penalty.
function yawOver(boat, frames) {
  const h0 = boat.physics_model.getAngle();
  for (let i = 0; i < frames; i++) {
    boat.physics_model_step();
    boat._world.step(1 / 30, 8, 3);
  }
  return wrapDeg((boat.physics_model.getAngle() - h0) * 180 / Math.PI);
}

const yawCw = makeSailingBoat(-20, 10, -Math.PI / 2);
chargePendingPenalty(yawCw, { time: 8, finalRule: "Rule 10", faultBoat: yawCw });
yawCw.input_penalty_turn_cw();
const cwYaw = yawOver(yawCw, 120);
assert(cwYaw < -15, "CW autopilot decreases hull angle, got " + cwYaw.toFixed(1) + "°");

const yawCcw = makeSailingBoat(-20, -10, -Math.PI / 2);
chargePendingPenalty(yawCcw, { time: 9, finalRule: "Rule 10", faultBoat: yawCcw });
yawCcw.input_penalty_turn_ccw();
const ccwYaw = yawOver(yawCcw, 120);
assert(ccwYaw > 15, "CCW autopilot increases hull angle, got " + ccwYaw.toFixed(1) + "°");

// Keep steering until the shared heading integrator clears the penalty.
// 20 s of simulation is enough for a beam-reach boat with the rudder held over.
function sailUntilClear(boat, frames) {
  for (let i = 0; i < frames; i++) {
    boat.physics_model_step();
    boat._world.step(1 / 30, 8, 3);
    if (pendingPenaltyCount(boat) === 0 && !boat.penalty_turn) return i;
  }
  return -1;
}

const physCw = makeSailingBoat(0, 12, -Math.PI / 2);
chargePendingPenalty(physCw, { time: 10, finalRule: "Rule 10", faultBoat: physCw });
physCw.input_penalty_turn_cw();
const cwFrame = sailUntilClear(physCw, 600);
assert(cwFrame >= 0, "CW rudder autopilot completes a circle and clears");

const physCcw = makeSailingBoat(0, -12, -Math.PI / 2);
chargePendingPenalty(physCcw, { time: 11, finalRule: "Rule 10", faultBoat: physCcw });
physCcw.input_penalty_turn_ccw();
const ccwFrame = sailUntilClear(physCcw, 600);
assert(ccwFrame >= 0, "CCW rudder autopilot completes a circle and clears");

console.log("penalty turn checks passed");
console.log("yaw CW " + cwYaw.toFixed(1) + "°  CCW " + ccwYaw.toFixed(1) + "°");
