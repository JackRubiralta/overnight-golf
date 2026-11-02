/**
 * Club panel (bottom-right): top-down view at the ball with the aim line pointing up.
 *  - aim line (gold, vertical) and the pin line (dashed, rotated by -aim)
 *  - clubface (solid) rotated by face; ghost face rotated by face + faceDrift while wobble is on
 *  - swing path arrow rotated by path (+ in-to-out = toward the right for a right-hander)
 *  - optional predicted start line
 *  - feet + ball-position ticks showing the stance (-1 back … +1 forward)
 * Angles are drawn exaggerated (ANGLE_GAIN) so a few degrees read clearly; the numeric readouts
 * underneath show the true values.
 */
import type { ClubPanelView } from '../core/view';
import { cfont, fitCanvas, h, panelScale, setText, toggle } from './dom';
import { lr, signed } from './format';

// ── tuning ──────────────────────────────────────────────────────────────
const ANGLE_GAIN = 3;
const MAX_DRAW_DEG = 60;
const FACE_COL = '#ffffff';
const PATH_COL = '#5ec8ff';
const START_COL = '#ffb35c';
const AIM_COL = '#ffd166';

const D = Math.PI / 180;
const ex = (deg: number) => Math.max(-MAX_DRAW_DEG, Math.min(MAX_DRAW_DEG, deg * ANGLE_GAIN)) * D;

export class ClubPanel {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private vals: Record<'face' | 'path' | 'f2p' | 'aim' | 'stance', HTMLElement>;
  private wobbleEl: HTMLElement;
  private time = 0;

  constructor() {
    this.canvas = h('canvas');
    const cell = (label: string, key: keyof ClubPanel['vals']) => {
      const v = h('b', { text: '—' });
      this.vals[key] = v;
      return h('div', { class: 'tl-cp-cell' }, h('span', { text: label }), v);
    };
    this.vals = {} as ClubPanel['vals'];
    this.wobbleEl = h('div', { class: 'tl-cp-wobble', text: 'DRIFT' });
    this.el = h(
      'div',
      { class: 'tl-panel tl-club' },
      this.canvas,
      this.wobbleEl,
      h('div', { class: 'tl-cp-grid' }, cell('Face', 'face'), cell('Path', 'path'), cell('Face→Path', 'f2p'), cell('Aim', 'aim'), cell('Stance', 'stance')),
    );
  }

  update(v: ClubPanelView, dt: number) {
    this.time += dt;
    const ftp = v.face - v.path;
    setText(this.vals.face, lr(v.face, 'open', 'closed'));
    setText(this.vals.path, lr(v.path, 'in-out', 'out-in'));
    setText(this.vals.f2p, `${signed(ftp)}°${Math.abs(ftp) >= 0.5 ? (ftp > 0 ? ' fade' : ' draw') : ''}`);
    setText(this.vals.aim, lr(v.aim, 'R', 'L', 0));
    setText(this.vals.stance, Math.abs(v.stance) < 0.05 ? 'Centre' : `${v.stance > 0 ? 'Fwd' : 'Back'} ${Math.round(Math.abs(v.stance) * 100)}%`);
    toggle(this.wobbleEl, 'on', v.wobble);
    this.draw(v);
  }

