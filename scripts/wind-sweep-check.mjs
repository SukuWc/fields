// Close-hauled autopilot across wind speeds (2f default, auto refinement).
// One boat, scenario 0 start, 600 frames, on a 400 m map so she never reaches
// the map edge: on the 75 m harness map she hits the left wall after
// ~55-65 m, which pins her head to wind at ~-18° TWA with near-zero speed.
// That was the "high wind" failure in the mode comparison (5-15 m/s reach
// the wall within 600 frames, 4.5 m/s does not). Each run asserts she stays
// clear of the edge. A real rudder holds TWA -45..-53° at every wind in
// this sweep; the steady helm is a few degrees.
// Run: node --import ./test/register.mjs scripts/wind-sweep-check.mjs
import * as H from './sim-res-harness.mjs';
const { Boat } = await import('../src/boat.js');
const MODE = process.env.M || '2f', SIDE = 400, FRAMES = 600;
const WINDS = (process.env.W || '3,4.5,6,7.5,10,15').split(',').map(Number);
H.setMapSize(SIDE);
let failed = 0, prevBs = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); };
console.log('wind m/s | TWA ° | spread | AWA ° | boat m/s | rudder ° | min edge gap m');
for (const w of WINDS) {
	const { bm, map } = H.makeWorld(MODE, w);
	const b = new Boat(map, 10, -9, 5 * Math.PI / 4);
	let lo = Infinity, hi = -Infinity, gap = Infinity, bs = 0, rud = 0;
	for (let f = 0; f < FRAMES; f++) {
		if (f === 1) {
			b.input_autopilot_enabled_toggle();
			// 139 kg from rest in a strong wind rounds up before the rudder
			// has flow. 0.6 m/s is enough steerage to reach the sailing state
			// this sweep measures.
			const ang = b.physics_model.getAngle();
			b.physics_model.setLinearVelocity({ x: Math.sin(ang) * 0.6, y: -Math.cos(ang) * 0.6 });
		}
		H.frame(map, bm, [b], { amr: true, energy: true });
		gap = Math.min(gap, SIDE / 2 - Math.abs(b.x), SIDE / 2 - Math.abs(b.y));
		if (f >= FRAMES - 100) {
			lo = Math.min(lo, b.twa); hi = Math.max(hi, b.twa);
			const v = b.physics_model.m_linearVelocity; bs += Math.hypot(v.x, v.y) / 100; rud += Math.abs(b.rudder_angle) / 100;
		}
	}
	console.log(`${w} | ${b.twa.toFixed(1)} | ${(hi - lo).toFixed(1)} | ${b.awa.toFixed(1)} | ${bs.toFixed(2)} | ${rud.toFixed(1)} | ${gap.toFixed(0)}`);
	check(`${MODE} ${w} m/s: clear of the map edge`, gap > 10, `gap ${gap.toFixed(0)} m`);
	// A real rudder holds the close-hauled band at every wind here.
	if (w <= 6) {
		check(`${MODE} ${w} m/s: holds close-hauled (TWA -45..-53°, spread < 3°)`, lo > -53 && hi < -45 && hi - lo < 3, `${lo.toFixed(1)}..${hi.toFixed(1)}`);
		check(`${MODE} ${w} m/s: boat speed rises with wind`, bs > prevBs, `${bs.toFixed(2)} m/s`);
	} else if (w <= 7.5) {
		check(`${MODE} ${w} m/s: holds near close-hauled (TWA -44..-53°, spread < 3°)`, lo > -53 && hi < -44 && hi - lo < 3, `${lo.toFixed(1)}..${hi.toFixed(1)}`);
		check(`${MODE} ${w} m/s: boat speed rises with wind`, bs > prevBs, `${bs.toFixed(2)} m/s`);
	} else {
		// A real rudder (foil.js) holds the beat. The steady angle is a couple
		// of degrees, not the old weak-rudder weather helm above 5°.
		check(`${MODE} ${w} m/s: holds close-hauled (TWA -45..-53°, spread < 3°)`, lo > -53 && hi < -45 && hi - lo < 3, `${lo.toFixed(1)}..${hi.toFixed(1)}`);
		check(`${MODE} ${w} m/s: rudder stays a few degrees`, rud < 8, `rud ${rud.toFixed(1)}°`);
		check(`${MODE} ${w} m/s: still sailing (bs > 1, |TWA| 20..90)`, bs > 1 && Math.abs(b.twa) > 20 && Math.abs(b.twa) < 90,
			`bs=${bs.toFixed(2)} twa=${b.twa.toFixed(1)}`);
	}
	prevBs = bs;
}
if (failed) { console.log(failed + ' FAILED'); process.exit(1); }
console.log('all wind-sweep checks passed');
