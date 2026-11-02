/**
 * Perf overlay (toggle with F3, or open at start with `?perf`): fps, frame/CPU time, draw calls,
 * triangles, programs, textures, geometries, the active preset and its budget, and a per-pass
 * breakdown (main, shadow, sky = cloud-cube face, water = planar reflection, post …).
 * Pure DOM, refreshed 4× a second; costs nothing while hidden.
 */
import type { FrameStatsSnapshot } from './FrameStats';

export interface PerfBudget {
  calls: number;
  triangles: number;
}

export type HudStats = FrameStatsSnapshot & { preset: string; pixelRatio: number; size: [number, number] };

const REFRESH_MS = 250;
const GRAPH_N = 120;

const fmtTris = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

export class PerfHud {
  readonly el: HTMLDivElement;
  private text: HTMLPreElement;
  private graph: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private frameTimes = new Float32Array(GRAPH_N);
  private head = 0;
  private lastRefresh = 0;
  visible = false;

  constructor(parent: HTMLElement = document.body) {
    const el = document.createElement('div');
    el.id = 'perf-hud';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      zIndex: '10000',
      padding: '6px 8px',
      background: 'rgba(8, 12, 10, 0.78)',
      color: '#d8f0d8',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      borderRadius: '4px',
      pointerEvents: 'none',
      display: 'none',
      whiteSpace: 'pre',
      maxWidth: 'calc(100vw - 16px)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.text = document.createElement('pre');
    Object.assign(this.text.style, { margin: '0', font: 'inherit' });
    this.graph = document.createElement('canvas');
    this.graph.width = GRAPH_N * 2;
    this.graph.height = 36;
    Object.assign(this.graph.style, { display: 'block', width: `${GRAPH_N * 2}px`, height: '36px', marginTop: '4px' });
    this.g = this.graph.getContext('2d');
    el.append(this.text, this.graph);
    parent.appendChild(el);
    this.el = el;
  }

  toggle(on = !this.visible) {
    this.visible = on;
    this.el.style.display = on ? 'block' : 'none';
    this.lastRefresh = 0;
  }

  /** Feed one frame (cheap); the text/graph refresh at REFRESH_MS. */
  frame(frameMs: number, getStats: () => HudStats, budget: PerfBudget | undefined) {
    if (!this.visible) return;
    this.frameTimes[this.head] = frameMs;
    this.head = (this.head + 1) % GRAPH_N;
    const now = performance.now();
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    this.render(getStats(), budget);
  }

  private render(s: HudStats, budget: PerfBudget | undefined) {
    const over = (v: number, b: number | undefined) => (b !== undefined && v > b ? ' ▲' : '');
    const lines = [
      `${s.preset.toUpperCase()}  ${s.size[0]}×${s.size[1]} @${s.pixelRatio.toFixed(2)}`,
      `fps ${s.fps.toFixed(1).padStart(5)}   frame ${s.frameMs.toFixed(1).padStart(5)} ms   cpu ${s.cpuMs.toFixed(1)} ms`,
      `calls ${String(s.calls).padStart(4)}${budget ? ` / ${budget.calls}` : ''}${over(s.calls, budget?.calls)}   tris ${fmtTris(s.triangles)}${budget ? ` / ${fmtTris(budget.triangles)}` : ''}${over(s.triangles, budget?.triangles)}`,
      `programs ${s.programs}   textures ${s.textures}   geometries ${s.geometries}`,
      ...Object.entries(s.passes)
        .filter(([, c]) => c.calls > 0)
        .sort((a, b) => b[1].calls - a[1].calls)
        .map(([k, c]) => `  ${k.padEnd(8)} ${String(c.calls).padStart(4)} calls  ${fmtTris(c.triangles).padStart(6)} tris`),
    ];
    this.text.textContent = lines.join('\n');
    const bad = budget && (s.calls > budget.calls || s.triangles > budget.triangles);
    this.el.style.outline = bad ? '1px solid #e05a4a' : 'none';
    this.drawGraph();
  }

  /** Frame-time graph: 0–50 ms, guides at 16.7 ms (60 fps) and 33.3 ms (30 fps). */
  private drawGraph() {
    const g = this.g;
    if (!g) return;
    const W = this.graph.width;
    const H = this.graph.height;
    g.clearRect(0, 0, W, H);
    const y = (ms: number) => H - Math.min(1, ms / 50) * H;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, y(16.7), W, 1);
    g.fillRect(0, y(33.3), W, 1);
    for (let i = 0; i < GRAPH_N; i++) {
      const ms = this.frameTimes[(this.head + i) % GRAPH_N];
      if (!ms) continue;
      g.fillStyle = ms <= 17.5 ? '#7ccf7c' : ms <= 34 ? '#e3c25a' : '#e05a4a';
      const top = y(ms);
      g.fillRect(i * 2, top, 2, H - top);
    }
  }

  dispose() {
    this.el.remove();
  }
}
