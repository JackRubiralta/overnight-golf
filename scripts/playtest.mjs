// Automated play-test: plays whole holes through the real game pipeline using the
// `__game.debugShot()` hook (synthetic deliveries → onImpact → flight → settle → rules),
// presses the real keys for the flow (F, Tab, X, Space, Escape), logs every mode transition,
// stroke, lie and shot report, checks the camera, and captures frames to screenshots/_wip/play/.
//
// Usage: node scripts/playtest.mjs [port] [holes=0,2] [q=low]
//   (expects a Vite dev server on that port; hole indices are 0-based)
import { chromium } from './pw.mjs';
import fs from 'node:fs';

const port = process.argv[2] || '5173';
const holes = (process.argv[3] || '0,2').split(',').map(Number);
const quality = process.argv[4] || 'low';
const OUT = 'screenshots/_wip/play';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};
const log = (...a) => console.log('     ', ...a);
const fmt = (v, n = 1) => (typeof v === 'number' ? v.toFixed(n) : String(v));

const st = () => page.evaluate(() => {
  const g = window.__game;
  return { mode: g.mode, hole: g.hole, strokes: g.strokes, ball: g.ball, lie: g.lie, dist: g.distToPin, sim: g.simState, club: g.club, cam: g.cam, player: g.player, hint: g.hint, report: g.lastReport, frames: g.frames };
});
const frames = async (n = 2) => {
  const f0 = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, f0 + n, { timeout: 900000, polling: 50 });
};
const until = async (pred, arg, maxFrames = 4000, step = 3) => {
  for (let i = 0; i < maxFrames; i += step) {
    if (await page.evaluate(pred, arg)) return true;
    await frames(step);
  }
  return false;
};
const tap = async (key) => {
  await page.keyboard.down(key);
  await frames(1);
  await page.keyboard.up(key);
  await frames(2);
};
const capture = async (name) => {
  const d = await page.evaluate(() => window.__game.capture());
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(d.split(',')[1], 'base64'));
  log(`captured ${OUT}/${name}.png`);
};
const camCheck = (label, s, ref, { minUp = 0.8, maxUp = 7, maxDist = 18 } = {}) => {
  const up = s.cam.y - s.cam.ground;
  const above = s.cam.y - ref.y;
  const d = Math.hypot(s.cam.x - ref.x, s.cam.z - ref.z);
  check(`${label}: camera low & near the ball`, up >= minUp && up <= maxUp && d <= maxDist, `cam ${fmt(up)} m above ground, ${fmt(above)} m above ball, ${fmt(d)} m away, pitch ${fmt(Math.asin(s.cam.dir.y) * 57.3, 0)}°`);
};

// Record every mode transition (sampled each rendered frame).
const installRecorder = () => page.evaluate(() => {
  window.__trans = [];
  let last = '';
  const tick = () => {
    const g = window.__game;
    if (g && g.mode !== last) {
      window.__trans.push(`${last || '∅'}→${g.mode}@f${g.frames}`);
      last = g.mode;
    }
    requestAnimationFrame(tick);
  };
  tick();
});
const drainTransitions = () => page.evaluate(() => window.__trans.splice(0).join('  '));

/** Choose a club & target distance for the current lie (a sensible "caddie"). */
const plan = (s, suggested) => {
  const d = s.dist;
  if (s.lie === 'green' || (s.lie === 'fringe' && d < 15)) return { club: 4, distance: d + 0.35, autoAim: true };
  if (d < 90) return { club: 3, distance: d, autoAim: true };
  if (d < 145) return { club: 2, distance: d, autoAim: true };
  if (d < 185) return { club: 1, distance: d, autoAim: true };
  return { club: s.lie === 'tee' ? 0 : 1, distance: Math.min(d, s.lie === 'tee' ? 245 : 190), autoAim: true, suggested };
};

