// Resolve Playwright: prefer a local install, fall back to the globally pre-installed one.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  for (const p of ['/opt/node-tools/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright']) {
    try { pw = require(p); break; } catch { /* next */ }
  }
}
if (!pw) throw new Error('Playwright not found. Install it with `npm i -D playwright && npx playwright install chromium`.');
export const chromium = pw.chromium;
