/**
 * Post-processing pipeline (pmndrs postprocessing 6.39 + n8ao 2.0.1):
 *
 *   RenderPass (HDR, HalfFloat)
 *   → N8AOPostPass            (QUALITY.ao; half-res, depth-aware upsample)
 *   → EffectPass #1           [DoF (setDof only)] · Bloom (mipmap, HDR threshold) · AgX tone map
 *                             · GradeEffect (split tone, contrast, vibrance, vignette) · dither
 *   → EffectPass #2           SMAA (QUALITY.smaa; runs on the tone-mapped LDR image)
 *
 * The composer tone maps, so renderer.toneMapping is NoToneMapping while the pipeline is active;
 * exposure still comes from renderer.toneMappingExposure (set by the Sky presets) because the
 * ToneMappingEffect uses three's tone-mapping chunk. renderer.info is reset once per frame by
 * World (perf/FrameStats.ts, autoReset off) so World.stats() reports the whole frame.
 */
import * as THREE from 'three';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  type Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { PostPipeline } from './World';
import type { FrameContext, InitContext, QualityPreset } from './shared';
import { GradeEffect } from './post/GradeEffect';
import { patchN8AO } from './post/n8aoCompat';

// ---- tuning -------------------------------------------------------------------------------
const BLOOM = { threshold: 4.0, smoothing: 3.0, intensity: 0.35, radius: 0.6, levels: 5 }; // HDR threshold: only sun, glints, hot cloud rims
const AO = { radius: 1.6, falloff: 1.0, intensity: 2.2 };
const DOF = { bokehScale: 3.0, rangeFraction: 0.35, minRange: 1.5 };

export class Post implements PostPipeline {
  composer!: EffectComposer;
  private ctx!: InitContext;
  private quality!: QualityPreset;
  private renderPass!: RenderPass;
  private aoPass: N8AOPostPass | null = null;
  private mainPass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private bloom: BloomEffect | null = null;
  private tone: ToneMappingEffect | null = null;
  grade: GradeEffect | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private smaa: SMAAEffect | null = null;
  private dofEnabled = false;
  private dofFocus = 10;
  /** Last flags the passes were built with (rebuild only when they change). */
  private builtKey = '';

  init(ctx: InitContext) {
    this.ctx = ctx;
    this.quality = ctx.quality;
    const r = ctx.renderer;
    r.toneMapping = THREE.NoToneMapping; // the composer tone maps (avoid doing it twice)
    r.info.autoReset = false;
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0, stencilBuffer: false });
    this.renderPass = new RenderPass(ctx.scene, ctx.camera);
    this.build();
  }

  private key(): string {
    const q = this.quality;
    return [q.ao, q.bloom, q.smaa, q.dof && this.dofEnabled, q.level].join('|');
  }

  /** (Re)assemble the pass chain for the current quality + DoF state. */
  private build() {
    const key = this.key();
    if (key === this.builtKey) return;
    this.builtKey = key;
    const { scene, camera, renderer } = this.ctx;
    const q = this.quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());

    // tear down the previous chain (keep the shared tone/grade effects and the render pass)
    this.composer.removeAllPasses();
    this.aoPass?.dispose();
    this.aoPass = null;
    this.mainPass?.dispose();
    this.mainPass = null;
    this.smaaPass?.dispose();
    this.smaaPass = null;
    // EffectPass.dispose() disposes its effects; recreate the ones we keep
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const gradeUniforms = this.grade ? [...this.grade.uniforms.entries()].map(([k, u]) => [k, u.value] as const) : [];
    this.grade = new GradeEffect();
    for (const [k, v] of gradeUniforms) this.grade.uniforms.get(k)!.value = v;
    this.bloom = null;
    this.dof = null;
    this.smaa = null;

    this.composer.addPass(this.renderPass);

    if (q.ao && !location.search.includes('noao')) { // TEMPDBG
      const ao = new N8AOPostPass(scene, camera, size.x, size.y);
      patchN8AO(ao); // must precede halfRes = true (three r187 MRT API)
      ao.configuration.transparencyAware = false; // also disables per-frame scene traversal
      ao.setQualityMode(q.level === 'ultra' ? 'Medium' : q.level === 'high' ? 'Low' : 'Performance');
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false; // we are mid-pipeline, linear HDR
      ao.configuration.aoRadius = AO.radius;
      ao.configuration.distanceFalloff = AO.falloff;
      ao.configuration.intensity = AO.intensity;
      ao.configuration.color = new THREE.Color(0, 0, 0);
      this.aoPass = ao;
      this.composer.addPass(ao);
    }

    const effects: Effect[] = [];
    if (q.dof && this.dofEnabled) {
      this.dof = new DepthOfFieldEffect(camera, {
        focusDistance: this.dofFocus,
        focusRange: Math.max(DOF.minRange, this.dofFocus * DOF.rangeFraction),
        bokehScale: DOF.bokehScale,
        resolutionScale: 0.5,
      });
      effects.push(this.dof);
    }
    if (q.bloom && !location.search.includes('nobloom')) { // TEMPDBG
      this.bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: BLOOM.threshold,
        luminanceSmoothing: BLOOM.smoothing,
        intensity: BLOOM.intensity,
        radius: BLOOM.radius,
        levels: BLOOM.levels,
      });
      effects.push(this.bloom);
    }
    effects.push(this.tone, this.grade);
    this.mainPass = new EffectPass(camera, ...effects);
    this.composer.addPass(this.mainPass);

    if (q.smaa) {
      this.smaa = new SMAAEffect({ preset: q.level === 'low' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH });
      this.smaaPass = new EffectPass(camera, this.smaa);
      this.composer.addPass(this.smaaPass);
    }
    // dither where the image is quantised to 8 bits (the last pass) to hide sky banding
    (this.smaaPass ?? this.mainPass).dithering = true;
    this.setSize();
  }

  /** World passes drawing-buffer pixels; the composer reads the real size from the renderer. */
  setSize(_w?: number, _h?: number) {
    if (!this.composer) return;
    const s = this.ctx.renderer.getSize(new THREE.Vector2());
    this.composer.setSize(s.x, s.y, false);
  }

  setQuality(q: QualityPreset) {
    this.quality = q;
    if (this.composer) this.build();
  }

  render(ctx: FrameContext) {
    const r = ctx.renderer;
    if (r.toneMapping !== THREE.NoToneMapping) r.toneMapping = THREE.NoToneMapping;
    this.composer.render(ctx.dt);
  }

  /** Depth of field for menus/replays. focusDistance in metres from the camera. */
  setDof(enabled: boolean, focusDistance?: number) {
    if (focusDistance !== undefined && focusDistance > 0) this.dofFocus = focusDistance;
    this.dofEnabled = enabled;
    if (!this.composer) return;
    if (this.dof && enabled) {
      this.dof.cocMaterial.focusDistance = this.dofFocus;
      this.dof.cocMaterial.focusRange = Math.max(DOF.minRange, this.dofFocus * DOF.rangeFraction);
    }
    this.build();
  }

  /** Tweak the colour grade at runtime (e.g. per time of day). */
  setGrade(values: Partial<Record<'uContrast' | 'uSaturation' | 'uVibrance' | 'uVignette', number>>) {
    for (const [k, v] of Object.entries(values)) {
      const u = this.grade?.uniforms.get(k);
      if (u && v !== undefined) u.value = v;
    }
  }

  dispose() {
    this.composer?.dispose();
    this.aoPass?.dispose();
  }
}
