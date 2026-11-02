/**
 * Tiny procedural synthesis toolkit on top of the Web Audio API. Everything in the game's audio is
 * built from these voices: filtered noise bursts, gliding oscillators, modal (inharmonic) rings and
 * noise grains. All voices are one-shot: nodes are scheduled, then stopped and disconnected.
 *
 * Time constants: `d` is the exponential decay time constant (seconds to fall to 1/e ≈ -8.7 dB);
 * a voice is stopped after ~7 time constants (≈ -60 dB).
 */

/** Hard cap on simultaneously sounding one-shot sources (low-priority sounds are skipped). */
export const MAX_VOICES = 140;
/** Pre-roll so the first sample of an envelope never lands in the past (avoids clicks). */
const LEAD = 0.004;

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface ToneOpts {
  t?: number;
  f: number;
  /** End frequency (glide over `glide` seconds, exponential). */
  f2?: number;
  glide?: number;
  type?: OscillatorType;
  /** Attack (s). */
  a?: number;
  /** Decay time constant (s). */
  d: number;
  /** Peak gain. */
  g: number;
  detune?: number;
  pan?: number;
  /** Optional lowpass on the voice. */
  lp?: number;
  /** Hold at the peak before the decay starts (s). */
  hold?: number;
}

export interface NoiseOpts {
  t?: number;
  color?: NoiseColor;
  a?: number;
  d: number;
  g: number;
  /** Main filter. */
  type?: BiquadFilterType;
  f?: number;
  /** Filter frequency at the end of `glide` seconds (exponential). */
  f2?: number;
  glide?: number;
  q?: number;
  /** Extra highpass / lowpass corners. */
  hp?: number;
  lp?: number;
  pan?: number;
  hold?: number;
  /** Playback rate (pitch of the noise grain structure). */
  rate?: number;
}

export interface ModalOpts {
  t?: number;
  /** Fundamental (Hz). */
  f: number;
  ratios: number[];
  /** Per-partial decay time constants (s). */
  decays: number[];
  /** Per-partial relative gains. */
  gains: number[];
  g: number;
  /** Beat (Hz): each partial is a detuned pair → shimmer. 0 = single sines. */
  beat?: number;
  /** Relative frequency glide over the ring (e.g. -0.015 = falls 1.5 %). */
  bend?: number;
  bendTime?: number;
  pan?: number;
  a?: number;
}

export interface GrainOpts {
  t?: number;
  n: number;
  /** Time span the grains are scattered over (s). */
  spread: number;
  /** Bias grains toward the start (1 = uniform, >1 = front-loaded). */
  skew?: number;
  f: number;
  /** Random spread of the grain filter frequency (fraction). */
  fJitter?: number;
  q?: number;
  g: number;
  /** Grain decay (s). */
  d: number;
  /** Gain decays across the cloud. */
  fade?: boolean;
  pan?: number;
  panJitter?: number;
}

export function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

