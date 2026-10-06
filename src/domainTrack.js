// One reusable window per boat. The boat object is the key, not its index in
// the player list: a skipped boat (NaN, or a window that will not fit) must
// not let the next boat's domain fall into an earlier slot.
//
// Each level's mask is a disk floor plus curl, and it also erodes. Curl that
// stays high away from the boat can seed its own island (SEED_MIN cells that
// have held), then that island grows and shrinks one layer per frame like the
// wake. A cluster outside every boat window opens a field window of its own.
// The mask inside that window is the curl contour (empty floor, same
// seed/grow/erode/hysteresis as a wake), so a barrier wave refines where it
// is, not as a circle glued to the obstacle. The window does not slide: moving
// the staircase through the shear was a separate failure, and Palabos does not
// move patches. Two windows on the same cells are refused — both would step,
// and the later one overwrites the restriction.
// The rectangle stays
// fixed: shiftBy refuses a size change. Level 1 reads root curl (Δx = 1).
// Level 2 reads level-1 fluid curl (Δx = 0.5), level 3 reads level-2 fluid
// curl (Δx = 0.25). Ghosts and the parent-mask rind are not sensors, so the
// staircase cannot refine itself forever. Dividing by that level's Δx keeps
// one τ meaningful on every grid.
//
// Sub-steps per root step (convective ratio 2): level 1 ×2, level 2 ×4,
// level 3 ×8. A masked parent cell is about four fine nodes. Caps bound the
// variable wake (the disk floors, ~200 cells, are the fixed cost):
//   MASK_CELL_CAP  400 root cells    → ≤ 400×4×2 =  3200 node-steps
//   MASK2_CELL_CAP 320 level-1 cells → ≤ 320×4×4 =  5120
//   MASK3_CELL_CAP 280 level-2 cells → ≤ 280×4×8 =  8960
// together ≤ ~17k node-steps plus the root lattice. A field island has no
// nested levels and no disk floor: at most FIELD_DOMAIN_MAX windows, each
// ≤ FIELD_CELL_CAP cells (≤ 160×4×2 = 1280 node-steps). Scenario 0's mean
// Boltzmann step stays under 12 ms at these caps.

import { buildClosedDiskMask, closeDiagonalContacts, fineIndex } from './boltzmann.js';

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
// 4-connected layer per frame. A detached island needs SEED_MIN held cells
// that do not already touch the mask; a smaller speckle cannot open one.
// The hysteresis band is the quiet margin around the
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
// A new island is born as this many 4-connected cells, after the same hold
// as a wake cell. One cell of curl cannot flicker a speckle into the mask.
export const SEED_MIN = 4;
// Disturbances outside the boat windows. The Barrier checkbox (off by
// default) puts a radius-6 obstacle at the lattice centre. Check Barrier and
// set wind speed to about 25: the waves refine as their own curl islands.
// Wind 30 and above can still destabilize the root lattice with no refinement
// at all. The window is FIELD_HALF on a side and does not follow the peak.
export const FIELD_HALF = 12;
export const FIELD_CELL_CAP = 160;
// Two islands. A window that would cover cells another field window already
// owns is refused. A cluster on the Dirichlet frame is refused too.
export const FIELD_DOMAIN_MAX = 2;

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

// Distance in cells to the nearest floor cell or cell still above τ_on.
// A hot island is its own anchor, so the cap trims a calm tail before it.
function anchorDistance(mask, floor, curlNorm, tauOn, cw, ch) {
	const n = cw * ch;
	const dist = new Int16Array(n);
	const q = [];
	for (let i = 0; i < n; i++) {
		const hot = curlNorm && curlNorm[i] > tauOn;
		if (floor[i] === 1 || hot) {
			dist[i] = 0;
			q.push(i);
		} else dist[i] = -1;
	}
	for (let qi = 0; qi < q.length; qi++) {
		const i = q[qi];
		const lx = i % cw;
		const ly = (i / cw) | 0;
		const step = dist[i] + 1;
		const nbrs = [];
		if (lx > 0) nbrs.push(i - 1);
		if (lx + 1 < cw) nbrs.push(i + 1);
		if (ly > 0) nbrs.push(i - cw);
		if (ly + 1 < ch) nbrs.push(i + cw);
		for (let k = 0; k < nbrs.length; k++) {
			const nb = nbrs[k];
			if (dist[nb] >= 0) continue;
			dist[nb] = step;
			q.push(nb);
		}
	}
	return dist;
}

