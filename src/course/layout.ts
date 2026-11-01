/**
 * Hand-authored routing for "Thornbury Links" — an original 9-hole course on one large
 * open landscape. All coordinates are world metres [x, z] (x east, z south; -z is north).
 * Shapes are turned into signed-distance fields in CourseField.
 */
export type P2 = [number, number];

export interface Ellipse {
  c: P2;
  r: P2; // radii along local x/z
  rot?: number; // radians
}

export interface BunkerDef extends Ellipse {
  depth?: number;
  /** Extra lobes merged into the bunker for organic shapes. */
  lobes?: Ellipse[];
}

export interface WaterDef {
  /** Union of blobs; level is computed from the surrounding terrain unless given. */
  blobs: Ellipse[];
  level?: number;
}

export interface HoleDef {
  number: number;
  name: string;
  par: number;
  tee: P2;
  /** Fairway centre-line from just past the tee to the front of the green. */
  fairway: P2[];
  /** Half-width per fairway point (m). */
  width: number[];
  green: Ellipse;
  /** Green tilt: rise in metres per metre along x and z (front-to-back slope etc.). */
  greenSlope: P2;
  pin: P2;
  bunkers: BunkerDef[];
  water: WaterDef[];
  /** Raise (+) or lower the tee box relative to the natural ground (m). */
  teeLift?: number;
  /** Raise/lower the green complex (m). */
  greenLift?: number;
  /** Short one-line description used on the hole card. */
  blurb: string;
}

export const COURSE_NAME = 'Thornbury Links';

