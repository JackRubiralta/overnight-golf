import { describe, it, expect } from 'vitest';
import { SwingModel } from '../src/swing/SwingModel';
import { clubById } from '../src/physics/clubs';
import { DEG, MPH } from '../src/config';

/** Drive the hand target around an arc: back to `back` deg over tBack, then through to `through` deg over tDown. */
export function scriptedSwing(clubId: string, o: { back?: number; tBack?: number; tDown?: number; radius?: number; through?: number; stance?: number; teed?: boolean; jitter?: number } = {}) {
  const m = new SwingModel(clubById(clubId), { stance: o.stance ?? 0, teed: o.teed ?? clubId === 'D' });
  const back = (o.back ?? 110) * DEG;
  const through = (o.through ?? 110) * DEG;
  const tBack = o.tBack ?? 0.9;
  const tDown = o.tDown ?? 0.45;
  const rf = o.radius ?? 1.0;
  const dt = 1 / 240;
  const S = m.geo.shoulder;
  const R = m.geo.armLen * rf;
  m.grabbing = true;
  let t = 0;
  let impact = null as ReturnType<SwingModel['step']>;
  const ang = (t: number) => {
    if (t < tBack) { const u = t / tBack; return -back * (1 - Math.cos(u * Math.PI)) / 2; }
    if (t < tBack + 0.12) return -back; // pause at top
    const u = Math.min(1, (t - tBack - 0.12) / tDown);
    return -back + (back + through) * (u * u * (3 - 2 * u)) ** 1.0 * 1;
  };
  let jitterSeed = 1;
  const rnd = () => ((jitterSeed = (jitterSeed * 16807) % 2147483647) / 2147483647 - 0.5);
  while (t < tBack + 0.12 + tDown + 0.6) {
    const th = ang(t);
    const tx = S.x + Math.sin(th) * R + (o.jitter ? rnd() * o.jitter : 0);
    const ty = S.y - Math.cos(th) * R + (o.jitter ? rnd() * o.jitter : 0);
    m.drag(tx - m.target.x, ty - m.target.y);
    const r = m.step(dt);
    if (r && !impact) impact = r;
    t += dt;
  }
  return { m, impact };
}

describe('swing model', () => {
  it('a smooth full driver swing produces a realistic clubhead speed', () => {
    const { impact } = scriptedSwing('D');
    expect(impact).not.toBeNull();
    const mph = impact!.clubSpeed / MPH;
    console.log('driver mph', mph.toFixed(1), 'attack', impact!.attackAngle.toFixed(1), 'sole', (impact!.soleHeight * 1000).toFixed(1), 'lean', impact!.shaftLean.toFixed(1), 'fat', impact!.fatDepth);
    expect(mph).toBeGreaterThan(80);
    expect(mph).toBeLessThan(125);
  });
  it('a slower downswing produces less clubhead speed', () => {
    const fast = scriptedSwing('7I', { tDown: 0.42 }).impact!;
    const slow = scriptedSwing('7I', { tDown: 0.9 }).impact!;
    console.log('7i fast', (fast.clubSpeed / MPH).toFixed(1), 'slow', (slow.clubSpeed / MPH).toFixed(1));
    expect(slow.clubSpeed).toBeLessThan(fast.clubSpeed * 0.8);
  });
  it('a shorter backswing produces less speed', () => {
    const full = scriptedSwing('7I', { back: 120 }).impact!;
    const half = scriptedSwing('7I', { back: 50, tDown: 0.3 }).impact!;
    console.log('7i full', (full.clubSpeed / MPH).toFixed(1), 'half', (half.clubSpeed / MPH).toFixed(1));
    expect(half.clubSpeed).toBeLessThan(full.clubSpeed * 0.8);
  });
  it('swinging at the outer edge digs in (fat); swinging high thins it', () => {
    const fat = scriptedSwing('7I', { radius: 1.06 }).impact!;
    const thin = scriptedSwing('7I', { radius: 0.95 }).impact!;
    const ok = scriptedSwing('7I', { radius: 1.0 }).impact!;
    console.log('fatDepth', fat.fatDepth, 'thin sole', thin.soleHeight, 'ok sole', ok.soleHeight, ok.fatDepth);
    expect(fat.fatDepth).toBeGreaterThan(0.005);
    expect(thin.soleHeight).toBeGreaterThan(0.015);
  });
});
