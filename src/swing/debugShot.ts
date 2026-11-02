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
 * The speed in [lo, hi] whose distance is closest to `target`. `distance` need not be monotonic
 * (balls can run back down a bank) and may return NaN for unusable results (water / OOB):
 * a coarse scan picks the best bracket, then bisection (or a local ternary search) refines it.
 */
export function solveSpeed(distance: (mph: number) => number, target: number, lo = 1, hi = 130, samples = 40): number {
  const xs: number[] = [];
  const ds: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = lo + ((hi - lo) * i) / samples;
    xs.push(x);
    ds.push(distance(x));
  }
  const err = (d: number) => (Number.isFinite(d) ? Math.abs(d - target) : Infinity);
  let best = 0;
  for (let i = 1; i <= samples; i++) if (err(ds[i]) < err(ds[best])) best = i;
  if (!Number.isFinite(ds[best])) return lo;
  // Prefer a bracket [i, i+1] around the best sample that crosses the target.
  for (const i of [best - 1, best]) {
    if (i < 0 || i >= samples) continue;
    const a = ds[i];
    const b = ds[i + 1];
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a - target) * (b - target) > 0) continue;
    let x0 = xs[i];
    let x1 = xs[i + 1];
    const rising = b >= a;
    for (let k = 0; k < 18; k++) {
      const m = 0.5 * (x0 + x1);
      const dm = distance(m);
      if (!Number.isFinite(dm)) break;
      if (dm < target === rising) x0 = m;
      else x1 = m;
    }
    return 0.5 * (x0 + x1);
  }
  // No crossing (target unreachable or a local extremum): ternary search on the error nearby.
  let x0 = xs[Math.max(0, best - 1)];
  let x1 = xs[Math.min(samples, best + 1)];
  for (let k = 0; k < 16; k++) {
    const m0 = x0 + (x1 - x0) / 3;
    const m1 = x1 - (x1 - x0) / 3;
    if (err(distance(m0)) <= err(distance(m1))) x1 = m1;
    else x0 = m0;
  }
  const m = 0.5 * (x0 + x1);
  return err(distance(m)) <= err(ds[best]) ? m : xs[best];
}
