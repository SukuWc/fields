// Wind chevrons (boat.graphics_model_render, roles "tw"/"aw"): the visible tip,
// taken from world-space vertices, points downwind along the true/apparent flow.
import './dom-stub.mjs';
const H = await import('../scripts/sim-res-harness.mjs');
const { Boat } = await import('../src/boat.js');
let failed = 0;
const check = (name, cond, detail) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`); };
const { map } = H.makeWorld(1);
const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
for (let t = 0; t < 300; t++) { if (t === 1) boat.input_autopilot_enabled_toggle(); map.world.step(1 / 30); boat.physics_model_step(); }
const g = boat.graphics_model_render();
// Visible tip direction from the chevron's world-space vertices: the two
// long strokes share their apex (x1, y1); the tip points from the midpoint of
// their open ends (x2, y2) to that apex.
const dir = r => {
	const [s1, s2] = g.filter(x => x.role === r);
	const tip = { x: s1.x1, y: s1.y1 }, tail = { x: (s1.x2 + s2.x2) / 2, y: (s1.y2 + s2.y2) / 2 };
	return Math.atan2(tip.y - tail.y, tip.x - tail.x);
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const deg = a => a * 180 / Math.PI;
const v = boat.physics_model.m_linearVelocity, w = boat.wind_direction * Math.PI / 180;
// Apparent flow = true flow − boat velocity = −(true "from" vector + v).
const flow = Math.atan2(-(v.y + Math.sin(w) * boat.wind_speed), -(v.x + Math.cos(w) * boat.wind_speed));
const tflow = Math.atan2(-Math.sin(w), -Math.cos(w)), tsm = Math.atan2(boat.wind_vy_smooth, boat.wind_vx_smooth);
const speed = Math.hypot(v.x, v.y);
check('boat is moving (apparent ≠ true)', speed > 0.5, `${speed.toFixed(2)} m/s, TWA ${boat.twa.toFixed(1)} AWA ${boat.awa.toFixed(1)}`);
check('AW chevron tip points along apparent flow (downwind)', Math.abs(deg(wrap(dir('aw') - flow))) < 1, `off by ${deg(wrap(dir('aw') - flow)).toFixed(2)}°`);
check('TW chevron tip points along true flow (vx, vy)', Math.abs(deg(wrap(dir('tw') - tsm))) < 1 && Math.abs(deg(wrap(dir('tw') - tflow))) < 5, `off by ${deg(wrap(dir('tw') - tsm)).toFixed(2)}°`);
const gap = Math.abs(deg(wrap(dir('aw') - dir('tw')))), hud = Math.abs(boat.twa - boat.awa);
check('TW→AW tick gap matches HUD |TWA−AWA|', Math.abs(gap - hud) < 5, `ticks ${gap.toFixed(1)}°, HUD ${hud.toFixed(1)}°`);
process.exit(failed ? 1 : 0);
