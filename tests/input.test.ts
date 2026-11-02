/**
 * Input tests with a minimal fake DOM: Node's EventTarget stands in for window/document/canvas and
 * synthetic events are plain Events with the fields Input reads (code, button, clientX, ...).
 */
import { beforeEach, describe, expect, it } from 'vitest';

// In-memory localStorage (must exist before Input/settings modules load).
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const { Input } = await import('../src/core/Input');
const { DEFAULT_KEYS } = await import('../src/core/actions');
const { AudioSystem } = await import('../src/audio/Audio');

type Pad = { id: string; connected: boolean; mapping: string; buttons: { pressed: boolean; value: number }[]; axes: number[]; vibrationActuator?: unknown };

function makePad(): Pad {
  return {
    id: 'Fake pad',
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
}

function setup(lockAllowed = true) {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, visibilityState: 'visible', exitPointerLock() {} });
  let lockRequests = 0;
  const canvas = Object.assign(new EventTarget(), {
    requestPointerLock() {
      lockRequests++;
      return Promise.reject(Object.assign(new Error('no lock in tests'), { name: 'NotAllowedError' }));
    },
  });
  const pads: (Pad | null)[] = [null];
  // Same clock as Event.timeStamp (capture ignores events created before it was armed).
  let now = performance.now();
  const input = new Input(canvas as any, {
    win,
    doc: doc as any,
    getGamepads: () => pads as any,
    now: () => now,
    hasActivation: () => true,
    lockAllowed: () => lockAllowed,
  });
  const ev = (type: string, props: Record<string, unknown> = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), props);
    win.dispatchEvent(e);
    return e;
  };
  const key = (code: string, down: boolean) => ev(down ? 'keydown' : 'keyup', { code });
  /** One game frame. */
  const frame = (fn?: () => void) => {
    input.update();
    fn?.();
    input.endFrame();
  };
  return {
    input, win, doc, canvas, pads, ev, key, frame,
    get lockRequests() { return lockRequests; },
    advance(ms: number) { now += ms; },
  };
}

beforeEach(() => store.clear());

describe('Input: keyboard & context', () => {
  it('fires pressed / held / released edges', () => {
    const t = setup();
    t.input.setContext('stance');
    t.key('KeyD', true);
    let p = false;
    let h = false;
    t.frame(() => {
      p = t.input.pressed('faceOpen');
      h = t.input.held('faceOpen');
    });
    expect(p).toBe(true);
    expect(h).toBe(true);
    t.frame(() => {
      p = t.input.pressed('faceOpen');
      h = t.input.held('faceOpen');
    });
    expect(p).toBe(false);
    expect(h).toBe(true);
    t.key('KeyD', false);
    let r = false;
    t.frame(() => {
      r = t.input.released('faceOpen');
      h = t.input.held('faceOpen');
    });
    expect(r).toBe(true);
    expect(h).toBe(false);
  });

  it('shared keys are context-sensitive (A = face in stance, strafe in walk)', () => {
    const t = setup();
    t.input.setContext('stance');
    t.key('KeyA', true);
    let face = false;
    let strafe = false;
    t.frame(() => {
      face = t.input.held('faceClose');
      strafe = t.input.held('moveLeft');
    });
    expect([face, strafe]).toEqual([true, false]);
    t.key('KeyA', false);
    t.frame();
    t.input.setContext('walk');
    t.key('KeyA', true);
    t.frame(() => {
      face = t.input.held('faceClose');
      strafe = t.input.held('moveLeft');
    });
    expect([face, strafe]).toEqual([false, true]);
  });

  it('keys held across a context switch do not leak into the new context', () => {
    const t = setup();
    t.input.setContext('walk');
    t.key('KeyW', true);
    t.frame();
    t.input.setContext('stance');
    let held = true;
    t.frame(() => (held = t.input.held('stanceForward')));
    expect(held).toBe(false);
    t.key('KeyW', false);
    t.frame();
    t.key('KeyW', true);
    t.frame(() => (held = t.input.held('stanceForward')));
    expect(held).toBe(true);
  });

  it('a tap inside one frame still registers; double taps become two pressed edges', () => {
    const t = setup();
    t.input.setContext('stance');
    t.key('KeyQ', true);
    t.key('KeyQ', false);
    t.key('KeyQ', true);
    t.key('KeyQ', false);
    const presses: boolean[] = [];
    for (let i = 0; i < 3; i++) t.frame(() => presses.push(t.input.pressed('pathIn')));
    expect(presses).toEqual([true, true, false]);
  });

  it('ignores auto-repeat and typing in text inputs', () => {
    const t = setup();
    t.input.setContext('stance');
    t.ev('keydown', { code: 'KeyE' });
    t.frame();
    t.ev('keydown', { code: 'KeyE', repeat: true });
    let p = true;
    t.frame(() => (p = t.input.pressed('pathOut')));
    expect(p).toBe(false);
    // Typing in a text field: override the (read-only) target with a fake <input>.
    const field = { tagName: 'INPUT', type: 'text' };
    const e = new Event('keydown', { cancelable: true });
    Object.defineProperty(e, 'target', { value: field });
    Object.assign(e, { code: 'KeyR' });
    t.win.dispatchEvent(e);
    t.frame(() => (p = t.input.pressed('resetFacePath')));
    expect(p).toBe(false);
  });

  it('prevents default for Tab/Space in game but not in menus', () => {
    const t = setup();
    t.input.setContext('menu');
    expect(t.key('Tab', true).defaultPrevented).toBe(false);
    t.key('Tab', false);
    t.input.setContext('stance');
    expect(t.key('Space', true).defaultPrevented).toBe(true);
    expect(t.key('Tab', true).defaultPrevented).toBe(true);
  });

  it('releases everything on blur', () => {
    const t = setup();
    t.input.setContext('walk');
    t.key('KeyW', true);
    t.frame();
    t.ev('blur');
    let held = true;
    t.frame(() => (held = t.input.held('moveForward')));
    expect(held).toBe(false);
  });
});

