/**
 * STUB — Props & physics objects (owner: props builder): ball mesh, flags/pins/cups for each
 * hole, tee markers, signs, clubhouse, carts, benches, gongs, targets and breakable props
 * simulated with Rapier. Implements CollisionWorld for the ball simulation.
 */
import * as THREE from 'three';
import type { CollisionWorld, ObstacleHit } from '../physics/BallSim';
import type { TreeCollider } from './Trees';
import type { FrameContext, InitContext, RenderModule } from './shared';

export interface PropHitEvent {
  id: string;
  kind: string;
  pos: THREE.Vector3;
  speed: number;
}

export class Props implements RenderModule, CollisionWorld {
  /** The golf ball mesh (position set by the game every frame). */
  ball = new THREE.Group();
  /** Called by the game when the ball hits a prop (for sounds/score). */
  onPropHit: ((e: PropHitEvent) => void) | null = null;
  init(ctx: InitContext) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.021335, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
    m.castShadow = true;
    this.ball.add(m);
    ctx.scene.add(this.ball);
  }
  update(_ctx: FrameContext) {}
  /** Tree colliders from Foliage (merged into sweeps). */
  setTreeColliders(_c: TreeCollider[]) {}
  /** Highlight the active hole (flag visible etc.). */
  setActiveHole(_index: number) {}
  /** Flag is pulled out when the ball is on the green & close (optional). */
  setFlagOut(_out: boolean) {}
  setBall(pos: THREE.Vector3, spin?: THREE.Vector3, dt?: number) {
    this.ball.position.copy(pos);
    void spin;
    void dt;
  }
  sweep(_a: THREE.Vector3, _b: THREE.Vector3, _r: number): ObstacleHit | null {
    return null;
  }
  onBallHit(_hit: ObstacleHit, _v: THREE.Vector3) {}
}
