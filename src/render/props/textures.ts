/**
 * Procedural canvas textures for props: golf-ball dimple normal map, wood grain, ashlar stone,
 * slate roof, straw, crate planks, archery target face, flag and hole-sign atlases.
 * Everything is generated at load time (no image assets). Seeded so results are deterministic.
 */
import * as THREE from 'three';
import { COURSE_NAME, HOLES, type HoleDef } from '../../course/layout';
import { YARD } from '../../config';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb: boolean, repeat = true, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────────── golf ball ─────────────────────────────

/**
 * Equirectangular tangent-space normal map of ~330 spherical dimples (Fibonacci layout),
 * matched to THREE.SphereGeometry's UV convention (u = φ, v = 1 − θ/π).
 */
export function ballNormalMap(w = 512, h = 256, count = 332): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const pts: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - ((i + 0.5) / count) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = golden * i;
    pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
  }
  // Dimple angular radius ≈ 0.55 × mean spacing.
  const spacing = Math.sqrt((4 * Math.PI) / count);
  const dimR = spacing * 0.52;
  // Bucket dimples by latitude band to avoid O(N) per pixel.
  const bands = 32;
  const buckets: number[][] = Array.from({ length: bands }, () => []);
  for (let i = 0; i < count; i++) {
    const th = Math.acos(Math.max(-1, Math.min(1, pts[i * 3 + 1])));
    const b0 = Math.floor(((th - dimR * 1.6) / Math.PI) * bands);
    const b1 = Math.floor(((th + dimR * 1.6) / Math.PI) * bands);
    for (let b = Math.max(0, b0); b <= Math.min(bands - 1, b1); b++) buckets[b].push(i);
  }
  for (let py = 0; py < h; py++) {
    const th = ((py + 0.5) / h) * Math.PI;
    const st = Math.sin(th);
    const ct = Math.cos(th);
    const band = buckets[Math.min(bands - 1, Math.floor((th / Math.PI) * bands))];
    for (let px = 0; px < w; px++) {
      const ph = ((px + 0.5) / w) * Math.PI * 2;
      const cp = Math.cos(ph);
      const sp = Math.sin(ph);
      // Direction, tangent (+u) and bitangent (+v) on the unit sphere.
      const dx = -cp * st;
      const dy = ct;
      const dz = sp * st;
      let best = -2;
      let bi = -1;
      for (const i of band) {
        const dot = dx * pts[i * 3] + dy * pts[i * 3 + 1] + dz * pts[i * 3 + 2];
        if (dot > best) {
          best = dot;
          bi = i;
        }
      }
      let nx = 0;
      let ny = 0;
      const ang = Math.acos(Math.min(1, best));
      if (bi >= 0 && ang < dimR) {
        // Offset from dimple centre in the tangent plane.
        const ox = dx - pts[bi * 3];
        const oy = dy - pts[bi * 3 + 1];
        const oz = dz - pts[bi * 3 + 2];
        const tx = sp * st, ty = 0, tz = cp * st; // +u
        const tl = Math.hypot(tx, tz) || 1;
        const bx = cp * ct, by = st, bz = -sp * ct; // +v
        const u = (ox * tx + oy * ty + oz * tz) / tl;
        const v = ox * bx + oy * by + oz * bz;
        // Concave bowl: normal tilts toward the dimple centre; steeper toward the rim.
        const k = 1.25 * Math.pow(ang / dimR, 0.6) / Math.max(1e-4, ang);
        nx = -u * k * 0.9;
        ny = -v * k * 0.9;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const o = (py * w + px) * 4;
      img.data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false, false, 8);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ───────────────────────────── materials ─────────────────────────────

/** Light wood-grain albedo (multiplied by vertex colour). 1 tile = 1 m. */
export function woodTexture(): THREE.CanvasTexture {
  const W = 256;
  const H = 512;
  const [c, g] = canvas(W, H);
  const r = rng(11);
  g.fillStyle = '#e8e2d8';
  g.fillRect(0, 0, W, H);
  // Board seams every 1/4 width, grain running along v.
  for (let b = 0; b < 4; b++) {
    const x0 = (b * W) / 4;
    const tone = 0.88 + r() * 0.12;
    g.fillStyle = `rgba(${Math.round(232 * tone)},${Math.round(224 * tone)},${Math.round(212 * tone)},1)`;
    g.fillRect(x0, 0, W / 4, H);
    for (let k = 0; k < 26; k++) {
      const x = x0 + r() * (W / 4);
      const amp = 2 + r() * 5;
      const freq = 0.004 + r() * 0.01;
      const ph = r() * 6.28;
      g.strokeStyle = `rgba(90,62,40,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      for (let y = 0; y <= H; y += 8) {
        const xx = x + Math.sin(y * freq + ph) * amp;
        if (y === 0) g.moveTo(xx, y);
        else g.lineTo(xx, y);
      }
      g.stroke();
    }
    // Knots
    for (let k = 0; k < 2; k++) {
      if (r() < 0.5) continue;
      const kx = x0 + 8 + r() * (W / 4 - 16);
      const ky = r() * H;
      const grd = g.createRadialGradient(kx, ky, 0, kx, ky, 7);
      grd.addColorStop(0, 'rgba(70,45,25,0.6)');
      grd.addColorStop(1, 'rgba(70,45,25,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(kx, ky, 5, 9, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(50,35,22,0.45)';
    g.fillRect(x0, 0, 1.5, H);
  }
  return tex(c, true);
}

/** Ashlar/random-coursed stone wall. 1 tile = 2 m. */
export function stoneTexture(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 512;
  const [c, g] = canvas(S, S);
  const [cb, gb] = canvas(S, S);
  const r = rng(23);
  g.fillStyle = '#8e8676';
  g.fillRect(0, 0, S, S);
  gb.fillStyle = '#202020';
  gb.fillRect(0, 0, S, S);
  let y = 0;
  while (y < S) {
    const rowH = 30 + Math.floor(r() * 26);
    const hh = Math.min(rowH, S - y);
    let x = -Math.floor(r() * 60);
    while (x < S) {
      const w = 44 + Math.floor(r() * 70);
      const base = 150 + r() * 50;
      const warm = r() * 18;
      const col = `rgb(${Math.round(base + warm)},${Math.round(base + warm * 0.6 - 4)},${Math.round(base - 14)})`;
      const draw = (ox: number) => {
        g.fillStyle = col;
        roundRect(g, x + ox + 2, y + 2, w - 4, hh - 4, 5);
        g.fill();
        // weathering speckles
        for (let k = 0; k < 18; k++) {
          g.fillStyle = `rgba(${r() < 0.5 ? '60,55,45' : '230,225,210'},${0.05 + r() * 0.1})`;
          g.fillRect(x + ox + 2 + r() * (w - 6), y + 2 + r() * (hh - 6), 2 + r() * 5, 1 + r() * 3);
        }
        const grd = gb.createLinearGradient(0, y, 0, y + hh);
        grd.addColorStop(0, '#d0d0d0');
        grd.addColorStop(0.5, '#f0f0f0');
        grd.addColorStop(1, '#a8a8a8');
        gb.fillStyle = grd;
        roundRect(gb, x + ox + 2, y + 2, w - 4, hh - 4, 5);
        gb.fill();
      };
      draw(0);
      if (x + w > S) draw(-S);
      if (x < 0) draw(S);
      x += w;
    }
    y += rowH;
  }
  return { map: tex(c, true), bump: tex(cb, false) };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Slate roof tiles in staggered courses. 1 tile = 2 m. */
export function slateTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(37);
  g.fillStyle = '#2a2c30';
  g.fillRect(0, 0, S, S);
  const rows = 16;
  const rh = S / rows;
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? 16 : 0;
    for (let x = -off; x < S; x += 32) {
      const b = 70 + r() * 30;
      g.fillStyle = `rgb(${Math.round(b * 0.92)},${Math.round(b * 0.95)},${Math.round(b * 1.05)})`;
      g.fillRect(x + 1, j * rh + 1, 30, rh - 2);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 1, j * rh + rh - 5, 30, 4);
      g.fillStyle = `rgba(150,160,150,${r() * 0.12})`;
      g.fillRect(x + 1, j * rh + 1, 30, rh * 0.5);
    }
  }
  return tex(c, true);
}

/** Subtle mottling for painted surfaces (keeps flat colours from looking CG). 1 tile = 2 m. */
export function grimeTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(51);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 900; k++) {
    const v = 200 + Math.floor(r() * 55);
    g.fillStyle = `rgba(${v},${v},${v - 6},${0.15 + r() * 0.25})`;
    const s = 2 + r() * 14;
    g.beginPath();
    g.arc(r() * S, r() * S, s, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true);
}

/** Straw texture for hay bales (fibres along u). 1 tile = 1 m. */
export function strawTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(61);
  g.fillStyle = '#c9a85a';
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 2600; k++) {
    const x = r() * S;
    const y = r() * S;
    const len = 10 + r() * 30;
    const a = (r() - 0.5) * 0.5;
    const v = r();
    g.strokeStyle = v < 0.3 ? `rgba(130,98,40,${0.4 + r() * 0.4})` : `rgba(${235 + Math.floor(r() * 20)},${205 + Math.floor(r() * 30)},${120 + Math.floor(r() * 40)},${0.4 + r() * 0.5})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  return tex(c, true);
}

/** Crate side: 3 planks with a stencilled stamp. UV 0..1 over one face. */
export function crateTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(71);
  for (let p = 0; p < 3; p++) {
    const t = 0.85 + r() * 0.15;
    g.fillStyle = `rgb(${Math.round(196 * t)},${Math.round(152 * t)},${Math.round(98 * t)})`;
    g.fillRect(0, (p * S) / 3, S, S / 3);
    for (let k = 0; k < 30; k++) {
      g.strokeStyle = `rgba(100,66,34,${0.08 + r() * 0.15})`;
      g.lineWidth = 1;
      const y = (p * S) / 3 + r() * (S / 3);
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 8, S * 0.6, y + (r() - 0.5) * 8, S, y + (r() - 0.5) * 6);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,26,14,0.7)';
    g.fillRect(0, (p * S) / 3, S, 2);
  }
  // Frame
  g.strokeStyle = '#7a5530';
  g.lineWidth = 18;
  g.strokeRect(9, 9, S - 18, S - 18);
  g.strokeStyle = 'rgba(30,18,8,0.6)';
  g.lineWidth = 2;
  g.strokeRect(18, 18, S - 36, S - 36);
  // Nails
  g.fillStyle = '#3a3a3a';
  for (const [x, y] of [[9, 9], [S - 9, 9], [9, S - 9], [S - 9, S - 9]]) {
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  // Stencil
  g.fillStyle = 'rgba(40,28,20,0.55)';
  g.font = 'bold 30px Georgia, serif';
  g.textAlign = 'center';
  g.fillText('THORNBURY', S / 2, S / 2 - 4);
  g.font = 'bold 20px Georgia, serif';
  g.fillText('GREENKEEPING', S / 2, S / 2 + 22);
  return tex(c, true, false);
}

/** Archery-style target face (original palette). UV: disc mapped to 0..1. */
export function targetTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  // Straw boss behind
  g.fillStyle = '#c4a560';
  g.fillRect(0, 0, S, S);
  const rings = ['#f3efe4', '#f3efe4', '#2b3a4a', '#2b3a4a', '#2f7fa8', '#2f7fa8', '#c8452d', '#c8452d', '#f0c23a', '#f0c23a'];
  for (let i = 0; i < rings.length; i++) {
    const rad = (S / 2) * (1 - i / rings.length) * 0.98;
    g.fillStyle = rings[i];
    g.beginPath();
    g.arc(S / 2, S / 2, rad, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = i < 4 && i >= 2 ? 'rgba(240,240,240,0.6)' : 'rgba(20,20,20,0.5)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(S / 2 - 6, S / 2);
  g.lineTo(S / 2 + 6, S / 2);
  g.moveTo(S / 2, S / 2 - 6);
  g.lineTo(S / 2, S / 2 + 6);
  g.stroke();
  return tex(c, true, false);
}

/** Brass gong face: radial hammering + concentric lathe rings. */
export function gongTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(91);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, '#f0c66a');
  grd.addColorStop(0.18, '#a8742a');
  grd.addColorStop(0.22, '#e6b55a');
  grd.addColorStop(0.8, '#d6a24a');
  grd.addColorStop(0.92, '#8a5a20');
  grd.addColorStop(1, '#5a3a14');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 60; k++) {
    const rad = r() * S * 0.48;
    g.strokeStyle = `rgba(${r() < 0.5 ? '90,55,15' : '255,230,160'},${0.05 + r() * 0.1})`;
    g.lineWidth = 1 + r() * 2;
    g.beginPath();
    g.arc(S / 2, S / 2, rad, 0, Math.PI * 2);
    g.stroke();
  }
  for (let k = 0; k < 500; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.46;
    g.fillStyle = `rgba(${r() < 0.5 ? '80,50,10' : '255,235,180'},${0.05 + r() * 0.08})`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 3 + r() * 6, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, true, false);
}

// ───────────────────────────── atlases ─────────────────────────────

export const FLAG_ATLAS_COLS = 4;
export const FLAG_ATLAS_ROWS = 3;

/** Flag colours: claret with a gold hoist stripe; practice flag in sage. */
export const FLAG_COLORS = { cloth: '#8c1f2e', stripe: '#d9a441', text: '#f7f0dc', practice: '#3f6b4f' };

/**
 * Flag atlas: cell i holds hole i+1's flag (cell 9 = practice "P"). Each cell is 2:1.4.
 * The numeral reads correctly on the front face; the shader mirrors u on back faces.
 */
export function flagAtlas(): THREE.CanvasTexture {
  const cw = 256;
  const ch = 180;
  const [c, g] = canvas(cw * FLAG_ATLAS_COLS, ch * FLAG_ATLAS_ROWS);
  const r = rng(81);
  for (let i = 0; i < FLAG_ATLAS_COLS * FLAG_ATLAS_ROWS; i++) {
    const x = (i % FLAG_ATLAS_COLS) * cw;
    const y = Math.floor(i / FLAG_ATLAS_COLS) * ch;
    const practice = i === 9;
    g.fillStyle = practice ? FLAG_COLORS.practice : FLAG_COLORS.cloth;
    g.fillRect(x, y, cw, ch);
    // Woven noise
    for (let k = 0; k < 400; k++) {
      g.fillStyle = `rgba(0,0,0,${r() * 0.05})`;
      g.fillRect(x + r() * cw, y + r() * ch, 2, 2);
    }
    // Hoist stripe and hem
    g.fillStyle = FLAG_COLORS.stripe;
    g.fillRect(x, y, 22, ch);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x + 22, y, 3, ch);
    g.fillRect(x, y + ch - 6, cw, 6);
    g.fillStyle = FLAG_COLORS.text;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 120px Georgia, "Times New Roman", serif';
    const label = i < 9 ? String(i + 1) : i === 9 ? 'P' : '';
    g.fillText(label, x + cw * 0.56, y + ch * 0.54);
  }
  return tex(c, true, false, 8);
}

