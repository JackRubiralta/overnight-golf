/**
 * GLSL injected into a MeshPhysicalMaterial (ior 1.33) for the course's ponds and burns.
 * We keep three's lighting (sun GGX glint, PMREM sky reflection, sun shadows, fog) and add:
 *  - multi-octave wind-aligned scrolling ripple normals with "cat's-paw" gust patches,
 *  - analytic water depth from the baked heightmap (level − courseHeight) driving
 *    absorption (shallow turquoise-green → deep peaty dark), opacity and a soft shoreline,
 *  - lapping shoreline foam,
 *  - optional planar reflection (Reflector RT), distorted by the ripple slope,
 *  - Fresnel-weighted premultiplied output so reflections stay bright over see-through shallows.
 */
import { COURSE_GLSL } from '../shared';

/** Tuning (metres, m/s). Kept here so the look can be tweaked without touching the GLSL below. */
export const WATER_TUNING = {
  /** Ripple octave tile sizes (m), largest first. */
  octaveSize: [13.0, 5.3, 2.1, 0.83],
  /** Relative slope weight of each octave. */
  octaveWeight: [0.75, 0.55, 0.38, 0.22],
  /** Base slope amplitude at calm and at ~10 m/s wind. */
  slopeCalm: 0.06,
  slopeWindy: 0.32,
  /** Gust ("cat's paw") patch size (m) and contrast. */
  gustSize: 85,
  gustContrast: 1.1,
  /** Light absorption per metre of path length (controls how fast the bed disappears). */
  absorption: 1.15,
  /** Planar-reflection UV distortion per unit slope. */
  reflDistort: 0.11,
  /** Depth (m) over which the shoreline fades in, and foam band width. */
  shoreFade: 0.1,
  foamBand: 0.45,
};

const T = WATER_TUNING;
const f = (n: number) => n.toFixed(4);

export const WATER_VERTEX_PARS = /* glsl */ `
attribute float aBody;
uniform mat4 uReflMatrix;
varying vec3 vWPos;
varying float vBody;
varying vec4 vReflCoord;
`;

export const WATER_VERTEX = /* glsl */ `
{
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vWPos = wp.xyz;
  vBody = aBody;
  vReflCoord = uReflMatrix * wp;
}
`;

export const WATER_FRAGMENT_PARS = /* glsl */ `
${COURSE_GLSL}
uniform sampler2D uRipples;
uniform sampler2D uReflTex;
uniform float uReflBody;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uFoamColor;
varying vec3 vWPos;
varying float vBody;
varying vec4 vReflCoord;

// Decoded ripple slope of one texture tile (normalised, ~-1..1).
vec2 ripSlope(vec2 uv) { return texture2D(uRipples, uv).xy * (255.0 / 127.0) - (128.0 / 127.0); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// One octave: p = position in wind space (m), L = tile size, ang = rotation, v = drift speed (m/s).
vec2 octave(vec2 p, float L, float ang, float v, float t) {
  mat2 R = rot2(ang);
  vec2 uv = R * p / L + vec2(t * v / L, 0.0);
  // slope in the rotated frame → back to wind space (transpose of R)
  return ripSlope(uv) * R;
}

// World-space surface slope (dh/dx, dh/dz) and a crest/foam noise value.
vec2 waterSlope(vec2 xz, float dist, out float crest) {
  vec2 w = normalize(uWindDir + vec2(1e-4, 0.0));
  vec2 wp = vec2(-w.y, w.x);
  vec2 p = vec2(dot(xz, w), dot(xz, wp));
  float t = uTime;
  float ws = uWindSpeed;
  float drift = 0.25 + 0.05 * ws;
  // Gust patches: slow, large-scale modulation of the ripple strength.
  float gust = texture2D(uRipples, p / ${f(T.gustSize)} * vec2(0.6, 1.0) + vec2(t * 0.012, t * 0.003)).b;
  gust = clamp(0.35 + ${f(T.gustContrast)} * (gust - 0.5) + 0.65 * gust, 0.15, 1.6);
  vec2 s = octave(p, ${f(T.octaveSize[0])}, 0.0, drift, t) * ${f(T.octaveWeight[0])};
  s += octave(p, ${f(T.octaveSize[1])}, 0.55, drift * 1.3, t) * ${f(T.octaveWeight[1])};
  #if WATER_DETAIL > 0
  s += octave(p, ${f(T.octaveSize[2])}, -0.8, drift * 1.7, t) * ${f(T.octaveWeight[2])};
  #endif
  #if WATER_DETAIL > 1
  s += octave(p, ${f(T.octaveSize[3])}, 1.9, drift * 2.3, t) * ${f(T.octaveWeight[3])} * (1.0 - smoothstep(25.0, 90.0, dist));
  #endif
  float amp = mix(${f(T.slopeCalm)}, ${f(T.slopeWindy)}, smoothstep(0.0, 10.0, ws)) * gust;
  // Flatten toward the horizon (mips average the ripples out; avoid sparkle aliasing).
  amp *= mix(1.0, 0.4, smoothstep(40.0, 600.0, dist));
  crest = texture2D(uRipples, p / 3.1 + vec2(t * 0.07, 0.0)).b * 0.6 + texture2D(uRipples, p * rot2(1.3) / 1.3 - vec2(t * 0.05, 0.0)).b * 0.4;
  s *= amp;
  return s.x * w + s.y * wp;
}
`;

