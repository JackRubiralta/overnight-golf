/**
 * Light rain: GPU-animated streaks (one LineSegments draw) in a box that wraps around the
 * camera, falling along gravity + wind. No CPU work per frame beyond a few uniforms.
 */
import * as THREE from 'three';
import { globalUniforms } from '../shared';

const BOX = 36; // m, horizontal extent around the camera
const HEIGHT = 22; // m
const FALL_SPEED = 8.5; // m/s
const STREAK = 0.4; // m

export class Rain {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;

  constructor(count: number) {
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: globalUniforms.uTime,
        uCam: globalUniforms.uCameraPos,
        uWindDir: globalUniforms.uWindDir,
        uWindSpeed: globalUniforms.uWindSpeed,
        uColor: { value: new THREE.Color(0.62, 0.66, 0.72) },
        uOpacity: { value: 0.22 },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec2 uWindDir;
        uniform float uWindSpeed;
        varying float vFade;
        void main() {
          vec3 box = vec3(${BOX.toFixed(1)}, ${HEIGHT.toFixed(1)}, ${BOX.toFixed(1)});
          vec3 vel = vec3(uWindDir.x * uWindSpeed * 0.7, -${FALL_SPEED.toFixed(2)}, uWindDir.y * uWindSpeed * 0.7);
          // per-drop speed variation
          float sp = 0.8 + 0.4 * fract(position.x * 91.7 + position.z * 37.3);
          vec3 p = position * box + vel * sp * uTime;
          // wrap into a box centred on the camera
          vec3 rel = mod(p - uCam + box * 0.5, box) - box * 0.5;
          vec3 wp = uCam + rel - normalize(vel) * ${STREAK.toFixed(2)} * aEnd * sp;
          vFade = (1.0 - smoothstep(${(BOX * 0.25).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(rel.xz))) * smoothstep(1.5, 4.5, length(rel)) * (1.0 - 0.6 * aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vFade);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'rain';
  }

  setIntensity(amount: number) {
    this.mat.uniforms.uOpacity.value = 0.22 * amount;
    this.mesh.visible = amount > 0.01;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
