/**
 * Geometry for the small scatter: noise-displaced rocks (vertex-coloured, mossy tops, darker
 * crevices) and wildflower patches (crossed sprite quads from the flower atlas).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng, hash2 } from './rng';

// ---------------------------------------------------------------- rocks

/** Cheap 3D value noise from the 2D integer hash. */
function vnoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash2(a + c * 157, b - c * 113, seed);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(ix, iy, iz), h(ix + 1, iy, iz), sx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy),
    l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy),
    sz,
  );
}
function fbm3(x: number, y: number, z: number, oct: number, seed: number) {
  let s = 0, a = 0.5, n = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += a * (vnoise3(x * f, y * f, z * f, seed + o * 31) * 2 - 1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

export interface RockParams {
  seed: number;
  /** Ellipsoid radii before displacement (unit-ish). */
  shape: [number, number, number];
  /** Displacement amplitude and base frequency. */
  amp: number;
  freq: number;
}

export const ROCK_VARIANTS: RockParams[] = [
  { seed: 5, shape: [1.0, 0.62, 0.85], amp: 0.32, freq: 1.3 },
  { seed: 9, shape: [1.0, 0.85, 0.9], amp: 0.26, freq: 1.8 },
  { seed: 13, shape: [1.25, 0.5, 0.8], amp: 0.36, freq: 1.1 },
];

/** A rock of radius ~1 m, base at y = 0 (the bottom quarter is meant to be buried). */
export function buildRock(p: RockParams, detail: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const disp = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Faceted, angular look: fbm plus a ridged term, then flatten a few planes.
    const n = fbm3(v.x * p.freq, v.y * p.freq, v.z * p.freq, 4, p.seed);
    const r = 1 - Math.abs(fbm3(v.x * p.freq * 2 + 7, v.y * p.freq * 2, v.z * p.freq * 2, 2, p.seed + 3));
    let d = 1 + p.amp * n + 0.08 * r;
    d = Math.min(d, 1.05 + 0.1 * n); // clipped tops read as fractured faces
    disp[i] = n;
    v.multiplyScalar(d);
    v.set(v.x * p.shape[0], v.y * p.shape[1], v.z * p.shape[2]);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3; // flat-ish buried base
    pos.setXYZ(i, v.x, v.y + 0.25, v.z);
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const grain = fbm3(x * 6, y * 6, z * 6, 2, p.seed + 11) * 0.5 + 0.5;
    // Linear albedo (vertex colours are linear): weathered grey-brown stone.
    const base = 0.13 + 0.07 * grain;
    let c = [base * 1.04, base * 1.0, base * 0.92];
    // Crevices darker.
    const cav = THREE.MathUtils.clamp(0.5 - disp[i] * 2, 0, 1);
    c = c.map((k) => k * (1 - 0.35 * cav));
    // Moss/lichen on upward faces.
    const moss = THREE.MathUtils.smoothstep(ny + 0.25 * (fbm3(x * 2, y * 2, z * 2, 2, p.seed + 17)), 0.55, 0.85);
    const mc = [0.045, 0.07, 0.018];
    c = c.map((k, j) => k * (1 - moss * 0.75) + mc[j] * moss * 0.75);
    // Damp, darker foot.
    const foot = THREE.MathUtils.smoothstep(y, 0.0, 0.4);
    c = c.map((k) => k * (0.6 + 0.4 * foot));
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- wildflowers

/**
 * A patch of crossed sprite quads (radius ~1.3 m). `kinds` = atlas tiles to use (0 daisy,
 * 1 buttercup, 2 knapweed, 3 cornflower), the first one dominant.
 */
export function buildFlowerPatch(seed: number, kinds: number[], sprigs = 12): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < sprigs; s++) {
    const r = Math.sqrt(rng.next()) * 1.3;
    const a = rng.next() * Math.PI * 2;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const h = rng.range(0.32, 0.55);
    const w = h * rng.range(0.85, 1.05);
    const kind = rng.next() < 0.65 ? kinds[0] : rng.pick(kinds);
    const u0 = (kind % 2) * 0.5;
    const v0 = Math.floor(kind / 2) * 0.5;
    const yaw = rng.next() * Math.PI;
    const phase = rng.next();
    const shade = rng.range(0.85, 1.1);
    for (let q = 0; q < 2; q++) {
      const ang = yaw + q * Math.PI * 0.5;
      const dx = Math.cos(ang) * w * 0.5;
      const dz = Math.sin(ang) * w * 0.5;
      const base = pos.length / 3;
      for (let k = 0; k < 4; k++) {
        const sx = k === 0 || k === 3 ? -1 : 1;
        const ty = k < 2 ? 0 : 1;
        pos.push(cx + sx * dx, ty * h - 0.03, cz + sx * dz);
        // Up-biased normals: sprites shade like the ground cover they sit in.
        nrm.push(Math.sin(ang) * 0.25 * sx, 1, -Math.cos(ang) * 0.25 * sx);
        uv.push(u0 + (sx * 0.5 + 0.5) * 0.5, v0 + (1 - ty) * 0.5);
        const ao = (0.55 + 0.45 * ty) * shade;
        col.push(ao, ao, ao);
        wind.push(0, ty * 0.25, ty, phase);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 4));
  g.setIndex(idx);
  g.normalizeNormals();
  g.computeBoundingSphere();
  return g;
}
