/**
 * Pins, flags and cups for every hole (plus the practice green).
 *
 *  - Flagsticks: one InstancedMesh (white shaft, claret band, ferrule) — 1 draw call.
 *  - Flags: one cloth mesh per pin; a vertex shader waves it from globalUniforms wind (amplitude,
 *    frequency and droop follow wind speed) and the CPU yaws it downwind. Numerals come from a
 *    shared atlas; back faces mirror u so the number reads correctly from both sides.
 *    A matching depth material keeps the shadow in sync with the wave.
 *  - Cups: a terrain-conforming disc whose fragment shader ray-marches (analytically) a vertical
 *    cylinder below the surface — white painted lip, darker soil/liner walls lit by the sun,
 *    near-black bottom — so the hole reads as a real cut from any camera angle on a heightfield.
 */
import * as THREE from 'three';
import { PHYS } from '../../config';
import type { Course } from '../../course/Course';
import { globalUniforms } from '../shared';
import { FLAG_COLORS, flagCellUV } from './textures';

/** Tunables */
export const PIN_HEIGHT = 2.13; // 7 ft flagstick
export const PIN_RADIUS = 0.0125;
const FLAG_W = 0.5;
const FLAG_H = 0.34;
const CUP_DEPTH = 0.1;
const CUP_OUTER = 0.085; // disc radius incl. the darkened cut edge
const PRACTICE_PIN_HEIGHT = 0.9;

export interface PinSpec {
  /** Atlas cell (0..8 = hole numbers, 9 = practice). */
  cell: number;
  x: number;
  z: number;
  /** Shorter pin (practice green). */
  short?: boolean;
  /** No flag at all (extra practice cups). */
  noFlag?: boolean;
}

interface Pin {
  spec: PinSpec;
  base: THREE.Vector3;
  group: THREE.Group;
  flag: THREE.Mesh | null;
  amp: { value: number };
  out: boolean;
  yaw: number;
  height: number;
}

const FLAG_VERT_PARS = /* glsl */ `
uniform float uTime;
uniform float uWindSpeed;
uniform float uAmp;
uniform float uPhase;
float flagS;
vec3 flagWave(vec3 p, out vec3 n) {
  float w = clamp(uWindSpeed, 0.0, 16.0);
  float s = clamp(p.x / ${FLAG_W.toFixed(3)}, 0.0, 1.0);
  float k = 11.0 - w * 0.25;
  float om = 3.5 + w * 1.1;
  float amp = uAmp * (0.018 + 0.006 * w) * pow(s, 1.15);
  float ph = k * p.x - om * uTime + uPhase + p.y * 2.2;
  float z = amp * (sin(ph) + 0.35 * sin(2.13 * ph + 1.3));
  float dz = amp * k * (cos(ph) + 0.35 * 2.13 * cos(2.13 * ph + 1.3));
  // Low wind: the free edge sags down the pole (progressive curl).
  float droop = (1.0 - smoothstep(0.6, 6.5, w)) * 1.15 * uAmp;
  float a = droop * s;
  vec3 q = vec3(p.x * cos(a), p.y - p.x * sin(a) * 0.85, z);
  // Shorten slightly as it flutters so it doesn't stretch.
  q.x -= abs(z) * 0.4;
  n = normalize(vec3(-dz, 0.0, 1.0));
  return q;
}
`;

