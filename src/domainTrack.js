// One reusable window per boat. The boat object is the key, not its index in
// the player list: a skipped boat (NaN, or a window that will not fit) must
// not let the next boat's domain fall into an earlier slot.
//
// Each level's mask is a disk floor plus a curl wake that also erodes. The
// rectangle stays fixed: shiftBy refuses a size change. Level 1 reads root
// curl (Δx = 1). Level 2 reads level-1 fluid curl (Δx = 0.5), level 3 reads
// level-2 fluid curl (Δx = 0.25). Ghosts and the parent-mask rind are not
// sensors, so the staircase cannot refine itself forever. Dividing by that
// level's Δx keeps one τ meaningful on every grid.
//
// Sub-steps per root step (convective ratio 2): level 1 ×2, level 2 ×4,
// level 3 ×8. A masked parent cell is about four fine nodes. Caps bound the
// variable wake (the disk floors, ~200 cells, are the fixed cost):
//   MASK_CELL_CAP  400 root cells    → ≤ 400×4×2 =  3200 node-steps
//   MASK2_CELL_CAP 320 level-1 cells → ≤ 320×4×4 =  5120
//   MASK3_CELL_CAP 280 level-2 cells → ≤ 280×4×8 =  8960
// together ≤ ~17k node-steps plus the root lattice. Scenario 0's mean
// Boltzmann step stays under 12 ms at these caps.

import { buildClosedDiskMask, closeDiagonalContacts } from './boltzmann.js';

export const DOMAIN_HALF = 20;
export const DOMAIN2_HALF = 20;
export const DOMAIN3_HALF = 16;
export const SHIFT_THRESHOLD = 1;
export const DISK_RADIUS = 8;  // coarse cells (8 world units at dx = 1)
export const DISK2_RADIUS = 8; // level-1 fine cells (4 coarse)
export const DISK3_RADIUS = 8; // level-2 fine cells (2 coarse)

// Stored curl is uy_E − uy_W − (ux_N − ux_S) = 2 Δx ω, with Δx the neighbor
// spacing of the lattice that stored it. Divide by 2 Δx U, U = bm.speed, so
// one threshold tracks the same physical vorticity at every inlet speed and
// every refinement level. The level being decided never reads its own nodes.
//
// τ_on > τ_off. A cell must hold for CURL_HOLD frames (about 0.2 s at 30 FPS)
// before it joins, and the same before it leaves. Growth and erosion are one
// 4-connected layer per frame, seeded from the mask already on, so a speckle
// cannot open an island. The hysteresis band is the quiet margin around the
// τ_on contour: a geometric rind of calm cells would be removed by erosion
// and chatter. The cell cap trims the tail, never the disk.
//
// Scenario 0 probe (close-hauled, U = 0.15): cells touching the level-1 disk
// reach about 0.03 downwind for a few dozen frames, then settle near 0.009.
// Upwind of the disk stays under 0.003, so 0.02 does not climb the staircase.
// The 0.05–0.1 band was only a pre-probe guess.
// Raise CURL_TAU_ON if the outline grows in calm water.
// Lower it if a visible wake stays on the coarser grid.
// Keep CURL_TAU_OFF near half of CURL_TAU_ON.
export const CURL_DX = 1;
export const CURL_TAU_ON = 0.02;
export const CURL_TAU_OFF = 0.01;
export const CURL_HOLD = 6;
export const MASK_CELL_CAP = 400;
export const MASK2_CELL_CAP = 320;
export const MASK3_CELL_CAP = 280;

const domainByBoat = new WeakMap();

export function normalizedCurl(curl, speed, dx = CURL_DX) {
	if (!(speed > 0) || !(dx > 0) || !Number.isFinite(curl)) return 0;
	return Math.abs(curl) / (2 * dx * speed);
}

function countOnes(mask) {
	let n = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++;
	return n;
}

function dist2(lx, ly, cx0, cy0, centerX, centerY) {
	const dx = cx0 + lx + 0.5 - centerX;
	const dy = cy0 + ly + 0.5 - centerY;
	return dx * dx + dy * dy;
}

// A cell with an off 4-neighbor, or sitting on the window edge, is boundary.
// Eroding only those cells cannot open an enclosed hole.
function isBoundary(mask, i, lx, ly, cw, ch) {
	if (lx === 0 || ly === 0 || lx + 1 === cw || ly + 1 === ch) return true;
	if (mask[i - 1] !== 1 || mask[i + 1] !== 1 || mask[i - cw] !== 1 || mask[i + cw] !== 1) return true;
	return false;
}

