/**
 * Club → ball impact model based on the TrackMan "D-plane" description of ball flight.
 *
 * Conventions (right-handed golfer, all angles in degrees, relative to the target/aim line):
 *  - faceAngle  > 0: face open (points right of target)
 *  - path       > 0: in-to-out (club travelling right of target)
 *  - faceToPath = face - path. > 0 → spin axis tilts right → ball curves right (fade/slice).
 *  - attackAngle > 0: club moving up at impact.
 *  - launchH > 0: ball starts right of target. spinAxis > 0: curves right.
 *  - strikeH > 0: toe-side strike (mm); strikeV > 0: above the sweet spot (mm).
 */
import { Vector3 } from 'three';
import { DEG, RPM, SURFACES, type SurfaceId } from '../config';
import type { Club } from './clubs';

export interface ClubDelivery {
  club: Club;
  /** Clubhead speed at impact, m/s. */
  clubSpeed: number;
  faceAngle: number;
  path: number;
  attackAngle: number;
  /** Dynamic (delivered) loft at impact, degrees. */
  dynamicLoft: number;
  strikeH: number;
  strikeV: number;
  /** 0..1 how much the club hit the ground before the ball. */
  fat: number;
  lie: SurfaceId;
}

export type StrikeQuality = 'pure' | 'good' | 'toe' | 'heel' | 'thin' | 'fat' | 'topped' | 'whiff' | 'skied';

