/**
 * Procedural tree generator (own code; the recursive "branch → sections → child branches" scheme
 * is inspired by @dgreenheck/ez-tree, MIT).
 *
 * generateSkeleton() grows a deterministic skeleton (branch polylines with radii + leaf cards)
 * from a SpeciesDef. buildTreeMesh() turns a skeleton into bark + leaf BufferGeometries for a LOD:
 * LOD0 = full detail, LOD1 = thin twigs dropped, half the rings/sections, every k-th leaf card
 * enlarged so the silhouette and canopy density stay the same.
 *
 * Vertex attributes (object space, metres, y up, trunk base at the origin):
 *   position, normal, uv, color (leaves: AO × tint jitter; bark: AO)
 *   aWind (vec4): x = trunk-bend weight ((y/H)²), y = branch flex (0 trunk … ~1 twig tips),
 *                 z = leaf flutter weight, w = phase (0..1, per primary branch)
 */
import * as THREE from 'three';
import { Rng } from './rng';
import { leafTileRect, type BarkKind, type LeafTile } from './textures';

export interface LevelDef {
  /** Level 0: unused. Level ≥ 1: children spawned per parent branch. */
  children: number;
  /** Angle from the parent direction (deg) and its jitter. */
  angle: number;
  angleJitter?: number;
  /** Children originate in [start, end] along the parent (0..1). */
  start: number;
  end?: number;
  /** Branch length (m). */
  length: number;
  lengthJitter?: number;
  /** Child length multiplier falloff toward the parent's tip: len *= 1 - falloff * u. */
  lengthFalloff?: number;
  /** Conifer profile: len *= (1 - t)^cone (t = position along the parent). */
  cone?: number;
  /** Level 0: base radius (m). Level ≥ 1: fraction of the parent radius at the origin. */
  radius: number;
  /** Radius reduction along the branch (0..1). */
  taper: number;
  sections: number;
  segments: number;
  /** Random direction change per section (radians-ish). */
  gnarl: number;
  /** Pull toward +y (negative = droop) per section. */
  tropism: number;
}

export interface LeafDef {
  tile: LeafTile;
  /** Cards per terminal branch. */
  count: number;
  /** Card size (m) and relative jitter. */
  size: number;
  sizeJitter: number;
  /** Cards along the terminal branch in [start, 1]. */
  start: number;
  /** Angle of the card's growth direction away from the branch (deg). */
  angle: number;
  /** Card plane orientation: 'free' (random roll), 'flat' (≈horizontal fronds). */
  orient: 'free' | 'flat';
  /** Pull of the card direction toward -y (0..1): hanging foliage (birch). */
  droop: number;
  /** Also emit cards on the second-to-last level (count per branch). */
  inner?: number;
  /** Fraction of cards that are crossed (double) quads. */
  double: number;
}

export interface SpeciesDef {
  name: string;
  kind: 'broadleaf' | 'conifer' | 'bush';
  seed: number;
  bark: BarkKind;
  levels: LevelDef[];
  leaves: LeafDef;
  /** Root flare factor on the trunk's first sections. */
  flare: number;
  /** World-scale bark texture tile (m around × m along). */
  barkTile: [number, number];
  /** Leaf albedo tint (linear multiplier on the atlas colour) and per-instance hue jitter. */
  leafTint: [number, number, number];
  tintJitter: number;
  /** Bark tint. */
  barkTint: [number, number, number];
  /** Branches thinner than this (m) are dropped at LOD1. */
  lod1MinRadius: number;
  /** LOD1 keeps every k-th leaf card (enlarged by sqrt(k) × lod1LeafGrow). */
  lod1LeafStep: number;
}

interface Section {
  p: THREE.Vector3;
  d: THREE.Vector3;
  r: number;
  /** Branch flex at this section. */
  flex: number;
}

interface BranchRec {
  level: number;
  sections: Section[];
  segments: number;
  phase: number;
}

interface LeafRec {
  p: THREE.Vector3;
  /** Growth direction (card base → tip). */
  d: THREE.Vector3;
  /** Card side axis. */
  s: THREE.Vector3;
  size: number;
  flex: number;
  phase: number;
  double: boolean;
  shade: number;
}

