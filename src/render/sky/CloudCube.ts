/**
 * Renders the raymarched clouds into a HalfFloat cube map around the camera, ONE FACE PER FRAME
 * (amortised: the cost is independent of screen resolution and ~1/6 of a full cube per frame).
 * The sky dome and the IBL capture then just sample this cube. Clouds sit 1.3 km+ up and drift
 * slowly, so a 6-frame refresh cycle is invisible; a full refresh is forced on lighting changes
 * or big camera jumps.
 *
 * Each refresh uses a new slice-jitter offset and is blended into the previous contents
 * (exponential moving average), so the raymarch noise/banding converges to a smooth result
 * over a few cycles, like TAA but in a space that never reprojects.
 */
import * as THREE from 'three';
import { createCloudMaterial, type CloudUniforms } from './cloudShader';

/** Re-render the whole cube at once when the camera jumped farther than this (m). */
const JUMP_DIST = 120;
/** Weight of a new refresh in the running average (lower = smoother, slower to react). */
const ACCUM = 0.3;
/** Extra accumulated full passes after a lighting refresh, to start converged. Camera jumps only
 *  re-render the six faces once (the running average converges over the next cycles), which
 *  keeps a camera cut at 6 face renders instead of 24 — perf: load time and shot-cut hitches. */
const WARMUP_PASSES = 3;

export class CloudCube {
  readonly target: THREE.WebGLCubeRenderTarget;
  private scene = new THREE.Scene();
  private cubeCam: THREE.CubeCamera;
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private face = 0;
  private lastFull = new THREE.Vector3(Infinity, 0, 0);
  private steps: number;
  private jitterIndex = 0;
  /** A lighting/config change is pending: the next full refresh accumulates WARMUP_PASSES. */
  private needsWarmup = true;
  /** Face renders issued since construction (perf accounting / tests). */
  faceRenders = 0;

  constructor(
    private uniforms: CloudUniforms,
    size: number,
    steps: number,
  ) {
    this.steps = steps;
    this.target = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.target.texture.name = 'CloudCube';
    this.material = createCloudMaterial(uniforms, steps);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.mesh = new THREE.Mesh(tri, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.cubeCam = new THREE.CubeCamera(0.1, 10, this.target);
    this.scene.add(this.cubeCam);
    uniforms.uTexelAngle.value = 2 / size;
  }

  get texture(): THREE.CubeTexture {
    return this.target.texture;
  }

  /** Change resolution / step count (quality preset). Re-renders everything on the next update. */
  configure(size: number, steps: number) {
    if (size !== this.target.width) {
      this.target.setSize(size, size);
      this.uniforms.uTexelAngle.value = 2 / size;
    }
    if (steps !== this.steps) {
      this.steps = steps;
      this.material.dispose();
      this.material = createCloudMaterial(this.uniforms, steps);
      this.mesh.material = this.material;
    }
    this.invalidate();
  }

  /** Force a full 6-face refresh on the next update (lighting/preset change). */
  invalidate() {
    this.lastFull.set(Infinity, 0, 0);
    this.needsWarmup = true;
  }

  /**
   * Render all six faces once from `pos` without the warm-up accumulation and without marking
   * the cube as refreshed: good enough for the (heavily blurred) IBL capture at load or after a
   * lighting change, while the next update() still does the full, converged refresh from the
   * real camera position (perf: the load-time capture used to cost a 24-face refresh at the
   * world origin that the first frame then threw away).
   */
  updateQuick(renderer: THREE.WebGLRenderer, pos: THREE.Vector3) {
    const keep = this.lastFull.clone();
    const warm = this.needsWarmup;
    this.needsWarmup = false;
    this.lastFull.set(Infinity, 0, 0);
    this.update(renderer, pos);
    this.lastFull.copy(keep);
    this.needsWarmup = warm;
  }

  /** Render one face (or all six after invalidate()/a camera jump) from `pos`. */
  update(renderer: THREE.WebGLRenderer, pos: THREE.Vector3) {
    const full = !(pos.distanceToSquared(this.lastFull) < JUMP_DIST * JUMP_DIST);
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const prevXr = renderer.xr.enabled;
    const prevAutoClear = renderer.autoClear;
    renderer.xr.enabled = false;
    renderer.autoClear = false; // the box covers every texel with NoBlending
    this.cubeCam.position.copy(pos);
    if (full) {
      // replace, then (after a lighting change) accumulate a few jittered passes so the first
      // frame is already smooth; a camera jump just replaces the six faces once
      const passes = this.needsWarmup ? WARMUP_PASSES : 0;
      for (let i = 0; i <= passes; i++) {
        this.setBlend(i > 0 ? 1 / (i + 1) : 1);
        this.cubeCam.update(renderer, this.scene);
        this.faceRenders += 6;
      }
      this.needsWarmup = false;
      this.lastFull.copy(pos);
      this.face = 0;
    } else {
      this.cubeCam.updateMatrixWorld();
      if (this.cubeCam.coordinateSystem !== renderer.coordinateSystem) {
        this.cubeCam.coordinateSystem = renderer.coordinateSystem;
        this.cubeCam.updateCoordinateSystem();
      }
      this.setBlend(ACCUM);
      renderer.setRenderTarget(this.target, this.face, 0);
      renderer.render(this.scene, this.cubeCam.children[this.face] as THREE.Camera);
      this.faceRenders++;
      this.face = (this.face + 1) % 6;
      if (this.face === 0) this.lastFull.copy(pos); // jump test is per 6-frame cycle
    }
    renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    renderer.xr.enabled = prevXr;
    renderer.autoClear = prevAutoClear;
  }

  /** weight 1 = overwrite; otherwise new = mix(old, new, weight) on all four channels. */
  private setBlend(weight: number) {
    const m = this.material;
    // golden-ratio sequence → well distributed slice offsets across refreshes
    this.jitterIndex = (this.jitterIndex + 1) % 4096;
    this.uniforms.uJitter.value = (this.jitterIndex * 0.6180339887) % 1;
    if (weight >= 1) {
      m.blending = THREE.NoBlending;
      return;
    }
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.ConstantAlphaFactor;
    m.blendDst = THREE.OneMinusConstantAlphaFactor;
    m.blendSrcAlpha = THREE.ConstantAlphaFactor;
    m.blendDstAlpha = THREE.OneMinusConstantAlphaFactor;
    m.blendAlpha = weight;
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
