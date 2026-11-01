import { it } from 'vitest';
import { Vector3 } from 'three';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { launchToWorld } from '../src/physics/impact';
import { MPH, YARD } from '../src/config';
// TrackMan PGA Tour averages: ball mph, launch, spin → carry yds, apex yds
const TOUR = [
  ['Driver', 167, 10.9, 2686, 275, 32], ['3W', 158, 9.2, 3655, 243, 30], ['5W', 152, 9.4, 4350, 230, 31],
  ['Hyb', 146, 10.2, 4437, 225, 29], ['5i', 132, 12.1, 5361, 194, 31], ['7i', 120, 16.3, 7097, 172, 32],
  ['9i', 109, 20.4, 8647, 152, 30], ['PW', 102, 24.2, 9304, 136, 29],
] as const;
it('tour calibration', () => {
  const out: string[] = [];
  for (const [n, bs, lv, rpm, carry, apex] of TOUR) {
    const sim = new BallSim({ terrain: new FlatTerrain('fairway') });
    sim.place(new Vector3());
    const l = { ballSpeed: bs * MPH, launchV: lv, launchH: 0, spinRpm: rpm, spinAxis: 0, smash: 1, spinLoft: 0, faceToPath: 0, quality: 'pure' as const };
    const { velocity, spin } = launchToWorld(l, new Vector3(0, 0, -1));
    sim.launch(velocity, spin);
    sim.simulate();
    out.push(`${n.padEnd(6)} carry ${(-sim.carryPos!.z / YARD).toFixed(0)} (tour ${carry})  apex ${(sim.apex / YARD).toFixed(0)} (tour ${apex}) total ${(-sim.pos.z / YARD).toFixed(0)}`);
  }
  console.log(out.join('\n'));
});
