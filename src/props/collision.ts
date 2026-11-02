/**
 * Swept-sphere collision primitives for the golf ball against course obstacles.
 *
 * Pure maths (no WebGL, no Rapier) so it is unit-testable and deterministic. Every test sweeps a
 * sphere of radius r from `a` to `b` and reports the earliest parametric hit time t ∈ [0, 1],
 * the outward surface normal and the contact point on the obstacle surface.
 *
 *  - sphere: classic ray vs (R + r) sphere. `soft` spheres (tree canopies) only register on entry.
 *  - vcyl:   vertical capped cylinder standing on the ground (tree trunks, posts, flagsticks).
 *  - box:    oriented box (OBB); tested as a ray against the box grown by r (Minkowski
 *            approximation — rounded edges are treated as square, which is fine at golf-ball scale).
 *  - cyl:    oriented cylinder with both caps (gong disc, target boards, pots).
 *
 * Static primitives live in a uniform spatial hash (StaticIndex) so a sweep only visits nearby
 * obstacles; dynamic primitives (Rapier props) are re-posed every frame and tested brute force.
 */
import { Quaternion, Vector3 } from 'three';

export type PrimShape = 'sphere' | 'vcyl' | 'box' | 'cyl';

export interface Primitive {
  id: string;
  /** Gameplay kind reported in prop-hit events: 'tree', 'building', 'flagstick', 'gong', … */
  kind: string;
  shape: PrimShape;
  /** sphere/box/cyl: centre. vcyl: centre of the base (ground contact). */
  center: Vector3;
  /** sphere / cylinder radius. */
  radius: number;
  /** vcyl: full height. cyl: half height along local y. */
  height: number;
  /** box half extents (local frame). */
  half: Vector3;
  /** box/cyl orientation (local → world). */
  rot: Quaternion;
  restitution: number;
  friction: number;
  soft?: boolean;
  /** Disabled primitives are skipped (e.g. flagstick pulled, pot shattered). */
  enabled: boolean;
  /** Bounding-sphere radius around `boundCenter` for quick rejection. */
  bound: number;
  boundCenter: Vector3;
  /** Free slot for the owner (e.g. dynamic prop index). */
  tag?: number;
}

export interface SweepResult {
  t: number;
  normal: Vector3;
  point: Vector3;
}

const EPS = 1e-9;
const _d = new Vector3();
const _m = new Vector3();
const _la = new Vector3();
const _lb = new Vector3();
const _ld = new Vector3();
const _q = new Quaternion();

export function makePrimitive(p: Partial<Primitive> & Pick<Primitive, 'id' | 'kind' | 'shape' | 'center'>): Primitive {
  const prim: Primitive = {
    radius: 0.1,
    height: 1,
    half: new Vector3(0.5, 0.5, 0.5),
    rot: new Quaternion(),
    restitution: 0.4,
    friction: 0.3,
    enabled: true,
    bound: 1,
    boundCenter: new Vector3(),
    ...p,
  };
  updateBounds(prim);
  return prim;
}

/** Recompute the bounding sphere (call after moving a primitive). */
export function updateBounds(p: Primitive) {
  switch (p.shape) {
    case 'sphere':
      p.boundCenter.copy(p.center);
      p.bound = p.radius;
      break;
    case 'vcyl':
      p.boundCenter.set(p.center.x, p.center.y + p.height * 0.5, p.center.z);
      p.bound = Math.hypot(p.radius, p.height * 0.5);
      break;
    case 'box':
      p.boundCenter.copy(p.center);
      p.bound = p.half.length();
      break;
    case 'cyl':
      p.boundCenter.copy(p.center);
      p.bound = Math.hypot(p.radius, p.height);
      break;
  }
}

/** Squared distance between segment a→b and point c. */
function segPointDist2(a: Vector3, b: Vector3, c: Vector3) {
  _d.subVectors(b, a);
  _m.subVectors(c, a);
  const l2 = _d.lengthSq();
  const t = l2 > EPS ? Math.max(0, Math.min(1, _m.dot(_d) / l2)) : 0;
  return _m.addScaledVector(_d, -t).lengthSq();
}

/** Quick reject: can the swept sphere touch this primitive's bounding sphere? */
export function mayHit(p: Primitive, a: Vector3, b: Vector3, r: number) {
  const R = p.bound + r;
  return segPointDist2(a, b, p.boundCenter) <= R * R;
}

// ───────────────────────────── shape tests ─────────────────────────────

