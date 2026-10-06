// Disk floor + root-curl expansion (C) and one-layer erosion (F).
globalThis.document = {
	getElementById: () => ({
		value: '0', selectedIndex: 3, checked: true, innerHTML: '', textContent: '', style: {},
		addEventListener() {}, appendChild() {},
	}),
	getElementsByTagName: () => [],
	createElement: () => ({ addEventListener() {}, appendChild() {}, style: {} }),
	body: { appendChild() {} },
	currentScript: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = globalThis.addEventListener || (() => {});

const { Boltzmann, buildClosedDiskMask, fineIndex } = await import('../src/boltzmann.js');
const {
	trackBoats, stepCurlMask, normalizedCurl,
	DISK_RADIUS, DISK2_RADIUS, DISK3_RADIUS, DOMAIN_HALF, DOMAIN2_HALF, DOMAIN3_HALF,
	CURL_HOLD, CURL_TAU_ON, CURL_TAU_OFF, MASK_CELL_CAP, MASK2_CELL_CAP, MASK3_CELL_CAP,
	SEED_MIN, FIELD_CELL_CAP, FIELD_DOMAIN_MAX,
} = await import('../src/domainTrack.js');

let failed = 0;
function check(name, cond, detail) {
	const ok = !!cond;
	if (!ok) failed++;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
	return ok;
}

const CW = 12;
const CH = 12;
const HOLD = 4;
const TAU_ON = 0.08;
const TAU_OFF = 0.04;

function idx(x, y) { return x + y * CW; }

function blockFloor() {
	const floor = new Uint8Array(CW * CH);
	for (let y = 4; y <= 6; y++) {
		for (let x = 4; x <= 6; x++) floor[idx(x, y)] = 1;
	}
	return floor;
}

function zeros() { return new Float64Array(CW * CH); }

function stepper(floor, cap = MASK_CELL_CAP) {
	const state = { mask: null, above: new Uint8Array(CW * CH), below: new Uint8Array(CW * CH) };
	return {
		state,
		step(curlNorm) {
			const stepped = stepCurlMask({
				floor, prev: state.mask, curlNorm,
				above: state.above, below: state.below,
				cw: CW, ch: CH, cx0: 0, cy0: 0, centerX: 5.5, centerY: 5.5,
				tauOn: TAU_ON, tauOff: TAU_OFF, hold: HOLD, cap,
			});
			state.mask = stepped.mask;
			state.above = stepped.above;
			state.below = stepped.below;
			return stepped.mask;
		},
	};
}

function count(mask) {
	let n = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i] === 1) n++;
	return n;
}

function floorHeld(mask, floor) {
	for (let i = 0; i < floor.length; i++) if (floor[i] === 1 && mask[i] !== 1) return false;
	return true;
}

function diagonalContact(mask) {
	for (let y = 0; y < CH - 1; y++) {
		for (let x = 0; x < CW - 1; x++) {
			const a = mask[idx(x, y)], b = mask[idx(x + 1, y)];
			const c = mask[idx(x, y + 1)], d = mask[idx(x + 1, y + 1)];
			if ((a && d && !b && !c) || (b && c && !a && !d)) return true;
		}
	}
	return false;
}

check('normalized curl divides by 2 Δx U', Math.abs(normalizedCurl(0.06, 0.15) - 0.2) < 1e-12
	&& Math.abs(normalizedCurl(0.03, 0.15, 0.5) - 0.2) < 1e-12
	&& Math.abs(normalizedCurl(0.015, 0.15, 0.25) - 0.2) < 1e-12
	&& normalizedCurl(0, 0.15) === 0 && normalizedCurl(1, 0) === 0 && normalizedCurl(NaN, 0.15) === 0
	&& normalizedCurl(1, 0.15, 0) === 0);
check('thresholds satisfy τ_on > τ_off and a few frames of hold',
	CURL_TAU_ON > CURL_TAU_OFF && CURL_TAU_OFF > 0 && CURL_HOLD >= 4 && CURL_HOLD <= 8 && MASK_CELL_CAP === 400
	&& MASK2_CELL_CAP > 200 && MASK2_CELL_CAP < DOMAIN2_HALF * DOMAIN2_HALF
	&& MASK3_CELL_CAP > 200 && MASK3_CELL_CAP < MASK2_CELL_CAP && MASK3_CELL_CAP < DOMAIN3_HALF * DOMAIN3_HALF * 4,
	`τ_on=${CURL_TAU_ON} τ_off=${CURL_TAU_OFF} hold=${CURL_HOLD} caps=${MASK_CELL_CAP}/${MASK2_CELL_CAP}/${MASK3_CELL_CAP}`);

// Calm water: the mask is the floor, and the floor never leaves.
{
	const floor = blockFloor();
	const run = stepper(floor);
	let ok = true;
	for (let i = 0; i < 8; i++) {
		const mask = run.step(zeros());
		if (!floorHeld(mask, floor) || count(mask) !== count(floor) || diagonalContact(mask)) ok = false;
	}
	check('disk floor stays on with no curl and does not grow', ok);
}

