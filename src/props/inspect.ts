/**
 * Dev-only props inspector (not part of the game build): /src/props/inspect.html?
 *   only=sky,terrain,props        modules to load (as in the viewer)
 *   cam=x,z,h & look=x,z,h        camera/look-at (h = metres above ground)
 *   shoot=x,z,tx,tz,speed,loft    fire a ball from (x,z) toward (tx,tz) through BallSim + Props
 *   sim=seconds                   physics time to advance (fixed 1/60 steps) before rendering
 *   flagout=1                     pull the hole-1 flag
 *   ball=x,z                      place the ball on the ground
 * Sets window.__ready after a few rendered frames; window.__hits lists prop-hit events.
 */
import * as THREE from 'three';
import { CourseField } from '../course/CourseField';
import { Course } from '../course/Course';
import { bakeCourse } from '../course/bake';
import { World } from '../render/World';
import { createModules, enabledModules } from '../render/registry';
import { BallSim } from '../physics/BallSim';
import { globalUniforms, type FrameContext } from '../render/shared';
import { DEG } from '../config';

async function run() {
  const p = new URLSearchParams(location.search);
  const field = new CourseField();
  const grids = await bakeCourse(field);
  const course = new Course(field, grids);
  const world = new World(document.getElementById('app')!);
  const mods = createModules();
  const { list, post } = enabledModules(mods);
  await world.init(course, grids, list, post);
  mods.props.setTreeColliders(mods.foliage.colliders);
  mods.props.setActiveHole(0);
  if (p.get('flagout')) mods.props.setFlagOut(true);
  world.mode = 'stance';
  const v3 = (s: string) => {
    const [x, z, h] = s.split(',').map(Number);
    return new THREE.Vector3(x, course.height(x, z) + h, z);
  };
  const cam = v3(p.get('cam') ?? '0,160,2');
  const look = v3(p.get('look') ?? '0,100,1');
  world.camera.position.copy(cam);
  world.camera.lookAt(look);
  world.updateSunShadow(look.clone().lerp(cam, 0.5));
  const hits: unknown[] = [];
  (window as unknown as { __hits: unknown[] }).__hits = hits;
  mods.props.onPropHit = (e) => hits.push({ id: e.id, kind: e.kind, speed: +e.speed.toFixed(1), impulse: e.impulse, broken: e.broken, score: e.score });
  // Give Rapier a moment to initialise.
  const T0 = performance.now();
  const log = (m: string) => console.log(`[inspect] ${m} @${Math.round(performance.now() - T0)}ms`);
  await mods.props.physicsReady;
  log('physics ready');
  const ballAt = p.get('ball');
  if (ballAt) {
    const [bx, bz] = ballAt.split(',').map(Number);
    mods.props.setBall(new THREE.Vector3(bx, course.height(bx, bz) + 0.0214, bz));
  }
  const shoot = p.get('shoot');
  const ctx = (dt: number): FrameContext => ({ time: world.time, dt, camera: world.camera, renderer: world.renderer, scene: world.scene, course, quality: world.quality, hole: 0, mode: 'flight' });
  if (shoot) {
    const [x, z, tx, tz, speed, loft] = shoot.split(',').map(Number);
    const sim = new BallSim({ terrain: course, world: mods.props });
    sim.place(new THREE.Vector3(x, 0, z));
    const dir = new THREE.Vector3(tx - x, 0, tz - z).normalize();
    const vel = dir.multiplyScalar(speed * Math.cos((loft || 10) * DEG)).setY(speed * Math.sin((loft || 10) * DEG));
    sim.launch(vel, new THREE.Vector3(0, 0, 0));
    const T = Number(p.get('sim') ?? 3);
    let n = 0;
    for (let t = 0; t < T; t += 1 / 60) {
      if (n++ % 10 === 0) log(`sim t=${t.toFixed(2)} state=${sim.state}`);
      sim.update(1 / 60);
      world.time += 1 / 60;
      globalUniforms.uTime.value = world.time;
      mods.props.update(ctx(1 / 60));
    }
    mods.props.setBall(sim.pos);
    (window as unknown as { __sim: unknown }).__sim = { state: sim.state, pos: sim.pos.toArray().map((v) => +v.toFixed(2)), events: sim.events.filter((e) => e.type === 'object').map((e) => e.id) };
  }
  log('rendering');
  let frames = 0;
  const loop = () => {
    world.frame(1 / 60);
    if (++frames === 3) (window as unknown as { __ready: boolean }).__ready = true;
    requestAnimationFrame(loop);
  };
  loop();
}
run().catch((e) => console.error(e));
