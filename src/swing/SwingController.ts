/**
 * SwingController: turns player input into a swing.
 *  - A/D face, Q/E path (both live DURING the swing, to fight the drift), Z/C aim,
 *    W/S stance (ball position), Shift = fine, R = square face & path, 1-5/wheel = club.
 *  - Mouse (pointer-locked raw deltas while LMB is held) or the right stick drags the hands.
 *  - The SwingModel simulates the hands + weighted club; on impact we assemble a ClubDelivery.
 */
import { DEG, SURFACES, SWING, type SurfaceId } from '../config';
import { settings } from '../core/settings';
import type { Input } from '../core/Input';
import type { Action } from '../core/actions';
import type { ClubPanelView, SwingPanelView, Vec2 } from '../core/view';
import { CLUBS, clubById, type Club } from '../physics/clubs';
import type { ClubDelivery } from '../physics/impact';
import { SwingModel, type SwingImpact } from './SwingModel';

/** The 5-club bag (keys 1-5). Research: driver, hybrid, iron, wedge, putter. */
export const BAG: Club[] = [clubById('D'), clubById('4H'), clubById('7I'), clubById('SW'), clubById('P')];

/** Metres of hand-target travel per pixel of mouse movement at sensitivity 1. */
const PX_TO_M = 0.0021;
const PUTTER_SCALE = 0.42;
const SIM_DT = 1 / 240;

export interface SwingResult {
  impact: SwingImpact;
  delivery: ClubDelivery;
  practice: boolean;
}

export class SwingController {
  clubIndex = 0;
  face = 0;
  path = 0;
  aim = 0;
  stance = 0;
  faceDrift = 0;
  pathDrift = 0;
  model: SwingModel;
  practice = false;
  teed = false;
  lie: SurfaceId = 'fairway';
  ghostPath: Vec2[] = [];
  /** True between grab and impact/abort. */
  active = false;
  private acc = 0;
  private driftT = 0;
  private driftSeed = Math.random() * 1000;
  private smoothDx = 0;
  private smoothDy = 0;
  private flail = 0;
  /** Elapsed swing time since impact (for the follow-through). */
  sinceImpact = -1;
  /** Whether the last swing actually hit the ball (for auto-reset). */
  private adjustCooldown = 0;
  onAdjust: ((kind: 'face' | 'path' | 'aim' | 'stance' | 'club') => void) | null = null;

  constructor() {
    this.model = new SwingModel(BAG[0], { teed: true });
  }

  get club(): Club {
    return BAG[this.clubIndex];
  }

  /** Prepare for a new shot at a lie. Keeps face/path/aim/stance offsets (they persist between shots, like the original). */
  address(lie: SurfaceId, teed: boolean, suggestedClub?: number) {
    this.lie = lie;
    this.teed = teed;
    if (suggestedClub !== undefined) this.clubIndex = suggestedClub;
    this.rebuildModel();
    this.active = false;
    this.sinceImpact = -1;
    this.faceDrift = 0;
    this.pathDrift = 0;
    this.flail = 0;
  }

  setClub(i: number) {
    if (this.active) return; // can't change clubs mid-swing
    const n = Math.max(0, Math.min(BAG.length - 1, i));
    if (n === this.clubIndex) return;
    this.clubIndex = n;
    this.rebuildModel();
    this.onAdjust?.('club');
  }

  private rebuildModel() {
    this.model = new SwingModel(this.club, { stance: this.stance, teed: this.teed && this.club.kind !== 'putter' });
    this.model.autoReturn = true;
    // Contact tolerance per assist level (research: the original's margin felt too small).
    const a = settings.get('assist');
    this.model.radialGain = a === 'off' ? 0.2 : a === 'light' ? 0.13 : 0.08;
  }

  resetFacePath() {
    this.face = 0;
    this.path = 0;
    this.onAdjust?.('face');
  }

