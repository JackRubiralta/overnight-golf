// Screenshots of the UI dev page (ui-dev.html) in several states.
// Usage: node scripts/ui-shots.mjs [outDir] [states comma list] [port]
//   states: hud,walk,loading,title,pause,settings,controls,practice,scorecard,final,big
//   Append @t=<sec> to freeze the scripted swing, @tab=<id> for a settings tab, @w=<px>x<px> for a viewport,
//   @dpr=2 for a hi-dpi shot, @clip=swing|club|shot|tl|tr|modal to capture one element,
//   e.g. hud@t=2.1, settings@tab=controls, hud@w=1920x1080, hud@t=2.1@dpr=2@clip=swing
import { chromium } from './pw.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'screenshots/_wip/ui';
const states = (process.argv[3] || 'hud,title,scorecard').split(',');
const port = process.argv[4] || '5208';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const spec of states) {
  const [state, ...opts] = spec.split('@');
  let vw = 1280, vh = 720, dpr = 1, clip = '';
  const qs = new URLSearchParams({ state });
  for (const o of opts) {
    const [k, v] = o.split('=');
    if (k === 'w') [vw, vh] = v.split('x').map(Number);
    else if (k === 'dpr') dpr = Number(v);
    else if (k === 'clip') clip = v; // swing | club | shot | tl | tr
    else qs.set(k, v);
  }
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${spec}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${spec}: ${e}`));
  await page.goto(`http://localhost:${port}/ui-dev.html?${qs}`);
  await page.waitForFunction(() => window.__uiReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.SHOT_WAIT || 900));
  const name = spec.replace(/[@=]/g, '_');
  const sel = { swing: '.tl-swing', club: '.tl-club', shot: '.tl-shot', tl: '.tl-tl', tr: '.tl-tr', modal: '.tl-modal' }[clip];
  if (sel) await page.locator(sel).first().screenshot({ path: `${out}/${name}.png` });
  else await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
  await page.close();
}
if (errors.length) { console.log('CONSOLE ERRORS:'); for (const e of [...new Set(errors)]) console.log('  ', e.slice(0, 300)); }
await browser.close();
