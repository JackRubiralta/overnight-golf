/**
 * Course furniture modelled in code: tee markers, hole signs, ball washers, benches, parked
 * carts and the out-of-bounds post-and-rail fence along the world edge. Each assembly writes
 * geometry into a GeoBucket (merged per material per cluster) and registers simple collision
 * primitives so the ball can clatter off them.
 */
import * as THREE from 'three';
import type { Course } from '../../course/Course';
import { HOLES, WORLD_HALF, type HoleDef } from '../../course/layout';
import { GeoBucket, mat } from './builder';
import { Frame, yawToward, type AddCollider } from './frame';
import { signCellUV } from './textures';

/** Tunables */
const TEE_MARKER_COLORS = { back: '#1f2f4f', main: '#b0323a', forward: '#e0b545' };
const OB_LINE = WORLD_HALF - 40; // matches Course.isOOB
const FENCE_OFFSET = 2.5; // fence sits just outside the OB line
const FENCE_SPACING = 4;
const FENCE_CHUNK = 80;
const WASHER_COLOR = '#7c1f2a';
const PAINT_GREEN = '#2c4a33';
const IRON = '#26292a';

export interface TeeLayout {
  dir: [number, number];
  right: [number, number];
}

export function teeLayout(h: HoleDef): TeeLayout {
  const f0 = h.fairway[0];
  const l = Math.hypot(f0[0] - h.tee[0], f0[1] - h.tee[1]) || 1;
  const dir: [number, number] = [(f0[0] - h.tee[0]) / l, (f0[1] - h.tee[1]) / l];
  return { dir, right: [-dir[1], dir[0]] };
}

/** Turned-wood tee marker (ball on a short collar). */
export function teeMarker(b: GeoBucket, x: number, y: number, z: number, color: string) {
  b.cyl('wood', 0.07, 0.085, 0.06, mat(x, y + 0.02, z), '#6b4a2e', 10);
  b.add('gloss', new THREE.SphereGeometry(0.085, 14, 10), mat(x, y + 0.13, z), color);
}

/** Hole sign: two oak posts, a framed painted board (atlas cell) and a little pitched cap. */
export function holeSign(b: GeoBucket, f: Frame, cell: number, col: AddCollider, id: string, ground: (x: number, z: number) => number, scale = 1) {
  const W = 1.2 * scale;
  const H = 0.8 * scale;
  const boardY = 1.05 + (scale - 1) * 0.6;
  b.push(f.matrix);
  for (const sx of [-1, 1]) {
    const p = f.world(sx * (W / 2 + 0.05), 0, 0);
    const gy = ground(p.x, p.z) - f.pos.y;
    const len = boardY + H / 2 + 0.15 - gy + 0.4;
    b.box('wood', 0.1, len, 0.1, mat(sx * (W / 2 + 0.05), gy - 0.4 + len / 2, 0), '#7a5a3a');
    col({ id, kind: 'sign', shape: 'vcyl', center: new THREE.Vector3(p.x, p.y + gy - 0.4, p.z), radius: 0.06, height: len, restitution: 0.45, friction: 0.3 });
  }
  // Frame + backing
  b.box('wood', W + 0.12, H + 0.12, 0.06, mat(0, boardY, -0.01), '#5e4128');
  // Painted face (atlas)
  const face = new THREE.PlaneGeometry(W, H);
  const [u0, v0, u1, v1] = signCellUV(cell);
  const uv = face.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  b.add('sign', face, mat(0, boardY, 0.021), '#ffffff');
  // Cap
  b.box('wood', W + 0.3, 0.05, 0.22, mat(0, boardY + H / 2 + 0.1, 0, -0.25), '#4a3220');
  b.pop();
  col({ id, kind: 'sign', shape: 'box', center: f.world(0, boardY, 0), half: new THREE.Vector3(W / 2 + 0.06, H / 2 + 0.06, 0.04), rot: f.quat.clone(), restitution: 0.45, friction: 0.3 });
}

