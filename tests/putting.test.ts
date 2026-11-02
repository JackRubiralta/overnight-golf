import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { SwingModel } from '../src/swing/SwingModel';
import { clubById } from '../src/physics/clubs';
import { computeLaunch, launchToWorld } from '../src/physics/impact';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { DEG } from '../src/config';

function putt(backDeg: number, tDown: number) {
  const m = new SwingModel(clubById('P'));
  const S = m.geo.shoulder, R = m.geo.armLen; const dt = 1 / 240; m.grabbing = true;
  let t = 0; let imp = null as ReturnType<SwingModel['step']>;
  const back = backDeg * DEG, through = backDeg * DEG;
  while (t < 3 && !imp) {
    let th; if (t < 0.6) th = -back * (1 - Math.cos(t / 0.6 * Math.PI)) / 2; else if (t < 0.7) th = -back; else { const u = Math.min(1, (t - 0.7) / tDown); th = -back + (back + through) * u * u * (3 - 2 * u); }
    m.drag(S.x + Math.sin(th) * R - m.cursor.x, S.y - Math.cos(th) * R - m.cursor.y);
    imp = m.step(dt); t += dt;
  }
  if (!imp) return null;
  const l = computeLaunch({ club: m.club, clubSpeed: imp.clubSpeed, faceAngle: 0, path: 0, attackAngle: imp.attackAngle, dynamicLoft: 3 - imp.shaftLean * 0.5, strikeH: 0, strikeV: Math.max(-8, Math.min(8, imp.strikeV)), fat: 0, lie: 'green' }, () => 0.5);
  const sim = new BallSim({ terrain: new FlatTerrain('green') });
  sim.place(new Vector3());
  const { velocity, spin } = launchToWorld(l, new Vector3(0, 0, -1));
  sim.launch(velocity, spin); sim.simulate();
  return { dist: -sim.pos.z, speed: imp.clubSpeed, armed: m.armed, launchV: l.launchV };
}
describe('putting', () => {
  it('putt distance scales with stroke length', () => {
    const rows: [number, number, ReturnType<typeof putt>][] = [];
    for (const [b, td] of [[8, 0.5], [12, 0.5], [18, 0.55], [25, 0.6], [35, 0.6]] as const) rows.push([b, td, putt(b, td)]);
    console.log(rows.map(([b, td, r]) => `back ${b}° tDown ${td}: ${r ? r.dist.toFixed(1) + ' m (club ' + r.speed.toFixed(2) + ' m/s, launch ' + r.launchV.toFixed(1) + ')' : 'no impact'}`).join('\n'));
    const d = rows.map((r) => (r[2] ? r[2].dist : 0));
    expect(d[4]).toBeGreaterThan(d[1]);
    // Roughly linear in backstroke length (~0.5 m per degree on a flat green).
    expect(d[1]).toBeGreaterThan(12 * 0.5 * 0.7);
    expect(d[1]).toBeLessThan(12 * 0.5 * 1.3);
    expect(d[4]).toBeGreaterThan(35 * 0.5 * 0.7);
    expect(d[4]).toBeLessThan(35 * 0.5 * 1.3);
  });
  it('tempo only nudges the distance (not 2 inches vs 2 miles)', () => {
    const fast = putt(20, 0.25)!;
    const slow = putt(20, 0.9)!;
    console.log('tempo fast', fast.dist.toFixed(2), 'slow', slow.dist.toFixed(2));
    expect(fast.dist / slow.dist).toBeLessThan(1.35);
    expect(fast.dist / slow.dist).toBeGreaterThan(0.75);
  });
});
