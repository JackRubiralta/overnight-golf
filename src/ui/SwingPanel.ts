/**
 * Swing panel (bottom-left): a face-on side view of the golfer drawn from SwingPanelView.
 *
 * Swing-plane coordinates are metres with +x toward the target, y up, ground at 0. The panel
 * draws the TARGET ON THE SCREEN'S LEFT, so +x maps to screen-left (mouse up/right = backswing).
 * Layers (back to front): ground, sweet ring band, arm circle, ghost hand path, current hand path,
 * clubhead speed trail (coloured by speed band), mannequin + club, ball, virtual cursor, readouts.
 */
import type { SwingPanelView, Vec2 } from '../core/view';
import { cfont, fitCanvas, panelScale } from './dom';
import { speedFromMph, speedUnit, type Units } from './format';

// ── tuning ──────────────────────────────────────────────────────────────
const TRAIL_SECONDS = 0.45; // clubhead trail lifetime
const TRAIL_MIN_MPH = 4; // below this the clubhead isn't recorded
const PAD_PX = 10; // panel inner padding
const SCALE_EASE = 6; // 1/s, how fast the view refits when the club changes
const ENVELOPE_SIDE = 0.9; // horizontal fit: fraction of (arm + club) reach either side of the shoulder
const ENVELOPE_TOP = 0.62; // vertical fit above the hands circle: fraction of club length
const BODY = 'rgba(226,231,236,0.92)';
const BODY_FAR = 'rgba(160,170,182,0.9)';
const BODY_EDGE = 'rgba(20,26,30,0.55)';
const SHAFT = 'rgba(205,212,220,0.95)';
const HEAD = 'rgba(70,78,88,1)';
const SWEET_FILL = 'rgba(110,214,140,0.15)';
const SWEET_EDGE = 'rgba(130,230,160,0.55)';
const PATH = 'rgba(150,225,255,0.9)';
const GHOST = 'rgba(255,255,255,0.38)';
/** Speed band colours: slow, good, great, max+. */
const BAND_COL = ['#8fa3b8', '#6fdc8c', '#ffd166', '#ff6b5a'];

interface TrailPt {
  x: number;
  y: number;
  mph: number;
  t: number;
}

export function speedBandIndex(mph: number, bands: [number, number, number]) {
  return mph >= bands[2] ? 3 : mph >= bands[1] ? 2 : mph >= bands[0] ? 1 : 0;
}

