/**
 * CPU-side data baked once for the terrain shader:
 *  - a filterable RGBA16F "slope" texture: height gradient (dh/dx, dh/dz) and two curvature
 *    scales (Laplacian). Linear filtering of the gradient gives smooth per-pixel normals that are
 *    identical for every LOD level, so lighting never pops when the geometry LOD changes.
 *  - mowing axes: fairway centre-line segments, green and tee orientations as uniform arrays.
 */
import * as THREE from 'three';
import type { CourseGrids } from '../../course/CourseField';
import { HOLES } from '../../course/layout';

/** Max fairway segments passed to the shader (sum of fairway points over all holes). */
export const MAX_FAIRWAY_SEGS = 48;
export const MAX_HOLES = 12;

/** Curvature radii in grid cells (small: bumps/hollows, large: valleys/ridges). */
const CURV_SMALL = 3;
const CURV_LARGE = 12;

export function bakeSlopeTexture(g: CourseGrids): THREE.DataTexture {
  const { res, heights } = g;
  const cell = (2 * g.half) / (res - 1);
  const out = new Uint16Array(res * res * 4);
  const half = THREE.DataUtils.toHalfFloat;
  // Clamped row/column offsets for every radius used (perf: no per-sample clamping/closures;
  // this bake runs on the main thread during loading, 1281² texels).
  const radii = [1, CURV_SMALL, CURV_LARGE];
  const clampIdx = (v: number) => (v < 0 ? 0 : v >= res ? res - 1 : v);
  const lo: Record<number, Int32Array> = {};
  const hi: Record<number, Int32Array> = {};
  for (const r of radii) {
    lo[r] = new Int32Array(res);
    hi[r] = new Int32Array(res);
    for (let i = 0; i < res; i++) {
      lo[r][i] = clampIdx(i - r);
      hi[r][i] = clampIdx(i + r);
    }
  }
  const inv2c = 1 / (2 * cell);
  // 8-neighbour Laplacian at radius r (metres^-1): + = concave (hollow), - = convex (ridge).
  const lap = (i: number, j: number, r: number, h: number) => {
    const i0 = lo[r][i], i1 = hi[r][i];
    const r0 = lo[r][j] * res, r1 = hi[r][j] * res, rj = j * res;
    const s = heights[rj + i1] + heights[rj + i0] + heights[r1 + i] + heights[r0 + i];
    const d = heights[r1 + i1] + heights[r0 + i0] + heights[r1 + i0] + heights[r0 + i1];
    return ((0.5 * s + 0.25 * d - 3 * h) / (r * cell * r * cell)) * 4;
  };
  const clamp8 = (v: number) => (v < -8 ? -8 : v > 8 ? 8 : v);
  const l1 = lo[1], h1 = hi[1];
  for (let j = 0; j < res; j++) {
    const rj = j * res;
    const rUp = h1[j] * res;
    const rDn = l1[j] * res;
    for (let i = 0; i < res; i++) {
      const k = (rj + i) * 4;
      const h = heights[rj + i];
      out[k] = half((heights[rj + h1[i]] - heights[rj + l1[i]]) * inv2c);
      out[k + 1] = half((heights[rUp + i] - heights[rDn + i]) * inv2c);
      out[k + 2] = half(clamp8(lap(i, j, CURV_SMALL, h) * 10));
      out[k + 3] = half(clamp8(lap(i, j, CURV_LARGE, h) * 40));
    }
  }
  const tex = new THREE.DataTexture(out, res, res, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export interface MowData {
  /** Fairway segments: (ax, az, bx, bz). Stripes run along each segment. */
  fairwaySegs: THREE.Vector4[];
  fairwayCount: number;
  /** Greens: (cx, cz, dirX, dirZ) — dir is the approach (line of play) direction. */
  greens: THREE.Vector4[];
  /** Tees: (cx, cz, dirX, dirZ). */
  tees: THREE.Vector4[];
  holeCount: number;
}

export function buildMowData(): MowData {
  const segs: THREE.Vector4[] = [];
  const greens: THREE.Vector4[] = [];
  const tees: THREE.Vector4[] = [];
  for (const h of HOLES) {
    const pts = [...h.fairway, h.green.c];
    for (let i = 0; i < pts.length - 1 && segs.length < MAX_FAIRWAY_SEGS; i++) {
      segs.push(new THREE.Vector4(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
    }
    const last = h.fairway[h.fairway.length - 1];
    const gd = new THREE.Vector2(h.green.c[0] - last[0], h.green.c[1] - last[1]).normalize();
    greens.push(new THREE.Vector4(h.green.c[0], h.green.c[1], gd.x, gd.y));
    const f0 = h.fairway[0];
    const td = new THREE.Vector2(f0[0] - h.tee[0], f0[1] - h.tee[1]).normalize();
    tees.push(new THREE.Vector4(h.tee[0], h.tee[1], td.x, td.y));
  }
  const fairwayCount = segs.length;
  while (segs.length < MAX_FAIRWAY_SEGS) segs.push(new THREE.Vector4(1e5, 1e5, 1e5 + 1, 1e5));
  const holeCount = Math.min(MAX_HOLES, greens.length);
  while (greens.length < MAX_HOLES) greens.push(new THREE.Vector4(1e5, 1e5, 1, 0));
  while (tees.length < MAX_HOLES) tees.push(new THREE.Vector4(1e5, 1e5, 1, 0));
  return { fairwaySegs: segs, fairwayCount, greens: greens.slice(0, MAX_HOLES), tees: tees.slice(0, MAX_HOLES), holeCount };
}
