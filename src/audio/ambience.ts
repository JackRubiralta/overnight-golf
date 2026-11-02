/**
 * Ambience bed: gusting wind (two noise layers whose level & cutoff follow wind speed), distant
 * leaves rustling in the gusts, and procedural birdsong at random intervals.
 */
import { settings } from '../core/settings';
import { clamp, rand, type Synth } from './synth';

// ───────────────────────────── tuning ─────────────────────────────

const WIND = {
  /** Low rumble layer: level at 0 and per m/s, lowpass cutoff at 0 and per m/s. */
  lowBase: 0.05, lowPer: 0.025, lowCut: 220, lowCutPer: 45,
  /** Airy layer (bandpass). */
  airBase: 0.012, airPer: 0.012, airF: 500, airFPer: 70,
  maxSpeed: 16,
  /** Gust targets change every gustMin..gustMax s and are approached with gustTau. */
  gustMin: 1.4, gustMax: 4.5, gustTau: 1.1,
};
const LEAVES = { level: 0.05, hp: 2600, bp: 5200 };
/** Seconds between bird phrases, by time of day [min, max]. */
const BIRD_GAPS: Record<string, [number, number]> = {
  dawn: [1.2, 4], morning: [2, 6], noon: [5, 13], golden: [3, 9], dusk: [7, 18],
};
const BIRD_LEVEL = 0.07;
/** Update the bed params at most this often (s). */
const PARAM_STEP = 0.05;

export class Ambience {
  private lowG: GainNode;
  private lowF: BiquadFilterNode;
  private airG: GainNode;
  private airF: BiquadFilterNode;
  private leafG: GainNode;
  private birdBus: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private gust = 1;
  private gustTarget = 1;
  private nextGust = 0;
  private flutterPhase = Math.random() * 10;
  private paramClock = 0;
  private nextBird = 2;
  private speed = 3;
  private time = 0;

  constructor(private s: Synth, out: AudioNode) {
    const ctx = s.ctx;
    // Low rumble: stereo pink → lowpass.
    const low = s.noiseSource(s.pinkStereo);
    this.lowF = s.filter('lowpass', WIND.lowCut, 0.6);
    this.lowG = s.gain(0);
    low.connect(this.lowF).connect(this.lowG).connect(out);
    // Airy whistle: brown-ish pink through a wide bandpass (slightly resonant).
    const air = s.noiseSource(s.pinkStereo);
    air.playbackRate.value = 0.83; // decorrelate from the low layer
    this.airF = s.filter('bandpass', WIND.airF, 1.4);
    this.airG = s.gain(0);
    air.connect(this.airF).connect(this.airG).connect(out);
    // Leaves: white → highpass → bandpass, wide stereo.
    const leaves = s.noiseSource(s.pinkStereo);
    leaves.playbackRate.value = 1.7;
    const hp = s.filter('highpass', LEAVES.hp, 0.7);
    const bp = s.filter('bandpass', LEAVES.bp, 0.5);
    this.leafG = s.gain(0);
    leaves.connect(hp).connect(bp).connect(this.leafG).connect(out);
    this.birdBus = s.gain(1);
    this.birdBus.connect(out);
    const t = ctx.currentTime + 0.05;
    for (const src of [low, air, leaves]) {
      src.start(t, Math.random() * 3);
      this.sources.push(src);
    }
  }

