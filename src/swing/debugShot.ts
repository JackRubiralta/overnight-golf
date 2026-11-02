/**
 * Synthetic ("debug") shots: build a ClubDelivery + SwingImpact without a mouse swing, so that
 * play-tests can drive the game through exactly the same impact pipeline as a real swing.
 * Pure functions only (unit-tested in tests/debugshot.test.ts).
 */
import { MPH, type SurfaceId } from '../config';
import type { Club, ClubKind } from '../physics/clubs';
import type { ClubDelivery } from '../physics/impact';
import type { SwingImpact } from './SwingModel';

export interface DebugShotOpts {
  /** Bag index (0-4) or club id ('D', '4H', '7I', 'SW', 'P'). Default: the current club. */
  club?: number | string;
  /** Clubhead speed, mph. Default: solved from `distance`, else the club's reference speed. */
  clubSpeed?: number;
  /** Target distance (m) to solve the club speed for (total distance along the aim line). */
  distance?: number;
  /** What `distance` measures: total (default) or carry. */
  solveFor?: 'total' | 'carry';
  /** Aim offset (deg, + right of the pin line). */
  aim?: number;
  /** Solve the aim so the ball finishes on the pin line (accounts for curve, slopes, wind). */
  autoAim?: boolean;
  face?: number;
  path?: number;
  attack?: number;
  dynamicLoft?: number;
  /** Strike location on the face (mm). */
  strikeH?: number;
  strikeV?: number;
  fat?: number;
  /** Play it as a practice swing (must not count). */
  practice?: boolean;
  /** Miss the ball completely (counts as a stroke). */
  whiff?: boolean;
}

/** Typical well-struck attack angle and dynamic-loft offset per club kind (matches tests/physics). */
export const NOMINAL: Record<ClubKind, { attack: number; dynOffset: number }> = {
  driver: { attack: 0, dynOffset: 4 },
  wood: { attack: -1.5, dynOffset: 1 },
  hybrid: { attack: -2.5, dynOffset: -1 },
  iron: { attack: -4, dynOffset: -9 },
  wedge: { attack: -5, dynOffset: -13 },
  putter: { attack: 1, dynOffset: 0 },
};

export function nominalDelivery(club: Club, mph: number, lie: SurfaceId, o: DebugShotOpts = {}): ClubDelivery {
  const nom = NOMINAL[club.kind];
  return {
    club,
    clubSpeed: o.whiff ? 0 : Math.max(0, mph) * MPH,
    faceAngle: o.face ?? 0,
    path: o.path ?? 0,
    attackAngle: o.attack ?? nom.attack,
    dynamicLoft: o.dynamicLoft ?? club.loft + nom.dynOffset,
    strikeH: o.strikeH ?? 0,
    strikeV: o.strikeV ?? 0,
    fat: o.fat ?? 0,
    lie,
  };
}

/** A SwingImpact consistent with a delivery (what the swing model would have reported). */
export function syntheticImpact(d: ClubDelivery, whiff = false): SwingImpact {
  return {
    clubSpeed: d.clubSpeed,
    attackAngle: d.attackAngle,
    shaftLean: 0,
    soleHeight: 0,
    fatDepth: d.fat * 0.03,
    peakHandSpeed: d.clubSpeed / 4,
    roughness: 0,
    backswing: 90,
    downswingTime: 0.3,
    strikeV: d.strikeV,
    whiff,
  };
}

/**
 * Bisection on a monotonic(ish) distance(speed) function: the speed in [lo, hi] whose distance
 * is closest to `target`.
 */
export function solveSpeed(distance: (mph: number) => number, target: number, lo = 1, hi = 130, iters = 22): number {
  if (distance(hi) <= target) return hi;
  if (distance(lo) >= target) return lo;
  for (let i = 0; i < iters; i++) {
    const mid = 0.5 * (lo + hi);
    if (distance(mid) < target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}
