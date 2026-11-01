/**
 * All gameplay / physics tuning values live here so they are easy to adjust.
 * Units are SI (metres, seconds, kilograms, radians) unless a name says otherwise.
 */

export const DEG = Math.PI / 180;
export const MPH = 0.44704; // m/s per mph
export const YARD = 0.9144; // m per yard
export const RPM = (2 * Math.PI) / 60; // rad/s per rpm

export const PHYS = {
  gravity: 9.81,
  airDensity: 1.194, // kg/m^3 (sea level, ~22°C)
  ballMass: 0.04593,
  ballRadius: 0.021335,
  /** Fixed physics timestep for ball simulation. */
  dt: 1 / 240,
  /** Spin decays exponentially with this time constant (s). */
  spinDecayTau: 26,
  /** Drag model: Cd = cdBase + cdSpin * S, with a drag-crisis bump at low Reynolds number. */
  cdBase: 0.25,
  cdSpin: 0.25,
  /** Drag falls slightly with Reynolds number above the crisis (per m/s above 40 m/s). */
  cdSpeed: 0.003,
  cdLowSpeed: 0.43, // Cd below the drag crisis (subcritical flow)
  dragCrisisLo: 11, // m/s: fully subcritical below this speed
  dragCrisisHi: 19, // m/s: fully supercritical above this speed
  /** Lift model: Cl = clMax * S^clScale (capped at 0.42); constants fitted to TrackMan tour carry/apex. */
  clMax: 0.5,
  clScale: 0.5,
  /** Wind boundary layer: wind speed scales with height using a log-ish profile. */
  windRefHeight: 10,
  windGroundFactor: 0.45,
  /** Cup */
  cupRadius: 0.054,
  cupCaptureSpeed: 1.55, // m/s: faster than this over the cup → lip-out/skip
  /** Ball at rest thresholds */
  restSpeed: 0.035,
  maxSimTime: 40,
  outOfBoundsY: -50,
};

export type SurfaceId =
  | 'tee'
  | 'fairway'
  | 'rough'
  | 'deepRough'
  | 'fringe'
  | 'green'
  | 'sand'
  | 'water'
  | 'path'
  | 'dirt'
  | 'oob';

export interface SurfaceParams {
  /** Coefficient of restitution for the normal component at low impact speed. */
  restitution: number;
  /** Coulomb friction coefficient for the bounce impulse. */
  friction: number;
  /** How much the turf deforms ("crater" tilt, rad per m/s of normal speed). Higher = ball checks more. */
  softness: number;
  /** Rolling deceleration on flat ground (m/s^2). */
  rollDecel: number;
  /** Extra speed-proportional drag while rolling (1/s): long grass grabs the ball. */
  rollDrag: number;
  /** Lie effect on the next shot: multiplier on clubhead speed transfer (ball speed). */
  lieSpeed: number;
  /** Lie effect on spin (rough → fliers with less spin). */
  lieSpin: number;
  /** Random clubface twist from the lie (deg, std dev). */
  lieTwist: number;
  label: string;
}

