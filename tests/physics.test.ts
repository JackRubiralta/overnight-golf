import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { BallSim, FlatTerrain } from '../src/physics/BallSim';
import { computeLaunch, launchToWorld, type ClubDelivery } from '../src/physics/impact';
import { clubById } from '../src/physics/clubs';
import { MPH, YARD, type SurfaceId } from '../src/config';

const fixedRng = () => 0.5;

function delivery(over: Partial<ClubDelivery> & { clubId?: string; mph?: number }): ClubDelivery {
  const club = clubById(over.clubId ?? 'D');
  const defaults: Record<string, { attack: number; dyn: number }> = {
    driver: { attack: 0, dyn: club.loft + 4 },
    wood: { attack: -1.5, dyn: club.loft + 1 },
    hybrid: { attack: -2.5, dyn: club.loft - 1 },
    iron: { attack: -4, dyn: club.loft - 9 },
    wedge: { attack: -5, dyn: club.loft - 13 },
    putter: { attack: 1, dyn: 3 },
  };
  const def = defaults[club.kind];
  return {
    club,
    clubSpeed: (over.mph ?? club.refSpeedMph) * MPH,
    faceAngle: 0,
    path: 0,
    attackAngle: def.attack,
    dynamicLoft: def.dyn,
    strikeH: 0,
    strikeV: 0,
    fat: 0,
    lie: 'fairway',
    ...over,
  };
}

export function hit(d: ClubDelivery, surf: SurfaceId = 'fairway', wind?: Vector3) {
  const launch = computeLaunch(d, fixedRng);
  const sim = new BallSim({
    terrain: new FlatTerrain(surf),
    wind: wind ? (_p, out) => out.copy(wind) : undefined,
    rng: fixedRng,
  });
  sim.place(new Vector3(0, 0, 0));
  const { velocity, spin } = launchToWorld(launch, new Vector3(0, 0, -1));
  sim.launch(velocity, spin);
  sim.simulate();
  const carry = sim.carryPos!;
  // Target line is -Z; right is +X.
  return {
    launch,
    carryYds: -carry.z / YARD,
    totalYds: -sim.pos.z / YARD,
    carryOffline: carry.x / YARD,
    totalOffline: sim.pos.x / YARD,
    apexYds: sim.apex / YARD,
    sim,
  };
}

describe('impact model (D-plane)', () => {
  it('driver at 110 mph square has realistic launch numbers', () => {
    const l = computeLaunch(delivery({ mph: 110 }), fixedRng);
    expect(l.ballSpeed / MPH).toBeGreaterThan(155);
    expect(l.ballSpeed / MPH).toBeLessThan(168);
    expect(l.launchV).toBeGreaterThan(10);
    expect(l.launchV).toBeLessThan(16);
    expect(l.spinRpm).toBeGreaterThan(2000);
    expect(l.spinRpm).toBeLessThan(3400);
  });
  it('face angle dominates start direction, face-to-path sets curve', () => {
    const open = computeLaunch(delivery({ mph: 100, faceAngle: 4, path: 0 }), fixedRng);
    expect(open.launchH).toBeGreaterThan(3);
    expect(open.spinAxis).toBeGreaterThan(5);
    const draw = computeLaunch(delivery({ mph: 100, faceAngle: 2, path: 6 }), fixedRng);
    expect(draw.launchH).toBeGreaterThan(0); // starts right
    expect(draw.spinAxis).toBeLessThan(0); // curves left
  });
  it('7 iron has more spin than driver, wedge more still', () => {
    const d = computeLaunch(delivery({ mph: 105 }), fixedRng);
    const i7 = computeLaunch(delivery({ clubId: '7I', mph: 87 }), fixedRng);
    const pw = computeLaunch(delivery({ clubId: 'PW', mph: 81 }), fixedRng);
    expect(i7.spinRpm).toBeGreaterThan(d.spinRpm * 1.8);
    expect(pw.spinRpm).toBeGreaterThan(i7.spinRpm);
    expect(i7.launchV).toBeGreaterThan(d.launchV);
  });
  it('fat and toe strikes lose ball speed', () => {
    const pure = computeLaunch(delivery({ clubId: '7I' }), fixedRng);
    const fat = computeLaunch(delivery({ clubId: '7I', fat: 0.5 }), fixedRng);
    const toe = computeLaunch(delivery({ clubId: '7I', strikeH: 18 }), fixedRng);
    expect(fat.ballSpeed).toBeLessThan(pure.ballSpeed * 0.8);
    expect(toe.ballSpeed).toBeLessThan(pure.ballSpeed * 0.97);
    expect(fat.quality).toBe('fat');
  });
});

