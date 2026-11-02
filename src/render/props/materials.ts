/**
 * Shared PBR materials for all props. Every merged prop mesh uses one of these by key, so the
 * whole prop layer compiles a handful of programs and textures are created exactly once.
 */
import * as THREE from 'three';
import { crateTexture, flagAtlas, gongTexture, grimeTexture, signAtlas, slateTexture, stoneTexture, strawTexture, targetTexture, windowTexture, woodTexture } from './textures';

export type PropMaterials = Record<string, THREE.Material> & {
  glass: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
};

export interface PropTextures {
  flags: THREE.Texture;
  signs: THREE.Texture;
}

/** Tunables */
const WINDOW_GLOW = new THREE.Color('#ffb15a');
const LAMP_GLOW = new THREE.Color('#ffd08a');

export function createPropMaterials(): { mats: PropMaterials; tex: PropTextures; dispose: () => void } {
  const grime = grimeTexture();
  grime.repeat.set(0.5, 0.5);
  const wood = woodTexture();
  const stone = stoneTexture();
  stone.map.repeat.set(0.5, 0.5);
  stone.bump.repeat.set(0.5, 0.5);
  const slate = slateTexture();
  slate.repeat.set(0.5, 0.5);
  const straw = strawTexture();
  const crate = crateTexture();
  const target = targetTexture();
  const gong = gongTexture();
  const win = windowTexture();
  const flags = flagAtlas();
  const signs = signAtlas();

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...p });
  // 'paint' reads roughness/metalness from the per-vertex `pbr` attribute (see builder.PBR_PRESETS).
  const paint = std({ map: grime, roughness: 1, metalness: 1 });
  paint.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vPbr.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vPbr.y;');
  };
  paint.customProgramCacheKey = () => 'thornbury-props-paint-v1';
  const mats = {
    paint,
    wood: std({ map: wood, roughness: 0.82, metalness: 0 }),
    stone: std({ map: stone.map, bumpMap: stone.bump, bumpScale: 2.5, roughness: 0.92, metalness: 0 }),
    roof: std({ map: slate, roughness: 0.62, metalness: 0.05 }),
    hay: std({ map: straw, roughness: 0.95, metalness: 0 }),
    terracottaDS: std({ map: grime, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }),
    crate: std({ map: crate, roughness: 0.8, metalness: 0 }),
    target: std({ map: target, roughness: 0.85, metalness: 0 }),
    brass: std({ map: gong, roughness: 0.3, metalness: 1 }),
    sign: std({ map: signs, roughness: 0.7, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 0.08, metalness: 0.1, emissive: WINDOW_GLOW, emissiveMap: win, emissiveIntensity: 1.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#fff2d0', roughness: 0.4, emissive: LAMP_GLOW, emissiveIntensity: 2 }),
  } as PropMaterials;
  const dispose = () => {
    for (const m of Object.values(mats)) m.dispose();
    for (const t of [grime, wood, stone.map, stone.bump, slate, straw, crate, target, gong, win, flags, signs]) t.dispose();
  };
  return { mats, tex: { flags, signs }, dispose };
}
