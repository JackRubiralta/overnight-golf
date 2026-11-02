/**
 * The rebinding API the UI EXPECTS from src/core/Input.ts (implemented concurrently by the
 * input builder). Every call goes through the defensive wrappers below, so a missing method
 * degrades gracefully (defaults shown, rebinding disabled) instead of throwing.
 */
import { DEFAULT_KEYS, DEFAULT_PAD, type Action, type KeyBindings, type PadBindings } from '../core/actions';

export type BindDevice = 'kbm' | 'pad';

export interface RebindableInput {
  /** Current keyboard/mouse bindings (KeyboardEvent.code, "Mouse0", "WheelUp", …). */
  getKeyBindings(): KeyBindings;
  /** Current gamepad bindings (Standard Gamepad button indices). */
  getPadBindings(): PadBindings;
  /**
   * Capture the next key/mouse button (kbm) or gamepad button (pad). The callback receives the
   * code / button index, or null when cancelled (Escape / timeout). While capturing, the input
   * system must not fire game actions for that press.
   */
  captureNext(device: BindDevice, cb: (code: string | number | null) => void): void;
  setKeyBinding(action: Action, index: number, code: string | null): void;
  setPadBinding(action: Action, index: number, button: number | null): void;
  resetBindings(): void;
  /** Optional: cancel an in-progress capture. */
  cancelCapture?(): void;
  /** Last device used, for button prompts. */
  lastDevice?: 'kbm' | 'pad';
}

type Maybe = Partial<RebindableInput> & Record<string, unknown>;

/** Defensive adapter around whatever Input object we were given. */
export class InputBridge {
  constructor(private readonly input: unknown) {}
  private get i(): Maybe {
    return (this.input ?? {}) as Maybe;
  }
  get canRebind(): boolean {
    return typeof this.i.setKeyBinding === 'function' || typeof this.i.setPadBinding === 'function';
  }
  get hasCapture(): boolean {
    return typeof this.i.captureNext === 'function';
  }
  keys(): KeyBindings {
    try {
      const k = this.i.getKeyBindings?.();
      if (k) return { ...DEFAULT_KEYS, ...k };
    } catch {
      /* fall through */
    }
    return DEFAULT_KEYS;
  }
  pad(): PadBindings {
    try {
      const p = this.i.getPadBindings?.();
      if (p) return { ...DEFAULT_PAD, ...p };
    } catch {
      /* fall through */
    }
    return DEFAULT_PAD;
  }
  capture(device: BindDevice, cb: (code: string | number | null) => void) {
    if (typeof this.i.captureNext === 'function') {
      try {
        this.i.captureNext(device, cb);
        return;
      } catch {
        /* use the fallback below */
      }
    }
    fallbackCapture(device, cb);
  }
  cancelCapture() {
    try {
      this.i.cancelCapture?.();
    } catch {
      /* ignore */
    }
    cancelFallback?.();
  }
  setKey(action: Action, index: number, code: string | null): boolean {
    if (typeof this.i.setKeyBinding !== 'function') return false;
    try {
      this.i.setKeyBinding(action, index, code);
      return true;
    } catch {
      return false;
    }
  }
  setPad(action: Action, index: number, button: number | null): boolean {
    if (typeof this.i.setPadBinding !== 'function') return false;
    try {
      this.i.setPadBinding(action, index, button);
      return true;
    } catch {
      return false;
    }
  }
  reset(): boolean {
    if (typeof this.i.resetBindings !== 'function') return false;
    try {
      this.i.resetBindings();
      return true;
    } catch {
      return false;
    }
  }
  get lastDevice(): 'kbm' | 'pad' {
    return this.i.lastDevice === 'pad' ? 'pad' : 'kbm';
  }
}

let cancelFallback: (() => void) | null = null;

/** Used only if Input has no captureNext(): listens on window directly (capture phase). */
function fallbackCapture(device: BindDevice, cb: (code: string | number | null) => void) {
  cancelFallback?.();
  let raf = 0;
  const done = (v: string | number | null) => {
    cleanup();
    cb(v);
  };
  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return done(null);
    if (device === 'kbm') done(e.code);
  };
  const onMouse = (e: MouseEvent) => {
    if (device !== 'kbm') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    done(`Mouse${e.button}`);
  };
  const onWheel = (e: WheelEvent) => {
    if (device !== 'kbm') return;
    e.preventDefault();
    done(e.deltaY < 0 ? 'WheelUp' : 'WheelDown');
  };
  const pressedBefore = new Set<string>();
  const poll = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      p.buttons.forEach((b, i) => {
        const id = `${p.index}:${i}`;
        if (b.pressed && !pressedBefore.has(id)) {
          if (device === 'pad') done(i);
        }
        if (b.pressed) pressedBefore.add(id);
        else pressedBefore.delete(id);
      });
    }
    raf = requestAnimationFrame(poll);
  };
  const cleanup = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('wheel', onWheel, true);
    cancelAnimationFrame(raf);
    cancelFallback = null;
  };
  // Defer so the click that started the capture is not captured itself.
  setTimeout(() => {
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    poll();
  }, 0);
  cancelFallback = () => {
    cleanup();
    cb(null);
  };
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Escape: 'Esc', Enter: 'Enter', Backspace: 'Bksp', Backquote: '`',
  ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl',
  AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Meta', MetaRight: 'R Meta', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
};

/** Human label for a KeyboardEvent.code / mouse binding. */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];
export function padLabel(b: number): string {
  return PAD_NAMES[b] ?? `B${b}`;
}
