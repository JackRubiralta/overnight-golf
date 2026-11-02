/**
 * Adversarial review: regression tests for bugs found in review. Tests marked `it.fails` document a
 * bug that is still present (they pass while the bug exists); flip them to `it` once it is fixed.
 */
import { describe, it, expect, vi } from 'vitest';

/** Minimal Input stand-in for SwingController: no keys, gamepad right stick only. */
function padInput() {
  return {
    padHands: null as { x: number; y: number } | null,
    held: () => false,
    pressed: () => false,
    released: () => false,
    consumeSwingDelta: () => ({ dx: 0, dy: 0 }),
  };
}

describe('review: SwingController gamepad swings', () => {
  /** Violent stick flick: full pull back, then slam to full forward (flails the hands). */
  async function flick(ctrl: any, inp: ReturnType<typeof padInput>, dt = 1 / 60) {
    let res = null;
    for (let i = 0; i < 50; i++) {
      inp.padHands = { x: 0, y: 1 }; // pulled down = backswing
      ctrl.update(inp, dt, true);
    }
    for (let i = 0; i < 40; i++) {
      inp.padHands = { x: 0, y: -1 }; // pushed up = through
      res = ctrl.update(inp, dt, true) ?? res;
    }
    inp.padHands = null; // release the stick
    for (let i = 0; i < 150; i++) ctrl.update(inp, dt, true); // > 1.4 s follow-through reset
    return res;
  }

  it('a violent pad swing accumulates face flail (precondition)', async () => {
    const { SwingController } = await import('../src/swing/SwingController');
    const c: any = new SwingController();
    c.address('fairway', false, 2);
    c.practice = true;
    const inp = padInput();
    await flick(c, inp);
    expect(c.flail).toBeGreaterThan(0);
  });

  // SwingController.update(): the mouse "fresh grab" branch resets flail/driftSeed, the gamepad branch
  // (src/swing/SwingController.ts:209-214) does not, so flail from a practice swing (or a whiff)
  // leaks into the next real swing at the same address (extra toe/heel strikes and face twist).
  it.fails('flail does not carry over from one gamepad swing to the next', async () => {
    const { SwingController } = await import('../src/swing/SwingController');
    const c: any = new SwingController();
    c.address('fairway', false, 2);
    c.practice = true;
    const inp = padInput();
    await flick(c, inp);
    const after1 = c.flail;
    c.practice = false;
    // Start a gentle new swing: the stick just leaves the dead zone.
    inp.padHands = { x: 0, y: 0.3 };
    c.update(inp, 1 / 60, true);
    expect(after1).toBeGreaterThan(0);
    expect(c.flail).toBe(0);
  });
});

describe('review: persisted settings validation', () => {
  const load = async (saved: unknown) => {
    vi.resetModules();
    const store: Record<string, string> = { 'tl-golf.settings.v1': JSON.stringify(saved) };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    });
    try {
      return (await import('../src/core/settings')).settings;
    } finally {
      vi.unstubAllGlobals();
    }
  };

  // settings.ts merges localStorage over the defaults without validating enum values. World's
  // constructor does QUALITY[settings.get('quality')].drawDistance and Wind does WEATHER[weather].min,
  // so one stale/invalid value (old version, manual edit, another app on the origin) throws during
  // boot, every time, until site data is cleared (reproduced in scripts/review-runtime.mjs).
  it.fails('an unknown persisted quality falls back to a valid preset', async () => {
    const s = await load({ quality: 'epic' });
    expect(['low', 'medium', 'high', 'ultra']).toContain(s.get('quality'));
  });
  it.fails('an unknown persisted weather falls back to a valid preset', async () => {
    const s = await load({ weather: 'storm' });
    expect(['calm', 'breezy', 'windy', 'rain']).toContain(s.get('weather'));
  });
});
