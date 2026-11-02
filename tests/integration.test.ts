/**
 * End-to-end: fake mouse/keyboard input → SwingController → SwingModel → impact → BallSim.
 * Verifies that a smooth mouse swing produces a sensible golf shot and that A/D, Q/E change it
 * the way they should.
 */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { SwingController } from '../src/swing/SwingController';
import { computeLaunch, launchToWorld } from '../src/physics/impact';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { settings } from '../src/core/settings';
import { DEG, MPH, YARD } from '../src/config';
import type { Action } from '../src/core/actions';

class FakeInput {
  heldSet = new Set<Action>();
  pressedSet = new Set<Action>();
  dx = 0;
  dy = 0;
  padHands = null;
  held(a: Action) {
    return this.heldSet.has(a);
  }
  pressed(a: Action) {
    return this.pressedSet.has(a);
  }
  released() {
    return false;
  }
  consumeSwingDelta() {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return d;
  }
}

function swingShot(opts: { club?: number; faceTaps?: number; pathTaps?: number; tDown?: number; back?: number; radius?: number; lie?: 'fairway' | 'tee' } = {}) {
  settings.data.mouseSmoothing = 0;
  settings.data.mouseSensitivity = 1;
  settings.data.assist = 'full'; // no drift → deterministic direction checks
  const sc = new SwingController();
  const input = new FakeInput();
  sc.address(opts.lie ?? 'tee', (opts.lie ?? 'tee') === 'tee', opts.club ?? 0);
  // Taps: D opens face, A closes; Q in-to-out, E out-to-in.
  const tap = (a: Action) => {
    input.pressedSet.add(a);
    sc.update(input as never, 1 / 60);
    input.pressedSet.clear();
  };
  for (let i = 0; i < Math.abs(opts.faceTaps ?? 0); i++) tap((opts.faceTaps ?? 0) > 0 ? 'faceOpen' : 'faceClose');
  for (let i = 0; i < Math.abs(opts.pathTaps ?? 0); i++) tap((opts.pathTaps ?? 0) > 0 ? 'pathIn' : 'pathOut');
  const m = sc.model;
  const S = m.geo.shoulder;
  const R = m.geo.armLen * (opts.radius ?? 1);
  const PX = 0.0021; // must match SwingController PX_TO_M
  const back = (opts.back ?? 115) * DEG;
  const through = 110 * DEG;
  const tBack = 0.9;
  const tDown = opts.tDown ?? 0.45;
  const dt = 1 / 120;
  input.heldSet.add('swingGrab');
  let t = 0;
  let res = null as ReturnType<SwingController['update']>;
  let prev = { x: m.cursor.x, y: m.cursor.y };
  while (t < tBack + 0.1 + tDown + 0.5 && !res) {
    let th: number;
    if (t < tBack) th = (-back * (1 - Math.cos((t / tBack) * Math.PI))) / 2;
    else if (t < tBack + 0.1) th = -back;
    else {
      const u = Math.min(1, (t - tBack - 0.1) / tDown);
      th = -back + (back + through) * u * u * (3 - 2 * u);
    }
    const tx = S.x + Math.sin(th) * R;
    const ty = S.y - Math.cos(th) * R;
    // SwingController maps mouse right → +x (toward target), mouse down (+dy) → -y.
    input.dx += (tx - prev.x) / PX;
    input.dy += -(ty - prev.y) / PX;
    prev = { x: tx, y: ty };
    res = sc.update(input as never, dt);
    t += dt;
  }
  expect(res, 'swing should reach the ball').not.toBeNull();
  const launch = computeLaunch(res!.delivery, () => 0.5);
  const sim = new BallSim({ terrain: new FlatTerrain('fairway') });
  sim.place(new Vector3());
  const { velocity, spin } = launchToWorld(launch, new Vector3(0, 0, -1));
  sim.launch(velocity, spin);
  sim.simulate();
  return {
    res: res!,
    launch,
    carry: -(sim.carryPos?.z ?? 0) / YARD,
    total: -sim.pos.z / YARD,
    offline: sim.pos.x / YARD,
  };
}

describe('mouse swing → ball flight (end to end)', () => {
  it('a smooth full driver swing from the tee goes a long way, roughly straight', () => {
    const r = swingShot();
    console.log('driver', (r.res.delivery.clubSpeed / MPH).toFixed(1), 'mph', r.launch.quality, 'carry', r.carry.toFixed(0), 'offline', r.offline.toFixed(1), 'launch', r.launch.launchV.toFixed(1), 'spin', r.launch.spinRpm.toFixed(0), 'strikeV', r.res.delivery.strikeV.toFixed(1), 'attack', r.res.delivery.attackAngle.toFixed(1));
    expect(r.carry).toBeGreaterThan(180);
    expect(r.carry).toBeLessThan(300);
    expect(Math.abs(r.offline)).toBeLessThan(30);
  });
  it('a slower swing goes shorter', () => {
    const fast = swingShot({ club: 2, lie: 'fairway' });
    const slow = swingShot({ club: 2, lie: 'fairway', tDown: 0.9 });
    console.log('7i fast', fast.carry.toFixed(0), fast.launch.quality, 'slow', slow.carry.toFixed(0), slow.launch.quality);
    expect(slow.carry).toBeLessThan(fast.carry * 0.85);
  });
  it('opening the face with D starts it right; closing with A starts it left', () => {
    const open = swingShot({ club: 2, lie: 'fairway', faceTaps: 8 });
    const closed = swingShot({ club: 2, lie: 'fairway', faceTaps: -8 });
    expect(open.launch.launchH).toBeGreaterThan(2);
    expect(closed.launch.launchH).toBeLessThan(-2);
    expect(open.offline).toBeGreaterThan(closed.offline + 10);
  });
  it('Q (in-to-out) with a square face draws; E (out-to-in) fades', () => {
    const draw = swingShot({ club: 2, lie: 'fairway', pathTaps: 10 });
    const fade = swingShot({ club: 2, lie: 'fairway', pathTaps: -10 });
    expect(draw.launch.spinAxis).toBeLessThan(0);
    expect(fade.launch.spinAxis).toBeGreaterThan(0);
  });
  it('dragging the hands past the arm circle hits it fat', () => {
    const fat = swingShot({ club: 2, lie: 'fairway', radius: 1.25 });
    console.log('fat test', fat.launch.quality, fat.res.delivery.fat, fat.res.impact.soleHeight, fat.res.impact.fatDepth);
    expect(['fat', 'good']).toContain(fat.launch.quality);
    expect(fat.res.delivery.fat).toBeGreaterThan(0.1);
  });
});
