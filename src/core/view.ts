/**
 * Read-only snapshots the game hands to the UI every frame. The UI never mutates game state;
 * it calls back through UIHandlers.
 */
import type { SurfaceId } from '../config';
import type { StrikeQuality } from '../physics/impact';

export interface Vec2 {
  x: number;
  y: number;
}

export type GameMode = 'loading' | 'title' | 'walk' | 'stance' | 'swing' | 'flight' | 'holed' | 'paused' | 'scorecard' | 'freecam';

export interface SwingPanelView {
  /** Swing-plane geometry (metres), x toward target, y up, ground at 0. */
  shoulder: Vec2;
  armLen: number;
  clubLen: number;
  hands: Vec2;
  /** Hand target (where the virtual cursor is). */
  target: Vec2;
  clubhead: Vec2;
  /** Club angle from straight down (rad, + toward target). */
  phi: number;
  ballX: number;
  ballY: number;
  grabbing: boolean;
  /** Current clubhead speed (mph) for the trail colour. */
  speedMph: number;
  /** Speed bands for trail colour (mph): good, great, max. */
  speedBands: [number, number, number];
  /** Previous swing's hand path (ghost) and current path. */
  ghostPath: Vec2[];
  path: Vec2[];
  practice: boolean;
  /** Recommended hand ring radius band (fraction of arm length) for clean contact. */
  sweetRing: [number, number];
}

export interface ClubPanelView {
  /** Degrees. face > 0 open, path > 0 in-to-out, aim relative to the pin line (+ right). */
  face: number;
  path: number;
  aim: number;
  /** Ball position in stance, -1 (back) .. 1 (forward). */
  stance: number;
  /** Drift offsets currently applied (deg) — drawn as the "ghost" face. */
  faceDrift: number;
  pathDrift: number;
  wobble: boolean;
  /** Predicted start direction (deg, + right) when the start-line assist is on; null otherwise. */
  startLine: number | null;
}

export interface ClubInfo {
  index: number; // 0..4 in the bag
  id: string;
  name: string;
  short: string;
  loft: number;
  /** Typical carry for a good swing (m), shown as a guide. */
  typicalCarry: number;
}

export interface HudView {
  mode: GameMode;
  holeNumber: number;
  holeName: string;
  par: number;
  strokes: number; // strokes taken on this hole so far
  totalStrokes: number;
  toPar: number; // round score relative to par, completed holes + current
  distanceToPin: number; // metres (horizontal)
  elevationToPin: number; // metres (+ uphill)
  lie: SurfaceId;
  windSpeed: number; // m/s
  /** Wind direction relative to the camera view, radians (0 = blowing away from camera, + clockwise). */
  windRelAngle: number;
  timer: number; // seconds since round start
  club: ClubInfo;
  bag: ClubInfo[];
  swing: SwingPanelView | null;
  clubPanel: ClubPanelView | null;
  /** Context hint line (e.g. "Press Tab to address the ball"). */
  hint: string;
  /** Rangefinder readout when active. */
  rangefinder: { distance: number; elevation: number } | null;
  ballInFlight: boolean;
  /** Distance from the player to their ball (m), for walking. */
  distanceToBall: number;
  units: 'yards' | 'metres';
  /** Player position and heading for the minimap (x, z, yaw). */
  player: { x: number; z: number; yaw: number };
  ball: { x: number; z: number };
  pin: { x: number; z: number };
}

export interface ShotReport {
  club: string;
  clubSpeedMph: number;
  face: number;
  path: number;
  faceToPath: number;
  attack: number;
  dynamicLoft: number;
  ballSpeedMph: number;
  smash: number;
  launchV: number;
  launchH: number;
  spinRpm: number;
  spinAxis: number;
  carry: number; // m
  total: number; // m
  offline: number; // m (+ right)
  apex: number; // m
  quality: StrikeQuality;
  result: SurfaceId | 'holed' | 'oob';
  practice: boolean;
}

export interface HoleScore {
  number: number;
  par: number;
  strokes: number | null;
  putts: number;
  fairway: boolean | null;
  gir: boolean;
  penalties: number;
}

export interface RoundView {
  courseName: string;
  holes: HoleScore[];
  totalStrokes: number;
  totalPar: number;
  timer: number;
  finished: boolean;
  best: { strokes: number | null; time: number | null };
  splits: number[];
}

/** Callbacks from the UI into the game. */
export interface UIHandlers {
  onPlay(opts: { startHole: number; mode: 'round' | 'practice' }): void;
  onResume(): void;
  onQuitToTitle(): void;
  onRestartHole(): void;
  onNextHole(): void;
  /** The mid-round scorecard was closed from the UI (button/click). */
  onCloseScorecard?(): void;
}
