/**
 * Procedural golf clubs: driver / fairway wood / hybrid (sculpted deformed-ellipsoid heads with
 * a flat lofted face), iron and wedge (extruded, lofted blades with grooves and a sole bar),
 * putter (milled blade with plumber's neck). Shafts and grips are lathes.
 *
 * Authoring space "H" (head space): origin R = sole point under the face centre (the point the
 * swing model calls "the clubhead"), +x = face normal at zero loft (toward the target at
 * address), +y = up, +z = toward the toe (away from the golfer). The club is authored lying at
 * address on flat ground at its lie angle, then re-expressed in the club bone frame:
 *   Yc = unit(R -> hands centre) (toward the butt), Xc = face direction ⟂ Yc, Zc = Xc × Yc.
 */
import * as THREE from 'three';
import type { ClubKind } from '../../physics/clubs';
import { PartBuilder, cyl, lathe, type Surface } from './geom';

// ---- tuning ---------------------------------------------------------------------------
const DEG = Math.PI / 180;
/** Distance from the butt end to the centre of the two hands (m). */
export const HANDS_FROM_BUTT = 0.1;
const GRIP_LEN = 0.27;

const MAT = {
  crown: { color: 0x16181c, rough: 0.28, metal: 0 } as Surface,
  titanium: { color: 0xbfc3c8, rough: 0.3, metal: 1 } as Surface,
  titaniumDark: { color: 0x8c9096, rough: 0.34, metal: 1 } as Surface,
  accent: { color: 0xc4682e, rough: 0.35, metal: 0.6 } as Surface,
  chrome: { color: 0xd6d9dd, rough: 0.16, metal: 1 } as Surface,
  satin: { color: 0xb3b7bc, rough: 0.38, metal: 1 } as Surface,
  groove: { color: 0x3a3c40, rough: 0.5, metal: 0.8 } as Surface,
  black: { color: 0x141414, rough: 0.45, metal: 0 } as Surface,
  graphite: { color: 0x24272d, rough: 0.25, metal: 0.25 } as Surface,
  steel: { color: 0xd4d7db, rough: 0.14, metal: 1 } as Surface,
  grip: { color: 0x1e1f21, rough: 0.78, metal: 0 } as Surface,
  gripBand: { color: 0x8a1d22, rough: 0.7, metal: 0 } as Surface,
  white: { color: 0xf2f2f0, rough: 0.4, metal: 0 } as Surface,
};

/** Default specs per kind (used when the game passes only a kind + length). */
export const CLUB_SPECS: Record<ClubKind, { lie: number; loft: number; length: number }> = {
  driver: { lie: 58, loft: 10.5, length: 1.15 },
  wood: { lie: 58.5, loft: 15, length: 1.08 },
  hybrid: { lie: 60, loft: 22, length: 1.02 },
  iron: { lie: 62.5, loft: 33, length: 0.94 },
  wedge: { lie: 64, loft: 50, length: 0.895 },
  putter: { lie: 70, loft: 3, length: 0.864 },
};

export const CLUB_KINDS: ClubKind[] = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'];

export interface ClubInfo {
  kind: ClubKind;
  /** Distance clubhead reference point → hands centre (m). */
  handLen: number;
  /** Elevation of the R→hands line above the ground at address (rad) — the effective lie. */
  lie: number;
  length: number;
}

