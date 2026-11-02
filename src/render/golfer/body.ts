/**
 * Procedural golfer body (original design): smooth lathe/ellipsoid parts for a ~1.80 m
 * stylised-realistic player in a navy polo, stone trousers, white cap + shoes, sports
 * sunglasses and a white glove on the lead (left) hand.
 *
 * Bone-local conventions (see rig.ts which poses them):
 *   PELVIS  origin pelvis centre, +Y up the spine, +Z forward (belly), +X = golfer's LEFT
 *   CHEST   origin at the waist, same axes as PELVIS
 *   NECK    origin neck base, +Y toward the head
 *   HEAD    origin head centre (ear level), +Y up, +Z face direction
 *   limbs   origin proximal joint, +Y toward the distal joint
 *   FOOT    origin ankle, +Y up, +Z toward the toe
 *   FIST    origin on the club shaft axis at the hand centre, axes = club frame
 */
import * as THREE from 'three';
import { CLUB_KINDS, buildClub, type ClubInfo } from './clubs';
import { M, PartBuilder, cyl, ellipsoid, limb, type Surface } from './geom';
import type { ClubKind } from '../../physics/clubs';

/** Body dimensions (metres). Shared with the rig so meshes and IK agree. */
export const DIM = {
  pelvisH: 0.93, // standing pelvis-centre height
  waist: 0.11, // pelvis centre → waist (chest origin)
  hipX: 0.092,
  hipY: -0.05,
  shoulderX: 0.172,
  shoulderY: 0.395, // above the waist
  shoulderZ: -0.025,
  neckY: 0.45,
  neckLen: 0.115,
  headUp: 0.075, // neck top → head centre
  upperArm: 0.295,
  foreArm: 0.268,
  wristToFist: 0.072,
  thigh: 0.43,
  shin: 0.41,
  ankleH: 0.075,
};

export enum Bone {
  Pelvis,
  Chest,
  Neck,
  Head,
  UpperL,
  ForeL,
  HandL,
  UpperR,
  ForeR,
  HandR,
  ThighL,
  ShinL,
  FootL,
  ThighR,
  ShinR,
  FootR,
  FistL,
  FistR,
  Club0, // + index in CLUB_KINDS
}
export const BONE_COUNT = Bone.Club0 + CLUB_KINDS.length;

export interface Outfit {
  shirt: number;
  shirtTrim: number;
  trousers: number;
  belt: number;
  shoes: number;
  sole: number;
  cap: number;
  capBrim: number;
  skin: number;
  hair: number;
  glove: number;
}

export const DEFAULT_OUTFIT: Outfit = {
  shirt: 0x2b4f78,
  shirtTrim: 0xe9e6dc,
  trousers: 0xb7a98a,
  belt: 0x3b2a1d,
  shoes: 0xf1f0ec,
  sole: 0x9c9a94,
  cap: 0xf0efe9,
  capBrim: 0x1f3656,
  skin: 0xc68b67,
  hair: 0x3a2a1f,
  glove: 0xf6f5f0,
};

/** Back-of-hand directions in fist (club) space: lead hand faces the target, trail hand away. */
export const BACK_L = new THREE.Vector3(1, 0, 0.45).normalize();
export const BACK_R = new THREE.Vector3(-1, 0, 0.3).normalize();

