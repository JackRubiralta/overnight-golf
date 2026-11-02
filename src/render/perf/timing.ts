/**
 * Load-time instrumentation: `phase('name')` records the time since the previous mark and logs
 * `[perf] name: 123 ms (t=4567 ms)`. The collected marks are exposed as window.__loadTimes so
 * headless tests can read the breakdown. Costs nothing measurable.
 */
export interface LoadMark {
  name: string;
  ms: number;
  at: number;
}

const marks: LoadMark[] = [];
let last = typeof performance !== 'undefined' ? performance.now() : 0;
const quiet = typeof location !== 'undefined' && new URLSearchParams(location.search).has('quietperf');

/** Record a phase that ended now (duration = time since the previous phase/mark). */
export function phase(name: string): number {
  const now = performance.now();
  const ms = now - last;
  last = now;
  marks.push({ name, ms, at: now });
  if (!quiet) console.info(`[perf] ${name}: ${ms.toFixed(0)} ms (t=${now.toFixed(0)} ms)`);
  if (typeof window !== 'undefined') (window as unknown as { __loadTimes?: LoadMark[] }).__loadTimes = marks;
  return ms;
}

/** Reset the reference point without recording (e.g. before an awaited phase). */
export function markStart() {
  last = performance.now();
}

/** Time an async (or sync) function as one phase. */
export async function timed<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  markStart();
  const r = await fn();
  phase(name);
  return r;
}

export function loadMarks(): readonly LoadMark[] {
  return marks;
}

/** `?perfsync` makes phase timings include the GPU work they queued (gl.finish after each). */
export const PERF_SYNC = typeof location !== 'undefined' && new URLSearchParams(location.search).has('perfsync');

/** Block until the GPU has executed all queued work (only with ?perfsync; otherwise a no-op). */
export function gpuSync(gl: WebGL2RenderingContext | WebGLRenderingContext | null | undefined) {
  if (!PERF_SYNC || !gl) return;
  const px = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
}
