/**
 * Input — keyboard, mouse (pointer lock with a no-lock fallback), wheel, gamepad, remappable
 * bindings saved to localStorage, rebinding capture and rumble.
 *
 * Contract used by the game:
 *  - input.setContext('walk' | 'stance' | 'menu') — context decides which actions are live when keys
 *    are shared (W/S = walk vs stance, A/D = strafe vs face). STANCE_ONLY actions fire only in
 *    'stance', WALK_ONLY only in 'walk'; everything else is shared (see CONTEXT_EXTRA for the two
 *    documented exceptions).
 *  - held(a) / pressed(a) (edge this frame) / released(a)
 *  - consumeSwingDelta(): {dx, dy} accumulated raw mouse movement (CSS px) while swingGrab is held
 *    — plus the gamepad right-stick hand position in padHands.
 *  - consumeLookDelta(): {dx, dy} mouse-look delta in walk mode (pointer locked, or while a mouse
 *    button is held when pointer lock is unavailable).
 *  - update() at the start of each frame, endFrame() after the game update, to clear edge states.
 *
 * Event model: DOM events are queued and applied in update(). If the same key is pressed twice
 * before a frame runs (fast taps on a slow frame), the second press is carried over to the next
 * frame so every tap produces exactly one pressed() edge. A key that goes down and up within one
 * frame still reports pressed() and held() for that frame.
 *
 * The constructor accepts an optional InputEnv so tests can pass fake event targets (the default
 * is the real window/document/navigator).
 */
import {
  ACTIONS,
  DEFAULT_KEYS,
  DEFAULT_PAD,
  STANCE_ONLY,
  WALK_ONLY,
  type Action,
  type KeyBindings,
  type PadBindings,
} from './actions';
import { settings } from './settings';
import { safeLoad, safeRemove, safeSave } from './storage';

export type InputContext = 'walk' | 'stance' | 'menu';

// ───────────────────────────── tuning ─────────────────────────────

/** localStorage key for remapped bindings. */
const BINDINGS_KEY = 'tl-golf.bindings.v1';
/** Max binding slots per action shown/edited by the UI. */
export const BINDING_SLOTS = 2;
/** Radial deadzones (fraction of stick throw). */
const DEADZONE_MOVE = 0.18;
const DEADZONE_LOOK = 0.15;
const DEADZONE_HANDS = 0.1;
/** Trigger threshold for counting an analog trigger as a pressed button. */
const TRIGGER_PRESS = 0.5;
/** Pad stick magnitude that marks the pad as the last-used device. */
const PAD_ACTIVITY = 0.35;
/** Wheel: delta (px) per notch-press, and the minimum gap between wheel presses (ms). */
const WHEEL_STEP = 40;
const WHEEL_MIN_GAP_MS = 90;
/** Pointer-locked mousemove deltas above this are treated as browser spikes and dropped. */
const LOCK_SPIKE_PX = 600;
/** After a failed lock request, don't retry for this long (ms) — Chrome has a re-lock cooldown. */
const LOCK_RETRY_MS = 400;
/**
 * A second tap of the same key before the next frame is carried over to the following frame so
 * every tap counts — but only while it is this fresh (ms). On very slow frames (headless software
 * rendering) older repeats are collapsed instead, so input never lags behind by seconds.
 */
const CARRY_MAX_MS = 150;
/** Queue cap — if the game loop isn't running, older events are applied immediately. */
const QUEUE_MAX = 128;
/** Keys whose browser default is suppressed during play (scrolling, focus moves, quick find). */
const PREVENT_KEYS = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote', 'Backspace', 'Backquote']);
/**
 * Actions that are also live outside their STANCE_ONLY / WALK_ONLY context. CONTROLS.md documents
 * RMB rangefinder while walking, and the game fast-forwards flight (stance context) with F
 * (returnToBall). Neither key has another binding in that context by default.
 */
const CONTEXT_EXTRA: Record<InputContext, Action[]> = {
  walk: ['rangefinder'],
  stance: ['returnToBall'],
  menu: [],
};

// ───────────────────────────── environment (DOM or fakes) ─────────────────────────────

