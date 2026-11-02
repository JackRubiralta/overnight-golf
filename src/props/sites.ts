/**
 * Where the hittable physics props live. Pure data (no three.js) so it can be validated in tests
 * (e.g. "never on a fairway, green, bunker or in water").
 * `face` is the direction the site's front looks toward — usually the tee it is seen from.
 */
export interface SiteItemDef {
  type: 'gong' | 'targets' | 'crates' | 'pots' | 'scarecrow' | 'hay';
  /** Local offsets in the site frame (x right, z toward `face`). */
  lx: number;
  lz: number;
  yaw?: number;
}

export interface SiteDefData {
  name: string;
  x: number;
  z: number;
  face: [number, number];
  items: SiteItemDef[];
}

export const PROP_SITES: SiteDefData[] = [
  // Hole 1: a gong waiting in the left rough, archery bosses out right.
  { name: 'h1-gong', x: -30, z: 100, face: [30, 50], items: [{ type: 'gong', lx: 0, lz: 0 }] },
  { name: 'h1-targets', x: 32, z: 84, face: [-32, 66], items: [{ type: 'targets', lx: -1.6, lz: 0 }, { type: 'targets', lx: 1.6, lz: -0.6, yaw: 0.15 }] },
  // Clubhouse hub: crates by the cart path, a pot pyramid near the practice green.
  { name: 'hub-crates', x: 16, z: 206, face: [-1, -1], items: [{ type: 'crates', lx: 0, lz: 0 }] },
  { name: 'hub-pots', x: -16, z: 232, face: [-0.3, -1], items: [{ type: 'pots', lx: 0, lz: 0 }] },
  // Behind the 1st green.
  { name: 'h1-green', x: -44, z: -262, face: [16, 34], items: [{ type: 'pots', lx: 0, lz: 0 }, { type: 'scarecrow', lx: 6, lz: -1.5 }] },
  // Hole 3 backstop gong right of the green.
  { name: 'h3-gong', x: -450, z: -568, face: [10, 196], items: [{ type: 'gong', lx: 0, lz: 0 }] },
  // Hole 4 farmyard inside the dogleg.
  { name: 'h4-farm', x: -428, z: -598, face: [-1, 0.2], items: [{ type: 'hay', lx: 0, lz: 0 }, { type: 'scarecrow', lx: -4, lz: 2 }] },
  // Hole 5 crates by the path.
  { name: 'h5-crates', x: 40, z: -666, face: [-1, 0.3], items: [{ type: 'crates', lx: 0, lz: 0 }] },
  // Hole 6: targets beyond the green for the brave.
  { name: 'h6-targets', x: 500, z: -402, face: [-170, -98], items: [{ type: 'targets', lx: -1.6, lz: 0 }, { type: 'targets', lx: 1.6, lz: 0 }] },
  // Hole 9: hay bales and a scarecrow by the pond.
  { name: 'h9-farm', x: -70, z: 470, face: [1, -0.4], items: [{ type: 'hay', lx: 0, lz: 0 }, { type: 'scarecrow', lx: 3.5, lz: 2.5 }] },
];
