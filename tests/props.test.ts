import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { StaticIndex, SweepAccumulator, makePrimitive, sweepPrimitive, type SweepResult } from '../src/props/collision';
import { PROP_SITES } from '../src/props/sites';
import { CourseField } from '../src/course/CourseField';

const R = 0.021335;
const res = (): SweepResult => ({ t: 0, normal: new Vector3(), point: new Vector3() });

describe('prop collision primitives', () => {
  it('sphere: hits head-on with the right normal and contact point', () => {
    const p = makePrimitive({ id: 's', kind: 'test', shape: 'sphere', center: new Vector3(0, 1, 0), radius: 0.5 });
    const out = res();
    expect(sweepPrimitive(p, new Vector3(-2, 1, 0), new Vector3(0, 1, 0), R, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(-1, 5);
    expect(out.point.x).toBeCloseTo(-0.5, 4);
    expect(out.t).toBeCloseTo((2 - 0.5 - R) / 2, 4);
    // Misses when passing above.
    expect(sweepPrimitive(p, new Vector3(-2, 2, 0), new Vector3(2, 2, 0), R, out)).toBe(false);
  });

  it('soft sphere only triggers on entry', () => {
    const p = makePrimitive({ id: 'c', kind: 'tree', shape: 'sphere', center: new Vector3(), radius: 3, soft: true });
    const out = res();
    expect(sweepPrimitive(p, new Vector3(-5, 0, 0), new Vector3(-2, 0, 0), R, out)).toBe(true);
    expect(sweepPrimitive(p, new Vector3(-2, 0, 0), new Vector3(-1, 0, 0), R, out)).toBe(false);
  });

  it('vertical cylinder: lateral and top-cap hits', () => {
    const p = makePrimitive({ id: 'pin', kind: 'flagstick', shape: 'vcyl', center: new Vector3(10, 0, 0), radius: 0.0125, height: 2.1 });
    const out = res();
    expect(sweepPrimitive(p, new Vector3(9, 1, 0), new Vector3(11, 1, 0), R, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(-1, 5);
    expect(out.point.x).toBeCloseTo(10 - 0.0125, 4);
    expect(sweepPrimitive(p, new Vector3(10, 3, 0), new Vector3(10, 1.5, 0), R, out)).toBe(true);
    expect(out.normal.y).toBeCloseTo(1, 5);
    // Glancing miss.
    expect(sweepPrimitive(p, new Vector3(9, 1, 0.05), new Vector3(11, 1, 0.05), R, out)).toBe(false);
  });

  it('oriented box: rotated face normal', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    const p = makePrimitive({ id: 'b', kind: 'crate', shape: 'box', center: new Vector3(0, 0.5, 0), half: new Vector3(0.5, 0.5, 0.5), rot: q });
    const out = res();
    const dir = new Vector3(1, 0, 0).applyQuaternion(q);
    const a = dir.clone().multiplyScalar(-3).add(new Vector3(0, 0.5, 0));
    expect(sweepPrimitive(p, a, new Vector3(0, 0.5, 0), R, out)).toBe(true);
    expect(out.normal.dot(dir)).toBeCloseTo(-1, 5);
  });

  it('oriented cylinder (gong disc) hit on the face', () => {
    // Disc axis along world x (rotate local y onto x).
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0));
    const p = makePrimitive({ id: 'g', kind: 'gong', shape: 'cyl', center: new Vector3(0, 1.5, 0), radius: 0.6, height: 0.02, rot: q });
    const out = res();
    expect(sweepPrimitive(p, new Vector3(-1, 1.6, 0.2), new Vector3(1, 1.6, 0.2), R, out)).toBe(true);
    expect(out.normal.x).toBeCloseTo(-1, 5);
    expect(sweepPrimitive(p, new Vector3(-1, 1.5, 0.9), new Vector3(1, 1.5, 0.9), R, out)).toBe(false);
  });

  it('static index finds the first hit along a long sweep', () => {
    const idx = new StaticIndex(8);
    for (let i = 0; i < 50; i++) idx.add(makePrimitive({ id: `t${i}`, kind: 'tree', shape: 'vcyl', center: new Vector3(i * 4, 0, 0), radius: 0.3, height: 5 }));
    const acc = new SweepAccumulator();
    const a = new Vector3(13, 1, 0);
    const b = new Vector3(30, 1, 0);
    acc.reset();
    idx.forEachNear(a, b, R, (p) => acc.test(p, a, b, R));
    expect(acc.best?.id).toBe('t4');
  });

  it('hittable prop sites stay off fairways, greens, tees, bunkers and water', () => {
    const f = new CourseField();
    for (const site of PROP_SITES) expect(['rough', 'deepRough', 'path', 'dirt'], site.name).toContain(f.surface(site.x, site.z));
  });
});
