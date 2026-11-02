/**
 * Manual test bench for the procedural audio and the input system (open /audio-dev.html on the
 * dev server). Buttons for every sound, swing/roll simulators, volume & wind sliders, and a live
 * input monitor (context, held actions, swing/look deltas, gamepad).
 *
 * Also exposes window.__audioBench.analyse(name) for automated checks: it renders a recipe into an
 * OfflineAudioContext and returns peak / RMS / spectral centroid.
 */
import type { SurfaceId } from '../config';
import { ACTIONS } from '../core/actions';
import { Input, type InputContext } from '../core/Input';
import { settings } from '../core/settings';
import type { StrikeQuality } from '../physics/impact';
import { AudioSystem } from './Audio';
import { Crowd } from './crowd';
import * as sfx from './sfx';
import { Synth } from './synth';

const audio = new AudioSystem();
const root = document.getElementById('root')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, children: (Node | string)[] = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}
function section(title: string, ...kids: Node[]) {
  const s = el('section', {}, [el('h2', { textContent: title }), ...kids]);
  root.append(s);
  return s;
}
function row(label: string, buttons: [string, () => void][]) {
  const r = el('div', { className: 'row' }, [el('span', { className: 'label', textContent: label })]);
  for (const [name, fn] of buttons) {
    r.append(
      el('button', {
        textContent: name,
        onclick: () => {
          audio.unlock();
          fn();
        },
      }),
    );
  }
  return r;
}
function slider(label: string, min: number, max: number, step: number, value: number, on: (v: number) => void) {
  const out = el('span', { textContent: String(value) });
  const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  inp.oninput = () => {
    out.textContent = inp.value;
    on(Number(inp.value));
  };
  return el('label', {}, [label, inp, out]);
}

// ───────────── unlock & volumes ─────────────
let wind = 4;
const status = el('span', { textContent: 'locked — click any button' });
section(
  'Audio',
  el('div', { className: 'row' }, [
    el('button', { className: 'big', textContent: 'Unlock audio', onclick: () => audio.unlock() }),
    status,
  ]),
  el('div', { className: 'row' }, [
    slider('Master', 0, 1, 0.01, settings.get('masterVolume'), (v) => settings.set({ masterVolume: v })),
    slider('SFX', 0, 1, 0.01, settings.get('sfxVolume'), (v) => settings.set({ sfxVolume: v })),
    slider('Ambience', 0, 1, 0.01, settings.get('ambienceVolume'), (v) => settings.set({ ambienceVolume: v })),
    slider('Wind m/s', 0, 16, 0.5, wind, (v) => (wind = v)),
  ]),
);

// ───────────── sounds ─────────────
const QUALITIES: StrikeQuality[] = ['pure', 'good', 'toe', 'heel', 'thin', 'fat', 'topped', 'skied', 'whiff'];
const strikeRows = (['driver', 'wood', 'hybrid', 'iron', 'wedge'] as const).map((club) =>
  row(club, QUALITIES.map((q) => [q, () => audio.strike(q, club, club === 'wedge' ? 70 : club === 'iron' ? 85 : 100, club === 'driver' || club === 'wood' ? 'tee' : 'fairway')])),
);
section(
  'Strikes',
  ...strikeRows,
  row('putter', [
    ['pure 3 mph', () => audio.strike('pure', 'putter', 3, 'green')],
    ['pure 7 mph', () => audio.strike('pure', 'putter', 7, 'green')],
    ['toe', () => audio.strike('toe', 'putter', 5, 'green')],
    ['from fringe', () => audio.strike('pure', 'putter', 5, 'fringe')],
  ]),
  row('lies', [
    ['iron pure / rough', () => audio.strike('pure', 'iron', 85, 'rough')],
    ['iron pure / deep rough', () => audio.strike('pure', 'iron', 85, 'deepRough')],
    ['wedge fat / sand (explosion)', () => audio.strike('fat', 'wedge', 70, 'sand')],
    ['wedge pure / sand', () => audio.strike('pure', 'wedge', 70, 'sand')],
    ['wedge thin / sand', () => audio.strike('thin', 'wedge', 70, 'sand')],
    ['driver pure slow 60', () => audio.strike('pure', 'driver', 60, 'tee')],
  ]),
);

