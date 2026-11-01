/**
 * STUB — Grass: GPU-instanced grass blades around the camera (owner: grass builder).
 * Must read the course textures (height, masks) to place blades: short on fairway/tee/green,
 * long & wispy in rough, none in sand/water/paths; wind sway from globalUniforms.
 */
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';

export class Grass implements RenderModule {
  init(_ctx: InitContext) {}
  update(_ctx: FrameContext) {}
  setQuality(_q: QualityPreset) {}
}
