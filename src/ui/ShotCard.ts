/** Post-shot launch-monitor card. Auto-hides after AUTO_HIDE_S seconds. */
import type { ShotReport } from '../core/view';
import { SURFACES } from '../config';
import type { StrikeQuality } from '../physics/impact';
import { h, toggle } from './dom';
import { dist, distUnit, height, heightUnit, lr, signed, speedFromMph, speedUnit, type Units } from './format';

const AUTO_HIDE_S = 8;

const QUALITY: Record<StrikeQuality, [string, 'q-pure' | 'q-good' | 'q-warn' | 'q-bad']> = {
  pure: ['Pure', 'q-pure'],
  good: ['Solid', 'q-good'],
  toe: ['Toe', 'q-warn'],
  heel: ['Heel', 'q-warn'],
  thin: ['Thin', 'q-warn'],
  fat: ['Fat', 'q-warn'],
  skied: ['Skied', 'q-warn'],
  topped: ['Topped', 'q-bad'],
  whiff: ['Whiff', 'q-bad'],
};

export function qualityLabel(q: StrikeQuality) {
  return QUALITY[q]?.[0] ?? q;
}

export class ShotCard {
  readonly el: HTMLElement;
  private hideHandle = 0;
  private barEl: HTMLElement;
  units: Units = 'yards';

  constructor() {
    this.barEl = h('i');
    this.el = h('div', { class: 'tl-panel tl-shot off' });
  }

  show(r: ShotReport) {
    const u = this.units;
    const [qText, qCls] = QUALITY[r.quality] ?? [r.quality, 'q-warn'];
    const result = r.result === 'holed' ? 'Holed!' : r.result === 'oob' ? 'Out of bounds' : SURFACES[r.result]?.label ?? r.result;
    const du = distUnit(u);
    const su = speedUnit(u);
    const hero = (label: string, val: string, unit: string) => h('div', {}, h('span', { text: label }), h('b', {}, val, h('small', { text: unit })));
    const off = Math.abs(r.offline) < 0.5 ? '0' : `${dist(Math.abs(r.offline), u)}${r.offline > 0 ? 'R' : 'L'}`;
    const rows: [string, string][] = [
      ['Club speed', `${speedFromMph(r.clubSpeedMph, u)} ${su}`],
      ['Ball speed', `${speedFromMph(r.ballSpeedMph, u)} ${su}`],
      ['Smash', r.smash.toFixed(2)],
      ['Launch', `${r.launchV.toFixed(1)}°`],
      ['Launch dir', lr(r.launchH, 'R', 'L')],
      ['Spin', `${Math.round(r.spinRpm).toLocaleString('en-US')} rpm`],
      ['Spin axis', lr(r.spinAxis, 'R', 'L')],
      ['Apex', `${height(r.apex, u)} ${heightUnit(u)}`],
      ['Face', lr(r.face, 'open', 'closed')],
      ['Path', lr(r.path, 'in-out', 'out-in')],
      ['Face→path', `${signed(r.faceToPath)}°`],
      ['Attack', `${signed(r.attack)}°`],
      ['Dyn. loft', `${r.dynamicLoft.toFixed(1)}°`],
    ];
    const trs: HTMLElement[] = [];
    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i];
      const b = rows[i + 1];
      trs.push(h('tr', {}, h('td', { text: a[0] }), h('td', { text: a[1] }), h('td', { text: b ? b[0] : '' }), h('td', { text: b ? b[1] : '' })));
    }
    this.barEl = h('i');
    this.el.replaceChildren(
      h('div', { class: 'head' }, h('b', {}, r.club, r.practice ? h('span', { class: 'tl-label', style: 'margin-left:0.6em;color:var(--tl-gold)', text: 'Practice' }) : null), h('span', { class: `tl-badge ${qCls}`, text: qText })),
      h('div', { class: 'hero' }, hero('Carry', dist(r.carry, u), du), hero('Total', dist(r.total, u), du), hero('Offline', off, Math.abs(r.offline) < 0.5 ? '' : du)),
      h('table', {}, h('tbody', {}, ...trs)),
      h('div', { class: 'foot' }, h('span', { text: 'Result' }), h('b', { text: result })),
      h('div', { class: 'bar' }, this.barEl),
    );
    toggle(this.el, 'off', false);
    // Countdown bar: CSS transition from full to empty over the auto-hide time.
    const bar = this.barEl;
    bar.style.transform = 'scaleX(1)';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bar.style.transition = `transform ${AUTO_HIDE_S}s linear`;
        bar.style.transform = 'scaleX(0)';
      }),
    );
    clearTimeout(this.hideHandle);
    this.hideHandle = window.setTimeout(() => this.hide(), AUTO_HIDE_S * 1000);
  }

  hide() {
    clearTimeout(this.hideHandle);
    toggle(this.el, 'off', true);
  }

  setDocked(clubPanelVisible: boolean) {
    toggle(this.el, 'noclub', !clubPanelVisible);
  }
}