// One boundary layer. Cells far from the disk and from any still-hot curl
// go first, so a detached island that is still disturbed survives the cap.
// The disk floor stays.
function trimOneLayer(mask, floor, cap, cw, ch, cx0, cy0, centerX, centerY, curlNorm, tauOn) {
	let count = countOnes(mask);
	if (count <= cap) return;
	const dist = anchorDistance(mask, floor, curlNorm, tauOn, cw, ch);
	const cand = [];
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + ly * cw;
			if (mask[i] !== 1 || floor[i] === 1) continue;
			if (!isBoundary(mask, i, lx, ly, cw, ch)) continue;
			cand.push({
				i,
				a: dist[i] < 0 ? 32767 : dist[i],
				d: dist2(lx, ly, cx0, cy0, centerX, centerY),
			});
		}
	}
	cand.sort((a, b) => b.a - a.a || b.d - a.d || b.i - a.i);
	for (let k = 0; k < cand.length && count > cap; k++) {
		mask[cand[k].i] = 0;
		count--;
	}
}

// Birth of one island: SEED_MIN connected cells that have held above τ_on and
// do not touch the mask yet. Adjacent growth already ran this frame, so this
// cannot add a second layer onto the boat. One island per frame.
function seedIslands(mask, above, hold, minCount, cap, cw, ch, allow, cx0, cy0) {
	const n = cw * ch;
	if (countOnes(mask) + minCount > cap) return;
	const cand = new Uint8Array(n);
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + ly * cw;
			if (mask[i] === 1 || above[i] < hold) continue;
			if (allow && !allow(cx0 + lx, cy0 + ly)) continue;
			if (hasOnEdge(mask, lx, ly, cw, ch)) continue;
			cand[i] = 1;
		}
	}
	const seen = new Uint8Array(n);
	const stack = [];
	let best = null;
	for (let i = 0; i < n; i++) {
		if (!cand[i] || seen[i]) continue;
		const comp = [];
		stack.push(i);
		seen[i] = 1;
		while (stack.length) {
			const k = stack.pop();
			comp.push(k);
			const lx = k % cw;
			const ly = (k / cw) | 0;
			if (lx > 0 && cand[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
			if (lx + 1 < cw && cand[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
			if (ly > 0 && cand[k - cw] && !seen[k - cw]) { seen[k - cw] = 1; stack.push(k - cw); }
			if (ly + 1 < ch && cand[k + cw] && !seen[k + cw]) { seen[k + cw] = 1; stack.push(k + cw); }
		}
		if (comp.length >= minCount && (!best || comp.length > best.length)) best = comp;
	}
	if (!best) return;
	let sx = 0, sy = 0;
	for (let k = 0; k < best.length; k++) {
		sx += best[k] % cw;
		sy += (best[k] / cw) | 0;
	}
	const mx = sx / best.length;
	const my = sy / best.length;
	const inComp = new Uint8Array(n);
	for (let k = 0; k < best.length; k++) inComp[best[k]] = 1;
	let start = best[0];
	let startD = Infinity;
	for (let k = 0; k < best.length; k++) {
		const i = best[k];
		const dx = (i % cw) - mx;
		const dy = ((i / cw) | 0) - my;
		const d = dx * dx + dy * dy;
		if (d < startD || (d === startD && i < start)) { startD = d; start = i; }
	}
	const q = [start];
	const used = new Uint8Array(n);
	used[start] = 1;
	const seed = [];
	for (let qi = 0; qi < q.length && seed.length < minCount; qi++) {
		const k = q[qi];
		seed.push(k);
		const lx = k % cw;
		const ly = (k / cw) | 0;
		const nbrs = [];
		if (lx > 0) nbrs.push(k - 1);
		if (lx + 1 < cw) nbrs.push(k + 1);
		if (ly > 0) nbrs.push(k - cw);
		if (ly + 1 < ch) nbrs.push(k + cw);
		for (let b = 0; b < nbrs.length; b++) {
			const nb = nbrs[b];
			if (!inComp[nb] || used[nb]) continue;
			used[nb] = 1;
			q.push(nb);
		}
	}
	for (let k = 0; k < seed.length; k++) mask[seed[k]] = 1;
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
	seedIslands(mask, above, hold, opts.seedMin ?? SEED_MIN, cap, cw, ch, opts.allow, opts.cx0, opts.cy0);
	erodeOneLayer(mask, floor, below, hold, cw, ch);
	trimOneLayer(mask, floor, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY, opts.curlNorm, tauOn);
	closeDiagonalContacts(mask, opts.cx0, opts.cy0, cw, ch, opts.centerX, opts.centerY, opts.allow);
	trimOneLayer(mask, floor, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY, opts.curlNorm, tauOn);
	closeDiagonalContacts(mask, opts.cx0, opts.cy0, cw, ch, opts.centerX, opts.centerY, opts.allow);
	// A boat disk plus a curl island can pinch a calm cell shut. Fill that
	// pocket, then shed the same number of boundary cells so the cap holds.
	// A field island has an empty floor: its contour is the wake itself, and
	// filling the lee rearranges the cap until the wind-25 street diverges.
	let hasFloor = false;
	for (let i = 0; i < n; i++) if (floor[i] === 1) { hasFloor = true; break; }
	if (hasFloor) {
		fillEnclosed(mask, cw, ch, opts.allow, opts.cx0, opts.cy0);
		trimOneLayer(mask, floor, cap, cw, ch, opts.cx0, opts.cy0, opts.centerX, opts.centerY, opts.curlNorm, tauOn);
	}
	return { mask, above, below };
}

// Off cells that cannot reach the window edge are a hole. Turn them on.
// A cell the parent mask does not cover stays off.
function fillEnclosed(mask, cw, ch, allow, cx0, cy0) {
	const n = cw * ch;
	const seen = new Uint8Array(n);
	const stack = [];
	const push = (i) => {
		if (i < 0 || i >= n || seen[i] || mask[i] === 1) return;
		seen[i] = 1;
		stack.push(i);
	};
	for (let x = 0; x < cw; x++) { push(x); push(x + (ch - 1) * cw); }
	for (let y = 0; y < ch; y++) { push(y * cw); push(cw - 1 + y * cw); }
	while (stack.length) {
		const i = stack.pop();
		const lx = i % cw;
		const ly = (i / cw) | 0;
		if (lx > 0) push(i - 1);
		if (lx + 1 < cw) push(i + 1);
		if (ly > 0) push(i - cw);
		if (ly + 1 < ch) push(i + cw);
	}
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const i = lx + ly * cw;
			if (mask[i] === 1 || seen[i]) continue;
			if (allow && !allow(cx0 + lx, cy0 + ly)) continue;
			mask[i] = 1;
		}
	}
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
			const pcx = Math.floor(parent.coarseX(cx));
			const pcy = Math.floor(parent.coarseY(cy));
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

	const fx = fineIndex(level1.cx0, boatCx);
	const fy = fineIndex(level1.cy0, boatCy);
	const placed2 = placeChild(level1, level1Shifted, fx, fy, DOMAIN2_HALF);
	const level2 = placed2.domain;
	if (!level2) return { domain: level1, shifted: level1Shifted };
	installSensorMask(level2, fx, fy, DISK2_RADIUS, MASK2_CELL_CAP, sampleParentFluidCurl(level1, level2, bm.speed));

	const f2x = fineIndex(level2.cx0, fx);
	const f2y = fineIndex(level2.cy0, fy);
	const placed3 = placeChild(level2, level1Shifted || placed2.shifted, f2x, f2y, DOMAIN3_HALF);
	const level3 = placed3.domain;
	if (level3) {
		installSensorMask(level3, f2x, f2y, DISK3_RADIUS, MASK3_CELL_CAP, sampleParentFluidCurl(level2, level3, bm.speed));
	}
	return { domain: level1, shifted: level1Shifted };
}

// Per lattice. Tests build many Boltzmann instances; a module-level list would
// slide one sim's island across the next.
const fieldState = new WeakMap();

function stateOf(bm) {
	const n = bm.width * bm.height;
	let state = fieldState.get(bm);
	if (!state || state.above.length !== n) {
		state = { above: new Uint8Array(n), below: new Uint8Array(n), domains: [] };
		fieldState.set(bm, state);
	}
	return state;
}

function inRect(domain, x, y) {
	return x >= domain.cx0 && x < domain.cx1 && y >= domain.cy0 && y < domain.cy1;
}

function coveredBy(domains, x, y) {
	for (let i = 0; i < domains.length; i++) if (inRect(domains[i], x, y)) return true;
	return false;
}

// Holds for root cells that no window owns yet. Cells inside a window are
// cleared so a window sliding off them does not reopen from a stale count.
function updateFieldHolds(bm, boats) {
	const state = stateOf(bm);
	const fieldAbove = state.above;
	const fieldBelow = state.below;
	const fieldDomains = state.domains;
	const U = bm.speed;
	for (let y = 0; y < bm.height; y++) {
		for (let x = 0; x < bm.width; x++) {
			const i = x + y * bm.width;
			if (coveredBy(boats, x, y) || coveredBy(fieldDomains, x, y)) {
				fieldAbove[i] = 0;
				fieldBelow[i] = 0;
				continue;
			}
			const cell = bm.cells[i];
			const norm = normalizedCurl(cell ? cell.curl : 0, U);
			if (norm > CURL_TAU_ON) {
				if (fieldAbove[i] < CURL_HOLD) fieldAbove[i]++;
				fieldBelow[i] = 0;
			} else if (norm < CURL_TAU_OFF) {
				if (fieldBelow[i] < CURL_HOLD) fieldBelow[i]++;
				fieldAbove[i] = 0;
			} else {
				fieldAbove[i] = 0;
				fieldBelow[i] = 0;
			}
		}
	}
}

function largestHeldCluster(bm, boats) {
	const state = stateOf(bm);
	const fieldAbove = state.above;
	const fieldDomains = state.domains;
	const w = bm.width;
	const h = bm.height;
	const seen = new Uint8Array(w * h);
	const stack = [];
	let best = null;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = x + y * w;
			if (seen[i] || fieldAbove[i] < CURL_HOLD) continue;
			if (coveredBy(boats, x, y) || coveredBy(fieldDomains, x, y)) continue;
			const comp = [];
			stack.push(i);
			seen[i] = 1;
			while (stack.length) {
				const k = stack.pop();
				comp.push(k);
				const cx = k % w;
				const cy = (k / w) | 0;
				const nbrs = [];
				if (cx > 1) nbrs.push(k - 1);
				if (cx + 2 < w) nbrs.push(k + 1);
				if (cy > 1) nbrs.push(k - w);
				if (cy + 2 < h) nbrs.push(k + w);
				for (let b = 0; b < nbrs.length; b++) {
					const nb = nbrs[b];
					if (seen[nb] || fieldAbove[nb] < CURL_HOLD) continue;
					const nx = nb % w;
					const ny = (nb / w) | 0;
					if (coveredBy(boats, nx, ny) || coveredBy(fieldDomains, nx, ny)) continue;
					seen[nb] = 1;
					stack.push(nb);
				}
			}
			if (comp.length >= SEED_MIN && (!best || comp.length > best.length)) best = comp;
		}
	}
	return best;
}

