/**
 * Procedural Web Audio for the game — no audio files. Every sound is synthesised at runtime from
 * noise, oscillators and modal rings (see synth.ts / sfx.ts / crowd.ts / ambience.ts).
 *
 * Bus graph:
 *   sfx ──┬──────────────────────────┐
 *         └─ reverb send → convolver ─┤
 *   ui (follows SFX volume) ─────────┤
 *   ambience ────────────────────────┴─ master → compressor → limiter → destination
 *
 * The AudioContext is created lazily by unlock() (call it from a user gesture). Until then — or
 * if Web Audio is unavailable (node tests, some headless setups) — every method is a safe no-op.
 */
import type { SurfaceId } from '../config';
import { settings } from '../core/settings';
import type { StrikeQuality } from '../physics/impact';
import { Ambience } from './ambience';
import { Crowd } from './crowd';
import * as sfx from './sfx';
import { clamp, Synth } from './synth';

// ───────────────────────────── tuning ─────────────────────────────

/** Reverb send level for SFX (open air: subtle). */
const REVERB_SEND = 0.1;
/** Swing whoosh: speed (mph) where it starts, level curve, filter mapping. */
const WHOOSH = { start: 8, full: 105, gain: 0.35, f0: 260, fPerMph: 24, q0: 0.9, qPerMph: 1 / 110 };
/** Peak-speed swish fires when the speed drops below this fraction of the running max. */
const SWISH_DROP = 0.96;
const SWISH_MIN_MPH = 40;
/** Roll layer gains/cutoffs per surface. [rumbleGain, rumbleCut, gritGain] at 1 m/s. */
const ROLL: Partial<Record<SurfaceId, [number, number, number]>> = {
  green: [0.07, 140, 0.004],
  fringe: [0.07, 160, 0.01],
  fairway: [0.08, 170, 0.014],
  tee: [0.08, 170, 0.014],
  rough: [0.06, 150, 0.035],
  deepRough: [0.04, 140, 0.04],
  path: [0.16, 420, 0.07],
  dirt: [0.12, 260, 0.05],
  sand: [0.03, 120, 0.03],
  oob: [0.06, 150, 0.03],
};
/** Silence the roll if roll() isn't called for this long (s). */
const ROLL_TIMEOUT = 0.12;
/** Minimum spacing between UI ticks (s) and adjustment ticks per kind (s). */
const UI_GAP = { tick: 0.035, other: 0.06 };
const ADJUST_GAP = 0.05;
/** Volume slider → gain curve exponent (perceptual). */
const VOLUME_CURVE = 2;

type AdjustKind = 'face' | 'path' | 'aim' | 'stance' | 'club';
type UiKind = 'tick' | 'click' | 'open' | 'close' | 'error' | 'success';