function hasOnEdge(mask, lx, ly, cw, ch) {
	const i = lx + ly * cw;
	if (lx > 0 && mask[i - 1] === 1) return true;
	if (lx + 1 < cw && mask[i + 1] === 1) return true;
	if (ly > 0 && mask[i - cw] === 1) return true;
	if (ly + 1 < ch && mask[i + cw] === 1) return true;
	return false;
}

function updateHolds(curlNorm, above, below, tauOn, tauOff, hold) {
	for (let i = 0; i < curlNorm.length; i++) {
		const norm = curlNorm[i];
		if (norm > tauOn) {
			if (above[i] < hold) above[i]++;
			below[i] = 0;
		} else if (norm < tauOff) {
			if (below[i] < hold) below[i]++;
			above[i] = 0;
		} else {
			above[i] = 0;
			below[i] = 0;
		}
	}
}

// One 4-connected layer of cells that have held above τ_on, closest to the
// boat first, stopping at the area cap. Adjacency is the mask before these
// additions, so a second layer waits until the next frame.
function growOneLayer(mask, above, hold, cap, cw, ch, cx0, cy0, centerX, centerY, allow) {
	let count = countOnes(mask);
	if (count >= cap) return;
	const cand = [];
	for (let ly = 0; ly < ch; ly++) {
		const row = ly * cw;
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + row;
			if (mask[i] === 1 || above[i] < hold) continue;
			if (allow && !allow(cx0 + lx, cy0 + ly)) continue;
			if (!hasOnEdge(mask, lx, ly, cw, ch)) continue;
			cand.push({ i, d: dist2(lx, ly, cx0, cy0, centerX, centerY) });
		}
	}
	cand.sort((a, b) => a.d - b.d || a.i - b.i);
	for (let k = 0; k < cand.length && count < cap; k++) {
		mask[cand[k].i] = 1;
		count++;
	}
}

function erodeOneLayer(mask, floor, below, hold, cw, ch) {
	const drop = [];
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + ly * cw;
			if (mask[i] !== 1 || floor[i] === 1 || below[i] < hold) continue;
			if (!isBoundary(mask, i, lx, ly, cw, ch)) continue;
			drop.push(i);
		}
	}
	for (let k = 0; k < drop.length; k++) mask[drop[k]] = 0;
}

// One boundary layer, farthest from the boat first. The disk floor stays.
function trimOneLayer(mask, floor, cap, cw, ch, cx0, cy0, centerX, centerY) {
	let count = countOnes(mask);
	if (count <= cap) return;
	const cand = [];
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + ly * cw;
			if (mask[i] !== 1 || floor[i] === 1) continue;
			if (!isBoundary(mask, i, lx, ly, cw, ch)) continue;
			cand.push({ i, d: dist2(lx, ly, cx0, cy0, centerX, centerY) });
		}
	}
	cand.sort((a, b) => b.d - a.d || b.i - a.i);
	for (let k = 0; k < cand.length && count > cap; k++) {
		mask[cand[k].i] = 0;
		count--;
	}
}

// One frame of disk-floor + curl expansion (C) and boundary erosion (F).
// `above` / `below` are consecutive-frame holds, mutated in place when they
// already match the window. `prev` null means there is no wake yet (a fresh
// window), not "the whole rectangle is on".
export function stepCurlMask(opts) {
	const cw = opts.cw;
	const ch = opts.ch;
	const n = cw * ch;
	const floor = opts.floor;
	const tauOn = opts.tauOn ?? CURL_TAU_ON;
	const tauOff = opts.tauOff ?? CURL_TAU_OFF;
	const hold = Math.max(1, Math.min(255, opts.hold ?? CURL_HOLD));
	const cap = opts.cap ?? MASK_CELL_CAP;
	let above = opts.above;
	let below = opts.below;
	if (!above || above.length !== n) above = new Uint8Array(n);
	if (!below || below.length !== n) below = new Uint8Array(n);

	const mask = new Uint8Array(n);
	if (opts.prev && opts.prev.length === n) mask.set(opts.prev);
	for (let i = 0; i < n; i++) if (floor[i] === 1) mask[i] = 1;
	// A child cannot outlive its parent mask. Dropping those cells is the
	// coverage rule, not the one-layer sensor erosion.
	if (opts.allow) {
		for (let ly = 0; ly < ch; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				if (!opts.allow(opts.cx0 + lx, opts.cy0 + ly)) mask[lx + ly * cw] = 0;
			}
		}
	}

	updateHolds(opts.curlNorm, above, below, tauOn, tauOff, hold);
	growOneLayer(mask, above, hold, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY, opts.allow);
	erodeOneLayer(mask, floor, below, hold, cw, ch);
	trimOneLayer(mask, floor, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY);
	closeDiagonalContacts(mask, opts.cx0, opts.cy0, cw, ch, opts.centerX, opts.centerY, opts.allow);
	trimOneLayer(mask, floor, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY);
	closeDiagonalContacts(mask, opts.cx0, opts.cy0, cw, ch, opts.centerX, opts.centerY, opts.allow);
	return { mask, above, below };
}

