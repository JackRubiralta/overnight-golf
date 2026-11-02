/**
 * Procedural foliage textures (no image assets):
 *  - leaf atlas (2×2 tiles): broadleaf cluster, birch spray, conifer frond, dense shrub cluster
 *  - bark albedo + normal per bark kind (oak/broadleaf, birch, pine), tileable around the trunk
 *  - wildflower atlas (2×2 tiles): daisy, buttercup, knapweed, cornflower sprigs
 * Canvas-2D drawn sprites are converted to DataTextures with the RGB of transparent texels
 * dilated to the mean leaf colour, so mipmapping never bleeds dark fringes into alpha-tested edges.
 */
import * as THREE from 'three';
import { Rng, tileFbm, tileNoise } from './rng';

// ---------------------------------------------------------------- tuning
const LEAF_TILE = 512;
const FLOWER_TILE = 256;
const BARK_W = 128;
const BARK_H = 256;

/** Atlas tile indices (row-major, 2×2). */
export const LEAF_TILE_INDEX = { broadleaf: 0, birch: 1, conifer: 2, shrub: 3 } as const;
export type LeafTile = keyof typeof LEAF_TILE_INDEX;
export type BarkKind = 'oak' | 'birch' | 'pine';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { ctx: Ctx2D; read: () => Uint8ClampedArray } {
  let ctx: Ctx2D | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    // willReadFrequently → CPU raster: no GPU round trips for thousands of small paths + readback.
    ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  }
  if (!ctx) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    ctx = c.getContext('2d', { willReadFrequently: true })!;
  }
  const c2 = ctx;
  return { ctx: c2, read: () => c2.getImageData(0, 0, w, h).data };
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;

/** Fill RGB of fully transparent texels with the mean opaque colour (alpha untouched). */
function dilateTransparent(px: Uint8ClampedArray | Uint8Array) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 128) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
  }
  if (!n) return;
  r /= n; g /= n; b /= n;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 1) {
      // Blend toward the mean so semi-transparent edge texels are not darkened by canvas AA.
      px[i] = px[i] * a + r * (1 - a);
      px[i + 1] = px[i + 1] * a + g * (1 - a);
      px[i + 2] = px[i + 2] * a + b * (1 - a);
    }
  }
}

function toTexture(data: Uint8Array, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- leaves

type LeafShape = 'ovate' | 'lobed' | 'birch';

/** One leaf from its base at the origin pointing along +x. `half`: only the lower half (shading). */
function leafPath(ctx: Ctx2D, len: number, wid: number, shape: LeafShape, half = false) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  const N = 14;
  const upper: [number, number][] = [];
  for (let i = 1; i < N; i++) {
    const t = i / N;
    let w: number;
    if (shape === 'lobed') w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.8) * (0.78 + 0.22 * Math.cos(t * Math.PI * 9));
    else if (shape === 'birch') w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.1) * (1 + 0.06 * Math.sin(t * 60));
    else w = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.9);
    upper.push([t * len, w * wid]);
  }
  if (!half) for (const p of upper) ctx.lineTo(p[0], -p[1]);
  ctx.lineTo(len, 0);
  for (let i = upper.length - 1; i >= 0; i--) ctx.lineTo(upper[i][0], upper[i][1]);
  ctx.closePath();
}

function drawLeaf(ctx: Ctx2D, x: number, y: number, ang: number, len: number, wid: number, shape: LeafShape, fill: string, vein: string) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(x + leafOrigin[0], y + leafOrigin[1]);
  ctx.rotate(ang);
  leafPath(ctx, len, wid, shape);
  ctx.fillStyle = fill;
  ctx.fill();
  // Light half / dark half gives each leaf a folded, 3D read.
  leafPath(ctx, len, wid, shape, true);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fill();
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(1, wid * 0.08);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, leafOrigin[0], leafOrigin[1]);
}
/** Tile origin of the sprite being drawn (drawLeaf resets the transform). */
const leafOrigin: [number, number] = [0, 0];

function stem(ctx: Ctx2D, pts: [number, number][], w0: number, w1: number, col: string) {
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  for (let i = 0; i < pts.length - 1; i++) {
    ctx.lineWidth = w0 + (w1 - w0) * (i / (pts.length - 1));
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.stroke();
  }
}

/** Twig polyline from (x0,y0) heading `ang` with gentle random curvature. */
function twig(rng: Rng, x0: number, y0: number, ang: number, len: number, curl: number, n = 6): [number, number][] {
  const pts: [number, number][] = [[x0, y0]];
  let x = x0, y = y0, a = ang;
  for (let i = 0; i < n; i++) {
    a += rng.sym(curl);
    x += Math.cos(a) * (len / n);
    y += Math.sin(a) * (len / n);
    pts.push([x, y]);
  }
  return pts;
}