export class SwingPanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private trail: TrailPt[] = [];
  private peakMph = 0;
  private lowPoint: { x: number; y: number } | null = null;
  private lowConfirmed = false; // shown once the clubhead has passed and risen again
  private lastPathLen = 0;
  private time = 0;
  private scale = 0; // px per metre (eased)
  private flashT = 0;
  private flashCol = '#ffd166';
  units: Units = 'yards';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tl-panel tl-swing';
    this.canvas = document.createElement('canvas');
    this.el.append(this.canvas);
  }

  /** Brief ring flash (e.g. on a pure strike). */
  flash(color = '#ffd166') {
    this.flashT = 1;
    this.flashCol = color;
  }

  update(v: SwingPanelView, dt: number) {
    this.time += dt;
    this.flashT = Math.max(0, this.flashT - dt * 1.6);
    // New swing (path restarted) → clear trail stats.
    if (v.path.length < this.lastPathLen || (v.path.length <= 1 && this.lastPathLen > 1)) {
      this.trail = [];
      this.peakMph = 0;
      this.lowPoint = null;
      this.lowConfirmed = false;
    }
    this.lastPathLen = v.path.length;
    if (v.speedMph > TRAIL_MIN_MPH) {
      this.trail.push({ x: v.clubhead.x, y: v.clubhead.y, mph: v.speedMph, t: this.time });
      this.peakMph = Math.max(this.peakMph, v.speedMph);
      const prev = this.trail[this.trail.length - 2];
      const forward = prev ? v.clubhead.x > prev.x : false; // downswing / through: moving toward target
      if (!this.lowConfirmed && forward && v.speedMph > v.speedBands[0] * 0.4 && (!this.lowPoint || v.clubhead.y < this.lowPoint.y)) this.lowPoint = { x: v.clubhead.x, y: v.clubhead.y };
      if (this.lowPoint && v.clubhead.x > Math.max(this.lowPoint.x, v.ballX) + 0.05 && v.clubhead.y > this.lowPoint.y + 0.05) this.lowConfirmed = true;
    }
    while (this.trail.length && this.time - this.trail[0].t > TRAIL_SECONDS) this.trail.shift();
    this.draw(v, dt);
  }

  private draw(v: SwingPanelView, dt: number) {
    const f = fitCanvas(this.canvas);
    if (!f) return;
    const { ctx, w, h } = f;
    const u = panelScale(w); // text / marker scale
    const S = v.shoulder;
    // Fit a typical full-swing envelope (hands circle + the club at the top / finish), fixed per
    // club so positions stay spatially stable for muscle memory. Extreme club positions may clip.
    const halfW = Math.max((v.armLen + v.clubLen) * ENVELOPE_SIDE, v.armLen * v.sweetRing[1] + 0.1);
    const top = S.y + v.armLen + v.clubLen * ENVELOPE_TOP;
    const bottom = -0.15;
    const target = Math.min((w - PAD_PX * 2) / (halfW * 2), (h - PAD_PX * 2 - 8) / (top - bottom));
    this.scale = this.scale ? this.scale + (target - this.scale) * Math.min(1, dt * SCALE_EASE) : target;
    const k = this.scale;
    const ox = w / 2;
    const oy = h - PAD_PX - 4 + bottom * k;
    const X = (x: number) => ox - (x - S.x) * k; // +x (target) → screen left
    const Y = (y: number) => oy - y * k;
    const P = (p: Vec2): [number, number] => [X(p.x), Y(p.y)];

    // Ground.
    const gy = Y(0);
    const grd = ctx.createLinearGradient(0, gy, 0, h);
    grd.addColorStop(0, 'rgba(92,140,82,0.55)');
    grd.addColorStop(1, 'rgba(40,64,40,0.0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, gy, w, h - gy);
    ctx.strokeStyle = 'rgba(190,230,170,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(w, gy + 0.5);
    ctx.stroke();

    // Target direction label.
    ctx.font = cfont(600, 9, u);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀ TARGET', 9, 14 * u);

    // Sweet ring (cursor radius band for clean contact).
    const [sx, sy] = P(S);
    const r0 = v.sweetRing[0] * v.armLen * k;
    const r1 = v.sweetRing[1] * v.armLen * k;
    ctx.beginPath();
    ctx.arc(sx, sy, r1, 0, Math.PI * 2);
    ctx.arc(sx, sy, r0, 0, Math.PI * 2, true);
    ctx.fillStyle = SWEET_FILL;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = SWEET_EDGE;
    ctx.beginPath();
    ctx.arc(sx, sy, r0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, r1, 0, Math.PI * 2);
    ctx.stroke();
    if (this.flashT > 0) {
      ctx.save();
      ctx.globalAlpha = this.flashT;
      ctx.strokeStyle = this.flashCol;
      ctx.lineWidth = 2 + 6 * (1 - this.flashT);
      ctx.beginPath();
      ctx.arc(sx, sy, (r0 + r1) / 2 + (1 - this.flashT) * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // Arm circle (hands at full extension).
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(sx, sy, v.armLen * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Thin / fat hints at the top of the band (where the hands rarely are).
    ctx.font = cfont(600, 8, u);
    ctx.textAlign = 'center';
    const lab = (txt: string, rr: number, a: number) => {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(txt, sx + Math.sin(a) * rr, sy + Math.cos(a) * rr);
    };
    lab('THIN', r0 - 8 * u, Math.PI);
    lab('FAT', r1 + 8 * u, Math.PI);

    // Ghost (previous) and current hand paths.
    const poly = (pts: Vec2[], style: string, width: number, dash: number[] = []) => {
      if (pts.length < 2) return;
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    poly(v.ghostPath, GHOST, 2 * u, [5 * u, 4 * u]);
    poly(v.path, PATH, 2 * u);

    // Clubhead speed trail.
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const age = (this.time - b.t) / TRAIL_SECONDS;
      ctx.globalAlpha = Math.max(0, 1 - age) * 0.9;
      ctx.strokeStyle = BAND_COL[speedBandIndex(b.mph, v.speedBands)];
      ctx.lineWidth = (1 + 5 * Math.max(0, 1 - age)) * u;
      ctx.beginPath();
      ctx.moveTo(X(a.x), Y(a.y));
      ctx.lineTo(X(b.x), Y(b.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    this.drawFigure(ctx, v, X, Y, k);

    // Ball (+ tee peg when teed up).
    const br = Math.max(2.6, 0.021335 * k);
    const [bx, by] = [X(v.ballX), Y(v.ballY)];
    if (v.ballY > 0.03) {
      ctx.strokeStyle = 'rgba(240,230,210,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by + br);
      ctx.lineTo(bx, gy + 2);
      ctx.stroke();
    }
    if (!v.practice) {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Low-point marker (lowest clubhead point during this swing).
    if (this.lowPoint && this.lowConfirmed) {
      const lx = X(this.lowPoint.x);
      ctx.fillStyle = this.lowPoint.y < -0.02 ? '#ff8a65' : 'rgba(255,255,255,0.8)'; // orange: bottomed out in the turf
      ctx.beginPath();
      ctx.moveTo(lx, gy + 3);
      ctx.lineTo(lx - 4, gy + 9);
      ctx.lineTo(lx + 4, gy + 9);
      ctx.closePath();
      ctx.fill();
    }

    // Virtual cursor (hand target) + elastic tether to the hands.
    const [cx, cy] = P(v.target);
    const [hx, hy] = P(v.hands);
    const cr = Math.hypot(v.target.x - S.x, v.target.y - S.y) / v.armLen;
    const inBand = cr >= v.sweetRing[0] && cr <= v.sweetRing[1];
    const cc = inBand ? '#7ee2a0' : cr > v.sweetRing[1] ? '#ff9a6b' : '#ffd166';
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulse = v.grabbing ? 0 : Math.sin(this.time * 4) * 1.2;
    ctx.strokeStyle = cc;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, (7 + pulse) * u, 0, Math.PI * 2);
    ctx.stroke();
    if (v.grabbing) {
      ctx.fillStyle = cc;
      ctx.globalAlpha = 0.35;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    const a0 = 4 * u;
    const a1 = 11 * u;
    ctx.moveTo(cx - a1, cy);
    ctx.lineTo(cx - a0, cy);
    ctx.moveTo(cx + a0, cy);
    ctx.lineTo(cx + a1, cy);
    ctx.moveTo(cx, cy - a1);
    ctx.lineTo(cx, cy - a0);
    ctx.moveTo(cx, cy + a0);
    ctx.lineTo(cx, cy + a1);
    ctx.stroke();

    this.drawReadout(ctx, v, w, h, u);
  }

  /** Simple original mannequin: legs, hips, torso, head, two arms meeting at the hands, club. */
  private drawFigure(ctx: CanvasRenderingContext2D, v: SwingPanelView, X: (x: number) => number, Y: (y: number) => number, k: number) {
    const S = v.shoulder;
    const theta = Math.atan2(v.hands.x - S.x, S.y - v.hands.y); // arm angle, + toward target
    const turn = Math.max(-1.25, Math.min(1.25, theta * 0.55)); // shoulder turn (foreshortening)
    const tilt = Math.max(-0.35, Math.min(0.35, -theta * 0.12)); // shoulder line tilt
    const sway = Math.max(-0.05, Math.min(0.06, theta * 0.03)); // hips shift toward the target
    const halfSh = 0.2 * Math.max(0.35, Math.cos(turn));
    // Lead shoulder is on the target (+x) side.
    const lead = { x: S.x + Math.cos(tilt) * halfSh, y: S.y - Math.sin(tilt) * halfSh };
    const trail = { x: S.x - Math.cos(tilt) * halfSh, y: S.y + Math.sin(tilt) * halfSh };
    const hipY = S.y * 0.64;
    const hip = { x: S.x + sway, y: hipY };
    const stanceHalf = 0.24;
    const feet = [
      { x: S.x + stanceHalf, y: 0.03 },
      { x: S.x - stanceHalf, y: 0.03 },
    ];
    const knees = [
      { x: S.x + stanceHalf * 0.8 + sway * 0.6, y: hipY * 0.5 },
      { x: S.x - stanceHalf * 0.8 + sway * 0.3, y: hipY * 0.5 },
    ];
    const limb = (pts: Vec2[], width: number, col: string) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = BODY_EDGE;
      ctx.lineWidth = width * k + 2;
      ctx.beginPath();
      ctx.moveTo(X(pts[0].x), Y(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = width * k;
      ctx.stroke();
    };
    // Legs.
    for (let i = 0; i < 2; i++) limb([{ x: hip.x + (i ? -0.08 : 0.08), y: hip.y }, knees[i], feet[i]], 0.12, i ? BODY_FAR : BODY);
    // Shoes.
    ctx.fillStyle = 'rgba(40,46,54,0.95)';
    for (const f of feet) {
      ctx.beginPath();
      ctx.ellipse(X(f.x), Y(0.025), 0.075 * k, 0.03 * k, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Trail arm (behind the torso).
    limb([trail, v.hands], 0.075, BODY_FAR);
    // Torso (shoulders → hips) as a filled quad with soft edge.
    const hipHalf = 0.14;
    ctx.beginPath();
    ctx.moveTo(X(lead.x), Y(lead.y));
    ctx.lineTo(X(trail.x), Y(trail.y));
    ctx.lineTo(X(hip.x - hipHalf), Y(hip.y));
    ctx.lineTo(X(hip.x + hipHalf), Y(hip.y));
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.1 * k;
    ctx.strokeStyle = BODY_EDGE;
    ctx.stroke();
    ctx.fillStyle = BODY;
    ctx.strokeStyle = BODY;
    ctx.lineWidth = 0.08 * k;
    ctx.stroke();
    ctx.fill();
    // Belt line.
    ctx.strokeStyle = 'rgba(40,50,60,0.6)';
    ctx.lineWidth = Math.max(1, 0.02 * k);
    ctx.beginPath();
    ctx.moveTo(X(hip.x - hipHalf), Y(hip.y + 0.03));
    ctx.lineTo(X(hip.x + hipHalf), Y(hip.y + 0.03));
    ctx.stroke();
    // Head + neck.
    limb([{ x: S.x + sway * 0.3, y: S.y }, { x: S.x + sway * 0.4, y: S.y + 0.12 }], 0.07, BODY);
    ctx.beginPath();
    ctx.arc(X(S.x + sway * 0.5), Y(S.y + 0.22), 0.1 * k, 0, Math.PI * 2);
    ctx.fillStyle = BODY;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = BODY_EDGE;
    ctx.stroke();
    // Cap brim hint.
    ctx.fillStyle = 'rgba(40,46,54,0.9)';
    ctx.beginPath();
    ctx.arc(X(S.x + sway * 0.5), Y(S.y + 0.24), 0.1 * k, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();

    // Club: shaft from the hands to the clubhead, head drawn as a short blade.
    const ch = v.clubhead;
    ctx.strokeStyle = SHAFT;
    ctx.lineWidth = Math.max(1.4, 0.014 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(v.hands.x), Y(v.hands.y));
    ctx.lineTo(X(ch.x), Y(ch.y));
    ctx.stroke();
    const dx = ch.x - v.hands.x;
    const dy = ch.y - v.hands.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    ctx.strokeStyle = HEAD;
    ctx.lineWidth = Math.max(3, 0.045 * k);
    ctx.beginPath();
    ctx.moveTo(X(ch.x - ux * 0.02), Y(ch.y - uy * 0.02));
    ctx.lineTo(X(ch.x + ux * 0.035), Y(ch.y + uy * 0.035));
    ctx.stroke();

    // Lead arm (in front), then the gloved hands.
    limb([lead, v.hands], 0.08, BODY);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(X(v.hands.x), Y(v.hands.y), Math.max(2.5, 0.045 * k), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BODY_EDGE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawReadout(ctx: CanvasRenderingContext2D, v: SwingPanelView, w: number, h: number, u: number) {
    const bands = v.speedBands;
    const cur = BAND_COL[speedBandIndex(v.speedMph, bands)];
    // Speed number (top-right).
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = cfont(700, 20, u);
    ctx.fillStyle = v.speedMph > TRAIL_MIN_MPH ? cur : 'rgba(255,255,255,0.75)';
    ctx.fillText(speedFromMph(v.speedMph, this.units), w - 10, 26 * u);
    ctx.font = cfont(600, 9, u);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`CLUBHEAD ${speedUnit(this.units).toUpperCase()}`, w - 10, 38 * u);
    if (this.peakMph > 0) {
      ctx.fillStyle = BAND_COL[speedBandIndex(this.peakMph, bands)];
      ctx.fillText(`PEAK ${speedFromMph(this.peakMph, this.units)}`, w - 10, 50 * u);
    }
    if (v.practice) {
      ctx.textAlign = 'left';
      ctx.font = cfont(700, 9, u);
      const label = 'PRACTICE SWING';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(255,209,102,0.18)';
      roundRect(ctx, 8, 22 * u, tw + 12 * u, 16 * u, 8 * u);
      ctx.fill();
      ctx.fillStyle = '#ffd166';
      ctx.fillText(label, 8 + 6 * u, 33.5 * u);
    }
    // Speed meter strip along the bottom: zones by speed band, marker at current/peak.
    const mx = 10;
    const mw = w - 20;
    const my = h - 9 * u;
    const max = bands[2] * 1.18;
    const zx = (mph: number) => mx + Math.min(1, mph / max) * mw;
    const zones: [number, number, string][] = [
      [0, bands[0], BAND_COL[0]],
      [bands[0], bands[1], BAND_COL[1]],
      [bands[1], bands[2], BAND_COL[2]],
      [bands[2], max, BAND_COL[3]],
    ];
    for (const [a, b, c] of zones) {
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(zx(a), my, Math.max(0, zx(b) - zx(a) - 1), 3 * u);
    }
    ctx.globalAlpha = 1;
    if (this.peakMph > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(zx(this.peakMph) - u, my - 3 * u, 2 * u, 9 * u);
    }
    ctx.fillStyle = cur;
    ctx.beginPath();
    const px = zx(v.speedMph);
    ctx.moveTo(px, my - u);
    ctx.lineTo(px - 4 * u, my - 7 * u);
    ctx.lineTo(px + 4 * u, my - 7 * u);
    ctx.closePath();
    ctx.fill();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { BAND_COL };
