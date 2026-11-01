/** Persistent user settings (localStorage, always wrapped in try/catch). */
import { safeLoad, safeSave } from './storage';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type AssistLevel = 'off' | 'light' | 'full';

export interface Settings {
  quality: QualityLevel;
  /** Multiplier on device pixel ratio (0.5 – 1.0+). */
  renderScale: number;
  fov: number;
  // Swing / mouse
  mouseSensitivity: number; // 0.25 – 3
  mouseSmoothing: number; // 0 – 0.9
  invertSwingY: boolean;
  invertSwingX: boolean;
  lookSensitivity: number;
  // Improvements (each can be toggled)
  fineAdjustWithShift: boolean;
  resetKeyEnabled: boolean;
  showShotData: boolean;
  showGhostSwing: boolean;
  practiceSwingEnabled: boolean;
  gamepadEnabled: boolean;
  gamepadVibration: boolean;
  /** Assist: off = original difficulty (face/path wobble on). */
  assist: AssistLevel;
  showStartLine: boolean;
  showMinimap: boolean;
  units: 'yards' | 'metres';
  // Audio
  masterVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  // Misc
  timeOfDay: 'dawn' | 'morning' | 'noon' | 'golden' | 'dusk';
  weather: 'calm' | 'breezy' | 'windy' | 'rain';
  showTimer: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  renderScale: 1,
  fov: 55,
  mouseSensitivity: 1,
  mouseSmoothing: 0.15,
  invertSwingY: false,
  invertSwingX: false,
  lookSensitivity: 1,
  fineAdjustWithShift: true,
  resetKeyEnabled: true,
  showShotData: true,
  showGhostSwing: true,
  practiceSwingEnabled: true,
  gamepadEnabled: true,
  gamepadVibration: true,
  assist: 'off',
  showStartLine: false,
  showMinimap: true,
  units: 'yards',
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambienceVolume: 0.6,
  timeOfDay: 'golden',
  weather: 'breezy',
  showTimer: true,
};

const KEY = 'tl-golf.settings.v1';
type Listener = (s: Settings, changed: (keyof Settings)[]) => void;

class SettingsStore {
  data: Settings;
  private listeners = new Set<Listener>();
  constructor() {
    this.data = { ...DEFAULT_SETTINGS, ...(safeLoad<Partial<Settings>>(KEY) ?? {}) };
  }
  get<K extends keyof Settings>(k: K): Settings[K] {
    return this.data[k];
  }
  set(patch: Partial<Settings>) {
    const changed = Object.keys(patch).filter((k) => (this.data as any)[k] !== (patch as any)[k]) as (keyof Settings)[];
    if (!changed.length) return;
    Object.assign(this.data, patch);
    safeSave(KEY, this.data);
    for (const l of this.listeners) l(this.data, changed);
  }
  reset() {
    this.set({ ...DEFAULT_SETTINGS });
  }
  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const settings = new SettingsStore();
