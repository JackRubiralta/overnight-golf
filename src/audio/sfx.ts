/**
 * One-shot sound recipes (all procedural). Each takes the Synth and an output bus.
 * Gains are relative; the master bus has a compressor/limiter.
 */
import type { SurfaceId } from '../config';
import type { StrikeQuality } from '../physics/impact';
import { clamp, rand, type Synth } from './synth';

// ───────────────────────────── tuning ─────────────────────────────

/** Overall level of strikes / bounces / props relative to each other. */
const LEVEL = { strike: 0.9, bounce: 0.55, cup: 0.5, splash: 0.7, prop: 0.75, ui: 0.22, adjust: 0.16 };
/** Club "ting" fundamentals (Hz) and decays. */
const DRIVER_RING = { f: 3350, ratios: [1, 1.37, 1.81, 2.43, 3.02], decays: [0.11, 0.085, 0.06, 0.045, 0.03], gains: [1, 0.7, 0.55, 0.35, 0.2] };
const WOOD_RING = { f: 3050, ratios: [1, 1.42, 1.93, 2.6], decays: [0.07, 0.05, 0.04, 0.03], gains: [1, 0.6, 0.4, 0.25] };
/** Gong partials (tam-tam-like inharmonic series). */
const GONG = {
  f: 118,
  ratios: [1, 1.52, 2.03, 2.71, 3.31, 4.18, 5.07, 6.2, 7.43, 9.1],
  decays: [2.4, 1.9, 1.7, 1.35, 1.15, 0.95, 0.75, 0.55, 0.42, 0.3],
  gains: [1, 0.75, 0.62, 0.55, 0.45, 0.36, 0.28, 0.2, 0.15, 0.1],
};

export type ClubFamily = 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';
function family(kind: string): ClubFamily {
  const k = kind.toLowerCase();
  if (k.includes('putt')) return 'putter';
  if (k.includes('driver')) return 'driver';
  if (k.includes('wood')) return 'wood';
  if (k.includes('hybrid')) return 'hybrid';
  if (k.includes('wedge')) return 'wedge';
  return 'iron';
}

const isGrass = (s: SurfaceId) => s === 'fairway' || s === 'fringe' || s === 'tee' || s === 'green' || s === 'rough' || s === 'deepRough' || s === 'oob';

// ───────────────────────────── swing ─────────────────────────────

/** The sharp "swish" at peak clubhead speed. */
export function swish(s: Synth, out: AudioNode, speedMph: number) {
  const I = clamp(speedMph / 100, 0.2, 1.3);
  s.noise(out, { color: 'white', a: 0.035, d: 0.045, g: 0.32 * I, type: 'bandpass', f: 2200 + 2800 * I, f2: 900, glide: 0.12, q: 1.1 });
  s.noise(out, { color: 'pink', a: 0.02, d: 0.06, g: 0.2 * I, type: 'lowpass', f: 900 + 600 * I, f2: 300, glide: 0.15 });
}

// ───────────────────────────── strike ─────────────────────────────

