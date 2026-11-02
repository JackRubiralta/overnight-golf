// Play-test helper: checks that __game.debugPredict() matches what the live game does for the
// same synthetic stroke (chip + putt), and captures the address view on the bank after a water
// drop (camera framing on slopes). Usage: node scripts/playtest-compare.mjs [port]
import { chromium } from './pw.mjs';
import fs from 'node:fs';

const port = process.argv[2] || '5173';
const OUT = 'screenshots/_wip/play';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};
const frames = async (n = 2) => {
  const f0 = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, f0 + n, { timeout: 900000, polling: 50 });
};
const capture = async (name) => {
  const d = await page.evaluate(() => window.__game.capture());
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(d.split(',')[1], 'base64'));
  console.log(`      captured ${OUT}/${name}.png`);
};
const settle = async () => {
  for (let i = 0; i < 2000; i += 2) {
    if (await page.evaluate(() => window.__game.mode !== 'flight')) return;
    await frames(2);
  }
};
const shoot = async (label, o) => {
  const pred = await page.evaluate((o) => window.__game.debugPredict(o), o);
  const before = await page.evaluate(() => ({ ...window.__game.ball, d: window.__game.distToPin }));
  await page.evaluate((o) => window.__game.debugShot(o), o);
  await page.keyboard.down('KeyF');
  await settle();
  await page.keyboard.up('KeyF');
  const after = await page.evaluate(() => ({ ...window.__game.ball, d: window.__game.distToPin, r: window.__game.lastReport }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  const predMoved = Math.hypot(pred.end.x - before.x, pred.end.z - before.z);
  const gap = Math.hypot(after.x - pred.end.x, after.z - pred.end.z);
  check(`${label}: prediction matches the live game`, after.r?.result === 'holed' || gap < Math.max(0.5, 0.05 * predMoved), `predicted ${predMoved.toFixed(2)} m (${pred.state}), live ${moved.toFixed(2)} m (${after.r?.result}), gap ${gap.toFixed(2)} m`);
};

await page.goto(`http://localhost:${port}/?play=0&q=low`);
await page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 300000 });
await page.evaluate(() => { window.__game.timeScale = 3; });
await frames(3);

// Chip from 12 m short of hole 1's pin, then a putt.
const p = await page.evaluate(() => window.__game.debugPlace(-25.2, -216));
console.log('placed', JSON.stringify(p));
await frames(3);
await capture('cmp-chip-addr');
await shoot('SW chip 20 mph', { club: 3, clubSpeed: 20 });
await frames(3);
await page.evaluate(() => window.__game.goToBall());
await shoot('putt 4 mph', { club: 4, clubSpeed: 4 });

// Steepest "camera behind is uphill" spot around hole 3's pond → address framing on a bank.
await page.evaluate(() => window.__game.start(2));
await frames(2);
const bank = await page.evaluate(() => {
  const g = window.__game;
  const pin = g.pin;
  let best = null;
  for (let x = -500; x <= -420; x += 4)
    for (let z = -500; z <= -430; z += 4) {
      const a = g.debugPlace(x, z);
      if (a.lie === 'water' || a.lie === 'sand') continue;
      const dx = pin.x - x, dz = pin.z - z, L = Math.hypot(dx, dz);
      const b = g.debugPlace(x - (dx / L) * 4.6, z - (dz / L) * 4.6);
      const rise = b.y - a.y;
      if (!best || rise > best.rise) best = { x, z, rise, lie: a.lie };
    }
  g.debugPlace(best.x, best.z);
  return best;
});
console.log('bank spot', JSON.stringify(bank));
await frames(12);
const bc = await page.evaluate(() => ({ cam: window.__game.cam, ball: window.__game.ball }));
console.log('bank cam', (bc.cam.y - bc.ball.y).toFixed(2), 'm above ball, pitch', (Math.asin(bc.cam.dir.y) * 57.3).toFixed(1));
await capture('cmp-bank-addr');

// Water drop on hole 3 → address on the bank.
await page.evaluate(() => window.__game.start(2));
await frames(3);
await page.evaluate(() => { window.__game.timeScale = 3; });
await shoot('hole 3 water shot', { club: 3, clubSpeed: 50, aim: 6 });
await frames(8);
const s = await page.evaluate(() => ({ mode: window.__game.mode, lie: window.__game.lie, cam: window.__game.cam, ball: window.__game.ball }));
console.log('after water:', JSON.stringify(s));
await capture('cmp-after-water');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
