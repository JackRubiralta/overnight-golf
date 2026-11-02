// Usage: node scripts/screenshots.mjs [outDir] [views comma list] [port]
// Starts nothing: expects a dev/preview server at http://localhost:PORT (default 5173).
import { chromium } from './pw.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'screenshots/_tmp';
const views = (process.argv[3] || 'tee,fairway,green,water,wide,grass').split(',');
const port = process.argv[4] || process.env.PORT || '5173';
const extra = process.env.SHOT_QUERY || '';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// Block Vite's HMR socket so edits by other processes don't reload the page mid-test.
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
for (const v of views) {
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?view=${v}${extra}`);
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  } catch { errors.push(`timeout waiting for view ${v}`); }
  await page.waitForTimeout(Number(process.env.SHOT_WAIT || 1500));
  await page.screenshot({ path: `${out}/${v}.png`, timeout: 180000 });
  const stats = await page.evaluate(() => (window.__stats ? window.__stats() : null));
  console.log(v, `${Date.now() - t0}ms`, JSON.stringify(stats));
}
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of [...new Set(errors)]) console.log('  ', e.slice(0, 300)); }
await browser.close();