export function strike(s: Synth, out: AudioNode, q: StrikeQuality, clubKind: string, speedMph: number, lie: SurfaceId) {
  const fam = family(clubKind);
  const t = s.now;
  const L = LEVEL.strike;
  if (q === 'whiff') {
    // Club only brushes the turf (or nothing at all).
    if (lie !== 'tee' && isGrass(lie)) s.noise(out, { t, color: 'white', d: 0.04, g: 0.12, type: 'highpass', f: 3500 });
    if (lie === 'sand') sandBurst(s, out, t, 0.35);
    return;
  }
  if (fam === 'putter') {
    putterKnock(s, out, t, q, speedMph, lie);
    return;
  }
  const I = clamp(speedMph / 100, 0.12, 1.25);
  const inSand = lie === 'sand';
  const clean = q === 'thin' || q === 'topped';
  // Sand muffles the contact unless the ball was picked clean.
  const mute = inSand && !clean ? 0.35 : lie === 'deepRough' ? 0.6 : lie === 'rough' ? 0.8 : 1;
  const lpRough = lie === 'deepRough' ? 2800 : lie === 'rough' ? 4500 : 0;
  const metal = fam === 'driver' || fam === 'wood';

  switch (q) {
    case 'pure':
    case 'good': {
      const good = q === 'good' ? 0.75 : 1;
      if (metal || fam === 'hybrid') {
        // "Thwack": bright transient + punchy body + short titanium ring.
        s.noise(out, { t, d: 0.006, g: 0.95 * I * L * mute * good, type: 'highpass', f: 1800, lp: lpRough || (q === 'good' ? 7000 : 0) });
        s.noise(out, { t, d: 0.012, g: 0.45 * I * L * mute, type: 'bandpass', f: 2600, q: 1.6 });
        s.tone(out, { t, f: 190, f2: 105, glide: 0.06, d: 0.035, g: 0.55 * I * L * mute });
        const ring = fam === 'driver' ? DRIVER_RING : WOOD_RING;
        const rf = fam === 'hybrid' ? 2850 : ring.f * rand(0.985, 1.015);
        const decays = fam === 'hybrid' ? ring.decays.map((d) => d * 0.5) : ring.decays;
        s.modal(out, { t, f: rf, ratios: ring.ratios, decays: decays.map((d) => d * (q === 'good' ? 0.7 : 1)), gains: ring.gains, g: (fam === 'driver' ? 0.2 : 0.13) * I * L * mute * good });
      } else {
        // Irons & wedges: compact, compressed "click".
        const wedge = fam === 'wedge';
        s.noise(out, { t, d: 0.0035, g: 0.9 * I * L * mute * good, type: 'highpass', f: wedge ? 3200 : 2500, lp: lpRough });
        s.noise(out, { t, d: 0.01, g: 0.5 * I * L * mute, type: 'bandpass', f: wedge ? 3800 : 3200, q: 3 });
        s.tone(out, { t, f: wedge ? 2900 : 2550, d: 0.012, g: 0.12 * I * L * mute * good });
        s.tone(out, { t, f: 260, f2: 150, glide: 0.04, d: 0.025, g: 0.45 * I * L * mute });
        // A clean divot after the ball (irons take turf on good strikes).
        if (lie !== 'tee' && isGrass(lie)) turfTear(s, out, t + 0.012, 0.35 * I);
      }
      break;
    }
    case 'toe':
    case 'heel': {
      // Off-centre: duller click and a buzzing vibration (beating partials).
      const off = q === 'toe' ? 1 : 0.92;
      s.noise(out, { t, d: 0.009, g: 0.6 * I * L * mute, type: 'lowpass', f: 2200 * off });
      s.tone(out, { t, f: 1280 * off, d: 0.07, g: 0.07 * I * L * mute });
      s.tone(out, { t, f: 1325 * off, d: 0.07, g: 0.07 * I * L * mute });
      s.tone(out, { t, f: 175, f2: 120, glide: 0.05, d: 0.04, g: 0.45 * I * L * mute });
      if (metal) s.tone(out, { t, f: 880, f2: 760, glide: 0.05, d: 0.03, g: 0.18 * I * L * mute, type: 'triangle' });
      if (!metal && lie !== 'tee' && isGrass(lie)) turfTear(s, out, t + 0.012, 0.25 * I);
      break;
    }
    case 'thin': {
      // Harsh metallic sting from the leading edge.
      s.noise(out, { t, d: 0.02, g: 0.55 * I * L, type: 'bandpass', f: 3500, q: 4 });
      s.tone(out, { t, f: 1900, d: 0.09, g: 0.12 * I * L, type: 'square', lp: 4200 });
      s.tone(out, { t, f: 3100, d: 0.13, g: 0.1 * I * L });
      s.tone(out, { t, f: 3172, d: 0.13, g: 0.1 * I * L });
      s.tone(out, { t, f: 320, f2: 220, glide: 0.04, d: 0.02, g: 0.25 * I * L });
      break;
    }
    case 'fat': {
      // Dull thud + turf (or sand) tearing.
      s.tone(out, { t, f: 100, f2: 52, glide: 0.12, d: 0.08, g: 0.9 * I * L });
      s.noise(out, { t, d: 0.015, g: 0.4 * I * L * mute, type: 'lowpass', f: 900 });
      if (!inSand) turfTear(s, out, t + 0.004, 0.9 * I);
      break;
    }
    case 'topped': {
      // "Clack" off the top of the ball + a scuff along the ground.
      s.tone(out, { t, f: 760, d: 0.018, g: 0.25 * I * L, type: 'square', lp: 2400 });
      s.noise(out, { t, d: 0.007, g: 0.6 * I * L, type: 'bandpass', f: 1450, q: 5 });
      s.noise(out, { t, d: 0.005, g: 0.4 * I * L, type: 'highpass', f: 1000 });
      if (!inSand) s.noise(out, { t: t + 0.01, d: 0.06, g: 0.2 * I * L, type: 'bandpass', f: 1600, q: 0.8 });
      break;
    }
    case 'skied': {
      // Hollow "tock" high on the face / crown.
      s.tone(out, { t, f: 820, f2: 690, glide: 0.06, d: 0.04, g: 0.35 * I * L, type: 'triangle' });
      s.tone(out, { t, f: 1660, d: 0.025, g: 0.12 * I * L });
      s.noise(out, { t, d: 0.006, g: 0.5 * I * L, type: 'highpass', f: 1400 });
      break;
    }
    default:
      break;
  }
  if (inSand) sandBurst(s, out, t + 0.003, (q === 'fat' ? 1.35 : clean ? 0.45 : 1) * clamp(I * 1.3, 0.4, 1.3));
  else if (lie === 'rough' || lie === 'deepRough') {
    const deep = lie === 'deepRough' ? 1.6 : 1;
    s.noise(out, { t, a: 0.004, d: 0.07 * deep, g: 0.22 * I * deep, type: 'bandpass', f: 4800, q: 0.6, hp: 2200 });
  }
}

