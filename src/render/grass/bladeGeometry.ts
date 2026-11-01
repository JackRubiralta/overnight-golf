/**
 * Blade geometry for the instanced grass. One *instance* is one grid cell holding `blades`
 * blades; the vertex shader places every blade procedurally (from gl_InstanceID + the per-vertex
 * blade index), so the geometry carries only parametric coordinates:
 *   position.x = side   (-1 / +1 for the two edges of a row, 0 for the tip vertex)
 *   position.y = t      (0 at the root … 1 at the tip, along the blade)
 *   position.z = blade  (index of the blade inside its cell)
 * There are no per-instance attributes at all: the draw is just `instanceCount` copies.
 */
import * as THREE from 'three';

/**
 * @param rows   t values of the two-vertex rows (must start at 0, ascending, < 1); a single
 *               tip vertex at t = 1 closes the blade.
 * @param blades blades per instance (cell)
 */
export function createBladeGeometry(rows: number[], blades: number, instanceCount: number): THREE.InstancedBufferGeometry {
  const vertsPerBlade = rows.length * 2 + 1;
  const pos = new Float32Array(vertsPerBlade * blades * 3);
  const idx: number[] = [];
  for (let b = 0; b < blades; b++) {
    const v0 = b * vertsPerBlade;
    rows.forEach((t, r) => {
      const k = (v0 + r * 2) * 3;
      pos.set([-1, t, b, 1, t, b], k);
    });
    pos.set([0, 1, b], (v0 + rows.length * 2) * 3);
    for (let r = 0; r < rows.length - 1; r++) {
      const a = v0 + r * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = v0 + (rows.length - 1) * 2;
    idx.push(last, last + 1, v0 + rows.length * 2);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.instanceCount = instanceCount;
  // Placement happens on the GPU around the camera; never let three cull or measure it.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));
  return g;
}
