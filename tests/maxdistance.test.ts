/** Regression: no more 500-yard drives. The hardest possible swing is capped to realistic distances. */
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { scriptedSwing } from './swing.test';
import { capClubSpeed, SPEED_CAP_MPH } from '../src/swing/SwingModel';
import { clubById } from '../src/physics/clubs';
import { computeLaunch, launchToWorld } from '../src/physics/impact';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { MPH, YARD } from '../src/config';

function maxDrive(wind?: Vector3) {
  const club = clubById('D');
  // Best-case delivery at the cap: square, slightly up, ideal launch.
  const l = computeLaunch({ club, clubSpeed: SPEED_CAP_MPH.driver * MPH, faceAngle: 0, path: 0, attackAngle: 3, dynamicLoft: 13.5, strikeH: 0, strikeV: 2, fat: 0, lie: 'tee' }, () => 0.5);
  const sim = new BallSim({ terrain: new FlatTerrain('fairway'), wind: wind ? (_p, o) => o.copy(wind) : undefined });
  sim.place(new Vector3());
  const { velocity, spin } = launchToWorld(l, new Vector3(0, 0, -1));
  sim.launch(velocity, spin);
  sim.simulate();
  return { carry: -sim.carryPos!.z / YARD, total: -sim.pos.z / YARD };
}

describe('maximum distance', () => {
  it('even a violent mouse flick cannot exceed the driver speed cap', () => {
    const { impact } = scriptedSwing('D', { tDown: 0.08, back: 170 });
    expect(impact!.clubSpeed / MPH).toBeLessThanOrEqual(SPEED_CAP_MPH.driver + 0.01);
  });
  it('normal swings are unaffected by the cap', () => {
    const v = 95 * MPH;
    expect(capClubSpeed(clubById('D'), v)).toBeCloseTo(v, 6);
  });
  it('the best possible drive stays realistic (calm and downwind)', () => {
    const calm = maxDrive();
    const down = maxDrive(new Vector3(0, 0, -8.5));
    console.log('max drive calm', calm, 'tailwind', down);
    expect(calm.total).toBeLessThan(340);
    expect(down.total).toBeLessThan(390);
  });
});