export const SURFACES: Record<SurfaceId, SurfaceParams> = {
  tee: { restitution: 0.32, friction: 0.42, softness: 0.012, rollDecel: 1.7, rollDrag: 0.22, lieSpeed: 1.0, lieSpin: 1.0, lieTwist: 0, label: 'Tee' },
  fairway: { restitution: 0.34, friction: 0.42, softness: 0.012, rollDecel: 1.7, rollDrag: 0.22, lieSpeed: 1.0, lieSpin: 1.0, lieTwist: 0.2, label: 'Fairway' },
  fringe: { restitution: 0.3, friction: 0.45, softness: 0.014, rollDecel: 0.95, rollDrag: 0.08, lieSpeed: 0.99, lieSpin: 0.95, lieTwist: 0.2, label: 'Fringe' },
  green: { restitution: 0.28, friction: 0.48, softness: 0.017, rollDecel: 0.55, rollDrag: 0.02, lieSpeed: 1.0, lieSpin: 1.0, lieTwist: 0, label: 'Green' },
  rough: { restitution: 0.22, friction: 0.55, softness: 0.02, rollDecel: 3.0, rollDrag: 0.9, lieSpeed: 0.9, lieSpin: 0.62, lieTwist: 1.4, label: 'Rough' },
  deepRough: { restitution: 0.16, friction: 0.65, softness: 0.026, rollDecel: 5.0, rollDrag: 2.2, lieSpeed: 0.72, lieSpin: 0.5, lieTwist: 3.0, label: 'Deep Rough' },
  sand: { restitution: 0.08, friction: 0.8, softness: 0.05, rollDecel: 7.0, rollDrag: 3.5, lieSpeed: 0.78, lieSpin: 0.7, lieTwist: 1.5, label: 'Bunker' },
  water: { restitution: 0, friction: 1, softness: 0, rollDecel: 99, rollDrag: 99, lieSpeed: 0, lieSpin: 0, lieTwist: 0, label: 'Water' },
  path: { restitution: 0.62, friction: 0.35, softness: 0.002, rollDecel: 0.7, rollDrag: 0.01, lieSpeed: 0.97, lieSpin: 0.9, lieTwist: 0.8, label: 'Cart Path' },
  dirt: { restitution: 0.4, friction: 0.45, softness: 0.006, rollDecel: 1.5, rollDrag: 0.1, lieSpeed: 0.92, lieSpin: 0.85, lieTwist: 1.2, label: 'Dirt' },
  oob: { restitution: 0.2, friction: 0.6, softness: 0.02, rollDecel: 4, rollDrag: 1.5, lieSpeed: 0.85, lieSpin: 0.6, lieTwist: 2, label: 'Out of Bounds' },
};

/** Swing / player-control tuning. */
export const SWING = {
  /** Degrees per second when holding a face key; Shift = fine. */
  faceRate: 6,
  pathRate: 6,
  aimRate: 30,
  fineFactor: 0.2,
  /** Discrete step (deg) applied on key tap, for precise adjustment. */
  faceStep: 0.5,
  pathStep: 0.5,
  maxFace: 25,
  maxPath: 20,
  /** Stance (ball position) range in normalized units [-1 (back) .. 1 (forward)]. */
  stanceRate: 1.2,
  stanceStep: 0.1,
  /** Drift: random walk applied to face/path while the swing is in motion (deg/s, std). */
  driftRate: 3.2,
  driftMeanReversion: 0.15,
  /** Mouse → hand mapping (radians of arm swing per pixel at sensitivity 1). */
  mouseToArm: 0.0055,
  /** Hand following spring (critically-damped-ish). */
  handStiffness: 260,
  handDamping: 30,
  /** Wrist hinge: angular spring between forearm and shaft. */
  wristStiffness: 38,
  wristDamping: 2.2,
  wristMaxHinge: 115 * DEG,
  /** How much hand speed transfers to clubhead via release (lag whip). */
  releaseGain: 1.0,
  /** Max arm angle for backswing (rad, 0 = address, + = back). */
  maxBackswing: 175 * DEG,
  maxFollow: 170 * DEG,
  /** Erratic input: jerk thresholds that start to degrade strike quality. */
  jerkTolerance: 900,
  /** Lateral mouse wobble (px/s) mapped to path noise (deg). */
  wobbleToPath: 0.012,
};

export const GAMEPLAY = {
  penaltyWater: 1,
  penaltyOOB: 1,
  conceded: 0, // no gimmes
  maxStrokesPerHole: 15,
  walkSpeed: 4.2,
  runSpeed: 8.5,
  /** Distance the golfer can be from the ball to enter stance. */
  stanceReach: 3.0,
};

export const SCALE = {
  /** World extents of the course heightfield, metres. */
  worldSize: 1600,
};