function putterKnock(s: Synth, out: AudioNode, t: number, q: StrikeQuality, speedMph: number, lie: SurfaceId) {
  const I = clamp(speedMph / 7, 0.15, 1.2);
  const off = q === 'toe' || q === 'heel' || q === 'thin' || q === 'topped';
  const f = off ? 980 : 1180;
  s.modal(out, { t, f, ratios: [1, 2.13, 3.4], decays: [0.022, 0.013, 0.008], gains: [1, 0.45, 0.25], g: 0.28 * I });
  s.noise(out, { t, d: 0.004, g: 0.35 * I, type: 'lowpass', f: 3500 });
  s.tone(out, { t, f: 230, f2: 180, glide: 0.03, d: 0.022, g: 0.3 * I });
  if (off) s.tone(out, { t, f: 1420, d: 0.05, g: 0.04 * I }); // slight buzz on a mishit
  if (lie !== 'green' && isGrass(lie)) s.noise(out, { t, d: 0.03, g: 0.1 * I, type: 'highpass', f: 3000 });
}

/** Turf being torn (divot): noisy midrange with crackle. */
export function turfTear(s: Synth, out: AudioNode, t: number, amt: number) {
  const a = clamp(amt, 0, 1.4);
  s.noise(out, { t, color: 'pink', a: 0.006, d: 0.09 + 0.06 * a, g: 0.35 * a, type: 'bandpass', f: 1100, f2: 500, glide: 0.2, q: 0.8 });
  s.grains(out, { t, n: Math.round(6 + 10 * a), spread: 0.16 + 0.08 * a, skew: 1.6, f: 2400, fJitter: 0.5, q: 1.5, g: 0.25 * a, d: 0.004 });
  s.noise(out, { t: t + 0.02, d: 0.08, g: 0.1 * a, type: 'highpass', f: 2500 }); // dirt spray
}

