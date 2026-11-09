// Engaging the autopilot locks the heading the dashed preview was showing.
// Dev mode (constant wind): the lock is a TWA, the guide is that TWA drawn
// as a world heading. A few headings and winds, both tacks.
import './dom-stub.mjs';
import { autopilotGuideTarget, penaltyTurnExitTarget } from '../src/boat-draw.js';
import { Boat } from '../src/boat.js';
import { Map } from '../src/map.js';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!ok) failed++;
};
const wrap = (d) => { d = ((d + 180) % 360 + 360) % 360 - 180; return d; };
const absDiff = (a, b) => Math.abs(wrap(a - b));

function previewDeg(boat) {
  const g = boat.graphics_model_render().filter((x) => x.role === 'ap-preview');
  const a = g[0], b = g[g.length - 1];
  return Math.atan2(b.y2 - a.y1, b.x2 - a.x1) * 180 / Math.PI;
}
function bowDeg(boat) {
  return boat.physics_model.getAngle() * 180 / Math.PI - 90;
}

function make(windDeg, heading) {
  const map = new Map(80, 160, windDeg, 6, null);
  map.physics_model_init();
  map.setDevMode(true);
  const boat = new Boat(map, 0, 0, heading);
  const tick = () => {
    const p = boat.physics_model.getPosition();
    if (Math.abs(p.x) > 30 || Math.abs(p.y) > 60) {
      boat.physics_model.setTransform({ x: 0, y: 0 }, boat.physics_model.getAngle());
    }
    map.world.step(1 / 30);
    boat.physics_model_step();
  };
  return { boat, tick };
}

// ha = wd − TWA + 90, so the hull starts near the named point of sail.
const ha = (wd, twa) => (wd - twa + 90) * Math.PI / 180;
const cases = [
  ['starboard close-hauled, wind 90', 90, ha(90, -45)],
  ['port close-hauled, wind 90', 90, ha(90, 45)],
  ['starboard beam, wind 90', 90, ha(90, -90)],
  ['port beam, wind 90', 90, ha(90, 90)],
  ['starboard run, wind 90', 90, ha(90, -150)],
  ['port run, wind 90', 90, ha(90, 150)],
  ['starboard close-hauled, wind 0', 0, ha(0, -45)],
  ['port close-hauled, wind 45', 45, ha(45, 45)],
  ['starboard near-beam 82, wind 20', 20, ha(20, -82)],
  ['port just off beam 79, wind 200', 200, ha(200, 79)],
];

for (const [name, wind, heading] of cases) {
  const { boat, tick } = make(wind, heading);
  for (let i = 0; i < 40; i++) tick();
  const preview = previewDeg(boat);
  const guide = autopilotGuideTarget(boat.renderState());
  boat.input_autopilot_enabled_toggle();
  const locked = boat.wind_direction + boat.autopilot_heading_target;
  const previewErr = absDiff(preview, locked);
  const guideErr = absDiff(boat.wind_direction + guide, locked);
  check(
    `${name}: engage locks to the preview`,
    boat.autopilot_enabled && previewErr < 1 && guideErr < 1e-6,
    `preview ${preview.toFixed(2)}° lock ${locked.toFixed(2)}° (Δ ${previewErr.toFixed(3)}°) aht ${boat.autopilot_heading_target}`,
  );
}

// While engaged the guide stays on the held target even when the live TWA
// sits in a different snap bucket (mid-tack, or Up/Down off 50/90/160).
{
  const { boat, tick } = make(90, ha(90, -45));
  for (let i = 0; i < 40; i++) tick();
  boat.input_autopilot_enabled_toggle();
  const locked = boat.wind_direction + boat.autopilot_heading_target;
  boat.twa = -85;
  check(
    'engaged: live TWA 85 does not pull the preview off the lock',
    absDiff(previewDeg(boat), locked) < 1,
    `preview ${previewDeg(boat).toFixed(2)}° lock ${locked.toFixed(2)}°`,
  );
  boat.autopilot_heading_target = 68;
  boat.twa = -85;
  const moved = boat.wind_direction + 68;
  check(
    'engaged: non-snap target 68 is the preview, not the 90° re-snap',
    absDiff(previewDeg(boat), moved) < 1,
    `preview ${previewDeg(boat).toFixed(2)}°`,
  );
}

// Q/E: the dashed line is the heading _finishPenaltyTurn will lock, not the
// snap of wherever the bow is right now.
{
  const { boat, tick } = make(90, ha(90, -50));
  for (let i = 0; i < 40; i++) tick();
  boat._startPenaltyTurn(1);
  for (let i = 0; i < 8; i++) tick();
  const exit = penaltyTurnExitTarget(boat.wind_direction, boat.penalty_turn.startHeading);
  const preview = previewDeg(boat);
  const want = boat.wind_direction + exit;
  check(
    'penalty circle: preview is the exit heading',
    absDiff(preview, want) < 1,
    `preview ${preview.toFixed(2)}° exit ${want.toFixed(2)}°`,
  );
  boat._finishPenaltyTurn();
  check(
    'penalty circle: finishing locks that same target',
    boat.autopilot_enabled && Math.abs(boat.autopilot_heading_target - exit) < 1e-9,
    `aht ${boat.autopilot_heading_target} exit ${exit}`,
  );
}

// Steady state is a separate error. The preview stays on the target; the
// hull settles off it because the autopilot is PD (ki = 0) and weather helm
// needs a constant rudder, which the P term only produces with a constant
// heading error. Logged, not folded into the guide.
function settleError(wind, twa0) {
  const { boat, tick } = make(wind, ha(wind, twa0));
  for (let i = 0; i < 30; i++) tick();
  boat.input_autopilot_enabled_toggle();
  let twa = 0, bow = 0, rud = 0, wd = 0, n = 0;
  for (let i = 0; i < 450; i++) {
    tick();
    if (i >= 390) {
      twa += boat.twa; bow += bowDeg(boat); rud += boat.rudder_angle; wd += boat.wind_direction; n++;
    }
  }
  twa /= n; bow /= n; rud /= n; wd /= n;
  const targetTwa = -boat.autopilot_heading_target;
  const headingErr = wrap(bow - (wd + boat.autopilot_heading_target));
  const previewErr = absDiff(previewDeg(boat), wd + boat.autopilot_heading_target);
  return { twa, targetTwa, headingErr, rud, previewErr, aht: boat.autopilot_heading_target };
}
for (const [name, wind, twa0] of [['starboard', 90, -45], ['port', 90, 45]]) {
  const r = settleError(wind, twa0);
  console.log(
    `steady ${name}: target TWA ${r.targetTwa.toFixed(2)}° achieved ${r.twa.toFixed(2)}° ` +
    `heading error ${r.headingErr.toFixed(2)}° rudder ${r.rud.toFixed(2)}° ` +
    `(preview still on the lock, Δ ${r.previewErr.toFixed(3)}°)`,
  );
  check(
    `${name}: settled preview stays on the lock`,
    r.previewErr < 1,
    `preview Δ ${r.previewErr.toFixed(3)}° hull Δ ${r.headingErr.toFixed(2)}°`,
  );
}

if (failed) { console.error(failed + ' failed'); process.exit(1); }
console.log('ap-lock-preview checks passed');
