import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { flightCamTarget, settleCamTarget } from '../src/camera/CameraRig';

const flat = () => 0;
const slope = (_x: number, z: number) => -0.2 * z; // rises toward -Z

describe('camera targets', () => {
  it('settle view is low, behind and beside the ball', () => {
    const ball = new Vector3(0, 0.02, -200);
    const dir = new Vector3(0, 0, -1);
    const t = settleCamTarget(ball, dir, false, flat);
    expect(t.y).toBeGreaterThan(1.5);
    expect(t.y).toBeLessThan(3.5);
    expect(t.z).toBeGreaterThan(ball.z + 4); // behind (travel is -Z)
    expect(Math.abs(t.x)).toBeGreaterThan(0.5); // a little to the side
    expect(Math.hypot(t.x - ball.x, t.z - ball.z)).toBeLessThan(8);
  });
  it('putting/holed settle view is closer and lower', () => {
    const ball = new Vector3(0, 0.02, 0);
    const t = settleCamTarget(ball, new Vector3(1, 0, 0), true, flat);
    expect(t.y).toBeLessThan(2);
    expect(Math.hypot(t.x, t.z)).toBeLessThan(4);
  });
  it('settle view stays above the terrain on slopes and above the ball when downhill', () => {
    const ball = new Vector3(0, slope(0, 0) + 0.02, 0);
    // Travelling +Z: the camera sits at -Z (uphill) → must clear the ground there.
    const up = settleCamTarget(ball, new Vector3(0, 0, 1), false, slope);
    expect(up.y).toBeGreaterThan(slope(up.x, up.z) + 2);
    // Travelling -Z: camera downhill → still above the ball.
    const dn = settleCamTarget(ball, new Vector3(0, 0, -1), false, slope);
    expect(dn.y).toBeGreaterThan(ball.y + 1);
  });
  it('flight camera rises less than the ball and comes down with it', () => {
    const dir = new Vector3(0, 0, -1);
    const apex = flightCamTarget(new Vector3(0, 30, -120), dir, 40, 30, flat);
    expect(apex.y).toBeLessThan(20);
    expect(apex.y).toBeGreaterThan(8);
    // The ball stays inside a 55° vertical FOV when the camera aims 30% of its height below it.
    const ballP = new Vector3(0, 30, -120);
    const look = ballP.clone().setY(30 - 0.3 * 30);
    const ang = (p: Vector3) => Math.atan2(p.y - apex.y, Math.hypot(p.x - apex.x, p.z - apex.z));
    expect((ang(ballP) - ang(look)) * 57.3).toBeLessThan(25);
    expect(ang(look) * 57.3).toBeLessThan(25); // horizon still on screen
    const landing = flightCamTarget(new Vector3(0, 0.5, -220), dir, 20, 0.5, flat);
    expect(landing.y).toBeLessThan(3);
    expect(landing.z).toBeGreaterThan(-220);
  });
});

describe('address camera framing', () => {
  const angleBelow = (cam: Vector3, look: Vector3, ball: Vector3) => {
    const d1 = look.clone().sub(cam).normalize();
    const d2 = ball.clone().sub(cam).normalize();
    return (Math.acos(Math.min(1, d1.dot(d2))) * 180) / Math.PI;
  };
  it('keeps the ball ~13° below centre on flat ground and when the camera is lifted by a bank', async () => {
    const { addressLook } = await import('../src/camera/CameraRig');
    const ball = new Vector3(0, 0.02, 0);
    const aim = new Vector3(0, 0, -1);
    for (const camY of [1.62, 3.5, 6]) {
      const cam = new Vector3(-0.55, camY, 4.6);
      const look = addressLook(cam, ball, aim, false);
      const a = angleBelow(cam, look, ball);
      expect(a).toBeGreaterThan(12);
      expect(a).toBeLessThan(15.5);
      expect(look.y).toBeLessThan(cam.y + 1); // never tilts up at the sky
    }
    const pc = new Vector3(0.05, 1.22, 3);
    expect(angleBelow(pc, addressLook(pc, ball, aim, true), ball)).toBeLessThan(14);
  });
});
