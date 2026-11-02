/**
 * Turf chunks and soil clods thrown by divots: a pooled InstancedMesh of small lit boxes
 * (grass-green top, soil sides) that tumble, bounce on the terrain, settle and shrink away.
 * One draw call; CPU simulation with preallocated arrays.
 */
import * as THREE from 'three';

// ---- tuning -------------------------------------------------------------------------------
const GRAVITY = 9.81;
const BOUNCE = 0.22;
const GROUND_FRICTION = 0.45;
/** Seconds resting chunks stay before shrinking away, and the shrink time. */
const REST_TIME = 14;
const SHRINK_TIME = 1.2;
const GRASS_TOP = new THREE.Color(0.11, 0.2, 0.045);
const SOIL = new THREE.Color(0.075, 0.05, 0.032);

export class ChunkPool {
  readonly mesh: THREE.InstancedMesh;
  readonly max: number;
  live = 0;
  ground: (x: number, z: number) => number = () => 0;
  private p: Float32Array; private v: Float32Array; private q: Float32Array; private w: Float32Array;
  private s: Float32Array; private age: Float32Array; private life: Float32Array; private rest: Uint8Array;
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private dq = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private col = new THREE.Color();

  constructor(max: number) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.q = new Float32Array(max * 4);
    this.w = new Float32Array(max * 3);
    this.s = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.rest = new Uint8Array(max);
    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    // Vertex colours: top face grass, the rest soil.
    const n = geo.getAttribute('normal');
    const colors = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const c = n.getY(i) > 0.5 ? GRASS_TOP : SOIL;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'fx-chunks';
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, this.col.setRGB(1, 1, 1));
  }

  /** Spawn a chunk of size (sx, sy, sz) metres. tint varies brightness/hue slightly. */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, sx: number, sy: number, sz: number, spin: number, tint: number): boolean {
    if (this.live >= this.max) return false;
    const i = this.live++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.q[i * 4] = 0; this.q[i * 4 + 1] = 0; this.q[i * 4 + 2] = 0; this.q[i * 4 + 3] = 1;
    this.w[i * 3] = (Math.random() - 0.5) * spin;
    this.w[i * 3 + 1] = (Math.random() - 0.5) * spin * 0.5;
    this.w[i * 3 + 2] = (Math.random() - 0.5) * spin;
    this.s[i * 3] = sx; this.s[i * 3 + 1] = sy; this.s[i * 3 + 2] = sz;
    this.age[i] = 0;
    this.life[i] = REST_TIME * (0.8 + 0.4 * Math.random());
    this.rest[i] = 0;
    this.mesh.setColorAt(i, this.col.setRGB(tint, tint * (0.95 + 0.1 * Math.random()), tint));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return true;
  }

  private kill(i: number) {
    const j = --this.live;
    if (i === j) return;
    for (let k = 0; k < 3; k++) {
      this.p[i * 3 + k] = this.p[j * 3 + k];
      this.v[i * 3 + k] = this.v[j * 3 + k];
      this.w[i * 3 + k] = this.w[j * 3 + k];
      this.s[i * 3 + k] = this.s[j * 3 + k];
    }
    for (let k = 0; k < 4; k++) this.q[i * 4 + k] = this.q[j * 4 + k];
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.rest[i] = this.rest[j];
    this.mesh.getColorAt(j, this.col);
    this.mesh.setColorAt(i, this.col);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  step(dt: number) {
    for (let i = 0; i < this.live; i++) {
      const age = (this.age[i] += dt);
      if (age > this.life[i] + SHRINK_TIME) {
        this.kill(i);
        i--;
        continue;
      }
      if (this.rest[i]) continue;
      const o = i * 3;
      this.v[o + 1] -= GRAVITY * dt;
      this.p[o] += this.v[o] * dt;
      this.p[o + 1] += this.v[o + 1] * dt;
      this.p[o + 2] += this.v[o + 2] * dt;
      // tumble
      this.axis.set(this.w[o], this.w[o + 1], this.w[o + 2]);
      const wl = this.axis.length();
      if (wl > 1e-4) {
        this.dq.setFromAxisAngle(this.axis.multiplyScalar(1 / wl), wl * dt);
        this.quat.fromArray(this.q, i * 4).premultiply(this.dq).normalize().toArray(this.q, i * 4);
      }
      const gy = this.ground(this.p[o], this.p[o + 2]) + this.s[o + 1] * 0.5;
      if (this.p[o + 1] < gy) {
        this.p[o + 1] = gy;
        if (Math.abs(this.v[o + 1]) < 1.2) {
          // settle: lie flat-ish (keep yaw only) and stop
          this.rest[i] = 1;
          this.quat.fromArray(this.q, i * 4);
          this.axis.set(0, 1, 0).applyQuaternion(this.quat);
          const up = this.axis.y >= 0 ? 0 : Math.PI; // grass side up or down, as it fell
          this.quat.setFromAxisAngle(this.axis.set(1, 0, 0), up).premultiply(this.dq.setFromAxisAngle(this.pos.set(0, 1, 0), Math.random() * 6.28));
          this.quat.toArray(this.q, i * 4);
        } else {
          this.v[o + 1] = -this.v[o + 1] * BOUNCE;
          this.v[o] *= GROUND_FRICTION;
          this.v[o + 2] *= GROUND_FRICTION;
          this.w[o] *= 0.5; this.w[o + 1] *= 0.5; this.w[o + 2] *= 0.5;
        }
      }
    }
  }

  upload() {
    for (let i = 0; i < this.live; i++) {
      const o = i * 3;
      const shrink = 1 - THREE.MathUtils.clamp((this.age[i] - this.life[i]) / SHRINK_TIME, 0, 1);
      this.pos.set(this.p[o], this.p[o + 1], this.p[o + 2]);
      this.quat.fromArray(this.q, i * 4);
      this.scl.set(this.s[o] * shrink, this.s[o + 1] * shrink, this.s[o + 2] * shrink);
      this.m.compose(this.pos, this.quat, this.scl);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = this.live;
    this.mesh.visible = this.live > 0;
    if (this.live) this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.live = 0;
    this.upload();
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