type Listener = (e: any) => void;
export interface EventTargetLike {
  addEventListener(type: string, l: Listener, opts?: any): void;
  removeEventListener(type: string, l: Listener, opts?: any): void;
}
export interface CanvasLike extends EventTargetLike {
  requestPointerLock?: (opts?: any) => unknown;
}
export interface DocumentLike extends EventTargetLike {
  pointerLockElement?: unknown;
  exitPointerLock?: () => void;
  visibilityState?: string;
}
export interface InputEnv {
  /** Receives key, mouse move/up, wheel-free events and blur. */
  win: EventTargetLike | null;
  doc: DocumentLike | null;
  getGamepads: () => ArrayLike<Gamepad | null>;
  now: () => number;
  /** Whether a lock request is likely to be honoured right now (user activation). */
  hasActivation: () => boolean;
  /**
   * Whether pointer lock may be used at all. Off under automation (navigator.webdriver): headless
   * Chromium grants the lock but then reports garbage movement for synthetic mouse events, so the
   * unlocked clientX/Y fallback is used instead. `?nolock` in the URL also disables it.
   */
  lockAllowed: () => boolean;
}

function defaultEnv(): InputEnv {
  const g = globalThis as any;
  return {
    win: typeof g.addEventListener === 'function' ? g : null,
    doc: g.document ?? null,
    getGamepads: () => {
      try {
        return g.navigator?.getGamepads?.() ?? [];
      } catch {
        return [];
      }
    },
    now: () => (g.performance?.now ? g.performance.now() : Date.now()),
    hasActivation: () => g.navigator?.userActivation?.isActive ?? true,
    lockAllowed: () => {
      try {
        if (g.navigator?.webdriver) return false;
        return !/[?&]nolock\b/.test(g.location?.search ?? '');
      } catch {
        return true;
      }
    },
  };
}

// ───────────────────────────── labels (for the UI) ─────────────────────────────

const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'LS', 'RS', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'];

/** Human-readable label for a key/mouse binding code. */
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
    WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'L-Meta', MetaRight: 'R-Meta',
    Space: 'Space', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Enter: 'Enter', Tab: 'Tab',
    Backspace: 'Backspace', CapsLock: 'Caps',
  };
  return map[code] ?? code;
}

/** Human-readable label for a Standard-mapping gamepad button index. */
export function padButtonLabel(i: number): string {
  return PAD_LABELS[i] ?? `Button ${i}`;
}

// ───────────────────────────── helpers ─────────────────────────────

interface QueuedEvent {
  code: string;
  down: boolean;
  /** env.now() when the event arrived. */
  at: number;
}
interface Capture {
  device: 'kbm' | 'pad';
  cb: (code: string | number | null) => void;
  armedAt: number;
}
interface StoredBindings {
  keys?: Partial<Record<Action, unknown>>;
  pad?: Partial<Record<Action, unknown>>;
}

const padCode = (i: number) => `Pad${i}`;

/** Radial deadzone with rescale: |out| goes 0..1 as |in| goes dz..1. */
function radial(x: number, y: number, dz: number, curve = 1): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m <= dz || !Number.isFinite(m)) return { x: 0, y: 0 };
  const mm = Math.min(1, m);
  let k = (mm - dz) / (1 - dz);
  if (curve !== 1) k = Math.pow(k, curve);
  return { x: (x / m) * k, y: (y / m) * k };
}

function isTypingTarget(t: any): boolean {
  if (!t) return false;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = String(t.type ?? 'text').toLowerCase();
    // Range sliders and checkboxes don't take text; let the game keep its keys there.
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(type);
  }
  return !!t.isContentEditable;
}

const INTERACTIVE_SELECTOR = 'button, input, select, textarea, a, label, [role="button"], [role="slider"], [data-ui-block]';
function isInteractiveTarget(t: any): boolean {
  try {
    return !!(t && typeof t.closest === 'function' && t.closest(INTERACTIVE_SELECTOR));
  } catch {
    return false;
  }
}

function cloneKeys(src: KeyBindings): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of ACTIONS) out[a] = [...(src[a] ?? [])];
  return out;
}
function clonePad(src: PadBindings): PadBindings {
  const out: PadBindings = {};
  for (const a of ACTIONS) out[a] = [...(src[a] ?? [])];
  return out;
}

// ───────────────────────────── Input ─────────────────────────────