export interface TreeSkeleton {
  def: SpeciesDef;
  branches: BranchRec[];
  leaves: LeafRec[];
  height: number;
  /** Crown ellipsoid (centre, radii) used for leaf normals, AO and colliders. */
  crownCenter: THREE.Vector3;
  crownRadii: THREE.Vector3;
  /** Horizontal radius of everything (for impostor framing). */
  maxRadius: number;
  /** Lowest leaf height (crown base). */
  crownBase: number;
  trunkRadius: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function perpBasis(d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const ref = Math.abs(d.y) < 0.9 ? UP : tmpA.set(1, 0, 0);
  a.crossVectors(d, ref).normalize();
  b.crossVectors(d, a).normalize();
}

/** Grow the skeleton of one tree variant. Deterministic in (def, seed). */
export function generateSkeleton(def: SpeciesDef, seed = def.seed): TreeSkeleton {
  const rng = new Rng(seed * 7919 + 13);
  const branches: BranchRec[] = [];
  const leaves: LeafRec[] = [];
  const L = def.levels;
  const maxLevel = L.length - 1;
  const trunkLen = L[0].length * (1 + rng.sym(L[0].lengthJitter ?? 0));

  interface Pending {
    origin: THREE.Vector3;
    dir: THREE.Vector3;
    length: number;
    radius: number;
    level: number;
    flex0: number;
    phase: number;
  }
  const queue: Pending[] = [
    { origin: new THREE.Vector3(), dir: new THREE.Vector3(rng.sym(0.04), 1, rng.sym(0.04)).normalize(), length: trunkLen, radius: L[0].radius, level: 0, flex0: 0, phase: rng.next() },
  ];
  const H0 = trunkLen + (L[1]?.length ?? 0) * 0.6; // rough height scale for flex normalisation
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  while (queue.length) {
    const br = queue.shift()!;
    const ld = L[br.level];
    const n = ld.sections;
    const segLen = br.length / n;
    const secs: Section[] = [];
    const p = br.origin.clone();
    const d = br.dir.clone();
    const flexRate = br.level === 0 ? 0 : (0.6 + 0.5 * br.level) / H0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let r = br.radius * (1 - ld.taper * t);
      if (br.level === maxLevel && i === n) r = Math.min(r, 0.004);
      if (br.level === 0 && def.flare > 0) r *= 1 + def.flare * Math.pow(Math.max(0, 1 - t * 6), 2);
      secs.push({ p: p.clone(), d: d.clone(), r: Math.max(r, 0.003), flex: br.flex0 + flexRate * segLen * i });
      p.addScaledVector(d, segLen);
      // Random wander + tropism; heavier (thicker) wood wanders less.
      const g = ld.gnarl / Math.max(1, Math.sqrt(r * 8));
      d.x += rng.sym(g);
      d.y += rng.sym(g * 0.5);
      d.z += rng.sym(g);
      d.normalize();
      d.y += ld.tropism;
      d.normalize();
    }
    branches.push({ level: br.level, sections: secs, segments: ld.segments, phase: br.phase });

    const sectionAt = (t: number) => {
      const f = t * n;
      const i = Math.min(n - 1, Math.floor(f));
      const s0 = secs[i];
      const s1 = secs[i + 1];
      const k = f - i;
      return {
        p: s0.p.clone().lerp(s1.p, k),
        d: s0.d.clone().lerp(s1.d, k).normalize(),
        r: s0.r + (s1.r - s0.r) * k,
        flex: s0.flex + (s1.flex - s0.flex) * k,
      };
    };

    if (br.level < maxLevel) {
      const cd = L[br.level + 1];
      const end = cd.end ?? 1;
      const phi0 = rng.next() * Math.PI * 2;
      for (let c = 0; c < cd.children; c++) {
        // Stratified positions along the parent keep spacing even but irregular.
        const u = (c + rng.range(0.15, 0.85)) / cd.children;
        const t = cd.start + (end - cd.start) * u;
        const s = sectionAt(t);
        perpBasis(s.d, a, b);
        const phi = phi0 + c * 2.39996 + rng.sym(0.35);
        const th = THREE.MathUtils.degToRad(cd.angle + rng.sym(cd.angleJitter ?? 8));
        const radial = tmpB.copy(a).multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
        const dir = s.d.clone().multiplyScalar(Math.cos(th)).addScaledVector(radial, Math.sin(th)).normalize();
        let len = cd.length * (1 + rng.sym(cd.lengthJitter ?? 0.2));
        if (cd.lengthFalloff) len *= 1 - cd.lengthFalloff * u;
        if (cd.cone !== undefined) len *= Math.pow(1 - t, cd.cone) * 0.92 + 0.08;
        const radius = Math.min(s.r * 0.9, s.r * cd.radius);
        queue.push({ origin: s.p, dir, length: len, radius, level: br.level + 1, flex0: s.flex, phase: br.level === 0 ? rng.next() : (br.phase + rng.sym(0.08) + 1) % 1 });
      }
    }

    // Leaves on terminal branches (and optionally on the level before).
    const lf = def.leaves;
    const count = br.level === maxLevel ? lf.count : br.level === maxLevel - 1 && lf.inner ? lf.inner : 0;
    for (let k = 0; k < count; k++) {
      const t = lf.start + (1 - lf.start) * ((k + rng.range(0.1, 0.9)) / count);
      const s = sectionAt(t);
      perpBasis(s.d, a, b);
      const phi = rng.next() * Math.PI * 2;
      const th = THREE.MathUtils.degToRad(lf.angle + rng.sym(15));
      const radial = tmpB.copy(a).multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
      const dir = s.d.clone().multiplyScalar(Math.cos(th)).addScaledVector(radial, Math.sin(th));
      if (lf.droop > 0) dir.y -= lf.droop;
      dir.normalize();
      let side: THREE.Vector3;
      if (lf.orient === 'flat') {
        side = new THREE.Vector3().crossVectors(dir, UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();
        // small random roll
        side.applyAxisAngle(dir, rng.sym(0.35));
      } else {
        perpBasis(dir, a, b);
        const roll = rng.next() * Math.PI * 2;
        side = a.clone().multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll));
      }
      leaves.push({
        p: s.p.clone().addScaledVector(dir, -0.05),
        d: dir,
        s: side,
        size: lf.size * (1 + rng.sym(lf.sizeJitter)),
        flex: s.flex + 0.05,
        phase: (br.phase + rng.sym(0.05) + 1) % 1,
        double: rng.next() < lf.double,
        shade: rng.next(),
      });
    }
  }

  // Bounds.
  const box = new THREE.Box3();
  let maxR = 0;
  let height = 0;
  for (const br of branches) for (const s of br.sections) {
    height = Math.max(height, s.p.y);
    maxR = Math.max(maxR, Math.hypot(s.p.x, s.p.z) + s.r);
  }
  let crownBase = Infinity;
  for (const lf of leaves) {
    const tip = lf.p.clone().addScaledVector(lf.d, lf.size);
    box.expandByPoint(lf.p);
    box.expandByPoint(tip);
    height = Math.max(height, tip.y);
    maxR = Math.max(maxR, Math.hypot(tip.x, tip.z) + lf.size * 0.5);
    crownBase = Math.min(crownBase, lf.p.y);
  }
  const crownCenter = box.getCenter(new THREE.Vector3());
  const crownRadii = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.3, 0.3, 0.3));
  return { def, branches, leaves, height, crownCenter, crownRadii, maxRadius: maxR, crownBase: isFinite(crownBase) ? crownBase : height * 0.5, trunkRadius: L[0].radius };
}

