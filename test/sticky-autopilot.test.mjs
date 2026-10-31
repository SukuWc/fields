// Sticky autopilot (player setting): Left / Right move the autopilot heading
// target (autopilotTurn) instead of the rudder; the autopilot stays on.
import './dom-stub.mjs';
await import('./full-stack.mjs');
const H = await import('../scripts/sim-res-harness.mjs');
const { helmCommand, heldCommands, setStickyAutopilot, stickyAutopilot } = await import('../src/controls.js');
const { Boat, AUTOPILOT_HEADING_STEP_DEG, wrapDeg180 } = await import('../src/boat.js');
const { BOAT_ACTIONS } = await import('../src/sim.js');

let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const helmL = { type: 'helm', boat: 0, dir: -1 };
check('on by default; helm unchanged when off', stickyAutopilot() === true && helmCommand(helmL, false) === helmL);
const m = helmCommand(helmL, true);
check('on: helm -> autopilotTurn, same boat and dir', m.type === 'autopilotTurn' && m.boat === 0 && m.dir === -1 && helmL.type === 'helm');
check('on: other held commands unchanged', helmCommand({ type: 'headingTarget', boat: 0, dir: 1 }, true).type === 'headingTarget');
setStickyAutopilot(true); check('setter', stickyAutopilot() === true && Array.isArray(heldCommands())); setStickyAutopilot(false);
check('autopilotTurn is a boat action (server room honours it)', typeof BOAT_ACTIONS.autopilotTurn === 'function');

// Target arithmetic: Left raises the signed target (CCW), Right lowers it.
const { map } = H.makeWorld(1);
const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
b.autopilot_enabled = true; b.twa = -50; b.autopilot_heading_target = 50;
BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('Left: +1.5° (CCW)', b.autopilot_heading_target === 50 + AUTOPILOT_HEADING_STEP_DEG);
BOAT_ACTIONS.autopilotTurn(b, { dir: +1 });
check('Right undoes it', b.autopilot_heading_target === 50);
b.twa = -5; b.autopilot_heading_target = 5.5; BOAT_ACTIONS.autopilotTurn(b, { dir: +1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: +1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: +1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: +1 });
check('Right goes through head-to-wind (tack, no 5° clamp)', b.autopilot_heading_target === -0.5);
b.twa = -179; b.autopilot_heading_target = 179; BOAT_ACTIONS.autopilotTurn(b, { dir: -1 }); BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('Left wraps through dead downwind (gybe, no 175° clamp)', b.autopilot_heading_target === -178);
b.twa = 0; b.autopilot_heading_target = 89; for (let i = 0; i < 5; i++) BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('target lead capped at 90° ahead of the boat', b.autopilot_heading_target === 90);
b.autopilot_enabled = false; b.twa = -30; BOAT_ACTIONS.autopilotTurn(b, { dir: -1 });
check('engaging starts from the current heading', b.autopilot_enabled && b.autopilot_heading_target === 30 + AUTOPILOT_HEADING_STEP_DEG);
check('wrapDeg180', wrapDeg180(190) === -170 && wrapDeg180(-180) === 180 && wrapDeg180(-190) === 170 && wrapDeg180(720) === 0);
// Up / Down unchanged: clamped 5..175 on the current side.
b.autopilot_heading_target = 5.5; b.input_autopilot_heading_decrease(); b.input_autopilot_heading_decrease();
check('Down still clamps at 5°', b.autopilot_heading_target === 5);
b.autopilot_heading_target = -174; b.input_autopilot_heading_increase(); b.input_autopilot_heading_increase();
check('Up still clamps at 175°', b.autopilot_heading_target === -175);

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

// Physics: holding Left / Right for a long time spins her through tacks and
// gybes in one direction (unwrapped heading change > 360°, never reverses much).
for (const dir of [-1, 1]) {
	const { map } = H.makeWorld(1);
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	const tick = () => { map.world.step(1 / 30); boat.physics_model_step(); };
	for (let t = 0; t < 100; t++) tick();
	let prev = boat.physics_model.getAngle(), total = 0, worstBack = 0;
	for (let t = 0; t < 2400; t++) {
		BOAT_ACTIONS.autopilotTurn(boat, { dir }); tick();
		const a = boat.physics_model.getAngle(); total += a - prev; prev = a;
		worstBack = Math.max(worstBack, dir < 0 ? -total : total);
	}
	const deg = total * 180 / Math.PI;
	check(`held ${dir < 0 ? 'Left' : 'Right'} turns continuously through tacks and gybes`, (dir < 0 ? deg : -deg) > 360 && boat.autopilot_enabled, `turned ${deg.toFixed(0)}°`);
}

if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all sticky-autopilot checks passed');
