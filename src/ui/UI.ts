/**
 * UI — DOM/canvas overlay: loading screen, title, HUD, swing panel, club panel, shot data card,
 * scorecard, pause / settings / controls menus (incl. rebinding), toasts, hole intro, minimap.
 *
 * The UI never mutates game state: it reads HudView / RoundView / ShotReport snapshots and calls
 * back through UIHandlers. Settings are written through settings.set().
 *
 * Escape handling: while a sub-menu (settings, controls, practice picker) is open `menuOpen` is
 * true and the UI handles Escape itself (back one level). `menuOpen` stays true for a short grace
 * period after closing so the same Escape press doesn't also toggle the game's pause.
 */
import type { HudView, RoundView, ShotReport, UIHandlers } from '../core/view';
import type { Input } from '../core/Input';
import type { AudioSystem } from '../audio/Audio';
import { settings } from '../core/settings';
import { HOLES, COURSE_NAME } from '../course/layout';
import { SURFACES, type SurfaceId } from '../config';
import { h, setText, toggle } from './dom';
import { clock, dist, distStr, distUnit, height, heightUnit, toParStr, windStr, type Units } from './format';
import { injectStyles } from './styles';
import { InputBridge } from './inputContract';
import { SwingPanel } from './SwingPanel';
import { ClubPanel } from './ClubPanel';
import { Minimap } from './Minimap';
import { ShotCard } from './ShotCard';
import { buildScorecard } from './Scorecard';
import { buildControls, buildSettings } from './menus';
import { PadNav } from './padNav';

// ── tuning ──────────────────────────────────────────────────────────────
const ESC_GRACE_MS = 250;
const TOAST_MS = { info: 3200, good: 3200, bad: 4600 };
const MAX_TOASTS = 4;
const TIP_MS = 4800;

const TIPS = [
  'There is no power meter. Clubhead speed comes from how fast and smoothly you move your hands.',
  'Keep the hand cursor inside the green ring at the bottom of the swing for clean contact. Outside it you hit it fat, inside it you hit it thin.',
  'Open the face and the ball starts right; the gap between face and path decides how much it curves.',
  'Play the ball forward in your stance for a higher flight, back for a lower, punchier shot.',
  'Hold Shift while adjusting face, path or aim to make finer changes.',
  'Take a practice swing (X) to feel the speed before you hit the real one.',
  'Wind matters more the higher the ball flies. Into the wind, club up and swing smoothly.',
  'Use the rangefinder (hold right mouse) to check the distance to anything you can see.',
  'Uphill shots play longer, downhill shorter. Watch the elevation next to the distance.',
  'Greens are firm at Thornbury. Land short and let it release.',
];

const LIE_COL: Record<SurfaceId, string> = {
  tee: '#b4e39a', fairway: '#8fd170', fringe: '#b8e68c', green: '#a8f07a', rough: '#7fae55', deepRough: '#5f8f3e',
  sand: '#ecd79f', water: '#6ab4ea', path: '#d0cabe', dirt: '#c09a66', oob: '#ff7a6b',
};

type ModalId = 'pause' | 'settings' | 'controls' | 'practice';
interface ModalEntry {
  id: ModalId;
  el: HTMLElement;
  back: () => void;
}

const CREST_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="32" cy="32" r="30" stroke="#ffd166" stroke-opacity=".55" stroke-width="1.5"/>
  <circle cx="32" cy="32" r="25" stroke="#ffd166" stroke-opacity=".25" stroke-width="1"/>
  <path d="M10 44c8-6 16-8 22-8s14 2 22 8" stroke="#8fd170" stroke-width="2" stroke-linecap="round"/>
  <path d="M30 40V14" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
  <path d="M30 14l13 4.5L30 23z" fill="#ffd166"/>
  <ellipse cx="30" cy="40.5" rx="4" ry="1.3" fill="#0b110d" stroke="#fff" stroke-opacity=".5"/>
