/**
 * GLSL for the instanced grass, injected into MeshStandardMaterial via onBeforeCompile so the
 * blades get three's full PBR lighting, IBL, shadow receiving and fog for free.
 *
 * Vertex stage (all placement on the GPU):
 *   gl_InstanceID → grid cell around the (snapped) camera → jittered blade root (stable world
 *   hash) → course height + SDF masks → surface type → blade height / width / colour → curved,
 *   tapered blade bent by its natural droop, wind gusts and player/ball interaction.
 *   Blades outside the view frustum, outside their LOD ring, or on sand/water/paths/greens
 *   collapse to a degenerate point (zero-area triangles are discarded before rasterisation).
 * Fragment stage: per-blade colour × base AO, plus a translucency term added inside the
 *   direct-light loop (so it is properly shadowed) that makes back-lit blades glow at golden hour.
 */
import { COURSE_GLSL } from '../shared';
import { FAIRWAY_STRIPE_W, TEE_STRIPE_W } from '../terrain/terrainShader';

/** Max fairway centre-line segments near the camera passed to the shader (CPU picks the nearest). */
export const GRASS_MOW_SEGS = 4;
const f = (v: number) => v.toFixed(4);

/** Declarations + helper functions for the vertex shader (inserted after #include <common>). */
export const GRASS_VERTEX_PARS = /* glsl */ `
${COURSE_GLSL}
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform vec3 uPlayerPos;
uniform vec3 uBallPos;
uniform vec2 uOrigin;     // cell index of the active rectangle's min corner (integer valued)
uniform float uCell;      // cell size, metres
uniform float uGridN;     // active rectangle width in cells (instances = width × height)
uniform float uSub;       // tuft roots per cell = uSub²
uniform float uTuft;      // blades per tuft root
uniform vec4 uRing;       // fade-in start/end, fade-out start/end (3D distance, m)
uniform float uWidth;     // ring width multiplier (wider blades in sparse rings)
uniform float uFacing;    // 0 = random yaw, 1 = blades turn to face the camera
uniform float uMinAngle;  // blades smaller than this angular height (rad) shrink away
uniform float uHeightMul; // global height multiplier (tuning)
uniform float uRadius;    // overall grass radius (outer edge of the last ring)
uniform float uPixelAngle; // angular size of one screen pixel (rad)
uniform vec4 uMowSegs[${GRASS_MOW_SEGS}]; // nearest fairway centre-line segments (ax, az, bx, bz)
uniform vec4 uMowTee;     // nearest tee: (cx, cz, dirX, dirZ)
varying vec3 vGrassCol;
varying float vGrassAO;
varying float vGrassTrans;
varying float vGrassSide; // -1..1 across the blade (edge darkening / midrib)
#define MOWN_MIN_ANGLE_MUL 2.5

uint gHash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x;
}
float gU01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }
float gHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash12(i), gHash12(i + vec2(1, 0)), f.x), mix(gHash12(i + vec2(0, 1)), gHash12(i + vec2(1, 1)), f.x), f.y);
}
float gTh(float d, float w) { return 1.0 - smoothstep(-w, w, d); }
// Quintic value noise, bit-identical to the terrain's vnoise (so mower lines wobble identically).
float gVnoise(vec2 x) {
  vec2 i = floor(x); vec2 fr = fract(x); vec2 u = fr * fr * fr * (fr * (fr * 6.0 - 15.0) + 10.0);
  float a = gHash12(i), b = gHash12(i + vec2(1, 0)), c = gHash12(i + vec2(0, 1)), d = gHash12(i + vec2(1, 1));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
// Mowing stripes, mirroring the terrain splat: band sign (-1/1) across the mowing axis times the
// view-dependent 'grain' (blades laid away from the viewer look lighter).
float gGrain(float v) { return clamp(v * 3.0, -1.0, 1.0) * (0.3 + 0.55 * abs(v)) + 0.15; }
float gBand(float t) { return clamp(sin(3.14159265 * t) / 0.08, -1.0, 1.0); }
// Fairway: returns band sign, writes the mowing direction.
float fairwayStripe(vec2 xz, out vec2 dir) {
  float best = 1e9, lat = 0.0; dir = vec2(0.0, 1.0);
  for (int i = 0; i < ${GRASS_MOW_SEGS}; i++) {
    vec4 s = uMowSegs[i];
    vec2 ab = s.zw - s.xy; float L = max(length(ab), 1e-3); vec2 d = ab / L; vec2 ap = xz - s.xy;
    float dd = length(ap - d * clamp(dot(ap, d), 0.0, L));
    if (dd < best) { best = dd; dir = d; lat = d.x * ap.y - d.y * ap.x < 0.0 ? -dd : dd; }
  }
  lat += (gVnoise(xz * 0.04) - 0.5) * 2.0;
  return gBand(lat / ${f(FAIRWAY_STRIPE_W)} + 0.5);
}
float teeStripe(vec2 xz) {
  vec2 dir = uMowTee.zw;
  return gBand(dot(xz - uMowTee.xy, vec2(-dir.y, dir.x)) / ${f(TEE_STRIPE_W)} + 0.5);
}

vec3 grassShadowPos; // where this vertex looks up the shadow map (see GRASS_SHADOW_POS)
void grassCull(out vec3 p, out vec3 n) { p = vec3(0.0, -1.0e4, 0.0); grassShadowPos = p; n = vec3(0.0, 1.0, 0.0); vGrassCol = vec3(0.0); vGrassAO = 1.0; vGrassTrans = 0.0; vGrassSide = 0.0; }

void grassVertex(out vec3 outPos, out vec3 outN) {
  int N = int(uGridN + 0.5);
  int S = int(uSub + 0.5);
  ivec2 ij = ivec2(gl_InstanceID % N, gl_InstanceID / N);
  ivec2 cell = ivec2(floor(uOrigin + 0.5)) + ij;
  int T = int(uTuft + 0.5);
  int bIdx = int(position.z + 0.5);
  int rIdx = bIdx / T;          // tuft root inside the cell
  int k = bIdx - rIdx * T;      // blade inside the tuft
  // Root randoms (shared by the tuft) and per-blade randoms.
  uint h0 = gHash(uint(cell.x) * 1597334677u ^ gHash(uint(cell.y) * 3812015801u ^ (uint(rIdx) + 1u) * 2654435761u));
  uint h1 = gHash(h0); uint h2 = gHash(h1); uint hr = gHash(h2);
  uint h3 = gHash(hr ^ (uint(k) + 1u) * 0x9e3779b9u);
  uint h4 = gHash(h3); uint h5 = gHash(h4); uint h6 = gHash(h5); uint h7 = gHash(h6); uint h8 = gHash(h7);
  float r0 = gU01(h0), r1 = gU01(h1), r2 = gU01(h2), rYaw = gU01(hr);
  float r3 = gU01(h3), r4 = gU01(h4), r5 = gU01(h5), r6 = gU01(h6), r7 = gU01(h7), r8 = gU01(h8);

  // Stratified tuft root inside the cell (S×S sub-cells, jittered).
  vec2 sub = vec2(float(rIdx % S), float(rIdx / S));
  vec2 xz = (vec2(cell) + (sub + vec2(r0, r1)) / float(S)) * uCell;

  // ---- cheap rejections first (no texture fetches yet) ----
  vec2 dc = xz - cameraPosition.xz;
  if (dot(dc, dc) > uRing.w * uRing.w) { grassCull(outPos, outN); return; }
  float y = courseHeight(xz);
  vec3 root = vec3(xz.x, y, xz.y);
  float dist = length(root - cameraPosition);
  if (dist > uRing.w || dist < uRing.x) { grassCull(outPos, outN); return; }
  // Frustum test of a 0.7 m sphere around the blade (exact for any camera, incl. reflections).
  vec4 clip = projectionMatrix * viewMatrix * vec4(root + vec3(0.0, 0.25, 0.0), 1.0);
  float pad = 0.7 * max(projectionMatrix[0][0], projectionMatrix[1][1]);
  if (dist > 1.5 && (clip.w < -0.7 || abs(clip.x) > clip.w + pad || abs(clip.y) > clip.w + pad)) { grassCull(outPos, outN); return; }

  // ---- LOD ring cross-fade: stochastic thinning keyed on a per-blade random ----
  float fin = uRing.y > uRing.x ? smoothstep(uRing.x, uRing.y, dist) : 1.0;
  float fout = smoothstep(uRing.z, uRing.w, dist);
  float lod = (1.0 - smoothstep(fin * 1.2 - 0.2, fin * 1.2, r5)) * smoothstep(fout * 1.2 - 0.2, fout * 1.2, r5);
  if (lod <= 0.0) { grassCull(outPos, outN); return; }

  // ---- surfaces from the baked SDF masks (mirrors CourseField.surfaceFromSample) ----
  vec4 mA = courseMaskA(xz);
  vec4 mB = courseMaskBRaw(xz);
  float teeD = (mB.r * 255.0 - 128.0) / 16.0;
  float pathD = (mB.g * 255.0 - 128.0) / 16.0;
  float corr = mB.b * 255.0 * 0.5;
  float nBig = gNoise(xz * 0.05);              // large patches (colour / height)
  float nMid = gNoise(xz * 0.35 + 17.0);        // matches terrain-scale mottling
  float clump = gNoise(xz * 0.9 + 3.7);         // tussocks in long grass
  float edgeN = (nMid - 0.5) * 0.35;

  float wFair = gTh(mA.r + edgeN, 0.3);
  float wGreen = gTh(mA.g, 0.08);
  float wFringe = gTh(mA.g - 1.6 + edgeN, 0.25);
  float wTee = gTh(teeD, 0.15);
  // First cut: the collar around fairways and tees (same SDF offsets as the terrain splat).
  float wCut = max(gTh(min(mA.r - 2.2, teeD - 1.4) + edgeN, 0.3), gTh(corr - 2.2, 0.6));
  float wDeep = smoothstep(17.0, 30.0, corr + (nBig - 0.5) * 14.0);
  float fescue = smoothstep(0.52, 0.78, gNoise(xz * 0.7 + 11.0) * 0.6 + nBig * 0.4);
  float excl = smoothstep(0.05, 0.5, mA.b) * smoothstep(0.3, 1.3, mA.a) * smoothstep(0.0, 0.45, pathD) * (1.0 - wGreen);
  if (excl <= 0.001) { grassCull(outPos, outN); return; }
  // Mowing stripes on fairway and tee (blades are laid along ±mowDir by alternating mower passes).
  vec2 mowDir = vec2(0.0, 1.0);
  float band = 0.0;
  if (wFair > 0.001) band = fairwayStripe(xz, mowDir);
  float bandT = wTee > 0.001 ? teeStripe(xz) : 0.0;
  vec2 viewXZ = normalize(xz - cameraPosition.xz + 1e-4);

  // Heights (m) per surface, with per-blade and patch variation.
  // Rough grows in loose tussocks (~1 m): taller, denser clumps with lower, thinner gaps between.
  float hRough = mix(0.09, 0.2, nBig) * mix(0.55, 1.25, r2) * mix(0.55, 1.2, clump);
  float hDeep = mix(0.22, 0.48, nBig) * mix(1.0, 1.25, fescue) * mix(0.35, 1.3, clump * clump) * mix(0.6, 1.2, r2);
  float h = mix(hRough, hDeep, wDeep);
  h = mix(h, 0.055 * mix(0.7, 1.2, r2), wCut);
  h = mix(h, 0.04 * mix(0.6, 1.25, r2), wFair);
  h = mix(h, 0.032 * mix(0.6, 1.2, r2), wTee);
  h = mix(h, 0.026 * mix(0.6, 1.2, r2), wFringe);
  float longness = smoothstep(0.06, 0.3, h);    // 0 = mown turf, 1 = long grass
  bool seed = wDeep * (1.0 - wCut) > 0.5 && r4 < mix(0.04, 0.14, fescue);
  h *= mix(0.7, 1.15, r7);                       // per-blade height inside the tuft
  if (seed) h *= 1.35;
  h *= uHeightMul * excl * lod;
  // Shrink blades that would be smaller than ~1.5 px. Mown turf uses a much stricter limit: a few
  // metres out it is pure micro-triangles (expensive, no visual gain), so the terrain takes over.
  float minAng = uMinAngle * mix(MOWN_MIN_ANGLE_MUL, 1.0, longness);
  h *= smoothstep(minAng, minAng * 2.0, h / max(dist, 0.1));
  if (h < 0.004) { grassCull(outPos, outN); return; }

  // ---- orientation ----
  vec2 toCam = normalize(cameraPosition.xz - xz + 1e-4);
  // Tuft blades fan out around the root (golden-angle spacing), each leaning away from it.
  float yaw = rYaw * 6.2831853 + float(k) * 2.39996 + (r3 - 0.5) * 0.9;
  yaw = mix(yaw, atan(toCam.y, toCam.x) + (r3 - 0.5) * 1.4, uFacing);
  vec2 fdir = vec2(cos(yaw), sin(yaw));          // blade face normal (horizontal)
  vec3 sideV = vec3(-fdir.y, 0.0, fdir.x);       // across the blade
  // Mown turf spreads its blades evenly over the sub-cell; long grass bunches them into tufts.
  float spread = mix(0.45 * uCell / float(S), 0.04, longness);
  if (T > 1) root.xz += fdir * (0.15 + 0.85 * r8) * spread;

  // Natural lean: long blades droop away from their face, with a little sideways scatter.
  vec2 lean = fdir * mix(0.22, 0.6, longness) * (0.35 + r6) + sideV.xz * (r4 - 0.5) * 0.3 * longness;

  // Mown turf lies the way the mower pushed it.
  lean += (mowDir * band * wFair + uMowTee.zw * bandT * wTee) * 0.35 * (1.0 - longness);

  // ---- wind: rolling gusts (low-freq noise scrolled downwind) + per-blade flutter ----
  vec2 wd = normalize(uWindDir + 1e-5);
  float ws = uWindSpeed;
  vec2 scroll = wd * uTime * (1.2 + ws * 0.55);
  float gust = gNoise((xz - scroll) * 0.07) * 0.65 + gNoise((xz - scroll * 1.6) * 0.23 + 5.1) * 0.35;
  gust = smoothstep(0.25, 0.9, gust);
  float strength = clamp(ws / 9.0, 0.06, 1.4) * mix(0.15, 1.0, longness);
  float ph = r5 * 6.2831853 + dot(xz, wd) * 0.9;
  float flutter = sin(uTime * (2.2 + ws * 0.35) + ph) * 0.6 + sin(uTime * 4.7 + ph * 1.7) * 0.25;
  lean += wd * strength * (0.2 + 1.0 * gust + 0.18 * flutter) + vec2(-wd.y, wd.x) * strength * flutter * 0.12;

  // ---- interaction: flatten around the player and (gently) around the ball ----
  vec3 dp = root - uPlayerPos;
  float pd = length(dp.xz);
  float push = (1.0 - smoothstep(0.15, 0.85, pd)) * step(abs(dp.y), 1.5);
  vec3 db = root - uBallPos;
  float bd = length(db.xz);
  float pushB = (1.0 - smoothstep(0.03, 0.16, bd)) * step(abs(db.y), 0.5) * 0.8;
  lean += normalize(dp.xz + 1e-4) * push * 1.4 + normalize(db.xz + 1e-4) * pushB;
  float lm = length(lean);
  if (lm > 1.6) { lean *= 1.6 / lm; lm = 1.6; }

  // ---- the blade: quadratic curve root → tip, length roughly preserved under bending ----
  float side = position.x;
  vGrassSide = side;
  float t = position.y;
  float lenNorm = 1.0 / (0.55 + 0.45 * sqrt(1.0 + lm * lm));
  vec3 curve = vec3(lean.x * t * t, t, lean.y * t * t) * h * lenNorm;
  float wBase = mix(0.0035, mix(0.006, 0.0072, wDeep), longness) * mix(0.7, 1.3, r6) * uWidth;
  // Never thinner than ~1 px: sub-pixel blades alias into sparse speckle without MSAA.
  wBase = max(wBase, dist * uPixelAngle * 0.9);
  float prof = (1.0 - t * t * t) * (0.8 + 0.2 * smoothstep(0.0, 0.3, t)); // full through the middle, rounded taper
  if (seed) prof = t < 0.62 ? 0.3 : 0.3 + 1.5 * sin(3.14159 * clamp((t - 0.62) / 0.38, 0.0, 1.0));
  outPos = root + curve + sideV * side * wBase * prof;
  // Shadows are looked up low on the blade so it takes the same shadow as the ground it grows
  // from: with a low sun the shadow map's grazing-angle error would otherwise leave tips lit
  // above shadowed turf (bright speckle). Long grass keeps more of its own height.
  grassShadowPos = mix(root, outPos, mix(0.1, 0.45, longness));

  vec3 tng = normalize(vec3(2.0 * t * lean.x, 1.0, 2.0 * t * lean.y));
  vec3 nb = normalize(cross(tng, sideV));
  // Always shade the side facing the viewer (the fragment stage cancels three's back-face flip,
  // which would otherwise turn the up-biased normal of every back face downward → black blades).
  if (dot(nb, cameraPosition - outPos) < 0.0) nb = -nb;
  nb = normalize(nb + sideV * side * 0.45);      // rounded cross-section
  // Bias toward the ground normal: fully for mown turf (so a low sun doesn't turn every vertical
  // blade into a bright speck against the grazing-lit ground), partially for long grass.
  // Far away the blades converge to the terrain's look (normal, colour) so the edge is invisible.
  float farK = smoothstep(uRadius * 0.35, uRadius, dist);
  outN = normalize(mix(nb, vec3(0.0, 1.0, 0.0), mix(mix(0.85, 0.2, longness), 0.9, farK)));

  // ---- colour (linear), matched to the terrain splat per surface ----
  // Palette mirrors the terrain splat (src/render/terrain/terrainShader.ts) so blade roots melt
  // into the ground; dark, saturated albedos (AgX tone mapping lifts them).
  // Base albedo per surface = the terrain splat palette (src/render/terrain/terrainShader.ts, C)
  // with similar mottling, so on average the blades melt into the ground beneath them.
  vec3 cRough = mix(vec3(0.034, 0.085, 0.013), vec3(0.048, 0.098, 0.016), nBig) * (0.84 + 0.32 * clump) * 1.1;
  vec3 cDeep = mix(vec3(0.045, 0.072, 0.016), vec3(0.064, 0.082, 0.022), nMid) * (0.72 + 0.56 * clump) * 1.1;
  cDeep = mix(cDeep, vec3(0.175, 0.145, 0.062) * (0.75 + 0.5 * clump), fescue * 0.3);
  vec3 col = mix(cRough, cDeep, wDeep);
  col = mix(col, vec3(0.042, 0.122, 0.015) * (0.9 + 0.2 * clump), wCut);
  vec3 cFair = mix(vec3(0.046, 0.140, 0.015), vec3(0.072, 0.194, 0.024), 0.5 + 0.5 * band * gGrain(dot(viewXZ, mowDir)));
  col = mix(col, cFair * (0.93 + 0.14 * nBig), wFair);
  col = mix(col, vec3(0.058, 0.168, 0.020) * (1.0 + 0.12 * bandT * gGrain(dot(viewXZ, uMowTee.zw))), wTee);
  col = mix(col, vec3(0.048, 0.146, 0.019), wFringe);
  // Per-blade brightness jitter. Mown turf: centred on 1 so the average still equals the ground
  // colour (the blades add texture, not a tint) and calming down with distance; long grass: wide
  // spread plus yellow-green, blue-green and dry/straw blades.
  float mownVar = 0.4 * (1.0 - smoothstep(3.0, 11.0, dist));
  // (Mown blades sit ~8% above the turf: light flecks read as blade sheen, dark ones as dirt.)
  col *= mix(1.08 + (r2 - 0.5) * mownVar, 0.62 + 0.75 * r2 * r2 + 0.2 * r7, longness);
  col = mix(col, col * vec3(1.22, 1.04, 0.62), r4 * longness);
  col = mix(col, col * vec3(0.82, 0.98, 1.12), step(r8, 0.22) * longness);
  float dry = step(1.0 - mix(0.03, 0.14, wDeep) * longness, r6);
  col = mix(col, vec3(0.15, 0.135, 0.065), dry * 0.75);
  // Root → tip gradient: tips are lighter and warmer.
  vec3 tip = col * mix(1.2, 1.45, longness) * mix(vec3(1.0), vec3(1.08, 1.0, 0.8), longness);
  col = mix(col, tip, smoothstep(0.2, 1.0, t) * (1.0 - 0.8 * farK));
  if (seed) col = mix(col, vec3(0.26, 0.2, 0.1), smoothstep(0.55, 0.7, t));
  col *= 1.0 + 0.14 * gust * longness;           // gusts flash the lighter blade sides
  vGrassCol = col;

  // Ambient occlusion at the root (deeper in long, dense grass).
  float aoBase = mix(0.88, mix(0.4, 0.25, wDeep * clump), longness);
  vGrassAO = mix(aoBase, 1.0, smoothstep(0.0, 0.85, t));
  vGrassTrans = mix(0.2, 0.85, longness) * smoothstep(0.05, 0.6, t) * (1.0 - 0.6 * farK);
}
`;

