import { CourseField } from './course/CourseField';
import { Course } from './course/Course';
import { bakeCourse } from './course/bake';
import type { UIHandlers } from './core/view';

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: () => unknown;
    __game?: unknown;
    __shot?: string;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if (view) {
    const field = new CourseField();
    const grids = await bakeCourse(field);
    const course = new Course(field, grids);
    const { runViewer } = await import('./viewer');
    await runViewer(course, grids, view);
    return;
  }
  // Game mode: build the UI first so the loading screen shows immediately.
  const [{ World }, { createModules, enabledModules }, { Input }, { AudioSystem }, { UI }, { Game }] = await Promise.all([
    import('./render/World'),
    import('./render/registry'),
    import('./core/Input'),
    import('./audio/Audio'),
    import('./ui/UI'),
    import('./game/Game'),
  ]);
  const world = new World(document.getElementById('app')!);
  const input = new Input(world.renderer.domElement);
  const audio = new AudioSystem();
  const handlers: { target: UIHandlers | null } = { target: null };
  const proxy: UIHandlers = {
    onPlay: (o) => handlers.target?.onPlay(o),
    onResume: () => handlers.target?.onResume(),
    onQuitToTitle: () => handlers.target?.onQuitToTitle(),
    onRestartHole: () => handlers.target?.onRestartHole(),
    onNextHole: () => handlers.target?.onNextHole(),
    onCloseScorecard: () => handlers.target?.onCloseScorecard?.(),
  };
  const ui = new UI(document.getElementById('ui-root')!, proxy, input, audio);
  ui.setLoading(0.02, 'Shaping the landscape…');
  const field = new CourseField();
  const grids = await bakeCourse(field, (p) => ui.setLoading(0.05 + p * 0.6, 'Shaping the landscape…'));
  const course = new Course(field, grids);
  ui.setLoading(0.7, 'Growing grass and trees…');
  await new Promise((r) => setTimeout(r, 0));
  const mods = createModules();
  const { list, post } = enabledModules(mods);
  await world.init(course, grids, list, post);
  mods.props.setTreeColliders(mods.foliage.colliders);
  ui.setLoading(0.95, 'Raking the bunkers…');
  const game = new Game(world, mods, course, { input, audio, ui, handlers });
  window.__stats = () => world.stats();
  // Warm-up frame so shaders compile behind the loading screen.
  game.toTitle();
  game.update(1 / 60);
  ui.hideLoading();
  const autostart = params.get('play');
  if (autostart !== null) game.startRound(Number(autostart) || 0, 'round');
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    game.update((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  window.__ready = true;
  loop();
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;z-index:9;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
