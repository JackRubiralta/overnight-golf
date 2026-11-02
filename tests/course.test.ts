import { describe, it, expect } from 'vitest';
import { CourseField } from '../src/course/CourseField';
import { HOLES } from '../src/course/layout';

describe('course field', () => {
  const f = new CourseField();
  it('surfaces at key points are right', () => {
    for (const h of HOLES) {
      expect(f.surface(h.green.c[0], h.green.c[1]), `hole ${h.number} green`).toBe('green');
      expect(f.surface(h.tee[0], h.tee[1]), `hole ${h.number} tee`).toBe('tee');
      expect(f.surface(h.pin[0], h.pin[1]), `hole ${h.number} pin`).toBe('green');
      const mid = h.fairway[Math.floor(h.fairway.length / 2)];
      expect(['fairway', 'path'], `hole ${h.number} fairway`).toContain(f.surface(mid[0], mid[1]));
      for (const b of h.bunkers) expect(f.surface(b.c[0], b.c[1]), `hole ${h.number} bunker`).toBe('sand');
      for (const w of h.water) expect(f.surface(w.blobs[0].c[0], w.blobs[0].c[1]), `hole ${h.number} water`).toBe('water');
    }
  });
  it('greens are not too steep', () => {
    for (const h of HOLES) {
      const e = 1.5;
      const [x, z] = h.pin;
      const sx = (f.height(x + e, z) - f.height(x - e, z)) / (2 * e);
      const sz = (f.height(x, z + e) - f.height(x, z - e)) / (2 * e);
      expect(Math.hypot(sx, sz), `hole ${h.number}`).toBeLessThan(0.035);
    }
  });
  it('bakes quickly', () => {
    const t0 = performance.now();
    f.bakeRows(1281, 600, 640);
    const ms = performance.now() - t0;
    console.log('40 rows ms', ms.toFixed(0), '→ full est', (ms * 1281 / 40 / 1000).toFixed(1), 's');
    const heights: number[] = [];
    for (const h of HOLES) heights.push(Math.round(f.height(h.tee[0], h.tee[1])), Math.round(f.height(h.green.c[0], h.green.c[1])));
    console.log('tee/green heights', heights.join(' '));
  });
});

describe('practice green', () => {
  it('is a green surface', async () => {
    const { LANDMARKS } = await import('../src/course/layout');
    const f = new CourseField();
    expect(f.surface(LANDMARKS.practiceGreen.c[0], LANDMARKS.practiceGreen.c[1])).toBe('green');
  });
});
