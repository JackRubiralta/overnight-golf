/**
 * Sky & lighting: physically-based Preetham sky (three/addons Sky, with its cloud layer),
 * time-of-day presets that drive the sun light, hemisphere fill, fog and an IBL environment
 * map generated from the sky with PMREM.
 */
import * as THREE from 'three';
import { Sky as SkyMesh } from 'three/addons/objects/Sky.js';
import { settings, type Settings } from '../core/settings';
import { globalUniforms, type FrameContext, type InitContext, type RenderModule } from './shared';

interface TimePreset {
  elevation: number; // degrees
  azimuth: number; // degrees
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fog: number;
  fogDensity: number;
  exposure: number;
}

export const TIME_PRESETS: Record<Settings['timeOfDay'], TimePreset> = {
  dawn: { elevation: 4, azimuth: 95, turbidity: 6, rayleigh: 2.2, mieCoefficient: 0.006, mieDirectionalG: 0.85, sunColor: 0xffb27a, sunIntensity: 2.0, hemiSky: 0x9fb4d8, hemiGround: 0x4a4a35, hemiIntensity: 0.5, fog: 0xc9b8b0, fogDensity: 0.0013, exposure: 0.95 },
  morning: { elevation: 22, azimuth: 120, turbidity: 4, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.8, sunColor: 0xfff0dc, sunIntensity: 3.0, hemiSky: 0xbfd6ff, hemiGround: 0x56663a, hemiIntensity: 0.65, fog: 0xbfcfe0, fogDensity: 0.0008, exposure: 1.0 },
  noon: { elevation: 62, azimuth: 170, turbidity: 3, rayleigh: 1, mieCoefficient: 0.003, mieDirectionalG: 0.75, sunColor: 0xffffff, sunIntensity: 3.6, hemiSky: 0xc8dcff, hemiGround: 0x5b6b3c, hemiIntensity: 0.7, fog: 0xc6d4e4, fogDensity: 0.0007, exposure: 0.95 },
  golden: { elevation: 9, azimuth: 248, turbidity: 5.5, rayleigh: 1.8, mieCoefficient: 0.005, mieDirectionalG: 0.86, sunColor: 0xffc58a, sunIntensity: 3.0, hemiSky: 0xa9bde0, hemiGround: 0x5a5530, hemiIntensity: 0.55, fog: 0xd9c3a5, fogDensity: 0.0011, exposure: 1.0 },
  dusk: { elevation: 2, azimuth: 262, turbidity: 8, rayleigh: 2.6, mieCoefficient: 0.008, mieDirectionalG: 0.9, sunColor: 0xff9466, sunIntensity: 1.6, hemiSky: 0x7f8cb8, hemiGround: 0x3b3526, hemiIntensity: 0.45, fog: 0xb59a92, fogDensity: 0.0014, exposure: 1.05 },
};

export class SkySystem implements RenderModule {
  sky = new SkyMesh();
  private ctx!: InitContext;
  private pmrem!: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSky = new SkyMesh();

  init(ctx: InitContext) {
    this.ctx = ctx;
    this.sky.scale.setScalar(9000);
    this.sky.frustumCulled = false;
    ctx.scene.add(this.sky);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(ctx.renderer);
    this.apply(settings.get('timeOfDay'));
    settings.subscribe((s, changed) => {
      if (changed.includes('timeOfDay')) this.apply(s.timeOfDay);
    });
  }

  apply(tod: Settings['timeOfDay']) {
    const p = TIME_PRESETS[tod];
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    globalUniforms.uSunDir.value.copy(sunDir);
    globalUniforms.uSunColor.value.set(p.sunColor);
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mieCoefficient;
      u.mieDirectionalG.value = p.mieDirectionalG;
      u.sunPosition.value.copy(sunDir);
      if (u.cloudCoverage) {
        u.cloudCoverage.value = 0.35;
        u.cloudDensity.value = 0.5;
      }
    }
    const { sun, scene, renderer } = this.ctx;
    sun.color.set(p.sunColor);
    sun.intensity = p.sunIntensity;
    const hemi = scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined;
    if (hemi) {
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.hemiIntensity;
    }
    const fog = scene.fog as THREE.FogExp2;
    fog.color.set(p.fog);
    fog.density = p.fogDensity;
    globalUniforms.uFogColor.value.set(p.fog);
    globalUniforms.uFogDensity.value = p.fogDensity;
    renderer.toneMappingExposure = p.exposure;
    // IBL from the sky.
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.55;
  }

  update(ctx: FrameContext) {
    this.sky.position.copy(ctx.camera.position);
  }
}
