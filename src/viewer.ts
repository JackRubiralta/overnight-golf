/**
 * Static screenshot viewer: `?view=tee|fairway|green|water|wide|grass[&only=a,b][&q=low|high]`.
 * Renders the full scene from fixed cameras for visual regression; sets window.__ready.
 */
import * as THREE from 'three';
import type { Course } from './course/Course';
import type { CourseGrids } from './course/CourseField';
import { World } from './render/World';
import { createModules, enabledModules } from './render/registry';
import { viewPreset } from './render/views';
import { SwingModel } from './swing/SwingModel';
import { clubById } from './physics/clubs';
import { HOLES } from './course/layout';
import { settings } from './core/settings';

export async function runViewer(course: Course, grids: CourseGrids, view: string) {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') settings.data.quality = q;
  const tod = params.get('tod');
  if (tod) settings.data.timeOfDay = tod as typeof settings.data.timeOfDay;
  const world = new World(document.getElementById('app')!);
  const mods = createModules();
  const { list, post } = enabledModules(mods);
  await world.init(course, grids, list, post);
  mods.props.setTreeColliders(mods.foliage.colliders);
  mods.props.setActiveHole(0);
  world.mode = 'stance';
  window.__stats = () => world.stats();
  const v = viewPreset(view, course) ?? viewPreset('tee', course)!;
  world.camera.position.copy(v.pos);
  world.camera.lookAt(v.look);
  world.updateSunShadow(v.look.clone().lerp(v.pos, 0.5));

  // Golfer + ball on the first tee, mid-backswing, for the tee view.
  const h = HOLES[0];
  const ball = new THREE.Vector3(h.tee[0], 0, h.tee[1]);
  ball.y = course.height(ball.x, ball.z) + 0.021 + 0.03;
  const aim = new THREE.Vector3(h.fairway[2][0] - h.tee[0], 0, h.fairway[2][1] - h.tee[1]).normalize();
  const sm = new SwingModel(clubById('D'), { teed: true });
  const pose = params.get('pose') ?? 'address';
  if (pose === 'top') {
    sm.grabbing = true;
    for (let i = 0; i < 240; i++) {
      const th = -Math.min(1, i / 160) * 1.9;
      sm.drag(sm.geo.shoulder.x + Math.sin(th) * sm.geo.armLen - sm.target.x, sm.geo.shoulder.y - Math.cos(th) * sm.geo.armLen - sm.target.y);
      sm.step(1 / 240);
    }
  }
  mods.props.setBall(ball);
  mods.golfer.setSwingPose({
    ballPos: ball,
    aimDir: aim,
    clubKind: 'driver',
    clubLength: sm.club.length,
    face: 0,
    stance: 0,
    swing: {
      shoulder: sm.geo.shoulder, armLen: sm.geo.armLen, clubLen: sm.geo.clubLen, hands: sm.hands, target: sm.target,
      clubhead: sm.clubhead(), phi: sm.phi, ballX: sm.geo.ballX, ballY: sm.geo.ballY, grabbing: false, speedMph: 0,
      speedBands: [70, 90, 105], ghostPath: [], path: [], practice: false, sweetRing: [0.98, 1.01],
    },
  });

  let frames = 0;
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    world.frame(dt);
    if (++frames === 4) window.__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}
