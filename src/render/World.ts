/**
 * World: owns the WebGLRenderer, scene, camera, sun light and the list of RenderModules.
 * Post-processing is provided by a RenderModule-like "post" object with render() (see Post.ts).
 */
import * as THREE from 'three';
import type { Course } from '../course/Course';
import type { CourseGrids } from '../course/CourseField';
import { settings } from '../core/settings';
import { phase, markStart, gpuSync, PERF_SYNC } from './perf/timing';
import { FrameStats, type FrameStatsSnapshot } from './perf/FrameStats';
import { PerfHud } from './perf/PerfHud';
import { PERF_BUDGETS, QUALITY, createCourseTextures, globalUniforms, type CourseTextures, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';

export interface PostPipeline {
  init(ctx: InitContext): void | Promise<void>;
  setSize(w: number, h: number): void;
  setQuality?(q: QualityPreset): void;
  /** Render the frame (scene → screen). */
  render(ctx: FrameContext): void;
  /** Depth of field focus/strength control (menus, replays). */
  setDof?(enabled: boolean, focusDistance?: number): void;
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  modules: RenderModule[] = [];
  post: PostPipeline | null = null;
  quality: QualityPreset;
  textures!: CourseTextures;
  course!: Course;
  grids!: CourseGrids;
  time = 0;
  hole = 0;
  mode = 'menu';
  private initCtx!: InitContext;
  private syncFrames = 0;
  /** Per-frame, per-pass renderer accounting (see perf/FrameStats.ts). */
  readonly perf: FrameStats;
  private moduleNames: string[] = [];
  /** F3 perf overlay (created on first use). */
  private hud: PerfHud | null = null;

  constructor(canvasParent: HTMLElement) {
    this.quality = QUALITY[settings.get('quality')];
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    canvasParent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.1, this.quality.drawDistance);
    this.scene.add(this.camera);
    this.perf = new FrameStats(this.renderer, this.scene, this.camera);

    this.sun = new THREE.DirectionalLight(0xfff1dd, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5a6b3a, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbfcbd6, 0.0009);
    this.applyShadowQuality();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3' || e.repeat) return;
      e.preventDefault(); // F3 = "find next" in some browsers
      this.togglePerfHud();
    });
    if (new URLSearchParams(location.search).has('perf')) this.togglePerfHud(true);
    settings.subscribe((s, changed) => {
      if (changed.includes('quality')) this.setQuality(QUALITY[s.quality]);
      if (changed.includes('renderScale')) this.resize();
      if (changed.includes('fov')) {
        this.camera.fov = s.fov;
        this.camera.updateProjectionMatrix();
      }
    });
    this.resize();
  }

  /**
   * Run every module's optional prepare() (course-independent work) — call it while the course
   * bake runs in the workers. Yields between modules so worker results and the loading bar
   * are processed.
   */
  async prepare(modules: RenderModule[]) {
    for (const m of modules) {
      if (!m.prepare) continue;
      markStart();
      try {
        await m.prepare(this.renderer);
      } catch (e) {
        console.error('Render module prepare failed', m, e);
      }
      phase(`prepare ${moduleName(m)}`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** Called once the course is baked. Initializes every registered module. */
  async init(course: Course, grids: CourseGrids, modules: RenderModule[], post: PostPipeline | null) {
    this.course = course;
    this.grids = grids;
    this.textures = createCourseTextures(grids);
    this.modules = modules;
    this.moduleNames = modules.map(moduleName);
    this.post = post;
    this.initCtx = {
      scene: this.scene,
      renderer: this.renderer,
      camera: this.camera,
      course,
      grids,
      textures: this.textures,
      quality: this.quality,
      sun: this.sun,
    };
    phase('course textures');
    for (const m of modules) {
      markStart();
      try {
        await m.init?.(this.initCtx);
      } catch (e) {
        console.error('Render module init failed', m, e);
      }
      gpuSync(this.renderer.getContext());
      phase(`init ${moduleName(m)}`);
    }
    if (post) {
      markStart();
      try {
        await post.init(this.initCtx);
        phase('init Post');
      } catch (e) {
        console.error('Post pipeline init failed, falling back to direct rendering', e);
        this.post = null;
      }
    }
    this.resize();
  }

  /** Show/hide the perf overlay (F3). */
  togglePerfHud(on?: boolean) {
    this.hud ??= new PerfHud();
    this.hud.toggle(on);
  }

  /**
   * Compile every material in the scene before the first frame, in parallel where the driver
   * supports KHR_parallel_shader_compile (the loading screen stays responsive meanwhile).
   * Programs are compiled for the render-target colour space the frame will really use (the
   * post chain renders the scene into a linear HalfFloat target; compiling against the canvas
   * would build sRGB variants that are never used and double the program count).
   * Shadow-depth and post-processing programs still compile on the first (warm-up) frame.
   */
  async compileShaders(): Promise<void> {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const rt = this.post ? new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true }) : null;
    this.camera.updateMatrixWorld();
    r.setRenderTarget(rt);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(this.scene, this.camera);
    } finally {
      r.setRenderTarget(prev);
    }
    await p;
    rt?.dispose();
  }

  addModule(m: RenderModule) {
    this.modules.push(m);
    this.moduleNames.push(moduleName(m));
    if (this.initCtx) void m.init?.(this.initCtx);
  }

  setQuality(q: QualityPreset) {
    this.quality = q;
    this.camera.far = q.drawDistance;
    this.camera.updateProjectionMatrix();
    this.applyShadowQuality();
    for (const m of this.modules) m.setQuality?.(q);
    this.post?.setQuality?.(q);
    this.resize();
  }

  private applyShadowQuality() {
    const q = this.quality;
    const s = this.sun.shadow;
    s.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    s.map?.dispose();
    (s as { map: THREE.WebGLRenderTarget | null }).map = null;
    const cam = s.camera as THREE.OrthographicCamera;
    const d = q.shadowDistance;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * settings.get('renderScale');
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(Math.floor(w * pr), Math.floor(h * pr));
  }

  /** Keep the sun's shadow frustum centred on the area of interest (texel-snapped to avoid shimmer). */
  updateSunShadow(focus: THREE.Vector3) {
    const dir = globalUniforms.uSunDir.value;
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + dir.x * 500, focus.y + dir.y * 500, fz + dir.z * 500);
    this.sun.target.updateMatrixWorld();
  }

  frame(dt: number) {
    this.time += dt;
    globalUniforms.uTime.value = this.time;
    globalUniforms.uCameraPos.value.copy(this.camera.position);
    const ctx: FrameContext = {
      time: this.time,
      dt,
      camera: this.camera,
      renderer: this.renderer,
      scene: this.scene,
      course: this.course,
      quality: this.quality,
      hole: this.hole,
      mode: this.mode,
    };
    const perf = this.perf;
    perf.begin();
    if (PERF_SYNC && this.syncFrames < 3) {
      // ?perfsync: per-module GPU-synchronised breakdown of the first frames (load profiling).
      this.syncFrames++;
      const gl = this.renderer.getContext();
      gpuSync(gl);
      markStart();
      for (const m of this.modules) {
        m.update?.(ctx);
        gpuSync(gl);
        phase(`frame${this.syncFrames} update ${m.constructor.name}`);
      }
      if (this.post) this.post.render(ctx);
      else this.renderer.render(this.scene, this.camera);
      gpuSync(gl);
      phase(`frame${this.syncFrames} render`);
      perf.end();
      return;
    }
    const mods = this.modules;
    for (let i = 0; i < mods.length; i++) {
      perf.setBucket(this.moduleNames[i]);
      mods[i].update?.(ctx);
    }
    perf.setBucket('post');
    if (this.post) this.post.render(ctx);
    else this.renderer.render(this.scene, this.camera);
    perf.end();
    if (this.hud?.visible) this.hud.frame(perf.frameMs, () => this.stats(), PERF_BUDGETS[this.quality.level]);
  }

  /**
   * Renderer stats of the last frame for performance budgets: totals over every pass, a per-pass
   * breakdown (main, shadow, sky = cloud cube, water = planar reflection, post, …), memory,
   * timings and the active preset.
   */
  stats(): FrameStatsSnapshot & { preset: string; pixelRatio: number; size: [number, number]; budget: { calls: number; triangles: number } } {
    const s = this.renderer.getDrawingBufferSize(_size);
    return { ...this.perf.snapshot(), preset: this.quality.level, pixelRatio: this.renderer.getPixelRatio(), size: [s.x, s.y], budget: PERF_BUDGETS[this.quality.level] };
  }
}

const _size = new THREE.Vector2();

function moduleName(m: RenderModule): string {
  return (m.perfName ?? m.constructor.name ?? 'module').toLowerCase();
}
