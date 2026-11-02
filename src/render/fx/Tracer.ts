/**
 * Shot tracer: a camera-facing glowing ribbon through the ball's path.
 *
 * Each point is stored twice (left/right edge); the vertex shader expands the ribbon
 * perpendicular to both the path tangent and the view ray, with a width that is constant in
 * pixels (min physical width near the camera), so the tracer reads the same at 3 m and 300 m.
 * The fragment shader draws a hot white core inside a coloured glow (additive, HDR → bloom),
 * a bright comet head at the ball and a soft fade-in at launch.
 *
 * Buffers are preallocated (MAX_POINTS); pushes only upload the last two points.
 */
import * as THREE from 'three';
import { FX_GLSL, fxUniforms } from './common';

// ---- tuning -------------------------------------------------------------------------------
export const TRACER_MAX_POINTS = 1024;
/** New point when the ball moved this far from the last fixed point (m). */
const MIN_SPACING = 0.6;
/** Ribbon half-width as a fraction of the screen height (≈7 px at 1080p), and the minimum physical half-width (m). */
const HALF_WIDTH_FRAC = 0.0065;
const MIN_HALF_WIDTH = 0.03;
/** Seconds a finished tracer stays at full strength, and the total fade time. */
export const TRACER_HOLD = 2.0;
export const TRACER_FADE = 10.0;
/** Brightness multiplier (HDR, for bloom). */
const INTENSITY = 1.0;