export class Input {
  context: InputContext = 'menu';
  /** Right stick position (-1..1) when a gamepad is used for the swing; null if none. */
  padHands: { x: number; y: number } | null = null;
  /** Left stick (walk). +y = stick pulled down. */
  padMove = { x: 0, y: 0 };
  /** Right stick look (walk mode). */
  padLook = { x: 0, y: 0 };
  /** Last device used: 'kbm' or 'pad' (for UI prompts). */
  lastDevice: 'kbm' | 'pad' = 'kbm';
  /** Id of the active gamepad, or null. */
  padId: string | null = null;

  private readonly canvas: CanvasLike;
  private readonly env: InputEnv;
  private keyBindings: KeyBindings = cloneKeys(DEFAULT_KEYS);
  private padBindings: PadBindings = clonePad(DEFAULT_PAD);
  /** Action → physical codes (keys, mouse, 'PadN'), rebuilt when bindings change. */
  private codes = new Map<Action, string[]>();
  private liveSets: Record<InputContext, Set<Action>>;

  // Frame state (applied in update()).
  private queue: QueuedEvent[] = [];
  private down = new Set<string>();
  private pressedC = new Set<string>();
  private releasedC = new Set<string>();
  /** Codes held (or pressed) when the context changed; ignored until released. */
  private stale = new Set<string>();
  // Immediate state (updated inside event handlers).
  private rawDown = new Set<string>();
  private swing = { dx: 0, dy: 0 };
  private look = { dx: 0, dy: 0 };
  private lastClient: { x: number; y: number } | null = null;
  private wheelAcc = 0;
  private lastWheelAt = -1e9;
  // Pointer lock.
  private wantLock = false;
  private lockPending = false;
  private lockFailedAt = -1e9;
  private lockedState = false;
  private skipLockedMove = false;
  // Gamepad.
  private padIndex = -1;
  private padButtons: boolean[] = [];
  private capture: Capture | null = null;
  private bindingListeners = new Set<() => void>();
  private listeners: [EventTargetLike, string, Listener, any][] = [];

  constructor(canvas: HTMLElement | CanvasLike, env?: Partial<InputEnv>) {
    this.canvas = canvas as CanvasLike;
    this.env = { ...defaultEnv(), ...(env ?? {}) };
    const stanceLive = new Set<Action>(ACTIONS.filter((a) => !WALK_ONLY.includes(a)));
    const walkLive = new Set<Action>(ACTIONS.filter((a) => !STANCE_ONLY.includes(a)));
    const menuLive = new Set<Action>(ACTIONS.filter((a) => !WALK_ONLY.includes(a) && !STANCE_ONLY.includes(a)));
    for (const a of CONTEXT_EXTRA.stance) stanceLive.add(a);
    for (const a of CONTEXT_EXTRA.walk) walkLive.add(a);
    this.liveSets = { stance: stanceLive, walk: walkLive, menu: menuLive };
    this.loadBindings();
    this.attach();
  }

  // ───────────── context ─────────────

  setContext(c: InputContext) {
    if (c === this.context) return;
    this.context = c;
    // Keys held across the switch must not leak into the new context (W held while walking
    // must not start moving the stance). They come back once released and pressed again.
    for (const k of this.down) this.stale.add(k);
    for (const k of this.pressedC) this.stale.add(k);
    this.swing.dx = this.swing.dy = 0;
    this.look.dx = this.look.dy = 0;
    if (c === 'walk') {
      // Mouse-look wants the lock; Tab/click that caused this is a user gesture.
      if (this.env.hasActivation()) this.requestPointerLock();
    } else if (c === 'menu') {
      this.exitPointerLock();
    }
  }

  private live(a: Action) {
    return this.liveSets[this.context].has(a);
  }

  // ───────────── queries ─────────────

