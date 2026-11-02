/**
 * Effects: shot tracer, divots, sand/water splash, landing puffs, grass clippings, strike flash
 * and ambient wind particles (pollen / seed fluff near the camera).
 *
 * Everything is pooled and preallocated; per frame there are no allocations. Draw calls:
 * ≤ 4 tracer ribbons (only visible ones), 1 particle sprite pool, 1 turf-chunk InstancedMesh,
 * 1 decal InstancedMesh, 1 wind-mote Points — all inside one group named 'fx' (excluded from
 * the water's planar reflection).
 *
 * Dev hook: `?fxtest=1` (tee view: tracers + divot + strike flash) or `?fxtest=2` (splashes and
 * puffs in front of the camera, water splash on the nearest water along the view).
 */
import * as THREE from 'three';
import type { Course } from '../course/Course';
import { globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';
import { ChunkPool } from './fx/Chunks';
import { updateFxScreen } from './fx/common';
import { DECAL_DIVOT, DECAL_RIPPLE, DECAL_SAND, DecalPool } from './fx/Decals';
import { PF_ADD, PF_GROUND, PF_SETTLE, PF_WIND, ParticlePool, SHAPE_DROP, SHAPE_FLAKE, SHAPE_GRAIN, SHAPE_SOFT, SHAPE_SPARK } from './fx/Particles';
import { TracerRibbon } from './fx/Tracer';
import { WindMotes } from './fx/WindMotes';
import { HOLES } from '../course/layout';

export type TracerStyle = 'draw' | 'fade' | 'straight';

// ---- tuning -------------------------------------------------------------------------------
/** Tracer colours (linear, pre-intensity). */
const TRACER_COLORS: Record<TracerStyle, THREE.Color> = {
  draw: new THREE.Color(0.25, 0.6, 1.0),
  fade: new THREE.Color(1.0, 0.45, 0.12),
  straight: new THREE.Color(0.95, 0.93, 0.9),
};
/** Number of ribbons (current + ghosts) and the dimming of ghosts once a newer shot starts. */
const TRACER_COUNT = 4;
const GHOST_DIM = 0.4;
const PARTICLE_MAX = 3000;
const CHUNK_MAX = 160;
const DECAL_MAX = 48;
/** Particle budget multiplier and wind-mote count per quality. */
const FX_SCALE: Record<QualityPreset['level'], number> = { low: 0.45, medium: 0.75, high: 1, ultra: 1.25 };
const MOTES: Record<QualityPreset['level'], number> = { low: 0, medium: 160, high: 280, ultra: 420 };
const MOTES_MAX = 420;
/** Decal lifetimes (s). */
const DIVOT_LIFE = 240;
const SAND_LIFE = 60;
const RIPPLE_LIFE = 3.2;
/** Fraction of the wind speed that small debris drifts with (near-ground air is slower). */
const DEBRIS_WIND = 0.6;

// colours (linear)
const SAND = [0.62, 0.5, 0.33];
const SAND_DUST = [0.72, 0.62, 0.45];
const SOIL_DUST = [0.2, 0.15, 0.1];
const CLIP_A = [0.12, 0.26, 0.05];
const CLIP_B = [0.2, 0.33, 0.08];
const WATER_DROP = [0.75, 0.82, 0.86];
const MIST = [0.85, 0.88, 0.9];

const rnd = (a: number, b: number) => a + (b - a) * Math.random();

export class Effects implements RenderModule {
  group = new THREE.Group();
  private tracers: TracerRibbon[] = [];
  private tracerSerial = 0;
  private current: TracerRibbon | null = null;
  private particles = new ParticlePool(PARTICLE_MAX);
  private chunks = new ChunkPool(CHUNK_MAX);
  private decals = new DecalPool(DECAL_MAX);
  private motes: WindMotes | null = null;
  private course: Course | null = null;
  private scale = 1;
  private normal = new THREE.Vector3();
  private v = new THREE.Vector3();
  private size = new THREE.Vector2();
  private testMode: string | null = null;
  private testDone = false;

  init(ctx: InitContext) {
    this.course = ctx.course;
    this.group.name = 'fx';
    for (let i = 0; i < TRACER_COUNT; i++) {
      const t = new TracerRibbon();
      this.tracers.push(t);
      this.group.add(t.mesh);
    }
    const ground = (x: number, z: number) => ctx.course.height(x, z);
    this.particles.ground = ground;
    this.chunks.ground = ground;
    this.motes = new WindMotes(MOTES_MAX, ctx.textures);
    this.group.add(this.decals.mesh, this.chunks.mesh, this.particles.points, this.motes.points);
    ctx.scene.add(this.group);
    this.setQuality(ctx.quality);
    if (typeof location !== 'undefined') this.testMode = new URLSearchParams(location.search).get('fxtest');
  }

  setQuality(q: QualityPreset) {
    this.scale = FX_SCALE[q.level];
    this.motes?.setCount(MOTES[q.level]);
  }

  update(ctx: FrameContext) {
    ctx.renderer.getDrawingBufferSize(this.size);
    updateFxScreen(ctx.camera, this.size.y || 720);
    if (this.testMode && !this.testDone) this.runTest(ctx);
    const dt = Math.min(ctx.dt, 0.1);
    this.step(dt);
    this.motes?.update(dt);
  }

  private step(dt: number) {
    const w = globalUniforms.uWindDir.value;
    const ws = globalUniforms.uWindSpeed.value * DEBRIS_WIND;
    this.particles.windX = w.x * ws;
    this.particles.windZ = w.y * ws;
    for (const t of this.tracers) t.update(dt);
    this.particles.step(dt);
    this.particles.upload();
    this.chunks.step(dt);
    this.chunks.upload();
  }

  // ---- tracer --------------------------------------------------------------------------------

  /** Begin a new tracer at the ball's launch position. Previous tracer becomes a fading ghost. */
  tracerStart(pos: THREE.Vector3, style: TracerStyle) {
    for (const t of this.tracers) {
      if (t.state === 'idle') continue;
      t.ghost *= GHOST_DIM;
      t.end();
    }
    // Recycle an idle ribbon, else the oldest.
    let pick: TracerRibbon | null = null;
    for (const t of this.tracers) if (t.state === 'idle' && (!pick || t.serial < pick.serial)) pick = t;
    if (!pick) for (const t of this.tracers) if (!pick || t.serial < pick.serial) pick = t;
    this.current = pick!;
    this.current.start(pos, TRACER_COLORS[style] ?? TRACER_COLORS.straight, ++this.tracerSerial);
  }

  /** Append the ball's current position (called every frame during flight/roll). */
  tracerPush(pos: THREE.Vector3) {
    this.current?.push(pos);
  }

  /** Ball stopped: tracer stays visible and fades slowly over ~10 s. */
  tracerEnd() {
    this.current?.end();
  }

  clearTracers() {
    for (const t of this.tracers) t.clear();
    this.current = null;
  }

  /** Remove every transient effect (hole change, retake). */
  clearAll() {
    this.clearTracers();
    this.particles.clear();
    this.chunks.clear();
    this.decals.clear();
  }

  // ---- bursts --------------------------------------------------------------------------------

  private n(count: number) {
    return Math.max(1, Math.round(count * this.scale));
  }

  private groundNormal(x: number, z: number) {
    if (this.course) this.course.normal(x, z, this.normal);
    else this.normal.set(0, 1, 0);
    return this.normal;
  }

  /** Divot / turf spray at impact. dir = horizontal shot direction. size 0..1. */
  divot(pos: THREE.Vector3, dir: THREE.Vector3, size: number) {
    const s = 0.4 + 0.6 * THREE.MathUtils.clamp(size, 0, 1);
    const dx = dir.x, dz = dir.z;
    const dl = Math.hypot(dx, dz) || 1;
    const fx = dx / dl, fz = dz / dl;
    const gy = this.course ? this.course.height(pos.x, pos.z) : pos.y;
    // Scar decal, starting at the ball and extending along the shot line.
    const yaw = Math.atan2(fx, fz);
    const len = 0.22 + 0.2 * s;
    const cx = pos.x + fx * len * 0.45, cz = pos.z + fz * len * 0.45;
    this.decals.spawn(DECAL_DIVOT, cx, this.course ? this.course.height(cx, cz) : gy, cz, this.groundNormal(cx, cz), yaw, 0.09 + 0.06 * s, len, globalUniforms.uTime.value, DIVOT_LIFE);
    // The main turf piece + clods.
    const sp = 4 + 4 * s;
    this.chunks.spawn(pos.x, gy + 0.03, pos.z, fx * sp * rnd(0.8, 1.1), rnd(2.5, 4.5) * s + 1, fz * sp * rnd(0.8, 1.1), 0.08 * s + 0.04, 0.025, 0.14 * s + 0.05, 18, 1);
    const clods = this.n(6 + 10 * s);
    for (let i = 0; i < clods; i++) {
      const a = rnd(-0.5, 0.5);
      const ca = Math.cos(a), sa = Math.sin(a);
      const vx = (fx * ca - fz * sa) * sp * rnd(0.4, 1.1);
      const vz = (fz * ca + fx * sa) * sp * rnd(0.4, 1.1);
      const e = rnd(0.012, 0.035) * (0.6 + s * 0.6);
      this.chunks.spawn(pos.x, gy + 0.02, pos.z, vx, rnd(1.5, 4.5), vz, e, e * 0.7, e * rnd(0.8, 1.4), 25, rnd(0.8, 1.15));
    }
    // Soil dust.
    const dust = this.n(8 + 10 * s);
    for (let i = 0; i < dust; i++) {
      this.particles.spawn(pos.x + rnd(-0.05, 0.05), gy + 0.05, pos.z + rnd(-0.05, 0.05),
        fx * rnd(1, 3) + rnd(-0.6, 0.6), rnd(0.4, 1.6), fz * rnd(1, 3) + rnd(-0.6, 0.6),
        rnd(0.8, 1.7), 0.06, rnd(0.35, 0.7) * s, SOIL_DUST[0], SOIL_DUST[1], SOIL_DUST[2], 0.35, 2.8, 0.2, PF_WIND, SHAPE_SOFT);
    }
    this.clippings(pos.x, gy + 0.03, pos.z, fx, fz, this.n(20 + 30 * s), 2 + 3 * s);
  }

  /** Grass clippings spray (also used by landing puffs in the rough). */
  grassClippings(pos: THREE.Vector3, dir: THREE.Vector3, amount: number) {
    const dl = Math.hypot(dir.x, dir.z) || 1;
    this.clippings(pos.x, pos.y, pos.z, dir.x / dl, dir.z / dl, this.n(10 + 40 * amount), 1.5 + 3 * amount);
  }

  private clippings(x: number, y: number, z: number, fx: number, fz: number, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const c = Math.random() < 0.5 ? CLIP_A : CLIP_B;
      const a = rnd(-0.9, 0.9);
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp = speed * rnd(0.3, 1.1);
      this.particles.spawn(x, y, z, (fx * ca - fz * sa) * sp, rnd(1.0, 3.5), (fz * ca + fx * sa) * sp,
        rnd(1.6, 3.2), rnd(0.03, 0.05), rnd(0.03, 0.05), c[0], c[1], c[2], 1, 1.6, 2.4, PF_WIND | PF_SETTLE, SHAPE_FLAKE, rnd(-14, 14));
    }
  }

  sandSplash(pos: THREE.Vector3, strength: number) {
    const s = THREE.MathUtils.clamp(strength, 0.05, 1);
    const gy = this.course ? this.course.height(pos.x, pos.z) : pos.y;
    this.decals.spawn(DECAL_SAND, pos.x, gy, pos.z, this.groundNormal(pos.x, pos.z), Math.random() * 6.28, 0.5 + 0.7 * s, 0.5 + 0.7 * s, globalUniforms.uTime.value, SAND_LIFE);
    // Grain spray in a cone.
    const grains = this.n(50 + 130 * s);
    for (let i = 0; i < grains; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.4, 2.6) * (0.5 + s);
      const k = rnd(0.85, 1.1);
      this.particles.spawn(pos.x, gy + 0.03, pos.z, Math.cos(a) * h, rnd(2, 6) * (0.4 + s), Math.sin(a) * h,
        rnd(0.9, 1.6), rnd(0.012, 0.03), rnd(0.012, 0.03), SAND[0] * k, SAND[1] * k, SAND[2] * k, 1, 0.5, 9.8, PF_GROUND, SHAPE_GRAIN);
    }
    // Lingering dust cloud.
    const dust = this.n(10 + 18 * s);
    for (let i = 0; i < dust; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.3, 1.4) * (0.4 + s);
      this.particles.spawn(pos.x + Math.cos(a) * 0.1, gy + rnd(0.05, 0.25), pos.z + Math.sin(a) * 0.1, Math.cos(a) * h, rnd(0.6, 2.2) * (0.4 + s), Math.sin(a) * h,
        rnd(1.8, 3.6), 0.15, rnd(0.7, 1.5) * (0.5 + s), SAND_DUST[0], SAND_DUST[1], SAND_DUST[2], 0.32, 2.2, 0.15, PF_WIND, SHAPE_SOFT);
    }
  }

  waterSplash(pos: THREE.Vector3, strength: number) {
    const s = THREE.MathUtils.clamp(strength, 0.05, 1);
    const level = this.course?.waterHeight(pos.x, pos.z) ?? pos.y;
    const t0 = globalUniforms.uTime.value;
    const up = this.v.set(0, 1, 0);
    // Ring ripples (staggered).
    const R = 3 + 5 * s;
    for (let i = 0; i < 3; i++) this.decals.spawn(DECAL_RIPPLE, pos.x, level, pos.z, up, 0, R * (1 - i * 0.15) * 2, R * (1 - i * 0.15) * 2, t0 + i * 0.28, RIPPLE_LIFE);
    // Crown: droplets thrown out and up in a ring.
    const crown = this.n(50 + 90 * s);
    for (let i = 0; i < crown; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.8, 2.4) * (0.5 + s);
      this.particles.spawn(pos.x + Math.cos(a) * 0.12, level + 0.02, pos.z + Math.sin(a) * 0.12, Math.cos(a) * h, rnd(2.0, 4.8) * (0.5 + s), Math.sin(a) * h,
        rnd(0.9, 1.6), rnd(0.04, 0.08), rnd(0.025, 0.05), WATER_DROP[0], WATER_DROP[1], WATER_DROP[2], 0.9, 0.3, 9.8, PF_GROUND, SHAPE_DROP, 0, level);
    }
    // Central jet (Worthington column).
    const jet = this.n(16 + 26 * s);
    for (let i = 0; i < jet; i++) {
      this.particles.spawn(pos.x + rnd(-0.06, 0.06), level, pos.z + rnd(-0.06, 0.06), rnd(-0.35, 0.35), rnd(3.5, 7.5) * (0.4 + s), rnd(-0.35, 0.35),
        rnd(1.0, 1.8), rnd(0.05, 0.09), 0.03, WATER_DROP[0], WATER_DROP[1], WATER_DROP[2], 0.95, 0.2, 9.8, PF_GROUND, SHAPE_DROP, 0, level);
    }
    // Mist / spray haze.
    const mist = this.n(5 + 8 * s);
    for (let i = 0; i < mist; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.3, 1.2);
      this.particles.spawn(pos.x, level + rnd(0.1, 0.5), pos.z, Math.cos(a) * h, rnd(0.8, 2.5) * s + 0.3, Math.sin(a) * h,
        rnd(1.0, 2.0), 0.15, rnd(0.5, 1.1) * (0.5 + s), MIST[0], MIST[1], MIST[2], 0.1, 2.5, 0.3, PF_WIND, SHAPE_SOFT);
    }
  }

  /** Little puff where the ball lands, by surface. */
  landPuff(pos: THREE.Vector3, surface: string, strength: number) {
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    switch (surface) {
      case 'sand':
        this.sandSplash(pos, s * 0.7);
        return;
      case 'water':
        this.waterSplash(pos, s);
        return;
      default:
        break;
    }
    const gy = this.course ? this.course.height(pos.x, pos.z) : pos.y;
    let col = [0.42, 0.45, 0.3];
    let puffs = 4;
    let size = 0.35;
    let alpha = 0.22;
    let clips = 0;
    if (surface === 'green' || surface === 'fringe') { puffs = 3; size = 0.25; alpha = 0.12; col = [0.6, 0.65, 0.55]; clips = 0; }
    else if (surface === 'fairway' || surface === 'tee') { puffs = 5; clips = 8; }
    else if (surface === 'rough') { puffs = 6; clips = 20; col = [0.35, 0.4, 0.22]; }
    else if (surface === 'deepRough') { puffs = 6; clips = 34; col = [0.32, 0.36, 0.2]; }
    else if (surface === 'path') { puffs = 7; col = [0.55, 0.53, 0.5]; size = 0.4; alpha = 0.3; }
    else if (surface === 'dirt') { puffs = 10; col = SOIL_DUST.map((c) => c * 1.8); size = 0.5; alpha = 0.35; }
    const n = this.n(puffs * (0.4 + s));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = rnd(0.3, 1.2) * (0.3 + s);
      this.particles.spawn(pos.x, gy + 0.05, pos.z, Math.cos(a) * h, rnd(0.3, 1.2) * (0.3 + s), Math.sin(a) * h,
        rnd(0.8, 1.6), 0.08, size * (0.5 + s), col[0], col[1], col[2], alpha, 2.6, 0.1, PF_WIND, SHAPE_SOFT);
    }
    if (clips) {
      const m = this.n(clips * (0.3 + s));
      for (let i = 0; i < m; i++) {
        const a = Math.random() * Math.PI * 2;
        const c = Math.random() < 0.5 ? CLIP_A : CLIP_B;
        const h = rnd(0.3, 1.6) * (0.3 + s);
        this.particles.spawn(pos.x, gy + 0.03, pos.z, Math.cos(a) * h, rnd(1.0, 2.8) * (0.3 + s), Math.sin(a) * h,
          rnd(1.4, 2.6), rnd(0.03, 0.05), 0.04, c[0], c[1], c[2], 1, 1.6, 2.4, PF_WIND | PF_SETTLE, SHAPE_FLAKE, rnd(-12, 12));
      }
    }
  }

  /** Bright flash/sparkle at the clubface on a pure strike. quality 0..1. */
  impactFlash(pos: THREE.Vector3, quality: number) {
    const q = THREE.MathUtils.clamp(quality, 0, 1);
    if (q < 0.1) return;
    const I = 2.5 + 5 * q; // HDR → bloom
    this.particles.spawn(pos.x, pos.y + 0.02, pos.z, 0, 0, 0, 0.12 + 0.06 * q, 0.25 + 0.35 * q, 0.5 + 0.5 * q, I, I * 0.92, I * 0.8, 1, 0, 0, PF_ADD, SHAPE_SPARK, rnd(-2, 2));
    this.particles.spawn(pos.x, pos.y + 0.02, pos.z, 0, 0, 0, 0.2, 0.3, 0.9 * q, I * 0.5, I * 0.42, I * 0.3, 0.8, 0, 0, PF_ADD, SHAPE_SOFT);
    const sparks = this.n(4 + 14 * q * q);
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = rnd(-0.2, 1);
      const sp = rnd(3, 9) * q;
      const ce = Math.cos(e);
      this.particles.spawn(pos.x, pos.y + 0.02, pos.z, Math.cos(a) * ce * sp, Math.sin(e) * sp + 1, Math.sin(a) * ce * sp,
        rnd(0.2, 0.45), rnd(0.015, 0.03), 0.008, I * 0.8, I * 0.65, I * 0.4, 1, 5, 4, PF_ADD, SHAPE_SOFT);
    }
  }

  // ---- dev test hook -----------------------------------------------------------------------

  private runTest(ctx: FrameContext) {
    this.testDone = true;
    const course = ctx.course;
    const at = (x: number, z: number, up = 0) => new THREE.Vector3(x, course.height(x, z) + up, z);
    if (this.testMode === '1') {
      const h = HOLES[0];
      const tee = at(h.tee[0], h.tee[1], 0.05);
      const aim = new THREE.Vector3(h.fairway[2][0] - h.tee[0], 0, h.fairway[2][1] - h.tee[1]).normalize();
      const right = new THREE.Vector3(-aim.z, 0, aim.x);
      const arc = (style: TracerStyle, carry: number, apex: number, bend: number, upto: number, end: boolean) => {
        this.tracerStart(tee, style);
        const p = new THREE.Vector3();
        for (let u = 0.004; u <= upto; u += 0.004) {
          // Asymmetric ball-flight shape: fast rise, steeper descent (drag).
          const sx = carry * (1 - Math.pow(1 - u, 1.35));
          const y = apex * Math.sin(Math.PI * Math.pow(u, 0.78));
          const lat = bend * u * u * carry;
          p.copy(tee).addScaledVector(aim, sx).addScaledVector(right, lat);
          p.y = tee.y + y;
          const gy = course.height(p.x, p.z);
          if (p.y < gy + 0.02) p.y = gy + 0.02;
          this.tracerPush(p);
        }
        if (end) this.tracerEnd();
      };
      arc('straight', 205, 26, 0.01, 1, true);
      arc('fade', 225, 31, 0.07, 1, true);
      arc('draw', 240, 34, -0.08, 0.72, false);
      this.impactFlash(tee, 1);
      this.divot(at(h.tee[0] - 1.6, h.tee[1] - 3.2), aim, 0.9);
      this.preSim(0.18);
    } else {
      const cam = ctx.camera;
      const fwd = cam.getWorldDirection(new THREE.Vector3());
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const spot = (d: number, l: number) => at(cam.position.x + fwd.x * d + right.x * l, cam.position.z + fwd.z * d + right.z * l);
      // Water splash on the first water along the view direction.
      for (let d = 6; d < 80; d += 1) {
        const p = spot(d + 6, 1.5);
        if (course.waterHeight(p.x, p.z) !== null) {
          this.waterSplash(p, 1);
          break;
        }
      }
      const dry = (d: number, l: number) => {
        const p = spot(d, l);
        return course.waterHeight(p.x, p.z) === null ? p : null;
      };
      const a = dry(7, -2.2);
      if (a) this.sandSplash(a, 0.9);
      const b = dry(4.5, 1.4);
      if (b) this.divot(b, fwd, 1);
      const c = dry(5.5, -0.6);
      if (c) this.landPuff(c, 'rough', 1);
      this.preSim(0.3);
    }
  }

  private preSim(t: number) {
    for (let s = 0; s < t; s += 1 / 60) this.step(1 / 60);
  }

  dispose() {
    for (const t of this.tracers) t.dispose();
    this.particles.dispose();
    this.chunks.dispose();
    this.decals.dispose();
    this.motes?.dispose();
    this.group.removeFromParent();
  }
}