describe('Input: mouse', () => {
  it('accumulates swing deltas only while LMB is held in stance (no pointer lock)', () => {
    const t = setup();
    t.input.setContext('stance');
    t.ev('mousemove', { clientX: 100, clientY: 100 });
    t.ev('mousemove', { clientX: 150, clientY: 100 });
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 0, dy: 0 });
    t.ev('mousedown', { button: 0, clientX: 150, clientY: 100 });
    expect(t.lockRequests).toBe(1); // requested inside the gesture, rejected → fallback
    t.ev('mousemove', { clientX: 170, clientY: 90 });
    t.ev('mousemove', { clientX: 200, clientY: 60 });
    let grab = false;
    t.frame(() => (grab = t.input.held('swingGrab')));
    expect(grab).toBe(true);
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 50, dy: -40 });
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 0, dy: 0 });
    t.ev('mouseup', { button: 0 });
    t.ev('mousemove', { clientX: 260, clientY: 60 });
    let rel = false;
    t.frame(() => (rel = t.input.released('swingGrab')));
    expect(rel).toBe(true);
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 0, dy: 0 });
  });

  it('never requests pointer lock when lock is disallowed (automation) but still swings', () => {
    const t = setup(false);
    t.input.setContext('stance');
    t.ev('mousedown', { button: 0, clientX: 0, clientY: 0 });
    t.ev('mousemove', { clientX: 30, clientY: -10 });
    expect(t.lockRequests).toBe(0);
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 30, dy: -10 });
  });

  it('uses movementX/Y when pointer locked', () => {
    const t = setup();
    t.input.setContext('stance');
    t.doc.pointerLockElement = t.canvas;
    t.ev('mousedown', { button: 0, clientX: 10, clientY: 10 });
    t.ev('mousemove', { clientX: 10, clientY: 10, movementX: 7, movementY: -3 });
    t.ev('mousemove', { clientX: 10, clientY: 10, movementX: 5, movementY: -2 });
    t.ev('mousemove', { clientX: 10, clientY: 10, movementX: 5000, movementY: 0 }); // spike dropped
    expect(t.input.consumeSwingDelta()).toEqual({ dx: 12, dy: -5 });
    expect(t.input.pointerLocked).toBe(true);
  });

  it('mouse-look in walk mode while locked, or while dragging without lock', () => {
    const t = setup();
    t.input.setContext('walk');
    t.doc.pointerLockElement = t.canvas;
    t.ev('mousemove', { clientX: 0, clientY: 0, movementX: 4, movementY: 2 });
    expect(t.input.consumeLookDelta()).toEqual({ dx: 4, dy: 2 });
    t.doc.pointerLockElement = null;
    t.ev('mousemove', { clientX: 0, clientY: 0, movementX: 4, movementY: 2 });
    t.ev('mousemove', { clientX: 9, clientY: 0, movementX: 9, movementY: 0 });
    expect(t.input.consumeLookDelta()).toEqual({ dx: 0, dy: 0 });
    t.ev('mousedown', { button: 2, clientX: 9, clientY: 0 });
    t.ev('mousemove', { clientX: 19, clientY: 5 });
    expect(t.input.consumeLookDelta()).toEqual({ dx: 10, dy: 5 });
    // RMB is the rangefinder while walking too.
    let rf = false;
    t.frame(() => (rf = t.input.held('rangefinder')));
    expect(rf).toBe(true);
  });

  it('wheel produces one-frame edge actions, rate-limited', () => {
    const t = setup();
    t.input.setContext('stance');
    t.ev('wheel', { deltaY: 100, deltaMode: 0 });
    t.ev('wheel', { deltaY: 100, deltaMode: 0 }); // within the min gap → ignored
    let next = false;
    let held = false;
    t.frame(() => {
      next = t.input.pressed('clubNext');
      held = t.input.held('clubNext');
    });
    expect(next).toBe(true);
    expect(held).toBe(true);
    t.frame(() => (next = t.input.pressed('clubNext')));
    expect(next).toBe(false);
    t.advance(200);
    t.ev('wheel', { deltaY: -120, deltaMode: 0 });
    let prev = false;
    t.frame(() => (prev = t.input.pressed('clubPrev')));
    expect(prev).toBe(true);
  });
});

