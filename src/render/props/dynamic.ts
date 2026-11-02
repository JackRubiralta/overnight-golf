/**
 * Hittable physics props simulated with Rapier (@dimforge/rapier3d-compat):
 *   gong (disc on a revolute joint under a timber frame), archery-style target bosses (hinged),
 *   crate pyramids and clay-pot pyramids on pallets (topple; pots shatter into pre-split shards
 *   above an impulse/contact-force threshold), a springy scarecrow (motorised revolute joint)
 *   and hay bales.
 *
 * The golf ball itself is NOT a Rapier body (it uses our own flight/bounce model); instead every
 * dynamic collider has a matching swept-sphere Primitive that is re-posed after each Rapier step,
 * and ball hits are turned into impulses via applyHit(). Visuals are InstancedMeshes (one per
 * prop type and material set), so all props of a type cost one draw call.
 *
 * Rapier is initialised asynchronously; until then props render at their rest poses and are
 * still solid to the ball.
 */
import * as THREE from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { PHYS } from '../../config';
import type { Course } from '../../course/Course';
import { makePrimitive, updateBounds, type Primitive } from '../../props/collision';
import { GeoBucket, mat } from './builder';
import { Frame, type AddCollider } from './frame';
import type { PropMaterials } from './materials';
import { rng } from './textures';

type Rapier = typeof RAPIER_NS;
type RBody = RAPIER_NS.RigidBody;

/** Tunables */
const STEP = 1 / 60;
const MAX_STEPS = 3;
const IMPULSE_GAIN = 2.6; // game-feel boost on ball → prop impulses
const POT_BREAK_IMPULSE = 0.45; // N·s from the ball
const POT_BREAK_FORCE = 260; // N contact force (falls, collisions)
const SHARD_SLICES = 4;
const SHARD_TIERS = 2;
const CRATE = 0.55;
const POT_H = 0.34;
const POT_R = 0.155;
const GROUND_PATCH = 7; // m radius of terrain trimesh around each site

export type DynKind = 'gong' | 'target' | 'crate' | 'pot' | 'scarecrow' | 'hay';

export interface SiteItem {
  type: 'gong' | 'targets' | 'crates' | 'pots' | 'scarecrow' | 'hay';
  lx: number;
  lz: number;
  yaw?: number;
}
export interface SiteDef {
  x: number;
  z: number;
  /** Direction the site faces (usually toward the tee it is seen from). */
  face: [number, number];
  items: SiteItem[];
}

interface Part {
  prim: Primitive;
  lp: THREE.Vector3;
  lq: THREE.Quaternion;
}

interface VisRef {
  type: string;
  index: number;
}

interface Joint {
  kind: 'revolute';
  /** World anchor on the fixed body; local anchor on the prop body (derived at creation). */
  anchorWorld: THREE.Vector3;
  anchorLocal: THREE.Vector3;
  /** Axis in prop-body local frame. */
  axis: THREE.Vector3;
  motor?: { stiffness: number; damping: number };
}

interface SiteFixed {
  shape: 'box' | 'cyl';
  half?: THREE.Vector3;
  r?: number;
  hh?: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}
interface SiteRec {
  def: SiteDef;
  frame: Frame;
  fixed: SiteFixed[];
  body?: RBody;
}

interface DynProp {
  id: string;
  kind: DynKind;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  mass: number;
  colliders: { shape: 'box' | 'cyl' | 'ball' | 'hull'; half?: THREE.Vector3; r?: number; hh?: number; pts?: Float32Array; lp: THREE.Vector3; lq: THREE.Quaternion; restitution: number; friction: number }[];
  parts: Part[];
  vis: VisRef[];
  joint?: Joint;
  angularDamping: number;
  linearDamping: number;
  body: RBody | null;
  breakable: boolean;
  broken: boolean;
  /** Pot index into the shard instance meshes. */
  potIndex: number;
  site: number;
  ccd?: boolean;
  /** For shards: lifetime bookkeeping. */
  shard?: { k: number; pot: number };
}

export interface HitInfo {
  kind: DynKind;
  impulse: number;
  broken: boolean;
  score?: number;
}

interface VisualType {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  count: number;
  mesh: THREE.InstancedMesh | null;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

/** Merge per-material parts of a bucket into one grouped geometry for an InstancedMesh. */
function multiGeo(b: GeoBucket, keys: string[], mats: PropMaterials) {
  const geos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  for (const k of keys) {
    const g = b.takeGeometry(k);
    if (!g) continue;
    geos.push(g);
    materials.push(mats[k]);
  }
  const groups: { start: number; count: number }[] = [];
  let start = 0;
  for (const g of geos) {
    const c = g.index!.count;
    groups.push({ start, count: c });
    start += c;
  }
  // Manual merge (attributes identical across buckets: position, normal, uv, color).
  const names = ['position', 'normal', 'uv', 'color'];
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = geos[0].getAttribute(n).itemSize;
    const total = geos.reduce((a, g) => a + g.getAttribute(n).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(n).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += g.getAttribute('position').count;
  }
  out.setIndex(idx);
  groups.forEach((gr, i) => out.addGroup(gr.start, gr.count, i));
  for (const g of geos) g.dispose();
  out.computeBoundingSphere();
  return { geometry: out, materials };
}

/** Lathe profile of a clay pot (radius, height). */
const POT_PROFILE: [number, number][] = [
  [0.0, 0.0], [0.095, 0.0], [0.11, 0.015], [0.14, 0.09], [0.155, 0.17], [0.15, 0.24], [0.13, 0.295], [0.118, 0.31], [0.135, 0.322], [0.138, 0.34], [0.118, 0.34], [0.11, 0.3], [0.0, 0.295],
];

export class DynamicProps {
  readonly group = new THREE.Group();
  readonly props: DynProp[] = [];
  /** Static scenery for the sites (frames, stands, pallets, bales) — merged per site. */
  readonly staticBuckets: { bucket: GeoBucket; center: THREE.Vector3; radius: number }[] = [];
  private visuals = new Map<string, VisualType>();
  private sites: SiteRec[] = [];
  private R: Rapier | null = null;
  private world: RAPIER_NS.World | null = null;
  private events: RAPIER_NS.EventQueue | null = null;
  private colliderToProp = new Map<number, DynProp>();
  private acc = 0;
  private breakQueue: { p: DynProp; impulse: THREE.Vector3 | null }[] = [];
  private potCount = 0;
  private shardGeoms: { geo: THREE.BufferGeometry; center: THREE.Vector3; hull: Float32Array }[] = [];
  private shardMeshes: THREE.InstancedMesh[] = [];
  private shards: DynProp[] = [];
  private awake = new Set<DynProp>();
  private rand = rng(777);
  /** Called for secondary events (pots broken by falls) so the game can play sounds. */
  onBreak: ((p: { id: string; kind: DynKind; pos: THREE.Vector3; speed: number }) => void) | null = null;