/** Build one club into the builder, bound to `bone`. Returns its geometry metrics. */
export function buildClub(b: PartBuilder, bone: number, kind: ClubKind): ClubInfo {
  const spec = CLUB_SPECS[kind];
  const lie = spec.lie * DEG;
  const loft = spec.loft * DEG;
  const s = new THREE.Vector3(0, Math.sin(lie), -Math.cos(lie)); // shaft dir in H (up toward the golfer)
  const pieces: { g: THREE.BufferGeometry; surf: Surface | ((p: THREE.Vector3, n: THREE.Vector3) => Surface) }[] = [];
  let hosel: THREE.Vector3; // where the shaft leaves the head (on the shaft axis)

  if (kind === 'driver' || kind === 'wood' || kind === 'hybrid') {
    const sc = kind === 'driver' ? 1 : kind === 'wood' ? 0.74 : 0.62;
    const tall = kind === 'driver' ? 1 : kind === 'wood' ? 0.78 : 0.86;
    const head = woodHead(sc, tall, loft, kind === 'hybrid' ? 0.85 : 1);
    pieces.push({ g: head, surf: woodPaint(sc) });
    hosel = new THREE.Vector3(-0.012 * sc, 0.05 * sc * tall, -0.05 * sc);
    // Hosel adaptor (black) along the shaft axis.
    pieces.push({ g: alongAxis(cyl(0.0078, 0.0068, -0.012, 0.045, 12), hosel, s), surf: MAT.black });
    hosel = hosel.clone().addScaledVector(s, 0.045);
  } else if (kind === 'iron' || kind === 'wedge') {
    const tall = kind === 'wedge' ? 1.12 : 1;
    pieces.push(...ironHead(loft, tall, kind === 'wedge'));
    hosel = new THREE.Vector3(-0.004, 0.026 * tall, -0.04);
    pieces.push({ g: alongAxis(cyl(0.0085, 0.0062, -0.02, 0.07, 12), hosel, s), surf: kind === 'wedge' ? MAT.satin : MAT.chrome });
    pieces.push({ g: alongAxis(cyl(0.0064, 0.0062, 0.07, 0.085, 12), hosel, s), surf: MAT.black }); // ferrule
    hosel = hosel.clone().addScaledVector(s, 0.085);
  } else {
    pieces.push(...putterHead(loft));
    hosel = new THREE.Vector3(-0.012, 0.05, -0.036);
    pieces.push({ g: alongAxis(cyl(0.0062, 0.0062, 0, 0.03, 10), hosel, s), surf: MAT.black });
    hosel = hosel.clone().addScaledVector(s, 0.03);
  }

  // Shaft axis meets the ground at G; the club length is measured from there to the butt.
  const ground = hosel.clone().addScaledVector(s, -hosel.y / s.y);
  const butt = ground.clone().addScaledVector(s, spec.length);
  const handsC = butt.clone().addScaledVector(s, -HANDS_FROM_BUTT);
  const shaftLen = butt.distanceTo(hosel);
  const steel = kind === 'iron' || kind === 'wedge' || kind === 'putter';
  // Shaft (tapered) from the hosel to just inside the grip.
  pieces.push({ g: alongAxis(lathe([[0.0043, 0], [0.0052, shaftLen * 0.5], [0.0072, shaftLen - GRIP_LEN + 0.01]], 10), hosel, s), surf: steel ? MAT.steel : MAT.graphite });
  // Grip with a coloured band and an end cap.
  const g0 = shaftLen - GRIP_LEN;
  pieces.push({
    g: alongAxis(lathe([[0.0098, g0], [0.0104, g0 + 0.02], [0.0118, g0 + 0.15], [0.0132, shaftLen - 0.012], [0.0128, shaftLen - 0.002], [0.007, shaftLen], [0.0, shaftLen + 0.0005]], 14), hosel, s),
    surf: MAT.grip,
  });
  pieces.push({ g: alongAxis(cyl(0.0101, 0.0103, g0 + 0.01, g0 + 0.018, 14), hosel, s), surf: MAT.gripBand });

  // Club bone frame expressed in H.
  const yc = handsC.clone().normalize();
  const xc = new THREE.Vector3(1, 0, 0).addScaledVector(yc, -yc.x).normalize();
  const zc = new THREE.Vector3().crossVectors(xc, yc);
  const toLocal = new THREE.Matrix4().makeBasis(xc, yc, zc).invert();
  for (const p of pieces) {
    p.g.applyMatrix4(toLocal);
    if (typeof p.surf === 'function') {
      const paint = p.surf;
      // Paint in H space: transform the probe back from club space.
      const toH = new THREE.Matrix4().makeBasis(xc, yc, zc);
      const nm = new THREE.Matrix3().setFromMatrix4(toH);
      const ph = new THREE.Vector3();
      const nh = new THREE.Vector3();
      b.addPainted(p.g, bone, (pp, nn) => paint(ph.copy(pp).applyMatrix4(toH), nh.copy(nn).applyMatrix3(nm)));
    } else b.add(p.g, bone, p.surf);
  }
  return { kind, handLen: handsC.length(), lie: Math.asin(yc.y), length: spec.length };
}

