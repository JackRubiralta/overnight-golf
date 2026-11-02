/**
 * Pose solver for the procedural golfer. Produces one rigid matrix per bone (see body.ts).
 *
 * SWING (address → backswing → impact → finish), in the golfer frame "G":
 *   origin = ground point under the ball, +X = aim (target), +Y = up,
 *   +Z = X × Y = away from the golfer (a right-handed golfer stands at -Z, facing +Z).
 *
 * The 2D swing model works in a face-on plane (x toward the target, y up). We map it onto an
 * inclined swing plane that contains the target line through the ball and leans toward the
 * golfer at the club's lie angle α:  P3 = ( k(x - ballX) - r_ball,  k y,  -depth(k y) ).
 * `k` makes the 2D club length equal the real 3D grip→head length, so when the 2D clubhead
 * crosses the ball the 3D clubface touches the back of the ball (an explicit correction near
 * the ground guarantees it exactly). Above the address hand height the plane steepens a little
 * (hands stay over the trail shoulder at the top instead of drifting behind the golfer), and
 * the hands are kept within arm's reach of the shoulders. Shoulders/hips turn with the arm
 * angle, the spine angle and head stay put through impact, weight shifts to the lead side,
 * and both arms/legs are solved with two-bone IK.
 *
 * WALK: a procedural gait in the walker frame (+Z forward), club resting on the right
 * shoulder, free left arm swinging; idle breathing when standing still.
 */
import * as THREE from 'three';
import type { SwingPanelView } from '../../core/view';
import { BACK_L, BACK_R, BONE_COUNT, Bone, DIM } from './body';
import { CLUB_KINDS, HANDS_FROM_BUTT, type ClubInfo } from './clubs';

// ---- tuning -------------------------------------------------------------------------------
const BALL_R = 0.021335;
/** Swing plane steepens to this angle above the address hand height (rad). */
const TOP_PLANE = 70 * (Math.PI / 180);
/** Lead arm extension at address as a fraction of full reach. */
const ADDRESS_REACH = 0.965;
/** Max arm extension during the swing (fraction of full reach). */
const MAX_REACH = 0.995;
/** Grip offsets along the shaft from the hands centre (m): lead hand above, trail below. */
const GRIP_L = 0.044;
const GRIP_R = -0.046;
/** Shoulder turn per radian of arm swing (backswing), hip turn as a fraction of it. */
const SHOULDER_TURN = 0.84;
const MAX_SHOULDER_BACK = 1.58;
const HIP_RATIO = 0.48;
/** Stance width (ankle to ankle, m) per club. */
const STANCE: Record<string, number> = { driver: 0.5, wood: 0.47, hybrid: 0.44, iron: 0.4, wedge: 0.35, putter: 0.3 };
/** Extra forward ball position (m) relative to the body centre per club. */
const BALL_FWD: Record<string, number> = { driver: 0.1, wood: 0.06, hybrid: 0.035, iron: 0.015, wedge: 0.0, putter: 0.04 };
const STRIDE = 1.35; // m per gait cycle at walking speed

const UP = new THREE.Vector3(0, 1, 0);
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const v3 = () => new THREE.Vector3();

export interface SwingSolveInput {
  swing: SwingPanelView;
  club: ClubInfo;
  /** Face angle (deg, + open). */
  face: number;
  stance: number;
  dt: number;
}

/** Two-bone IK: returns the middle joint in `mid` (and the reachable end in `end`). */
function ik2(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3) {
  const d = _ik.d.subVectors(target, root);
  let dist = d.length();
  const dir = dist > 1e-6 ? d.multiplyScalar(1 / dist) : d.set(0, -1, 0);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = _ik.p.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  mid.copy(root).addScaledVector(dir, cosA * l1).addScaledVector(perp, sinA * l1);
  end.copy(root).addScaledVector(dir, dist);
}
const _ik = { d: v3(), p: v3() };

export class GolferRig {
  /** Bone matrices in the active local frame (G for swing, walker frame for walk). */
  mats: THREE.Matrix4[] = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  /** Clubhead reference point (sole under the face centre) in the local frame. */
  clubhead = v3();
  /** Point 0.3 m up the shaft from the clubhead (for the motion trail ribbon). */
  shaftPoint = v3();
  /** Active club index in CLUB_KINDS. */
  clubIndex = 0;
  /** Terrain height offsets at the left/right foot relative to the frame origin (m). */
  footLift = [0, 0];
  /** Local foot positions (ankle, before terrain) for terrain queries by the owner. */
  footProbe = [v3(), v3()];

