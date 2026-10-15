// Depower toggle (Boat.input_depower_toggle, X key).
import './dom-stub.mjs';
const H = await import('../scripts/sim-res-harness.mjs');
const { trackBoats } = await import('../src/domainTrack.js');
const { SAIL_LATTICE_COUPLING, Boat, DEPOWER_RAMP_S, SAIL_FLAP_AOA_DEG } = await import('../src/boat.js');
let failed = 0;
const check = (name, cond, detail) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`); };
const spd = b => Math.hypot(b.physics_model.m_linearVelocity.x, b.physics_model.m_linearVelocity.y);
const { bm, map } = H.makeWorld(1);
const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
let maxForceJump = 0, lastPower = null;
function tick() {
	map.world.step(1 / 30);
	boat.physics_model_step();
	if (boat.mainsail_force) {
		const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution / (bm.velScale ?? 1);
		for (const s of boat.getSailSegments()) bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff);
	}
	if (bm.stepsDueThisFrame() > 0) trackBoats(bm, [boat]);
	bm.advance_frame();
	if (lastPower !== null) maxForceJump = Math.max(maxForceJump, Math.abs(boat.power - lastPower));
	lastPower = boat.power;
}
for (let t = 0; t < 300; t++) { if (t === 1) boat.input_autopilot_enabled_toggle(); tick(); }
const bs0 = spd(boat), power0 = boat.power, twa0 = boat.twa;
const aoaTrim = boat._sailAoaDeg;
boat.graphics_model_render(); const flapTrim = boat.sailFlap;
const jumpPowered = maxForceJump; maxForceJump = 0;
boat.input_depower_toggle();
let rampTicks = 0;
for (let t = 0; t < 300; t++) { tick(); if (boat.depower < 1) rampTicks++; }
const bs1 = spd(boat);
check('depowered: speed below 20 % of powered', bs1 < 0.2 * bs0, `${bs0.toFixed(3)} → ${bs1.toFixed(3)} m/s (${(100 * bs1 / bs0).toFixed(1)} %)`);
check(`ramp ≈ ${DEPOWER_RAMP_S} s, sail power changes smoothly`, rampTicks >= 14 && rampTicks <= 16 && maxForceJump < 0.25 * power0,
	`ramp ${rampTicks} ticks, max power step ${maxForceJump.toFixed(3)} (powered ${power0.toFixed(2)}, powered-run max step ${jumpPowered.toFixed(3)})`);
check('autopilot keeps it depowered, HUD flag set', boat.depowered && boat.depower === 1 && boat.autopilot_enabled && boat.telemetry.depowered === true);
check('depowered: lift ~0 (power is flapping drag only)', boat.power < 0.25 * power0, `power ${power0.toFixed(2)} → ${boat.power.toFixed(2)}`);
check('depowered: still steers (autopilot keeps her within 15° of close-hauled at ~0.2 m/s)', Math.abs(boat.twa - twa0) < 15, `twa ${twa0.toFixed(1)} → ${boat.twa.toFixed(1)}`);
{
	// Sail flapping is visual: the render adds ripple segments, physics state is untouched.
	const before = JSON.stringify([boat.physics_model.getPosition(), boat.physics_model.getLinearVelocity(), boat.rudder_angle, boat.depower]);
	const g = boat.graphics_model_render().filter(x => x.type === 'sail');
	const after = JSON.stringify([boat.physics_model.getPosition(), boat.physics_model.getLinearVelocity(), boat.rudder_angle, boat.depower]);
	check('depowered sails flap (ripple segments), render leaves physics alone', g.length > 6 && boat.sailFlap > 0 && before === after, `${g.length} sail segments, flap ${boat.sailFlap.toFixed(2)}`);
}
boat.input_depower_toggle();
// 250 ticks: long enough to recover, short of the map edge (scenario 0 heads for the wall).
for (let t = 0; t < 250; t++) tick();
const bs2 = spd(boat);
check('toggled off: speed recovers (> 90 %)', bs2 > 0.9 * bs0 && boat.depower === 0, `${bs2.toFixed(3)} m/s (${(100 * bs2 / bs0).toFixed(1)} %)`);
const s0 = H.scenario0(1);
check('scenario 0 never toggled: unchanged (twa −49.3048 / bs 2.8465)', Math.abs(s0.twa + 49.3048) < 1e-4 && Math.abs(s0.bs - 2.8465) < 1e-4, `${s0.twa.toFixed(4)} / ${s0.bs.toFixed(4)}`);
// Flap amplitude follows the main's angle of attack: full at 0, none at close-hauled trim.
{
	const { map: m2 } = H.makeWorld(1);
	const b = new Boat(m2, 0, 0, 5 * Math.PI / 4);
	b._aws = 15; b._sailAoaDeg = 0; b.graphics_model_render(); const atZero = b.sailFlap;
	b._sailAoaDeg = SAIL_FLAP_AOA_DEG; b.graphics_model_render(); const atLimit = b.sailFlap;
	check(`flap: max at AoA 0, none from ${SAIL_FLAP_AOA_DEG}° and at close-hauled trim (AoA ${aoaTrim.toFixed(1)}°)`,
		atZero === 1 && atLimit === 0 && flapTrim === 0, `AoA 0 → ${atZero}, ${SAIL_FLAP_AOA_DEG}° → ${atLimit}, trim → ${flapTrim}`);
}

// Dead downwind the boom is already at its limit: depower changes nothing.
{
	const run = (depowerAt) => {
		const w = H.makeWorld(1);
		const b = new Boat(w.map, 0, 10, 5 * Math.PI / 4);
		const loop = (n, f) => { for (let t = 0; t < n; t++) { w.map.world.step(1 / 30); b.physics_model_step(); if (f) f(t);
			if (b.mainsail_force) { const eff = SAIL_LATTICE_COUPLING * w.bm.resolution * w.bm.resolution / (w.bm.velScale ?? 1);
				for (const s of b.getSailSegments()) w.bm.apply_energy_segment(s.x0, s.y0, s.x1, s.y1, s.fx * eff, s.fy * eff); }
			if (w.bm.stepsDueThisFrame() > 0) trackBoats(w.bm, [b]); w.bm.advance_frame(); } };
		loop(1);
		// Turn her dead downwind (TWA 178°, still on one side) and hold it.
		b.physics_model.setAngle(b.physics_model.getAngle() + (b.twa - 178) * Math.PI / 180);
		b.physics_model_step();
		b.input_autopilot_enabled_toggle();
		let pw = 0, n = 0;
		loop(450, t => { if (t === depowerAt) b.input_depower_toggle(); if (t >= 390) { pw += b.power; n++; } });
		b.graphics_model_render();
		return { bs: spd(b), power: pw / n, twa: b.twa, flap: b.sailFlap, depower: b.depower };
	};
	const off = run(-1), on = run(300);
	check('downwind (autopilot settles at TWA ~160°, boom at its limit): depower leaves speed and force within 2 %, no flap',
		on.depower === 1 && Math.abs(on.bs / off.bs - 1) < 0.02 && Math.abs(on.power / off.power - 1) < 0.02 && on.flap === 0,
		`TWA ${off.twa.toFixed(1)} / ${on.twa.toFixed(1)}, bs ${off.bs.toFixed(3)} → ${on.bs.toFixed(3)}, power ${off.power.toFixed(2)} → ${on.power.toFixed(2)}, flap ${on.flap}`);
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('all depower checks passed');
