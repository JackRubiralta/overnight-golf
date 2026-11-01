/**
 * Sky dome shader: Preetham analytic daylight (scattering code adapted from three.js
 * examples/jsm/objects/Sky.js, MIT) + our own layered volumetric cumulus clouds, a limb-darkened
 * sun disc and a horizon haze that uses the exact same height-fog integral as the patched
 * scene fog (src/render/sky/fog.ts), so distant terrain melts seamlessly into the sky.
 *
 * Clouds: CLOUD_STEPS altitude slices through a curved slab (artistic planet radius), each
 * sampling a tiling 2D Perlin-Worley texture with a height profile (pseudo-3D), lit by the sun
 * with two-sample Beer shadowing, dual-lobe Henyey-Greenstein phase (silver lining) and a powder
 * term; energy-conserving front-to-back integration. CLOUD_STEPS == 0 → single cheap 2D layer.
 */
import * as THREE from 'three';
import { FOG_GLSL } from './fog';

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
}

export function createSkyUniforms(noise: THREE.Texture): SkyUniforms {
  return {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTurbidity: { value: 4 },
    uRayleigh: { value: 1.5 },
    uMieCoef: { value: 0.005 },
    uMieG: { value: 0.8 },
    uSkyIntensity: { value: 1 },
    uSunDiscIntensity: { value: 40 },
    uSunDiscColor: { value: new THREE.Color(1, 0.8, 0.6) },
    uOvercast: { value: 0 },
    uOvercastColor: { value: new THREE.Color(0.5, 0.52, 0.55) },
    // clouds
    uNoise: { value: noise },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudCoverage: { value: 0.45 },
    uCloudDensity: { value: 0.02 },
    uCloudLayer: { value: new THREE.Vector2(1300, 2500) },
    uCloudLit: { value: new THREE.Color(1, 0.9, 0.8) },
    uCloudShade: { value: new THREE.Color(0.4, 0.45, 0.55) },
    uCloudTime: { value: 0 },
    uPixelAngle: { value: 0.001 },
    // haze (copies of the scene fog values)
    uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uFogSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
    uFogDensity: { value: 0.001 },
    uFogParams: { value: new THREE.Vector4(1 / 140, 0, 350, 0.2) },
    uSkyHaze: { value: 0.6 },
  };
}