// Strictly above τ_on for HOLD frames, one edge at a time. A detached cell stays off.
{
	const floor = blockFloor();
	const run = stepper(floor);
	const curl = zeros();
	curl[idx(7, 5)] = 0.2;
	curl[idx(8, 5)] = 0.2;
	curl[idx(10, 5)] = 0.5;
	let early = false;
	for (let i = 0; i < HOLD - 1; i++) if (run.step(curl)[idx(7, 5)] === 1) early = true;
	const atHold = run.step(curl);
	const next = run.step(curl);
	check('curl below the hold does not expand', !early && floorHeld(atHold, floor));
	check('one adjacent layer joins on the hold frame', atHold[idx(7, 5)] === 1 && atHold[idx(8, 5)] !== 1
		&& atHold[idx(10, 5)] !== 1, `second=${atHold[idx(8, 5)]} island=${atHold[idx(10, 5)]}`);
	check('the next cell waits until the following frame', next[idx(8, 5)] === 1 && next[idx(10, 5)] !== 1
		&& floorHeld(next, floor) && !diagonalContact(next));
}

// A cluster that never touches the disk becomes its own island after the hold.
// Three cells are not enough. Once quiet, the island peels away and the floor stays.
{
	const floor = blockFloor();
	const tooSmall = stepper(floor);
	const speckle = zeros();
	speckle[idx(0, 0)] = 0.2;
	speckle[idx(1, 0)] = 0.2;
	speckle[idx(0, 1)] = 0.2;
	let speckleOn = false;
	for (let i = 0; i < HOLD + 2; i++) {
		const mask = tooSmall.step(speckle);
		if (mask[idx(0, 0)] === 1 || mask[idx(1, 0)] === 1 || mask[idx(0, 1)] === 1) speckleOn = true;
	}
	const run = stepper(floor);
	const curl = zeros();
	for (let y = 0; y <= 1; y++) for (let x = 0; x <= 1; x++) curl[idx(x, y)] = 0.2;
	let early = false;
	for (let i = 0; i < HOLD - 1; i++) if (run.step(curl)[idx(0, 0)] === 1) early = true;
	const born = run.step(curl);
	let extra = 0;
	let bridge = false;
	for (let y = 0; y < CH; y++) {
		for (let x = 0; x < CW; x++) {
			if (born[idx(x, y)] !== 1 || floor[idx(x, y)] === 1) continue;
			extra++;
			if ((x > 0 && floor[idx(x - 1, y)] === 1) || (x + 1 < CW && floor[idx(x + 1, y)] === 1)
				|| (y > 0 && floor[idx(x, y - 1)] === 1) || (y + 1 < CH && floor[idx(x, y + 1)] === 1)) bridge = true;
		}
	}
	check('a held cluster seeds an island that does not touch the disk',
		!speckleOn && !early && extra === SEED_MIN && born[idx(0, 0)] === 1 && born[idx(1, 1)] === 1
		&& !bridge && floorHeld(born, floor) && SEED_MIN === 4,
		`extra=${extra} early=${early} speckle=${speckleOn}`);
	for (let i = 0; i < curl.length; i++) curl[i] = 0;
	let wiped = false;
	for (let i = 0; i < HOLD - 1; i++) if (run.step(curl)[idx(0, 0)] !== 1) wiped = true;
	const gone = run.step(curl);
	check('a quiet island coarsens away and the disk floor stays',
		!wiped && gone[idx(0, 0)] !== 1 && gone[idx(1, 1)] !== 1 && floorHeld(gone, floor)
		&& count(gone) === count(floor));
}

// Exactly τ_on is not enough (the test is strict), and the band does not arm a cell.
{
	const floor = blockFloor();
	const run = stepper(floor);
	const curl = zeros();
	curl[idx(7, 5)] = TAU_ON;
	let on = false;
	for (let i = 0; i < HOLD + 2; i++) if (run.step(curl)[idx(7, 5)] === 1) on = true;
	curl[idx(7, 5)] = (TAU_ON + TAU_OFF) / 2;
	for (let i = 0; i < 6; i++) if (run.step(curl)[idx(7, 5)] === 1) on = true;
	check('τ_on and the hysteresis band do not grow the mask', !on && run.state.above[idx(7, 5)] === 0);
}

// Once on, the band keeps the cell; falling below τ_off erodes it after the hold, not before.
{
	const floor = blockFloor();
	const run = stepper(floor);
	const curl = zeros();
	curl[idx(7, 5)] = 0.2;
	for (let i = 0; i < HOLD; i++) run.step(curl);
	curl[idx(7, 5)] = (TAU_ON + TAU_OFF) / 2;
	let dropped = false;
	for (let i = 0; i < 8; i++) if (run.step(curl)[idx(7, 5)] !== 1) dropped = true;
	curl[idx(7, 5)] = 0;
	let early = false;
	for (let i = 0; i < HOLD - 1; i++) if (run.step(curl)[idx(7, 5)] !== 1) early = true;
	const gone = run.step(curl);
	check('band holds a wake cell and τ_off erodes it after the hold',
		!dropped && !early && gone[idx(7, 5)] !== 1 && floorHeld(gone, floor) && !diagonalContact(gone));
}

