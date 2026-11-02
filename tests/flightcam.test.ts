import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/camera/CameraRig';

const flatCourse = { height: () => 0, waterHeight: () => null } as never;

function fly(orbit?: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 5000);
  const rig = new CameraRig(cam, flatCourse);
  rig.snap(new THREE.Vector3(0, 2, 4), new THREE.Vector3(0, 0, -40));
  rig.startFlight();
  rig.setFlightDir(new THREE.Vector3(0, 0, -1));
  const ball = new THREE.Vector3(0, 0, 0);
  const vel = new THREE.Vector3(0, 20, -60);
  for (let i = 0; i < 180; i++) {
    ball.addScaledVector(vel, 1 / 60);
    vel.y -= 9.81 / 60;
    if (orbit && i > 30) rig.orbitFlight(orbit[0] / 150, orbit[1] / 150, orbit[2] / 150);
    rig.flight(ball, vel, new THREE.Vector3(), 1 / 60);
  }
  return { cam: cam.position.clone(), ball: ball.clone() };
}

describe('flight camera look-around', () => {
  it('chases from behind by default', () => {
    const { cam, ball } = fly();
    expect(cam.z).toBeGreaterThan(ball.z); // behind (ball travels toward -z)
  });
  it('mouse orbit swings the camera around to the side of the ball', () => {
    const { cam, ball } = fly([Math.PI / 2, 0, 0]);
    const side = Math.abs(cam.x - ball.x);
    const behind = cam.z - ball.z;
    expect(side).toBeGreaterThan(Math.abs(behind));
  });
  it('zoom brings the camera closer', () => {
    const a = fly();
    const b = fly([0, 0, 1.2]);
    expect(b.cam.distanceTo(b.ball)).toBeLessThan(a.cam.distanceTo(a.ball) * 0.8);
  });
});
