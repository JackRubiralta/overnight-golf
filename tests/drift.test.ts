import { describe, it, expect } from 'vitest';
import { SwingController } from '../src/swing/SwingController';
import { settings } from '../src/core/settings';
import type { Action } from '../src/core/actions';

class FakeInput {
  heldSet = new Set<Action>();
  padHands = null;
  held(a: Action) { return this.heldSet.has(a); }
  pressed() { return false; }
  released() { return false; }
  consumeSwingDelta() { return { dx: 0, dy: 0 }; }
}

function run(correct: boolean, assist: 'off' | 'light' | 'full') {
  settings.data.assist = assist;
  const sc = new SwingController();
  sc.address('fairway', false, 2);
  const input = new FakeInput();
  input.heldSet.add('swingGrab'); // holding the hands = swing active
  let maxEff = 0;
  for (let i = 0; i < 90; i++) { // 1.5 s at 60 fps
    if (correct) {
      // A player fighting the drift: press A/D and Q/E against the live error.
      const ef = sc.face + sc.faceDrift;
      const ep = sc.path + sc.pathDrift;
      input.heldSet.delete('faceOpen'); input.heldSet.delete('faceClose');
      input.heldSet.delete('pathIn'); input.heldSet.delete('pathOut');
      if (ef > 0.3) input.heldSet.add('faceClose'); else if (ef < -0.3) input.heldSet.add('faceOpen');
      if (ep > 0.3) input.heldSet.add('pathOut'); else if (ep < -0.3) input.heldSet.add('pathIn');
    }
    sc.update(input as never, 1 / 60);
    maxEff = Math.max(maxEff, Math.abs(sc.face + sc.faceDrift), Math.abs(sc.path + sc.pathDrift));
  }
  return { face: sc.face + sc.faceDrift, path: sc.path + sc.pathDrift, maxEff };
}

describe('face/path drift during the swing', () => {
  it('runs away from square if you do nothing (assist off)', () => {
    const r = run(false, 'off');
    console.log('UNCORRECTED ' + JSON.stringify(r));
    expect(Math.max(Math.abs(r.face), Math.abs(r.path))).toBeGreaterThan(4);
  });
  it('can be held near square by correcting with A/D and Q/E', () => {
    const r = run(true, 'off');
    console.log('CORRECTED ' + JSON.stringify(r));
    expect(Math.abs(r.face)).toBeLessThan(1.5);
    expect(Math.abs(r.path)).toBeLessThan(1.5);
  });
  it('is disabled by the full assist', () => {
    const r = run(false, 'full');
    expect(r.maxEff).toBeLessThan(0.01);
  });
});
