/**
 * Shared bits for the effects (fx) shaders: approximate lighting of small translucent things
 * (dust, droplets, pollen) from the global sun/fog uniforms, a cheap exp² fog, value noise and
 * the per-frame screen-scale uniforms used to size camera-facing sprites in pixels.
 */
import * as THREE from 'three';
import { globalUniforms } from '../shared';

// ---- tuning -------------------------------------------------------------------------------
/** Direct sun contribution on particles (× uSunColor). */
export const FX_SUN = 1.25;
/** Forward-scattering boost when looking toward the sun (backlit dust/pollen glows). */
export const FX_FORWARD = 2.6;
/** Ambient contribution (× fog colour, which tracks the sky tint). */
export const FX_AMBIENT = 0.55;

const f = (n: number) => n.toFixed(4);

/** Uniform objects shared by every fx material (same object references → no per-material sync). */
export const fxShared = {
  /** Drawing-buffer pixels per radian-ish: bufferHeight / (2 tan(fov/2)). */
  uScreenScale: { value: 800 },
  /** Radians per pixel: 1 / uScreenScale. */
  uPixel: { value: 1 / 800 },
};

export function fxUniforms() {
  return {
    uSunDir: globalUniforms.uSunDir,
    uSunColor: globalUniforms.uSunColor,
    uFogColor: globalUniforms.uFogColor,
    uFogDensity: globalUniforms.uFogDensity,
    uTime: globalUniforms.uTime,
    uScreenScale: fxShared.uScreenScale,
    uPixel: fxShared.uPixel,
  };
}

/** Update the screen-scale uniforms for the current camera / drawing buffer. */
export function updateFxScreen(camera: THREE.PerspectiveCamera, bufferHeight: number) {
  const s = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  fxShared.uScreenScale.value = s;
  fxShared.uPixel.value = 1 / s;
}

export const FX_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform float uScreenScale;
uniform float uPixel;
float fxFog(float d) { float x = uFogDensity * d; return 1.0 - exp(-x * x); }
// Light reaching a small translucent particle seen along viewDir (camera → particle).
vec3 fxLight(vec3 viewDir) {
  float fwd = pow(max(dot(viewDir, uSunDir), 0.0), 6.0);
  float sunUp = 0.35 + 0.65 * smoothstep(0.0, 0.5, uSunDir.y);
  return uSunColor * (${f(FX_SUN)} * sunUp + ${f(FX_FORWARD)} * fwd) + uFogColor * ${f(FX_AMBIENT)};
}
float fxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p) {
  vec2 i = floor(p), u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(fxHash(i), fxHash(i + vec2(1.0, 0.0)), u.x), mix(fxHash(i + vec2(0.0, 1.0)), fxHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** Premultiplied-alpha blending: rgb is pre-multiplied, alpha 0 → purely additive. */
export function premultipliedBlending(m: THREE.Material) {
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}