/** Classic paddle ball washer on a green post with a towel. */
export function ballWasher(b: GeoBucket, f: Frame, col: AddCollider, id: string) {
  b.push(f.matrix);
  b.cyl('paint', 0.035, 0.04, 1.4, mat(0, 0.3, 0), PAINT_GREEN, 10);
  b.box('gloss', 0.22, 0.26, 0.14, mat(0, 1.05, 0), WASHER_COLOR);
  b.cyl('paint', 0.06, 0.06, 0.03, mat(0.115, 1.05, 0, 0, 0, Math.PI / 2), '#d8d2c0', 12);
  b.box('metal', 0.02, 0.28, 0.02, mat(0, 1.31, 0), '#aaaaaa');
  b.box('paint', 0.1, 0.04, 0.04, mat(0, 1.45, 0), '#222222');
  // Towel draped on a hook
  b.box('cloth', 0.02, 0.32, 0.16, mat(-0.13, 0.86, 0, 0, 0, 0.08), '#f1efe6');
  b.box('cloth', 0.021, 0.04, 0.161, mat(-0.13, 0.78, 0, 0, 0, 0.08), WASHER_COLOR);
  b.pop();
  col({ id, kind: 'washer', shape: 'vcyl', center: f.world(0, -0.4, 0), radius: 0.12, height: 1.85, restitution: 0.4, friction: 0.3 });
}

/** Park bench: cast-iron ends and timber slats; front faces local +z. */
export function bench(b: GeoBucket, f: Frame, col: AddCollider, id: string) {
  const L = 1.7;
  b.push(f.matrix);
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.12);
    b.box('iron', 0.05, 0.45, 0.06, mat(x, 0.22, 0.2), IRON);
    b.box('iron', 0.05, 0.85, 0.06, mat(x, 0.42, -0.2, -0.12), IRON);
    b.box('iron', 0.05, 0.05, 0.5, mat(x, 0.44, 0.0), IRON);
    b.box('iron', 0.05, 0.05, 0.45, mat(x, 0.66, 0.04, 0.2), IRON);
    b.box('iron', 0.08, 0.04, 0.5, mat(x, 0.02, 0.0), IRON);
  }
  for (let k = 0; k < 4; k++) b.box('wood', L, 0.035, 0.09, mat(0, 0.47, 0.17 - k * 0.105), '#8a6440');
  for (let k = 0; k < 3; k++) b.box('wood', L, 0.09, 0.03, mat(0, 0.62 + k * 0.12, -0.22 - k * 0.015, -0.12), '#8a6440');
  b.pop();
  col({ id, kind: 'bench', shape: 'box', center: f.world(0, 0.45, 0), half: new THREE.Vector3(L / 2, 0.45, 0.3), rot: f.quat.clone(), restitution: 0.4, friction: 0.35 });
}

