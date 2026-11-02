/**
 * Dev-only particle blending check (not part of the game bundle): /src/render/fx/debug.html
 * Draws a few overlapping dust sprites over a mid-grey quad, no tone mapping, and exposes the
 * centre pixel so blending can be verified numerically.
 */
import * as THREE from 'three';
import { ParticlePool, SHAPE_SOFT, PF_WIND } from './Particles';
import { updateFxScreen } from './common';
import { globalUniforms } from '../shared';

const r = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
r.setSize(256, 256);
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0.2, 0.2, 0.2);
const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
cam.position.set(0, 0, 5);
globalUniforms.uSunColor.value.setRGB(1, 0.53, 0.25);
globalUniforms.uFogColor.value.setRGB(0.6, 0.65, 0.7);
const pool = new ParticlePool(64);
const N = Number(new URLSearchParams(location.search).get('n') ?? 14);
for (let i = 0; i < N; i++) pool.spawn(0, 0, 0, 0, 0, 0, 10, 1, 1, 0.2, 0.15, 0.1, 0.35, 0, 0, PF_WIND, SHAPE_SOFT);
pool.step(1);
pool.upload();
scene.add(pool.points);
updateFxScreen(cam, 256);
r.render(scene, cam);
const px = new Uint8Array(4);
const gl = r.getContext();
gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
(window as unknown as { __px: number[] }).__px = Array.from(px);
console.log('centre pixel', Array.from(px).join(','));