/** Sand "pff": breathy burst + grain spray. */
export function sandBurst(s: Synth, out: AudioNode, t: number, amt: number) {
  const a = clamp(amt, 0, 1.6);
  s.noise(out, { t, a: 0.005, d: 0.08 + 0.07 * a, g: 0.55 * a, type: 'lowpass', f: 6000, f2: 1100, glide: 0.3, hp: 500 });
  s.noise(out, { t, a: 0.003, d: 0.05, g: 0.3 * a, type: 'bandpass', f: 1800, q: 0.6 });
  s.grains(out, { t: t + 0.01, n: Math.round(10 + 18 * a), spread: 0.25 + 0.2 * a, skew: 1.8, f: 4200, fJitter: 0.45, q: 2, g: 0.18 * a, d: 0.003, panJitter: 0.4 });
  s.tone(out, { t, f: 85, f2: 55, glide: 0.08, d: 0.05, g: 0.3 * a });
}

// ───────────────────────────── ball on the ground ─────────────────────────────

export function bounce(s: Synth, out: AudioNode, surface: SurfaceId, speed: number) {
  const I = clamp(speed / 16, 0.06, 1) * LEVEL.bounce;
  const t = s.now;
  switch (surface) {
    case 'green':
    case 'fringe':
      s.tone(out, { t, f: 155, f2: 95, glide: 0.05, d: 0.03, g: 0.7 * I });
      s.noise(out, { t, d: 0.018, g: 0.35 * I, type: 'lowpass', f: 650 });
      break;
    case 'fairway':
    case 'tee':
      s.tone(out, { t, f: 130, f2: 80, glide: 0.06, d: 0.04, g: 0.75 * I });
      s.noise(out, { t, d: 0.022, g: 0.35 * I, type: 'lowpass', f: 1100 });
      s.noise(out, { t, d: 0.03, g: 0.08 * I, type: 'highpass', f: 3500 });
      break;
    case 'rough':
    case 'deepRough':
    case 'oob':
      s.noise(out, { t, a: 0.004, d: 0.07, g: 0.35 * I, type: 'bandpass', f: 2600, q: 0.7 });
      s.tone(out, { t, f: 110, f2: 70, glide: 0.06, d: 0.035, g: 0.4 * I });
      break;
    case 'sand':
      s.noise(out, { t, d: 0.05, g: 0.45 * I, type: 'bandpass', f: 2200, q: 0.9 });
      s.grains(out, { t, n: 10, spread: 0.07, skew: 1.5, f: 3800, q: 2, g: 0.25 * I, d: 0.003 });
      s.tone(out, { t, f: 75, d: 0.03, g: 0.3 * I });
      break;
    case 'path':
      s.noise(out, { t, d: 0.004, g: 0.9 * I, type: 'highpass', f: 1500 });
      s.modal(out, { t, f: 1720 * rand(0.95, 1.05), ratios: [1, 2.31, 3.9], decays: [0.03, 0.018, 0.01], gains: [1, 0.5, 0.25], g: 0.35 * I });
      s.tone(out, { t, f: 310, d: 0.012, g: 0.4 * I });
      break;
    case 'dirt':
      s.tone(out, { t, f: 120, f2: 75, glide: 0.05, d: 0.035, g: 0.7 * I });
      s.grains(out, { t, n: 7, spread: 0.06, f: 2600, q: 1.5, g: 0.25 * I, d: 0.004 });
      break;
    case 'water':
      splash(s, out, clamp(speed / 25, 0.15, 0.6));
      break;
  }
}

// ───────────────────────────── cup ─────────────────────────────