export interface LaunchData {
  ballSpeed: number; // m/s
  launchV: number; // deg
  launchH: number; // deg (+ right)
  spinRpm: number;
  spinAxis: number; // deg (+ right curve)
  smash: number;
  spinLoft: number;
  faceToPath: number;
  quality: StrikeQuality;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

/** Nominal spin loft for a club with a typical well-struck delivery. */
export function nominalSpinLoft(club: Club): number {
  if (club.kind === 'putter') return 3;
  return club.loft * 0.7 + 5;
}

export function computeLaunch(d: ClubDelivery, rng: () => number = Math.random): LaunchData {
  const { club } = d;
  const lie = SURFACES[d.lie];
  const faceToPath = d.faceAngle - d.path;

  // Toe/heel twist: the face rotates open on toe hits and closed on heel hits.
  const offsetMm = Math.hypot(d.strikeH, d.strikeV * 0.8);
  const twist = d.strikeH * 0.12 * (1 - club.gear * 0.25);
  const face = d.faceAngle + twist;

  // Thin / topped strikes deloft the impact, high-on-face adds launch (vertical gear effect).
  let dynLoft = d.dynamicLoft;
  let quality: StrikeQuality = 'pure';
  if (d.strikeV < -14 && club.kind !== 'putter') {
    // Leading edge contact.
    const t = clamp((-d.strikeV - 14) / 10, 0, 1);
    dynLoft = dynLoft * (1 - 0.8 * t) - 4 * t;
    quality = t > 0.7 ? 'topped' : 'thin';
  } else if (d.strikeV > 16 && club.kind !== 'putter') {
    quality = 'skied';
  }
  dynLoft += club.gear * d.strikeV * 0.08;

  const spinLoft = clamp(dynLoft - d.attackAngle, 0.5, 85);

  // Smash factor: peaks at the club's nominal spin loft; more spin loft = glancing blow.
  const nom = nominalSpinLoft(club);
  let smash = club.smash * clamp(Math.cos(spinLoft * DEG) / Math.cos(nom * DEG), 0.45, 1.03);
  // Off-centre losses.
  const offN = offsetMm / (club.forgiveness * 1.6);
  smash *= 1 - clamp(0.11 * offN * offN, 0, 0.55);
  // Fat: club decelerated by turf before ball.
  smash *= 1 - 0.62 * clamp(d.fat, 0, 1);
  if (quality === 'topped') smash *= 0.55;
  else if (quality === 'thin') smash *= 0.93;
  let ballSpeed = Math.max(0, d.clubSpeed * smash * lie.lieSpeed);

  // Vertical launch.
  const k = clamp(0.9 - 0.004 * spinLoft, 0.55, 0.92);
  let launchV = d.attackAngle + k * (dynLoft - d.attackAngle);
  if (club.kind === 'putter') launchV = clamp(dynLoft * 0.9 + d.attackAngle * 0.5, -2, 8);
  if (quality === 'topped') launchV = Math.min(launchV, -3 - rng() * 3);

  // Horizontal launch: mostly face for low lofts, more path for high lofts.
  const faceW = clamp(0.88 - 0.0025 * club.loft, 0.7, 0.9);
  const lieTwist = (rng() - 0.5) * 2 * lie.lieTwist;
  const launchH = d.path + faceW * (face + lieTwist - d.path);

  // Spin rate: power law with saturation, fitted to TrackMan tour averages
  // (driver 2686 rpm @ SL 14.3°, 7i 7097 @ 27.6°, PW 9304 @ 37°).
  let spinRpm =
    spinLoft < 14.3
      ? 215 * d.clubSpeed * Math.sin(spinLoft * DEG) // low spin loft: ~linear in sin(SL)
      : (0.0881 * d.clubSpeed * Math.pow(spinLoft, 2.5)) / (1 + (spinLoft / 27) ** 2);
  if (spinLoft > 50) spinRpm *= clamp(1 - (spinLoft - 50) / 60, 0.35, 1); // ball slides up the face
  spinRpm *= lie.lieSpin;
  spinRpm *= 1 - 0.5 * clamp(d.fat, 0, 1);
  spinRpm -= club.gear * d.strikeV * 22; // high on the face = less spin (woods)
  if (quality === 'thin') spinRpm *= 0.7;
  if (quality === 'topped') spinRpm = 200 + rng() * 300;
  if (club.kind === 'putter') spinRpm = 40;
  spinRpm = clamp(spinRpm, 0, 12500);

  // Spin axis tilt from face-to-path (D-plane), plus horizontal gear effect (toe → draw spin).
  const f2pEff = faceToPath + twist * (1 - club.gear);
  let spinAxis = (Math.atan2(Math.sin(f2pEff * DEG), Math.sin(spinLoft * DEG)) / DEG) * 0.75;
  spinAxis -= club.gear * d.strikeH * 0.55;
  spinAxis = clamp(spinAxis, -60, 60);

  if (quality === 'pure') {
    if (Math.abs(d.strikeH) > club.forgiveness) quality = d.strikeH > 0 ? 'toe' : 'heel';
    else if (d.fat > 0.25) quality = 'fat';
    else if (offsetMm > club.forgiveness * 0.5 || d.fat > 0.05) quality = 'good';
  }
  if (ballSpeed < 0.3) quality = 'whiff';

  return { ballSpeed, launchV, launchH, spinRpm, spinAxis, smash, spinLoft, faceToPath, quality };
}

/**
 * Convert launch data to a world-space initial velocity and spin vector.
 * @param aimDir horizontal unit vector pointing at the target line.
 * @param up     world up (unit).
 */
export function launchToWorld(l: LaunchData, aimDir: Vector3, up = new Vector3(0, 1, 0)) {
  const fwd = aimDir.clone().setY(0).normalize();
  const right = new Vector3().crossVectors(fwd, up).normalize();
  // Horizontal start direction (+ right).
  const h = l.launchH * DEG;
  const dirH = fwd.clone().multiplyScalar(Math.cos(h)).addScaledVector(right, Math.sin(h));
  const v = l.launchV * DEG;
  const dir = dirH.clone().multiplyScalar(Math.cos(v)).addScaledVector(up, Math.sin(v)).normalize();
  const velocity = dir.clone().multiplyScalar(l.ballSpeed);
  // Backspin axis: right of travel (ω × v points up). Tilt it so positive axis curves right.
  const back = new Vector3().crossVectors(dir, up).normalize();
  const tilt = l.spinAxis * DEG;
  const lift = new Vector3().crossVectors(back, dir).normalize(); // ≈ up, perpendicular to dir
  // Rotating ω toward +lift makes ω×v point toward the left; so use -lift for right curve.
  const axis = back.multiplyScalar(Math.cos(tilt)).addScaledVector(lift, -Math.sin(tilt)).normalize();
  const spin = axis.multiplyScalar(l.spinRpm * RPM);
  return { velocity, spin };
}
