/**
 * Sky & lighting.
 *  - Own sky dome shader (Preetham atmosphere + sun disc + horizon haze matched to the scene
 *    fog), see ./sky/skyShader.ts.
 *  - Raymarched volumetric clouds rendered into an amortised cube map, one face per frame
 *    (./sky/CloudCube.ts, ./sky/cloudShader.ts). QUALITY.cloudSteps sets the march steps
 *    (0 = single 2D layer); the cube resolution scales with the quality level.
 *  - Time-of-day presets (settings.timeOfDay) drive sun direction/colour/intensity, hemisphere
 *    fill, fog (aerial-perspective height fog, ./sky/fog.ts), exposure and cloud lighting.
 *  - Weather (settings.weather) adds cloud cover; 'rain' = overcast dome + rain streaks + uWetness.
 *  - IBL: scene.environment is a PMREM of the sky dome (sun disc off, clouds from the cube),
 *    regenerated only when the preset/weather changes.
 *  - setWind() updates the shared wind uniforms and the clouds drift with it.
 */
import * as THREE from 'three';
import { settings, type Settings } from '../core/settings';
import { globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';
import { fogShared, installHeightFog } from './sky/fog';
import { createCloudNoiseTexture } from './sky/noiseTexture';
import { createDetailNoise3D } from './sky/detailNoise3D';
import { createCloudUniforms, type CloudUniforms } from './sky/cloudShader';
import { CloudCube } from './sky/CloudCube';
import { createSkyMaterial, createSkyUniforms, type SkyUniforms } from './sky/skyShader';
import { TIME_PRESETS, WEATHER, type TimePreset } from './sky/presets';
import { Rain } from './sky/Rain';

export { TIME_PRESETS } from './sky/presets';

// ---- tuning -------------------------------------------------------------------------------
/** Cloud cube face resolution per quality level (one face is re-rendered per frame). */
const CLOUD_CUBE_SIZE: Record<QualityPreset['level'], number> = { low: 256, medium: 512, high: 768, ultra: 1024 };
/** March steps in the cube = QUALITY.cloudSteps × this (affordable: 1/6 of a cube per frame). */
const CLOUD_STEP_SCALE = 2;
/** Wind aloft relative to the near-ground wind the ball feels. */
const CLOUD_WIND_SCALE = 4;
const MIN_CLOUD_DRIFT = 2; // m/s, so clouds always move a little
/** Rain streak count per quality level. */
const RAIN_COUNT: Record<QualityPreset['level'], number> = { low: 2500, medium: 4500, high: 7000, ultra: 9000 };
/** Seconds to fade wetness / rain in and out. */
const WEATHER_FADE = 4;

installHeightFog(); // must run before any material compiles (idempotent)

export class SkySystem implements RenderModule {
  /** The visible sky dome (follows the camera, drawn after opaque geometry). */
  sky!: THREE.Mesh;
  uniforms!: SkyUniforms;
  timeOfDay: Settings['timeOfDay'] = 'golden';
  weather: Settings['weather'] = 'breezy';

  private ctx!: InitContext;
  private quality!: QualityPreset;
  private noise!: THREE.DataTexture;
  private detail!: THREE.Data3DTexture;
  /** Cloud uniforms (share uSunDir with the dome). */
  cloudUniforms!: CloudUniforms;
  private cloudCube!: CloudCube;
  private material!: THREE.ShaderMaterial;
  private pmrem!: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envScene = new THREE.Scene();
  private envSky!: THREE.Mesh;
  private envMaterial!: THREE.ShaderMaterial;
  private hemi: THREE.HemisphereLight | null = null;
  private rain: Rain | null = null;
  private rainTarget = 0;
  private rainAmount = 0;
  private unsub: (() => void) | null = null;
  private envDirty = false;

  init(ctx: InitContext) {
    this.ctx = ctx;
    this.quality = ctx.quality;
    this.noise = createCloudNoiseTexture(256);
    this.detail = createDetailNoise3D(64);
    this.cloudUniforms = createCloudUniforms(this.noise, this.detail);
    this.cloudCube = new CloudCube(this.cloudUniforms, CLOUD_CUBE_SIZE[ctx.quality.level], ctx.quality.cloudSteps * CLOUD_STEP_SCALE);
    this.uniforms = createSkyUniforms(this.cloudCube.texture);
    this.uniforms.uSunDir = this.cloudUniforms.uSunDir; // shared by reference

    this.material = createSkyMaterial(this.uniforms);
    this.sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.sky.name = 'sky';
    this.sky.scale.setScalar(1000);
    this.sky.frustumCulled = false;
    // Draw after all opaque geometry so early-z skips every covered pixel.
    this.sky.renderOrder = 1e6;
    ctx.scene.add(this.sky);

    // IBL capture: same uniforms but no sun disc (avoids fireflies in the env map).
    this.envMaterial = createSkyMaterial({ ...this.uniforms, uSunDiscIntensity: { value: 0 } });
    this.envSky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.envMaterial);
    this.envSky.scale.setScalar(1000);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(ctx.renderer);

    this.hemi = (ctx.scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight) ?? null;
    this.weather = settings.get('weather');
    this.apply(settings.get('timeOfDay'));
    this.rainAmount = this.rainTarget; // no fade on first load
    globalUniforms.uWetness.value = this.rainAmount;
    this.unsub = settings.subscribe((s, changed) => {
      if (changed.includes('timeOfDay') || changed.includes('weather')) {
        this.weather = s.weather;
        this.apply(s.timeOfDay);
      }
    });
  }

  /** Apply a time-of-day preset (and the current weather). Regenerates the IBL. */
  apply(tod: Settings['timeOfDay'], weather: Settings['weather'] = this.weather) {
    this.timeOfDay = tod;
    this.weather = weather;
    const p: TimePreset = TIME_PRESETS[tod] ?? TIME_PRESETS.golden;
    const w = WEATHER[weather] ?? WEATHER.breezy;
    const u = this.uniforms;

    // Sun direction
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    globalUniforms.uSunDir.value.copy(sunDir);
    u.uSunDir.value.copy(sunDir);

    // Atmosphere
    u.uTurbidity.value = p.turbidity;
    u.uRayleigh.value = p.rayleigh;
    u.uMieCoef.value = p.mieCoefficient;
    u.uMieG.value = p.mieDirectionalG;
    u.uSkyIntensity.value = p.skyIntensity;
    u.uSunDiscColor.value.set(p.sunDiscColor);
    u.uSunDiscIntensity.value = p.sunDiscIntensity;
    u.uOvercast.value = w.overcast;
    const overcast = new THREE.Color(p.fog).lerp(new THREE.Color(0x8d939b), 0.6).multiplyScalar(0.55);
    u.uOvercastColor.value.copy(overcast);

    // Clouds
    const cu = this.cloudUniforms;
    cu.uCloudCoverage.value = THREE.MathUtils.clamp(p.cloudCoverage + w.cloudCoverage, 0, 0.95);
    cu.uCloudLit.value.set(p.cloudLit).multiplyScalar(p.cloudLitIntensity * (1 - 0.75 * w.overcast));
    cu.uCloudShade.value.set(p.cloudShade).multiplyScalar(p.cloudShadeIntensity * (1 - 0.3 * w.overcast));
    this.cloudCube.invalidate();

    // Direct + ambient light
    const { sun, scene, renderer } = this.ctx;
    sun.color.set(p.sunColor);
    sun.intensity = p.sunIntensity * w.sun;
    globalUniforms.uSunColor.value.set(p.sunColor).multiplyScalar(w.sun);
    if (this.hemi) {
      this.hemi.color.set(p.hemiSky);
      this.hemi.groundColor.set(p.hemiGround);
      this.hemi.intensity = p.hemiIntensity * (1 + 0.6 * w.overcast);
    }

    // Fog (scene FogExp2 + our height/aerial extension + sky haze copy)
    const fogDensity = p.fogDensity * w.fogDensity;
    const fogColor = new THREE.Color(p.fog).lerp(overcast.clone().multiplyScalar(1.4), w.overcast);
    const fogSun = new THREE.Color(p.fogSun).lerp(fogColor, w.overcast);
    let fog = scene.fog as THREE.FogExp2 | null;
    if (!fog || !(fog as THREE.FogExp2).isFogExp2) {
      fog = new THREE.FogExp2(fogColor.getHex(), fogDensity);
      scene.fog = fog;
    }
    fog.color.copy(fogColor);
    fog.density = fogDensity;
    globalUniforms.uFogColor.value.copy(fogColor);
    globalUniforms.uFogDensity.value = fogDensity;
    fogShared.sunDir.x = sunDir.x;
    fogShared.sunDir.y = sunDir.y;
    fogShared.sunDir.z = sunDir.z;
    fogShared.sunColor.x = fogSun.r;
    fogShared.sunColor.y = fogSun.g;
    fogShared.sunColor.z = fogSun.b;
    fogShared.params.x = 1 / p.fogHeight;
    u.uFogColor.value.copy(fogColor);
    u.uFogSunColor.value.copy(fogSun);
    u.uFogDensity.value = fogDensity;
    u.uFogParams.value.set(fogShared.params.x, fogShared.params.y, fogShared.params.z, fogShared.params.w);
    u.uSkyHaze.value = p.skyHaze * (1 + w.overcast);

    renderer.toneMappingExposure = p.exposure;

    // Weather
    this.rainTarget = w.rain ? 1 : 0;
    if (w.rain && !this.rain) this.createRain();

    this.envDirty = true;
    this.regenerateEnvironment();
    scene.environmentIntensity = p.envIntensity;
  }

  /** Re-capture the IBL environment from the sky (call after changing sky uniforms by hand). */
  regenerateEnvironment() {
    if (!this.envDirty) return;
    this.envDirty = false;
    // make sure the cloud cube reflects the new lighting before capturing it
    this.cloudCube.update(this.ctx.renderer, this.ctx.camera.position);
    // Capture from the camera's horizontal position so the clouds overhead match.
    const cam = this.ctx.camera.position;
    this.envSky.position.set(0, 0, 0);
    const prev = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000, { position: new THREE.Vector3(0, Math.max(cam.y, 0), 0) });
    this.ctx.scene.environment = this.envRT.texture;
    prev?.dispose();
  }

  /** Wind the golf ball feels (direction it blows TOWARD, m/s). Clouds drift with it aloft. */
  setWind(dirX: number, dirZ: number, speed: number) {
    const d = globalUniforms.uWindDir.value.set(dirX, dirZ);
    if (d.lengthSq() < 1e-8) d.set(1, 0);
    d.normalize();
    globalUniforms.uWindSpeed.value = Math.max(0, speed);
  }

  update(ctx: FrameContext) {
    this.sky.position.copy(ctx.camera.position);
    // cloud drift: wind aloft (texture is sampled at xz + offset → subtract to move downwind)
    const wd = globalUniforms.uWindDir.value;
    const aloft = Math.max(MIN_CLOUD_DRIFT, globalUniforms.uWindSpeed.value * CLOUD_WIND_SCALE);
    const cu = this.cloudUniforms;
    cu.uCloudOffset.value.x -= wd.x * aloft * ctx.dt;
    cu.uCloudOffset.value.y -= wd.y * aloft * ctx.dt;
    cu.uCloudTime.value = ctx.time;
    this.cloudCube.update(ctx.renderer, ctx.camera.position);

    // rain fade
    if (this.rainAmount !== this.rainTarget) {
      const step = ctx.dt / WEATHER_FADE;
      this.rainAmount = this.rainTarget > this.rainAmount ? Math.min(this.rainTarget, this.rainAmount + step) : Math.max(this.rainTarget, this.rainAmount - step);
      globalUniforms.uWetness.value = this.rainAmount;
    }
    this.rain?.setIntensity(this.rainAmount);
  }

  setQuality(q: QualityPreset) {
    const levelChanged = q.level !== this.quality.level;
    this.quality = q;
    this.cloudCube.configure(CLOUD_CUBE_SIZE[q.level] ?? 512, q.cloudSteps * CLOUD_STEP_SCALE);
    if (levelChanged && this.rain) {
      this.ctx.scene.remove(this.rain.mesh);
      this.rain.dispose();
      this.rain = null;
      if (this.rainTarget > 0 || this.rainAmount > 0) this.createRain();
    }
  }

  private createRain() {
    this.rain = new Rain(RAIN_COUNT[this.quality.level] ?? 6000);
    this.rain.setIntensity(this.rainAmount);
    this.ctx.scene.add(this.rain.mesh);
  }

  dispose() {
    this.unsub?.();
    this.ctx.scene.remove(this.sky);
    this.sky.geometry.dispose();
    this.material.dispose();
    this.envSky.geometry.dispose();
    this.envMaterial.dispose();
    this.noise.dispose();
    this.detail.dispose();
    this.cloudCube.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
    if (this.rain) {
      this.ctx.scene.remove(this.rain.mesh);
      this.rain.dispose();
    }
  }
}

