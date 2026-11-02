/**
 * Golfer: original procedural golfer character + clubs (driver, fairway wood, hybrid, iron,
 * wedge, putter), posed every frame from the 2D swing model mapped onto a 3D swing plane.
 *
 *  - Geometry: ./golfer/body.ts + ./golfer/clubs.ts, merged into ONE rigidly skinned mesh
 *    (per-vertex albedo + roughness/metalness) → 1 draw call + 1 shadow draw call.
 *  - Posing: ./golfer/rig.ts (swing-plane mapping, body turn, two-bone IK, walk cycle).
 *  - Motion trail: ./golfer/trail.ts (optional, speed-coloured, additive).
 *
 * Bones are plain THREE.Bone objects outside the scene graph whose matrixWorld we write
 * directly (bind matrix and bone inverses are identity), so the skinned vertex = bone × v.
 */
import * as THREE from 'three';
import type { ClubKind } from '../physics/clubs';
import type { SwingPanelView } from '../core/view';
import type { Course } from '../course/Course';
import type { FrameContext, InitContext, QualityPreset, RenderModule } from './shared';
import { BONE_COUNT, DEFAULT_OUTFIT, buildGolferGeometry, type Outfit } from './golfer/body';
import type { ClubInfo } from './golfer/clubs';
import { GolferRig } from './golfer/rig';
import { ClubTrail } from './golfer/trail';

// ---- tuning -------------------------------------------------------------------------------
/** Seconds to cross-fade between walk and swing poses. */
const MODE_BLEND = 0.3;
/** Max terrain height difference applied to a foot (m). */
const MAX_FOOT_LIFT = 0.25;
/** Debug camera preset from the URL (visual checks only). */
const DEBUG_CAM = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('golfercam') ?? '' : '';

export interface GolferPose {
  /** Ball centre position (world). The ground under it is at ballPos.y - swing.ballY. */
  ballPos: THREE.Vector3;
  /** Unit horizontal vector pointing at the target (aim line). */
  aimDir: THREE.Vector3;
  swing: SwingPanelView;
  clubKind: ClubKind;
  clubLength: number;
  /** Face angle (deg, + open) for rotating the clubhead. */
  face: number;
  /** Stance -1..1 (ball position). */
  stance: number;
}

