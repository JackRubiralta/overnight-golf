/**
 * Terrain: chunked heightfield meshes with distance LOD + skirts, shaded by a splat material
 * driven by the baked SDF masks (fairway / green / fringe / rough / sand / tee / path / dirt).
 * (Baseline implementation — see Terrain shader upgrades in DECISIONS.md.)
 */
import * as THREE from 'three';
import { COURSE_GLSL, courseUniforms, globalUniforms, type FrameContext, type InitContext, type QualityPreset, type RenderModule } from './shared';

const CHUNK_CELLS = 64; // cells per chunk side at LOD0 (64 * 1.25 m = 80 m)

export class Terrain implements RenderModule {
  group = new THREE.Group();
  material!: THREE.MeshStandardMaterial;
  private lods: THREE.LOD[] = [];
  private bias = 1;

  init(ctx: InitContext) {
    const g = ctx.grids;
    const cell = (2 * g.half) / (g.res - 1);
    this.material = this.createMaterial(ctx);
    const chunks = Math.ceil((g.res - 1) / CHUNK_CELLS);
    for (let cj = 0; cj < chunks; cj++) {
      for (let ci = 0; ci < chunks; ci++) {
        const lod = new THREE.LOD();
        const i0 = ci * CHUNK_CELLS;
        const j0 = cj * CHUNK_CELLS;
        const steps = [1, 2, 4, 8];
        const dists = [0, 160, 380, 800];
        steps.forEach((step, k) => {
          const geo = buildChunk(g.heights, g.res, i0, j0, CHUNK_CELLS, step, cell, g.half);
          const mesh = new THREE.Mesh(geo, this.material);
          mesh.receiveShadow = true;
          mesh.castShadow = k <= 1;
          mesh.matrixAutoUpdate = false;
          lod.addLevel(mesh, dists[k]);
        });
        lod.position.set(0, 0, 0);
        lod.autoUpdate = true;
        this.lods.push(lod);
        this.group.add(lod);
      }
    }
    ctx.scene.add(this.group);
    this.setQuality(ctx.quality);
  }

  setQuality(q: QualityPreset) {
    this.bias = q.terrainLodBias;
    const dists = [0, 160, 380, 800].map((d) => d * this.bias);
    for (const lod of this.lods) lod.levels.forEach((l, i) => (l.distance = dists[i]));
  }

  update(_ctx: FrameContext) {
    /* LOD auto-updates during render */
  }

