/**
 * Horizon ring: low-poly procedural mountains beyond the baked 1600 m world, so no camera
 * (including high overview shots) ever sees the edge of the heightmap.
 *
 * Geometry is a stack of concentric squares around the world edge, all with the same number
 * of perimeter vertices. Ring 0 lies exactly on the world edge at the coarsest terrain LOD
 * spacing with the exact heightmap heights, so it meets the terrain chunks without a gap (the
 * chunks' skirts hide the sub-metre mismatch at finer LODs). Heights rise outward into ridged
 * forested ranges with a few rocky peaks; aerial perspective (fog) does the rest.
 *
 * It is drawn with the regular terrain splat material compiled with TERRAIN_FAR (vertex
 * normals instead of the slope texture), so lighting, canopy and rock match the rim hills.
 * Cost: 1 draw call, ~20k triangles, no shadow casting.
 */
import * as THREE from 'three';
import type { CourseGrids } from '../../course/CourseField';
import { Simplex2, smoothstep } from '../../course/noise';

/** Perimeter spacing at the world edge (m) — matches the coarsest terrain LOD (16 cells). */
const EDGE_SPACING = 20;
/** Outer extent of the ring beyond the world edge (m). */
const RING_EXTENT = 3000;
/** Radial spacing: grows with distance (fine near the seam, coarse far away). */
const RING_STEP_MIN = 12;
const RING_STEP_GROWTH = 0.11;
/** Height of the ranges: [distance (m), typical height (m), ridge amplitude (m)]. Kept low so
 *  the ranges read as layered, rolling ridgelines just above the course rim, not alpine peaks. */
const PROFILE: [number, number, number][] = [
  [0, 0, 0],
  [250, 42, 22],
  [700, 62, 40],
  [1400, 85, 62],
  [2200, 108, 80],
  [3000, 80, 70],
];
/** Horizontal scale of the ranges (m): large → broad, well-sampled forms (no spiky triangles). */
const RIDGE_SCALE = 1300;
const ROLL_SCALE = 600;

function ringDistances(): number[] {
  const d = [0];
  while (d[d.length - 1] < RING_EXTENT) {
    const last = d[d.length - 1];
    d.push(Math.min(RING_EXTENT, last + Math.max(RING_STEP_MIN, last * RING_STEP_GROWTH)));
  }
  return d;
}
const SEED = 9001;

function profile(d: number): [number, number] {
  for (let k = 1; k < PROFILE.length; k++) {
    const [d1, h1, a1] = PROFILE[k];
    const [d0, h0, a0] = PROFILE[k - 1];
    if (d <= d1) {
      const t = smoothstep(0, 1, (d - d0) / (d1 - d0));
      return [h0 + (h1 - h0) * t, a0 + (a1 - a0) * t];
    }
  }
  const last = PROFILE[PROFILE.length - 1];
  return [last[1], last[2]];
}

/** Bilinear height from the baked grid (exact on grid lines). */
function gridHeight(g: CourseGrids, x: number, z: number): number {
  const cell = (2 * g.half) / (g.res - 1);
  const fx = Math.min(g.res - 1.0001, Math.max(0, (x + g.half) / cell));
  const fz = Math.min(g.res - 1.0001, Math.max(0, (z + g.half) / cell));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const H = (a: number, b: number) => g.heights[b * g.res + a];
  return (H(i, j) * (1 - tx) + H(i + 1, j) * tx) * (1 - tz) + (H(i, j + 1) * (1 - tx) + H(i + 1, j + 1) * tx) * tz;
}

/** Point on the perimeter of a square of half-size s, parameter t in [0, 1) (CCW from -x,-z). */
function squarePoint(s: number, t: number): [number, number] {
  const u = t * 4;
  const side = Math.floor(u);
  const f = (u - side) * 2 - 1; // -1..1 along the side
  switch (side) {
    case 0: return [f * s, -s];
    case 1: return [s, f * s];
    case 2: return [-f * s, s];
    default: return [-s, -f * s];
  }
}

export function buildFarRingGeometry(g: CourseGrids): THREE.BufferGeometry {
  const n = new Simplex2(SEED);
  const half = g.half;
  const perSide = Math.round((2 * half) / EDGE_SPACING);
  const M = perSide * 4;
  const RING_DIST = ringDistances();
  const pos: number[] = [];
  for (let r = 0; r < RING_DIST.length; r++) {
    const d = RING_DIST[r];
    const s = half + d;
    const [base, amp] = profile(d);
    for (let k = 0; k < M; k++) {
      const [x, z] = squarePoint(s, k / M);
      let y: number;
      if (r === 0) {
        y = gridHeight(g, x, z);
      } else {
        // continue the edge height outward, blending into the ranges
        const [ex, ez] = squarePoint(half, k / M);
        const edgeH = gridHeight(g, ex, ez);
        const w = smoothstep(0, 220, d);
        const ridge = 0.6 * n.ridged(x / RIDGE_SCALE, z / RIDGE_SCALE, 3) + 0.4 * (0.5 + 0.5 * n.fbm(x / ROLL_SCALE + 2.1, z / ROLL_SCALE - 4.4, 3));
        const roll = n.fbm(x / 2600 + 5.3, z / 2600 - 1.7, 2);
        const mount = base * (0.7 + 0.6 * roll) + amp * (ridge - 0.4) * 1.6;
        y = edgeH * (1 - w) + Math.max(edgeH * 0.5, mount + edgeH * 0.6) * w;
      }
      pos.push(x, y, z);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < RING_DIST.length - 1; r++) {
    for (let k = 0; k < M; k++) {
      const a = r * M + k;
      const b = r * M + ((k + 1) % M);
      const c = (r + 1) * M + k;
      const e = (r + 1) * M + ((k + 1) % M);
      // CCW seen from above (+y): inner ring walks CCW in x/z = clockwise in screen space,
      // so order (a, c, b) / (b, c, e) gives upward normals.
      idx.push(a, b, c, b, e, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Ensure normals point up (winding conventions differ per side otherwise).
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}
