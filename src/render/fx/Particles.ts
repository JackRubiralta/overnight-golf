/**
 * Pooled CPU-simulated sprite particles (one THREE.Points draw call for every burst effect:
 * dust, sand, droplets, mist, grass clippings, sparks).
 *
 * Struct-of-arrays storage, swap-remove on death (live particles are always [0, live)), so the
 * GPU upload is limited to the live range. No allocations after construction.
 *
 * Blending is premultiplied alpha with a per-particle "additive" flag folded into the alpha
 * channel, so lit (alpha-blended) and glowing (additive) sprites share one material.
 */
import * as THREE from 'three';
import { FX_GLSL, fxUniforms, premultipliedBlending } from './common';

// ---- flags & shapes -------------------------------------------------------------------------
export const PF_ADD = 1; // additive glow (unlit)
export const PF_GROUND = 2; // dies when it hits the ground / floor
export const PF_WIND = 4; // drag pulls it toward the wind velocity
export const PF_SETTLE = 8; // lands and rests on the ground instead of dying

export const SHAPE_SOFT = 0;
export const SHAPE_DROP = 1;
export const SHAPE_SPARK = 2;
export const SHAPE_FLAKE = 3;
export const SHAPE_GRAIN = 4;

/** Max sprite size in pixels (keeps fill-rate bounded for puffs right in front of the camera). */
const MAX_PX = 380;
/** Fraction of the life used for fade in / where fade out starts. */
const FADE_IN = 0.06;
const FADE_OUT = 0.55;

const VERT = /* glsl */ `
${FX_GLSL}
attribute vec4 aColor;
attribute vec3 aMisc; // size (m), shape, rotation
varying vec4 vColor;
varying vec3 vLight;
varying float vShape;
varying float vRot;
varying float vFog;
varying float vAdd;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float px = aMisc.x * uScreenScale / max(-mv.z, 0.05);
  gl_PointSize = clamp(px, 1.5, ${MAX_PX.toFixed(1)});
  vColor = aColor;
  vAdd = step(1.5, aColor.a); // alpha encoded as a + 2 for additive particles
  vColor.a -= vAdd * 2.0;
  // Sub-pixel sprites: fade instead of shrinking below ~1.5 px (no shimmering specks).
  vColor.a *= clamp(px / 1.5, 0.0, 1.0);
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 vd = wp - cameraPosition;
  float d = length(vd);
  vLight = fxLight(vd / max(d, 1e-4));
  vFog = fxFog(d);
  vShape = aMisc.y;
  vRot = aMisc.z;
}
`;

const FRAG = /* glsl */ `
${FX_GLSL}
varying vec4 vColor;
varying vec3 vLight;
varying float vShape;
varying float vRot;
varying float vFog;
varying float vAdd;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float cs = cos(vRot), sn = sin(vRot);
  c = mat2(cs, sn, -sn, cs) * c;
  float r2 = dot(c, c);
  float a;
  vec3 col = vColor.rgb;
  if (vShape < 0.5) {            // soft puff
    a = exp(-r2 * 3.2) * (1.0 - smoothstep(0.7, 1.0, r2));
  } else if (vShape < 1.5) {     // droplet: crisp disc with a specular glint
    a = 1.0 - smoothstep(0.55, 1.0, r2);
    col += vec3(1.6) * exp(-dot(c - vec2(-0.3, -0.35), c - vec2(-0.3, -0.35)) * 14.0);
  } else if (vShape < 2.5) {     // spark / star
    float star = exp(-abs(c.x) * 14.0) * exp(-c.y * c.y * 2.0) + exp(-abs(c.y) * 14.0) * exp(-c.x * c.x * 2.0);
    a = clamp(star + exp(-r2 * 9.0), 0.0, 1.0);
  } else if (vShape < 3.5) {     // grass clipping: thin sliver
    vec2 q = c * vec2(4.2, 1.05);
    a = 1.0 - smoothstep(0.7, 1.0, dot(q, q));
  } else {                       // grain: small hard dot
    a = 1.0 - smoothstep(0.35, 1.0, r2);
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  vec3 lit = vAdd > 0.5 ? col : col * vLight;
  lit = mix(lit, vAdd > 0.5 ? vec3(0.0) : uFogColor, vFog);
  // Tone map / encode the straight colour, then premultiply (keeps small alphas from glowing
  // when the renderer tone maps per material, i.e. without the post pipeline).
  gl_FragColor = vec4(lit, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
}
`;

export class ParticlePool {
  readonly points: THREE.Points;
  readonly max: number;
  live = 0;
  /** Ground height query (terrain). */
  ground: (x: number, z: number) => number = () => 0;
  /** Wind velocity (m/s, x/z) the WIND-flagged particles relax toward. */
  windX = 0;
  windZ = 0;