function flagMaterial(map: THREE.Texture, amp: { value: number }, phase: number, cell: [number, number, number, number]) {
  const uniforms = {
    uTime: globalUniforms.uTime,
    uWindSpeed: globalUniforms.uWindSpeed,
    uAmp: amp,
    uPhase: { value: phase },
    uCell: { value: new THREE.Vector4(...cell) },
  };
  const mat = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_VERT_PARS)
      .replace('#include <beginnormal_vertex>', 'vec3 flagN; vec3 flagP = flagWave(position, flagN);\nvec3 objectNormal = flagN;')
      .replace('#include <begin_vertex>', 'vec3 transformed = flagP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uCell;')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec2 fuv = vMapUv;
        if (!gl_FrontFacing) fuv.x = uCell.x + uCell.z - fuv.x;
        vec4 sampledDiffuseColor = texture2D(map, fuv);
        diffuseColor *= sampledDiffuseColor;`,
      );
  };
  mat.customProgramCacheKey = () => 'thornbury-flag-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_VERT_PARS)
      .replace('#include <begin_vertex>', 'vec3 flagN; vec3 transformed = flagWave(position, flagN);');
  };
  depth.customProgramCacheKey = () => 'thornbury-flag-depth-v1';
  return { mat, depth };
}

const CUP_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CUP_FRAG = /* glsl */ `
uniform float uR;
uniform float uDepth;
uniform float uOuter;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uTurf;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  float r = length(vLocal.xz);
  vec3 d = normalize(vWorld - cameraPosition);
  if (r > uR) {
    // Cut edge: slightly darker, bruised turf fading into the green.
    float a = 1.0 - smoothstep(uR, uOuter, r);
    gl_FragColor = vec4(uTurf * 0.35, a * 0.75);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  // Ray from the surface point into the cylinder (we are inside it): far root of |o + t d| = R.
  vec2 o = vLocal.xz;
  vec2 dd = d.xz;
  float A = max(dot(dd, dd), 1e-7);
  float B = dot(o, dd);
  float C = dot(o, o) - uR * uR;
  float t = (-B + sqrt(max(B * B - A * C, 0.0))) / A;
  float depth = -d.y * t;
  vec3 col;
  if (d.y >= -1e-4 || depth > uDepth) {
    // Bottom of the cup.
    float tb = uDepth / max(-d.y, 1e-4);
    vec2 pb = o + dd * tb;
    col = vec3(0.025, 0.022, 0.02) * (1.0 - 0.5 * length(pb) / uR);
  } else {
    vec2 hp = o + dd * t;
    vec3 nWall = normalize(vec3(-hp.x, 0.0, -hp.y));
    // Sun reaches only the upper part of the far wall; the rest is in shadow.
    float sunVis = clamp(1.0 - depth / max(0.002, 2.0 * uR * uSunDir.y / max(length(uSunDir.xz), 0.05)), 0.0, 1.0);
    float lit = max(dot(nWall, uSunDir), 0.0) * sunVis;
    float ao = mix(1.0, 0.18, smoothstep(0.0, uDepth * 0.8, depth));
    vec3 paint = vec3(0.9);
    vec3 soil = vec3(0.16, 0.12, 0.08);
    vec3 liner = vec3(0.55);
    vec3 base = depth < 0.015 ? paint : (depth < 0.026 ? soil : liner * 0.45);
    col = base * (0.12 * ao + 0.8 * lit * uSunColor);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class FlagSet {
  readonly group = new THREE.Group();
  readonly pins: Pin[] = [];
  private sticks!: THREE.InstancedMesh;
  private cupMat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private windYaw = 0;
  private course: Course;
  private flagTex: THREE.Texture;
  private flagGeos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(course: Course, specs: PinSpec[], flagTex: THREE.Texture) {
    this.course = course;
    this.flagTex = flagTex;
    this.group.name = 'pins';
    this.cupMat = new THREE.ShaderMaterial({
      vertexShader: CUP_VERT,
      fragmentShader: CUP_FRAG,
      transparent: true,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -6,
      uniforms: {
        uR: { value: PHYS.cupRadius },
        uDepth: { value: CUP_DEPTH },
        uOuter: { value: CUP_OUTER },
        uSunDir: globalUniforms.uSunDir,
        uSunColor: globalUniforms.uSunColor,
        uTurf: { value: new THREE.Color('#3f6a2a') },
      },
    });
    this.mats.push(this.cupMat);
    // Stick geometry: shaft + coloured band near the top + ferrule tip. Unit height, scaled per pin.
    const stickGeo = buildStickGeometry();
    const stickMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
    this.mats.push(stickMat);
    this.sticks = new THREE.InstancedMesh(stickGeo, stickMat, specs.length);
    this.sticks.name = 'flagsticks';
    this.sticks.castShadow = true;
    this.sticks.receiveShadow = true;
    this.sticks.frustumCulled = false;
    this.group.add(this.sticks);

    specs.forEach((spec, i) => {
      const y = course.height(spec.x, spec.z);
      const base = new THREE.Vector3(spec.x, y, spec.z);
      const height = spec.short ? PRACTICE_PIN_HEIGHT : PIN_HEIGHT;
      const g = new THREE.Group();
      g.position.copy(base);
      g.name = `pin${spec.cell}`;
      this.group.add(g);
      // Cup
      const cup = new THREE.Mesh(this.cupGeometry(spec.x, spec.z, y), this.cupMat);
      cup.renderOrder = 1;
      cup.name = 'cup';
      g.add(cup);
      // Flag
      const amp = { value: 1 };
      let flag: THREE.Mesh | null = null;
      if (!spec.noFlag) {
        const cell = flagCellUV(spec.cell);
        const fg = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 16, 6);
        fg.translate(FLAG_W / 2 + PIN_RADIUS, -FLAG_H / 2, 0);
        const uv = fg.getAttribute('uv') as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, cell[0] + uv.getX(k) * (cell[2] - cell[0]), cell[1] + uv.getY(k) * (cell[3] - cell[1]));
        this.flagGeos.push(fg);
        const fm = flagMaterial(this.flagTex, amp, i * 1.7, cell);
        this.mats.push(fm.mat, fm.depth);
        flag = new THREE.Mesh(fg, fm.mat);
        flag.customDepthMaterial = fm.depth;
        flag.castShadow = true;
        flag.receiveShadow = true;
        flag.frustumCulled = false;
        flag.name = 'flag';
        if (spec.short) flag.scale.setScalar(0.55);
        g.add(flag);
      }
      const pin: Pin = { spec, base, group: g, flag, amp, out: false, yaw: 0, height };
      this.pins.push(pin);
      if (spec.noFlag) this.sticks.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    });
    this.layout();
  }

  /** Disc mesh conforming to the terrain around the cup (local coords relative to the pin base). */
  private cupGeometry(px: number, pz: number, py: number) {
    const rings = [0, PHYS.cupRadius * 0.5, PHYS.cupRadius, PHYS.cupRadius + 0.012, CUP_OUTER];
    const seg = 28;
    const pos: number[] = [];
    const idx: number[] = [];
    pos.push(0, this.course.height(px, pz) - py + 0.003, 0);
    for (let r = 1; r < rings.length; r++) {
      for (let s = 0; s < seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const x = Math.cos(a) * rings[r];
        const z = Math.sin(a) * rings[r];
        pos.push(x, this.course.height(px + x, pz + z) - py + 0.003, z);
      }
    }
    for (let s = 0; s < seg; s++) idx.push(0, 1 + ((s + 1) % seg), 1 + s);
    for (let r = 1; r < rings.length - 1; r++) {
      const a0 = 1 + (r - 1) * seg;
      const b0 = 1 + r * seg;
      for (let s = 0; s < seg; s++) {
        const s1 = (s + 1) % seg;
        idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Write stick instance matrices and flag transforms (call after changing out/yaw). */
  private layout() {
    this.pins.forEach((p, i) => {
      if (p.spec.noFlag) return;
      if (p.out) {
        // Laid on the green beside the hole, pointing away from it.
        const ang = 0.6 + i;
        this.q.setFromEuler(new THREE.Euler(0, ang, -Math.PI / 2 + 0.02, 'YXZ'));
        const dx = Math.cos(ang) * 0.35;
        const dz = -Math.sin(ang) * 0.35;
        const gy = this.course.height(p.base.x + dx, p.base.z + dz);
        this.v.set(p.base.x + dx, gy + PIN_RADIUS + 0.004, p.base.z + dz);
        this.s.set(1, p.height, 1);
        this.m.compose(this.v, this.q, this.s);
        this.sticks.setMatrixAt(i, this.m);
        if (p.flag) {
          // Flag hangs from the top of the lying stick, lying flat-ish on the turf.
          const top = new THREE.Vector3(0, p.height, 0).applyQuaternion(this.q).add(this.v);
          p.flag.position.copy(top).sub(p.base);
          p.flag.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, ang + Math.PI / 2, 0, 'YXZ'));
          p.amp.value = 0.12;
        }
      } else {
        this.v.copy(p.base);
        this.v.y -= 0.06; // seated in the cup's ferrule
        this.q.identity();
        this.s.set(1, p.height + 0.06, 1);
        this.m.compose(this.v, this.q, this.s);
        this.sticks.setMatrixAt(i, this.m);
        if (p.flag) {
          p.flag.position.set(0, p.height - 0.01, 0);
          p.amp.value = 1;
        }
      }
    });
    this.sticks.instanceMatrix.needsUpdate = true;
    this.sticks.computeBoundingSphere();
  }

  setOut(index: number, out: boolean) {
    const p = this.pins[index];
    if (!p || p.out === out) return;
    p.out = out;
    this.layout();
  }

  /** Per-frame: yaw flags downwind (smoothed) with a little gust wobble. */
  update(time: number, dt: number) {
    const wd = globalUniforms.uWindDir.value;
    const target = Math.atan2(-wd.y, wd.x);
    let diff = target - this.windYaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.windYaw += diff * Math.min(1, dt * 1.5);
    const ws = globalUniforms.uWindSpeed.value;
    for (let i = 0; i < this.pins.length; i++) {
      const p = this.pins[i];
      if (!p.flag || p.out) continue;
      const wob = Math.sin(time * (1.3 + ws * 0.12) + i * 2.1) * (0.08 + 0.02 * ws) + Math.sin(time * 0.37 + i) * 0.1;
      p.flag.rotation.set(0, this.windYaw + wob, 0);
    }
  }

  pinTop(index: number) {
    const p = this.pins[index];
    return p.base.clone().setY(p.base.y + p.height);
  }

  dispose() {
    this.sticks.geometry.dispose();
    for (const g of this.flagGeos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const p of this.pins) p.group.traverse((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.dispose());
  }
}

/** Unit-height flagstick (y 0..1) with vertex colours. */
function buildStickGeometry(): THREE.BufferGeometry {
  const parts: { g: THREE.BufferGeometry; c: string }[] = [];
  const add = (r0: number, r1: number, y0: number, y1: number, c: string) => {
    const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, 8, 1, false);
    g.translate(0, (y0 + y1) / 2, 0);
    parts.push({ g, c });
  };
  add(PIN_RADIUS, PIN_RADIUS, 0, 0.8, '#f4f2ec');
  add(PIN_RADIUS, PIN_RADIUS, 0.8, 0.86, FLAG_COLORS.cloth);
  add(PIN_RADIUS, PIN_RADIUS, 0.86, 0.995, '#f4f2ec');
  add(PIN_RADIUS * 1.1, PIN_RADIUS * 0.6, 0.995, 1.0, '#c9a446');
  // The scale is non-uniform (y = height), so the radius stays in metres.
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const { g, c } of parts) {
    const base = pos.length / 3;
    const cc = new THREE.Color(c);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(cc.r, cc.g, cc.b);
    }
    const ix = g.index!;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}
