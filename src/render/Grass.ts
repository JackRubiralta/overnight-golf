/**
 * Grass: GPU-instanced grass blades around the camera.
 *
 * Four concentric LOD rings (two on Low), each ONE instanced draw (no per-instance attributes):
 *   ring 0 – very dense 6-row curved blades right around the camera (mown turf reads as turf)
 *   ring 1 – ¼ of that density, same blades
 *   ring 2 – 1/16 density, 4-row blades 2× wider, partly camera-facing
 *   ring 3 – 1/64 density, 3-row blades 3.5× wider, mostly camera-facing
 * Each ring is a square grid of cells snapped to the camera's cell (so blades never swim);
 * every blade's root, height, colour and shape are derived in the vertex shader from a stable
 * world-space hash plus the baked course textures (height + SDF masks). Rings cross-fade by
 * stochastic per-blade thinning + height shrink, and the outer ring fades to nothing at
 * QualityPreset.grassRadius, so nothing pops. Wind and player/ball bending come from
 * globalUniforms. Material = MeshStandardMaterial + onBeforeCompile → PBR lighting, IBL, fog
 * and shadow receiving, plus a translucency term for back-lit golden-hour glow.
 */
import * as THREE from 'three';
import { createBladeGeometry } from './grass/bladeGeometry';
import { GRASS_FRAGMENT_PARS, GRASS_LIGHT_OVERRIDE, GRASS_MOW_SEGS, GRASS_SHADOW_POS, GRASS_VERTEX_PARS } from './grass/grassShader';
import { buildMowData, type MowData } from './terrain/TerrainData';
import { courseUniforms, globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';

// ---------------------------------------------------------------- tuning
/** Tuft roots per cell = SUB²; stratified sub-cell jitter keeps the distribution even. */
const SUB = 2;
interface RingDef {
  /** Outer radius as a fraction of QualityPreset.grassRadius. */
  outer: number;
  /** Tuft-root density relative to QualityPreset.grassDensity (blades/m² = that × tuft). */
  density: number;
  /** Blades per tuft root. */
  tuft: number;
  /** Blade width multiplier (compensates coverage in sparser rings). */
  width: number;
  /** Row t-values along the blade (tip vertex at t = 1 is implicit). */
  rows: number[];
  /** 0 = random yaw, 1 = face the camera. */
  facing: number;
}
const RINGS: RingDef[] = [
  { outer: 0.085, density: 4, tuft: 4, width: 1, rows: [0, 0.22, 0.44, 0.64, 0.82], facing: 0 },
  { outer: 0.24, density: 1, tuft: 4, width: 1, rows: [0, 0.22, 0.44, 0.64, 0.82], facing: 0 },
  { outer: 0.58, density: 1 / 4, tuft: 2, width: 2.0, rows: [0, 0.35, 0.65, 0.85], facing: 0.35 },
  { outer: 1, density: 1 / 16, tuft: 2, width: 3.5, rows: [0, 0.5, 0.78], facing: 0.7 },
];
/** Low quality skips the extra-dense near ring and the far ring (2 draws). */
const LOW_RINGS = [1, 2];
/** Width of the cross-fade band between rings, as a fraction of the inner ring's radius. */
const BLEND = 0.22;
/** Blades with an angular height below this (rad) shrink away (≈1.5 px at 1440p/60° fov). */
const MIN_ANGLE = 0.0011;
const HEIGHT_MUL = 1.0;
/** Extra half-angle (rad) around the camera's diagonal FOV when fitting the instance rectangle. */
const WEDGE_MARGIN = 0.12;
/** Always cover this many metres around the camera (blades beside/behind the near plane). */
const NEAR_PAD = 2.5;
/** Transmission tint: chlorophyll-filtered light is a saturated yellow-green, not the sun's orange. */
const TRANS_TINT = new THREE.Color(0.85, 1.2, 0.4);
const TRANS_STRENGTH = 0.75;
/** Multiplier on the PBR specular (direct + IBL). */
const SPECULAR = 0.25;

interface Ring {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  cell: number;
  /** Max cells per side (full disk). */
  gridN: number;
  outer: number;
  tuft: number;
  uniforms: Record<string, THREE.IUniform>;
}

export class Grass implements RenderModule {
  readonly perfName = 'grass';
  group = new THREE.Group();
  private rings: Ring[] = [];
  private ctx: InitContext | null = null;
  private radius = 55;
  /** Angular size of one pixel, shared by all rings (updated per frame). */
  private pixelAngle = { value: 0.001 };
  private tmpSize = new THREE.Vector2();
  private fwd = new THREE.Vector3();
  private ray = new THREE.Vector3();
  private camXZ = new THREE.Vector2();
  private wedge: THREE.Vector2[] | null = null;
  /** Mowing axes (fairway centre-lines, tees) for the stripe colours on mown blades. */
  private mow: MowData | null = null;
  /** Shared by all rings: the fairway segments / tee nearest the camera (picked per frame). */
  private mowSegs = Array.from({ length: GRASS_MOW_SEGS }, () => new THREE.Vector4(1e5, 1e5, 1e5 + 1, 1e5));
  private mowTee = new THREE.Vector4(1e5, 1e5, 1, 0);
  private mowAt = new THREE.Vector2(1e9, 1e9);
  /** Extra density multiplier (e.g. a settings slider); 1 = preset density. */
  densityScale = 1;

  init(ctx: InitContext) {
    this.ctx = ctx;
    this.group.name = 'grass';
    this.mow = buildMowData();
    ctx.scene.add(this.group);
    this.build(ctx.quality);
  }

  setQuality(q: QualityPreset) {
    if (this.ctx) this.build(q);
  }

  /** Change the density multiplier at runtime (rebuilds the instance grids). */
  setDensityScale(s: number) {
    this.densityScale = Math.max(0.1, s);
    if (this.ctx) this.build(this.ctx.quality);
  }

  update(ctx: FrameContext) {
    const cam = ctx.camera.position;
    // Hide everything when the camera is far above the ground (aerial / overview cameras).
    const ground = ctx.course.height(cam.x, cam.z);
    const visible = cam.y - ground < this.radius * 0.9;
    this.group.visible = visible;
    if (!visible) return;
    const h = ctx.renderer.getDrawingBufferSize(this.tmpSize).y || 1;
    this.pixelAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2)) / h;
    this.updateFootprint(ctx.camera);
    this.updateMowing(cam.x, cam.z);
    for (const r of this.rings) this.fitRing(r);
  }

  /** Pick the fairway centre-line segments and the tee nearest the camera for the stripe shader. */
  private updateMowing(x: number, z: number) {
    const m = this.mow;
    if (!m || Math.hypot(x - this.mowAt.x, z - this.mowAt.y) < 1) return;
    this.mowAt.set(x, z);
    const segDist = (s: THREE.Vector4) => {
      const abx = s.z - s.x, abz = s.w - s.y;
      const L2 = Math.max(abx * abx + abz * abz, 1e-6);
      const t = Math.min(1, Math.max(0, ((x - s.x) * abx + (z - s.y) * abz) / L2));
      return Math.hypot(x - s.x - abx * t, z - s.y - abz * t);
    };
    const best = m.fairwaySegs
      .slice(0, m.fairwayCount)
      .map((s) => ({ s, d: segDist(s) }))
      .sort((a, b) => a.d - b.d);
    this.mowSegs.forEach((v, i) => (best[i] ? v.copy(best[i].s) : v.set(1e5, 1e5, 1e5 + 1, 1e5)));
    let bd = Infinity;
    for (let i = 0; i < m.holeCount; i++) {
      const t = m.tees[i];
      const d = Math.hypot(t.x - x, t.y - z);
      if (d < bd) { bd = d; this.mowTee.copy(t); }
    }
  }

  /**
   * Horizontal view wedge: unit directions bounding what the camera can see in the xz-plane, or
   * null when the camera looks steeply down/up (then the whole disk is used).
   */
  private updateFootprint(cam: THREE.PerspectiveCamera) {
    cam.getWorldDirection(this.fwd);
    this.camXZ.set(cam.position.x, cam.position.z);
    this.wedge = null;
    const fx = this.fwd.x, fz = this.fwd.z;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.2) return; // looking (nearly) straight down/up: use the whole disk
    const yaw = Math.atan2(fz, fx);
    // Horizontal angle of each frustum corner ray, relative to the view yaw.
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const th = tv * cam.aspect;
    let half = 0;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.ray.set(sx * th, sy * tv, -1).transformDirection(cam.matrixWorld);
      const rl = Math.hypot(this.ray.x, this.ray.z);
      if (rl < 1e-3 || (this.ray.x * fx + this.ray.z * fz) / (rl * fl) < 0.05) return;
      const a = Math.atan2(this.ray.z, this.ray.x) - yaw;
      half = Math.max(half, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
    }
    half += WEDGE_MARGIN;
    if (half >= Math.PI / 2) return;
    this.wedge = [];
    for (let i = 0; i <= 6; i++) {
      const a = yaw - half + (2 * half * i) / 6;
      this.wedge.push(new THREE.Vector2(Math.cos(a), Math.sin(a)));
    }
  }

  /** Fit a ring's instance rectangle to (disk ∩ view wedge), in whole cells. */
  private fitRing(r: Ring) {
    const R = r.outer;
    const c = this.camXZ;
    let minX = c.x - NEAR_PAD, maxX = c.x + NEAR_PAD, minZ = c.y - NEAR_PAD, maxZ = c.y + NEAR_PAD;
    if (this.wedge) {
      for (const d of this.wedge) {
        minX = Math.min(minX, c.x + d.x * R);
        maxX = Math.max(maxX, c.x + d.x * R);
        minZ = Math.min(minZ, c.y + d.y * R);
        maxZ = Math.max(maxZ, c.y + d.y * R);
      }
    } else {
      minX = c.x - R; maxX = c.x + R; minZ = c.y - R; maxZ = c.y + R;
    }
    minX = Math.max(minX, c.x - R); maxX = Math.min(maxX, c.x + R);
    minZ = Math.max(minZ, c.y - R); maxZ = Math.min(maxZ, c.y + R);
    const i0 = Math.floor(minX / r.cell), i1 = Math.floor(maxX / r.cell);
    const j0 = Math.floor(minZ / r.cell), j1 = Math.floor(maxZ / r.cell);
    const w = Math.min(i1 - i0 + 1, r.gridN);
    const h = Math.min(j1 - j0 + 1, r.gridN);
    (r.uniforms.uOrigin.value as THREE.Vector2).set(i0, j0);
    r.uniforms.uGridN.value = w;
    r.mesh.geometry.instanceCount = w * h;
  }

  /** Renderer-independent instance/blade counts (for perf HUDs). */
  stats() {
    let instances = 0;
    let blades = 0;
    for (const r of this.rings) {
      instances += r.mesh.geometry.instanceCount;
      blades += r.mesh.geometry.instanceCount * SUB * SUB * r.tuft;
    }
    return { rings: this.rings.length, instances, blades };
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }

  private clear() {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      this.group.remove(r.mesh);
    }
    this.rings = [];
  }

  private build(q: QualityPreset) {
    const ctx = this.ctx!;
    this.clear();
    this.radius = q.grassRadius;
    const defs = q.level === 'low' ? LOW_RINGS.map((i) => RINGS[i]) : RINGS;
    const scaleR = 1 / defs[defs.length - 1].outer;
    const course = courseUniforms(ctx.textures);
    let inner = 0;
    defs.forEach((d, i) => {
      const outer = d.outer * scaleR * q.grassRadius;
      const density = q.grassDensity * this.densityScale * d.density;
      const cell = Math.sqrt((SUB * SUB) / density);
      const gridN = Math.ceil((2 * outer) / cell) + 2;
      const isLast = i === defs.length - 1;
      // fade-in band [inner - blendPrev, inner], fade-out band [outer - blend, outer]
      const blendIn = i === 0 ? 0 : BLEND * inner;
      const fadeOutStart = isLast ? outer * 0.72 : outer - BLEND * outer;
      const uniforms: Record<string, THREE.IUniform> = {
        ...course,
        uTime: globalUniforms.uTime,
        uWindDir: globalUniforms.uWindDir,
        uWindSpeed: globalUniforms.uWindSpeed,
        uPlayerPos: globalUniforms.uPlayerPos,
        uBallPos: globalUniforms.uBallPos,
        uOrigin: { value: new THREE.Vector2() },
        uCell: { value: cell },
        uGridN: { value: gridN },
        uSub: { value: SUB },
        uTuft: { value: d.tuft },
        uRing: { value: new THREE.Vector4(i === 0 ? -1 : inner - blendIn, i === 0 ? -1 : inner, fadeOutStart, outer) },
        uWidth: { value: d.width },
        uFacing: { value: d.facing },
        uMinAngle: { value: MIN_ANGLE },
        uHeightMul: { value: HEIGHT_MUL },
        uRadius: { value: q.grassRadius },
        uTransTint: { value: TRANS_TINT },
        uTransStrength: { value: TRANS_STRENGTH },
        uSpecular: { value: SPECULAR },
        uPixelAngle: this.pixelAngle,
        uMowSegs: { value: this.mowSegs },
        uMowTee: { value: this.mowTee },
      };
      const geo = createBladeGeometry(d.rows, SUB * SUB * d.tuft, gridN * gridN);
      const mat = createGrassMaterial(uniforms);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `grass-ring${i}`;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.raycast = () => {};
      mesh.renderOrder = -1; // draw early: lots of overdraw-occluding geometry near the camera
      this.group.add(mesh);
      this.rings.push({ mesh, cell, gridN, outer, tuft: d.tuft, uniforms });
      inner = outer;
    });
  }
}

function createGrassMaterial(uniforms: Record<string, THREE.IUniform>) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}`)
      .replace('#include <beginnormal_vertex>', 'vec3 grassPos;\nvec3 grassN;\ngrassVertex(grassPos, grassN);\nvec3 objectNormal = grassN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = grassPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${GRASS_SHADOW_POS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GRASS_FRAGMENT_PARS}`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal *= faceDirection; // undo DoubleSide flip: normals already face the viewer')
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${GRASS_LIGHT_OVERRIDE}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vGrassCol * vGrassAO * (0.8 + 0.2 * (1.0 - vGrassSide * vGrassSide)); // darker, folded edges')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= uSpecular;');
  };
  // All rings share one program (they differ only by uniforms and geometry).
  mat.customProgramCacheKey = () => 'thornbury-grass-v2';
  return mat;
}
