# Progress log

## Done
- Phase 1 research: RESEARCH.md, which covers controls, mechanics, player sentiment, tech choices and physics references.
- Project scaffold: Vite + TS strict + Three r187 + Vitest. The renderer choice was verified in headless Chromium (DECISIONS.md).
- Ball physics:
  - D-plane impact model.
  - Aero flight (drag, Magnus, spin decay, height-profiled wind).
  - Penner-style turf bounce with spin.
  - Rolling with slope break and stimp-calibrated greens.
  - Cup capture and lip-outs, water and OOB.
  - Calibrated to TrackMan tour numbers (±3%).
- Physics-driven mouse swing model:
  - Hands follow the cursor around the arm arc.
  - Weighted club on a springy wrist hinge.
  - Emergent speed, attack angle, fat, thin, topped and whiff.
- SwingController:
  - A/D face, Q/E path (live during the swing), Z/C aim, W/S stance, Shift fine, R reset, 1-5/wheel clubs.
  - Drift, flail, practice swing, ghost path, assist levels, gamepad right-stick swing.
- Course: 9-hole original routing on a 1.6 km landscape. Analytic SDF surfaces plus a noise heightfield, baked in Web Workers in about 2 s.
- Game loop:
  - Title, then tee, stance, swing, flight, settle, walk or stance, holed, scorecard, next hole.
  - Penalties, stroke cap, retake, rangefinder, survey camera, scoring and personal bests.
- Tests:
  - 29 Vitest tests: physics calibration, swing model, course, and end-to-end mouse swing to ball flight.
  - Playwright scripts: screenshots, smoke and e2e-controls.

## In progress
- Parallel subsystem build: grass, terrain shading, sky/clouds/post, water + effects, trees/foliage, props/Rapier, golfer, UI and input/audio.

## Known issues / next
- See the bottom of this file after integration.