function clusterCentroid(bm, cluster) {
	const w = bm.width;
	let sx = 0, sy = 0;
	for (let k = 0; k < cluster.length; k++) {
		sx += cluster[k] % w;
		sy += (cluster[k] / w) | 0;
	}
	return { x: sx / cluster.length, y: sy / cluster.length };
}

function clusterInterior(bm, cluster) {
	const c = clusterCentroid(bm, cluster);
	const m = FIELD_HALF + 1;
	return c.x >= m && c.y >= m && c.x < bm.width - m && c.y < bm.height - m;
}

function fieldBox(bm, x, y) {
	const cx = Math.round(x);
	const cy = Math.round(y);
	const cx0 = Math.max(1, cx - FIELD_HALF);
	const cy0 = Math.max(1, cy - FIELD_HALF);
	const cx1 = Math.min(bm.width - 1, cx + FIELD_HALF);
	const cy1 = Math.min(bm.height - 1, cy + FIELD_HALF);
	if (!(cx1 > cx0 && cy1 > cy0)) return null;
	return { cx0, cy0, cx1, cy1 };
}

function boxesOverlap(a, b) {
	return a.cx0 < b.cx1 && b.cx0 < a.cx1 && a.cy0 < b.cy1 && b.cy0 < a.cy1;
}

