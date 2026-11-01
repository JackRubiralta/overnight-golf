/**
 * Wind: a slowly wandering base wind plus gusts. Speed scales with height above the ground
 * (log-ish boundary layer), so low punch shots are less affected than high wedges.
 */
import { Vector3 } from 'three';
import { PHYS } from '../config';
import { settings, type Settings } from '../core/settings';
import { mulberry32 } from '../course/noise';

const WEATHER: Record<Settings['weather'], { min: number; max: number; gust: number }> = {
  calm: { min: 0, max: 1.5, gust: 0.3 },
  breezy: { min: 1.5, max: 4.5, gust: 1.0 },
  windy: { min: 4.5, max: 8.5, gust: 2.2 },
  rain: { min: 2.5, max: 6, gust: 1.6 },
};

export class Wind {
  /** Direction the wind blows TOWARD (unit, horizontal). */
  dir = new Vector3(1, 0, 0);
  /** Reference speed at 10 m (m/s). */
  speed = 3;
  private baseAngle = 0;
  private baseSpeed = 3;
  private t = 0;
  private rng = mulberry32(99);
  private gustPhase = 0;

  constructor(seed = 7) {
    this.rng = mulberry32(seed);
    this.reroll();
  }

  /** New wind for a new hole. */
  reroll() {
    const w = WEATHER[settings.get('weather')];
    this.baseAngle = this.rng() * Math.PI * 2;
    this.baseSpeed = w.min + (w.max - w.min) * this.rng();
    this.gustPhase = this.rng() * 100;
    this.update(0);
  }

  update(dt: number) {
    this.t += dt;
    const w = WEATHER[settings.get('weather')];
    const t = this.t + this.gustPhase;
    // Slow direction wander (±12°) and gusts (a few seconds period).
    const ang = this.baseAngle + 0.2 * Math.sin(t * 0.05) + 0.08 * Math.sin(t * 0.23);
    const gust = w.gust * (0.5 * Math.sin(t * 0.7) + 0.3 * Math.sin(t * 1.9 + 1) + 0.2 * Math.sin(t * 3.1 + 2));
    this.speed = Math.max(0, this.baseSpeed + gust * 0.5);
    this.dir.set(Math.cos(ang), 0, Math.sin(ang));
  }

  /** Wind velocity at a point (m/s) given ground height there. */
  at(pos: Vector3, groundY: number, out: Vector3): Vector3 {
    const h = Math.max(0.05, pos.y - groundY);
    const prof = PHYS.windGroundFactor + (1 - PHYS.windGroundFactor) * Math.min(1, Math.log(h / 0.03) / Math.log(PHYS.windRefHeight / 0.03));
    return out.copy(this.dir).multiplyScalar(this.speed * Math.max(0.15, prof));
  }
}
