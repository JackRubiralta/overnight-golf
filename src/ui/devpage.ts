/**
 * UI dev page (ui-dev.html): instantiates the UI with fake HudView data and a scripted swing so the
 * overlay can be developed and screenshotted without the 3D game.
 *
 * Query params:
 *   state = hud (default) | loading | title | pause | settings | controls | practice | scorecard | final | walk
 *   t     = freeze the scripted swing at this time (s) within its 4 s cycle
 *   tab   = settings tab id (graphics | controls | audio | gameplay)
 */
import { UI } from './UI';
import type { HudView, RoundView, ShotReport, SwingPanelView, ClubPanelView, Vec2, ClubInfo } from '../core/view';
import { DEFAULT_KEYS, DEFAULT_PAD, type Action, type KeyBindings, type PadBindings } from '../core/actions';
import { HOLES } from '../course/layout';
import type { Input } from '../core/Input';
import type { AudioSystem } from '../audio/Audio';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'hud';
const freezeT = q.has('t') ? Number(q.get('t')) : null;

// ── fake input implementing the rebinding contract ──
class FakeInput {
  lastDevice: 'kbm' | 'pad' = 'kbm';
  private keys: KeyBindings = JSON.parse(JSON.stringify(DEFAULT_KEYS));
  private pad: PadBindings = JSON.parse(JSON.stringify(DEFAULT_PAD));
  private pending: ((c: string | number | null) => void) | null = null;
  constructor() {
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.pending) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const cb = this.pending;
        this.pending = null;
        cb(e.code === 'Escape' ? null : e.code);
      },
      true,
    );
  }
  getKeyBindings() {
    return this.keys;
  }
  getPadBindings() {
    return this.pad;
  }
  captureNext(_d: 'kbm' | 'pad', cb: (c: string | number | null) => void) {
    this.pending = cb;
  }
  cancelCapture() {
    const cb = this.pending;
    this.pending = null;
    cb?.(null);
  }
  setKeyBinding(a: Action, i: number, code: string | null) {
    const arr = [...(this.keys[a] ?? [])];
    if (code === null) arr.splice(i, 1);
    else arr[i] = code;
    this.keys[a] = arr.filter(Boolean);
  }
  setPadBinding(a: Action, i: number, b: number | null) {
    const arr = [...(this.pad[a] ?? [])];
    if (b === null) arr.splice(i, 1);
    else arr[i] = b;
    this.pad[a] = arr.filter((x) => x !== undefined);
  }
  resetBindings() {
    this.keys = JSON.parse(JSON.stringify(DEFAULT_KEYS));
    this.pad = JSON.parse(JSON.stringify(DEFAULT_PAD));
  }
}

const fakeAudio = new Proxy({}, { get: () => () => {} }) as unknown as AudioSystem;
const handlers = {
  onPlay: (o: unknown) => console.log('onPlay', o),
  onResume: () => {
    console.log('onResume');
    ui.hidePause();
  },
  onQuitToTitle: () => console.log('quit'),
  onRestartHole: () => console.log('restart'),
  onNextHole: () => {
    console.log('next');
    ui.hideScorecard();
  },
};
const ui = new UI(document.getElementById('ui-root')!, handlers, new FakeInput() as unknown as Input, fakeAudio);

// ── scripted swing ──
const ARM = 0.62;
const CLUB = 0.94 * Math.sin(62.5 * (Math.PI / 180)) * 0.98;
const SH: Vec2 = { x: 0, y: ARM + CLUB - 0.014 };
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Arm angle theta and wrist hinge (club angle relative to the arms) over a 4 s cycle. */
function pose(t: number): { theta: number; hinge: number; rad: number } {
  const TOP = -2.55;
  if (t < 0.5) return { theta: 0, hinge: 0, rad: 1 };
  if (t < 1.7) {
    const k = smooth((t - 0.5) / 1.2);
    return { theta: TOP * k, hinge: -1.5 * smooth(clamp01((t - 0.7) / 0.9)), rad: 1 + 0.02 * k };
  }
  if (t < 1.9) return { theta: TOP, hinge: -1.5, rad: 1.02 };
  if (t < 2.16) {
    const k = (t - 1.9) / 0.26;
    const th = TOP * (1 - k * k);
    const release = clamp01((k - 0.6) / 0.4);
    return { theta: th, hinge: -1.5 * (1 - release * release), rad: 1.02 - 0.03 * k };
  }
  if (t < 2.5) {
    const k = smooth((t - 2.16) / 0.34);
    return { theta: 2.3 * k, hinge: 0.9 * k, rad: 0.99 };
  }
  if (t < 3.4) return { theta: 2.3, hinge: 0.9, rad: 0.99 };
  const k = smooth((t - 3.4) / 0.6);
  return { theta: 2.3 * (1 - k), hinge: 0.9 * (1 - k), rad: 1 };
}

