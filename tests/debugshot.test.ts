import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { nominalDelivery, solveSpeed, syntheticImpact } from '../src/swing/debugShot';
import { clubById } from '../src/physics/clubs';
import { computeLaunch, launchToWorld } from '../src/physics/impact';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { MPH, YARD } from '../src/config';

function total(clubId: string, mph: number, surf: 'fairway' | 'green' = 'fairway') {
  const d = nominalDelivery(clubById(clubId), mph, surf);
  const l = computeLaunch(d, () => 0.5);
  const sim = new BallSim({ terrain: new FlatTerrain(surf), rng: () => 0.5 });
  sim.place(new Vector3());
  const { velocity, spin } = launchToWorld(l, new Vector3(0, 0, -1));
  sim.launch(velocity, spin);
  sim.simulate();
  return { total: -sim.pos.z, carry: -(sim.carryPos?.z ?? 0), quality: l.quality };
}

describe('debug shots (synthetic deliveries)', () => {
  it('builds a square, centred, nominal delivery', () => {
    const d = nominalDelivery(clubById('7I'), 87, 'fairway');
    expect(d.clubSpeed).toBeCloseTo(87 * MPH);
    expect(d.faceAngle).toBe(0);
    expect(d.path).toBe(0);
    expect(d.attackAngle).toBeLessThan(0);
    expect(d.dynamicLoft).toBeLessThan(clubById('7I').loft);
    expect(computeLaunch(d, () => 0.5).quality).toBe('pure');
  });
  it('overrides apply and whiff zeroes the speed', () => {
    const d = nominalDelivery(clubById('D'), 100, 'tee', { face: 3, path: -2, attack: 4, whiff: false });
    expect([d.faceAngle, d.path, d.attackAngle]).toEqual([3, -2, 4]);
    const w = nominalDelivery(clubById('D'), 100, 'tee', { whiff: true });
    expect(w.clubSpeed).toBe(0);
    expect(syntheticImpact(w, true).whiff).toBe(true);
  });
  it('nominal driver at 110 mph carries 250-280 yd', () => {
    const r = total('D', 110);
    expect(r.carry / YARD).toBeGreaterThan(245);
    expect(r.carry / YARD).toBeLessThan(285);
  });
  it('solveSpeed finds the speed for a target distance (iron and putt)', () => {
    const v = solveSpeed((mph) => total('7I', mph).total, 120);
    expect(Math.abs(total('7I', v).total - 120)).toBeLessThan(1.5);
    const p = solveSpeed((mph) => total('P', mph, 'green').total, 6, 1, 25);
    expect(Math.abs(total('P', p, 'green').total - 6)).toBeLessThan(0.2);
  });
  it('solveSpeed clamps to the bounds when the target is unreachable', () => {
    expect(solveSpeed((mph) => mph, 500, 1, 130)).toBe(130);
    expect(solveSpeed((mph) => mph + 10, 5, 1, 130)).toBe(1);
  });
});
