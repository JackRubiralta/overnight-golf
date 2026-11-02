/**
 * Minimap (top-right): the current hole drawn from src/course/layout.ts, rotated so the tee is at
 * the bottom and the green at the top. Static hole art is cached in an offscreen canvas and only
 * the markers (player, ball, pin) are redrawn each frame.
 */
import { HOLES, type Ellipse, type HoleDef, type P2 } from '../course/layout';
import { h } from './dom';
import { distStr, type Units } from './format';

// ── tuning ──────────────────────────────────────────────────────────────
const MARGIN_M = 22; // world metres of margin around the hole's bounding box
const COL_ROUGH = 'rgba(52,84,46,0.55)';
const COL_FAIRWAY = '#6f9d4f';
const COL_FAIRWAY_EDGE = 'rgba(30,50,25,0.6)';
const COL_GREEN = '#8cc463';
const COL_TEE = '#7aac58';
const COL_SAND = '#e4d3a2';
const COL_WATER = '#4f8fb8';

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private label: HTMLElement;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  private hole: HoleDef | null = null;
  // World → map transform.
  private rot = 0;
  private cx = 0;
  private cz = 0;
  private k = 1;

  constructor() {
    this.canvas = h('canvas');
    this.label = h('div', { class: 'tl-map-label' });
    this.el = h('div', { class: 'tl-panel tl-map' }, this.canvas, this.label);
  }

  /** Map world (x, z) to canvas CSS pixels. */
  private toMap(x: number, z: number, w: number, hh: number): [number, number] {
    const dx = x - this.cx;
    const dz = z - this.cz;
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    // Rotate so the tee→green direction points up (screen -y).
    const rx = dx * c - dz * s;
    const rz = dx * s + dz * c;
    return [w / 2 + rx * this.k, hh / 2 + rz * this.k];
  }

  private layout(hole: HoleDef, w: number, hh: number) {
    const dir: P2 = [hole.pin[0] - hole.tee[0], hole.pin[1] - hole.tee[1]];
    // We want dir to map to (0, -1): rotate by angle so that rotated z of dir is negative.
    this.rot = Math.atan2(dir[0], -dir[1]) * -1;
    // Rotation used in toMap: rx = dx c - dz s; rz = dx s + dz c. Check & fix sign so dir → up.
    const c = Math.cos(this.rot);
    const s = Math.sin(this.rot);
    const rz = dir[0] * s + dir[1] * c;
    if (rz > 0) this.rot += Math.PI;
    const pts: P2[] = [hole.tee, hole.pin, ...hole.fairway];
    const addE = (e: Ellipse) => {
      const r = Math.max(e.r[0], e.r[1]);
      pts.push([e.c[0] - r, e.c[1] - r], [e.c[0] + r, e.c[1] + r], [e.c[0] - r, e.c[1] + r], [e.c[0] + r, e.c[1] - r]);
    };
    addE(hole.green);
    for (const b of hole.bunkers) addE(b);
    for (const wd of hole.water) for (const b of wd.blobs) addE(b);
    // Bounding box in rotated space.
    const cc = Math.cos(this.rot);
    const ss = Math.sin(this.rot);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of pts) {
      const rx = x * cc - z * ss;
      const rzz = x * ss + z * cc;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rzz); maxZ = Math.max(maxZ, rzz);
    }
    minX -= MARGIN_M; maxX += MARGIN_M; minZ -= MARGIN_M; maxZ += MARGIN_M;
    this.k = Math.min(w / (maxX - minX), hh / (maxZ - minZ));
    // Centre (back-rotate the rotated centre to world).
    const mx = (minX + maxX) / 2;
    const mz = (minZ + maxZ) / 2;
    this.cx = mx * cc + mz * ss;
    this.cz = -mx * ss + mz * cc;
  }

  private buildCache(hole: HoleDef, w: number, hh: number, dpr: number) {
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(hh * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const M = (p: P2) => this.toMap(p[0], p[1], w, hh);
    const ellipse = (e: Ellipse, fill: string, stroke?: string) => {
      const [x, y] = M(e.c);
      ctx.beginPath();
      ctx.ellipse(x, y, e.r[0] * this.k, e.r[1] * this.k, (e.rot ?? 0) + this.rot, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    // Rough corridor: a wide soft band along tee → fairway → green.
    const line = [hole.tee, ...hole.fairway, hole.green.c];
    const stroke = (width: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = width;
      ctx.beginPath();
      line.forEach((p, i) => {
        const [x, y] = M(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    stroke(70 * this.k, COL_ROUGH);
    // Fairway: segment by segment with interpolated widths (dark edge first, then fill).
    for (const pass of [0, 1]) {
      for (let i = 0; i < hole.fairway.length; i++) {
        const a = hole.fairway[i];
        const b = hole.fairway[Math.min(i + 1, hole.fairway.length - 1)];
        const wA = hole.width[i] ?? hole.width[hole.width.length - 1];
        const wB = hole.width[Math.min(i + 1, hole.width.length - 1)] ?? wA;
        const [ax, ay] = M(a);
        const [bx, by] = M(b);
        const wd = (wA + wB) * this.k + (pass ? 0 : 2);
        ctx.strokeStyle = pass ? COL_FAIRWAY : COL_FAIRWAY_EDGE;
        ctx.lineWidth = Math.max(2, wd);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    // Water, green, bunkers, tee.
    for (const wd of hole.water) for (const b of wd.blobs) ellipse(b, COL_WATER);
    ellipse({ c: hole.green.c, r: [hole.green.r[0] + 2.5, hole.green.r[1] + 2.5], rot: hole.green.rot }, '#79ad55');
    ellipse(hole.green, COL_GREEN, 'rgba(255,255,255,0.35)');
    for (const b of hole.bunkers) {
      ellipse(b, COL_SAND);
      for (const l of b.lobes ?? []) ellipse(l, COL_SAND);
    }
    const [tx, ty] = M(hole.tee);
    ctx.save();
    ctx.translate(tx, ty);
    ctx.fillStyle = COL_TEE;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    const ts = Math.max(5, 8 * this.k);
    ctx.fillRect(-ts, -ts * 0.7, ts * 2, ts * 1.4);
    ctx.strokeRect(-ts, -ts * 0.7, ts * 2, ts * 1.4);
    ctx.restore();
    return cv;
  }

  update(holeNumber: number, player: { x: number; z: number; yaw: number }, ball: { x: number; z: number }, pin: { x: number; z: number }, distToPin: number, units: Units) {
    const hole = HOLES[holeNumber - 1] ?? HOLES[0];
    const w = this.canvas.clientWidth;
    const hh = this.canvas.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const key = `${hole.number}:${w}x${hh}@${dpr}`;
    if (key !== this.cacheKey || this.hole !== hole) {
      this.hole = hole;
      this.layout(hole, w, hh);
      this.cache = this.buildCache(hole, w, hh, dpr);
      this.cacheKey = key;
      this.label.innerHTML = `<b>${hole.number}</b> ${hole.name}`;
    }
    const bw = Math.round(w * dpr);
    const bh = Math.round(hh * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, bw, bh);
    if (this.cache) ctx.drawImage(this.cache, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const [px, py] = this.toMap(pin.x, pin.z, w, hh);
    const [bx, by] = this.toMap(ball.x, ball.z, w, hh);
    const [ux, uy] = this.toMap(player.x, player.z, w, hh);
    // Ball → pin guide line with the remaining distance.
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 9px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 3;
    const mx = (bx + px) / 2;
    const my = (by + py) / 2;
    ctx.fillText(distStr(distToPin, units), mx + 18, my);
    ctx.shadowBlur = 0;
    // Pin flag.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py - 11);
    ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.moveTo(px, py - 11);
    ctx.lineTo(px + 7, py - 8.5);
    ctx.lineTo(px, py - 6);
    ctx.fill();
    // Ball.
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(bx, by, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Player: arrow along the heading (three.js yaw: forward = (-sin yaw, -cos yaw)).
    const fx = -Math.sin(player.yaw);
    const fz = -Math.cos(player.yaw);
    const [hx, hy] = this.toMap(player.x + fx, player.z + fz, w, hh);
    const a = Math.atan2(hy - uy, hx - ux);
    ctx.save();
    ctx.translate(ux, uy);
    ctx.rotate(a);
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-4, -4.5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-4, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
