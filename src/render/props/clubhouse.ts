/**
 * The Thornbury clubhouse: a stone ground floor with a jettied, timber-framed upper storey, steep
 * slate gable roofs (main range + front cross-wing), stone chimneys, warm-lit mullioned windows,
 * a timber veranda with lanterns, planters and benches, and steps down from its stone plinth.
 *
 * Local frame: the building front (veranda) faces local +z; y = 0 is the ground-floor level.
 * The plinth extends below the lowest terrain point of the footprint so the building never
 * floats on sloping ground.
 */
import * as THREE from 'three';
import type { Course } from '../../course/Course';
import { GeoBucket, mat, prismGeo } from './builder';
import { Frame, type AddCollider } from './frame';
import { bench, holeSign } from './furniture';

/** Tunables (metres) */
const MAIN_W = 22;
const MAIN_D = 10;
const GF_H = 3.6; // ground floor (stone)
const UF_H = 2.8; // upper floor (timber frame)
const JETTY = 0.25;
const ROOF_OVER = 0.45;
const PITCH = Math.PI / 4.2;
const WING_X0 = 5.5;
const WING_X1 = 12.5;
const WING_Z1 = 8.5;
const VER_X0 = -MAIN_W / 2 - 0.3;
const VER_X1 = WING_X0;
const VER_Z1 = 8.6; // veranda front edge
const STEP_X = -2.75; // centre of the front steps / door
const STEP_W = 2.6;
const STONE = '#c9bfae';
const STONE_DARK = '#b3a893';
const COPING = '#ddd4c4';
const PLASTER = '#eadfc4';
const OAK = '#3d2b1d';
const TRIM = '#f1ede2';
const ROOF = '#a3a8ae';
const DECK = '#8d6a48';
const DOOR = '#4a2a1c';

export interface ClubhouseResult {
  bucket: GeoBucket;
  frame: Frame;
  center: THREE.Vector3;
  radius: number;
}

type WallFace = 'front' | 'back' | 'left' | 'right';
const FACE_YAW: Record<WallFace, number> = { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };

/** Mullioned window facing local +z of its own frame; `stone` adds sill and lintel. */
function windowAt(b: GeoBucket, x: number, y: number, z: number, face: WallFace, w: number, h: number, stone: boolean, panes = 2) {
  b.push(mat(x, y, z, 0, FACE_YAW[face]));
  b.add('glass', new THREE.PlaneGeometry(w, h), mat(0, 0, 0.012), '#ffffff');
  const fz = 0.045;
  const ft = 0.08;
  b.box('paint', w + ft * 2, ft, 0.09, mat(0, h / 2 + ft / 2, fz), TRIM);
  b.box('paint', w + ft * 2, ft, 0.09, mat(0, -h / 2 - ft / 2, fz), TRIM);
  b.box('paint', ft, h, 0.09, mat(-w / 2 - ft / 2, 0, fz), TRIM);
  b.box('paint', ft, h, 0.09, mat(w / 2 + ft / 2, 0, fz), TRIM);
  for (let i = 1; i < panes; i++) b.box('paint', 0.05, h, 0.06, mat(-w / 2 + (i / panes) * w, 0, fz), TRIM);
  b.box('paint', w, 0.045, 0.06, mat(0, h * 0.18, fz), TRIM);
  if (stone) {
    b.box('stone', w + 0.36, 0.1, 0.22, mat(0, -h / 2 - 0.12, 0.08), COPING);
    b.box('stone', w + 0.4, 0.24, 0.12, mat(0, h / 2 + 0.2, 0.04), COPING);
  }
  b.pop();
}

