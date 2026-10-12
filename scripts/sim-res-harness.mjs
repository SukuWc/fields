// Headless runs of the main.js frame loop at a given simulation resolution.
// Used by test/sim-res.test.mjs and scripts/sim-res-check.mjs.
// Callers must install the DOM stubs before importing this module.
const { Boltzmann } = await import('../src/boltzmann.js');
const { trackBoats, amrParams } = await import('../src/domainTrack.js');
const { SAIL_LATTICE_COUPLING, Boat } = await import('../src/boat.js');
const { Map } = await import('../src/map.js');
const { FluidWind, ConstantWind } = await import('../src/wind.js');

export { Boltzmann, amrParams };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function fieldStats(bm) {
	let bad = 0, maxU = 0, maxDr = 0;
	for (let y = 1; y < bm.height - 1; y++) {
		for (let x = 1; x < bm.width - 1; x++) {
			const c = bm.cells[x + y * bm.width];
			if (c.barrier) continue;
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; continue; }
			maxU = Math.max(maxU, Math.hypot(c.ux, c.uy));
			maxDr = Math.max(maxDr, Math.abs(c.rho - 1));
		}
	}
	return { bad, maxU, maxDr };
}

// One frame of main.js: boats, sail kicks (coupling × resolution²), tracking
// on stepping frames, advance_frame. Returns lattice ms and steps.
function frame(map, bm, boats, opts) {
	map.world.step(1 / 30);
	for (const boat of boats) {
		boat.physics_model_step();
		if (opts.energy !== false && boat.mainsail_force) {
			const eff = SAIL_LATTICE_COUPLING * bm.resolution * bm.resolution;
			for (const seg of boat.getSailSegments()) {
				bm.apply_energy_segment(seg.x0, seg.y0, seg.x1, seg.y1, seg.fx * eff, seg.fy * eff);
			}
		}
	}
	const t0 = now();
	if (opts.amr !== false && bm.stepsDueThisFrame() > 0) trackBoats(bm, boats);
	const steps = bm.advance_frame();
	return { ms: now() - t0, steps };
}

export function makeWorld(k, wind = 15) {
	const bm = new Boltzmann(75, 75, 1, 90, wind, undefined, 1);
	if (k !== 1) bm.setResolution(1 / k);
	const map = new Map(75, 75, 90, wind, bm, new FluidWind(bm), new ConstantWind(90, wind));
	map.physics_model_init();
	return { bm, map };
}

const speedOf = (b) => Math.hypot(b.physics_model.m_linearVelocity.x, b.physics_model.m_linearVelocity.y);

// Scenario 0: one boat close-hauled on autopilot.
export function scenario0(k, { frames = 600, amr = true, energy = true } = {}) {
	const { bm, map } = makeWorld(k);
	const boat = new Boat(map, 10, -9, 5 * Math.PI / 4);
	let ms = 0, steps = 0, bsAt500 = 0, twaMin = Infinity, twaMax = -Infinity, tws = 0, twsN = 0;
	for (let f = 0; f < frames; f++) {
		if (f === 1) boat.input_autopilot_enabled_toggle();
		const r = frame(map, bm, [boat], { amr, energy });
		ms += r.ms; steps += r.steps;
		if (f === 500) bsAt500 = speedOf(boat);
		if (f >= frames - 100) {
			twaMin = Math.min(twaMin, boat.twa); twaMax = Math.max(twaMax, boat.twa);
			tws += boat.wind_speed; twsN++;
		}
	}
	const st = fieldStats(bm);
	// Boat stack depth and the finest world cell at the boat.
	let depth = 0;
	for (let d = bm.domains[0]; d; d = d.domains[0]) depth++;
	const finestStep = bm._worldStepAt(boat.x, boat.y);
	return {
		k, amr, depth, finestStep, twa: boat.twa, twaSpread: twaMax - twaMin, bs: speedOf(boat), bsAt500,
		tws: tws / twsN, msPerFrame: ms / frames, msPerStep: steps ? ms / steps : 0, steps,
		cells: bm.width * bm.height, ...st, capHits: bm.capHits, domains: bm.domains.length,
	};
}

// Scenario 1: boat 1 clear astern and to leeward of boat 0. TWS over the
// last 100 frames, with sail kicks on and off; the drop on the leeward boat
// with kicks on is the wind shadow.
export function scenario1(k, { frames = 300, energy = true } = {}) {
	const { bm, map } = makeWorld(k);
	const boats = [new Boat(map, 12, -6, 5 * Math.PI / 4), new Boat(map, 15, -11.5, 5 * Math.PI / 4)];
	const tws = [0, 0];
	let n = 0;
	for (let f = 0; f < frames; f++) {
		if (f === 1) { boats[0].input_autopilot_enabled_toggle(); boats[1].input_autopilot_enabled_toggle(); }
		frame(map, bm, boats, { amr: true, energy });
		if (f >= frames - 100) { tws[0] += boats[0].wind_speed; tws[1] += boats[1].wind_speed; n++; }
	}
	const st = fieldStats(bm);
	return { k, energy, tws0: tws[0] / n, tws1: tws[1] / n, ...st };
}

// Barrier at the map centre, no boats. Frame loop with tracking (refine
// anywhere) or without.
export function barrier(k, wind, { frames = 1500, amr = false } = {}) {
	const { bm } = makeWorld(k, wind);
	bm.setBarriers(true);
	let diverge = null, worstU = 0, worstDr = 0, islands = 0, ms = 0, steps = 0;
	for (let f = 1; f <= frames; f++) {
		const t0 = now();
		if (amr && bm.stepsDueThisFrame() > 0) trackBoats(bm, []);
		steps += bm.advance_frame();
		ms += now() - t0;
		if (f % 25 && f !== frames) continue;
		const st = fieldStats(bm);
		if (f >= 300) { worstU = Math.max(worstU, st.maxU); worstDr = Math.max(worstDr, st.maxDr); }
		if (!diverge && (st.bad > 0 || st.maxU > 1 || st.maxDr > 0.5)) diverge = f;
		islands = Math.max(islands, bm.domains.length);
	}
	const end = fieldStats(bm);
	return { k, wind, amr, diverge, worstU, worstDr, endU: end.maxU, endDr: end.maxDr, bad: end.bad, islands, msPerFrame: ms / frames, steps };
}
