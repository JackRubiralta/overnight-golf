/**
 * Logical input actions and their default bindings. Keyboard codes use KeyboardEvent.code.
 * Gamepad bindings use the Standard Gamepad mapping (button indices / axis ids).
 * Final spec: see RESEARCH.md "Final control spec" and CONTROLS.md.
 */
export type Action =
  // walking (first-person)
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight' | 'run' | 'crouch' | 'jump'
  // mode
  | 'toggleStance' // Tab: walking <-> golf stance
  // swing shaping (stance)
  | 'faceClose' | 'faceOpen' // A / D
  | 'pathIn' | 'pathOut' // Q (in-to-out, draw) / E (out-to-in, fade)
  | 'aimLeft' | 'aimRight' // Z / C
  | 'stanceForward' | 'stanceBack' // W / S while in stance (assumption, see RESEARCH.md)
  | 'fine' // Shift: fine adjustment
  | 'resetFacePath' // R
  | 'swingGrab' // LMB hold: grab the hands
  | 'rangefinder' // RMB
  | 'retake' // Space: stroke-and-distance retake
  | 'practiceSwing' // X: toggle practice swing (no ball)
  | 'club1' | 'club2' | 'club3' | 'club4' | 'club5'
  | 'clubNext' | 'clubPrev'
  | 'returnToBall' // F: walk/teleport back to your ball
  | 'freeCam' // V: survey camera
  | 'scorecard' // Backquote / Select
  | 'map' // M
  | 'pause'; // Escape / Start

export const ACTIONS: Action[] = [
  'moveForward', 'moveBack', 'moveLeft', 'moveRight', 'run', 'crouch', 'jump', 'toggleStance',
  'faceClose', 'faceOpen', 'pathIn', 'pathOut', 'aimLeft', 'aimRight', 'stanceForward', 'stanceBack',
  'fine', 'resetFacePath', 'swingGrab', 'rangefinder', 'retake', 'practiceSwing',
  'club1', 'club2', 'club3', 'club4', 'club5', 'clubNext', 'clubPrev', 'returnToBall', 'freeCam', 'scorecard', 'map', 'pause',
];

export const ACTION_LABELS: Record<Action, string> = {
  moveForward: 'Walk forward', moveBack: 'Walk back', moveLeft: 'Strafe left', moveRight: 'Strafe right',
  run: 'Run', crouch: 'Crouch (read greens)', jump: 'Jump',
  toggleStance: 'Golf stance / walk',
  faceClose: 'Close clubface', faceOpen: 'Open clubface',
  pathIn: 'Path in-to-out (draw)', pathOut: 'Path out-to-in (fade)',
  aimLeft: 'Aim left', aimRight: 'Aim right',
  stanceForward: 'Stance forward (lower)', stanceBack: 'Stance back (higher)',
  fine: 'Fine adjust (hold)', resetFacePath: 'Square face & path',
  swingGrab: 'Grab hands / swing', rangefinder: 'Rangefinder (hold)',
  retake: 'Retake shot (+1)', practiceSwing: 'Practice swing',
  club1: 'Driver', club2: 'Hybrid', club3: 'Iron', club4: 'Wedge', club5: 'Putter',
  clubNext: 'Next club', clubPrev: 'Previous club',
  returnToBall: 'Return to ball', freeCam: 'Survey camera', scorecard: 'Scorecard', map: 'Map', pause: 'Pause',
};

/** Key binding: KeyboardEvent.code or a mouse button "Mouse0" (left), "Mouse2" (right), "WheelUp", "WheelDown". */
export type KeyBindings = Record<Action, string[]>;

export const DEFAULT_KEYS: KeyBindings = {
  moveForward: ['KeyW', 'ArrowUp'], moveBack: ['KeyS', 'ArrowDown'], moveLeft: ['KeyA', 'ArrowLeft'], moveRight: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft'], crouch: ['ControlLeft'], jump: [],
  toggleStance: ['Tab'],
  faceClose: ['KeyA'], faceOpen: ['KeyD'],
  pathIn: ['KeyQ'], pathOut: ['KeyE'],
  aimLeft: ['KeyZ'], aimRight: ['KeyC'],
  stanceForward: ['KeyW'], stanceBack: ['KeyS'],
  fine: ['ShiftLeft', 'ShiftRight'], resetFacePath: ['KeyR'],
  swingGrab: ['Mouse0'], rangefinder: ['Mouse2'],
  retake: ['Space'], practiceSwing: ['KeyX'],
  club1: ['Digit1'], club2: ['Digit2'], club3: ['Digit3'], club4: ['Digit4'], club5: ['Digit5'],
  clubNext: ['WheelDown'], clubPrev: ['WheelUp'],
  returnToBall: ['KeyF'], freeCam: ['KeyV'], scorecard: ['Backquote'], map: ['KeyM'], pause: ['Escape', 'KeyP'],
};

/**
 * Gamepad bindings (Standard mapping). Buttons: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT,
 * 8 Back/View, 9 Start/Menu, 10 LS, 11 RS, 12 DUp, 13 DDown, 14 DLeft, 15 DRight.
 * Sticks: left stick walks (and moves the camera in survey); right stick = HANDS (swing).
 */
export type PadBindings = Partial<Record<Action, number[]>>;

export const DEFAULT_PAD: PadBindings = {
  toggleStance: [3], // Y
  faceClose: [4], faceOpen: [5], // LB / RB
  pathIn: [6], pathOut: [7], // LT / RT
  aimLeft: [14], aimRight: [15], // D-pad left/right
  stanceForward: [12], stanceBack: [13], // D-pad up/down
  resetFacePath: [11], // RS click
  retake: [2], // X
  practiceSwing: [10], // LS click
  clubNext: [1], // B cycles clubs
  rangefinder: [0], // A (hold)
  returnToBall: [],
  scorecard: [8],
  pause: [9],
  run: [10],
};

/** Which bindings are context-sensitive (same key used in walking vs stance). */
export const STANCE_ONLY: Action[] = ['faceClose', 'faceOpen', 'pathIn', 'pathOut', 'aimLeft', 'aimRight', 'stanceForward', 'stanceBack', 'resetFacePath', 'swingGrab', 'retake', 'practiceSwing', 'club1', 'club2', 'club3', 'club4', 'club5', 'clubNext', 'clubPrev'];
export const WALK_ONLY: Action[] = ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'run', 'crouch', 'jump', 'returnToBall'];