export const HOLES: HoleDef[] = [
  {
    number: 1, name: 'First Light', par: 4,
    tee: [0, 150],
    fairway: [[0, 110], [-4, 20], [-12, -80], [-24, -170]],
    width: [14, 17, 18, 15],
    green: { c: [-30, -222], r: [15, 19], rot: 0.15 },
    greenSlope: [0.004, 0.012],
    pin: [-26, -228],
    bunkers: [
      { c: [12, -50], r: [9, 5], rot: 0.5, lobes: [{ c: [17, -44], r: [5, 4] }] },
      { c: [-48, -214], r: [5, 9], rot: 0.2 },
      { c: [-12, -244], r: [8, 4], rot: -0.3 },
    ],
    water: [],
    teeLift: 0.8,
    blurb: 'A gentle opener. Bunker guards the right side of the landing zone.',
  },
  {
    number: 2, name: 'Heron Bend', par: 4,
    tee: [-75, -268],
    fairway: [[-110, -268], [-190, -258], [-270, -262], [-340, -290]],
    width: [13, 17, 16, 13],
    green: { c: [-392, -316], r: [17, 14], rot: 0.4 },
    greenSlope: [-0.01, 0.006],
    pin: [-398, -312],
    bunkers: [
      { c: [-372, -335], r: [7, 4], rot: 0.4 },
      { c: [-238, -240], r: [8, 4], rot: -0.1 },
    ],
    water: [{ blobs: [{ c: [-350, -246], r: [26, 15], rot: 0.3 }, { c: [-385, -268], r: [16, 10], rot: 0.6 }, { c: [-322, -232], r: [14, 9] }] }],
    blurb: 'Water lurks left of the green. Favour the right half of the fairway.',
  },
  {
    number: 3, name: 'Over the Mere', par: 3,
    tee: [-440, -372],
    fairway: [[-445, -395], [-458, -430]],
    width: [7, 6],
    green: { c: [-478, -530], r: [16, 13], rot: -0.2 },
    greenSlope: [0.006, 0.01],
    pin: [-482, -526],
    bunkers: [
      { c: [-500, -548], r: [7, 4], rot: 0.6 },
      { c: [-454, -540], r: [5, 6] },
    ],
    water: [{ blobs: [{ c: [-462, -470], r: [30, 22], rot: 0.2 }, { c: [-440, -495], r: [18, 13] }, { c: [-492, -460], r: [16, 12] }] }],
    teeLift: 3,
    blurb: 'All carry over the mere to a green that slopes back to front.',
  },
  {
    number: 4, name: 'The Long Walk', par: 5,
    tee: [-520, -495],
    fairway: [[-512, -535], [-470, -630], [-400, -685], [-300, -680], [-220, -645]],
    width: [13, 18, 17, 16, 13],
    green: { c: [-182, -628], r: [18, 15], rot: 0.5 },
    greenSlope: [-0.008, -0.008],
    pin: [-176, -632],
    bunkers: [
      { c: [-440, -615], r: [9, 5], rot: 1.0, lobes: [{ c: [-432, -608], r: [5, 4] }] },
      { c: [-330, -705], r: [10, 4], rot: 0.1 },
      { c: [-205, -610], r: [6, 4], rot: 0.9 },
      { c: [-168, -652], r: [7, 4], rot: -0.4 },
    ],
    water: [],
    blurb: 'A three-shot par five that swings right around the old woods.',
  },
  {
    number: 5, name: 'Saddleback', par: 4,
    tee: [-130, -650],
    fairway: [[-95, -646], [0, -628], [110, -600], [210, -560]],
    width: [13, 16, 17, 14],
    green: { c: [262, -538], r: [16, 17], rot: 0.2 },
    greenSlope: [0.01, -0.004],
    pin: [268, -534],
    bunkers: [
      { c: [70, -590], r: [10, 5], rot: 0.3 },
      { c: [120, -628], r: [8, 4], rot: 0.2 },
      { c: [246, -520], r: [6, 4], rot: 0.5 },
      { c: [282, -556], r: [6, 4], rot: -0.4 },
    ],
    water: [],
    blurb: 'Rolling ground and a pair of fairway bunkers in the drive zone.',
  },
  {
    number: 6, name: 'The Perch', par: 3,
    tee: [330, -500],
    fairway: [[350, -490], [380, -474]],
    width: [7, 7],
    green: { c: [470, -425], r: [16, 13], rot: 0.6 },
    greenSlope: [-0.006, 0.008],
    pin: [474, -420],
    bunkers: [
      { c: [452, -405], r: [7, 4], rot: 0.6 },
      { c: [486, -446], r: [6, 4], rot: 0.6 },
      { c: [452, -446], r: [5, 3], rot: 0.2 },
    ],
    water: [],
    teeLift: 6,
    blurb: 'Downhill from an elevated tee. Club down and trust the wind.',
  },
  {
    number: 7, name: 'Crossing', par: 5,
    tee: [520, -360],
    fairway: [[524, -320], [548, -220], [560, -110], [535, 10], [492, 110]],
    width: [13, 17, 18, 16, 13],
    green: { c: [470, 162], r: [17, 16], rot: 0.2 },
    greenSlope: [0.006, 0.008],
    pin: [466, 168],
    bunkers: [
      { c: [580, -200], r: [9, 5], rot: 1.2 },
      { c: [450, 140], r: [6, 5] },
      { c: [496, 182], r: [7, 4], rot: 0.3 },
    ],
    water: [{ blobs: [{ c: [548, -40], r: [40, 14], rot: 0.08 }, { c: [520, -32], r: [20, 12] }, { c: [580, -46], r: [20, 11] }] }],
    blurb: 'A burn crosses the fairway in the lay-up zone. Go for it or lay up?',
  },
  {
    number: 8, name: 'Old Oak', par: 4,
    tee: [420, 205],
    fairway: [[395, 225], [330, 290], [250, 330], [180, 350]],
    width: [13, 16, 16, 13],
    green: { c: [140, 360], r: [15, 17], rot: -0.3 },
    greenSlope: [0.01, 0.0],
    pin: [134, 364],
    bunkers: [
      { c: [300, 330], r: [8, 4], rot: -0.6 },
      { c: [152, 382], r: [6, 4], rot: -0.2 },
      { c: [120, 342], r: [5, 4] },
    ],
    water: [],
    blurb: 'Dogleg left around the old oak. Cut the corner if you dare.',
  },
  {
    number: 9, name: 'Homecoming', par: 4,
    tee: [110, 440],
    fairway: [[80, 445], [0, 440], [-90, 410], [-160, 360]],
    width: [13, 17, 17, 14],
    green: { c: [-196, 326], r: [17, 18], rot: 0.4 },
    greenSlope: [-0.006, -0.01],
    pin: [-200, 322],
    bunkers: [
      { c: [-40, 448], r: [9, 4], rot: 0.2 },
      { c: [-170, 300], r: [7, 4], rot: 0.9 },
      { c: [-220, 348], r: [6, 4], rot: 0.4 },
    ],
    water: [{ blobs: [{ c: [-110, 365], r: [22, 12], rot: 0.7 }, { c: [-130, 345], r: [12, 9] }] }],
    blurb: 'Home in front of the clubhouse — mind the pond short and left.',
  },
];

/** Clubhouse, practice green and other set pieces. */
export const LANDMARKS = {
  clubhouse: { c: [60, 250] as P2, rot: -0.3 },
  practiceGreen: { c: [-40, 215] as P2, r: [10, 8] as P2 },
  /** Cart paths (polylines). */
  paths: [
    [[30, 225], [12, 170], [18, 120], [26, -40], [10, -200], [-60, -260]],
    [[-100, -290], [-300, -300], [-420, -360], [-470, -390]],
    [[-500, -470], [-540, -510], [-500, -610], [-420, -710], [-180, -670], [-140, -650]],
    [[-120, -675], [100, -650], [300, -580], [330, -520]],
    [[490, -450], [540, -380], [590, -200], [600, 0], [520, 160], [430, 210]],
    [[400, 240], [300, 380], [120, 410], [110, 455], [-40, 470], [-200, 380], [-80, 290], [30, 240]],
  ] as P2[][],
};

export const WORLD_HALF = 800;
