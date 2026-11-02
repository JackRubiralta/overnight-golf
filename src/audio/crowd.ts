/**
 * Small greenside gallery: applause (individual clappers rendered into a buffer), cheers and
 * groans (a chorus of formant-filtered "voices").
 */
import { clamp, rand, type Synth } from './synth';

// ───────────────────────────── tuning ─────────────────────────────

const CLAPPERS = 22;
const APPLAUSE_SECONDS = 4.2;
const CROWD_LEVEL = 0.32;
/** Vowel formants (F1, F2) in Hz. */
const VOWEL = { ah: [750, 1150], oh: [480, 850], ee: [330, 2200], eh: [560, 1750] } as const;

/** Render an applause bed: each clapper has their own pitch, rate, pan and start/stop time. */
export function renderApplause(ctx: BaseAudioContext, intensity = 1): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(APPLAUSE_SECONDS * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  const n = Math.round(CLAPPERS * intensity);
  for (let c = 0; c < n; c++) {
    const pan = rand(-0.85, 0.85);
    const gl = Math.sqrt(0.5 * (1 - pan));
    const gr = Math.sqrt(0.5 * (1 + pan));
    const dist = rand(0.35, 1); // nearer clappers are louder and brighter
    const centre = rand(900, 2300) * (0.8 + 0.3 * dist);
    const rate = rand(3.6, 6.2);
    const start = Math.pow(Math.random(), 2) * 0.45;
    const stop = rand(1.6, APPLAUSE_SECONDS - 0.5);
    // Two-pole resonator coefficients for this hand shape.
    const w = (2 * Math.PI * centre) / sr;
    const r = 0.94 - 0.02 * Math.random();
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    let t = start;
    while (t < stop) {
      const fadeOut = clamp((stop - t) / 0.9, 0, 1);
      const fadeIn = clamp((t - start) / 0.25, 0.3, 1);
      const amp = 0.22 * dist * fadeOut * fadeIn * rand(0.6, 1);
      const i0 = Math.floor(t * sr);
      const clapLen = Math.floor(sr * rand(0.012, 0.022));
      let y1 = 0;
      let y2 = 0;
      for (let j = 0; j < clapLen && i0 + j < len; j++) {
        const exc = (Math.random() * 2 - 1) * Math.exp(-j / (sr * 0.0025));
        const y = exc + a1 * y1 + a2 * y2;
        y2 = y1;
        y1 = y;
        const v = y * amp * 0.25;
        L[i0 + j] += v * gl;
        R[i0 + j] += v * gr;
      }
      t += (1 / rate) * rand(0.85, 1.15) * (1 + (1 - fadeOut) * 0.4); // slows as it dies away
    }
  }
  // Normalise peak to ~0.9.
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < len; i++) {
      L[i] *= k;
      R[i] *= k;
    }
  }
  return buf;
}

export class Crowd {
  private applause: AudioBuffer | null = null;
  constructor(private s: Synth, private out: AudioNode) {}

  play(kind: 'applause' | 'groan' | 'cheer') {
    if (kind === 'groan') this.groan();
    else {
      this.clap(kind === 'cheer' ? 1.15 : 0.9);
      if (kind === 'cheer') this.cheer();
    }
  }

  private clap(level: number) {
    const ctx = this.s.ctx;
    if (!this.applause) this.applause = renderApplause(ctx);
    const src = ctx.createBufferSource();
    src.buffer = this.applause;
    src.playbackRate.value = rand(0.94, 1.06);
    const lp = this.s.filter('lowpass', 6500, 0.5);
    const g = this.s.gain(CROWD_LEVEL * level);
    src.connect(lp).connect(g).connect(this.out);
    src.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* already */
      }
    };
    src.start(this.s.now + rand(0.05, 0.25));
  }

  /** One sung "voice": saw + breath through two formant filters, with a pitch contour. */
  private voice(t: number, dur: number, f0: number, f1: number, vowelA: readonly number[], vowelB: readonly number[], level: number, pan: number) {
    const s = this.s;
    const ctx = s.ctx;
    if (!s.canPlay()) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    // Vibrato.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(4.5, 6.5);
    const lfoG = s.gain(f0 * 0.018);
    lfo.connect(lfoG).connect(osc.frequency);
    const breath = s.noiseSource(s.pink);
    const breathG = s.gain(0.25);
    const mix = s.gain(1);
    osc.connect(mix);
    breath.connect(breathG).connect(mix);
    const fA = s.filter('bandpass', vowelA[0], 6);
    const fB = s.filter('bandpass', vowelA[1], 8);
    fA.frequency.setValueAtTime(vowelA[0], t);
    fA.frequency.linearRampToValueAtTime(vowelB[0], t + dur * 0.8);
    fB.frequency.setValueAtTime(vowelA[1], t);
    fB.frequency.linearRampToValueAtTime(vowelB[1], t + dur * 0.8);
    const fBg = s.gain(0.5);
    const env = s.gain(0);
    mix.connect(fA).connect(env);
    mix.connect(fB).connect(fBg).connect(env);
    const lp = s.filter('lowpass', 2600, 0.6);
    const p = s.panner(pan);
    env.connect(lp).connect(p).connect(this.out);
    const pk = level;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(pk, t + dur * 0.25);
    env.gain.setValueAtTime(pk, t + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const end = t + dur + 0.05;
    s.active += 3;
    osc.onended = () => {
      s.active -= 3;
      for (const n of [osc, lfo, breath, mix, env, lp, p]) {
        try {
          n.disconnect();
        } catch {
          /* already */
        }
      }
    };
    osc.start(t);
    lfo.start(t);
    breath.start(t, Math.random() * 2);
    osc.stop(end);
    lfo.stop(end);
    breath.stop(end);
  }

  private groan() {
    const t = this.s.now + rand(0.05, 0.2);
    for (let i = 0; i < 9; i++) {
      const f0 = rand(115, 230);
      const dur = rand(1.1, 1.8);
      this.voice(t + rand(0, 0.25), dur, f0 * 1.08, f0 * rand(0.72, 0.82), VOWEL.oh, VOWEL.ah, CROWD_LEVEL * 0.55, rand(-0.7, 0.7));
    }
  }

  private cheer() {
    const t = this.s.now + rand(0.05, 0.15);
    for (let i = 0; i < 7; i++) {
      const f0 = rand(170, 360);
      const dur = rand(0.6, 1.2);
      this.voice(t + rand(0, 0.35), dur, f0 * 0.9, f0 * rand(1.15, 1.35), VOWEL.eh, VOWEL.ah, CROWD_LEVEL * 0.45, rand(-0.7, 0.7));
    }
    // A couple of "whoo!" whistles.
    for (let i = 0; i < 2; i++) {
      const wt = t + rand(0.1, 0.6);
      const f = rand(1100, 1500);
      this.s.tone(this.out, { t: wt, f, f2: f * 1.9, glide: 0.35, a: 0.05, d: 0.18, hold: 0.2, g: CROWD_LEVEL * 0.12, pan: rand(-0.6, 0.6) });
    }
  }
}
