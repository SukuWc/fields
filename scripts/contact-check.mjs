// Headless checks for contact fault. One closure is one incident. Rule 10
// charges the keep-clear boat. Rule 15 charges the new right-of-way boat.
// Run: node scripts/contact-check.mjs

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const planck = require("planck-js");
const { ConstantWind } = await import("../src/wind.js");
const {
  evaluateAllPairs,
  getIncidents,
  recordContacts,
  resetContacts,
  resetRule15Memory,
  headingForward,
  boatClearance,
  SIM_STEP_S,
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

function pairOf(resolutions, boatA, boatB) {
  for (let i = 0; i < resolutions.length; i++) {
    const r = resolutions[i];
    if ((r.boatA === boatA && r.boatB === boatB) || (r.boatA === boatB && r.boatB === boatA)) return r;
  }
  return null;
}

// --- Rule 10: overlapping opposite tacks, port is at fault, once ---

resetRule15Memory();
resetContacts();
const port = makeBoat(0, 0, PORT);
const starboard = makeBoat(0.4, 0.2, STARBOARD);
assert(boatClearance(port, starboard) === 0, "opposite-tack hulls start overlapped");
let t = 0;
let resolutions = step([port, starboard], t);
const rule10 = pairOf(resolutions, port, starboard);
assert(rule10.final && rule10.final.rule === "Rule 10", "overlapped opposite tacks are Rule 10");
assert(rule10.faultBoat === port, "Rule 10 fault is the port boat");
const lines10 = rule10.guides.filter((g) => g.type === "label")[0].lines;
assert(lines10.length === 1 && lines10[0].text === "Rule 10" && lines10[0].role === "final", "a lone Rule 10 stack is just the final line");
assert(getIncidents().length === 1, "one contact, one incident");
const first = getIncidents()[0];
assert(first.faultBoat === port, "incident charges the port boat");
assert(first.finalRule === "Rule 10", "incident names Rule 10");
assert(first.inhibited.length === 0, "Rule 10 contact inhibits nothing");
assert(first.boats.includes(port) && first.boats.includes(starboard), "incident names both boats");
assert(Number.isFinite(first.x) && Number.isFinite(first.y), "incident has a contact point");

t += SIM_STEP_S;
step([port, starboard], t);
assert(getIncidents().length === 1, "holding the overlap does not open a second incident");

place(starboard, 8, 0, STARBOARD);
assert(boatClearance(port, starboard) > 0.25, "pulled apart far enough to rearm");
t += SIM_STEP_S;
step([port, starboard], t);
place(starboard, 0.4, 0.2, STARBOARD);
t += SIM_STEP_S;
step([port, starboard], t);
assert(getIncidents().length === 2, "a new closure after separating is a new incident");
assert(getIncidents()[1].faultBoat === port, "the second incident is still the port boat");

// A third boat nearby does not inherit the incident or the fault.
const bystander = makeBoat(0, 5, PORT);
t += SIM_STEP_S;
const before = getIncidents().length;
resolutions = step([port, starboard, bystander], t);
assert(getIncidents().length === before, "an already-latched pair does not record again when a third boat appears");
const byPair = pairOf(resolutions, starboard, bystander);
assert(byPair && byPair.final && byPair.final.rule === "Rule 10", "the third boat is her own Rule 10 pair");
assert(byPair.faultBoat === bystander, "her fault boat is not the other pair's");

// --- both tacking: hulls touch, but fault is not a single boat ---

resetRule15Memory();
resetContacts();
port.tacking = true;
starboard.tacking = true;
place(port, 0, 0, PORT);
place(starboard, 0.3, 0.2, STARBOARD);
t = 0;
resolutions = step([port, starboard], t);
assert(pairOf(resolutions, port, starboard).final.rule === "Rule 13 both", "both tacking stays Rule 13 both");
assert(pairOf(resolutions, port, starboard).faultBoat === null, "both keep-clear has no single fault boat");
assert(getIncidents().length === 0, "no incident when fault is not clear-cut");
const bothLines = pairOf(resolutions, port, starboard).guides.filter((g) => g.type === "label")[0].lines;
assert(bothLines[0].role === "final" && bothLines[0].text === "Rule 13 both", "final line is Rule 13 both");
assert(bothLines.some((line) => line.role === "inhibited"), "the stack lists the inhibited Section A rule");

// --- Rule 15: she gains the overlap and the hulls meet on that step ---

resetRule15Memory();
resetContacts();
port.tacking = false;
starboard.tacking = false;
const fwd = headingForward(STARBOARD);
const leader = makeBoat(0, 0, STARBOARD);
const trailer = makeBoat(-fwd.x * 4.05, -fwd.y * 4.05, STARBOARD);
t = 0;
resolutions = step([leader, trailer], t);
assert(pairOf(resolutions, leader, trailer).final.rule === "Rule 12", "Rule 15 contact case starts clear astern");
assert(getIncidents().length === 0, "clear astern is not a contact");

t += SIM_STEP_S;
// Leeward (lower Y, wind from +Y) and overlapping the leader.
place(trailer, 0.35, -0.9, STARBOARD);
assert(boatClearance(leader, trailer) === 0, "the gaining boat is hull-to-hull");
resolutions = step([leader, trailer], t);
const gained = pairOf(resolutions, leader, trailer);
assert(gained.final && gained.final.id === "15", "the overlap is Rule 15, got " + (gained.final && gained.final.rule));
assert(gained.final.blockedRule === "Rule 11", "Rule 15 is blocking Rule 11");
assert(gained.faultBoat === trailer, "fault during Rule 15 is the new right-of-way boat");
const stack = gained.guides.filter((g) => g.type === "label")[0].lines;
assert(stack[0].text === "Rule 15" && stack[0].role === "final", "Rule 15 is the top, final line");
assert(stack.some((line) => line.text === "Rule 11" && line.role === "inhibited"), "Rule 11 is on the stack and inhibited");
assert(getIncidents().length === 1, "the Rule 15 contact is one incident");
const room = getIncidents()[0];
assert(room.faultBoat === trailer, "incident charges the boat that acquired right of way");
assert(room.finalRule === "Rule 15", "incident final rule is Rule 15");
assert(room.inhibited.indexOf("Rule 11") >= 0, "incident records Rule 11 as inhibited");

t += SIM_STEP_S;
step([leader, trailer], t);
assert(getIncidents().length === 1, "staying overlapped through the Rule 15 window does not re-charge");

console.log("contact checks passed");