let path: Vec2[] = [];
let ghost: Vec2[] = [];
let prevHead: Vec2 | null = null;
let prevT = -1;

function swingView(t: number, dt: number, record = true): SwingPanelView {
  const p = pose(t);
  const hands = { x: SH.x + Math.sin(p.theta) * ARM, y: SH.y - Math.cos(p.theta) * ARM };
  const phi = p.theta + p.hinge;
  const head = { x: hands.x + Math.sin(phi) * CLUB, y: hands.y - Math.cos(phi) * CLUB };
  const lead = pose(Math.min(3.99, t + 0.04));
  const target = { x: SH.x + Math.sin(lead.theta) * ARM * lead.rad, y: SH.y - Math.cos(lead.theta) * ARM * lead.rad };
  if (record && t < prevT) {
    ghost = path;
    path = [];
  }
  if (record && t > 0.5 && t < 2.6) path.push({ ...hands });
  const speed = prevHead && dt > 0 ? (Math.hypot(head.x - prevHead.x, head.y - prevHead.y) / dt) * 2.237 * 1.15 : 0;
  prevHead = head;
  if (record) prevT = t;
  return {
    shoulder: SH, armLen: ARM, clubLen: CLUB, hands, target, clubhead: head, phi, ballX: 0, ballY: 0.021335,
    grabbing: t > 0.5 && t < 2.5, speedMph: speed, speedBands: [87 * 0.7, 87 * 0.9, 87 * 1.08],
    ghostPath: ghost, path, practice: false, sweetRing: [1 - 0.012 / 0.2, 1 + 0.014 / 0.2],
  };
}

const BAG: ClubInfo[] = [
  { index: 0, id: 'D', name: 'Driver', short: 'Dr', loft: 10.5, typicalCarry: 210 },
  { index: 1, id: '4H', name: '4 Hybrid', short: '4H', loft: 22, typicalCarry: 170 },
  { index: 2, id: '7I', name: '7 Iron', short: '7i', loft: 33, typicalCarry: 140 },
  { index: 3, id: 'SW', name: 'Sand Wedge', short: 'SW', loft: 56, typicalCarry: 85 },
  { index: 4, id: 'P', name: 'Putter', short: 'Pt', loft: 3, typicalCarry: 10 },
];

const hole = HOLES[2];
function hudView(t: number, swing: SwingPanelView | null, time: number): HudView {
  const club: ClubPanelView = {
    face: 1.5, path: -0.8, aim: -4, stance: 0.35,
    faceDrift: 1.2 * Math.sin(time * 2.1), pathDrift: 0.8 * Math.sin(time * 1.6 + 2), wobble: true, startLine: 1.0,
  };
  const walk = state === 'walk';
  return {
    mode: walk ? 'walk' : t > 2.2 && t < 3.6 ? 'swing' : 'stance',
    holeNumber: hole.number, holeName: hole.name, par: hole.par, strokes: 0, totalStrokes: 11, toPar: -1,
    distanceToPin: 152.4, elevationToPin: -6.1, lie: 'tee', windSpeed: 4.2, windRelAngle: 0.9 + 0.1 * Math.sin(time * 0.5),
    timer: 734 + time, club: BAG[2], bag: BAG, swing: walk ? null : swing, clubPanel: walk ? null : club,
    hint: walk ? 'WASD walk · Shift run · F go to ball (42 yd) · RMB rangefinder · Ctrl crouch' : 'Hold LMB and drag up-left to swing · A/D face · Q/E path · Z/C aim · X practice',
    rangefinder: walk ? { distance: 138.2, elevation: -4.5 } : null, ballInFlight: false, distanceToBall: walk ? 38 : 0, units: 'yards',
    player: { x: hole.tee[0] + 2, z: hole.tee[1] - 8, yaw: Math.PI * 0.95 }, ball: { x: hole.tee[0] + 1, z: hole.tee[1] - 12 }, pin: { x: hole.pin[0], z: hole.pin[1] },
  };
}

