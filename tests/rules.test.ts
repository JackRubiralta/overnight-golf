import { describe, it, expect } from 'vitest';
import { dropSearchStart, findDropPoint } from '../src/game/rules';

// A pond covering z in [-120, -80] (x anything); clear ground needs 1.5 m from the margin.
const clear = (_x: number, z: number) => z > -78.5 || z < -121.5;

describe('water relief', () => {
  it('a ball flown straight into the pond is dropped back on the line, just short of the margin', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const entry = { x: 0, y: 0, z: -100 };
    const start = dropSearchStart(origin /* lastDry never updated in flight */, entry, origin);
    expect(start).toBe(entry);
    const p = findDropPoint(start, origin, clear)!;
    expect(p.z).toBeGreaterThan(-79);
    expect(p.z).toBeLessThan(-77.5);
    expect(p.x).toBeCloseTo(0);
  });
  it('a ball that rolled in drops from its last dry contact', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const lastDry = { x: 2, y: 0, z: -79 };
    const start = dropSearchStart(lastDry, { x: 2, y: 0, z: -81 }, origin);
    expect(start).toBe(lastDry);
    const p = findDropPoint(start, origin, clear)!;
    expect(p.z).toBeGreaterThan(-79);
  });
  it('returns null when there is no dry spot on the line', () => {
    expect(findDropPoint({ x: 0, y: 0, z: -100 }, { x: 0, y: 0, z: -90 }, clear)).toBeNull();
  });
});
