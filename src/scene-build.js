// Client side of the scene: builds everything the renderer draws (guide
// segments, labels, body outlines) from the compact state and statics the
// host sends (scene-state.js). The same code runs in every host mode
// (local, worker, server), so they look the same. The drawing functions are
// the ones the Sim objects use (boat-draw.js, mark.js markGuides, start.js,
// course.js, finish.js, boundary.js, rules.js, mark-touch.js); here they get
// plain state instead of live objects.
//
// buildScene(state, statics, view) → { guides, bodies }
import { unionMaskBorderLines, RefinementDomain } from './boltzmann.js';
import { windArrowSegments } from './wind.js';
import { boatGuides } from './boat-draw.js';
import { markGuides } from './mark.js';
import { startGuidesFromState } from './start.js';
import { courseGuidesFromState } from './course.js';
import { finishGuidesFromState } from './finish.js';
import { boundaryGuides } from './boundary.js';
import { roomGuidesFromState, contactGuidesFromState, penaltyGuidesFromState, pairGuidesFromState, pairBoatsFromState } from './rules.js';
import { hudFromState } from './hud.js';
import { markTouchGuidesFromState } from './mark-touch.js';
import { ladderGuidesFromState } from './ladder-lines.js';
import { gustGuidesFromState } from './gusts.js';

