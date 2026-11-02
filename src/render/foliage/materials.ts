/**
 * Foliage materials: three.js MeshStandardMaterial / MeshDepthMaterial patched via onBeforeCompile
 * (PBR lighting, IBL, fog and shadows stay three's), adding:
 *  - wind sway in world space (trunk bend, branch sway, leaf flutter) from globalUniforms
 *  - LOD cross-fade: complementary screen-door dither on the instance's camera distance, so LOD
 *    switches never pop (the same test runs in the shadow pass, so shadows cross-fade too)
 *  - leaves: canopy normals kept for both faces, mip-aware alpha (no thinning with distance),
 *    translucency toward the sun (back-lit glow at golden hour)
 *  - impostors: camera-facing billboards sampling a baked 8-view albedo/normal atlas
 */
import * as THREE from 'three';
import { globalUniforms } from '../shared';

// ---------------------------------------------------------------- tuning
/** Leaf translucency: tint of transmitted light and overall strength. */
const LEAF_TRANS_TINT = new THREE.Color(1.0, 1.0, 0.55);
const LEAF_TRANS_STRENGTH = 0.9;
/** Multiplier on leaf PBR specular (waxy but not mirror-like). */
const LEAF_SPECULAR = 0.35;
/** Alpha-test threshold and mip compensation rate. */
export const LEAF_ALPHA_TEST = 0.45;
const ALPHA_MIP_BOOST = 0.28;
/** Impostors have no self-shadowing (3D LODs get it from the shadow map): darken to match. */
const IMPOSTOR_SHADE = 0.68;
const IMPOSTOR_TRANS = 0.45;

export type LodUniform = { value: THREE.Vector4 };

/** LOD fade window: fade in over [x, y], fade out over [z, w] (camera distance, metres). */
export function lodUniform(): LodUniform {
  return { value: new THREE.Vector4(-2, -1, 1e6, 1e6 + 1) };
}

export interface FoliagePatch {
  /** 'bark' | 'leaf' | 'rock' | 'flower' — selects shader features. */
  kind: 'bark' | 'leaf' | 'rock' | 'flower';
  /** Trunk sway amplitude at the crown top (m) for 8 m/s wind. */
  sway: number;
  lod: LodUniform;
  /** Atlas texel size (for mip-aware alpha). */
  atlasSize?: number;
}

const COMMON_VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform vec3 uCameraPos;
uniform vec4 uLod;
uniform float uSway;
attribute vec4 aWind;
varying vec2 vLodFade;

float tlHash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// World-space wind displacement for a vertex at object position p.
vec3 tlTreeWind(vec3 p, vec4 w, vec3 iPos) {
  float ws = uWindSpeed;
  float str = clamp(ws / 8.0, 0.06, 1.6);
  vec2 wd = normalize(uWindDir + 1e-5);
  float ph = tlHash12(iPos.xz) * 6.2831;
  float t = uTime;
  // Gust envelope travelling downwind across the course.
  float gust = 0.55 + 0.45 * sin(t * 0.5 - dot(iPos.xz, wd) * 0.04 + ph * 0.3) * sin(t * 0.21 + ph);
  vec3 W = vec3(wd.x, 0.0, wd.y);
  vec3 S = vec3(-wd.y, 0.0, wd.x);
  // Trunk: lean downwind + slow sway.
  float trunk = w.x * str * (0.55 * gust + 0.3 * sin(t * (0.7 + 0.04 * ws) + ph));
  vec3 d = W * trunk * uSway + S * w.x * str * 0.12 * uSway * sin(t * 0.53 + ph * 1.7);
  // Branches: faster sway with their own phase, bobbing vertically.
  float bph = w.w * 6.2831 + ph;
  float b = w.y * str * (0.45 + 0.55 * gust);
  d += W * b * 0.35 * (0.5 + 0.5 * sin(t * 1.7 + bph));
  d += S * b * 0.18 * sin(t * 1.3 + bph * 1.3);
  d.y += b * 0.16 * sin(t * 2.1 + bph * 0.7);
  // Leaf flutter.
  float f = w.z * str * (0.35 + 0.65 * gust);
  d += vec3(sin(t * 7.1 + bph * 13.0 + p.y * 3.0), sin(t * 8.3 + bph * 7.0 + p.x * 3.0), sin(t * 6.3 + bph * 5.0 + p.z * 3.0)) * f * 0.04;
  return d;
}
`;

const COMMON_VERTEX_BEGIN = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 tlIPos = instanceMatrix[3].xyz;
  float tlS2 = max(dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz), 1e-6);
  #ifdef TL_WIND
    vec3 tlD = tlTreeWind(position, aWind, tlIPos);
    transformed += (transpose(mat3(instanceMatrix)) * tlD) / tlS2;
  #endif
  float tlDist = distance(tlIPos, uCameraPos);
  vLodFade = vec2(smoothstep(uLod.x, uLod.y, tlDist), 1.0 - smoothstep(uLod.z, uLod.w, tlDist));
#else
  vLodFade = vec2(1.0);
#endif
`;