/** Parked golf cart; front faces local +z. */
export function cart(b: GeoBucket, f: Frame, col: AddCollider, id: string, body = '#ece8dc', roofCol = '#2c4a33') {
  b.push(f.matrix);
  const wy = 0.22;
  // Wheels + hubs
  for (const sx of [-1, 1]) for (const sz of [-0.82, 0.78]) {
    b.cyl('rubber', 0.22, 0.22, 0.17, mat(sx * 0.56, wy, sz, 0, 0, Math.PI / 2), '#1b1b1b', 16);
    b.cyl('metal', 0.12, 0.12, 0.175, mat(sx * 0.56, wy, sz, 0, 0, Math.PI / 2), '#c8c8c8', 12);
  }
  // Chassis & body
  b.box('paint', 1.0, 0.12, 2.2, mat(0, 0.3, 0), '#2a2a2a');
  b.box('gloss', 1.18, 0.42, 0.7, mat(0, 0.55, 0.85), body); // front cowl
  b.box('gloss', 1.18, 0.12, 0.25, mat(0, 0.8, 1.12, -0.5), body);
  b.box('gloss', 1.2, 0.22, 2.3, mat(0, 0.42, 0), body); // side skirt
  for (const sx of [-1, 1]) b.box('gloss', 0.22, 0.12, 0.62, mat(sx * 0.5, 0.48, 0.8), body); // front fenders
  b.box('paint', 1.05, 0.06, 1.2, mat(0, 0.55, -0.2), '#3a3a3a'); // floor
  // Seat
  b.box('gloss', 1.05, 0.28, 0.6, mat(0, 0.72, -0.3), body);
  b.box('cloth', 1.0, 0.1, 0.55, mat(0, 0.9, -0.3), '#5a3a2a');
  b.box('cloth', 1.0, 0.45, 0.1, mat(0, 1.15, -0.62, -0.12), '#5a3a2a');
  // Steering
  b.cyl('metal', 0.02, 0.02, 0.55, mat(-0.25, 0.95, 0.42, -0.6), '#333333', 6);
  b.add('rubber', new THREE.TorusGeometry(0.17, 0.018, 6, 18), mat(-0.25, 1.17, 0.27, -1.0), '#1b1b1b');
  // Roof posts + canopy
  for (const sx of [-1, 1]) {
    b.box('metal', 0.04, 1.25, 0.04, mat(sx * 0.52, 1.35, 0.62, -0.18), '#bbbbbb');
    b.box('metal', 0.04, 1.2, 0.04, mat(sx * 0.52, 1.3, -0.72), '#bbbbbb');
  }
  b.box('gloss', 1.3, 0.06, 1.9, mat(0, 1.96, -0.05), roofCol);
  b.box('gloss', 1.34, 0.08, 0.06, mat(0, 1.93, 0.9), roofCol);
  // Bag rack with a golf bag and club heads
  b.box('metal', 0.9, 0.05, 0.3, mat(0, 0.85, -1.12), '#9a9a9a');
  b.cyl('cloth', 0.13, 0.13, 0.95, mat(0, 1.25, -1.12, 0.12), '#1f3b5c', 14);
  b.cyl('paint', 0.14, 0.14, 0.12, mat(0, 1.73, -1.06, 0.12), '#d9a441', 14);
  for (let k = 0; k < 5; k++) b.box('metal', 0.08, 0.05, 0.03, mat(-0.06 + (k % 3) * 0.06, 1.85 + (k % 2) * 0.04, -1.03 + Math.floor(k / 3) * 0.06), k === 0 ? '#222222' : '#d0d0d0');
  b.pop();
  col({ id, kind: 'cart', shape: 'box', center: f.world(0, 0.6, 0), half: new THREE.Vector3(0.62, 0.6, 1.2), rot: f.quat.clone(), restitution: 0.45, friction: 0.25 });
  col({ id, kind: 'cart', shape: 'box', center: f.world(0, 1.96, -0.05), half: new THREE.Vector3(0.65, 0.05, 0.95), rot: f.quat.clone(), restitution: 0.4, friction: 0.3 });
}

/** Furniture around one tee: 3 pairs of markers, a sign, a ball washer and a bench. */
export function buildTee(b: GeoBucket, course: Course, h: HoleDef, index: number, col: AddCollider) {
  const { dir, right } = teeLayout(h);
  const g = (x: number, z: number) => course.height(x, z);
  const at = (fwd: number, side: number): [number, number] => [h.tee[0] + dir[0] * fwd + right[0] * side, h.tee[1] + dir[1] * fwd + right[1] * side];
  const pairs: [number, string][] = [[-5, TEE_MARKER_COLORS.back], [0.8, TEE_MARKER_COLORS.main], [9, TEE_MARKER_COLORS.forward]];
  for (const [fwd, c] of pairs) {
    for (const side of [-3.2, 3.2]) {
      const [x, z] = at(fwd, side);
      const y = g(x, z);
      teeMarker(b, x, y, z, c);
      col({ id: `marker${index}`, kind: 'marker', shape: 'sphere', center: new THREE.Vector3(x, y + 0.12, z), radius: 0.09, restitution: 0.5, friction: 0.2 });
    }
  }
  // Sign on the left edge, angled toward the back of the tee so players read it as they arrive.
  {
    const [x, z] = at(2.5, -8.2);
    const face = [-dir[0] * 0.75 + right[0] * 0.66, -dir[1] * 0.75 + right[1] * 0.66];
    const f = new Frame(x, g(x, z), z, yawToward(face[0], face[1]));
    holeSign(b, f, index, col, `sign${index}`, g);
  }
  {
    const [x, z] = at(0.5, -8.6);
    ballWasher(b, new Frame(x, g(x, z), z, yawToward(-dir[0], -dir[1])), col, `washer${index}`);
  }
  {
    const [x, z] = at(-9.5, -5.5);
    bench(b, new Frame(x, g(x, z), z, yawToward(dir[0], dir[1])), col, `bench${index}`);
  }
}