</svg>`;

const WIND_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs><linearGradient id="tlwg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset="1" stop-color="#ffd166"/></linearGradient></defs>
  <path d="M50 14 L64 40 L55 37 L55 80 L45 80 L45 37 L36 40 Z" fill="url(#tlwg)" stroke="rgba(0,0,0,.35)" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

/** Length of a hole along tee → fairway → pin (m). */
function holeLength(i: number) {
  const hd = HOLES[i];
  const pts = [hd.tee, ...hd.fairway, hd.pin];
  let d = 0;
  for (let k = 1; k < pts.length; k++) d += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return d;
}

/** Escape a string and wrap obvious key names in <kbd>. */
function hintHtml(s: string) {
  const esc = s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return esc.replace(/(^|[\s·(])(Tab|Space|Shift|Ctrl|Esc|LMB|RMB|WASD|Enter|[B-HJ-Z]|[1-5]|1-5)(?=[\s:]|$)/g, '$1<kbd>$2</kbd>');
}

export class UI {
  private root: HTMLElement;
  private handlers: UIHandlers;
  private audio: AudioSystem;
  private input: InputBridge;

  // Layers.
  private hud: HTMLElement;
  private screens: HTMLElement;
  private modalLayer: HTMLElement;
  private toastBox: HTMLElement;
  private overlay: HTMLElement; // intro + big toasts

  // Loading / title.
  private loadingEl: HTMLElement | null = null;
  private loadBar: HTMLElement | null = null;
  private loadLabel: HTMLElement | null = null;
  private loadPct: HTMLElement | null = null;
  private tipTimer = 0;
  private titleEl: HTMLElement | null = null;
  private lastRound: RoundView | null = null;

  // Modals.
  private stack: ModalEntry[] = [];
  private escGraceUntil = 0;
  private settingsUI: ReturnType<typeof buildSettings> | null = null;
  private controlsUI: ReturnType<typeof buildControls> | null = null;
  private scorecardEl: HTMLElement | null = null;

  // HUD parts.
  private swing = new SwingPanel();
  private club = new ClubPanel();
  private minimap = new Minimap();
  private shot = new ShotCard();
  private el: Record<string, HTMLElement> = {};
  private bagEls: HTMLElement[] = [];
  private bagKey = '';
  private lastMode = '';
  private lastT = 0;
  private hudVisible = true; // constructor hides it

  constructor(root: HTMLElement, handlers: UIHandlers, input: Input, audio: AudioSystem) {
    injectStyles();
    this.handlers = handlers;
    this.audio = audio;
    this.input = new InputBridge(input);
    this.root = h('div', { class: 'tl-root' });
    root.append(this.root);
    this.hud = this.buildHud();
    this.overlay = h('div', { style: 'position:absolute;inset:0' });
    this.toastBox = h('div', { class: 'tl-toasts' });
    this.screens = h('div', { style: 'position:absolute;inset:0' });
    this.modalLayer = h('div', { style: 'position:absolute;inset:0' });
    this.root.append(this.hud, this.overlay, this.toastBox, this.screens, this.modalLayer);
    this.setHudVisible(false);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Gamepad menu navigation over whichever layer is on top.
    new PadNav(
      () => this.navLayer(),
      () => this.navLayer() !== null && !this.controlsUI?.state.capturing,
      () => this.padBack(),
      () => this.audio.ui('tick'),
    );
    settings.subscribe((_s, ch) => {
      if (ch.includes('units') && this.titleEl) this.refreshTitleBest();
    });
  }

  // ───────────────────────────── loading ─────────────────────────────

  setLoading(progress: number, label: string) {
    if (!this.loadingEl) {
      this.loadBar = h('i');
      this.loadLabel = h('span');
      this.loadPct = h('span', { style: 'color:var(--tl-faint)' });
      const tip = h('div', { class: 'tip' });
      const showTip = () => {
        tip.style.opacity = '0';
        setTimeout(() => {
          tip.innerHTML = `<b>TIP</b>${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
          tip.style.opacity = '1';
        }, 300);
      };
      tip.innerHTML = `<b>TIP</b>${TIPS[0]}`;
      this.tipTimer = window.setInterval(showTip, TIP_MS);
      this.loadingEl = h(
        'div',
        { class: 'tl-screen tl-loading' },
        h('div', { class: 'crest', html: CREST_SVG }),
        h('h1', { text: COURSE_NAME }),
        h('div', { class: 'sub', text: 'Nine holes · Physics golf' }),
        h('div', { class: 'tl-progress' }, this.loadBar),
        h('div', { class: 'stage' }, this.loadLabel, this.loadPct),
        tip,
      );
      this.screens.append(this.loadingEl);
    }
    const p = Math.max(0, Math.min(1, progress));
    this.loadBar!.style.width = `${(p * 100).toFixed(1)}%`;
    setText(this.loadLabel!, label);
    setText(this.loadPct!, `${Math.round(p * 100)}%`);
  }

  hideLoading() {
    const el = this.loadingEl;
    if (!el) return;
    this.loadBar!.style.width = '100%';
    clearInterval(this.tipTimer);
    this.loadingEl = null;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 600);
  }

  // ───────────────────────────── title ─────────────────────────────

  showTitle(round: RoundView | null) {
    this.lastRound = round;
    this.closeModals();
    this.setHudVisible(false);
    this.hideScorecard();
    this.shot.hide();
    if (this.titleEl) this.titleEl.remove();
    const btn = (label: string, sub: string, cls: string, fn: () => void) =>
      h('button', {
        class: `tl-btn ${cls}`,
        html: `${label}<small>${sub}</small>`,
        onmouseenter: () => this.audio.ui('tick'),
        onclick: () => {
          this.audio.unlock?.();
          this.audio.ui('click');
          fn();
        },
      });
    const best = h('div', { class: 'tl-best' });
    this.titleEl = h(
      'div',
      { class: 'tl-screen tl-title' },
      h(
        'div',
        { class: 'tl-title-inner' },
        h('div', { class: 'kicker', text: 'A physics golf course' }),
        h('h1', { text: COURSE_NAME }),
        h('div', { class: 'tag', text: 'Nine holes. No power meter. Just your hands, the wind and the ground.' }),
        h(
          'div',
          { class: 'tl-menu' },
          btn('Play 9 Holes', `Par ${HOLES.reduce((s, x) => s + x.par, 0)}`, 'primary', () => this.handlers.onPlay({ startHole: 0, mode: 'round' })),
          btn('Practice', 'Pick a hole', '', () => this.openPractice()),
          btn('Settings', '', '', () => this.openSettings()),
          btn('Controls', '', '', () => this.openControls()),
        ),
        best,
      ),
      h('div', { class: 'tl-foot', html: 'Mouse swing with pointer lock · Gamepad supported<br>Esc pauses during play' }),
    );
    this.el.titleBest = best;
    this.refreshTitleBest();
    this.screens.append(this.titleEl);
  }

  private refreshTitleBest() {
    const best = this.el.titleBest;
    if (!best) return;
    const r = this.lastRound;
    const par = r?.totalPar ?? HOLES.reduce((s, x) => s + x.par, 0);
    const bs = r?.best.strokes ?? null;
    const bt = r?.best.time ?? null;
    best.replaceChildren(
      h('div', {}, h('span', { text: 'Best round' }), h('b', { text: bs === null ? '—' : `${bs} (${toParStr(bs - par)})` })),
      h('div', {}, h('span', { text: 'Best time' }), h('b', { text: bt === null ? '—' : clock(bt) })),
      h('div', {}, h('span', { text: 'Course' }), h('b', { text: distStr(HOLES.reduce((s, _x, i) => s + holeLength(i), 0), settings.get('units')) })),
    );
  }

  hideTitle() {
    this.closeModals();
    const el = this.titleEl;
    if (!el) return;
    this.titleEl = null;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 400);
  }

  // ───────────────────────────── modals ─────────────────────────────

  private pushModal(id: ModalId, content: HTMLElement, back: () => void) {
    // Only the top modal is visible.
    for (const m of this.stack) m.el.classList.add('tl-hidden');
    const wrap = h('div', { class: 'tl-screen tl-modal-wrap' }, content);
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap && id !== 'pause') back();
    });
    this.modalLayer.append(wrap);
    this.stack.push({ id, el: wrap, back });
    this.audio.ui('open');
  }

  private popModal() {
    const m = this.stack.pop();
    if (!m) return;
    m.el.remove();
    if (m.id === 'controls') this.controlsUI?.cancel();
    const top = this.stack[this.stack.length - 1];
    if (top) top.el.classList.remove('tl-hidden');
    this.escGraceUntil = performance.now() + ESC_GRACE_MS;
    this.audio.ui('close');
  }

  private closeModals() {
    this.controlsUI?.cancel();
    while (this.stack.length) this.stack.pop()!.el.remove();
  }

  private top(): ModalId | null {
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  private onKey(e: KeyboardEvent) {
    if (e.code !== 'Escape') return;
    const now = performance.now();
    const cap = this.controlsUI?.state;
    if (cap && (cap.capturing || now - cap.endedAt < ESC_GRACE_MS)) return;
    const t = this.top();
    if (t && t !== 'pause') {
      e.preventDefault();
      this.stack[this.stack.length - 1].back();
    }
  }

  /** Top-most interactive layer for gamepad navigation. */
  private navLayer(): HTMLElement | null {
    if (this.stack.length) return this.stack[this.stack.length - 1].el;
    if (this.scorecardEl) return this.scorecardEl;
    return this.titleEl;
  }

  private padBack() {
    const t = this.top();
    if (t === 'pause') this.handlers.onResume();
    else if (t) this.stack[this.stack.length - 1].back();
  }

  private openSettings() {
    if (!this.settingsUI) this.settingsUI = buildSettings(this.audio, () => this.popModal());
    this.settingsUI.refresh();
    this.pushModal('settings', this.settingsUI.el, () => this.popModal());
  }

  private openControls() {
    if (!this.controlsUI) this.controlsUI = buildControls(this.input, this.audio, (m, k) => this.toast(m, k), () => this.popModal());
    this.controlsUI.render();
    this.pushModal('controls', this.controlsUI.el, () => this.popModal());
  }

  private openPractice() {
    const u = settings.get('units');
    const grid = h(
      'div',
      { class: 'tl-holes' },
      ...HOLES.map((hd, i) =>
        h(
          'button',
          {
            class: 'tl-holebtn',
            onmouseenter: () => this.audio.ui('tick'),
            onclick: () => {
              this.audio.ui('click');
              this.closeModals();
              this.handlers.onPlay({ startHole: i, mode: 'practice' });
            },
          },
          h('span', { class: 'n', text: `HOLE ${hd.number}` }),
          h('b', { text: hd.name }),
          h('span', { text: `Par ${hd.par} · ${distStr(holeLength(i), u)}` }),
        ),
      ),
    );
    const el = h(
      'div',
      { class: 'tl-modal tl-practice' },
      h('header', {}, h('h2', { text: 'Practice' }), h('span', { class: 'tl-label', text: 'Scores are not recorded' })),
      h('div', { class: 'body' }, grid),
      h('footer', {}, h('button', { class: 'tl-btn small', text: 'Back', onclick: () => this.popModal() })),
    );
    this.pushModal('practice', el, () => this.popModal());
  }

  showPause() {
    this.closeModals();
    let quitArmed = 0;
    const btn = (label: string, cls: string, fn: (b: HTMLButtonElement) => void) => {
      const b = h('button', {
        class: `tl-btn ${cls}`,
        html: label,
        onmouseenter: () => this.audio.ui('tick'),
      });
      b.addEventListener('click', () => {
        this.audio.ui('click');
        fn(b);
      });
      return b;
    };
    const el = h(
      'div',
      { class: 'tl-modal tl-pause' },
      h('header', {}, h('h2', { text: 'Paused' }), h('span', { class: 'tl-label', text: this.lastHoleLabel() })),
      h(
        'div',
        { class: 'body' },
        btn('Resume <small>Esc</small>', 'primary', () => this.handlers.onResume()),
        btn('Restart hole', '', () => this.handlers.onRestartHole()),
        btn('Settings', '', () => this.openSettings()),
        btn('Controls', '', () => this.openControls()),
        btn('Quit to title', 'danger', (b) => {
          if (performance.now() < quitArmed) {
            this.handlers.onQuitToTitle();
            return;
          }
          quitArmed = performance.now() + 2500;
          b.innerHTML = 'Click again to quit <small>round progress is lost</small>';
          setTimeout(() => {
            if (b.isConnected) b.innerHTML = 'Quit to title';
          }, 2500);
        }),
      ),
    );
    this.pushModal('pause', el, () => this.handlers.onResume());
  }

  hidePause() {
    if (this.stack.length) this.escGraceUntil = performance.now() + ESC_GRACE_MS;
    this.closeModals();
  }

  /** True while a sub-menu owns Escape (settings / controls / practice / key capture). */
  get menuOpen() {
    const t = this.top();
    return (t !== null && t !== 'pause') || !!this.controlsUI?.state.capturing || performance.now() < this.escGraceUntil;
  }

  private lastHoleLabel() {
    const n = this.el.holeNum?.textContent;
    return n ? `Hole ${n}` : '';
  }

  // ───────────────────────────── HUD ─────────────────────────────

  private buildHud() {
    const e = this.el;
    e.holeNum = h('b', { text: '1' });
    e.holeName = h('div', { class: 'name' });
    e.par = h('b');
    e.stroke = h('b');
    e.toPar = h('b', { class: 'tl-topar' });
    e.distBig = h('div', { class: 'big' });
    e.elev = h('div', { class: 'elev' });
    e.plays = h('div', { class: 'tl-label' });
    e.lie = h('div', { class: 'tl-lie' });
    e.ballDist = h('div', { class: 'tl-label tl-ballDist' });
    e.timer = h('div', { class: 'tl-panel tl-timer' });
    e.windArrow = h('div', { class: 'arrow', html: WIND_SVG });
    e.windSpd = h('div', { class: 'spd' });
    e.hint = h('div', { class: 'tl-hint' });
    e.clubName = h('b');
    e.clubCarry = h('span');
    e.bag = h('div', { class: 'tl-bag' });
    e.rangeVal = h('b');
    e.rangeElev = h('span');
    e.range = h('div', {}, h('div', { class: 'tl-reticle' }), h('div', { class: 'tl-panel tl-range' }, h('span', { class: 'tl-label', text: 'Range' }), e.rangeVal, e.rangeElev));

    const holeCard = h(
      'div',
      { class: 'tl-panel tl-holecard' },
      h('div', { class: 'num' }, h('span', { text: 'HOLE' }), e.holeNum),
      h('div', { class: 'info' }, e.holeName, h('div', { class: 'stats' }, h('span', {}, 'Par ', e.par), h('span', {}, 'Stroke ', e.stroke), h('span', {}, 'Score ', e.toPar))),
    );
    const distCard = h(
      'div',
      { class: 'tl-panel tl-dist' },
      h('div', { class: 'col' }, h('span', { class: 'tl-label', text: 'To pin' }), e.distBig),
      h('div', { class: 'col' }, e.elev, e.plays),
    );
    e.wind = h('div', { class: 'tl-panel tl-wind' }, h('span', { class: 'tl-label', text: 'Wind' }), h('div', { class: 'dial' }, e.windArrow), e.windSpd);
    const tl = h('div', { class: 'tl-tl' }, holeCard, distCard, h('div', { style: 'display:flex;gap:0.5em;align-items:center' }, e.lie, e.ballDist), e.timer);
    const tr = h('div', { class: 'tl-tr' }, e.wind, this.minimap.el);
    const bc = h('div', { class: 'tl-bc' }, e.hint, h('div', { class: 'tl-panel tl-clubbar' }, h('div', { class: 'cur' }, e.clubName, e.clubCarry), e.bag));
    return h('div', { class: 'tl-hud' }, tl, tr, bc, e.range, this.swing.el, this.club.el, this.shot.el);
  }

  private setHudVisible(on: boolean) {
    if (this.hudVisible === on) return;
    this.hudVisible = on;
    toggle(this.hud, 'off', !on);
  }

  update(v: HudView) {
    const now = performance.now();
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    const e = this.el;
    const u: Units = v.units;
    this.lastMode = v.mode;
    const playing = v.mode !== 'title' && v.mode !== 'loading';
    this.setHudVisible(playing && !this.titleEl);
    if (!playing) return;

    // Hole card.
    setText(e.holeNum, String(v.holeNumber));
    setText(e.holeName, v.holeName);
    setText(e.par, String(v.par));
    const upcoming = v.mode === 'walk' || v.mode === 'stance' || v.mode === 'swing' ? 1 : 0;
    setText(e.stroke, String(v.strokes + upcoming));
    setText(e.toPar, toParStr(v.toPar));
    toggle(e.toPar, 'under', v.toPar < 0);
    toggle(e.toPar, 'over', v.toPar > 0);

    // Distance + elevation ("plays like" uses a simple 1:1 elevation rule).
    const dTxt = `${dist(v.distanceToPin, u)}<small>${distUnit(u)}</small>`;
    if (e.distBig.innerHTML !== dTxt) e.distBig.innerHTML = dTxt;
    const el = v.elevationToPin;
    const flat = Math.abs(el) < 0.3;
    setText(e.elev, flat ? 'Level' : `${el > 0 ? '▲' : '▼'} ${height(Math.abs(el), u)} ${heightUnit(u)}`);
    toggle(e.elev, 'up', !flat && el > 0);
    toggle(e.elev, 'down', !flat && el < 0);
    setText(e.plays, flat ? '' : `Plays ${dist(v.distanceToPin + el, u)}`);

    // Lie badge (+ walking distance to the ball).
    const lieName = SURFACES[v.lie]?.label ?? v.lie;
    if (e.lie.dataset.lie !== v.lie) {
      e.lie.dataset.lie = v.lie;
      e.lie.innerHTML = '';
      e.lie.append(h('i'), lieName);
      e.lie.style.color = LIE_COL[v.lie] ?? '#fff';
    }
    toggle(e.lie, 'tl-hidden', v.ballInFlight);
    const showBall = v.mode === 'walk' && v.distanceToBall > 3;
    setText(e.ballDist, showBall ? `Ball ${distStr(v.distanceToBall, u)}` : '');

    // Timer.
    toggle(e.timer, 'tl-hidden', !settings.get('showTimer'));
    const tTxt = `⏱ <b>${clock(v.timer)}</b>`;
    if (e.timer.innerHTML !== tTxt) e.timer.innerHTML = tTxt;

    // Wind.
    e.windArrow.style.transform = `rotate(${v.windRelAngle.toFixed(3)}rad)`;
    const wTxt = `${windStr(v.windSpeed, u)}<small>${u === 'yards' ? 'mph' : 'km/h'}</small>`;
    if (e.windSpd.innerHTML !== wTxt) e.windSpd.innerHTML = wTxt;

    // Hint.
    const hHtml = hintHtml(v.hint);
    if (e.hint.dataset.raw !== v.hint) {
      e.hint.dataset.raw = v.hint;
      e.hint.innerHTML = hHtml;
    }

    // Club + bag.
    setText(e.clubName, v.club.name);
    setText(e.clubCarry, v.club.typicalCarry > 0 ? `Typical carry ${distStr(v.club.typicalCarry, u)} · ${v.club.loft}°` : `${v.club.loft}° loft`);
    const bk = v.bag.map((c) => c.id).join(',');
    if (bk !== this.bagKey) {
      this.bagKey = bk;
      this.bagEls = v.bag.map((c, i) => h('div', { title: c.name }, h('sup', { text: String(i + 1) }), c.short));
      e.bag.replaceChildren(...this.bagEls);
    }
    this.bagEls.forEach((b, i) => toggle(b, 'sel', i === v.club.index));

    // Rangefinder.
    toggle(e.range, 'tl-hidden', !v.rangefinder);
    if (v.rangefinder) {
      const rf = v.rangefinder;
      if (rf.distance < 0) {
        setText(e.rangeVal, '– – –');
        setText(e.rangeElev, 'No target');
      } else {
        setText(e.rangeVal, distStr(rf.distance, u));
        setText(e.rangeElev, Math.abs(rf.elevation) < 0.3 ? 'level' : `${rf.elevation > 0 ? '▲' : '▼'} ${height(Math.abs(rf.elevation), u)} ${heightUnit(u)}`);
      }
    }

    // Minimap.
    const showMap = settings.get('showMinimap') && v.mode !== 'freecam';
    toggle(this.minimap.el, 'tl-hidden', !showMap);
    if (showMap) this.minimap.update(v.holeNumber, v.player, v.ball, v.pin, v.distanceToPin, u);

    // Swing + club panels.
    toggle(this.swing.el, 'off', !v.swing);
    if (v.swing) {
      this.swing.units = u;
      this.swing.update(v.swing, dt);
    }
    toggle(this.club.el, 'off', !v.clubPanel);
    if (v.clubPanel) this.club.update(v.clubPanel, dt);
    this.shot.units = u;
    this.shot.setDocked(!!v.clubPanel);
  }

  // ───────────────────────────── shot data ─────────────────────────────

  showShotReport(r: ShotReport) {
    this.shot.units = settings.get('units');
    this.shot.show(r);
    if (r.quality === 'pure') this.swing.flash('#ffd166');
    else if (r.quality === 'good') this.swing.flash('#7ee2a0');
  }

  hideShotReport() {
    this.shot.hide();
  }

  // ───────────────────────────── scorecard ─────────────────────────────

  showScorecard(r: RoundView, final: boolean) {
    this.hideScorecard();
    this.lastRound = r;
    const cur = HOLES.findIndex((x) => String(x.number) === this.el.holeNum?.textContent);
    const el = buildScorecard(r, {
      final,
      currentHole: cur,
      showNext: this.lastMode === 'holed',
      onNext: () => {
        this.audio.ui('click');
        this.handlers.onNextHole();
      },
      onClose: () => this.hideScorecard(),
    });
    this.scorecardEl = h('div', { class: 'tl-screen tl-modal-wrap' }, el);
    this.screens.append(this.scorecardEl);
    this.audio.ui(final ? 'success' : 'open');
  }

  hideScorecard() {
    const el = this.scorecardEl;
    if (!el) return;
    this.scorecardEl = null;
    el.classList.add('closing');
    setTimeout(() => el.remove(), 300);
  }

  // ───────────────────────────── toasts / intro ─────────────────────────────

  toast(msg: string, kind: 'info' | 'good' | 'bad' | 'big' = 'info') {
    if (kind === 'big') {
      for (const old of this.overlay.querySelectorAll('.tl-bigtoast')) old.remove();
      const b = h('div', { class: 'tl-bigtoast', text: msg });
      this.overlay.append(b);
      setTimeout(() => b.remove(), 2900);
      this.audio.ui('success');
      return;
    }
    const t = h('div', { class: `tl-toast ${kind}`, text: msg });
    this.toastBox.append(t);
    while (this.toastBox.children.length > MAX_TOASTS) this.toastBox.firstElementChild!.remove();
    if (kind === 'bad') this.audio.ui('error');
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 420);
    }, TOAST_MS[kind]);
  }

  /** Hole intro card (name, par, distance, blurb). */
  holeIntro(n: number, name: string, par: number, distance: number, blurb: string) {
    for (const old of this.overlay.querySelectorAll('.tl-intro')) old.remove();
    const u = settings.get('units');
    const card = h(
      'div',
      { class: 'tl-intro' },
      h('div', { class: 'kicker', text: `Hole ${n} of ${HOLES.length}` }),
      h('h2', { text: name }),
      h('div', { class: 'meta' }, h('div', {}, h('span', { text: 'Par' }), String(par)), h('div', {}, h('span', { text: 'Length' }), distStr(distance, u))),
      h('div', { class: 'rule' }),
      h('p', { text: blurb }),
    );
    this.overlay.append(card);
    setTimeout(() => card.remove(), 5300);
  }
}
