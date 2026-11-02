/**
 * Camera rig: first-person walking, behind-the-golfer address camera, smooth ball-follow
 * during flight, a landing/settle hold, rangefinder zoom and a free survey camera.
 * All transitions are critically-damped springs so nothing snaps.
 */
import * as THREE from 'three';
import type { Course } from '../course/Course';

export type CamMode = 'walk' | 'address' | 'flight' | 'settle' | 'free' | 'orbit';

const UP = new THREE.Vector3(0, 1, 0);

function damp(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) {
  return current.lerp(target, 1 - Math.exp(-lambda * dt));
}

export class CameraRig {
  mode: CamMode = 'orbit';
  camera: THREE.PerspectiveCamera;
  course: Course;
  pos = new THREE.Vector3();
  look = new THREE.Vector3();
  /** First-person yaw/pitch (radians). yaw 0 = looking toward -Z. */
  yaw = 0;
  pitch = 0;
  baseFov = 55;
  fovZoom = 1;
  private targetPos = new THREE.Vector3();
  private targetLook = new THREE.Vector3();
  private shake = 0;
  private flightTime = 0;
  private flightDir = new THREE.Vector3(0, 0, -1);
  orbitT = 0;

  constructor(camera: THREE.PerspectiveCamera, course: Course) {
    this.camera = camera;
    this.course = course;
  }

  /** Teleport (no smoothing). */
  snap(pos: THREE.Vector3, look: THREE.Vector3) {
    this.pos.copy(pos);
    this.look.copy(look);
    this.targetPos.copy(pos);
    this.targetLook.copy(look);
    this.apply();
  }

