/**
 * Fixed-timestep golf ball simulation: aerodynamics (drag, Magnus lift, spin decay, wind),
 * turf bounce with spin/friction impulses (Penner-style soft "crater" normal), rolling with
 * slope gravity and surface-dependent resistance, cup capture, water & out-of-bounds.
 */
import { Vector3 } from 'three';
import { PHYS, SURFACES, type SurfaceId } from '../config';

export interface TerrainQuery {
  height(x: number, z: number): number;
  normal(x: number, z: number, out: Vector3): Vector3;
  surface(x: number, z: number): SurfaceId;
  /** Water surface height at (x,z), or null if there is no water here. */
  waterHeight(x: number, z: number): number | null;
  /** Is (x,z) out of bounds? */
  isOOB(x: number, z: number): boolean;
}

export interface ObstacleHit {
  /** Contact point on obstacle surface. */
  point: Vector3;
  normal: Vector3;
  restitution: number;
  friction: number;
  /** Soft obstacles (tree canopy) slow the ball randomly instead of a hard bounce. */
  soft?: boolean;
  id: string;
}

export interface CollisionWorld {
  /** Sweep a sphere of radius r from a to b; return first hit, or null. */
  sweep(a: Vector3, b: Vector3, r: number): ObstacleHit | null;
  /** Notify the world that the ball hit something (to push dynamic props). */
  onBallHit?(hit: ObstacleHit, ballVelocity: Vector3): void;
}

export type BallState = 'flight' | 'rolling' | 'rest' | 'holed' | 'water' | 'oob';

export interface BallEvent {
  type: 'bounce' | 'land' | 'object' | 'rest' | 'holed' | 'water' | 'oob' | 'lipout' | 'rattle';
  pos: Vector3;
  speed: number;
  surface?: SurfaceId;
  id?: string;
}

export type WindFn = (pos: Vector3, out: Vector3) => Vector3;

const UP = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const tmpN = new Vector3();
const tmpW = new Vector3();

export interface BallSimOptions {
  terrain: TerrainQuery;
  wind?: WindFn;
  world?: CollisionWorld;
  cup?: Vector3 | null;
  rng?: () => number;
}

export class BallSim {
  pos = new Vector3();
  vel = new Vector3();
  /** Angular velocity, rad/s (world). */
  spin = new Vector3();
  state: BallState = 'rest';
  time = 0;
  /** Recorded path for tracers and analysis (sampled every few steps). */
  trail: Vector3[] = [];
  events: BallEvent[] = [];
  /** First ground contact (carry) position. */
  carryPos: Vector3 | null = null;
  apex = 0;
  lastSurface: SurfaceId = 'fairway';
  /** Position where the ball most recently crossed into water (for drop rules). */
  waterEntry: Vector3 | null = null;
  /** Last dry position the ball was at (for lateral hazard drop). */
  lastDry = new Vector3();
  private startPos = new Vector3();
  private accum = 0;
  private steps = 0;
  private stillTime = 0;
  opts: BallSimOptions;

  constructor(opts: BallSimOptions) {
    this.opts = opts;
  }

  /** Place the ball at rest on the terrain at (x, z). */
  place(p: Vector3) {
    const t = this.opts.terrain;
    this.pos.set(p.x, t.height(p.x, p.z) + PHYS.ballRadius, p.z);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.state = 'rest';
    this.lastSurface = t.surface(p.x, p.z);
    this.lastDry.copy(this.pos);
  }

  launch(velocity: Vector3, spin: Vector3) {
    this.vel.copy(velocity);
    this.spin.copy(spin);
    this.state = 'flight';
    this.time = 0;
    this.accum = 0;
    this.steps = 0;
    this.stillTime = 0;
    this.trail = [this.pos.clone()];
    this.events = [];
    this.carryPos = null;
    this.apex = this.pos.y;
    this.startPos.copy(this.pos);
    this.waterEntry = null;
    this.lastDry.copy(this.pos);
    // Lift the ball off the ground slightly so the first step isn't a contact.
    this.pos.y += 0.002;
  }

  get moving() {
    return this.state === 'flight' || this.state === 'rolling';
  }

  /** Advance by real time dt using fixed sub-steps. Returns events produced this call. */
  update(dt: number): BallEvent[] {
    const out: BallEvent[] = [];
    if (!this.moving) return out;
    this.accum += Math.min(dt, 0.1);
    while (this.accum >= PHYS.dt && this.moving) {
      this.accum -= PHYS.dt;
      const before = this.events.length;
      this.step(PHYS.dt);
      for (let i = before; i < this.events.length; i++) out.push(this.events[i]);
    }
    return out;
  }

