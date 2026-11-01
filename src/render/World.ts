/**
 * World: owns the WebGLRenderer, scene, camera, sun light and the list of RenderModules.
 * Post-processing is provided by a RenderModule-like "post" object with render() (see Post.ts).
 */
import * as THREE from 'three';
import type { Course } from '../course/Course';
import type { CourseGrids } from '../course/CourseField';
import { settings } from '../core/settings';
import { QUALITY, createCourseTextures, globalUniforms, type CourseTextures, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';

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

  constructor(canvasParent: HTMLElement) {
    this.quality = QUALITY[settings.get('quality')];
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    canvasParent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(settings.get('fov'), 1, 0.1, this.quality.drawDistance);
    this.scene.add(this.camera);

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

  /** Called once the course is baked. Initializes every registered module. */
  async init(course: Course, grids: CourseGrids, modules: RenderModule[], post: PostPipeline | null) {
    this.course = course;
    this.grids = grids;
    this.textures = createCourseTextures(grids);
    this.modules = modules;
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
    for (const m of modules) {
      try {
        await m.init?.(this.initCtx);
      } catch (e) {
        console.error('Render module init failed', m, e);
      }
    }
    if (post) {
      try {
        await post.init(this.initCtx);
      } catch (e) {
        console.error('Post pipeline init failed, falling back to direct rendering', e);
        this.post = null;
      }
    }
    this.resize();
  }

  addModule(m: RenderModule) {
    this.modules.push(m);
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
    for (const m of this.modules) m.update?.(ctx);
    if (this.post) this.post.render(ctx);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Renderer stats for performance budgets. */
  stats() {
    const i = this.renderer.info;
    return {
      calls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
    };
  }
}