describe('ball flight', () => {
  it('driver 110 mph square carries 250–280 yards', () => {
    const r = hit(delivery({ mph: 110 }));
    expect(r.carryYds).toBeGreaterThan(250);
    expect(r.carryYds).toBeLessThan(280);
    expect(r.totalYds).toBeGreaterThan(r.carryYds + 8);
    expect(Math.abs(r.totalOffline)).toBeLessThan(2);
  });
  it('7 iron at 87 mph carries ~150–175 yards', () => {
    const r = hit(delivery({ clubId: '7I', mph: 87 }));
    expect(r.carryYds).toBeGreaterThan(145);
    expect(r.carryYds).toBeLessThan(178);
    expect(r.totalYds - r.carryYds).toBeLessThan(15);
  });
  it('pitching wedge stops quickly on the green', () => {
    const r = hit(delivery({ clubId: 'PW', mph: 81 }), 'green');
    expect(r.carryYds).toBeGreaterThan(105);
    expect(r.carryYds).toBeLessThan(135);
    expect(Math.abs(r.totalYds - r.carryYds)).toBeLessThan(8);
  });
  it('open face curves right (slice), closed face curves left (hook)', () => {
    const slice = hit(delivery({ mph: 100, faceAngle: 4, path: -2 }));
    expect(slice.totalOffline).toBeGreaterThan(20);
    const hook = hit(delivery({ mph: 100, faceAngle: -4, path: 2 }));
    expect(hook.totalOffline).toBeLessThan(-20);
  });
  it('a draw starts right and finishes left of its start line', () => {
    const r = hit(delivery({ mph: 100, faceAngle: 1, path: 5 }));
    const maxRight = Math.max(...r.sim.trail.map((p) => p.x));
    expect(r.launch.launchH).toBeGreaterThan(0);
    expect(maxRight).toBeGreaterThan(0.5);
    expect(r.carryOffline).toBeLessThan(maxRight / YARD); // bending back left
  });
  it('headwind shortens and tailwind lengthens', () => {
    const calm = hit(delivery({ mph: 105 }));
    const head = hit(delivery({ mph: 105 }), 'fairway', new Vector3(0, 0, 8));
    const tail = hit(delivery({ mph: 105 }), 'fairway', new Vector3(0, 0, -8));
    expect(head.carryYds).toBeLessThan(calm.carryYds - 10);
    expect(tail.carryYds).toBeGreaterThan(calm.carryYds + 5);
  });
  it('rough lie flies with less spin', () => {
    const fw = computeLaunch(delivery({ clubId: '7I' }), fixedRng);
    const rough = computeLaunch(delivery({ clubId: '7I', lie: 'rough' }), fixedRng);
    expect(rough.spinRpm).toBeLessThan(fw.spinRpm * 0.8);
  });
  it('topped shot runs along the ground', () => {
    const r = hit(delivery({ clubId: '7I', strikeV: -26 }));
    expect(r.launch.quality).toBe('topped');
    expect(r.apexYds).toBeLessThan(1.5);
    expect(r.totalYds).toBeLessThan(110);
  });
});

describe('putting & rolling', () => {
  it('stimp ~10: a 1.83 m/s roll on flat green travels ~3 m', () => {
    const sim = new BallSim({ terrain: new FlatTerrain('green') });
    sim.place(new Vector3(0, 0, 0));
    sim.launch(new Vector3(0, 0, -1.83), new Vector3(0, 0, 0));
    sim.state = 'rolling';
    sim.simulate();
    expect(-sim.pos.z).toBeGreaterThan(2.6);
    expect(-sim.pos.z).toBeLessThan(3.5);
  });
  it('a putt on a side slope breaks downhill', () => {
    // Slope: terrain rises toward -x (height = -0.02 x) so downhill is +x.
    const sim = new BallSim({ terrain: new FlatTerrain('green', new Vector3(-0.02, 0, 0)) });
    sim.place(new Vector3(0, 0, 0));
    sim.launch(new Vector3(0, 0, -3), new Vector3(0, 0, 0));
    sim.state = 'rolling';
    sim.simulate();
    expect(sim.pos.x).toBeGreaterThan(0.3);
  });
  it('a firm putt over the cup lips out, a dying putt drops', () => {
    const mk = (speed: number) => {
      const sim = new BallSim({ terrain: new FlatTerrain('green'), cup: new Vector3(0, 0, -2) });
      sim.place(new Vector3(0, 0, 0));
      sim.launch(new Vector3(0, 0, -speed), new Vector3());
      sim.state = 'rolling';
      sim.simulate();
      return sim.state;
    };
    expect(mk(1.7)).toBe('holed');
    expect(mk(4.5)).not.toBe('holed');
  });
});

describe('report', () => {
  it('prints a club table', () => {
    const rows: string[] = [];
    for (const id of ['D', '3W', '5W', '4H', '5I', '7I', '9I', 'PW', 'SW', 'LW']) {
      const r = hit(delivery({ clubId: id }));
      rows.push(`${id.padEnd(3)} ${(r.launch.ballSpeed / MPH).toFixed(0)}mph L${r.launch.launchV.toFixed(1)} ${r.launch.spinRpm.toFixed(0)}rpm carry ${r.carryYds.toFixed(0)} total ${r.totalYds.toFixed(0)} apex ${r.apexYds.toFixed(0)}`);
    }
    console.log(rows.join('\n'));
  });
});
