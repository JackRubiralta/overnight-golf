/** Bake the course grids using a pool of Web Workers (falls back to the main thread). */
import { CourseField, GRID_RES, type CourseGrids } from './CourseField';

export async function bakeCourse(field: CourseField, onProgress?: (p: number) => void, res = GRID_RES): Promise<CourseGrids> {
  const heights = new Float32Array(res * res);
  const maskA = new Uint8Array(res * res * 4);
  const maskB = new Uint8Array(res * res * 4);
  const grids: CourseGrids = { res, half: field.half, heights, maskA, maskB };
  const nWorkers = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const chunk = 32;
  const jobs: [number, number][] = [];
  for (let r = 0; r < res; r += chunk) jobs.push([r, Math.min(res, r + chunk)]);
  let done = 0;
  const place = (row0: number, d: { heights: Float32Array; maskA: Uint8Array; maskB: Uint8Array }) => {
    heights.set(d.heights, row0 * res);
    maskA.set(d.maskA, row0 * res * 4);
    maskB.set(d.maskB, row0 * res * 4);
    done++;
    onProgress?.(done / jobs.length);
  };
  let workers: Worker[] = [];
  try {
    workers = Array.from({ length: nWorkers }, () => new Worker(new URL('../workers/bake.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    workers = [];
  }
  if (!workers.length) {
    for (const [a, b] of jobs) {
      place(a, field.bakeRows(res, a, b));
      await new Promise((r) => setTimeout(r, 0));
    }
    return grids;
  }
  await new Promise<void>((resolve, reject) => {
    let next = 0;
    const feed = (w: Worker) => {
      if (next >= jobs.length) return;
      const [a, b] = jobs[next++];
      w.postMessage({ res, row0: a, row1: b });
    };
    for (const w of workers) {
      w.onmessage = (e) => {
        place(e.data.row0, e.data);
        if (done === jobs.length) resolve();
        else feed(w);
      };
      w.onerror = (err) => reject(err);
      feed(w);
    }
  });
  for (const w of workers) w.terminate();
  return grids;
}
