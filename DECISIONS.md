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

- After every shot the game takes you straight to your ball, ready to address it (see User feedback below). Tab switches to first-person walking to explore, and **F** returns you to the ball.

## User feedback (overnight)

- **Swing panel mirrored and enlarged**: the target is on the right. Drag up-left, then swiftly down-right. The swing panel is 28 em and the club panel 24×27 em.
- **Face/path drift**: an unstable "runaway" drift, where A/D and Q/E accelerate away from square during the swing, was tried and **rejected by the user**. The original gentle, bounded wobble is kept and must not be changed back to runaway behaviour.
- **No 500-yard drives**: very fast or violent mouse flicks could push the driver to about 185 mph. Clubhead speed now saturates softly toward a per-club cap. Swings stay 1:1 up to 82% of the cap.

  | Club | Cap (mph) |
  |---|---|
  | Driver | 118 |
  | Wood | 114 |
  | Hybrid | 110 |
  | Iron | 102 |
  | Wedge | 95 |

  Fairway and tee roll-out were also firmed up.

  | Drive | Carry | Total |
  |---|---|---|
  | Best possible, calm | ~295 yd | ~323 yd |
  | Best possible, strong tailwind | — | ~380 yd |
  | Typical good drive | ~245 yd | ~275 yd |

  Over-swinging now mostly adds error (face flail), not distance.
- **No more "hitting the drive twice"**: after a long shot the game used to drop you, in walking mode, where you hit from (on the tee after a drive). That looked and felt like a forced replay. The game now always takes you straight to your ball, ready to address it; Tab still lets you walk. Space no longer doubles as fast-forward (that's **F**). A retake (stroke and distance, +1) needs Space pressed twice within 2 s.
- **Easier putting**: putt distance used to come from raw mouse speed at impact, which produced either tiny or huge putts. Putting is now a pendulum stroke. The **backstroke length sets the distance**, about 0.5 m per degree on a flat green, and tempo only nudges it by about ±12%. A live hint shows how far the current backstroke will roll and how far the hole is. Slopes and fringe still affect the real roll.
- **Per-club swing range (lower sensitivity for soft clubs)**: the arms rotate only a fraction of the mouse cursor's angle. The full-swing clubs are unchanged.

  | Club | Arm rotation (share of cursor angle) | Result |
  |---|---|---|
  | Putter | 30% | A full mouse backswing is only about a 16 m putt; 1 m ≈ 35 px of mouse |
  | Wedge | 80% | Full swing ≈ 80 yd, half swing ≈ 47 yd |
  | Iron, hybrid, woods, driver | 100% | Unchanged |

  Big, comfortable mouse motions now make small, controllable strokes. This replaces the old putter-only pixel scale.

## Performance budgets (polish pass)

Each budget covers one frame and counts every pass: main, shadow, water reflection, cloud cube face and post.

| Preset | Budget (calls / tris) | Tee, measured | Worst view, measured |
|---|---|---|---|
| Low | 120 / 1M | 73 / 0.57M | 73 / 0.57M |
| Medium | 200 / 2M | 141 / 1.05M | 189 / 1.44M (water) |
| High (default) | 250 / 3M | 179 / 2.05M | 203 / 2.75M (water) |
| Ultra | 350 / 6M | 215 / 4.29M | 216 / 5.66M |

- **Load time:**
  - Course-independent resources are prepared while the bake runs.
  - All shaders are compiled before the first frame, in parallel where supported.
  - Cloud-cube warm-up drops from 72 face renders to 30.
  - Headless load fell from 58 s to 30 s; about 90% of what remains is SwiftShader compiling shaders.
- **The water reflection only renders when a pond is visible**, scissored to the pond's area.
- **Shadow-only copies of terrain and foliage** hold just the instances inside the shadow camera's view.
- **Dynamic props are frustum-culled** per site.
- **F3** opens the performance overlay. `PERF_BUDGETS` lives in `src/render/shared.ts`.

## Visual polish

- **Fog density cut 2–3×.** The scattered fog light is far brighter than lit turf, so the old density made every view look milky. Golden hour's base fog is now neutral grey and only turns warm toward the sun.
- **Greens toned down.** The colour grade warms strong greens slightly and takes some saturation out, so turf no longer looks neon.
- **Pollen motes stay smaller than a golf ball** (at most 2.8 cm and 9 px on screen).
- **Noon exposure lowered.** The cloud undersides are also shaded better.

## Camera and rules (playtest pass)

- **After the ball stops:** the camera glides to about 6 m behind and beside the ball, 2.3 m up. In flight it rises only about 40% of the ball's height.
- **At address:** the ball sits about 13° below centre so the HUD never covers it. When putting, the camera sits on the line.
- **Water relief:** the ball is dropped back along the line it entered the water on.
- **Aim** resets to the pin after every shot. Face, path and stance persist, as in the original.
- **Saved settings are validated on load**, so a stale value can never stop the game from booting.