function sweepSphere(c: Vector3, R0: number, soft: boolean, a: Vector3, b: Vector3, r: number, out: SweepResult): boolean {
  const R = R0 + r;
  const d = _d.subVectors(b, a);
  const m = _m.subVectors(a, c);
  const C = m.lengthSq() - R * R;
  if (C <= 0) {
    // Starting inside: soft colliders never re-trigger; hard ones push out if moving inward.
    if (soft) return false;
    const len = Math.sqrt(m.lengthSq());
    if (len < EPS) out.normal.set(0, 1, 0);
    else out.normal.copy(m).multiplyScalar(1 / len);
    if (d.dot(out.normal) >= 0) return false;
    out.t = 0;
    out.point.copy(c).addScaledVector(out.normal, R0);
    return true;
  }
  const A = d.lengthSq();
  if (A < EPS) return false;
  const B = m.dot(d);
  if (B >= 0) return false; // moving away
  const disc = B * B - A * C;
  if (disc < 0) return false;
  const t = (-B - Math.sqrt(disc)) / A;
  if (t < 0 || t > 1) return false;
  out.t = t;
  out.normal.copy(m).addScaledVector(d, t).multiplyScalar(1 / R);
  out.point.copy(c).addScaledVector(out.normal, R0);
  return true;
}

/**
 * Capped cylinder in a local frame: axis = y, y ∈ [y0, y1], radius R0. `capBottom` adds the
 * bottom cap. Inputs/outputs in local space; out.point is the sphere centre at contact.
 */
function sweepLocalCyl(la: Vector3, lb: Vector3, R0: number, y0: number, y1: number, capBottom: boolean, r: number, out: SweepResult): boolean {
  const R = R0 + r;
  const top = y1 + r;
  const bot = capBottom ? y0 - r : y0;
  const dx = lb.x - la.x;
  const dy = lb.y - la.y;
  const dz = lb.z - la.z;
  const ra2 = la.x * la.x + la.z * la.z;
  // Start inside the grown cylinder?
  if (ra2 <= R * R && la.y <= top && la.y >= bot) {
    const radial = R - Math.sqrt(ra2);
    const toTop = top - la.y;
    const toBot = capBottom ? la.y - bot : Infinity;
    if (toTop < radial && toTop <= toBot) out.normal.set(0, 1, 0);
    else if (toBot < radial) out.normal.set(0, -1, 0);
    else {
      const l = Math.sqrt(ra2);
      if (l < EPS) out.normal.set(1, 0, 0);
      else out.normal.set(la.x / l, 0, la.z / l);
    }
    if (dx * out.normal.x + dy * out.normal.y + dz * out.normal.z >= 0) return false;
    out.t = 0;
    out.point.copy(la);
    return true;
  }
  let best = Infinity;
  // Lateral surface.
  const A = dx * dx + dz * dz;
  if (A > EPS) {
    const B = la.x * dx + la.z * dz;
    const C = ra2 - R * R;
    const disc = B * B - A * C;
    if (disc >= 0 && B < 0) {
      const t = (-B - Math.sqrt(disc)) / A;
      if (t >= 0 && t <= 1) {
        const y = la.y + dy * t;
        if (y >= y0 && y <= y1) {
          best = t;
          const x = la.x + dx * t;
          const z = la.z + dz * t;
          out.normal.set(x / R, 0, z / R);
        }
      }
    }
  }
  // Top cap.
  if (la.y >= top && lb.y < top && dy < 0) {
    const t = (top - la.y) / dy;
    if (t < best) {
      const x = la.x + dx * t;
      const z = la.z + dz * t;
      if (x * x + z * z <= R0 * R0 + r * r) {
        best = t;
        out.normal.set(0, 1, 0);
      }
    }
  }
  // Bottom cap.
  if (capBottom && la.y <= bot && lb.y > bot && dy > 0) {
    const t = (bot - la.y) / dy;
    if (t < best) {
      const x = la.x + dx * t;
      const z = la.z + dz * t;
      if (x * x + z * z <= R0 * R0 + r * r) {
        best = t;
        out.normal.set(0, -1, 0);
      }
    }
  }
  if (best === Infinity) return false;
  out.t = best;
  out.point.set(la.x + dx * best, la.y + dy * best, la.z + dz * best);
  return true;
}

/** Ray vs AABB grown by r (local frame). out.point = sphere centre at contact (local). */
function sweepLocalBox(la: Vector3, lb: Vector3, h: Vector3, r: number, out: SweepResult): boolean {
  const ex = h.x + r;
  const ey = h.y + r;
  const ez = h.z + r;
  const d = _ld.subVectors(lb, la);
  if (Math.abs(la.x) <= ex && Math.abs(la.y) <= ey && Math.abs(la.z) <= ez) {
    // Inside: exit along the axis of least penetration.
    const px = ex - Math.abs(la.x);
    const py = ey - Math.abs(la.y);
    const pz = ez - Math.abs(la.z);
    if (px <= py && px <= pz) out.normal.set(Math.sign(la.x) || 1, 0, 0);
    else if (py <= pz) out.normal.set(0, Math.sign(la.y) || 1, 0);
    else out.normal.set(0, 0, Math.sign(la.z) || 1);
    if (d.dot(out.normal) >= 0) return false;
    out.t = 0;
    out.point.copy(la);
    return true;
  }
  let tmin = 0;
  let tmax = 1;
  let axis = -1;
  let sign = 1;
  const o = [la.x, la.y, la.z];
  const dd = [d.x, d.y, d.z];
  const e = [ex, ey, ez];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < EPS) {
      if (o[i] < -e[i] || o[i] > e[i]) return false;
      continue;
    }
    const inv = 1 / dd[i];
    let t0 = (-e[i] - o[i]) * inv;
    let t1 = (e[i] - o[i]) * inv;
    let s = -1;
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
      s = 1;
    }
    if (t0 > tmin) {
      tmin = t0;
      axis = i;
      sign = s;
    }
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return false;
  }
  if (axis < 0) return false;
  out.t = tmin;
  out.normal.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  out.point.copy(la).addScaledVector(d, tmin);
  return true;
}

