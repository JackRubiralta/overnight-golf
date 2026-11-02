/**
 * Foliage: procedural trees (instanced, 2 mesh LODs + baked impostors), shrubs, wildflower
 * patches and rocks, plus simple collision primitives for ball physics.
 *
 *  - Species (foliage/species.ts) are grown by our own branch generator (foliage/treeGen.ts) with
 *    procedural canvas textures (foliage/textures.ts): no image assets.
 *  - Each variant renders as InstancedMeshes: LOD0 (full), LOD1 (reduced) and, for every variant,
 *    one entry in a shared impostor draw (8-view albedo/normal atlas baked at init,
 *    foliage/impostor.ts). LODs cross-fade with a complementary per-pixel dither (also in the
 *    shadow pass), so nothing pops. Wind sway runs in the vertex shader from globalUniforms.
 *  - Placement (foliage/placement.ts) is seeded and driven by the baked foliage-density mask,
 *    corridor distance and SDFs; play lines, greens, tees, bunkers, water, paths stay clear.
 *  - Quality: QUALITY.treeCount trees (all trees near the holes are always kept, so colliders do
 *    not depend on quality), shrubs/rocks/flowers proportional, LOD distances, impostor
 *    resolution and LOD1 shadow casting scale with the preset.
 */
import * as THREE from 'three';
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';
import { bakeImpostors, impostorFrame } from './foliage/impostor';
import { LodSystem, Sink, type Group, type LevelDef } from './foliage/lod';
import { LEAF_ALPHA_TEST, createImpostorMaterial, lodUniform, patchFoliage, type LodUniform } from './foliage/materials';
import { inPlayCount, placeFoliage, type Placed, type PlacementResult } from './foliage/placement';
import { ROCK_VARIANTS, buildFlowerPatch, buildRock } from './foliage/smallMeshes';
import { SPECIES } from './foliage/species';
import { createBarkTextures, createFlowerAtlas, createLeafAtlas, type BarkKind, type BarkTextures } from './foliage/textures';
import { buildTreeMesh, generateSkeleton, type TreeGeometry, type TreeSkeleton } from './foliage/treeGen';

export interface TreeCollider {
  x: number;
  z: number;
  /** Ground height at trunk base. */
  y: number;
  trunkRadius: number;
  trunkHeight: number;
  /** Canopy sphere (soft collider): centre height above ground and radius. */
  canopyY: number;
  canopyR: number;
  /** What the collider belongs to (rocks: trunk cylinder = the rock, canopyR = 0). */
  kind?: 'tree' | 'bush' | 'rock';
}

// ---------------------------------------------------------------- tuning
interface LodDistances {
  /** LOD0 → LOD1 switch, LOD1 → impostor switch (m). */
  l0: number;
  l1: number;
  /** Shrubs: switch distances and where their impostors fade out. */
  b0: number;
  b1: number;
  bushFar: number;
  rock0: number;
  rockFar: number;
  flowerFar: number;
  /** Impostor atlas tile resolution (px). */
  impTile: number;
  lod1Shadows: boolean;
}
const LODS: Record<QualityPreset['level'], LodDistances> = {
  low: { l0: 28, l1: 110, b0: 14, b1: 90, bushFar: 200, rock0: 25, rockFar: 260, flowerFar: 45, impTile: 128, lod1Shadows: false },
  medium: { l0: 42, l1: 160, b0: 20, b1: 130, bushFar: 260, rock0: 35, rockFar: 340, flowerFar: 65, impTile: 192, lod1Shadows: true },
  high: { l0: 58, l1: 220, b0: 26, b1: 170, bushFar: 320, rock0: 45, rockFar: 420, flowerFar: 85, impTile: 256, lod1Shadows: true },
  ultra: { l0: 80, l1: 300, b0: 34, b1: 220, bushFar: 400, rock0: 60, rockFar: 520, flowerFar: 110, impTile: 256, lod1Shadows: true },
};
/** Fade band half-widths as a fraction of the switch distance. */
const BAND = 0.08;
/** Shrubs / rocks / flower patches relative to treeCount. */
const BUSH_RATIO = 0.7;
const ROCK_RATIO = 0.22;
const FLOWER_RATIO = 1.6;
/** Chance a broadleaf shows early autumn colour. */
const AUTUMN = 0.05;

interface Variant {
  sk: TreeSkeleton;
  lod0: TreeGeometry;
  lod1: TreeGeometry;
  sway: number;
}

const rangeIn = (a: number, b: number) => [a * (1 - BAND), a * (1 + BAND), b * (1 - BAND), b * (1 + BAND)] as const;

