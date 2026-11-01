/**
 * STUB — Procedural Web Audio (owner: input+audio builder).
 */
import type { SurfaceId } from '../config';
import type { StrikeQuality } from '../physics/impact';

export class AudioSystem {
  /** Must be called from a user gesture before sounds can play. */
  unlock() {}
  /** Swing whoosh while the club moves; speed in mph (call every frame during a swing). */
  swingUpdate(_speedMph: number) {}
  strike(_quality: StrikeQuality, _clubKind: string, _speedMph: number, _surface: SurfaceId) {}
  bounce(_surface: SurfaceId, _speed: number) {}
  roll(_surface: SurfaceId, _speed: number) {}
  cup() {}
  splash(_strength: number) {}
  propHit(_kind: string, _speed: number) {}
  ui(_kind: 'tick' | 'click' | 'open' | 'close' | 'error' | 'success') {}
  /** Adjustment tick for face/path/aim/stance changes (rate-limited, pitch varies). */
  adjust(_kind: 'face' | 'path' | 'aim' | 'stance' | 'club') {}
  crowd(_kind: 'applause' | 'groan' | 'cheer') {}
  /** Ambience: wind speed (m/s) & listener; call each frame. */
  update(_dt: number, _windSpeed: number) {}
  setVolumes(_master: number, _sfx: number, _ambience: number) {}
}