const SURFACES: SurfaceId[] = ['green', 'fringe', 'fairway', 'tee', 'rough', 'deepRough', 'sand', 'path', 'dirt', 'water', 'oob'];
let rollTimer = 0;
function rollFor(surface: SurfaceId) {
  cancelAnimationFrame(rollTimer);
  let v = 6;
  const step = () => {
    v -= 0.05;
    if (v <= 0.05) return;
    audio.roll(surface, v);
    rollTimer = requestAnimationFrame(step);
  };
  step();
}
section(
  'Ball',
  row('bounce soft', SURFACES.map((s) => [s, () => audio.bounce(s, 4)] as [string, () => void])),
  row('bounce hard', SURFACES.map((s) => [s, () => audio.bounce(s, 16)] as [string, () => void])),
  row('roll (6→0 m/s)', SURFACES.filter((s) => s !== 'water').map((s) => [s, () => rollFor(s)] as [string, () => void])),
  row('cup / water', [
    ['cup rattle + drop', () => audio.cup()],
    ['splash small', () => audio.splash(0.2)],
    ['splash big', () => audio.splash(1)],
  ]),
);

let swingRaf = 0;
function simulateSwing(peak: number) {
  cancelAnimationFrame(swingRaf);
  const t0 = performance.now();
  const dur = 1.8;
  const step = () => {
    const t = (performance.now() - t0) / 1000;
    let v = 0;
    if (t < 0.9) v = 18 * Math.sin((t / 0.9) * Math.PI); // backswing
    else if (t < 1.35) v = peak * Math.pow((t - 0.9) / 0.45, 2.2); // downswing
    else if (t < dur) v = peak * Math.max(0, 1 - (t - 1.35) / 0.45) ** 1.5; // follow-through
    audio.swingUpdate(v);
    if (Math.abs(t - 1.35) < 0.017) audio.strike('pure', peak > 60 ? 'driver' : 'iron', peak, 'tee');
    if (t < dur + 0.3) swingRaf = requestAnimationFrame(step);
    else audio.swingUpdate(0);
  };
  step();
}
section(
  'Swing, props, crowd',
  row('swing', [
    ['easy 50 mph', () => simulateSwing(50)],
    ['full 95 mph', () => simulateSwing(95)],
    ['max 120 mph', () => simulateSwing(120)],
  ]),
  row('props', [
    ['gong', () => audio.propHit('gong', 20)],
    ['gong soft', () => audio.propHit('gong', 6)],
    ['wood crate', () => audio.propHit('crate', 15)],
    ['tree / bench', () => audio.propHit('tree', 12)],
    ['pot shatter', () => audio.propHit('pot', 15)],
    ['metal target', () => audio.propHit('target', 15)],
    ['flagstick', () => audio.propHit('flagstick', 8)],
  ]),
  row('crowd', [
    ['applause', () => audio.crowd('applause')],
    ['cheer', () => audio.crowd('cheer')],
    ['groan', () => audio.crowd('groan')],
  ]),
  row('ambience', [['bird phrase', () => audio.bird()]]),
);

let tickRaf = 0;
section(
  'UI & adjustments',
  row('ui', (['tick', 'click', 'open', 'close', 'error', 'success'] as const).map((k) => [k, () => audio.ui(k)] as [string, () => void])),
  row('adjust', (['face', 'path', 'aim', 'stance', 'club'] as const).map((k) => [k, () => audio.adjust(k)] as [string, () => void])),
  row('held key', [
    [
      'hold face 1.5 s (90 ms repeat)',
      () => {
        cancelAnimationFrame(tickRaf);
        const t0 = performance.now();
        let last = 0;
        const step = () => {
          const t = performance.now() - t0;
          if (t - last >= 90) {
            last = t;
            audio.adjust('face');
          }
          if (t < 1500) tickRaf = requestAnimationFrame(step);
        };
        step();
      },
    ],
  ]),
);

// ───────────── input monitor ─────────────
const area = el('div', { id: 'capture-area', textContent: 'Click / hold LMB here and drag (stance: swing deltas; walk: look)' });
const monitor = el('div', { id: 'monitor' });
const padInfo = el('div', { id: 'pad' });
const ctxSel = el('select');
for (const c of ['stance', 'walk', 'menu']) ctxSel.append(el('option', { value: c, textContent: c }));
const capOut = el('span', { textContent: '' });
const input = new Input(area);
input.setContext('stance');
ctxSel.onchange = () => input.setContext(ctxSel.value as InputContext);
section(
  'Input monitor',
  el('div', { className: 'row' }, [
    el('label', {}, ['Context', ctxSel]),
    el('button', { textContent: 'Capture next key/mouse', onclick: () => input.captureNext('kbm', (c) => (capOut.textContent = `captured: ${c}`)) }),
    el('button', { textContent: 'Capture next pad button', onclick: () => input.captureNext('pad', (c) => (capOut.textContent = `captured pad: ${c}`)) }),
    el('button', { textContent: 'Rumble', onclick: () => input.vibrate(0.8, 200) }),
    capOut,
  ]),
  area,
  el('div', { className: 'grid2' }, [monitor, padInfo]),
);