/**
 * Sweep a sphere (radius r) from a to b against one primitive. Returns true on hit and fills
 * `out` with t, world normal and the contact point on the obstacle surface.
 */
export function sweepPrimitive(p: Primitive, a: Vector3, b: Vector3, r: number, out: SweepResult): boolean {
  if (!p.enabled) return false;
  switch (p.shape) {
    case 'sphere':
      return sweepSphere(p.center, p.radius, !!p.soft, a, b, r, out);
    case 'vcyl': {
      _la.subVectors(a, p.center);
      _lb.subVectors(b, p.center);
      if (!sweepLocalCyl(_la, _lb, p.radius, -1e3, p.height, false, r, out)) return false;
      out.point.add(p.center).addScaledVector(out.normal, -r);
      return true;
    }
    case 'box':
    case 'cyl': {
      _q.copy(p.rot).invert();
      _la.subVectors(a, p.center).applyQuaternion(_q);
      _lb.subVectors(b, p.center).applyQuaternion(_q);
      const hit = p.shape === 'box'
        ? sweepLocalBox(_la, _lb, p.half, r, out)
        : sweepLocalCyl(_la, _lb, p.radius, -p.height, p.height, true, r, out);
      if (!hit) return false;
      out.normal.applyQuaternion(p.rot);
      out.point.applyQuaternion(p.rot).add(p.center).addScaledVector(out.normal, -r);
      return true;
    }
  }
}

// ───────────────────────────── spatial hash ─────────────────────────────

/** Uniform-grid spatial hash over the world XZ plane for static primitives. */
export class StaticIndex {
  readonly prims: Primitive[] = [];
  private cells = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private query = 0;
  constructor(readonly cellSize = 8, readonly half = 900) {}

  private key(ix: number, iz: number) {
    return ix * 4096 + iz;
  }
  private cellOf(v: number) {
    return Math.floor((v + this.half) / this.cellSize);
  }

  add(p: Primitive) {
    const idx = this.prims.length;
    this.prims.push(p);
    const bx = p.boundCenter.x;
    const bz = p.boundCenter.z;
    const R = p.bound;
    for (let ix = this.cellOf(bx - R); ix <= this.cellOf(bx + R); ix++) {
      for (let iz = this.cellOf(bz - R); iz <= this.cellOf(bz + R); iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(idx);
      }
    }
  }

  /** Remove every primitive whose kind matches (e.g. replace tree colliders). */
  removeKind(kind: string) {
    const keep = this.prims.filter((p) => p.kind !== kind);
    this.prims.length = 0;
    this.cells.clear();
    for (const p of keep) this.add(p);
  }

  /** Visit primitives near the swept segment (each at most once). */
  forEachNear(a: Vector3, b: Vector3, r: number, fn: (p: Primitive) => void) {
    if (this.stamp.length < this.prims.length) this.stamp = new Uint32Array(this.prims.length * 2 + 16);
    const q = ++this.query;
    const x0 = this.cellOf(Math.min(a.x, b.x) - r);
    const x1 = this.cellOf(Math.max(a.x, b.x) + r);
    const z0 = this.cellOf(Math.min(a.z, b.z) - r);
    const z1 = this.cellOf(Math.max(a.z, b.z) + r);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const i of list) {
          if (this.stamp[i] === q) continue;
          this.stamp[i] = q;
          fn(this.prims[i]);
        }
      }
    }
  }
}

/** Earliest hit among a set of primitives. Reuses `out`; returns the hit primitive or null. */
export class SweepAccumulator {
  best: Primitive | null = null;
  result: SweepResult = { t: Infinity, normal: new Vector3(), point: new Vector3() };
  private tmp: SweepResult = { t: 0, normal: new Vector3(), point: new Vector3() };
  reset() {
    this.best = null;
    this.result.t = Infinity;
  }
  test(p: Primitive, a: Vector3, b: Vector3, r: number) {
    if (!p.enabled || !mayHit(p, a, b, r)) return;
    if (sweepPrimitive(p, a, b, r, this.tmp) && this.tmp.t < this.result.t) {
      this.best = p;
      this.result.t = this.tmp.t;
      this.result.normal.copy(this.tmp.normal);
      this.result.point.copy(this.tmp.point);
    }
  }
}