  held(a: Action): boolean {
    if (!this.live(a)) return false;
    for (const c of this.codes.get(a) ?? []) {
      if (this.stale.has(c)) continue;
      if (this.down.has(c) || this.pressedC.has(c)) return true;
    }
    return false;
  }
  pressed(a: Action): boolean {
    if (!this.live(a)) return false;
    for (const c of this.codes.get(a) ?? []) if (this.pressedC.has(c) && !this.stale.has(c)) return true;
    return false;
  }
  released(a: Action): boolean {
    if (!this.live(a)) return false;
    for (const c of this.codes.get(a) ?? []) if (this.releasedC.has(c)) return true;
    return false;
  }
  /** Raw state of a physical code (ignores context), e.g. isDown('KeyW'). */
  isDown(code: string) {
    return this.down.has(code);
  }
  consumeSwingDelta() {
    const d = { dx: this.swing.dx, dy: this.swing.dy };
    this.swing.dx = this.swing.dy = 0;
    return d;
  }
  consumeLookDelta() {
    const d = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = this.look.dy = 0;
    return d;
  }

  // ───────────── pointer lock ─────────────

  get pointerLocked() {
    const doc = this.env.doc;
    if (!doc) return false;
    return doc.pointerLockElement != null ? doc.pointerLockElement === this.canvas : false;
  }
  requestPointerLock() {
    this.wantLock = true;
    if (this.pointerLocked || this.lockPending) return;
    const req = this.canvas.requestPointerLock;
    if (typeof req !== 'function' || !this.env.lockAllowed()) return;
    if (this.env.now() - this.lockFailedAt < LOCK_RETRY_MS) return;
    this.lockPending = true;
    const fail = () => {
      this.lockPending = false;
      this.lockFailedAt = this.env.now();
    };
    const plain = () => {
      try {
        const r: any = req.call(this.canvas);
        if (r && typeof r.then === 'function') r.then(() => (this.lockPending = false), fail);
      } catch {
        fail();
      }
    };
    try {
      // Raw (unaccelerated) deltas where supported; otherwise retry with a plain request.
      const r: any = req.call(this.canvas, { unadjustedMovement: true });
      if (r && typeof r.then === 'function') {
        r.then(
          () => (this.lockPending = false),
          (err: any) => {
            if (err && err.name === 'NotSupportedError' && this.wantLock) plain();
            else fail();
          },
        );
      }
    } catch {
      plain();
    }
  }
  exitPointerLock() {
    this.wantLock = false;
    if (!this.pointerLocked) return;
    try {
      this.env.doc?.exitPointerLock?.();
    } catch {
      /* ignore */
    }
  }
  private onLockChange = () => {
    const locked = this.pointerLocked;
    this.lockPending = false;
    if (locked && !this.wantLock) {
      // Granted after we stopped wanting it (e.g. LMB released before the lock arrived).
      this.exitPointerLock();
    }
    if (locked !== this.lockedState) {
      this.lastClient = null;
      // The first locked event can carry the jump to the lock origin, not a real movement.
      this.skipLockedMove = locked;
    }
    this.lockedState = locked;
  };
  private onLockError = () => {
    this.lockPending = false;
    this.lockFailedAt = this.env.now();
  };

  // ───────────── gamepad ─────────────