/** Broadleaf (oak/beech-like) cluster: a forked twig carrying ~30 leaves, filling the tile. */
function drawBroadleaf(ctx: Ctx2D, S: number, rng: Rng) {
  const twigs: [number, number][][] = [];
  const main = twig(rng, S * 0.5, S * 0.98, -Math.PI / 2, S * 0.8, 0.12);
  twigs.push(main);
  for (let k = 0; k < 4; k++) {
    const p = main[2 + k];
    const side = k % 2 ? 1 : -1;
    twigs.push(twig(rng, p[0], p[1], -Math.PI / 2 + side * rng.range(0.6, 1.0), S * rng.range(0.25, 0.38), 0.15, 4));
  }
  for (const t of twigs) stem(ctx, t, 6, 2, '#4a3a28');
  // Back layer darker, front layer lighter: depth within the card.
  for (let layer = 0; layer < 2; layer++) {
    for (const t of twigs) {
      for (let i = 1; i < t.length; i++) {
        const p = t[i];
        const nLeaves = layer ? 2 : 1;
        for (let k = 0; k < nLeaves; k++) {
          const dir = Math.atan2(t[i][1] - t[i - 1][1], t[i][0] - t[i - 1][0]);
          const ang = dir + (rng.next() < 0.5 ? -1 : 1) * rng.range(0.5, 1.2);
          const len = S * rng.range(0.13, 0.19);
          const l = layer ? rng.range(0.19, 0.29) : rng.range(0.12, 0.18);
          drawLeaf(ctx, p[0], p[1], ang, len, len * 0.36, 'lobed', hsl(rng.range(84, 104), rng.range(0.42, 0.58), l), hsl(80, 0.35, l + 0.1));
        }
      }
      const tip = t[t.length - 1];
      const dir = Math.atan2(tip[1] - t[t.length - 2][1], tip[0] - t[t.length - 2][0]);
      drawLeaf(ctx, tip[0], tip[1], dir, S * 0.17, S * 0.06, 'lobed', hsl(rng.range(86, 100), 0.5, rng.range(0.22, 0.3)), hsl(80, 0.35, 0.34));
    }
  }
}

/** Birch spray: thin drooping twigs with many small light leaves (airy silhouette). */
function drawBirch(ctx: Ctx2D, S: number, rng: Rng) {
  for (let k = 0; k < 5; k++) {
    const x0 = S * (0.3 + 0.4 * rng.next());
    const t = twig(rng, x0, S * 0.02, Math.PI / 2 + rng.sym(0.45), S * rng.range(0.75, 0.95), 0.1, 8);
    stem(ctx, t, 3, 1.2, '#5a4636');
    for (let i = 1; i < t.length; i++) {
      for (let j = 0; j < 3; j++) {
        const dir = Math.atan2(t[i][1] - t[i - 1][1], t[i][0] - t[i - 1][0]);
        const ang = dir + (j % 2 ? 1 : -1) * rng.range(0.4, 1.1);
        const len = S * rng.range(0.07, 0.1);
        const l = rng.range(0.2, 0.34);
        drawLeaf(ctx, t[i][0], t[i][1], ang, len, len * 0.42, 'birch', hsl(rng.range(72, 92), rng.range(0.45, 0.62), l), hsl(70, 0.4, l + 0.1));
      }
    }
  }
}

/** Conifer frond: central stem with side shoots, densely covered in short needles. */
function drawConifer(ctx: Ctx2D, S: number, rng: Rng) {
  const main = twig(rng, S * 0.5, S * 0.99, -Math.PI / 2, S * 0.95, 0.05, 10);
  const shoots: [number, number][][] = [main];
  for (let i = 1; i < main.length - 2; i++) {
    for (const side of [-1, 1]) {
      const len = S * 0.42 * (1 - i / main.length) + S * 0.08;
      shoots.push(twig(rng, main[i][0], main[i][1], -Math.PI / 2 + side * rng.range(0.75, 1.05), len, 0.06, 5));
    }
  }
  for (const t of shoots) stem(ctx, t, 4, 1.5, '#3b2c1d');
  ctx.lineCap = 'round';
  for (const t of shoots) {
    for (let i = 0; i < t.length - 1; i++) {
      const steps = 7;
      for (let s = 0; s < steps; s++) {
        const f = s / steps;
        const x = t[i][0] + (t[i + 1][0] - t[i][0]) * f;
        const y = t[i][1] + (t[i + 1][1] - t[i][1]) * f;
        const dir = Math.atan2(t[i + 1][1] - t[i][1], t[i + 1][0] - t[i][0]);
        for (const side of [-1, 1]) {
          const a = dir + side * rng.range(0.6, 1.1);
          const l = S * rng.range(0.035, 0.055);
          ctx.strokeStyle = hsl(rng.range(118, 150), rng.range(0.3, 0.45), rng.range(0.13, 0.27));
          ctx.lineWidth = rng.range(2.2, 3.4);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
          ctx.stroke();
        }
      }
    }
  }
}