export class Golfer implements RenderModule {
  root = new THREE.Group();
  private mesh: THREE.SkinnedMesh | null = null;
  private material: THREE.MeshStandardMaterial | null = null;
  private bones: THREE.Bone[] = [];
  private clubs: Record<ClubKind, ClubInfo> | null = null;
  private rig = new GolferRig();
  private trail = new ClubTrail();
  private course: Course | null = null;
  /** Local (rig) frame → world. */
  private frame = new THREE.Matrix4();
  private mode: 'none' | 'swing' | 'walk' = 'none';
  private clubKind: ClubKind = 'driver';
  private lastCall = 0;
  private trailSpeed = -1;
  private blendT = 1;
  private from = Array.from({ length: BONE_COUNT }, () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }));
  private tmpP = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private outfit: Outfit;

  constructor(outfit: Outfit = DEFAULT_OUTFIT) {
    this.outfit = outfit;
    this.root.name = 'golfer';
  }

  init(ctx: InitContext) {
    this.course = ctx.course;
    const { geometry, clubs } = buildGolferGeometry(this.outfit);
    this.clubs = clubs;
    this.material = createGolferMaterial();
    const mesh = new THREE.SkinnedMesh(geometry, this.material);
    for (let i = 0; i < BONE_COUNT; i++) {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      this.bones.push(b);
    }
    const skeleton = new THREE.Skeleton(this.bones, this.bones.map(() => new THREE.Matrix4()));
    mesh.bindMode = THREE.DetachedBindMode;
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'golfer-body';
    this.mesh = mesh;
    this.root.add(mesh);
    this.root.add(this.trail.mesh);
    ctx.scene.add(this.root);
    // Until the game poses us, stand idle at the origin.
    if (this.mode === 'none') {
      this.setWalkPose(new THREE.Vector3(), 0, 0);
      this.mode = 'none'; // the first real pose should not cross-fade from this placeholder
    }
  }

  update(ctx: FrameContext) {
    if (this.blendT < 1) this.commit(ctx.dt);
    this.trail.update(performance.now() / 1000);
    if (DEBUG_CAM) this.debugCamera(ctx.camera);
  }

  /**
   * Debug close-up camera for visual checks: `?golfercam=behind|face|side|top` places the
   * camera relative to the golfer frame (only in the static viewer; ignored otherwise).
   */
  private debugCamera(cam: THREE.PerspectiveCamera) {
    const presets: Record<string, [number, number, number, number]> = {
      behind: [-4.2, 1.45, -0.55, 0.95], // down the line, behind the hands
      face: [-0.45, 1.2, 3.6, 0.85], // face-on, across the ball
      side: [3.2, 1.4, -1.6, 0.9], // from the target side
      top: [-0.2, 4.5, -0.4, 0.4],
      club: [0.6, 0.35, 0.9, 0.05], // close on the clubhead at address
    };
    const c = presets[DEBUG_CAM] ?? presets.behind;
    const look = new THREE.Vector3(-0.15, c[3], -0.55);
    if (DEBUG_CAM === 'club') look.set(-0.02, 0.03, 0);
    cam.position.set(c[0], c[1], c[2]).applyMatrix4(this.frame);
    cam.lookAt(look.applyMatrix4(this.frame));
  }

  setQuality(_q: QualityPreset) {
    // The golfer is a single cheap draw call; nothing to scale. (Shadow resolution is global.)
  }

  setVisible(v: boolean) {
    this.root.visible = v;
    if (!v) this.trail.clear();
  }

  /** Select the club shown while walking (setSwingPose selects it automatically). */
  setClub(kind: ClubKind) {
    this.clubKind = kind;
  }

  /**
   * Club-head motion trail. `speedMph` overrides the colour speed (pass < 0 to use the swing
   * model's live clubhead speed from the pose).
   */
  setTrail(enabled: boolean, speedMph = -1) {
    if (this.trail.enabled && !enabled) this.trail.clear();
    this.trail.enabled = enabled;
    this.trailSpeed = speedMph;
  }

  /** Address/swing pose. */
  setSwingPose(p: GolferPose) {
    if (!this.clubs) return;
    const dt = this.stepClock();
    this.clubKind = p.clubKind;
    this.switchMode('swing');
    // Golfer frame: origin at the ground under the ball, X = aim, Y = up, Z = X × Y.
    const x = this.tmpP.set(p.aimDir.x, 0, p.aimDir.z);
    if (x.lengthSq() < 1e-8) x.set(0, 0, -1);
    x.normalize();
    const y = new THREE.Vector3(0, 1, 0);
    const z = new THREE.Vector3().crossVectors(x, y);
    this.frame.makeBasis(x, y, z).setPosition(p.ballPos.x, p.ballPos.y - p.swing.ballY, p.ballPos.z);
    this.terrainLift();
    this.rig.solveSwing({ swing: p.swing, club: this.clubs[p.clubKind], face: p.face, stance: p.stance, dt });
    this.commit(0);
    if (this.trail.enabled) {
      const mph = this.trailSpeed >= 0 ? this.trailSpeed : p.swing.speedMph;
      const head = new THREE.Vector3().copy(this.rig.clubhead).applyMatrix4(this.frame);
      const shaft = new THREE.Vector3().copy(this.rig.shaftPoint).applyMatrix4(this.frame);
      this.trail.push(performance.now() / 1000, head, shaft, mph, p.swing.speedBands);
    }
  }

  /** Walking/idle pose at a world position facing yaw (radians about +Y, 0 = facing -Z). speed m/s. */
  setWalkPose(pos: THREE.Vector3, yaw: number, speed: number) {
    if (!this.clubs) return;
    const dt = this.stepClock();
    this.switchMode('walk');
    this.frame.makeRotationY(yaw + Math.PI).setPosition(pos);
    this.terrainLift();
    this.rig.solveWalk(this.clubs[this.clubKind], speed, dt);
    this.commit(0);
  }

  /** World position of the clubhead (sole under the face centre). */
  clubheadWorld(out: THREE.Vector3) {
    return out.copy(this.rig.clubhead).applyMatrix4(this.frame);
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.mesh?.skeleton.dispose();
    this.trail.dispose();
    this.root.removeFromParent();
  }

  // ---------------------------------------------------------------------------------------
  private stepClock() {
    const now = performance.now();
    const dt = this.lastCall ? Math.min(0.1, Math.max(0, (now - this.lastCall) / 1000)) : 1 / 60;
    this.lastCall = now;
    return dt;
  }

  private switchMode(m: 'swing' | 'walk') {
    if (this.mode === m) return;
    if (this.mode !== 'none') {
      // Capture the current world pose to cross-fade from.
      for (let i = 0; i < BONE_COUNT; i++) this.bones[i].matrixWorld.decompose(this.from[i].p, this.from[i].q, this.from[i].s);
      this.blendT = 0;
    }
    if (m === 'walk') this.trail.clear();
    this.mode = m;
  }

  /** Terrain under each foot relative to the frame origin (one-frame lag on the probe). */
  private terrainLift() {
    if (!this.course) return;
    const oy = this.frame.elements[13];
    for (let i = 0; i < 2; i++) {
      const w = this.tmpS.copy(this.rig.footProbe[i]).applyMatrix4(this.frame);
      const h = this.course.height(w.x, w.z) - oy;
      this.rig.footLift[i] = Number.isFinite(h) ? Math.max(-MAX_FOOT_LIFT, Math.min(MAX_FOOT_LIFT, h)) : 0;
    }
  }

  /** Write bone world matrices (cross-fading from the previous mode while blendT < 1). */
  private commit(dt: number) {
    this.blendT = Math.min(1, this.blendT + dt / MODE_BLEND);
    const t = this.blendT < 1 ? this.blendT * this.blendT * (3 - 2 * this.blendT) : 1;
    for (let i = 0; i < BONE_COUNT; i++) {
      const out = this.bones[i].matrixWorld;
      out.multiplyMatrices(this.frame, this.rig.mats[i]);
      if (t < 1) {
        out.decompose(this.tmpP, this.tmpQ, this.tmpS);
        const f = this.from[i];
        this.tmpP.lerpVectors(f.p, this.tmpP, t);
        this.tmpQ.slerpQuaternions(f.q, this.tmpQ, t);
        this.tmpS.lerpVectors(f.s, this.tmpS, t);
        out.compose(this.tmpP, this.tmpQ, this.tmpS);
      }
    }
  }
}

/** Standard PBR material reading per-vertex roughness/metalness from the `rm` attribute. */
function createGolferMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1 });
  m.name = 'golfer';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * vRM.y;');
  };
  m.customProgramCacheKey = () => 'golfer-rm-v1';
  return m;
}