export class Foliage implements RenderModule {
  readonly perfName = 'foliage';
  colliders: TreeCollider[] = [];
  /**
   * Called after a quality change rebuilt `colliders` in place (trees within 50 m of the maintained
   * turf never change; only far woods are thinned). Wire to Props.setTreeColliders to resync.
   */
  onCollidersChanged: ((c: TreeCollider[]) => void) | null = null;
  group = new THREE.Group();
  /** Build time of the last init (ms), for budgets. */
  buildMs = 0;

  private lod = new LodSystem();
  /** Active quality preset. */
  quality!: QualityPreset;
  private placed!: PlacementResult;
  private variants: Variant[] = [];
  private lodU = {
    tree0: lodUniform(),
    tree1: lodUniform(),
    bush0: lodUniform(),
    bush1: lodUniform(),
    rock0: lodUniform(),
    rock1: lodUniform(),
    flower: lodUniform(),
  };
  private treeSinks: { lod0: Sink; lod1: Sink; meshes: THREE.InstancedMesh[] }[] = [];
  private rockSinks: { lod0: Sink; lod1: Sink; meshes: THREE.InstancedMesh[] }[] = [];
  private flowerSinks: Sink[] = [];
  private impostorSink!: Sink;
  private impFrames: ReturnType<typeof impostorFrame>[] = [];
  private disposables: { dispose(): void }[] = [];

  private prepared: { leafAtlas: THREE.Texture; flowerAtlas: THREE.Texture; bark: Record<BarkKind, BarkTextures>; variants: Variant[] } | null = null;

  /** Course-independent work while the course bakes (perf): canvas textures + tree geometry. */
  prepare() {
    if (this.prepared) return;
    const leafAtlas = createLeafAtlas();
    const flowerAtlas = createFlowerAtlas();
    const bark: Record<BarkKind, BarkTextures> = { oak: createBarkTextures('oak', 3), birch: createBarkTextures('birch', 5), pine: createBarkTextures('pine', 7) };
    const variants = SPECIES.map((def) => {
      const sk = generateSkeleton(def);
      return { sk, lod0: buildTreeMesh(sk, 0), lod1: buildTreeMesh(sk, 1), sway: def.kind === 'bush' ? 0.05 : sk.height * 0.03 };
    });
    this.prepared = { leafAtlas, flowerAtlas, bark, variants };
  }