  /** Run until the ball stops (for tests / prediction). */
  simulate(maxTime = PHYS.maxSimTime) {
    while (this.moving && this.time < maxTime) this.step(PHYS.dt);
    if (this.moving) this.stop('rest');
    return this;
  }

  private emit(e: BallEvent) {
    this.events.push(e);
  }

  private stop(state: BallState, ev?: BallEvent['type']) {
    this.state = state;
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.trail.push(this.pos.clone());
    this.emit({ type: ev ?? (state as BallEvent['type']), pos: this.pos.clone(), speed: 0, surface: this.lastSurface });
  }

  step(dt: number) {
    const T = this.opts.terrain;
    const r = PHYS.ballRadius;
    this.time += dt;
    this.steps++;

    const groundH = T.height(this.pos.x, this.pos.z);
    const gap = this.pos.y - r - groundH;
    const inContact = gap <= 0.004;
    const surfId = T.surface(this.pos.x, this.pos.z);
    const surf = SURFACES[surfId];

    // --- Forces ---
    const acc = tmpA.set(0, -PHYS.gravity, 0);
    if (!inContact || this.state === 'flight') {
      // Aerodynamics (also applies while bouncing).
      const wind = this.opts.wind ? this.opts.wind(this.pos, tmpW) : tmpW.set(0, 0, 0);
      const vRel = tmpB.copy(this.vel).sub(wind);
      const speed = vRel.length();
      if (speed > 0.05) {
        const area = Math.PI * r * r;
        const q = 0.5 * PHYS.airDensity * area * speed * speed;
        const w = this.spin.length();
        const S = (r * w) / speed;
        const crisis = smooth(PHYS.dragCrisisLo, PHYS.dragCrisisHi, speed);
        const cdHi = PHYS.cdBase + PHYS.cdSpin * S - PHYS.cdSpeed * Math.max(0, speed - 40);
        const cd = PHYS.cdLowSpeed * (1 - crisis) + Math.max(0.12, cdHi) * crisis;
        const cl = Math.min(0.42, PHYS.clMax * Math.pow(S, PHYS.clScale));
        // Drag
        acc.addScaledVector(vRel, (-q * cd) / (PHYS.ballMass * speed));
        // Magnus lift ⟂ to velocity along ω × v
        if (w > 1e-3) {
          const liftDir = tmpC.crossVectors(this.spin, vRel);
          const ll = liftDir.length();
          if (ll > 1e-9) acc.addScaledVector(liftDir, (q * cl) / (PHYS.ballMass * ll));
        }
      }
      // Spin decay
      this.spin.multiplyScalar(Math.exp(-dt / PHYS.spinDecayTau));
    }

    if (inContact && this.state === 'rolling') {
      this.rollStep(dt, surfId);
    } else {
      // Ballistic integration (semi-implicit Euler).
      this.vel.addScaledVector(acc, dt);
      const prev = tmpC.copy(this.pos);
      this.pos.addScaledVector(this.vel, dt);
      this.apex = Math.max(this.apex, this.pos.y);
      // Obstacles
      const world = this.opts.world;
      if (world) {
        const hit = world.sweep(prev, this.pos, r);
        if (hit) this.resolveObstacle(hit, prev);
      }
      // Ground contact
      const h = T.height(this.pos.x, this.pos.z);
      if (this.pos.y - r <= h) {
        this.pos.y = h + r;
        this.groundContact(surfId === 'water' ? T.surface(this.pos.x, this.pos.z) : T.surface(this.pos.x, this.pos.z));
      }
    }

    // Hazards
    const wh = T.waterHeight(this.pos.x, this.pos.z);
    if (wh !== null && this.pos.y - r * 0.5 <= wh) {
      this.waterEntry = this.pos.clone();
      this.pos.y = wh;
      this.emit({ type: 'water', pos: this.pos.clone(), speed: this.vel.length() });
      this.stop('water', 'water');
      return;
    } else if (wh === null && this.state !== 'flight') {
      this.lastDry.copy(this.pos);
    }
    if (this.pos.y < PHYS.outOfBoundsY || T.isOOB(this.pos.x, this.pos.z) && this.state !== 'flight') {
      this.stop('oob', 'oob');
      return;
    }

    // Cup
    if (this.opts.cup && this.checkCup()) return;

    if (this.steps % 6 === 0) this.trail.push(this.pos.clone());

    // Rest check
    if (this.state === 'rolling') {
      const sp = this.vel.length();
      if (sp < PHYS.restSpeed) {
        this.stillTime += dt;
        const n = T.normal(this.pos.x, this.pos.z, tmpN);
        const slopeAcc = PHYS.gravity * Math.sqrt(Math.max(0, 1 - n.y * n.y)) * (5 / 7);
        const s = SURFACES[T.surface(this.pos.x, this.pos.z)];
        if (slopeAcc < s.rollDecel * 0.9 || this.stillTime > 0.6) {
          if (T.isOOB(this.pos.x, this.pos.z)) this.stop('oob', 'oob');
          else this.stop('rest', 'rest');
        }
      } else this.stillTime = 0;
    }
    if (this.time > PHYS.maxSimTime) this.stop(T.isOOB(this.pos.x, this.pos.z) ? 'oob' : 'rest');
    void surf;
  }

