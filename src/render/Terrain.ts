/**
 * Terrain: GPU-displaced, instanced heightfield chunks with geomorphed LOD (see
 * terrain/ChunkGrid.ts), shaded by a procedural splat material (terrain/terrainShader.ts)
 * driven by the baked SDF masks: fairway with mowing stripes, first cut, green collar and
 * cross-cut greens, tees, rough, deep rough with fescue, forest floor, rim forest/rock, raked
 * sand, cart paths and lake beds.
 *
 * A low-poly horizon ring of procedural mountains (terrain/FarRing.ts) continues the landscape
 * beyond the baked 1600 m world so the heightmap edge is never visible.
 *
 * Cost: one draw call per LOD level (≤ 5) + 1 for the horizon ring in the main pass, ≤ 2 for
 * the sun shadow pass.
 */
import * as THREE from 'three';
import { courseUniforms, globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';
import { ChunkSelector, LOD_STEPS, buildChunks, buildLevelGeometry, lodSwitchDistances, morphWindows, shadowCastingLevel } from './terrain/ChunkGrid';
import { bakeSlopeTexture, buildMowData } from './terrain/TerrainData';
import { buildFarRingGeometry } from './terrain/FarRing';
import {
  TERRAIN_FAR_VERTEX,
  TERRAIN_FAR_VERTEX_PARS,
  TERRAIN_FRAGMENT_PARS,
  TERRAIN_NORMAL,
  TERRAIN_ROUGHNESS,
  TERRAIN_SPECULAR,
  TERRAIN_SURFACE,
  TERRAIN_VERTEX_PARS,
} from './terrain/terrainShader';

/** Shader detail level per quality preset (0 = cheapest). */
const DETAIL_BY_QUALITY: Record<QualityPreset['level'], number> = { low: 0, medium: 1, high: 2, ultra: 2 };
/** Chunks within this distance are kept even when off-screen (they may cast shadows into view). */
const SHADOW_KEEP_MARGIN = 1.15;
const PROGRAM_KEY = 'thornbury-terrain-v2';

export class Terrain implements RenderModule {
  group = new THREE.Group();
  /** LOD0 material (all levels share one program; they differ only by morph/step uniforms). */
  material!: THREE.MeshStandardMaterial;
  materials: THREE.MeshStandardMaterial[] = [];
  /** Horizon ring beyond the world edge. */
  farRing: THREE.Mesh | null = null;
  /** RGBA16F: (dh/dx, dh/dz, small-scale curvature, large-scale curvature). Usable by other modules. */
  slopeTexture!: THREE.DataTexture;
  private depthMaterials: THREE.MeshDepthMaterial[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private selector!: ChunkSelector;
  private levelUniforms: { uStep: THREE.IUniform<number>; uMorph: THREE.IUniform<THREE.Vector2> }[] = [];
  private detail = 2;
  private course: InitContext['course'] | null = null;

  init(ctx: InitContext) {
    const g = ctx.grids;
    this.course = ctx.course;
    const cell = (2 * g.half) / (g.res - 1);
    this.slopeTexture = bakeSlopeTexture(g);
    const mow = buildMowData();
    const shared: Record<string, THREE.IUniform> = {
      ...courseUniforms(ctx.textures),
      uSlopeTex: { value: this.slopeTexture },
      uCameraPos: globalUniforms.uCameraPos,
      uWetness: globalUniforms.uWetness,
      uFairSeg: { value: mow.fairwaySegs },
      uFairCount: { value: mow.fairwayCount },
      uGreens: { value: mow.greens },
      uTees: { value: mow.tees },
      uHoleCount: { value: mow.holeCount },
    };
    this.detail = DETAIL_BY_QUALITY[ctx.quality.level];

    const chunks = buildChunks(g.heights, g.res, g.half);
    this.group.name = 'terrain';
    LOD_STEPS.forEach((step, k) => {
      const lu = { uStep: { value: step }, uMorph: { value: new THREE.Vector2(1e9, 1e9 + 1) } };
      this.levelUniforms.push(lu);
      const mat = this.createMaterial({ ...shared, ...lu });
      const depth = this.createDepthMaterial({ ...shared, ...lu });
      this.materials.push(mat);
      this.depthMaterials.push(depth);
      const mesh = new THREE.InstancedMesh(buildLevelGeometry(step, cell), mat, chunks.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false; // culled per chunk on the CPU
      mesh.matrixAutoUpdate = false;
      mesh.receiveShadow = true;
      mesh.castShadow = shadowCastingLevel(k);
      mesh.customDepthMaterial = depth;
      mesh.raycast = () => {}; // use Course.height() / Course.normal() for queries
      mesh.name = `terrain-lod${k}`;
      this.meshes.push(mesh);
      this.group.add(mesh);
    });
    this.material = this.materials[0];

    const farMat = this.createMaterial(shared, true);
    this.materials.push(farMat);
    this.farRing = new THREE.Mesh(buildFarRingGeometry(g), farMat);
    this.farRing.name = 'terrain-horizon';
    this.farRing.receiveShadow = false;
    this.farRing.castShadow = false;
    this.farRing.matrixAutoUpdate = false;
    this.farRing.raycast = () => {};
    this.group.add(this.farRing);
    this.selector = new ChunkSelector(chunks, this.meshes);
    ctx.scene.add(this.group);
    this.setQuality(ctx.quality);
    // Select chunks once so the very first frame is complete.
    ctx.camera.updateMatrixWorld();
    this.selector.update(ctx.camera);
  }

  setQuality(q: QualityPreset) {
    const sw = lodSwitchDistances(q.terrainLodBias);
    const win = morphWindows(sw);
    this.levelUniforms.forEach((u, k) => u.uMorph.value.copy(win[k]));
    if (this.selector) {
      this.selector.switchDist = sw;
      this.selector.shadowKeep = q.shadowDistance * SHADOW_KEEP_MARGIN;
    }
    const detail = DETAIL_BY_QUALITY[q.level];
    if (detail !== this.detail) {
      this.detail = detail;
      for (const m of this.materials) {
        m.defines = { ...m.defines, TERRAIN_DETAIL: detail };
        m.needsUpdate = true;
      }
    }
  }

  update(ctx: FrameContext) {
    ctx.camera.updateMatrixWorld();
    this.selector.update(ctx.camera);
  }

  /** Rendered terrain height (identical to physics). */
  heightAt(x: number, z: number): number {
    return this.course ? this.course.height(x, z) : 0;
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.farRing?.geometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.depthMaterials) m.dispose();
    this.slopeTexture?.dispose();
    this.group.removeFromParent();
  }

  /** Splat material; `far` = horizon-ring variant (plain geometry with vertex normals). */
  private createMaterial(uniforms: Record<string, THREE.IUniform>, far = false) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    mat.defines = far ? { TERRAIN_COLOR: '', TERRAIN_FAR: '', TERRAIN_DETAIL: this.detail } : { TERRAIN_COLOR: '', TERRAIN_DETAIL: this.detail };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (far) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${TERRAIN_FAR_VERTEX_PARS}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TERRAIN_FAR_VERTEX}`);
      } else {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
          .replace('#include <beginnormal_vertex>', 'vec3 tNrmW;\nvec3 tLocal = terrainDisplace(position, tNrmW);\nvec3 objectNormal = tNrmW;')
          .replace('#include <begin_vertex>', 'vec3 transformed = tLocal;');
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${TERRAIN_SURFACE}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${TERRAIN_ROUGHNESS}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${TERRAIN_NORMAL}`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${TERRAIN_SPECULAR}`);
    };
    mat.customProgramCacheKey = () => (far ? `${PROGRAM_KEY}-far` : PROGRAM_KEY);
    return mat;
  }

  private createDepthMaterial(uniforms: Record<string, THREE.IUniform>) {
    const mat = new THREE.MeshDepthMaterial();
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', 'vec3 tNrmW;\nvec3 transformed = terrainDisplace(position, tNrmW);');
    };
    mat.customProgramCacheKey = () => `${PROGRAM_KEY}-depth`;
    return mat;
  }
}
