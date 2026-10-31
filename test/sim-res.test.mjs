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

// Sections 1–8 measure the fixed rings (Default pinned to main; one main-parity
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
		r.twa < -40 && r.twa > -55 && r.twaSpread < 3 && r.bs > 2.4 && r.bs < 3.1 && Math.abs(r.bs - r.bsAt500) < 0.15
		&& r.bad === 0 && r.maxU < 0.3,
		`twa=${r.twa.toFixed(2)} bs=${r.bs.toFixed(3)} tws=${r.tws.toFixed(2)} ms/frame=${r.msPerFrame.toFixed(2)}`);
	check(`x${k} scenario 0 boat sits in a ${2 + Math.log2(k) + 1}-level stack with 1/8-unit cells`,
		r.depth === 3 + Math.log2(k) && r.finestStep === 0.125, `depth=${r.depth} finest=${r.finestStep}`);
}
check(// Fixed 30 FPS (one pass per tick, boat terms ×3): −49.4023 / 2.1314 → −49.3314 / 2.8466.
// #90 (1 m ring): −49.3314 / 2.8466 → −49.3106 / 2.8521.
// #103 point true wind (Default has no force undo): → −49.3314 / 2.8466.
'Default scenario 0 with ?amrMode=fixed pinned (twa −49.33, bs 2.847)',
	near(s0[1].twa, -49.3314, 0.01) && near(s0[1].bs, 2.8466, 0.002), `twa=${s0[1].twa.toFixed(4)} bs=${s0[1].bs.toFixed(4)}`);
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

// --- 6. Two boats: one flow where their grids overlap, and a wind shadow ---
// Same-depth grids of different boats are synced on coincident fluid nodes
// after every root step (Boltzmann._syncBoatOverlaps). Without that the
// downwind boat's grids never saw the upwind wake, and the scenario-1 number
// (1.16 / 0.40 / 0.07) was mostly the two grids disagreeing.
const S1 = [[12, -6, 5 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]];
const INWAKE = [[12, -6, 5 * Math.PI / 4], [12, -13, 5 * Math.PI / 4]];
const s1 = {}, wk = {};
for (const k of KS) {
	const on = H.scenario1(k);
	const off = H.scenario1(k, { energy: false });
	s1[k] = on.tws0 - on.tws1;
	check(`x${k} scenario 1 grids carry one flow; leeward boat sails in less wind`,
		on.overlapGap < 1e-12 && s1[k] > 0.1 && near(off.tws0, 15, 1e-6) && near(off.tws1, 15, 1e-6) && on.bad === 0 && on.maxU < 0.3,
		`windward ${on.tws0.toFixed(2)} leeward ${on.tws1.toFixed(2)} gap=${on.overlapGap.toExponential(1)}`);
	const w = H.wakeShadow(k, INWAKE);
	wk[k] = w.shadow;
	check(`x${k} boat directly downwind loses wind to the upwind sail`, w.shadow > (k === 4 ? 0.05 : 0.2) && w.overlapGap < 1e-12 && w.bad === 0,
		`TWS ${w.off.toFixed(2)} → ${w.on.toFixed(2)} (shadow ${w.shadow.toFixed(2)})`);
}
check('scenario 1 and in-wake shadows on x2 / x4 come close to Default',
	// #90: the boat reads true wind as a 1 m ring mean; the x4 in-wake shadow fell 0.12 → 0.06 (floor 0.2 × Default; per-boat floors 0.05 x4, 0.2 else).
	// Fixed 30 FPS: the x4 in-wake shadow fell 0.20 → 0.12 (the field advects 3× less per boat length); x4 floor 0.35 × Default.
	[2, 4].every(k => Math.abs(s1[k] - s1[1]) < 0.15 && wk[k] > (k === 4 ? 0.2 : 0.6) * wk[1]),
	`s1 ${KS.map(k => s1[k].toFixed(2)).join(' / ')} · in-wake ${KS.map(k => wk[k].toFixed(2)).join(' / ')}`);
