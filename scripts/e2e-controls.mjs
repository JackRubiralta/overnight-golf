// End-to-end controls test (Playwright, headless Chromium).
// Simulates the real inputs — keys A/D, Q/E, Z/C, W/S, 1-5, Tab, and a held-left-mouse drag swing —
// and checks that the game state responds and that a shot is actually played.
// Usage: node scripts/e2e-controls.mjs [port]   (expects `npx vite` running on that port)
import { chromium } from './pw.mjs';

const port = process.argv[2] || '5173';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
// Block Vite's HMR socket so edits by other processes don't reload the page mid-test.
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};
const g = () => page.evaluate(() => {
  const s = window.__game;
  return { mode: s.mode, strokes: s.strokes, swing: s.swing, sim: s.simState, report: s.lastReport, ball: s.ball };
});
const tap = async (key, times = 1) => {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(40);
    await page.keyboard.up(key);
    await page.waitForTimeout(40);
  }
};

await page.goto(`http://localhost:${port}/?play=0`);
await page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 240000 });
await page.waitForTimeout(1500);
// Give the canvas focus.
await page.mouse.click(640, 500);
await page.waitForTimeout(300);
let s = await g();
check('starts in golf stance on hole 1', s.mode === 'stance', s.mode);

// Face: D opens, A closes.
await tap('KeyD', 6);
s = await g();
check('D opens the clubface', s.swing.face > 1, `face=${s.swing.face.toFixed(2)}`);
await tap('KeyA', 12);
s = await g();
check('A closes the clubface', s.swing.face < -1, `face=${s.swing.face.toFixed(2)}`);
// Path: Q in-to-out (+), E out-to-in (−).
await tap('KeyQ', 6);
s = await g();
check('Q sets an in-to-out path', s.swing.path > 1, `path=${s.swing.path.toFixed(2)}`);
await tap('KeyE', 12);
s = await g();
check('E sets an out-to-in path', s.swing.path < -1, `path=${s.swing.path.toFixed(2)}`);
// Aim: Z left (−), C right (+).
await tap('KeyZ', 3);
s = await g();
const aimL = s.swing.aim;
await tap('KeyC', 6);
s = await g();
check('Z/C rotate the aim', aimL < 0 && s.swing.aim > aimL, `afterZ=${aimL.toFixed(1)} afterC=${s.swing.aim.toFixed(1)}`);
// Stance: W forward, S back.
await tap('KeyW', 3);
s = await g();
check('W moves the stance forward', s.swing.stance > 0, `stance=${s.swing.stance.toFixed(2)}`);
await tap('KeyS', 6);
s = await g();
check('S moves the stance back', s.swing.stance < 0, `stance=${s.swing.stance.toFixed(2)}`);
// Reset face & path with R.
await tap('KeyR');
s = await g();
check('R squares face & path', Math.abs(s.swing.face) < 0.01 && Math.abs(s.swing.path) < 0.01);
// Square up stance/aim for the test shot.
await tap('KeyW', 3);
await tap('KeyZ', 3);
// Clubs 1-5.
await tap('Digit3');
s = await g();
check('3 selects the iron', s.swing.club === '7I', s.swing.club);
await tap('Digit1');
s = await g();
check('1 selects the driver', s.swing.club === 'D', s.swing.club);
// Tab to walk and back.
await tap('Tab');
s = await g();
check('Tab switches to walking', s.mode === 'walk', s.mode);
await tap('Tab');
s = await g();
check('Tab near the ball returns to stance', s.mode === 'stance', s.mode);

// ── The swing: hold LMB and drag the hands around the arc. ──
// Swing panel convention: mouse up/right = backswing, swiftly down/left = downswing.
const PX = 0.0021; // metres per pixel at sensitivity 1 (SwingController)
const R = 0.62 / PX; // arm radius in pixels
const start = { x: 640, y: 900 };
const centre = { x: start.x, y: start.y - R };
const pos = (deg) => {
  const th = (deg * Math.PI) / 180;
  // Plane: x = sin(th) R, y = -cos(th) R. Screen: dx = -x, dy = +cos... (y down) → screen y = centre.y + cos(th) R.
  return { x: centre.x - Math.sin(th) * R, y: centre.y + Math.cos(th) * R };
};
await page.mouse.move(start.x, start.y);
await page.mouse.down({ button: 'left' });
const back = -115;
const through = 100;
const backSteps = 30;
for (let i = 1; i <= backSteps; i++) {
  const u = i / backSteps;
  const p = pos(back * (1 - Math.cos(u * Math.PI)) / 2);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(28);
}
await page.waitForTimeout(120);
const downSteps = 10;
for (let i = 1; i <= downSteps; i++) {
  const u = i / downSteps;
  const p = pos(back + (through - back) * (u * u * (3 - 2 * u)));
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(150);
await page.mouse.up({ button: 'left' });
// Wait for the shot to start.
let started = false;
for (let i = 0; i < 60 && !started; i++) {
  s = await g();
  started = s.mode === 'flight' || s.strokes > 0;
  if (!started) await page.waitForTimeout(250);
}
check('LMB drag swing hits the ball', started, `mode=${s.mode} strokes=${s.strokes}`);
if (started) {
  await page.screenshot({ path: 'screenshots/_tmp/e2e-flight.png' });
  // Wait for the ball to stop (fast-forward with F held).
  await page.keyboard.down('KeyF');
  for (let i = 0; i < 160; i++) {
    s = await g();
    if (s.report) break;
    await page.waitForTimeout(250);
  }
  await page.keyboard.up('KeyF');
  const r = s.report;
  check('shot produces a shot report', !!r, r ? `${r.club} ${r.clubSpeedMph.toFixed(0)} mph, ${r.quality}, carry ${(r.carry / 0.9144).toFixed(0)} yd, total ${(r.total / 0.9144).toFixed(0)} yd, offline ${(r.offline / 0.9144).toFixed(1)} yd, result ${r.result}` : 'none');
  check('stroke counted', s.strokes >= 1, `strokes=${s.strokes}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'screenshots/_tmp/e2e-after.png' });
}
const uniq = [...new Set(errors)];
check('no console errors', uniq.length === 0, uniq.slice(0, 5).join(' | ').slice(0, 600));
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
