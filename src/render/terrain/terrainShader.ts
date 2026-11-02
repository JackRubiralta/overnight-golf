/**
 * GLSL for the terrain splat material (injected into MeshStandardMaterial via onBeforeCompile,
 * so PBR lighting, shadows, fog and IBL keep working).
 *
 * Vertex: GPU displacement from the baked heightmap + geomorph toward the next LOD level.
 * Fragment: procedural surfaces (fairway / first cut / green / tee / rough / deep rough /
 * forest floor / rock / far forest canopy / sand / cart path / lake bed), driven by the baked
 * SDF masks. Everything is procedural, hash-based value noise in world space (never periodic,
 * so nothing can tile). Every high-frequency pattern is faded by its pixel footprint
 * (fwidth of world xz) so distant terrain never aliases.
 *
 * All colours are LINEAR albedo.
 */
import { COURSE_GLSL } from '../shared';
import { MAX_FAIRWAY_SEGS, MAX_HOLES } from './TerrainData';

// ------------------------------------------------------------------ tuning (shared by GLSL)
/** Fairway mowing band width (m) and green cross-cut band width (m). */
export const FAIRWAY_STRIPE_W = 4.6;
export const GREEN_STRIPE_W = 2.2;
export const TEE_STRIPE_W = 1.6;

const f = (v: number) => v.toFixed(4);

// ------------------------------------------------------------------ vertex
export const TERRAIN_VERTEX_PARS = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uSlopeTex;
uniform float uCourseHalf;
uniform float uCourseRes;
uniform vec3 uCameraPos;
uniform float uStep;   // grid step of this LOD level (cells)
uniform vec2 uMorph;   // morph window (start, end) in metres from the camera
#ifdef TERRAIN_COLOR
varying vec3 vWorldPos;
#endif
float tHeight(ivec2 ij) {
  ij = clamp(ij, ivec2(0), ivec2(int(uCourseRes) - 1));
  return texelFetch(uHeightTex, ij, 0).r;
}
// p: local chunk-grid position (y < 0 marks skirt vertices). Returns local displaced position.
vec3 terrainDisplace(vec3 p, out vec3 nrmW) {
  vec4 w = vec4(p.x, 0.0, p.z, 1.0);
  #ifdef USE_INSTANCING
  w = instanceMatrix * w;
  #endif
  float cell = 2.0 * uCourseHalf / (uCourseRes - 1.0);
  ivec2 ij = ivec2(floor((w.xz + uCourseHalf) / cell + 0.5));
  float h = tHeight(ij);
  // Height of the next-coarser level at this vertex (diagonal (i,j+1)-(i+1,j) as in Course.height).
  int s = int(uStep + 0.5);
  ivec2 odd = (ij / s) % 2;
  float hc = h;
  if (odd.x == 1 && odd.y == 0) hc = 0.5 * (tHeight(ij - ivec2(s, 0)) + tHeight(ij + ivec2(s, 0)));
  else if (odd.x == 0 && odd.y == 1) hc = 0.5 * (tHeight(ij - ivec2(0, s)) + tHeight(ij + ivec2(0, s)));
  else if (odd.x == 1 && odd.y == 1) hc = 0.5 * (tHeight(ij + ivec2(-s, s)) + tHeight(ij + ivec2(s, -s)));
  float d = distance(uCameraPos, vec3(w.x, h, w.z));
  float m = clamp((d - uMorph.x) / (uMorph.y - uMorph.x), 0.0, 1.0);
  float y = mix(h, hc, m) + min(p.y, 0.0);
  vec2 g = texelFetch(uSlopeTex, clamp(ij, ivec2(0), ivec2(int(uCourseRes) - 1)), 0).xy;
  nrmW = normalize(vec3(-g.x, 1.0, -g.y));
  #ifdef TERRAIN_COLOR
  vWorldPos = vec3(w.x, y, w.z);
  #endif
  return vec3(p.x, y, p.z);
}
`;

// ------------------------------------------------------------------ fragment
export const TERRAIN_FRAGMENT_PARS = /* glsl */ `
#define MAX_FAIRWAY_SEGS ${MAX_FAIRWAY_SEGS}
#define MAX_HOLES ${MAX_HOLES}
varying vec3 vWorldPos;
uniform sampler2D uSlopeTex;
uniform vec3 uCameraPos;
uniform float uWetness;
uniform vec4 uFairSeg[MAX_FAIRWAY_SEGS];
uniform int uFairCount;
uniform vec4 uGreens[MAX_HOLES];
uniform vec4 uTees[MAX_HOLES];
uniform int uHoleCount;
${COURSE_GLSL}