  // swing phase tracking
  private prevTheta = 0;
  private minTheta = 0;
  private down = 0;
  // walk state
  private phase = 0;
  private idleT = 0;

  // scratch
  private t = Array.from({ length: 24 }, v3);
  private q = Array.from({ length: 6 }, () => new THREE.Quaternion());

  // ---------------------------------------------------------------------------------------
  private setFrame(i: number, o: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
    this.mats[i].makeBasis(x, y, z).setPosition(o);
  }
  /** Bone with +Y along `yDir` and +Z as close as possible to `zHint`. */
  private setBone(i: number, o: THREE.Vector3, yDir: THREE.Vector3, zHint: THREE.Vector3) {
    const y = this.t[20].copy(yDir).normalize();
    const z = this.t[21].copy(zHint).addScaledVector(y, -zHint.dot(y));
    if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
    z.normalize();
    const x = this.t[22].crossVectors(y, z);
    this.mats[i].makeBasis(x, y, z).setPosition(o);
  }
  private setLimb(i: number, a: THREE.Vector3, b: THREE.Vector3, zHint: THREE.Vector3) {
    this.setBone(i, a, this.t[23].subVectors(b, a), zHint);
  }
  private showClub(index: number) {
    this.clubIndex = index;
  }
  private hideOtherClubs(frame: THREE.Matrix4) {
    for (let i = 0; i < CLUB_KINDS.length; i++) {
      const m = this.mats[Bone.Club0 + i];
      if (i === this.clubIndex) m.copy(frame);
      else m.makeScale(0, 0, 0);
    }
  }