/** Dense shrub cluster: a rounded blob of small ovate leaves. */
function drawShrub(ctx: Ctx2D, S: number, rng: Rng) {
  const cx = S * 0.5;
  const cy = S * 0.55;
  for (let k = 0; k < 6; k++) stem(ctx, twig(rng, cx, S * 0.98, -Math.PI / 2 + rng.sym(0.9), S * 0.45, 0.2, 4), 4, 1.5, '#4a3a28');
  for (let i = 0; i < 150; i++) {
    const r = Math.sqrt(rng.next()) * S * 0.36;
    const a = rng.next() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.95;
    const len = S * rng.range(0.07, 0.1);
    const depth = i / 150; // later = front = lighter
    const l = 0.11 + 0.16 * depth + rng.range(-0.03, 0.03);
    drawLeaf(ctx, x, y, a + rng.sym(0.8), len, len * 0.45, 'ovate', hsl(rng.range(88, 112), rng.range(0.4, 0.55), l), hsl(85, 0.3, l + 0.08));
  }
}

/** 2×2 leaf atlas (sRGB, alpha in .a). */
export function createLeafAtlas(seed = 7): THREE.DataTexture {
  const S = LEAF_TILE;
  const { ctx, read } = makeCanvas(S * 2, S * 2);
  const rng = new Rng(seed);
  const tiles: ((c: Ctx2D, s: number, r: Rng) => void)[] = [drawBroadleaf, drawBirch, drawConifer, drawShrub];
  tiles.forEach((fn, i) => {
    ctx.save();
    leafOrigin[0] = (i % 2) * S;
    leafOrigin[1] = Math.floor(i / 2) * S;
    ctx.setTransform(1, 0, 0, 1, leafOrigin[0], leafOrigin[1]);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    fn(ctx, S, rng);
    ctx.restore();
  });
  const px = new Uint8Array(read());
  dilateTransparent(px);
  return toTexture(px, S * 2, S * 2, true);
}

/** UV rectangle (u0, v0, du, dv) of an atlas tile. DataTexture rows start at the top (flipY=false). */
export function leafTileRect(tile: LeafTile): [number, number, number, number] {
  const i = LEAF_TILE_INDEX[tile];
  return [(i % 2) * 0.5, Math.floor(i / 2) * 0.5, 0.5, 0.5];
}

// ---------------------------------------------------------------- flowers

function drawFlowerSprig(ctx: Ctx2D, S: number, rng: Rng, kind: number) {
  const heads: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const x0 = S * rng.range(0.25, 0.75);
    const t = twig(rng, x0, S, -Math.PI / 2 + rng.sym(0.35), S * rng.range(0.55, 0.85), 0.12, 5);
    stem(ctx, t, 3, 1.5, hsl(95, 0.4, 0.25));
    // a couple of narrow leaves
    for (let i = 1; i < 3; i++) drawLeaf(ctx, t[i][0], t[i][1], -Math.PI / 2 + (i % 2 ? 0.9 : -0.9), S * 0.14, S * 0.025, 'ovate', hsl(100, 0.45, 0.24), hsl(95, 0.4, 0.3));
    heads.push(t[t.length - 1]);
  }
  for (const [x, y] of heads) {
    const r = S * rng.range(0.045, 0.065);
    if (kind === 0 || kind === 1) {
      // daisy (white) / buttercup (yellow): petals around a centre
      const n = kind === 0 ? 12 : 5;
      ctx.fillStyle = kind === 0 ? '#f4f1e6' : '#f2c81e';
      for (let p = 0; p < n; p++) {
        const a = (p / n) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * (kind ? 0.55 : 0.6), r * (kind ? 0.45 : 0.22), a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = kind === 0 ? '#e8b923' : '#c98f10';
      ctx.beginPath();
      ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // knapweed (purple tuft) / cornflower (blue ragged star)
      const col = kind === 2 ? ['#8a3f9e', '#b35fc4'] : ['#3a5fd0', '#6d8ff0'];
      for (let p = 0; p < 14; p++) {
        const a = rng.next() * Math.PI * 2;
        const rr = r * rng.range(0.3, 0.95);
        ctx.strokeStyle = col[p % 2];
        ctx.lineWidth = r * 0.28;
        ctx.beginPath();
        ctx.moveTo(x, y + r * 0.2);
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8 - r * 0.2);
        ctx.stroke();
      }
    }
  }
}

