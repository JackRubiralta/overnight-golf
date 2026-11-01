import { CourseField } from './course/CourseField';
import { Course } from './course/Course';
import { bakeCourse } from './course/bake';
import { World } from './render/World';
import { SkySystem } from './render/Sky';
import { Terrain } from './render/Terrain';
import { viewPreset } from './render/views';

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: () => unknown;
    __game?: unknown;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  const field = new CourseField();
  const grids = await bakeCourse(field);
  const course = new Course(field, grids);
  const world = new World(document.getElementById('app')!);
  await world.init(course, grids, [new SkySystem(), new Terrain()], null);
  window.__stats = () => world.stats();
  const v = viewPreset(view ?? 'tee', course)!;
  world.camera.position.copy(v.pos);
  world.camera.lookAt(v.look);
  world.updateSunShadow(v.look);
  let frames = 0;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    world.frame(dt);
    if (++frames === 3) window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;z-index:9">${String(e?.stack ?? e)}</pre>`);
});