  // ---------------------------------------------------------------------------------------
  // SWING
  // ---------------------------------------------------------------------------------------
  solveSwing(inp: SwingSolveInput) {
    const sw = inp.swing;
    const club = inp.club;
    this.showClub(CLUB_KINDS.indexOf(club.kind));
    const alpha = club.lie;
    const L3 = club.handLen;
    const cot = 1 / Math.tan(alpha);
    const cotTop = 1 / Math.tan(TOP_PLANE);
    const k = (L3 * Math.sin(alpha)) / Math.max(0.2, sw.clubLen);
    const yA = L3 * Math.sin(alpha);
    // depth(y): integral of a slope that blends from cot(α) to cot(TOP_PLANE) above yA.
    const depth = (y: number) => {
      if (y <= yA) return y * cot;
      const span = 0.3;
      const u = Math.min(y - yA, span);
      // ∫ slope over the smoothstep blend (closed form for t²(3-2t)) + constant beyond.
      const t = u / span;
      const blendInt = span * (t * t * t - 0.5 * t * t * t * t);
      let d = yA * cot + u * cot + (cotTop - cot) * blendInt;
      if (y - yA > span) d += (y - yA - span) * cotTop;
      return d;
    };
    const map = (x2: number, y2: number, out: THREE.Vector3) => {
      const y = y2 * k;
      return out.set((x2 - sw.ballX) * k - BALL_R, y, -depth(y));
    };

    // --- club & hands -----------------------------------------------------------------
    const H = map(sw.hands.x, sw.hands.y, this.t[0]);
    const dir = this.t[1].set(Math.sin(sw.phi) * k, -Math.cos(sw.phi) * k, Math.cos(sw.phi) * k * cot).normalize();
    const R = this.clubhead.copy(H).addScaledVector(dir, L3);
    const c2 = sw.clubhead;
    const w = 1 - smooth(0.12, 0.35, c2.y * k);
    if (w > 0) {
      const e = map(c2.x, c2.y, this.t[2]).sub(R).multiplyScalar(w);
      H.add(e);
      R.add(e);
    }
    const Yc = this.t[3].copy(dir).negate();
    const N = this.t[4].set(0, Math.cos(alpha), Math.sin(alpha));
    const Xc = this.t[5].crossVectors(Yc, N).normalize();
    Xc.applyAxisAngle(Yc, (-inp.face * Math.PI) / 180);
    const Zc = this.t[6].crossVectors(Xc, Yc);

    // --- swing phase --------------------------------------------------------------------
    const theta = Math.atan2(sw.hands.x - sw.shoulder.x, sw.shoulder.y - sw.hands.y);
    const dTh = theta - this.prevTheta;
    this.prevTheta = theta;
    if (Math.abs(theta) < 0.06 && Math.abs(dTh) < 0.002) this.minTheta = 0;
    this.minTheta = Math.min(this.minTheta, theta);
    let downTarget = this.down > 0.5 ? 1 : 0;
    if (dTh > 0.002 && this.minTheta < -0.5) downTarget = 1;
    if (theta < -0.05 && dTh < -0.002) downTarget = 0;
    if (this.minTheta > -0.3 && theta < 0.3) downTarget = 0;
    this.down += (downTarget - this.down) * Math.min(1, inp.dt * 12);
    const back = clamp(-theta / 1.9, 0, 1); // 0 address → 1 top
    const thru = smooth(0.1, 1.8, theta); // 0 impact → 1 finish

    // --- posture constants (address) -----------------------------------------------------
    const kind = club.kind;
    const tau0 = clamp(0.5 + (1.04 - L3) * 0.62, 0.48, 0.72); // spine tilt from vertical
    const sigma0 = 0.12; // side bend (trail shoulder low)
    const pelvisH = 0.872 - (1.04 - L3) * 0.08;
    const ha = map(sw.shoulder.x, sw.shoulder.y - sw.armLen, this.t[7]);
    const xc = map(sw.shoulder.x, 0, this.t[8]).x - (BALL_FWD[kind] ?? 0) + inp.stance * 0.03;
    // Address lead wrist estimate.
    const uAddr = this.t[9].set(0, Math.sin(alpha), -Math.cos(alpha));
    const wristA = this.t[10].copy(ha).addScaledVector(uAddr, GRIP_L + 0.055).addScaledVector(AX_X, 0.012);
    // Lead shoulder at address relative to the pelvis centre.
    const qP0 = this.q[0].setFromAxisAngle(AX_X, tau0 * 0.72);
    const qC0 = this.q[1].setFromAxisAngle(AX_X, tau0).multiply(this.q[2].setFromAxisAngle(AX_Z, sigma0));
    const shRel = this.t[11].set(0, DIM.waist, 0).applyQuaternion(qP0).add(this.t[12].set(DIM.shoulderX, DIM.shoulderY, DIM.shoulderZ).applyQuaternion(qC0));
    const reach = (DIM.upperArm + DIM.foreArm) * ADDRESS_REACH;
    const dx = xc + shRel.x - wristA.x;
    const dy = pelvisH + shRel.y - wristA.y;
    const dz = Math.sqrt(Math.max(0.0025, reach * reach - dx * dx - dy * dy));
    const pelvisZ0 = wristA.z - dz - shRel.z;
    const footZ = pelvisZ0 + 0.035;

    // --- dynamic body angles --------------------------------------------------------------
    const psiBack = Math.max(-MAX_SHOULDER_BACK, theta * SHOULDER_TURN);
    const psiThru = clamp(theta * 0.95 + 0.18, -1.2, 1.75);
    let psiS: number;
    let psiH: number;
    const hipDown = clamp(0.6 + theta * 0.55, -0.6, 1.35); // hips lead the downswing
    if (theta < 0) {
      // Backswing, or downswing (shoulders unwind slightly ahead of the arms, hips lead).
      psiS = psiBack + (clamp(psiBack * 0.85 + 0.1, -1.5, 0.3) - psiBack) * this.down;
      const hipBack = psiS * HIP_RATIO;
      const lead = smooth(-1.9, -0.6, theta);
      psiH = hipBack + (hipDown * lead + hipBack * (1 - lead) - hipBack) * this.down;
    } else {
      const b = smooth(0, 0.25, theta);
      psiS = psiBack * (1 - b) + psiThru * b;
      const hipBack = psiS * HIP_RATIO;
      psiH = hipBack + (hipDown - hipBack) * Math.max(this.down, smooth(0, 0.6, theta));
    }
    const tau = tau0 * (1 - 0.8 * thru);
    const tauP = tau0 * 0.72 * (1 - 0.7 * thru);
    const impactZone = Math.exp(-((theta - 0.15) ** 2) / 0.25) * this.down;
    const sigma = sigma0 * (1 - 0.5 * back) + 0.08 * impactZone - 0.06 * thru;
    const shiftX = -0.025 * back * (1 - this.down) + 0.06 * this.down * (1 - thru) * smooth(-1.6, -0.2, theta) + 0.11 * thru;
    const lift = 0.035 * thru - 0.01 * impactZone;

    // --- pelvis & chest -------------------------------------------------------------------
    const P = this.t[13].set(xc + shiftX, pelvisH + lift + (this.footLift[0] + this.footLift[1]) * 0.5, pelvisZ0 + 0.03 * thru);
    const qP = this.q[0].setFromAxisAngle(AX_Y, psiH).multiply(this.q[2].setFromAxisAngle(AX_X, tauP));
    const qC = this.q[1].setFromAxisAngle(AX_X, tau).multiply(this.q[2].setFromAxisAngle(AX_Z, sigma)).multiply(this.q[3].setFromAxisAngle(AX_Y, psiS));
    const waist = this.t[14].set(0, DIM.waist, 0).applyQuaternion(qP).add(P);
    this.setFrame(Bone.Pelvis, P, this.t[15].copy(AX_X).applyQuaternion(qP), this.t[16].copy(AX_Y).applyQuaternion(qP), this.t[17].copy(AX_Z).applyQuaternion(qP));
    const cx = v3().copy(AX_X).applyQuaternion(qC);
    const cy = v3().copy(AX_Y).applyQuaternion(qC);
    const cz = v3().copy(AX_Z).applyQuaternion(qC);
    this.setFrame(Bone.Chest, waist, cx, cy, cz);
    const shL = v3().set(DIM.shoulderX, DIM.shoulderY, DIM.shoulderZ).applyQuaternion(qC).add(waist);
    const shR = v3().set(-DIM.shoulderX, DIM.shoulderY, DIM.shoulderZ).applyQuaternion(qC).add(waist);

    // --- grips, reach clamp ---------------------------------------------------------------
    const Hc = v3().copy(R).addScaledVector(Yc, L3);
    const gL = v3();
    const gR = v3();
    const wL = v3();
    const wR = v3();
    const backL = v3().copy(Xc).multiplyScalar(BACK_L.x).addScaledVector(Zc, BACK_L.z);
    const backR = v3().copy(Xc).multiplyScalar(BACK_R.x).addScaledVector(Zc, BACK_R.z);
    const wristOf = (g: THREE.Vector3, sh: THREE.Vector3, backN: THREE.Vector3, out: THREE.Vector3) => {
      const toSh = this.t[18].subVectors(sh, g).normalize();
      const d = this.t[19].copy(toSh).add(Yc).normalize();
      return out.copy(g).addScaledVector(d, DIM.wristToFist).addScaledVector(backN, 0.008);
    };
    const maxR = (DIM.upperArm + DIM.foreArm) * MAX_REACH;
    for (let it = 0; it < 3; it++) {
      gL.copy(Hc).addScaledVector(Yc, GRIP_L);
      gR.copy(Hc).addScaledVector(Yc, GRIP_R);
      wristOf(gL, shL, backL, wL);
      wristOf(gR, shR, backR, wR);
      const sL = wL.distanceTo(shL);
      const sR = wR.distanceTo(shR);
      const exL = sL - maxR;
      const exR = sR - maxR;
      if (exL <= 0 && exR <= 0) break;
      const fix = v3();
      if (exL >= exR) fix.subVectors(shL, wL).normalize().multiplyScalar(exL + 0.002);
      else fix.subVectors(shR, wR).normalize().multiplyScalar(exR + 0.002);
      Hc.add(fix);
      R.add(fix);
    }
    this.shaftPoint.copy(R).addScaledVector(Yc, 0.3);
    const clubFrame = new THREE.Matrix4().makeBasis(Xc, Yc, Zc).setPosition(R);
    this.hideOtherClubs(clubFrame);
    this.setFrame(Bone.FistL, gL, Xc, Yc, Zc);
    this.setFrame(Bone.FistR, gR, Xc, Yc, Zc);

    // --- arms -----------------------------------------------------------------------------
    const down = v3().set(0, -1, 0);
    const poleL = v3().copy(cy).multiplyScalar(-0.8).addScaledVector(cz, -0.7).addScaledVector(cx, 0.35).addScaledVector(down, 0.6 * thru);
    const poleR = v3().copy(cy).multiplyScalar(-0.7).addScaledVector(cz, -0.6).addScaledVector(cx, -0.45).addScaledVector(down, 0.9 * back).addScaledVector(down, 0.4 * thru);
    this.solveArm(shL, wL, gL, poleL, backL, Bone.UpperL, Bone.ForeL, Bone.HandL);
    this.solveArm(shR, wR, gR, poleR, backR, Bone.UpperR, Bone.ForeR, Bone.HandR);

    // --- legs & feet --------------------------------------------------------------------
    const width = STANCE[kind] ?? 0.42;
    const flareL = 0.36;
    const flareR = 0.12;
    // Trail heel rises and the foot pivots toward the target through the finish.
    const heel = smooth(0.1, 1.6, theta) * this.down;
    this.placeFoot(Bone.FootL, xc + width / 2, footZ, flareL + 0.1 * thru, 0, 0, this.footLift[0], this.footProbe[0]);
    this.placeFoot(Bone.FootR, xc - width / 2, footZ, -flareR + 0.55 * heel, 1.05 * heel, 0.035 * back * (1 - this.down), this.footLift[1], this.footProbe[1]);
    const hipL = v3().set(DIM.hipX, DIM.hipY, 0).applyQuaternion(qP).add(P);
    const hipR = v3().set(-DIM.hipX, DIM.hipY, 0).applyQuaternion(qP).add(P);
    const kneeL = v3().set(Math.sin(flareL) * 0.6 - 0.35 * back, 0, 1).normalize();
    const kneeR = v3().set(-Math.sin(flareR) * 0.4 + 0.25 * back + 1.3 * heel, 0, 1).normalize();
    this.solveLeg(hipL, Bone.ThighL, Bone.ShinL, Bone.FootL, kneeL);
    this.solveLeg(hipR, Bone.ThighR, Bone.ShinR, Bone.FootR, kneeR);

    // --- neck & head: steady, eyes on the ball until the finish -----------------------
    const neck = v3().set(0, DIM.neckY, -0.012).applyQuaternion(qC).add(waist);
    const neckDir = v3().copy(cy).multiplyScalar(0.55).addScaledVector(UP, 0.45).normalize();
    const headC = v3().copy(neck).addScaledVector(neckDir, DIM.neckLen + DIM.headUp * 0.55).addScaledVector(cz, 0.025);
    const ballPt = v3().set(-0.02, sw.ballY, 0);
    const look = v3().subVectors(ballPt, headC).normalize();
    const chestFlat = v3().set(cz.x, 0, cz.z);
    if (chestFlat.lengthSq() < 1e-6) chestFlat.set(0, 0, 1);
    chestFlat.normalize();
    const lookUp = smooth(0.5, 1.5, theta) * this.down;
    const fwd = v3().copy(look).multiplyScalar(0.62).addScaledVector(chestFlat, 0.38).normalize();
    const finishLook = v3().set(0.85, 0.1, 0.25).normalize();
    fwd.lerp(finishLook, lookUp).normalize();
    const headUp = v3().copy(UP).multiplyScalar(0.7).addScaledVector(cy, 0.3);
    this.setLimb(Bone.Neck, neck, headC, cz);
    this.setBone(Bone.Head, headC, headUp.addScaledVector(fwd, -headUp.dot(fwd)), fwd);
  }

