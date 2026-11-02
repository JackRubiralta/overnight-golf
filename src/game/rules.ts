/** Pure rules helpers (unit-tested in tests/rules.test.ts). */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Penalty-area relief "back on the line": start where the ball entered the water and walk back
 * toward where the stroke was played from until the spot is dry and clear of the margin.
 * `start` should be the last dry point the ball touched after the stroke if it rolled in, else
 * the water entry point (a ball that flies straight in never touched dry ground).
 * Returns null if no dry spot exists on that line (caller falls back to stroke and distance).
 */
export function findDropPoint(start: P3, origin: P3, isClear: (x: number, z: number) => boolean, step = 0.5): { x: number; z: number } | null {
  const dx = origin.x - start.x;
  const dz = origin.z - start.z;
  const len = Math.hypot(dx, dz);
  const ux = len > 1e-6 ? dx / len : 0;
  const uz = len > 1e-6 ? dz / len : 0;
  for (let t = 0; t <= len + 1e-6; t += step) {
    const x = start.x + ux * t;
    const z = start.z + uz * t;
    if (isClear(x, z)) return { x, z };
  }
  return null;
}

/** Where to start the drop search: the last dry contact if the ball touched ground after the stroke, else the entry point. */
export function dropSearchStart(lastDry: P3, entry: P3 | null, origin: P3): P3 {
  const touchedAfterLaunch = Math.hypot(lastDry.x - origin.x, lastDry.z - origin.z) > 1;
  return touchedAfterLaunch || !entry ? lastDry : entry;
}