const VERT = /* glsl */ `
uniform vec3 uSunDir;
uniform float uRayleigh;
uniform float uTurbidity;
uniform float uMieCoef;
varying vec3 vWorldDir;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

const float e = 2.71828182845904523536028747135266249775724709369995957;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;

float sunIntensity(float zenithAngleCos) {
  zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
  return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // on the far plane
  vec3 sunDir = normalize(uSunDir);
  vSunE = sunIntensity(sunDir.y);
  vBetaR = totalRayleigh * uRayleigh;
  float c = (0.2 * uTurbidity) * 10E-18;
  vBetaM = 0.434 * c * MieConst * uMieCoef;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform float uMieG;
uniform float uSkyIntensity;
uniform float uSunDiscIntensity;
uniform vec3 uSunDiscColor;
uniform float uOvercast;
uniform vec3 uOvercastColor;
uniform sampler2D uNoise;
uniform vec2 uCloudOffset;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform vec2 uCloudLayer;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCloudTime;
uniform float uPixelAngle;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uFogDensity;
uniform vec4 uFogParams;
uniform float uSkyHaze;

varying vec3 vWorldDir;
varying vec3 vBetaR;
varying vec3 vBetaM;
varying float vSunE;

${FOG_GLSL}

const float PI = 3.141592653589793;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;
const float SUN_COS = 0.99996;   // ~0.5 deg radius disc (a touch larger than real for readability)
const float PLANET_R = 60000.0;  // artistic planet radius: clouds curve down to the horizon

float rayleighPhase(float c) { return THREE_OVER_SIXTEENPI * (1.0 + c * c); }
float hgPhase(float c, float g) {
  float g2 = g * g;
  return ONE_OVER_FOURPI * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

// Preetham in-scattered sky radiance (no sun disc), in our HDR scene units.
vec3 atmosphere(vec3 dir, vec3 sunDir, out vec3 Fex) {
  float zenithAngle = acos(max(0.0, dir.y));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / PI), -1.253));
  float sR = rayleighZenithLength * inv;
  float sM = mieZenithLength * inv;
  Fex = exp(-(vBetaR * sR + vBetaM * sM));
  float cosTheta = dot(dir, sunDir);
  vec3 betaRTheta = vBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
  vec3 betaMTheta = vBetaM * hgPhase(cosTheta, uMieG);
  vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)),
             clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  return ((Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075)) * uSkyIntensity;
}

// ---------------------------------------------------------------- clouds
// distance along dir (from a camera at height h0 above "sea level") to the cloud shell at altitude hc
float shellDist(vec3 dir, float h0, float hc) {
  float b = (PLANET_R + h0) * dir.y;
  float c = (hc - h0) * (2.0 * PLANET_R + h0 + hc); // = Rc^2 - Ro^2, computed without cancellation
  return c / (b + sqrt(max(b * b + c, 0.0)));
}

vec4 noiseAt(vec2 xz, float scale, float lod) {
  return textureLod(uNoise, xz * scale, lod);
}

// lod: mip bias from the footprint of a pixel at that distance
float cloudDensity(vec2 xz, float hf, float lod) {
  vec2 p = xz + uCloudOffset;
  float weather = noiseAt(p, 1.0 / 16000.0, lod - 4.0).r;
  float cov = clamp(uCloudCoverage + (weather - 0.5) * 0.85, 0.0, 1.0);
  // two shape samples offset with height → pseudo-3D billows that lean with altitude
  vec4 s0 = noiseAt(p + vec2(hf * 380.0, hf * 210.0), 1.0 / 4200.0, lod - 2.0);
  float shape = s0.g;
  // height profile: flat-ish base, rounded/tapered tops (taller where coverage is high)
  float top = 0.35 + 0.65 * cov;
  float hp = smoothstep(0.0, 0.1, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
  float d = shape * hp;
  d = (d - (1.0 - cov)) / max(cov, 0.05);
  if (d <= 0.0) return 0.0;
  // erosion: billowy detail eats edges and the base more than the cores
  float det = noiseAt(p + vec2(uCloudTime * 4.0, 0.0), 1.0 / 950.0, lod).b;
  float ero = mix(det, 1.0 - det, clamp(hf * 3.0, 0.0, 1.0)); // wispy bottom → billowy top
  d -= ero * 0.32 * (1.0 - d);
  return clamp(d, 0.0, 1.0);
}

vec4 clouds(vec3 dir, vec3 sunDir, vec3 camPos, float jitter, out float cloudDist) {
  cloudDist = 0.0;
  if (dir.y < -0.01 || uCloudCoverage <= 0.001) return vec4(0.0, 0.0, 0.0, 1.0);
  float h0 = clamp(camPos.y, 0.0, uCloudLayer.x - 50.0);
  float t0 = shellDist(dir, h0, uCloudLayer.x);
  float t1 = shellDist(dir, h0, uCloudLayer.y);
  float cosT = dot(dir, sunDir);
  // dual-lobe HG: strong forward silver lining + some back-scatter, normalised to ~1 at 90deg
  float phase = mix(hgPhase(cosT, 0.6), hgPhase(cosT, -0.25), 0.35) * 4.0 * PI * 0.9;
  vec3 T3 = vec3(1.0);
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  float thick = uCloudLayer.y - uCloudLayer.x;

#if CLOUD_STEPS > 0
  float ds = (t1 - t0) / float(CLOUD_STEPS);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    float f = (float(i) + jitter) / float(CLOUD_STEPS);
    float t = mix(t0, t1, f);
    float lod = log2(max(t * uPixelAngle * 256.0 / 900.0, 1.0));
    vec3 p = camPos + dir * t;
    float hf = f;
    float d = cloudDensity(p.xz, hf, lod);
    if (d > 0.002) {
      // two light samples toward the sun → self shadowing
      vec3 ld = normalize(vec3(sunDir.x, max(sunDir.y, 0.08), sunDir.z));
      float hl1 = clamp(hf + ld.y * 140.0 / thick, 0.0, 1.0);
      float hl2 = clamp(hf + ld.y * 520.0 / thick, 0.0, 1.0);
      float l1 = cloudDensity(p.xz + ld.xz * 140.0, hl1, lod + 1.0);
      float l2 = cloudDensity(p.xz + ld.xz * 520.0, hl2, lod + 2.0);
      float od = (l1 * 140.0 + l2 * 380.0) * uCloudDensity;
      float sunT = max(exp(-od), exp(-od * 0.25) * 0.55);      // multiple-scattering tail
      float powder = 1.0 - 0.55 * exp(-d * 9.0);
      vec3 amb = uCloudShade * mix(0.65, 1.15, hf);
      vec3 S = uCloudLit * sunT * phase * powder + amb;
      float sigma = d * uCloudDensity;
      float Tstep = exp(-sigma * ds);
      vec3 Tc = T3;
      col += Tc * S * (1.0 - Tstep);
      wsum += (T3.x * (1.0 - Tstep)) * t;
      T3 *= Tstep;
      if (T3.x < 0.02) break;
    }
  }
  float alpha = 1.0 - T3.x;
  cloudDist = alpha > 0.001 ? wsum / alpha : t0;
#else
  // single 2D layer, lit by offsetting toward the sun
  float t = mix(t0, t1, 0.4);
  float lod = log2(max(t * uPixelAngle * 256.0 / 900.0, 1.0));
  vec3 p = camPos + dir * t;
  float d = cloudDensity(p.xz, 0.4, lod);
  vec3 ld = normalize(vec3(sunDir.x, max(sunDir.y, 0.08), sunDir.z));
  float l1 = cloudDensity(p.xz + ld.xz * 300.0, 0.55, lod + 1.0);
  float sunT = max(exp(-l1 * 400.0 * uCloudDensity), 0.25);
  float powder = 1.0 - 0.55 * exp(-d * 9.0);
  vec3 S = uCloudLit * sunT * phase * powder + uCloudShade;
  float alpha = 1.0 - exp(-d * uCloudDensity * thick * 0.6);
  col = S * alpha;
  T3 = vec3(1.0 - alpha);
  cloudDist = t;
#endif
  return vec4(col, T3.x);
}

// interleaved gradient noise (Jimenez) for slice jitter
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec3 dir = normalize(vWorldDir);
  vec3 sunDir = normalize(uSunDir);
  vec3 Fex;
  // evaluate the atmosphere slightly above the horizon for below-horizon rays (hidden by haze)
  vec3 adir = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z));
  vec3 sky = atmosphere(adir, sunDir, Fex);

  // sun disc with limb darkening
  float cosS = dot(dir, sunDir);
  float disc = smoothstep(SUN_COS - 0.00002, SUN_COS + 0.00001, cosS);
  float limb = sqrt(max(0.0, 1.0 - (1.0 - cosS) / (1.0 - SUN_COS)));
  vec3 sun = uSunDiscColor * uSunDiscIntensity * disc * mix(0.55, 1.0, limb);

  // overcast: desaturate/darken the clear sky toward a flat grey dome
  sky = mix(sky, uOvercastColor * (0.75 + 0.35 * adir.y), uOvercast);
  sun *= 1.0 - uOvercast;

  float cd;
  vec4 cl = clouds(dir, sunDir, cameraPosition, ign(gl_FragCoord.xy), cd);
  // aerial perspective on the clouds: distant ones dissolve into the sky colour
  float aerial = 1.0 - exp(-cd / 26000.0);
  vec3 cloudCol = mix(cl.rgb, sky * (1.0 - cl.a), aerial);
  vec3 col = (sky + sun) * cl.a + cloudCol;

  // horizon haze: the same height-fog integral as the scene fog, to "infinity"
  float od = tlFogOptical(cameraPosition.y, dir * 30000.0, uFogDensity, uFogParams, 0.0);
  float haze = 1.0 - exp(-od * uSkyHaze);
  if (dir.y < 0.0) haze = 1.0;
  vec3 fogTint = tlFogTint(dir, uFogColor, sunDir, uFogSunColor);
  col = mix(col, fogTint, haze);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyMaterial(uniforms: SkyUniforms, cloudSteps: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'TLSky',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: { CLOUD_STEPS: Math.max(0, Math.round(cloudSteps)) },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
