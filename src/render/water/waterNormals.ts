/**
 * Procedural, perfectly tileable water-ripple slope texture (no image assets).
 *
 * The height field is a sum of sinusoids whose wave vectors are integer multiples of the tile
 * frequency, so it wraps seamlessly. Wave directions are biased toward +u (the "wind" axis of
 * texture space) and amplitudes follow a k^-1.6 falloff, which reads like a small capillary/
 * wind-ripple spectrum. The shader rotates UVs so +u follows the world wind direction.
 *
 * Encoding (RGBA8, repeat-wrapped, mipmapped):
 *   R,G = dh/du, dh/dv  (128 + slope * SLOPE_SCALE)
 *   B   = normalised height (0..255) — used to break up shoreline foam
 *   A   = crest mask (sharpened height) — sun sparkle / foam detail
 */
import * as THREE from 'three';

/** Texture resolution (texels per side). */
const SIZE = 256;
/** Number of sinusoid components. */
const WAVES = 56;
/** Encoded slope range: byte 128 ± 127 ↔ slope ± 127/SLOPE_SCALE. */
export const SLOPE_SCALE = 96;
/** Spectrum: wave numbers (cycles per tile) from KMIN to KMAX. */
const KMIN = 2;
const KMAX = 22;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWaterNormalTexture(seed = 9127): THREE.DataTexture {
  const rnd = mulberry32(seed);
  // Pick integer wave vectors (kx, ky) — biased along +x (wind axis) with ±60° spread.
  const kx = new Float32Array(WAVES);
  const ky = new Float32Array(WAVES);
  const amp = new Float32Array(WAVES);
  const ph = new Float32Array(WAVES);
  for (let i = 0; i < WAVES; i++) {
    const k = KMIN + (KMAX - KMIN) * Math.pow(rnd(), 1.4);
    const spread = (rnd() - 0.5) * 2.1 * (0.6 + 0.4 * rnd());
    let ix = Math.round(Math.cos(spread) * k);
    let iy = Math.round(Math.sin(spread) * k);
    if (ix === 0 && iy === 0) ix = 1;
    kx[i] = ix;
    ky[i] = iy;
    const kk = Math.hypot(ix, iy);
    amp[i] = Math.pow(kk, -1.6) * (0.6 + 0.8 * rnd());
    ph[i] = rnd() * Math.PI * 2;
  }
  const n = SIZE * SIZE;
  const h = new Float32Array(n);
  const du = new Float32Array(n);
  const dv = new Float32Array(n);
  const TAU = Math.PI * 2;
  let hMin = Infinity;
  let hMax = -Infinity;
  let sMax = 0;
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      let hh = 0;
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < WAVES; i++) {
        const a = TAU * (kx[i] * u + ky[i] * v) + ph[i];
        // Slightly peaked waves (trochoid-ish): sin + 0.25 sin(2a) sharpens crests.
        const s = Math.sin(a) + 0.22 * Math.sin(2 * a);
        const c = Math.cos(a) + 0.44 * Math.cos(2 * a);
        hh += amp[i] * s;
        // d/du of amp*sin(a) = amp*cos(a)*TAU*kx (slope per tile; the shader rescales per metre).
        gx += amp[i] * c * kx[i];
        gy += amp[i] * c * ky[i];
      }
      const k = y * SIZE + x;
      h[k] = hh;
      du[k] = gx;
      dv[k] = gy;
      if (hh < hMin) hMin = hh;
      if (hh > hMax) hMax = hh;
      sMax = Math.max(sMax, Math.abs(gx), Math.abs(gy));
    }
  }
  const data = new Uint8Array(n * 4);
  // Normalise slopes so the largest maps to ±1 (shader applies the physical amplitude).
  const sn = 1 / sMax;
  const hr = 1 / (hMax - hMin);
  for (let k = 0; k < n; k++) {
    const enc = (s: number) => Math.max(0, Math.min(255, Math.round(128 + s * sn * 127)));
    data[k * 4] = enc(du[k]);
    data[k * 4 + 1] = enc(dv[k]);
    const hn = (h[k] - hMin) * hr;
    data[k * 4 + 2] = Math.round(hn * 255);
    data[k * 4 + 3] = Math.round(Math.pow(hn, 3) * 255);
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.name = 'water-ripples';
  return tex;
}
