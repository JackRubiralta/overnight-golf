/**
 * Deterministic (seeded) placement of trees, shrubs, rocks and wildflower patches from the baked
 * course grids: maskB.a foliage density (woods away from play, in clumps), maskB.b corridor
 * distance, SDFs for water / paths / bunkers, plus our own clearance from every hole's play line
 * (tee → fairway → green), the clubhouse and the practice green.
 *
 * Every list is sorted by priority so a quality level simply takes a prefix: things near the
 * holes (which also act as ball colliders) come first, far rim woods last.
 */
import type { Course } from '../../course/Course';
import { HOLES, LANDMARKS, type P2 } from '../../course/layout';
import { Rng, hash2 } from './rng';
import { SPECIES_INDEX } from './species';

// ---------------------------------------------------------------- tuning
const TREE_SPACING = 8; // m, jittered candidate grid
const BUSH_SPACING = 8;
const ROCK_SPACING = 16;
const FLOWER_SPACING = 6;
const EDGE = 792; // keep inside the baked world
/** Minimum clearance from any hole's play line (m). */
const PLAYLINE_TREE = 40;
const PLAYLINE_SPECIMEN = 32;
const PLAYLINE_BUSH = 30;
const PLAYLINE_ROCK = 32;
const PLAYLINE_FLOWER = 22;
/** Trees closer than this corridor distance are "in play" (always present, colliders). */
const IN_PLAY = 50;

export interface Placed {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
  /** Random 0..1 (colour jitter). */
  r: number;
  /** Priority (lower = kept at lower quality). */
  rank: number;
}

export interface PlacementResult {
  trees: Placed[];
  bushes: Placed[];
  rocks: Placed[];
  flowers: Placed[];
}

/** Nearest-texel reader for the baked grids. */
class GridReader {
  private res: number;
  private half: number;
  private cell: number;
  constructor(private course: Course) {
    this.res = course.grids.res;
    this.half = course.grids.half;
    this.cell = (2 * this.half) / (this.res - 1);
  }
  private k(x: number, z: number) {
    const i = Math.min(this.res - 1, Math.max(0, Math.round((x + this.half) / this.cell)));
    const j = Math.min(this.res - 1, Math.max(0, Math.round((z + this.half) / this.cell)));
    return (j * this.res + i) * 4;
  }
  /** Signed distances (m, clamped ±8): fairway, green, bunker, water, tee, path. */
  sdf(x: number, z: number) {
    const k = this.k(x, z);
    const a = this.course.grids.maskA;
    const b = this.course.grids.maskB;
    const d = (v: number) => (v - 128) / 16;
    return { fairway: d(a[k]), green: d(a[k + 1]), bunker: d(a[k + 2]), water: d(a[k + 3]), tee: d(b[k]), path: d(b[k + 1]) };
  }
  corridor(x: number, z: number) {
    return this.course.grids.maskB[this.k(x, z) + 2] * 0.5;
  }
  density(x: number, z: number) {
    return this.course.grids.maskB[this.k(x, z) + 3] / 255;
  }
  slope(x: number, z: number) {
    const e = 2;
    const h = (a: number, b: number) => this.course.height(a, b);
    return Math.hypot(h(x + e, z) - h(x - e, z), h(x, z + e) - h(x, z - e)) / (2 * e);
  }
}

function segDist(px: number, pz: number, a: P2, b: P2) {
  const bx = b[0] - a[0], bz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * bx + (pz - a[1]) * bz) / (bx * bx + bz * bz || 1)));
  return Math.hypot(px - a[0] - bx * t, pz - a[1] - bz * t);
}

const PLAY_LINES: P2[][] = HOLES.map((h) => [h.tee, ...h.fairway, h.green.c]);
function playLineDist(x: number, z: number, corridor: number) {
  // corridor (distance to the nearest fairway/green/tee) bounds the play-line distance closely
  // enough: far from every hole there is nothing to test.
  if (corridor >= 110) return corridor;
  let d = Infinity;
  for (const pl of PLAY_LINES) for (let i = 0; i < pl.length - 1; i++) d = Math.min(d, segDist(x, z, pl[i], pl[i + 1]));
  return d;
}

function landmarkClear(x: number, z: number, pad: number) {
  const c = LANDMARKS.clubhouse.c;
  if (Math.hypot(x - c[0], z - c[1]) < 48 + pad) return false;
  const p = LANDMARKS.practiceGreen.c;
  if (Math.hypot(x - p[0], z - p[1]) < 22 + pad) return false;
  return true;
}

/** Smooth 2D value noise in [0, 1). */
function vnoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const S = SPECIES_INDEX;