/** Every hole's tee furniture, one bucket (cluster) per tee. */
export function teeClusters(course: Course, col: AddCollider) {
  return HOLES.map((h, i) => {
    const b = new GeoBucket();
    buildTee(b, course, h, i, col);
    return { bucket: b, center: new THREE.Vector3(h.tee[0], course.height(h.tee[0], h.tee[1]), h.tee[1]), radius: 18 };
  });
}

/**
 * Post-and-rail fence just outside the OB line on all four sides, chunked for culling.
 * White stakes every FENCE_SPACING with two rails; every 4th post carries a red-capped OB stake.
 */
export function fenceChunks(course: Course, col: AddCollider, rails: boolean) {
  const L = OB_LINE + FENCE_OFFSET;
  const out: { bucket: GeoBucket; center: THREE.Vector3; radius: number }[] = [];
  const edges: [number, number, number, number][] = [
    [-L, -L, L, -L],
    [L, -L, L, L],
    [L, L, -L, L],
    [-L, L, -L, -L],
  ];
  const tmpQ = new THREE.Quaternion();
  for (const [x0, z0, x1, z1] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    const yaw = yawToward(ux, uz);
    const nChunks = Math.ceil(len / FENCE_CHUNK);
    for (let c = 0; c < nChunks; c++) {
      const b = new GeoBucket();
      const s0 = c * FENCE_CHUNK;
      const s1 = Math.min(len, s0 + FENCE_CHUNK);
      let prev: THREE.Vector3 | null = null;
      for (let s = s0; s <= s1 + 1e-6; s += FENCE_SPACING) {
        const x = x0 + ux * s;
        const z = z0 + uz * s;
        const y = course.height(x, z);
        const ob = Math.round(s / FENCE_SPACING) % 4 === 0;
        b.box('paint', 0.09, 1.5, 0.09, mat(x, y + 0.25, z, 0, yaw), '#efede6');
        if (ob) b.box('paint', 0.095, 0.14, 0.095, mat(x, y + 0.95, z, 0, yaw), '#b3242c');
        col({ id: 'fence', kind: 'fence', shape: 'vcyl', center: new THREE.Vector3(x, y - 0.5, z), radius: 0.06, height: 1.5, restitution: 0.4, friction: 0.3 });
        const cur = new THREE.Vector3(x, y, z);
        if (prev && rails) {
          const dy = cur.y - prev.y;
          const span = Math.hypot(FENCE_SPACING, dy);
          const pitch = Math.atan2(dy, FENCE_SPACING);
          const mx = (x + prev.x) / 2;
          const mz = (z + prev.z) / 2;
          const my = (y + prev.y) / 2;
          for (const ry of [0.45, 0.85]) {
            // Rail along local z (yaw), pitched to follow the ground.
            b.box('paint', 0.04, 0.1, span, mat(mx, my + ry, mz, -pitch, yaw), '#efede6');
          }
          tmpQ.setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
          col({ id: 'fence', kind: 'fence', shape: 'box', center: new THREE.Vector3(mx, my + 0.65, mz), half: new THREE.Vector3(0.03, 0.27, span / 2), rot: tmpQ.clone(), restitution: 0.4, friction: 0.3 });
        }
        prev = cur;
      }
      const sm = (s0 + s1) / 2;
      const cx = x0 + ux * sm;
      const cz = z0 + uz * sm;
      out.push({ bucket: b, center: new THREE.Vector3(cx, course.height(cx, cz), cz), radius: FENCE_CHUNK / 2 + 10 });
    }
  }
  return out;
}