/** Play one stroke and wait until the ball has settled; returns the report. */
let shotNo = 0;
const playStroke = async (opts, { fast = true, shots = {} } = {}) => {
  const before = await st();
  const r = await page.evaluate((o) => window.__game.debugShot(o), opts);
  if (!r.ok) {
    check('debugShot accepted', false, `mode=${r.mode}`);
    return null;
  }
  shotNo++;
  log(`stroke ${before.strokes + 1}: ${r.club} ${fmt(r.clubSpeed)} mph aim ${fmt(r.aim)}° from ${before.lie} ${fmt(before.dist)} m to pin`);
  if (fast) await page.keyboard.down('KeyF');
  let midDone = !shots.mid;
  let settleCaptured = false;
  let restCam = null;
  for (let i = 0; i < 3000; i += 2) {
    const s = await page.evaluate(() => ({ mode: window.__game.mode, sim: window.__game.simState, t: window.__game.frames }));
    if (!midDone && s.mode === 'flight' && s.sim === 'flight') {
      await frames(shots.midFrames ?? 25);
      await capture(shots.mid);
      const m = await st();
      log(`mid-flight cam ${fmt(m.cam.y - m.cam.ground)} m above ground (mode ${m.cam.mode})`);
      midDone = true;
      continue;
    }
    if (s.mode === 'flight' && s.sim !== 'flight' && s.sim !== 'rolling' && !settleCaptured) {
      // Ball at rest; let the settle camera move for a while (it holds ~1.6 s game time).
      await frames(fast ? 2 : 18);
      const m = await st();
      restCam = m;
      if (shots.settle) await capture(shots.settle);
      settleCaptured = true;
    }
    if (s.mode !== 'flight') break;
    await frames(2);
  }
  if (fast) await page.keyboard.up('KeyF');
  await frames(3);
  const after = await st();
  const rep = after.report;
  if (rep) log(`→ ${rep.quality} ${fmt(rep.clubSpeedMph)} mph, launch ${fmt(rep.launchV)}°, spin ${fmt(rep.spinRpm, 0)}, carry ${fmt(rep.carry)} m, total ${fmt(rep.total)} m, offline ${fmt(rep.offline)} m, apex ${fmt(rep.apex)} m, result ${rep.result}`);
  log(`   now: mode ${after.mode}, strokes ${after.strokes}, lie ${after.lie}, ${fmt(after.dist)} m to pin; transitions: ${await drainTransitions()}`);
  return { before, after, rep, restCam, r };
};

const waitStanceOrWalk = () => until(() => ['stance', 'walk', 'holed'].includes(window.__game.mode), null, 3000);

await page.goto(`http://localhost:${port}/?play=${holes[0]}&q=${quality}`);
await page.waitForFunction(() => window.__ready === true && window.__game, null, { timeout: 300000 });
await frames(3);
await installRecorder();
console.log('fps', await page.evaluate(() => window.__game.fps.toFixed(1)));

