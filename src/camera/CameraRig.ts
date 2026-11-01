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
    const back = putting ? 2.6 : 3.6;
    const up = putting ? 1.25 : 1.75;
    this.targetPos.copy(ball).addScaledVector(aimDir, -back).addScaledVector(right, -0.55).addScaledVector(UP, up);
    const g = this.course.height(this.targetPos.x, this.targetPos.z) + 0.6;
    if (this.targetPos.y < g) this.targetPos.y = g;
    this.targetLook.copy(ball).addScaledVector(aimDir, putting ? 8 : 40).addScaledVector(UP, putting ? -0.5 : 0.5);
    damp(this.pos, this.targetPos, 6, dt);
    damp(this.look, this.targetLook, 6, dt);
    this.apply(dt);
  }

  startFlight() {
    this.flightTime = 0;
  }

  /** Chase the ball in flight from behind/above, settling as it lands. */
  flight(ball: THREE.Vector3, vel: THREE.Vector3, origin: THREE.Vector3, dt: number) {
    this.mode = 'flight';
    this.flightTime += dt;
    const horiz = new THREE.Vector3(vel.x, 0, vel.z);
    const sp = horiz.length();
    const dir = sp > 0.5 ? horiz.normalize() : new THREE.Vector3().subVectors(ball, origin).setY(0).normalize();
    if (this.flightTime < 0.35) {
      // Brief hold behind the golfer to watch the ball leave.
      this.targetLook.copy(ball);
      damp(this.look, this.targetLook, 10, dt);
      this.apply(dt);
      return;
    }
    const dist = Math.min(14, 6 + sp * 0.12);
    this.targetPos.copy(ball).addScaledVector(dir, -dist).addScaledVector(UP, 2.2 + Math.min(6, sp * 0.06));
    const g = this.course.height(this.targetPos.x, this.targetPos.z) + 1.2;
    if (this.targetPos.y < g) this.targetPos.y = g;
    this.targetLook.copy(ball);
    damp(this.pos, this.targetPos, 2.2, dt);
    damp(this.look, this.targetLook, 12, dt);
    this.apply(dt);
  }

  /** Ball at rest: hold a view of it. */
  settle(ball: THREE.Vector3, dt: number) {
    this.mode = 'settle';
    this.targetLook.copy(ball);
    damp(this.look, this.targetLook, 4, dt);
    const g = this.course.height(this.pos.x, this.pos.z) + 1.0;
    if (this.pos.y < g) this.pos.y += (g - this.pos.y) * Math.min(1, dt * 5);
    this.apply(dt);
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