/** Pick a species for a woodland tree from rim-ness, grove noise and chance. */
function pickTreeSpecies(x: number, z: number, rng: Rng): number {
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = Math.min(1, Math.max(0, (edge - 520) / 220));
  const grove = vnoise(x / 140, z / 140, 77); // large-scale stands
  const grove2 = vnoise(x / 60 + 9, z / 60 - 3, 78);
  const u = rng.next();
  if (u < rim * 0.85 || (grove > 0.72 && u < 0.7)) {
    // conifer stand
    const v = rng.next();
    return v < 0.45 ? S.spruce : v < 0.7 ? S.spruceB : S.pine;
  }
  if (grove2 > 0.66 && rng.next() < 0.75) return rng.next() < 0.6 ? S.birch : S.birchB;
  const v = rng.next();
  if (v < 0.28) return S.oakA;
  if (v < 0.5) return S.oakB;
  if (v < 0.66) return S.lime;
  if (v < 0.8) return S.birch;
  if (v < 0.9) return S.pine;
  return S.birchB;
}

export function placeFoliage(course: Course, seed = 2024): PlacementResult {
  const g = new GridReader(course);
  const rng = new Rng(seed);
  const trees: Placed[] = [];
  const bushes: Placed[] = [];
  const rocks: Placed[] = [];
  const flowers: Placed[] = [];

  const groundY = (x: number, z: number, r: number) => {
    // Lowest point under the footprint so trunks never float on slopes.
    let y = course.height(x, z);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      y = Math.min(y, course.height(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return y;
  };
  const baseClear = (x: number, z: number, minCorr: number, water: number, path: number) => {
    if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) return false;
    if (g.corridor(x, z) < minCorr) return false;
    const s = g.sdf(x, z);
    if (s.water < water || s.path < path || s.bunker < 4 || s.green < 6 || s.tee < 6 || s.fairway < 6) return false;
    return true;
  };

  // ---- trees: woodland from the density mask + scattered specimen trees in the rough
  const nT = Math.ceil((2 * EDGE) / TREE_SPACING);
  for (let j = 0; j < nT; j++) {
    for (let i = 0; i < nT; i++) {
      const x = -EDGE + (i + 0.5 + rng.sym(0.42)) * TREE_SPACING;
      const z = -EDGE + (j + 0.5 + rng.sym(0.42)) * TREE_SPACING;
      const roll = rng.next();
      const r = rng.next();
      const dens = g.density(x, z);
      const corr = g.corridor(x, z);
      // A broken row of trees lining the outer rough of every hole.
      const row = corr > 27 && corr < 60 ? (1 - Math.abs(corr - 38) / 22) * 0.45 * vnoise(x / 45, z / 45, 3) : 0;
      let specimen = false;
      if (roll > Math.min(1, dens * 0.9 + row)) {
        // Specimen: sparse in the outer rough, away from the woods.
        const sp = corr > 16 && corr < 40 && roll > 0.996 - 0.004 * vnoise(x / 80, z / 80, 5);
        if (!sp) continue;
        specimen = true;
      }
      if (!baseClear(x, z, specimen ? 14 : 18, 5, 3)) continue;
      if (!landmarkClear(x, z, 0)) continue;
      if (playLineDist(x, z, corr) < (specimen ? PLAYLINE_SPECIMEN : PLAYLINE_TREE)) continue;
      const variant = specimen ? [S.oakA, S.oakB, S.lime][Math.floor(r * 3)] : pickTreeSpecies(x, z, rng);
      const scale = specimen ? rng.range(1.0, 1.3) : rng.range(0.78, 1.18);
      const inPlay = corr < IN_PLAY;
      // Beyond the holes, budgets keep whole stands (clumpiest ground first) instead of thinning
      // everything evenly: woods + open meadows rather than a savanna. Rim woods get a boost.
      const stand = vnoise(x / 110, z / 110, 41) * 0.7 + vnoise(x / 37, z / 37, 42) * 0.3;
      const rimBoost = Math.max(Math.abs(x), Math.abs(z)) > 600 ? 0.25 : 0;
      trees.push({ x, z, y: groundY(x, z, 0.5 * scale) - 0.12, yaw: rng.next() * Math.PI * 2, scale, variant, r, rank: inPlay ? r * 0.01 : 0.01 + (1 - stand) - rimBoost + r * 0.12 + (corr - IN_PLAY) / 250 });
    }
  }

  // ---- shrubs: woodland edges and clumps in the deep rough
  const nB = Math.ceil((2 * EDGE) / BUSH_SPACING);
  for (let j = 0; j < nB; j++) {
    for (let i = 0; i < nB; i++) {
      const x = -EDGE + (i + 0.5 + rng.sym(0.45)) * BUSH_SPACING;
      const z = -EDGE + (j + 0.5 + rng.sym(0.45)) * BUSH_SPACING;
      const roll = rng.next();
      const r = rng.next();
      const dens = g.density(x, z);
      const corr = g.corridor(x, z);
      const edgeBand = Math.max(0, 1 - Math.abs(dens - 0.25) * 3); // woodland fringe
      const rough = corr > 18 && corr < 60 ? 0.08 * vnoise(x / 35, z / 35, 9) : 0;
      if (roll > edgeBand * 0.25 + rough + dens * 0.05) continue;
      if (!baseClear(x, z, 15, 3, 2.5)) continue;
      if (!landmarkClear(x, z, -10)) continue;
      if (playLineDist(x, z, corr) < PLAYLINE_BUSH) continue;
      const scale = rng.range(0.7, 1.35);
      const stand = vnoise(x / 110, z / 110, 41) * 0.7 + vnoise(x / 37, z / 37, 42) * 0.3;
      bushes.push({ x, z, y: groundY(x, z, 0.3) - 0.08, yaw: rng.next() * Math.PI * 2, scale, variant: r < 0.55 ? S.bushA : S.bushB, r, rank: corr < IN_PLAY ? r * 0.01 : 0.01 + (1 - stand) + r * 0.12 });
    }
  }

  // ---- rocks: rim slopes, steep ground and occasional outcrops in the deep rough (clusters)
  const nR = Math.ceil((2 * EDGE) / ROCK_SPACING);
  for (let j = 0; j < nR; j++) {
    for (let i = 0; i < nR; i++) {
      const x = -EDGE + (i + 0.5 + rng.sym(0.45)) * ROCK_SPACING;
      const z = -EDGE + (j + 0.5 + rng.sym(0.45)) * ROCK_SPACING;
      const roll = rng.next();
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const rim = Math.min(1, Math.max(0, (edge - 560) / 200));
      const cl = vnoise(x / 70, z / 70, 31);
      const k = cl > 0.55 ? 1.5 : 0.3;
      if (roll > (rim * 0.3 + 0.275) * k) continue; // cheap upper bound before the slope lookups
      const p = (rim * 0.3 + Math.min(1, g.slope(x, z) * 1.2) * 0.25 + 0.025) * k;
      if (roll > p) continue;
      if (!baseClear(x, z, 20, 4, 3)) continue;
      if (!landmarkClear(x, z, 0)) continue;
      const corr = g.corridor(x, z);
      if (playLineDist(x, z, corr) < PLAYLINE_ROCK) continue;
      const n = 1 + Math.floor(rng.next() * 3.5);
      for (let k = 0; k < n; k++) {
        const ox = x + (k ? rng.sym(4) : 0);
        const oz = z + (k ? rng.sym(4) : 0);
        const scale = (k ? rng.range(0.25, 0.7) : rng.range(0.5, 1.6)) * (1 + rim * 0.8);
        const r = rng.next();
        rocks.push({ x: ox, z: oz, y: course.height(ox, oz) - 0.18 * scale, yaw: rng.next() * Math.PI * 2, scale, variant: Math.floor(rng.next() * 3), r, rank: corr < IN_PLAY ? r * 0.01 : 0.01 + r });
      }
    }
  }

  // ---- wildflower patches: drifts in the deep rough and woodland edges
  const nF = Math.ceil((2 * EDGE) / FLOWER_SPACING);
  for (let j = 0; j < nF; j++) {
    for (let i = 0; i < nF; i++) {
      const x = -EDGE + (i + 0.5 + rng.sym(0.45)) * FLOWER_SPACING;
      const z = -EDGE + (j + 0.5 + rng.sym(0.45)) * FLOWER_SPACING;
      const roll = rng.next();
      const corr = g.corridor(x, z);
      if (corr < 14 || corr > 110) continue;
      const drift = vnoise(x / 45, z / 45, 51);
      if (drift < 0.55) continue;
      const dens = g.density(x, z);
      if (roll > (drift - 0.55) * 2.2 * (1 - dens)) continue;
      if (!baseClear(x, z, 14, 2, 1.5)) continue;
      if (!landmarkClear(x, z, -15)) continue;
      if (playLineDist(x, z, corr) < PLAYLINE_FLOWER) continue;
      const r = rng.next();
      flowers.push({ x, z, y: course.height(x, z), yaw: rng.next() * Math.PI * 2, scale: rng.range(0.8, 1.25), variant: vnoise(x / 120, z / 120, 52) > 0.5 ? 1 : 0, r, rank: r });
    }
  }

  const byRank = (a: Placed, b: Placed) => a.rank - b.rank;
  trees.sort(byRank);
  bushes.sort(byRank);
  rocks.sort(byRank);
  flowers.sort(byRank);
  return { trees, bushes, rocks, flowers };
}

/** Count of trees that are "in play" (always kept, regardless of quality). */
export function inPlayCount(list: Placed[]) {
  let n = 0;
  for (const p of list) if (p.rank < 0.01) n++;
  return n;
}
