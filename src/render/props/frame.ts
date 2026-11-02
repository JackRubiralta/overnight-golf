/**
 * Small helpers shared by the prop assemblies: a local placement frame (position + yaw) that
 * converts local points/rotations to world space for both geometry and collision primitives,
 * and the cluster record used for distance culling.
 */
import * as THREE from 'three';
import { makePrimitive, type Primitive } from '../../props/collision';

export type PrimInit = Parameters<typeof makePrimitive>[0];
export type AddCollider = (p: PrimInit) => Primitive;

export interface Cluster {
  group: THREE.Group;
  center: THREE.Vector3;
  radius: number;
  /** Culling class: small props vanish sooner than buildings. */
  size: 'small' | 'large' | 'fence';
}

/** Yaw that turns local +z to face the XZ direction (fx, fz). */
export function yawToward(fx: number, fz: number) {
  return Math.atan2(fx, fz);
}

export class Frame {
  readonly pos: THREE.Vector3;
  readonly yaw: number;
  readonly quat: THREE.Quaternion;
  readonly matrix: THREE.Matrix4;
  /** Optional pitch (about local x) and roll (about local z) tilt the frame onto sloping ground. */
  constructor(x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) {
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = yaw;
    this.quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    this.matrix = new THREE.Matrix4().compose(this.pos, this.quat, new THREE.Vector3(1, 1, 1));
  }
  /** Local point → world. */
  world(lx: number, ly: number, lz: number, out = new THREE.Vector3()) {
    return out.set(lx, ly, lz).applyQuaternion(this.quat).add(this.pos);
  }
  /** Local rotation (Euler YXZ) → world quaternion. */
  rot(rx = 0, ry = 0, rz = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    return this.quat.clone().multiply(q);
  }
}
