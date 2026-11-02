/**
 * Geometry helpers for the procedural golfer.
 *
 * Every body part / club piece is authored in its own bone-local frame and pushed into a
 * PartBuilder together with a bone index, an albedo colour and (roughness, metalness). The
 * builder merges everything into ONE rigidly-skinned BufferGeometry so the whole golfer + all
 * clubs render with a single draw call (plus one in the shadow pass).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Surface {
  color: THREE.ColorRepresentation;
  rough: number;
  metal?: number;
}

const _c = new THREE.Color();

export class PartBuilder {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a piece bound rigidly to `bone`, transformed by `m` (bone-local placement). */
  add(geo: THREE.BufferGeometry, bone: number, s: Surface, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    _c.set(s.color).convertSRGBToLinear();
    const col = new Float32Array(n * 3);
    const rm = new Float32Array(n * 2);
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      rm[i * 2] = s.rough;
      rm[i * 2 + 1] = s.metal ?? 0;
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts.push(g);
    return g;
  }

  /** Like add() but colour/rm chosen per vertex by a callback (position, normal in bone space). */
  addPainted(geo: THREE.BufferGeometry, bone: number, paint: (p: THREE.Vector3, n: THREE.Vector3) => Surface, m?: THREE.Matrix4) {
    const g = this.add(geo, bone, { color: 0xffffff, rough: 0.5 }, m);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = g.attributes.color as THREE.BufferAttribute;
    const rm = g.attributes.rm as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      // Paint per triangle (centroid) so material boundaries stay crisp.
      p.set(0, 0, 0);
      nn.set(0, 0, 0);
      for (let j = 0; j < 3; j++) {
        p.x += pos.getX(i + j) / 3;
        p.y += pos.getY(i + j) / 3;
        p.z += pos.getZ(i + j) / 3;
        nn.x += nor.getX(i + j);
        nn.y += nor.getY(i + j);
        nn.z += nor.getZ(i + j);
      }
      nn.normalize();
      const s = paint(p, nn);
      _c.set(s.color).convertSRGBToLinear();
      for (let j = 0; j < 3; j++) {
        col.setXYZ(i + j, _c.r, _c.g, _c.b);
        rm.setXY(i + j, s.rough, s.metal ?? 0);
      }
    }
    return g;
  }

  build() {
    const g = mergeGeometries(this.parts, false);
    if (!g) throw new Error('Golfer geometry merge failed');
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return g;
  }
}

// ---------------------------------------------------------------------------------------
// Shape primitives (all along +Y unless noted)
// ---------------------------------------------------------------------------------------

/** Lathe around +Y from a (radius, y) profile; smooth-ish caps when the profile ends at r=0. */
export function lathe(profile: [number, number][], segments = 16) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  return new THREE.LatheGeometry(pts, segments);
}

/**
 * A smooth limb: tapered tube from radius r0 at y=0 to r1 at y=len with hemispherical ends.
 * `bulge` adds a muscle-like swelling at fraction `bulgeAt` along the length.
 */
export function limb(r0: number, r1: number, len: number, segs = 14, bulge = 0, bulgeAt = 0.35) {
  const prof: [number, number][] = [];
  const capN = 4;
  for (let i = 0; i <= capN; i++) {
    const a = (-Math.PI / 2) * (1 - i / capN);
    prof.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  const mid = 6;
  for (let i = 1; i < mid; i++) {
    const t = i / mid;
    const r = r0 + (r1 - r0) * t + bulge * Math.exp(-((t - bulgeAt) ** 2) / 0.05);
    prof.push([r, len * t]);
  }
  for (let i = 0; i <= capN; i++) {
    const a = (Math.PI / 2) * (i / capN);
    prof.push([r1 * Math.cos(a), len + r1 * Math.sin(a)]);
  }
  return lathe(prof, segs);
}

/** Ellipsoid with radii (rx, ry, rz) centred at the origin. */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 16, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

/** Cylinder along +Y from y0 to y1. */
export function cyl(r0: number, r1: number, y0: number, y1: number, segs = 12, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, segs, 1, open);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

export const M = {
  t(x: number, y: number, z: number) {
    return new THREE.Matrix4().makeTranslation(x, y, z);
  },
  /** Compose translation * rotation(euler XYZ) * scale. */
  trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
  },
  s(x: number, y: number, z: number) {
    return new THREE.Matrix4().makeScale(x, y, z);
  },
};
