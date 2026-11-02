/**
 * Display-referred colour grade, applied right after tone mapping (inputs are 0..1 linear):
 * split toning (cool shadows / warm highlights), a foliage hue grade, gentle contrast around mid-grey in a
 * perceptual space, vibrance-style saturation lift, and a soft elliptical vignette.
 */
import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';

const FRAG = /* glsl */ `
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uContrast;
uniform float uSaturation;
uniform float uVibrance;
uniform float uVignette;
uniform float uVignetteSoftness;
uniform float uGreenWarm;
uniform float uGreenDesat;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);
  // tonal masks in a gamma-ish space
  vec3 g = pow(c, vec3(1.0 / 2.2));
  float pl = dot(g, LUMA);
  float sh = 1.0 - smoothstep(0.05, 0.5, pl);
  float hi = smoothstep(0.45, 0.95, pl);
  g *= mix(vec3(1.0), uShadowTint, sh);
  g *= mix(vec3(1.0), uHighlightTint, hi);
  // Foliage hue grade (film-style): push dominant greens slightly toward yellow and take a little
  // saturation out of them, so sunlit turf reads as grass rather than neon lime.
  float gm = smoothstep(0.02, 0.22, g.g - max(g.r, g.b));
  g.r += (g.g - g.r) * uGreenWarm * gm;
  g = mix(vec3(dot(g, LUMA)), g, 1.0 - uGreenDesat * gm);
  // contrast pivoting on mid grey, with a soft shoulder so highlights don't clip
  g = clamp((g - 0.46) * uContrast + 0.46, 0.0, 1.0);
  // saturation + vibrance (boost muted colours more than already saturated ones)
  float l = dot(g, LUMA);
  float mx = max(g.r, max(g.g, g.b));
  float mn = min(g.r, min(g.g, g.b));
  float sat = mx - mn;
  float s = uSaturation + uVibrance * (1.0 - smoothstep(0.0, 0.6, sat));
  g = mix(vec3(l), g, s);
  // vignette (aspect-aware)
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float v = smoothstep(0.35, 0.35 + uVignetteSoftness, length(d) * 0.85);
  g *= 1.0 - uVignette * v;
  outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
}
`;

export interface GradeOptions {
  shadowTint?: THREE.Color;
  highlightTint?: THREE.Color;
  contrast?: number;
  saturation?: number;
  vibrance?: number;
  vignette?: number;
  vignetteSoftness?: number;
  /** Shift of dominant greens toward yellow (0..1). */
  greenWarm?: number;
  /** Extra desaturation of dominant greens (0..1). */
  greenDesat?: number;
}

export class GradeEffect extends Effect {
  constructor(o: GradeOptions = {}) {
    super('GradeEffect', FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uShadowTint', new THREE.Uniform(o.shadowTint ?? new THREE.Color(0.94, 0.98, 1.06))],
        ['uHighlightTint', new THREE.Uniform(o.highlightTint ?? new THREE.Color(1.06, 1.0, 0.92))],
        ['uContrast', new THREE.Uniform(o.contrast ?? 1.12)],
        ['uSaturation', new THREE.Uniform(o.saturation ?? 1.12)],
        ['uVibrance', new THREE.Uniform(o.vibrance ?? 0.18)],
        ['uVignette', new THREE.Uniform(o.vignette ?? 0.22)],
        ['uVignetteSoftness', new THREE.Uniform(o.vignetteSoftness ?? 0.55)],
        ['uGreenWarm', new THREE.Uniform(o.greenWarm ?? 0.12)],
        ['uGreenDesat', new THREE.Uniform(o.greenDesat ?? 0.24)],
      ]),
    });
  }

  uniform<T = number>(name: string): THREE.Uniform<T> {
    return this.uniforms.get(name) as THREE.Uniform<T>;
  }
}
