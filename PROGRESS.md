# Progress log

## Status: playable 9-hole round, polished and tested

To play, run `npm install && npm run dev` and choose **Play 9 Holes**. `npm run build` produces a static `dist/`. GitHub Pages deploys from `.github/workflows/pages.yml`; enable it under Settings → Pages → Source: GitHub Actions.

## Done

### Research and design
- **RESEARCH.md** covers the controls (confirmed table with sources), mechanics, structure, player sentiment, physics references and tech choices.
- **DECISIONS.md** records every decision, including the changes made from your feedback overnight.

### Physics
- **Impact:** D-plane impact model.
- **Flight:** drag and Magnus lift fitted to TrackMan tour carry and apex (±3%), spin decay, and wind that changes with height.
- **Ground:** turf bounce after Penner with a spin impulse and a crater normal, rolling with slope break, stimp-10 greens, cup capture and lip-outs.
- **Hazards and rules:** water and OOB.
- **Speed cap:** clubhead speed has a soft cap per club, so there are no 500-yard drives. The best possible drive is about 323 yd.

### Swing
- **Model:** the hands are driven by physics on the arm arc. The club is weighted and hangs from a springy wrist hinge.
- **Emergent results:** speed, attack angle and shaft lean come out of the motion, and so do fat, thin, topped and whiff strikes.
- **Contact tolerance:** the ring band where contact is clean scales with the assist level.
- **Input:** A/D face and Q/E path work live during the swing, with a gentle wobble. Z/C aim, W/S stance, Shift for fine steps, R to square up.
- **Swing panel:** mirrored (target on the right) and enlarged at the user's request.
- **Swing range per club:** putter 30%, wedge 80%.
- **Putting:** backstroke length sets the distance, and a live hint shows the expected roll.
- **Extras:** practice swing, ghost swing, gamepad swing on the right stick.

### Course
- Original 9-hole, par-35 layout called **Thornbury Links**: 1.6 km of landscape with water on holes 2, 3, 7 and 9.
- Also a clubhouse pad and a practice green.
- The course is defined by signed-distance shapes plus noise and baked in Web Workers.

### Rendering
- **Grass:** GPU-placed with 4 LOD rings; it continues the mowing stripes, glows when backlit and bends with wind gusts.
- **Terrain:** splat terrain with mowing stripes, raked bunkers, geomorphed LOD and a horizon ring.
- **Sky and clouds:** Preetham sky, volumetric cloud cube, image-based lighting and height fog, with time-of-day presets and rain.
- **Water:** depth tint, foam and a planar reflection drawn only when the water is visible.
- **Trees:** own generator with 10 species, LOD and impostors.
- **Golfer and props:**
  - A procedural golfer with 6 clubs and an IK rig driven by the swing.
  - Rapier-driven props: gong, targets, crates, pots that shatter, scarecrows and hay.
  - A clubhouse, flags with cloth animation, and cups.
- **Effects:** tracer, divots, splashes and wind motes.
- **Post-processing:** AgX tonemapping, bloom, N8AO, SMAA, DoF and grading.
- **Performance:** budgets for each preset, all met (see DECISIONS.md), and an **F3** performance overlay.

### Gameplay
- **Round flow:** title → tee → swing → flight (mouse-look orbit, W/S zoom, F fast-forward) → straight to the ball → … → holed → scorecard → next hole.
- **Rules:** penalties for water (drop on the line of entry) and OOB. A double-tap retake; a retake after a penalty shot doesn't add a second penalty. A 15-stroke cap.
- **Records:** best score and time are saved, and split times are kept.

### UI and audio
- **UI:** HUD, swing and club panels, minimap, shot data card, scorecard, pause, settings (all options), key and pad rebinding, pad navigation.
- **Audio:** fully procedural Web Audio. Swing whoosh, strikes by quality, club and lie, bounces, cup rattle, splash, gong, crowd, wind, leaves and birds.

### Tests
- 90 Vitest tests: physics calibration, swing, putting, max distance, course, rules, camera, flight camera, input, props, debug shots and review regressions.
- Playwright scripts:
  - `scripts/e2e-controls.mjs`: real keys plus the mouse drag swing.
  - `scripts/playtest.mjs`: plays holes 1 and 3 start to finish (57 checks).
  - `scripts/screenshots.mjs`: the fixed views.
  - `scripts/review-*.mjs`

## Known issues / next steps
- **Headless testing is slow.** Under SwiftShader, load takes about 30 s and frames take seconds. A real GPU should be about 3–5 s (estimate). The playtest script takes about 70 minutes headless.
- **Out of bounds only exists at the map edge.** Adding OOB lines between holes would make the penalty matter.
- **Ball hidden in deep rough.** At address the ball can be hidden by tall rough. Grass between the camera and the ball should be flattened.
- **Address camera on extreme banks.** It can end up inside a bush, because there is no foliage avoidance yet.
- **Hole 3's pond is hidden from the tee** by the raised tee's crest. The tee could be raised, or the camera lifted.
- **Distant pine impostors look blocky** in fog. The horizon has a faint seam where the fog meets the sky.
- **Noon is a little flat.** Golden hour is the tuned default.
- **Debug shots don't animate the golfer** (test hooks only).
- **Possible next steps:**
  - A tutorial or practice range.
  - A "Drills & Dares" board (see RESEARCH.md §6).
  - A seeded daily round and replay.
  - A touch-control swing.
