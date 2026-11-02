/**
 * Impostor atlas baking: each tree variant's LOD0 mesh is rendered (unlit) from FRAMES azimuths
 * around the Y axis into a shared atlas — one row per variant, one column per view — once for
 * sqrt(albedo) and once for object-space normals (+ leaf mask in alpha). The far LOD is then a
 * single instanced draw of camera-facing quads that pick (and blend) the two nearest views and
 * light them with three's PBR model, so distant woods keep their shape and react to the sun.
 */
import * as THREE from 'three';
import { createBakeMaterial, type ImpostorAtlas } from './materials';
import type { TreeGeometry, TreeSkeleton } from './treeGen';

export const IMPOSTOR_FRAMES = 8;

export interface ImpostorFrame {
  /** Half width and height range (object units) covered by the frame. */
  halfW: number;
  yMin: number;
  yMax: number;
}

export interface BakeInput {
  sk: TreeSkeleton;
  geo: TreeGeometry;
  leafMap: THREE.Texture;
  barkMap: THREE.Texture;
  leafTint: THREE.Color;
  barkTint: THREE.Color;
}

/** Frame bounds for a variant (slightly padded). */
export function impostorFrame(sk: TreeSkeleton): ImpostorFrame {
  return { halfW: sk.maxRadius * 1.04 + 0.1, yMin: -0.4, yMax: sk.height * 1.03 + 0.1 };
}

export function bakeImpostors(renderer: THREE.WebGLRenderer, inputs: BakeInput[], tile: number): { atlas: ImpostorAtlas; frames: ImpostorFrame[] } {
  const rows = inputs.length;
  const W = IMPOSTOR_FRAMES * tile;
  const H = rows * tile;
  const mk = () => {
    const rt = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      // Allocates the full mip chain; generation is deferred until every frame is drawn.
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.anisotropy = 4;
    return rt;
  };
  const albedoRT = mk();
  const normalRT = mk();

  const mode = { value: 0 };
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const frames: ImpostorFrame[] = [];

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;

  // Clear: albedo background = a mid foliage colour (mip bleed), normal background = up.
  renderer.setRenderTarget(albedoRT);
  renderer.setClearColor(new THREE.Color(0.28, 0.33, 0.2), 0);
  renderer.clear(true, true, false);
  renderer.setRenderTarget(normalRT);
  renderer.setClearColor(new THREE.Color(0.5, 1.0, 0.5), 0);
  renderer.clear(true, true, false);
  // Storage (with mip levels) now exists: skip per-render mip generation while baking.
  albedoRT.texture.generateMipmaps = false;
  normalRT.texture.generateMipmaps = false;

  const disposables: THREE.Material[] = [];
  inputs.forEach((inp, row) => {
    const fr = impostorFrame(inp.sk);
    frames.push(fr);
    const barkMat = createBakeMaterial(inp.barkMap, inp.barkTint, false, mode);
    const leafMat = createBakeMaterial(inp.leafMap, inp.leafTint, true, mode);
    disposables.push(barkMat, leafMat);
    const bark = new THREE.Mesh(inp.geo.bark, barkMat);
    const leaves = new THREE.Mesh(inp.geo.leaves, leafMat);
    scene.add(bark, leaves);
    cam.left = -fr.halfW;
    cam.right = fr.halfW;
    cam.bottom = fr.yMin;
    cam.top = fr.yMax;
    const dist = fr.halfW + 20;
    cam.near = 1;
    cam.far = dist + fr.halfW + 20;
    cam.updateProjectionMatrix();
    for (let f = 0; f < IMPOSTOR_FRAMES; f++) {
      const th = (f / IMPOSTOR_FRAMES) * Math.PI * 2;
      cam.position.set(Math.sin(th) * dist, 0, Math.cos(th) * dist);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld();
      for (const [rt, m] of [[albedoRT, 0], [normalRT, 1]] as const) {
        mode.value = m;
        rt.viewport.set(f * tile, row * tile, tile, tile);
        rt.scissor.set(f * tile, row * tile, tile, tile);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.clear(false, true, false); // depth only for this frame
        renderer.render(scene, cam);
      }
    }
    scene.remove(bark, leaves);
  });

  // Mipmaps once at the end.
  for (const rt of [albedoRT, normalRT]) {
    rt.scissorTest = false;
    rt.viewport.set(0, 0, W, H);
    rt.texture.generateMipmaps = true;
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam); // empty scene: only triggers mipmap generation
  }

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadow;
  for (const m of disposables) m.dispose();

  return { atlas: { albedo: albedoRT.texture, normal: normalRT.texture, frames: IMPOSTOR_FRAMES, rows }, frames };
}