function openFieldWindow(bm, center) {
	const box = fieldBox(bm, center.x, center.y);
	if (!box) return null;
	const { cx0, cy0, cx1, cy1 } = box;
	const domain = bm.replaceDomain(bm.domains.length, cx0, cy0, cx1, cy1);
	if (!domain) return null;
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	const state = stateOf(bm);
	const above = new Uint8Array(cw * ch);
	const below = new Uint8Array(cw * ch);
	const w = bm.width;
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			const src = (domain.cx0 + lx) + (domain.cy0 + ly) * w;
			above[lx + ly * cw] = state.above[src];
			below[lx + ly * cw] = state.below[src];
		}
	}
	domain._curlAbove = above;
	domain._curlBelow = below;
	return domain;
}

// Curl centroid of the island, used only as the growth anchor inside the
// window. The window itself stays where it was opened.
function fieldCentroid(bm, domain) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	let sx = 0, sy = 0, n = 0;
	const U = bm.speed;
	for (let ly = 0; ly < ch; ly++) {
		const cy = domain.cy0 + ly;
		for (let lx = 0; lx < cw; lx++) {
			const cx = domain.cx0 + lx;
			const cell = bm.cells[cx + cy * bm.width];
			const norm = normalizedCurl(cell ? cell.curl : 0, U);
			const on = domain.mask && domain.mask[lx + ly * cw] === 1;
			if (norm <= CURL_TAU_ON && !on) continue;
			sx += cx + 0.5;
			sy += cy + 0.5;
			n++;
		}
	}
	if (!n) return { x: (domain.cx0 + domain.cx1) / 2, y: (domain.cy0 + domain.cy1) / 2 };
	return { x: sx / n, y: sy / n };
}

