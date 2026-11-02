/**
 * Physics-driven 2D swing model (face-on "swing plane" view).
 *
 * The player drags the golfer's HANDS with the mouse/right stick. The hands follow a
 * target point with a spring, constrained by arm length around the shoulder pivot.
 * The club hangs from the hands as a weighted rod with a springy wrist hinge, so it
 * lags, cocks and whips through on its own. Clubhead speed, attack angle, shaft lean
 * and the height of the sole as it passes the ball all EMERGE from the motion:
 *   - swing faster & smoother → more clubhead speed
 *   - hands too low (beyond the arm circle edge) → club digs the turf before the ball (fat)
 *   - hands too high → sole passes above the ball's equator (thin / topped / whiff)
 *   - erratic, jerky input → face flail & off-centre strikes
 *
 * Coordinates: metres in the swing plane. x > 0 points toward the target, y up,
 * ground at y = 0. Angles are measured from straight down, positive toward the target.
 */
import { DEG, SURFACES, SWING } from '../config';
import type { Club } from '../physics/clubs';

export interface Vec2 {
  x: number;
  y: number;
}

export interface SwingImpact {
  /** Clubhead speed in the 2D model (m/s), already scaled to a 3D-equivalent clubhead speed. */
  clubSpeed: number;
  /** Attack angle from the clubhead velocity direction (deg, + up). */
  attackAngle: number;
  /** Forward shaft lean at impact (deg, + = hands ahead → delofted). */
  shaftLean: number;
  /** Sole height above ground when crossing the ball (m). */
  soleHeight: number;
  /** Deepest the club dug into the turf before reaching the ball (m, ≥ 0). */
  fatDepth: number;
  /** Peak hand speed during the downswing (m/s). */
  peakHandSpeed: number;
  /** Mean absolute jerk of the hand target during the downswing (normalised). */
  roughness: number;
  /** Backswing length reached (deg of arm rotation). */
  backswing: number;
  /** Time from top of the backswing to impact (s). */
  downswingTime: number;
  /** Ball-centre-relative strike height on the face (mm, + above sweet spot). */
  strikeV: number;
  whiff: boolean;
}

export interface SwingGeometry {
  shoulder: Vec2;
  armLen: number;
  clubLen: number;
  ballX: number;
  /** Ball centre height (m) — tee height for driver. */
  ballY: number;
  /** Height of the face sweet spot above the sole (m). */
  sweetH: number;
}

const BALL_R = 0.021335;

/**
 * Realistic clubhead-speed ceiling per club (mph). Very fast/violent mouse flicks used to reach
 * ~185 mph with the driver (500-yard drives). Speeds stay 1:1 up to a knee, then saturate softly
 * toward the cap, so over-swinging mostly adds error (face flail) instead of distance.
 */
export const SPEED_CAP_MPH: Record<string, number> = { driver: 118, wood: 114, hybrid: 110, iron: 102, wedge: 95, putter: 30 };
const SPEED_KNEE = 0.82;

export function capClubSpeed(club: Club, speed: number): number {
  const cap = (SPEED_CAP_MPH[club.kind] ?? 110) * 0.44704;
  const knee = cap * SPEED_KNEE;
  if (speed <= knee) return speed;
  const room = cap - knee;
  return knee + room * Math.tanh((speed - knee) / room);
}

/**
 * Putting is a pendulum stroke: the BACKSTROKE LENGTH sets the distance (≈ linear), and tempo
 * (how fast the mouse moves) only nudges it ±10%. Raw mouse speed was far too sensitive
 * ("2 inches or 2 miles").
 */
export const PUTT = {
  /** Flat-green roll distance per degree of backstroke (m/deg). */
  metresPerDeg: 0.62,
  /** How much tempo can change the result (fraction of the deviation from the expected speed). */
  tempoInfluence: 0.15,
  tempoClamp: 0.4,
};

/** Clubhead speed (m/s) that rolls a putt `d` metres on a flat green. */
export function puttClubSpeedFor(d: number, smash: number): number {
  return Math.sqrt(2 * SURFACES.green.rollDecel * Math.max(0, d)) / smash;
}

