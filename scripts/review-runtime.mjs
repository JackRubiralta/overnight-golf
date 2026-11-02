// Adversarial runtime review: reproduces suspected bugs in the running game (dev server).
// Usage: node scripts/review-runtime.mjs PORT [parts=settings,gamepad,switch,lock,flightpause,restart]
// Every part prints REPRO (bug reproduced) / OK (behaves) lines; captures go to OUT.
import { chromium } from './pw.mjs';
import fs from 'node:fs';

const port = process.argv[2] || '5304';
const parts = (process.argv[3] || 'settings,gamepad,switch,lock,flightpause,restart').split(',');
const OUT = process.env.REVIEW_OUT || 'screenshots/_wip/review';
fs.mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${port}`;
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'];
const browser = await chromium.launch({ args: ARGS });
const log = (...a) => console.log(...a);

async function newPage({ settings = { quality: 'low' }, init = null, w = 640, h = 360 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/.*/, () => {});
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.addInitScript((s) => { try { localStorage.setItem('tl-golf.settings.v1', JSON.stringify(s)); } catch {} }, settings);
  if (init) await page.addInitScript(init);
  const frames = async (n = 2) => {
    const f0 = await page.evaluate(() => window.__game.frames);
    await page.waitForFunction((t) => window.__game.frames >= t, f0 + n, { timeout: 600000, polling: 50 });
  };
  const tap = async (key) => { await page.keyboard.down(key); await frames(1); await page.keyboard.up(key); await frames(2); };
  const until = async (pred, arg, maxFrames = 3000, step = 2) => {
    for (let i = 0; i < maxFrames; i += step) { if (await page.evaluate(pred, arg)) return true; await frames(step); }
    return false;
  };
  const capture = async (name) => {
    const d = await page.evaluate(() => window.__game.capture());
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(d.split(',')[1], 'base64'));
    log(`   captured ${OUT}/${name}.png`);
  };
  const boot = async (q = '?play=0') => {
    await page.goto(`${BASE}/${q}`);
    await page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 400000 });
    await frames(2);
  };
  return { ctx, page, errors, frames, tap, until, capture, boot };
}

// ── 1. invalid persisted settings brick the boot ──────────────────────────────────────────
if (parts.includes('settings')) {
  for (const bad of [{ quality: 'epic' }, { weather: 'storm' }, { timeOfDay: 'night' }]) {
    const P = await newPage({ settings: bad });
    await P.page.goto(`${BASE}/?play=0`);
    const ok = await P.page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 }).then(() => true, () => false);
    log(`${ok ? 'OK   ' : 'REPRO'} settings ${JSON.stringify(bad)} → ready=${ok}; errors: ${P.errors.slice(0, 2).join(' | ') || 'none'}`);
    await P.ctx.close();
  }
}

// ── 2. getGamepads() throwing (permissions policy / iframe) ────────────────────────────────
if (parts.includes('gamepad')) {
  const P = await newPage({
    init: () => {
      Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value() { throw new DOMException('Use of the Gamepad API is disallowed by permissions policy', 'SecurityError'); } });
    },
  });
  await P.page.goto(`${BASE}/`);
  await P.page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 400000 });
  await P.frames(6);
  const n = P.errors.length;
  log(`${n ? 'REPRO' : 'OK   '} getGamepads throws on the title screen → ${n} page errors after 6 frames; first: ${P.errors[0] ?? 'none'}`);
  await P.ctx.close();
}

// ── 3. runtime quality / time-of-day / weather / resize switches ──────────────────────────
if (parts.includes('switch')) {
  const P = await newPage();
  await P.boot('?play=0');
  const S = async (patch) => P.page.evaluate(async (p) => { const m = await import('/src/core/settings.ts'); m.settings.set(p); }, patch);
  const camOk = () => P.page.evaluate(() => { const c = window.__game.cam; return [c.x, c.y, c.z, c.dir.x, c.dir.y, c.dir.z].every(Number.isFinite); });
  const steps = [
    ['q-medium', { quality: 'medium' }], ['q-ultra', { quality: 'ultra' }], ['q-low', { quality: 'low' }], ['q-high', { quality: 'high' }],
    ['tod-dawn', { timeOfDay: 'dawn' }], ['tod-noon', { timeOfDay: 'noon' }], ['tod-dusk', { timeOfDay: 'dusk' }],
    ['weather-rain', { weather: 'rain' }], ['weather-calm', { weather: 'calm' }],
    ['scale-0.5', { renderScale: 0.5 }], ['fov-80', { fov: 80 }], ['q-low-final', { quality: 'low', renderScale: 1, fov: 55, timeOfDay: 'golden' }],
  ];
  for (const [name, patch] of steps) {
    const e0 = P.errors.length;
    await S(patch);
    await P.frames(2);
    const ok = await camOk();
    log(`${P.errors.length > e0 || !ok ? 'REPRO' : 'OK   '} switch ${name}: errors +${P.errors.length - e0} cam finite=${ok} ${P.errors.slice(e0, e0 + 2).join(' | ')}`);
    if (['q-ultra', 'tod-dusk', 'weather-rain', 'q-low-final'].includes(name)) await P.capture(`switch_${name}`);
  }
  for (const [w, h] of [[400, 700], [1, 1], [900, 500]]) {
    const e0 = P.errors.length;
    await P.page.setViewportSize({ width: w, height: h });
    await P.frames(2);
    log(`${P.errors.length > e0 ? 'REPRO' : 'OK   '} resize ${w}x${h}: errors +${P.errors.length - e0} ${P.errors.slice(e0, e0 + 2).join(' | ')}`);
  }
  await P.capture('switch_resized');
  await P.ctx.close();
}

// ── 4. pointer lock kept after holing out; Space does not continue after a holed shot ──────
if (parts.includes('lock')) {
  const P = await newPage({ init: () => Object.defineProperty(Navigator.prototype, 'webdriver', { configurable: true, get: () => false }) });
  await P.boot('?play=0');
  const pl = () => P.page.evaluate(() => !!document.pointerLockElement);
  // Control: a normal shot. Grab the mouse in flight (as the swing does), then check after settle.
  await P.page.evaluate(() => { const p = window.__game.pin; window.__game.debugPlace(p.x + 6, p.z + 2); window.__game.timeScale = 4; });
  await P.frames(2);
  let r = await P.page.evaluate(() => window.__game.debugShot({ club: 'P', distance: 3, autoAim: true }));
  await P.page.mouse.click(320, 180);
  await P.frames(2);
  const lockedInFlight = await pl();
  await P.until(() => window.__game.mode !== 'flight');
  log(`     control shot: lock in flight=${lockedInFlight}, after settle mode=${await P.page.evaluate(() => window.__game.mode)} lock=${await pl()}`);
  // Holed putt.
  await P.page.evaluate(() => { const p = window.__game.pin; window.__game.debugPlace(p.x + 1.2, p.z + 0.4); });
  await P.frames(2);
  r = await P.page.evaluate(() => window.__game.debugShot({ club: 'P', distance: Math.hypot(1.2, 0.4) + 0.4, autoAim: true }));
  await P.page.mouse.click(320, 180);
  await P.frames(2);
  log(`     putt: ${JSON.stringify(r)} lock in flight=${await pl()}`);
  const holed = await P.until(() => window.__game.mode === 'holed');
  await P.until(() => !!document.querySelector('.tl-scorecard, .tl-card, [class*=score]') && window.__game.mode === 'holed', null, 200);
  await P.frames(20);
  const s = await P.page.evaluate(() => ({ mode: window.__game.mode, lock: !!document.pointerLockElement, nextBtn: [...document.querySelectorAll('button')].filter((b) => /next/i.test(b.textContent)).map((b) => b.textContent.trim()) }));
  log(`${s.lock ? 'REPRO' : 'OK   '} holed=${holed}: mode=${s.mode}, pointer still locked while the scorecard shows its buttons=${s.lock} (buttons: ${JSON.stringify(s.nextBtn)})`);
  await P.capture('lock_holed_scorecard');
  // Space (retake key) is the documented-in-code way to continue from 'holed' (Game.updateHoled).
  await P.tap('Space');
  await P.frames(3);
  const afterSpace = await P.page.evaluate(() => ({ mode: window.__game.mode, hole: window.__game.hole }));
  log(`${afterSpace.mode === 'holed' ? 'REPRO' : 'OK   '} Space in 'holed' after a holed putt → mode=${afterSpace.mode} hole=${afterSpace.hole} (Tab works; Space is STANCE_ONLY and the context is 'walk')`);
  // Clicking the scorecard backdrop (not a button) re-captures the pointer in walk context.
  await P.page.evaluate(() => document.exitPointerLock());
  await P.frames(2);
  await P.page.mouse.click(8, 8);
  await P.frames(2);
  log(`     click on overlay backdrop while holed → lock=${await pl()}`);
  await P.tap('Tab');
  await P.frames(3);
  log(`     Tab → mode=${await P.page.evaluate(() => window.__game.mode)} hole=${await P.page.evaluate(() => window.__game.hole)}; errors: ${P.errors.join(' | ') || 'none'}`);
  await P.ctx.close();
}

// ── 5. pause + resume during flight leaves the input in 'stance' context ──────────────────
if (parts.includes('flightpause')) {
  const P = await newPage();
  await P.boot('?play=0');
  const flightFace = async (pause) => {
    await P.page.evaluate(() => { window.__game.timeScale = 0.2; });
    const r = await P.page.evaluate(() => window.__game.debugShot({ club: 'D', clubSpeed: 100 }));
    await P.frames(2);
    if (pause) { await P.tap('Escape'); await P.tap('Escape'); }
    const f0 = await P.page.evaluate(() => ({ face: window.__game.swing.face, mode: window.__game.mode }));
    await P.page.keyboard.down('KeyD');
    await P.frames(6);
    await P.page.keyboard.up('KeyD');
    const f1 = await P.page.evaluate(() => ({ face: window.__game.swing.face, mode: window.__game.mode }));
    await P.page.evaluate(() => { window.__game.timeScale = 8; });
    await P.until(() => window.__game.mode !== 'flight');
    return { ok: r.ok, f0, f1 };
  };
  const a = await flightFace(false);
  log(`     no pause: holding D in flight: face ${a.f0.face.toFixed(2)} → ${a.f1.face.toFixed(2)} (mode ${a.f1.mode})`);
  await P.page.evaluate(() => window.__game.debugPlace(window.__game.ball.x, window.__game.ball.z));
  await P.frames(2);
  const b = await flightFace(true);
  log(`${b.f1.face !== b.f0.face ? 'REPRO' : 'OK   '} after Esc,Esc in flight: holding D (strafe/look key) changed the clubface ${b.f0.face.toFixed(2)} → ${b.f1.face.toFixed(2)} (mode ${b.f1.mode}) — input context is 'stance' in flight`);
  log(`     errors: ${P.errors.join(' | ') || 'none'}`);
  await P.ctx.close();
}

// ── 6. restart a hole after the round is finished ─────────────────────────────────────────
if (parts.includes('restart')) {
  const P = await newPage();
  await P.boot('?play=0');
  await P.page.evaluate(() => { window.__game.timeScale = 8; });
  for (let hole = 0; hole < 9; hole++) {
    await P.page.evaluate(() => { for (let i = 0; i < 15; i++) window.__game.debugShot({ whiff: true }); });
    await P.frames(10);
    if (hole < 8) await P.tap('Tab'); // Tab on the last hole would end the round (toTitle)
    await P.frames(2);
  }
  let s = await P.page.evaluate(() => ({ mode: window.__game.mode, round: window.__game.round }));
  log(`     after 9 picked-up holes: mode=${s.mode} finished=${s.round.finished} total=${s.round.totalStrokes} splits=${s.round.splits.length}`);
  // Esc → pause → "Restart hole"
  await P.tap('Escape');
  await P.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /Restart hole/.test(b.textContent)).click());
  await P.frames(3);
  const t0 = await P.page.evaluate(() => window.__game.round.timer);
  await P.page.evaluate(() => window.__game.debugShot({ whiff: true }));
  await P.frames(20);
  s = await P.page.evaluate(() => ({ mode: window.__game.mode, hole: window.__game.hole, strokes: window.__game.strokes, round: window.__game.round }));
  const holeStrokes = s.round.holes[s.hole].strokes;
  log(`${s.round.finished && holeStrokes === null ? 'REPRO' : 'OK   '} restarted hole ${s.hole + 1}: mode=${s.mode} strokes=${s.strokes} hole.strokes=${holeStrokes} round.finished=${s.round.finished} timer ${t0.toFixed(2)} → ${s.round.timer.toFixed(2)} (frozen=${s.round.timer === t0})`);
  await P.page.evaluate(() => { for (let i = 0; i < 15; i++) window.__game.debugShot({ whiff: true }); });
  await P.frames(10);
  s = await P.page.evaluate(() => ({ mode: window.__game.mode, round: window.__game.round }));
  log(`     re-finished: splits=${s.round.splits.length} (9 holes) total=${s.round.totalStrokes}; errors: ${P.errors.join(' | ') || 'none'}`);
  await P.ctx.close();
}

await browser.close();
