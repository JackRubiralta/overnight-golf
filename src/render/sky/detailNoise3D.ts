/**
 * Tiling 3D Worley-fbm texture (single channel) for cloud erosion detail, generated once on the
 * CPU (~60-120 ms for 64³). Feature points are precomputed per cell and octave, so each voxel only
 * does distance tests against its 27 neighbouring cells.
 * Value: 1 at cell centres (billows) → 0 at cell borders.
 */
import * as THREE from 'three';

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** One Worley octave with `cells` cells per axis over the [0,1)³ tile, F1 distance in cell units. */
function worleyOctave(size: number, cells: number, seed: number, out: Float32Array, weight: number) {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let k = 0; k < cells; k++)
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const o = ((k * cells + j) * cells + i) * 3;
        pts[o] = i + hash3(i, j, k, seed);
        pts[o + 1] = j + hash3(i, j, k, seed + 1);
        pts[o + 2] = k + hash3(i, j, k, seed + 2);
      }
  const s = cells / size;
  for (let z = 0; z < size; z++) {
    const pz = (z + 0.5) * s;
    const cz = Math.floor(pz);
    for (let y = 0; y < size; y++) {
      const py = (y + 0.5) * s;
      const cy = Math.floor(py);
      for (let x = 0; x < size; x++) {
        const px = (x + 0.5) * s;
        const cx = Math.floor(px);
        let best = 9;
        for (let dz = -1; dz <= 1; dz++) {
          const kz = cz + dz;
          const wz = ((kz % cells) + cells) % cells;
          const offz = kz - wz;
          for (let dy = -1; dy <= 1; dy++) {
            const ky = cy + dy;
            const wy = ((ky % cells) + cells) % cells;
            const offy = ky - wy;
            for (let dx = -1; dx <= 1; dx++) {
              const kx = cx + dx;
              const wx = ((kx % cells) + cells) % cells;
              const o = ((wz * cells + wy) * cells + wx) * 3;
              const ex = pts[o] + (kx - wx) - px;
              const ey = pts[o + 1] + offy - py;
              const ez = pts[o + 2] + offz - pz;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < best) best = d;
            }
          }
        }
        out[(z * size + y) * size + x] += weight * (1 - Math.min(1, Math.sqrt(best)));
      }
    }
  }
}

export function createDetailNoise3D(size = 64, seed = 11): THREE.Data3DTexture {
  const n = size * size * size;
  const acc = new Float32Array(n);
  worleyOctave(size, 4, seed, acc, 0.625);
  worleyOctave(size, 8, seed + 10, acc, 0.25);
  worleyOctave(size, 16, seed + 20, acc, 0.125);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of acc) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = 255 / Math.max(1e-6, hi - lo);
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (acc[i] - lo) * k;
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
