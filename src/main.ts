import { CourseField } from './course/CourseField';
import { Course } from './course/Course';
import { bakeCourse } from './course/bake';

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
  if (view) {
    const { runViewer } = await import('./viewer');
    await runViewer(course, grids, view);
    return;
  }
  const { runViewer } = await import('./viewer');
  await runViewer(course, grids, 'tee');
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;z-index:9">${String(e?.stack ?? e)}</pre>`);
});