  kick(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** Walking: eye position + yaw/pitch. */
  walk(eye: THREE.Vector3, dt: number) {
    this.mode = 'walk';
    this.targetPos.copy(eye);
    damp(this.pos, this.targetPos, 25, dt);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.look.copy(this.pos).addScaledVector(dir, 10);
    this.apply(dt);
  }

  /** Behind the golfer, looking down the aim line. */
  address(ball: THREE.Vector3, aimDir: THREE.Vector3, dt: number, putting: boolean) {
    this.mode = 'address';
    const right = new THREE.Vector3().crossVectors(aimDir, UP).normalize();
    // Framed so the ball sits ~12-14° below the screen centre: clear of the bottom HUD
    // (club bar / hint) while the target line still runs up the middle of the screen.
    const back = putting ? 3.0 : 4.6;
    const up = putting ? 1.2 : 1.6;
    // Putting: straight down the line (the golfer stands left of it, out of the way).
    this.targetPos.copy(ball).addScaledVector(aimDir, -back).addScaledVector(right, putting ? 0.05 : -0.55).addScaledVector(UP, up);
    const g = this.camGround(this.targetPos.x, this.targetPos.z) + 0.6;
    // On a bank the camera has to rise above its nominal height: raise the look point by the
    // same amount so the ball keeps its place on screen (instead of sinking under the HUD).
    const lift = Math.max(0, g - this.targetPos.y);
    this.targetPos.y += lift;
    this.targetLook.copy(ball).addScaledVector(aimDir, putting ? 6 : 12).addScaledVector(UP, (putting ? -0.3 : 0) + lift);
    damp(this.pos, this.targetPos, 6, dt);
    damp(this.look, this.targetLook, 6, dt);
    this.apply(dt);
  }

  /** Player-controlled orbit around the ball during flight (radians / zoom multiplier). */
  flightYawOff = 0;
  flightPitchOff = 0;
  flightZoom = 1;
  private flightUserControl = false;

  startFlight() {
    this.flightTime = 0;
    this.flightYawOff = 0;
    this.flightPitchOff = 0;
    this.flightZoom = 1;
    this.flightUserControl = false;
  }

  /** Mouse / right-stick look during flight: orbit around the ball, and zoom (>0 = closer). */
  orbitFlight(dYaw: number, dPitch: number, dZoom: number) {
    if (dYaw === 0 && dPitch === 0 && dZoom === 0) return;
    this.flightUserControl = true;
    this.flightYawOff += dYaw;
    this.flightPitchOff = Math.max(-0.35, Math.min(1.2, this.flightPitchOff + dPitch));
    this.flightZoom = Math.max(0.35, Math.min(3, this.flightZoom * Math.exp(-dZoom)));
  }

  /**
   * Chase the ball in flight from behind. The camera rises only part of the way with the ball
   * (so the ball is seen against the sky at its apex) and comes back down as the ball descends,
   * ending a few metres above the ground behind the ball when it lands and rolls.
   */
  flight(ball: THREE.Vector3, vel: THREE.Vector3, origin: THREE.Vector3, dt: number) {
    this.mode = 'flight';
    this.flightTime += dt;
    const horiz = new THREE.Vector3(vel.x, 0, vel.z);
    const sp = horiz.length();
    const fromOrigin = new THREE.Vector3().subVectors(ball, origin).setY(0);
    const dir = sp > 0.5 ? horiz.normalize() : fromOrigin.lengthSq() > 1e-4 ? fromOrigin.normalize() : this.flightDir.clone();
    // Smooth the travel direction so bounces/lip-outs don't whip the camera around.
    this.flightDir.lerp(dir, 1 - Math.exp(-3 * dt)).setY(0);
    if (this.flightDir.lengthSq() < 1e-6) this.flightDir.copy(dir);
    this.flightDir.normalize();
    if (this.flightTime < 0.35) {
      // Brief hold behind the golfer to watch the ball leave.
      this.targetLook.copy(ball);
      damp(this.look, this.targetLook, 10, dt);
      this.apply(dt);
      return;
    }
    const groundBall = this.course.height(ball.x, ball.z);
    const ballUp = Math.max(0, ball.y - groundBall);
    const t = flightCamTarget(ball, this.flightDir, sp, ballUp, (x, z) => this.camGround(x, z));
    this.targetPos.copy(t);
    // Aim a little below a high ball so the ground/horizon stays in view under it.
    this.targetLook.copy(ball).addScaledVector(UP, -0.3 * ballUp);
    if (this.flightUserControl) {
      // Player is looking around: orbit the chase offset around the ball.
      const off = new THREE.Vector3().subVectors(t, ball);
      const r = Math.max(4, off.length()) * this.flightZoom;
      const baseYaw = Math.atan2(off.x, off.z);
      const basePitch = Math.asin(Math.max(-1, Math.min(1, off.y / Math.max(1e-6, off.length()))));
      const yaw = baseYaw + this.flightYawOff;
      const pitch = Math.max(-0.2, Math.min(1.35, basePitch + this.flightPitchOff));
      this.targetPos.set(ball.x + Math.sin(yaw) * Math.cos(pitch) * r, ball.y + Math.sin(pitch) * r, ball.z + Math.cos(yaw) * Math.cos(pitch) * r);
      this.targetLook.copy(ball);
    }
    damp(this.pos, this.targetPos, this.flightUserControl ? 6 : 2.4, dt);
    this.keepAboveGround(1.0);
    damp(this.look, this.targetLook, 12, dt);
    this.apply(dt);
  }

  /** Initialise the travel direction used by the flight / settle cameras. */
  setFlightDir(dir: THREE.Vector3) {
    this.flightDir.set(dir.x, 0, dir.z);
    if (this.flightDir.lengthSq() < 1e-6) this.flightDir.set(0, 0, -1);
    this.flightDir.normalize();
  }

  /**
   * Ball at rest: glide to a low view a few metres behind and beside the ball, looking along
   * the line of travel (or toward `toward`, e.g. the pin, when given).
   */
  settle(ball: THREE.Vector3, dt: number, opts: { dir?: THREE.Vector3; close?: boolean } = {}) {
    this.mode = 'settle';
    const dir = opts.dir ? new THREE.Vector3(opts.dir.x, 0, opts.dir.z) : this.flightDir.clone();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    this.targetPos.copy(settleCamTarget(ball, dir, !!opts.close, (x, z) => this.camGround(x, z)));
    // Look a little past the ball so the ball sits below centre with the hole ahead in view.
    this.targetLook.copy(ball).addScaledVector(dir, opts.close ? 1.2 : 5).addScaledVector(UP, 0.1);
    damp(this.pos, this.targetPos, 2.2, dt);
    this.keepAboveGround(0.8);
    damp(this.look, this.targetLook, 5, dt);
    this.apply(dt);
  }

  /** Terrain (or water surface) height under a camera position. */
  private camGround(x: number, z: number) {
    const g = this.course.height(x, z);
    const w = this.course.waterHeight(x, z);
    return w !== null && w > g ? w : g;
  }

  private keepAboveGround(clear: number) {
    const g = this.camGround(this.pos.x, this.pos.z) + clear;
    if (this.pos.y < g) this.pos.y = g;
  }

  /** Slow cinematic orbit (title screen / hole intro). */
  orbit(center: THREE.Vector3, radius: number, height: number, dt: number) {
    this.mode = 'orbit';
    this.orbitT += dt * 0.04;
    this.targetPos.set(center.x + Math.cos(this.orbitT) * radius, 0, center.z + Math.sin(this.orbitT) * radius);
    this.targetPos.y = Math.max(this.course.height(this.targetPos.x, this.targetPos.z) + 3, center.y + height);
    this.targetLook.copy(center);
    damp(this.pos, this.targetPos, 1.5, dt);
    damp(this.look, this.targetLook, 1.5, dt);
    this.apply(dt);
  }

  /** Free survey camera driven by yaw/pitch + movement. */
  free(move: THREE.Vector3, dt: number) {
    this.mode = 'free';
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    this.pos.addScaledVector(dir, move.z * dt).addScaledVector(right, move.x * dt).addScaledVector(UP, move.y * dt);
    const g = this.course.height(this.pos.x, this.pos.z) + 0.5;
    if (this.pos.y < g) this.pos.y = g;
    this.look.copy(this.pos).add(dir);
    this.apply(dt);
  }

  private apply(dt = 0) {
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001 && dt > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 10);
    }
    this.camera.lookAt(this.look);
    const fov = this.baseFov / this.fovZoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10 || 1);
      this.camera.updateProjectionMatrix();
    }
  }

  /** Ray-march the heightfield from the camera along its view direction. */
  pickTerrain(maxDist = 700): THREE.Vector3 | null {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const p = this.camera.position.clone();
    let step = 0.5;
    for (let t = 0; t < maxDist; t += step) {
      p.copy(this.camera.position).addScaledVector(dir, t);
      if (p.y <= this.course.height(p.x, p.z)) return p;
      step = Math.min(4, 0.5 + t * 0.01);
    }
    return null;
  }
}

