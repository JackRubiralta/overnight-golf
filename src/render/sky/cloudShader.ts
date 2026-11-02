/**
 * Volumetric cumulus clouds, rendered into a cube map (see CloudCube.ts), not per screen pixel.
 *
 * Shape: a curved slab (artistic planet radius) between uCloudLayer.x and .y metres. The 2D
 * Perlin-Worley footprint (noiseTexture.ts, G) is modulated by a weather map (R) and by a height
 * profile that tapers with altitude, so each column rises into a dome proportional to its
 * footprint strength (no vertical "extruded 2D" walls). A tiling 3D Worley texture
 * (detailNoise3D.ts) then erodes the edges: wispy at the base, billowy at the top.
 *
 * Lighting: two-sample Beer shadowing toward the sun with a multiple-scattering tail, dual-lobe
 * Henyey-Greenstein phase (silver lining toward the sun), powder term, height-graded ambient;
 * energy-conserving front-to-back integration. CLOUD_STEPS == 0 → a single cheap 2D layer.
 *
 * Output (linear HDR, premultiplied): rgb = in-scattered cloud light already faded by aerial
 * perspective, a = transmittance of the sky behind the clouds.
 */
import * as THREE from 'three';

// ---- tuning -------------------------------------------------------------------------------
const PLANET_R = 60000; // m: clouds curve down toward the horizon
const WEATHER_SCALE = 16000; // m per weather-map tile
const SHAPE_SCALE = 5200; // m per shape tile (6 billow cells → ~850 m clouds)
const DETAIL_SCALE = 480; // m per 3D detail tile
const AERIAL_DIST = 30000; // m: clouds this far are ~63% dissolved into the sky
/** Extinction toward the sun relative to the view ray (art-directed: < 1 lets light reach in). */
const LIGHT_ABSORB = 0.4;

export function createCloudUniforms(noise: THREE.Texture, detail: THREE.Data3DTexture) {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNoise: { value: noise },
    uDetail: { value: detail },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudCoverage: { value: 0.45 },
    uCloudDensity: { value: 0.045 },
    uCloudLayer: { value: new THREE.Vector2(1300, 2600) },
    uCloudLit: { value: new THREE.Color(1, 0.9, 0.8) },
    uCloudShade: { value: new THREE.Color(0.4, 0.45, 0.55) },
    uCloudTime: { value: 0 },
    /** Radians per cube texel (for texture LOD). */
    uTexelAngle: { value: 2 / 512 },
    /** Per-render jitter offset (0..1): successive refreshes are blended in the cube (TAA-like). */
    uJitter: { value: 0 },
  };
}
export type CloudUniforms = ReturnType<typeof createCloudUniforms>;

// Full-screen triangle (guaranteed full coverage of every cube face texel): the world-space view
// direction is reconstructed from the face camera's matrices.
const VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 v = inverse(projectionMatrix) * vec4(position.xy, 1.0, 1.0);
  vWorldDir = (inverse(viewMatrix) * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform sampler2D uNoise;
uniform sampler3D uDetail;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform vec2 uCloudLayer;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudTime;
uniform float uTexelAngle;
uniform float uJitter;
varying vec3 vWorldDir;

const float PI = 3.141592653589793;
const float PLANET_R = ${PLANET_R.toFixed(1)};

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 / (4.0 * PI)) * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}
float remap01(float v, float a, float b) { return clamp((v - a) / max(b - a, 1e-4), 0.0, 1.0); }

// distance along dir from a camera at height h0 to the shell at altitude hc
float shellDist(vec3 dir, float h0, float hc) {
  float b = (PLANET_R + h0) * dir.y;
  float c = (hc - h0) * (2.0 * PLANET_R + h0 + hc);
  return c / (b + sqrt(max(b * b + c, 0.0)));
}
// altitude above the curved "sea level" of a point camPos.xz-relative
float altitude(vec3 p) { return length(vec3(p.x, p.y + PLANET_R, p.z)) - PLANET_R; }

// Coarse density (no 3D erosion) — also used for the light samples.
float cloudBase(vec2 xz, float hf, float lod) {
  vec2 p = xz + uCloudOffset;
  float weather = textureLod(uNoise, p / ${WEATHER_SCALE.toFixed(1)}, max(lod - 4.0, 0.0)).r;
  float cov = clamp(uCloudCoverage + (weather - 0.5) * 0.9, 0.0, 1.0);
  // lean the billows a little with altitude (wind shear)
  vec4 s = textureLod(uNoise, (p + vec2(hf * 260.0, hf * 140.0)) / ${SHAPE_SCALE.toFixed(1)}, max(lod - 2.0, 0.0));
  float shape = s.g * 0.82 + s.a * 0.18;
  // height profile: soft rounded base, tapering toward the top → dome-shaped columns
  float top = mix(0.45, 1.0, cov);
  float hp = smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(0.08, top, hf));
  return remap01(shape * hp, 1.0 - cov, 1.0);
}