  private draw(v: ClubPanelView) {
    const f = fitCanvas(this.canvas);
    if (!f) return;
    const { ctx, w, h: hh } = f;
    const u = panelScale(w * 1.15); // text / marker scale (panel is a bit narrower than the swing panel)
    const bx = w * 0.56;
    const by = hh * 0.6;
    const len = Math.min(w, hh) * 0.5;
    // Direction from the ball at an angle (rad, + = clockwise from up/right of target).
    const dir = (a: number) => ({ x: Math.sin(a), y: -Math.cos(a) });
    const ray = (a: number, r0: number, r1: number) => {
      const d = dir(a);
      ctx.beginPath();
      ctx.moveTo(bx + d.x * r0, by + d.y * r0);
      ctx.lineTo(bx + d.x * r1, by + d.y * r1);
      ctx.stroke();
    };

    // Turf grid backdrop (subtle mowing stripes along the aim line).
    ctx.save();
    for (let i = -6; i <= 6; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(120,170,100,0.06)' : 'rgba(120,170,100,0.025)';
      ctx.fillRect(bx + i * 18 - 9, 0, 18, hh);
    }
    ctx.restore();

    // Pin line (true direction to the pin = -aim in this aim-up frame).
    const pinA = -v.aim * D;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ray(pinA, 12, len * 1.6);
    ctx.setLineDash([]);
    if (Math.abs(v.aim) > 0.05) {
      const d = dir(pinA);
      const fx = bx + d.x * len * 0.92;
      const fy = by + d.y * len * 0.92;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy - 12);
      ctx.stroke();
      ctx.fillStyle = '#ff5f5f';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 12);
      ctx.lineTo(fx + 8, fy - 9);
      ctx.lineTo(fx, fy - 6);
      ctx.fill();
    }
    // Aim line.
    ctx.strokeStyle = AIM_COL;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ray(0, 10, len * 1.6);
    ctx.globalAlpha = 1;
    ctx.font = cfont(700, 8, u);
    ctx.fillStyle = 'rgba(255,209,102,0.75)';
    ctx.textAlign = 'center';
    ctx.textAlign = 'right';
    ctx.fillText('AIM', bx - 5, 12 * u);

    // Start-line hint.
    if (v.startLine !== null) {
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = START_COL;
      ctx.lineWidth = 2;
      ray(ex(v.startLine), 10, len * 1.25);
      ctx.setLineDash([]);
    }

    // Path arrow (through the ball): ghost with drift first.
    const arrow = (a: number, col: string, alpha: number, width: number) => {
      const d = dir(a);
      const x0 = bx - d.x * len * 0.75;
      const y0 = by - d.y * len * 0.75;
      const x1 = bx + d.x * len * 0.7;
      const y1 = by + d.y * len * 0.7;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const nx = -d.y;
      const ny = d.x;
      ctx.beginPath();
      ctx.moveTo(x1 + d.x * 8, y1 + d.y * 8);
      ctx.lineTo(x1 + nx * 5, y1 + ny * 5);
      ctx.lineTo(x1 - nx * 5, y1 - ny * 5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    if (v.wobble && Math.abs(v.pathDrift) > 0.01) arrow(ex(v.path + v.pathDrift), PATH_COL, 0.3, 1.5);
    arrow(ex(v.path), PATH_COL, 0.95, 2.2);

    // Stance: feet to the left of the ball (right-hander, target up) with ball-position ticks.
    const footX = bx - len * 0.62;
    const stanceSpan = len * 0.55; // half distance between feet
    const tickGain = stanceSpan * 0.6; // px per unit of stance on the tick ruler
    const shift = v.stance * tickGain; // feet slide back so the ball sits at the stance tick
    const feetY = by + shift;
    ctx.fillStyle = 'rgba(230,235,240,0.18)';
    ctx.strokeStyle = 'rgba(230,235,240,0.4)';
    ctx.lineWidth = 1;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(footX, feetY + s * stanceSpan, 13, 6, 0.12 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Ticks between the feet: -1 (back) … +1 (forward); forward = toward the lead (upper) foot.
    const tickX = bx - 14;
    for (let i = -2; i <= 2; i++) {
      const st = i / 2;
      const ty = feetY - st * tickGain;
      ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.moveTo(tickX - (i === 0 ? 7 : 4), ty);
      ctx.lineTo(tickX, ty);
      ctx.stroke();
    }
    // Ball-position marker (the ball itself sits on the aim line at by).
    ctx.fillStyle = AIM_COL;
    ctx.beginPath();
    ctx.moveTo(tickX + 2, by);
    ctx.lineTo(tickX + 8, by - 4);
    ctx.lineTo(tickX + 8, by + 4);
    ctx.closePath();
    ctx.fill();

    // Clubface: blade behind the ball, perpendicular to the face direction.
    const face = (a: number, alpha: number, dashed: boolean) => {
      const d = dir(a);
      const nx = -d.y; // along the face (toe → right)
      const ny = d.x;
      const cx = bx - d.x * 9;
      const cy = by - d.y * 9;
      const half = len * 0.32;
      ctx.globalAlpha = alpha;
      // Head body.
      if (!dashed) {
        ctx.fillStyle = 'rgba(60,68,78,0.85)';
        ctx.beginPath();
        ctx.moveTo(cx - nx * half, cy - ny * half);
        ctx.lineTo(cx + nx * half, cy + ny * half);
        ctx.lineTo(cx + nx * half * 0.85 - d.x * 12, cy + ny * half * 0.85 - d.y * 12);
        ctx.lineTo(cx - nx * half * 0.9 - d.x * 9, cy - ny * half * 0.9 - d.y * 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.setLineDash(dashed ? [3, 3] : []);
      ctx.strokeStyle = FACE_COL;
      ctx.lineWidth = dashed ? 1.5 : 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - nx * half, cy - ny * half);
      ctx.lineTo(cx + nx * half, cy + ny * half);
      ctx.stroke();
      ctx.setLineDash([]);
      // Face normal tick.
      if (!dashed) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + d.x * len * 0.42, cy + d.y * len * 0.42);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    if (v.wobble && Math.abs(v.faceDrift) > 0.01) face(ex(v.face + v.faceDrift), 0.45, true);
    face(ex(v.face), 1, false);

    // Ball.
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(bx, by, 5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Legend.
    ctx.font = cfont(600, 8, u);
    ctx.textAlign = 'left';
    const items: [string, string][] = [['FACE', FACE_COL], ['PATH', PATH_COL]];
    if (v.startLine !== null) items.push(['START', START_COL]);
    items.forEach(([t, c], i) => {
      ctx.fillStyle = c;
      ctx.fillRect(8, (9 + i * 11) * u, 8 * u, 2 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(t, 8 + 12 * u, (12 + i * 11) * u);
    });
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText(`angles ×${ANGLE_GAIN}`, w - 8, hh - 6 * u);
  }
}
