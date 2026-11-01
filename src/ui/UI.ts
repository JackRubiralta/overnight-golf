/**
 * STUB — UI (owner: UI builder): DOM/canvas overlay — loading screen, title, HUD, swing panel,
 * club panel, shot data card, scorecard, pause & settings menus (incl. key remapping), toasts.
 */
import type { HudView, RoundView, ShotReport, UIHandlers } from '../core/view';
import type { Input } from '../core/Input';
import type { AudioSystem } from '../audio/Audio';

export class UI {
  constructor(_root: HTMLElement, _handlers: UIHandlers, _input: Input, _audio: AudioSystem) {}
  setLoading(_progress: number, _label: string) {}
  hideLoading() {}
  showTitle(_round: RoundView | null) {}
  hideTitle() {}
  showPause() {}
  hidePause() {}
  get menuOpen() {
    return false;
  }
  update(_v: HudView) {}
  showShotReport(_r: ShotReport) {}
  hideShotReport() {}
  showScorecard(_r: RoundView, _final: boolean) {}
  hideScorecard() {}
  toast(_msg: string, _kind?: 'info' | 'good' | 'bad' | 'big') {}
  /** Hole intro card (name, par, distance, blurb). */
  holeIntro(_n: number, _name: string, _par: number, _distance: number, _blurb: string) {}
}
