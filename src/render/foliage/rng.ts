/**
 * Small deterministic helpers for foliage generation: a seeded PRNG (mulberry32), integer hashing
 * and tileable value noise (used for bark textures).
 */

/** mulberry32: fast 32-bit seeded PRNG. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform float in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Symmetric jitter in [-a, a). */
  sym(a: number): number {
    return (this.next() * 2 - 1) * a;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** 2D integer hash → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a lattice that wraps with period (px, py) → seamlessly tileable. Range [0, 1). */
export function tileNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const m = (a: number, p: number) => ((a % p) + p) % p;
  const x0 = m(ix, px);
  const x1 = m(ix + 1, px);
  const y0 = m(iy, py);
  const y1 = m(iy + 1, py);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Tileable fBm: u, v in [0, 1) map to one period; (fx, fy) = base lattice frequency. */
export function tileFbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 1 << o;
    sum += amp * tileNoise(u * fx * f, v * fy * f, fx * f, fy * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}
