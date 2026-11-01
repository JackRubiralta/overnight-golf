/**
 * STUB — Golfer: original procedural golfer character + clubs (owner: golfer builder).
 * Posed every frame from the 2D swing model (hands/club angle in the swing plane) mapped into 3D.
 */
import * as THREE from 'three';
import type { ClubKind } from '../physics/clubs';
import type { SwingPanelView } from '../core/view';
import type { FrameContext, InitContext, RenderModule } from './shared';

export interface GolferPose {
  /** Ball position on the ground (world) and aim yaw (radians, 0 = facing -Z target... see Golfer docs). */
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
  init(ctx: InitContext) {
    ctx.scene.add(this.root);
  }
  update(_ctx: FrameContext) {}
  setVisible(v: boolean) {
    this.root.visible = v;
  }
  /** Address/swing pose. */
  setSwingPose(_p: GolferPose) {}
  /** Walking/idle pose at a world position facing yaw (radians about +Y, 0 = facing -Z). speed m/s. */
  setWalkPose(_pos: THREE.Vector3, _yaw: number, _speed: number) {}
  /** World position of the clubhead (for effects/audio). */
  clubheadWorld(out: THREE.Vector3) {
    return out.set(0, 0, 0);
  }
}