// Interior of a blob is not a hole. Only the boundary peels, one layer.
{
	const floor = blockFloor();
	const prev = new Uint8Array(floor);
	for (let y = 4; y <= 6; y++) for (let x = 7; x <= 9; x++) prev[idx(x, y)] = 1;
	const run = stepper(floor);
	run.state.mask = prev;
	let mask = null;
	for (let i = 0; i < HOLD - 1; i++) mask = run.step(zeros());
	check('erosion waits out the hold', mask[idx(9, 5)] === 1 && mask[idx(8, 5)] === 1 && floorHeld(mask, floor));
	mask = run.step(zeros());
	check('one layer peels the boundary and leaves the interior',
		mask[idx(9, 5)] !== 1 && mask[idx(8, 5)] === 1 && mask[idx(7, 5)] === 1 && floorHeld(mask, floor)
		&& !diagonalContact(mask));
}

// Cap drops the tail, not the floor. A tiny cap does not eat the hull.
{
	const floor = blockFloor();
	const prev = new Uint8Array(floor);
	prev[idx(7, 5)] = 1;
	prev[idx(8, 5)] = 1;
	prev[idx(9, 5)] = 1;
	const snap = new Uint8Array(prev);
	const curl = zeros();
	for (let i = 0; i < curl.length; i++) curl[i] = 1;
	const trimmed = stepCurlMask({
		floor, prev, curlNorm: curl,
		above: new Uint8Array(CW * CH), below: new Uint8Array(CW * CH),
		cw: CW, ch: CH, cx0: 0, cy0: 0, centerX: 5.5, centerY: 5.5,
		tauOn: TAU_ON, tauOff: TAU_OFF, hold: HOLD, cap: count(floor),
	});
	let prevIntact = true;
	for (let i = 0; i < prev.length; i++) if (prev[i] !== snap[i]) prevIntact = false;
	const tiny = stepper(floor, 1);
	let hull = true;
	for (let i = 0; i < 4; i++) if (!floorHeld(tiny.step(zeros()), floor)) hull = false;
	check('cap trims the tail and keeps the floor',
		trimmed.mask[idx(9, 5)] !== 1 && trimmed.mask[idx(7, 5)] !== 1 && floorHeld(trimmed.mask, floor)
		&& count(trimmed.mask) === count(floor) && prevIntact && hull);
}

// Closer-to-boat tie break fills a diagonal contact.
{
	const floor = new Uint8Array(CW * CH);
	floor[idx(5, 5)] = 1;
	const prev = new Uint8Array(floor);
	prev[idx(6, 6)] = 1;
	const mask = stepCurlMask({
		floor, prev, curlNorm: zeros(),
		above: new Uint8Array(CW * CH), below: new Uint8Array(CW * CH),
		cw: CW, ch: CH, cx0: 0, cy0: 0, centerX: 5.5, centerY: 5.5,
		tauOn: TAU_ON, tauOff: TAU_OFF, hold: HOLD,
	}).mask;
	check('diagonal-only contact is closed toward the boat',
		mask[idx(5, 5)] === 1 && mask[idx(6, 6)] === 1 && mask[idx(6, 5)] === 1 && !diagonalContact(mask));
}

// Closest candidate wins when the cap has room for one cell.
{
	const floor = new Uint8Array(CW * CH);
	floor[idx(5, 5)] = 1;
	const curl = zeros();
	curl[idx(5, 4)] = 1;
	curl[idx(6, 5)] = 1;
	curl[idx(4, 5)] = 1;
	curl[idx(5, 6)] = 1;
	const mask = stepCurlMask({
		floor, prev: null, curlNorm: curl,
		above: new Uint8Array(CW * CH), below: new Uint8Array(CW * CH),
		cw: CW, ch: CH, cx0: 0, cy0: 0, centerX: 5.5, centerY: 5.5,
		tauOn: TAU_ON, tauOff: TAU_OFF, hold: 1, cap: 2,
	}).mask;
	check('cap keeps the closest wake cell', mask[idx(5, 4)] === 1 && mask[idx(6, 5)] !== 1
		&& count(mask) === 2 && floorHeld(mask, floor));
}

function make(w, h, speed) {
	return new Boltzmann(w, h, 1, 90, speed, undefined, 1);
}

function countMask(domain) {
	let n = 0;
	for (let i = 0; i < domain.mask.length; i++) if (domain.mask[i] === 1) n++;
	return n;
}