describe('Input: gamepad', () => {
  it('maps buttons, triggers (>0.5) and sticks with deadzones by context', () => {
    const t = setup();
    const pad = makePad();
    t.pads[0] = pad;
    t.input.setContext('stance');
    pad.buttons[5] = { pressed: true, value: 1 }; // RB → faceOpen
    pad.buttons[6] = { pressed: false, value: 0.3 }; // LT below threshold
    pad.axes = [0.05, 0.05, 0.5, 0.8];
    let open = false;
    let pathIn = true;
    t.frame(() => {
      open = t.input.pressed('faceOpen');
      pathIn = t.input.held('pathIn');
    });
    expect(open).toBe(true);
    expect(pathIn).toBe(false);
    expect(t.input.lastDevice).toBe('pad');
    expect(t.input.padMove).toEqual({ x: 0, y: 0 });
    expect(t.input.padHands).not.toBeNull();
    const hands = t.input.padHands!;
    expect(Math.hypot(hands.x, hands.y)).toBeGreaterThan(0.8);
    expect(hands.y).toBeGreaterThan(hands.x);
    pad.buttons[6] = { pressed: false, value: 0.7 };
    t.frame(() => (pathIn = t.input.pressed('pathIn')));
    expect(pathIn).toBe(true);
    // Walk: right stick becomes look; padHands goes away.
    t.input.setContext('walk');
    pad.axes = [0, -1, 1, 0];
    t.frame();
    expect(t.input.padHands).toBeNull();
    expect(t.input.padLook.x).toBeCloseTo(1, 5);
    expect(t.input.padMove.y).toBeCloseTo(-1, 5);
  });

  it('no pad → padHands null', () => {
    const t = setup();
    t.input.setContext('stance');
    t.frame();
    expect(t.input.padHands).toBeNull();
  });

  it('vibrate uses dual-rumble when available', () => {
    const t = setup();
    const pad = makePad();
    const calls: unknown[] = [];
    pad.vibrationActuator = { effects: ['dual-rumble'], playEffect: (type: string, o: unknown) => (calls.push([type, o]), Promise.resolve('complete')) };
    t.pads[0] = pad;
    t.frame();
    t.input.vibrate(0.6, 120);
    expect(calls.length).toBe(1);
    expect((calls[0] as any)[0]).toBe('dual-rumble');
  });
});