/** Ball rattling around the cup liner, then dropping to the bottom. */
export function cup(s: Synth, out: AudioNode) {
  const t0 = s.now;
  const L = LEVEL.cup;
  const n = 3 + Math.floor(Math.random() * 3);
  let t = t0;
  let gap = rand(0.045, 0.07);
  for (let i = 0; i < n; i++) {
    const f = rand(2050, 2750);
    s.modal(out, { t, f, ratios: [1, 2.76, 5.4], decays: [0.03, 0.016, 0.008], gains: [1, 0.45, 0.2], g: L * 0.32 * (1 - i * 0.12) * rand(0.7, 1), pan: rand(-0.1, 0.1) });
    s.noise(out, { t, d: 0.003, g: L * 0.25, type: 'highpass', f: 2500 });
    t += gap;
    gap *= rand(0.65, 0.95);
  }
  // The drop: hollow plunk with the cup's cavity resonance.
  t += 0.05;
  s.tone(out, { t, f: 270, f2: 175, glide: 0.08, d: 0.06, g: L * 0.7 });
  s.noise(out, { t, d: 0.03, g: L * 0.35, type: 'bandpass', f: 420, q: 4 });
  s.modal(out, { t: t + 0.002, f: 1150, ratios: [1, 2.3], decays: [0.05, 0.03], gains: [1, 0.4], g: L * 0.12 });
  // Two quiet settling ticks.
  s.modal(out, { t: t + 0.09, f: 2300, ratios: [1, 2.7], decays: [0.02, 0.01], gains: [1, 0.4], g: L * 0.1 });
  s.modal(out, { t: t + 0.15, f: 2450, ratios: [1, 2.7], decays: [0.015, 0.008], gains: [1, 0.4], g: L * 0.05 });
}

// ───────────────────────────── water ─────────────────────────────

export function splash(s: Synth, out: AudioNode, strength: number) {
  const a = clamp(strength, 0.05, 1) * LEVEL.splash;
  const t = s.now;
  // Plop.
  s.tone(out, { t, f: 190, f2: 70, glide: 0.07, d: 0.05, g: 0.8 * a });
  // Spray (bright → dull) and body.
  s.noise(out, { t, a: 0.004, d: 0.12 + 0.12 * a, g: 0.6 * a, type: 'bandpass', f: 2800, f2: 600, glide: 0.5, q: 0.7 });
  s.noise(out, { t, color: 'brown', a: 0.01, d: 0.12, g: 0.6 * a, type: 'lowpass', f: 900 });
  // Bubbles: rising sine chirps.
  const nb = Math.round(5 + 10 * a);
  for (let i = 0; i < nb; i++) {
    const bt = t + 0.03 + Math.pow(Math.random(), 1.5) * (0.4 + 0.4 * a);
    const f = rand(350, 1100);
    s.tone(out, { t: bt, f, f2: f * rand(1.6, 2.6), glide: rand(0.02, 0.05), d: rand(0.012, 0.03), g: rand(0.05, 0.14) * a, pan: rand(-0.3, 0.3) });
  }
  // Droplets falling back.
  s.grains(out, { t: t + 0.2, n: Math.round(6 + 14 * a), spread: 0.6 + 0.5 * a, f: 3200, fJitter: 0.5, q: 3, g: 0.12 * a, d: 0.004, panJitter: 0.5 });
}

// ───────────────────────────── props ─────────────────────────────