function eastTarget(domain) {
	const cw = domain.cx1 - domain.cx0;
	const ch = domain.cy1 - domain.cy0;
	let best = null;
	let bestDy = Infinity;
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw - 1; lx++) {
			const i = lx + ly * cw;
			if (domain.mask[i] !== 1 || domain.mask[i + 1] === 1) continue;
			const dy = Math.abs(domain.cy0 + ly + 0.5 - domain.disk.cy);
			if (dy < bestDy) {
				bestDy = dy;
				best = { cx: domain.cx0 + lx + 1, cy: domain.cy0 + ly };
			}
		}
	}
	return best;
}

function touches(domain, cx, cy) {
	return domain._maskAt(cx - 1, cy) || domain._maskAt(cx + 1, cy)
		|| domain._maskAt(cx, cy - 1) || domain._maskAt(cx, cy + 1);
}

function maskEqualsFloor(domain, radius) {
	const floor = buildClosedDiskMask(
		domain.cx0, domain.cy0, domain.cx1, domain.cy1,
		domain.disk.cx, domain.disk.cy, radius,
		(cx, cy) => domain._parentAllows(cx, cy),
	);
	if (floor.length !== domain.mask.length) return false;
	for (let i = 0; i < floor.length; i++) if (floor[i] !== domain.mask[i]) return false;
	return true;
}

function share(a, b) {
	const cw = a.cx1 - a.cx0;
	for (let ly = 0; ly < a.cy1 - a.cy0; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			if (a.mask[lx + ly * cw] !== 1) continue;
			if (b._maskAt(a.cx0 + lx, a.cy0 + ly)) return true;
		}
	}
	return false;
}

// A parent node may seed the child only when it is fluid and its cell is
// strictly inside the parent mask (every 4-neighbor on).
function sensorNode(parent, fi, fj) {
	if (!parent._isFluid(fi, fj)) return false;
	const pcx = Math.floor(parent.coarseX(fi));
	const pcy = Math.floor(parent.coarseY(fj));
	return parent._maskAt(pcx, pcy)
		&& parent._maskAt(pcx - 1, pcy) && parent._maskAt(pcx + 1, pcy)
		&& parent._maskAt(pcx, pcy - 1) && parent._maskAt(pcx, pcy + 1);
}

function paintNonSensor(parent, value) {
	for (let fj = 0; fj < parent.height; fj++) {
		for (let fi = 0; fi < parent.width; fi++) {
			if (sensorNode(parent, fi, fj)) continue;
			parent.cells[fi + fj * parent.width].curl = value;
		}
	}
}

// Lattice wiring: root curl only on level 1, parent fluid curl on the children.
{
	const bm = make(75, 75, 15);
	const boat = { x: 0, y: 0 };
	trackBoats(bm, [boat]);
	const d = bm.domains[0];
	const w0 = d.cx1 - d.cx0;
	const h0 = d.cy1 - d.cy0;
	const l2 = d.domains[0];
	const l3 = l2 && l2.domains[0];
	check('calm trackBoats installs the disk floor', maskEqualsFloor(d, DISK_RADIUS)
		&& w0 === DOMAIN_HALF * 2 && h0 === DOMAIN_HALF * 2 && !d.hasDiagonalOnlyContact());
	check('calm water keeps level 2 and level 3 on their disk floors',
		!!l3 && d.domains.length === 1 && l2.domains.length === 1
		&& maskEqualsFloor(l2, DISK2_RADIUS) && maskEqualsFloor(l3, DISK3_RADIUS)
		&& l2.cx1 - l2.cx0 === DOMAIN2_HALF * 2 && l3.cx1 - l3.cx0 === DOMAIN3_HALF * 2);

	const floorN = countMask(d);
	const floor2 = countMask(l2);
	const floor3 = countMask(l3);
	paintNonSensor(d, 20);
	paintNonSensor(l2, 20);
	for (const c of l3.cells) c.curl = 20;
	for (let i = 0; i < CURL_HOLD + 4; i++) trackBoats(bm, [boat]);
	check('ghost and rind curl do not expand any level',
		countMask(d) === floorN && maskEqualsFloor(d, DISK_RADIUS)
		&& countMask(l2) === floor2 && maskEqualsFloor(l2, DISK2_RADIUS)
		&& countMask(l3) === floor3 && maskEqualsFloor(l3, DISK3_RADIUS));
	for (const c of d.cells) c.curl = 0;
	for (const c of l2.cells) c.curl = 0;
	for (const c of l3.cells) c.curl = 0;

	const target = eastTarget(d);
	const beyond = { cx: target.cx + 1, cy: target.cy };
	const beyondDetached = !touches(d, beyond.cx, beyond.cy);
	const root = (cx, cy) => bm.cells[cx + cy * bm.width];
	root(target.cx, target.cy).curl = 1;
	root(beyond.cx, beyond.cy).curl = 1;
	for (let i = 0; i < CURL_HOLD - 1; i++) trackBoats(bm, [boat]);
	const waited = !d._maskAt(target.cx, target.cy);
	root(target.cx, target.cy).setEquil(0, 0, 1.03);
	root(target.cx, target.cy).curl = 1;
	trackBoats(bm, [boat]);
	const fi = fineIndex(d.cx0, target.cx);
	const fj = fineIndex(d.cy0, target.cy);
	const fine = d.cells[fi + fj * d.width];
	check('root curl expands one layer through injection',
		beyondDetached && waited && d._maskAt(target.cx, target.cy) && !d._maskAt(beyond.cx, beyond.cy)
		&& Math.abs(fine.rho - 1.03) < 1e-6 && floorN < countMask(d),
		`target=(${target.cx},${target.cy}) detached=${beyondDetached} waited=${waited} rho=${fine.rho}`);
	trackBoats(bm, [boat]);
	check('the following frame takes the next cell only', d._maskAt(beyond.cx, beyond.cy)
		&& d.cx1 - d.cx0 === w0
		&& maskEqualsFloor(d.domains[0], DISK2_RADIUS)
		&& maskEqualsFloor(d.domains[0].domains[0], DISK3_RADIUS));

	root(target.cx, target.cy).curl = 0;
	root(beyond.cx, beyond.cy).curl = 0;
	trackBoats(bm, [boat]);
	const sticky = d._maskAt(target.cx, target.cy);
	for (let i = 0; i < CURL_HOLD - 2; i++) trackBoats(bm, [boat]);
	const still = d._maskAt(target.cx, target.cy);
	fine.setEquil(0, 0, 1.07);
	trackBoats(bm, [boat]);
	const parent = root(target.cx, target.cy);
	let floorOn = true;
	const floor = buildClosedDiskMask(d.cx0, d.cy0, d.cx1, d.cy1, d.disk.cx, d.disk.cy, DISK_RADIUS, null);
	const cw = d.cx1 - d.cx0;
	for (let ly = 0; ly < d.cy1 - d.cy0; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			if (floor[lx + ly * cw] === 1 && !d._maskAt(d.cx0 + lx, d.cy0 + ly)) floorOn = false;
		}
	}
	check('leaving the mask restricts, and one quiet frame does not wipe the wake',
		sticky && still && !d._maskAt(target.cx, target.cy) && Math.abs(parent.rho - 1.07) < 1e-6 && floorOn,
		`sticky=${sticky} still=${still} rho=${parent.rho}`);
}

