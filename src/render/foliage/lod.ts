/**
 * CPU side of the foliage LOD system.
 *
 * Every instance belongs to a Group (one variant: tree species, rock shape, flower patch). A group
 * has 1–2 mesh LOD levels (each a Sink: one or more InstancedMeshes sharing the same instance
 * buffers, e.g. bark + leaves) and optionally an impostor entry into the shared impostor Sink.
 * Instances live in a coarse spatial grid; when the camera moves, visible cells are walked and each
 * instance is appended to every level whose distance window (incl. fade bands) contains it.
 * The fade itself happens on the GPU (complementary dither per pixel on the exact distance), so the
 * CPU lists only need to be conservative and LOD switches never pop.
 *
 * Shadow casters: a level with a `shadowSink` (shadow-only InstancedMeshes on SHADOW_LAYER, see
 * shared.ts) gets every in-range instance whose bounds intersect the sun's shadow frustum,
 * visible or not, while its main sink holds only the instances in view (perf: in-view trees far
 * outside the ±shadowDistance shadow map no longer go through the shadow pass, and off-screen
 * casters no longer go through the main pass). Levels without a shadowSink fall back to the old
 * rule: off-screen instances within `shadowKeep` metres are kept in the main sink when the level
 * casts shadows.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------- tuning
const CELL = 64; // m
/** Extra distance margin on every window, so slightly stale lists stay correct. */
const SLACK = 3;
/** Rebuild lists when the camera moved / turned more than this. */
const MOVE_EPS = 0.75; // m
const TURN_EPS = 0.004; // 1 - cos(angle) ≈ 5°

export class Sink {
  readonly matrix: THREE.InstancedBufferAttribute;
  readonly color: THREE.InstancedBufferAttribute | null;
  /** Extra per-instance vec4 attributes (impostors: aImp, aFade). */
  readonly extras: THREE.InstancedBufferAttribute[];
  count = 0;
  constructor(
    readonly meshes: THREE.InstancedMesh[],
    capacity: number,
    withColor: boolean,
    extraNames: string[] = [],
  ) {
    this.matrix = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 16), 16);
    this.matrix.setUsage(THREE.DynamicDrawUsage);
    this.color = withColor ? new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3).setUsage(THREE.DynamicDrawUsage) : null;
    this.extras = extraNames.map(() => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 4), 4).setUsage(THREE.DynamicDrawUsage));
    for (const m of meshes) {
      m.instanceMatrix = this.matrix;
      if (this.color && m.material && (m.userData.wantsColor ?? true)) m.instanceColor = this.color;
      extraNames.forEach((n, i) => m.geometry.setAttribute(n, this.extras[i]));
      m.count = 0;
      m.frustumCulled = false;
      m.visible = false;
    }
  }
  get capacity() {
    return this.matrix.count;
  }
  finish() {
    const n = this.count;
    const upd = (a: THREE.InstancedBufferAttribute) => {
      a.clearUpdateRanges();
      if (n > 0) {
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    };
    upd(this.matrix);
    if (this.color) upd(this.color);
    for (const e of this.extras) upd(e);
    for (const m of this.meshes) {
      m.count = n;
      m.visible = n > 0;
    }
  }
}

export interface LevelDef {
  sink: Sink;
  /** Fade-in start/end, fade-out start/end (m) — must match the material's LOD uniform. */
  range: THREE.Vector4;
  shadow: boolean;
  /** Shadow-only copy of the level (used when `shadow`): filled from the shadow frustum. */
  shadowSink?: Sink;
}

export interface Group {
  levels: LevelDef[];
  impostor?: { sink: Sink; imp: [number, number, number, number]; range: THREE.Vector4 };
  /** Per-instance data. */
  n: number;
  pos: Float32Array; // xyz
  mat: Float32Array; // 16
  col: Float32Array | null; // rgb
  /** Bounding radius/height in metres at scale 1 and per-instance scale. */
  radius: number;
  height: number;
  scale: Float32Array;
}

interface CellRef {
  g: Group;
  i: number;
}
interface Cell {
  box: THREE.Box3;
  items: CellRef[];
  /** Max distance at which anything in this cell is drawn. */
  reach: number;
}

export class LodSystem {
  groups: Group[] = [];
  private sinks = new Set<Sink>();
  private cells: Cell[] = [];
  private frustum = new THREE.Frustum();
  private pm = new THREE.Matrix4();
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private lastDir = new THREE.Vector3();
  private dirty = true;
  shadowKeep = 150;
  /** Sun shadow frustum for the shadow sinks (null: no shadow casters). */
  private shadowFrustum: THREE.Frustum | null = null;
  private lastShadow = new THREE.Vector3(1e9, 0, 0);
  private sphere = new THREE.Sphere();

