/**
 * STUB — Water: reflective/refractive water surfaces for every hazard (owner: water+fx builder).
 * Water levels come from course.field.holes[i].waterLevels / def.water blobs.
 */
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';

export class WaterSystem implements RenderModule {
  init(_ctx: InitContext) {}
  update(_ctx: FrameContext) {}
  setQuality(_q: QualityPreset) {}
}
