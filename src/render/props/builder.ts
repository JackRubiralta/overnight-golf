/**
 * Geometry helpers for code-modelled props.
 *
 * Props are authored as many small primitives (boxes, cylinders, prisms, lathes) that are
 * vertex-coloured and merged per material into one mesh per "cluster" (a tee box, a green, the
 * clubhouse…). That keeps draw calls low (one per material per visible cluster) while every
 * shape keeps proper normals and metre-scaled UVs for the procedural tiling textures.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Box with UVs in metres (so tiling textures keep a constant texel density). */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; 4 verts each.
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  return g;
}

/** Cylinder with UVs in metres (u around the circumference, v up). */
export function cylGeo(rTop: number, rBot: number, h: number, seg = 12, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

/**
 * Triangular prism (gable roof infill / wedge): triangle in the XY plane with base width w,
 * apex height h above the base, extruded along z by depth d. Origin at the base centre.
 */
export function prismGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  // ExtrudeGeometry UVs are already in shape units (metres).
  return ensureIndexed(g);
}

/** Make a non-indexed geometry indexed (trivial index) so it can merge with indexed ones. */
export function ensureIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.index) return g;
  const n = g.getAttribute('position').count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Compose a matrix from position, Euler rotation (radians, YXZ order) and scale. */
export function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Collects geometry per material key, each piece transformed and vertex-coloured, then merges.
 * A builder can carry a base transform (`push`/`pop`) so sub-assemblies are authored locally.
 */
export class GeoBucket {
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get top() {
    return this.stack[this.stack.length - 1];
  }
  push(m: THREE.Matrix4) {
    this.stack.push(this.top.clone().multiply(m));
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop();
  }

  /** Add a geometry (consumed) with a local matrix and an sRGB colour. */
  add(matKey: string, g: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: THREE.ColorRepresentation) {
    ensureIndexed(g);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    _m.copy(this.top);
    if (m) _m.multiply(m);
    g.applyMatrix4(_m);
    const c = new THREE.Color(color);
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    let list = this.parts.get(matKey);
    if (!list) this.parts.set(matKey, (list = []));
    list.push(g);
  }

  box(matKey: string, w: number, h: number, d: number, m: THREE.Matrix4 | null, color: THREE.ColorRepresentation) {
    this.add(matKey, boxGeo(w, h, d), m, color);
  }
  cyl(matKey: string, rTop: number, rBot: number, h: number, m: THREE.Matrix4 | null, color: THREE.ColorRepresentation, seg = 12) {
    this.add(matKey, cylGeo(rTop, rBot, h, seg), m, color);
  }

  isEmpty() {
    return this.parts.size === 0;
  }

  /** Merge into meshes (one per material). Missing materials are skipped with a warning. */
  build(materials: Record<string, THREE.Material>, opts: { castShadow?: boolean; receiveShadow?: boolean; name?: string } = {}): THREE.Group {
    const group = new THREE.Group();
    group.name = opts.name ?? 'props';
    for (const [key, list] of this.parts) {
      const material = materials[key];
      if (!material) {
        console.warn(`[props] missing material ${key}`);
        continue;
      }
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `${group.name}:${key}`;
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }

  /** Merge one material's parts into a raw geometry (for InstancedMesh templates). */
  takeGeometry(matKey: string): THREE.BufferGeometry | null {
    const list = this.parts.get(matKey);
    if (!list) return null;
    this.parts.delete(matKey);
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    return merged;
  }
}