type GroundFn = (x: number, z: number) => number;

/**
 * Where the flight camera wants to be: behind the ball along its travel, rising only partly
 * with the ball (≈40% of its height above the ground) and never far above the terrain.
 */
export function flightCamTarget(ball: THREE.Vector3, dir: THREE.Vector3, horizSpeed: number, ballAboveGround: number, ground: GroundFn, out = new THREE.Vector3()) {
  // Further back while the ball is high so the view isn't a steep look up into the sky.
  const back = Math.min(14, 6 + horizSpeed * 0.12) + Math.min(18, ballAboveGround * 0.5);
  out.copy(ball).addScaledVector(dir, -back);
  const g = ground(out.x, out.z);
  out.y = Math.max(g + 2.2 + Math.min(14, ballAboveGround * 0.4), g + 1.2);
  return out;
}

/** The pleasant "ball at rest" view: ~6 m behind, slightly to the right, ~2.3 m above the ground. */
export function settleCamTarget(ball: THREE.Vector3, dir: THREE.Vector3, close: boolean, ground: GroundFn, out = new THREE.Vector3()) {
  const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
  const back = close ? 3.2 : 6.0;
  const side = close ? 0.8 : 1.6;
  const up = close ? 1.4 : 2.3;
  out.copy(ball).addScaledVector(dir, -back).addScaledVector(right, side);
  const g = ground(out.x, out.z);
  out.y = Math.max(g + up, ball.y + up * 0.6);
  return out;
}
