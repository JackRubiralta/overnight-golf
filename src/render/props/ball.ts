/**
 * Golf ball visual: bright white clear-coated sphere with a procedural dimple normal map,
 * visually spun from the simulated spin vector (in flight) or rolled from its displacement
 * (on the ground), plus a soft contact-shadow blob that keeps the tiny ball grounded at
 * distances where the shadow map can't resolve it.
 */
import * as THREE from 'three';
import { PHYS } from '../../config';
import type { Course } from '../../course/Course';
import { ballNormalMap } from './textures';

/** Max visual spin rate (rad/s); real backspin (~600 rad/s) would strobe at 60 fps. */
const MAX_VISUAL_SPIN = 40;
const SHADOW_SIZE = 0.09;
const SHADOW_FADE_HEIGHT = 1.2;

export class BallVisual {
  readonly group: THREE.Group;
  readonly mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  private last = new THREE.Vector3();
  private hasLast = false;
  private q = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private course: Course;

  constructor(group: THREE.Group, course: Course) {
    this.group = group;
    this.course = course;
    const normal = ballNormalMap();
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.12,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.65, 0.65),
      emissive: '#ffffff',
      emissiveIntensity: 0.04,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(PHYS.ballRadius, 40, 28), mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'ball';
    group.add(this.mesh);

    // Contact shadow: radial gradient disc, world-aligned, positioned on the terrain below.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(c);
    const sg = new THREE.PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.shadow.name = 'ballShadow';
    this.shadow.renderOrder = 2;
    this.shadow.frustumCulled = false;
  }

  /** The shadow blob lives in world space (not under the ball group transform). */
  get shadowMesh() {
    return this.shadow;
  }

  set(pos: THREE.Vector3, spin?: THREE.Vector3, dt?: number) {
    this.group.position.copy(pos);
    const step = dt ?? 0;
    if (spin && step > 0) {
      const w = spin.length();
      if (w > 1e-3) {
        const vis = Math.min(w, MAX_VISUAL_SPIN);
        this.axis.copy(spin).multiplyScalar(1 / w);
        this.q.setFromAxisAngle(this.axis, vis * step);
        this.mesh.quaternion.premultiply(this.q);
      }
    } else if (this.hasLast) {
      // Rolling: rotate about (up × displacement) by distance / radius.
      const dx = pos.x - this.last.x;
      const dz = pos.z - this.last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 2) {
        this.axis.set(dz, 0, -dx).multiplyScalar(1 / d);
        this.q.setFromAxisAngle(this.axis, d / PHYS.ballRadius);
        this.mesh.quaternion.premultiply(this.q);
      }
    }
    this.last.copy(pos);
    this.hasLast = true;
    // Contact shadow
    const gy = this.course.height(pos.x, pos.z);
    const hgt = pos.y - PHYS.ballRadius - gy;
    const fade = 1 - Math.min(1, Math.max(0, hgt) / SHADOW_FADE_HEIGHT);
    this.shadow.visible = fade > 0.01 && this.group.visible;
    this.shadow.position.set(pos.x, gy + 0.004, pos.z);
    const s = 1 + Math.max(0, hgt) * 1.5;
    this.shadow.scale.set(s, 1, s);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.6 * fade;
  }
}