  /** Adjustments from keys. Hold for continuous change; Shift = fine. */
  private adjust(input: Input, dt: number) {
    const fine = settings.get('fineAdjustWithShift') && input.held('fine') ? SWING.fineFactor : 1;
    const hold = (neg: Action, pos: Action) => (input.held(pos) ? 1 : 0) - (input.held(neg) ? 1 : 0);
    const tap = (neg: Action, pos: Action) => (input.pressed(pos) ? 1 : 0) - (input.pressed(neg) ? 1 : 0);
    const f = hold('faceClose', 'faceOpen');
    const p = hold('pathOut', 'pathIn');
    const a = hold('aimLeft', 'aimRight');
    const s = this.active ? 0 : hold('stanceBack', 'stanceForward');
    // A tap gives a precise step; holding ramps continuously.
    const ft = tap('faceClose', 'faceOpen');
    const pt = tap('pathOut', 'pathIn');
    const at = tap('aimLeft', 'aimRight');
    const st = this.active ? 0 : tap('stanceBack', 'stanceForward');
    this.face = clamp(this.face + (f * SWING.faceRate * dt + ft * SWING.faceStep) * fine, -SWING.maxFace, SWING.maxFace);
    this.path = clamp(this.path + (p * SWING.pathRate * dt + pt * SWING.pathStep) * fine, -SWING.maxPath, SWING.maxPath);
    this.aim = clamp(this.aim + (a * SWING.aimRate * dt + at * 1) * fine, -180, 180);
    const ns = clamp(this.stance + (s * SWING.stanceRate * dt * 0.5 + st * SWING.stanceStep) * fine, -1, 1);
    if (ns !== this.stance) {
      this.stance = ns;
      this.model.setStance(this.stance, this.teed && this.club.kind !== 'putter');
    }
    this.adjustCooldown -= dt;
    if ((f || p || a || s) && this.adjustCooldown <= 0) {
      this.onAdjust?.(f ? 'face' : p ? 'path' : a ? 'aim' : 'stance');
      this.adjustCooldown = 0.09;
    }
    if (settings.get('resetKeyEnabled') && input.pressed('resetFacePath')) this.resetFacePath();
    for (let k = 0; k < BAG.length; k++) if (input.pressed(`club${k + 1}` as Action)) this.setClub(k);
    if (input.pressed('clubNext')) this.setClub((this.clubIndex + 1) % BAG.length);
    if (input.pressed('clubPrev')) this.setClub((this.clubIndex + BAG.length - 1) % BAG.length);
  }

  private assistScale() {
    const a = settings.get('assist');
    return a === 'off' ? 1 : a === 'light' ? 0.45 : 0;
  }

  /** Smooth, visible drift (sum of sines + seeded phase), only while swinging. */
  private updateDrift(dt: number) {
    const k = this.assistScale();
    if (!this.active || k === 0) {
      this.faceDrift *= Math.max(0, 1 - dt * 3);
      this.pathDrift *= Math.max(0, 1 - dt * 3);
      return;
    }
    this.driftT += dt;
    const t = this.driftT + this.driftSeed;
    // Amplitude grows a little with hand speed (fast hands = harder to hold the face square).
    const hs = Math.hypot(this.model.handsVel.x, this.model.handsVel.y);
    const amp = (1 + Math.min(1.2, hs / 8)) * k;
    const putt = this.club.kind === 'putter' ? 0.35 : 1;
    this.faceDrift = putt * amp * 2.0 * (0.6 * Math.sin(t * 2.1) + 0.4 * Math.sin(t * 4.7 + 1.3));
    this.pathDrift = putt * amp * 1.5 * (0.55 * Math.sin(t * 1.6 + 2.2) + 0.45 * Math.sin(t * 3.9 + 0.4));
  }