for (const [name, spec, tacks] of [
	['scenario 2', [[-10, -6, 3 * Math.PI / 4], [15, -11.5, 5 * Math.PI / 4]], {}],
	['scenario 3', [[-3, -3, 3 * Math.PI / 4], [18, -11.5, 5 * Math.PI / 4]], { 0: 350 }],
]) {
	for (const k of KS) {
		const r = H.fleet(k, spec, { frames: 500, tacks });
		check(`x${k} ${name} stays finite with one flow`, r.bad === 0 && r.maxU < 0.3 && r.overlapGap < 1e-12
			&& r.boats.every(b => Number.isFinite(b.x) && b.wind_speed > 10),
			`max|u|=${r.maxU.toFixed(3)} TWS ${r.tws.map(t => t.toFixed(2)).join(' / ')}`);
	}
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
			r.twa < -45 && r.twa > -54 && r.twaSpread < 3 && r.bs > 2.4 && r.bs < 3.1 && r.bad === 0 && r.finestStep === 0.125,
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

// --- 9. Holds in seconds, and ?amrMode=auto (finest disk + grading shell + curl) ---
{
	const holds = [[1, 1, 6], [0.5, 0.5, 3], [0.25, 0.25, 2], [0.5, 1, 6]]
		.map(([res, spf, want]) => ({ want, got: amrParams({ cellSize: 1 / res, stepsPerFrame: spf }).hold, secs: amrParams({ cellSize: 1 / res, stepsPerFrame: spf }).hold / (30 * spf) }));
	check('curl hold is ~0.2 s on every setting (Default / x2 / x4 / 2f)',
		holds.every(h => h.got === h.want && h.secs >= 0.19 && h.secs <= 0.27), holds.map(h => `${h.got} (${h.secs.toFixed(3)} s)`).join(' / '));
	const a1 = amrParams({ cellSize: 1, amrMode: 'auto' });
	const a2 = amrParams({ cellSize: 2, stepsPerFrame: 0.5, amrMode: 'auto' });
	check('auto: finest disk R2 fixed, coarser floors are the 3-cell grading shell',
		a1.auto && a1.levels.map(l => l.worldRadius).join() === '4.25,2.75,2' && a2.levels.map(l => l.worldRadius).join() === '7.25,4.25,2.75,2'
		&& a1.levels.every((l, i) => l.cap === amrParams({ cellSize: 1 }).levels[i].cap),
		`Default ${a1.levels.map(l => l.worldRadius).join('/')} · x2 ${a2.levels.map(l => l.worldRadius).join('/')}`);
	// Every refined child cell sits AUTO_SHELL − 1 own cells inside its parent's
	// refined region (one cell of lag allowed), unless that is off the window.
	const D_AUTO = D.AUTO_SHELL;
	const shellOk = (bm) => {
		let worst = Infinity;
		for (let D = bm.domains.find(d => d.disk); D && D.domains[0]; D = D.domains[0]) {
			const C = D.domains[0], ccw = C.cx1 - C.cx0;
			for (let ly = 0; ly < C.cy1 - C.cy0; ly++) for (let lx = 0; lx < ccw; lx++) {
				if (C.mask[lx + ly * ccw] !== 1) continue;
				for (let d = 1; d <= D_AUTO - 1; d++) for (const [ox, oy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
					const px = Math.floor(D.coarseX(C.cx0 + lx + ox)), py = Math.floor(D.coarseY(C.cy0 + ly + oy));
					if (px < D.cx0 + 1 || py < D.cy0 + 1 || px >= D.cx1 - 1 || py >= D.cy1 - 1) continue;
					if (!D._maskAt(px, py)) worst = Math.min(worst, d - 1);
				}
			}
		}
		return worst;
	};
	H.setAmrMode('auto');
	for (const k of [1, 2, '2f']) {
		const r = H.fleet(k, [[10, -9, 5 * Math.PI / 4]], { frames: 400 });
		const w = shellOk(r.bm);
		const reach = H.stackReach(r.bm, r.boats[0].x, r.boats[0].y);
		check(`auto ${k}: grading shell holds (≥ 2 own cells) and the wake is refined downstream`,
			w === Infinity && r.bad === 0 && reach.length >= 3 && reach[0] > 12 && r.stack[r.stack.length - 1] > 0,
			`margin ${w === Infinity ? '≥2' : w} reach ${reach.map(v => v.toFixed(1)).join('/')} cells ${r.stack.join('/')}`);
	}
	const s0 = H.scenario0(1);
	const wk = H.wakeShadow(1, INWAKE);
	check(// Fixed 30 FPS: −49.428 / 2.129 → −49.305 / 2.8465.
	// #90 (1 m ring): −49.3048 / 2.8465 → −49.3557 / 2.8526.
	// #103 point true wind (Default has no force undo): → −49.3048 / 2.8465.
	'auto Default scenario 0 pinned: twa −49.30, bs 2.847',
		near(s0.twa, -49.3048, 0.01) && near(s0.bs, 2.8465, 0.002), `twa=${s0.twa.toFixed(4)} bs=${s0.bs.toFixed(4)}`);
	H.setAmrMode('fixed');
	check('auto Default scenario 0 close-hauled and the in-wake shadow is at least the fixed one',
		s0.twa < -45 && s0.twa > -54 && s0.bs > 2.4 && s0.bs < 3.1 && wk.shadow > 0.4 && wk.overlapGap < 1e-12,
		`twa=${s0.twa.toFixed(2)} bs=${s0.bs.toFixed(3)} in-wake ${wk.shadow.toFixed(2)}`);
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all sim-res checks passed');