/** Inserted after <worldpos_vertex>: only the shadow lookup uses worldPosition from here on. */
export const GRASS_SHADOW_POS = /* glsl */ `
#if defined( USE_SHADOWMAP )
  worldPosition.xyz = grassShadowPos;
#endif
`;

/** Fragment declarations (after <common>). */
export const GRASS_FRAGMENT_PARS = /* glsl */ `
varying vec3 vGrassCol;
varying float vGrassAO;
varying float vGrassTrans;
varying float vGrassSide;
uniform vec3 uTransTint;
uniform float uTransStrength;
uniform float uSpecular;
`;

/**
 * Inserted after <lights_physical_pars_fragment>: wraps RE_Direct so every direct light (with its
 * shadow already applied to directLight.color) also contributes light transmitted through the
 * thin blade — a diffuse back-face term plus a forward-scatter lobe when looking toward the light.
 */
export const GRASS_LIGHT_OVERRIDE = /* glsl */ `
void RE_Direct_Grass( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  vec3 spec0 = reflectedLight.directSpecular;
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  // Thin blades have a weak, broad sheen: damp the PBR specular so grazing views don't go white.
  reflectedLight.directSpecular = spec0 + ( reflectedLight.directSpecular - spec0 ) * uSpecular;
  float back = saturate( dot( -geometryNormal, directLight.direction ) );
  float fwd = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 6.0 );
  // Light leaving a leaf is filtered by chlorophyll: more saturated than its reflected colour.
  vec3 albedo = material.diffuseColor;
  vec3 trans = albedo * albedo / max( dot( albedo, vec3( 0.3333 ) ), 1e-3 );
  reflectedLight.directDiffuse += directLight.color * trans * uTransTint * vGrassTrans * uTransStrength * ( 0.5 * back + 0.85 * fwd );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass
`;
