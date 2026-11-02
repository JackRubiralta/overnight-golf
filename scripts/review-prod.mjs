// Boot the production build (vite preview) headless and report console errors.
// Usage: node scripts/review-prod.mjs PORT [query=?play=0] [quality=low]
import { chromium } from './pw.mjs';
import fs from 'node:fs';

const port = process.argv[2] || '5304';
const q = process.argv[3] || '?play=0';
const quality = process.argv[4] || 'low';
const out = process.env.REVIEW_OUT || 'screenshots/_wip/review';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.routeWebSocket(/.*/, () => {});
const errors = [];
const warnings = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); else if (m.type() === 'warning') warnings.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('requestfailed', (r) => errors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`));
await page.addInitScript((s) => { try { localStorage.setItem('tl-golf.settings.v1', JSON.stringify({ quality: s })); } catch {} }, quality);
const t0 = Date.now();
await page.goto(`http://localhost:${port}/${q}`);
await page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 400000 });
const f0 = await page.evaluate(() => window.__game.frames);
await page.waitForFunction((t) => window.__game.frames >= t, f0 + 4, { timeout: 400000, polling: 100 });
const s = await page.evaluate(() => ({ mode: window.__game.mode, hole: window.__game.hole, ball: window.__game.ball, stats: window.__game.stats() }));
const d = await page.evaluate(() => window.__game.capture());
fs.writeFileSync(`${out}/prod_${quality}.png`, Buffer.from(d.split(',')[1], 'base64'));
console.log(`prod ${q} (${quality}): ready+4 frames in ${((Date.now() - t0) / 1000).toFixed(1)} s, mode=${s.mode} hole=${s.hole} calls=${s.stats.calls ?? s.stats.render?.calls ?? '?'}`);
console.log(`errors (${errors.length}): ${errors.join(' | ') || 'none'}`);
console.log(`warnings (${warnings.length}): ${warnings.slice(0, 5).join(' | ') || 'none'}`);
console.log(`captured ${out}/prod_${quality}.png`);
await browser.close();