// Holds slide with the window. A hot field cannot fill the rectangle or resize it.
{
	const bm = make(75, 75, 15);
	const boat = { x: 0, y: 0 };
	trackBoats(bm, [boat]);
	const d = bm.domains[0];
	const cw = d.cx1 - d.cx0;
	const ch = d.cy1 - d.cy0;
	d._curlAbove[10 + 10 * cw] = 42;
	d._curlBelow[10 + 10 * cw] = 7;
	const cx0 = d.cx0;
	d.shiftBy(bm, 1, 0);
	check('curl holds slide onto the same world cell', d.cx0 === cx0 + 1 && d.cx1 - d.cx0 === cw
		&& d._curlAbove[9 + 10 * cw] === 42 && d._curlBelow[9 + 10 * cw] === 7
		&& d._curlAbove[10 + 10 * cw] === 0);

	for (const c of bm.cells) c.curl = 1;
	let maxR = 0;
	const boatCx = bm.width / 2;
	const boatCy = bm.height / 2;
	for (let i = 0; i < 40; i++) trackBoats(bm, [boat]);
	for (let ly = 0; ly < ch; ly++) {
		for (let lx = 0; lx < cw; lx++) {
			if (d.mask[lx + ly * cw] !== 1) continue;
			const r = Math.hypot(d.cx0 + lx + 0.5 - boatCx, d.cy0 + ly + 0.5 - boatCy);
			if (r > maxR) maxR = r;
		}
	}
	const floor = buildClosedDiskMask(d.cx0, d.cy0, d.cx1, d.cy1, d.disk.cx, d.disk.cy, DISK_RADIUS, null);
	let floorOn = true;
	for (let i = 0; i < floor.length; i++) if (floor[i] === 1 && d.mask[i] !== 1) floorOn = false;
	check('a hot field grows past the disk, stays under the cap, and leaves the window alone',
		floorOn && countMask(d) > count(floor) && countMask(d) <= MASK_CELL_CAP + 16
		&& maxR > DISK_RADIUS && maxR < 16 && d.mask[0] === 0 && d.mask[d.mask.length - 1] === 0
		&& d.cx1 - d.cx0 === cw && d.cy1 - d.cy0 === ch && !d.hasDiagonalOnlyContact()
		&& maskEqualsFloor(d.domains[0], DISK2_RADIUS)
		&& maskEqualsFloor(d.domains[0].domains[0], DISK3_RADIUS),
		`cells=${countMask(d)} maxR=${maxR.toFixed(2)}`);
}