function audioContextCtor(): (new (o?: AudioContextOptions) => AudioContext) | null {
  const g = globalThis as any;
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export class AudioSystem {
  /** True once the context exists and is running. */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }
  /** The underlying context (null until unlocked / when unsupported). */
  ctx: AudioContext | null = null;

  private synth: Synth | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private verbSend: GainNode | null = null;
  private ambience: Ambience | null = null;
  private crowdFx: Crowd | null = null;
  private vol = { master: 0.8, sfx: 0.9, ambience: 0.6 };
  private failed = false;
  // Whoosh.
  private whooshG: GainNode | null = null;
  private whooshF: BiquadFilterNode | null = null;
  private swingMax = 0;
  private swishFired = false;
  // Roll.
  private rollG: GainNode | null = null;
  private rollF: BiquadFilterNode | null = null;
  private gritG: GainNode | null = null;
  private lastRollAt = -1;
  private rolling = false;
  // Rate limiting.
  private lastUi = new Map<string, number>();
  private lastAdjust = new Map<string, { t: number; soft: number }>();
  private lastBounceAt = 0;

  constructor() {
    try {
      this.vol = { master: settings.get('masterVolume'), sfx: settings.get('sfxVolume'), ambience: settings.get('ambienceVolume') };
      settings.subscribe((s, ch) => {
        if (ch.includes('masterVolume') || ch.includes('sfxVolume') || ch.includes('ambienceVolume')) this.setVolumes(s.masterVolume, s.sfxVolume, s.ambienceVolume);
      });
    } catch {
      /* settings unavailable — keep defaults */
    }
    const doc = (globalThis as any).document;
    doc?.addEventListener?.('visibilitychange', () => {
      if (!this.ctx) return;
      try {
        if (doc.visibilityState === 'hidden') void this.ctx.suspend().catch(() => {});
        else void this.ctx.resume().catch(() => {});
      } catch {
        /* ignore */
      }
    });
  }

  /** Must be called from a user gesture before sounds can play. Safe to call repeatedly. */
  unlock() {
    if (this.failed) return;
    if (!this.ctx) {
      const AC = audioContextCtor();
      if (!AC) {
        this.failed = true;
        return;
      }
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build(this.ctx);
      } catch {
        this.failed = true;
        this.ctx = null;
        this.synth = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        void this.ctx.resume().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }

  private build(ctx: AudioContext) {
    const s = new Synth(ctx);
    // Master chain: gentle bus compression then a fast limiter.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.08;
    const master = s.gain(0);
    master.connect(comp).connect(lim).connect(ctx.destination);
    const sfxBus = s.gain(1);
    sfxBus.connect(master);
    const uiBus = s.gain(1);
    uiBus.connect(master);
    const ambBus = s.gain(0);
    ambBus.connect(master);
    // Short open-air reverb on SFX.
    const verb = ctx.createConvolver();
    verb.buffer = s.makeImpulse(1.6, 2.5);
    const verbSend = s.gain(REVERB_SEND);
    sfxBus.connect(verbSend).connect(verb).connect(master);
    // Direct reverb input for sounds that want an extra-wet tail (gong); follows the SFX volume.
    const verbDirect = s.gain(1);
    verbDirect.connect(verb);
    this.synth = s;
    this.master = master;
    this.sfxBus = sfxBus;
    this.uiBus = uiBus;
    this.ambBus = ambBus;
    this.verbSend = verbDirect;
    // Persistent swing whoosh.
    const wsrc = s.noiseSource(s.pink);
    this.whooshF = s.filter('bandpass', WHOOSH.f0, WHOOSH.q0);
    this.whooshG = s.gain(0);
    wsrc.connect(this.whooshF).connect(this.whooshG).connect(sfxBus);
    wsrc.start(ctx.currentTime, Math.random() * 2);
    // Persistent roll: brown rumble + grit.
    const rsrc = s.noiseSource(s.brown);
    this.rollF = s.filter('lowpass', 150, 0.8);
    this.rollG = s.gain(0);
    rsrc.connect(this.rollF).connect(this.rollG).connect(sfxBus);
    rsrc.start(ctx.currentTime, Math.random() * 2);
    const gsrc = s.noiseSource(s.white);
    const gf = s.filter('bandpass', 2800, 1.2);
    this.gritG = s.gain(0);
    gsrc.connect(gf).connect(this.gritG).connect(sfxBus);
    gsrc.start(ctx.currentTime, Math.random());
    this.ambience = new Ambience(s, ambBus);
    this.crowdFx = new Crowd(s, sfxBus);
    this.applyVolumes(true);
  }

  // ───────────────────────────── volumes ─────────────────────────────

  setVolumes(master: number, sfxVol: number, ambience: number) {
    const ok = (v: number, d: number) => (Number.isFinite(v) ? clamp(v, 0, 1.5) : d);
    this.vol = { master: ok(master, 0.8), sfx: ok(sfxVol, 0.9), ambience: ok(ambience, 0.6) };
    this.applyVolumes(false);
  }

  private applyVolumes(initial: boolean) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const curve = (v: number) => Math.pow(v, VOLUME_CURVE);
    const tau = initial ? 0.6 : 0.05; // fade the whole mix in on first unlock
    this.master.gain.setTargetAtTime(curve(this.vol.master), t, tau);
    this.sfxBus!.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.05);
    this.uiBus!.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.05);
    this.ambBus!.gain.setTargetAtTime(curve(this.vol.ambience), t, initial ? 1.5 : 0.05);
    this.verbSend!.gain.setTargetAtTime(curve(this.vol.sfx), t, 0.05);
  }

  // ───────────────────────────── sounds ─────────────────────────────

  private get live() {
    return !!this.synth && !!this.ctx && this.ctx.state === 'running';
  }

  /** Swing whoosh while the club moves; speed in mph (call every frame during a swing). */
  swingUpdate(speedMph: number) {
    if (!this.live || !this.whooshG || !this.whooshF) return;
    const v = Number.isFinite(speedMph) ? Math.max(0, speedMph) : 0;
    const t = this.ctx!.currentTime;
    const k = clamp((v - WHOOSH.start) / (WHOOSH.full - WHOOSH.start), 0, 1.3);
    this.whooshG.gain.setTargetAtTime(k * k * WHOOSH.gain, t, v > 0 ? 0.02 : 0.06);
    this.whooshF.frequency.setTargetAtTime(WHOOSH.f0 + WHOOSH.fPerMph * v, t, 0.02);
    this.whooshF.Q.setTargetAtTime(WHOOSH.q0 + v * WHOOSH.qPerMph, t, 0.05);
    // Distinct swish at the speed peak.
    if (v > this.swingMax) this.swingMax = v;
    if (!this.swishFired && this.swingMax > SWISH_MIN_MPH && v < this.swingMax * SWISH_DROP) {
      this.swishFired = true;
      sfx.swish(this.synth!, this.sfxBus!, this.swingMax);
    }
    if (v < 12) {
      this.swingMax = v;
      this.swishFired = false;
    }
  }

  strike(quality: StrikeQuality, clubKind: string, speedMph: number, surface: SurfaceId) {
    if (!this.live) return;
    sfx.strike(this.synth!, this.sfxBus!, quality, clubKind ?? 'iron', Number.isFinite(speedMph) ? speedMph : 60, surface ?? 'fairway');
  }

  bounce(surface: SurfaceId, speed: number) {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    if (t - this.lastBounceAt < 0.025) return; // physics sub-step duplicates
    this.lastBounceAt = t;
    sfx.bounce(this.synth!, this.sfxBus!, surface ?? 'fairway', Number.isFinite(speed) ? speed : 3);
  }

  /** Quiet rumble while rolling; call every frame the ball rolls. */
  roll(surface: SurfaceId, speed: number) {
    if (!this.live || !this.rollG || !this.rollF || !this.gritG) return;
    const p = ROLL[surface] ?? ROLL.fairway!;
    const v = clamp(Number.isFinite(speed) ? speed : 0, 0, 20);
    const t = this.ctx!.currentTime;
    const lvl = Math.min(1, v / 1.2) * Math.sqrt(Math.min(v, 12) / 1.2 + 0.2) * 0.6;
    this.rollG.gain.setTargetAtTime(p[0] * lvl, t, 0.05);
    this.rollF.frequency.setTargetAtTime(p[1] + v * 55, t, 0.05);
    this.gritG.gain.setTargetAtTime(p[2] * lvl, t, 0.05);
    this.lastRollAt = t;
    this.rolling = true;
  }

  cup() {
    if (!this.live) return;
    this.stopRoll();
    sfx.cup(this.synth!, this.sfxBus!);
  }

  splash(strength: number) {
    if (!this.live) return;
    this.stopRoll();
    sfx.splash(this.synth!, this.sfxBus!, Number.isFinite(strength) ? strength : 0.5);
  }

  propHit(kind: string, speed: number) {
    if (!this.live) return;
    sfx.propHit(this.synth!, this.sfxBus!, this.verbSend!, kind ?? '', Number.isFinite(speed) ? speed : 10);
  }

  ui(kind: UiKind) {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    const gap = kind === 'tick' ? UI_GAP.tick : UI_GAP.other;
    if (t - (this.lastUi.get(kind) ?? -1) < gap) return;
    this.lastUi.set(kind, t);
    sfx.ui(this.synth!, this.uiBus!, kind);
  }

  /** Adjustment tick for face/path/aim/stance changes (rate-limited, pitch varies). */
  adjust(kind: AdjustKind) {
    if (!this.live) return;
    const t = this.ctx!.currentTime;
    const prev = this.lastAdjust.get(kind);
    if (prev && t - prev.t < ADJUST_GAP) return;
    // Rapid repeats get progressively softer so holding a key never becomes "grating".
    const soft = prev && t - prev.t < 0.3 ? Math.max(0.45, prev.soft * 0.85) : 1;
    this.lastAdjust.set(kind, { t, soft });
    sfx.adjust(this.synth!, this.uiBus!, kind, soft);
  }

  crowd(kind: 'applause' | 'groan' | 'cheer') {
    if (!this.live || !this.crowdFx) return;
    this.crowdFx.play(kind);
  }

  /** Ambience: wind speed (m/s); call each frame. Also times out the roll sound. */
  update(dt: number, windSpeed: number) {
    if (!this.live) return;
    const d = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0.016;
    this.ambience?.update(d, windSpeed);
    if (this.rolling && this.ctx!.currentTime - this.lastRollAt > ROLL_TIMEOUT) this.stopRoll();
  }

  private stopRoll() {
    if (!this.rolling || !this.ctx) return;
    this.rolling = false;
    const t = this.ctx.currentTime;
    this.rollG?.gain.setTargetAtTime(0, t, 0.06);
    this.gritG?.gain.setTargetAtTime(0, t, 0.04);
  }

  /** Dev/test helper: play one bird phrase now. */
  bird() {
    if (!this.live) return;
    this.ambience?.bird();
  }

  /** Number of sounding one-shot voices (diagnostics). */
  get voices() {
    return this.synth?.active ?? 0;
  }
}
