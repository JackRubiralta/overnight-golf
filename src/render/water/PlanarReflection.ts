/**
 * Horizontal planar reflection (Reflector-style, after three/addons Reflector.js, MIT):
 * a mirrored virtual camera renders the scene into a half-resolution HDR target, using an
 * oblique near plane so nothing below the water plane leaks into the reflection.
 *
 * Cost control:
 *  - resolution is a fraction of the drawing buffer (per quality preset),
 *  - the sun shadow map is NOT re-rendered for the reflection pass,
 *  - objects with `userData.noReflect = true` at any depth (grass, small props, fences, rocks,
 *    flowers …) are hidden; the flagged list is collected by a scene traversal every
 *    REFRESH_FRAMES frames, not per render,
 *  - the caller only renders when a water body is actually in view,
 *  - an optional screen rectangle (the water body's projected bounds) scissors the pass, so
 *    only the pixels the water can sample are shaded.
 */
import * as THREE from 'three';

const CLIP_BIAS = 0.0;
/** Re-collect the `userData.noReflect` objects every this many reflection renders. */
const REFRESH_FRAMES = 120;

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  /** World → reflection-texture (projective) matrix. */
  readonly textureMatrix = new THREE.Matrix4();
  readonly camera = new THREE.PerspectiveCamera();
  /** Fraction of the drawing buffer resolution. */
  scale = 0.5;
  /** Extra objects to hide while rendering (the water mesh itself). */
  hide: THREE.Object3D[] = [];

  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private planePos = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private look = new THREE.Vector3();
  private view = new THREE.Vector3();
  private tgt = new THREE.Vector3();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  private size = new THREE.Vector2();
  private hidden: THREE.Object3D[] = [];
  private flagged: THREE.Object3D[] = [];
  private flaggedAge = Infinity;
  private flaggedScene: THREE.Scene | null = null;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: 0,
    });
    this.target.texture.generateMipmaps = false;
    this.target.texture.name = 'water-reflection';
    this.camera.matrixAutoUpdate = true;
  }

  /**
   * Render the reflection of `scene` seen by `camera` in the plane y = level.
   * Returns false (and renders nothing) when the camera is below the plane.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, level: number, rect: THREE.Vector4 | null = null): boolean {
    this.planePos.set(camera.position.x, level, camera.position.z);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    this.view.subVectors(this.planePos, this.camPos);
    if (this.view.dot(this.normal) > 0) return false;

    // Resize to a fraction of the drawing buffer.
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(64, Math.round(this.size.x * this.scale));
    const h = Math.max(64, Math.round(this.size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    // Scissor to the water's screen rectangle (x0, y0, x1, y1 in 0..1), when given.
    if (rect) {
      const x0 = Math.max(0, Math.floor(rect.x * w));
      const y0 = Math.max(0, Math.floor(rect.y * h));
      const x1 = Math.min(w, Math.ceil(rect.z * w));
      const y1 = Math.min(h, Math.ceil(rect.w * h));
      if (x1 <= x0 || y1 <= y0) return false;
      this.target.scissor.set(x0, y0, x1 - x0, y1 - y0);
      this.target.scissorTest = true;
    } else {
      this.target.scissorTest = false;
    }

    // Mirror the camera position and its look target through the plane.
    this.view.reflect(this.normal).negate().add(this.planePos);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.tgt.subVectors(this.planePos, this.look).reflect(this.normal).negate().add(this.planePos);
    const vc = this.camera;
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    vc.lookAt(this.tgt);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    vc.layers.mask = camera.layers.mask;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane = water plane (Lengyel), in the virtual camera's view space.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.planePos).applyMatrix4(vc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = vc.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x;
    e[6] = this.clip.y;
    e[10] = this.clip.z + 1 - CLIP_BIAS;
    e[14] = this.clip.w;

    // Hide excluded objects.
    this.hidden.length = 0;
    for (const o of this.hide) if (o.visible) { o.visible = false; this.hidden.push(o); }
    if (this.flaggedScene !== scene || ++this.flaggedAge > REFRESH_FRAMES) {
      this.flaggedScene = scene;
      this.flaggedAge = 0;
      this.flagged.length = 0;
      scene.traverse((o) => {
        if (o.userData.noReflect) this.flagged.push(o);
      });
    }
    for (const o of this.flagged) if (o.visible) { o.visible = false; this.hidden.push(o); }

    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const sm = renderer.shadowMap;
    const prevAuto = sm.autoUpdate;
    const prevNeeds = sm.needsUpdate;
    renderer.xr.enabled = false;
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    renderer.setRenderTarget(prevRT);
    sm.autoUpdate = prevAuto;
    sm.needsUpdate = prevNeeds;
    renderer.xr.enabled = prevXr;
    for (const o of this.hidden) o.visible = true;
    return true;
  }

  dispose() {
    this.target.dispose();
  }
}
