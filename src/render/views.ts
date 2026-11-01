/** Fixed camera views used for screenshots / visual regression. */
import * as THREE from 'three';
import type { Course } from '../course/Course';
import { HOLES } from '../course/layout';

export interface ViewDef {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

export function viewPreset(name: string, course: Course): ViewDef | null {
  const h1 = HOLES[0];
  const h3 = HOLES[2];
  const at = (x: number, z: number, up: number) => new THREE.Vector3(x, course.height(x, z) + up, z);
  switch (name) {
    case 'tee': {
      const t = h1.tee;
      return { pos: at(t[0] + 1.5, t[1] + 7, 1.9), look: at(h1.fairway[2][0], h1.fairway[2][1], 2) };
    }
    case 'fairway': {
      const p = h1.fairway[2];
      return { pos: at(p[0] + 4, p[1] + 25, 1.7), look: at(h1.green.c[0], h1.green.c[1], 1) };
    }
    case 'green': {
      const g = h1.green.c;
      return { pos: at(g[0] + 6, g[1] + 17, 1.1), look: at(h1.pin[0], h1.pin[1], 0.4) };
    }
    case 'water': {
      const t = h3.tee;
      return { pos: at(t[0] + 2, t[1] + 8, 2.2), look: at(h3.green.c[0], h3.green.c[1], 0) };
    }
    case 'wide': {
      return { pos: at(-250, 520, 150), look: at(-40, -60, 0) };
    }
    case 'grass': {
      const p = h1.fairway[1];
      return { pos: at(p[0] + 16, p[1], 0.6), look: at(p[0] + 30, p[1] - 12, 0.2) };
    }
    default:
      return null;
  }
}

export const VIEW_NAMES = ['tee', 'fairway', 'green', 'water', 'wide', 'grass'];
