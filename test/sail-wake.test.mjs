// Sail wake gain (?sailWakeGain, 'sailWake' room command): default is
// boat.js SAIL_WAKE_GAIN (no change), the coupling scales linearly with it,
// 0 puts no sail momentum into the field, and SimCore carries it into its
// room state.
import './dom-stub.mjs';
const { SimCore } = await import('../src/host.js');
const { SAIL_WAKE_GAIN, SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const { settingDefault, validateRoomSettingCommand } = await import('../src/settings-registry.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const mute = (f) => { const l = console.log; console.log = () => {}; try { return f(); } finally { console.log = l; } };

check('registry default is SAIL_WAKE_GAIN (16)', settingDefault('sailWakeGain') === SAIL_WAKE_GAIN && SAIL_WAKE_GAIN === 16);
check('registry: 0..64 accepted, out of range and missing refused',
	!!validateRoomSettingCommand({ type: 'sailWake', gain: 0 }).c && !!validateRoomSettingCommand({ type: 'sailWake', gain: 64 }).c
	&& !!validateRoomSettingCommand({ type: 'sailWake', gain: -1 }).error && !!validateRoomSettingCommand({ type: 'sailWake', gain: 65 }).error
	&& !!validateRoomSettingCommand({ type: 'sailWake' }).error);

const run = (gain, ticks = 120) => {
	const core = new SimCore({ mapW: 50, mapH: 100 });
	if (gain !== undefined) core.command({ type: 'sailWake', gain });
	mute(() => core.command({ type: 'restart', scenario: 0 }));
	const e = core.sim.sailEfficiency();
	for (let t = 0; t < ticks; t++) core.tick({ dt: 1 / 30, held: [] });
	let dev = 0; const bm = core.bm, U = bm.speed;
	for (const c of bm.cells) if (c && !c.barrier) dev = Math.max(dev, Math.hypot(c.ux, c.uy) - U);
	return { core, e, dev };
};
const d = run(), z = run(0), dbl = run(32);
const base = SAIL_LATTICE_COUPLING * d.core.bm.resolution ** 2 / (d.core.bm.velScale ?? 1);
check('default efficiency is the old formula exactly', d.e === base, `${d.e} vs ${base}`);
check('efficiency scales with the gain (0 → 0, 32 → 2×)', z.e === 0 && Math.abs(dbl.e / d.e - 2) < 1e-12);
check('room state carries the gain', d.core.settings.sailWakeGain === 16 && dbl.core.settings.sailWakeGain === 32);
check('wake strength follows the gain (max |u| above freestream)', z.dev < d.dev && d.dev < dbl.dev, `0: ${z.dev.toExponential(2)} 16: ${d.dev.toExponential(2)} 32: ${dbl.dev.toExponential(2)}`);
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all sail-wake checks passed');