/**
 * Per-club swing range: how much of the mouse (cursor) angle the golfer's arms actually rotate.
 * Softer clubs get less, so a big, controllable mouse motion makes a short stroke — lower
 * sensitivity for putting and the short game.
 */
export const SWING_RANGE: Record<string, number> = { putter: 0.3, wedge: 0.8, iron: 1, hybrid: 1, wood: 1, driver: 1 };

export class SwingModel {
  club: Club;
  geo: SwingGeometry;
  /** Hand position, velocity. */
  hands: Vec2 = { x: 0, y: 0 };
  handsVel: Vec2 = { x: 0, y: 0 };
  /** Hands in polar form around the shoulder. */
  hTheta = 0;
  hThetaVel = 0;
  hRho = 0.62;
  hRhoVel = 0;
  /** Where the player is dragging the hands to (derived from the cursor). */
  target: Vec2 = { x: 0, y: 0 };
  /** The player's virtual cursor. Its angle maps 1:1 to the hands, but its radial distance
   *  from the arm circle is scaled by radialGain, so contact (fat/thin) is controllable. */
  cursor: Vec2 = { x: 0, y: 0 };
  radialGain = 0.2;
  /** Club angle from straight down (rad, + toward target) and its angular velocity. */
  phi = 0;
  phiVel = 0;
  /** True while the player is holding the grab button. */
  grabbing = false;
  /** Lowest arm angle reached on the backswing (rad, negative = away from target). */
  minTheta = 0;
  /** Has the swing passed the ball? */
  impacted = false;
  /** Has a real backswing begun (so a downswing crossing counts as a strike)? */
  armed = false;
  private topTime = 0;
  private time = 0;
  private fatDepth = 0;
  private peakHand = 0;
  private jerkAcc = 0;
  private jerkN = 0;
  private lastTargetVel: Vec2 = { x: 0, y: 0 };
  private lastTarget: Vec2 = { x: 0, y: 0 };
  private prevClub: Vec2 = { x: 0, y: 0 };
  /** Recorded hand path for the ghost swing overlay. */
  path: Vec2[] = [];
  /** Global tuning multipliers (settings / assist). */
  speedScale = 1.3;
  /** Hand auto-return when the grab is released (original game behaviour). */
  autoReturn = true;
  /** Fraction of the cursor's angle that the arms actually rotate (per club, see SWING_RANGE). */
  angleGain = 1;

  constructor(club: Club, opts: { stance?: number; teed?: boolean } = {}) {
    this.club = club;
    this.geo = SwingModel.geometry(club, opts.stance ?? 0, opts.teed ?? false);
    if (club.kind === 'putter') this.speedScale = 0.75;
    this.angleGain = SWING_RANGE[club.kind] ?? 1;
    this.reset();
  }

  static geometry(club: Club, stance: number, teed: boolean): SwingGeometry {
    const armLen = 0.62;
    // Projected club length into the swing plane (shaft is inclined at its lie angle).
    const clubLen = club.length * Math.sin(club.lie * DEG) * 0.98;
    const sweetH = club.kind === 'driver' ? 0.03 : club.kind === 'wood' ? 0.022 : club.kind === 'putter' ? 0.016 : 0.018;
    const teeH = teed ? (club.kind === 'driver' ? 0.02 : 0.012) : 0;
    // Stance forward (+) moves the body toward the target = the ball sits further back.
    const ballX = -stance * 0.09 + (club.kind === 'driver' ? 0.07 : club.kind === 'wood' ? 0.04 : 0.0);
    // Shoulders are set so that straight arms + straight club just reach the ground below.
    const shoulder = { x: 0, y: armLen + clubLen - 0.014 };
    return { shoulder, armLen, clubLen, ballX, ballY: BALL_R + teeH, sweetH };
  }

  setStance(stance: number, teed: boolean) {
    this.geo = SwingModel.geometry(this.club, stance, teed);
  }

