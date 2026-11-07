// Simulation resolution setting (Default / x2 / x4 coarser root grid).
// Scaling: lattice U and ν fixed, root cell k = 1/resolution world units,
// resolution lattice steps per frame. See Boltzmann.setResolution.
import './dom-stub.mjs';
// Pins the full pre-#86 stack: main-parity numbers and stack structure.
await import('./full-stack.mjs');

const H = await import('../scripts/sim-res-harness.mjs');
const { Boltzmann, amrParams } = H;
const { SAIL_LATTICE_COUPLING } = await import('../src/boat.js');
const D = await import('../src/domainTrack.js');
const { FieldPainter } = await import('../src/fieldPainter.js');

let failed = 0;
function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
	return ok;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Sections 6 and 9 live in sim-res-fleet.test.mjs. Sections 1–8 measure the fixed rings (Default pinned to main; one main-parity
// check). The app, the harness and the engine default to auto; sections 0 and 9 cover that.
{
	const fs = await import('node:fs');
	const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
	// Room amrMode is edited via the TOML admin textarea (amr_auto), not a dropdown.
	// The registry default and host.js SimCore still send amrMode at startup.
	const { settingDefault } = await import('../src/settings-registry.js');
	const { ROOM_CONFIG_DEFAULTS, ROOM_CONFIG_KEYS } = await import('../src/room-config.js');
	const selected = settingDefault('amrMode');
	const hostJs = fs.readFileSync(new URL('../src/host.js', import.meta.url), 'utf8');
	check('app default refinement layout is auto (registry + TOML amr_auto + host.js); fixed stays selectable via amr_auto=false',
		selected === 'auto'
		&& ROOM_CONFIG_DEFAULTS.amr_auto === true
		&& ROOM_CONFIG_KEYS.includes('amr_auto')
		&& /id="room_config"/.test(html)
		&& !/<select id="amrMode"/.test(html)
		&& /type: 'amrMode', mode: settingDefault\('amrMode'\)/.test(hostJs)
		&& H.amrMode() === 'auto',
		`selected=${selected} harness=${H.amrMode()}`);
	const eng = new Boltzmann(75, 75, 1, 90, 4.5, undefined, 1);
	const engFixed = new Boltzmann(75, 75, 1, 90, 4.5, undefined, 1);
	engFixed.amrMode = 'fixed';
	check('Boltzmann engine defaults to auto; amrMode = fixed still selects the rings',
		eng.amrMode === 'auto' && amrParams(eng).auto && !amrParams(engFixed).auto && amrParams(engFixed).levels[0].worldRadius === 8);
}
H.setAmrMode('fixed');
const KS = [1, 2, 4];

function lattice(k, wind = 4.5) { // m/s
	const bm = new Boltzmann(75, 75, 1, 90, wind, undefined, 1);
	if (k !== 1) bm.setResolution(1 / k);
	return bm;
}

// --- 1. Lattice size, plane, stepping, wind units ---
for (const k of KS) {
	const bm = lattice(k);
	const n = Math.round(75 / k);
	check(`x${k} lattice is ${n}² cells, ${bm.latticeWorldWidth} world units`,
		bm.width === n && bm.height === n && bm.cellSize === k && near(bm.latticeWorldWidth, n * k, 1e-12)
		&& bm.latticeWorldWidth >= 75 && bm.latticeWorldWidth - 75 < k);
	let steps = 0;
	for (let f = 0; f < 8; f++) steps += bm.advance_frame();
	check(`x${k} takes ${8 / k} lattice steps in 8 frames`, steps === 8 / k, `steps=${steps}`);
	let worst = 0;
	for (const [x, y] of [[0, 0], [10.3, -9.7], [-20.1, 17.4], [33, -33]]) {
		const v = bm.get_field_velocity(x, y);
		worst = Math.max(worst, Math.abs(Math.hypot(v.x, v.y) * 400 - 15));
	}
	check(`x${k} freestream reads TWS 15`, worst < 1e-9, `err=${worst.toExponential(2)}`);
}
{
	const bm = lattice(1);
	bm.setResolution(0.25);
	bm.setResolution(1);
	const fresh = lattice(1);
	let diff = 0;
	for (let i = 0; i < fresh.cells.length; i++) diff = Math.max(diff, Math.abs(fresh.cells[i].fN - bm.cells[i].fN));
	check('switching back to Default rebuilds the same lattice', bm.width === 75 && diff === 0 && bm.domains.length === 0);
	bm.setBarriers(true);
	bm.setResolution(0.5);
	let bar = 0;
	for (const c of bm.cells) if (c.barrier) bar++;
	check('barrier survives a resolution change at the same world radius', bar > 20 && bar < 40, `cells=${bar} (π·3² ≈ 28)`);
}

// --- 2. AMR footprint in world units ---
{
	const p1 = amrParams({ cellSize: 1 });
	const L = p1.levels;
	check('Default AMR stack is the existing three levels and constants',
		L.length === 3 && p1.extraLevels === 0
		&& L[0].radius === D.DISK_RADIUS && L[1].radius === D.DISK2_RADIUS && L[2].radius === D.DISK3_RADIUS
		&& L[0].half === D.DOMAIN_HALF && L[1].half === D.DOMAIN2_HALF && L[2].half === D.DOMAIN3_HALF
		&& L[0].cap === D.MASK_CELL_CAP && L[1].cap === D.MASK2_CELL_CAP && L[2].cap === D.MASK3_CELL_CAP
		&& p1.fieldHalf === D.FIELD_HALF && p1.fieldCap === D.FIELD_CELL_CAP
		&& p1.seedMin === D.SEED_MIN && p1.hold === D.CURL_HOLD && p1.curlDx === D.CURL_DX && p1.maxShift === 1);
	for (const k of [2, 4]) {
		const p = amrParams({ cellSize: k });
		const L = p.levels;
		const extra = Math.log2(k);
		const finestCell = L[L.length - 1].parentCell / 2;
		check(`x${k} adds ${extra} outer ring(s); finest cell is 1/8 world unit`,
			L.length === 3 + extra && p.extraLevels === extra && finestCell === 0.125,
			L.map(l => `cell ${l.parentCell / 2} R${l.worldRadius}`).join(' · '));
		const inner = L.slice(extra);
		check(`x${k} inner three levels keep the Default radii, halves and caps`,
			inner.every((l, i) => l.radius === amrParams({ cellSize: 1 }).levels[i].radius
				&& l.half === amrParams({ cellSize: 1 }).levels[i].half && l.cap === amrParams({ cellSize: 1 }).levels[i].cap));
		let nested = true, buffer = Infinity;
		for (let i = 0; i + 1 < L.length; i++) {
			if (!(L[i].worldRadius > L[i + 1].worldRadius)) nested = false;
			if (L[i].ring) buffer = Math.min(buffer, (L[i].worldRadius - L[i + 1].worldRadius) / (L[i].parentCell / 2));
		}
		check(`x${k} rings wrap the inner disks with ≥ 4 own cells of buffer`, nested && buffer >= 4,
			`min buffer ${buffer} cells`);
		check(`x${k} ring caps fit their disk floor and stay bounded`,
			L.every(l => l.cap >= Math.PI * l.radius * l.radius && l.cap <= 400),
			L.map(l => l.cap).join('/'));
		check(`x${k} curl is normalised by world spacing`, p.curlDx === k && p.maxShift === k);
	}
	const tex = { image: { data: new Uint8Array(75 * 8 * 75 * 8 * 4), width: 600, height: 600 } };
	const painter = new FieldPainter(tex, 8);
	const bm = new Boltzmann(75, 75, 1, 90, 4.5, painter);
	const sizes = [painter.oversampling];
	bm.setResolution(0.5); sizes.push(painter.oversampling, tex.image.width);
	bm.setResolution(0.25); sizes.push(painter.oversampling, tex.image.width);
	bm.setResolution(1); sizes.push(painter.oversampling, tex.image.width);
	check('texture keeps one texel per 1/8-unit cell (oversampling 8 / 16 / 32)',
		sizes.join() === [8, 16, 608, 32, 608, 8, 600].join(), sizes.join());
}

// --- 2b. Viscosity: refined levels carry Default's physical ν ---
{
	const omegaOf = (nu) => 1 / (3 * nu + 0.5);
	const eq24 = (w) => 2 * w / (4 - w);
	// Default: ω of a level with cell c world units (root c = 1).
	const def = new Map();
	let w = omegaOf(0.025);
	for (let c = 1; c >= 0.125; c /= 2) { def.set(c, w); w = eq24(w); }
	// A 2-unit cell at Default's physical ν: ν_lat = 0.025 / 2 (Eq. 24 run backwards).
	def.set(2, omegaOf(0.0125));
	for (const k of [1, 2, 4]) {
		const bm = lattice(k);
		bm.addDomain(6, 6, 10, 10);
		const l1 = bm.domains[0];
		l1.addDomain(4, 4, 8, 8);
		const l2 = l1.domains[0];
		const c = k / 2;
		const worst = Math.max(Math.abs(l1.omega_f - def.get(c)), Math.abs(l2.omega_f - def.get(c / 2)));
		const parts = [`c${c}:ω${l1.omega_f.toFixed(4)}`, `c${c / 2}:ω${l2.omega_f.toFixed(4)}`];
		check(`x${k} level-1 ω_f equals Default's ω for its cell size`, worst < 1e-12 && bm.nu === 0.025
			&& near(bm.matchedNu, 0.025 / k, 1e-15), `${parts.join(' ')} root ν=${bm.nu} matched=${bm.matchedNu}`);
	}
}

// --- 3. Sail momentum: same physical momentum per frame on every grid ---
{
	const out = [];
	for (const k of KS) {
		const bm = lattice(k);
		const before = { x: 0, y: 0 };
		for (const c of bm.cells) { before.x += c.rho * c.ux; before.y += c.rho * c.uy; }
		const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution;
		bm.apply_energy_segment(5, -5, 7, -3, 10 * eff, -20 * eff);
		let px = 0, py = 0;
		for (const c of bm.cells) { px += c.rho * c.ux; py += c.rho * c.uy; }
		// Physical momentum: lattice ρu × cell area (k²).
		out.push({ k, px: (px - before.x) * k * k, py: (py - before.y) * k * k });
	}
	const ref = out[0];
	const err = Math.max(...out.map(o => Math.hypot(o.px - ref.px, o.py - ref.py) / Math.hypot(ref.px, ref.py)));
	check('sail kick deposits the same physical momentum at Default, x2, x4', err < 1e-6,
		out.map(o => `x${o.k}:(${o.px.toFixed(5)},${o.py.toFixed(5)})`).join(' '));
}

// --- 4. Wind features advect at the same world speed ---
{
	const out = [];
	for (const k of KS) {
		const bm = lattice(k);
		// A sideways puff at world (0, 20); wind blows toward −Y at U = 0.15.
		bm.apply_energy(0, 20, 0.05 / (k * k), 0);
		for (let f = 0; f < 120; f++) bm.advance_frame();
		// Centroid of the +x momentum the puff carries (the acoustic pulse
		// radiates both signs and averages out of this).
		let sw = 0, sy = 0;
		for (let y = 1; y < bm.height - 1; y++) for (let x = 1; x < bm.width - 1; x++) {
			const u = bm.cells[x + y * bm.width].ux;
			if (u <= 0) continue;
			sw += u; sy += u * (y - bm.height / 2 + 0.5) / bm.resolution;
		}
		out.push({ k, y: sy / sw });
	}
	// U = 0.15 lattice = 0.15 world units per frame at every setting: about
	// 18 units in 120 frames, from y = 20 to about 2–3.
	check('a puff crosses the same world distance in 120 frames',
		out.every(o => Math.abs(o.y - out[0].y) < 1.5) && out[0].y < 5 && out[0].y > 0,
		out.map(o => `x${o.k}: y=${o.y.toFixed(2)}`).join(' '));
}

// --- 5. Scenario 0: ~45° hold at every setting, Default unchanged, faster when coarse ---
const s0 = {};
for (const k of KS) {
	const r = H.scenario0(k, { frames: 600 });
	s0[k] = r;
	check(`x${k} scenario 0 holds ~45° at a steady speed`,
		r.twa < -40 && r.twa > -55 && r.twaSpread < 3 && r.bs > 2.0 && r.bs < 2.6 && Math.abs(r.bs - r.bsAt500) < 0.15
		&& r.bad === 0 && r.maxU < 0.3,
		`twa=${r.twa.toFixed(2)} bs=${r.bs.toFixed(3)} tws=${r.tws.toFixed(2)} ms/frame=${r.msPerFrame.toFixed(2)}`);
	check(`x${k} scenario 0 boat sits in a ${2 + Math.log2(k) + 1}-level stack with 1/8-unit cells`,
		r.depth === 3 + Math.log2(k) && r.finestStep === 0.125, `depth=${r.depth} finest=${r.finestStep}`);
}
check(// Fixed 30 FPS (one pass per tick, boat terms ×3): −49.4023 / 2.1314 → −49.3314 / 2.8466.
// #90 (1 m ring): −49.3314 / 2.8466 → −49.3106 / 2.8521.
// #103 point true wind (Default has no force undo): → −49.3314 / 2.8466.
// Dinghy heel (crew holds 5°, sail force × cos²): → −49.3053 / 2.8339.
// Sail CE leeward offset (weather helm via h·sinφ): → −47.5006 / 2.7098.
// CE + CLR offsets (ceLateralHeight 0.5, clrDepth 0.5): → −48.9519 / 2.8097.
// Sail AWS in m/s + hull drag (dinghy-forces.js): → −48.6869 / 2.2831.
'Default scenario 0 with ?amrMode=fixed pinned (twa −48.69, bs 2.283)',
	near(s0[1].twa, -48.6869, 0.01) && near(s0[1].bs, 2.2831, 0.002), `twa=${s0[1].twa.toFixed(4)} bs=${s0[1].bs.toFixed(4)}`);
// With the outer rings the boat keeps Default's fine levels, so refinement
// costs about what it does at Default. Coarse settings must not be slower.
check('x2 and x4 with refinement are no slower per frame than Default',
	s0[2].msPerFrame < 1.15 * s0[1].msPerFrame && s0[4].msPerFrame < 1.15 * s0[1].msPerFrame,
	`ms/frame ${s0[1].msPerFrame.toFixed(2)} / ${s0[2].msPerFrame.toFixed(2)} / ${s0[4].msPerFrame.toFixed(2)}`);
{
	const off = KS.map(k => H.scenario0(k, { frames: 300, amr: false }).msPerFrame);
	check('x2 and x4 without refinement are measurably faster', off[1] < 0.5 * off[0] && off[2] < off[1],
		off.map(v => v.toFixed(3)).join(' / '));
}

// --- 7. Barrier at wind 5, 15, 25 for 1500 frames on the coarse grids ---
// Default is covered by wind-stability.test.mjs.
for (const k of [2, 4]) {
	for (const wind of [1.5, 4.5, 7.5]) { // m/s (old UI 5 / 15 / 25)
		for (const amr of [false, true]) {
			const r = H.barrier(k, wind, { frames: 1500, amr });
			check(`x${k} barrier wind ${wind} m/s ${amr ? 'refine-anywhere' : 'no AMR'} stable for 1500 frames`,
				r.diverge === null && r.bad === 0 && r.worstU < 0.6 && r.worstDr < 0.3 && r.endU < 0.55,
				`max|u|=${r.worstU.toFixed(3)} max|ρ−1|=${r.worstDr.toFixed(3)} islands=${r.islands}`);
		}
	}
}

// --- 7b. 4f viscosity: root and boat stack at FAST4_NU_FLOOR (2x Default's physical nu) ---
{
	const { FAST4_NU_FLOOR } = await import('../src/boltzmann.js');
	const { bm } = H.makeWorld('4f', 4.5);
	const phys = bm.nu * bm.cellSize * bm.cellSize * bm.stepsPerFrame;
	check('4f: root and stack ν at FAST4_NU_FLOOR, physical ν 2× Default (was 16× / 8×)',
		FAST4_NU_FLOOR === 0.003125 && bm.nu === FAST4_NU_FLOOR && bm.matchedNu === FAST4_NU_FLOOR && near(phys, 0.05, 1e-12),
		`ν=${bm.nu}/${bm.matchedNu} phys=${phys}`);
}

// --- 8. Fast-wind grid 2f (2 m root cell stepped every frame) and the 150 m map ---
{
	const { FluidWind } = await import('../src/wind.js');
	for (const [mode, steps, vs] of [['2f', 1, 2]]) {
		const { bm } = H.makeWorld(mode, 4.5);
		let n = 0;
		for (let f = 0; f < 10; f++) n += bm.advance_frame();
		const w = new FluidWind(bm).getWind(3, -4);
		check(`${mode}: ${steps} steps/frame, velScale ${vs}, lattice U = 0.15/${vs}, felt wind 4.5 m/s`,
			n === Math.floor(10 * steps + 1e-9) && near(bm.velScale, vs, 1e-12) && near(bm.speed, 0.15 / vs, 1e-15)
			&& near(w.speed, 4.5, 1e-6) && bm.nu === 0.025 && bm.matchedNu === 0.0125,
			`steps=${n} U=${bm.speed.toFixed(4)} TWS=${w.speed.toFixed(3)} ν=${bm.nu}/${bm.matchedNu}`);
		const r = H.scenario0(mode);
		check(`${mode} scenario 0 holds close-hauled like Default`,
			r.twa < -45 && r.twa > -54 && r.twaSpread < 3 && r.bs > 2.0 && r.bs < 2.6 && r.bad === 0 && r.finestStep === 0.125,
			`twa=${r.twa.toFixed(2)} bs=${r.bs.toFixed(3)}`);
	}
	for (const [mode, wind] of [['2f', 15]]) {
		const r = H.barrier(mode, wind, { frames: 1500, amr: true });
		check(`${mode} barrier at ${wind} m/s (refine-anywhere) stable for 1500 frames`,
			r.diverge === null && r.bad === 0 && r.worstU < 0.6 && r.worstDr < 0.3,
			`max|u|=${r.worstU.toFixed(3)} islands=${r.islands}`);
	}
	H.setMapSize(150);
	const big = H.scenario0('2f', { frames: 300 });
	H.setMapSize(75);
	check('150 m map: 2f lattice is 75² cells and scenario 0 runs finite',
		big.cells === 75 * 75 && big.bad === 0 && Number.isFinite(big.twa), `cells=${big.cells} twa=${big.twa.toFixed(2)}`);
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all sim-res checks passed');