export function buildClubhouse(course: Course, cx: number, cz: number, yaw: number, col: AddCollider): ClubhouseResult {
  // Terrain range under the footprint (incl. veranda).
  const probe = new Frame(cx, 0, cz, yaw);
  let minG = Infinity;
  let maxG = -Infinity;
  const p = new THREE.Vector3();
  for (let lx = -MAIN_W / 2 - 1; lx <= WING_X1 + 1; lx += 1.5) {
    for (let lz = -MAIN_D / 2 - 1; lz <= VER_Z1 + 0.5; lz += 1.5) {
      probe.world(lx, 0, lz, p);
      const h = course.height(p.x, p.z);
      minG = Math.min(minG, h);
      maxG = Math.max(maxG, h);
    }
  }
  const floorY = maxG + 0.35;
  const f = new Frame(cx, floorY, cz, yaw);
  const groundLocal = (lx: number, lz: number) => {
    f.world(lx, 0, lz, p);
    return course.height(p.x, p.z) - floorY;
  };
  const b = new GeoBucket();
  const plinthDepth = floorY - minG + 0.8;
  const box = (id: string, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, rot = f.quat.clone(), restitution = 0.5) =>
    col({ id, kind: 'building', shape: 'box', center: f.world(lx, ly, lz), half: new THREE.Vector3(hx, hy, hz), rot, restitution, friction: 0.25 });

  b.push(f.matrix);

  // ── Plinth: stone podium under the building and the veranda ──
  {
    const x0 = -MAIN_W / 2 - 0.35;
    const x1 = WING_X1 + 0.35;
    const z0 = -MAIN_D / 2 - 0.35;
    const z1 = VER_Z1 + 0.15;
    b.box('stone', x1 - x0, plinthDepth, z1 - z0, mat((x0 + x1) / 2, -plinthDepth / 2, (z0 + z1) / 2), STONE_DARK);
    // Coping band around the top
    b.box('stone', x1 - x0 + 0.1, 0.14, 0.36, mat((x0 + x1) / 2, -0.07, z0 + 0.13), COPING);
    b.box('stone', 0.36, 0.14, z1 - z0 + 0.1, mat(x0 + 0.13, -0.07, (z0 + z1) / 2), COPING);
    b.box('stone', 0.36, 0.14, z1 - z0 + 0.1, mat(x1 - 0.13, -0.07, (z0 + z1) / 2), COPING);
    box('clubhouse', (x0 + x1) / 2, -plinthDepth / 2, (z0 + z1) / 2, (x1 - x0) / 2, plinthDepth / 2, (z1 - z0) / 2);
    // Pilasters and cellar vents break up the podium where the ground falls away.
    const sides: { a: [number, number]; b: [number, number]; n: [number, number]; yaw: number }[] = [
      { a: [x0, z1], b: [x1, z1], n: [0, 1], yaw: 0 },
      { a: [x0, z0], b: [x0, z1], n: [-1, 0], yaw: -Math.PI / 2 },
      { a: [x1, z0], b: [x0, z0], n: [0, -1], yaw: Math.PI },
      { a: [x1, z1], b: [x1, z0], n: [1, 0], yaw: Math.PI / 2 },
    ];
    for (const sd of sides) {
      const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
      const n = Math.max(2, Math.round(len / 3.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = sd.a[0] + (sd.b[0] - sd.a[0]) * t + sd.n[0] * 0.08;
        const z = sd.a[1] + (sd.b[1] - sd.a[1]) * t + sd.n[1] * 0.08;
        const gl = groundLocal(x, z);
        if (gl > -0.5) continue;
        const h = -gl + 0.5;
        b.box('stone', 0.55, h, 0.2, mat(x, -h / 2 - 0.15, z, 0, sd.yaw), COPING);
        // Vent between this pilaster and the next, if the wall is tall enough there.
        if (i < n) {
          const tm = (i + 0.5) / n;
          const vx = sd.a[0] + (sd.b[0] - sd.a[0]) * tm + sd.n[0] * 0.02;
          const vz = sd.a[1] + (sd.b[1] - sd.a[1]) * tm + sd.n[1] * 0.02;
          if (groundLocal(vx, vz) < -1.5) {
            b.box('paint', 0.9, 0.55, 0.06, mat(vx, -0.75, vz, 0, sd.yaw), '#17130f');
            b.box('stone', 1.1, 0.14, 0.12, mat(vx, -0.42, vz, 0, sd.yaw), COPING);
            for (let k = -1; k <= 1; k++) b.box('iron', 0.03, 0.55, 0.05, mat(vx + Math.cos(sd.yaw) * k * 0.25, -0.75, vz - Math.sin(sd.yaw) * k * 0.25, 0, sd.yaw), '#2a2a2a');
          }
        }
      }
    }
  }

  // ── Main range ──
  const ufW = MAIN_W + JETTY * 2;
  const ufD = MAIN_D + JETTY * 2;
  const eaveY = GF_H + UF_H;
  b.box('stone', MAIN_W, GF_H, MAIN_D, mat(0, GF_H / 2, 0), STONE);
  b.box('stone', MAIN_W + 0.12, 0.35, MAIN_D + 0.12, mat(0, 0.17, 0), STONE_DARK); // plinth course
  b.box('paint', ufW, UF_H, ufD, mat(0, GF_H + UF_H / 2, 0), PLASTER);
  b.box('wood', ufW + 0.04, 0.24, ufD + 0.04, mat(0, GF_H + 0.08, 0), OAK);
  timberFrame(b, ufW, ufD, GF_H + 0.2, UF_H - 0.2);
  box('clubhouse', 0, eaveY / 2, 0, ufW / 2, eaveY / 2, ufD / 2);

  // Main roof: two slopes, ridge along x, with gable infills, barge boards and ridge tiles.
  const halfSpan = ufD / 2 + ROOF_OVER;
  const tanP = Math.tan(PITCH);
  const rise = tanP * (ufD / 2);
  const slopeLen = halfSpan / Math.cos(PITCH);
  const roofLen = MAIN_W + ROOF_OVER * 2 + 0.6;
  for (const s of [-1, 1]) {
    const yc = eaveY + rise - (tanP * halfSpan) / 2 + 0.09 / Math.cos(PITCH);
    b.box('roof', roofLen, 0.18, slopeLen, mat(0, yc, (s * halfSpan) / 2, s * PITCH), ROOF);
    box('clubhouse', 0, yc, (s * halfSpan) / 2, roofLen / 2, 0.12, slopeLen / 2, f.rot(s * PITCH, 0, 0));
    // Fascia along the eave
    b.box('wood', roofLen, 0.22, 0.05, mat(0, eaveY + rise - tanP * halfSpan + 0.02, s * (halfSpan + 0.02)), OAK);
  }
  b.box('terracotta', roofLen, 0.2, 0.32, mat(0, eaveY + rise + 0.17, 0), '#7d5a48');
  for (const s of [-1, 1]) {
    b.add('paint', prismGeo(ufD, rise, 0.25), mat(s * (ufW / 2 - 0.12), eaveY, 0, 0, Math.PI / 2), PLASTER);
    for (const t of [-1, 1]) {
      const yc = eaveY + rise - (tanP * halfSpan) / 2 + 0.05;
      b.box('wood', 0.08, 0.3, slopeLen + 0.05, mat(s * (roofLen / 2 + 0.02), yc, (t * halfSpan) / 2, t * PITCH), OAK);
    }
    // Gable timbers + a small attic window
    b.box('wood', 0.07, rise * 0.9, 0.16, mat(s * (ufW / 2 + 0.02), eaveY + rise * 0.45, -1.6), OAK);
    b.box('wood', 0.07, rise * 0.9, 0.16, mat(s * (ufW / 2 + 0.02), eaveY + rise * 0.45, 1.6), OAK);
    b.box('wood', 0.07, 0.16, ufD * 0.62, mat(s * (ufW / 2 + 0.02), eaveY + rise * 0.22, 0), OAK);
    if (s < 0) windowAt(b, s * (ufW / 2 + 0.01), eaveY + rise * 0.48, 0, 'left', 0.9, 1.1, false);
  }
  // Chimneys
  for (const x of [-6.5, 2.8]) {
    const h = rise + 2.3;
    b.box('stone', 1.1, h, 0.8, mat(x, eaveY + h / 2 + 0.2, -0.6), STONE);
    b.box('stone', 1.3, 0.18, 1.0, mat(x, eaveY + h + 0.25, -0.6), COPING);
    for (const dx of [-0.25, 0.25]) b.cyl('terracotta', 0.11, 0.13, 0.45, mat(x + dx, eaveY + h + 0.55, -0.6), '#a5552f', 10);
    box('clubhouse', x, eaveY + h / 2 + 0.2, -0.6, 0.55, h / 2, 0.4);
  }

  // ── Cross wing with a front gable ──
  const wW = WING_X1 - WING_X0;
  const wcx = (WING_X0 + WING_X1) / 2;
  const wz0 = -MAIN_D / 2;
  const wD = WING_Z1 - wz0;
  const wcz = (WING_Z1 + wz0) / 2;
  const wUfW = wW + JETTY * 2;
  b.box('stone', wW, GF_H, wD, mat(wcx, GF_H / 2, wcz), STONE);
  b.box('stone', wW + 0.12, 0.35, wD + 0.12, mat(wcx, 0.17, wcz), STONE_DARK);
  b.box('paint', wUfW, UF_H, wD + JETTY, mat(wcx, GF_H + UF_H / 2, wcz + JETTY / 2), PLASTER);
  b.box('wood', wUfW + 0.04, 0.24, wD + JETTY + 0.04, mat(wcx, GF_H + 0.08, wcz + JETTY / 2), OAK);
  b.push(mat(wcx, 0, WING_Z1 - 0.5 * (WING_Z1 - (ufD / 2)) + JETTY / 2));
  timberFrame(b, wUfW, WING_Z1 - ufD / 2 + JETTY, GF_H + 0.2, UF_H - 0.2, ['front', 'left', 'right']);
  b.pop();
  box('clubhouse', wcx, eaveY / 2, wcz + JETTY / 2, wUfW / 2, eaveY / 2, (wD + JETTY) / 2);
  {
    const wRise = tanP * (wUfW / 2);
    const wHalf = wUfW / 2 + ROOF_OVER;
    const wSlope = wHalf / Math.cos(PITCH);
    const zA = 0.5;
    const zB = WING_Z1 + JETTY + ROOF_OVER;
    const len = zB - zA;
    const zc = (zA + zB) / 2;
    for (const s of [-1, 1]) {
      const yc = eaveY + wRise - (tanP * wHalf) / 2 + 0.09 / Math.cos(PITCH);
      b.box('roof', wSlope, 0.18, len, mat(wcx + (s * wHalf) / 2, yc, zc, 0, 0, -s * PITCH), ROOF);
      box('clubhouse', wcx + (s * wHalf) / 2, yc, zc, wSlope / 2, 0.12, len / 2, f.rot(0, 0, -s * PITCH));
      b.box('wood', 0.3, wSlope + 0.05, 0.08, mat(wcx + (s * wHalf) / 2, eaveY + wRise - (tanP * wHalf) / 2 + 0.05, zB + 0.02, 0, 0, s * (Math.PI / 2 - PITCH)), OAK);
      b.box('wood', 0.05, 0.22, len, mat(wcx + s * (wHalf + 0.02), eaveY + wRise - tanP * wHalf + 0.02, zc), OAK);
    }
    b.box('terracotta', 0.32, 0.2, len, mat(wcx, eaveY + wRise + 0.17, zc), '#7d5a48');
    b.add('paint', prismGeo(wUfW, wRise, 0.25), mat(wcx, eaveY, WING_Z1 + JETTY - 0.12), PLASTER);
    // Gable: king post, collar and a round "oculus" style window
    b.box('wood', 0.16, wRise * 0.9, 0.07, mat(wcx, eaveY + wRise * 0.45, WING_Z1 + JETTY + 0.02), OAK);
    b.box('wood', wUfW * 0.62, 0.16, 0.07, mat(wcx, eaveY + wRise * 0.25, WING_Z1 + JETTY + 0.02), OAK);
    windowAt(b, wcx - 1.15, eaveY + wRise * 0.5, WING_Z1 + JETTY + 0.01, 'front', 0.7, 0.9, false);
    windowAt(b, wcx + 1.15, eaveY + wRise * 0.5, WING_Z1 + JETTY + 0.01, 'front', 0.7, 0.9, false);
  }

  // ── Windows & door ──
  const gy = 1.75; // ground-floor window centre
  const uy = GF_H + 1.45; // upper-floor window centre
  for (const x of [-9.2, -6.2, 0.6, 3.4]) windowAt(b, x, gy, MAIN_D / 2 + 0.005, 'front', 1.3, 2.0, true);
  for (const x of [-9, -5.6, -2.2, 1.4]) windowAt(b, x, uy, ufD / 2 + 0.035, 'front', 1.2, 1.3, false, 3);
  for (const x of [-8.5, -4.5, -0.5, 3.5, 7.5]) {
    windowAt(b, x, gy, -MAIN_D / 2 - 0.005, 'back', 1.2, 1.9, true);
    windowAt(b, x, uy, -ufD / 2 - 0.035, 'back', 1.1, 1.2, false, 3);
  }
  for (const z of [-2.4, 2.4]) windowAt(b, -MAIN_W / 2 - 0.005, gy, z, 'left', 1.2, 1.9, true);
  windowAt(b, -ufW / 2 - 0.035, uy, 0, 'left', 1.6, 1.3, false, 3);
  for (const z of [-2.2, 2.6, 6.6]) {
    windowAt(b, WING_X1 + 0.005, gy, z, 'right', 1.2, 1.9, true);
    windowAt(b, WING_X1 + JETTY + 0.035, uy, z, 'right', 1.1, 1.2, false, 3);
  }
  // Wing front: a wide four-light bay at ground level, two windows above.
  windowAt(b, wcx, gy, WING_Z1 + 0.005, 'front', 3.8, 2.1, true, 4);
  for (const dx of [-1.6, 1.6]) windowAt(b, wcx + dx, uy, WING_Z1 + JETTY + 0.035, 'front', 1.1, 1.2, false, 3);
  // Double door with fanlight
  {
    const z = MAIN_D / 2 + 0.01;
    b.box('wood', 1.9, 2.6, 0.08, mat(STEP_X, 1.3, z), DOOR);
    b.box('wood', 0.04, 2.5, 0.1, mat(STEP_X, 1.3, z + 0.01), '#2c180e');
    for (const dx of [-0.48, 0.48]) for (const dy of [0.7, 1.75]) b.box('wood', 0.62, 0.75, 0.04, mat(STEP_X + dx, dy, z + 0.05), '#5a3424');
    b.box('metal', 0.04, 0.22, 0.05, mat(STEP_X - 0.12, 1.25, z + 0.09), '#c9a446');
    b.box('metal', 0.04, 0.22, 0.05, mat(STEP_X + 0.12, 1.25, z + 0.09), '#c9a446');
    b.add('glass', new THREE.PlaneGeometry(1.8, 0.5), mat(STEP_X, 2.95, z + 0.01), '#ffffff');
    b.box('paint', 2.2, 0.12, 0.12, mat(STEP_X, 2.65, z + 0.04), TRIM);
    b.box('stone', 2.5, 0.3, 0.16, mat(STEP_X, 3.32, z + 0.05), COPING);
  }

  // ── Veranda ──
  {
    const z0 = MAIN_D / 2;
    const depth = VER_Z1 - z0;
    const len = VER_X1 - VER_X0;
    const xc = (VER_X0 + VER_X1) / 2;
    b.box('wood', len, 0.12, depth, mat(xc, -0.03, z0 + depth / 2), DECK);
    const nPosts = 6;
    const postZ = VER_Z1 - 0.2;
    const postH = 2.95;
    for (let i = 0; i < nPosts; i++) {
      const x = VER_X0 + 0.25 + (i / (nPosts - 1)) * (len - 0.5);
      b.box('wood', 0.2, postH, 0.2, mat(x, postH / 2, postZ), '#6e4e32');
      b.box('wood', 0.3, 0.12, 0.3, mat(x, 0.06, postZ), '#5a3e28');
      // Curved brackets
      b.box('wood', 0.08, 0.5, 0.08, mat(x - 0.22, postH - 0.25, postZ, 0, 0, -0.7), '#6e4e32');
      b.box('wood', 0.08, 0.5, 0.08, mat(x + 0.22, postH - 0.25, postZ, 0, 0, 0.7), '#6e4e32');
      col({ id: 'clubhouse', kind: 'building', shape: 'vcyl', center: f.world(x, 0, postZ), radius: 0.12, height: postH, restitution: 0.45, friction: 0.3 });
      if (i > 0 && i < nPosts - 1) {
        // Lantern on the post
        b.box('iron', 0.05, 0.05, 0.2, mat(x, 2.35, postZ + 0.18), '#1e1e1e');
        b.box('lamp', 0.16, 0.24, 0.16, mat(x, 2.2, postZ + 0.3), '#ffffff');
        b.box('iron', 0.22, 0.05, 0.22, mat(x, 2.35, postZ + 0.3), '#1e1e1e');
        b.cyl('iron', 0.01, 0.12, 0.08, mat(x, 2.41, postZ + 0.3), '#1e1e1e', 4);
      }
    }
    b.box('wood', len, 0.26, 0.2, mat(xc, postH + 0.05, postZ), '#6e4e32');
    // Lean-to roof from the wall down to the beam
    const yA = GF_H - 0.08;
    const yB = postH + 0.18;
    const run = VER_Z1 + 0.35 - z0;
    const sl = Math.hypot(run, yA - yB);
    const tilt = Math.atan2(yA - yB, run);
    b.box('roof', len + 0.3, 0.12, sl, mat(xc, (yA + yB) / 2 + 0.06, z0 + run / 2, tilt), ROOF);
    box('clubhouse', xc, (yA + yB) / 2 + 0.06, z0 + run / 2, (len + 0.3) / 2, 0.1, sl / 2, f.rot(tilt, 0, 0));
    b.box('wood', len + 0.3, 0.2, 0.05, mat(xc, yB - 0.02, VER_Z1 + 0.37), OAK);
    // Railing with balusters, leaving the steps open.
    const railZ = VER_Z1 - 0.12;
    const spans: [number, number][] = [[VER_X0 + 0.3, STEP_X - STEP_W / 2], [STEP_X + STEP_W / 2, VER_X1 - 0.2]];
    for (const [a, c] of spans) {
      const w = c - a;
      b.box('wood', w, 0.07, 0.1, mat((a + c) / 2, 0.95, railZ), '#7a5838');
      b.box('wood', w, 0.05, 0.07, mat((a + c) / 2, 0.14, railZ), '#7a5838');
      const n = Math.floor(w / 0.24);
      for (let k = 1; k < n; k++) b.box('wood', 0.045, 0.78, 0.045, mat(a + (k / n) * w, 0.54, railZ), '#7a5838');
      col({ id: 'clubhouse', kind: 'building', shape: 'box', center: f.world((a + c) / 2, 0.5, railZ), half: new THREE.Vector3(w / 2, 0.5, 0.06), rot: f.quat.clone(), restitution: 0.4, friction: 0.3 });
    }
    // Planters with flowers either side of the steps and at the ends
    const flowers = ['#d9475a', '#f0c23a', '#e98a3c', '#c77dd8', '#f4f0e6'];
    for (const x of [STEP_X - STEP_W / 2 - 0.55, STEP_X + STEP_W / 2 + 0.55, VER_X0 + 0.8, VER_X1 - 0.7]) {
      b.box('wood', 0.7, 0.45, 0.5, mat(x, 0.22, VER_Z1 - 0.55), '#5e4128');
      b.box('cloth', 0.62, 0.06, 0.42, mat(x, 0.44, VER_Z1 - 0.55), '#3d2e1f');
      for (let k = 0; k < 9; k++) {
        const fx = x - 0.25 + (k % 3) * 0.25 + ((k * 37) % 7) * 0.01;
        const fz = VER_Z1 - 0.68 + Math.floor(k / 3) * 0.13;
        b.add('cloth', new THREE.IcosahedronGeometry(0.075, 0), mat(fx, 0.55 + (k % 2) * 0.05, fz), k % 4 === 0 ? '#3f6a2a' : flowers[(k + Math.round(x)) % flowers.length]);
      }
    }
  }

  // ── Front steps down to the ground ──
  {
    const gFront = groundLocal(STEP_X, VER_Z1 + 2.5);
    const drop = Math.max(0, -gFront);
    const n = Math.max(1, Math.ceil(drop / 0.17));
    const rStep = drop / n;
    const tread = 0.32;
    for (let i = 1; i <= n; i++) {
      const top = -i * rStep + 0.02;
      const z = VER_Z1 + 0.15 + (i - 0.5) * tread;
      const gl = groundLocal(STEP_X, z);
      const bottom = Math.min(gl, top) - 0.4;
      b.box('stone', STEP_W, top - bottom, tread + 0.02, mat(STEP_X, (top + bottom) / 2, z), i % 2 ? COPING : '#d3cab9');
    }
    // Cheek walls
    const runLen = n * tread;
    for (const s of [-1, 1]) {
      const gl = groundLocal(STEP_X + s * (STEP_W / 2 + 0.2), VER_Z1 + runLen);
      const bottom = Math.min(gl, -drop) - 0.4;
      b.box('stone', 0.36, 0.3 - bottom, runLen + 0.3, mat(STEP_X + s * (STEP_W / 2 + 0.18), (0.3 + bottom) / 2, VER_Z1 + 0.15 + runLen / 2), STONE_DARK);
    }
    if (n > 0) box('clubhouse', STEP_X, -drop / 2, VER_Z1 + 0.15 + runLen / 2, STEP_W / 2 + 0.36, drop / 2 + 0.15, runLen / 2, f.rot(Math.atan2(drop, runLen), 0, 0), 0.55);
  }
  b.pop();

  // Veranda benches (world frames).
  for (const lx of [-8.2, 1.8]) {
    const w = f.world(lx, 0, MAIN_D / 2 + 0.65);
    bench(b, new Frame(w.x, w.y, w.z, f.yaw), col, 'clubhouse-bench');
  }
  // Freestanding name board at the front-left corner, facing the arrival path.
  {
    const w = f.world(-MAIN_W / 2 - 3.5, 0, VER_Z1 + 4);
    const gyw = course.height(w.x, w.z);
    holeSign(b, new Frame(w.x, gyw, w.z, f.yaw - 0.5), 9, col, 'clubhouse-sign', (x, z) => course.height(x, z), 1.8);
  }
  const center = f.world(1, 4, 1.5);
  return { bucket: b, frame: f, center, radius: 20 };
}

/**
 * Oak studs, rails and braces over the plaster of a w×d storey (local, centred at x = z = 0).
 * `faces` limits which sides are framed (the wing's back face is hidden inside the main range).
 */
function timberFrame(b: GeoBucket, w: number, d: number, y0: number, h: number, faces: WallFace[] = ['front', 'back', 'left', 'right']) {
  const defs: Record<WallFace, { len: number; place: (s: number, y: number) => THREE.Matrix4 }> = {
    front: { len: w, place: (s, y) => mat(s, y, d / 2 + 0.03) },
    back: { len: w, place: (s, y) => mat(-s, y, -d / 2 - 0.03, 0, Math.PI) },
    right: { len: d, place: (s, y) => mat(w / 2 + 0.03, y, -s, 0, Math.PI / 2) },
    left: { len: d, place: (s, y) => mat(-w / 2 - 0.03, y, s, 0, -Math.PI / 2) },
  };
  for (const face of faces) {
    const fc = defs[face];
    b.add('wood', new THREE.BoxGeometry(fc.len, 0.16, 0.06), fc.place(0, y0 + h - 0.08), OAK);
    b.add('wood', new THREE.BoxGeometry(fc.len, 0.12, 0.06), fc.place(0, y0 + 0.3), OAK);
    const n = Math.max(2, Math.round(fc.len / 1.7));
    const bay = fc.len / n;
    for (let i = 0; i <= n; i++) {
      const s = -fc.len / 2 + i * bay;
      b.add('wood', new THREE.BoxGeometry(0.15, h, 0.06), fc.place(s, y0 + h / 2), OAK);
    }
    // Herringbone braces under the windows in alternate bays.
    for (let i = 0; i < n; i += 2) {
      const s = -fc.len / 2 + (i + 0.5) * bay;
      for (const side of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.11, Math.hypot(bay, 0.55), 0.05);
        g.rotateZ(side * Math.atan2(bay, 0.55));
        b.add('wood', g, fc.place(s, y0 + 0.58), OAK);
      }
    }
  }
}