export function propHit(s: Synth, out: AudioNode, verb: AudioNode, kind: string, speed: number) {
  const I = clamp(speed / 20, 0.15, 1.2) * LEVEL.prop;
  const k = kind.toLowerCase();
  const t = s.now;
  if (k.includes('gong') || k.includes('bell')) {
    // Long inharmonic ring with beating shimmer and a slight downward "wah".
    const f = GONG.f * rand(0.97, 1.03);
    const decays = GONG.decays.map((d) => d * (0.8 + 0.4 * clamp(speed / 20, 0, 1)));
    s.modal(out, { t, f, ratios: GONG.ratios, decays, gains: GONG.gains, g: 0.42 * I, beat: 0.9, bend: -0.012, bendTime: 3 });
    s.modal(verb, { t, f, ratios: GONG.ratios.slice(0, 5), decays: decays.slice(0, 5), gains: GONG.gains, g: 0.2 * I, beat: 0.6 });
    s.noise(out, { t, d: 0.03, g: 0.4 * I, type: 'lowpass', f: 2200 });
    s.tone(out, { t, f: 62, d: 0.12, g: 0.5 * I });
  } else if (k.includes('pot') || k.includes('vase') || k.includes('urn') || k.includes('jar') || k.includes('ceramic') || k.includes('glass') || k.includes('bottle')) {
    potShatter(s, out, I);
  } else if (k.includes('target') || k.includes('metal') || k.includes('cart') || k.includes('sign') || k.includes('plate') || k.includes('bin') || k.includes('can')) {
    // Metal plate clang.
    s.noise(out, { t, d: 0.005, g: 0.7 * I, type: 'highpass', f: 1200 });
    s.modal(out, { t, f: rand(480, 560), ratios: [1, 2.32, 3.91, 5.37, 7.1], decays: [0.45, 0.3, 0.2, 0.14, 0.09], gains: [1, 0.7, 0.5, 0.35, 0.2], g: 0.3 * I, beat: 2.5 });
  } else if (k.includes('pin') || k.includes('flag') || k.includes('pole')) {
    s.modal(out, { t, f: rand(1700, 1900), ratios: [1, 2.76, 5.4], decays: [0.18, 0.08, 0.04], gains: [1, 0.4, 0.2], g: 0.25 * I });
    s.noise(out, { t, d: 0.004, g: 0.4 * I, type: 'highpass', f: 2000 });
  } else {
    // Wood (crates, benches, trees, posts) — hollow knock.
    const crate = k.includes('crate') || k.includes('box') || k.includes('barrel');
    const f = crate ? rand(200, 240) : rand(150, 190);
    s.noise(out, { t, d: 0.012, g: 0.6 * I, type: 'bandpass', f: crate ? 950 : 750, q: 2 });
    s.modal(out, { t, f, ratios: [1, 2.18, 3.62, 5.4], decays: [0.09, 0.06, 0.035, 0.02], gains: [1, 0.7, 0.45, 0.25], g: 0.45 * I });
    s.tone(out, { t, f: 95, f2: 70, glide: 0.05, d: 0.04, g: 0.4 * I });
    if (crate) s.modal(out, { t: t + 0.035, f: f * 1.4, ratios: [1, 2.3], decays: [0.04, 0.02], gains: [1, 0.5], g: 0.15 * I }); // loose slat rattle
  }
}

function potShatter(s: Synth, out: AudioNode, I: number) {
  const t = s.now;
  // Clay "tok".
  s.modal(out, { t, f: rand(560, 660), ratios: [1, 2.25, 3.55], decays: [0.035, 0.02, 0.012], gains: [1, 0.6, 0.35], g: 0.45 * I });
  s.tone(out, { t, f: 140, f2: 90, glide: 0.04, d: 0.03, g: 0.4 * I });
  // Crash.
  s.noise(out, { t: t + 0.008, a: 0.003, d: 0.09, g: 0.5 * I, type: 'bandpass', f: 4200, f2: 2600, glide: 0.25, q: 0.8 });
  // Shards: tiny high pings scattered over half a second, bouncing.
  const n = Math.round(14 + 12 * Math.min(1, I));
  for (let i = 0; i < n; i++) {
    const st = t + 0.01 + Math.pow(Math.random(), 1.7) * 0.6;
    s.tone(out, { t: st, f: rand(2600, 8500), d: rand(0.008, 0.03), g: rand(0.03, 0.1) * I, pan: rand(-0.6, 0.6) });
  }
  s.grains(out, { t: t + 0.02, n: 18, spread: 0.55, skew: 1.8, f: 5000, fJitter: 0.5, q: 2.5, g: 0.2 * I, d: 0.003, panJitter: 0.6 });
}

// ───────────────────────────── UI ─────────────────────────────