  private groundContact(surfId: SurfaceId) {
    const T = this.opts.terrain;
    const s = SURFACES[surfId];
    const r = PHYS.ballRadius;
    const n = T.normal(this.pos.x, this.pos.z, tmpN).clone();
    const vn0 = this.vel.dot(n);
    if (vn0 >= 0) return;
    const impactSpeed = this.vel.length();
    this.lastSurface = surfId;
    if (!this.carryPos) {
      this.carryPos = this.pos.clone();
      this.emit({ type: 'land', pos: this.pos.clone(), speed: impactSpeed, surface: surfId });
    }

    // Penner-style crater: soft turf tilts the effective normal back against the motion.
    const vt0 = tmpB.copy(this.vel).addScaledVector(n, -vn0);
    const vtLen = vt0.length();
    const tilt = Math.min(0.42, s.softness * Math.abs(vn0));
    if (vtLen > 1e-4 && tilt > 0) {
      n.addScaledVector(vt0, -Math.tan(tilt) / vtLen).normalize();
    }
    const vn = this.vel.dot(n);
    if (vn >= 0) return;
    const vt = tmpB.copy(this.vel).addScaledVector(n, -vn);
    // Penner (2002) turf COR vs normal impact speed, scaled by the surface firmness.
    const avn = Math.abs(vn);
    const e = (s.restitution / 0.34) * clamp(0.51 - 0.0375 * avn + 0.000903 * avn * avn, 0.08, 0.6);

    // Contact point velocity (slip) = vt + ω × (−r n)
    const rc = tmpC.copy(n).multiplyScalar(-r);
    const slip = new Vector3().crossVectors(this.spin, rc).add(vt);
    const slipLen = slip.length();
    const m = PHYS.ballMass;
    const I = 0.4 * m * r * r;
    if (slipLen > 1e-6) {
      const maxJ = s.friction * (1 + e) * m * Math.abs(vn);
      const needJ = (2 / 7) * m * slipLen; // impulse to reach pure rolling
      const J = Math.min(maxJ, needJ);
      const Jv = slip.multiplyScalar(-J / slipLen);
      this.vel.addScaledVector(Jv, 1 / m);
      const dW = new Vector3().crossVectors(rc, Jv).multiplyScalar(1 / I);
      this.spin.add(dW);
    }
    // Normal restitution
    const vnNow = this.vel.dot(n);
    this.vel.addScaledVector(n, -vnNow - e * vn);

    const outN = this.vel.dot(T.normal(this.pos.x, this.pos.z, tmpN));
    if (surfId !== 'water') {
      this.emit({ type: 'bounce', pos: this.pos.clone(), speed: impactSpeed, surface: surfId });
    }
    if (outN < 0.55 || surfId === 'sand') {
      // Settle into rolling.
      const gn = T.normal(this.pos.x, this.pos.z, tmpN);
      this.vel.addScaledVector(gn, -this.vel.dot(gn));
      this.state = 'rolling';
    }
  }

