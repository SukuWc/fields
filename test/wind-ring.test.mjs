// Boat true-wind ring (wind.js ringWindSample, Map.get_wind_ring): mean of
// the sample VECTORS on a 1 m, 20-point circle. Uniform wind is exact,
// opposite vectors cancel, directions near 0 / 360 wrap, non-finite samples
// are skipped, and dev mode (ConstantWind) is bit-identical to get_wind.
import './dom-stub.mjs';
const { ringWindSample, windSample, ConstantWind } = await import('../src/wind.js');
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const uni = (vx, vy) => () => windSample(vx, vy);

{
	const w = ringWindSample(uni(0.01, -0.02), 3, 4), c = windSample(0.01, -0.02);
	check('uniform field: exactly the point sample', w.vx === c.vx && w.vy === c.vy && w.speed === c.speed && w.direction === c.direction);
}
{
	// +x half of the ring blows one way, −x half the other: the mean is zero.
	const w = ringWindSample((x) => windSample(x > 0 ? 0.01 : -0.01, 0), 0, 0, 1, 20);
	check('opposite vectors cancel (no speed survives)', near(w.vx, 0) && near(w.vy, 0) && w.speed < 1e-9, `speed ${w.speed}`);
}
{
	// Directions 350° and 10° around the ring: vector mean is 0° (from +X), not 180°.
	const at = (deg) => { const a = (deg - 180) * Math.PI / 180; return windSample(0.01 * Math.cos(a), 0.01 * Math.sin(a)); };
	const w = ringWindSample((x, y) => at(y > 0 ? 350 : 10), 0, 0, 1, 20);
	const d = ((w.direction % 360) + 360) % 360;
	check('directions near 0/360 wrap: 350° and 10° average to 0°', Math.min(d, 360 - d) < 1e-6 && w.speed > 0, `${w.direction}`);
}
{
	// A rotating field (solid-body vortex about the centre) cancels; offset by a uniform wind it returns that wind.
	const rot = (x, y) => windSample(-y * 0.001, x * 0.001);
	const w0 = ringWindSample(rot, 0, 0), w1 = ringWindSample((x, y) => windSample(0.02 - y * 0.001, x * 0.001), 0, 0);
	check('rotating field: vortex part cancels, uniform part stays', w0.speed < 1e-9 && near(w1.vx, 0.02, 1e-12) && near(w1.vy, 0, 1e-12));
}
{
	let i = 0;
	const w = ringWindSample(() => (i++ % 2 ? { vx: NaN, vy: 0 } : windSample(0.01, 0)), 0, 0);
	const none = ringWindSample(() => ({ vx: NaN, vy: NaN }), 0, 0);
	check('non-finite samples skipped; all non-finite → null', w && w.vx === 0.01 && none === null);
}
{
	const cw = new ConstantWind(37, 6.3);
	const map = { wind: cw };
	const { Map } = await import('../src/map.js');
	const ring = Map.prototype.get_wind_ring.call(map, 12.3, -4.5), pt = cw.getWind(12.3, -4.5);
	check('dev mode (ConstantWind): ring is bit-identical to get_wind', ring.vx === pt.vx && ring.vy === pt.vy && ring.speed === pt.speed && ring.direction === pt.direction);
}
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
console.log('all wind-ring checks passed');