export function buildGolferGeometry(o: Outfit = DEFAULT_OUTFIT) {
  const b = new PartBuilder();
  const cloth = (c: number, rough = 0.86): Surface => ({ color: c, rough });
  const shirt = cloth(o.shirt, 0.8);
  const trousers = cloth(o.trousers, 0.88);
  const skin: Surface = { color: o.skin, rough: 0.55 };

  // ---- pelvis / trousers -------------------------------------------------------------
  const hips = new THREE.LatheGeometry(
    [
      [0.06, -0.15],
      [0.115, -0.13],
      [0.152, -0.08],
      [0.168, -0.02],
      [0.166, 0.04],
      [0.155, 0.09],
      [0.148, 0.125],
      [0.12, 0.135],
      [0.0, 0.136],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    20,
  );
  b.add(hips, Bone.Pelvis, trousers, M.s(1, 1, 0.74));
  // Seat: two soft lobes at the back.
  for (const sx of [1, -1]) b.add(ellipsoid(0.085, 0.085, 0.07, 14, 10), Bone.Pelvis, trousers, M.t(sx * 0.06, -0.045, -0.045));
  // Belt + buckle.
  b.add(cyl(0.151, 0.149, 0.1, 0.13, 20, true), Bone.Pelvis, { color: o.belt, rough: 0.4 }, M.s(1, 1, 0.75));
  b.add(new THREE.BoxGeometry(0.03, 0.022, 0.006), Bone.Pelvis, { color: 0xc9c4b8, rough: 0.25, metal: 1 }, M.t(0, 0.115, 0.113));

  // ---- chest / polo -----------------------------------------------------------------
  const torso = new THREE.LatheGeometry(
    [
      [0.0, -0.06],
      [0.128, -0.055],
      [0.136, 0.03],
      [0.146, 0.12],
      [0.162, 0.22],
      [0.17, 0.3],
      [0.166, 0.36],
      [0.14, 0.41],
      [0.075, 0.455],
      [0.0, 0.46],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    22,
  );
  b.add(torso, Bone.Chest, shirt, M.s(1.1, 1, 0.72));
  // Pecs/back fill so the chest isn't a pure ellipse.
  b.add(ellipsoid(0.15, 0.1, 0.1), Bone.Chest, shirt, M.t(0, 0.27, 0.025));
  b.add(ellipsoid(0.16, 0.12, 0.09), Bone.Chest, shirt, M.t(0, 0.29, -0.03));
  // Collar (two-tone) and placket buttons.
  const collar = new THREE.TorusGeometry(0.066, 0.014, 6, 18);
  collar.rotateX(Math.PI / 2 + 0.25);
  b.add(collar, Bone.Chest, cloth(o.shirt, 0.75), M.trs(0, 0.455, 0.0, 0, 0, 0, 1, 1, 0.9));
  const trim = new THREE.TorusGeometry(0.07, 0.006, 4, 18);
  trim.rotateX(Math.PI / 2 + 0.25);
  b.add(trim, Bone.Chest, cloth(o.shirtTrim, 0.7), M.trs(0, 0.448, 0.003, 0, 0, 0, 1, 1, 0.9));
  for (let i = 0; i < 2; i++) b.add(new THREE.SphereGeometry(0.0055, 6, 4), Bone.Chest, { color: 0xf4f2ea, rough: 0.3 }, M.t(0, 0.4 - i * 0.04, 0.112 - i * 0.004));

  // ---- neck & head ------------------------------------------------------------------
  b.add(limb(0.05, 0.047, DIM.neckLen, 12), Bone.Neck, skin);
  buildHead(b, o, skin);

  // ---- arms ------------------------------------------------------------------------
  for (const side of [1, -1]) {
    const up = side > 0 ? Bone.UpperL : Bone.UpperR;
    const fo = side > 0 ? Bone.ForeL : Bone.ForeR;
    const ha = side > 0 ? Bone.HandL : Bone.HandR;
    b.add(ellipsoid(0.058, 0.064, 0.058), up, shirt, M.t(0, 0.03, 0)); // deltoid / sleeve cap
    b.add(limb(0.066, 0.058, 0.15, 14), up, shirt); // short sleeve
    const cuff = new THREE.TorusGeometry(0.057, 0.0045, 4, 16);
    cuff.rotateX(Math.PI / 2);
    b.add(cuff, up, cloth(o.shirtTrim, 0.7), M.t(0, 0.153, 0));
    b.add(limb(0.046, 0.038, DIM.upperArm, 12, 0.004, 0.4), up, skin);
    b.add(limb(0.039, 0.028, DIM.foreArm, 12, 0.007, 0.25), fo, skin);
    // Hand (wrist → fist): flattened along +Z (= back of the hand normal).
    const handSurf: Surface = side > 0 ? { color: o.glove, rough: 0.62 } : skin;
    b.add(limb(0.026, 0.03, DIM.wristToFist - 0.015, 10), ha, handSurf, M.s(1.25, 1, 0.72));
    // Fist wrapped around the grip (bound to the fist bone that follows the club).
    const fist = side > 0 ? Bone.FistL : Bone.FistR;
    const back = side > 0 ? BACK_L : BACK_R;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), back);
    const fistM = (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number) =>
      new THREE.Matrix4().compose(new THREE.Vector3(ox, oy, oz).applyQuaternion(q), q, new THREE.Vector3(sx, sy, sz));
    b.add(ellipsoid(0.03, 0.046, 0.031, 14, 10), fist, handSurf, fistM(0, 0, 0.006, 1, 1, 1));
    b.add(ellipsoid(0.03, 0.044, 0.014, 12, 8), fist, handSurf, fistM(0, 0.004, 0.028, 1, 1, 1)); // knuckles / back
    // Thumb lying down the grip on the trail side of the shaft.
    b.add(limb(0.011, 0.009, 0.04, 8), fist, handSurf, fistM(-side * 0.018, 0.02, -0.018, 1, -1, 1));
    // Glove velcro tab on the lead hand.
    if (side > 0) b.add(ellipsoid(0.018, 0.012, 0.004, 8, 6), fist, { color: 0x1f3656, rough: 0.6 }, fistM(0, 0.035, 0.04, 1, 1, 1));
  }

  // ---- legs ------------------------------------------------------------------------
  for (const side of [1, -1]) {
    const th = side > 0 ? Bone.ThighL : Bone.ThighR;
    const sh = side > 0 ? Bone.ShinL : Bone.ShinR;
    const ft = side > 0 ? Bone.FootL : Bone.FootR;
    b.add(limb(0.088, 0.064, DIM.thigh, 14, 0.006, 0.3), th, trousers);
    b.add(limb(0.064, 0.054, DIM.shin, 14, 0.004, 0.3), sh, trousers);
    // Trouser hem with a slight break over the shoe.
    b.add(cyl(0.055, 0.059, DIM.shin - 0.06, DIM.shin + 0.02, 14, true), sh, trousers);
    buildShoe(b, ft, o);
  }

  // ---- clubs -----------------------------------------------------------------------
  const clubs = {} as Record<ClubKind, ClubInfo>;
  CLUB_KINDS.forEach((k, i) => {
    clubs[k] = buildClub(b, Bone.Club0 + i, k);
  });

  return { geometry: b.build(), clubs };
}

