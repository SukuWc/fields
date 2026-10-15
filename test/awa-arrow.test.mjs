// Apparent-wind tick (boat.graphics_model_render, role "aw") points along the
// apparent flow, the same downwind convention as the true-wind tick (role "tw").
import './dom-stub.mjs';
const H = await import('../scripts/sim-res-harness.mjs');
const { Boat } = await import('../src/boat.js');
let failed = 0;
const check = (name, cond, detail) => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`); };
const { map } = H.makeWorld(1);
const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
for (let t = 0; t < 300; t++) { if (t === 1) boat.input_autopilot_enabled_toggle(); map.world.step(1 / 30); boat.physics_model_step(); }
const g = boat.graphics_model_render();
const dir = r => { const s = g.find(x => x.role === r); return Math.atan2(s.y1 - boat.y, s.x1 - boat.x); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const deg = a => a * 180 / Math.PI;
const v = boat.physics_model.m_linearVelocity, w = boat.wind_direction * Math.PI / 180;
// Apparent flow = true flow − boat velocity = −(true "from" vector + v).
const flow = Math.atan2(-(v.y + Math.sin(w) * boat.wind_speed), -(v.x + Math.cos(w) * boat.wind_speed));
const speed = Math.hypot(v.x, v.y);
check('boat is moving (apparent ≠ true)', speed > 0.5, `${speed.toFixed(2)} m/s, TWA ${boat.twa.toFixed(1)} AWA ${boat.awa.toFixed(1)}`);
check('AW tick points along apparent flow', Math.abs(deg(wrap(dir('aw') - flow))) < 1, `off by ${deg(wrap(dir('aw') - flow)).toFixed(2)}°`);
const gap = Math.abs(deg(wrap(dir('aw') - dir('tw')))), hud = Math.abs(boat.twa - boat.awa);
check('TW→AW tick gap matches HUD |TWA−AWA|', Math.abs(gap - hud) < 5, `ticks ${gap.toFixed(1)}°, HUD ${hud.toFixed(1)}°`);
process.exit(failed ? 1 : 0);