float cloudDetail(vec3 wp, float base, float hf) {
  vec3 q = vec3(wp.x + uCloudOffset.x, wp.y * 1.4, wp.z + uCloudOffset.y) / ${DETAIL_SCALE.toFixed(1)};
  q += vec3(0.0, uCloudTime * 0.0035, uCloudTime * 0.002); // slow boil
  float n = texture(uDetail, q).r * 0.72 + texture(uDetail, q * 2.9).r * 0.28;
  float e = mix(1.0 - n, n, clamp(hf * 3.0, 0.0, 1.0)); // wispy base → billowy top
  return remap01(base, e * 0.55, 1.0);
}

vec4 clouds(vec3 dir, vec3 camPos, float jitter) {
  if (dir.y < -0.015 || uCloudCoverage <= 0.001) return vec4(0.0, 0.0, 0.0, 1.0);
  float h0 = clamp(camPos.y, 0.0, uCloudLayer.x - 50.0);
  vec3 o = vec3(camPos.x, h0, camPos.z);
  float t0 = shellDist(dir, h0, uCloudLayer.x);
  float t1 = shellDist(dir, h0, uCloudLayer.y);
  float thick = uCloudLayer.y - uCloudLayer.x;
  vec3 sunDir = normalize(uSunDir);
  float cosT = dot(dir, sunDir);
  // dual-lobe HG: forward silver lining + soft back-scatter, ~1 at 90°
  float phase = mix(hgPhase(cosT, 0.6), hgPhase(cosT, -0.3), 0.5) * 4.0 * PI * 1.25;
  vec3 ld = normalize(vec3(sunDir.x, max(sunDir.y, 0.06), sunDir.z));
  float T = 1.0;
  vec3 col = vec3(0.0);
  float wsum = 0.0;

#if CLOUD_STEPS > 0
  float ds = (t1 - t0) / float(CLOUD_STEPS);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    float t = t0 + (float(i) + jitter) * ds;
    vec3 p = o + dir * t;
    float hf = clamp((altitude(p) - uCloudLayer.x) / thick, 0.0, 1.0);
    float lod = log2(max(t * uTexelAngle * 256.0 / ${DETAIL_SCALE.toFixed(1)}, 1.0));
    float base = cloudBase(p.xz, hf, lod);
    if (base <= 0.0) continue;
    float d = cloudDetail(p, base, hf);
    if (d <= 0.002) continue;
    // self shadowing: two coarse samples toward the sun
    vec3 p1 = p + ld * 120.0;
    vec3 p2 = p + ld * 480.0;
    float l1 = cloudBase(p1.xz, clamp((altitude(p1) - uCloudLayer.x) / thick, 0.0, 1.0), lod + 1.0);
    float l2 = cloudBase(p2.xz, clamp((altitude(p2) - uCloudLayer.x) / thick, 0.0, 1.0), lod + 2.0);
    float od = (l1 * 120.0 + l2 * 360.0) * uCloudDensity * ${LIGHT_ABSORB.toFixed(2)};
    // Beer + two cheaper multiple-scattering octaves (Wrenninge-style)
    float sunT = exp(-od) + 0.45 * exp(-od * 0.4) + 0.2 * exp(-od * 0.15);
    float powder = 1.0 - 0.6 * exp(-d * 6.0);
    vec3 amb = uCloudShade * mix(0.5, 1.35, hf);
    vec3 S = uCloudLit * sunT * phase * powder + amb;
    float Ts = exp(-d * uCloudDensity * ds);
    col += T * S * (1.0 - Ts);
    wsum += T * (1.0 - Ts) * t;
    T *= Ts;
    if (T < 0.015) break;
  }
  float cd = (1.0 - T) > 0.001 ? wsum / (1.0 - T) : t0;
#else
  // single 2D layer, lit by an offset sample toward the sun
  float t = mix(t0, t1, 0.35);
  vec3 p = o + dir * t;
  float lod = log2(max(t * uTexelAngle * 256.0 / ${DETAIL_SCALE.toFixed(1)}, 1.0));
  float d = cloudBase(p.xz, 0.35, lod);
  float l1 = cloudBase(p.xz + ld.xz * 300.0, 0.5, lod + 1.0);
  float od = l1 * 420.0 * uCloudDensity * ${LIGHT_ABSORB.toFixed(2)};
  float sunT = exp(-od) + 0.45 * exp(-od * 0.4) + 0.2 * exp(-od * 0.15);
  float powder = 1.0 - 0.6 * exp(-d * 6.0);
  vec3 S = uCloudLit * sunT * phase * powder + uCloudShade;
  float a = 1.0 - exp(-d * uCloudDensity * thick * 0.5);
  col = S * a;
  T = 1.0 - a;
  float cd = t;
#endif
  // aerial perspective: far clouds dissolve into the sky behind them
  float aerial = 1.0 - exp(-cd / ${AERIAL_DIST.toFixed(1)});
  aerial = max(aerial, smoothstep(0.06, -0.01, dir.y));
  return vec4(col * (1.0 - aerial), mix(T, 1.0, aerial));
}

// interleaved gradient noise (Jimenez) for slice jitter
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 dir = normalize(vWorldDir);
  gl_FragColor = clouds(dir, cameraPosition, fract(ign(gl_FragCoord.xy) + uJitter));
}
`;

export function createCloudMaterial(uniforms: CloudUniforms, cloudSteps: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'TLClouds',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { CLOUD_STEPS: Math.max(0, Math.round(cloudSteps)) },
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    fog: false,
  });
}
