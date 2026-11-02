/**
 * GPU-displaced, instanced terrain chunks with continuous (geomorphed) LOD.
 *
 * The world grid (res × res samples, `cell` metres apart) is split into square chunks of
 * CHUNK_CELLS cells. Each LOD level k samples every 2^k-th grid point and is ONE shared flat
 * grid geometry drawn as an InstancedMesh (one instance per visible chunk), so the whole
 * terrain costs one draw call per LOD level. The vertex shader fetches exact heights from the
 * baked heightmap (texelFetch), so vertices sit exactly on grid samples and the triangulation
 * (diagonal from (i, j+1) to (i+1, j)) matches Course.height().
 *
 * Geomorphing: vertices that do not exist in the next-coarser level slide toward the coarse
 * surface as the camera distance approaches the switch distance, so switching levels is
 * invisible and neighbouring chunks of different levels meet without cracks (a small skirt is
 * kept as a safety net).
 */
import * as THREE from 'three';

export const CHUNK_CELLS = 64;
/** Grid steps per LOD level (in cells). Must divide CHUNK_CELLS. */
export const LOD_STEPS = [1, 2, 4, 8, 16];
/** Base switch distances (m) from level k to k+1, scaled by QualityPreset.terrainLodBias. */
export const LOD_SWITCH = [150, 360, 720, 1200];
/** Minimum spacing between consecutive switch distances: keeps neighbours ≤ 1 level apart
 *  and guarantees that morph zones never touch a coarser neighbour (chunk diagonal ≈ 115 m). */
const LOD_MIN_GAP = 200;
/** Fraction of each LOD band used for morphing toward the next level. */
const MORPH_FRACTION = 0.3;
/** Levels that cast sun shadows (far levels are outside the shadow frustum anyway). */
export const SHADOW_LEVELS = 2;
/** Object layer of shadow-only meshes: the sun's shadow camera renders it, the views don't. */
export const SHADOW_LAYER = 1;

export interface ChunkInfo {
  i0: number;
  j0: number;
  box: THREE.Box3;
  origin: THREE.Vector3;
}

/** Shared flat grid for one level; position.y < 0 marks skirt vertices (depth in metres). */
export function buildLevelGeometry(step: number, cell: number): THREE.BufferGeometry {
  const n = CHUNK_CELLS / step + 1;
  const skirt = -(0.6 + 0.5 * step * cell);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) pos.push(a * step * cell, 0, b * step * cell);
  for (let b = 0; b < n - 1; b++) {
    for (let a = 0; a < n - 1; a++) {
      const p = b * n + a;
      // Diagonal from (a, b+1) to (a+1, b) — matches Course.height() triangulation.
      idx.push(p, p + n, p + 1, p + 1, p + n, p + n + 1);
    }
  }
  // Skirts: a ring of duplicated edge vertices pushed down, walking the border CCW.
  const ring: [number, number][] = [];
  for (let k = 0; k < n - 1; k++) ring.push([k, 0]);
  for (let k = 0; k < n - 1; k++) ring.push([n - 1, k]);
  for (let k = n - 1; k > 0; k--) ring.push([k, n - 1]);
  for (let k = n - 1; k > 0; k--) ring.push([0, k]);
  const start = pos.length / 3;
  for (const [a, b] of ring) pos.push(a * step * cell, skirt, b * step * cell);
  for (let k = 0; k < ring.length; k++) {
    const [a0, b0] = ring[k];
    const [a1, b1] = ring[(k + 1) % ring.length];
    const t0 = b0 * n + a0;
    const t1 = b1 * n + a1;
    const s0 = start + k;
    const s1 = start + ((k + 1) % ring.length);
    // Both windings: the skirt must hide cracks whichever side it is seen from.
    idx.push(t0, s0, t1, t1, s0, s1, t0, t1, s0, t1, s1, s0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // Normals are computed in the vertex shader from the slope texture; this is a placeholder.
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  const size = CHUNK_CELLS * cell;
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, -1e4, 0), new THREE.Vector3(size, 1e4, size));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(size / 2, 0, size / 2), 1e5);
  return geo;
}

