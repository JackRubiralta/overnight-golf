/**
 * Ambient wind particles: pollen, seed fluff and tiny insects drifting with the wind in a box
 * around the camera. Fully GPU-animated (static seeds; the vertex shader wraps positions into
 * the box, follows the terrain via the baked heightmap and adds gentle swirl), so it costs one
 * draw call and no CPU work besides advancing the drift offset. Backlit motes glow gold.
 */
import * as THREE from 'three';
import { COURSE_GLSL, courseUniforms, globalUniforms, type CourseTextures } from '../shared';
import { FX_GLSL, fxUniforms, premultipliedBlending } from './common';

// ---- tuning -------------------------------------------------------------------------------
/** Box edge length (m) around the camera. */
const BOX = 38;
/** Drift = wind speed × this (motes are in the slower near-ground air) + a minimum (m/s). */
const WIND_FACTOR = 0.5;
const MIN_DRIFT = 0.35;
/** Height band above the ground (m). */
const MIN_H = 0.25;
const MAX_H = 7.0;
/** Size range (m) of pollen and of the rarer fluffy seeds. */
const POLLEN_SIZE = 0.018;
const FLUFF_SIZE = 0.05;
const FLUFF_FRACTION = 0.12;

const f = (n: number) => n.toFixed(4);

const VERT = /* glsl */ `
${FX_GLSL}
${COURSE_GLSL}
uniform vec2 uDrift;
uniform vec3 uCamPos;
attribute vec4 aSeed;
varying float vAlpha;
varying vec3 vLight;
varying float vFluff;
void main() {
  float s = aSeed.w;
  float fluff = step(1.0 - ${f(FLUFF_FRACTION)}, fract(s * 7.31));
  float speed = 0.7 + 0.6 * aSeed.z;
  vec2 swirl = vec2(sin(uTime * 0.61 + s * 40.0) + 0.5 * sin(uTime * 1.37 + s * 13.0),
                    cos(uTime * 0.47 + s * 31.0) + 0.5 * cos(uTime * 1.13 + s * 7.0)) * 0.9;
  vec2 xz = aSeed.xy * ${f(BOX)} + uDrift * speed + swirl;
  vec2 rel = mod(xz - uCamPos.xz + ${f(BOX * 0.5)}, ${f(BOX)}) - ${f(BOX * 0.5)};
  xz = uCamPos.xz + rel;
  float h = mix(${f(MIN_H)}, ${f(MAX_H)}, aSeed.z * aSeed.z) + 0.35 * sin(uTime * 0.83 + s * 17.0);
  vec3 wp = vec3(xz.x, courseHeight(xz) + h, xz.y);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(${f(POLLEN_SIZE)}, ${f(FLUFF_SIZE)}, fluff) * (0.7 + 0.6 * fract(s * 3.7));
  float px = size * uScreenScale / max(-mv.z, 0.05);
  gl_PointSize = clamp(px, 1.0, 24.0);
  // Fade at the box edges (no popping when wrapping) and with distance; sub-pixel → fade.
  float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x), abs(rel.y)) / ${f(BOX)});
  float d = length(wp - cameraPosition);
  vAlpha = edge * (1.0 - smoothstep(10.0, ${f(BOX * 0.5)}, d)) * clamp(px, 0.0, 1.0) * (0.4 + 0.2 * fluff);
  vec3 vd = (wp - cameraPosition) / max(d, 1e-3);
  vLight = fxLight(vd) * (1.0 + 1.5 * pow(max(dot(vd, uSunDir), 0.0), 12.0));
  vFluff = fluff;
}
`;

const FRAG = /* glsl */ `
${FX_GLSL}
varying float vAlpha;
varying vec3 vLight;
varying float vFluff;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  float a = mix(exp(-r2 * 4.0), exp(-r2 * 2.2) * (0.6 + 0.4 * exp(-r2 * 12.0)), vFluff) * vAlpha;
  if (a < 0.003) discard;
  vec3 col = vec3(1.0, 0.96, 0.86) * vLight;
  gl_FragColor = vec4(col * a, a * 0.6);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class WindMotes {
  readonly points: THREE.Points;
  private geo = new THREE.BufferGeometry();
  private uDrift = { value: new THREE.Vector2() };
  private max: number;

  constructor(max: number, tex: CourseTextures) {
    this.max = max;
    const seeds = new Float32Array(max * 4);
    for (let i = 0; i < max * 4; i++) seeds[i] = Math.random();
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    // `position` is required by three for draw counts; the shader ignores it.
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...fxUniforms(), ...courseUniforms(tex), uDrift: this.uDrift, uCamPos: globalUniforms.uCameraPos },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    premultipliedBlending(mat);
    this.points = new THREE.Points(this.geo, mat);
    this.points.name = 'fx-motes';
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
  }

  /** Number of motes drawn (≤ max). */
  setCount(n: number) {
    this.geo.setDrawRange(0, Math.min(this.max, n));
    this.points.visible = n > 0;
  }

  update(dt: number) {
    const w = globalUniforms.uWindDir.value;
    const sp = globalUniforms.uWindSpeed.value * WIND_FACTOR + MIN_DRIFT;
    const d = this.uDrift.value;
    d.x += w.x * sp * dt;
    d.y += w.y * sp * dt;
    // keep the offset bounded (float precision) — whole boxes are invisible shifts
    if (Math.abs(d.x) > BOX * 100) d.x %= BOX;
    if (Math.abs(d.y) > BOX * 100) d.y %= BOX;
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