function installFieldMask(bm, domain, boats) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	if (!(cw * ch > 0)) return false;
	const floor = new Uint8Array(cw * ch);
	const allow = (cx, cy) => {
		for (let i = 0; i < boats.length; i++) if (boats[i]._maskAt(cx, cy)) return false;
		return true;
	};
	const center = fieldCentroid(bm, domain);
	const stepped = stepCurlMask({
		floor,
		prev: domain.mask,
		curlNorm: sampleRootCurl(bm, domain),
		above: domain._curlAbove,
		below: domain._curlBelow,
		cw, ch,
		cx0: domain.cx0,
		cy0: domain.cy0,
		centerX: center.x,
		centerY: center.y,
		allow,
		cap: FIELD_CELL_CAP,
	});
	domain._curlAbove = stepped.above;
	domain._curlBelow = stepped.below;
	domain.setMask(stepped.mask, null);
	return countOnes(stepped.mask) > 0;
}

// Windows for curl that never touches a boat. At most one new window a frame,
// and FIELD_DOMAIN_MAX in total. An empty mask is the island coarsening away.
// The window does not slide. A second window that would cover the same cells
// is refused: both would step, and that pair diverges even after it stops moving.
function trackFieldDomains(bm, boats) {
	const fieldDomains = stateOf(bm).domains;
	updateFieldHolds(bm, boats);
	let shifted = false;
	for (let i = fieldDomains.length - 1; i >= 0; i--) {
		const domain = fieldDomains[i];
		if (!installFieldMask(bm, domain, boats)) {
			fieldDomains.splice(i, 1);
			shifted = true;
		}
	}
	if (fieldDomains.length < FIELD_DOMAIN_MAX) {
		const cluster = largestHeldCluster(bm, boats);
		// A patch planted on the Dirichlet frame puts the interface on the
		// boundary condition. The outlet pile-up is that case.
		if (cluster && clusterInterior(bm, cluster)) {
			const center = clusterCentroid(bm, cluster);
			const box = fieldBox(bm, center.x, center.y);
			let overlap = !box;
			for (let i = 0; box && i < fieldDomains.length; i++) {
				if (boxesOverlap(box, fieldDomains[i])) overlap = true;
			}
			if (!overlap) {
				const domain = openFieldWindow(bm, center);
				if (domain) {
					if (installFieldMask(bm, domain, boats)) fieldDomains.push(domain);
					else {
						const idx = bm.domains.indexOf(domain);
						if (idx >= 0) bm.domains.splice(idx, 1);
					}
					shifted = true;
				}
			}
		}
	}
	return shifted;
}

// Install one level-1 window per finite boat, in player order. Later boats are
// later siblings, so a same-level overlap still lets the later boat write.
// Field islands follow the boats and do not own a disk floor.
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
	if (trackFieldDomains(bm, live)) shifted = true;
	const next = live.concat(stateOf(bm).domains);
	let same = next.length === bm.domains.length;
	for (let i = 0; same && i < next.length; i++) if (next[i] !== bm.domains[i]) same = false;
	if (!same || shifted) {
		bm.domains = next;
		bm._rebuildInteriorCells();
	}
}