  /** Address position: arms hanging, slight forward press, club soled behind the ball. */
  reset() {
    const g = this.geo;
    const theta = 0;
    this.hands = { x: g.shoulder.x + Math.sin(theta) * g.armLen, y: g.shoulder.y - Math.cos(theta) * g.armLen };
    this.target = { ...this.hands };
    this.cursor = { ...this.hands };
    this.lastTarget = { ...this.hands };
    this.handsVel = { x: 0, y: 0 };
    this.hTheta = theta;
    this.hThetaVel = 0;
    this.hRho = g.armLen;
    this.hRhoVel = 0;
    this.lastTargetVel = { x: 0, y: 0 };
    this.phi = Math.asin(Math.max(-0.5, Math.min(0.5, (g.ballX - this.hands.x) / g.clubLen)));
    this.phiVel = 0;
    this.minTheta = 0;
    this.impacted = false;
    this.armed = false;
    this.topTime = 0;
    this.time = 0;
    this.fatDepth = 0;
    this.peakHand = 0;
    this.jerkAcc = 0;
    this.jerkN = 0;
    this.path = [];
    this.prevClub = this.clubhead();
  }

  /** Expected flat-green roll (m) for the current/peak backstroke of a putt. */
  puttDistanceForBackswing(): number {
    return PUTT.metresPerDeg * Math.max(0, -this.minTheta / DEG);
  }

  /** Putter impact speed: backstroke-length based, nudged a little by tempo. */
  private puttSpeed(measured: number): number {
    const target = puttClubSpeedFor(this.puttDistanceForBackswing(), this.club.smash);
    if (target <= 0) return 0;
    const ratio = Math.max(1 - PUTT.tempoClamp, Math.min(1 + PUTT.tempoClamp, measured / target));
    return target * (1 + (ratio - 1) * PUTT.tempoInfluence);
  }

  /** Arm angle (rad from straight down, + toward target). */
  get theta() {
    const s = this.geo.shoulder;
    return Math.atan2(this.hands.x - s.x, s.y - this.hands.y);
  }

  clubhead(): Vec2 {
    return { x: this.hands.x + Math.sin(this.phi) * this.geo.clubLen, y: this.hands.y - Math.cos(this.phi) * this.geo.clubLen };
  }

  /** Clubhead velocity (m/s) in the plane. */
  clubheadVel(): Vec2 {
    const L = this.geo.clubLen;
    return { x: this.handsVel.x + Math.cos(this.phi) * L * this.phiVel, y: this.handsVel.y + Math.sin(this.phi) * L * this.phiVel };
  }

  /** Move the hand target by a delta in swing-plane metres (from mouse/stick). */
  drag(dx: number, dy: number) {
    const g = this.geo;
    let cx = this.cursor.x + dx;
    let cy = this.cursor.y + dy;
    // The cursor lives in a generous annulus around the shoulder.
    let rx = cx - g.shoulder.x;
    let ry = cy - g.shoulder.y;
    let r = Math.hypot(rx, ry);
    const cMax = g.armLen * 1.6;
    const cMin = g.armLen * 0.3;
    if (r > cMax || r < cMin) {
      const k = (r > cMax ? cMax : cMin) / Math.max(r, 1e-6);
      rx *= k;
      ry *= k;
      r = Math.hypot(rx, ry);
    }
    // Limit arm rotation range.
    let th = Math.atan2(rx, -ry);
    const lim = th < 0 ? SWING.maxBackswing : SWING.maxFollow;
    if (Math.abs(th) > lim) th = Math.sign(th) * lim;
    cx = g.shoulder.x + Math.sin(th) * r;
    cy = g.shoulder.y - Math.cos(th) * r;
    this.cursor.x = cx;
    this.cursor.y = cy;
    // Hand target: the cursor angle scaled by the club's swing range (a full mouse swing is only a
    // short stroke with the putter / a three-quarter swing with a wedge), radial error scaled down,
    // clamped to what the arms can reach.
    const ath = th * this.angleGain;
    let hr = g.armLen + (r - g.armLen) * this.radialGain;
    hr = Math.min(g.armLen * 1.035, Math.max(g.armLen * 0.35, hr));
    this.target.x = g.shoulder.x + Math.sin(ath) * hr;
    this.target.y = g.shoulder.y - Math.cos(ath) * hr;
  }

