/**
 * Water: every pond / mere / burn of the course as ONE merged, flat mesh (one draw call).
 *
 * Geometry: for each water body (course.field.holes[i].def.water[k], level = waterLevels[k]) a
 * grid of quads at y = level covering the blobs' bounding box + margin, keeping only cells whose
 * terrain dips below the surface. The terrain is carved below the level, so the shoreline
 * emerges per pixel in the shader (depth = level − courseHeight(xz), discard if < 0).
 *
 * Shading (see ./water/waterShader.ts): MeshPhysicalMaterial (ior 1.33) patched with
 * wind-aligned multi-octave ripple normals, analytic depth tint/absorption, shoreline foam,
 * Fresnel-weighted premultiplied output, three's sun GGX glint, PMREM sky reflection, fog.
 * On QUALITY.waterReflections the nearest visible body gets a planar reflection
 * (./water/PlanarReflection.ts) instead of the env-map reflection.
 */
import * as THREE from 'three';
import { courseUniforms, globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';
import { PlanarReflection } from './water/PlanarReflection';
import { createWaterNormalTexture } from './water/waterNormals';
import {
  WATER_FRAGMENT_PARS,
  WATER_NORMAL,
  WATER_OUTPUT,
  WATER_PLANAR,
  WATER_ROUGHNESS,
  WATER_SURFACE,
  WATER_VERTEX,
  WATER_VERTEX_PARS,
} from './water/waterShader';

// ---- tuning -------------------------------------------------------------------------------
/** Grid cell size (m) of the water surface mesh. */
const CELL = 1.5;
/** Extra margin (m) around the blobs' bounding box. */
const MARGIN = 12;
/** A cell is kept when any corner's terrain is below level + this (m). */
const KEEP_ABOVE = 0.35;
/** Linear colours. */
const DEEP_COLOR = new THREE.Color(0.006, 0.026, 0.03);
const SHALLOW_COLOR = new THREE.Color(0.05, 0.15, 0.12);
const FOAM_COLOR = new THREE.Color(0.78, 0.8, 0.76);
/** Planar reflection resolution (fraction of the drawing buffer) per quality. */
const REFL_SCALE: Record<QualityPreset['level'], number> = { low: 0, medium: 0.5, high: 0.6, ultra: 0.75 };
/** Ripple shader octaves per quality (0: 2 octaves … 2: 4 octaves). */
const DETAIL: Record<QualityPreset['level'], number> = { low: 0, medium: 1, high: 2, ultra: 2 };
/** Don't bother with a planar reflection for bodies farther than this (m). */
const REFL_MAX_DIST = 900;
/** Top-level scene objects never drawn into the reflection (besides userData.noReflect). */
const NO_REFLECT_NAMES = new Set(['grass', 'rain', 'fx']);

/**
 * Dev-only camera hook (`?watercam=1|2|3`): frames the hole-3 mere for visual checks
 * (1 = elevated into the sun, 2 = low grazing into the sun, 3 = looking down-sun).
 */
const _v = new THREE.Vector3();

const WATER_CAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('watercam') : null;

export interface WaterBody {
  hole: number;
  index: number;
  level: number;
  /** Bounding sphere of the body's surface (for culling / reflection selection). */
  sphere: THREE.Sphere;
  /** Tight bounds of the kept surface cells. */
  box: THREE.Box3;
  /** Evenly spread surface points (x, z pairs) for the reflection visibility test. */
  samples: Float32Array;
}

/** Max surface sample points per body for the line-of-sight test. */
const VIS_SAMPLES = 96;
/** Ray-march step (m) of the terrain line-of-sight test. */
const VIS_STEP = 2.5;
/** Margin (fraction of the screen) around the water's projected bounds for the reflection
 *  scissor: covers the ripple distortion of the lookup. */
const REFL_RECT_MARGIN = 0.04;
/** Keep the planar reflection this many frames after its body was last seen (hysteresis). */
const VIS_HOLD = 8;

export class WaterSystem implements RenderModule {
  readonly perfName = 'water';
  mesh: THREE.Mesh | null = null;
  material!: THREE.MeshPhysicalMaterial;
  bodies: WaterBody[] = [];
  private reflection = new PlanarReflection();
  private ripples!: THREE.DataTexture;
  quality!: QualityPreset;
  private uReflBody = { value: -1 };
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private hiddenTmp: THREE.Object3D[] = [];
  private lastBody: WaterBody | null = null;
  private holdFrames = 0;
  private visCheckSkip = 0;
  /** Whether the planar reflection was rendered this frame (perf HUD). */
  reflecting = false;

  /** Course-independent work while the course bakes (perf): the ripple normal texture. */
  prepare() {
    this.ripples ??= createWaterNormalTexture();
  }

  init(ctx: InitContext) {
    this.quality = ctx.quality;
    const geo = this.buildGeometry(ctx);
    if (!geo) return;
    this.prepare();
    this.material = this.createMaterial(ctx);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = 'water';
    mesh.renderOrder = -10; // first among transparents: splashes/tracers draw over it
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.userData.noReflect = true;
    mesh.raycast = () => {};
    this.mesh = mesh;
    this.reflection.hide = [mesh];
    ctx.scene.add(mesh);
    this.setQuality(ctx.quality);
  }

  /** Merged surface mesh for all water bodies; returns null when the course has no water. */
  private buildGeometry(ctx: InitContext): THREE.BufferGeometry | null {
    const field = ctx.course.field;
    const pos: number[] = [];
    const body: number[] = [];
    const idx: number[] = [];
    field.holes.forEach((hc, hi) => {
      hc.def.water.forEach((w, k) => {
        const level = hc.waterLevels[k];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const b of w.blobs) {
          const r = Math.max(b.r[0], b.r[1]);
          minX = Math.min(minX, b.c[0] - r);
          maxX = Math.max(maxX, b.c[0] + r);
          minZ = Math.min(minZ, b.c[1] - r);
          maxZ = Math.max(maxZ, b.c[1] + r);
        }
        minX -= MARGIN; maxX += MARGIN; minZ -= MARGIN; maxZ += MARGIN;
        const nx = Math.ceil((maxX - minX) / CELL);
        const nz = Math.ceil((maxZ - minZ) / CELL);
        // Corner "below the surface" flags.
        const below = new Uint8Array((nx + 1) * (nz + 1));
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
          const x = minX + i * CELL, z = minZ + j * CELL;
          below[j * (nx + 1) + i] = ctx.course.height(x, z) < level + KEEP_ABOVE ? 1 : 0;
        }
        const vmap = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
        const vid = (i: number, j: number) => {
          const key = j * (nx + 1) + i;
          if (vmap[key] < 0) {
            vmap[key] = pos.length / 3;
            pos.push(minX + i * CELL, level, minZ + j * CELL);
            body.push(this.bodies.length);
          }
          return vmap[key];
        };
        let any = false;
        let sx = 0, sz = 0, cnt = 0;
        const cells: number[] = [];
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          const b = (ii: number, jj: number) => below[jj * (nx + 1) + ii];
          // Keep the cell if it or a neighbour corner is wet (1-cell dilation hides grid edges).
          let wet = 0;
          for (let dj = -1; dj <= 2 && !wet; dj++) for (let di = -1; di <= 2 && !wet; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii <= nx && jj <= nz) wet = b(ii, jj);
          }
          if (!wet) continue;
          const a = vid(i, j), c = vid(i + 1, j), d = vid(i, j + 1), e = vid(i + 1, j + 1);
          idx.push(a, d, c, c, d, e);
          any = true;
          sx += i; sz += j; cnt++;
          // truly wet cells only (not the dilation ring) as visibility samples
          if (b(i, j) && b(i + 1, j + 1)) cells.push(minX + (i + 0.5) * CELL, minZ + (j + 0.5) * CELL);
        }
        if (!any) return;
        const cx = minX + (sx / cnt) * CELL, cz = minZ + (sz / cnt) * CELL;
        const rad = Math.hypot(maxX - minX, maxZ - minZ) * 0.5;
        const box = new THREE.Box3();
        for (let q = 0; q < cells.length; q += 2) box.expandByPoint(_v.set(cells[q], level, cells[q + 1]));
        box.expandByScalar(CELL * 2);
        const nCells = cells.length / 2;
        const take = Math.min(VIS_SAMPLES, nCells);
        const samples = new Float32Array(take * 2);
        // golden-ratio stride → points spread over the whole body
        for (let q = 0; q < take; q++) {
          const c = Math.floor(((q * 0.6180339887) % 1) * nCells);
          samples[q * 2] = cells[c * 2];
          samples[q * 2 + 1] = cells[c * 2 + 1];
        }
        if (!take) box.setFromCenterAndSize(new THREE.Vector3(cx, level, cz), new THREE.Vector3(rad * 2, 1, rad * 2));
        this.bodies.push({ hole: hi, index: k, level, sphere: new THREE.Sphere(new THREE.Vector3(cx, level, cz), rad), box, samples });
      });
    });
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private createMaterial(ctx: InitContext) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.06,
      metalness: 0,
      ior: 1.33,
      transparent: true,
      depthWrite: true,
      side: THREE.FrontSide,
    });
    const uniforms: Record<string, THREE.IUniform> = {
      ...courseUniforms(ctx.textures),
      uRipples: { value: this.ripples },
      uReflTex: { value: this.reflection.target.texture },
      uReflMatrix: { value: this.reflection.textureMatrix },
      uReflBody: this.uReflBody,
      uTime: globalUniforms.uTime,
      uWindDir: globalUniforms.uWindDir,
      uWindSpeed: globalUniforms.uWindSpeed,
      uDeepColor: { value: DEEP_COLOR },
      uShallowColor: { value: SHALLOW_COLOR },
      uFoamColor: { value: FOAM_COLOR },
    };
    mat.defines = { WATER_DETAIL: DETAIL[ctx.quality.level] };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WATER_VERTEX_PARS}`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${WATER_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WATER_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${WATER_SURFACE}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${WATER_ROUGHNESS}`)
        .replace('#include <normal_fragment_maps>', WATER_NORMAL)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${WATER_PLANAR}`)
        .replace('#include <opaque_fragment>', WATER_OUTPUT);
    };
    mat.customProgramCacheKey = () => `thornbury-water-${String(mat.defines?.WATER_DETAIL)}-${mat.defines?.USE_PLANAR !== undefined}`;
    return mat;
  }

  setQuality(q: QualityPreset) {
    this.quality = q;
    if (!this.mesh) return;
    const defs: Record<string, string | number> = { WATER_DETAIL: DETAIL[q.level] };
    if (q.waterReflections) defs.USE_PLANAR = '';
    this.material.defines = defs;
    this.material.needsUpdate = true;
    this.reflection.scale = REFL_SCALE[q.level];
    if (!q.waterReflections) this.reflection.target.setSize(16, 16); // free the big target
  }

  /**
   * Nearest water body that is actually visible: in the view frustum AND with at least one of
   * its surface sample points in view and not hidden behind the terrain (CPU line of sight on
   * the course heightfield). Perf: the planar reflection re-renders most of the scene, and the
   * loose bounding-sphere test alone fired for ponds hidden behind a hill (e.g. the first tee).
   */
  private activeBody(camera: THREE.PerspectiveCamera, course: FrameContext['course']): WaterBody | null {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const cam = camera.position;
    const cands: { b: WaterBody; d: number }[] = [];
    for (const b of this.bodies) {
      if (!this.frustum.intersectsBox(b.box)) continue;
      const d = b.box.distanceToPoint(cam);
      if (d < REFL_MAX_DIST) cands.push({ b, d });
    }
    cands.sort((x, y) => x.d - y.d);
    // Re-test line of sight only every few frames while the same body stays a candidate.
    if (this.visCheckSkip > 0 && this.lastBody && cands.some((c) => c.b === this.lastBody)) {
      this.visCheckSkip--;
      return this.lastBody;
    }
    for (const { b } of cands) if (this.bodyVisible(b, cam, course)) return b;
    return null;
  }

  /** Any sample point of the body inside the frustum with a clear line of sight over the terrain. */
  private bodyVisible(b: WaterBody, cam: THREE.Vector3, course: FrameContext['course']): boolean {
    const s = b.samples;
    if (!s.length) return true;
    const y = b.level + 0.05;
    for (let q = 0; q < s.length; q += 2) {
      const px = s[q], pz = s[q + 1];
      if (!this.frustum.containsPoint(_v.set(px, y, pz))) continue;
      const dx = px - cam.x, dy = y - cam.y, dz = pz - cam.z;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(len / VIS_STEP));
      let clear = true;
      // skip the last step: the water sits in a terrain hollow right at the sample point
      for (let k = 1; k < n - 1; k++) {
        const t = k / n;
        if (course.height(cam.x + dx * t, cam.z + dz * t) > cam.y + dy * t + 0.1) {
          clear = false;
          break;
        }
      }
      if (clear) return true;
    }
    return false;
  }

  update(ctx: FrameContext) {
    if (!this.mesh) return;
    if (WATER_CAM) this.devCamera(ctx);
    this.uReflBody.value = -1;
    this.reflecting = false;
    if (!ctx.quality.waterReflections) return;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    // Visibility is re-tested every few frames; a body stays reflected for VIS_HOLD frames after
    // it was last seen so the reflection never flickers on/off at a silhouette.
    let b = this.activeBody(cam, ctx.course);
    if (b) {
      if (b !== this.lastBody || this.visCheckSkip === 0) this.visCheckSkip = 3;
      this.lastBody = b;
      this.holdFrames = VIS_HOLD;
    } else if (this.lastBody && this.holdFrames > 0 && this.frustum.intersectsBox(this.lastBody.box)) {
      this.holdFrames--;
      b = this.lastBody;
    } else {
      this.lastBody = null;
      this.holdFrames = 0;
    }
    this.reflecting = b !== null;
    if (!b) return;
    // Hide named heavy/irrelevant groups (grass, rain, effects) for the reflection pass.
    const extra = this.hiddenTmp;
    extra.length = 0;
    for (const o of ctx.scene.children) if (o.visible && NO_REFLECT_NAMES.has(o.name)) { o.visible = false; extra.push(o); }
    const ok = this.reflection.render(ctx.renderer, ctx.scene, cam, b.level, b.box, REFL_RECT_MARGIN);
    for (const o of extra) o.visible = true;
    extra.length = 0;
    if (ok) this.uReflBody.value = this.bodies.indexOf(b);
  }

  private devCamera(ctx: FrameContext) {
    const b = this.bodies.find((x) => x.hole === 2) ?? this.bodies[0];
    if (!b) return;
    const c = b.sphere.center;
    const cam = ctx.camera;
    if (WATER_CAM === '2') cam.position.set(c.x + 40, b.level + 1.6, c.z + 22);
    else if (WATER_CAM === '3') cam.position.set(c.x - 45, b.level + 5, c.z - 30);
    else cam.position.set(c.x + 55, b.level + 9, c.z + 32);
    const gy = ctx.course.height(cam.position.x, cam.position.z);
    if (cam.position.y < gy + 1.5) cam.position.y = gy + 1.5;
    cam.lookAt(c.x, b.level, c.z);
    cam.updateMatrixWorld();
  }

  /** Water surface height at (x, z), or null if dry (analytic, matches the hazard). */
  levelAt(course: FrameContext['course'], x: number, z: number): number | null {
    return course.waterHeight(x, z);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.removeFromParent();
    this.material?.dispose();
    this.ripples?.dispose();
    this.reflection.dispose();
  }
}
