import planck from 'planck-js/dist/planck-with-testbed';

let pl = planck, Vec2 = pl.Vec2;

// Race mark (buoy). A dynamic planck body with one circle fixture, held on
// station by an anchor line modelled as a spring plus a velocity damper.
// It collides with boats like any other body; nothing in the rules engine
// treats it as a boat (it is not in the players list).
//
// Units are the world's: 1 unit = 1 m, mass in the same units planck reports
// for a boat hull (Boat hull_mass is the polygon density).

// 1 m diameter.
export const MARK_RADIUS = 0.5;

// Mark mass as a fraction of a boat's mass. Scenarios pass the boat's actual
// body mass (body.getMass()) through markMassForBoat, so a change to the hull
// shape or hull_mass carries through.
export const MARK_MASS_RATIO = 0.1;

// Anchor spring: F = -MARK_SPRING_K · d, d = mark center − anchor (metres).
// The pull grows linearly with distance. With the current hull (boat mass
// 26.6, mark mass 2.66) the undamped period is 2π·√(m/k) ≈ 10 s. Soft enough
// that a close-hauled boat at ~2 m/s shoves the buoy a couple of metres
// (scenario 11: ~2.3 m) and it drifts back over about five seconds.
export const MARK_SPRING_K = 1.0;

// Anchor-line damping: F = -MARK_DAMPING · v. Water drag and the line's own
// losses, so the buoy settles instead of oscillating round the anchor for
// ever. 2.0 is a damping ratio of c / (2·√(k·m)) ≈ 0.6 for the mass above:
// a small overshoot (under 0.2 m), then it sits on station.
export const MARK_DAMPING = 2.0;

// Colour of the buoy outline and of the anchor cross / anchor line.
export const MARK_COLOR = 0xff8c00;
export const MARK_ANCHOR_COLOR = 0xffd34d;

// Displacement below which the anchor line is not drawn (metres).
export const MARK_LINE_MIN_M = 0.05;

export function markMassForBoat(boatBody) {
  return boatBody.getMass() * MARK_MASS_RATIO;
}

// Restoring force on a mark at (x, y) moving at (vx, vy), anchored at
// (ax, ay). Pure, so checks and later rounding logic can call it directly.
export function markRestoringForce(x, y, ax, ay, vx = 0, vy = 0, k = MARK_SPRING_K, c = MARK_DAMPING) {
  return {
    x: -k * (x - ax) - c * vx,
    y: -k * (y - ay) - c * vy,
  };
}

export class Mark {
  // options: { mass, anchorX, anchorY, radius }. mass is required; pass
  // markMassForBoat(boat.physics_model). The anchor defaults to the starting
  // position.
  constructor(map, x, y, options = {}) {
    if (!(options.mass > 0)) throw new Error('Mark needs a positive mass (use markMassForBoat)');
    this.map = map;
    this.radius = options.radius !== undefined ? options.radius : MARK_RADIUS;
    this.mass = options.mass;
    this.anchor = {
      x: options.anchorX !== undefined ? options.anchorX : x,
      y: options.anchorY !== undefined ? options.anchorY : y,
    };
    this.x = x;
    this.y = y;
    // Last applied force and the state it was computed from.
    this.force = { x: 0, y: 0 };
    this.lastPosition = { x, y };
    this.lastVelocity = { x: 0, y: 0 };
    this.physics_model = undefined;
    this.physics_model_init();
  }

  physics_model_init() {
    const body = this.map.world.createBody({
      type: 'dynamic',
      position: Vec2(this.x, this.y),
      allowSleep: false,
      // A buoy spins freely about its own axis; keep it from spinning for ever.
      angularDamping: 1.0,
    });
    // density × area = mass.
    const density = this.mass / (Math.PI * this.radius * this.radius);
    body.createFixture(pl.Circle(this.radius), { density, friction: 0.3, restitution: 0.2 });
    body.render = { stroke: MARK_COLOR };
    body.isMark = true;
    this.physics_model = body;
  }

  physics_model_deinit() {
    this.map.world.destroyBody(this.physics_model);
  }

  // Distance from the anchor, metres.
  displacement() {
    return Math.hypot(this.x - this.anchor.x, this.y - this.anchor.y);
  }

  // Call once per world.step, before it. Planck clears forces after a step.
  physics_model_step() {
    const body = this.physics_model;
    const p = body.getPosition();
    const v = body.getLinearVelocity();
    this.x = p.x;
    this.y = p.y;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      body.setTransform(Vec2(this.anchor.x, this.anchor.y), 0);
      body.setLinearVelocity(Vec2(0, 0));
      body.setAngularVelocity(0);
      this.x = this.anchor.x;
      this.y = this.anchor.y;
      this.force = { x: 0, y: 0 };
      return;
    }
    this.lastPosition = { x: p.x, y: p.y };
    this.lastVelocity = { x: v.x, y: v.y };
    this.force = markRestoringForce(p.x, p.y, this.anchor.x, this.anchor.y, v.x, v.y);
    body.applyForceToCenter(Vec2(this.force.x, this.force.y), true);
  }

  // Anchor cross, plus the anchor line to the buoy while it is displaced.
  graphics_model_render() {
    const g = [];
    const p = this.physics_model.getPosition();
    const ax = this.anchor.x;
    const ay = this.anchor.y;
    const s = 0.3;
    g.push({ color: MARK_ANCHOR_COLOR, type: 'guide', x1: ax - s, y1: ay - s, x2: ax + s, y2: ay + s });
    g.push({ color: MARK_ANCHOR_COLOR, type: 'guide', x1: ax - s, y1: ay + s, x2: ax + s, y2: ay - s });
    if (Math.hypot(p.x - ax, p.y - ay) > MARK_LINE_MIN_M) {
      g.push({ color: MARK_ANCHOR_COLOR, opacity: 0.8, type: 'guide', x1: ax, y1: ay, x2: p.x, y2: p.y });
    }
    return g;
  }
}