  /** Cursor radius range (fraction of arm length) that gives clean contact. */
  sweetRing(): [number, number] {
    return [1 - 0.012 / this.radialGain, 1 + 0.014 / this.radialGain];
  }

  /**
   * Advance the simulation. Returns an impact when the clubhead passes the ball this step.
   * @param ballPresent false for a practice swing (still reports a "virtual" impact).
   */
  step(dt: number, ballPresent = true): SwingImpact | null {
    const g = this.geo;
    this.time += dt;

    // Target roughness (jerk) bookkeeping during an active swing.
    const tvx = (this.target.x - this.lastTarget.x) / dt;
    const tvy = (this.target.y - this.lastTarget.y) / dt;
    if (this.armed && !this.impacted) {
      const jx = (tvx - this.lastTargetVel.x) / dt;
      const jy = (tvy - this.lastTargetVel.y) / dt;
      this.jerkAcc += Math.hypot(jx, jy);
      this.jerkN++;
    }
    this.lastTargetVel = { x: tvx, y: tvy };
    this.lastTarget = { ...this.target };

    // Hand auto-return toward address when released (before impact only).
    if (!this.grabbing && this.autoReturn && !this.armed) {
      const home = { x: g.shoulder.x, y: g.shoulder.y - g.armLen };
      const k = Math.min(1, dt * 2.5);
      this.drag((home.x - this.cursor.x) * k, (home.y - this.cursor.y) * k);
    }

    // Hands: springs toward the target in POLAR coordinates around the shoulder, so the
    // hands naturally travel on the arm arc (the lead arm stays extended) instead of
    // cutting straight across the circle.
    const sh = g.shoulder;
    const tTheta = Math.atan2(this.target.x - sh.x, sh.y - this.target.y);
    const tRho = Math.hypot(this.target.x - sh.x, this.target.y - sh.y);
    const thetaAcc = SWING.handStiffness * (tTheta - this.hTheta) - SWING.handDamping * this.hThetaVel;
    const rhoAcc = SWING.handStiffness * (tRho - this.hRho) - SWING.handDamping * this.hRhoVel;
    this.hThetaVel += thetaAcc * dt;
    this.hRhoVel += rhoAcc * dt;
    // Physical limit on hand speed.
    const maxHand = 14;
    const tang = Math.abs(this.hThetaVel) * this.hRho;
    if (tang > maxHand) this.hThetaVel *= maxHand / tang;
    this.hTheta += this.hThetaVel * dt;
    this.hRho = Math.min(g.armLen * 1.035, Math.max(g.armLen * 0.35, this.hRho + this.hRhoVel * dt));
    const prevHx = this.hands.x;
    const prevHy = this.hands.y;
    const prevVx = this.handsVel.x;
    const prevVy = this.handsVel.y;
    this.hands.x = sh.x + Math.sin(this.hTheta) * this.hRho;
    this.hands.y = sh.y - Math.cos(this.hTheta) * this.hRho;
    this.handsVel.x = (this.hands.x - prevHx) / dt;
    this.handsVel.y = (this.hands.y - prevHy) / dt;
    const ax = (this.handsVel.x - prevVx) / dt;
    const ay = (this.handsVel.y - prevVy) / dt;

    // Club: weighted rod pinned at the hands, with a springy wrist hinge.
    const theta = this.theta;
    const L = g.clubLen;
    const tx = Math.cos(this.phi);
    const ty = Math.sin(this.phi);
    // Natural wrist cock: hinge grows as the arms rotate back, unhinges as they come down.
    const backAmt = Math.max(0, -theta);
    const hingeTarget = this.club.kind === 'putter' ? 0 : -Math.min(90 * DEG, backAmt * 0.85);
    const beta = this.phi - theta;
    const thetaVel = this.thetaVel();
    const betaVel = this.phiVel - thetaVel;
    const wristK = this.club.kind === 'putter' ? SWING.wristStiffness * 6 : SWING.wristStiffness;
    const wristTorque = -wristK * (beta - hingeTarget) - SWING.wristDamping * betaVel;
    const gravity = -9.81 * Math.sin(this.phi);
    const pivotAcc = -(ax * tx + ay * ty);
    let phiAcc = (gravity + pivotAcc) / L + wristTorque;
    this.phiVel += phiAcc * dt;
    this.phi += this.phiVel * dt;
    // Hinge limits.
    const b = this.phi - theta;
    if (Math.abs(b) > SWING.wristMaxHinge) {
      this.phi = theta + Math.sign(b) * SWING.wristMaxHinge;
      this.phiVel = thetaVel;
    }

    // Track backswing.
    if (theta < this.minTheta) {
      this.minTheta = theta;
      this.topTime = this.time;
    }
    const armAt = this.club.kind === 'putter' ? -2.5 * DEG : -25 * DEG;
    const turn = this.club.kind === 'putter' ? 0.6 * DEG : 4 * DEG;
    if (!this.armed && this.minTheta < armAt && theta > this.minTheta + turn) this.armed = true;
    if (this.armed && !this.impacted) {
      this.peakHand = Math.max(this.peakHand, Math.hypot(this.handsVel.x, this.handsVel.y));
    }

    // Ground interaction: the club can't pass through the turf; it digs and slows.
    let head = this.clubhead();
    if (head.y < 0) {
      const depth = -head.y;
      if (this.armed && !this.impacted && head.x < g.ballX + 0.01 && head.x > g.ballX - 0.3) this.fatDepth = Math.max(this.fatDepth, depth);
      // Turf resistance: bleed angular velocity proportional to depth.
      this.phiVel *= Math.max(0.6, 1 - depth * 25 * dt * 60 * 0.05);
      if (depth > 0.04) {
        // Can't go deeper: clamp by rotating the club up.
        const cy = Math.max(-1, Math.min(1, (this.hands.y + 0.04) / L));
        const newPhi = Math.sign(this.phi || 1) * Math.acos(cy);
        if (Number.isFinite(newPhi)) this.phi = newPhi;
      }
      head = this.clubhead();
    }

    if (this.path.length === 0 || this.time - (this.path.length - 1) * (1 / 60) >= 1 / 60) {
      if (this.grabbing || this.armed) this.path.push({ ...this.hands });
    }

    // Impact: clubhead crossing the ball's x moving toward the target during the downswing.
    let result: SwingImpact | null = null;
    const prev = this.prevClub;
    if (this.armed && !this.impacted && prev.x < g.ballX && head.x >= g.ballX && head.y < 0.35 && theta > -80 * DEG) {
      const t = (g.ballX - prev.x) / Math.max(1e-6, head.x - prev.x);
      const soleY = prev.y + (head.y - prev.y) * t;
      const v = this.clubheadVel();
      const speed2d = Math.hypot(v.x, v.y);
      const attack = Math.atan2(v.y, v.x) / DEG;
      const lean = -(this.phi / DEG); // clubhead behind the hands → hands ahead → positive lean
      const strikeV = (g.ballY - (Math.max(0, soleY) + g.sweetH)) * 1000;
      const whiff = ballPresent ? soleY > g.ballY + BALL_R * 0.85 : false;
      this.impacted = true;
      const rough = this.jerkN > 0 ? this.jerkAcc / this.jerkN : 0;
      result = {
        clubSpeed: this.club.kind === 'putter' ? this.puttSpeed(speed2d * this.speedScale) : capClubSpeed(this.club, speed2d * this.speedScale),
        attackAngle: Math.max(-12, Math.min(12, attack)),
        shaftLean: lean,
        soleHeight: soleY,
        fatDepth: this.fatDepth,
        peakHandSpeed: this.peakHand,
        roughness: rough / 2000,
        backswing: -this.minTheta / DEG,
        downswingTime: this.time - this.topTime,
        strikeV,
        whiff,
      };
    }
    this.prevClub = head;
    return result;
  }

  /** Angular velocity of the arms (rad/s) from the hand velocity. */
  private thetaVel() {
    return this.hThetaVel;
  }
}