  update(dt: number, windSpeed: number) {
    this.time += dt;
    this.speed = clamp(Number.isFinite(windSpeed) ? windSpeed : 0, 0, WIND.maxSpeed);
    // Gusts: piecewise random targets, smoothly approached; plus a faster flutter.
    this.nextGust -= dt;
    if (this.nextGust <= 0) {
      this.nextGust = rand(WIND.gustMin, WIND.gustMax);
      this.gustTarget = rand(0.55, 1.15) + (Math.random() < 0.25 ? rand(0.3, 0.7) : 0);
    }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dt / WIND.gustTau));
    this.flutterPhase += dt;
    const flutter = 1 + 0.12 * Math.sin(this.flutterPhase * 2.3) + 0.08 * Math.sin(this.flutterPhase * 5.1 + 1.3);

    this.paramClock -= dt;
    if (this.paramClock <= 0) {
      this.paramClock = PARAM_STEP;
      const t = this.s.ctx.currentTime;
      const v = this.speed;
      const g = this.gust * flutter;
      const tau = 0.12;
      this.lowG.gain.setTargetAtTime((WIND.lowBase + WIND.lowPer * v) * g, t, tau);
      this.lowF.frequency.setTargetAtTime(WIND.lowCut + WIND.lowCutPer * v * g, t, tau);
      this.airG.gain.setTargetAtTime((WIND.airBase + WIND.airPer * v) * Math.pow(g, 1.6), t, tau);
      this.airF.frequency.setTargetAtTime(WIND.airF + WIND.airFPer * v * g, t, tau * 2);
      // Leaves only really rustle when the wind gusts.
      const leaf = LEAVES.level * clamp(v / 8, 0.15, 1.4) * Math.pow(Math.max(0, g - 0.45), 1.5);
      this.leafG.gain.setTargetAtTime(leaf, t, 0.25);
    }

    // Birds.
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      const tod = settings.get('timeOfDay');
      const rain = settings.get('weather') === 'rain';
      const [a, b] = BIRD_GAPS[tod] ?? BIRD_GAPS.golden;
      // Strong wind and rain keep the birds quieter.
      const windK = 1 + Math.max(0, this.speed - 6) * 0.25;
      this.nextBird = rand(a, b) * windK * (rain ? 3 : 1);
      if (!rain || Math.random() < 0.3) this.bird();
    }
  }

  /** One phrase from a random "species". */
  bird() {
    const s = this.s;
    if (!s.canPlay()) return;
    const t = s.now + 0.02;
    const pan = rand(-0.85, 0.85);
    const dist = rand(0.35, 1); // 1 = close
    const g = BIRD_LEVEL * dist * dist;
    const lp = 3500 + 6000 * dist; // distant birds lose their top end
    const species = Math.floor(Math.random() * 5);
    const out = this.birdBus;
    switch (species) {
      case 0: {
        // Chirp series: quick downward sweeps.
        const n = 3 + Math.floor(Math.random() * 5);
        const f = rand(3800, 5600);
        for (let i = 0; i < n; i++) {
          const tt = t + i * rand(0.09, 0.13);
          s.tone(out, { t: tt, f: f * rand(0.97, 1.03), f2: f * 0.68, glide: 0.05, a: 0.004, d: 0.022, g, pan, lp });
        }
        break;
      }
      case 1: {
        // Warbler: FM trill.
        const osc = s.ctx.createOscillator();
        const mod = s.ctx.createOscillator();
        const modG = s.gain(rand(400, 900));
        const env = s.gain(0);
        const fc = rand(3300, 4600);
        const dur = rand(0.5, 1.1);
        osc.frequency.setValueAtTime(fc, t);
        osc.frequency.linearRampToValueAtTime(fc * rand(0.85, 1.15), t + dur);
        mod.frequency.value = rand(18, 34);
        mod.connect(modG).connect(osc.frequency);
        const lpf = s.filter('lowpass', lp, 0.7);
        const p = s.panner(pan);
        osc.connect(env).connect(lpf).connect(p).connect(out);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(g * 0.6, t + 0.05);
        env.gain.setValueAtTime(g * 0.6, t + dur - 0.1);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.active += 2;
        osc.onended = () => {
          s.active -= 2;
          for (const n of [osc, mod, modG, env, lpf, p]) n.disconnect();
        };
        osc.start(t);
        mod.start(t);
        osc.stop(t + dur + 0.02);
        mod.stop(t + dur + 0.02);
        break;
      }
      case 2: {
        // Two-note "tea-cher" call, repeated.
        const hi = rand(4000, 4800);
        const lo = hi * rand(0.72, 0.8);
        const reps = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < reps; i++) {
          const tt = t + i * 0.32;
          s.tone(out, { t: tt, f: hi, f2: hi * 0.95, glide: 0.1, a: 0.008, d: 0.03, hold: 0.06, g, pan, lp });
          s.tone(out, { t: tt + 0.15, f: lo, f2: lo * 1.03, glide: 0.1, a: 0.008, d: 0.03, hold: 0.07, g: g * 0.9, pan, lp });
        }
        break;
      }
      case 3: {
        // Distant dove: soft low "coo-COO-coo".
        const f = rand(430, 520);
        const pattern = [
          [0, 0.28, 0.6],
          [0.42, 0.42, 1],
          [0.95, 0.3, 0.7],
        ];
        for (const [dt, dur, k] of pattern) {
          s.tone(out, { t: t + dt, f: f * 1.06, f2: f * 0.94, glide: dur, a: 0.06, d: 0.06, hold: dur * 0.5, g: g * 0.9 * k, pan, lp: 1400 });
        }
        break;
      }
      default: {
        // Song phrase: a random motif repeated 2-3 times (thrush-like).
        const notes = 3 + Math.floor(Math.random() * 3);
        const motif = Array.from({ length: notes }, () => [rand(2400, 6200), rand(0.7, 1.4), rand(0.04, 0.09)] as const);
        const reps = 2 + Math.floor(Math.random() * 2);
        let tt = t;
        for (let r = 0; r < reps; r++) {
          for (const [f, bend, len] of motif) {
            s.tone(out, { t: tt, f, f2: f * bend, glide: len, a: 0.005, d: len * 0.35, hold: len * 0.4, g: g * 0.8, pan, lp });
            tt += len + 0.03;
          }
          tt += 0.18;
        }
        break;
      }
    }
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already */
      }
    }
    this.sources = [];
  }
}