/** Place a +Y-authored geometry so its +Y runs along `dir` starting at `origin`. */
function alongAxis(g: THREE.BufferGeometry, origin: THREE.Vector3, dir: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(origin, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/**
 * Wood/driver head: an ellipsoid with the face sliced flat (lofted plane) and the sole
 * flattened. Normals are computed analytically so the crown stays perfectly smooth while the
 * face/sole stay flat.
 */
function woodHead(sc: number, tall: number, loft: number, depthScale: number) {
  const g = new THREE.SphereGeometry(1, 40, 22);
  const rx = 0.07 * sc * depthScale;
  const ry = 0.034 * sc * tall;
  const rz = 0.063 * sc;
  const c = new THREE.Vector3(-0.045 * sc * depthScale, 0.032 * sc * tall, 0.004 * sc);
  const nf = new THREE.Vector3(Math.cos(loft), Math.sin(loft), 0); // lofted face normal
  const p0 = new THREE.Vector3(0, 0.03 * sc * tall, 0);
  // Slight face bulge/roll: the face plane bends back a touch toward its edges.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.set(p.x / rx, p.y / ry, p.z / rz).normalize(); // gradient of the ellipsoid
    p.set(c.x + p.x * rx, c.y + p.y * ry, c.z + p.z * rz);
    const roll = 18 * ((p.z / (rz * 0.9)) ** 2 + ((p.y - p0.y) / (ry * 0.9)) ** 2) * 0.0015;
    const d = nf.dot(p.clone().sub(p0)) + roll;
    if (d > 0) {
      p.addScaledVector(nf, -d);
      n.copy(nf);
    }
    if (p.y < 0.0015) {
      p.y = 0.0015;
      if (n.y < 0) n.set(0, -1, 0);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

function woodPaint(sc: number) {
  return (p: THREE.Vector3, n: THREE.Vector3): Surface => {
    if (n.x > 0.8 && p.x > -0.02 * sc) return MAT.titanium; // face
    if (n.y > 0.22) return MAT.crown;
    if (n.y < -0.6) return p.x < -0.075 * sc ? MAT.accent : MAT.titaniumDark; // sole with a weight pad
    return p.x < -0.085 * sc ? MAT.accent : MAT.titaniumDark; // skirt
  };
}

/** Shape (u = toe direction z_H, v = up y_H) → extruded backwards from the face (x_H ≤ 0). */
function extrudeBack(shape: THREE.Shape, depth: number, bevel = 0.0015) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  // shape x → H z, shape y → H y, extrusion z → H -x
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
  g.translate(-bevel, 0, 0);
  return g;
}

/** Lean the geometry back by `loft` about the leading edge (x' = x - y tan(loft)). */
function shearLoft(g: THREE.BufferGeometry, loft: number) {
  const t = Math.tan(loft);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) - pos.getY(i) * t);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

function ironHead(loft: number, tall: number, wedge: boolean) {
  const h = 0.048 * tall;
  const sh = new THREE.Shape();
  sh.moveTo(-0.036, 0.004);
  sh.quadraticCurveTo(-0.034, 0.0, -0.02, 0.0);
  sh.lineTo(0.036, 0.0005);
  sh.quadraticCurveTo(0.052, 0.002, 0.052, 0.02 * tall);
  sh.quadraticCurveTo(0.05, h, 0.03, h * 0.98);
  sh.lineTo(-0.026, 0.03 * tall);
  sh.quadraticCurveTo(-0.034, 0.028 * tall, -0.04, 0.022 * tall);
  sh.quadraticCurveTo(-0.042, 0.01, -0.036, 0.004);
  const surf = wedge ? MAT.satin : MAT.chrome;
  const blade = shearLoft(extrudeBack(sh, wedge ? 0.012 : 0.009), loft);
  // Cavity-back sole bar.
  const bar = new THREE.Shape();
  bar.moveTo(-0.032, 0.001);
  bar.lineTo(0.045, 0.0015);
  bar.quadraticCurveTo(0.05, 0.012, 0.044, 0.02 * tall);
  bar.lineTo(-0.028, 0.016 * tall);
  bar.lineTo(-0.032, 0.001);
  const back = shearLoft(extrudeBack(bar, wedge ? 0.022 : 0.026, 0.002), loft * 0.5);
  const out: { g: THREE.BufferGeometry; surf: Surface }[] = [
    { g: blade, surf },
    { g: back, surf },
  ];
  // Grooves: thin dark strips lying on the lofted face.
  const nGroove = wedge ? 10 : 8;
  for (let i = 0; i < nGroove; i++) {
    const y = 0.006 + i * 0.0036 * tall;
    const gz = new THREE.BoxGeometry(0.0006, 0.0011, 0.05 - i * 0.0009);
    gz.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(-y * Math.tan(loft) + 0.0002, y, 0.006), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), loft), new THREE.Vector3(1, 1, 1)));
    out.push({ g: gz, surf: MAT.groove });
  }
  return out;
}

function putterHead(loft: number) {
  const sh = new THREE.Shape(); // footprint in (u = toe z_H, v = -x_H) → extruded upward
  const w0 = -0.052;
  const w1 = 0.056;
  const d = 0.026;
  const r = 0.008;
  sh.moveTo(w0 + r, 0);
  sh.lineTo(w1 - r, 0);
  sh.quadraticCurveTo(w1, 0, w1, r);
  sh.lineTo(w1, d - r);
  sh.quadraticCurveTo(w1, d, w1 - r, d);
  sh.lineTo(w0 + r, d);
  sh.quadraticCurveTo(w0, d, w0, d - r);
  sh.lineTo(w0, r);
  sh.quadraticCurveTo(w0, 0, w0 + r, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 6 });
  // shape x → H z, shape y → H -x, extrusion → H +y
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
  g.translate(-0.002, 0.002, 0);
  shearLoft(g, loft);
  // Sight line on top + plumber's neck.
  const line = new THREE.BoxGeometry(0.014, 0.0008, 0.0022);
  line.translate(-0.012, 0.0262, 0.002);
  const neck = cyl(0.0045, 0.0045, 0.024, 0.05, 8);
  neck.translate(-0.012, 0, -0.036);
  const bend = new THREE.BoxGeometry(0.009, 0.006, 0.02);
  bend.translate(-0.012, 0.027, -0.03);
  return [
    { g, surf: MAT.satin },
    { g: line, surf: MAT.white },
    { g: neck, surf: MAT.satin },
    { g: bend, surf: MAT.satin },
  ];
}