export class Synth {
  readonly ctx: AudioContext;
  readonly white: AudioBuffer;
  readonly pink: AudioBuffer;
  readonly brown: AudioBuffer;
  /** Stereo pink noise with decorrelated channels (wind bed). */
  readonly pinkStereo: AudioBuffer;
  active = 0;
  private hasPanner: boolean;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const sr = ctx.sampleRate;
    this.white = this.makeNoise('white', 2 * sr, 1);
    this.pink = this.makeNoise('pink', 3 * sr, 1);
    this.brown = this.makeNoise('brown', 3 * sr, 1);
    this.pinkStereo = this.makeNoise('pink', 5 * sr, 2);
    this.hasPanner = typeof (ctx as any).createStereoPanner === 'function';
  }

  get now() {
    return this.ctx.currentTime + LEAD;
  }
  /** True if there's headroom for another voice (pass critical=true to always allow). */
  canPlay(critical = false) {
    return critical || this.active < MAX_VOICES;
  }

  private makeNoise(color: NoiseColor, len: number, channels: number): AudioBuffer {
    const buf = this.ctx.createBuffer(channels, len, this.ctx.sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (color === 'white') d[i] = w;
        else if (color === 'pink') {
          // Paul Kellet's refined pink filter.
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
      // Cross-fade the loop seam so looping sources don't click.
      const fade = Math.min(2048, len >> 4);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[len - fade + i] * (1 - k);
      }
    }
    return buf;
  }

  buffer(color: NoiseColor) {
    return color === 'white' ? this.white : color === 'pink' ? this.pink : this.brown;
  }

  /** Looping noise source starting at a random offset. */
  noiseSource(buf: AudioBuffer, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    return s;
  }

  filter(type: BiquadFilterType, f: number, q = 0.707) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = clamp(f, 10, this.ctx.sampleRate * 0.49);
    n.Q.value = q;
    return n;
  }

  gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** Stereo panner if supported, else a pass-through gain. */
  panner(p: number): AudioNode {
    if (this.hasPanner) {
      const n = this.ctx.createStereoPanner();
      n.pan.value = clamp(p, -1, 1);
      return n;
    }
    return this.gain(1);
  }

  /** Attack/hold/decay envelope on a gain param. Returns the time the voice is silent. */
  private env(p: AudioParam, t: number, a: number, peak: number, d: number, hold = 0) {
    const pk = Math.max(peak, 0.00002);
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.00001, t);
    if (a > 0.0005) p.exponentialRampToValueAtTime(pk, t + a);
    else p.setValueAtTime(pk, t);
    if (hold > 0) p.setValueAtTime(pk, t + a + hold);
    p.setTargetAtTime(0, t + a + hold, Math.max(0.001, d));
    // ≈ -60 dB for short voices; long rings (gongs) stop at ≈ -43 dB, already far below the mix.
    return t + a + hold + d * (d > 0.8 ? 5 : 7) + 0.02;
  }

  /** Track a scheduled source for voice counting and cleanup. */
  private track(src: AudioScheduledSourceNode, t: number, end: number, cleanup: AudioNode[]) {
    this.active++;
    src.onended = () => {
      this.active--;
      for (const n of cleanup) {
        try {
          n.disconnect();
        } catch {
          /* already */
        }
      }
    };
    src.start(t);
    src.stop(end);
  }

  private chainOut(nodes: AudioNode[], dest: AudioNode) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    nodes[nodes.length - 1].connect(dest);
  }

  /** Oscillator voice with optional pitch glide. */
  tone(dest: AudioNode, o: ToneOpts) {
    if (!this.canPlay()) return;
    const t = o.t ?? this.now;
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2 && o.f2 !== o.f) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.glide ?? o.d * 2));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.gain(0);
    const end = this.env(g.gain, t, o.a ?? 0.001, o.g, o.d, o.hold);
    const chain: AudioNode[] = [osc];
    if (o.lp) chain.push(this.filter('lowpass', o.lp, 0.7));
    chain.push(g);
    if (o.pan) chain.push(this.panner(o.pan));
    this.chainOut(chain, dest);
    this.track(osc, t, end, chain);
  }

  /** Filtered noise burst. */
  noise(dest: AudioNode, o: NoiseOpts) {
    if (!this.canPlay()) return;
    const t = o.t ?? this.now;
    const buf = this.buffer(o.color ?? 'white');
    const src = this.noiseSource(buf);
    if (o.rate) src.playbackRate.value = o.rate;
    const chain: AudioNode[] = [src];
    if (o.type && o.f) {
      const f = this.filter(o.type, o.f, o.q ?? 0.707);
      if (o.f2) {
        f.frequency.setValueAtTime(o.f, t);
        f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.glide ?? o.d * 3));
      }
      chain.push(f);
    }
    if (o.hp) chain.push(this.filter('highpass', o.hp, 0.7));
    if (o.lp) chain.push(this.filter('lowpass', o.lp, 0.7));
    const g = this.gain(0);
    const end = this.env(g.gain, t, o.a ?? 0.001, o.g, o.d, o.hold);
    chain.push(g);
    if (o.pan) chain.push(this.panner(o.pan));
    this.chainOut(chain, dest);
    const off = Math.random() * (buf.duration - 0.5);
    this.active++;
    src.onended = () => {
      this.active--;
      for (const n of chain) {
        try {
          n.disconnect();
        } catch {
          /* already */
        }
      }
    };
    src.start(t, Math.max(0, off));
    src.stop(end);
  }

  /** Inharmonic ring: a bank of exponentially decaying sines (bells, gongs, clubheads, cups). */
  modal(dest: AudioNode, o: ModalOpts) {
    const t = o.t ?? this.now;
    const out = this.gain(1);
    const tail: AudioNode[] = [out];
    if (o.pan) {
      const p = this.panner(o.pan);
      out.connect(p);
      p.connect(dest);
      tail.push(p);
    } else out.connect(dest);
    let last: AudioScheduledSourceNode | null = null;
    let lastEnd = 0;
    const n = o.ratios.length;
    for (let i = 0; i < n; i++) {
      if (!this.canPlay(i === 0)) break;
      const pairs = o.beat ? 2 : 1;
      for (let k = 0; k < pairs; k++) {
        const f = o.f * o.ratios[i] + (o.beat ? (k ? 0.5 : -0.5) * o.beat * (1 + i * 0.37) : 0);
        if (f >= this.ctx.sampleRate * 0.45) continue;
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(f, t);
        if (o.bend) osc.frequency.exponentialRampToValueAtTime(f * (1 + o.bend), t + (o.bendTime ?? 2));
        const g = this.gain(0);
        const end = this.env(g.gain, t, o.a ?? 0.0015, (o.g * (o.gains[i] ?? 0.3)) / pairs, o.decays[i] ?? o.decays[o.decays.length - 1]);
        osc.connect(g);
        g.connect(out);
        this.active++;
        osc.onended = () => {
          this.active--;
          try {
            g.disconnect();
          } catch {
            /* already */
          }
        };
        osc.start(t);
        osc.stop(end);
        if (end > lastEnd) {
          lastEnd = end;
          last = osc;
        }
      }
    }
    // Disconnect the shared output when the longest partial ends.
    if (last) {
      const prev = last.onended as any;
      last.onended = (ev) => {
        prev?.(ev);
        for (const nd of tail) {
          try {
            nd.disconnect();
          } catch {
            /* already */
          }
        }
      };
    }
  }

  /** A cloud of tiny filtered noise grains (sand spray, gravel, shards, crackle). */
  grains(dest: AudioNode, o: GrainOpts) {
    const t0 = o.t ?? this.now;
    const skew = o.skew ?? 1;
    for (let i = 0; i < o.n; i++) {
      if (!this.canPlay()) return;
      const u = Math.pow(Math.random(), skew);
      const t = t0 + u * o.spread;
      const fade = o.fade === false ? 1 : 1 - 0.75 * u;
      this.noise(dest, {
        t,
        d: o.d * rand(0.6, 1.4),
        g: o.g * fade * rand(0.4, 1),
        type: 'bandpass',
        f: o.f * (1 + (o.fJitter ?? 0.3) * (Math.random() * 2 - 1)),
        q: o.q ?? 2,
        pan: (o.pan ?? 0) + (o.panJitter ?? 0) * (Math.random() * 2 - 1),
      });
    }
  }

  /** Generated stereo impulse response for a short open-air reverb (slap + diffuse tail). */
  makeImpulse(seconds: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(seconds * sr);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / sr;
        // Gentle lowpass that closes over time (air absorption).
        const k = 0.35 + 0.6 * Math.exp(-x * 3);
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.pow(1 - i / len, decay) * Math.exp(-x * 2.2);
      }
      // A couple of distant slapback reflections (clubhouse, tree line).
      for (const [dt, a] of [[0.071 + ch * 0.009, 0.35], [0.163 - ch * 0.013, 0.22], [0.29 + ch * 0.02, 0.12]] as const) {
        const i0 = Math.floor(dt * sr);
        for (let j = 0; j < 220 && i0 + j < len; j++) d[i0 + j] += a * (Math.random() * 2 - 1) * Math.exp(-j / 60);
      }
    }
    return buf;
  }
}
