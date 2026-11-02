/**
 * Club-head motion trail: a short ribbon between the clubhead and a point up the shaft,
 * coloured by clubhead speed (bands from the swing model) and fading with age.
 * One additive draw call; rebuilt in place from a ring buffer each frame.
 */
import * as THREE from 'three';

// ---- tuning -------------------------------------------------------------------------------
const MAX_SAMPLES = 48;
/** Seconds a sample stays visible. */
const LIFETIME = 0.45;
const MIN_SPEED_MPH = 12;
const OPACITY = 0.55;

const C_SLOW = new THREE.Color(0x9fc4ff);
const C_GOOD = new THREE.Color(0x5df08a);
const C_GREAT = new THREE.Color(0xffd84a);
const C_MAX = new THREE.Color(0xff6a2a);

export function speedColor(mph: number, bands: [number, number, number], out: THREE.Color) {
  const [a, b, c] = bands;
  if (mph < a) return out.copy(C_SLOW).lerp(C_GOOD, Math.max(0, (mph - a * 0.6) / (a * 0.4)));
  if (mph < b) return out.copy(C_GOOD).lerp(C_GREAT, (mph - a) / (b - a));
  if (mph < c) return out.copy(C_GREAT).lerp(C_MAX, (mph - b) / (c - b));
  return out.copy(C_MAX);
}

export class ClubTrail {
  mesh: THREE.Mesh;
  enabled = false;
  private head: Float32Array = new Float32Array(MAX_SAMPLES * 3);
  private tail: Float32Array = new Float32Array(MAX_SAMPLES * 3);
  private col: Float32Array = new Float32Array(MAX_SAMPLES * 3);
  private time: Float32Array = new Float32Array(MAX_SAMPLES);
  private n = 0;
  private start = 0;
  private pos: THREE.BufferAttribute;
  private rgba: THREE.BufferAttribute;
  private c = new THREE.Color();

  constructor() {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(MAX_SAMPLES * 2 * 3), 3);
    this.rgba = new THREE.BufferAttribute(new Float32Array(MAX_SAMPLES * 2 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.rgba.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.rgba);
    const idx: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  clear() {
    this.n = 0;
    this.start = 0;
    this.mesh.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  /** Record a sample (world space). */
  push(time: number, head: THREE.Vector3, shaft: THREE.Vector3, mph: number, bands: [number, number, number]) {
    if (!this.enabled) return;
    if (mph < MIN_SPEED_MPH) return;
    const i = (this.start + this.n) % MAX_SAMPLES;
    if (this.n < MAX_SAMPLES) this.n++;
    else this.start = (this.start + 1) % MAX_SAMPLES;
    head.toArray(this.head, i * 3);
    shaft.toArray(this.tail, i * 3);
    speedColor(mph, bands, this.c).toArray(this.col, i * 3);
    this.time[i] = time;
  }

  update(time: number) {
    // Drop expired samples.
    while (this.n > 0 && time - this.time[this.start] > LIFETIME) {
      this.start = (this.start + 1) % MAX_SAMPLES;
      this.n--;
    }
    if (!this.enabled || this.n < 2) {
      this.mesh.visible = false;
      return;
    }
    const p = this.pos.array as Float32Array;
    const c = this.rgba.array as Float32Array;
    for (let k = 0; k < this.n; k++) {
      const i = (this.start + k) % MAX_SAMPLES;
      const age = Math.min(1, (time - this.time[i]) / LIFETIME);
      const a = (1 - age) * (1 - age) * Math.min(1, (k + 1) / 3);
      for (let j = 0; j < 3; j++) {
        p[k * 6 + j] = this.head[i * 3 + j];
        // The ribbon tapers toward the shaft end.
        p[k * 6 + 3 + j] = this.head[i * 3 + j] + (this.tail[i * 3 + j] - this.head[i * 3 + j]) * (0.35 + 0.65 * (1 - age));
        c[k * 8 + j] = this.col[i * 3 + j];
        c[k * 8 + 4 + j] = this.col[i * 3 + j];
      }
      c[k * 8 + 3] = a;
      c[k * 8 + 7] = 0;
    }
    this.pos.needsUpdate = true;
    this.rgba.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, (this.n - 1) * 6);
    this.mesh.visible = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