const swingSum = { dx: 0, dy: 0 };
const lookSum = { dx: 0, dy: 0 };
const recent: string[] = [];
let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  input.update();
  audio.update(dt, wind);
  const sd = input.consumeSwingDelta();
  const ld = input.consumeLookDelta();
  swingSum.dx += sd.dx;
  swingSum.dy += sd.dy;
  lookSum.dx += ld.dx;
  lookSum.dy += ld.dy;
  const held = ACTIONS.filter((a) => input.held(a));
  for (const a of ACTIONS) if (input.pressed(a)) recent.unshift(`+${a}`);
  for (const a of ACTIONS) if (input.released(a)) recent.unshift(`-${a}`);
  recent.length = Math.min(recent.length, 12);
  monitor.textContent =
    `context: ${input.context}   pointerLocked: ${input.pointerLocked}   lastDevice: ${input.lastDevice}\n` +
    `held: ${held.join(', ') || '—'}\n` +
    `swing Σ: ${swingSum.dx.toFixed(0)}, ${swingSum.dy.toFixed(0)} px   look Σ: ${lookSum.dx.toFixed(0)}, ${lookSum.dy.toFixed(0)} px\n` +
    `recent: ${recent.join(' ')}`;
  padInfo.textContent =
    `pad: ${input.padId ?? 'none'}\n` +
    `move: ${input.padMove.x.toFixed(2)}, ${input.padMove.y.toFixed(2)}   look: ${input.padLook.x.toFixed(2)}, ${input.padLook.y.toFixed(2)}\n` +
    `hands: ${input.padHands ? `${input.padHands.x.toFixed(2)}, ${input.padHands.y.toFixed(2)}` : '—'}`;
  status.textContent = audio.ctx ? `${audio.ctx.state} · ${audio.ctx.sampleRate} Hz · voices ${audio.voices}` : 'locked — click any button';
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ───────────── automated analysis (OfflineAudioContext) ─────────────
type Recipe = (s: Synth, out: AudioNode) => void;
const RECIPES: Record<string, Recipe> = {};
for (const club of ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter']) {
  for (const q of QUALITIES) RECIPES[`strike:${club}:${q}`] = (s, o) => sfx.strike(s, o, q, club, club === 'putter' ? 5 : 95, club === 'driver' ? 'tee' : club === 'putter' ? 'green' : 'fairway');
}
RECIPES['strike:wedge:fat:sand'] = (s, o) => sfx.strike(s, o, 'fat', 'wedge', 70, 'sand');
for (const surf of SURFACES) RECIPES[`bounce:${surf}`] = (s, o) => sfx.bounce(s, o, surf, 10);
RECIPES.cup = (s, o) => sfx.cup(s, o);
RECIPES.splash = (s, o) => sfx.splash(s, o, 1);
RECIPES.swish = (s, o) => sfx.swish(s, o, 100);
for (const k of ['gong', 'crate', 'pot', 'target', 'flagstick', 'tree']) RECIPES[`prop:${k}`] = (s, o) => sfx.propHit(s, o, o, k, 15);
for (const k of ['tick', 'click', 'open', 'close', 'error', 'success'] as const) RECIPES[`ui:${k}`] = (s, o) => sfx.ui(s, o, k);
for (const k of ['face', 'path', 'aim', 'stance', 'club'] as const) RECIPES[`adjust:${k}`] = (s, o) => sfx.adjust(s, o, k, 1);
for (const k of ['applause', 'cheer', 'groan'] as const) RECIPES[`crowd:${k}`] = (s, o) => new Crowd(s, o).play(k);

async function analyse(name: string, seconds = 1.5) {
  const fn = RECIPES[name];
  if (!fn) throw new Error(`unknown recipe ${name}`);
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.floor(sr * seconds), sr);
  const s = new Synth(ctx as unknown as AudioContext);
  fn(s, ctx.destination);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let lastAbove = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    sum += d[i] * d[i];
    if (a > 0.003) lastAbove = i;
  }
  // Spectral centroid of the first 4096 samples after onset (naive DFT on 128 bins).
  let onset = 0;
  while (onset < d.length && Math.abs(d[onset]) < peak * 0.05) onset++;
  const N = 2048;
  let num = 0;
  let den = 0;
  for (let k = 1; k < 256; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N && onset + n < d.length; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N);
      const x = d[onset + n] * w;
      const ph = (2 * Math.PI * k * 4 * n) / N; // bins every 4·sr/N ≈ 86 Hz
      re += x * Math.cos(ph);
      im -= x * Math.sin(ph);
    }
    const mag = Math.hypot(re, im);
    num += mag * ((k * 4 * sr) / N);
    den += mag;
  }
  return { name, peak: +peak.toFixed(3), rmsDb: +(10 * Math.log10(sum / d.length + 1e-12)).toFixed(1), tail: +(lastAbove / sr).toFixed(2), centroid: Math.round(num / (den || 1)) };
}

(window as any).__audioBench = { audio, input, analyse, recipes: Object.keys(RECIPES) };