export type UiKind = 'tick' | 'click' | 'open' | 'close' | 'error' | 'success';

export function ui(s: Synth, out: AudioNode, kind: UiKind) {
  const t = s.now;
  const L = LEVEL.ui;
  const p = rand(0.96, 1.04); // slight random pitch so repeats don't grate
  switch (kind) {
    case 'tick':
      s.tone(out, { t, f: 1350 * p, d: 0.012, g: 0.35 * L, lp: 3000 });
      break;
    case 'click':
      s.tone(out, { t, f: 880 * p, d: 0.02, g: 0.5 * L });
      s.tone(out, { t, f: 1760 * p, d: 0.012, g: 0.2 * L });
      s.noise(out, { t, d: 0.003, g: 0.15 * L, type: 'bandpass', f: 3000, q: 1 });
      break;
    case 'open':
      s.tone(out, { t, f: 520 * p, f2: 790 * p, glide: 0.07, a: 0.006, d: 0.06, g: 0.45 * L });
      s.tone(out, { t: t + 0.05, f: 1040 * p, a: 0.004, d: 0.05, g: 0.18 * L });
      break;
    case 'close':
      s.tone(out, { t, f: 760 * p, f2: 480 * p, glide: 0.07, a: 0.006, d: 0.06, g: 0.42 * L });
      break;
    case 'error':
      s.tone(out, { t, f: 233, a: 0.005, d: 0.06, g: 0.45 * L, type: 'square', lp: 900 });
      s.tone(out, { t: t + 0.11, f: 196, a: 0.005, d: 0.08, g: 0.45 * L, type: 'square', lp: 800 });
      break;
    case 'success':
      [659, 831, 988].forEach((f, i) => {
        s.tone(out, { t: t + i * 0.075, f, a: 0.004, d: 0.12, g: 0.42 * L });
        s.tone(out, { t: t + i * 0.075, f: f * 2, a: 0.004, d: 0.05, g: 0.08 * L });
      });
      break;
  }
}

export type AdjustKind = 'face' | 'path' | 'aim' | 'stance' | 'club';

/** Soft adjustment ticks. `soft` (0..1) lowers level for rapid repeats. */
export function adjust(s: Synth, out: AudioNode, kind: AdjustKind, soft: number) {
  const t = s.now;
  const g = LEVEL.adjust * soft;
  const p = rand(0.965, 1.035);
  switch (kind) {
    case 'face':
      s.tone(out, { t, f: 1500 * p, d: 0.01, g: 0.5 * g, lp: 3500 });
      s.noise(out, { t, d: 0.003, g: 0.18 * g, type: 'bandpass', f: 3000, q: 2 });
      break;
    case 'path':
      s.tone(out, { t, f: 1120 * p, d: 0.012, g: 0.5 * g, lp: 3000 });
      s.noise(out, { t, d: 0.003, g: 0.15 * g, type: 'bandpass', f: 2400, q: 2 });
      break;
    case 'aim':
      // Woody, lower tick.
      s.tone(out, { t, f: 820 * p, d: 0.014, g: 0.55 * g, type: 'triangle', lp: 2500 });
      break;
    case 'stance':
      // Soft "tuk" of shoes shuffling on turf.
      s.tone(out, { t, f: 420 * p, f2: 330 * p, glide: 0.03, d: 0.018, g: 0.5 * g });
      s.noise(out, { t, a: 0.004, d: 0.03, g: 0.3 * g, type: 'lowpass', f: 1300 });
      break;
    case 'club':
      // Clubs clinking in the bag.
      s.modal(out, { t, f: 1900 * p, ratios: [1, 2.42, 3.71], decays: [0.07, 0.04, 0.025], gains: [1, 0.5, 0.3], g: 0.9 * g });
      s.modal(out, { t: t + rand(0.05, 0.08), f: 2300 * p, ratios: [1, 2.42], decays: [0.04, 0.02], gains: [1, 0.4], g: 0.45 * g });
      break;
  }
}