// Detail outputs consumed by the roughness / normal stages.
vec2 tGrad;     // detail height gradient (dh/dx, dh/dz) added to the macro slope
vec2 tSlopeG;   // macro slope from the slope texture
float tRough;
float tSpec;   // specular occlusion (grass blades self-shadow their grazing sheen)

// ---------- noise (value noise with analytic derivatives, IQ style)
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// Value noise (quintic fade, C2) for colour variation, 0..1.
float vnoise(vec2 x) {
  vec2 i = floor(x); vec2 fr = fract(x); vec2 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
// Gradient noise with analytic derivatives (quintic), for detail normals: (value ~0..1, d/dx, d/dy).
// Gradient noise has no lattice-aligned plateaus, so lit detail never shows a square grid.
vec2 gHash(vec2 p) { return normalize(hash22(p) * 2.0 - 1.0 + 1e-4); }
vec3 noised(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = gHash(i), gb = gHash(i + vec2(1, 0)), gc = gHash(i + vec2(0, 1)), gd = gHash(i + vec2(1, 1));
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(0.5 + 0.7 * v, 0.7 * d);
}
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 x, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { if (i >= oct) break; s += a * vnoise(x); x = ROT * x * 2.03 + 17.1; a *= 0.5; }
  return s / (1.0 - pow(0.5, float(oct)));
}
// fbm with derivatives; value ~0..1, gradient w.r.t. x
vec3 fbmd(vec2 x, int oct) {
  float s = 0.0, a = 0.5; vec2 dsum = vec2(0.0); mat2 m = mat2(1.0);
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    vec3 n = noised(x);
    s += a * n.x; dsum += a * (m * n.yz);
    x = ROT * x * 2.03 + 17.1; m = 2.03 * transpose(ROT) * m; a *= 0.5;
  }
  float norm = 1.0 / (1.0 - pow(0.5, float(oct)));
  return vec3(s, dsum) * norm;
}
// Visibility of a pattern of frequency 'freq' (cycles/m) at footprint 'fp' (m/pixel).
float vis(float fp, float freq) { return 1.0 - smoothstep(0.1, 0.42, fp * freq); }
// Coverage of an SDF (inside = negative) with an antialiased edge.
float inside(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
// Band-limited square wave (-1..1) for mowing stripes; t in band units, fpT = footprint in band units.
float stripeWave(float t, float fpT) {
  float s = sin(3.14159265 * t);
  return clamp(s / max(3.14159265 * fpT * 1.2, 0.02), -1.0, 1.0) * (1.0 - smoothstep(0.3, 0.8, fpT));
}
// Mowing 'grain': blades laid away from the viewer look lighter, toward the viewer darker.
// v = dot(view direction, mowing direction); a small constant keeps stripes readable side-on.
float grain(float v) { return clamp(v * 3.0, -1.0, 1.0) * (0.3 + 0.55 * abs(v)) + 0.15; }
vec2 perp(vec2 v) { return vec2(-v.y, v.x); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// Palette (linear albedo). Grass greens are deliberately dark & saturated: real turf albedo is
// ~0.05–0.12 and AgX tone mapping lifts it.
const C = {
  fairwayA: '0.046, 0.140, 0.015',
  fairwayB: '0.067, 0.182, 0.022',
  firstCut: '0.042, 0.122, 0.015',
  greenA: '0.050, 0.160, 0.026',
  greenB: '0.066, 0.192, 0.033',
  fringe: '0.048, 0.146, 0.019',
  tee: '0.058, 0.168, 0.020',
  roughA: '0.034, 0.085, 0.013',
  roughB: '0.048, 0.098, 0.016',
  roughOlive: '0.058, 0.092, 0.020',
  roughCool: '0.026, 0.078, 0.022',
  deepA: '0.045, 0.072, 0.016',
  deepB: '0.064, 0.082, 0.022',
  fescue: '0.175, 0.145, 0.062',
  straw: '0.140, 0.120, 0.055',
  needles: '0.048, 0.040, 0.022',
  moss: '0.030, 0.052, 0.014',
  rockA: '0.122, 0.110, 0.092',
  rockB: '0.070, 0.063, 0.053',
  lichen: '0.110, 0.112, 0.070',
  canopyA: '0.012, 0.030, 0.010',
  canopyB: '0.032, 0.056, 0.016',
  meadow: '0.055, 0.085, 0.020',
  sand: '0.400, 0.295, 0.165',
  sandWet: '0.230, 0.165, 0.092',
  soil: '0.075, 0.052, 0.032',
  asphalt: '0.062, 0.057, 0.050',
  asphaltWorn: '0.085, 0.082, 0.080',
  gravel: '0.150, 0.130, 0.100',
  mud: '0.068, 0.056, 0.036',
  lakeBed: '0.040, 0.040, 0.028',
  divot: '0.120, 0.090, 0.050',
};

/** Injected after <color_fragment>: evaluates every surface and writes diffuseColor/tGrad/tRough. */
export const TERRAIN_SURFACE = /* glsl */ `
#define LFP(g) (abs(dot(g, dX)) + abs(dot(g, dY)))
tGrad = vec2(0.0);
tRough = 0.95;
tSpec = 0.12;
{
  vec3 wp = vWorldPos;
  vec2 xz = wp.xz;
  float dist = distance(uCameraPos, wp);
  // Pixel footprint. Isotropic patterns use a mildly anisotropic estimate (sharper than the
  // major axis, like anisotropic filtering); stripes use their exact directional footprint.
  vec2 dX = dFdx(xz), dY = dFdy(xz);
  float fwMax = max(length(dX), length(dY)), fwMin = min(length(dX), length(dY));
  float fp = max(0.002, max(fwMin, 0.55 * fwMax));      // metres per pixel
  vec2 viewXZ = normalize(xz - uCameraPos.xz + vec2(1e-4));

  vec4 sl = texture2D(uSlopeTex, courseUV(xz));
  tSlopeG = sl.xy;
  float slope = 1.0 - inversesqrt(1.0 + dot(sl.xy, sl.xy)); // 1 - n.y
  float curvS = sl.z;   // + hollow / - bump (few metres)
  float curvL = sl.w;   // + valley / - ridge (tens of metres)

  vec4 mA = courseMaskA(xz);
  vec4 mB = courseMaskBRaw(xz);
  float fwD = mA.r, grD = mA.g, bkD = mA.b, waD = mA.a;
  float fpGr = max(fwidth(grD), 0.002);
  float teeD = (mB.r * 255.0 - 128.0) / 16.0;
  float pathD = (mB.g * 255.0 - 128.0) / 16.0;
  float corridor = mB.b * 255.0 * 0.5;
  float foliage = mB.a;

  // ---- shared noise
  float mac1 = fbm(xz * 0.0045 + vec2(3.7, 1.3), 3);        // ~220 m patches
  float mac2 = fbm(xz * 0.016 + vec2(-5.1, 8.2), 3);        // ~60 m patches
  float mid = vnoise(xz * 0.13 + 7.7);                      // ~8 m
  float v21 = vis(fp, 2.1), v73 = vis(fp, 7.3);
  float eN = (vnoise(xz * 0.45) - 0.5) * 0.55 + (vnoise(xz * 2.1 + 3.3) - 0.5) * 0.24 * v21 + (vnoise(xz * 7.3) - 0.5) * 0.12 * v73;
  float aw = max(0.03, fp * 0.7);                           // antialiased edge half-width
  // Rim hills at the world edge (forest + rock instead of course grasses).
  float edge = max(abs(xz.x), abs(xz.y));
  float rim = smoothstep(520.0, 680.0, edge + (mac2 - 0.5) * 120.0);
  rim *= smoothstep(30.0, 70.0, corridor + (mac2 - 0.5) * 30.0);   // holes run close to the edge
  float dryness = sat((mac1 - 0.5) * 1.4 - curvL * 0.2 + slope * 1.0) * (1.0 - 0.8 * rim);
  float lush = sat(curvL * 0.35 + curvS * 0.15);

  // ---- rough / deep rough (base layer everywhere)
  #if TERRAIN_DETAIL > 0
  vec3 cl = fbmd(xz * 2.2, 3);                              // grass clumps (~0.45 m)
  #else
  vec3 cl = vec3(vnoise(xz * 2.2), 0.0, 0.0);
  #endif
  float vCl = vis(fp, 2.2 * 2.0);
  float clump = mix(0.5, cl.x, vCl);
  vec3 rough = mix(vec3(${C.roughA}), vec3(${C.roughB}), mac2) * (0.84 + 0.32 * clump);
  // Macro hue drift (~200 m): olive/yellowish swards vs cooler blue-green ones.
  rough = mix(rough, vec3(${C.roughOlive}), smoothstep(0.45, 0.75, mac1) * 0.4);
  rough = mix(rough, vec3(${C.roughCool}), smoothstep(0.5, 0.25, mac1) * 0.4);
  rough = mix(rough, vec3(${C.straw}), dryness * 0.12);
  rough *= 1.0 + lush * 0.12 * vec3(-0.3, 0.2, -0.4);
  // Mid-scale patchiness (~3 m and ~13 m): lighter/yellower vs darker/bluer clumps. Low enough
  // in frequency to survive at distance, so far rough never reads as a flat smear.
  float pA = mix(0.5, vnoise(xz * 0.31 + 4.1), vis(fp, 0.31));
  float pB = vnoise(xz * 0.075 - 2.3);
  float patchN = pA * 0.45 + pB * 0.55;
  rough *= 0.88 + 0.24 * patchN;
  rough = mix(rough, vec3(${C.straw}), smoothstep(0.6, 0.85, patchN) * (0.12 + 0.2 * dryness));
  float deepW = smoothstep(17.0, 30.0, corridor + eN * 10.0 + (mac2 - 0.5) * 14.0 + (pB - 0.5) * 8.0);
  // fescue: ~10 m patches, broken up by tufts that fade out with distance
  float tuftN = mix(0.5, vnoise(xz * 0.7 + 11.0), vis(fp, 0.7));
  float tuft = smoothstep(0.5, 0.8, fbm(xz * 0.07 + 2.0, 2) * 0.65 + mac2 * 0.25 + dryness * 0.2 + (tuftN - 0.5) * 0.3);
  vec3 deep = mix(vec3(${C.deepA}), vec3(${C.deepB}), mac1) * (0.72 + 0.56 * clump) * (0.82 + 0.36 * patchN);
  deep = mix(deep, vec3(${C.fescue}) * (0.75 + 0.5 * clump), tuft * (0.3 + 0.35 * dryness) * (1.0 - rim));
  vec3 col = mix(rough, deep, deepW);
  tGrad = cl.yz * 2.2 * mix(0.03, 0.07, deepW) * vCl;
  // Hummocks (~3 m, 10-25 cm high): lighting texture that still reads from far away.
  #if TERRAIN_DETAIL > 0
  {
    vec3 hk = noised(xz * 0.33 + 7.3);
    tGrad += hk.yz * 0.33 * mix(0.14, 0.3, deepW) * vis(fp, 0.33);
  }
  #endif
  #if TERRAIN_DETAIL > 1
  {
    vec3 tf = noised(xz * 5.5 + 2.0);                        // individual tufts
    float v = vis(fp, 11.0);
    col *= 1.0 + (tf.x - 0.5) * 0.3 * v;
    tGrad += tf.yz * 5.5 * 0.035 * v;
  }
  #endif
  tRough = 0.97;

  // ---- forest floor under tree clumps
  float forestW = smoothstep(0.30, 0.75, foliage + (mid - 0.5) * 0.35);
  if (forestW > 0.001) {
    vec3 ff = mix(vec3(${C.needles}), vec3(${C.moss}), smoothstep(0.35, 0.7, mid * 0.6 + mac2 * 0.4)) * (0.75 + 0.5 * clump);
    col = mix(col, ff, forestW * 0.7);
  }

  // ---- rim hills: meadow, forest canopy (seen from afar) and rock on steep ground
  if (rim > 0.001) {
    // Forest canopy: tree crowns as bumps (~6 m) with dark gaps; only once far enough away
    // not to look painted on. Stand type (dark conifer / lighter broadleaf) varies per ~60 m.
    vec3 cr = fbmd(xz * 0.16 + 4.0, 2);
    float crown = cr.x;
    float clearing = smoothstep(0.68, 0.78, mac1 + (mid - 0.5) * 0.15 + max(-curvL, 0.0) * 0.1);
    float canopyW = rim * (1.0 - clearing) * smoothstep(60.0, 180.0, dist);
    float stand = smoothstep(0.35, 0.65, mac2);
    vec3 canopy = mix(vec3(${C.canopyA}), vec3(${C.canopyB}), stand);
    canopy *= 0.75 + 0.5 * hash12(floor(xz * 0.16 + 0.5));
    canopy *= 0.35 + 0.95 * smoothstep(0.2, 0.75, crown);
    vec3 meadow = mix(vec3(${C.meadow}), vec3(${C.straw}), dryness * 0.4) * (0.8 + 0.4 * clump);
    vec3 rimCol = mix(meadow, mix(vec3(${C.needles}), vec3(${C.moss}), mid), (1.0 - clearing) * 0.7);
    col = mix(col, rimCol, rim);
    col = mix(col, canopy, canopyW);
    tGrad = mix(tGrad, cr.yz * 0.16 * 1.6, canopyW * vis(fp, 0.32));
    tSpec = mix(tSpec, 0.15, canopyW);
  }
  // Rock: steep ground and convex crests (mostly on the rim), broken into outcrops by noise.
  float rockMask = slope + max(-curvL, 0.0) * 0.02 * rim + (fbm(xz * 0.035 + 9.0, 2) - 0.5) * 0.35 + (mid - 0.5) * 0.1;
  float rockW = smoothstep(0.50, 0.60, rockMask - (1.0 - rim) * 0.1) * step(4.0, waD) * step(1.5, bkD);
  if (rockW > 0.001) {
    #if TERRAIN_DETAIL > 0
    vec3 rk = fbmd(xz * vec2(0.22, 0.25) + 1.7, 4);
    #else
    vec3 rk = vec3(fbm(xz * 0.22, 2), 0.0, 0.0);
    #endif
    float strata = sin((wp.y + rk.x * 6.0) * 1.7) * 0.5 + 0.5;
    vec3 rock = mix(vec3(${C.rockB}), vec3(${C.rockA}), sat(rk.x * 1.4 - 0.2 + strata * 0.25));
    rock = mix(rock, vec3(${C.lichen}), smoothstep(0.6, 0.8, vnoise(xz * 0.9)) * 0.35);
    rock *= 0.8 + 0.3 * vnoise(xz * 3.1) * vis(fp, 3.1);
    col = mix(col, rock, rockW);
    tGrad = mix(tGrad, rk.yz * 0.22 * 2.4 * vis(fp, 0.5), rockW);
    tRough = mix(tRough, 0.85, rockW);
    tSpec = mix(tSpec, 0.45, rockW);
  }

  // ---- first cut (collar around fairways and tees; the gameplay 'fringe' band)
  float cutW = inside(min(fwD - 2.2, teeD - 1.4) + eN * 0.45, aw + 0.05);
  if (cutW > 0.001) {
    vec3 cut = vec3(${C.firstCut}) * (0.9 + 0.2 * clump) * (0.94 + 0.12 * mac2);
    col = mix(col, cut, cutW);
    tSpec = mix(tSpec, 0.12, cutW);
    tGrad = mix(tGrad, tGrad * 0.45, cutW);
  }

  // ---- fairway: mowing stripes along the local fairway axis
  float fairW = inside(fwD + eN * 0.3, aw);
  if (fairW > 0.001) {
    float best = 1e9; vec2 dir = vec2(0.0, 1.0); float lat = 0.0;
    for (int i = 0; i < MAX_FAIRWAY_SEGS; i++) {
      if (i >= uFairCount) break;
      vec4 s = uFairSeg[i];
      vec2 ab = s.zw - s.xy; float L = length(ab); vec2 d = ab / L; vec2 ap = xz - s.xy;
      float t = clamp(dot(ap, d), 0.0, L);
      float dd = length(ap - d * t);
      // signed distance to the centre-line polyline: continuous across segment joints, so the
      // stripes follow the fairway around doglegs like a real mower would
      if (dd < best) { best = dd; dir = d; lat = (d.x * ap.y - d.y * ap.x < 0.0 ? -dd : dd); }
    }
    lat += (vnoise(xz * 0.04) - 0.5) * 2.0;              // mower lines are never perfectly straight
    float W = ${f(FAIRWAY_STRIPE_W)};
    float sw = stripeWave(lat / W + 0.5, LFP(perp(dir)) / W);
    float view = dot(viewXZ, dir);
    float b = sw * grain(view);
    vec3 fair = mix(vec3(${C.fairwayA}), vec3(${C.fairwayB}), 0.5 + 0.5 * b);
    fair *= (0.93 + 0.14 * mac2) * (0.95 + 0.1 * clump);
    // Blade streaks: the mower leaves fine lines along its direction of travel.
    {
      vec2 pd = perp(dir);
      float streak = vnoise(vec2(dot(xz, dir) * 0.5, dot(xz, pd) * 9.0));
      fair *= 1.0 + (streak - 0.5) * 0.16 * vis(LFP(pd), 9.0);
      fair *= 1.0 + (vnoise(xz * 0.9 + 3.0) - 0.5) * 0.08 * vis(fp, 0.9); // ~1 m wear / thickness
      fair *= 1.0 + (hash12(floor(xz * 40.0)) - 0.5) * 0.2 * vis(fp, 40.0)   // blade tips
                  + (vnoise(xz * 6.0 + 1.3) - 0.5) * 0.12 * vis(fp, 6.0);    // ~15 cm clumps
    }
    fair = mix(fair, vec3(${C.straw}), dryness * 0.12);
    // sparse divots / sandy repair marks
    #if TERRAIN_DETAIL > 0
    vec2 dc = floor(xz * 1.2); vec2 dr = hash22(dc);
    float dv = smoothstep(0.16, 0.06, length(fract(xz * 1.2) - dr)) * step(0.996, hash12(dc + 31.0)) * vis(fp, 6.0);
    fair = mix(fair, vec3(${C.divot}), dv * 0.8);
    #endif
    col = mix(col, fair, fairW);
    // Very gentle relief: at grazing golden-hour light, stronger relief reads as sand ripples.
    vec3 fg = noised(xz * 13.0);
    tGrad = mix(tGrad, fg.yz * 13.0 * 0.0011 * vis(fp, 13.0) + cl.yz * 2.2 * 0.003 * vCl, fairW);
    tRough = mix(tRough, 0.92, fairW);
    tSpec = mix(tSpec, 0.12, fairW);
  }

  // ---- cart paths: asphalt with worn wheel tracks, crumbly edges and gravel shoulders
  if (pathD < 1.2) {
    float pe = (vnoise(xz * 3.0) - 0.5) * 0.16 * vis(fp, 3.0);
    float shoulderW = inside(pathD - 0.35 + pe + eN * 0.25, aw + 0.08);
    float pathW = inside(pathD + pe * 0.5, aw);
    float agg = hash12(floor(xz * 38.0)) * vis(fp, 38.0);
    vec3 gravel = vec3(${C.gravel}) * (0.75 + 0.5 * hash12(floor(xz * 22.0)) * vis(fp, 22.0) + 0.0);
    col = mix(col, mix(col * vec3(1.25, 1.05, 0.8), gravel, 0.55), shoulderW * (1.0 - pathW));
    float track = exp(-pow((pathD + 0.62) / 0.24, 2.0));
    vec3 asph = mix(vec3(${C.asphalt}), vec3(${C.asphaltWorn}), track * 0.8 + mac2 * 0.2);
    asph *= 0.85 + 0.3 * agg;
    asph *= 1.0 - 0.25 * smoothstep(-0.12, 0.0, pathD);   // darker crumbly edge
    col = mix(col, asph, pathW);
    vec3 ag = noised(xz * 26.0);
    tGrad = mix(tGrad, ag.yz * 26.0 * 0.006 * vis(fp, 26.0), pathW);
    tGrad = mix(tGrad, tGrad + ag.yz * 26.0 * 0.01 * vis(fp, 26.0), shoulderW * (1.0 - pathW));
    tRough = mix(tRough, 0.78, pathW);
    tSpec = mix(tSpec, 0.45, pathW);
  }

  // ---- tees: mown in the direction of play, with divots
  float teeW = inside(teeD + eN * 0.08, aw);
  if (teeW > 0.001) {
    float best = 1e9; vec4 t = uTees[0];
    for (int i = 0; i < MAX_HOLES; i++) { if (i >= uHoleCount) break; float d = distance(xz, uTees[i].xy); if (d < best) { best = d; t = uTees[i]; } }
    vec2 dir = t.zw;
    float lat = dot(xz - t.xy, perp(dir));
    float sw = stripeWave(lat / ${f(TEE_STRIPE_W)} + 0.5, LFP(perp(dir)) / ${f(TEE_STRIPE_W)});
    vec3 tee = vec3(${C.tee}) * (1.0 + 0.12 * sw * grain(dot(viewXZ, dir))) * (0.95 + 0.1 * clump);
    // blade streaks along the mowing direction + ~1 m wear where golfers stand
    float streak = vnoise(vec2(dot(xz, dir) * 0.6, lat * 11.0));
    tee *= 1.0 + (streak - 0.5) * 0.16 * vis(LFP(perp(dir)), 11.0);
    tee *= 1.0 + (vnoise(xz * 0.8 + 1.7) - 0.5) * 0.12 * vis(fp, 0.8);
    float dv = smoothstep(0.86, 0.93, vnoise(xz * 4.0) * 0.6 + vnoise(xz * 11.0) * 0.4) * vis(fp, 8.0);
    tee = mix(tee, vec3(${C.divot}), dv * 0.5);
    col = mix(col, tee, teeW);
    tRough = mix(tRough, 0.92, teeW);
    tSpec = mix(tSpec, 0.12, teeW);
    tGrad = mix(tGrad, tGrad * 0.2, teeW);
  }

  // ---- greens: fringe collar + fine cross-hatched mowing
  float collarW = inside(grD - 1.6 + eN * 0.25, aw);
  if (collarW > 0.001) {
    float best = 1e9; vec4 g = uGreens[0];
    for (int i = 0; i < MAX_HOLES; i++) { if (i >= uHoleCount) break; float d = distance(xz, uGreens[i].xy); if (d < best) { best = d; g = uGreens[i]; } }
    vec2 rel = xz - g.xy;
    vec3 fringe = vec3(${C.fringe}) * (0.94 + 0.12 * clump) * (0.95 + 0.1 * mac2);
    // Collar is mown around the green: stripe follows the green outline.
    fringe *= 1.0 + 0.06 * stripeWave(grD / 0.9, fpGr / 0.9);
    col = mix(col, fringe, collarW);
    tRough = mix(tRough, 0.9, collarW);
    tSpec = mix(tSpec, 0.12, collarW);
    tGrad = mix(tGrad, tGrad * 0.15, collarW);
    float greenW = inside(grD + eN * 0.06, aw);
    if (greenW > 0.001) {
      vec2 d1 = normalize(g.zw + perp(g.zw));
      vec2 d2 = perp(d1);
      float W = ${f(GREEN_STRIPE_W)};
      float s1 = stripeWave(dot(rel, d2) / W + 0.5, LFP(d2) / W);
      float s2 = stripeWave(dot(rel, d1) / W + 0.5, LFP(d1) / W);
      float b = s1 * grain(dot(viewXZ, d1)) + s2 * grain(dot(viewXZ, d2));
      vec3 green = mix(vec3(${C.greenA}), vec3(${C.greenB}), 0.5 + 0.42 * b);
      // soft ~2 m density variation + very fine speckle (individual blade tips)
      green *= 0.95 + 0.1 * vnoise(xz * 0.6) + 0.07 * (vnoise(xz * 0.17 + 9.0) - 0.5);
      // blade tips (~2 cm), ~12 cm tufts of denser growth, ~40 cm mottling
      green *= 1.0 + (hash12(floor(xz * 55.0)) - 0.5) * 0.22 * vis(fp, 55.0)
                   + (vnoise(xz * 8.0) - 0.5) * 0.12 * vis(fp, 8.0)
                   + (vnoise(xz * 2.4 + 5.0) - 0.5) * 0.08 * vis(fp, 2.4);
      col = mix(col, green, greenW);
      // Almost no detail relief: a putting surface is smooth (strong relief reads as ripples).
      vec3 gg = noised(xz * 7.0);
      vec3 gm = noised(xz * 40.0 + 3.1);                     // blade-scale sheen breakup
      tGrad = mix(tGrad, gg.yz * 7.0 * 0.0012 * vis(fp, 7.0) + gm.yz * 40.0 * 0.0006 * vis(fp, 40.0), greenW);
      tRough = mix(tRough, 0.82, greenW);
    }
  }

  // ---- bunkers: raked sand, wet rim, sand on the steep lip faces, cut soil edge
  if (bkD < 1.0) {
    float lipSteep = smoothstep(0.10, 0.32, slope);
    float fineN = (vnoise(xz * 6.0) - 0.5) * 0.12 * vis(fp, 6.0);
    float sandD = bkD - (0.05 + 0.22 * lipSteep) + eN * 0.12 + fineN;
    float sandW = inside(sandD, aw);
    float soilW = inside(sandD - 0.2 - fineN * 1.5, aw) * (1.0 - sandW);
    col = mix(col, vec3(${C.soil}) * (0.8 + 0.4 * mid), soilW * 0.9);
    // Turf lip: the grass edge overhangs the cut face and shades it (dark rim around the sand).
    float lipShade = inside(sandD - 0.45 - fineN, 0.18) * (1.0 - sandW);
    col *= 1.0 - 0.35 * lipShade;
    if (sandW > 0.001) {
      vec3 gr = noised(xz * 34.0);
      float grain = mix(0.5, gr.x, vis(fp, 34.0));
      // rake ripples: direction drifts slowly across the bunker
      float ang = mac2 * 6.2832;
      vec2 rd = vec2(cos(ang), sin(ang));
      float ph = dot(xz, rd) / 0.14 + (vnoise(xz * 0.8) - 0.5) * 4.0;
      float vr = vis(fp, 7.0);
      vec2 rakeG = rd * cos(ph * 6.2832) * (6.2832 / 0.14) * 0.0012 * vr;
      vec3 sb = noised(xz * 0.9 + 5.0);                     // footprints / lumps
      float wet = smoothstep(-0.9, -0.05, sandD) * (0.55 + 0.45 * vnoise(xz * 1.7));
      vec3 sand = vec3(${C.sand}) * (0.9 + 0.18 * grain) * (0.94 + 0.12 * mac2);
      sand = mix(sand, vec3(${C.sandWet}), wet * 0.55);
      // Raked furrows hold slightly darker, coarser sand; lumps/footprints shade a little.
      sand *= 1.0 - 0.06 * cos(ph * 6.2832) * vr - 0.08 * (sb.x - 0.5);
      col = mix(col, sand, sandW);
      tGrad = mix(tGrad, rakeG + gr.yz * 34.0 * 0.0025 * vis(fp, 34.0) + sb.yz * 0.9 * 0.06, sandW);
      tRough = mix(tRough, mix(0.93, 0.8, wet), sandW);
      tSpec = mix(tSpec, 0.7, sandW);
    }
  }

  // ---- lakes: damp banks, mud rim, dark silty bed
  if (waD < 3.0) {
    float bankW = inside(waD - 2.2 + eN * 0.8, 0.6);
    col = mix(col, col * vec3(0.8, 0.92, 0.75), bankW * 0.6);
    float mudW = inside(waD - 0.35 + eN * 0.35 + (vnoise(xz * 4.0) - 0.5) * 0.2, aw + 0.05);
    vec3 mud = mix(vec3(${C.mud}), vec3(${C.lakeBed}), smoothstep(0.0, 4.0, -waD)) * (0.8 + 0.4 * mid);
    col = mix(col, mud, mudW);
    vec3 pb = noised(xz * 8.0);
    tGrad = mix(tGrad, pb.yz * 8.0 * 0.03 * vis(fp, 8.0), mudW);
    tRough = mix(tRough, 0.72, mudW * smoothstep(0.6, -0.2, waD) * smoothstep(-1.5, -0.3, waD));
    tSpec = mix(tSpec, mix(0.45, 0.2, smoothstep(0.0, -0.6, waD)), mudW);
  }

  // ---- global: cavity darkening, rain wetness
  col *= 1.0 - 0.18 * sat(curvS * 0.6);
  float porous = 1.0 - 0.6 * luma(col);
  col *= 1.0 - 0.38 * uWetness * porous;
  tRough = mix(tRough, tRough * 0.55, uWetness);
  tSpec = mix(tSpec, 1.0, uWetness * 0.7);
  diffuseColor.rgb = col;
}
`;

/** Injected after <roughnessmap_fragment>. */
export const TERRAIN_ROUGHNESS = /* glsl */ `roughnessFactor = tRough;`;

/** Injected after <lights_physical_fragment>: per-surface specular occlusion. */
export const TERRAIN_SPECULAR = /* glsl */ `
material.specularColor *= tSpec;
material.specularColorBlended *= tSpec;
material.specularF90 *= tSpec;
`;

/** Injected after <normal_fragment_maps>: macro slope (smooth, LOD-independent) + detail. */
export const TERRAIN_NORMAL = /* glsl */ `
{
  vec2 g = tSlopeG + tGrad;
  vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;