// Two boats: each wake is its own mask. The other boat does not inherit an island.
{
	const bm = make(75, 75, 15);
	const a = { x: -12, y: 0 };
	const b = { x: 12, y: 0 };
	trackBoats(bm, [a, b]);
	const da = bm.domains[0];
	const db = bm.domains[1];
	const target = eastTarget(da);
	bm.cells[target.cx + target.cy * bm.width].curl = 1;
	for (let i = 0; i < CURL_HOLD; i++) trackBoats(bm, [a, b]);
	check('two boats keep separate windows and the union is per-mask',
		bm.domains.length === 2 && da.domains.length === 1 && db.domains.length === 1
		&& da.domains[0].domains.length === 1 && db.domains[0].domains.length === 1
		&& da._maskAt(target.cx, target.cy) && maskEqualsFloor(db, DISK_RADIUS)
		&& !share(da, db) && da.cx1 - da.cx0 === DOMAIN_HALF * 2 && db.cx1 - db.cx0 === DOMAIN_HALF * 2
		&& maskEqualsFloor(da.domains[0], DISK2_RADIUS) && maskEqualsFloor(db.domains[0], DISK2_RADIUS)
		&& maskEqualsFloor(da.domains[0].domains[0], DISK3_RADIUS)
		&& maskEqualsFloor(db.domains[0].domains[0], DISK3_RADIUS));
}

// Interior parent curl grows the next level one layer at a time, then erodes
// back to the disk. The floor never leaves. A hot parent cannot fill the window.
{
	const bm = make(75, 75, 15);
	const boat = { x: 0, y: 0 };
	trackBoats(bm, [boat]);
	const d = bm.domains[0];
	const l2 = d.domains[0];
	const l3 = l2.domains[0];
	const w2 = l2.cx1 - l2.cx0;
	const w3 = l3.cx1 - l3.cx0;
	const target2 = eastTarget(l2);
	const sensed = sensorNode(d, target2.cx, target2.cy) && !l2._maskAt(target2.cx, target2.cy);
	d.cells[target2.cx + target2.cy * d.width].curl = 1;
	let early2 = false;
	for (let i = 0; i < CURL_HOLD - 1; i++) {
		trackBoats(bm, [boat]);
		if (l2._maskAt(target2.cx, target2.cy)) early2 = true;
	}
	trackBoats(bm, [boat]);
	const grew2 = l2._maskAt(target2.cx, target2.cy);
	const l3still = maskEqualsFloor(l3, DISK3_RADIUS);
	const target3 = eastTarget(l3);
	const sensed3 = sensorNode(l2, target3.cx, target3.cy) && !l3._maskAt(target3.cx, target3.cy);
	l2.cells[target3.cx + target3.cy * l2.width].curl = 1;
	let early3 = false;
	for (let i = 0; i < CURL_HOLD - 1; i++) {
		trackBoats(bm, [boat]);
		d.cells[target2.cx + target2.cy * d.width].curl = 1;
		l2.cells[target3.cx + target3.cy * l2.width].curl = 1;
		if (l3._maskAt(target3.cx, target3.cy)) early3 = true;
	}
	trackBoats(bm, [boat]);
	const grew3 = l3._maskAt(target3.cx, target3.cy);
	check('level 2 and level 3 grow one layer from interior parent curl',
		sensed && sensed3 && !early2 && grew2 && l3still && !early3 && grew3
		&& maskEqualsFloor(d, DISK_RADIUS),
		`sensed2=${sensed} early2=${early2} grew2=${grew2} sensed3=${sensed3} early3=${early3} grew3=${grew3}`);
	const floor2 = buildClosedDiskMask(l2.cx0, l2.cy0, l2.cx1, l2.cy1, l2.disk.cx, l2.disk.cy, DISK2_RADIUS,
		(cx, cy) => l2._parentAllows(cx, cy));
	const floor3 = buildClosedDiskMask(l3.cx0, l3.cy0, l3.cx1, l3.cy1, l3.disk.cx, l3.disk.cy, DISK3_RADIUS,
		(cx, cy) => l3._parentAllows(cx, cy));
	let floorsOn = true;
	for (let i = 0; i < floor2.length; i++) if (floor2[i] === 1 && l2.mask[i] !== 1) floorsOn = false;
	for (let i = 0; i < floor3.length; i++) if (floor3[i] === 1 && l3.mask[i] !== 1) floorsOn = false;

	for (const c of d.cells) c.curl = 0;
	for (const c of l2.cells) c.curl = 0;
	let wiped = false;
	for (let i = 0; i < CURL_HOLD - 1; i++) {
		trackBoats(bm, [boat]);
		if (!l2._maskAt(target2.cx, target2.cy) || !l3._maskAt(target3.cx, target3.cy)) wiped = true;
	}
	trackBoats(bm, [boat]);
	const peeled2 = !l2._maskAt(target2.cx, target2.cy);
	const peeled3 = !l3._maskAt(target3.cx, target3.cy);
	for (let i = 0; i < floor2.length; i++) if (floor2[i] === 1 && l2.mask[i] !== 1) floorsOn = false;
	for (let i = 0; i < floor3.length; i++) if (floor3[i] === 1 && l3.mask[i] !== 1) floorsOn = false;
	check('quiet water retracts level 2 and level 3 to the disk floors',
		floorsOn && !wiped && peeled2 && peeled3
		&& maskEqualsFloor(l2, DISK2_RADIUS) && maskEqualsFloor(l3, DISK3_RADIUS)
		&& l2.cx1 - l2.cx0 === w2 && l3.cx1 - l3.cx0 === w3,
		`wiped=${wiped} peeled2=${peeled2} peeled3=${peeled3}`);

	for (let fj = 0; fj < d.height; fj++) {
		for (let fi = 0; fi < d.width; fi++) d.cells[fi + fj * d.width].curl = 1;
	}
	for (let i = 0; i < 24; i++) trackBoats(bm, [boat]);
	let floor2on = true;
	const floor2b = buildClosedDiskMask(l2.cx0, l2.cy0, l2.cx1, l2.cy1, l2.disk.cx, l2.disk.cy, DISK2_RADIUS,
		(cx, cy) => l2._parentAllows(cx, cy));
	for (let i = 0; i < floor2b.length; i++) if (floor2b[i] === 1 && l2.mask[i] !== 1) floor2on = false;
	check('level 2 wake stays inside its cap and window',
		floor2on && countMask(l2) > count(floor2b) && countMask(l2) <= MASK2_CELL_CAP + 16
		&& l2.mask[0] === 0 && l2.cx1 - l2.cx0 === w2 && !l2.hasDiagonalOnlyContact()
		&& maskEqualsFloor(l3, DISK3_RADIUS),
		`cells=${countMask(l2)}`);

	for (let fj = 0; fj < l2.height; fj++) {
		for (let fi = 0; fi < l2.width; fi++) l2.cells[fi + fj * l2.width].curl = 1;
	}
	for (let i = 0; i < 24; i++) trackBoats(bm, [boat]);
	let floor3on = true;
	const floor3b = buildClosedDiskMask(l3.cx0, l3.cy0, l3.cx1, l3.cy1, l3.disk.cx, l3.disk.cy, DISK3_RADIUS,
		(cx, cy) => l3._parentAllows(cx, cy));
	for (let i = 0; i < floor3b.length; i++) if (floor3b[i] === 1 && l3.mask[i] !== 1) floor3on = false;
	check('level 3 wake stays inside its cap and window',
		floor3on && countMask(l3) > count(floor3b) && countMask(l3) <= MASK3_CELL_CAP + 16
		&& l3.mask[0] === 0 && l3.cx1 - l3.cx0 === w3 && !l3.hasDiagonalOnlyContact(),
		`cells=${countMask(l3)}`);
}

