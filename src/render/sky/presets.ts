/**
 * Time-of-day and weather presets. Colours are sRGB hex (converted to linear by THREE.Color).
 * Every visual knob of the sky/lighting lives here so art direction is one table.
 */
import type { Settings } from '../../core/settings';

export interface TimePreset {
  /** Sun elevation above the horizon / azimuth (deg; 0 = +z south, 90 = +x east, 270 = west). */
  elevation: number;
  azimuth: number;
  // Preetham atmosphere
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  /** Multiplier on the sky radiance (HDR scene units). */
  skyIntensity: number;
  // Direct light
  sunColor: number;
  sunIntensity: number;
  sunDiscColor: number;
  sunDiscIntensity: number;
  // Ambient
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  envIntensity: number;
  // Fog / aerial perspective
  fog: number;
  fogSun: number;
  fogDensity: number;
  /** Fog scale height (m): smaller = fog hugs the valleys. */
  fogHeight: number;
  /** How strongly the haze creeps up the sky dome. */
  skyHaze: number;
  // Clouds
  cloudLit: number;
  cloudLitIntensity: number;
  cloudShade: number;
  cloudShadeIntensity: number;
  cloudCoverage: number;
  // Camera
  exposure: number;
}

export const TIME_PRESETS: Record<Settings['timeOfDay'], TimePreset> = {
  dawn: {
    elevation: 3.5, azimuth: 100, turbidity: 6, rayleigh: 2.4, mieCoefficient: 0.006, mieDirectionalG: 0.86, skyIntensity: 1.0,
    sunColor: 0xffa66e, sunIntensity: 1.9, sunDiscColor: 0xffb070, sunDiscIntensity: 30,
    hemiSky: 0x93a6d0, hemiGround: 0x4a4636, hemiIntensity: 0.35, envIntensity: 0.6,
    fog: 0xb7aeb4, fogSun: 0xffbe8c, fogDensity: 0.0013, fogHeight: 110, skyHaze: 0.55,
    cloudLit: 0xffae7a, cloudLitIntensity: 1.0, cloudShade: 0x6d6f88, cloudShadeIntensity: 0.22, cloudCoverage: 0.42,
    exposure: 1.15,
  },
  morning: {
    elevation: 22, azimuth: 118, turbidity: 3.6, rayleigh: 1.5, mieCoefficient: 0.004, mieDirectionalG: 0.8, skyIntensity: 1.0,
    sunColor: 0xfff0dc, sunIntensity: 3.0, sunDiscColor: 0xfff2e0, sunDiscIntensity: 60,
    hemiSky: 0xbfd6ff, hemiGround: 0x56663a, hemiIntensity: 0.4, envIntensity: 0.7,
    fog: 0xbccbdc, fogSun: 0xf3e6d2, fogDensity: 0.0008, fogHeight: 160, skyHaze: 0.5,
    cloudLit: 0xfff4e6, cloudLitIntensity: 1.7, cloudShade: 0x8c9cb6, cloudShadeIntensity: 0.42, cloudCoverage: 0.42,
    exposure: 1.0,
  },
  noon: {
    elevation: 62, azimuth: 170, turbidity: 2.6, rayleigh: 1.0, mieCoefficient: 0.003, mieDirectionalG: 0.78, skyIntensity: 1.0,
    sunColor: 0xfffaf2, sunIntensity: 3.4, sunDiscColor: 0xffffff, sunDiscIntensity: 80,
    hemiSky: 0xc8dcff, hemiGround: 0x5b6b3c, hemiIntensity: 0.4, envIntensity: 0.7,
    fog: 0xc0d0e2, fogSun: 0xe9eef2, fogDensity: 0.0007, fogHeight: 180, skyHaze: 0.5,
    cloudLit: 0xffffff, cloudLitIntensity: 2.0, cloudShade: 0x9aa9c0, cloudShadeIntensity: 0.5, cloudCoverage: 0.4,
    exposure: 0.92,
  },
  golden: {
    elevation: 8.5, azimuth: 242, turbidity: 4.0, rayleigh: 2.4, mieCoefficient: 0.0045, mieDirectionalG: 0.86, skyIntensity: 1.0,
    sunColor: 0xffc189, sunIntensity: 3.0, sunDiscColor: 0xffcf96, sunDiscIntensity: 45,
    hemiSky: 0xa4b7dc, hemiGround: 0x5a5330, hemiIntensity: 0.35, envIntensity: 0.65,
    fog: 0xc4c0bd, fogSun: 0xffc994, fogDensity: 0.0008, fogHeight: 140, skyHaze: 0.5,
    cloudLit: 0xffc890, cloudLitIntensity: 1.7, cloudShade: 0x7f88a6, cloudShadeIntensity: 0.36, cloudCoverage: 0.44,
    exposure: 1.0,
  },
  dusk: {
    elevation: 1.8, azimuth: 262, turbidity: 7, rayleigh: 2.8, mieCoefficient: 0.007, mieDirectionalG: 0.9, skyIntensity: 1.1,
    sunColor: 0xff8a5a, sunIntensity: 1.5, sunDiscColor: 0xff9058, sunDiscIntensity: 25,
    hemiSky: 0x7d88b8, hemiGround: 0x3b3526, hemiIntensity: 0.32, envIntensity: 0.6,
    fog: 0xa898a2, fogSun: 0xff9f78, fogDensity: 0.0014, fogHeight: 110, skyHaze: 0.6,
    cloudLit: 0xff8e66, cloudLitIntensity: 0.9, cloudShade: 0x5c5a78, cloudShadeIntensity: 0.18, cloudCoverage: 0.46,
    exposure: 1.2,
  },
};

export interface WeatherMod {
  cloudCoverage: number; // added to the preset
  overcast: number; // 0..1: flat grey dome, sun dimmed
  wetness: number;
  /** Multiplier on sun intensity. */
  sun: number;
  fogDensity: number; // multiplier
  rain: boolean;
}

export const WEATHER: Record<Settings['weather'], WeatherMod> = {
  calm: { cloudCoverage: -0.12, overcast: 0, wetness: 0, sun: 1, fogDensity: 1.1, rain: false },
  breezy: { cloudCoverage: 0, overcast: 0, wetness: 0, sun: 1, fogDensity: 1, rain: false },
  windy: { cloudCoverage: 0.08, overcast: 0, wetness: 0, sun: 1, fogDensity: 0.85, rain: false },
  rain: { cloudCoverage: 0.45, overcast: 0.75, wetness: 1, sun: 0.22, fogDensity: 2.2, rain: true },
};