// One axis, one cell. Refused when the step would enter the Dirichlet frame.
export function shiftToward(posX, posY, domain, gridW, gridH) {
	const centerX = (domain.cx0 + domain.cx1) / 2;
	const centerY = (domain.cy0 + domain.cy1) / 2;
	let dcx = 0, dcy = 0;
	if (posX - centerX > SHIFT_THRESHOLD) dcx = 1;
	else if (centerX - posX > SHIFT_THRESHOLD) dcx = -1;
	else if (posY - centerY > SHIFT_THRESHOLD) dcy = 1;
	else if (centerY - posY > SHIFT_THRESHOLD) dcy = -1;
	if (domain.cx0 + dcx < 1 || domain.cx1 + dcx > gridW - 1) dcx = 0;
	if (domain.cy0 + dcy < 1 || domain.cy1 + dcy > gridH - 1) dcy = 0;
	return { dcx, dcy };
}

// Child box in the parent's fine-cell coordinates. The parent is clamped to
// the lattice, so a boat past the wall maps outside it and fi±half can invert.
function nestedBox(parent, fi, fj, half) {
	if (!parent || !(parent.width >= 4) || !(parent.height >= 4)) return null;
	if (!Number.isFinite(fi) || !Number.isFinite(fj)) return null;
	const x0 = Math.max(1, Math.min(parent.width - 3, Math.round(fi - half)));
	const y0 = Math.max(1, Math.min(parent.height - 3, Math.round(fj - half)));
	const x1 = Math.max(x0 + 2, Math.min(parent.width - 1, Math.round(fi + half)));
	const y1 = Math.max(y0 + 2, Math.min(parent.height - 1, Math.round(fj + half)));
	if (!(x1 > x0 && y1 > y0 && x1 < parent.width && y1 < parent.height)) return null;
	return { x0, y0, x1, y1 };
}

function outside(domain, x, y) {
	return !domain || x < domain.cx0 || y < domain.cy0 || x >= domain.cx1 || y >= domain.cy1;
}

// Root lattice only. Covered coarse nodes still hold the restricted curl.
function sampleRootCurl(bm, domain) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	const norm = new Float64Array(cw * ch);
	const U = bm.speed;
	for (let ly = 0; ly < ch; ly++) {
		const cy = domain.cy0 + ly;
		for (let lx = 0; lx < cw; lx++) {
			const cx = domain.cx0 + lx;
			const cell = bm.cells[cx + cy * bm.width];
			norm[lx + ly * cw] = normalizedCurl(cell ? cell.curl : 0, U);
		}
	}
	return norm;
}

// Parent fluid curl at this child cell, normalized by the parent's Δx.
// The child cell index is the parent's fine-node index. Ghosts are not fluid.
// A parent cell with any 4-neighbor off the mask is rind: its curl is the
// interface, or a value left from before the cell was injected, and must not
// open the next level.
function sampleParentFluidCurl(parent, domain, speed) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	const norm = new Float64Array(cw * ch);
	const dx = parent.dx;
	const pw = parent.width;
	for (let ly = 0; ly < ch; ly++) {
		const cy = domain.cy0 + ly;
		for (let lx = 0; lx < cw; lx++) {
			const cx = domain.cx0 + lx;
			if (!parent._isFluid(cx, cy)) continue;
			const pcx = Math.floor(parent.cx0 + (cx - 1) * 0.5);
			const pcy = Math.floor(parent.cy0 + (cy - 1) * 0.5);
			if (!parent._maskAt(pcx, pcy)) continue;
			if (!parent._maskAt(pcx - 1, pcy) || !parent._maskAt(pcx + 1, pcy)) continue;
			if (!parent._maskAt(pcx, pcy - 1) || !parent._maskAt(pcx, pcy + 1)) continue;
			const cell = parent.cells[cx + cy * pw];
			norm[lx + ly * cw] = normalizedCurl(cell ? cell.curl : 0, speed, dx);
		}
	}
	return norm;
}