  private solveArm(sh: THREE.Vector3, wrist: THREE.Vector3, grip: THREE.Vector3, pole: THREE.Vector3, backN: THREE.Vector3, up: number, fo: number, ha: number) {
    const elbow = v3();
    const end = v3();
    ik2(sh, wrist, DIM.upperArm, DIM.foreArm, pole, elbow, end);
    this.setLimb(up, sh, elbow, pole);
    this.setLimb(fo, elbow, end, backN);
    this.setLimb(ha, end, grip, backN);
  }

  /** Foot bone at (x, z) with yaw (toward +X positive), heel lift (rad) pivoting on the ball of the foot. */
  private placeFoot(bone: number, x: number, z: number, yaw: number, heelLift: number, slide: number, lift: number, probe: THREE.Vector3) {
    const fwd = v3().set(Math.sin(yaw), 0, Math.cos(yaw));
    const side = v3().crossVectors(UP, fwd); // foot +X
    // Pivot at the ball of the foot, on the ground.
    const ballOff = 0.13;
    const pivot = v3().set(x, lift, z).addScaledVector(fwd, ballOff);
    pivot.x += slide;
    const q = new THREE.Quaternion().setFromAxisAngle(side, heelLift);
    const ankleRel = v3().set(0, DIM.ankleH, 0).addScaledVector(fwd, -ballOff).applyQuaternion(q);
    const ankle = ankleRel.add(pivot);
    probe.set(x, 0, z);
    const y = v3().copy(UP).applyQuaternion(q);
    const zf = v3().copy(fwd).applyQuaternion(q);
    this.setFrame(bone, ankle, v3().crossVectors(y, zf), y, zf);
  }