/** 2×2 flower atlas (sRGB). */
export function createFlowerAtlas(seed = 11): THREE.DataTexture {
  const S = FLOWER_TILE;
  const { ctx, read } = makeCanvas(S * 2, S * 2);
  const rng = new Rng(seed);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    leafOrigin[0] = (i % 2) * S;
    leafOrigin[1] = Math.floor(i / 2) * S;
    ctx.setTransform(1, 0, 0, 1, leafOrigin[0], leafOrigin[1]);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    drawFlowerSprig(ctx, S, rng, i);
    ctx.restore();
  }
  const px = new Uint8Array(read());
  dilateTransparent(px);
  return toTexture(px, S * 2, S * 2, true);
}

// ---------------------------------------------------------------- bark

export interface BarkTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
}

/** Height (0..1) and linear-ish sRGB albedo for a bark texel at (u, v) ∈ [0,1)². */
function barkSample(kind: BarkKind, u: number, v: number, seed: number): { h: number; c: [number, number, number] } {
  if (kind === 'birch') {
    // Smooth white bark, horizontal dark lenticels, a few black diamond scars.
    const n = tileFbm(u, v, 4, 8, 3, seed);
    const len = tileNoise(u * 6, v * 70, 6, 70, seed + 7);
    const lent = len > 0.8 ? (len - 0.8) * 5 : 0;
    const scar = Math.max(0, tileFbm(u, v, 3, 5, 3, seed + 3) - 0.62) * 4;
    const dark = Math.min(1, lent * 0.8 + scar);
    const base = 0.86 + 0.08 * n;
    const c: [number, number, number] = [base * (1 - 0.82 * dark), base * 0.98 * (1 - 0.84 * dark), base * 0.92 * (1 - 0.85 * dark)];
    return { h: 0.6 + 0.2 * n - 0.4 * dark, c };
  }
  if (kind === 'pine') {
    // Scaly plates separated by dark cracks; orange-brown with grey weathering.
    const n1 = tileFbm(u, v, 6, 6, 4, seed);
    const plates = tileNoise(u * 8, v * 5, 8, 5, seed + 5);
    const crack = Math.min(1, Math.abs(plates - 0.5) * 6);
    const h = 0.25 + 0.55 * crack * (0.7 + 0.3 * n1);
    const grey = tileFbm(u, v, 3, 3, 2, seed + 9);
    const c: [number, number, number] = [0.42 + 0.14 * n1, 0.25 + 0.08 * n1, 0.16 + 0.04 * n1];
    const g = 0.36 + 0.06 * n1;
    const gm = Math.min(1, Math.max(0, grey * 1.6 - 0.5));
    for (let k = 0; k < 3; k++) c[k] = (c[k] * (1 - gm) + g * gm) * (0.35 + 0.65 * crack);
    return { h, c };
  }
  // Oak / generic broadleaf: deep vertical furrows, grey-brown, some lichen.
  const ridges = tileFbm(u, v, 10, 3, 4, seed);
  const r = 1 - Math.abs(ridges * 2 - 1);
  const h = Math.pow(r, 1.6);
  const fine = tileFbm(u, v, 24, 12, 2, seed + 4);
  const lichen = Math.max(0, tileFbm(u, v, 5, 6, 3, seed + 8) - 0.6) * 2.5;
  const base = 0.15 + 0.13 * h + 0.05 * fine;
  const c: [number, number, number] = [base * 1.02, base * 0.92, base * 0.8];
  c[0] = c[0] * (1 - lichen) + 0.42 * lichen;
  c[1] = c[1] * (1 - lichen) + 0.46 * lichen;
  c[2] = c[2] * (1 - lichen) + 0.3 * lichen;
  return { h: h * 0.85 + fine * 0.15, c };
}

export function createBarkTextures(kind: BarkKind, seed = 3): BarkTextures {
  const W = BARK_W;
  const H = BARK_H;
  const hgt = new Float32Array(W * H);
  const col = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const s = barkSample(kind, i / W, j / H, seed);
      const k = j * W + i;
      hgt[k] = s.h;
      col[k * 4] = Math.min(255, s.c[0] * 255);
      col[k * 4 + 1] = Math.min(255, s.c[1] * 255);
      col[k * 4 + 2] = Math.min(255, s.c[2] * 255);
      col[k * 4 + 3] = 255;
    }
  }
  const strength = kind === 'birch' ? 1.5 : kind === 'pine' ? 5 : 6;
  const nrm = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const hx = hgt[j * W + ((i + 1) % W)] - hgt[j * W + ((i - 1 + W) % W)];
      const hy = hgt[((j + 1) % H) * W + i] - hgt[((j - 1 + H) % H) * W + i];
      let nx = -hx * strength;
      let ny = -hy * strength;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const k = (j * W + i) * 4;
      nrm[k] = (nx * 0.5 + 0.5) * 255;
      nrm[k + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[k + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[k + 3] = 255;
    }
  }
  const map = toTexture(col, W, H, true);
  const normalMap = toTexture(nrm, W, H, false);
  for (const t of [map, normalMap]) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}