  init(ctx: InitContext) {
    const t0 = performance.now();
    this.quality = ctx.quality;
    this.group.name = 'foliage';
    ctx.scene.add(this.group);
    const L = LODS[ctx.quality.level];

    const marks: string[] = [];
    let tm = performance.now();
    const mark = (name: string) => {
      const now = performance.now();
      marks.push(`${name} ${(now - tm).toFixed(0)}`);
      tm = now;
    };
    // ---- textures + species geometry (normally built by prepare() while the course baked)
    this.prepare();
    const { leafAtlas, flowerAtlas, bark, variants } = this.prepared!;
    this.prepared = null;
    this.disposables.push(leafAtlas, flowerAtlas, ...Object.values(bark).flatMap((b) => [b.map, b.normalMap]));
    this.variants = variants;
    for (const v of variants) this.disposables.push(v.lod0.bark, v.lod0.leaves, v.lod1.bark, v.lod1.leaves);
    mark('textures+geometry');
    // ---- impostor atlas (one row per variant)
    const baked = bakeImpostors(
      ctx.renderer,
      this.variants.map((v) => ({
        sk: v.sk,
        geo: v.lod0,
        leafMap: leafAtlas,
        barkMap: bark[v.sk.def.bark].map,
        leafTint: new THREE.Color(...v.sk.def.leafTint),
        barkTint: new THREE.Color(...v.sk.def.barkTint),
      })),
      L.impTile,
    );
    this.impFrames = baked.frames;
    mark('impostors');
    this.disposables.push(baked.atlas.albedo, baked.atlas.normal);

    // ---- placement (all candidates, priority sorted; quality takes prefixes)
    this.placed = placeFoliage(ctx.course);
    const P = this.placed;
    mark('placement');

    // ---- tree / shrub meshes (capacity = every placed instance of the variant)
    const capByVariant = new Array(SPECIES.length).fill(0);
    for (const p of P.trees) capByVariant[p.variant]++;
    for (const p of P.bushes) capByVariant[p.variant]++;
    this.treeSinks = this.variants.map((v, vi) => {
      const def = v.sk.def;
      const isBush = def.kind === 'bush';
      const u0 = isBush ? this.lodU.bush0 : this.lodU.tree0;
      const u1 = isBush ? this.lodU.bush1 : this.lodU.tree1;
      const mk = (geo: TreeGeometry, u: LodUniform, lodIx: number) => {
        const barkMat = patchFoliage(
          new THREE.MeshStandardMaterial({ map: bark[def.bark].map, normalMap: bark[def.bark].normalMap, normalScale: new THREE.Vector2(1.2, 1.2), color: new THREE.Color(...def.barkTint), roughness: 0.93, metalness: 0, vertexColors: true }),
          { kind: 'bark', sway: v.sway, lod: u },
        );
        const leafMat = patchFoliage(
          new THREE.MeshStandardMaterial({ map: leafAtlas, color: new THREE.Color(...def.leafTint), roughness: 0.72, metalness: 0, alphaTest: LEAF_ALPHA_TEST, side: THREE.DoubleSide, vertexColors: true }),
          { kind: 'leaf', sway: v.sway, lod: u, atlasSize: leafAtlas.image.width },
        );
        const barkMesh = new THREE.InstancedMesh(geo.bark, barkMat, 1);
        const leafMesh = new THREE.InstancedMesh(geo.leaves, leafMat, 1);
        barkMesh.customDepthMaterial = patchFoliage(new THREE.MeshDepthMaterial(), { kind: 'bark', sway: v.sway, lod: u }, true);
        leafMesh.customDepthMaterial = patchFoliage(new THREE.MeshDepthMaterial({ map: leafAtlas, alphaTest: LEAF_ALPHA_TEST, side: THREE.DoubleSide }), { kind: 'leaf', sway: v.sway, lod: u, atlasSize: leafAtlas.image.width }, true);
        barkMesh.userData.wantsColor = false;
        barkMesh.name = `${def.name}-bark-lod${lodIx}`;
        leafMesh.name = `${def.name}-leaves-lod${lodIx}`;
        for (const m of [barkMesh, leafMesh]) {
          m.receiveShadow = true;
          this.group.add(m);
          this.disposables.push(m.material as THREE.Material, m.customDepthMaterial!);
        }
        return new Sink([barkMesh, leafMesh], capByVariant[vi], true);
      };
      const lod0 = mk(v.lod0, u0, 0);
      const lod1 = mk(v.lod1, u1, 1);
      return { lod0, lod1, meshes: [...lod0.meshes, ...lod1.meshes] };
    });

    // ---- shared impostor draw
    const impGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const impMesh = new THREE.InstancedMesh(impGeo, createImpostorMaterial(baked.atlas), 1);
    impMesh.name = 'tree-impostors';
    impMesh.castShadow = false;
    impMesh.receiveShadow = false;
    this.group.add(impMesh);
    this.disposables.push(impGeo, impMesh.material as THREE.Material);
    this.impostorSink = new Sink([impMesh], P.trees.length + P.bushes.length, true, ['aImp', 'aFade']);

    // ---- rocks (3 shapes × 2 LODs)
    const capRock = new Array(ROCK_VARIANTS.length).fill(0);
    for (const p of P.rocks) capRock[p.variant]++;
    const rockMat = (u: LodUniform) => patchFoliage(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }), { kind: 'rock', sway: 0, lod: u });
    this.rockSinks = ROCK_VARIANTS.map((rp, ri) => {
      const mk = (detail: number, u: LodUniform) => {
        const geo = buildRock(rp, detail);
        const m = new THREE.InstancedMesh(geo, rockMat(u), 1);
        m.customDepthMaterial = patchFoliage(new THREE.MeshDepthMaterial(), { kind: 'rock', sway: 0, lod: u }, true);
        m.receiveShadow = true;
        m.name = `rock${ri}-lod${detail}`;
        this.group.add(m);
        this.disposables.push(geo, m.material as THREE.Material, m.customDepthMaterial);
        return new Sink([m], capRock[ri], true);
      };
      const lod0 = mk(3, this.lodU.rock0);
      const lod1 = mk(1, this.lodU.rock1);
      return { lod0, lod1, meshes: [...lod0.meshes, ...lod1.meshes] };
    });

    // ---- wildflower patches (2 mixes, 1 LOD, no shadow casting)
    const capFlower = [0, 0];
    for (const p of P.flowers) capFlower[p.variant]++;
    this.flowerSinks = [buildFlowerPatch(3, [0, 1, 3]), buildFlowerPatch(8, [2, 0, 3])].map((geo, fi) => {
      const mat = patchFoliage(
        new THREE.MeshStandardMaterial({ map: flowerAtlas, roughness: 0.8, metalness: 0, alphaTest: LEAF_ALPHA_TEST, side: THREE.DoubleSide, vertexColors: true }),
        { kind: 'flower', sway: 0, lod: this.lodU.flower, atlasSize: flowerAtlas.image.width },
      );
      const m = new THREE.InstancedMesh(geo, mat, 1);
      m.name = `flowers${fi}`;
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.wantsColor = false;
      this.group.add(m);
      this.disposables.push(geo, mat);
      return new Sink([m], capFlower[fi], false);
    });

    mark('meshes');
    this.applyQuality(ctx.quality);
    mark('instances');
    this.buildMs = performance.now() - t0;
    console.info(`[foliage] built in ${this.buildMs.toFixed(0)} ms: ${P.trees.length} tree / ${P.bushes.length} shrub / ${P.rocks.length} rock / ${P.flowers.length} flower candidates (${marks.join(', ')} ms)`);
  }

  update(ctx: FrameContext) {
    this.lod.update(ctx.camera);
  }

  setQuality(q: QualityPreset) {
    if (!this.placed) return;
    this.applyQuality(q);
    this.onCollidersChanged?.(this.colliders);
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  // ------------------------------------------------------------------------------------------

  private applyQuality(q: QualityPreset) {
    this.quality = q;
    const L = LODS[q.level];
    const P = this.placed;
    const set = (u: LodUniform, r: readonly number[]) => u.value.set(r[0], r[1], r[2], r[3]);
    const far = q.drawDistance;
    const tree0 = [-2, -1, ...rangeIn(L.l0, L.l1).slice(0, 2)];
    const tree1 = rangeIn(L.l0, L.l1);
    const treeImp = [L.l1 * (1 - BAND), L.l1 * (1 + BAND), far * 0.85, far * 0.98];
    const bush0 = [-2, -1, ...rangeIn(L.b0, L.b1).slice(0, 2)];
    const bush1 = rangeIn(L.b0, L.b1);
    const bushImp = [L.b1 * (1 - BAND), L.b1 * (1 + BAND), L.bushFar * 0.85, L.bushFar];
    const rock0 = [-2, -1, ...rangeIn(L.rock0, L.rockFar).slice(0, 2)];
    const rock1 = [L.rock0 * (1 - BAND), L.rock0 * (1 + BAND), L.rockFar * 0.8, L.rockFar];
    const flower = [-2, -1, L.flowerFar * 0.7, L.flowerFar];
    set(this.lodU.tree0, tree0);
    set(this.lodU.tree1, tree1);
    set(this.lodU.bush0, bush0);
    set(this.lodU.bush1, bush1);
    set(this.lodU.rock0, rock0);
    set(this.lodU.rock1, rock1);
    set(this.lodU.flower, flower);
    const v4 = (r: readonly number[]) => new THREE.Vector4(r[0], r[1], r[2], r[3]);

    // Shadow casting per LOD.
    for (const s of this.treeSinks) {
      for (const m of s.lod0.meshes) m.castShadow = true;
      for (const m of s.lod1.meshes) m.castShadow = L.lod1Shadows;
    }
    for (const s of this.rockSinks) {
      for (const m of s.lod0.meshes) m.castShadow = true;
      for (const m of s.lod1.meshes) m.castShadow = false;
    }

    // Instance subsets for this quality.
    const nTree = Math.max(q.treeCount, inPlayCount(P.trees));
    const nBush = Math.max(Math.round(q.treeCount * BUSH_RATIO), inPlayCount(P.bushes));
    const nRock = Math.max(Math.round(q.treeCount * ROCK_RATIO), inPlayCount(P.rocks));
    const nFlower = Math.round(q.treeCount * FLOWER_RATIO);
    const trees = P.trees.slice(0, nTree);
    const bushes = P.bushes.slice(0, nBush);
    const rocks = P.rocks.slice(0, nRock);
    const flowers = P.flowers.slice(0, nFlower);

    const groups: Group[] = [];
    // Trees + shrubs, grouped by variant.
    const byVariant: Placed[][] = SPECIES.map(() => []);
    for (const p of trees) byVariant[p.variant].push(p);
    for (const p of bushes) byVariant[p.variant].push(p);
    byVariant.forEach((list, vi) => {
      if (!list.length) return;
      const v = this.variants[vi];
      const def = v.sk.def;
      const isBush = def.kind === 'bush';
      const fr = this.impFrames[vi];
      const g = makeGroup(list, v.sk.maxRadius, v.sk.height, (p, out) => {
        // Leaf tint jitter (hue + brightness), a few broadleaves turning early.
        const j = (p.r - 0.5) * 2 * def.tintJitter;
        const b = 0.9 + 0.2 * fract(p.r * 7.31);
        out[0] = (1 + j * 0.7) * b;
        out[1] = (1 + j * 0.15) * b;
        out[2] = (1 - j * 0.9) * b;
        if (def.kind === 'broadleaf' && fract(p.r * 13.7) < AUTUMN) {
          out[0] *= 1.45;
          out[1] *= 1.05;
          out[2] *= 0.45;
        }
      });
      const levels: LevelDef[] = [
        { sink: this.treeSinks[vi].lod0, range: v4(isBush ? bush0 : tree0), shadow: true },
        { sink: this.treeSinks[vi].lod1, range: v4(isBush ? bush1 : tree1), shadow: L.lod1Shadows },
      ];
      g.levels = levels;
      g.impostor = { sink: this.impostorSink, imp: [vi, fr.halfW, fr.yMax, fr.yMin], range: v4(isBush ? bushImp : treeImp) };
      groups.push(g);
    });
    // Rocks.
    const rockBy: Placed[][] = ROCK_VARIANTS.map(() => []);
    for (const p of rocks) rockBy[p.variant].push(p);
    rockBy.forEach((list, ri) => {
      if (!list.length) return;
      const g = makeGroup(
        list,
        1.4,
        1.2,
        (p, out) => {
          const b = 0.78 + 0.4 * p.r;
          const w = fract(p.r * 5.3) - 0.5;
          out[0] = b * (1 + w * 0.12);
          out[1] = b;
          out[2] = b * (1 - w * 0.12);
        },
        true,
      );
      g.levels = [
        { sink: this.rockSinks[ri].lod0, range: v4(rock0), shadow: true },
        { sink: this.rockSinks[ri].lod1, range: v4(rock1), shadow: false },
      ];
      groups.push(g);
    });
    // Flowers.
    const flowerBy: Placed[][] = [[], []];
    for (const p of flowers) flowerBy[p.variant].push(p);
    flowerBy.forEach((list, fi) => {
      if (!list.length) return;
      const g = makeGroup(list, 1.5, 0.6, null);
      g.levels = [{ sink: this.flowerSinks[fi], range: v4(flower), shadow: false }];
      groups.push(g);
    });

    this.lod.shadowKeep = q.shadowDistance * 1.2;
    this.lod.setGroups(groups);
    this.buildColliders(trees, bushes, rocks);
  }

  /** Rebuild colliders in place (Props keeps a reference to this array). */
  private buildColliders(trees: Placed[], bushes: Placed[], rocks: Placed[]) {
    const out = this.colliders;
    out.length = 0;
    for (const p of [...trees, ...bushes]) {
      const sk = this.variants[p.variant].sk;
      const s = p.scale;
      const isBush = sk.def.kind === 'bush';
      const cr = sk.crownRadii;
      out.push({
        x: p.x,
        z: p.z,
        y: p.y,
        trunkRadius: isBush ? 0.08 * s : sk.trunkRadius * s * (1 + sk.def.flare * 0.2),
        trunkHeight: isBush ? 0.4 * s : Math.max(1.5, sk.crownBase) * s,
        canopyY: sk.crownCenter.y * s,
        canopyR: ((cr.x + cr.z) * 0.5 * 0.7 + cr.y * 0.3) * s * 0.9,
        kind: isBush ? 'bush' : 'tree',
      });
    }
    for (const p of rocks) {
      const rp = ROCK_VARIANTS[p.variant];
      out.push({ x: p.x, z: p.z, y: p.y, trunkRadius: rp.shape[0] * 0.95 * p.scale, trunkHeight: (rp.shape[1] + 0.25) * p.scale, canopyY: 0, canopyR: 0, kind: 'rock' });
    }
  }
}

const fract = (x: number) => x - Math.floor(x);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function makeGroup(list: Placed[], radius: number, height: number, color: ((p: Placed, out: number[]) => void) | null, tumble = false): Group {
  const n = list.length;
  const g: Group = { levels: [], n, pos: new Float32Array(n * 3), mat: new Float32Array(n * 16), col: color ? new Float32Array(n * 3) : null, radius, height, scale: new Float32Array(n) };
  const c = [1, 1, 1];
  list.forEach((p, i) => {
    if (tumble) _q.setFromEuler(_e.set((fract(p.r * 3.7) - 0.5) * 0.5, p.yaw, (fract(p.r * 9.1) - 0.5) * 0.5));
    else _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(p.scale));
    _m.toArray(g.mat, i * 16);
    g.pos[i * 3] = p.x;
    g.pos[i * 3 + 1] = p.y;
    g.pos[i * 3 + 2] = p.z;
    g.scale[i] = p.scale;
    if (color && g.col) {
      color(p, c);
      g.col.set(c, i * 3);
    }
  });
  return g;
}
