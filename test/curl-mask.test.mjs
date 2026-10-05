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

const { Boltzmann, buildClosedDiskMask } = await import('../src/boltzmann.js');
const {
	trackBoats, stepCurlMask, normalizedCurl,
	DISK_RADIUS, DISK2_RADIUS, DOMAIN_HALF, CURL_HOLD, CURL_TAU_ON, CURL_TAU_OFF, MASK_CELL_CAP,
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
	&& normalizedCurl(0, 0.15) === 0 && normalizedCurl(1, 0) === 0 && normalizedCurl(NaN, 0.15) === 0);
check('thresholds satisfy τ_on > τ_off and a few frames of hold',
	CURL_TAU_ON > CURL_TAU_OFF && CURL_TAU_OFF > 0 && CURL_HOLD >= 4 && CURL_HOLD <= 8 && MASK_CELL_CAP === 400,
	`τ_on=${CURL_TAU_ON} τ_off=${CURL_TAU_OFF} hold=${CURL_HOLD}`);

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

// Lattice wiring: root curl only, enter injects, leave restricts, level 2 stays a disk.
{
	const bm = make(75, 75, 15);
	const boat = { x: 0, y: 0 };
	trackBoats(bm, [boat]);
	const d = bm.domains[0];
	const w0 = d.cx1 - d.cx0;
	const h0 = d.cy1 - d.cy0;
	check('calm trackBoats installs the disk floor', maskEqualsFloor(d, DISK_RADIUS)
		&& w0 === DOMAIN_HALF * 2 && h0 === DOMAIN_HALF * 2 && !d.hasDiagonalOnlyContact());
	check('level 2 is the nested disk', d.domains.length === 1 && maskEqualsFloor(d.domains[0], DISK2_RADIUS));

	const floorN = countMask(d);
	for (const c of d.cells) c.curl = 20;
	for (const c of d.domains[0].cells) c.curl = 20;
	for (let i = 0; i < CURL_HOLD + 4; i++) trackBoats(bm, [boat]);
	check('fine-grid curl does not expand the mask', countMask(d) === floorN && maskEqualsFloor(d, DISK_RADIUS));
	for (const c of d.cells) c.curl = 0;
	for (const c of d.domains[0].cells) c.curl = 0;

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
	const fi = 1 + (target.cx - d.cx0) * 2;
	const fj = 1 + (target.cy - d.cy0) * 2;
	const fine = d.cells[fi + fj * d.width];
	check('root curl expands one layer through injection',
		beyondDetached && waited && d._maskAt(target.cx, target.cy) && !d._maskAt(beyond.cx, beyond.cy)
		&& Math.abs(fine.rho - 1.03) < 1e-6 && floorN < countMask(d),
		`target=(${target.cx},${target.cy}) detached=${beyondDetached} waited=${waited} rho=${fine.rho}`);
	trackBoats(bm, [boat]);
	check('the following frame takes the next cell only', d._maskAt(beyond.cx, beyond.cy)
		&& d.cx1 - d.cx0 === w0 && maskEqualsFloor(d.domains[0], DISK2_RADIUS));

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
		&& maskEqualsFloor(d.domains[0], DISK2_RADIUS),
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
		&& da._maskAt(target.cx, target.cy) && maskEqualsFloor(db, DISK_RADIUS)
		&& !share(da, db) && da.cx1 - da.cx0 === DOMAIN_HALF * 2 && db.cx1 - db.cx0 === DOMAIN_HALF * 2
		&& maskEqualsFloor(da.domains[0], DISK2_RADIUS) && maskEqualsFloor(db.domains[0], DISK2_RADIUS));
}

if (failed) {
	console.error(`${failed} check(s) failed`);
	process.exit(1);
}
console.log('all curl-mask checks passed');
