/**
 * Ground/water decals as one InstancedMesh of horizontal quads (ring buffer, oldest recycled):
 *  - DECAL_DIVOT:  torn turf scar (dark soil, ragged edges, a lip of displaced grass),
 *  - DECAL_SAND:   disturbed sand crater (dark centre, light thrown rim),
 *  - DECAL_RIPPLE: expanding ring ripple on water (light crest + dark trough), animated on the
 *                  GPU from its birth time, so it costs nothing on the CPU after spawning.
 * Each instance carries (kind, birth time, lifetime, seed); everything else is in the shader.
 */
import * as THREE from 'three';
import { FX_GLSL, fxUniforms } from './common';

export const DECAL_DIVOT = 0;
export const DECAL_SAND = 1;
export const DECAL_RIPPLE = 2;

// ---- tuning -------------------------------------------------------------------------------
/** Ripple expansion speed (m/s) relative to the decal radius 1 (quad scale = max diameter). */
const RIPPLE_SPEED = 1.5;
const LIFT = 0.025; // m above the surface

const VERT = /* glsl */ `
attribute vec4 aParams; // kind, birth, life, seed
attribute float aRadius;
varying vec2 vUv;
varying vec4 vParams;
varying float vRadius;
varying vec3 vWPos;
void main() {
  vUv = uv * 2.0 - 1.0;
  vParams = aParams;
  vRadius = aRadius;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${FX_GLSL}
varying vec2 vUv;
varying vec4 vParams;
varying float vRadius;
varying vec3 vWPos;
void main() {
  float kind = vParams.x;
  float age = uTime - vParams.y;
  float life = vParams.z;
  float seed = vParams.w;
  if (age < 0.0 || age > life) discard;
  vec2 p = vUv;
  float n = fxNoise(p * 4.0 + seed * 17.0) * 0.6 + fxNoise(p * 9.0 - seed * 5.0) * 0.4;
  vec3 col;
  float a;
  vec3 light = uSunColor * (0.25 + 1.2 * max(uSunDir.y, 0.0)) + uFogColor * 0.45;
  if (kind < 0.5) {
    // Divot scar: ragged ellipse (quad is already stretched along the shot line).
    float d = length(p) + (n - 0.5) * 0.45;
    a = 1.0 - smoothstep(0.62, 0.8, d);
    float lip = smoothstep(0.55, 0.75, d) * (1.0 - smoothstep(0.8, 0.98, d));
    vec3 soil = mix(vec3(0.05, 0.034, 0.022), vec3(0.11, 0.075, 0.045), n);
    col = mix(soil, vec3(0.07, 0.11, 0.03), lip * 0.8);
    a = max(a * 0.95, lip * 0.5);
    a *= 1.0 - smoothstep(life * 0.8, life, age);
    col *= light;
  } else if (kind < 1.5) {
    // Sand crater: darker churned centre, light spray rim.
    float d = length(p) + (n - 0.5) * 0.3;
    float centre = 1.0 - smoothstep(0.2, 0.55, d);
    float rim = smoothstep(0.4, 0.62, d) * (1.0 - smoothstep(0.65, 0.95, d));
    col = mix(vec3(0.42, 0.33, 0.21), vec3(0.85, 0.75, 0.56), rim);
    a = max(centre * 0.5, rim * 0.3 * smoothstep(0.3, 0.7, n));
    a *= 1.0 - smoothstep(life * 0.5, life, age);
    col *= light;
  } else {
    // Ring ripple: radius grows, crest/trough pair, fading with age and radius.
    float d = length(p) * vRadius;
    float r = age * ${RIPPLE_SPEED.toFixed(3)} + 0.05;
    float w = 0.06 + age * 0.07;
    float x = (d - r) / w;
    float v = exp(-x * x) - 0.7 * exp(-(x + 1.8) * (x + 1.8));
    float fade = (1.0 - age / life);
    fade *= fade * (1.0 - smoothstep(vRadius * 0.7, vRadius, d));
    v *= fade;
    col = v > 0.0 ? (uFogColor * 0.9 + uSunColor * 0.6) : vec3(0.0);
    a = abs(v) * (v > 0.0 ? 0.55 : 0.35);
  }
  a *= 1.0 - fxFog(distance(vWPos, cameraPosition)) * 0.7;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class DecalPool {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  private next = 0;
  private params: THREE.InstancedBufferAttribute;
  private radius: THREE.InstancedBufferAttribute;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private used = 0;

  constructor(max: number) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.radius = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    // Unused slots: birth far in the future → discarded.
    for (let i = 0; i < max; i++) this.params.setXYZW(i, 0, 1e9, 1, 0);
    geo.setAttribute('aParams', this.params);
    geo.setAttribute('aRadius', this.radius);
    const mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms(),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = 'fx-decals';
    this.mesh.renderOrder = -5; // just after the water, before particles
  }

  /**
   * Place a decal. normal = surface normal, yaw = rotation about it (radians; the quad's local
   * z axis = shot direction), size (w, l) in metres. birth = globalUniforms.uTime value at start.
   */
  spawn(kind: number, x: number, y: number, z: number, normal: THREE.Vector3, yaw: number, w: number, l: number, birth: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    this.q.setFromUnitVectors(this.up, normal).multiply(this.q2.setFromAxisAngle(this.up, yaw));
    this.v.set(x, y, z).addScaledVector(normal, LIFT);
    this.s.set(w, 1, l);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.params.setXYZW(i, kind, birth, life, Math.random() * 10);
    this.radius.setX(i, Math.max(w, l) * 0.5);
    this.mesh.count = this.used;
    this.mesh.visible = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.params.needsUpdate = true;
    this.radius.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) this.params.setXYZW(i, 0, 1e9, 1, 0);
    this.params.needsUpdate = true;
    this.used = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
