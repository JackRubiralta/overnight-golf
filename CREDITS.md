# Credits

*Thornbury Links* is an original game. All art is generated procedurally at runtime: terrain, grass, trees, golfer, clubs, props, textures, sky, water, sounds and UI icons. **No image, model, audio or font files are bundled or downloaded**, and the UI uses the system font stack.

The game is *inspired by the mechanics* of *Normal Golf Game* (Luke Muscat). It uses none of that game's name, logo, text, footage, characters, story or assets (see RESEARCH.md §9).

## Runtime libraries (bundled)

| Library | Version | Licence | Used for |
|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 0.187.0 | MIT | Rendering. Also `BufferGeometryUtils` and the `Sky` addon. |
| [postprocessing](https://github.com/pmndrs/postprocessing) | 6.39.6 | Zlib | Post-processing: AgX tone mapping, bloom, SMAA, depth of field, vignette, grading pass |
| [n8ao](https://github.com/N8python/n8ao) | 2.0.1 | ISC | Screen-space ambient occlusion. A small runtime compatibility patch for three r187 lives in `src/render/post/n8aoCompat.ts`. |
| [@dimforge/rapier3d-compat](https://rapier.rs) | 0.21.0 | Apache-2.0 | Physics for the hittable props (gong, targets, crates, pots, scarecrows, hay) |

## Development tools

| Tool | Licence |
|---|---|
| Vite | MIT |
| TypeScript | Apache-2.0 |
| Vitest | MIT |
| Playwright (pre-installed in the build environment, not a dependency) | Apache-2.0 |

## Adapted code and techniques

| What | Source | Licence / status |
|---|---|---|
| Atmospheric scattering in `src/render/sky/skyShader.ts` | three.js `examples/jsm/objects/Sky.js` (Preetham model) | MIT |
| Planar reflection mirror camera and oblique clip plane (`src/render/water/PlanarReflection.ts`) | three.js `examples/jsm/objects/Reflector.js` | MIT |
| `hash12` / `hash22` shader hashes (terrain, grass) | Dave Hoskins, "Hash without Sine" | MIT |
| Value noise with analytic derivatives, derivative fbm | Inigo Quilez's published articles | Re-implemented |
| Interleaved gradient noise (LOD dither in trees) | Jimenez 2014 | Published technique |
| Tree branch generator (`src/render/foliage/treeGen.ts`) | Inspired by [@dgreenheck/ez-tree](https://github.com/dgreenheck/ez-tree) | MIT. Not bundled; our own implementation. |
| Turf bounce and roll model | A. R. Penner, "The run of a golf ball" (2001/2002) | Published physics |
| Impact model | TrackMan D-plane definitions | Published concepts |
| Flight calibration | TrackMan PGA Tour averages | Published data |

## Research sources

RESEARCH.md lists every article, review, community thread and paper consulted, with links.