// Curl that never enters the boat window opens its own island. The disk stays a disk.
{
	const bm = make(75, 75, 30);
	const boat = { x: -21.5, y: 22.5 };
	trackBoats(bm, [boat]);
	const boatDom = bm.domains[0];
	const hot = [];
	for (let y = 36; y <= 38; y++) {
		for (let x = 50; x <= 52; x++) hot.push(bm.cells[x + y * bm.width]);
	}
	for (let i = 0; i < CURL_HOLD + 1; i++) {
		for (const c of hot) c.curl = 1;
		trackBoats(bm, [boat]);
	}
	const field = bm.domains.filter(d => !d.disk);
	let disjoint = field.length === 1;
	if (disjoint) {
		const cw = field[0].cx1 - field[0].cx0;
		for (let ly = 0; ly < field[0].cy1 - field[0].cy0 && disjoint; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				if (field[0].mask[lx + ly * cw] !== 1) continue;
				if (boatDom._maskAt(field[0].cx0 + lx, field[0].cy0 + ly)) disjoint = false;
			}
		}
	}
	const hotCovered = field.length === 1 && field[0]._maskAt(51, 37);
	check('curl outside the boat window opens one detached field island',
		field.length === 1 && disjoint && hotCovered && countMask(field[0]) >= SEED_MIN
		&& countMask(field[0]) <= FIELD_CELL_CAP && field.length <= FIELD_DOMAIN_MAX
		&& !field[0].hasDiagonalOnlyContact()
		&& maskEqualsFloor(boatDom, DISK_RADIUS) && !field[0].domains.length,
		`islands=${field.length} cells=${field[0] ? countMask(field[0]) : 0}`);
}

// The barrier checkbox has to mark windows that are already open, not only the root.
{
	const bm = make(48, 48, 25);
	trackBoats(bm, [{ x: 0, y: 0 }]);
	const d = bm.domains[0];
	bm.setBarriers(true);
	const cx = Math.round(bm.width / 2);
	const cy = Math.round(bm.height / 2);
	const fi = fineIndex(d.cx0, cx);
	const fj = fineIndex(d.cy0, cy);
	const fine = d.cells[fi + fj * d.width];
	const l2 = d.domains[0];
	let nested = false;
	if (l2) {
		for (let k = 0; k < l2.cells.length && !nested; k++) if (l2.cells[k].barrier) nested = true;
	}
	const marked = bm.cells[cx + cy * bm.width].barrier === true && fine.barrier === true && nested;
	bm.setBarriers(false);
	const cleared = bm.cells[cx + cy * bm.width].barrier === false && fine.barrier === false;
	check('the barrier checkbox reaches open refinement windows', marked && cleared,
		`root=${bm.cells[cx + cy * bm.width].barrier} fine=${fine.barrier} nested=${nested}`);
}

