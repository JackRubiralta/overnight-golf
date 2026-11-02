/**
 * Per-frame renderer accounting. three's renderer.info only knows totals (and resets on every
 * renderer.render() call by default, so with a post-processing chain it reports just the last
 * full-screen pass). FrameStats turns autoReset off, resets once per frame and attributes every
 * renderer.render() call to a bucket:
 *
 *   main       the main scene from the main camera (opaque + transparent geometry)
 *   shadow     the sun shadow-map pass (rendered inside the main render)
 *   <module>   passes issued from a RenderModule's update(), e.g. 'sky' (cloud cube faces),
 *              'water' (planar reflection), 'foliage' …
 *   post       full-screen passes of the post chain (AO, bloom, DoF, SMAA …)
 *
 * The bookkeeping is a handful of integer subtractions per render() call.
 */
import * as THREE from 'three';

/** `?perfobjects`: also record per-object draw costs (debug only: patches Object3D.onBeforeRender). */
const RECORD_OBJECTS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perfobjects');

export interface ObjectCost {
  name: string;
  pass: string;
  calls: number;
  triangles: number;
}

export interface PassCost {
  calls: number;
  triangles: number;
}

export interface FrameStatsSnapshot {
  /** Whole frame, every pass. */
  calls: number;
  triangles: number;
  points: number;
  lines: number;
  /** Per-bucket costs (see file header). */
  passes: Record<string, PassCost>;
  geometries: number;
  textures: number;
  programs: number;
  /** CPU time of World.frame (ms; module updates + render submission). */
  cpuMs: number;
  /** Wall-clock time between frames (ms) and the smoothed fps. */
  frameMs: number;
  fps: number;
  /** Most expensive objects of the last frame (only with ?perfobjects). */
  objects?: ObjectCost[];
  /** Compiled programs (name, users, cache-key prefix; only with ?perfobjects). */
  programList?: string[];
}

export class FrameStats {
  private bucket = 'main';
  private passes: Record<string, PassCost> = {};
  private last: Record<string, PassCost> = {};
  private lastTotals = { calls: 0, triangles: 0, points: 0, lines: 0 };
  private shadowCalls = 0;
  private shadowTris = 0;
  private depth = 0;
  private frameStart = 0;
  private prevFrameAt = 0;
  private objects = new Map<string, ObjectCost>();
  private lastObjects: ObjectCost[] = [];
  private currentPass = 'main';
  cpuMs = 0;
  frameMs = 0;
  fps = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private mainScene: THREE.Scene,
    private mainCamera: THREE.Camera,
  ) {
    renderer.info.autoReset = false;
    if (RECORD_OBJECTS) this.installObjectRecorder();
    const info = renderer.info.render;
    const origRender = renderer.render.bind(renderer);
    renderer.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
      // Nested renders (e.g. a render issued from onBeforeRender) are attributed to the outer call.
      if (this.depth > 0) return origRender(scene, camera);
      const c0 = info.calls;
      const t0 = info.triangles;
      const name = scene === this.mainScene && camera === this.mainCamera ? 'main' : this.bucket === 'main' ? 'post' : this.bucket;
      this.shadowCalls = 0;
      this.shadowTris = 0;
      this.currentPass = name;
      this.depth++;
      try {
        origRender(scene, camera);
      } finally {
        this.depth--;
      }
      // The shadow pass runs inside this render: it was booked as 'shadow', don't count it twice.
      this.add(name, info.calls - c0 - this.shadowCalls, info.triangles - t0 - this.shadowTris);
    };
    const sm = renderer.shadowMap as THREE.WebGLShadowMap & { render: (...a: unknown[]) => void };
    const origShadow = sm.render.bind(sm);
    sm.render = (...args: unknown[]) => {
      const c0 = info.calls;
      const t0 = info.triangles;
      const prevPass = this.currentPass;
      this.currentPass = 'shadow';
      origShadow(...args);
      this.currentPass = prevPass;
      const dc = info.calls - c0;
      const dt = info.triangles - t0;
      if (!dc) return;
      this.shadowCalls += dc;
      this.shadowTris += dt;
      this.add('shadow', dc, dt);
    };
  }

  private installObjectRecorder() {
    const rec = (o: THREE.Object3D) => {
      const m = o as THREE.Mesh & { count?: number; isInstancedMesh?: boolean };
      const g = m.geometry as THREE.BufferGeometry | undefined;
      if (!g) return;
      const n = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
      const range = Math.min(n, g.drawRange.count) / 3;
      const inst = m.isInstancedMesh ? (m.count ?? 1) : ((g as THREE.InstancedBufferGeometry).instanceCount ?? 1);
      const tris = range * (Number.isFinite(inst) ? inst : 1);
      let name = o.name || o.type;
      if (o.parent && o.parent.name && o.parent.type !== 'Scene') name = `${o.parent.name}/${name}`;
      const key = `${this.currentPass}|${name}`;
      const c = this.objects.get(key) ?? { name, pass: this.currentPass, calls: 0, triangles: 0 };
      c.calls++;
      c.triangles += tris;
      this.objects.set(key, c);
    };
    THREE.Object3D.prototype.onBeforeRender = function (this: THREE.Object3D) {
      rec(this);
    };
    THREE.Object3D.prototype.onBeforeShadow = function (this: THREE.Object3D) {
      rec(this);
    };
  }

  private add(name: string, calls: number, triangles: number) {
    const p = (this.passes[name] ??= { calls: 0, triangles: 0 });
    p.calls += calls;
    p.triangles += triangles;
  }

  /** Start of World.frame(). */
  begin() {
    const now = performance.now();
    if (this.prevFrameAt) {
      this.frameMs = now - this.prevFrameAt;
      const inst = 1000 / Math.max(0.01, this.frameMs);
      this.fps = this.fps ? this.fps * 0.92 + inst * 0.08 : inst;
    }
    this.prevFrameAt = now;
    this.frameStart = now;
    this.renderer.info.reset();
    this.passes = {};
    this.bucket = 'main';
    this.objects.clear();
  }

  /** Attribute the following renderer.render() calls (other than the main scene/camera) to `name`. */
  setBucket(name: string) {
    this.bucket = name;
  }

  /** End of World.frame(). */
  end() {
    this.cpuMs = performance.now() - this.frameStart;
    this.last = this.passes;
    if (RECORD_OBJECTS) this.lastObjects = [...this.objects.values()].sort((a, b) => b.triangles - a.triangles).slice(0, 300);
    const r = this.renderer.info.render;
    this.lastTotals = { calls: r.calls, triangles: r.triangles, points: r.points, lines: r.lines };
  }

  snapshot(): FrameStatsSnapshot {
    const i = this.renderer.info;
    return {
      ...this.lastTotals,
      passes: Object.fromEntries(Object.entries(this.last).map(([k, v]) => [k, { ...v }])),
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
      cpuMs: this.cpuMs,
      frameMs: this.frameMs,
      fps: this.fps,
      ...(RECORD_OBJECTS
        ? {
            objects: this.lastObjects.map((o) => ({ ...o })),
            programList: (i.programs ?? []).map((p) => `${p.name} ×${(p as unknown as { usedTimes: number }).usedTimes} ${String((p as unknown as { cacheKey: string }).cacheKey).slice(0, 80)}`),
          }
        : {}),
    };
  }
}
