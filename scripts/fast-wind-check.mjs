// Fast-wind / map-size timing table. Lattice ms per frame (tracking +
// advance_frame) for one and two boats, refinement on/off, 75 m and 150 m maps.
// node --import ./test/register.mjs scripts/fast-wind-check.mjs
import '../test/dom-stub.mjs';
const H = await import('./sim-res-harness.mjs');
const ONE = [[10, -9, 5 * Math.PI / 4]];
const TWO = [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]];
const rows = [];
for (const size of [75, 150]) {
	H.setMapSize(size);
	for (const mode of [1, 2, '2f', '2f34']) {
		const row = { map: size, mode: String(mode) };
		for (const [name, spec] of [['one', ONE], ['two', TWO]]) for (const amr of [true, false]) {
			const r = H.fleet(mode, spec, { frames: 300, amr, timing: true });
			row[`${name}${amr ? 'On' : 'Off'}`] = +r.msPerFrame.toFixed(2);
		}
		rows.push(row);
		console.log(JSON.stringify(row));
	}
}