// Centre obstacle, boat parked upwind of it. The shed waves must refine as a
// mask that does not touch the boat disk, and the lattice must stay finite.
{
	const bm = make(75, 75, 25);
	bm.setBarriers(true);
	const boat = { x: -21.5, y: 22.5 };
	let bad = 0;
	let maxU = 0;
	for (let frame = 0; frame < 100; frame++) {
		trackBoats(bm, [boat]);
		bm.physics_model_step();
		for (let i = 0; i < bm.cells.length; i++) {
			const c = bm.cells[i];
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) bad++;
			else {
				const s = Math.hypot(c.ux, c.uy);
				if (s > maxU) maxU = s;
			}
		}
	}
	const boatDom = bm.domains.find(d => d.disk);
	const field = bm.domains.filter(d => !d.disk);
	let disjoint = field.length > 0 && !!boatDom;
	for (let f = 0; f < field.length && disjoint; f++) {
		const domain = field[f];
		const cw = domain.cx1 - domain.cx0;
		for (let ly = 0; ly < domain.cy1 - domain.cy0 && disjoint; ly++) {
			for (let lx = 0; lx < cw; lx++) {
				if (domain.mask[lx + ly * cw] !== 1) continue;
				if (boatDom._maskAt(domain.cx0 + lx, domain.cy0 + ly)) disjoint = false;
			}
		}
	}
	const cells = field.reduce((n, d) => n + countMask(d), 0);
	const boatFloor = boatDom && buildClosedDiskMask(
		boatDom.cx0, boatDom.cy0, boatDom.cx1, boatDom.cy1,
		boatDom.disk.cx, boatDom.disk.cy, DISK_RADIUS,
		(cx, cy) => boatDom._parentAllows(cx, cy),
	);
	const floorOk = !!boatFloor && floorHeld(boatDom.mask, boatFloor);
	check('barrier waves at wind 25 refine as an island away from the boat',
		bad === 0 && maxU < 1 && disjoint && cells >= SEED_MIN && cells <= FIELD_CELL_CAP * FIELD_DOMAIN_MAX
		&& floorOk,
		`bad=${bad} max|u|=${maxU.toExponential(2)} islands=${field.length} cells=${cells} floor=${floorOk}`);
}

// The curl-contour island used to diverge here around frame 400 (max|u| ~1e3,
// density off by 1e30) while the same barrier with no refinement stayed near
// max|u| 0.43. Several hundred frames, both ways.
function latticeHealth(bm) {
	let bad = 0, maxU = 0, maxDr = 0;
	for (let y = 1; y < bm.height - 1; y++) {
		for (let x = 1; x < bm.width - 1; x++) {
			const c = bm.cells[x + y * bm.width];
			if (!Number.isFinite(c.ux) || !Number.isFinite(c.uy) || !Number.isFinite(c.rho)) { bad++; continue; }
			const s = Math.hypot(c.ux, c.uy);
			if (s > maxU) maxU = s;
			const dr = Math.abs(c.rho - 1);
			if (dr > maxDr) maxDr = dr;
		}
	}
	return { bad, maxU, maxDr };
}

function runBarrier(track, frames) {
	const bm = make(75, 75, 25);
	bm.setBarriers(true);
	const worst = { bad: 0, maxU: 0, maxDr: 0, domains: 0 };
	for (let frame = 0; frame < frames; frame++) {
		if (track) trackBoats(bm, []);
		bm.physics_model_step();
		if (frame % 25 !== 24 && frame !== frames - 1) continue;
		const st = latticeHealth(bm);
		worst.bad += st.bad;
		worst.domains = bm.domains.length;
		if (st.maxU > worst.maxU) worst.maxU = st.maxU;
		if (st.maxDr > worst.maxDr) worst.maxDr = st.maxDr;
	}
	return worst;
}

{
	// The curl-contour island diverged around frame 400. The root lattice at
	// this wind stays bounded well past that and later hits its own Mach limit
	// near frame 700, so the comparison window stops short of that limit.
	const frames = 600;
	const off = runBarrier(false, frames);
	const on = runBarrier(true, frames);
	const bounded = (st) => st.bad === 0 && st.maxU < 0.8 && st.maxDr < 0.5;
	check('barrier at wind 25 stays bounded with refinement off', bounded(off) && off.domains === 0,
		`bad=${off.bad} max|u|=${off.maxU.toExponential(2)} max|ρ−1|=${off.maxDr.toExponential(2)} domains=${off.domains}`);
	check('barrier at wind 25 stays bounded with refinement on', bounded(on) && on.domains >= 1,
		`bad=${on.bad} max|u|=${on.maxU.toExponential(2)} max|ρ−1|=${on.maxDr.toExponential(2)} domains=${on.domains}`);
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all curl-mask checks passed');
