// Sticky autopilot (player setting): Left / Right move the autopilot heading
// target (autopilotTurn) instead of the rudder; the autopilot stays on.
import './dom-stub.mjs';
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const { helmCommand, heldCommands, setStickyAutopilot, stickyAutopilot } = await import('../src/controls.js');
const { Boat, AUTOPILOT_HEADING_STEP_DEG } = await import('../src/boat.js');
const { BOAT_ACTIONS } = await import('../src/sim.js');

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const helmL = { type: 'helm', boat: 0, dir: -1 };
check('off by default; helm unchanged when off', stickyAutopilot() === false && helmCommand(helmL, false) === helmL);
const m = helmCommand(helmL, true);
check('on: helm -> autopilotTurn, same boat and dir', m.type === 'autopilotTurn' && m.boat === 0 && m.dir === -1 && helmL.type === 'helm');
check('on: other held commands unchanged', helmCommand({ type: 'headingTarget', boat: 0, dir: 1 }, true).type === 'headingTarget');
setStickyAutopilot(true); check('setter', stickyAutopilot() === true && Array.isArray(heldCommands())); setStickyAutopilot(false);
check('autopilotTurn is a boat action (server room honours it)', typeof BOAT_ACTIONS.autopilotTurn === 'function');

// Target arithmetic: Left raises the signed target (CCW), Right lowers it.
const { map } = H.makeWorld(1);
const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
b.autopilot_enabled = false; b.autopilot_heading_target = 50;
BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('Left engages the autopilot, +1.5° on a positive target', b.autopilot_enabled === true && b.autopilot_heading_target === 50 + AUTOPILOT_HEADING_STEP_DEG);
BOAT_ACTIONS.autopilotTurn(b, { dir: +1 });
check('Right undoes it', b.autopilot_heading_target === 50);
b.autopilot_heading_target = -50;
BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('Left on a negative target: -50 -> -48.5', b.autopilot_heading_target === -48.5);
b.autopilot_heading_target = 5.5; BOAT_ACTIONS.autopilotTurn(b, { dir: +1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: +1 });
check('clamped at 5° (no tack through the wind)', b.autopilot_heading_target === 5);
b.autopilot_heading_target = -174; BOAT_ACTIONS.autopilotTurn(b, { dir: +1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: +1 });
check('clamped at 175° (no gybe)', b.autopilot_heading_target === -175);

// Physics: held Left turns her counter-clockwise like left rudder, autopilot on.
for (const a of [5 * Math.PI / 4, 3 * Math.PI / 4]) {
	const { map } = H.makeWorld(1);
	const boat = new Boat(map, 10, -9, a);
	const tick = () => { map.world.step(1 / 30); boat.physics_model_step(); };
	for (let t = 0; t < 200; t++) { if (t === 1) boat.input_autopilot_enabled_toggle(); tick(); }
	const h0 = boat.physics_model.getAngle();
	for (let t = 0; t < 20; t++) { BOAT_ACTIONS.autopilotTurn(boat, { dir: -1 }); tick(); }
	for (let t = 0; t < 30; t++) tick();
	const dA = boat.physics_model.getAngle() - h0;
	check(`held Left turns CCW like left rudder, autopilot stays on (start ${(a * 180 / Math.PI).toFixed(0)}°)`, dA > 0.2 && boat.autopilot_enabled, `dAngle ${dA.toFixed(3)} rad`);
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all sticky-autopilot checks passed');
