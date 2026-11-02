/**
 * Dev-only grass inspection page (not part of the game bundle):
 *   /src/render/grass/debug.html?cam=x,up,z&look=x,up,z[&sunlook=drop][&tod=golden][&q=high][&post=1][&wind=8]
 * Heights are relative to the ground under each point. Renders sky + terrain + grass (+ post).
 */
import * as THREE from 'three';
import { CourseField } from '../../course/CourseField';
import { Course } from '../../course/Course';
import { bakeCourse } from '../../course/bake';
import { settings } from '../../core/settings';
import { World } from '../World';
import { SkySystem } from '../Sky';
import { Terrain } from '../Terrain';
import { Grass } from '../Grass';
import { Post } from '../Post';
import { globalUniforms } from '../shared';

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
  const grass = new Grass();
  await world.init(course, grids, [new SkySystem(), new Terrain(), grass], p.get('post') ? new Post() : null);
  const v = (s: string | null, d: number[]) => (s ? s.split(',').map(Number) : d);
  const [cx, cu, cz] = v(p.get('cam'), [12, 0.6, 20]);
  const [lx, lu, lz] = v(p.get('look'), [26, 0.2, 8]);
  world.camera.position.set(cx, course.height(cx, cz) + cu, cz);
  world.camera.lookAt(lx, course.height(lx, lz) + lu, lz);
  if (p.get('sunlook')) {
    // Look toward the sun (back-lit grass), slightly down.
    const s = globalUniforms.uSunDir.value;
    const d = new THREE.Vector3(s.x, 0, s.z).normalize();
    world.camera.lookAt(world.camera.position.clone().add(d.multiplyScalar(20)).add(new THREE.Vector3(0, -Number(p.get('sunlook')), 0)));
  }
  world.updateSunShadow(world.camera.position.clone().lerp(world.camera.position, 0.5));
  const wind = p.get('wind');
  if (wind) globalUniforms.uWindSpeed.value = Number(wind);
  const [px, pz] = v(p.get('player'), [1e5, 1e5]);
  globalUniforms.uPlayerPos.value.set(px, course.height(px, pz), pz);
  window.__stats = () => ({ ...world.stats(), ...grass.stats() });
  let frames = 0;
  const loop = () => {
    world.frame(1 / 60);
    if (++frames === 4) window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}
void main();
