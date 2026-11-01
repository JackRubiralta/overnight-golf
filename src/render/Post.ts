/**
 * STUB — Post-processing pipeline (owner: sky/post builder): AgX/ACES tonemapping, colour
 * grading, bloom, N8AO, SMAA, DoF (menus/replays), vignette.
 */
import type { PostPipeline } from './World';
import type { FrameContext, InitContext } from './shared';

export class Post implements PostPipeline {
  private ctx!: InitContext;
  init(ctx: InitContext) {
    this.ctx = ctx;
  }
  setSize(_w: number, _h: number) {}
  render(ctx: FrameContext) {
    ctx.renderer.render(ctx.scene, ctx.camera);
    void this.ctx;
  }
  setDof(_enabled: boolean, _focus?: number) {}
}
