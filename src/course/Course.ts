/**
 * Course: physics-facing view of the baked course. Heights/normals come from the baked grid
 * (bilinear, identical to what's rendered), surfaces from the exact analytic SDFs.
 */
import { Vector3 } from 'three';
import type { SurfaceId } from '../config';
import type { TerrainQuery } from '../physics/BallSim';
import { CourseField, type CourseGrids } from './CourseField';
import { HOLES, type HoleDef } from './layout';

export class Course implements TerrainQuery {
  field: CourseField;
  grids: CourseGrids;
  private cell: number;
  private surfCacheKey = '';
  private surfCacheVal: SurfaceId = 'rough';

  constructor(field: CourseField, grids: CourseGrids) {
    this.field = field;
    this.grids = grids;
    this.cell = (2 * grids.half) / (grids.res - 1);
  }

  get holes(): HoleDef[] {
    return HOLES;
  }

  /** Raw grid height at integer cell (clamped). */
  private gh(i: number, j: number) {
    const r = this.grids.res;
    i = i < 0 ? 0 : i >= r ? r - 1 : i;
    j = j < 0 ? 0 : j >= r ? r - 1 : j;
    return this.grids.heights[j * r + i];
  }

  height(x: number, z: number): number {
    const fx = (x + this.grids.half) / this.cell;
    const fz = (z + this.grids.half) / this.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    // Match the rendered triangulation (diagonal from (i,j+1) to (i+1,j)).
    const h00 = this.gh(i, j);
    const h10 = this.gh(i + 1, j);
    const h01 = this.gh(i, j + 1);
    const h11 = this.gh(i + 1, j + 1);
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  normal(x: number, z: number, out: Vector3): Vector3 {
    // Smooth normal: central differences of the bilinear surface at half-cell spacing.
    const e = this.cell * 0.75;
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  surface(x: number, z: number): SurfaceId {
    // Ball steps are tiny; cache by ~5 cm cell.
    const key = `${Math.round(x * 20)},${Math.round(z * 20)}`;
    if (key === this.surfCacheKey) return this.surfCacheVal;
    this.surfCacheKey = key;
    this.surfCacheVal = this.field.surface(x, z);
    return this.surfCacheVal;
  }

  waterHeight(x: number, z: number): number | null {
    return this.field.waterLevelAt(x, z);
  }

  isOOB(x: number, z: number): boolean {
    const lim = this.grids.half - 40;
    return Math.abs(x) > lim || Math.abs(z) > lim;
  }
}

/** Bake all grids synchronously (tests / fallback when workers are unavailable). */
export function bakeSync(field: CourseField, res: number): CourseGrids {
  const { heights, maskA, maskB } = field.bakeRows(res, 0, res);
  return { res, half: field.half, heights, maskA, maskB };
}
