/**
 * CourseField: the single source of truth for the landscape.
 * Pure & deterministic (safe to run inside Web Workers). It evaluates
 *  - analytic signed-distance fields for fairways, greens, tees, bunkers, water and cart paths
 *  - the terrain height (layered noise, flattened corridors, shaped greens/tees/bunkers/water)
 *  - the playing surface at any point
 * and can bake everything into grids for rendering (heightmap + SDF mask textures).
 */
import type { SurfaceId } from '../config';
import { HOLES, LANDMARKS, WORLD_HALF, type Ellipse, type HoleDef, type P2 } from './layout';
import { Simplex2, clamp, lerp, smin, smoothstep } from './noise';

export const GRID_RES = 1281; // samples per side → 1.25 m cells over 1600 m
export const SDF_SCALE = 16; // bytes per metre in mask encoding (±8 m range)

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface HoleCache {
  def: HoleDef;
  box: Box;
  greenH: number;
  teeH: number;
  teeDir: P2;
  waterLevels: number[];
}

export interface FieldSample {
  height: number;
  fairway: number;
  green: number;
  bunker: number;
  water: number;
  tee: number;
  path: number;
  /** Distance to the nearest maintained turf (fairway/green/tee), for rough bands & trees. */
  corridor: number;
}

function sdEllipse(px: number, pz: number, e: Ellipse): number {
  const rot = e.rot ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const dx = px - e.c[0];
  const dz = pz - e.c[1];
  const lx = c * dx + s * dz;
  const lz = -s * dx + c * dz;
  // Cheap ellipse distance approximation (good near the boundary).
  const k0 = Math.hypot(lx / e.r[0], lz / e.r[1]);
  const k1 = Math.hypot(lx / (e.r[0] * e.r[0]), lz / (e.r[1] * e.r[1]));
  if (k1 < 1e-9) return -Math.min(e.r[0], e.r[1]);
  return (k0 * (k0 - 1)) / k1;
}

function sdSegment(px: number, pz: number, a: P2, b: P2): { d: number; t: number } {
  const bax = b[0] - a[0];
  const baz = b[1] - a[1];
  const pax = px - a[0];
  const paz = pz - a[1];
  const h = clamp((pax * bax + paz * baz) / (bax * bax + baz * baz), 0, 1);
  return { d: Math.hypot(pax - bax * h, paz - baz * h), t: h };
}

function sdBox(px: number, pz: number, c: P2, half: P2, dir: P2): number {
  const dx = px - c[0];
  const dz = pz - c[1];
  // dir is the forward axis (z-local).
  const lz = dx * dir[0] + dz * dir[1];
  const lx = dx * -dir[1] + dz * dir[0];
  const qx = Math.abs(lx) - half[0];
  const qz = Math.abs(lz) - half[1];
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}

export class CourseField {
  readonly half = WORLD_HALF;
  private n = new Simplex2(1337);
  private n2 = new Simplex2(4242);
  holes: HoleCache[] = [];
  private practiceH: number | null = null;
  private clubhouseH: number | null = null;