export function flagCellUV(i: number): [number, number, number, number] {
  const u0 = (i % FLAG_ATLAS_COLS) / FLAG_ATLAS_COLS;
  const v1 = 1 - Math.floor(i / FLAG_ATLAS_COLS) / FLAG_ATLAS_ROWS;
  return [u0, v1 - 1 / FLAG_ATLAS_ROWS, u0 + 1 / FLAG_ATLAS_COLS, v1];
}

export const SIGN_ATLAS_COLS = 3;
export const SIGN_ATLAS_ROWS = 4;
const SIGN_W = 600;
const SIGN_H = 400;

/** Yardage from tee along the fairway line to the pin. */
export function holeYards(h: HoleDef): number {
  const pts = [h.tee, ...h.fairway, h.pin];
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return Math.round(d / YARD);
}

/**
 * Hole-sign atlas: cells 0..8 = tee signs (number, name, par, yards and a plan of the hole),
 * cell 9 = clubhouse name board, cell 10 = "practice green" sign, cell 11 = out-of-bounds plate.
 */
export function signAtlas(): THREE.CanvasTexture {
  const [c, g] = canvas(SIGN_W * SIGN_ATLAS_COLS, SIGN_H * SIGN_ATLAS_ROWS);
  const r = rng(101);
  const board = (x: number, y: number, w: number, h: number) => {
    g.fillStyle = '#1f3b2c';
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 300; k++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.03})`;
      g.fillRect(x + r() * w, y + r() * h, 1 + r() * 40, 1);
    }
    g.strokeStyle = '#d9c79a';
    g.lineWidth = 6;
    g.strokeRect(x + 14, y + 14, w - 28, h - 28);
    g.lineWidth = 1.5;
    g.strokeRect(x + 24, y + 24, w - 48, h - 48);
  };
  HOLES.forEach((h, i) => {
    const x = (i % SIGN_ATLAS_COLS) * SIGN_W;
    const y = Math.floor(i / SIGN_ATLAS_COLS) * SIGN_H;
    board(x, y, SIGN_W, SIGN_H);
    g.fillStyle = '#f2ead2';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = '600 30px Georgia, serif';
    g.fillText('HOLE', x + 48, y + 82);
    g.font = 'bold 150px Georgia, serif';
    g.fillText(String(h.number), x + 40, y + 222);
    g.font = 'italic 32px Georgia, serif';
    g.fillStyle = '#e3c77c';
    g.fillText(h.name, x + 48, y + 274);
    g.fillStyle = '#f2ead2';
    g.font = '600 34px Georgia, serif';
    g.fillText(`PAR ${h.par}`, x + 48, y + 326);
    g.fillText(`${holeYards(h)} YDS`, x + 48, y + 366);
    drawHolePlan(g, h, x + 300, y + 44, 260, 312);
  });
  // Clubhouse name board.
  {
    const x = (9 % SIGN_ATLAS_COLS) * SIGN_W;
    const y = Math.floor(9 / SIGN_ATLAS_COLS) * SIGN_H;
    board(x, y, SIGN_W, SIGN_H);
    g.fillStyle = '#e3c77c';
    g.textAlign = 'center';
    g.font = 'bold 74px Georgia, serif';
    g.fillText(COURSE_NAME.split(' ')[0].toUpperCase(), x + SIGN_W / 2, y + 170);
    g.font = '600 46px Georgia, serif';
    g.fillStyle = '#f2ead2';
    g.fillText('L I N K S', x + SIGN_W / 2, y + 240);
    g.font = 'italic 28px Georgia, serif';
    g.fillText('Clubhouse · Est. 1911', x + SIGN_W / 2, y + 300);
  }
  // Practice green sign.
  {
    const x = (10 % SIGN_ATLAS_COLS) * SIGN_W;
    const y = Math.floor(10 / SIGN_ATLAS_COLS) * SIGN_H;
    board(x, y, SIGN_W, SIGN_H);
    g.fillStyle = '#f2ead2';
    g.textAlign = 'center';
    g.font = 'bold 70px Georgia, serif';
    g.fillText('PRACTICE', x + SIGN_W / 2, y + 170);
    g.fillText('GREEN', x + SIGN_W / 2, y + 250);
    g.font = 'italic 28px Georgia, serif';
    g.fillStyle = '#e3c77c';
    g.fillText('Please repair your pitch marks', x + SIGN_W / 2, y + 315);
  }
  // OB plate.
  {
    const x = (11 % SIGN_ATLAS_COLS) * SIGN_W;
    const y = Math.floor(11 / SIGN_ATLAS_COLS) * SIGN_H;
    g.fillStyle = '#f4f1ea';
    g.fillRect(x, y, SIGN_W, SIGN_H);
    g.fillStyle = '#1d1d1d';
    g.textAlign = 'center';
    g.font = 'bold 90px Arial, sans-serif';
    g.fillText('OUT OF', x + SIGN_W / 2, y + 170);
    g.fillText('BOUNDS', x + SIGN_W / 2, y + 280);
  }
  return tex(c, true, false, 8);
}

export function signCellUV(i: number): [number, number, number, number] {
  const u0 = (i % SIGN_ATLAS_COLS) / SIGN_ATLAS_COLS;
  const v1 = 1 - Math.floor(i / SIGN_ATLAS_COLS) / SIGN_ATLAS_ROWS;
  return [u0, v1 - 1 / SIGN_ATLAS_ROWS, u0 + 1 / SIGN_ATLAS_COLS, v1];
}

/** Draw a plan view of the hole (tee at the bottom, green at the top) into a rectangle. */
function drawHolePlan(g: CanvasRenderingContext2D, h: HoleDef, x: number, y: number, w: number, hgt: number) {
  const dx = h.green.c[0] - h.tee[0];
  const dz = h.green.c[1] - h.tee[1];
  const ang = Math.atan2(dx, -dz); // rotate so tee→green points up
  const ca = Math.cos(-ang);
  const sa = Math.sin(-ang);
  const pts: [number, number][] = [];
  const tr = (p: [number, number]): [number, number] => {
    const px = p[0] - h.tee[0];
    const pz = p[1] - h.tee[1];
    return [px * ca - pz * sa, px * sa + pz * ca];
  };
  const all: [number, number][] = [h.tee, ...h.fairway, h.green.c];
  for (const p of all) pts.push(tr(p));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    minX = Math.min(minX, px - 25);
    maxX = Math.max(maxX, px + 25);
    minY = Math.min(minY, py - 25);
    maxY = Math.max(maxY, py + 25);
  }
  const s = Math.min(w / (maxX - minX), hgt / (maxY - minY));
  const ox = x + w / 2 - ((minX + maxX) / 2) * s;
  const oy = y + hgt / 2 - ((minY + maxY) / 2) * s;
  const map = (p: [number, number]): [number, number] => {
    const q = tr(p);
    return [ox + q[0] * s, oy + q[1] * s];
  };
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(x, y, w, hgt);
  g.beginPath();
  g.rect(x, y, w, hgt);
  g.clip();
  // Fairway
  g.strokeStyle = '#7fae5a';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  h.fairway.forEach((p, i) => {
    const [px, py] = map(p);
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  });
  const gc = map(h.green.c);
  g.lineTo(gc[0], gc[1]);
  g.lineWidth = Math.max(6, (h.width.reduce((a, b) => a + b, 0) / h.width.length) * 2 * s);
  g.stroke();
  // Water
  g.fillStyle = '#4f86b0';
  for (const wd of h.water) for (const b of wd.blobs) {
    const [px, py] = map(b.c);
    g.beginPath();
    g.ellipse(px, py, b.r[0] * s, b.r[1] * s, (b.rot ?? 0) + ang, 0, Math.PI * 2);
    g.fill();
  }
  // Green
  g.fillStyle = '#a6d17a';
  g.beginPath();
  g.ellipse(gc[0], gc[1], h.green.r[0] * s, h.green.r[1] * s, (h.green.rot ?? 0) + ang, 0, Math.PI * 2);
  g.fill();
  // Bunkers
  g.fillStyle = '#efe2b8';
  for (const b of h.bunkers) {
    const [px, py] = map(b.c);
    g.beginPath();
    g.ellipse(px, py, Math.max(3, b.r[0] * s), Math.max(3, b.r[1] * s), (b.rot ?? 0) + ang, 0, Math.PI * 2);
    g.fill();
  }
  // Tee and pin
  const t = map(h.tee);
  g.fillStyle = '#f2ead2';
  g.fillRect(t[0] - 6, t[1] - 8, 12, 16);
  const p = map(h.pin);
  g.strokeStyle = '#f2ead2';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(p[0], p[1]);
  g.lineTo(p[0], p[1] - 22);
  g.stroke();
  g.fillStyle = FLAG_COLORS.cloth;
  g.beginPath();
  g.moveTo(p[0], p[1] - 22);
  g.lineTo(p[0] + 14, p[1] - 17);
  g.lineTo(p[0], p[1] - 12);
  g.fill();
  g.restore();
}

/** Warm-lit interior seen through a window (emissive map). UV 0..1 over the glass. */
export function windowTexture(): THREE.CanvasTexture {
  const W = 128;
  const H = 192;
  const [c, g] = canvas(W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#6b3f18');
  grd.addColorStop(0.35, '#f2b25a');
  grd.addColorStop(0.75, '#ffd28a');
  grd.addColorStop(1, '#8a5524');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // Hanging lamp glow
  const lg = g.createRadialGradient(W * 0.6, H * 0.3, 0, W * 0.6, H * 0.3, W * 0.5);
  lg.addColorStop(0, 'rgba(255,240,200,0.9)');
  lg.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = lg;
  g.fillRect(0, 0, W, H);
  // Curtains
  g.fillStyle = 'rgba(90,20,24,0.85)';
  g.fillRect(0, 0, W * 0.16, H);
  g.fillRect(W * 0.84, 0, W * 0.16, H);
  // Silhouette shelves
  g.fillStyle = 'rgba(60,30,12,0.5)';
  g.fillRect(W * 0.2, H * 0.78, W * 0.6, H * 0.05);
  return tex(c, true, false);
}
