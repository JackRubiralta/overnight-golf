/**
 * Dev-only terrain inspection page (not part of the game bundle):
 *   /src/render/terrain/debug.html?cam=x,up,z&look=x,up,z[&tod=golden][&q=high][&clouds=0]
 *   /src/render/terrain/debug.html?view=tee|fairway|green|water|wide|grass[...]
 * Heights are relative to the ground under each point. Renders sky + terrain only.
 * `clouds=0` turns the sky's raymarched clouds off (much faster under software GL) while the
 * terrain keeps the selected quality level.
 */
import { CourseField } from '../../course/CourseField';
import { Course } from '../../course/Course';
import { bakeCourse } from '../../course/bake';
import { settings } from '../../core/settings';
import { World } from '../World';
import { SkySystem } from '../Sky';
import { Terrain } from '../Terrain';
import { viewPreset } from '../views';
import { TIME_PRESETS } from '../sky/presets';
import { globalUniforms, type RenderModule } from '../shared';
import * as THREE from 'three';

/**
 * Minimal stand-in sky for when the real sky module is unavailable (`nosky=1`): applies the
 * shared time-of-day preset to the lights/fog and captures a gradient dome for IBL.
 */
function fallbackSky(world: World, tod: string): RenderModule {
  const p = TIME_PRESETS[(tod in TIME_PRESETS ? tod : 'golden') as keyof typeof TIME_PRESETS];
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - p.elevation), THREE.MathUtils.degToRad(p.azimuth));
  globalUniforms.uSunDir.value.copy(sunDir);
  world.sun.color.set(p.sunColor);
  world.sun.intensity = p.sunIntensity;
  world.hemi.color.set(p.hemiSky);
  world.hemi.groundColor.set(p.hemiGround);
  world.hemi.intensity = p.hemiIntensity;
  const fog = world.scene.fog as THREE.FogExp2;
  fog.color.set(p.fog);
  fog.density = p.fogDensity;
  world.renderer.toneMappingExposure = p.exposure;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uFog: { value: new THREE.Color(p.fog) }, uSun: { value: sunDir }, uSunC: { value: new THREE.Color(p.fogSun) } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uFog; uniform vec3 uSun; uniform vec3 uSunC; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); vec3 zen = vec3(0.12, 0.28, 0.62);
          vec3 c = mix(uFog, zen, pow(clamp(d.y, 0.0, 1.0), 0.45));
          c += uSunC * pow(max(dot(d, uSun), 0.0), 8.0) * 0.6; gl_FragColor = vec4(c * 1.4, 1.0); }`,
    }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = 1e6;
  world.scene.add(dome);
  const envScene = new THREE.Scene();
  envScene.add(dome.clone());
  const pmrem = new THREE.PMREMGenerator(world.renderer);
  world.scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
  world.scene.environmentIntensity = p.envIntensity;
  return { update: (ctx) => dome.position.copy(ctx.camera.position) };
}

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
  const terrain = new Terrain();
  if (p.get('nosky') === '1') {
    await world.init(course, grids, [terrain], null);
    world.modules.unshift(fallbackSky(world, tod ?? 'golden'));
  } else {
    const sky = new SkySystem();
    await world.init(course, grids, [sky, terrain], null);
    if (p.get('clouds') === '0') sky.setQuality?.({ ...world.quality, cloudSteps: 0 });
  }
  const view = p.get('view');
  const preset = view ? viewPreset(view, course) : null;
  if (preset) {
    world.camera.position.copy(preset.pos);
    world.camera.lookAt(preset.look);
    world.updateSunShadow(preset.look.clone().lerp(preset.pos, 0.5));
  } else {
    const v = (s: string | null, d: number[]) => (s ? s.split(',').map(Number) : d);
    const [cx, cu, cz] = v(p.get('cam'), [0, 2, 150]);
    const [lx, lu, lz] = v(p.get('look'), [0, 0, 0]);
    world.camera.position.set(cx, course.height(cx, cz) + cu, cz);
    world.camera.lookAt(lx, course.height(lx, lz) + lu, lz);
    world.updateSunShadow(world.camera.position);
  }
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
