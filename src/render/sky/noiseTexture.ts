/**
 * Procedural, seamlessly tiling 2D noise texture for the clouds (generated once on the CPU,
 * ~40 ms for 256², no assets). Channels:
 *   R: low-frequency fbm         → weather / coverage map
 *   G: Perlin-Worley fbm          → billowy cloud shape
 *   B: inverted Worley fbm (×2)   → erosion detail
 *   A: high-frequency fbm         → wispy detail
 */
import * as THREE from 'three';

function hash2(x: number, y: number, seed: number): number {
  // integer hash → [0,1)
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Tileable 2D gradient noise with integer period `p` (u, v in lattice units). Returns ~[-1,1]. */
function gradNoise(u: number, v: number, p: number, seed: number): number {
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fx = u - i;
  const fy = v - j;
  const g = (ci: number, cj: number, dx: number, dy: number) => {
    const a = hash2(mod(ci, p), mod(cj, p), seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const q = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const sx = q(fx);
  const sy = q(fy);
  const a = g(i, j, fx, fy);
  const b = g(i + 1, j, fx - 1, fy);
  const c = g(i, j + 1, fx, fy - 1);
  const d = g(i + 1, j + 1, fx - 1, fy - 1);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 1.414;
}

/** Tileable Worley (F1) distance, 0 at feature points, ~1 far away. */
function worley(u: number, v: number, p: number, seed: number): number {
  const i = Math.floor(u);
  const j = Math.floor(v);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const ci = i + ox;
      const cj = j + oy;
      const px = ci + hash2(mod(ci, p), mod(cj, p), seed);
      const py = cj + hash2(mod(ci, p), mod(cj, p), seed + 17);
      const dx = px - u;
      const dy = py - v;
      const dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
  }
  return Math.min(1, Math.sqrt(best));
}

function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * gradNoise(u * (p / period), v * (p / period), p, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm; // ~[-1,1]
}

function worleyFbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.6;
  let norm = 0;
  let p = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (1 - worley(u * (p / period), v * (p / period), p, seed + o * 57));
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm; // 0..1, 1 at cell centres (billows)
}

function normalise(ch: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of ch) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const s = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < ch.length; i++) ch[i] = (ch[i] - lo) * s;
}

export function createCloudNoiseTexture(size = 256, seed = 7): THREE.DataTexture {
  const n = size * size;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const a = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;
      r[i] = fbm(u * 3, v * 3, 3, 4, seed);
      const perlin = fbm(u * 6, v * 6, 6, 5, seed + 101) * 0.5 + 0.5;
      const wor = worleyFbm(u * 6, v * 6, 6, 3, seed + 202);
      // Perlin-Worley blend: worley gives round billows, perlin breaks up the cell pattern
      g[i] = perlin * 0.5 + wor * 0.5;
      b[i] = worleyFbm(u * 14, v * 14, 14, 3, seed + 303);
      a[i] = fbm(u * 24, v * 24, 24, 3, seed + 404) * 0.5 + 0.5;
    }
  }
  normalise(r);
  normalise(g);
  normalise(b);
  normalise(a);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = r[i] * 255;
    data[i * 4 + 1] = g[i] * 255;
    data[i * 4 + 2] = b[i] * 255;
    data[i * 4 + 3] = a[i] * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