// Smooth circle per boat disk. A field island has a mask and no disk, so
// only its staircase is drawn. The light staircase is the union of every
// mask at that level: overlapping boats share one border, and a detached
// curl island keeps its own outline. A rectangle with no disk and no mask
// still uses its four sides. domains: RefinementDomain or DomainOutline;
// bm: { width, height, resolution, amrMode }.
export function pushRefinementGuides(guides, domains, bm) {
  const masked = [];
  for (const domain of domains) {
    if (domain.mask && !domain.disk) {
      masked.push(domain);
      continue;
    }
    // Auto layout: only the finest boat level has a fixed disk. A coarser
    // level's disk is just its grading-shell floor, so its circle is not
    // drawn; its real extent is the mask outline below.
    const shellOnly = bm.amrMode === 'auto' && domain.disk && domain.domains.length > 0;
    for (const seg of shellOnly ? [] : domain.worldBorderLines(bm)) {
      if (domain.disk && seg.dim) continue;
      guides.push({
        color: seg.dim ? 0x8899aa : 0x000000,
        opacity: seg.dim ? 0.35 : 1,
        type: 'guide',
        refine: true,
        x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2,
      });
    }
    if (domain.disk) masked.push(domain);
  }
  for (const seg of unionMaskBorderLines(masked, bm)) {
    // Full-opacity light line: the 0.35 gray sat on the dark speed field
    // and the merged border could not be told from the black per-boat circles.
    guides.push({ color: 0x9ad0ff, opacity: 1, type: 'guide', refine: true, x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
  }
  const children = [];
  for (const domain of domains) children.push(...domain.domains);
  if (children.length) pushRefinementGuides(guides, children, bm);
}

// Run lengths (scene-state.js encodeMaskRuns) → mask.
export function decodeMaskRuns(str, length) {
  const mask = new Uint8Array(length);
  let i = 0, v = 0;
  for (const r of str.split(',')) {
    const n = parseInt(r, 36);
    if (v) mask.fill(1, i, Math.min(length, i + n));
    i += n;
    v ^= 1;
  }
  return mask;
}

// Outline-only stand-in for a RefinementDomain: the fields its outline code
// reads, and that code itself (worldBorderLines, _rootX/_rootY, _maskAt).
export class DomainOutline {
  constructor(s) {
    this.cx0 = s.x; this.cy0 = s.y; this.cx1 = s.x + s.w; this.cy1 = s.y + s.h;
    this.dx = s.dx; this.cx0_root = s.rx; this.cy0_root = s.ry;
    this.disk = s.k ? { cx: s.k[0], cy: s.k[1], radius: s.k[2] } : null;
    this.mask = s.m === null || s.m === undefined ? null : decodeMaskRuns(s.m, s.w * s.h);
    this.domains = (s.c || []).map((c) => new DomainOutline(c));
  }
}
for (const name of ['worldBorderLines', '_rootX', '_rootY', '_maskAt']) {
  DomainOutline.prototype[name] = RefinementDomain.prototype[name];
}

// Body outlines from statics.bodies and state.bt (formulas of the old
// present.js bodyOutlines).
export function buildBodies(list, bt) {
  const out = [];
  let k = 0;
  for (const e of list || []) {
    let tf = e.at;
    if (e.mv) {
      const n = e.kind === 'polygon' ? 3 : 2;
      tf = bt.slice(k, k + n);
      k += n;
    }
    let pts;
    if (e.kind === 'circle') {
      const radius = e.r;
      pts = new Array(74);
      for (let i = 0; i < 36; i++) {
        const a = i * 10 / 180 * Math.PI;
        pts[i * 2] = radius * Math.cos(a) + tf[0];
        pts[i * 2 + 1] = radius * Math.sin(a) + tf[1];
      }
      pts[72] = pts[0]; pts[73] = pts[1];
    } else if (e.kind === 'edge') {
      const v = e.v;
      pts = [v[0] + tf[0], v[1] + tf[1], v[2] + tf[0], v[3] + tf[1]];
    } else {
      const v = e.v;
      const n = v.length / 2;
      const angle = tf[0] + Math.PI;
      const comx = e.com[0], comy = e.com[1];
      const cx = tf[1], cy = tf[2];
      const c = Math.cos(angle), s = Math.sin(angle);
      pts = new Array((n + 1) * 2);
      for (let i = 0; i <= n; i++) {
        const vx = v[(i % n) * 2], vy = v[(i % n) * 2 + 1];
        pts[i * 2] = (vx + comx) * c + (vy - comy) * s + cx;
        pts[i * 2 + 1] = (vx + comx) * s - (vy - comy) * c + cy;
      }
    }
    out.push({ id: e.id, kind: e.kind, stroke: e.stroke, pts });
  }
  return out;
}

// Guides in the order the old present.js presentStep drew them. view: the
// client's View (dev-mode wind arrow position).
export function buildGuides(state, statics, view) {
  const guides = [];
  const now = state.t || 0;
  const defs = statics.defs || [];
  const boats = state.boats || [];
  for (let i = 0; i < boats.length; i++) guides.push(...boatGuides(boats[i], defs[i] || {}));
  const anchors = statics.marks || [];
  const mk = state.mk || [];
  for (let i = 0; i < mk.length; i++) {
    const a = anchors[i];
    if (a) guides.push(...markGuides(a[0], a[1], mk[i][0], mk[i][1]));
  }
  // Spawned (player) boats carry a name badge.
  for (let i = 0; i < boats.length; i++) {
    const name = defs[i] && defs[i].name;
    if (name) guides.push({ type: 'label', badge: true, x: boats[i].x, y: boats[i].y + 4, lines: [{ text: name, role: 'markno', id: 'name' }] });
  }
  // Owner disconnected (server grace period, state.aw): whole seconds until
  // the boat is removed, in red above the name badge.
  const aw = state.aw || [];
  for (let i = 0; i < boats.length && i < aw.length; i++) {
    if (aw[i] > 0) guides.push({ type: 'label', badge: true, x: boats[i].x, y: boats[i].y + 5.6, lines: [{ text: String(aw[i]), role: 'badge', id: 'away' }] });
  }
  const b0 = boats[0] ? { x: boats[0].x, y: boats[0].y } : null;
  if (state.start && statics.start) guides.push(...startGuidesFromState(statics.start, state.start, b0, now));
  if (state.course && statics.course) guides.push(...courseGuidesFromState(statics.course, state.course, now));
  if (state.finish && statics.finish) guides.push(...finishGuidesFromState(statics.finish, state.finish, now));
  if (statics.boundary) guides.push(...boundaryGuides(statics.boundary));
  if (state.br) guides.push(...roomGuidesFromState(state.br, 'boundaryRoom', boats));
  if (state.mr) guides.push(...roomGuidesFromState(state.mr, 'markRoom', boats));
  if (state.pair) {
    const at = pairBoatsFromState(state.boats, statics.hulls);
    for (const p of state.pair) guides.push(...pairGuidesFromState(p, at));
  }
  if (state.mt) guides.push(...markTouchGuidesFromState(state.mt));
  if (state.cf) guides.push(...contactGuidesFromState(state.cf));
  if (state.pen) guides.push(...penaltyGuidesFromState(state.pen, boats));
  if (state.amr && statics.lat) {
    const bm = { width: statics.lat.w, height: statics.lat.h, resolution: statics.lat.res, amrMode: state.amr.mode };
    pushRefinementGuides(guides, state.amr.d.map((d) => new DomainOutline(d)), bm);
  }
  if (state.ladder) guides.push(...ladderGuidesFromState(state.ladder));
  if (state.gust) guides.push(...gustGuidesFromState(state.gust));
  if (state.wind !== undefined && view) {
    // The arrow points downwind, along the flow.
    const ox = view.camera_position_x - 14;
    const oy = view.camera_position_y + 4;
    for (const seg of windArrowSegments(ox, oy, state.wind, 8)) {
      guides.push({ color: 0x66eeff, type: 'guide', x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
    }
  }
  return guides;
}

// { guides, bodies, hud } (hud: hud.js hudFromState, null without HUD state).
// ownId: this client's player boat in a server room (its readout), or null.
export function buildScene(state, statics, view, ownId = null) {
  if (!state || !statics) return { guides: [], bodies: [], hud: null };
  return { guides: buildGuides(state, statics, view), bodies: buildBodies(statics.bodies, state.bt), hud: state.hud ? hudFromState(state.hud, ownId, state.boats) : null };
}
