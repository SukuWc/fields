// One reusable window per boat. The boat object is the key, not its index in
// the player list: a skipped boat (NaN, or a window that will not fit) must
// not let the next boat's domain fall into an earlier slot.

export const DOMAIN_HALF = 20;
export const DOMAIN2_HALF = 20;
export const SHIFT_THRESHOLD = 1;
export const DISK_RADIUS = 16;  // coarse cells
export const DISK2_RADIUS = 16; // level-1 fine cells (8 coarse)

const domainByBoat = new WeakMap();

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

// Level-2 box in the parent's fine-cell coordinates. The parent is clamped to
// the lattice, so a boat past the wall maps outside it and fi±HALF can invert.
function level2Box(parent, fi, fj) {
	if (!parent || !(parent.width >= 4) || !(parent.height >= 4)) return null;
	if (!Number.isFinite(fi) || !Number.isFinite(fj)) return null;
	const x0 = Math.max(1, Math.min(parent.width - 3, Math.round(fi - DOMAIN2_HALF)));
	const y0 = Math.max(1, Math.min(parent.height - 3, Math.round(fj - DOMAIN2_HALF)));
	const x1 = Math.max(x0 + 2, Math.min(parent.width - 1, Math.round(fi + DOMAIN2_HALF)));
	const y1 = Math.max(y0 + 2, Math.min(parent.height - 1, Math.round(fj + DOMAIN2_HALF)));
	if (!(x1 > x0 && y1 > y0 && x1 < parent.width && y1 < parent.height)) return null;
	return { x0, y0, x1, y1 };
}

function outside(domain, x, y) {
	return !domain || x < domain.cx0 || y < domain.cy0 || x >= domain.cx1 || y >= domain.cy1;
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

	level1.setDisk(boatCx, boatCy, DISK_RADIUS);

	const fx = 1 + (boatCx - level1.cx0) * 2;
	const fy = 1 + (boatCy - level1.cy0) * 2;
	if (level1.domains.length === 0 || outside(level1.domains[0], fx, fy)) {
		const box = level2Box(level1, fx, fy);
		if (!box) return { domain: level1, shifted: level1Shifted };
		level1.replaceDomain(0, box.x0, box.y0, box.x1, box.y1);
	} else if (!level1Shifted) {
		const d2 = level1.domains[0];
		const step2 = shiftToward(fx, fy, d2, level1.width, level1.height);
		if (step2.dcx || step2.dcy) {
			d2.shiftBy(level1, step2.dcx, step2.dcy);
			level1._rebuildInteriorCells();
		}
	}
	if (level1.domains[0]) level1.domains[0].setDisk(fx, fy, DISK2_RADIUS);
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
