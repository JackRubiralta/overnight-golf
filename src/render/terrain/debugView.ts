/**
 * Dev-only terrain inspection page (not part of the game bundle):
 *   /src/render/terrain/debug.html?cam=x,up,z&look=x,up,z[&tod=golden][&q=high]
 * Heights are relative to the ground under each point. Renders sky + terrain only.
 */
import { CourseField } from '../../course/CourseField';
import { Course } from '../../course/Course';
import { bakeCourse } from '../../course/bake';
import { settings } from '../../core/settings';
import { World } from '../World';
import { SkySystem } from '../Sky';
import { Terrain } from '../Terrain';

async function main() {
  const p = new URLSearchParams(location.search);
  const q = p.get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') settings.data.quality = q;
  const tod = p.get('tod');
  if (tod) settings.data.timeOfDay = tod as typeof settings.data.timeOfDay;
  const field = new CourseField();
  const grids = await bakeCourse(field);
  const course = new Course(field, grids);
  const world = new World(document.getElementById('app')!);
  await world.init(course, grids, [new SkySystem(), new Terrain()], null);
  const v = (s: string | null, d: number[]) => (s ? s.split(',').map(Number) : d);
  const [cx, cu, cz] = v(p.get('cam'), [0, 2, 150]);
  const [lx, lu, lz] = v(p.get('look'), [0, 0, 0]);
  world.camera.position.set(cx, course.height(cx, cz) + cu, cz);
  world.camera.lookAt(lx, course.height(lx, lz) + lu, lz);
  world.updateSunShadow(world.camera.position.clone().lerp(world.camera.position, 0.5));
  window.__stats = () => world.stats();
  let frames = 0;
  const loop = () => {
    world.frame(1 / 60);
    if (++frames === 4) window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}
void main();