function installSensorMask(domain, centerX, centerY, radius, cap, curlNorm) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	if (!(cw * ch > 0)) return;
	const allow = (cx, cy) => domain._parentAllows(cx, cy);
	const floor = buildClosedDiskMask(
		domain.cx0, domain.cy0, domain.cx1, domain.cy1,
		centerX, centerY, radius, allow,
	);
	const stepped = stepCurlMask({
		floor,
		prev: domain.mask,
		curlNorm,
		above: domain._curlAbove,
		below: domain._curlBelow,
		cw, ch,
		cx0: domain.cx0,
		cy0: domain.cy0,
		centerX,
		centerY,
		allow,
		cap,
	});
	domain._curlAbove = stepped.above;
	domain._curlBelow = stepped.below;
	domain.setMask(stepped.mask, { cx: centerX, cy: centerY, radius });
}

// Place or slide the single child window. A parent slide already carried it
// (moveOrigin false), so this frame does not shift it again. Returns whether
// this call itself slid the child.
function placeChild(parent, parentShifted, fx, fy, half) {
	let shifted = false;
	if (parent.domains.length === 0 || outside(parent.domains[0], fx, fy)) {
		const box = nestedBox(parent, fx, fy, half);
		if (!box) return { domain: parent.domains[0] || null, shifted: false };
		parent.replaceDomain(0, box.x0, box.y0, box.x1, box.y1);
	} else if (!parentShifted) {
		const child = parent.domains[0];
		const step = shiftToward(fx, fy, child, parent.width, parent.height);
		if (step.dcx || step.dcy) {
			child.shiftBy(parent, step.dcx, step.dcy);
			parent._rebuildInteriorCells();
			shifted = true;
		}
	}
	return { domain: parent.domains[0] || null, shifted };
}

// Returns the level-1 domain for this boat, and whether that window slid.
function trackOne(bm, player) {
	const boatCx = bm.width / 2 + player.x * bm.resolution;
	const boatCy = bm.height / 2 + player.y * bm.resolution;

	let level1 = domainByBoat.get(player);
	let level1Shifted = false;
	if (outside(level1, boatCx, boatCy)) {
		const cx = Math.round(boatCx);
		const cy = Math.round(boatCy);
		const cx0 = Math.max(1, cx - DOMAIN_HALF);
		const cy0 = Math.max(1, cy - DOMAIN_HALF);
		const cx1 = Math.min(bm.width - 1, cx + DOMAIN_HALF);
		const cy1 = Math.min(bm.height - 1, cy + DOMAIN_HALF);
		if (!(cx1 > cx0 && cy1 > cy0)) return null;
		const idx = level1 ? bm.domains.indexOf(level1) : -1;
		const at = idx >= 0 ? idx : bm.domains.length;
		level1 = bm.replaceDomain(at, cx0, cy0, cx1, cy1);
		if (!level1) return null;
		domainByBoat.set(player, level1);
	} else {
		const step = shiftToward(boatCx, boatCy, level1, bm.width, bm.height);
		if (step.dcx || step.dcy) {
			level1.shiftBy(bm, step.dcx, step.dcy);
			level1Shifted = true;
		}
	}

	installSensorMask(level1, boatCx, boatCy, DISK_RADIUS, MASK_CELL_CAP, sampleRootCurl(bm, level1));

	const fx = 1 + (boatCx - level1.cx0) * 2;
	const fy = 1 + (boatCy - level1.cy0) * 2;
	const placed2 = placeChild(level1, level1Shifted, fx, fy, DOMAIN2_HALF);
	const level2 = placed2.domain;
	if (!level2) return { domain: level1, shifted: level1Shifted };
	installSensorMask(level2, fx, fy, DISK2_RADIUS, MASK2_CELL_CAP, sampleParentFluidCurl(level1, level2, bm.speed));

	const f2x = 1 + (fx - level2.cx0) * 2;
	const f2y = 1 + (fy - level2.cy0) * 2;
	const placed3 = placeChild(level2, level1Shifted || placed2.shifted, f2x, f2y, DOMAIN3_HALF);
	const level3 = placed3.domain;
	if (level3) {
		installSensorMask(level3, f2x, f2y, DISK3_RADIUS, MASK3_CELL_CAP, sampleParentFluidCurl(level2, level3, bm.speed));
	}
	return { domain: level1, shifted: level1Shifted };
}

// Install one level-1 window per finite boat, in player order. Later boats are
// later siblings, so a same-level overlap still lets the later boat write.
export function trackBoats(bm, players) {
	const live = [];
	let shifted = false;
	for (const player of players) {
		if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;
		const placed = trackOne(bm, player);
		if (!placed) continue;
		live.push(placed.domain);
		if (placed.shifted) shifted = true;
	}
	let same = live.length === bm.domains.length;
	for (let i = 0; same && i < live.length; i++) if (live[i] !== bm.domains[i]) same = false;
	if (!same || shifted) {
		bm.domains = live;
		bm._rebuildInteriorCells();
	}
}