const report: ShotReport = {
  club: '7 Iron', clubSpeedMph: 86.4, face: 1.2, path: -0.6, faceToPath: 1.8, attack: -4.1, dynamicLoft: 27.5, ballSpeedMph: 117.8, smash: 1.36,
  launchV: 18.2, launchH: 0.9, spinRpm: 6840, spinAxis: 4.2, carry: 139.1, total: 147.6, offline: 3.4, apex: 27.2, quality: 'pure', result: 'green', practice: false,
};

const round: RoundView = {
  courseName: 'Thornbury Links',
  holes: HOLES.map((hd, i) => ({ number: hd.number, par: hd.par, strokes: i < 8 ? [4, 5, 2, 6, 4, 3, 7, 4][i] : state === 'final' ? 4 : null, putts: i < 8 ? [2, 2, 1, 2, 1, 2, 3, 2][i] : 0, fairway: hd.par >= 4 ? i % 3 !== 1 : null, gir: i % 2 === 0, penalties: i === 6 ? 1 : 0 })),
  totalStrokes: 35 + (state === 'final' ? 4 : 0), totalPar: HOLES.reduce((s, x) => s + x.par, 0), timer: 1820, finished: state === 'final',
  best: { strokes: state === 'final' ? 39 : 41, time: 1795 }, splits: [180, 420, 560, 830, 1010, 1180, 1480, 1650, 1820].slice(0, state === 'final' ? 9 : 8),
};

// ── states ──
if (state === 'loading') {
  ui.setLoading(0.58, 'Growing grass and trees…');
} else if (state === 'title' || state === 'settings' || state === 'controls' || state === 'practice') {
  ui.showTitle(round);
  const click = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.tl-btn')].find((b) => b.textContent?.startsWith(label))?.click();
  if (state === 'settings') {
    click('Settings');
    const tab = q.get('tab');
    if (tab) [...document.querySelectorAll<HTMLButtonElement>('.tl-tab')].find((b) => b.textContent?.toLowerCase() === tab)?.click();
  }
  if (state === 'controls') click('Controls');
  if (state === 'practice') click('Practice');
} else {
  let t0 = performance.now();
  let last = t0;
  const frame = () => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    const time = (now - t0) / 1000;
    let t = freezeT !== null ? freezeT : time % 4;
    let sv: SwingPanelView;
    if (freezeT !== null) {
      // Build up path/trail by simulating the cycle up to the freeze time.
      if (!(window as unknown as { __warm?: boolean }).__warm) {
        (window as unknown as { __warm?: boolean }).__warm = true;
        for (let s = 0; s < 4; s += 1 / 60) swingView(s, 1 / 60); // previous swing → ghost
        swingView(0, 1 / 60);
        for (let s = 0; s < t; s += 1 / 120) {
          const v = swingView(s, 1 / 120);
          (ui as unknown as { swing: { update: (v: SwingPanelView, dt: number) => void } }).swing.update(v, 1 / 120);
        }
      }
      swingView(t - 1 / 120, 1 / 120, false);
      sv = swingView(t, 1 / 120, false);
    } else sv = swingView(t, dt);
    ui.update(hudView(t, sv, time));
    // Frozen swing: draw once so the (time-based) clubhead trail stays visible for screenshots.
    if (freezeT === null) requestAnimationFrame(frame);
  };
  frame();
  if (state === 'hud' || state === 'walk') {
    ui.holeIntro(hole.number, hole.name, hole.par, 168, hole.blurb);
    setTimeout(() => ui.toast('Practice swing — the ball is safe', 'info'), 200);
    setTimeout(() => ui.toast('Water hazard — penalty stroke.', 'bad'), 400);
    if (state === 'hud') setTimeout(() => ui.showShotReport(report), 300);
  }
  if (state === 'pause') ui.showPause();
  if (state === 'scorecard' || state === 'final') setTimeout(() => ui.showScorecard(round, state === 'final'), 50);
  if (state === 'big') setTimeout(() => ui.toast('Birdie — 2 strokes', 'big'), 50);
}
(window as unknown as { __uiReady: boolean; __ui: unknown }).__ui = ui;
(window as unknown as { __uiReady: boolean }).__uiReady = true;
