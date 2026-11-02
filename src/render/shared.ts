/**
 * Shared rendering contracts. Every visual subsystem is a RenderModule that receives the
 * same FrameContext each frame and can read the global uniforms (time, wind, sun) in shaders.
 */
import * as THREE from 'three';
import type { Course } from '../course/Course';
import type { CourseGrids } from '../course/CourseField';
import type { QualityLevel } from '../core/settings';

/** Uniform objects shared by reference across all custom shaders. */
export const globalUniforms = {
  uTime: { value: 0 },
  /** Normalised horizontal wind direction (x, z) the wind blows TOWARD. */
  uWindDir: { value: new THREE.Vector2(1, 0) },
  /** Wind speed in m/s. */
  uWindSpeed: { value: 3 },
  /** World-space direction TO the sun. */
  uSunDir: { value: new THREE.Vector3(0.3, 0.5, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
  uFogColor: { value: new THREE.Color(0.75, 0.8, 0.85) },
  uFogDensity: { value: 0.0009 },
  /** Camera position (for distance-based LOD/fade in shaders). */
  uCameraPos: { value: new THREE.Vector3() },
  /** Ball & player position (grass interaction / bending). */
  uPlayerPos: { value: new THREE.Vector3() },
  uBallPos: { value: new THREE.Vector3() },
  /** Rain amount 0..1 (wet look). */
  uWetness: { value: 0 },
};

export interface CourseTextures {
  /** R32F heightmap, res × res, covering [-half, half]². Use NearestFilter-safe manual bilinear or LinearFilter (float-linear is optional). */
  height: THREE.DataTexture;
  /** RGBA8: fairway, green, bunker, water SDF (byte = 128 + d*16, d in metres, + outside). */
  maskA: THREE.DataTexture;
  /** RGBA8: tee SDF, path SDF, corridor distance (0.5 m units), foliage density (0..255). */
  maskB: THREE.DataTexture;
  res: number;
  half: number;
}

export interface QualityPreset {
  level: QualityLevel;
  pixelRatioCap: number;
  shadowMapSize: number;
  shadowDistance: number;
  grassRadius: number;
  grassDensity: number; // blades per m² near the camera
  treeCount: number;
  drawDistance: number;
  terrainLodBias: number;
  ao: boolean;
  bloom: boolean;
  dof: boolean;
  smaa: boolean;
  waterReflections: boolean;
  cloudSteps: number;
}

export const QUALITY: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', pixelRatioCap: 1, shadowMapSize: 1024, shadowDistance: 80, grassRadius: 28, grassDensity: 18, treeCount: 900, drawDistance: 1600, terrainLodBias: 0.6, ao: false, bloom: false, dof: false, smaa: true, waterReflections: false, cloudSteps: 0 },
  medium: { level: 'medium', pixelRatioCap: 1.25, shadowMapSize: 2048, shadowDistance: 120, grassRadius: 40, grassDensity: 32, treeCount: 1600, drawDistance: 2200, terrainLodBias: 0.85, ao: true, bloom: true, dof: false, smaa: true, waterReflections: true, cloudSteps: 8 },
  high: { level: 'high', pixelRatioCap: 1.5, shadowMapSize: 4096, shadowDistance: 160, grassRadius: 55, grassDensity: 50, treeCount: 2600, drawDistance: 3000, terrainLodBias: 1, ao: true, bloom: true, dof: true, smaa: true, waterReflections: true, cloudSteps: 16 },
  ultra: { level: 'ultra', pixelRatioCap: 2, shadowMapSize: 4096, shadowDistance: 220, grassRadius: 75, grassDensity: 80, treeCount: 3800, drawDistance: 4000, terrainLodBias: 1.3, ao: true, bloom: true, dof: true, smaa: true, waterReflections: true, cloudSteps: 24 },
};

export interface FrameContext {
  time: number;
  dt: number;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  course: Course;
  quality: QualityPreset;
  /** Current hole index (0-based) for hole-specific effects. */
  hole: number;
  /** Game mode/state name, e.g. 'walk', 'stance', 'flight', 'menu'. */
  mode: string;
}

export interface RenderModule {
  /** Short label for perf accounting (World.stats().passes); defaults to the class name. */
  readonly perfName?: string;
  /** Called once after the course is baked and the scene exists. */
  init?(ctx: InitContext): void | Promise<void>;
  update?(ctx: FrameContext): void;
  setQuality?(q: QualityPreset): void;
  dispose?(): void;
}

export interface InitContext {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  course: Course;
  grids: CourseGrids;
  textures: CourseTextures;
  quality: QualityPreset;
  /** The directional sun light (shadow caster). */
  sun: THREE.DirectionalLight;
}

/** GLSL helpers to sample the course textures. Include via string concatenation. */
export const COURSE_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform float uCourseHalf;
uniform float uCourseRes;
vec2 courseUV(vec2 xz) {
  // texel centres: sample i at x = -half + i*cell
  float cell = 2.0 * uCourseHalf / (uCourseRes - 1.0);
  return (xz + uCourseHalf) / cell / uCourseRes + 0.5 / uCourseRes;
}
float courseHeight(vec2 xz) {
  // manual bilinear (float textures may not be filterable)
  float cell = 2.0 * uCourseHalf / (uCourseRes - 1.0);
  vec2 f = (xz + uCourseHalf) / cell;
  vec2 i = floor(f);
  vec2 t = f - i;
  float r = 1.0 / uCourseRes;
  vec2 uv = (i + 0.5) * r;
  float h00 = texture2D(uHeightTex, uv).r;
  float h10 = texture2D(uHeightTex, uv + vec2(r, 0.0)).r;
  float h01 = texture2D(uHeightTex, uv + vec2(0.0, r)).r;
  float h11 = texture2D(uHeightTex, uv + vec2(r, r)).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
// Decode SDF bytes (texture returns 0..1) to metres.
vec4 decodeSdf(vec4 v) { return (v * 255.0 - 128.0) / 16.0; }
vec4 courseMaskA(vec2 xz) { return decodeSdf(texture2D(uMaskA, courseUV(xz))); }
vec4 courseMaskBRaw(vec2 xz) { return texture2D(uMaskB, courseUV(xz)); }
`;

export function courseUniforms(t: CourseTextures) {
  return {
    uHeightTex: { value: t.height },
    uMaskA: { value: t.maskA },
    uMaskB: { value: t.maskB },
    uCourseHalf: { value: t.half },
    uCourseRes: { value: t.res },
  };
}

export function createCourseTextures(g: CourseGrids): CourseTextures {
  const height = new THREE.DataTexture(g.heights, g.res, g.res, THREE.RedFormat, THREE.FloatType);
  height.magFilter = THREE.NearestFilter;
  height.minFilter = THREE.NearestFilter;
  height.needsUpdate = true;
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, g.res, g.res, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  return { height, maskA: mk(g.maskA), maskB: mk(g.maskB), res: g.res, half: g.half };
}