const COMMON_FRAGMENT_PARS = /* glsl */ `
varying vec2 vLodFade;
// Interleaved gradient noise (Jimenez 2014): stable per-pixel dither threshold.
float tlIGN(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/** Complementary dither: fading-out keeps h < out, fading-in keeps h ≥ 1 - in. */
const LOD_DISCARD = /* glsl */ `
{
  float tlH = tlIGN(gl_FragCoord.xy);
  if (tlH >= vLodFade.y || tlH < 1.0 - vLodFade.x) discard;
}
`;

const ALPHA_MIP = /* glsl */ `
#if defined( USE_MAP ) && defined( TL_LEAF )
{
  vec2 tlDx = dFdx(vMapUv * uAtlasSize);
  vec2 tlDy = dFdy(vMapUv * uAtlasSize);
  float tlMip = max(0.0, 0.5 * log2(max(dot(tlDx, tlDx), dot(tlDy, tlDy))));
  diffuseColor.a *= 1.0 + tlMip * ${ALPHA_MIP_BOOST.toFixed(3)};
}
#endif
`;

const LEAF_LIGHT = /* glsl */ `
uniform vec3 uTransTint;
uniform float uTransStrength;
uniform float uLeafSpecular;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 spec0 = reflectedLight.directSpecular;
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  reflectedLight.directSpecular = spec0 + ( reflectedLight.directSpecular - spec0 ) * uLeafSpecular;
  // Thin leaves transmit light: diffuse back-face term + forward-scatter lobe toward the sun.
  float back = saturate( dot( -geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 5.0 );
  vec3 albedo = material.diffuseColor;
  vec3 trans = albedo * albedo / max( dot( albedo, vec3( 0.3333 ) ), 1e-3 );
  reflectedLight.directDiffuse += directLight.color * trans * uTransTint * uTransStrength * tlTransMask * ( 0.35 * back + 1.2 * fwd );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

function sharedUniforms(p: FoliagePatch): Record<string, THREE.IUniform> {
  return {
    uTime: globalUniforms.uTime,
    uWindDir: globalUniforms.uWindDir,
    uWindSpeed: globalUniforms.uWindSpeed,
    uCameraPos: globalUniforms.uCameraPos,
    uLod: p.lod,
    uSway: { value: p.sway },
    uAtlasSize: { value: p.atlasSize ?? 1024 },
    uTransTint: { value: LEAF_TRANS_TINT },
    uTransStrength: { value: LEAF_TRANS_STRENGTH },
    uLeafSpecular: { value: LEAF_SPECULAR },
  };
}

/** Patch a MeshStandardMaterial (or MeshDepthMaterial when depth=true) with foliage features. */
export function patchFoliage<M extends THREE.Material>(mat: M, p: FoliagePatch, depth = false): M {
  const wind = p.kind !== 'rock';
  const leaf = p.kind === 'leaf' || p.kind === 'flower';
  const defines = (mat as unknown as { defines?: Record<string, string> }).defines ?? {};
  if (wind) defines.TL_WIND = '';
  if (leaf) defines.TL_LEAF = '';
  (mat as unknown as { defines: Record<string, string> }).defines = defines;
  const uniforms = sharedUniforms(p);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', COMMON_VERTEX_BEGIN);
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAGMENT_PARS}\nuniform float uAtlasSize;\nfloat tlTransMask = 1.0;`)
      .replace('#include <alphatest_fragment>', `${ALPHA_MIP}\n#include <alphatest_fragment>\n${LOD_DISCARD}`);
    if (!depth && leaf) {
      fs = fs
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT}`)
        // Canopy normals are valid for both faces: undo three's back-face flip.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n  nonPerturbedNormal = normal;\n#endif')
        // Leaves are mostly diffuse: sky reflections on thousands of cards read as grey haze.
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectSpecular *= uLeafSpecular;');
    }
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `tl-foliage-${p.kind}-${depth ? 'd' : 'c'}`;
  return mat;
}

// ---------------------------------------------------------------- impostors

export interface ImpostorAtlas {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  frames: number;
  rows: number;
}

const IMP_VERTEX_PARS = /* glsl */ `
uniform vec3 uCameraPos;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform float uFrames;
uniform float uRows;
attribute vec4 aImp;   // atlas row, half width, height, y min (object units)
attribute vec4 aFade;  // fade in start/end, fade out start/end (m)
varying vec2 vLodFade;
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying float vImpBlend;
varying vec2 vYaw;
`;

const IMP_VERTEX = /* glsl */ `
  vec3 tlIPos = instanceMatrix[3].xyz;
  float tlSc = length(instanceMatrix[0].xyz);
  vec3 tlC0 = instanceMatrix[0].xyz / tlSc;           // = (cos ψ, 0, -sin ψ)
  vYaw = vec2(tlC0.x, -tlC0.z);
  vec3 toCam = uCameraPos - tlIPos;
  vec2 cw = normalize(toCam.xz + 1e-4);
  // Camera direction in the tree's object frame → baked frame index.
  vec2 co = vec2(vYaw.x * cw.x - vYaw.y * cw.y, vYaw.y * cw.x + vYaw.x * cw.y);
  float th = atan(co.x, co.y);                        // [-π, π]
  float f = fract(th / 6.2831853) * uFrames;
  float f0 = floor(f);
  vImpBlend = f - f0;
  float f1 = mod(f0 + 1.0, uFrames);
  vec2 local = vec2(position.x + 0.5, position.y);
  vImpUv0 = vec2((f0 + local.x) / uFrames, (aImp.x + local.y) / uRows);
  vImpUv1 = vec2((f1 + local.x) / uFrames, (aImp.x + local.y) / uRows);
  vec3 right = vec3(cw.y, 0.0, -cw.x);
  float hgt = aImp.z - aImp.w;
  // Gentle sway of the top (matches the trunk bend of the 3D LODs).
  float ws = clamp(uWindSpeed / 8.0, 0.06, 1.6);
  float sway = local.y * local.y * ws * 0.02 * hgt * (0.7 + 0.3 * sin(uTime * 0.7 + tlIPos.x * 0.37));
  vec3 wp = tlIPos + right * (position.x * 2.0 * aImp.y * tlSc) + vec3(0.0, (aImp.w + local.y * hgt) * tlSc, 0.0);
  wp.xz += normalize(uWindDir + 1e-5) * sway * tlSc;
  float tlDist = length(toCam);
  vLodFade = vec2(smoothstep(aFade.x, aFade.y, tlDist), 1.0 - smoothstep(aFade.z, aFade.w, tlDist));
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
`;

const IMP_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uImpAlbedo;
uniform sampler2D uImpNormal;
varying vec2 vImpUv0;
varying vec2 vImpUv1;
varying float vImpBlend;
varying vec2 vYaw;
float tlTransMask = 1.0;
`;

/** Material for the camera-facing impostor billboards of all variants (one draw). */
export function createImpostorMaterial(atlas: ImpostorAtlas): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, alphaTest: LEAF_ALPHA_TEST, side: THREE.DoubleSide });
  const uniforms: Record<string, THREE.IUniform> = {
    uCameraPos: globalUniforms.uCameraPos,
    uTime: globalUniforms.uTime,
    uWindDir: globalUniforms.uWindDir,
    uWindSpeed: globalUniforms.uWindSpeed,
    uFrames: { value: atlas.frames },
    uRows: { value: atlas.rows },
    uImpAlbedo: { value: atlas.albedo },
    uImpNormal: { value: atlas.normal },
    uTransTint: { value: LEAF_TRANS_TINT },
    uTransStrength: { value: LEAF_TRANS_STRENGTH * IMPOSTOR_TRANS },
    uLeafSpecular: { value: LEAF_SPECULAR },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${IMP_VERTEX_PARS}`)
      .replace('#include <project_vertex>', IMP_VERTEX)
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(wp, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON_FRAGMENT_PARS}\n${IMP_FRAGMENT_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT}`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 tlA = mix(texture2D(uImpAlbedo, vImpUv0), texture2D(uImpAlbedo, vImpUv1), vImpBlend);
        vec4 tlN = mix(texture2D(uImpNormal, vImpUv0), texture2D(uImpNormal, vImpUv1), vImpBlend);
        {
          vec2 tlDx = dFdx(vImpUv0 * vec2(textureSize(uImpAlbedo, 0)));
          vec2 tlDy = dFdy(vImpUv0 * vec2(textureSize(uImpAlbedo, 0)));
          float tlMip = max(0.0, 0.5 * log2(max(dot(tlDx, tlDx), dot(tlDy, tlDy))));
          tlA.a *= 1.0 + tlMip * ${ALPHA_MIP_BOOST.toFixed(3)};
        }
        diffuseColor *= vec4(tlA.rgb * tlA.rgb * ${IMPOSTOR_SHADE.toFixed(3)}, tlA.a);   // albedo stored as sqrt (gamma 2)
        tlTransMask = tlN.a;
        `,
      )
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n${LOD_DISCARD}`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n  reflectedLight.indirectSpecular *= uLeafSpecular;')
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        float faceDirection = 1.0;
        vec3 tlNo = normalize(tlN.xyz * 2.0 - 1.0);
        vec3 tlNw = vec3(vYaw.x * tlNo.x + vYaw.y * tlNo.z, tlNo.y, -vYaw.y * tlNo.x + vYaw.x * tlNo.z);
        vec3 normal = normalize((viewMatrix * vec4(tlNw, 0.0)).xyz);
        vec3 nonPerturbedNormal = normal;
        `,
      );
  };
  mat.customProgramCacheKey = () => 'tl-foliage-impostor';
  return mat;
}

// ---------------------------------------------------------------- bake materials

/** Unlit material used to bake impostor frames: mode 0 = sqrt(albedo), 1 = object normal (+leaf mask). */
export function createBakeMaterial(map: THREE.Texture | null, tint: THREE.Color, leaf: boolean, mode: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uTint: { value: tint }, uMode: mode, uLeaf: { value: leaf ? 1 : 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vC;
      void main() {
        vUv = uv;
        vN = normal;
        vC = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform float uMode;
      uniform float uLeaf;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vC;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (uLeaf > 0.5 && t.a < ${LEAF_ALPHA_TEST.toFixed(2)}) discard;
        vec3 n = normalize(vN);
        if (uLeaf < 0.5 && !gl_FrontFacing) n = -n;
        if (uMode < 0.5) gl_FragColor = vec4(sqrt(max(t.rgb * uTint * vC, 0.0)), 1.0);
        else gl_FragColor = vec4(n * 0.5 + 0.5, uLeaf);
      }`,
    side: leaf ? THREE.DoubleSide : THREE.FrontSide,
    toneMapped: false,
    fog: false,
  });
}
