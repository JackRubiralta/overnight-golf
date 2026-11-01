/**
 * STUB — Input (owner: input+audio builder): keyboard, mouse (pointer lock), wheel, gamepad,
 * remappable bindings saved to localStorage (try/catch), rebinding capture, rumble.
 *
 * Contract used by the game:
 *  - input.setContext('walk' | 'stance' | 'menu') — context decides which actions are live when keys
 *    are shared (W/S = walk vs stance, A/D = strafe vs face).
 *  - held(a) / pressed(a) (edge this frame) / released(a)
 *  - consumeSwingDelta(): {dx, dy} accumulated raw mouse movement (px) while swingGrab is held
 *    (pointer locked) — plus the gamepad right-stick hand position in padHands.
 *  - consumeLookDelta(): {dx, dy} mouse-look delta in walk mode (pointer locked).
 *  - endFrame() after the game update, to clear edge states.
 */
import type { Action } from './actions';

export type InputContext = 'walk' | 'stance' | 'menu';

export class Input {
  context: InputContext = 'menu';
  /** Right stick position (-1..1) when a gamepad is used for the swing; null if none. */
  padHands: { x: number; y: number } | null = null;
  /** Left stick (walk). */
  padMove = { x: 0, y: 0 };
  /** Right stick look (walk mode). */
  padLook = { x: 0, y: 0 };
  /** Last device used: 'kbm' or 'pad' (for UI prompts). */
  lastDevice: 'kbm' | 'pad' = 'kbm';
  constructor(_canvas: HTMLElement) {}
  setContext(c: InputContext) {
    this.context = c;
  }
  held(_a: Action): boolean {
    return false;
  }
  pressed(_a: Action): boolean {
    return false;
  }
  released(_a: Action): boolean {
    return false;
  }
  consumeSwingDelta() {
    return { dx: 0, dy: 0 };
  }
  consumeLookDelta() {
    return { dx: 0, dy: 0 };
  }
  get pointerLocked() {
    return false;
  }
  requestPointerLock() {}
  exitPointerLock() {}
  vibrate(_strength: number, _ms: number) {}
  /** Poll gamepads; call at the start of each frame. */
  update() {}
  endFrame() {}
}