  // simulation state
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private cr: Float32Array; private cg: Float32Array; private cb: Float32Array; private ca: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private flags: Uint8Array; private shape: Uint8Array;
  private rot: Float32Array; private spin: Float32Array; private floor: Float32Array;
  // GPU attributes
  private aPos: THREE.BufferAttribute; private aColor: THREE.BufferAttribute; private aMisc: THREE.BufferAttribute;
  private geo = new THREE.BufferGeometry();

  constructor(max: number) {
    this.max = max;
    const F = () => new Float32Array(max);
    this.px = F(); this.py = F(); this.pz = F();
    this.vx = F(); this.vy = F(); this.vz = F();
    this.age = F(); this.life = F(); this.s0 = F(); this.s1 = F();
    this.cr = F(); this.cg = F(); this.cb = F(); this.ca = F();
    this.drag = F(); this.grav = F(); this.rot = F(); this.spin = F(); this.floor = F();
    this.flags = new Uint8Array(max); this.shape = new Uint8Array(max);
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aColor', this.aColor);
    this.geo.setAttribute('aMisc', this.aMisc);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: fxUniforms(),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    premultipliedBlending(mat);
    this.points = new THREE.Points(this.geo, mat);
    this.points.name = 'fx-particles';
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /**
   * Spawn one particle. Returns false when the pool is full.
   * floorY: NaN → collide with the terrain; otherwise a fixed floor (e.g. water surface).
   */
  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number,
    r: number, g: number, b: number, a: number,
    drag: number, grav: number, flags: number, shape: number,
    spin = 0, floorY = NaN,
  ): boolean {
    if (this.live >= this.max) return false;
    const i = this.live++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life;
    this.s0[i] = size0; this.s1[i] = size1;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b; this.ca[i] = a;
    this.drag[i] = drag; this.grav[i] = grav;
    this.flags[i] = flags; this.shape[i] = shape;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = spin;
    this.floor[i] = floorY;
    return true;
  }

  private kill(i: number) {
    const j = --this.live;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j]; this.ca[i] = this.ca[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j];
    this.flags[i] = this.flags[j]; this.shape[i] = this.shape[j];
    this.rot[i] = this.rot[j]; this.spin[i] = this.spin[j]; this.floor[i] = this.floor[j];
  }

  /** Simulate (no upload). */
  step(dt: number) {
    for (let i = 0; i < this.live; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        this.kill(i);
        i--;
        continue;
      }
      const fl = this.flags[i];
      const k = Math.exp(-this.drag[i] * dt);
      if (fl & PF_WIND) {
        this.vx[i] = this.windX + (this.vx[i] - this.windX) * k;
        this.vz[i] = this.windZ + (this.vz[i] - this.windZ) * k;
      } else {
        this.vx[i] *= k;
        this.vz[i] *= k;
      }
      this.vy[i] = this.vy[i] * k - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (fl & (PF_GROUND | PF_SETTLE)) {
        const fy = this.floor[i];
        const gy = fy === fy ? fy : this.ground(this.px[i], this.pz[i]);
        if (this.py[i] < gy) {
          if (fl & PF_SETTLE) {
            this.py[i] = gy + 0.005;
            this.vx[i] = this.vy[i] = this.vz[i] = 0;
            this.spin[i] = 0;
            this.flags[i] = fl & ~(PF_SETTLE | PF_GROUND | PF_WIND);
            this.grav[i] = 0;
          } else {
            this.kill(i);
            i--;
          }
        }
      }
    }
  }

  /** Write the live range into the GPU attributes. */
  upload() {
    const P = this.aPos.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    for (let i = 0; i < this.live; i++) {
      const t = this.age[i] / this.life[i];
      const fade = Math.min(1, t / FADE_IN) * (t < FADE_OUT ? 1 : 1 - (t - FADE_OUT) / (1 - FADE_OUT));
      P[i * 3] = this.px[i]; P[i * 3 + 1] = this.py[i]; P[i * 3 + 2] = this.pz[i];
      C[i * 4] = this.cr[i]; C[i * 4 + 1] = this.cg[i]; C[i * 4 + 2] = this.cb[i];
      C[i * 4 + 3] = this.ca[i] * fade + (this.flags[i] & PF_ADD ? 2 : 0);
      M[i * 3] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t);
      M[i * 3 + 1] = this.shape[i];
      M[i * 3 + 2] = this.rot[i];
    }
    const n = this.live;
    this.geo.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (n === 0) return;
    this.mark(this.aPos, n * 3);
    this.mark(this.aColor, n * 4);
    this.mark(this.aMisc, n * 3);
  }

  private mark(a: THREE.BufferAttribute, count: number) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, count);
    a.needsUpdate = true;
  }

  clear() {
    this.live = 0;
    this.upload();
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