  constructor(private course: Course, private mats: PropMaterials, private col: AddCollider, sites: SiteDef[]) {
    this.group.name = 'dynamicProps';
    this.defineVisuals();
    sites.forEach((def, si) => this.buildSite(def, si));
    this.createInstanceMeshes();
  }

  // ───────────────────────────── visuals ─────────────────────────────

  private defineVisuals() {
    const M = this.mats;
    // Crate
    {
      const b = new GeoBucket();
      b.add('crate', new THREE.BoxGeometry(CRATE, CRATE, CRATE), null, '#ffffff');
      this.addVisual('crate', multiGeo(b, ['crate'], M));
    }
    // Pot (lathe) + its shards
    {
      const b = new GeoBucket();
      const pts = POT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y - POT_H / 2));
      b.add('terracotta', new THREE.LatheGeometry(pts, 18), null, '#b8643a');
      b.add('terracotta', new THREE.TorusGeometry(0.137, 0.012, 6, 18), mat(0, POT_H / 2 - 0.012, 0, Math.PI / 2), '#a5552f');
      this.addVisual('pot', multiGeo(b, ['terracotta'], M));
      this.buildShardGeometries();
    }
    // Gong disc (faces local +z) with its hanging cords; origin at the disc centre.
    {
      const b = new GeoBucket();
      const disc = new THREE.CylinderGeometry(0.6, 0.6, 0.035, 40, 1);
      disc.rotateX(Math.PI / 2);
      // Remap cap UVs to the planar disc (cylinder caps already map to a 0..1 disc).
      b.add('brass', disc, null, '#ffffff');
      b.add('brass', new THREE.TorusGeometry(0.6, 0.025, 8, 40), null, '#d6a24a');
      b.add('brass', new THREE.SphereGeometry(0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0, 0, 0.015, Math.PI / 2), '#f0c66a');
      for (const sx of [-0.28, 0.28]) b.cyl('cloth', 0.012, 0.012, 0.42, mat(sx, 0.72, 0, 0, 0, -sx * 0.25), '#b02a2a', 6);
      this.addVisual('gong', multiGeo(b, ['brass', 'cloth'], M));
    }
    // Target boss: straw drum with painted faces; origin at the centre, faces local ±z.
    {
      const b = new GeoBucket();
      const side = new THREE.CylinderGeometry(0.62, 0.62, 0.2, 32, 1, true);
      side.rotateX(Math.PI / 2);
      b.add('hay', side, null, '#e0c27a');
      const face = new THREE.CircleGeometry(0.62, 40);
      b.add('target', face, mat(0, 0, 0.1), '#ffffff');
      b.add('target', new THREE.CircleGeometry(0.62, 40), mat(0, 0, -0.1, 0, Math.PI), '#ffffff');
      // Hanging straps
      for (const sx of [-0.35, 0.35]) b.box('cloth', 0.05, 0.5, 0.02, mat(sx, 0.75, 0.02), '#3a2a1a');
      this.addVisual('target', multiGeo(b, ['hay', 'target', 'cloth'], M));
    }
    // Scarecrow (origin at the foot of the post).
    {
      const b = new GeoBucket();
      b.box('wood', 0.09, 2.3, 0.09, mat(0, 1.05, 0), '#6b5038');
      b.box('wood', 1.5, 0.07, 0.07, mat(0, 1.62, 0), '#6b5038');
      b.box('cloth', 0.52, 0.62, 0.24, mat(0, 1.38, 0), '#9c3b2c'); // shirt
      b.box('cloth', 0.6, 0.16, 0.22, mat(0, 1.62, 0), '#9c3b2c'); // shoulders
      b.box('cloth', 0.7, 0.13, 0.13, mat(-0.55, 1.62, 0), '#83321f'); // sleeves
      b.box('cloth', 0.7, 0.13, 0.13, mat(0.55, 1.62, 0), '#83321f');
      b.box('cloth', 0.5, 0.06, 0.25, mat(0, 1.1, 0), '#3a2a1a'); // belt (rope)
      b.box('cloth', 0.2, 0.62, 0.18, mat(-0.13, 0.78, 0, 0, 0, 0.05), '#3d4f6b'); // trousers
      b.box('cloth', 0.2, 0.62, 0.18, mat(0.13, 0.78, 0, 0, 0, -0.05), '#3d4f6b');
      b.add('cloth', new THREE.SphereGeometry(0.19, 12, 10), mat(0, 1.98, 0, 0, 0, 0, 1, 1.1, 1), '#cdb48a'); // sack head
      b.cyl('hay', 0.34, 0.34, 0.025, mat(0, 2.16, 0, 0.08), '#d8b860', 16); // hat brim
      b.cyl('hay', 0.12, 0.17, 0.2, mat(0, 2.27, 0, 0.08), '#d8b860', 12); // crown
      b.cyl('cloth', 0.172, 0.172, 0.04, mat(0, 2.2, 0, 0.08), '#2c4a33', 12); // hat band
      // Straw tufts at wrists, ankles and neck
      for (const [x, y] of [[-0.92, 1.62], [0.92, 1.62], [-0.15, 0.45], [0.15, 0.45], [0, 1.75]]) {
        for (let k = 0; k < 4; k++) b.box('hay', 0.03, 0.16, 0.03, mat(x + (k - 1.5) * 0.03, y - 0.04, (k % 2) * 0.03, 0, k, 0.4 * (k - 1.5)), '#e3c46b');
      }
      // Face: button eyes and stitched smile
      for (const sx of [-0.06, 0.06]) b.add('rubber', new THREE.SphereGeometry(0.025, 8, 6), mat(sx, 2.02, 0.175), '#1a1a1a');
      b.box('rubber', 0.12, 0.015, 0.01, mat(0, 1.92, 0.185), '#2a1a10');
      this.addVisual('scarecrow', multiGeo(b, ['wood', 'cloth', 'hay', 'rubber'], M));
    }
    // Square hay bale.
    {
      const b = new GeoBucket();
      b.box('hay', 0.95, 0.4, 0.48, null, '#e0c070');
      for (const x of [-0.25, 0.25]) b.box('cloth', 0.025, 0.405, 0.485, mat(x, 0, 0), '#6a4a2a');
      this.addVisual('bale', multiGeo(b, ['hay', 'cloth'], M));
    }
  }

  private addVisual(type: string, g: { geometry: THREE.BufferGeometry; materials: THREE.Material[] }) {
    this.visuals.set(type, { geometry: g.geometry, materials: g.materials, count: 0, mesh: null });
  }

  private buildShardGeometries() {
    const pts = POT_PROFILE.slice(0, 10).map(([r, y]) => [r, y - POT_H / 2] as [number, number]);
    const tierY = [-POT_H / 2, -POT_H / 2 + POT_H * 0.45, POT_H / 2];
    const lerpProfile = (y: number): [number, number] => {
      for (let i = 1; i < pts.length; i++) {
        const [r0, y0] = pts[i - 1];
        const [r1, y1] = pts[i];
        if (y >= y0 && y <= y1 && y1 > y0) {
          const t = (y - y0) / (y1 - y0);
          return [r0 + (r1 - r0) * t, y];
        }
      }
      return pts[pts.length - 1];
    };
    for (let t = 0; t < SHARD_TIERS; t++) {
      const y0 = tierY[t];
      const y1 = tierY[t + 1];
      const prof: THREE.Vector2[] = [];
      if (t === 0) prof.push(new THREE.Vector2(0.001, y0));
      const a = lerpProfile(y0 + 1e-4);
      prof.push(new THREE.Vector2(a[0], y0));
      for (const [r, y] of pts) if (y > y0 + 1e-4 && y < y1 - 1e-4) prof.push(new THREE.Vector2(r, y));
      const c = lerpProfile(y1 - 1e-4);
      prof.push(new THREE.Vector2(c[0], y1));
      for (let s = 0; s < SHARD_SLICES; s++) {
        const jitter = (this.rand() - 0.5) * 0.3;
        const phi0 = (s / SHARD_SLICES) * Math.PI * 2 + jitter * (s > 0 ? 1 : 0);
        const phiLen = Math.PI * 2 / SHARD_SLICES;
        const g = new THREE.LatheGeometry(prof, 5, phi0, phiLen);
        g.computeBoundingBox();
        const center = new THREE.Vector3();
        // Centroid of vertices (better pivot than the box centre for curved shells).
        const pos = g.getAttribute('position');
        for (let i = 0; i < pos.count; i++) center.add(_v.fromBufferAttribute(pos, i));
        center.multiplyScalar(1 / pos.count);
        g.translate(-center.x, -center.y, -center.z);
        // Hull points, thickened slightly inward so the convex hull has volume.
        const hull: number[] = [];
        for (let i = 0; i < pos.count; i += 2) {
          _v.fromBufferAttribute(pos, i);
          hull.push(_v.x, _v.y, _v.z);
          hull.push(_v.x * 0.9, _v.y, _v.z * 0.9);
        }
        const b = new GeoBucket();
        b.add('terracottaDS', g, null, '#b8643a');
        const geo = b.takeGeometry('terracottaDS')!;
        geo.computeBoundingSphere();
        this.shardGeoms.push({ geo, center, hull: new Float32Array(hull) });
      }
    }
  }

  private createInstanceMeshes() {
    for (const [type, v] of this.visuals) {
      if (!v.count) continue;
      const mesh = new THREE.InstancedMesh(v.geometry, v.materials.length === 1 ? v.materials[0] : v.materials, v.count);
      mesh.name = `dyn:${type}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      v.mesh = mesh;
      this.group.add(mesh);
    }
    // Shards: one InstancedMesh per shard piece, one instance per pot (hidden until broken).
    if (this.potCount) {
      for (const s of this.shardGeoms) {
        const mesh = new THREE.InstancedMesh(s.geo, this.mats.terracottaDS, this.potCount);
        for (let i = 0; i < this.potCount; i++) mesh.setMatrixAt(i, ZERO_M);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.name = 'dyn:shard';
        this.shardMeshes.push(mesh);
        this.group.add(mesh);
      }
    }
    for (const p of this.props) this.syncVisual(p);
    for (const v of this.visuals.values()) if (v.mesh) {
      v.mesh.instanceMatrix.needsUpdate = true;
      v.mesh.computeBoundingSphere();
    }
  }

  private addInstance(type: string): VisRef {
    const v = this.visuals.get(type)!;
    return { type, index: v.count++ };
  }

  // ───────────────────────────── sites ─────────────────────────────

  private buildSite(def: SiteDef, si: number) {
    const g = (x: number, z: number) => this.course.height(x, z);
    const frame = new Frame(def.x, g(def.x, def.z), def.z, Math.atan2(def.face[0], def.face[1]));
    const site: SiteRec = { def, frame, fixed: [] };
    this.sites.push(site);
    const b = new GeoBucket();
    for (const it of def.items) {
      const w = frame.world(it.lx, 0, it.lz);
      const yaw = frame.yaw + (it.yaw ?? 0);
      const f = new Frame(w.x, g(w.x, w.z), w.z, yaw);
      switch (it.type) {
        case 'gong': this.makeGong(b, f, si); break;
        case 'targets': this.makeTarget(b, f, si); break;
        case 'crates': this.makeCrates(b, f, si); break;
        case 'pots': this.makePots(b, f, si); break;
        case 'scarecrow': this.makeScarecrow(f, si); break;
        case 'hay': this.makeHay(b, f, si); break;
      }
    }
    this.staticBuckets.push({ bucket: b, center: frame.pos.clone(), radius: 12 });
  }

  /** Static collider: goes into both the ball's static index and the Rapier fixed body. */
  private fixedBox(si: number, kind: string, center: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, restitution = 0.4) {
    this.col({ id: `${kind}-frame${si}`, kind, shape: 'box', center: center.clone(), half: half.clone(), rot: quat.clone(), restitution, friction: 0.35 });
    this.sites[si].fixed.push({ shape: 'box', half: half.clone(), pos: center.clone(), quat: quat.clone() });
  }
  private fixedPost(si: number, kind: string, base: THREE.Vector3, r: number, h: number) {
    this.col({ id: `${kind}-frame${si}`, kind, shape: 'vcyl', center: base.clone(), radius: r, height: h, restitution: 0.45, friction: 0.3 });
    this.sites[si].fixed.push({ shape: 'cyl', r, hh: h / 2, pos: base.clone().setY(base.y + h / 2), quat: new THREE.Quaternion() });
  }

  /** Flat pallet top at the highest ground point of a footprint (returns top height). */
  private pallet(b: GeoBucket, f: Frame, si: number, w: number, d: number) {
    let maxG = -Infinity;
    let minG = Infinity;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
      const p = f.world((sx * w) / 2, 0, (sz * d) / 2);
      const h = this.course.height(p.x, p.z);
      maxG = Math.max(maxG, h);
      minG = Math.min(minG, h);
    }
    const top = maxG + 0.14;
    const ly = top - f.pos.y;
    const depth = top - minG + 0.15;
    b.push(f.matrix);
    // Deck boards on bearers that run down into the ground.
    for (let k = 0; k < 5; k++) b.box('wood', w, 0.025, d / 5 - 0.02, mat(0, ly - 0.0125, -d / 2 + (k + 0.5) * (d / 5)), '#a88a62');
    for (const sx of [-1, 0, 1]) b.box('wood', 0.1, depth, d, mat((sx * (w - 0.1)) / 2, ly - 0.025 - depth / 2, 0), '#8a6e4a');
    b.pop();
    this.fixedBox(si, 'pallet', f.world(0, ly - 0.15, 0), new THREE.Vector3(w / 2, 0.15, d / 2), f.quat.clone(), 0.35);
    return top;
  }

  private newProp(id: string, kind: DynKind, pos: THREE.Vector3, quat: THREE.Quaternion, mass: number, si: number): DynProp {
    const p: DynProp = { id, kind, pos: pos.clone(), quat: quat.clone(), mass, colliders: [], parts: [], vis: [], angularDamping: 0.2, linearDamping: 0.05, body: null, breakable: false, broken: false, potIndex: -1, site: si };
    p.vis.push(this.addInstance(kind === 'hay' ? 'bale' : kind));
    this.props.push(p);
    return p;
  }

  /** Add a collider (Rapier) + matching primitive (ball sweeps) to a prop, in body-local space. */
  private addPart(p: DynProp, shape: 'box' | 'cyl' | 'ball', dims: { half?: THREE.Vector3; r?: number; hh?: number }, lp: THREE.Vector3, lq: THREE.Quaternion, restitution: number, friction: number) {
    p.colliders.push({ shape, ...dims, lp, lq, restitution, friction });
    // Rapier cylinders are y-axis; our 'cyl' primitive is too.
    const prim = makePrimitive({
      id: p.id,
      kind: p.kind,
      shape: shape === 'ball' ? 'sphere' : shape,
      center: new THREE.Vector3(),
      radius: dims.r ?? 0.1,
      height: dims.hh ?? 0.1,
      half: dims.half?.clone() ?? new THREE.Vector3(0.1, 0.1, 0.1),
      restitution,
      friction,
      tag: this.props.indexOf(p),
    });
    p.parts.push({ prim, lp, lq });
    this.posePrims(p);
  }

  private makeCrates(b: GeoBucket, f: Frame, si: number) {
    const rows = 3;
    const s = CRATE + 0.004;
    const top = this.pallet(b, f, si, rows * s + 0.2, s + 0.25);
    const ly = top - f.pos.y;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      const count = rows - r;
      for (let i = 0; i < count; i++) {
        const lx = (i - (count - 1) / 2) * s;
        const y = ly + CRATE / 2 + r * (CRATE + 0.002) + 0.002;
        const yawJ = (this.rand() - 0.5) * 0.08;
        const p = this.newProp(`crate${si}-${n++}`, 'crate', f.world(lx, y, 0), f.rot(0, yawJ, 0), 4, si);
        this.addPart(p, 'box', { half: new THREE.Vector3(CRATE / 2, CRATE / 2, CRATE / 2) }, new THREE.Vector3(), new THREE.Quaternion(), 0.35, 0.5);
      }
    }
  }

  private makePots(b: GeoBucket, f: Frame, si: number) {
    const rows = 4;
    const s = POT_R * 2 + 0.012;
    const top = this.pallet(b, f, si, rows * s + 0.2, s + 0.25);
    const ly = top - f.pos.y;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      const count = rows - r;
      for (let i = 0; i < count; i++) {
        const lx = (i - (count - 1) / 2) * s;
        const y = ly + POT_H / 2 + r * (POT_H + 0.002) + 0.002;
        const p = this.newProp(`pot${si}-${n++}`, 'pot', f.world(lx, y, 0), f.rot(0, this.rand() * 6.28, 0), 1.6, si);
        p.breakable = true;
        p.potIndex = this.potCount++;
        this.addPart(p, 'cyl', { r: POT_R, hh: POT_H / 2 }, new THREE.Vector3(), new THREE.Quaternion(), 0.3, 0.6);
      }
    }
  }

  private makeGong(b: GeoBucket, f: Frame, si: number) {
    const barY = 2.55;
    b.push(f.matrix);
    const lacquer = '#5a1a14';
    for (const sx of [-1, 1]) {
      b.box('wood', 0.16, barY + 0.5, 0.16, mat(sx * 0.95, (barY + 0.5) / 2 - 0.4, 0), lacquer);
      b.box('wood', 0.2, 0.12, 0.9, mat(sx * 0.95, 0.03, 0), '#3a1410');
      b.box('wood', 0.1, 0.55, 0.1, mat(sx * 0.95, 0.3, 0.28, 0.75), lacquer);
      b.box('wood', 0.1, 0.55, 0.1, mat(sx * 0.95, 0.3, -0.28, -0.75), lacquer);
      b.cyl('brass', 0.1, 0.06, 0.12, mat(sx * 0.95, barY + 0.17, 0), '#d6a24a', 10);
    }
    b.box('wood', 2.3, 0.16, 0.18, mat(0, barY, 0), lacquer);
    b.box('wood', 2.6, 0.08, 0.24, mat(0, barY + 0.12, 0, 0, 0, 0), '#3a1410');
    b.box('wood', 1.9, 0.1, 0.12, mat(0, 0.45, 0), lacquer);
    // Mallet resting against a post
    b.cyl('wood', 0.02, 0.02, 0.9, mat(1.15, 0.45, 0.15, 0, 0, 0.25), '#8a6440', 6);
    b.add('cloth', new THREE.SphereGeometry(0.08, 10, 8), mat(1.27, 0.88, 0.15), '#c9b48a');
    b.pop();
    for (const sx of [-1, 1]) this.fixedPost(si, 'gongframe', f.world(sx * 0.95, -0.4, 0), 0.09, barY + 0.5);
    this.fixedBox(si, 'gongframe', f.world(0, barY + 0.05, 0), new THREE.Vector3(1.3, 0.12, 0.12), f.quat.clone());
    const center = f.world(0, barY - 0.95, 0);
    const p = this.newProp(`gong${si}`, 'gong', center, f.quat.clone(), 7, si);
    p.angularDamping = 0.35;
    // Disc collider: cylinder axis along local z (rotate y→z).
    this.addPart(p, 'cyl', { r: 0.6, hh: 0.025 }, new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), 0.55, 0.2);
    p.joint = { kind: 'revolute', anchorWorld: f.world(0, barY - 0.08, 0), anchorLocal: new THREE.Vector3(0, 0.87, 0), axis: new THREE.Vector3(1, 0, 0) };
  }

  private makeTarget(b: GeoBucket, f: Frame, si: number) {
    const barY = 2.05;
    b.push(f.matrix);
    // A-frame stand: two splayed front legs per side and a crossbar.
    for (const sx of [-1, 1]) {
      b.box('wood', 0.08, 2.3, 0.08, mat(sx * 0.82, 1.0, -0.1, -0.18), '#7a5a3a');
      b.box('wood', 0.08, 2.2, 0.08, mat(sx * 0.82, 0.95, -0.5, 0.25), '#7a5a3a');
    }
    b.box('wood', 1.9, 0.1, 0.1, mat(0, barY, -0.28), '#6a4a2a');
    b.box('wood', 1.7, 0.06, 0.06, mat(0, 0.5, -0.33), '#6a4a2a');
    b.pop();
    for (const sx of [-1, 1]) this.fixedPost(si, 'targetstand', f.world(sx * 0.82, -0.3, -0.3), 0.07, barY + 0.3);
    this.fixedBox(si, 'targetstand', f.world(0, barY, -0.28), new THREE.Vector3(0.95, 0.06, 0.06), f.quat.clone());
    const center = f.world(0, barY - 0.9, -0.2);
    const p = this.newProp(`target${si}-${this.props.length}`, 'target', center, f.rot(-0.08, 0, 0), 9, si);
    p.angularDamping = 0.9;
    this.addPart(p, 'cyl', { r: 0.62, hh: 0.1 }, new THREE.Vector3(), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), 0.12, 0.6);
    p.joint = { kind: 'revolute', anchorWorld: f.world(0, barY - 0.05, -0.24), anchorLocal: new THREE.Vector3(0, 0.85, -0.04), axis: new THREE.Vector3(1, 0, 0) };
  }

  private makeScarecrow(f: Frame, si: number) {
    const base = f.world(0, -0.25, 0);
    const p = this.newProp(`scarecrow${si}`, 'scarecrow', base, f.quat.clone(), 9, si);
    p.angularDamping = 1.2;
    const I = new THREE.Quaternion();
    this.addPart(p, 'box', { half: new THREE.Vector3(0.05, 0.95, 0.05) }, new THREE.Vector3(0, 1.25, 0), I, 0.3, 0.5);
    this.addPart(p, 'box', { half: new THREE.Vector3(0.28, 0.4, 0.13) }, new THREE.Vector3(0, 1.38, 0), I, 0.2, 0.6);
    this.addPart(p, 'box', { half: new THREE.Vector3(0.95, 0.08, 0.08) }, new THREE.Vector3(0, 1.62, 0), I, 0.2, 0.6);
    this.addPart(p, 'ball', { r: 0.2 }, new THREE.Vector3(0, 1.98, 0), I, 0.25, 0.6);
    this.addPart(p, 'box', { half: new THREE.Vector3(0.24, 0.32, 0.1) }, new THREE.Vector3(0, 0.78, 0), I, 0.2, 0.6);
    p.joint = { kind: 'revolute', anchorWorld: base.clone(), anchorLocal: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), motor: { stiffness: 900, damping: 40 } };
  }

  private makeHay(b: GeoBucket, f: Frame, si: number) {
    // Two big round bales (static scenery, solid to the ball) …
    b.push(f.matrix);
    const rounds: [number, number, number][] = [[-1.9, 0.6, 0.2], [1.8, -0.4, -0.35]];
    for (const [lx, lz, ry] of rounds) {
      const w = f.world(lx, 0, lz);
      const gy = this.course.height(w.x, w.z) - f.pos.y;
      const side = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 28, 1, true);
      b.add('hay', side, mat(lx, gy + 0.72, lz, 0, ry, Math.PI / 2), '#d9b866');
      for (const s of [-1, 1]) {
        const cap = new THREE.CircleGeometry(0.75, 28);
        b.add('hay', cap, mat(lx + Math.cos(ry) * s * 0.6, gy + 0.72, lz - Math.sin(ry) * s * 0.6, 0, ry + (s * Math.PI) / 2), '#c9a656');
      }
      for (const k of [-0.3, 0.3]) b.add('cloth', new THREE.TorusGeometry(0.755, 0.012, 4, 28), mat(lx + Math.cos(ry) * k, gy + 0.72, lz - Math.sin(ry) * k, 0, ry + Math.PI / 2), '#6a4a2a');
      this.col({ id: `hay${si}`, kind: 'hay', shape: 'cyl', center: f.world(lx, gy + 0.72, lz), radius: 0.75, height: 0.6, rot: f.rot(0, ry, Math.PI / 2), restitution: 0.08, friction: 0.7 });
      this.sites[si].fixed.push({ shape: 'cyl', r: 0.75, hh: 0.6, pos: f.world(lx, gy + 0.72, lz), quat: f.rot(0, ry, Math.PI / 2) });
    }
    b.pop();
    // … and a small stack of square bales that can be knocked over.
    const top = this.pallet(b, f, si, 2.1, 0.75);
    const ly = top - f.pos.y;
    const spots: [number, number][] = [[-0.49, 0], [0.49, 0], [0, 1]];
    spots.forEach(([lx, row], i) => {
      const p = this.newProp(`bale${si}-${i}`, 'hay', f.world(lx, ly + 0.2 + row * 0.402 + 0.002, 0), f.rot(0, (this.rand() - 0.5) * 0.1, 0), 16, si);
      this.addPart(p, 'box', { half: new THREE.Vector3(0.475, 0.2, 0.24) }, new THREE.Vector3(), new THREE.Quaternion(), 0.1, 0.8);
    });
  }

  // ───────────────────────────── physics ─────────────────────────────

  /** Initialise Rapier and create bodies, joints and terrain patches. Safe to call once. */
  async initPhysics() {
    const mod = await import('@dimforge/rapier3d-compat');
    const R = (mod.default ?? mod) as Rapier;
    await R.init();
    this.R = R;
    const world = new R.World({ x: 0, y: -PHYS.gravity, z: 0 });
    world.timestep = STEP;
    this.world = world;
    this.events = new R.EventQueue(true);
    // Fixed scenery per site: terrain trimesh + frames/pallets.
    for (const s of this.sites) {
      const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
      const tm = this.groundPatch(s.frame.pos.x, s.frame.pos.z, GROUND_PATCH + 4);
      const gd = R.ColliderDesc.trimesh(tm.vertices, tm.indices);
      if (gd) world.createCollider(gd.setFriction(0.8).setRestitution(0.2), fixed);
      for (const fx of s.fixed) {
        const d = fx.shape === 'box' ? R.ColliderDesc.cuboid(fx.half!.x, fx.half!.y, fx.half!.z) : R.ColliderDesc.cylinder(fx.hh!, fx.r!);
        d.setTranslation(fx.pos.x, fx.pos.y, fx.pos.z).setRotation(fx.quat).setFriction(0.6);
        world.createCollider(d, fixed);
      }
      s.body = fixed;
    }
    for (const p of this.props) this.createBody(p);
  }

  private groundPatch(cx: number, cz: number, radius: number) {
    const g = this.course.grids;
    const cell = (2 * g.half) / (g.res - 1);
    const i0 = Math.max(0, Math.floor((cx - radius + g.half) / cell));
    const i1 = Math.min(g.res - 1, Math.ceil((cx + radius + g.half) / cell));
    const j0 = Math.max(0, Math.floor((cz - radius + g.half) / cell));
    const j1 = Math.min(g.res - 1, Math.ceil((cz + radius + g.half) / cell));
    const nx = i1 - i0 + 1;
    const nz = j1 - j0 + 1;
    const vertices = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      vertices[k] = -g.half + (i0 + i) * cell;
      vertices[k + 1] = g.heights[(j0 + j) * g.res + (i0 + i)];
      vertices[k + 2] = -g.half + (j0 + j) * cell;
    }
    const idx: number[] = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i; // (i, j)
      const b = a + 1; // (i+1, j)
      const c = a + nx; // (i, j+1)
      const d = c + 1; // (i+1, j+1)
      // Same diagonal as Course.height: (i, j+1)–(i+1, j); counter-clockwise from above.
      idx.push(a, c, b, d, b, c);
    }
    return { vertices, indices: new Uint32Array(idx) };
  }

  private createBody(p: DynProp) {
    const R = this.R!;
    const world = this.world!;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(p.pos.x, p.pos.y, p.pos.z)
      .setRotation(p.quat)
      .setAngularDamping(p.angularDamping)
      .setLinearDamping(p.linearDamping)
      .setCcdEnabled(!!p.ccd || p.kind === 'pot' || !!p.shard);
    if (!p.shard) desc.setSleeping(true);
    const body = world.createRigidBody(desc);
    const totalVol = p.colliders.reduce((a, c) => a + this.volume(c), 0) || 1;
    for (const c of p.colliders) {
      let d: RAPIER_NS.ColliderDesc | null;
      if (c.shape === 'box') d = R.ColliderDesc.cuboid(c.half!.x, c.half!.y, c.half!.z);
      else if (c.shape === 'cyl') d = R.ColliderDesc.cylinder(c.hh!, c.r!);
      else if (c.shape === 'ball') d = R.ColliderDesc.ball(c.r!);
      else d = R.ColliderDesc.convexHull(c.pts!) ?? R.ColliderDesc.cuboid(0.04, 0.04, 0.04);
      d.setTranslation(c.lp.x, c.lp.y, c.lp.z).setRotation(c.lq).setRestitution(c.restitution).setFriction(c.friction);
      d.setMass((p.mass * this.volume(c)) / totalVol);
      if (p.breakable) d.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(POT_BREAK_FORCE);
      const collider = world.createCollider(d, body);
      this.colliderToProp.set(collider.handle, p);
    }
    if (p.joint) {
      const site = this.sites[p.site];
      const j = p.joint;
      // Local anchor derived from the world anchor so the joint starts exactly satisfied.
      j.anchorLocal.copy(j.anchorWorld).sub(p.pos).applyQuaternion(_q.copy(p.quat).invert());
      // Axis is given in prop-local space; Rapier's revolute axis is shared, so express it in
      // world space for the fixed body (identity frame) and keep the prop-local value aligned.
      const worldAxis = j.axis.clone().applyQuaternion(p.quat);
      const data = R.JointData.revoluteWithAxes(
        { x: j.anchorWorld.x, y: j.anchorWorld.y, z: j.anchorWorld.z },
        { x: j.anchorLocal.x, y: j.anchorLocal.y, z: j.anchorLocal.z },
        { x: worldAxis.x, y: worldAxis.y, z: worldAxis.z },
        { x: j.axis.x, y: j.axis.y, z: j.axis.z },
      );
      const joint = world.createImpulseJoint(data, site.body!, body, true) as RAPIER_NS.RevoluteImpulseJoint;
      if (j.motor) joint.configureMotorPosition(0, j.motor.stiffness, j.motor.damping);
    }
    p.body = body;
  }

  private volume(c: DynProp['colliders'][number]) {
    if (c.shape === 'box') return 8 * c.half!.x * c.half!.y * c.half!.z;
    if (c.shape === 'cyl') return Math.PI * c.r! * c.r! * 2 * c.hh!;
    if (c.shape === 'ball') return (4 / 3) * Math.PI * c.r! ** 3;
    return 0.001;
  }

  /** Fixed-step the Rapier world and sync visuals/primitives of awake bodies. */
  update(dt: number) {
    const world = this.world;
    if (!world) return;
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      world.step(this.events!);
      this.acc -= STEP;
      steps++;
      this.events!.drainContactForceEvents((e) => {
        const f = e.maxForceMagnitude();
        for (const h of [e.collider1(), e.collider2()]) {
          const p = this.colliderToProp.get(h);
          if (p && p.breakable && !p.broken && f > POT_BREAK_FORCE && !this.breakQueue.some((q) => q.p === p)) this.breakQueue.push({ p, impulse: null });
        }
      });
      if (this.breakQueue.length) {
        for (const q of this.breakQueue) this.shatter(q.p, q.impulse);
        this.breakQueue.length = 0;
      }
    }
    if (!steps) return;
    const dirty = new Set<string>();
    for (const p of this.props) {
      if (!p.body || p.broken) continue;
      if (p.body.isSleeping()) {
        if (this.awake.has(p)) {
          this.awake.delete(p);
          this.readPose(p);
          this.syncVisual(p);
          for (const v of p.vis) dirty.add(v.type);
        }
        continue;
      }
      this.awake.add(p);
      this.readPose(p);
      // Fell off the patch: freeze.
      if (p.pos.y < this.course.height(p.pos.x, p.pos.z) - 3) p.body.sleep();
      this.syncVisual(p);
      for (const v of p.vis) dirty.add(v.type);
    }
    for (const t of dirty) this.visuals.get(t)!.mesh!.instanceMatrix.needsUpdate = true;
    // Shards
    let shardDirty = false;
    for (const s of this.shards) {
      if (!s.body || s.body.isSleeping()) continue;
      this.readPose(s);
      if (s.pos.y < this.course.height(s.pos.x, s.pos.z) - 2) s.body.sleep();
      _m.compose(s.pos, s.quat, ONE);
      this.shardMeshes[s.shard!.k].setMatrixAt(s.shard!.pot, _m);
      shardDirty = true;
    }
    if (shardDirty) for (const m of this.shardMeshes) m.instanceMatrix.needsUpdate = true;
  }

  private readPose(p: DynProp) {
    const t = p.body!.translation();
    const r = p.body!.rotation();
    p.pos.set(t.x, t.y, t.z);
    p.quat.set(r.x, r.y, r.z, r.w);
    this.posePrims(p);
  }

  private posePrims(p: DynProp) {
    for (const part of p.parts) {
      part.prim.center.copy(part.lp).applyQuaternion(p.quat).add(p.pos);
      part.prim.rot.copy(p.quat).multiply(part.lq);
      updateBounds(part.prim);
    }
  }

  private syncVisual(p: DynProp) {
    if (p.broken) _m.copy(ZERO_M);
    else _m.compose(p.pos, p.quat, ONE);
    for (const v of p.vis) this.visuals.get(v.type)?.mesh?.setMatrixAt(v.index, _m);
  }

  /** All dynamic primitives (for ball sweeps). */
  forEachPrim(fn: (prim: Primitive) => void) {
    for (const p of this.props) {
      if (p.broken) continue;
      for (const part of p.parts) fn(part.prim);
    }
  }

  /** Ball hit a dynamic prop: push it (or break it). Returns info for the hit event. */
  applyHit(prim: Primitive, point: THREE.Vector3, normal: THREE.Vector3, ballVel: THREE.Vector3): HitInfo | null {
    const p = this.props[prim.tag ?? -1];
    if (!p) return null;
    const vn = Math.max(0, -ballVel.dot(normal));
    const jRaw = PHYS.ballMass * (1 + prim.restitution) * vn;
    const info: HitInfo = { kind: p.kind, impulse: jRaw, broken: false };
    if (p.kind === 'target') {
      // Score by ring: distance from the boss centre in its face plane.
      _v.copy(point).sub(p.pos);
      _q.copy(p.quat).invert();
      _v.applyQuaternion(_q);
      const d = Math.hypot(_v.x, _v.y) / 0.62;
      info.score = Math.max(0, Math.min(10, 10 - Math.floor(d * 10)));
    }
    // Impulse along the ball's travel blended with the contact normal.
    _v.copy(normal).multiplyScalar(-0.7);
    const sp = ballVel.length();
    if (sp > 1e-3) _v.addScaledVector(ballVel, 0.3 / sp);
    _v.normalize().multiplyScalar(jRaw * IMPULSE_GAIN);
    if (p.breakable && jRaw > POT_BREAK_IMPULSE) {
      info.broken = true;
      if (this.world) this.shatter(p, _v.clone());
      else this.hideProp(p);
      return info;
    }
    if (p.body) {
      p.body.applyImpulseAtPoint({ x: _v.x, y: _v.y, z: _v.z }, { x: point.x, y: point.y, z: point.z }, true);
      this.awake.add(p);
    }
    return info;
  }

  private hideProp(p: DynProp) {
    p.broken = true;
    for (const part of p.parts) part.prim.enabled = false;
    this.syncVisual(p);
    for (const v of p.vis) this.visuals.get(v.type)!.mesh!.instanceMatrix.needsUpdate = true;
  }

  /** Replace a pot with its pre-split shards, inheriting its motion plus a burst. */
  private shatter(p: DynProp, impulse: THREE.Vector3 | null) {
    if (p.broken || !this.world || !this.R) return;
    const lin = p.body ? p.body.linvel() : { x: 0, y: 0, z: 0 };
    if (p.body) {
      this.readPose(p);
      for (let i = 0; i < p.body.numColliders(); i++) this.colliderToProp.delete(p.body.collider(i).handle);
      this.world.removeRigidBody(p.body);
      p.body = null;
    }
    this.hideProp(p);
    this.awake.delete(p);
    const burst = 1.2 + (impulse ? impulse.length() * 0.6 : 0.5);
    this.shardGeoms.forEach((sg, k) => {
      const lp = sg.center.clone().applyQuaternion(p.quat).add(p.pos);
      const s: DynProp = {
        id: `${p.id}-shard${k}`, kind: 'pot', pos: lp, quat: p.quat.clone(), mass: 0.2, colliders: [{ shape: 'hull', pts: sg.hull, lp: new THREE.Vector3(), lq: new THREE.Quaternion(), restitution: 0.25, friction: 0.7 }],
        parts: [], vis: [], angularDamping: 0.5, linearDamping: 0.1, body: null, breakable: false, broken: false, potIndex: -1, site: p.site, shard: { k, pot: p.potIndex }, ccd: true,
      };
      this.createBody(s);
      const out = _v2.copy(sg.center).setY(0).applyQuaternion(p.quat).normalize();
      const v = { x: lin.x + out.x * burst * (0.6 + this.rand() * 0.8), y: lin.y + 0.8 + this.rand() * 1.6, z: lin.z + out.z * burst * (0.6 + this.rand() * 0.8) };
      if (impulse) {
        v.x += (impulse.x / 1.6) * 0.8;
        v.y += (impulse.y / 1.6) * 0.8;
        v.z += (impulse.z / 1.6) * 0.8;
      }
      s.body!.setLinvel(v, true);
      s.body!.setAngvel({ x: (this.rand() - 0.5) * 18, y: (this.rand() - 0.5) * 18, z: (this.rand() - 0.5) * 18 }, true);
      this.shards.push(s);
      this.shardMeshes[k].visible = true;
      _m.compose(s.pos, s.quat, ONE);
      this.shardMeshes[k].setMatrixAt(p.potIndex, _m);
      this.shardMeshes[k].instanceMatrix.needsUpdate = true;
    });
    this.onBreak?.({ id: p.id, kind: 'pot', pos: p.pos.clone(), speed: burst });
  }

  /** Number of currently simulated (awake) bodies — for debugging/perf HUDs. */
  get activeBodies() {
    return this.awake.size;
  }

  dispose() {
    this.world?.free();
    this.world = null;
    for (const v of this.visuals.values()) v.geometry.dispose();
    for (const s of this.shardGeoms) s.geo.dispose();
  }
}