export interface TreeGeometry {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: number[], w: number[]) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.wind.push(w[0], w[1], w[2], w[3]);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Build bark + leaf geometry for LOD `lod` (0 = full, 1 = reduced). */
export function buildTreeMesh(sk: TreeSkeleton, lod: 0 | 1): TreeGeometry {
  const def = sk.def;
  const H = Math.max(sk.height, 0.5);
  const bark = new GeoBuilder();
  const n = new THREE.Vector3();
  const bn = new THREE.Vector3();
  const nb = new THREE.Vector3();
  const v = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  for (const br of sk.branches) {
    if (lod === 1 && br.level > 0 && br.sections[0].r < def.lod1MinRadius) continue;
    const secs = lod === 1 && br.sections.length > 3 ? br.sections.filter((_, i) => i % 2 === 0 || i === br.sections.length - 1) : br.sections;
    const seg = lod === 1 ? Math.max(3, Math.ceil(br.segments * 0.5)) : br.segments;
    const base = bark.count;
    const uRep = Math.max(1, Math.round((2 * Math.PI * secs[0].r) / def.barkTile[0]));
    let vAcc = 0;
    // Parallel-transport frame so the rings never twist.
    perpBasis(secs[0].d, n, bn);
    for (let i = 0; i < secs.length; i++) {
      const s = secs[i];
      if (i > 0) {
        vAcc += s.p.distanceTo(secs[i - 1].p) / def.barkTile[1];
        n.addScaledVector(s.d, -n.dot(s.d)).normalize();
        bn.crossVectors(s.d, n).normalize();
      }
      // Ambient occlusion: darker low on the trunk and on inner wood.
      const ao = br.level === 0 ? 0.55 + 0.45 * Math.min(1, s.p.y / Math.max(1, sk.crownBase)) : 0.8;
      for (let j = 0; j <= seg; j++) {
        const ang = (j / seg) * Math.PI * 2;
        nrm.copy(n).multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
        v.copy(s.p).addScaledVector(nrm, s.r);
        const hb = Math.max(0, v.y) / H;
        bark.vert(v, nrm, (j / seg) * uRep, vAcc, [ao, ao, ao], [hb * hb, s.flex, 0, br.phase]);
      }
    }
    const ring = seg + 1;
    for (let i = 0; i < secs.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a0 = base + i * ring + j;
        const a1 = a0 + 1;
        const b0 = a0 + ring;
        const b1 = b0 + 1;
        bark.idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }

  // Leaves.
  const leaves = new GeoBuilder();
  const [u0, v0, du, dv] = leafTileRect(def.leaves.tile);
  const step = lod === 1 ? def.lod1LeafStep : 1;
  const grow = lod === 1 ? Math.sqrt(step) * 0.9 : 1;
  const cc = sk.crownCenter;
  const cr = sk.crownRadii;
  const corner = new THREE.Vector3();
  const sph = new THREE.Vector3();
  const cardN = new THREE.Vector3();
  for (let li = 0; li < sk.leaves.length; li += step) {
    const lf = sk.leaves[li];
    const size = lf.size * grow;
    const quads = lf.double || lod === 1 ? 2 : 1;
    for (let q = 0; q < quads; q++) {
      const side = q === 0 ? lf.s : nb.crossVectors(lf.d, lf.s).normalize();
      cardN.crossVectors(side, lf.d).normalize();
      const base = leaves.count;
      for (let k = 0; k < 4; k++) {
        const sx = k === 0 || k === 3 ? -0.5 : 0.5;
        const ty = k < 2 ? 0 : 1;
        corner.copy(lf.p).addScaledVector(side, sx * size).addScaledVector(lf.d, ty * size);
        // Canopy normal: blend the card normal toward the crown ellipsoid normal (soft volume).
        sph.set((corner.x - cc.x) / cr.x, (corner.y - cc.y) / cr.y, (corner.z - cc.z) / cr.z);
        const e = sph.length();
        sph.normalize();
        sph.y += 0.15;
        const cn = cardN.dot(sph) < 0 ? -1 : 1;
        nrm.copy(cardN).multiplyScalar(cn * 0.3).addScaledVector(sph, 0.85).normalize();
        // AO: inner and lower leaves are darker.
        const lowK = THREE.MathUtils.clamp((corner.y - sk.crownBase) / Math.max(0.5, cc.y + cr.y - sk.crownBase), 0, 1);
        const ao = (0.4 + 0.6 * THREE.MathUtils.smoothstep(e, 0.25, 1.05)) * (0.72 + 0.28 * lowK);
        const jit = 0.88 + 0.24 * lf.shade;
        const yel = (lf.shade - 0.5) * 0.08;
        const hb = Math.max(0, corner.y) / H;
        leaves.vert(corner, nrm, u0 + (sx + 0.5) * du, v0 + (1 - ty) * dv, [ao * jit * (1 + yel), ao * jit, ao * jit * (1 - yel * 2)], [hb * hb, lf.flex + ty * 0.15, ty * 0.8 + 0.2, lf.phase]);
      }
      leaves.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { bark: bark.build(), leaves: leaves.build() };
}