/** After <color_fragment>: water body colour, opacity, foam. Declares wNormalW, wOpacity, wFoam. */
export const WATER_SURFACE = /* glsl */ `
vec3 wToCam = cameraPosition - vWPos;
float wDist = length(wToCam);
vec3 wV = wToCam / max(wDist, 1e-4);
float wDepth = vWPos.y - courseHeight(vWPos.xz);
if (wDepth < 0.0) discard;
float wCrest;
vec2 wSlope = waterSlope(vWPos.xz, wDist, wCrest);
vec3 wNormalW = normalize(vec3(-wSlope.x, 1.0, -wSlope.y));
// Optical path through the water (refracted ray ≈ steeper than the view ray).
float wCosT = sqrt(1.0 - (1.0 - wV.y * wV.y) / (1.33 * 1.33));
float wPath = wDepth / max(wCosT, 0.2);
float wTrans = exp(-wPath * ${f(T.absorption)});
float wOpacity = (1.0 - wTrans) * smoothstep(0.0, ${f(T.shoreFade)}, wDepth);
// In-scatter colour: turquoise-green where the bed is close, peaty dark in the deep.
vec3 wBody = mix(uDeepColor, uShallowColor, exp(-wDepth * 0.55));
// Lapping shoreline foam: a thin, broken band that breathes with time.
float wBand = 1.0 - smoothstep(0.0, ${f(T.foamBand)} * (0.75 + 0.25 * sin(uTime * 0.9 + vWPos.x * 0.21 + vWPos.z * 0.17)), wDepth);
float wFoam = wBand * smoothstep(0.42, 0.78, wCrest + wBand * 0.35) * smoothstep(0.0, 0.03, wDepth);
wFoam *= 1.0 - smoothstep(120.0, 300.0, wDist);
diffuseColor.rgb = mix(wBody, uFoamColor, wFoam * 0.85);
wOpacity = max(wOpacity, wFoam * 0.8);
`;

export const WATER_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(0.05, 0.12, smoothstep(80.0, 700.0, wDist));
roughnessFactor = mix(roughnessFactor, 0.6, wFoam);
`;

/** Replaces <normal_fragment_maps>. */
export const WATER_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(wNormalW, 0.0)).xyz);
`;

/** After <lights_fragment_maps>: swap the env radiance for the planar reflection on the active body. */
export const WATER_PLANAR = /* glsl */ `
#if defined(USE_PLANAR) && defined(RE_IndirectSpecular)
if (abs(vBody - uReflBody) < 0.5) {
  vec2 ruv = vReflCoord.xy / vReflCoord.w;
  ruv += wSlope * ${f(T.reflDistort)} * (1.0 / (1.0 + wDist * 0.01));
  ruv = clamp(ruv, vec2(0.002), vec2(0.998));
  vec3 pr = texture2D(uReflTex, ruv).rgb;
  radiance = mix(radiance, pr, 1.0 - wFoam);
}
#endif
`;

/** Replaces <opaque_fragment>: Fresnel-weighted premultiplied composition (straightened for fog). */
export const WATER_OUTPUT = /* glsl */ `
float wNoV = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
float wF = 0.02 + 0.98 * pow(1.0 - wNoV, 5.0);
float wA = clamp(wOpacity + (1.0 - wOpacity) * wF, 0.0, 1.0);
vec3 wPremult = totalDiffuse * wOpacity + totalSpecular;
gl_FragColor = vec4(wPremult / max(wA, 1e-3), max(wA, 1e-3));
`;
