import { CourseField } from './course/CourseField';
import { Course } from './course/Course';
import { bakeCourse } from './course/bake';
import type { UIHandlers } from './core/view';
import { phase, gpuSync } from './render/perf/timing';

declare global {
  interface Window {
    __ready?: boolean;
    __stats?: () => unknown;
    __game?: unknown;
    __shot?: string;
  }
}

async function boot() {
  phase('navigation → boot');
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
  phase('import modules');
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
  phase('world/input/audio/ui ctor');
  const field = new CourseField();
  // The bake runs in Web Workers; meanwhile the main thread prepares course-independent
  // resources (procedural textures, tree geometry, Rapier WASM) instead of idling.
  const bakeStart = performance.now();
  let bakeMs = 0;
  const baking = bakeCourse(field, (p) => ui.setLoading(0.05 + p * 0.6, 'Shaping the landscape…')).then((g) => {
    bakeMs = performance.now() - bakeStart;
    return g;
  });
  const mods = createModules();
  const { list, post } = enabledModules(mods);
  await world.prepare(list);
  phase('prepare (overlaps the bake)');
  const grids = await baking;
  const course = new Course(field, grids);
  phase(`course bake done (bake took ${bakeMs.toFixed(0)} ms)`);
  ui.setLoading(0.7, 'Growing grass and trees…');
  await new Promise((r) => setTimeout(r, 0));
  await world.init(course, grids, list, post);
  mods.props.setTreeColliders(mods.foliage.colliders);
  (mods.foliage as { onCollidersChanged?: ((c: typeof mods.foliage.colliders) => void) | null }).onCollidersChanged = (c) => mods.props.setTreeColliders(c);
  phase('world.init total');
  ui.setLoading(0.95, 'Raking the bunkers…');
  const game = new Game(world, mods, course, { input, audio, ui, handlers });
  phase('game ctor');
  window.__stats = () => world.stats();
  game.toTitle();
  // ?play=N: start the round now so the shader warm-up and the warm-up frame see the real first
  // view (no extra full cloud-cube refresh for a title camera that is never shown).
  const autostart = params.get('play');
  if (autostart !== null) game.startRound(Number(autostart) || 0, 'round');
  phase('toTitle / startRound');
  ui.setLoading(0.97, 'Mixing the paint…');
  // Compile every material behind the loading screen (parallel where the driver allows it) …
  await world.compileShaders();
  gpuSync(world.renderer.getContext());
  phase('compile shaders');
  // … then one real frame: shadow-depth/post programs, cloud cube, first GPU uploads.
  game.update(1 / 60);
  gpuSync(world.renderer.getContext());
  phase('warm-up frame');
  ui.hideLoading();
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    game.update((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  window.__ready = true;
  loop();
  phase('first frame (ready)');
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;z-index:9;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`);
});
