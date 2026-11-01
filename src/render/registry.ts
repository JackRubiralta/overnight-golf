/**
 * Render module registry. `?only=terrain,sky,grass` (comma list) restricts which modules load,
 * which lets each subsystem be screenshotted in isolation.
 */
import { SkySystem } from './Sky';
import { Terrain } from './Terrain';
import { Grass } from './Grass';
import { WaterSystem } from './Water';
import { Foliage } from './Trees';
import { Props } from './Props';
import { Effects } from './Effects';
import { Golfer } from './Golfer';
import { Post } from './Post';
import type { RenderModule } from './shared';

export interface Modules {
  sky: SkySystem;
  terrain: Terrain;
  grass: Grass;
  water: WaterSystem;
  foliage: Foliage;
  props: Props;
  effects: Effects;
  golfer: Golfer;
  post: Post;
}

export function createModules(): Modules {
  return {
    sky: new SkySystem(),
    terrain: new Terrain(),
    grass: new Grass(),
    water: new WaterSystem(),
    foliage: new Foliage(),
    props: new Props(),
    effects: new Effects(),
    golfer: new Golfer(),
    post: new Post(),
  };
}

export function enabledModules(m: Modules): { list: RenderModule[]; post: Post | null } {
  const only = new URLSearchParams(location.search).get('only');
  const want = only ? new Set(only.split(',')) : null;
  const on = (k: keyof Modules) => !want || want.has(k);
  const order: (keyof Modules)[] = ['sky', 'terrain', 'water', 'grass', 'foliage', 'props', 'golfer', 'effects'];
  return { list: order.filter(on).map((k) => m[k] as RenderModule), post: on('post') ? m.post : null };
}
