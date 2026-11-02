/** Tiny DOM helpers (no framework). */
export type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Set textContent only when it changed (cheap per-frame HUD updates). */
export function setText(el: HTMLElement, s: string) {
  if (el.textContent !== s) el.textContent = s;
}

export function toggle(el: HTMLElement, cls: string, on: boolean) {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

/** Canvas whose backing store follows its CSS size × devicePixelRatio. Returns a 2D context
 *  already scaled to CSS pixels, plus the CSS width/height. */
export function fitCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = c.clientWidth;
  const hh = c.clientHeight;
  if (!w || !hh) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.round(w * dpr);
  const bh = Math.round(hh * dpr);
  if (c.width !== bw || c.height !== bh) {
    c.width = bw;
    c.height = bh;
  }
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  return { ctx, w, h: hh };
}

const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Canvas font string; px is multiplied by the panel scale `k`. */
export function cfont(weight: number, px: number, k = 1) {
  return `${weight} ${(px * k).toFixed(1)}px ${FONT_STACK}`;
}
/** Scale for canvas text/markers so they grow with the (em-sized) panel. Base = 220 CSS px wide. */
export function panelScale(w: number) {
  return Math.max(1, Math.min(1.9, w / 220));
}
