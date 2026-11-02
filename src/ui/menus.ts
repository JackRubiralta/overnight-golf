/**
 * Settings and Controls screens (modal). Settings write through settings.set(); the Controls
 * screen lists every action with its keyboard/mouse and gamepad bindings and rebinds on click
 * through the InputBridge (see inputContract.ts).
 */
import { ACTIONS, ACTION_LABELS, STANCE_ONLY, WALK_ONLY, type Action } from '../core/actions';
import { DEFAULT_SETTINGS, settings, type Settings } from '../core/settings';
import type { AudioSystem } from '../audio/Audio';
import { h } from './dom';
import { keyLabel, padLabel, type InputBridge } from './inputContract';

type Key = keyof Settings;
type Row =
  | { key: Key; label: string; help?: string; kind: 'seg'; options: [string, string][] }
  | { key: Key; label: string; help?: string; kind: 'switch' }
  | { key: Key; label: string; help?: string; kind: 'slider'; min: number; max: number; step: number; fmt: (v: number) => string };
interface Group {
  title?: string;
  rows: Row[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mult = (v: number) => `${v.toFixed(2)}×`;

export const SETTINGS_TABS: { id: string; label: string; groups: Group[] }[] = [
  {
    id: 'graphics',
    label: 'Graphics',
    groups: [
      {
        rows: [
          { key: 'quality', label: 'Quality preset', help: 'Grass density, shadows, reflections and post effects', kind: 'seg', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']] },
          { key: 'renderScale', label: 'Render scale', help: 'Resolution multiplier on your display', kind: 'slider', min: 0.5, max: 1.5, step: 0.05, fmt: pct },
          { key: 'fov', label: 'Field of view', kind: 'slider', min: 40, max: 90, step: 1, fmt: (v) => `${v.toFixed(0)}°` },
        ],
      },
      {
        title: 'Atmosphere',
        rows: [
          { key: 'timeOfDay', label: 'Time of day', kind: 'seg', options: [['dawn', 'Dawn'], ['morning', 'Morning'], ['noon', 'Noon'], ['golden', 'Golden'], ['dusk', 'Dusk']] },
          { key: 'weather', label: 'Weather', help: 'Also sets how strong the wind blows', kind: 'seg', options: [['calm', 'Calm'], ['breezy', 'Breezy'], ['windy', 'Windy'], ['rain', 'Rain']] },
        ],
      },
    ],
  },
  {
    id: 'controls',
    label: 'Controls',
    groups: [
      {
        title: 'Swing',
        rows: [
          { key: 'mouseSensitivity', label: 'Swing sensitivity', kind: 'slider', min: 0.25, max: 3, step: 0.05, fmt: mult },
          { key: 'mouseSmoothing', label: 'Swing smoothing', help: 'Filters jitter from the mouse at the cost of a little lag', kind: 'slider', min: 0, max: 0.9, step: 0.05, fmt: pct },
          { key: 'invertSwingY', label: 'Invert swing vertical', kind: 'switch' },
          { key: 'invertSwingX', label: 'Invert swing horizontal', kind: 'switch' },
          { key: 'lookSensitivity', label: 'Look sensitivity', help: 'Mouse-look while walking', kind: 'slider', min: 0.25, max: 3, step: 0.05, fmt: mult },
        ],
      },
      {
        title: 'Assists',
        rows: [
          { key: 'assist', label: 'Assist level', help: 'Off is the full challenge: face and path wobble while you address', kind: 'seg', options: [['off', 'Off'], ['light', 'Light'], ['full', 'Full']] },
          { key: 'showStartLine', label: 'Start-line hint', help: 'Draws the predicted start direction in the club panel', kind: 'switch' },
          { key: 'showGhostSwing', label: 'Ghost swing', help: 'Shows your previous hand path in the swing panel', kind: 'switch' },
          { key: 'showShotData', label: 'Shot data card', help: 'Launch-monitor numbers after every shot', kind: 'switch' },
        ],
      },
      {
        title: 'Improvements',
        rows: [
          { key: 'fineAdjustWithShift', label: 'Fine adjust with Shift', help: 'Hold to make face / path / aim changes smaller', kind: 'switch' },
          { key: 'resetKeyEnabled', label: 'Square-up key', help: 'One key resets face and path to square', kind: 'switch' },
          { key: 'practiceSwingEnabled', label: 'Practice swings', help: 'Swing without the ball to feel the speed', kind: 'switch' },
          { key: 'gamepadEnabled', label: 'Gamepad', kind: 'switch' },
          { key: 'gamepadVibration', label: 'Gamepad vibration', kind: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    groups: [
      {
        rows: [
          { key: 'masterVolume', label: 'Master volume', kind: 'slider', min: 0, max: 1, step: 0.01, fmt: pct },
          { key: 'sfxVolume', label: 'Effects', help: 'Swing, strike, ball and interface sounds', kind: 'slider', min: 0, max: 1, step: 0.01, fmt: pct },
          { key: 'ambienceVolume', label: 'Ambience', help: 'Wind, birds and rain', kind: 'slider', min: 0, max: 1, step: 0.01, fmt: pct },
        ],
      },
    ],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    groups: [
      {
        rows: [
          { key: 'units', label: 'Units', kind: 'seg', options: [['yards', 'Yards'], ['metres', 'Metres']] },
          { key: 'showTimer', label: 'Round timer', kind: 'switch' },
          { key: 'showMinimap', label: 'Hole map', kind: 'switch' },
        ],
      },
    ],
  },
];

/** Builds the settings modal. Returns the element and a refresh() to resync from the store. */
export function buildSettings(audio: AudioSystem, onBack: () => void) {
  const refreshers: (() => void)[] = [];
  const body = h('div', { class: 'body' });
  const tabBtns: HTMLButtonElement[] = [];
  let current = SETTINGS_TABS[0].id;

  const rowEl = (r: Row) => {
    const lbl = h('div', { class: 'lbl' }, h('b', { text: r.label }), r.help ? h('span', { text: r.help }) : null);
    let ctl: HTMLElement;
    if (r.kind === 'seg') {
      const btns = r.options.map(([val, text]) =>
        h('button', {
          text,
          onclick: () => {
            settings.set({ [r.key]: val } as Partial<Settings>);
            audio.ui('click');
          },
        }),
      );
      ctl = h('div', { class: 'tl-seg' }, ...btns);
      refreshers.push(() => btns.forEach((b, i) => b.classList.toggle('on', settings.get(r.key) === r.options[i][0])));
    } else if (r.kind === 'switch') {
      const sw = h('button', {
        class: 'tl-switch',
        'aria-label': r.label,
        onclick: () => {
          settings.set({ [r.key]: !settings.get(r.key) } as Partial<Settings>);
          audio.ui('click');
        },
      });
      ctl = sw;
      refreshers.push(() => sw.classList.toggle('on', !!settings.get(r.key)));
    } else {
      const input = h('input', { type: 'range', min: r.min, max: r.max, step: r.step, 'aria-label': r.label });
      const out = h('output');
      let lastTick = 0;
      input.addEventListener('input', () => {
        settings.set({ [r.key]: Number(input.value) } as Partial<Settings>);
        const now = performance.now();
        if (now - lastTick > 70) {
          audio.ui('tick');
          lastTick = now;
        }
      });
      const sync = () => {
        const v = Number(settings.get(r.key));
        if (document.activeElement !== input) input.value = String(v);
        out.textContent = r.fmt(v);
        input.style.setProperty('--p', `${((v - r.min) / (r.max - r.min)) * 100}%`);
      };
      refreshers.push(sync);
      ctl = h('div', { class: 'tl-slider' }, input, out);
    }
    return h('div', { class: 'tl-row' }, lbl, ctl);
  };

  const render = () => {
    refreshers.length = 0;
    body.replaceChildren();
    const tab = SETTINGS_TABS.find((t) => t.id === current)!;
    for (const g of tab.groups) {
      if (g.title) body.append(h('div', { class: 'tl-label tl-group-title', text: g.title }));
      for (const r of g.rows) body.append(rowEl(r));
    }
    tabBtns.forEach((b, i) => b.classList.toggle('on', SETTINGS_TABS[i].id === current));
    refresh();
  };
  const refresh = () => refreshers.forEach((f) => f());

  for (const t of SETTINGS_TABS) {
    tabBtns.push(
      h('button', {
        class: 'tl-tab',
        text: t.label,
        onclick: () => {
          current = t.id;
          audio.ui('tick');
          render();
        },
      }),
    );
  }
  const resetTab = () => {
    const tab = SETTINGS_TABS.find((t) => t.id === current)!;
    const patch: Partial<Settings> = {};
    for (const g of tab.groups) for (const r of g.rows) (patch as Record<string, unknown>)[r.key] = DEFAULT_SETTINGS[r.key];
    settings.set(patch);
    audio.ui('click');
  };
  const el = h(
    'div',
    { class: 'tl-modal tl-settings' },
    h('header', {}, h('h2', { text: 'Settings' }), h('span', { class: 'tl-label', text: 'Saved automatically' })),
    h('div', { class: 'tl-tabs' }, ...tabBtns),
    body,
    h('footer', {}, h('button', { class: 'tl-btn small', text: 'Reset this tab', onclick: resetTab }), h('button', { class: 'tl-btn small primary', text: 'Done', onclick: onBack })),
  );
  render();
  settings.subscribe(() => refresh());
  return { el, refresh };
}

const GROUPS: { title: string; actions: Action[] }[] = [
  { title: 'Walking', actions: ['moveForward', 'moveBack', 'moveLeft', 'moveRight', 'run', 'crouch', 'jump', 'returnToBall'] },
  { title: 'Address & swing', actions: ['toggleStance', 'swingGrab', 'faceClose', 'faceOpen', 'pathIn', 'pathOut', 'aimLeft', 'aimRight', 'stanceForward', 'stanceBack', 'fine', 'resetFacePath', 'practiceSwing', 'retake', 'rangefinder'] },
  { title: 'Clubs', actions: ['club1', 'club2', 'club3', 'club4', 'club5', 'clubNext', 'clubPrev'] },
  { title: 'Camera & menus', actions: ['freeCam', 'map', 'scorecard', 'pause'] },
];
// Any action not listed above still appears (future-proof).
const listed = new Set(GROUPS.flatMap((g) => g.actions));
const extra = ACTIONS.filter((a) => !listed.has(a));
if (extra.length) GROUPS.push({ title: 'Other', actions: extra });

const KEY_SLOTS = 2;
const PAD_SLOTS = 1;

/** Builds the controls/rebinding modal. */
export function buildControls(input: InputBridge, audio: AudioSystem, toast: (m: string, k?: 'info' | 'good' | 'bad') => void, onBack: () => void) {
  const body = h('div', { class: 'body' });
  let capturing: HTMLElement | null = null;
  const state = { capturing: false, endedAt: 0 };

  const startCapture = (chip: HTMLElement, action: Action, device: 'kbm' | 'pad', index: number) => {
    if (!input.canRebind) {
      toast('Rebinding is not available in this build', 'bad');
      audio.ui('error');
      return;
    }
    if (capturing) input.cancelCapture();
    capturing = chip;
    state.capturing = true;
    chip.classList.add('capturing');
    chip.textContent = device === 'kbm' ? 'Press a key…' : 'Press a button…';
    audio.ui('open');
    input.capture(device, (code) => {
      capturing = null;
      state.capturing = false;
      state.endedAt = performance.now();
      if (code === null || code === undefined) {
        audio.ui('close');
      } else {
        const ok = device === 'kbm' ? input.setKey(action, index, String(code)) : input.setPad(action, index, Number(code));
        audio.ui(ok ? 'success' : 'error');
        if (!ok) toast('Could not change that binding', 'bad');
      }
      render();
    });
  };

  const clearBinding = (action: Action, device: 'kbm' | 'pad', index: number) => {
    const ok = device === 'kbm' ? input.setKey(action, index, null) : input.setPad(action, index, null);
    audio.ui(ok ? 'click' : 'error');
    render();
  };

  const render = () => {
    const keys = input.keys();
    const pad = input.pad();
    body.replaceChildren(
      h('p', { class: 'tl-note', text: 'Click a binding, then press the new key, mouse button or gamepad button. Esc cancels, right-click a binding to clear it. Some keys are shared between walking and the golf stance on purpose.' }),
      h('div', { class: 'tl-bind-row tl-bind-head' }, h('span', { text: 'Action' }), h('span', { text: 'Keyboard / mouse' }), h('span', { text: 'Gamepad' })),
    );
    for (const g of GROUPS) {
      body.append(h('div', { class: 'tl-label tl-group-title', text: g.title }));
      for (const a of g.actions) {
        const ctx = STANCE_ONLY.includes(a) ? 'stance' : WALK_ONLY.includes(a) ? 'walking' : '';
        const mk = (device: 'kbm' | 'pad', i: number, label: string | null) => {
          const chip = h('button', { class: `tl-chip${label ? '' : ' empty'}${input.canRebind ? '' : ' disabled'}`, text: label ?? '—', title: label ? 'Click to rebind, right-click to clear' : 'Click to bind' });
          chip.addEventListener('click', () => startCapture(chip, a, device, i));
          chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (label) clearBinding(a, device, i);
          });
          return chip;
        };
        const kb = keys[a] ?? [];
        const pb = pad[a] ?? [];
        const kSlots = Array.from({ length: Math.max(KEY_SLOTS, kb.length) }, (_, i) => mk('kbm', i, kb[i] ? keyLabel(kb[i]) : null)).slice(0, Math.max(KEY_SLOTS, kb.length));
        const pSlots = Array.from({ length: Math.max(PAD_SLOTS, pb.length) }, (_, i) => mk('pad', i, pb[i] !== undefined ? padLabel(pb[i]) : null));
        body.append(
          h('div', { class: 'tl-bind-row' }, h('span', {}, ACTION_LABELS[a], ctx ? h('span', { class: 'ctx', text: ctx }) : null), h('div', { class: 'tl-slots' }, ...kSlots), h('div', { class: 'tl-slots' }, ...pSlots)),
        );
      }
    }
    body.append(h('p', { class: 'tl-note', text: 'Gamepad: left stick walks, right stick moves the hands during the swing.' }));
  };

  const el = h(
    'div',
    { class: 'tl-modal tl-controls' },
    h('header', {}, h('h2', { text: 'Controls' }), h('span', { class: 'tl-label', text: input.canRebind ? 'Click to rebind' : 'Default bindings' })),
    body,
    h(
      'footer',
      {},
      h('button', {
        class: 'tl-btn small',
        text: 'Reset to defaults',
        onclick: () => {
          const ok = input.reset();
          audio.ui(ok ? 'click' : 'error');
          if (ok) toast('Bindings reset to defaults', 'good');
          render();
        },
      }),
      h('button', {
        class: 'tl-btn small primary',
        text: 'Done',
        onclick: () => {
          if (capturing) input.cancelCapture();
          onBack();
        },
      }),
    ),
  );
  return {
    el,
    render,
    state,
    cancel: () => {
      if (capturing) input.cancelCapture();
    },
  };
}
