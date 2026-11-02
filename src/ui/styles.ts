/**
 * All UI CSS, injected once as a <style> tag. Look: dark translucent glass, warm golden accent,
 * system font stack, everything sized in `em` off a viewport-scaled root font size so the whole
 * overlay scales with the window. Only interactive elements take pointer events.
 */
export const UI_CSS = /* css */ `
#ui-root, .tl-root {
  --tl-bg: rgba(14, 19, 17, 0.58);
  --tl-bg-strong: rgba(12, 16, 15, 0.82);
  --tl-line: rgba(255, 255, 255, 0.09);
  --tl-line-strong: rgba(255, 255, 255, 0.18);
  --tl-text: #eef1ec;
  --tl-dim: rgba(238, 241, 236, 0.62);
  --tl-faint: rgba(238, 241, 236, 0.38);
  --tl-gold: #ffd166;
  --tl-gold-deep: #e0a93b;
  --tl-good: #7ee2a0;
  --tl-bad: #ff7a6b;
  --tl-blue: #6bb6ff;
  --tl-radius: 0.9em;
  --tl-blur: blur(14px) saturate(140%);
  --tl-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --tl-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Times New Roman", serif;
}
.tl-root {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: var(--tl-font); color: var(--tl-text);
  font-size: clamp(11px, 0.62vw + 0.42vh, 18px);
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  font-variant-numeric: tabular-nums; line-height: 1.25;
}
.tl-root * { box-sizing: border-box; }
.tl-root button, .tl-root input, .tl-root select, .tl-root .tl-interactive { pointer-events: auto; font-family: inherit; }
.tl-hidden { display: none !important; }
.tl-root button:focus-visible, .tl-root input:focus-visible { outline: 2px solid var(--tl-gold); outline-offset: 2px; }

/* Glass panel */
.tl-panel {
  background: var(--tl-bg);
  -webkit-backdrop-filter: var(--tl-blur); backdrop-filter: var(--tl-blur);
  border: 1px solid var(--tl-line); border-radius: var(--tl-radius);
  box-shadow: 0 0.6em 2em rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.tl-label { font-size: 0.68em; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tl-faint); }

/* ── HUD layout ── */
.tl-hud { position: absolute; inset: 0; transition: opacity .35s ease; }
.tl-hud.off { opacity: 0; }
.tl-tl { position: absolute; left: 1.4em; top: 1.3em; display: flex; flex-direction: column; gap: 0.6em; align-items: flex-start; }
.tl-tr { position: absolute; right: 1.4em; top: 1.3em; display: flex; gap: 0.7em; align-items: flex-start; }

.tl-holecard { display: flex; align-items: stretch; overflow: hidden; }
.tl-holecard .num { display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 0.45em 0.95em; background: linear-gradient(160deg, rgba(255,209,102,0.22), rgba(255,209,102,0.06)); border-right: 1px solid var(--tl-line); }
.tl-holecard .num b { font-size: 2.1em; font-weight: 800; line-height: 1; color: var(--tl-gold); }
.tl-holecard .num span { font-size: 0.6em; font-weight: 700; letter-spacing: 0.18em; color: var(--tl-dim); }
.tl-holecard .info { padding: 0.5em 0.9em 0.5em 0.8em; display: flex; flex-direction: column; justify-content: center; gap: 0.2em; }
.tl-holecard .name { font-family: var(--tl-serif); font-size: 1.12em; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap; }
.tl-holecard .stats { display: flex; gap: 0.95em; font-size: 0.86em; color: var(--tl-dim); white-space: nowrap; }
.tl-holecard .stats b { color: var(--tl-text); font-weight: 700; }
.tl-topar { font-weight: 800; }
.tl-topar.under { color: var(--tl-bad); }
.tl-topar.over { color: var(--tl-blue); }

.tl-dist { padding: 0.55em 0.9em; display: flex; gap: 1.1em; align-items: flex-end; }
.tl-dist .big { font-size: 1.9em; font-weight: 800; line-height: 1; letter-spacing: -0.01em; }
.tl-dist .big small { font-size: 0.48em; font-weight: 700; color: var(--tl-dim); margin-left: 0.2em; letter-spacing: 0.05em; }
.tl-dist .col { display: flex; flex-direction: column; gap: 0.25em; }
.tl-dist .elev { font-size: 0.9em; font-weight: 700; }
.tl-dist .elev.up { color: #ffb38a; } .tl-dist .elev.down { color: #9fd3ff; }
.tl-lie { display: inline-flex; align-items: center; gap: 0.45em; font-size: 0.8em; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; padding: 0.35em 0.75em 0.35em 0.6em; border-radius: 99em; background: rgba(10,14,12,0.6); border: 1px solid var(--tl-line); -webkit-backdrop-filter: var(--tl-blur); backdrop-filter: var(--tl-blur); }
.tl-lie i { width: 0.75em; height: 0.75em; border-radius: 50%; background: currentColor; box-shadow: 0 0 0.6em currentColor; }
.tl-timer { font-size: 0.8em; color: var(--tl-dim); padding: 0.3em 0.7em; }
.tl-timer b { color: var(--tl-text); }

.tl-wind { width: 6.6em; padding: 0.6em 0.5em 0.5em; display: flex; flex-direction: column; align-items: center; gap: 0.25em; }
.tl-wind .dial { width: 4.4em; height: 4.4em; border-radius: 50%; position: relative; border: 1px solid var(--tl-line-strong); background: radial-gradient(circle, rgba(255,255,255,0.06), rgba(255,255,255,0) 70%); }
.tl-wind .dial::before { content: ''; position: absolute; left: 50%; top: 0.2em; width: 1px; height: 0.45em; background: var(--tl-faint); }
.tl-wind .arrow { position: absolute; inset: 0; transition: transform .25s ease-out; }
.tl-wind .arrow svg { width: 100%; height: 100%; display: block; }
.tl-wind .spd { font-size: 1.25em; font-weight: 800; line-height: 1; }
.tl-wind .spd small { font-size: 0.55em; color: var(--tl-dim); font-weight: 700; margin-left: 0.15em; }

.tl-map { width: 12.5em; height: 17em; position: relative; overflow: hidden; transition: opacity .3s; }
.tl-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.tl-map-label { position: absolute; left: 0.7em; bottom: 0.55em; font-size: 0.72em; color: var(--tl-dim); text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
.tl-map-label b { color: var(--tl-gold); margin-right: 0.3em; }

/* Bottom centre: hint + club strip */
.tl-bc { position: absolute; left: 50%; bottom: 1.3em; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 0.6em; }
.tl-hint { font-size: 0.86em; color: var(--tl-text); padding: 0.45em 1.05em; border-radius: 99em; background: rgba(10,14,12,0.5); border: 1px solid var(--tl-line); -webkit-backdrop-filter: var(--tl-blur); backdrop-filter: var(--tl-blur); white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; transition: opacity .25s; }
.tl-hint:empty { opacity: 0; }
.tl-hint kbd, .tl-kbd { font-family: inherit; font-size: 0.85em; font-weight: 700; padding: 0.05em 0.45em; border-radius: 0.35em; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); border-bottom-width: 2px; }
.tl-clubbar { display: flex; align-items: center; gap: 0.9em; padding: 0.45em 0.6em 0.45em 1em; }
.tl-clubbar .cur { display: flex; flex-direction: column; min-width: 7.5em; }
.tl-clubbar .cur b { font-size: 1.1em; font-weight: 800; white-space: nowrap; }
.tl-clubbar .cur span { font-size: 0.75em; color: var(--tl-dim); white-space: nowrap; }
.tl-bag { display: flex; gap: 0.3em; }
.tl-bag div { position: relative; width: 2.8em; height: 2.6em; border-radius: 0.55em; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.9em; color: var(--tl-dim); background: rgba(255,255,255,0.05); border: 1px solid var(--tl-line); transition: all .18s ease; }
.tl-bag div sup { position: absolute; left: 0.35em; top: 0.2em; font-size: 0.62em; color: var(--tl-faint); font-weight: 700; }
.tl-bag div.sel { color: #1b1a12; background: linear-gradient(180deg, #ffe08f, var(--tl-gold-deep)); border-color: rgba(255,230,160,0.9); transform: translateY(-0.15em); box-shadow: 0 0.35em 1em rgba(255,190,70,0.35); }
.tl-bag div.sel sup { color: rgba(30,25,10,0.6); }

/* Bottom corners: swing + club panels */
.tl-swing { position: absolute; left: 1.4em; bottom: 1.3em; width: 20em; height: 20em; overflow: hidden; transition: opacity .3s, transform .3s; }
.tl-swing canvas { width: 100%; height: 100%; display: block; }
.tl-club { position: absolute; right: 1.4em; bottom: 1.3em; width: 17em; height: 19em; overflow: hidden; display: flex; flex-direction: column; transition: opacity .3s, transform .3s; }
.tl-club canvas { flex: 1; width: 100%; min-height: 0; display: block; }
.tl-cp-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1px; background: var(--tl-line); border-top: 1px solid var(--tl-line); }
.tl-cp-cell { background: rgba(10,14,12,0.55); padding: 0.35em 0.5em 0.4em; display: flex; flex-direction: column; gap: 0.1em; }
.tl-cp-cell span { font-size: 0.6em; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tl-faint); font-weight: 700; }
.tl-cp-cell b { font-size: 0.82em; font-weight: 700; white-space: nowrap; }
.tl-cp-cell { grid-column: span 2; }
.tl-cp-cell:nth-child(n+4) { grid-column: span 3; }
.tl-cp-wobble { position: absolute; right: 0.6em; top: 0.55em; font-size: 0.58em; letter-spacing: 0.14em; font-weight: 800; color: var(--tl-faint); display: none; }
.tl-cp-wobble.on { display: block; color: #ffb35c; }
.tl-cp-wobble.on::before { content: '● '; animation: tl-blink 1.2s infinite; }
.tl-swing.off, .tl-club.off { opacity: 0; transform: translateY(1em); }

/* Rangefinder */
.tl-range { position: absolute; left: 50%; top: 50%; transform: translate(-50%, 2.6em); padding: 0.4em 0.9em; display: flex; gap: 0.8em; align-items: baseline; border-radius: 99em; }
.tl-range b { font-size: 1.3em; font-weight: 800; }
.tl-range span { font-size: 0.8em; color: var(--tl-dim); }
.tl-reticle { position: absolute; left: 50%; top: 50%; width: 3.2em; height: 3.2em; transform: translate(-50%, -50%); border: 1.5px solid rgba(255,255,255,0.75); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.25); }
.tl-reticle::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: #ff5f5f; }

/* Toasts */
.tl-toasts { position: absolute; left: 50%; top: 1.4em; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 0.45em; }
.tl-toast { padding: 0.55em 1.2em; border-radius: 99em; font-size: 0.92em; font-weight: 600; background: var(--tl-bg-strong); border: 1px solid var(--tl-line-strong); -webkit-backdrop-filter: var(--tl-blur); backdrop-filter: var(--tl-blur); animation: tl-toast-in .35s cubic-bezier(.2,.9,.3,1.2); white-space: nowrap; display: flex; gap: 0.6em; align-items: center; }
.tl-toast::before { content: ''; width: 0.55em; height: 0.55em; border-radius: 50%; background: var(--tl-faint); }
.tl-toast.good::before { background: var(--tl-good); box-shadow: 0 0 0.6em var(--tl-good); }
.tl-toast.bad::before { background: var(--tl-bad); box-shadow: 0 0 0.6em var(--tl-bad); }
.tl-toast.out { animation: tl-toast-out .4s ease forwards; }
.tl-bigtoast { position: absolute; left: 50%; top: 30%; transform: translate(-50%, -50%); font-family: var(--tl-serif); font-size: 3.6em; font-weight: 600; letter-spacing: 0.02em; color: #fff; text-shadow: 0 0.06em 0.5em rgba(0,0,0,0.55), 0 0 1.4em rgba(255,200,90,0.35); animation: tl-big 2.8s ease forwards; white-space: nowrap; }

/* Hole intro */
.tl-intro { position: absolute; left: 6%; top: 36%; max-width: 32em; animation: tl-intro 5.2s ease forwards; }
.tl-intro .kicker { font-size: 0.8em; font-weight: 800; letter-spacing: 0.3em; color: var(--tl-gold); text-transform: uppercase; }
.tl-intro h2 { margin: 0.1em 0 0.15em; font-family: var(--tl-serif); font-size: 3.4em; font-weight: 600; line-height: 1.05; text-shadow: 0 0.05em 0.6em rgba(0,0,0,0.5); }
.tl-intro .meta { display: flex; gap: 1.3em; font-size: 1.05em; font-weight: 700; text-shadow: 0 1px 6px rgba(0,0,0,0.6); }
.tl-intro .meta span { color: var(--tl-dim); font-weight: 600; margin-right: 0.3em; }
.tl-intro p { margin: 0.7em 0 0; font-size: 1em; color: rgba(255,255,255,0.85); max-width: 28em; text-shadow: 0 1px 6px rgba(0,0,0,0.7); line-height: 1.45; }
.tl-intro .rule { width: 4em; height: 2px; background: linear-gradient(90deg, var(--tl-gold), transparent); margin: 0.6em 0; }

/* Shot data card */
.tl-shot { position: absolute; right: 1.4em; bottom: 21.6em; width: 21em; padding: 0.75em 0.85em 0.7em; transition: opacity .4s, transform .4s; }
.tl-shot.off { opacity: 0; transform: translateX(1.5em); }
.tl-shot.noclub { bottom: 1.3em; }
.tl-shot .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.55em; }
.tl-shot .head b { font-size: 0.95em; }
.tl-badge { font-size: 0.66em; font-weight: 800; letter-spacing: 0.14em; padding: 0.3em 0.7em; border-radius: 99em; text-transform: uppercase; }
.tl-badge.q-pure { background: linear-gradient(180deg, #ffe08f, #e0a93b); color: #231b05; box-shadow: 0 0 1em rgba(255,200,90,0.45); }
.tl-badge.q-good { background: rgba(126,226,160,0.2); color: var(--tl-good); border: 1px solid rgba(126,226,160,0.4); }
.tl-badge.q-warn { background: rgba(255,179,92,0.18); color: #ffb35c; border: 1px solid rgba(255,179,92,0.4); }
.tl-badge.q-bad { background: rgba(255,122,107,0.18); color: var(--tl-bad); border: 1px solid rgba(255,122,107,0.4); }
.tl-shot .hero { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4em; margin-bottom: 0.55em; }
.tl-shot .hero div { background: rgba(255,255,255,0.05); border-radius: 0.5em; padding: 0.35em 0.45em; }
.tl-shot .hero span { display: block; font-size: 0.58em; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tl-faint); font-weight: 700; }
.tl-shot .hero b { font-size: 1.15em; font-weight: 800; }
.tl-shot .hero b small { font-size: 0.6em; color: var(--tl-dim); margin-left: 0.15em; }
.tl-shot table { width: 100%; border-collapse: collapse; font-size: 0.78em; }
.tl-shot td { padding: 0.17em 0; white-space: nowrap; }
.tl-shot td:nth-child(odd) { color: var(--tl-dim); }
.tl-shot td:nth-child(even) { text-align: right; font-weight: 700; padding-right: 0.8em; }
.tl-shot td:last-child { padding-right: 0; }
.tl-shot .foot { margin-top: 0.45em; font-size: 0.72em; color: var(--tl-dim); display: flex; justify-content: space-between; }
.tl-shot .bar { position: absolute; left: 0.85em; right: 0.85em; bottom: 0.3em; height: 2px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden; }
.tl-shot .bar i { display: block; height: 100%; background: var(--tl-gold); transform-origin: left; }

/* ── Full-screen layers ── */
.tl-screen { position: absolute; inset: 0; pointer-events: auto; display: flex; animation: tl-fade .35s ease; }
.tl-screen.closing { animation: tl-fadeout .3s ease forwards; pointer-events: none; }
.tl-dim { background: radial-gradient(ellipse at 30% 50%, rgba(8,12,10,0.35), rgba(8,12,10,0.75)); }

/* Loading */
.tl-loading { background: radial-gradient(ellipse at 50% 120%, #4a3b1f 0%, #1d2a1c 45%, #0b110d 100%); align-items: center; justify-content: center; flex-direction: column; z-index: 5; }
.tl-loading .crest { width: 4.6em; height: 4.6em; margin-bottom: 1.1em; opacity: 0.95; }
.tl-loading h1 { margin: 0; font-family: var(--tl-serif); font-weight: 600; font-size: 3.6em; letter-spacing: 0.04em; }
.tl-loading .sub { margin-top: 0.3em; font-size: 0.78em; letter-spacing: 0.42em; text-transform: uppercase; color: var(--tl-gold); font-weight: 700; }
.tl-progress { width: min(26em, 70vw); height: 3px; border-radius: 3px; margin-top: 3em; background: rgba(255,255,255,0.1); overflow: hidden; }
.tl-progress i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--tl-gold-deep), #fff1c4); box-shadow: 0 0 12px rgba(255,209,102,0.7); transition: width .35s ease; }
.tl-loading .stage { margin-top: 0.9em; font-size: 0.85em; color: var(--tl-dim); display: flex; gap: 1em; }
.tl-loading .tip { position: absolute; bottom: 3.5em; left: 50%; transform: translateX(-50%); width: min(40em, 86vw); text-align: center; font-size: 0.92em; color: rgba(255,255,255,0.72); line-height: 1.5; transition: opacity .5s; }
.tl-loading .tip b { display: block; font-size: 0.72em; letter-spacing: 0.3em; color: var(--tl-gold); margin-bottom: 0.4em; }

/* Title */
.tl-title { background: linear-gradient(90deg, rgba(8,12,10,0.78) 0%, rgba(8,12,10,0.45) 34%, rgba(8,12,10,0) 62%); align-items: center; }
.tl-title-inner { margin-left: 7%; width: min(28em, 80vw); display: flex; flex-direction: column; }
.tl-title .kicker { font-size: 0.78em; letter-spacing: 0.42em; color: var(--tl-gold); font-weight: 700; text-transform: uppercase; }
.tl-title h1 { margin: 0.15em 0 0.1em; font-family: var(--tl-serif); font-size: 4.4em; font-weight: 600; line-height: 0.98; letter-spacing: 0.01em; text-shadow: 0 0.05em 0.5em rgba(0,0,0,0.45); }
.tl-title .tag { color: var(--tl-dim); font-size: 1em; margin-bottom: 2.2em; }
.tl-menu { display: flex; flex-direction: column; gap: 0.5em; }
.tl-btn { all: unset; box-sizing: border-box; cursor: pointer; pointer-events: auto; display: flex; align-items: center; justify-content: space-between; gap: 1em; padding: 0.85em 1.2em; border-radius: 0.7em; font-size: 1.02em; font-weight: 700; letter-spacing: 0.02em; color: var(--tl-text); background: rgba(255,255,255,0.06); border: 1px solid var(--tl-line); transition: background .15s, transform .15s, border-color .15s, box-shadow .15s; }
.tl-btn:hover, .tl-btn:focus-visible { background: rgba(255,255,255,0.12); border-color: var(--tl-line-strong); transform: translateX(0.2em); }
.tl-btn small { font-weight: 600; color: var(--tl-faint); font-size: 0.78em; }
.tl-btn.primary { color: #211a08; background: linear-gradient(180deg, #ffe39a, var(--tl-gold-deep)); border-color: rgba(255,230,160,0.8); box-shadow: 0 0.5em 1.6em rgba(224,169,59,0.3); }
.tl-btn.primary small { color: rgba(33,26,8,0.6); }
.tl-btn.primary:hover { background: linear-gradient(180deg, #fff0c2, #f0b84a); }
.tl-btn.danger { color: #ffd0c9; }
.tl-btn.small { padding: 0.5em 0.9em; font-size: 0.86em; justify-content: center; }
.tl-best { margin-top: 2em; display: flex; gap: 2em; }
.tl-best div span { display: block; font-size: 0.66em; letter-spacing: 0.18em; text-transform: uppercase; color: var(--tl-faint); font-weight: 700; }
.tl-best div b { font-size: 1.5em; font-weight: 800; }
.tl-foot { position: absolute; right: 1.6em; bottom: 1.2em; font-size: 0.72em; color: var(--tl-faint); text-align: right; }

/* Modal (pause, settings, controls, practice, scorecard) */
.tl-modal-wrap { align-items: center; justify-content: center; background: rgba(6,9,8,0.55); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.tl-modal { background: var(--tl-bg-strong); border: 1px solid var(--tl-line-strong); border-radius: 1.1em; box-shadow: 0 1.5em 4em rgba(0,0,0,0.5); -webkit-backdrop-filter: var(--tl-blur); backdrop-filter: var(--tl-blur); max-height: 88vh; display: flex; flex-direction: column; animation: tl-pop .3s cubic-bezier(.2,.9,.3,1.1); }
.tl-modal header { padding: 1.1em 1.4em 0.9em; display: flex; align-items: baseline; justify-content: space-between; gap: 1em; border-bottom: 1px solid var(--tl-line); }
.tl-modal header h2 { margin: 0; font-family: var(--tl-serif); font-weight: 600; font-size: 1.7em; }
.tl-modal header .tl-label { white-space: nowrap; }
.tl-modal .body { padding: 1em 1.4em; overflow: auto; }
.tl-modal footer { padding: 0.8em 1.4em 1em; display: flex; gap: 0.6em; justify-content: flex-end; border-top: 1px solid var(--tl-line); }
.tl-modal .body::-webkit-scrollbar { width: 8px; } .tl-modal .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 8px; }
.tl-pause { width: min(22em, 90vw); }
.tl-pause .body { display: flex; flex-direction: column; gap: 0.45em; }

/* Tabs + settings rows */
.tl-tabs { display: flex; gap: 0.3em; padding: 0.7em 1.4em 0; }
.tl-tab { all: unset; cursor: pointer; pointer-events: auto; padding: 0.5em 1em; border-radius: 0.55em 0.55em 0 0; font-weight: 700; font-size: 0.9em; color: var(--tl-dim); border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
.tl-tab:hover { color: var(--tl-text); }
.tl-tab.on { color: var(--tl-gold); border-color: var(--tl-gold); }
.tl-settings { width: min(44em, 94vw); height: min(40em, 88vh); }
.tl-settings .body { flex: 1; }
.tl-ballDist { color: var(--tl-dim); text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
.tl-row { display: flex; align-items: center; justify-content: space-between; gap: 1.2em; padding: 0.62em 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.tl-row:last-child { border-bottom: none; }
.tl-row .lbl { display: flex; flex-direction: column; gap: 0.15em; }
.tl-row .lbl b { font-weight: 600; font-size: 0.95em; }
.tl-row .lbl span { font-size: 0.76em; color: var(--tl-faint); }
.tl-group-title { margin: 1em 0 0.2em; }
.tl-group-title:first-child { margin-top: 0.2em; }
.tl-seg { display: inline-flex; background: rgba(255,255,255,0.06); border: 1px solid var(--tl-line); border-radius: 0.6em; padding: 0.18em; flex-shrink: 0; }
.tl-seg button { all: unset; cursor: pointer; pointer-events: auto; padding: 0.38em 0.8em; border-radius: 0.45em; font-size: 0.82em; font-weight: 700; color: var(--tl-dim); transition: all .15s; white-space: nowrap; }
.tl-seg button:hover { color: var(--tl-text); }
.tl-seg button.on { background: rgba(255,209,102,0.92); color: #211a08; }
.tl-switch { all: unset; cursor: pointer; pointer-events: auto; width: 2.7em; height: 1.5em; border-radius: 99em; background: rgba(255,255,255,0.14); position: relative; transition: background .2s; flex-shrink: 0; }
.tl-switch::after { content: ''; position: absolute; left: 0.18em; top: 0.18em; width: 1.14em; height: 1.14em; border-radius: 50%; background: #fff; transition: transform .2s cubic-bezier(.3,.9,.4,1.2); box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
.tl-switch.on { background: var(--tl-gold-deep); }
.tl-switch.on::after { transform: translateX(1.2em); }
.tl-slider { display: flex; align-items: center; gap: 0.8em; flex-shrink: 0; }
.tl-slider output { min-width: 3.2em; text-align: right; font-weight: 700; font-size: 0.86em; }
.tl-slider input[type=range] { -webkit-appearance: none; appearance: none; width: 11em; height: 4px; border-radius: 4px; background: linear-gradient(90deg, var(--tl-gold) var(--p, 50%), rgba(255,255,255,0.15) var(--p, 50%)); outline: none; cursor: pointer; }
.tl-slider input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 1em; height: 1em; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.tl-slider input[type=range]::-moz-range-thumb { width: 1em; height: 1em; border: none; border-radius: 50%; background: #fff; }

/* Controls */
.tl-controls { width: min(46em, 94vw); }
.tl-bind-row { display: grid; grid-template-columns: 1fr 13.5em 9.5em; align-items: center; gap: 0.8em; padding: 0.32em 0; border-bottom: 1px solid rgba(255,255,255,0.045); font-size: 0.9em; }
.tl-bind-row .ctx { font-size: 0.7em; color: var(--tl-faint); margin-left: 0.5em; }
.tl-bind-head { font-size: 0.66em; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tl-faint); font-weight: 700; border-bottom: 1px solid var(--tl-line); padding-bottom: 0.5em; position: sticky; top: -1em; background: rgba(14,18,16,0.96); z-index: 1; padding-top: 0.6em; }
.tl-slots { display: flex; gap: 0.35em; }
.tl-chip { all: unset; cursor: pointer; pointer-events: auto; min-width: 3.6em; flex: 1; text-align: center; padding: 0.32em 0.5em; border-radius: 0.45em; font-size: 0.84em; font-weight: 700; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12); border-bottom-width: 2px; transition: all .12s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tl-chip:hover { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.25); }
.tl-chip.empty { color: var(--tl-faint); font-weight: 500; }
.tl-chip.capturing { background: rgba(255,209,102,0.2); border-color: var(--tl-gold); color: var(--tl-gold); animation: tl-blink 1s infinite; }
.tl-chip.disabled { cursor: default; opacity: 0.6; }
.tl-note { font-size: 0.78em; color: var(--tl-faint); margin: 0.2em 0 0.6em; line-height: 1.45; }

/* Practice hole picker */
.tl-practice { width: min(46em, 94vw); }
.tl-holes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6em; }
.tl-holebtn { all: unset; cursor: pointer; pointer-events: auto; border-radius: 0.75em; padding: 0.8em 0.9em; background: rgba(255,255,255,0.05); border: 1px solid var(--tl-line); display: flex; flex-direction: column; gap: 0.2em; transition: all .15s; }
.tl-holebtn:hover { background: rgba(255,209,102,0.12); border-color: rgba(255,209,102,0.5); transform: translateY(-0.12em); }
.tl-holebtn .n { font-size: 0.66em; letter-spacing: 0.2em; color: var(--tl-gold); font-weight: 800; }
.tl-holebtn b { font-family: var(--tl-serif); font-size: 1.15em; font-weight: 600; }
.tl-holebtn span { font-size: 0.78em; color: var(--tl-dim); }

/* Scorecard */
.tl-scorecard { width: min(54em, 96vw); }
.tl-sc { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; font-size: 0.92em; }
.tl-sc th, .tl-sc td { text-align: center; padding: 0.5em 0.2em; border-bottom: 1px solid rgba(255,255,255,0.06); }
.tl-sc th:first-child, .tl-sc td:first-child { text-align: left; padding-left: 0.4em; color: var(--tl-dim); font-weight: 700; font-size: 0.82em; letter-spacing: 0.06em; text-transform: uppercase; width: 5.5em; }
.tl-sc thead th { font-size: 0.78em; color: var(--tl-faint); font-weight: 800; }
.tl-sc .tot { background: rgba(255,255,255,0.05); font-weight: 800; }
.tl-sc .cur { background: rgba(255,209,102,0.08); }
.tl-sc thead .cur { color: var(--tl-gold); }
.tl-score { display: inline-flex; align-items: center; justify-content: center; width: 1.9em; height: 1.9em; font-weight: 800; position: relative; }
.tl-score.eagle { color: #ffd166; border: 2px solid #ffd166; border-radius: 50%; outline: 1.5px solid rgba(255,209,102,0.7); outline-offset: 2px; }
.tl-score.birdie { color: #ff8a7a; border: 2px solid #ff8a7a; border-radius: 50%; }
.tl-score.par { color: var(--tl-text); }
.tl-score.bogey { color: #8ec5ff; border: 2px solid #8ec5ff; border-radius: 0.2em; }
.tl-score.double { color: #a99bff; border: 2px solid #a99bff; border-radius: 0.2em; outline: 1.5px solid rgba(169,155,255,0.7); outline-offset: 2px; }
.tl-sc-sum { display: flex; gap: 0.8em; margin-top: 1.1em; flex-wrap: wrap; }
.tl-sc-sum div { flex: 1; min-width: 7em; background: rgba(255,255,255,0.05); border: 1px solid var(--tl-line); border-radius: 0.7em; padding: 0.6em 0.8em; }
.tl-sc-sum span { display: block; font-size: 0.64em; letter-spacing: 0.15em; text-transform: uppercase; color: var(--tl-faint); font-weight: 700; }
.tl-sc-sum b { font-size: 1.45em; font-weight: 800; }
.tl-sc-final { text-align: center; padding: 0.2em 0 1em; }
.tl-sc-final .big { font-family: var(--tl-serif); font-size: 3.6em; font-weight: 600; line-height: 1; }
.tl-sc-final .big small { font-family: var(--tl-font); font-size: 0.35em; font-weight: 800; margin-left: 0.4em; vertical-align: middle; }
.tl-newbest { display: inline-block; margin-top: 0.6em; font-size: 0.72em; letter-spacing: 0.22em; font-weight: 800; padding: 0.35em 0.9em; border-radius: 99em; color: #231b05; background: linear-gradient(180deg, #ffe08f, #e0a93b); animation: tl-glow 1.6s ease-in-out infinite; }
.tl-sc-legend { display: flex; gap: 1.2em; font-size: 0.74em; color: var(--tl-dim); margin-top: 0.8em; align-items: center; }
.tl-sc-legend > span { display: inline-flex; align-items: center; gap: 0.5em; }
.tl-sc-legend .tl-score { width: 1.5em; height: 1.5em; font-size: 0.8em; }
.tl-sc-legend .tl-score.eagle, .tl-sc-legend .tl-score.double { outline-offset: 1px; }

@keyframes tl-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tl-fadeout { to { opacity: 0; } }
@keyframes tl-pop { from { opacity: 0; transform: translateY(0.8em) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes tl-toast-in { from { opacity: 0; transform: translateY(-0.6em) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes tl-toast-out { to { opacity: 0; transform: translateY(-0.5em); } }
@keyframes tl-big { 0% { opacity: 0; transform: translate(-50%, -40%) scale(0.92); } 12% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -56%); } }
@keyframes tl-intro { 0% { opacity: 0; transform: translateX(-1.2em); } 10% { opacity: 1; transform: none; } 82% { opacity: 1; } 100% { opacity: 0; transform: translateX(0.6em); } }
@keyframes tl-blink { 50% { opacity: 0.45; } }
@keyframes tl-glow { 50% { box-shadow: 0 0 1.4em rgba(255,200,90,0.65); } }
@media (prefers-reduced-motion: reduce) { .tl-root * { animation-duration: 0.01s !important; transition-duration: 0.01s !important; } }
@media (max-aspect-ratio: 4/3) { .tl-map { width: 10.5em; height: 14em; } }
`;

let injected = false;
export function injectStyles() {
  if (injected) return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'tl-ui-styles';
  s.textContent = UI_CSS;
  document.head.append(s);
}