export function buildChunks(heights: Float32Array, res: number, half: number): ChunkInfo[] {
  const cell = (2 * half) / (res - 1);
  const count = Math.ceil((res - 1) / CHUNK_CELLS);
  const out: ChunkInfo[] = [];
  for (let cj = 0; cj < count; cj++) {
    for (let ci = 0; ci < count; ci++) {
      const i0 = ci * CHUNK_CELLS;
      const j0 = cj * CHUNK_CELLS;
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = j0; j <= Math.min(res - 1, j0 + CHUNK_CELLS); j++) {
        for (let i = i0; i <= Math.min(res - 1, i0 + CHUNK_CELLS); i++) {
          const h = heights[j * res + i];
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      const x0 = -half + i0 * cell;
      const z0 = -half + j0 * cell;
      const size = CHUNK_CELLS * cell;
      const box = new THREE.Box3(new THREE.Vector3(x0, lo - 12, z0), new THREE.Vector3(x0 + size, hi + 0.5, z0 + size));
      out.push({ i0, j0, box, origin: new THREE.Vector3(x0, 0, z0) });
    }
  }
  return out;
}

/** Switch distances scaled by quality with the minimum-gap rule applied. */
export function lodSwitchDistances(bias: number): number[] {
  const d: number[] = [];
  for (let k = 0; k < LOD_SWITCH.length; k++) {
    const v = LOD_SWITCH[k] * bias;
    d.push(k === 0 ? v : Math.max(v, d[k - 1] + LOD_MIN_GAP));
  }
  return d;
}

/** Morph window (start, end) for each level. The last level never morphs. */
export function morphWindows(sw: number[]): THREE.Vector2[] {
  return LOD_STEPS.map((_, k) => {
    if (k >= sw.length) return new THREE.Vector2(1e9, 1e9 + 1);
    const prev = k === 0 ? 0 : sw[k - 1];
    const end = sw[k] - 1;
    return new THREE.Vector2(end - MORPH_FRACTION * (sw[k] - prev), end);
  });
}

/**
 * Per-frame chunk selection: frustum culling + LOD level from the nearest-point distance of
 * each chunk's AABB to the camera. Writes instance translations into the per-level meshes.
 *
 * Shadow casters are selected separately (perf): `shadowMeshes[k]` (drawn only in the sun's
 * shadow pass, see SHADOW_LAYER) get the chunks of the shadow-casting levels that intersect the
 * shadow camera's frustum, at the same LOD level the main view uses, so self-shadowing matches
 * the visible surface. Previously every visible LOD0/LOD1 chunk (out to ~360 m) was drawn into
 * a shadow map that only covers ±shadowDistance, and off-screen near chunks were drawn in the
 * main pass too.
 */
export class ChunkSelector {
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private tmp = new THREE.Matrix4();
  switchDist: number[] = lodSwitchDistances(1);
  /** Shadow-caster meshes per shadow-casting level (may be empty: then no shadow selection). */
  shadowMeshes: THREE.InstancedMesh[] = [];

  constructor(private chunks: ChunkInfo[], private meshes: THREE.InstancedMesh[]) {}

  /** `shadowFrustum`: the sun shadow camera's frustum (null = no shadow casters this frame). */
  update(camera: THREE.Camera, shadowFrustum: THREE.Frustum | null = null) {
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const counts = this.meshes.map(() => 0);
    const sCounts = this.shadowMeshes.map(() => 0);
    const cam = camera.position;
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(cam);
      let level = 0;
      while (level < this.switchDist.length && d >= this.switchDist[level]) level++;
      if (shadowFrustum && level < this.shadowMeshes.length && shadowFrustum.intersectsBox(c.box)) {
        this.tmp.makeTranslation(c.origin.x, 0, c.origin.z);
        this.shadowMeshes[level].setMatrixAt(sCounts[level]++, this.tmp);
      }
      if (!this.frustum.intersectsBox(c.box)) continue;
      const mesh = this.meshes[level];
      this.tmp.makeTranslation(c.origin.x, 0, c.origin.z);
      mesh.setMatrixAt(counts[level]++, this.tmp);
    }
    const finish = (mesh: THREE.InstancedMesh, n: number) => {
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, Math.max(1, n) * 16);
    };
    this.meshes.forEach((mesh, k) => finish(mesh, counts[k]));
    this.shadowMeshes.forEach((mesh, k) => finish(mesh, sCounts[k]));
  }
}

export function shadowCastingLevel(k: number) {
  return k < SHADOW_LEVELS;
}
