/**
 * Props & physics objects: the golf ball, pins/flags/cups for every hole, tee furniture (markers,
 * signs, ball washers, benches), parked carts, the out-of-bounds fence, the clubhouse, and the
 * hittable Rapier props (gongs, targets, crates, breakable pots, scarecrows, hay bales).
 *
 * Implements CollisionWorld for the ball simulation: sweep() tests a swept sphere against static
 * primitives (trees, buildings, signs, fence, flagsticks…) in a spatial hash plus the live
 * primitives of the dynamic props; onBallHit() turns hits into Rapier impulses and fires
 * onPropHit for sounds/UI.
 *
 * Draw-call budget: static props are merged per material per cluster (tee, green, site,
 * clubhouse, fence chunk) and distance-culled by quality; flags are one mesh each, flagsticks one
 * instanced mesh, dynamic props one instanced mesh per type.
 */
import * as THREE from 'three';
import type { CollisionWorld, ObstacleHit } from '../physics/BallSim';
import type { Course } from '../course/Course';
import { HOLES, LANDMARKS } from '../course/layout';
import { StaticIndex, SweepAccumulator, makePrimitive, type Primitive } from '../props/collision';
import { PROP_SITES } from '../props/sites';
import type { TreeCollider } from './Trees';
import { globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';
import { BallVisual } from './props/ball';
import { GeoBucket } from './props/builder';
import { buildClubhouse } from './props/clubhouse';
import { DynamicProps } from './props/dynamic';
import { FlagSet, PIN_HEIGHT, PIN_RADIUS, type PinSpec } from './props/flags';
import { Frame, yawToward, type AddCollider, type Cluster, type PrimInit } from './props/frame';
import { bench, cart, fenceChunks, holeSign, teeClusters } from './props/furniture';
import { createPropMaterials, type PropMaterials } from './props/materials';

export interface PropHitEvent {
  id: string;
  kind: string;
  pos: THREE.Vector3;
  speed: number;
  /** Momentum delivered to the prop (N·s), when it is a physics prop. */
  impulse?: number;
  /** A breakable prop shattered. */
  broken?: boolean;
  /** Target ring score 0..10 (targets only). */
  score?: number;
}

/** Tunables */
const CULL_SMALL: Record<QualityPreset['level'], number> = { low: 170, medium: 280, high: 420, ultra: 650 };
const FENCE_CULL_FACTOR = 1.6;
const EVENT_REPEAT_S = 0.3; // min time between events for the same prop id
const TREE_RESTITUTION = 0.45;
const CANOPY_SHRINK = 0.85; // canopy collision sphere vs visual radius
const WINDOW_GLOW = { day: 0.25, low: 2.4 };
const LAMP_GLOW = { day: 0.4, low: 3.2 };

const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

export class Props implements RenderModule, CollisionWorld {
  readonly perfName = 'props';
  /** The golf ball mesh (position set by the game every frame). */
  ball = new THREE.Group();
  /** Called by the game when the ball hits a prop (for sounds/score). */
  onPropHit: ((e: PropHitEvent) => void) | null = null;

  readonly root = new THREE.Group();
  private statics = new StaticIndex(8);
  private acc = new SweepAccumulator();
  private lastHit: Primitive | null = null;
  private lastEvent = new Map<string, number>();
  private time = 0;
  private mats: PropMaterials | null = null;
  private disposeMats: (() => void) | null = null;
  private ballVis: BallVisual | null = null;
  private flags: FlagSet | null = null;
  private dyn: DynamicProps | null = null;
  private clusters: Cluster[] = [];
  private flagPrims: (Primitive | null)[] = [];
  private activeHole = 0;
  private flagOut = false;
  private pendingTrees: TreeCollider[] | null = null;
  private ready = false;
  /** Resolves once Rapier is initialised and the dynamic props are simulated. */
  physicsReady: Promise<void> = Promise.resolve();
  private scene: THREE.Scene | null = null;

  init(ctx: InitContext) {
    const course = ctx.course;
    this.scene = ctx.scene;
    this.root.name = 'props';
    ctx.scene.add(this.root);
    const { mats, tex, dispose } = createPropMaterials();
    this.mats = mats;
    this.disposeMats = dispose;
    const col: AddCollider = (p: PrimInit) => {
      const prim = makePrimitive(p);
      this.statics.add(prim);
      return prim;
    };

    // Ball
    this.ballVis = new BallVisual(this.ball, course);
    ctx.scene.add(this.ball);
    ctx.scene.add(this.ballVis.shadowMesh);

    // Pins, flags and cups
    const pg = LANDMARKS.practiceGreen.c;
    const specs: PinSpec[] = HOLES.map((h, i) => ({ cell: i, x: h.pin[0], z: h.pin[1] }));
    specs.push({ cell: 9, x: pg[0] + 1.5, z: pg[1] - 1, short: true });
    specs.push({ cell: 9, x: pg[0] - 4.5, z: pg[1] + 2.5, short: true });
    specs.push({ cell: 9, x: pg[0] + 4, z: pg[1] + 3.5, noFlag: true });
    this.flags = new FlagSet(course, specs, tex.flags);
    this.root.add(this.flags.group);
    this.flagPrims = this.flags.pins.map((p, i) =>
      p.spec.noFlag
        ? null
        : col({ id: i < HOLES.length ? `flagstick${i + 1}` : `practice-pin${i}`, kind: 'flagstick', shape: 'vcyl', center: p.base.clone().setY(p.base.y - 0.1), radius: PIN_RADIUS, height: (p.spec.short ? 0.9 : PIN_HEIGHT) + 0.1, restitution: 0.3, friction: 0.12 }),
    );

    // Tee furniture
    for (const t of teeClusters(course, col)) this.addCluster(t.bucket, t.center, t.radius, 'small');

    // Clubhouse (front faces the practice green / first tee) with carts and the practice-green kit.
    const cc = LANDMARKS.clubhouse.c;
    const club = buildClubhouse(course, cc[0], cc[1], yawToward(-90, -50) + LANDMARKS.clubhouse.rot * 0.1, col);
    this.addCluster(club.bucket, club.center, club.radius, 'large');
    {
      const b = new GeoBucket();
      const f = club.frame;
      for (const [lx, lz, dyaw, body] of [[-15.5, 12.5, 0.1, '#ece8dc'], [-18.2, 12.2, 0.05, '#dfe6e0']] as [number, number, number, string][]) {
        const w = f.world(lx, 0, lz);
        this.placeCart(b, course, w.x, w.z, f.yaw + Math.PI + dyaw, col, `cart-club${lx}`, body);
      }
      // Practice green sign and bench.
      {
        const x = pg[0] + 12;
        const z = pg[1] - 6;
        holeSign(b, new Frame(x, course.height(x, z), z, yawToward(10, -4)), 10, col, 'practice-sign', (px, pz) => course.height(px, pz));
        const bx = pg[0] + 11;
        const bz = pg[1] + 6;
        bench(b, new Frame(bx, course.height(bx, bz), bz, yawToward(-1, 0)), col, 'practice-bench');
      }
      this.addCluster(b, new THREE.Vector3(pg[0] + 30, course.height(pg[0], pg[1]), pg[1] + 10), 45, 'small');
    }
    // A cart parked on the path between holes 4 and 5.
    {
      const b = new GeoBucket();
      this.placeCart(b, course, -152, -664, yawToward(1, 0.45), col, 'cart-h5', '#ece8dc');
      this.addCluster(b, new THREE.Vector3(-152, course.height(-152, -664), -664), 5, 'small');
    }

    // Out-of-bounds fence
    for (const fc of fenceChunks(course, col, true)) this.addCluster(fc.bucket, fc.center, fc.radius, 'fence');

    // Hittable Rapier props
    this.dyn = new DynamicProps(course, mats, col, PROP_SITES);
    this.root.add(this.dyn.group);
    for (const s of this.dyn.staticBuckets) this.addCluster(s.bucket, s.center, s.radius, 'small');
    this.dyn.onBreak = (e) => this.emit({ id: e.id, kind: e.kind, pos: e.pos, speed: e.speed, broken: true });
    this.physicsReady = this.dyn.initPhysics().catch((e) => console.warn('[props] Rapier unavailable; dynamic props stay static', e));

    this.ready = true;
    if (this.pendingTrees) this.setTreeColliders(this.pendingTrees);
    this.applyQuality(ctx.quality);
  }

  private placeCart(b: GeoBucket, course: Course, x: number, z: number, yaw: number, col: AddCollider, id: string, body: string) {
    // Tilt onto the ground using the wheel-base heights.
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const hF = course.height(x + fx * 0.8, z + fz * 0.8);
    const hB = course.height(x - fx * 0.8, z - fz * 0.8);
    const hR = course.height(x + fz * 0.56, z - fx * 0.56);
    const hL = course.height(x - fz * 0.56, z + fx * 0.56);
    const pitch = -Math.atan2(hF - hB, 1.6);
    const roll = Math.atan2(hL - hR, 1.12);
    cart(b, new Frame(x, (hF + hB + hR + hL) / 4 - 0.01, z, yaw, pitch, roll), col, id, body);
  }

  private addCluster(bucket: GeoBucket, center: THREE.Vector3, radius: number, size: Cluster['size']) {
    if (bucket.isEmpty() || !this.mats) return;
    const group = bucket.build(this.mats, { castShadow: true, receiveShadow: true, name: `props-${size}` });
    group.updateMatrixWorld(true);
    // Tighten the cull radius to the merged geometry.
    let r = radius;
    for (const m of group.children as THREE.Mesh[]) {
      const bs = m.geometry.boundingSphere;
      if (bs) r = Math.max(r, bs.center.distanceTo(center) + bs.radius);
    }
    this.root.add(group);
    this.clusters.push({ group, center, radius: r, size });
  }

  update(ctx: FrameContext) {
    if (!this.ready) return;
    const dt = Math.min(ctx.dt, 0.1);
    this.time += dt;
    this.flags?.update(ctx.time, dt);
    this.dyn?.update(dt);
    // Distance culling of static clusters.
    const cam = ctx.camera.position;
    const lim = CULL_SMALL[ctx.quality.level];
    if (this.dyn) {
      ctx.camera.updateMatrixWorld();
      _pv.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
      this.dyn.cull(_frustum, cam, lim, ctx.quality.shadowDistance);
    }
    for (const c of this.clusters) {
      const d = c.center.distanceTo(cam) - c.radius;
      c.group.visible = c.size === 'large' ? d < ctx.quality.drawDistance : d < (c.size === 'fence' ? lim * FENCE_CULL_FACTOR : lim);
    }
    // Warm window glow strongest when the sun is low.
    if (this.mats) {
      const sy = globalUniforms.uSunDir.value.y;
      const low = 1 - THREE.MathUtils.smoothstep(sy, 0.06, 0.55);
      this.mats.glass.emissiveIntensity = THREE.MathUtils.lerp(WINDOW_GLOW.day, WINDOW_GLOW.low, low);
      this.mats.lamp.emissiveIntensity = THREE.MathUtils.lerp(LAMP_GLOW.day, LAMP_GLOW.low, low);
    }
  }

  setQuality(q: QualityPreset) {
    this.applyQuality(q);
  }

  private applyQuality(q: QualityPreset) {
    // Small props only cast shadows from medium up (they are tiny in a 1024 shadow map).
    const smallShadows = q.level !== 'low';
    for (const c of this.clusters) {
      if (c.size === 'large') continue;
      for (const m of c.group.children) m.castShadow = smallShadows && c.size !== 'fence';
    }
    if (this.dyn) for (const m of this.dyn.group.children) m.castShadow = smallShadows;
  }

  /** Tree colliders from Foliage (merged into sweeps): trunks are hard cylinders, canopies soft spheres. */
  setTreeColliders(c: TreeCollider[]) {
    if (!this.ready) {
      this.pendingTrees = c;
      return;
    }
    this.pendingTrees = null;
    this.statics.removeKind('tree');
    c.forEach((t, i) => {
      this.statics.add(makePrimitive({ id: `tree${i}`, kind: 'tree', shape: 'vcyl', center: new THREE.Vector3(t.x, t.y - 0.3, t.z), radius: t.trunkRadius, height: t.trunkHeight + 0.3, restitution: TREE_RESTITUTION, friction: 0.35 }));
      if (t.canopyR > 0.3) this.statics.add(makePrimitive({ id: `tree${i}`, kind: 'tree', shape: 'sphere', center: new THREE.Vector3(t.x, t.y + t.canopyY, t.z), radius: t.canopyR * CANOPY_SHRINK, soft: true, restitution: 0.1, friction: 0.8 }));
    });
  }

  /** Highlight the active hole (flag visible etc.). */
  setActiveHole(index: number) {
    if (index === this.activeHole) return;
    if (this.flagOut) this.setFlagOut(false);
    this.activeHole = index;
  }

  /** Flag is pulled out when the ball is on the green & close (optional). */
  setFlagOut(out: boolean) {
    this.flagOut = out;
    this.flags?.setOut(this.activeHole, out);
    const prim = this.flagPrims[this.activeHole];
    if (prim) prim.enabled = !out;
  }

  setBall(pos: THREE.Vector3, spin?: THREE.Vector3, dt?: number) {
    if (this.ballVis) this.ballVis.set(pos, spin, dt);
    else this.ball.position.copy(pos);
  }

  sweep(a: THREE.Vector3, b: THREE.Vector3, r: number): ObstacleHit | null {
    const acc = this.acc;
    acc.reset();
    this.statics.forEachNear(a, b, r, (p) => acc.test(p, a, b, r));
    this.dyn?.forEachPrim((p) => acc.test(p, a, b, r));
    const prim = acc.best;
    if (!prim) return null;
    this.lastHit = prim;
    const res = acc.result;
    return {
      point: res.point.clone(),
      normal: res.normal.clone(),
      restitution: prim.restitution,
      friction: prim.friction,
      soft: prim.soft,
      id: prim.id,
    };
  }

  onBallHit(hit: ObstacleHit, v: THREE.Vector3) {
    const prim = this.lastHit && this.lastHit.id === hit.id ? this.lastHit : null;
    if (!prim) return;
    const speed = v.length();
    const ev: PropHitEvent = { id: prim.id, kind: prim.kind, pos: hit.point.clone(), speed };
    if (prim.tag !== undefined && this.dyn) {
      const info = this.dyn.applyHit(prim, hit.point, hit.normal, v);
      if (info) {
        ev.kind = info.kind;
        ev.impulse = info.impulse;
        ev.broken = info.broken;
        if (info.score !== undefined) ev.score = info.score;
      }
    }
    this.emit(ev);
  }

  private emit(ev: PropHitEvent) {
    const last = this.lastEvent.get(ev.id) ?? -1e9;
    if (!ev.broken && this.time - last < EVENT_REPEAT_S) return;
    this.lastEvent.set(ev.id, this.time);
    this.onPropHit?.(ev);
  }

  dispose() {
    this.dyn?.dispose();
    this.flags?.dispose();
    for (const c of this.clusters) for (const m of c.group.children as THREE.Mesh[]) m.geometry.dispose();
    this.disposeMats?.();
    this.scene?.remove(this.root, this.ball);
    if (this.ballVis) this.scene?.remove(this.ballVis.shadowMesh);
  }
}
