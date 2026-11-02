/**
 * Gamepad navigation for menus: D-pad / left stick moves focus between the visible buttons of the
 * top-most UI layer, A activates, B goes back. Only runs while `active()` returns true.
 */
const REPEAT_DELAY = 0.38; // s before a held direction repeats
const REPEAT_RATE = 0.12; // s between repeats
const STICK_DEAD = 0.55;

export class PadNav {
  private raf = 0;
  private prev = new Set<number>();
  private held = 0; // -1 up, 1 down, 0 none
  private heldT = 0;
  private last = 0;

  constructor(
    private readonly layer: () => HTMLElement | null,
    private readonly active: () => boolean,
    private readonly back: () => void,
    private readonly tick: () => void,
  ) {
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
      this.last = t;
      if (this.active()) this.poll(dt);
      else this.prev.clear();
    };
    if (typeof navigator !== 'undefined' && 'getGamepads' in navigator) this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
  }

  private poll(dt: number) {
    const pads = navigator.getGamepads();
    let gp: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) gp = gp ?? p;
    if (!gp) return;
    const down = new Set<number>();
    gp.buttons.forEach((b, i) => b.pressed && down.add(i));
    const edge = (i: number) => down.has(i) && !this.prev.has(i);
    const ax = gp.axes[0] ?? 0;
    const ay = gp.axes[1] ?? 0;
    const v = down.has(12) || ay < -STICK_DEAD ? -1 : down.has(13) || ay > STICK_DEAD ? 1 : 0;
    const hz = down.has(14) || ax < -STICK_DEAD ? -1 : down.has(15) || ax > STICK_DEAD ? 1 : 0;
    // Encode vertical as ±1 and horizontal as ±2 so a change of direction resets the repeat.
    const dir = v || hz * 2;
    if (dir !== this.held) {
      this.held = dir;
      this.heldT = 0;
      if (dir) this.step(dir);
    } else if (dir) {
      this.heldT += dt;
      if (this.heldT > REPEAT_DELAY) {
        this.heldT -= REPEAT_RATE;
        this.step(dir);
      }
    }
    if (edge(0)) {
      const f = document.activeElement as HTMLElement | null;
      if (f && this.focusables().includes(f)) f.click();
      else this.move(1);
    }
    if (edge(1)) this.back();
    this.prev = down;
  }

  /** Vertical (±1) moves focus; horizontal (±2) nudges a focused slider, else moves focus. */
  private step(dir: number) {
    const f = document.activeElement;
    if (Math.abs(dir) === 2 && f instanceof HTMLInputElement && f.type === 'range') {
      const stepN = Number(f.step) || 0.01;
      const v = Math.min(Number(f.max), Math.max(Number(f.min), Number(f.value) + Math.sign(dir) * stepN * (stepN < 0.05 ? 5 : 1)));
      f.value = String(v);
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.move(Math.sign(dir));
  }

  private focusables(): HTMLElement[] {
    const root = this.layer();
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('button, input[type=range]')].filter((e) => e.offsetParent !== null && !e.closest('.tl-hidden'));
  }

  private move(d: number) {
    const list = this.focusables();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const n = i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length;
    list[n].focus({ preventScroll: false });
    list[n].scrollIntoView({ block: 'nearest' });
    this.tick();
  }
}
