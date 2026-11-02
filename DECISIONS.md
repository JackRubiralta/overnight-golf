# Decisions

Decisions made autonomously during the overnight build, with the reasoning. Newest decisions are appended at the bottom of each section.

## Identity

- **Name:** *Thornbury Links*: an original 9-hole course, original hole names, characters and UI. Nothing is taken from Normal Golf Game. That means no name, logo, text, FMV, "developer traps you" story or assets (see RESEARCH.md §9).
- **Focus:** golf comes first. *Play 9 Holes* is available from the first second, the full 5-club bag is unlocked, and there is no story layer. This responds to the top player complaint (RESEARCH.md §8).

## Tech

| Decision | Choice | Why |
|---|---|---|
| Renderer | `THREE.WebGLRenderer` (three 0.187) | Tested headless Chromium first. WebGL2 renders correctly via SwiftShader (`--use-angle=swiftshader`). `WebGPURenderer` has no adapter headless and silently falls back to WebGL2 anyway. pmndrs `postprocessing` and `n8ao` are WebGL-only. |
| Post | `postprocessing@6.39.6` + `n8ao@2.0.1` | Mature, MIT/ISC, compatible with r187 (research §10). |
| Ball physics | Our own code (`src/physics`) | Full control. D-plane impact, drag/Magnus with spin-ratio models, Penner-style turf bounce, rolling with slope gravity. |
| Prop physics | Rapier (`@dimforge/rapier3d-compat`) | Used for props and breakables only, per the brief. |
| Trees | Own branch generator (inspired by `@dgreenheck/ez-tree`, MIT), 10 variants, instanced LOD0/LOD1 + baked 8-view impostors | ez-tree's ES build inlines ~4 MB of textures; our generator is small, fully procedural and offline. |
| Course data | Analytic SDFs + layered noise, baked into a 1281² grid (1.25 m) by a Web Worker pool | One source of truth. The physics height uses the same triangulation as the rendered mesh, so the ball never floats or sinks. Surfaces use exact analytic SDFs. |
| Mask encoding | Two RGBA8 textures storing *signed distances* (±8 m, 6 cm steps), not hard masks | Shaders threshold the SDF with noise, so surface edges stay crisp at any distance even with a 1.25 m texel. |
| Units | SI internally. Yards/mph in the UI by default (metres option). | |

## Physics tuning

- Drag/lift constants were fitted by grid search to TrackMan PGA Tour carry and apex for 8 clubs. Results are within about 3% (tests/calib.test.ts). Lift is `Cl = 0.5·S^0.5` capped at 0.42. Drag is `Cd = 0.25 + 0.25·S − 0.003·max(0, v−40)`, with a drag crisis below 19 m/s.
- Spin rate uses a saturating power law fitted to tour driver, 7-iron and PW spin, linear in sin(spin loft) below 14°.
- A user-requested check passes: a square 110 mph driver carries 250–280 yd (tests/physics.test.ts).
- Turf COR follows Penner's speed-dependent restitution, scaled per surface. Soft surfaces tilt the effective contact normal (the "crater"), so wedges check up on greens.
- Green speed is about stimp 10 (rolling deceleration 0.55 m/s²).

## Controls (see CONTROLS.md, RESEARCH.md §2)

- **Final spec** = the user's mapping, confirmed by research. The sources:
  - WASD walk, Tab golf view, A/D face, Q/E path, Z/C aim: medium-high confidence.
  - LMB drag of the hands: high confidence.
  - 1–5 clubs: an official option, which we make the default.
- **W/S = stance (ball position) in address.** This is an ASSUMPTION. No source names the key, so we use the user's mapping.
- **Direction conventions:** A = close the face, D = open it. Q = in-to-out (draw), E = out-to-in (fade). The direction is fan-sourced, but it is the natural "A/Q left, D/E right" mapping.
- **Mouse swing:** the swing panel is a face-on view with the target on the screen's **right** (mirrored at the user's request). Drag up/left for the backswing, then swiftly down (and right) through the ball. One review describes this as "swiftly move the mouse downward to hit the ball". Both axes can be inverted in settings.
- **Pointer lock while LMB is held.** The original probably isn't pointer-locked, but the brief asks for it so the swing isn't limited by the screen edge. A virtual cursor is drawn in the swing panel.
- **Stance forward = body forward = ball further back**, which gives a delofted, low punch. Stance back gives higher, scooped shots. This matches the community description "forward → lower stinger".

## Swing model

- **Physics-driven 2D swing-plane model** (`src/swing/SwingModel.ts`):
  - The hands follow a cursor via springs in polar coordinates around the shoulder, so they travel on the arm arc.
  - The club is a weighted rod on a springy wrist hinge.
  - Speed, attack angle, shaft lean and the sole height at the ball all *emerge* from the motion.
- **Radial decoupling.** The cursor's angle maps 1:1 to the hands. The cursor's radial distance from the arm circle is scaled by `radialGain` (0.2 = original difficulty; 0.13 and 0.08 with assists).
  - With a 1:1 mapping, the clean-contact window was about 1.5 cm of hand travel, roughly 7 px of mouse. That was unplayable.
  - The scaled window is about 5× wider. Research confirms the original's "margin for error is just too small" complaint.
- **Over-reaching** past the circle hits fat. Swinging inside it hits thin, topped, or a whiff. Hands faster than about 10.5 m/s "flail", twisting the face. Erratic, jerky input causes off-centre (toe/heel) strikes.
- **Drift.** Face and path drift only while swinging, as a smooth, visible, seeded sum of sines (±2° face, ±1.5° path, growing with hand speed). Assist Light halves it; Full removes it. Research suggested that predictable drift feels fair, while pure noise feels like padding.
- **Bag:** Driver, 4-Hybrid, 7-Iron, Sand Wedge, Putter. Research says the original's bag is driver, hybrid, iron, wedge and putter, for keys 1–5. Distance control comes from swing length and speed.
- **Rules:**
  - A whiff counts as a stroke.
  - Water: +1, dropped where the ball crossed the margin.
  - OOB: stroke and distance.
  - Space retake: stroke and distance, +1.
  - The stroke cap is 15 per hole, so a disaster never ends a session.

## Game flow

- After a long shot you are put in first-person walking mode where you hit from, as in the original. **F** goes straight to your ball. This is an improvement for pace; research found walking can feel like padding. Short shots and shots onto the green auto-address the ball.