  /** Rumble the active gamepad. strength 0..1, ms duration. */
  vibrate(strength: number, ms: number) {
    if (!settings.get('gamepadVibration')) return;
    const pad = this.activePad();
    if (!pad) return;
    const s = Math.max(0, Math.min(1, strength));
    const dur = Math.max(1, Math.min(5000, ms));
    try {
      const va: any = (pad as any).vibrationActuator;
      if (va && typeof va.playEffect === 'function' && (!va.effects || va.effects.includes('dual-rumble'))) {
        const p = va.playEffect('dual-rumble', { startDelay: 0, duration: dur, strongMagnitude: s, weakMagnitude: Math.min(1, s * 0.6 + 0.2) });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return;
      }
      const ha: any = (pad as any).hapticActuators?.[0];
      if (ha && typeof ha.pulse === 'function') {
        const p = ha.pulse(s, dur);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      /* unsupported */
    }
  }

  private activePad(): Gamepad | null {
    let pads: ArrayLike<Gamepad | null>;
    try {
      pads = this.env.getGamepads();
    } catch {
      return null;
    }
    if (!pads) return null;
    if (this.padIndex >= 0 && pads[this.padIndex]?.connected) return pads[this.padIndex];
    // Prefer a standard-mapping pad.
    let pick = -1;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p || p.connected === false) continue;
      if (pick < 0 || (p.mapping === 'standard' && pads[pick]!.mapping !== 'standard')) pick = i;
    }
    if (pick !== this.padIndex) this.padButtons = [];
    this.padIndex = pick;
    return pick >= 0 ? pads[pick] : null;
  }

  private pollPad() {
    const pad = settings.get('gamepadEnabled') ? this.activePad() : null;
    if (!pad) {
      // Release anything the pad was holding.
      for (let i = 0; i < this.padButtons.length; i++) if (this.padButtons[i]) this.applyEdge(padCode(i), false);
      this.padButtons = [];
      this.padId = null;
      this.padHands = null;
      this.padMove = { x: 0, y: 0 };
      this.padLook = { x: 0, y: 0 };
      return;
    }
    this.padId = pad.id;
    const btns = pad.buttons ?? [];
    let active = false;
    for (let i = 0; i < btns.length; i++) {
      const b: any = btns[i];
      const v = typeof b === 'number' ? b : (b?.value ?? 0);
      const on = i === 6 || i === 7 ? v > TRIGGER_PRESS : !!b?.pressed || v > TRIGGER_PRESS;
      const was = !!this.padButtons[i];
      if (on === was) continue;
      this.padButtons[i] = on;
      if (on) {
        active = true;
        if (this.capture?.device === 'pad') {
          const cap = this.capture;
          this.capture = null; // the captured press never acts (and its release is ignored)
          cap.cb(i);
          continue;
        }
      }
      this.applyEdge(padCode(i), on);
    }
    const ax = pad.axes ?? [];
    const a = (i: number) => (Number.isFinite(ax[i]) ? ax[i] : 0);
    this.padMove = radial(a(0), a(1), DEADZONE_MOVE);
    const rx = a(2);
    const ry = a(3);
    if (this.context === 'stance') {
      this.padHands = radial(rx, ry, DEADZONE_HANDS);
      this.padLook = { x: 0, y: 0 };
    } else {
      this.padHands = null;
      this.padLook = this.context === 'walk' ? radial(rx, ry, DEADZONE_LOOK, 1.6) : { x: 0, y: 0 };
    }
    if (Math.hypot(a(0), a(1)) > PAD_ACTIVITY || Math.hypot(rx, ry) > PAD_ACTIVITY) active = true;
    if (active) this.lastDevice = 'pad';
  }

  // ───────────── frame ─────────────

  /** Poll gamepads and apply queued events; call at the start of each frame. */
  update() {
    const now = this.env.now();
    let i = 0;
    for (; i < this.queue.length; i++) {
      const ev = this.queue[i];
      if (ev.down && this.pressedC.has(ev.code)) {
        if (now - ev.at < CARRY_MAX_MS) break; // second tap this frame → next frame
        // Stale repeat on a very slow frame: collapse into the press already reported this frame
        // (still held if it hasn't been released yet).
        this.down.add(ev.code);
        continue;
      }
      this.applyEdge(ev.code, ev.down);
    }
    this.queue.splice(0, i);
    this.pollPad();
  }
  /** Clear edge states; call after the game update. */
  endFrame() {
    this.pressedC.clear();
    this.releasedC.clear();
    for (const k of this.stale) if (!this.down.has(k)) this.stale.delete(k);
  }

  private applyEdge(code: string, isDown: boolean) {
    if (isDown) {
      if (this.down.has(code)) return;
      this.down.add(code);
      this.pressedC.add(code);
    } else {
      if (!this.down.has(code)) return;
      this.down.delete(code);
      this.releasedC.add(code);
    }
  }

  private enqueue(code: string, isDown: boolean) {
    this.queue.push({ code, down: isDown, at: this.env.now() });
    if (this.queue.length > QUEUE_MAX) {
      // The game loop isn't consuming events (loading, hidden tab): fold the oldest in.
      const old = this.queue.splice(0, this.queue.length - QUEUE_MAX / 2);
      for (const ev of old) this.applyEdge(ev.code, ev.down);
      this.pressedC.clear();
      this.releasedC.clear();
    }
  }

  /** Release everything (window blur, tab hidden). */
  releaseAll() {
    for (const c of [...this.rawDown]) this.enqueue(c, false);
    for (const c of this.down) if (!c.startsWith('Pad')) this.enqueue(c, false);
    this.rawDown.clear();
    this.swing.dx = this.swing.dy = 0;
    this.look.dx = this.look.dy = 0;
    this.lastClient = null;
  }

  // ───────────── DOM events ─────────────

  private on(t: EventTargetLike | null | undefined, type: string, l: Listener, opts?: any) {
    if (!t || typeof t.addEventListener !== 'function') return;
    t.addEventListener(type, l, opts);
    this.listeners.push([t, type, l, opts]);
  }

  private attach() {
    const { win, doc } = this.env;
    this.on(win, 'keydown', this.onKeyDown);
    this.on(win, 'keyup', this.onKeyUp);
    this.on(win, 'mousedown', this.onMouseDown);
    this.on(win, 'mouseup', this.onMouseUp);
    this.on(win, 'mousemove', this.onMouseMove);
    this.on(win, 'blur', this.onBlur);
    this.on(win, 'wheel', this.onWheel, { passive: false });
    this.on(this.canvas, 'contextmenu', this.onContextMenu);
    this.on(doc, 'pointerlockchange', this.onLockChange);
    this.on(doc, 'pointerlockerror', this.onLockError);
    this.on(doc, 'visibilitychange', this.onVisibility);
    this.on(win, 'gamepadconnected', this.onPadConnect);
    this.on(win, 'gamepaddisconnected', this.onPadConnect);
  }

  /** Remove all listeners. */
  dispose() {
    for (const [t, type, l, opts] of this.listeners) t.removeEventListener(type, l, opts);
    this.listeners = [];
    this.exitPointerLock();
  }

  private onPadConnect = () => {
    this.padIndex = -1;
  };
  private onVisibility = () => {
    if (this.env.doc?.visibilityState === 'hidden') this.releaseAll();
  };
  private onBlur = () => this.releaseAll();
  private onContextMenu = (e: any) => e.preventDefault?.();

  private captureEventOk(e: any, cap: Capture) {
    // Ignore the very event that armed the capture (UI handlers run before ours bubble here).
    return !(typeof e.timeStamp === 'number' && e.timeStamp > 0 && e.timeStamp < cap.armedAt);
  }

  private onKeyDown = (e: any) => {
    const code: string = e.code || e.key || '';
    if (!code) return;
    if (this.capture && this.captureEventOk(e, this.capture)) {
      e.preventDefault?.();
      if (e.repeat) return;
      const cap = this.capture;
      if (code === 'Escape') {
        this.capture = null;
        cap.cb(null);
      } else if (cap.device === 'kbm') {
        this.capture = null;
        cap.cb(code);
      }
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (this.context !== 'menu' && !e.metaKey && (PREVENT_KEYS.has(code) || (this.isBound(code) && code !== 'Escape'))) e.preventDefault?.();
    this.lastDevice = 'kbm';
    if (e.repeat || this.rawDown.has(code)) return;
    this.rawDown.add(code);
    this.enqueue(code, true);
  };
  private onKeyUp = (e: any) => {
    const code: string = e.code || e.key || '';
    if (!code) return;
    if (this.context !== 'menu' && PREVENT_KEYS.has(code)) e.preventDefault?.();
    if (!this.rawDown.has(code)) return;
    this.rawDown.delete(code);
    this.enqueue(code, false);
  };

  private onMouseDown = (e: any) => {
    const code = `Mouse${e.button ?? 0}`;
    if (this.capture && this.captureEventOk(e, this.capture)) {
      if (this.capture.device === 'kbm') {
        e.preventDefault?.();
        const cap = this.capture;
        this.capture = null;
        cap.cb(code);
      }
      return;
    }
    const onCanvas = e.target === this.canvas;
    if (!onCanvas && (this.context === 'menu' || isInteractiveTarget(e.target))) return;
    if (onCanvas) e.preventDefault?.(); // no text selection / focus steal
    this.lastDevice = 'kbm';
    if (this.rawDown.has(code)) return;
    this.rawDown.add(code);
    this.lastClient = Number.isFinite(e.clientX) ? { x: e.clientX, y: e.clientY } : null;
    this.enqueue(code, true);
    // Lock inside the gesture: the swing grab (stance) or mouse-look (walk).
    if (this.context === 'stance' && this.isBoundTo(code, 'swingGrab')) this.requestPointerLock();
    else if (this.context === 'walk' && !this.pointerLocked) this.requestPointerLock();
  };
  private onMouseUp = (e: any) => {
    const code = `Mouse${e.button ?? 0}`;
    if (!this.rawDown.has(code)) return;
    this.rawDown.delete(code);
    this.enqueue(code, false);
    // Symmetric with onMouseDown: the swing lock ends with the grab.
    if (this.context === 'stance' && this.isBoundTo(code, 'swingGrab') && !this.rawHeldAction('swingGrab')) this.exitPointerLock();
  };

  private onMouseMove = (e: any) => {
    const locked = this.pointerLocked;
    const mx = Number.isFinite(e.movementX) ? e.movementX : 0;
    const my = Number.isFinite(e.movementY) ? e.movementY : 0;
    const hasClient = Number.isFinite(e.clientX) && Number.isFinite(e.clientY);
    const prev = this.lastClient;
    this.lastClient = hasClient ? { x: e.clientX, y: e.clientY } : null;
    const cx = hasClient && prev ? e.clientX - prev.x : 0;
    const cy = hasClient && prev ? e.clientY - prev.y : 0;
    // Locked: movementX is the truth (clientX is frozen); some synthetic/automation events carry
    // no movement, so fall back to the client delta. Unlocked: client delta in CSS px, with the
    // movement fields as a fallback when there is no previous position (first event, lock change).
    let dx: number;
    let dy: number;
    if (locked) {
      if (this.skipLockedMove) {
        this.skipLockedMove = false;
        return;
      }
      [dx, dy] = mx || my ? [mx, my] : [cx, cy];
      if (Math.abs(dx) > LOCK_SPIKE_PX || Math.abs(dy) > LOCK_SPIKE_PX) return;
    } else {
      [dx, dy] = hasClient && prev ? [cx, cy] : [mx, my];
    }
    if (!dx && !dy) return;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.lastDevice = 'kbm';
    if (this.capture) return;
    if (this.context === 'stance') {
      if (this.rawHeldAction('swingGrab')) {
        this.swing.dx += dx;
        this.swing.dy += dy;
      }
    } else if (this.context === 'walk') {
      if (locked || this.anyMouseButtonDown()) {
        this.look.dx += dx;
        this.look.dy += dy;
      }
    }
  };

  private onWheel = (e: any) => {
    if (this.context !== 'menu' && (e.target === this.canvas || !isInteractiveTarget(e.target))) e.preventDefault?.();
    let dy = Number(e.deltaY) || 0;
    if (e.deltaMode === 1) dy *= 33; // lines
    else if (e.deltaMode === 2) dy *= 400; // pages
    if (this.capture && this.captureEventOk(e, this.capture)) {
      if (this.capture.device === 'kbm' && dy) {
        const cap = this.capture;
        this.capture = null;
        cap.cb(dy < 0 ? 'WheelUp' : 'WheelDown');
      }
      return;
    }
    if (this.context === 'menu' && isInteractiveTarget(e.target)) return;
    if (Math.sign(dy) !== Math.sign(this.wheelAcc)) this.wheelAcc = 0;
    this.wheelAcc += dy;
    const now = this.env.now();
    if (Math.abs(this.wheelAcc) < WHEEL_STEP || now - this.lastWheelAt < WHEEL_MIN_GAP_MS) return;
    const code = this.wheelAcc < 0 ? 'WheelUp' : 'WheelDown';
    this.wheelAcc = 0;
    this.lastWheelAt = now;
    this.lastDevice = 'kbm';
    this.enqueue(code, true);
    this.enqueue(code, false);
  };

  private anyMouseButtonDown() {
    for (const c of this.rawDown) if (c.startsWith('Mouse')) return true;
    return false;
  }
  private rawHeldAction(a: Action) {
    for (const c of this.codes.get(a) ?? []) if (this.rawDown.has(c)) return true;
    return false;
  }
  private isBoundTo(code: string, a: Action) {
    return (this.codes.get(a) ?? []).includes(code);
  }
  private isBound(code: string) {
    for (const a of this.liveSets[this.context]) if (this.isBoundTo(code, a)) return true;
    return false;
  }

  // ───────────── bindings ─────────────

  getKeyBindings(): KeyBindings {
    return cloneKeys(this.keyBindings);
  }
  getPadBindings(): PadBindings {
    return clonePad(this.padBindings);
  }
  /** Set (or clear with null/'') slot `index` of an action's key/mouse bindings. Saved immediately. */
  setKeyBinding(action: Action, index: number, code: string | null) {
    const arr = [...(this.keyBindings[action] ?? [])];
    if (code == null || code === '') arr.splice(index, 1);
    else if (index < arr.length) arr[index] = code;
    else arr.push(code);
    this.keyBindings[action] = arr.filter((c, i) => arr.indexOf(c) === i).slice(0, Math.max(BINDING_SLOTS, arr.length));
    this.bindingsChanged();
  }
  /** Set (or clear with null/-1) slot `index` of an action's gamepad button bindings. */
  setPadBinding(action: Action, index: number, button: number | null) {
    const arr = [...(this.padBindings[action] ?? [])];
    if (button == null || button < 0) arr.splice(index, 1);
    else if (index < arr.length) arr[index] = button;
    else arr.push(button);
    this.padBindings[action] = arr.filter((c, i) => arr.indexOf(c) === i);
    this.bindingsChanged();
  }
  resetBindings() {
    this.keyBindings = cloneKeys(DEFAULT_KEYS);
    this.padBindings = clonePad(DEFAULT_PAD);
    safeRemove(BINDINGS_KEY);
    this.rebuildCodes();
    for (const l of this.bindingListeners) l();
  }
  /**
   * Other actions that would fire together with `action` if `code` were bound to it (they share a
   * context). Shared keys across walk/stance (W = walk forward / stance forward) are not conflicts.
   */
  findConflicts(action: Action, code: string | number): Action[] {
    const key = typeof code === 'number' ? padCode(code) : code;
    const ctxs = (['walk', 'stance', 'menu'] as InputContext[]).filter((c) => this.liveSets[c].has(action));
    const out: Action[] = [];
    for (const a of ACTIONS) {
      if (a === action || !(this.codes.get(a) ?? []).includes(key)) continue;
      if (ctxs.some((c) => this.liveSets[c].has(a))) out.push(a);
    }
    return out;
  }
  /** Listen for binding changes (returns an unsubscribe function). */
  onBindingsChanged(l: () => void) {
    this.bindingListeners.add(l);
    return () => this.bindingListeners.delete(l);
  }
  /**
   * Report the next key / mouse button / wheel ('kbm') or gamepad button ('pad') instead of acting
   * on it. Escape cancels (cb(null)). Calling again replaces (and cancels) a pending capture.
   * Returns a cancel function.
   */
  captureNext(device: 'kbm' | 'pad', cb: (code: string | number | null) => void): () => void {
    if (this.capture) {
      const prev = this.capture;
      this.capture = null;
      prev.cb(null);
    }
    const cap: Capture = { device, cb, armedAt: this.env.now() };
    this.capture = cap;
    return () => {
      if (this.capture === cap) {
        this.capture = null;
        cb(null);
      }
    };
  }
  get capturing() {
    return this.capture?.device ?? null;
  }

  private bindingsChanged() {
    this.rebuildCodes();
    safeSave(BINDINGS_KEY, { keys: this.keyBindings, pad: this.padBindings });
    for (const l of this.bindingListeners) l();
  }

  private loadBindings() {
    const saved = safeLoad<StoredBindings>(BINDINGS_KEY);
    if (saved && typeof saved === 'object') {
      for (const a of ACTIONS) {
        const k = saved.keys?.[a];
        if (Array.isArray(k) && k.every((c) => typeof c === 'string')) this.keyBindings[a] = [...(k as string[])];
        const p = saved.pad?.[a];
        if (Array.isArray(p) && p.every((c) => Number.isInteger(c) && c >= 0)) this.padBindings[a] = [...(p as number[])];
      }
    }
    this.rebuildCodes();
  }

  private rebuildCodes() {
    this.codes.clear();
    for (const a of ACTIONS) {
      const list = [...(this.keyBindings[a] ?? []), ...(this.padBindings[a] ?? []).map(padCode)];
      this.codes.set(a, list);
    }
  }
}
