/**
 * STUB — Effects: shot tracer, divots, sand/water splash, grass clippings, wind particles,
 * impact sparkle (owner: water+fx builder). The game calls these methods.
 */
import * as THREE from 'three';
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';

export type TracerStyle = 'draw' | 'fade' | 'straight';

export class Effects implements RenderModule {
  init(_ctx: InitContext) {}
  update(_ctx: FrameContext) {}
  setQuality(_q: QualityPreset) {}
  /** Begin a new tracer at the ball's launch position. Previous tracer becomes a fading ghost. */
  tracerStart(_pos: THREE.Vector3, _style: TracerStyle) {}
  /** Append the ball's current position (called every frame during flight/roll). */
  tracerPush(_pos: THREE.Vector3) {}
  /** Ball stopped: tracer stays visible and fades slowly over ~10 s. */
  tracerEnd() {}
  clearTracers() {}
  /** Divot / turf spray at impact. dir = horizontal shot direction. size 0..1. */
  divot(_pos: THREE.Vector3, _dir: THREE.Vector3, _size: number) {}
  sandSplash(_pos: THREE.Vector3, _strength: number) {}
  waterSplash(_pos: THREE.Vector3, _strength: number) {}
  /** Little puff where the ball lands on grass. */
  landPuff(_pos: THREE.Vector3, _surface: string, _strength: number) {}
  /** Bright flash/sparkle at the clubface on a pure strike. */
  impactFlash(_pos: THREE.Vector3, _quality: number) {}
}
