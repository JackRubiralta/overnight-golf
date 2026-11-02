/**
 * Aerial-perspective height fog for every material that uses three's fog chunks.
 *
 * three's FogExp2 only knows a colour and a density. We patch the fog ShaderChunks once (at
 * import time, before any program compiles) to add:
 *  - exponential height fog (dense in valleys, thinner on hill tops, Quilez-style analytic
 *    integral along the view ray),
 *  - a short near-field ramp so the foreground stays crisp,
 *  - sun in-scattering: fog looking toward the sun takes the warm `tlFogSunColor`.
 *
 * The extra uniforms are injected into every built-in ShaderLib entry (and UniformsLib.fog) with
 * plain {x,y,z(,w)} objects. UniformsUtils.clone() only deep-copies three math objects, so these
 * plain objects stay SHARED by reference across all materials: updating them here updates all.
 * Custom ShaderMaterials that merge UniformsLib.fog get them too; any shader that lacks them sees
 * zeros and falls back to plain FogExp2 (tlFogParams.x == 0).
 */
import * as THREE from 'three';

type V3 = { x: number; y: number; z: number };
type V4 = V3 & { w: number };

/** Shared fog uniform VALUES (do not replace the objects, mutate their fields). */
export const fogShared = {
  sunDir: { x: 0, y: 1, z: 0 } as V3,
  sunColor: { x: 1, y: 0.9, z: 0.7 } as V3,
  /** x: height falloff (1/m), y: fog base height (m), z: near ramp distance (m), w: haze floor (0..1). */
  params: { x: 1 / 140, y: 0, z: 500, w: 0.16 } as V4,
};

/**
 * GLSL: fog optical depth along a world-space ray `ray` (camera → fragment, unnormalised).
 * Used by the patched fog chunk and by the sky shader for its horizon haze.
 */
export const FOG_GLSL = /* glsl */ `
float tlFogOptical(float camY, vec3 ray, float density, vec4 P, float hazeFloor) {
  float d = max(length(ray), 1e-3);
  float rdy = ray.y / d;
  float b = P.x;
  float k = max(b * rdy * d, -30.0);                   // change of the density exponent along the ray
  float avg = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  float heightTerm = exp(-b * clamp(camY - P.y, -200.0, 2000.0)) * avg; // mean relative density along the ray
  float ramp = clamp(d / max(P.z, 1.0), 0.0, 1.0);    // keep the near field clear (quadratic start)
  return density * d * (heightTerm + hazeFloor) * ramp;
}
vec3 tlFogTint(vec3 rayDir, vec3 baseColor, vec3 sunDir, vec3 sunColor) {
  float s = max(dot(rayDir, sunDir), 0.0);
  float glow = pow(s, 7.0) * 0.85 + pow(s, 40.0) * 0.5;
  return mix(baseColor, sunColor, clamp(glow, 0.0, 1.0));
}
`;

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // view-space offset rotated back to world space (vec * mat = transpose(mat) * vec)
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
    uniform vec3 tlFogSunDir;
    uniform vec3 tlFogSunColor;
    uniform vec4 tlFogParams;
    ${FOG_GLSL}
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor;
    vec3 fogTint = fogColor;
    if ( tlFogParams.x > 0.0 ) {
      fogFactor = 1.0 - exp( - tlFogOptical( cameraPosition.y, vFogRay, fogDensity, tlFogParams, tlFogParams.w ) );
      fogTint = tlFogTint( normalize( vFogRay ), fogColor, tlFogSunDir, tlFogSunColor );
    } else {
      fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    }
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    vec3 fogTint = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogTint, fogFactor );
#endif
`;

let installed = false;

/** Patch three's fog chunks + uniform libraries. Idempotent; must run before the first render. */
export function installHeightFog() {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.fog_pars_vertex = PARS_VERTEX;
  chunks.fog_vertex = VERTEX;
  chunks.fog_pars_fragment = PARS_FRAGMENT;
  chunks.fog_fragment = FRAGMENT;
  const extra = {
    tlFogSunDir: { value: fogShared.sunDir },
    tlFogSunColor: { value: fogShared.sunColor },
    tlFogParams: { value: fogShared.params },
  };
  Object.assign(THREE.UniformsLib.fog as object, extra);
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key].uniforms;
    if (u && 'fogColor' in u) Object.assign(u, extra);
  }
}

installHeightFog();
