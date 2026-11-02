/**
 * Sky dome shader: Preetham analytic daylight (scattering code adapted from three.js
 * examples/jsm/objects/Sky.js, MIT), a limb-darkened sun disc, the volumetric clouds sampled
 * from the amortised cloud cube map (CloudCube.ts / cloudShader.ts) and a horizon haze that uses
 * the exact same height-fog integral as the patched scene fog (fog.ts), so distant terrain melts
 * seamlessly into the sky. Cheap per pixel: no raymarching here.
 */
import * as THREE from 'three';
import { FOG_GLSL } from './fog';

export interface SkyUniforms {
  [k: string]: THREE.IUniform;
}

export function createSkyUniforms(cloudCube: THREE.Texture | null): SkyUniforms {
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
    // clouds (cube map from CloudCube; rgb = premultiplied cloud light, a = transmittance)
    uCloudCube: { value: cloudCube },
    uCloudsOn: { value: 1 },
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
uniform samplerCube uCloudCube;
uniform float uCloudsOn;
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

  vec4 cl = uCloudsOn > 0.5 ? textureCube(uCloudCube, dir) : vec4(0.0, 0.0, 0.0, 1.0);
  vec3 col = (sky + sun) * cl.a + cl.rgb;

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

export function createSkyMaterial(uniforms: SkyUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'TLSky',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}