for (const [hi, hole] of holes.entries()) {
  let s = await st();
  if (s.hole !== hole || hi > 0 && s.mode !== 'stance') {
    await page.evaluate((h) => window.__game.start(h), hole);
    await frames(4);
    s = await st();
  }
  console.log(`\n=== Hole ${hole + 1}: ${fmt(s.dist)} m, mode ${s.mode}, lie ${s.lie}, suggested club ${s.club.id} ===`);
  check(`hole ${hole + 1} starts in stance on the tee`, s.mode === 'stance' && s.lie === 'tee', `${s.mode} ${s.lie}`);
  check(`hole ${hole + 1} tee club suggestion`, s.dist > 200 ? s.club.id === 'D' : s.club.id !== 'P' && s.club.id !== 'D', `${s.club.id} for ${fmt(s.dist)} m`);
  await frames(20);
  await capture(`h${hole + 1}-tee`);
  camCheck(`hole ${hole + 1} tee address`, await st(), s.ball, { maxUp: 3, maxDist: 6 });

  // ── Flow checks on the first hole ──
  if (hi === 0) {
    // Pause / resume
    await tap('Escape');
    s = await st();
    check('Escape pauses', s.mode === 'paused', s.mode);
    await frames(10);
    await tap('Escape');
    s = await st();
    check('Escape resumes to stance', s.mode === 'stance', s.mode);
    // Practice swing does not count
    await tap('KeyX');
    let r = await page.evaluate(() => window.__game.debugShot({ clubSpeed: 100 }));
    await frames(4);
    s = await st();
    check('practice swing (X) does not count', s.strokes === 0 && s.mode === 'stance', `strokes=${s.strokes} mode=${s.mode} ${JSON.stringify(r).slice(0, 80)}`);
    await tap('KeyX');
    // Retake with nothing to retake
    await tap('Space');
    s = await st();
    check('Space with no shot yet does nothing', s.strokes === 0, `strokes=${s.strokes}`);
  }

  const tee = await st();
  // Water hole: deliberately find a shot that finds the water first.
  if (hi > 0) {
    const w = await page.evaluate(() => {
      const g = window.__game;
      for (const club of [3, 2])
        for (let mph = 40; mph <= 110; mph += 2)
          for (const aim of [0, -3, 3, -6, 6]) {
            const p = g.debugPredict({ club, clubSpeed: mph, aim });
            if (p.state === 'water') return { club, clubSpeed: mph, aim };
          }
      return null;
    });
    check(`hole ${hole + 1}: found a shot into the water`, !!w, JSON.stringify(w));
    if (w) {
      const res = await playStroke(w, { fast: false, shots: { mid: `h${hole + 1}-water-flight`, midFrames: 15 } });
      const rep = res.after.report;
      check('water: result water, +1 penalty (2 strokes)', rep?.result === 'water' && res.after.strokes === 2, `result=${rep?.result} strokes=${res.after.strokes}`);
      check('water: dropped on dry land', res.after.lie !== 'water', `lie=${res.after.lie}`);
      const dropToTee = Math.hypot(res.after.ball.x - tee.ball.x, res.after.ball.z - tee.ball.z);
      log(`drop ${fmt(dropToTee)} m from the tee, lie ${res.after.lie}`);
      await frames(6);
      await capture(`h${hole + 1}-after-water`);
      // Retake (Space): back to the previous spot, +1.
      const s0 = await st();
      if (s0.mode !== 'stance') await page.evaluate(() => window.__game.goToBall());
      await frames(3);
      const s1 = await st();
      await tap('Space');
      const s2 = await st();
      check('Space retake: back to the previous spot, +1', s2.strokes === s1.strokes + 1 && Math.hypot(s2.ball.x - tee.ball.x, s2.ball.z - tee.ball.z) < 0.5, `strokes ${s1.strokes}→${s2.strokes}, ${fmt(Math.hypot(s2.ball.x - tee.ball.x, s2.ball.z - tee.ball.z))} m from tee, lie ${s2.lie}`);
    }
    // OOB: look for a shot that goes out of bounds.
    const o = await page.evaluate(() => {
      const g = window.__game;
      for (const aim of [60, -60, 75, -75, 90, -90, 45, -45, 110, -110])
        for (const mph of [110, 95, 80])
          for (const club of [0, 1]) {
            const p = g.debugPredict({ club, clubSpeed: mph, aim });
            if (p.state === 'oob') return { club, clubSpeed: mph, aim };
          }
      return null;
    });
    check(`hole ${hole + 1}: found an out-of-bounds shot`, !!o, JSON.stringify(o));
    if (o) {
      const s1 = await st();
      const res = await playStroke(o, { fast: true, shots: {} });
      check('OOB: stroke and distance (back to the same spot, +2)', res.after.report?.result === 'oob' && res.after.strokes === s1.strokes + 2 && Math.hypot(res.after.ball.x - s1.ball.x, res.after.ball.z - s1.ball.z) < 0.5, `result=${res.after.report?.result} strokes ${s1.strokes}→${res.after.strokes} mode ${res.after.mode}`);
      if (res.after.mode !== 'stance') await page.evaluate(() => window.__game.goToBall());
      await frames(3);
      await page.evaluate(() => window.__game.setAim(0));
    }
  }

  // ── Play the hole out ──
  let n = 0;
  let sawWalk = false;
  let sawGreen = false;
  while (n++ < 20) {
    s = await st();
    if (s.mode === 'holed') break;
    if (s.mode === 'walk') {
      sawWalk = true;
      const far = Math.hypot(s.player.x - s.ball.x, s.player.z - s.ball.z);
      log(`walk mode, ${fmt(far)} m from the ball; hint: ${s.hint}`);
      if (far > 3) {
        await tap('Tab');
        const t = await st();
        check('Tab far from the ball stays in walk mode', t.mode === 'walk', t.mode);
        await capture(`h${hole + 1}-walk`);
        await tap('KeyF');
        const f = await st();
        check('F goes to the ball and addresses it', f.mode === 'stance' && Math.hypot(f.player.x - f.ball.x, f.player.z - f.ball.z) < 3, `${f.mode}`);
        // Tab back to walk and Tab again to address.
        await tap('Tab');
        const w2 = await st();
        await tap('Tab');
        const a2 = await st();
        check('Tab walk ⇄ address next to the ball', w2.mode === 'walk' && a2.mode === 'stance', `${w2.mode} → ${a2.mode}`);
      } else {
        await tap('Tab');
      }
      s = await st();
    }
    if (s.mode !== 'stance') {
      await frames(5);
      continue;
    }
    const suggested = s.club.id;
    const p = plan(s);
    log(`suggested ${suggested} from ${s.lie} at ${fmt(s.dist)} m; playing ${['D', '4H', '7I', 'SW', 'P'][p.club]}`);
    if (s.lie === 'green' && !sawGreen) {
      sawGreen = true;
      check('putter suggested on the green', suggested === 'P', suggested);
      await frames(15);
      const g = await st();
      camCheck('putting address', g, g.ball, { minUp: 0.6, maxUp: 2.5, maxDist: 4 });
      await capture(`h${hole + 1}-green`);
    }
    const first = s.strokes === 0;
    const res = await playStroke(p, first ? { fast: false, shots: { mid: `h${hole + 1}-flight`, midFrames: 40, settle: `h${hole + 1}-settle` } } : { fast: true, shots: {} });
    if (!res) break;
    if (first && res.restCam) camCheck('after the tee shot (settle view)', res.restCam, res.before.ball.y !== undefined ? res.restCam.ball : res.after.ball, { maxUp: 7, maxDist: 20 });
    await waitStanceOrWalk();
  }
  s = await st();
  check(`hole ${hole + 1} holed out`, s.mode === 'holed', `mode ${s.mode} strokes ${s.strokes}`);
  if (hi === 0) check('walk mode after the long tee shot', sawWalk);
  await frames(6);
  await capture(`h${hole + 1}-holed`);
  // Scorecard appears, then Tab → next hole.
  await until(() => !!document.querySelector('.scorecard, #scorecard, [data-scorecard]') || window.__game.mode !== 'holed', null, 400);
  await frames(60);
  const rv = await page.evaluate(() => window.__game.round);
  const hs = rv.holes[hole];
  check(`hole ${hole + 1} on the scorecard`, hs.strokes === s.strokes, `card ${hs.strokes} (putts ${hs.putts}, pen ${hs.penalties}, fw ${hs.fairway}, gir ${hs.gir})`);
  await capture(`h${hole + 1}-scorecard`);
  await tap('Tab');
  await frames(4);
  const nx = await st();
  check('Tab after holing goes to the next hole', nx.hole === (hole + 1) % 9 && nx.mode === 'stance' && nx.strokes === 0, `hole ${nx.hole + 1} mode ${nx.mode} strokes ${nx.strokes}`);
  log(`transitions: ${await drainTransitions()}`);
}

// ── Stroke cap: whiff repeatedly on a fresh hole ──
console.log('\n=== Stroke cap ===');
await page.evaluate(() => window.__game.start(5));
await frames(4);
for (let i = 0; i < 16; i++) {
  const s = await st();
  if (s.mode !== 'stance') break;
  await page.evaluate(() => window.__game.debugShot({ whiff: true }));
  await frames(2);
}
let s = await st();
check('stroke cap: whiffs stop at 15 and the hole is picked up', s.strokes <= 15 && s.mode === 'holed', `strokes ${s.strokes}, mode ${s.mode}`);
await until(() => window.__game.round.holes[5].strokes !== null, null, 30);
s = await st();
const card = await page.evaluate(() => window.__game.round.holes[5]);
check('stroke cap recorded on the card', card.strokes === 15, `card ${card.strokes}`);

const uniq = [...new Set(errors)];
check('no console errors', uniq.length === 0, uniq.slice(0, 5).join(' | ').slice(0, 600));
await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