function buildHead(b: PartBuilder, o: Outfit, skin: Surface) {
  const hair: Surface = { color: o.hair, rough: 0.8 };
  // Skull (painted: short hair at the back/sides, skin on the face).
  b.addPainted(ellipsoid(0.077, 0.108, 0.095, 20, 14), Bone.Head, (p) => ((p.z < -0.005 && p.y > -0.05) || p.y > 0.05 || (Math.abs(p.x) > 0.06 && p.y > 0.0 && p.z < 0.04) ? hair : skin), M.t(0, 0.012, 0));
  // Jaw and chin.
  b.add(ellipsoid(0.058, 0.05, 0.066, 14, 10), Bone.Head, skin, M.t(0, -0.06, 0.026));
  // Nose, ears.
  const nose = new THREE.ConeGeometry(0.011, 0.03, 6);
  nose.rotateX(Math.PI / 2 - 0.35);
  b.add(nose, Bone.Head, skin, M.t(0, -0.012, 0.096));
  for (const s of [1, -1]) b.add(ellipsoid(0.011, 0.026, 0.018, 8, 6), Bone.Head, skin, M.t(s * 0.077, -0.004, -0.004));
  // Wrap-around sports sunglasses.
  const lens = new THREE.CylinderGeometry(0.084, 0.084, 0.026, 18, 1, true, -1.25, 2.5);
  b.add(lens, Bone.Head, { color: 0x0e1012, rough: 0.12, metal: 0.4 }, M.trs(0, 0.016, 0.004, 0, 0, 0, 1, 1, 1.12));
  // Cap: crown, brim, button.
  const crown = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(crown, Bone.Head, { color: o.cap, rough: 0.82 }, M.trs(0, 0.042, -0.004, 0, 0, 0, 0.086, 0.082, 0.102));
  const band = cyl(0.0865, 0.0865, 0.036, 0.046, 20, true);
  b.add(band, Bone.Head, { color: o.capBrim, rough: 0.8 }, M.trs(0, 0, -0.004, 0, 0, 0, 1, 1, 1.18));
  b.add(new THREE.SphereGeometry(0.008, 6, 4), Bone.Head, { color: o.capBrim, rough: 0.8 }, M.t(0, 0.123, -0.004));
  const brim = new THREE.Shape();
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const a = -1.25 + (2.5 * i) / N;
    const x = Math.sin(a) * 0.088;
    const z = Math.cos(a) * 0.17;
    if (i === 0) brim.moveTo(x, z);
    else brim.lineTo(x, z);
  }
  for (let i = N; i >= 0; i--) {
    const a = -1.25 + (2.5 * i) / N;
    brim.lineTo(Math.sin(a) * 0.084, Math.cos(a) * 0.095);
  }
  const brimG = new THREE.ExtrudeGeometry(brim, { depth: 0.005, bevelEnabled: false });
  // shape (x, y=z_head) → head (x, z); extrude → head -y
  brimG.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
  b.add(brimG, Bone.Head, { color: o.capBrim, rough: 0.8 }, M.trs(0, 0.046, -0.004, 0.2, 0, 0));
}