  /**
   * Update from input. Returns a SwingResult when the club reaches the ball.
   * @param allowSwing false while the ball is not ready (e.g. flight).
   */
  update(input: Input, dt: number, allowSwing = true): SwingResult | null {
    this.adjust(input, dt);
    const m = this.model;
    const grab = allowSwing && input.held('swingGrab');
    if (grab && !m.grabbing) {
      // Fresh grab: begin a swing (the original lets you grab the hands at any time).
      if (!this.active) {
        if (this.sinceImpact >= 0) this.rebuildModel();
        this.active = true;
        this.sinceImpact = -1;
        this.driftSeed = Math.random() * 1000;
        this.driftT = 0;
        this.flail = 0;
      }
    }
    m.grabbing = grab;

    // Mouse → hand target.
    const d = input.consumeSwingDelta();
    const sens = settings.get('mouseSensitivity') * PX_TO_M * (this.club.kind === 'putter' ? PUTTER_SCALE : 1);
    const sm = clamp(settings.get('mouseSmoothing'), 0, 0.9);
    // Exponential smoothing that preserves the total distance moved.
    this.smoothDx += d.dx;
    this.smoothDy += d.dy;
    const take = 1 - sm;
    const ux = this.smoothDx * take;
    const uy = this.smoothDy * take;
    this.smoothDx -= ux;
    this.smoothDy -= uy;
    // Face-on panel: target is on the screen's RIGHT. Mouse left/up → hands back/up (backswing);
    // swiftly down (and right) → downswing. The movement is spread evenly over the physics
    // sub-steps of this frame so the hand target moves smoothly.
    let dragX = 0;
    let dragY = 0;
    if (grab) {
      const sx = settings.get('invertSwingX') ? -1 : 1;
      const sy = settings.get('invertSwingY') ? 1 : -1;
      dragX = ux * sens * sx;
      dragY = uy * sens * sy;
    } else {
      this.smoothDx = this.smoothDy = 0;
    }
    // Gamepad right stick: absolute hand position. Pull down = backswing, push up = through.
    const pad = settings.get('gamepadEnabled') ? input.padHands : null;
    if (allowSwing && pad && Math.hypot(pad.x, pad.y) > 0.12) {
      if (!this.active) {
        this.active = true;
        this.sinceImpact = -1;
        this.driftT = 0;
      }
      m.grabbing = true;
      const mag = Math.min(1, Math.hypot(pad.x, pad.y));
      const th = clamp(-pad.y, -1, 1) * (this.club.kind === 'putter' ? 35 : 118) * DEG;
      const rho = m.geo.armLen * (0.99 + 0.045 * Math.max(0, mag - 0.9) / 0.1);
      const tx = m.geo.shoulder.x + Math.sin(th) * rho;
      const ty = m.geo.shoulder.y - Math.cos(th) * rho;
      m.drag(tx - m.cursor.x, ty - m.cursor.y);
    }

    this.updateDrift(dt);

    // Fixed-step simulation.
    let result: SwingResult | null = null;
    this.acc += Math.min(dt, 0.1);
    const steps = Math.max(1, Math.floor(this.acc / SIM_DT));
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      if (dragX || dragY) m.drag(dragX / steps, dragY / steps);
      const imp = m.step(SIM_DT, !this.practice);
      if (m.armed) {
        const hs = Math.hypot(m.handsVel.x, m.handsVel.y);
        if (hs > 10.5) this.flail += (hs - 10.5) * SIM_DT * 2.5;
      }
      if (imp && !result) result = this.buildResult(imp);
    }
    if (this.sinceImpact >= 0) this.sinceImpact += dt;
    // End of swing: once released after impact (or released without a real swing), reset.
    if (this.active && !m.grabbing && !m.armed && this.sinceImpact < 0) {
      // Let the hands auto-return; swing not committed yet.
      if (Math.hypot(m.hands.x - m.geo.shoulder.x, m.hands.y - (m.geo.shoulder.y - m.geo.armLen)) < 0.02) this.active = false;
    }
    if (this.active && m.armed && !m.grabbing && !m.impacted) {
      // Released mid-swing: the club keeps going under its own momentum; we just wait for impact or a stop.
      if (Math.hypot(m.handsVel.x, m.handsVel.y) < 0.05 && Math.abs(m.phiVel) < 0.2) {
        this.active = false;
        this.rebuildModel();
      }
    }
    if (this.sinceImpact > 1.4 && !m.grabbing) {
      this.active = false;
      this.ghostPath = m.path.slice();
      this.sinceImpact = -1;
      this.rebuildModel();
    }
    return result;
  }

  private buildResult(imp: SwingImpact): SwingResult {
    const club = this.club;
    this.sinceImpact = 0;
    const rnd = gaussian;
    // Erratic input → off-centre strikes; flailing hands → face twist.
    const k = this.assistScale();
    const rough = Math.min(3, imp.roughness);
    const strikeH = rnd() * (3 + rough * 7) + rnd() * this.flail * 6;
    const flailFace = rnd() * this.flail * 4 * Math.max(0.3, k);
    const lieTwist = SURFACES[this.lie].lieTwist;
    const faceAngle = this.face + this.faceDrift + flailFace;
    const path = this.path + this.pathDrift;
    const loftBias: Record<string, number> = { driver: 3, wood: 1.5, hybrid: 0.5, iron: -1, wedge: -2, putter: 0 };
    let dynamicLoft = club.loft + (loftBias[club.kind] ?? 0) - imp.shaftLean * 0.8 + Math.max(0, this.face) * 0.3 - this.stance * 3;
    if (club.kind === 'putter') dynamicLoft = club.loft - imp.shaftLean * 0.5;
    dynamicLoft = clamp(dynamicLoft, -5, 75);
    const fat = clamp(imp.fatDepth / 0.03, 0, 1);
    let strikeV = imp.strikeV;
    if (club.kind === 'putter') strikeV = clamp(strikeV, -8, 8);
    const delivery: ClubDelivery = {
      club,
      clubSpeed: imp.whiff ? 0 : imp.clubSpeed,
      faceAngle,
      path,
      attackAngle: club.kind === 'putter' ? clamp(imp.attackAngle, -4, 6) : imp.attackAngle,
      dynamicLoft,
      strikeH: club.kind === 'putter' ? strikeH * 0.4 : strikeH,
      strikeV,
      fat: this.lie === 'sand' ? fat * 0.25 : fat, // splashing through sand is intended
      lie: this.lie,
    };
    void lieTwist;
    return { impact: imp, delivery, practice: this.practice };
  }

  /** Predicted start line (deg, + right) for the start-line assist. */
  predictedStart(): number {
    const faceW = clamp(0.88 - 0.0025 * this.club.loft, 0.7, 0.9);
    return this.path + faceW * (this.face - this.path);
  }

  panelView(): SwingPanelView {
    const m = this.model;
    const v = m.clubheadVel();
    const speed = (Math.hypot(v.x, v.y) * m.speedScale) / 0.44704;
    const ref = this.club.refSpeedMph;
    return {
      shoulder: m.geo.shoulder,
      armLen: m.geo.armLen,
      clubLen: m.geo.clubLen,
      hands: m.hands,
      target: m.cursor,
      clubhead: m.clubhead(),
      phi: m.phi,
      ballX: m.geo.ballX,
      ballY: m.geo.ballY,
      grabbing: m.grabbing,
      speedMph: speed,
      speedBands: [ref * 0.7, ref * 0.9, ref * 1.08],
      ghostPath: settings.get('showGhostSwing') ? this.ghostPath : [],
      path: m.path,
      practice: this.practice,
      sweetRing: m.sweetRing(),
    };
  }

  clubPanelView(): ClubPanelView {
    return {
      face: this.face,
      path: this.path,
      aim: this.aim,
      stance: this.stance,
      faceDrift: this.faceDrift,
      pathDrift: this.pathDrift,
      wobble: this.assistScale() > 0,
      startLine: settings.get('showStartLine') || settings.get('assist') !== 'off' ? this.predictedStart() : null,
    };
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
function gaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export { CLUBS };