  private createMaterial(ctx: InitContext) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const uniforms = { ...courseUniforms(ctx.textures), uTime: globalUniforms.uTime };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWorldPos;
${COURSE_GLSL}
float th(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 xz = vWorldPos.xz;
  vec4 mA = courseMaskA(xz);
  vec4 mBr = courseMaskBRaw(xz);
  float teeD = (mBr.r * 255.0 - 128.0) / 16.0;
  float pathD = (mBr.g * 255.0 - 128.0) / 16.0;
  float corridor = mBr.b * 255.0 * 0.5;
  float n1 = fbm2(xz * 0.35);
  float n2 = fbm2(xz * 0.05);
  float edgeN = (n1 - 0.5) * 0.35;
  vec3 rough = mix(vec3(0.16, 0.24, 0.07), vec3(0.22, 0.28, 0.09), n2) * (0.8 + 0.4 * n1);
  vec3 deep = mix(vec3(0.17, 0.2, 0.07), vec3(0.24, 0.24, 0.1), n2);
  vec3 col = mix(rough, deep, smoothstep(20.0, 40.0, corridor));
  // Fairway with mowing stripes (stripe along the dominant direction, 6 m bands).
  float stripes = step(0.5, fract((xz.x * 0.7 + xz.y * 0.7) / 12.0));
  vec3 fw = mix(vec3(0.24, 0.42, 0.1), vec3(0.3, 0.5, 0.13), stripes) * (0.92 + 0.12 * n1);
  float fwM = th(mA.r + edgeN, 0.25);
  col = mix(col, fw, fwM);
  // Fringe & green
  vec3 fringe = vec3(0.26, 0.45, 0.12) * (0.95 + 0.1 * n1);
  col = mix(col, fringe, th(mA.g - 1.6 + edgeN, 0.2));
  float gstr = step(0.5, fract((xz.x * 0.2 - xz.y * 0.98) / 3.0));
  vec3 green = mix(vec3(0.28, 0.52, 0.14), vec3(0.32, 0.56, 0.16), gstr) * (0.96 + 0.06 * n1);
  col = mix(col, green, th(mA.g, 0.12));
  // Tee
  col = mix(col, mix(vec3(0.27, 0.48, 0.13), vec3(0.31, 0.53, 0.15), stripes), th(teeD, 0.15));
  // Path
  col = mix(col, vec3(0.55, 0.53, 0.48) * (0.85 + 0.2 * n1), th(pathD, 0.15));
  // Sand (with a darker wet rim)
  vec3 sand = vec3(0.86, 0.78, 0.6) * (0.9 + 0.15 * n1);
  col = mix(col, vec3(0.45, 0.4, 0.3), th(mA.b - 0.25, 0.15));
  col = mix(col, sand, th(mA.b + 0.05 + edgeN * 0.5, 0.1));
  // Lake bed / muddy banks
  col = mix(col, vec3(0.28, 0.25, 0.17), th(mA.a - 1.5, 1.0));
  diffuseColor.rgb = col;
}`,
        );
    };
    return mat;
  }
}

/** Build one chunk mesh at a given step (LOD), with a skirt to hide LOD cracks. */
function buildChunk(heights: Float32Array, res: number, i0: number, j0: number, cells: number, step: number, cell: number, half: number) {
  const n = Math.floor(cells / step) + 1;
  const verts = (n * n + 4 * n) * 3;
  const pos = new Float32Array(verts);
  const nrm = new Float32Array(verts);
  const H = (i: number, j: number) => {
    i = Math.max(0, Math.min(res - 1, i));
    j = Math.max(0, Math.min(res - 1, j));
    return heights[j * res + i];
  };
  let v = 0;
  const put = (i: number, j: number, yOff: number) => {
    const x = -half + i * cell;
    const z = -half + j * cell;
    pos[v * 3] = x;
    pos[v * 3 + 1] = H(i, j) + yOff;
    pos[v * 3 + 2] = z;
    const hx = H(i + 1, j) - H(i - 1, j);
    const hz = H(i, j + 1) - H(i, j - 1);
    const l = Math.hypot(hx, 2 * cell, hz);
    nrm[v * 3] = -hx / l;
    nrm[v * 3 + 1] = (2 * cell) / l;
    nrm[v * 3 + 2] = -hz / l;
    v++;
  };
  for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) put(i0 + a * step, j0 + b * step, 0);
  const idx: number[] = [];
  for (let b = 0; b < n - 1; b++) {
    for (let a = 0; a < n - 1; a++) {
      const p = b * n + a;
      // Diagonal from (a, b+1) to (a+1, b) — matches Course.height() triangulation.
      idx.push(p, p + n, p + 1, p + 1, p + n, p + n + 1);
    }
  }
  // Skirts along the 4 edges.
  const skirt = 1.5 * step;
  const edges: [number, number][][] = [[], [], [], []];
  for (let k = 0; k < n; k++) {
    edges[0].push([k, 0]);
    edges[1].push([n - 1, k]);
    edges[2].push([n - 1 - k, n - 1]);
    edges[3].push([0, n - 1 - k]);
  }
  for (const e of edges) {
    const start = v;
    for (const [a, b] of e) put(i0 + a * step, j0 + b * step, -skirt);
    for (let k = 0; k < e.length - 1; k++) {
      const top0 = e[k][1] * n + e[k][0];
      const top1 = e[k + 1][1] * n + e[k + 1][0];
      const bot0 = start + k;
      const bot1 = start + k + 1;
      idx.push(top0, bot0, top1, top1, bot0, bot1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, v * 3), 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}