  private solveLeg(hip: THREE.Vector3, th: number, sh: number, foot: number, kneeDir: THREE.Vector3) {
    const ankle = v3().setFromMatrixPosition(this.mats[foot]);
    const knee = v3();
    const end = v3();
    ik2(hip, ankle, DIM.thigh, DIM.shin, kneeDir, knee, end);
    this.setLimb(th, hip, knee, kneeDir);
    this.setLimb(sh, knee, end, kneeDir);
  }

  // ---------------------------------------------------------------------------------------
  // WALK / IDLE
  // ---------------------------------------------------------------------------------------
  solveWalk(club: ClubInfo, speed: number, dt: number) {
    this.showClub(CLUB_KINDS.indexOf(club.kind));
    this.down = 0;
    this.minTheta = 0;
    const amp = clamp(speed / 1.3, 0, 1.5);
    this.phase += (dt * Math.PI * 2 * speed) / STRIDE;
    this.idleT += dt;
    const ph = this.phase;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    const breathe = Math.sin(this.idleT * 1.7) * (1 - Math.min(1, amp));

    // Feet: stance foot planted & sliding back, swing foot lifting forward.
    const stride = 0.3 * amp;
    const footY = (cc: number) => DIM.ankleH + Math.max(0, cc) * 0.075 * Math.min(1, amp);
    const pitch = (cc: number, ss: number) => (cc > 0 ? -0.25 * ss * Math.min(1, amp) : 0.3 * Math.max(0, -ss) * Math.min(1, amp));
    this.walkFoot(Bone.FootL, 0.1, footY(c) - DIM.ankleH + this.footLift[0], stride * s, pitch(c, s), 0.08, this.footProbe[0]);
    this.walkFoot(Bone.FootR, -0.1, footY(-c) - DIM.ankleH + this.footLift[1], -stride * s, pitch(-c, -s), -0.08, this.footProbe[1]);

    const P = v3().set(0.018 * amp * s, DIM.pelvisH - 0.02 * Math.min(1, amp) - 0.018 * Math.min(1, amp) * Math.abs(c) + 0.004 * breathe + Math.min(this.footLift[0], this.footLift[1]), 0);
    const qP = this.q[0].setFromAxisAngle(AX_Y, 0.11 * amp * s).multiply(this.q[2].setFromAxisAngle(AX_X, 0.05 + 0.02 * amp));
    const tilt = 0.05 + 0.05 * Math.min(1, amp) + 0.012 * breathe;
    const qC = this.q[1].setFromAxisAngle(AX_X, tilt).multiply(this.q[3].setFromAxisAngle(AX_Y, -0.09 * amp * s)).multiply(this.q[4].setFromAxisAngle(AX_Z, 0.03 * amp * s));
    const waist = v3().set(0, DIM.waist, 0).applyQuaternion(qP).add(P);
    this.setFrame(Bone.Pelvis, P, v3().copy(AX_X).applyQuaternion(qP), v3().copy(AX_Y).applyQuaternion(qP), v3().copy(AX_Z).applyQuaternion(qP));
    const cx = v3().copy(AX_X).applyQuaternion(qC);
    const cy = v3().copy(AX_Y).applyQuaternion(qC);
    const cz = v3().copy(AX_Z).applyQuaternion(qC);
    this.setFrame(Bone.Chest, waist, cx, cy, cz);
    const shL = v3().set(DIM.shoulderX, DIM.shoulderY, DIM.shoulderZ).applyQuaternion(qC).add(waist);
    const shR = v3().set(-DIM.shoulderX, DIM.shoulderY, DIM.shoulderZ).applyQuaternion(qC).add(waist);

    // Club resting on the right shoulder: trail hand in front of the shoulder.
    const local = (x: number, y: number, z: number) => v3().set(x, y, z).applyQuaternion(qC);
    const gR = local(-0.17, 0.27 + 0.005 * s * amp, 0.24).add(waist);
    const toHead = local(-0.05, 0.33, -0.94).normalize(); // grip → head, over the shoulder
    const Yc = v3().copy(toHead).negate();
    const Xc = v3().crossVectors(Yc, cx).normalize();
    const Zc = v3().crossVectors(Xc, Yc);
    const Hc = v3().copy(gR).addScaledVector(Yc, -GRIP_R);
    const R = this.clubhead.copy(Hc).addScaledVector(Yc, -club.handLen);
    this.shaftPoint.copy(R).addScaledVector(Yc, 0.3);
    this.hideOtherClubs(new THREE.Matrix4().makeBasis(Xc, Yc, Zc).setPosition(R));
    this.setFrame(Bone.FistR, gR, Xc, Yc, Zc);
    const backR = v3().copy(Xc).multiplyScalar(BACK_R.x).addScaledVector(Zc, BACK_R.z);
    const wR = v3().copy(gR).addScaledVector(local(-0.1, -1, 0.15).normalize(), DIM.wristToFist);
    this.solveArm(shR, wR, gR, local(-0.4, -0.5, -1).normalize(), backR, Bone.UpperR, Bone.ForeR, Bone.HandR);

    // Free left arm swinging opposite the left leg.
    const swing = -0.32 * Math.min(1.2, amp) * s + 0.02 * breathe;
    const hang = v3().set(0.06, -0.52, 0.04).applyAxisAngle(AX_X, -swing);
    const wL = v3().copy(hang).applyQuaternion(qC).add(shL);
    const foreDir = v3();
    const elbowL = v3();
    const endL = v3();
    const poleL = local(0.2, -0.3, -1).normalize();
    ik2(shL, wL, DIM.upperArm, DIM.foreArm, poleL, elbowL, endL);
    this.setLimb(Bone.UpperL, shL, elbowL, poleL);
    foreDir.subVectors(endL, elbowL).normalize();
    this.setLimb(Bone.ForeL, elbowL, endL, cx);
    const fistL = v3().copy(endL).addScaledVector(foreDir, DIM.wristToFist);
    this.setLimb(Bone.HandL, endL, fistL, cx);
    // Relaxed fist: shaft axis forward, back of hand facing out (+X).
    const fy = v3().copy(cz).addScaledVector(foreDir, -cz.dot(foreDir)).normalize();
    const fz = v3().crossVectors(cx, fy).normalize();
    const fx = v3().crossVectors(fy, fz);
    this.setFrame(Bone.FistL, fistL.addScaledVector(fx, -0.01), fx, fy, fz);

    // Legs.
    const hipL = v3().set(DIM.hipX, DIM.hipY, 0).applyQuaternion(qP).add(P);
    const hipR = v3().set(-DIM.hipX, DIM.hipY, 0).applyQuaternion(qP).add(P);
    this.solveLeg(hipL, Bone.ThighL, Bone.ShinL, Bone.FootL, v3().set(0.05, 0, 1).normalize());
    this.solveLeg(hipR, Bone.ThighR, Bone.ShinR, Bone.FootR, v3().set(-0.05, 0, 1).normalize());

    // Head: level gaze ahead.
    const neck = v3().set(0, DIM.neckY, -0.012).applyQuaternion(qC).add(waist);
    const neckDir = v3().copy(cy).multiplyScalar(0.4).addScaledVector(UP, 0.6).normalize();
    const headC = v3().copy(neck).addScaledVector(neckDir, DIM.neckLen + DIM.headUp * 0.55).addScaledVector(cz, 0.02);
    const look = v3().set(0.05 * Math.sin(this.idleT * 0.31) * (1 - Math.min(1, amp)), -0.12, 1).normalize();
    this.setLimb(Bone.Neck, neck, headC, cz);
    this.setBone(Bone.Head, headC, v3().copy(UP).addScaledVector(look, -look.y), look);
  }

  private walkFoot(bone: number, x: number, lift: number, z: number, pitch: number, yaw: number, probe: THREE.Vector3) {
    const fwd = v3().set(Math.sin(yaw), 0, Math.cos(yaw));
    const side = v3().crossVectors(UP, fwd);
    const q = new THREE.Quaternion().setFromAxisAngle(side, pitch);
    const y = v3().copy(UP).applyQuaternion(q);
    const zf = v3().copy(fwd).applyQuaternion(q);
    const ankle = v3().set(x, DIM.ankleH + lift, z);
    probe.set(x, 0, z);
    this.setFrame(bone, ankle, v3().crossVectors(y, zf), y, zf);
  }
}

export { HANDS_FROM_BUTT };
