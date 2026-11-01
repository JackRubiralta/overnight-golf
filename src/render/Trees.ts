/**
 * STUB — Foliage: procedural trees (instanced, LOD + impostors), bushes, flowers, rocks
 * (owner: trees builder). Placement uses maskB.a (foliage density) and must avoid play lines.
 * Provides simple collision primitives for ball physics.
 */
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';

export interface TreeCollider {
  x: number;
  z: number;
  /** Ground height at trunk base. */
  y: number;
  trunkRadius: number;
  trunkHeight: number;
  /** Canopy sphere (soft collider): centre height above ground and radius. */
  canopyY: number;
  canopyR: number;
}

export class Foliage implements RenderModule {
  colliders: TreeCollider[] = [];
  init(_ctx: InitContext) {}
  update(_ctx: FrameContext) {}
  setQuality(_q: QualityPreset) {}
}
