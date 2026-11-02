/** Scorecard modal: 9 holes, par, strokes (classic circle/square notation), putts, splits, totals. */
import type { RoundView } from '../core/view';
import { HOLES } from '../course/layout';
import { h } from './dom';
import { clock, toParStr } from './format';

export function scoreClass(strokes: number, par: number) {
  const d = strokes - par;
  return d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : 'double';
}

/** Map each recorded split (cumulative time at hole-out) to its hole index, if the completed holes
 *  form one contiguous run (holes are played in order from the start hole, wrapping). For a full
 *  card the start hole can't be told from the card alone, so hole 1 is assumed. */
function splitHoles(r: RoundView): number[] | null {
  const n = r.holes.length;
  const done = r.holes.map((x) => x.strokes !== null);
  const count = done.filter(Boolean).length;
  if (count !== r.splits.length || count === 0) return null;
  const seq = (s: number) => Array.from({ length: count }, (_, i) => (s + i) % n);
  if (count === n) return seq(0);
  for (let s = 0; s < n; s++) if (!done[(s + n - 1) % n] && seq(s).every((i) => done[i])) return seq(s);
  return null;
}

export interface ScorecardOpts {
  final: boolean;
  currentHole: number; // 0-based, -1 for none
  showNext: boolean;
  onNext: () => void;
  onClose: () => void;
}

export function buildScorecard(r: RoundView, o: ScorecardOpts): HTMLElement {
  const holes = r.holes;
  const cols = holes.map((_, i) => i);
  const th = (t: string, cls = '') => h('th', { class: cls, text: t });
  const td = (c: Node | string, cls = '') => h('td', { class: cls }, c);
  const curCls = (i: number) => (i === o.currentHole && !o.final ? 'cur' : '');
  const played = holes.filter((x) => x.strokes !== null);
  const parPlayed = played.reduce((s, x) => s + x.par, 0);
  const strokes = played.reduce((s, x) => s + (x.strokes ?? 0), 0);
  const putts = holes.reduce((s, x) => s + x.putts, 0);
  const toPar = strokes - parPlayed;

  // Running to-par line.
  let run = 0;
  const running = holes.map((x) => {
    if (x.strokes === null) return '';
    run += x.strokes - x.par;
    return toParStr(run);
  });
  const sh = splitHoles(r);
  const splitByHole: (string | null)[] = holes.map(() => null);
  if (sh) sh.forEach((hi, k) => (splitByHole[hi] = clock(r.splits[k] - (k ? r.splits[k - 1] : 0))));

  const table = h(
    'table',
    { class: 'tl-sc' },
    h('thead', {}, h('tr', {}, th('Hole'), ...cols.map((i) => { const c = th(String(holes[i].number), curCls(i)); c.title = HOLES[i]?.name ?? ''; return c; }), th('Total', 'tot'))),
    h(
      'tbody',
      {},
      h('tr', {}, td('Par'), ...cols.map((i) => td(String(holes[i].par), curCls(i))), td(String(r.totalPar), 'tot')),
      h(
        'tr',
        {},
        td('Score'),
        ...cols.map((i) => {
          const x = holes[i];
          return td(x.strokes === null ? h('span', { style: 'color:var(--tl-faint)', text: '·' }) : h('span', { class: `tl-score ${scoreClass(x.strokes, x.par)}`, text: String(x.strokes) }), curCls(i));
        }),
        td(played.length ? String(strokes) : '–', 'tot'),
      ),
      h('tr', {}, td('Putts'), ...cols.map((i) => td(holes[i].strokes === null ? '' : String(holes[i].putts), curCls(i))), td(String(putts), 'tot')),
      h('tr', {}, td('To par'), ...cols.map((i) => td(running[i], curCls(i))), td(played.length ? toParStr(toPar) : '–', 'tot')),
      sh ? h('tr', {}, td('Split'), ...cols.map((i) => td(h('span', { style: 'font-size:0.8em;color:var(--tl-dim)', text: splitByHole[i] ?? '' }), curCls(i))), td(clock(r.timer), 'tot')) : null,
    ),
  );

  const fwHoles = holes.filter((x) => x.fairway !== null);
  const fw = fwHoles.filter((x) => x.fairway).length;
  const gir = played.filter((x) => x.gir).length;
  const pens = holes.reduce((s, x) => s + x.penalties, 0);
  const stat = (label: string, val: string) => h('div', {}, h('span', { text: label }), h('b', { text: val }));
  const summary = h(
    'div',
    { class: 'tl-sc-sum' },
    stat('Fairways', fwHoles.length ? `${fw}/${fwHoles.length}` : '–'),
    stat('Greens in reg.', played.length ? `${gir}/${played.length}` : '–'),
    stat('Putts', String(putts)),
    stat('Penalties', String(pens)),
    stat('Time', clock(r.timer)),
  );
  const legend = h(
    'div',
    { class: 'tl-sc-legend' },
    ...([['eagle', 'Eagle or better'], ['birdie', 'Birdie'], ['par', 'Par'], ['bogey', 'Bogey'], ['double', 'Double+']] as const).map(([c, t]) => h('span', {}, h('span', { class: `tl-score ${c}`, text: c === 'par' ? '4' : '' }), t)),
  );

  let finalBlock: HTMLElement | null = null;
  if (o.final) {
    const isBest = r.best.strokes !== null && r.best.strokes === r.totalStrokes;
    finalBlock = h(
      'div',
      { class: 'tl-sc-final' },
      h('div', { class: 'tl-label', text: 'Round complete' }),
      h('div', { class: 'big' }, String(r.totalStrokes), h('small', { class: `tl-topar ${toPar < 0 ? 'under' : toPar > 0 ? 'over' : ''}`, text: toParStr(r.totalStrokes - r.totalPar) })),
      h('div', { style: 'color:var(--tl-dim);margin-top:0.4em', text: `Best ${r.best.strokes ?? '–'} · Best time ${r.best.time !== null ? clock(r.best.time) : '–'}` }),
      isBest ? h('div', { class: 'tl-newbest', text: 'PERSONAL BEST' }) : null,
    );
  }

  const footer = h('footer', {});
  if (o.showNext || o.final)
    footer.append(h('button', { class: 'tl-btn small primary', html: o.final ? 'Back to the clubhouse' : 'Next hole <small>Tab / Space</small>', onclick: o.onNext }));
  else footer.append(h('span', { class: 'tl-label', html: 'Press <kbd class="tl-kbd">`</kbd> to close' }));

  return h(
    'div',
    { class: 'tl-modal tl-scorecard' },
    h('header', {}, h('h2', { text: r.courseName }), h('span', { class: 'tl-label', text: o.final ? 'Final scorecard' : `Scorecard · ${played.length}/${holes.length} holes` })),
    h('div', { class: 'body' }, finalBlock, table, summary, legend),
    footer,
  );
}
