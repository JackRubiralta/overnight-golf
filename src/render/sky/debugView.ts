/**
 * Dev-only sky/post inspection page (not part of the game bundle):
 *   /src/render/sky/debug.html?yaw=240&pitch=12[&tod=golden][&weather=rain][&q=high][&terrain=1][&post=1][&frames=6]
 * yaw: compass degrees the camera faces (0 = +z south, 90 = +x east, matches the sun azimuth).
 * The render loop stops after `frames` frames so headless screenshots are cheap.
 */
import * as THREE from 'three';
import { CourseField } from '../../course/CourseField';
import { Course } from '../../course/Course';
import { bakeCourse } from '../../course/bake';
import { settings } from '../../core/settings';
import { World } from '../World';
import { SkySystem } from '../Sky';
import { Terrain } from '../Terrain';
import { Post } from '../Post';
import { viewPreset } from '../views';

async function main() {
  const p = new URLSearchParams(location.search);
  const q = p.get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') settings.data.quality = q;
  const tod = p.get('tod');
  if (tod) settings.data.timeOfDay = tod as typeof settings.data.timeOfDay;
  const weather = p.get('weather');
  if (weather) settings.data.weather = weather as typeof settings.data.weather;
  const field = new CourseField();
  const grids = await bakeCourse(field);
  const course = new Course(field, grids);
  const world = new World(document.getElementById('app')!);
  const sky = new SkySystem();
  const mods = p.get('terrain') === '1' ? [sky, new Terrain()] : [sky];
  await world.init(course, grids, mods, p.get('post') === '1' ? new Post() : null);
  const wind = (p.get('wind') ?? '1,0,4').split(',').map(Number);
  sky.setWind(wind[0], wind[1], wind[2]);

  const view = p.get('view');
  const preset = view ? viewPreset(view, course) : null;
  if (preset) {
    world.camera.position.copy(preset.pos);
    world.camera.lookAt(preset.look);
  } else {
    const yaw = THREE.MathUtils.degToRad(Number(p.get('yaw') ?? 242));
    const pitch = THREE.MathUtils.degToRad(Number(p.get('pitch') ?? 10));
    const cam = world.camera.position.set(0, course.height(0, 0) + Number(p.get('h') ?? 2), 0);
    world.camera.lookAt(cam.x + Math.sin(yaw) * Math.cos(pitch), cam.y + Math.sin(pitch), cam.z + Math.cos(yaw) * Math.cos(pitch));
  }
  world.updateSunShadow(world.camera.position);
  window.__stats = () => world.stats();
  const maxFrames = Number(p.get('frames') ?? 6);
  let frames = 0;
  const loop = () => {
    world.frame(1 / 60);
    if (++frames === maxFrames) {
      window.__ready = true;
      return;
    }
    requestAnimationFrame(loop);
  };
  loop();
}
void main();