const VERT = /* glsl */ `
${FX_GLSL}
attribute vec3 aDir;
attribute float aSide;
attribute float aU;
varying float vSide;
varying float vU;
varying float vDist;
void main() {
  vec3 toCam = cameraPosition - position;
  float d = length(toCam);
  vec3 side = cross(aDir, toCam / max(d, 1e-4));
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
  float w = max(${MIN_HALF_WIDTH.toFixed(4)}, d * uFovScale * ${HALF_WIDTH_FRAC.toFixed(5)});
  vec3 p = position + side * aSide * w;
  vSide = aSide;
  vU = aU;
  vDist = d;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
${FX_GLSL}
uniform vec3 uColor;
uniform float uAlpha;
uniform float uLen;
uniform float uHead;
varying float vSide;
varying float vU;
varying float vDist;
void main() {
  float x = vSide;
  float core = exp(-x * x * 30.0);
  float glow = exp(-x * x * 3.5) - exp(-3.5);
  float head = exp(-max(uLen - vU, 0.0) / 7.0) * uHead;
  float launch = smoothstep(0.0, 2.5, vU);
  // gentle shimmer travelling along the path
  float shimmer = 0.88 + 0.12 * sin(vU * 0.35 - uTime * 6.0);
  vec3 hot = mix(uColor, vec3(1.0), 0.15);
  vec3 col = (uColor * glow * 2.6 + hot * core * 0.9) * shimmer + vec3(1.0, 0.97, 0.92) * core * 2.4 * head;
  float a = uAlpha * launch * (1.0 - 0.85 * fxFog(vDist));
  gl_FragColor = vec4(col * ${INTENSITY.toFixed(2)}, clamp(a, 0.0, 1.0)); // additive: src * alpha
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export type TracerState = 'idle' | 'live' | 'done';

export class TracerRibbon {
  readonly mesh: THREE.Mesh;
  state: TracerState = 'idle';
  /** Seconds since tracerEnd (state 'done'). */
  age = 0;
  /** Extra dimming once a newer shot exists (1 = full). */
  ghost = 1;
  /** Creation order (for picking the oldest ribbon to recycle). */
  serial = 0;
  private geo = new THREE.BufferGeometry();
  private pos: THREE.BufferAttribute;
  private dir: THREE.BufferAttribute;
  private u: THREE.BufferAttribute;
  private n = 0;
  private len = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  private uniforms: { uColor: { value: THREE.Color }; uAlpha: { value: number }; uLen: { value: number }; uHead: { value: number } };
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor() {
    const N = TRACER_MAX_POINTS;
    this.pos = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.dir = new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.u = new THREE.BufferAttribute(new Float32Array(N * 2), 1).setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const idx = new Uint16Array((N - 1) * 6);
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
    }
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aDir', this.dir);
    this.geo.setAttribute('aU', this.u);
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setDrawRange(0, 0);
    this.uniforms = { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uLen: { value: 0 }, uHead: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...fxUniforms(), ...this.uniforms },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'tracer';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 20;
  }

  start(p: THREE.Vector3, color: THREE.Color, serial: number) {
    this.state = 'live';
    this.age = 0;
    this.ghost = 1;
    this.serial = serial;
    this.n = 0;
    this.len = 0;
    this.uniforms.uColor.value.copy(color);
    this.addPoint(p);
    this.addPoint(p);
    this.mesh.visible = true;
  }

  push(p: THREE.Vector3) {
    if (this.state !== 'live' || this.n < 2) return;
    const last = this.n - 2; // last fixed point
    this.tmp.fromArray(this.pos.array as Float32Array, last * 6);
    if (this.tmp.distanceTo(p) >= MIN_SPACING && this.n < TRACER_MAX_POINTS) this.addPoint(p);
    else this.setPoint(this.n - 1, p);
  }

  end() {
    if (this.state === 'live') {
      this.state = 'done';
      this.age = 0;
    }
  }

  clear() {
    this.state = 'idle';
    this.n = 0;
    this.mesh.visible = false;
    this.geo.setDrawRange(0, 0);
  }

  /** Advance fading; returns false once fully faded (ribbon goes idle). */
  update(dt: number): boolean {
    if (this.state === 'idle') return false;
    let a = 1;
    if (this.state === 'done') {
      this.age += dt;
      a = 1 - THREE.MathUtils.smoothstep(this.age, TRACER_HOLD, TRACER_FADE);
      if (a <= 0) {
        this.clear();
        return false;
      }
    }
    this.flush();
    this.uniforms.uAlpha.value = a * this.ghost;
    this.uniforms.uHead.value = this.state === 'live' ? 1 : Math.max(0, 1 - this.age / 1.5);
    return true;
  }

  private addPoint(p: THREE.Vector3) {
    const i = this.n++;
    if (i > 0) {
      this.tmp.fromArray(this.pos.array as Float32Array, (i - 1) * 6);
      this.len += this.tmp.distanceTo(p);
    }
    this.setPoint(i, p, true);
    this.geo.setDrawRange(0, Math.max(0, this.n - 1) * 6);
  }

  /** Write point i (both edge vertices), update its arc length and the tangents around it. */
  private setPoint(i: number, p: THREE.Vector3, appended = false) {
    const P = this.pos.array as Float32Array;
    const U = this.u.array as Float32Array;
    if (!appended && i > 0) {
      // Moving the head point: recompute its arc length from the previous point.
      this.tmp.fromArray(P, (i - 1) * 6);
      this.len = U[(i - 1) * 2] + this.tmp.distanceTo(p);
    }
    P[i * 6] = P[i * 6 + 3] = p.x;
    P[i * 6 + 1] = P[i * 6 + 4] = p.y;
    P[i * 6 + 2] = P[i * 6 + 5] = p.z;
    U[i * 2] = U[i * 2 + 1] = i === 0 ? 0 : this.len;
    this.uniforms.uLen.value = this.len;
    this.updateDir(i);
    if (i > 0) this.updateDir(i - 1);
    this.dirtyMin = Math.min(this.dirtyMin, Math.max(0, i - 1));
    this.dirtyMax = Math.max(this.dirtyMax, i);
  }

  /** Upload the points changed since the last flush (called once per frame). */
  private flush() {
    if (this.dirtyMax < 0) return;
    const from = this.dirtyMin;
    const count = this.dirtyMax - from + 1;
    markRange(this.pos, from * 6, count * 6);
    markRange(this.dir, from * 6, count * 6);
    markRange(this.u, from * 2, count * 2);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  private updateDir(i: number) {
    const P = this.pos.array as Float32Array;
    const D = this.dir.array as Float32Array;
    const a = Math.max(0, i - 1);
    const b = Math.min(this.n - 1, i + 1);
    this.tmp.fromArray(P, b * 6).sub(this.tmp2.fromArray(P, a * 6));
    if (this.tmp.lengthSq() < 1e-10) this.tmp.set(0, 0, 1);
    this.tmp.normalize();
    D[i * 6] = D[i * 6 + 3] = this.tmp.x;
    D[i * 6 + 1] = D[i * 6 + 4] = this.tmp.y;
    D[i * 6 + 2] = D[i * 6 + 5] = this.tmp.z;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function markRange(a: THREE.BufferAttribute, start: number, count: number) {
  a.clearUpdateRanges();
  a.addUpdateRange(start, count);
  a.needsUpdate = true;
}
