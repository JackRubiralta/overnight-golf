/** Round state: scores per hole, penalties, putts, timer, splits and personal bests. */
import { HOLES, COURSE_NAME } from '../course/layout';
import { safeLoad, safeSave } from '../core/storage';
import type { HoleScore, RoundView } from '../core/view';

const BEST_KEY = 'tl-golf.best.v1';

interface Best {
  strokes: number | null;
  time: number | null;
  holes: Record<number, number>;
}

export class Round {
  holes: HoleScore[] = HOLES.map((h) => ({ number: h.number, par: h.par, strokes: null, putts: 0, fairway: null, gir: false, penalties: 0 }));
  current = 0;
  /** Strokes on the current hole (including penalties). */
  strokes = 0;
  started = false;
  timer = 0;
  splits: number[] = [];
  finished = false;
  mode: 'round' | 'practice' = 'round';
  best: Best;

  constructor() {
    this.best = safeLoad<Best>(BEST_KEY) ?? { strokes: null, time: null, holes: {} };
  }

  reset(startHole = 0, mode: 'round' | 'practice' = 'round') {
    this.holes = HOLES.map((h) => ({ number: h.number, par: h.par, strokes: null, putts: 0, fairway: null, gir: false, penalties: 0 }));
    this.current = startHole;
    this.strokes = 0;
    this.started = false;
    this.timer = 0;
    this.splits = [];
    this.finished = false;
    this.mode = mode;
  }

  get hole() {
    return HOLES[this.current];
  }

  tick(dt: number, running: boolean) {
    if (this.started && !this.finished && running) this.timer += dt;
  }

  addStroke(onGreen: boolean) {
    this.started = true;
    this.strokes++;
    if (onGreen) this.holes[this.current].putts++;
  }

  addPenalty(n = 1) {
    this.strokes += n;
    this.holes[this.current].penalties += n;
  }

  /** Record what happened on the first shot of a par 4/5 and greens in regulation. */
  noteResult(strokeNumber: number, surface: string) {
    const hs = this.holes[this.current];
    if (strokeNumber === 1 && hs.par >= 4) hs.fairway = surface === 'fairway';
    if ((surface === 'green' || surface === 'holed') && strokeNumber <= hs.par - 2) hs.gir = true;
  }

  holeOut() {
    const hs = this.holes[this.current];
    hs.strokes = this.strokes;
    this.splits.push(this.timer);
    const prev = this.best.holes[hs.number];
    if (this.mode === 'round' && (prev === undefined || this.strokes < prev)) this.best.holes[hs.number] = this.strokes;
    if (this.holes.every((h) => h.strokes !== null)) {
      this.finished = true;
      const total = this.totalStrokes;
      if (this.mode === 'round') {
        if (this.best.strokes === null || total < this.best.strokes) this.best.strokes = total;
        if (this.best.time === null || this.timer < this.best.time) this.best.time = this.timer;
      }
    }
    safeSave(BEST_KEY, this.best);
  }

  /** Advance to the next unplayed hole. Returns false if the round is over. */
  next(): boolean {
    for (let k = 1; k <= HOLES.length; k++) {
      const i = (this.current + k) % HOLES.length;
      if (this.holes[i].strokes === null) {
        this.current = i;
        this.strokes = 0;
        return true;
      }
    }
    return false;
  }

  get totalStrokes() {
    return this.holes.reduce((s, h) => s + (h.strokes ?? 0), 0);
  }

  get toPar() {
    let d = 0;
    for (const h of this.holes) if (h.strokes !== null) d += h.strokes - h.par;
    return d;
  }

  view(): RoundView {
    return {
      courseName: COURSE_NAME,
      holes: this.holes.map((h) => ({ ...h })),
      totalStrokes: this.totalStrokes,
      totalPar: this.holes.reduce((s, h) => s + h.par, 0),
      timer: this.timer,
      finished: this.finished,
      best: { strokes: this.best.strokes, time: this.best.time },
      splits: [...this.splits],
    };
  }
}