  private rollStep(dt: number, surfId: SurfaceId) {
    const T = this.opts.terrain;
    const r = PHYS.ballRadius;
    const s = SURFACES[surfId];
    this.lastSurface = surfId;
    const n = T.normal(this.pos.x, this.pos.z, tmpN);
    // Gravity along the slope (rolling sphere: 5/7 g sinθ).
    const g = tmpA.set(0, -PHYS.gravity, 0);
    const gT = g.addScaledVector(n, -g.dot(n)).multiplyScalar(5 / 7);
    // Velocity is kept tangent.
    this.vel.addScaledVector(n, -this.vel.dot(n));
    this.vel.addScaledVector(gT, dt);
    const sp = this.vel.length();
    if (sp > 1e-6) {
      const dec = (s.rollDecel + s.rollDrag * sp) * dt;
      if (dec >= sp) this.vel.set(0, 0, 0);
      else this.vel.multiplyScalar((sp - dec) / sp);
    }
    // Residual backspin while rolling makes it "grab" (check) briefly; decay spin toward rolling.
    const rollSpin = tmpB.crossVectors(n, this.vel).multiplyScalar(1 / r);
    this.spin.lerp(rollSpin, Math.min(1, dt * 12));

    const prev = tmpC.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    const world = this.opts.world;
    if (world) {
      const hit = world.sweep(prev, this.pos, r);
      if (hit) this.resolveObstacle(hit, prev);
    }
    const h = T.height(this.pos.x, this.pos.z);
    if (this.pos.y - r < h + 0.02) {
      // Stay glued to the surface.
      this.pos.y = h + r;
    } else {
      // Terrain drops away faster than the ball follows: it becomes airborne.
      this.state = 'flight';
    }
  }

  private resolveObstacle(hit: ObstacleHit, prev: Vector3) {
    const speed = this.vel.length();
    this.emit({ type: 'object', pos: hit.point.clone(), speed, id: hit.id });
    this.opts.world?.onBallHit?.(hit, this.vel.clone());
    const rng = this.opts.rng ?? Math.random;
    if (hit.soft) {
      // Canopy: lose a random amount of speed and get deflected.
      const keep = 0.25 + rng() * 0.35;
      this.vel.multiplyScalar(keep);
      this.vel.x += (rng() - 0.5) * speed * 0.3;
      this.vel.z += (rng() - 0.5) * speed * 0.3;
      this.vel.y = Math.min(this.vel.y, 0) - rng() * 1.5;
      this.spin.multiplyScalar(0.3);
      return;
    }
    const n = hit.normal;
    const vn = this.vel.dot(n);
    if (vn < 0) {
      const vt = tmpB.copy(this.vel).addScaledVector(n, -vn);
      this.vel.copy(vt.multiplyScalar(1 - hit.friction * 0.5)).addScaledVector(n, -vn * hit.restitution);
      this.spin.multiplyScalar(0.5);
    }
    // Move to contact point, pushed out along the normal.
    this.pos.copy(hit.point).addScaledVector(n, PHYS.ballRadius + 0.002);
    if (this.state === 'rolling' && this.vel.y > 1) this.state = 'flight';
    void prev;
  }

  private checkCup(): boolean {
    const cup = this.opts.cup!;
    const dx = this.pos.x - cup.x;
    const dz = this.pos.z - cup.z;
    const d = Math.hypot(dx, dz);
    if (d > PHYS.cupRadius) return false;
    const ground = this.opts.terrain.height(this.pos.x, this.pos.z);
    if (this.pos.y - PHYS.ballRadius > ground + 0.03) return false; // flying over
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // Effective capture speed depends on how centred the ball is.
    const centred = 1 - d / PHYS.cupRadius;
    const capture = PHYS.cupCaptureSpeed * (0.45 + 0.75 * centred);
    if (sp < capture || this.state === 'flight' && this.vel.y < 0 && sp < capture * 2.2) {
      this.pos.set(cup.x, ground - 0.06, cup.z);
      this.vel.set(0, 0, 0);
      this.spin.set(0, 0, 0);
      this.state = 'holed';
      this.trail.push(this.pos.clone());
      this.emit({ type: 'holed', pos: this.pos.clone(), speed: sp });
      return true;
    }
    // Lip: deflect a bit and slow.
    if (this.state === 'rolling') {
      const toC = tmpA.set(-dx, 0, -dz).normalize();
      this.vel.addScaledVector(toC, sp * 0.15).multiplyScalar(0.92);
      this.emit({ type: 'lipout', pos: this.pos.clone(), speed: sp });
    }
    return false;
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function smooth(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Convenience: an infinite flat terrain with one surface (tests, range). */
export class FlatTerrain implements TerrainQuery {
  constructor(
    public surf: SurfaceId = 'fairway',
    public slope = new Vector3(0, 0, 0),
  ) {}
  height(x: number, z: number) {
    return this.slope.x * x + this.slope.z * z;
  }
  normal(_x: number, _z: number, out: Vector3) {
    return out.set(-this.slope.x, 1, -this.slope.z).normalize();
  }
  surface() {
    return this.surf;
  }
  waterHeight() {
    return null;
  }
  isOOB() {
    return false;
  }
}

export { UP };