describe('Input: bindings & capture', () => {
  it('rebinding persists to localStorage and reloads', () => {
    const t = setup();
    t.input.setKeyBinding('faceOpen', 0, 'KeyL');
    t.input.setPadBinding('retake', 0, 3);
    expect(t.input.getKeyBindings().faceOpen).toEqual(['KeyL']);
    const t2 = setup();
    expect(t2.input.getKeyBindings().faceOpen).toEqual(['KeyL']);
    expect(t2.input.getPadBindings().retake).toEqual([3]);
    t2.input.setContext('stance');
    t2.key('KeyL', true);
    let open = false;
    t2.frame(() => (open = t2.input.held('faceOpen')));
    expect(open).toBe(true);
    t2.input.resetBindings();
    expect(t2.input.getKeyBindings().faceOpen).toEqual(DEFAULT_KEYS.faceOpen);
    expect(setup().input.getKeyBindings().faceOpen).toEqual(DEFAULT_KEYS.faceOpen);
  });

  it('second slot and clearing', () => {
    const t = setup();
    t.input.setKeyBinding('aimLeft', 1, 'KeyJ');
    expect(t.input.getKeyBindings().aimLeft).toEqual(['KeyZ', 'KeyJ']);
    t.input.setKeyBinding('aimLeft', 0, null);
    expect(t.input.getKeyBindings().aimLeft).toEqual(['KeyJ']);
  });

  it('findConflicts ignores walk/stance shared keys', () => {
    const t = setup();
    expect(t.input.findConflicts('faceOpen', 'KeyD')).toEqual([]);
    expect(t.input.findConflicts('faceOpen', 'KeyQ')).toContain('pathIn');
  });

  it('captureNext reports the next key instead of acting on it; Escape cancels', () => {
    const t = setup();
    t.input.setContext('stance');
    const got: (string | number | null)[] = [];
    t.input.captureNext('kbm', (c) => got.push(c));
    t.key('KeyQ', true);
    let p = true;
    t.frame(() => (p = t.input.pressed('pathIn')));
    expect(p).toBe(false);
    expect(got).toEqual(['KeyQ']);
    t.key('KeyQ', false);
    t.input.captureNext('kbm', (c) => got.push(c));
    t.key('Escape', true);
    expect(got).toEqual(['KeyQ', null]);
    t.input.captureNext('kbm', (c) => got.push(c));
    t.ev('mousedown', { button: 2 });
    expect(got).toEqual(['KeyQ', null, 'Mouse2']);
  });

  it('captureNext("pad") reports the next pad button', () => {
    const t = setup();
    const pad = makePad();
    t.pads[0] = pad;
    t.input.setContext('stance');
    t.frame();
    const got: (string | number | null)[] = [];
    t.input.captureNext('pad', (c) => got.push(c));
    pad.buttons[2] = { pressed: true, value: 1 }; // X = retake by default
    let retake = true;
    t.frame(() => (retake = t.input.pressed('retake')));
    expect(got).toEqual([2]);
    expect(retake).toBe(false);
  });
});

describe('AudioSystem without Web Audio', () => {
  it('every method is a safe no-op', () => {
    const a = new AudioSystem();
    expect(() => {
      a.unlock();
      a.swingUpdate(90);
      a.strike('pure', 'driver', 100, 'tee');
      a.bounce('green', 5);
      a.roll('green', 2);
      a.cup();
      a.splash(0.5);
      a.propHit('gong', 10);
      a.ui('tick');
      a.adjust('face');
      a.crowd('applause');
      a.update(0.016, 4);
      a.setVolumes(1, 1, 1);
    }).not.toThrow();
    expect(a.ready).toBe(false);
  });
});
