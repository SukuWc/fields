// Headless checks for Rule 15 (acquiring right of way).
// Run: node scripts/rule15-check.mjs
//
// Hulls match Boat in src/boat.js. Wind is ConstantWind. simTime is the
// simulation clock sectionAOverlay uses: one SIM_STEP_S per physics step.

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");
const { ConstantWind } = await import("../src/wind.js");
const {
  boatClearance,
  evaluateSectionA,
  sectionAOverlay,
  resetRule15Memory,
  headingForward,
  RULE15_RANGE_M,
  RULE15_ROOM_S,
  RULE10_INTEREST_RANGE_M,
  SIM_STEP_S,
  BOAT_LENGTH_M,
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

assert(RULE15_RANGE_M === 2 * BOAT_LENGTH_M, "Rule 15 gate is two boat lengths");
assert(RULE15_RANGE_M === 8, "two boat lengths is 8 m");
assert(RULE15_ROOM_S === 1, "Rule 15 room lasts 1 s");
assert(Math.abs(SIM_STEP_S - 1 / 30) < 1e-15, "simulation step is 1/30 s");

const wind = new ConstantWind(90, 15);
const getWind = (x, y) => wind.getWind(x, y);

const HULL = [
  Vec2(0, -2.25), Vec2(-0.5, -1.25), Vec2(-0.75, -0.25), Vec2(-0.75, 0.5),
  Vec2(-0.5, 1.75), Vec2(0.5, 1.75), Vec2(0.75, 0.5), Vec2(0.75, -0.25),
  Vec2(0.5, -1.25), Vec2(0, -2.25),
];

const world = new World(Vec2(0, 0));
const STARBOARD = 5 * Math.PI / 4;
const PORT = 3 * Math.PI / 4;

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

function labelOf(overlay) {
  const label = overlay.find((r) => r.type === "label");
  return label ? label.text : null;
}

function stepPair(boatA, boatB, simTime) {
  return sectionAOverlay(boatA, boatB, getWind, simTime);
}

// --- stateless overlay ignores a right-of-way flip (the 10–13 checks) ---

resetRule15Memory();
const fwd = headingForward(STARBOARD);
const leader = makeBoat(0, 0, STARBOARD);
const trailer = makeBoat(-fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 12", "baseline is Rule 12");
place(trailer, -fwd.x * 3.9, -fwd.y * 3.9, STARBOARD);
const stateless = sectionAOverlay(leader, trailer, getWind);
assert(labelOf(stateless) === "Rule 11", "without simTime a flip stays on the new rule");
assert(!stateless.some((r) => r.rule15), "without simTime there is no Rule 15 progress");
place(trailer, -fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);

// --- her own move: clear astern to a leeward overlap, inside 8 m ---

resetRule15Memory();
let t = 0;
let overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 12", "first step remembers Rule 12 and does not invent Rule 15");
assert(boatClearance(leader, trailer) < RULE15_RANGE_M, "the astern pair starts inside 8 m");

t += SIM_STEP_S;
place(trailer, -fwd.x * 3.9, -fwd.y * 3.9, STARBOARD);
overlay = stepPair(leader, trailer, t);
const gained = evaluateSectionA(leader, trailer, getWind);
assert(gained.rule === "Rule 11" && gained.rightOfWay === trailer, "leeward trailer takes Rule 11");
assert(labelOf(overlay) === "Rule 15 (blocks Rule 11)", "her overlap is Rule 15 blocking Rule 11, got " + labelOf(overlay));
const label = overlay.find((r) => r.type === "label");
assert(label.rule15 === true && label.progress > 0.99, "the room bar starts full");
assert(overlay[0].color === 0x00ff00 && overlay[0].x2 === trailer.x, "green still ends on the new right-of-way boat");
assert(overlay[1].color === 0xffc240 && overlay[1].x2 === trailer.x, "amber centerline marks that she owes room");
assert(overlay[2].color === 0xff0000 && overlay[2].x2 === leader.x, "red still ends on the give-way boat");
assert(overlay.some((r) => r.type === "abeam"), "Rule 15 keeps the blocked rule's stern mark");

const started = t;
for (let n = 0; n < 29; n++) {
  t += SIM_STEP_S;
  overlay = stepPair(leader, trailer, t);
  assert(labelOf(overlay) === "Rule 15 (blocks Rule 11)", "room continues at t=" + t);
}
const mid = overlay.find((r) => r.type === "label");
assert(mid.progress < 0.1 && mid.progress > 0, "the bar has almost run out just before 1 s, progress " + mid.progress);

t += SIM_STEP_S;
assert(Math.abs((t - started) - RULE15_ROOM_S) < 1e-6, "thirty steps is one simulation second");
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 11", "after 1 s the blocked rule stands on its own, got " + labelOf(overlay));
assert(!overlay.some((r) => r.rule15), "the progress bar is gone after the timeout");

// Same geometry, no new acquisition: Rules 11 stays 11. A redraw at the same
// simulation time must not move the clock.
const again = stepPair(leader, trailer, t);
assert(labelOf(again) === "Rule 11", "a same-time redraw does not restart Rule 15");

// --- ends early once the hulls are 8 m or more apart ---

resetRule15Memory();
place(trailer, -fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
t = 0;
stepPair(leader, trailer, t);
t += SIM_STEP_S;
place(trailer, -fwd.x * 3.9, -fwd.y * 3.9, STARBOARD);
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 15 (blocks Rule 11)", "room starts again for the separation check");
t += SIM_STEP_S;
place(trailer, -fwd.x * 14, -fwd.y * 14, STARBOARD);
const apart = boatClearance(leader, trailer);
assert(apart >= RULE15_RANGE_M && apart <= RULE10_INTEREST_RANGE_M, "pulled apart past 8 m but still inside 12 m, clearance " + apart);
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) !== null && !String(labelOf(overlay)).startsWith("Rule 15"), "separating past 8 m ends Rule 15 early, got " + labelOf(overlay));

// --- the other boat's action: no Rule 15 ---

resetRule15Memory();
place(leader, 0, 0, STARBOARD);
place(trailer, -fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
t = 0;
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 12", "exception case starts on Rule 12");
t += SIM_STEP_S;
place(leader, -fwd.x * 0.25, -fwd.y * 0.25, STARBOARD);
overlay = stepPair(leader, trailer, t);
const afterLeaderBacks = evaluateSectionA(leader, trailer, getWind);
assert(afterLeaderBacks.rule === "Rule 11" && afterLeaderBacks.rightOfWay === trailer, "leader backing down gives the trailer Rule 11");
assert(labelOf(overlay) === "Rule 11", "Rule 15 does not apply when the other boat caused it, got " + labelOf(overlay));

// --- outside 8 m the acquisition is recorded but not shown ---

resetRule15Memory();
const lateral = { x: -fwd.y, y: fwd.x };
const beam = 10;
place(leader, 0, 0, STARBOARD);
place(trailer, -fwd.x * 4.3 + lateral.x * beam, -fwd.y * 4.3 + lateral.y * beam, STARBOARD);
const wide = boatClearance(leader, trailer);
assert(wide >= RULE15_RANGE_M && wide <= RULE10_INTEREST_RANGE_M, "wide pair is between 8 m and 12 m, clearance " + wide);
t = 0;
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 12", "wide clear-astern pair is Rule 12");
t += SIM_STEP_S;
place(trailer, -fwd.x * 3.5 + lateral.x * beam, -fwd.y * 3.5 + lateral.y * beam, STARBOARD);
const wideOverlap = boatClearance(leader, trailer);
const wideRule = evaluateSectionA(leader, trailer, getWind);
assert(wideOverlap >= RULE15_RANGE_M, "overlap at this beam is still outside 8 m, clearance " + wideOverlap);
assert(wideRule && wideRule.rule === "Rule 11" && wideRule.rightOfWay === trailer, "wide overlap still gives the leeward trailer right of way");
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 11", "Rule 15 stays hidden at or outside 8 m, got " + labelOf(overlay));

// --- out of Rule 13 onto starboard: she caused it, blocks Rule 10 ---

resetRule15Memory();
const portBoat = makeBoat(0, 0, PORT);
const standOn = makeBoat(0, 5, PORT);
portBoat.tacking = true;
standOn.tacking = false;
assert(boatClearance(portBoat, standOn) < RULE15_RANGE_M, "tack pair is inside 8 m");
t = 0;
overlay = stepPair(portBoat, standOn, t);
assert(labelOf(overlay) === "Rule 13" && evaluateSectionA(portBoat, standOn, getWind).rightOfWay === standOn, "while tacking the other boat has right of way");
t += SIM_STEP_S;
portBoat.tacking = false;
place(portBoat, 0, 0, STARBOARD);
overlay = stepPair(portBoat, standOn, t);
const opposite = evaluateSectionA(portBoat, standOn, getWind);
assert(opposite.rule === "Rule 10" && opposite.rightOfWay === portBoat, "finishing onto starboard takes Rule 10");
assert(labelOf(overlay) === "Rule 15 (blocks Rule 10)", "leaving Rule 13 by her own tack is Rule 15, got " + labelOf(overlay));

// Starting the tack gives the other boat right of way. That is the exception.
resetRule15Memory();
const lee = makeBoat(0, 0, PORT);
const windward = makeBoat(-Math.sin(PORT) * 0 + 0, 4, PORT);
place(lee, 0, -1, PORT);
place(windward, 0, 3, PORT);
assert(evaluateSectionA(lee, windward, getWind).rule === "Rule 11", "before the tack the leeward boat has Rule 11");
assert(evaluateSectionA(lee, windward, getWind).rightOfWay === lee, "leeward is right of way before the tack");
t = 0;
stepPair(lee, windward, t);
t += SIM_STEP_S;
lee.tacking = true;
overlay = stepPair(lee, windward, t);
assert(evaluateSectionA(lee, windward, getWind).rule === "Rule 13", "passing head to wind is Rule 13");
assert(labelOf(overlay) === "Rule 13", "Rule 15 does not apply when her tack hands right of way to the other boat, got " + labelOf(overlay));

// --- fallback: neither move alone crosses the abeam line; she closed more ---

resetRule15Memory();
place(leader, 0, 0, STARBOARD);
place(trailer, -fwd.x * 4.2, -fwd.y * 4.2, STARBOARD);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 12", "fallback baseline is clear astern");
t = 0;
stepPair(leader, trailer, t);
t += SIM_STEP_S;
place(leader, -fwd.x * 0.12, -fwd.y * 0.12, STARBOARD);
place(trailer, -fwd.x * (4.2 - 0.18), -fwd.y * (4.2 - 0.18), STARBOARD);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 11", "together they become overlapped");
assert(evaluateSectionA(leader, trailer, getWind).rightOfWay === trailer, "trailer is the new right-of-way boat");
// Confirm neither displacement alone would have flipped the dispatcher, so
// the what-if really does fall through. Rebuild the old hulls via place.
place(leader, 0, 0, STARBOARD);
place(trailer, -fwd.x * (4.2 - 0.18), -fwd.y * (4.2 - 0.18), STARBOARD);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 12", "trailer alone is still clear astern");
place(leader, -fwd.x * 0.12, -fwd.y * 0.12, STARBOARD);
place(trailer, -fwd.x * 4.2, -fwd.y * 4.2, STARBOARD);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 12", "leader alone is still clear astern");
place(leader, -fwd.x * 0.12, -fwd.y * 0.12, STARBOARD);
place(trailer, -fwd.x * (4.2 - 0.18), -fwd.y * (4.2 - 0.18), STARBOARD);
overlay = stepPair(leader, trailer, t);
assert(labelOf(overlay) === "Rule 15 (blocks Rule 11)", "fallback assigns the cause to the boat that closed more, got " + labelOf(overlay));

// Equal closing stays ambiguous: the underlying rule shows, not Rule 15.
resetRule15Memory();
place(leader, 0, 0, STARBOARD);
place(trailer, -fwd.x * 4.2, -fwd.y * 4.2, STARBOARD);
t = 10;
stepPair(leader, trailer, t);
t += SIM_STEP_S;
place(leader, -fwd.x * 0.16, -fwd.y * 0.16, STARBOARD);
place(trailer, -fwd.x * (4.2 - 0.16), -fwd.y * (4.2 - 0.16), STARBOARD);
overlay = stepPair(leader, trailer, t);
assert(evaluateSectionA(leader, trailer, getWind).rule === "Rule 11", "equal closing still creates the overlap");
assert(labelOf(overlay) === "Rule 11", "an even split does not start Rule 15, got " + labelOf(overlay));

console.log("rule 15 checks passed");