function buildShoe(b: PartBuilder, bone: number, o: Outfit) {
  const y0 = -DIM.ankleH;
  // Footprint (x = lateral, y = -z along the foot) → extruded upward as the sole.
  const fp = new THREE.Shape();
  const pts: [number, number][] = [
    [0.0, -0.07],
    [0.034, -0.062],
    [0.04, -0.02],
    [0.046, 0.06],
    [0.05, 0.13],
    [0.04, 0.185],
    [0.0, 0.205],
    [-0.035, 0.19],
    [-0.046, 0.13],
    [-0.038, 0.06],
    [-0.034, -0.02],
    [-0.03, -0.062],
  ];
  fp.moveTo(pts[0][0], -pts[0][1]);
  fp.splineThru([...pts.slice(1), pts[0]].map(([x, z]) => new THREE.Vector2(x, -z)));
  const sole = new THREE.ExtrudeGeometry(fp, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
  // shape (x, -z) + extrusion along +z_shape → foot (x, y, z): y' = extrusion, z' = -shape.y
  sole.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
  b.add(sole, bone, { color: o.sole, rough: 0.75 }, M.t(0, y0 + 0.004, 0));
  // Upper: half-dome plus a toe box and heel counter.
  const dome = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(dome, bone, { color: o.shoes, rough: 0.42 }, M.trs(0.004, y0 + 0.02, 0.07, 0, 0, 0, 0.046, 0.075, 0.13));
  b.add(ellipsoid(0.042, 0.03, 0.06, 12, 8), bone, { color: o.shoes, rough: 0.42 }, M.t(0.004, y0 + 0.03, 0.135));
  // Accent swoosh-free side stripe (original): a thin navy band along the upper.
  b.add(ellipsoid(0.047, 0.012, 0.1, 14, 6), bone, { color: 0x1f3656, rough: 0.5 }, M.t(0.004, y0 + 0.034, 0.06));
}