  constructor() {
    for (const def of HOLES) {
      const pts: P2[] = [def.tee, ...def.fairway, def.green.c];
      const box: Box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const p of pts) {
        box.minX = Math.min(box.minX, p[0]);
        box.maxX = Math.max(box.maxX, p[0]);
        box.minZ = Math.min(box.minZ, p[1]);
        box.maxZ = Math.max(box.maxZ, p[1]);
      }
      for (const w of def.water) for (const b of w.blobs) {
        box.minX = Math.min(box.minX, b.c[0] - b.r[0]);
        box.maxX = Math.max(box.maxX, b.c[0] + b.r[0]);
        box.minZ = Math.min(box.minZ, b.c[1] - b.r[1]);
        box.maxZ = Math.max(box.maxZ, b.c[1] + b.r[1]);
      }
      const pad = 70;
      box.minX -= pad;
      box.maxX += pad;
      box.minZ -= pad;
      box.maxZ += pad;
      const f0 = def.fairway[0];
      const dl = Math.hypot(f0[0] - def.tee[0], f0[1] - def.tee[1]) || 1;
      const teeDir: P2 = [(f0[0] - def.tee[0]) / dl, (f0[1] - def.tee[1]) / dl];
      this.holes.push({ def, box, greenH: 0, teeH: 0, teeDir, waterLevels: [] });
    }
    // Feature heights from the corridor-smoothed base terrain.
    for (const h of this.holes) {
      h.greenH = this.corridorHeight(h.def.green.c[0], h.def.green.c[1]) + (h.def.greenLift ?? 0.4);
      h.teeH = this.corridorHeight(h.def.tee[0], h.def.tee[1]) + (h.def.teeLift ?? 0.5);
      h.waterLevels = h.def.water.map((w) => {
        if (w.level !== undefined) return w.level;
        let min = Infinity;
        for (const b of w.blobs) {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            const x = b.c[0] + Math.cos(ang) * b.r[0] * 1.2;
            const z = b.c[1] + Math.sin(ang) * b.r[1] * 1.2;
            min = Math.min(min, this.corridorHeight(x, z));
          }
        }
        return min - 0.9;
      });
    }
  }

  /** Large-scale landform: rolling hills, steeper toward the world edge. */
  baseHeight(x: number, z: number): number {
    const n = this.n;
    const big = n.fbm(x / 520, z / 520, 3) * 16;
    const mid = n.fbm(x / 170 + 11.3, z / 170 - 7.1, 3) * 5.5;
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const rim = smoothstep(560, 790, edge);
    const ridges = this.n2.ridged(x / 240, z / 240, 3) * 40 * rim + rim * 18;
    return big + mid + ridges;
  }

  /** Smoothed height used along playing corridors. */
  corridorHeight(x: number, z: number): number {
    const big = this.n.fbm(x / 520, z / 520, 3) * 16;
    const roll = this.n.fbm(x / 70 + 3.1, z / 70 + 9.7, 2) * 1.1;
    return big + roll;
  }

  private relevantHoles(x: number, z: number): HoleCache[] {
    const out: HoleCache[] = [];
    for (const h of this.holes) {
      const b = h.box;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) out.push(h);
    }
    return out;
  }

  /** Fairway width multiplier noise so edges look organic, not geometric. */
  private widthNoise(x: number, z: number) {
    return 1 + 0.14 * this.n2.noise(x / 38, z / 38);
  }

  fairwaySdf(h: HoleDef, x: number, z: number): number {
    let d = Infinity;
    const f = h.fairway;
    const wn = this.widthNoise(x, z);
    for (let i = 0; i < f.length - 1; i++) {
      const s = sdSegment(x, z, f[i], f[i + 1]);
      const w = lerp(h.width[i], h.width[i + 1], s.t) * wn;
      d = Math.min(d, s.d - w);
    }
    if (f.length === 1) d = Math.hypot(x - f[0][0], z - f[0][1]) - h.width[0] * wn;
    // Blend into the green approach.
    const last = f[f.length - 1];
    const ap = sdSegment(x, z, last, h.green.c);
    d = smin(d, ap.d - h.width[h.width.length - 1] * 0.8 * wn, 6);
    return d;
  }

  greenSdf(h: HoleDef, x: number, z: number): number {
    return sdEllipse(x, z, h.green) + 0.6 * this.n2.noise(x / 9, z / 9);
  }

  bunkerSdf(h: HoleDef, x: number, z: number): number {
    let d = Infinity;
    for (const b of h.bunkers) {
      let bd = sdEllipse(x, z, b);
      if (b.lobes) for (const l of b.lobes) bd = smin(bd, sdEllipse(x, z, l), 2.5);
      d = Math.min(d, bd + 0.45 * this.n2.noise(x / 4, z / 4));
    }
    return d;
  }

  waterSdf(h: HoleCache, x: number, z: number): { d: number; level: number } {
    let best = { d: Infinity, level: 0 };
    h.def.water.forEach((w, i) => {
      let d = sdEllipse(x, z, w.blobs[0]);
      for (let k = 1; k < w.blobs.length; k++) d = smin(d, sdEllipse(x, z, w.blobs[k]), 8);
      d += 0.9 * this.n2.noise(x / 14, z / 14);
      if (d < best.d) best = { d, level: h.waterLevels[i] };
    });
    return best;
  }

  teeSdf(h: HoleCache, x: number, z: number): number {
    const c: P2 = [h.def.tee[0] + h.teeDir[0] * 4, h.def.tee[1] + h.teeDir[1] * 4];
    return sdBox(x, z, c, [6, 11], h.teeDir) - 1.0;
  }

  pathSdf(x: number, z: number): number {
    let d = Infinity;
    for (const pl of LANDMARKS.paths) {
      for (let i = 0; i < pl.length - 1; i++) {
        const a = pl[i];
        const b = pl[i + 1];
        // quick reject
        if (x < Math.min(a[0], b[0]) - 10 || x > Math.max(a[0], b[0]) + 10 || z < Math.min(a[1], b[1]) - 10 || z > Math.max(a[1], b[1]) + 10) continue;
        d = Math.min(d, sdSegment(x, z, a, b).d - 1.3);
      }
    }
    return d;
  }

  /** Full evaluation at a point. */
  sample(x: number, z: number): FieldSample {
    const out: FieldSample = { height: 0, fairway: 99, green: 99, bunker: 99, water: 99, tee: 99, path: 99, corridor: 999 };
    const base = this.baseHeight(x, z);
    const hs = this.relevantHoles(x, z);
    let h = base;
    let waterLevel = 0;
    if (hs.length) {
      let corridor = Infinity;
      for (const hc of hs) {
        const def = hc.def;
        const fw = this.fairwaySdf(def, x, z);
        const gr = this.greenSdf(def, x, z);
        const tb = this.teeSdf(hc, x, z);
        const bk = this.bunkerSdf(def, x, z);
        const wt = hc.def.water.length ? this.waterSdf(hc, x, z) : { d: 99, level: 0 };
        out.fairway = Math.min(out.fairway, fw);
        out.green = Math.min(out.green, gr);
        out.tee = Math.min(out.tee, tb);
        out.bunker = Math.min(out.bunker, bk);
        if (wt.d < out.water) {
          out.water = wt.d;
          waterLevel = wt.level;
        }
        corridor = Math.min(corridor, fw, gr, tb);
      }
      out.corridor = corridor;
      // Corridors are smoother than the wild landscape.
      const cm = 1 - smoothstep(0, 45, corridor);
      h = lerp(base, this.corridorHeight(x, z), cm * 0.92);
      for (const hc of hs) {
        const def = hc.def;
        // Green complex: tilted plane with gentle undulation, blended into surrounds.
        const gd = this.greenSdf(def, x, z);
        if (gd < 14) {
          const gx = x - def.green.c[0];
          const gz = z - def.green.c[1];
          const plane = hc.greenH + def.greenSlope[0] * gx + def.greenSlope[1] * gz + 0.1 * this.n.fbm(x / 15, z / 15, 2);
          const gm = 1 - smoothstep(-1, 12, gd);
          h = lerp(h, plane, gm);
        }
        // Tee box: flat raised pad.
        const td = this.teeSdf(hc, x, z);
        const lift = def.teeLift ?? 0.5;
        if (td < 6 + lift * 4) {
          const tm = 1 - smoothstep(0, 2 + lift * 3, td);
          h = lerp(h, hc.teeH, tm);
        }
        // Bunkers: bowls with a raised lip.
        const bd = this.bunkerSdf(def, x, z);
        if (bd < 3) {
          h -= 0.75 * smoothstep(0.6, -2.4, bd);
          h += 0.22 * Math.exp(-((bd - 0.7) * (bd - 0.7)) / 0.5);
        }
      }
      // Water: carve a basin and pull banks down toward the waterline.
      if (out.water < 12) {
        const d = out.water;
        if (d < 0) h = Math.min(h, waterLevel - 0.25 - 1.6 * smoothstep(0, 9, -d));
        else h = Math.min(h, lerp(waterLevel + 0.05, h, smoothstep(0, 10, d)));
      }
    }
    // Clubhouse pad: level ground under and around the building.
    const ch = LANDMARKS.clubhouse.c;
    const cdx = x - ch[0];
    const cdz = z - ch[1];
    const cd = Math.hypot(cdx, cdz);
    if (cd < 60) {
      if (this.clubhouseH === null) this.clubhouseH = this.corridorHeight(ch[0], ch[1]) + 0.2;
      h = lerp(h, this.clubhouseH, 1 - smoothstep(26, 55, cd));
    }
    // Practice green by the clubhouse: a gently tilted putting surface.
    const pg = LANDMARKS.practiceGreen;
    const pdx = x - pg.c[0];
    const pdz = z - pg.c[1];
    if (pdx * pdx + pdz * pdz < 30 * 30) {
      const gd = sdEllipse(x, z, { c: pg.c, r: pg.r }) + 0.4 * this.n2.noise(x / 9, z / 9);
      out.green = Math.min(out.green, gd);
      out.corridor = Math.min(out.corridor, gd);
      if (this.practiceH === null) this.practiceH = this.corridorHeight(pg.c[0], pg.c[1]) + 0.3;
      const plane = this.practiceH + 0.006 * pdx - 0.008 * pdz + 0.06 * this.n.fbm(x / 10, z / 10, 2);
      h = lerp(h, plane, 1 - smoothstep(-1, 9, gd));
    }
    // Cart paths (slightly flattened, no holes needed).
    out.path = this.pathSdf(x, z);
    out.height = h;
    return out;
  }

  height(x: number, z: number): number {
    return this.sample(x, z).height;
  }

  waterLevelAt(x: number, z: number): number | null {
    for (const hc of this.relevantHoles(x, z)) {
      if (!hc.def.water.length) continue;
      const w = this.waterSdf(hc, x, z);
      if (w.d < 0.2) return w.level;
    }
    return null;
  }

  surfaceFromSample(s: FieldSample, x: number, z: number): SurfaceId {
    if (Math.abs(x) > this.half - 40 || Math.abs(z) > this.half - 40) return 'oob';
    if (s.water < 0) return 'water';
    if (s.bunker < 0) return 'sand';
    if (s.green < 0) return 'green';
    if (s.green < 1.6) return 'fringe';
    if (s.tee < 0) return 'tee';
    if (s.path < 0) return 'path';
    if (s.fairway < 0) return 'fairway';
    if (s.corridor < 2.2) return 'fringe';
    if (s.corridor < 26) return 'rough';
    return 'deepRough';
  }

  surface(x: number, z: number): SurfaceId {
    return this.surfaceFromSample(this.sample(x, z), x, z);
  }

  /** Bake rows [row0, row1) of the grid. Returns heights and two RGBA mask arrays. */
  bakeRows(res: number, row0: number, row1: number) {
    const rows = row1 - row0;
    const heights = new Float32Array(res * rows);
    const maskA = new Uint8Array(res * rows * 4); // fairway, green, bunker, water
    const maskB = new Uint8Array(res * rows * 4); // tee, path, corridor(rough band), foliage density
    const cell = (2 * this.half) / (res - 1);
    const enc = (d: number) => clamp(Math.round(128 + d * SDF_SCALE), 0, 255);
    for (let j = row0; j < row1; j++) {
      const z = -this.half + j * cell;
      for (let i = 0; i < res; i++) {
        const x = -this.half + i * cell;
        const s = this.sample(x, z);
        const k = (j - row0) * res + i;
        heights[k] = s.height;
        maskA[k * 4] = enc(s.fairway);
        maskA[k * 4 + 1] = enc(s.green);
        maskA[k * 4 + 2] = enc(s.bunker);
        maskA[k * 4 + 3] = enc(s.water);
        maskB[k * 4] = enc(s.tee);
        maskB[k * 4 + 1] = enc(s.path);
        maskB[k * 4 + 2] = clamp(Math.round(s.corridor * 2), 0, 255); // 0.5 m units, up to 127 m
        // Foliage density: trees away from play lines, in clumps.
        const clump = this.n2.fbm(x / 90, z / 90, 3) * 0.5 + 0.5;
        const away = smoothstep(24, 60, s.corridor) * (s.water > 4 ? 1 : 0) * (s.path > 2 ? 1 : 0);
        maskB[k * 4 + 3] = clamp(Math.round(255 * away * smoothstep(0.35, 0.7, clump)), 0, 255);
      }
    }
    return { heights, maskA, maskB };
  }
}

/** Baked grids shared by rendering and physics. */
export interface CourseGrids {
  res: number;
  half: number;
  heights: Float32Array;
  maskA: Uint8Array;
  maskB: Uint8Array;
}