  setGroups(groups: Group[]) {
    this.groups = groups;
    this.sinks.clear();
    for (const g of groups) {
      for (const l of g.levels) {
        this.sinks.add(l.sink);
        if (l.shadowSink) this.sinks.add(l.shadowSink);
      }
      if (g.impostor) this.sinks.add(g.impostor.sink);
    }
    // Spatial grid.
    const map = new Map<number, Cell>();
    for (const g of groups) {
      const reach = Math.max(...g.levels.map((l) => l.range.w), g.impostor ? g.impostor.range.w : 0);
      for (let i = 0; i < g.n; i++) {
        const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2];
        const key = Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
        let c = map.get(key);
        if (!c) {
          c = { box: new THREE.Box3(), items: [], reach: 0 };
          map.set(key, c);
        }
        const s = g.scale[i];
        c.box.expandByPoint(new THREE.Vector3(x - g.radius * s, y - 1, z - g.radius * s));
        c.box.expandByPoint(new THREE.Vector3(x + g.radius * s, y + g.height * s, z + g.radius * s));
        c.items.push({ g, i });
        c.reach = Math.max(c.reach, reach);
      }
    }
    this.cells = [...map.values()];
    this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  /**
   * `shadow`: the sun shadow camera's frustum and a point that moves with it (the sun's
   * position), or null when nothing casts shadows.
   */
  update(camera: THREE.Camera, shadow: { frustum: THREE.Frustum; anchor: THREE.Vector3 } | null = null) {
    const cp = camera.getWorldPosition(new THREE.Vector3());
    const cd = camera.getWorldDirection(new THREE.Vector3());
    const shadowMoved = shadow ? shadow.anchor.distanceToSquared(this.lastShadow) >= MOVE_EPS * MOVE_EPS : this.shadowFrustum !== null;
    if (!this.dirty && !shadowMoved && cp.distanceToSquared(this.lastPos) < MOVE_EPS * MOVE_EPS && 1 - cd.dot(this.lastDir) < TURN_EPS) return;
    this.dirty = false;
    this.lastPos.copy(cp);
    this.lastDir.copy(cd);
    this.shadowFrustum = shadow ? shadow.frustum : null;
    if (shadow) this.lastShadow.copy(shadow.anchor);
    const sf = this.shadowFrustum;
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    for (const s of this.sinks) s.count = 0;
    const keep = this.shadowKeep;
    for (const c of this.cells) {
      const dBox = c.box.distanceToPoint(cp);
      if (dBox > c.reach + SLACK) continue;
      const vis = this.frustum.intersectsBox(c.box);
      const inShadow = sf !== null && sf.intersectsBox(c.box);
      if (!vis && dBox > keep && !inShadow) continue;
      for (const { g, i } of c.items) {
        const dx = g.pos[i * 3] - cp.x, dy = g.pos[i * 3 + 1] - cp.y, dz = g.pos[i * 3 + 2] - cp.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let casts = -1; // lazily evaluated per-instance shadow-frustum test
        for (const l of g.levels) {
          if (d < l.range.x - SLACK || d > l.range.w + SLACK) continue;
          if (l.shadowSink) {
            if (vis) push(l.sink, g, i);
            if (l.shadow && inShadow) {
              if (casts < 0) {
                const sc = g.scale[i];
                const h = g.height * sc * 0.5;
                this.sphere.center.set(g.pos[i * 3], g.pos[i * 3 + 1] + h, g.pos[i * 3 + 2]);
                this.sphere.radius = Math.max(g.radius * sc, h);
                casts = sf!.intersectsSphere(this.sphere) ? 1 : 0;
              }
              if (casts) push(l.shadowSink, g, i);
            }
            continue;
          }
          if (!vis && (!l.shadow || d > keep)) continue;
          push(l.sink, g, i);
        }
        const im = g.impostor;
        if (im && vis && d >= im.range.x - SLACK && d <= im.range.w + SLACK) {
          const k = push(im.sink, g, i);
          if (k >= 0) {
            im.sink.extras[0].array.set(im.imp, k * 4);
            im.sink.extras[1].array[k * 4] = im.range.x;
            im.sink.extras[1].array[k * 4 + 1] = im.range.y;
            im.sink.extras[1].array[k * 4 + 2] = im.range.z;
            im.sink.extras[1].array[k * 4 + 3] = im.range.w;
          }
        }
      }
    }
    for (const s of this.sinks) s.finish();
  }
}

function push(s: Sink, g: Group, i: number): number {
  const k = s.count;
  if (k >= s.capacity) return -1;
  (s.matrix.array as Float32Array).set(g.mat.subarray(i * 16, i * 16 + 16), k * 16);
  if (s.color && g.col) (s.color.array as Float32Array).set(g.col.subarray(i * 3, i * 3 + 3), k * 3);
  s.count = k + 1;
  return k;
}
