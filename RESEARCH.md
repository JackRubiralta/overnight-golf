# RESEARCH.md: an original browser golf game inspired by the mechanics of Normal Golf Game

> **What this is.** A design-research brief for an **original** Three.js browser golf game. It borrows *mechanical ideas* (a physical mouse-drag swing, separate face/path/aim/stance inputs, open-course walking, optional challenges) from *Normal Golf Game* (Steam app 3510740, by Luke Muscat). It does **not** copy the name, branding, story, FMV, characters, text or assets. See section 9.
>
> Research date: 2026-11-01. Every claim cites a URL inline. Confidence tags: **H** = high, **M** = medium, **L** = low. **[S]** = sourced, **[I]** = inferred, **[E]** = engineering estimate, **[L]** = known literature value I could not open here. Anything I had to guess is marked **ASSUMPTION** and collected in section 11.

---

## 1. Summary and methodology

### 1.1 Summary
- **What the reference game is.** *Normal Golf Game* came out on Sep 21, 2026 at $9.99 for PC on Steam. It is Steam Deck Verified and rated Overwhelmingly Positive at about 98% ([Steam](https://store.steampowered.com/app/3510740/Normal_Golf_Game/), [SteamDB](https://steamdb.info/app/3510740/)).
  - You walk in first person around a single 9-hole property.
  - You press **Tab** to enter a third-person "golf view" with swing panels.
  - You swing by **click-dragging the golfer's hands** with the mouse. There is no power meter.
  - Separate keys adjust **clubface angle (A/D)**, **clubface path (Q/E)** and **aim (Z/C)**, and you keep correcting them live during the swing.
  - At default difficulty the club "wobbles" (drifts), and you have to fight it ([PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/), [Tally Ho Corner](https://tallyhocorner.com/2026/10/normal-golf-game-review/)).
- **What players think.** They love the analog, QWOP-like skill swing and the arc from awful to competent. They dislike four things:
  - the golf is buried under challenges and story;
  - random club drift can feel unfair;
  - the controller swing is awkward;
  - the bounty structure feels grindy.

  Sources: [Steam thread](https://steamcommunity.com/app/3510740/discussions/0/572667123972783002/), [Controller Nerds](https://www.controllernerds.co.uk/reviews/pc/normal-golf-game-review/), [Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/).
- **Our plan.** Build an original, **golf-first** game on the same core swing idea:
  - **physics:** real TrackMan-calibrated physics (D-plane, Magnus lift, Penner bounce and roll);
  - **feedback:** visible, readable drift;
  - **modes:** a "Play Round" mode available from the first minute, with challenges optional;
  - **tech stack:** three r187 with WebGLRenderer, pmndrs postprocessing and Rapier.

### 1.2 Sources consulted
- **Official.** Steam store and demo pages, Steam Community patch notes #2–#4 and their hotfix, Steam discussions, Steam achievements, SteamDB.
- **Press.** PC Gamer, Kotaku, Tally Ho Corner, Xbox Tavern, WayTooManyGames, Controller Nerds, Remap Radio, Pixel Byte, Quest Daily, contentbymarko, Movies Games and Tech, Gaming.net, Operation Sports, GamingOnLinux, Insider Gaming, Automaton, IndieGame.com, GamesRadar (headline only).
- **Walkthrough.** 9Puz, a demo guide. It is the only source that claims to transcribe the in-game controls menu.
- **Community.** ResetEra OT, speedrun.com, a Luke Muscat YouTube community post.
- **Fan or SEO wikis** (low reliability, contradictory): normalgolfgame.site, normal-golf-game-wiki.wiki, normalgolfgamewiki.wiki/.top, dear-passengers.com.
- **Physics.** TrackMan support PDFs and blog; Penner 2001/2003; Smits & Smith 1994; opengolfcoach `trajectory.rs`; Sports Engineering 2023; USGA stimp toolkit.
- **Tech.** The npm registry (2026-11-01) and unpacked tarballs of three@0.187.0, postprocessing@6.39.6, n8ao@2.0.1, @dgreenheck/ez-tree@1.1.0 and @dimforge/rapier3d-compat@0.21.0.

### 1.3 What was blocked
- **No page could be fetched.** WebFetch failed with `getaddrinfo ENOTFOUND` on every host tried: store.steampowered.com, steamcommunity.com, 9puz.com, pcgamer.com, kotaku.com, playtester.io, remapradio.com, gaming.net, waytoomany.games, trackman.com, link.springer.com, arxiv.org, docs.rs and others.
- **All game evidence comes from WebSearch snippets** (roughly 70 queries across the research passes). Quotes are search-engine extracts and may be lightly paraphrased.
- **No official keybind list was found**: no Steam guide, no developer post, no readable controls-menu text.
- **No real Reddit threads or YouTube transcripts were found.**
- **To verify the full text,** allow these hosts in the session's network settings: steamcommunity.com, store.steampowered.com, 9puz.com, pcgamer.com, kotaku.com, xboxtavern.com, trackman.com, link.springer.com.

---

## 2. Controls

### 2.1 Confirmed controls table (reference game)

| Input | Action | Source | Confidence |
|---|---|---|---|
| WASD (first person) | Walk/move | [9Puz](https://9puz.com/5907-normal-golf-game-tiny-island/) ("Use WASD to move"). Walking itself is confirmed by [PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/) and the patch notes. | M-H |
| Mouse look (first person) | Look around | Patch #2 "Smooth Out First Person Camera… mouse delta" ([Steam hub](https://steamcommunity.com/app/3510740)) | M-H |
| Tab | Toggle between first-person walking and the third-person golf view with swing panels. The shot trace persists. | [PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/): "To golf, I press Tab… press Tab again to resume first-person view while maintaining the traced path" | H |
| LMB hold + drag | Grab and move the golfer's hands to swing. Speed and travel give power; accuracy gives contact. Drag in an arc. | PC Gamer ("clicking and dragging my hands"); [Pixel Byte](https://pixelbytegaming.com/normal-golf-game-or-how-i-found-fun-again/) ("keep the left button pressed"); [Kotaku](https://kotaku.com/jetpack-joyride-designers-upcoming-golf-sim-makes-compelling-case-for-miserable-controls-2000700905) ("whip of your mouse"); [Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/) ("circle motion") | H (drag), M (LMB held throughout) |
| A / D | Clubface angle (open/closed) | [9Puz](https://9puz.com/5907-normal-golf-game-tiny-island/) "A and D for clubface angle"; official patch pairs Q+A and E+D | M-H |
| Q / E | Clubface path | 9Puz "Q and E for clubface path"; [Steam store](https://store.steampowered.com/app/3510740/Normal_Golf_Game/) "angle and path of the face" | M |
| Z / C | Rotate aim (direction line) | 9Puz "Z and C to change aim"; [Tally Ho](https://tallyhocorner.com/2026/10/normal-golf-game-review/) "rotate an aiming line left or right" (no keys named) | M |
| Q/E/A/D during the swing | Live corrections. They are held and they stack. | Official patch: "cheese extra long shots by holding either Q+A or E+D" ([Steam hub](https://steamcommunity.com/app/3510740)); [Remap Radio](https://remapradio.com/articles/the-most-normal-golf-game-ever-made/) "adjust the angle… also in real-time" | H |
| 1–5 | Quick club select. **Opt-in** setting, added in Patch #3. | Patch #3: "Option in the Configure Controls menu to enable quick club selection using 1-5" ([Steam hub](https://steamcommunity.com/app/3510740)) | H |
| Default club switch | Menu/UI, only when you are allowed to swing | Patch: "Can no longer change clubs unless you are allowed to swing" | L (the input is unknown) |
| Stance up/down | Adjusted at least partly by clicking UI. Has "up" and "down" directions. | Hotfix: pop-ups "block mouse clicks when you are trying to quickly adjust stance"; Steam thread "What does stance 'up' and 'down' do?" | M (feature), L (binding) |
| Space | Reset/retake shot | Fan wikis only ([normalgolfgame.site](https://normalgolfgame.site/)). A retake exists officially ("Retaking a shot will now correctly re-tee your ball"). | L (key), H (feature) |
| RMB | Rangefinder | Fan wikis; patch "rangefinder and distance travelled now match" | L (key), H (feature) |
| Left Ctrl | Crouch to read greens | Fan wikis plus one review snippet | L |
| X | Practice swing | One fan wiki ([normal-golf-game-wiki.wiki](https://normal-golf-game-wiki.wiki/)) | L (likely fabricated) |
| Controller | Right stick = swing. Left stick + triggers/bumpers = face/path corrections. | [Remap Radio](https://remapradio.com/articles/the-most-normal-golf-game-ever-made/) "analog sticks replacing the mouse and bumper buttons replacing the keyboard"; [Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/) "left stick and triggers… keep this straight"; [WayTooManyGames](https://waytoomany.games/2026/09/21/review-normal-golf-game/) | M |
| Esc / pause, map | Unknown | — | none |

### 2.2 Conflicts with the user's starting mapping

| Starting mapping | Verdict | Notes |
|---|---|---|
| WASD walk | **CONFIRMED** (M-H) | Only one secondary source (9Puz) names the keys. |
| Tab toggles walk/stance | **CONFIRMED** (H), with nuance | It toggles *camera mode + UI panels* (first person ⇄ third-person golf view), not just a stance. |
| Hold LMB + drag hands, with pointer lock | **Swing CONFIRMED (H). Pointer lock UNVERIFIED and probably WRONG for the reference.** | The reference has you click on-screen panels (the hands, stance UI), so it is likely *not* pointer-locked [I, M]. We still choose pointer lock: see 2.3 and section 8. |
| A/D clubface open/close | **CONFIRMED** (M-H) | Direction unverified. A fan draw/fade tip gives **A = close, D = open** (L). One outlier site ([contentbymarko](https://gaming.contentbymarko.com/normal-golf-game/)) swaps A/D with Q/E. It could not be reproduced; treat it as wrong. |
| Q/E path in-out/out-in | **CONFIRMED as the label "clubface path"** (M) | Exact semantics are contested. Wikis also call it "spin", "impact position" or "club placement & alignment". Tally Ho's "rotate **and move** the club head" hints that one pair is a translation. Direction (Q = in-out/draw, E = out-in/fade) is fan-sourced (L). |
| Z/C rotate aim | **LIKELY CONFIRMED** (M) | **Conflict:** [normalgolfgame.site walkthrough](https://normalgolfgame.site/guide/walkthrough/) says Z/C = stance ("Alters ball pop height and distance"). The official "Q/E/A/D" list leaves out Z/C. |
| W/S in stance = ball position | **UNVERIFIED** (L) | No source names W/S, the wheel or any stance key. Evidence points to UI clicks plus a gamepad stick. Fine for an original game, but not faithful to the reference. |
| 1–5 clubs | **CONTRADICTED as a default. CONFIRMED as an option** (H) | Off by default in the reference. We make it the default; see 2.3. |

### 2.3 Final control spec for our game

These are design decisions for an original game. They follow the reference where it is confirmed, and fix what players disliked.

| Input | Mode | Action | Basis |
|---|---|---|---|
| W A S D | Walk | Move (Shift = jog) | Confirmed reference + FPS default. Shift = ASSUMPTION. |
| Mouse | Walk | Look (pointer lock, raw deltas) | Fixes the reference's jitter complaint (Patch #2) |
| Tab | Both | Toggle Walk ⇄ Address (stance) view. The shot tracer persists. | Confirmed (H) |
| LMB hold + drag | Address | Grab the hands and swing. Drag back/up = backswing; fast forward/down = downswing. Release = let go. | Confirmed (H). Direction = ASSUMPTION. |
| Pointer lock | Address | **On** while LMB is held (raw `movementX/Y`). The cursor is hidden and a virtual hand cursor is drawn in the swing panel. | ASSUMPTION: our choice, departs from the reference |
| A / D | Address, live during swing | Close / open the clubface (A = close/hook, D = open/slice for a right-hander) | Confirmed pair; direction from the fan tip (L) |
| Q / E | Address, live during swing | Club path: Q = in-to-out (draw), E = out-to-in (fade) | Confirmed label; direction fan-sourced (L) |
| Z / C | Address | Rotate aim line and body alignment left/right | Confirmed (M) |
| W / S | Address | Ball position: forward (W, lower and flatter) / back (S, more loft, steeper attack) | **ASSUMPTION** (user mapping; unsourced in the reference) |
| 1–5 | Address | Select club 1–5 (default **on**) | Reference option made default. Our bag: 1 Driver, 2 Hybrid/Wood, 3 Iron, 4 Wedge, 5 Putter (ASSUMPTION). |
| Mouse wheel | Address | Cycle clubs | ASSUMPTION |
| Space | Address / after shot | Retake shot (counted as a mulligan in casual mode, disabled in "pure" mode) | Feature confirmed; key fan-sourced (L) |
| R | Address | Reset club face/path/stance to neutral | ASSUMPTION |
| RMB hold | Walk / Address | Rangefinder (distance to the point under the crosshair, plus elevation) | Feature confirmed; key fan-sourced (L) |
| Left Ctrl | Walk | Crouch to read the green (a break grid when the assist is on) | Fan-sourced (L) |
| F | After shot | Fast-forward ball flight | Requested by players ([Steam thread](https://steamcommunity.com/app/3510740/discussions/0/561409060965013167/)); ASSUMPTION key |
| T | After shot | Replay last shot | Requested by players; ASSUMPTION key |
| M | Walk | Course map | Reference has a map (key unknown); ASSUMPTION |
| Esc | Any | Pause/menu (releases pointer lock) | Browser convention |
| Gamepad | Both | Left stick = walk / face+path in Address. Right stick = look / swing hands. LB/RB = path, LT/RT = face, d-pad L/R = aim, d-pad U/D = ball position, A = toggle mode, X = retake, Y = club. | Reference pattern (M); exact map = ASSUMPTION |
| Touch | Address | One-finger drag = swing. On-screen ± pads for face/path/aim. | ASSUMPTION (browser reach; section 8) |

Everything is rebindable, and bindings are stored per device. This follows the reference's Patch 3/4 rebind work.

---

## 3. Swing system

### 3.1 What the reference does
- **Direct physical swing, no meter.** Kotaku: it "does away with the usual power meters, maps and compasses for a more QWOP-like tee-off", splitting "swing strength, curves and stances into a set of inputs" ([Kotaku](https://kotaku.com/jetpack-joyride-designers-upcoming-golf-sim-makes-compelling-case-for-miserable-controls-2000700905)). [S, H]
- **Two panels** ([PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/)) [S, H]:
  - a body panel where you drag the hands;
  - a top-down club panel showing "the placement and angle of the clubface".
  - Panels "accumulate" as the game introduces more inputs.
- **Circular gesture with auto-return.** "Drag your club in a circle motion, building enough speed while precisely hitting the ball with accurate contact" ([WayTooManyGames](https://waytoomany.games/2026/09/21/review-normal-golf-game/), [Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/)). A Steam suggestion thread [S, M] mentions:
  - "the circle" and its centre;
  - hands that "auto return back to the starting position when you are doing no input", at a speed the developer randomised;
  - an exploit of "clicking in the lower right part of the circle" for reliable contact.

  Source: [Steam thread](https://steamcommunity.com/app/3510740/discussions/0/658233614222366804/).
- **Power and contact.** Power comes from hand speed and travel. Contact comes from accuracy. Going too fast makes "your club face… flail", giving fat shots (fan wiki, L). Following the stick's outer edges "will see us hitting the turf" ([Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/)). You can "scoop under the ball for more lift, or top it" (Xbox Tavern). [S, M]
- **Speed feedback.** The club-head swoosh trail changes colour by speed zone, up to red and then purple near max (a Steam player). [S, M]
- **Drift ("wobble").**
  - "At default difficulty and above, club head position and alignment wobble slightly as you swing, meaning tiny mid-swing corrections and good timing are important" ([Tally Ho](https://tallyhocorner.com/2026/10/normal-golf-game-review/)).
  - Face "angle and position… shift randomly, so you have to correct them constantly" ([Controller Nerds](https://www.controllernerds.co.uk/reviews/pc/normal-golf-game-review/)).
  - A difficulty mode removes it (fan wikis and patch notes mention bounties completed on that mode).

  [S, H]
- **Separate stance, aim, face and path.** The store says you "manipulate the path of your club, while simultaneously managing your stance, direction, and the angle and path of the face" ([Steam](https://store.steampowered.com/app/3510740/Normal_Golf_Game/)). [S, H]

### 3.2 Our design (original implementation)
- **Address state** (persistent between swings, shown in the top-down panel):
  - `aimYaw` (Z/C, ±45°, 0.5°/tick hold-accelerated)
  - `ballPos` (W/S, −3…+3 ball-widths)
  - `faceOffset` (A/D, ±12°)
  - `pathOffset` (Q/E, ±10°)
  - club
- **Swing state machine:** `Idle → Grab (LMB down inside the hand zone) → Backswing → Transition → Downswing → Impact → FollowThrough → Release`.
  - The hands follow a **2D virtual cursor** driven by raw pointer-lock deltas, on a circular arc around a shoulder pivot in the side-view panel.
  - The cursor's tangential component drives the club angle θ. The radial component (pulling in or pushing out) changes the arc radius, which sets the **low point / attack angle / fat-thin**.
  - Club-head speed at impact = `ω_arm × R_club × k_club`. Here `ω_arm` comes from smoothed angular velocity of the cursor over the last ~60 ms, clamped by a per-club max. A soft-saturation curve means overswinging gains little speed but adds error (players complained max speed is hard to reach, so the curve is visible in the trail colour).
- **Attack angle and low point.** Mapped from where the arc bottoms out relative to the ball (ballPos shifts the ball along the arc):
  - forward ball = upward AoA, lower dynamic loft;
  - back ball = steeper AoA, more loft-down "punch".

  ASSUMPTION mapping: each ball-width ≈ 1.5° AoA, −1.5° dynamic loft.
- **Impact face and path:**
  - `face = aimYaw + faceOffset + faceDrift + handRotationError`
  - `path = aimYaw + pathOffset + pathDrift + gestureCurvature` (an in-to-out drag curve adds path)
- **Strike location.** Strike location on the face (toe/heel, high/low) comes from radial and timing error. It feeds gear effect and smash loss (section 4.6).
- **Drift, made fair.** This responds to the "random = unfair" complaint (section 8).
  - Drift is a **visible, smooth, low-frequency** signal: a sum of 2 sines plus seeded value noise at 0.3–1.2 Hz.
  - Amplitude grows with hand speed and difficulty:

  | Difficulty | Drift |
  |---|---|
  | Steady | none |
  | Normal | ±2° face, ±1.5° path |
  | Hard | ±4°, plus position wobble |

  - Drift is drawn **live** in the club panel as a ghost face, so A/D/Q/E corrections are a skill rather than a dice roll.
  - Seeded per shot, so replays are deterministic.
- **Hands auto-return** to address after release (constant speed; no randomisation).
- **Practice swing.** A swing that never reaches the ball's arc segment (no contact) is a free practice swing.
- **Feedback.** Swoosh trail colour bands for 60/80/95/100% of club max speed. After the shot there is a readout card: club speed, face, path, FtP, AoA, strike dot (assist toggle).

---

## 4. Ball physics

The reference gives no numbers. It shows hooks, slices, thin, fat, fliers and an apex of 200+ yd is possible ("To The Moon" achievement, [Steam achievements](https://steamcommunity.com/stats/3510740/achievements)). We use a real model calibrated to TrackMan and allow an optional "arcade" multiplier. All formulas and values below come from the physics report. Tags: [S] confirmed snippet, [L] literature, [E] estimate.

### 4.1 Constants
```text
m = 0.04593 kg   D = 0.04267 m   r = 0.021335 m   A = πr² = 1.4300e-3 m²
I ≈ 0.4 m r²     g = 9.80665 m/s²   μ_air = 1.81e-5 Pa·s (15 °C; Sutherland: 1.458e-6·T^1.5/(T+110.4))
Driver COR e ≈ 0.830 (USGA) → max smash ≈ 1.50
Air density: p(h)=101325(1−2.25577e-5 h)^5.25588; p_sat=610.78·10^(7.5Tc/(Tc+237.3));
             ρ = p_d/(287.058 T) + p_v/(461.495 T)   → 1.225 at sea level/15 °C, ≈1.05 at 1609 m (+6–8 % carry)
```

### 4.2 D-plane and launch ([TrackMan definitions](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions), [D-Plane Tilt](https://support.trackmangolf.com/hc/en-us/articles/39726207070875-Parameters-D-Plane-Tilt-Tee-to-Green), [Spin loft](https://www.trackman.com/blog/spin-loft), [Spin axis](https://www.trackman.com/blog/spin-axis))
```text
// y = target line, z = up, x = right (RH golfer)
p̂ = (sin(path)cos(aoa), cos(path)cos(aoa), sin(aoa))    // club velocity direction
n̂ = (sin(face)cos(dl),  cos(face)cos(dl),  sin(dl))      // face normal (dl = dynamic loft)
spinLoft = acos(p̂·n̂)
spinAxis = normalize(n̂ × p̂)        // verify sign: straight shot backspin axis ≈ −x
axisTilt = asin(spinAxis.z)         // + = fade/slice, − = draw/hook (RH)
// check: tilt ≈ atan(FtP / spinLoft); driver SL 14°, FtP 2° → ≈ 8°
launchV = aoa  + kV(dl − aoa)       kV ≈ 0.85 driver / 0.80 irons / 0.75 wedges  [E]
launchH = path + kH(face − path)    kH ≈ 0.85 driver / 0.75–0.80 irons / 0.70 wedges  [E]
```
- FtP = face − path.
- When FtP = 0 the tilt is 0. A smaller spin loft gives more tilt for the same FtP [S].

### 4.3 Ball speed and spin (Penner 2003 [L])
```text
M (head mass): driver 0.200, 3W 0.210, hybrid 0.230, 3i 0.240 … PW 0.290, SW 0.300 kg
v_n = V·cos(SL)·(1+e)/(1+m/M)        v_t = V·sin(SL)·(2/7)/(1+m/M)
v_ball = √(v_n² + v_t²)              ω_roll = 5 v_t /(2r)   (underestimates irons)
e: driver 0.83, 3W 0.80, 7i 0.78, wedges 0.72–0.75, putting 0.80–0.83   [E]
Calibrated spin: spin_rpm = k_club · v_ball(mph) · sin(SL)
  k ≈ 68 driver, 85 3W, 100 5W, 105 hybrid, 120 4i, 141 7i, 150 9i, 155 PW, 160 wedges  [E]
```
- Checks: a driver at 113 mph with SL 14° gives a smash of about 1.45; a 7i at 90 mph with SL 25° gives about 1.37.
- Smash by club (Tour) [S driver, L rest]:

| Club | Smash |
|---|---|
| Driver | 1.48–1.50 |
| 3W | 1.47–1.48 |
| 5W | 1.46–1.47 |
| Hybrid | 1.45–1.46 |
| 3i | 1.45 |
| 4i | 1.43 |
| 5i | 1.41 |
| 6i | 1.38 |
| 7i | 1.33 |
| 8i | 1.32 |
| 9i | 1.28 |
| PW | 1.23 |
| GW | ~1.20 |
| SW | ~1.15 |
| LW | ~1.10 |

### 4.4 Per-club TrackMan reference table (PGA Tour)

Sources: [TrackMan PDF 1](https://support.trackmangolf.com/hc/en-us/article_attachments/7349801987483), [PDF 2](https://support.trackmangolf.com/hc/en-us/article_attachments/7349802113051), [Tour averages](https://support.trackmangolf.com/hc/en-us/articles/5089752464667-Shot-Analysis-Tour-Averages-On-PGA-LPGA-Tour). The driver row and PW spin are [S]; the other Tour rows are [L]; GW/SW/LW are [E].

| Club | Club mph | AoA° | Ball mph | Smash | Launch° | Spin rpm | Apex yd | Land° | Carry yd |
|---|---|---|---|---|---|---|---|---|---|
| Driver | 113 | −1.3 | 167 | 1.48 | 10.9 | 2686 | 32 | 38 | 275 |
| 3-wood | 107 | −2.9 | 158 | 1.48 | 9.2 | 3655 | 30 | 43 | 243 |
| 5-wood | 103 | −3.3 | 152 | 1.47 | 9.4 | 4350 | 31 | 47 | 230 |
| Hybrid | 100 | −3.5 | 146 | 1.46 | 10.2 | 4437 | 29 | 47 | 225 |
| 3-iron | 98 | −3.1 | 142 | 1.45 | 10.4 | 4630 | 27 | 46 | 212 |
| 4-iron | 96 | −3.4 | 137 | 1.43 | 11.0 | 4836 | 28 | 48 | 203 |
| 5-iron | 94 | −3.7 | 132 | 1.41 | 12.1 | 5361 | 31 | 49 | 194 |
| 6-iron | 92 | −4.1 | 127 | 1.38 | 14.1 | 6231 | 30 | 50 | 183 |
| 7-iron | 90 | −4.3 | 120 | 1.33 | 16.3 | 7097 | 32 | 50 | 172 |
| 8-iron | 87 | −4.5 | 115 | 1.32 | 18.1 | 7998 | 31 | 50 | 160 |
| 9-iron | 85 | −4.7 | 109 | 1.28 | 20.4 | 8647 | 30 | 51 | 148 |
| PW | 83 | −5.0 | 102 | 1.23 | 24.2 | 9304 | 29 | 52 | 136 |
| GW [E] | 80 | −5.0 | 96 | 1.20 | 27 | 9800 | 28 | 52 | 122 |
| SW [E] | 77 | −5.0 | 89 | 1.16 | 30 | 10200 | 27 | 52 | 108 |
| LW [E] | 74 | −5.0 | 82 | 1.11 | 33 | 10500 | 26 | 52 | 95 |

- **Updated 2023–24 values** ([TrackMan blog](https://www.trackman.com/blog/introducing-updated-tour-averages), [Golf Monthly](https://golfmonthly.com/tour/how-far-pga-tour-players-hit-every-club-in-the-bag)) [S]: driver ~115 mph club / 171 ball / 2545 rpm / apex 35 / carry 282; 7i 92 / 123 / carry 172–176.
- **Amateur (~15 hcp)** [E/L]: driver 93 mph, 1.42 smash, 12–13° launch, ~3250 rpm, ~214 carry; 7i 75 mph, 98 ball, 18–19°, 6000–6500 rpm, ~140 carry.
- **Dynamic loft** [E]: driver 12.5–13°, 7i 20–21°, PW 28–30°.
- **Game target:** default player strength ≈ the "amateur" row. A perfect max-speed swing reaches the Tour row (ASSUMPTION).

### 4.5 Flight (CL/CD model)
```text
v_rel = v_ball − u_wind(z);  S = r|ω|/|v_rel|;  Re = ρ|v_rel|D/μ_air
F_D = −½ρ A C_D |v_rel| v_rel
F_L =  ½ρ A C_L |v_rel|² · normalize(ω̂ × v̂_rel)
a   = (F_D + F_L)/m − g ẑ          // RK4, dt = 1 ms (or semi-implicit 1–2 ms)
```
- Typical S: driver 0.07–0.09, 7i 0.28–0.30, wedges 0.35–0.45.
- **Model options** (calibrate against 4.4):
  1. **Penner 2003** [L], our default: `C_D = 0.171 + 0.62 S`, `C_L = 0.083 + 0.885 S`.
  2. **Smits & Smith 1994** ([chapter](https://www.taylorfrancis.com/chapters/edit/10.4324/9780203474709-54/new-aerodynamic-model-golf-ball-flight-smits-smith)): `C_D = 0.24 + 0.18 S (+ small Re term)`, `C_L = 0.54 S^0.4`.
  3. **Lyu 2018 + Bearman & Harvey** ([opengolfcoach](https://docs.rs/crate/opengolfcoach/0.3.0/source/src/trajectory.rs)): `S ≤ 0.25: C_L = 1.990 S − 3.25 S²`; `S > 0.25: C_L = 0.294 + 0.50 (S − 0.25)`.
  4. **Re-dependent drag** [E]: `C_D0(Re) = 0.23 + 0.25/(1 + exp((Re − 5.5e4)/8e3))`, `C_D = C_D0 + 0.6 S`. Captures the drag crisis near 15–20 m/s.
- **Spin decay:** `dω/ds = −K ω`, K = 0.001 m⁻¹ [S, opengolfcoach]. Equivalently `dω/dt = −K|v|ω`. Alternative: τ ≈ 20–30 s [E].
- **Calibration targets:**
  - The Tour driver (167 mph, 10.9°, 2686 rpm) should give ≈ 275 yd carry, 32 yd apex and a 38° land angle.
  - The 7i (120 mph, 16.3°, 7097 rpm) should give ≈ 172 yd carry and a 50° land angle.
  - Scale C_L and C_D by ±10% until both hit. This becomes a unit test.

### 4.6 Strike location, gear effect, thin/fat, lies [E unless noted]
- **Gear effect:**
  ```text
  M_eff = 1/(1/M + d²/I_c)
  J     = m(1+e)v_n/(1 + m/M_eff)
  Ω     = J·d/I_c
  u     = Ω·b
  ω_gear ≈ 5u/(7r)
  ```
  - Driver values: b ≈ 0.035 m, I_c ≈ 4.5–5.0e-4 kg·m². Iron values: b ≈ 0.005 m, I_c ≈ 2.5e-4.
  - A toe hit at 12.7 mm gives ≈ 900 rpm of draw spin.
  - Bulge (R ≈ 0.30 m) opens the face by d/R. Roll (R ≈ 0.28 m) adds loft by z/R.
  - Vertical: for each mm above CG, spin drops 35–45 rpm and launch rises 0.1–0.15°.
- **Smash loss:** `smash·(1 − k(d/0.01 m)²)`, with k = 0.025 driver, 0.04 irons, 0.05 blades.
- **Thin:** ball speed −5…−15%, launch −3…−6°, spin −20…−40%.
- **Fat** (turf a distance x before the ball): club speed loss ≈ 0.12·(x/2.5 cm), capped at 50%. Loft +1–2°, spin −10–20%.
- **Lies:**

| Lie | Ball speed | Spin | Launch | Notes / friction factor f_lie |
|---|---|---|---|---|
| Fairway | 1.0 | 1.0 | 0 | f = 1.0 |
| Light rough | −2…−4% | −15…−30% | +0.5° | f = 0.5 |
| Flier | −0…−3% | −40…−65% | +1…+2° | f = 0.35; +5–15 yd carry |
| Heavy rough | −10…−25% | −50…−70% | +1…+3° | face/path randomised ±5° (visible as a "grab" wobble) |
| Fairway bunker | −3…−6% | −10…−20% | 0 | a fat contact is punished hard |
| Greenside explosion | 0.25–0.40 × club speed | 2000–5000 rpm | 35–45° | club enters 5–8 cm behind the ball |
| Wet | 0 | −20…−40% | +0.5° | f = 0.65 |

- **Reference evidence.** Lies matter in the reference: the "Consistency" fairway bounty, and players resetting from the rough ([normalgolfgame.site](https://normalgolfgame.site/)). No multipliers are sourced [I, L-M].

### 4.7 Bounce ([Penner 2001 "The run of a golf ball"](https://link.springer.com/article/10.1007/s12283-023-00442-4) family; [arXiv 2208.11685](https://arxiv.org/pdf/2208.11685))
```text
contact frame; ω_b > 0 = backspin;  slip u = v_t + r ω_b
if μ(1+e)v_n ≥ (2/7)u  → rolling:  v_t' = (5v_t − 2rω_b)/7 ; ω_b' = −v_t'/r
else                   → sliding:  J = μ(1+e)v_n·sign(u) ; v_t' = v_t − J ; ω_b' = ω_b − (5/2)J/r
v_n' = e v_n
Penner compliant turf: θ_c = 15.4° · (v_in/18.6 m/s) · (θ_in/44.4°)   (rotate the frame, then apply the above)
e(v_n) = 0.510 − 0.0375 v_n + 0.000903 v_n²  (v_n ≤ 20 m/s);  e = 0.120 (v_n > 20)
μ_green = 0.4
```
- Wedge spin-back emerges naturally when `rω_b > 2.5 v_t`.
- Switch to rolling once v_n' < 0.5 m/s, or after 3–5 bounces.
- Recalibrate against the [Sports Engineering 2023](https://link.springer.com/article/10.1007/s12283-023-00442-4) fit, which used more than 1000 bounces on a green.

**Surface presets** [E]:

| Surface | e scale | μ | θ_c scale | Rolling decel a_r (m/s²) |
|---|---|---|---|---|
| Green firm | 1.0 | 0.40 | 1.0 | from stimp |
| Green soft | 0.8 | 0.45 | 1.4 | from stimp |
| Fairway firm | 1.1 | 0.40 | 0.8 | 1.0–1.5 |
| Fairway soft | 0.8 | 0.45 | 1.3 | 1.5–2.5 |
| Light rough | 0.6 | 0.55 | 1.5 | 3–5 |
| Heavy rough | 0.4 | 0.70 | 2.0 | 6–10 |
| Sand | 0.05–0.10 | 0.70 | 2.5 (can plug) | ~15 |
| Cart path | 1.5–2.0 | 0.30 | 0 | 0.3 |

### 4.8 Roll and the stimpmeter ([stimp patch](https://patents.justia.com/patent/20100285903), [USGA toolkit](https://www.usga.org/content/dam/usga/pdf/science-of-golf/high-school/Putting/putting_full_toolkit_HS.pdf))
```text
v0 = 1.83 m/s (stimp release);  a_r = v0²/(2·d_s),  d_s = stimp_ft × 0.3048
  stimp 8 → 0.69, 10 → 0.55, 12 → 0.46, 14 → 0.39 m/s²
μ_r = 7 a_r/(5g)  (≈0.078 at stimp 10)
a = −(5/7) g sin(α) ĝ_slope − a_r v̂
stop when |v| < 0.01–0.02 m/s and (5/7) g sin(α) < a_r
low-speed rise: a_r(v) = a_r0 (1 + 0.3/max(v, 0.1))   [E]
residual backspin decays via sliding friction μ_slide 0.2–0.4 until v = −rω_b
```
- Default greens: stimp 10 (ASSUMPTION). Cup capture: the ball is within the cup radius (54 mm) and slow enough; otherwise it lips out.

### 4.9 Implementation split
- **Flight:** our own RK4 integrator (deterministic, 1 ms).
- **Bounce, roll and lies:** our own contact model against the heightfield (sampling the splat mask for surface type). Rapier is used for collisions with props, trees, flags and breakables, with CCD on (see section 10).

---

## 5. Weather and wind

### 5.1 Reference
- **Wind exists, varies and shifts.** Patch #2: "The wind now changes direction more slowly if the ball is in flight, reducing (but not eliminating) the wind messing up your shot" ([Steam hub](https://steamcommunity.com/app/3510740)). [S, H]
- **Wind can be strong, and it is a teaching tool.** The "Crosswind" bounty has fan-cited 30–40 mph winds, and you open or close the face to ride it. [S, M] (fan wikis)
- **Wind can be toggled off** as an assist. [S, M]
- **No evidence of rain or other weather.** [—, L]

### 5.2 Our design
- **Wind model:**
  - `u_ref` at 10 m, with a log-law profile `u(z) = u_ref·ln(z/z0)/ln(10/z0)` and z0 = 0.01–0.03 m [L/E].
  - Direction and speed follow seeded slow noise, plus gust events of 2–6 s.
  - While the ball is in flight, the wind's rate of change is scaled down to ≤25% (this mirrors the reference fix, so mid-flight wind shifts don't feel unfair).
- **Presets per hole:** Calm (0–5 mph), Breezy (5–15), Windy (15–25), Gale (25–40; challenge only).
- **Assists:** "lock wind per shot" and "wind off".
- **Atmosphere:** temperature and altitude feed ρ (section 4.1), so a "mountain course" variant gives +6–8% carry.
- **Weather (original additions, ASSUMPTION):**
  - Overcast skies via the Sky cloud uniforms.
  - Light rain sets wet lies (spin −20…−40%) and soft greens (bounce preset "soft").
  - Morning dew.
  - Visual only for rain: particles plus a wet-roughness change on the terrain.
- **HUD:** a wind flag on the pin, a windsock prop, and a small arrow with mph. The arrow can be hidden by the "pure" assist toggle.

---

## 6. Game structure

| Topic | Reference (sourced) | Our design |
|---|---|---|
| **Course** | One contiguous property with a 9-hole layout that starts and ends at the clubhouse. Access is gated: the demo covers only the clubhouse area ([Steam demo](https://store.steampowered.com/app/4663130/Normal_Golf_Game_Demo/), [Tally Ho](https://tallyhocorner.com/2026/10/normal-golf-game-review/)). [S, H] | An original seamless 9-hole links-meets-parkland property (heightmap, ~1.2 × 0.9 km), designed to grow to 18 holes. A seeded procedural "daily course" comes later (section 8). |
| **Holes** | Fan wiki: H1 par 3 ~130 yd over water; H2 par 4 ~270 yd uphill dogleg; H4 par 4 332 yd; H6 par 5 with water; total par 34 ([normalgolfgame.site](https://normalgolfgame.site/guide/walkthrough/)). [L-M] | Our own par-35 layout (ASSUMPTION): 2 par 3s, 5 par 4s, 2 par 5s; at least one forced carry over water, one dogleg, one island-like green under our own name, one elevated tee. |
| **Walking** | First-person walking between shots; "Hit anything. Shoot from anywhere" ([Steam](https://store.steampowered.com/app/3510740/Normal_Golf_Game/)). Exploration is "the bulk" of play ([Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/)). [S, H] | Keep: walk anywhere, hit from wherever the ball lies. Add "walk to ball" auto-path (hold a key) and a teleport-to-ball option in round mode so walking never becomes padding. |
| **Challenges / bounties** | 100+ bounties (fan count 105) paying cash spent on clubs and assists. Examples: fairway three times in a row, crosswind within 8 yd, hit thrown watermelons, find a lost ball. Problems: no difficulty ordering, and a birdie doesn't satisfy a par bounty ([Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/), [Operation Sports](https://www.operationsports.com/normal-golf-game-launches-after-viral-demo-success/)). [S, M-H] | **"Drills & Dares" board**, all optional, with a visible difficulty ladder (Bronze/Silver/Gold). A better result also satisfies lesser goals. Quick retry from the shot position. Each drill teaches one variable (face, path, stance, wind, putting break). Rewards are cosmetic plus club unlocks; nothing gates normal rounds. |
| **Breakables** | Physics props you can hit (watermelons, gongs, a target object, maybe billboards). No general destruction; fan wiki says the shop windows are indestructible. [S, M] | Original props as Rapier bodies (stacked crates, pumpkins, clay pots, bottle pyramids, wind chimes), fractured into pre-split pieces on impulse above a threshold. Used in Dares only, never on the main fairway line. |
| **Unlocks** | Start with one iron; buy clubs at a shop (fan prices: putter $200, driver $250, hybrid $500). Assists (mulligans, wind toggle, hole skips, easy) also bought. [L-M] | Round mode has the **full bag from minute one**. Career/Dares mode earns currency for cosmetic balls, trails, outfits and *alternate* clubs (e.g. a forged blade with higher spin and a smaller sweet spot). Assists are **always free toggles**. |
| **Practice range / tutorial** | A "long tutorial" swing lesson introduces each key in turn ([9Puz](https://9puz.com/5907-normal-golf-game-tiny-island/), [WayTooManyGames](https://waytoomany.games/2026/09/21/review-normal-golf-game/)). A practice area by the shop. "Unclear tutorial objectives" is a complaint. [S, M] | Range plus a 6-step onboarding, each step with an explicit goal: (1) walk & Tab, (2) drag swing, (3) A/D face → push/pull, (4) Q/E path → curve, (5) Z/C aim + W/S ball position, (6) putting. A target-green range with launch-monitor readout. Skippable. |
| **Modes** | Story/campaign, a bonus plain 9-hole mode ("you can just play nine holes of normal golf"), an in-story 9-hole gauntlet, difficulty modes. No multiplayer. [S, H/M] | **Play Round** (default; 9/18, stroke play), **Range**, **Drills & Dares**, **Daily Seeded Round** with async ghost replays, **Time Trial**. Difficulty presets: Steady / Normal / Hard, plus per-assist toggles. Optional light humour layer (an original caddie character). |
| **Speedrun** | In-game time and stroke tracker (demo: "tracks your time and strokes"). speedrun.com board: full game WR ~34m08s ([speedrun.com](https://www.speedrun.com/Normal_Golf_Game)). Separate time and stroke categories exist. [S, H] | Built-in Time Trial: RTA timer from the first tee to holing out on the 9th, with split times per hole, stroke counter, deterministic seeds, and a "pure" flag (no assists, wind seed fixed). Export splits as JSON. |
| **Scoring** | Strokes against par; achievement for an albatross on hole 6. [S, H] | Stroke play, plus a Stableford option. Scorecard with fairway hit, GIR and putts. Per-hole personal bests and an "improved by N" toast. |
| **Penalties** | No sourced penalty rules. Retake exists ("Retaking a shot will now correctly re-tee your ball"). [S, M-H] | Rules of Golf-lite: water = +1 and drop at the crossing point (or replay); OOB = stroke and distance (+1, replay). Mulligans in casual mode only, counted and shown. Stroke cap per hole (default: net double bogey, or 10), with a "no cap" option. |
| **OOB** | An auto-reset was observed ("reset about 4–6 inches before hitting the green") [L-M]. | White-stake OOB polygons per hole, with a clear visual (stakes, fence). Detected when the ball comes to rest outside, not mid-flight. Show a toast plus the penalty. |
| **Water** | Water hazards exist (holes 1, 6, 9; "Tiny Island"). [M] | Hazard polygons in red/yellow. Ball entry triggers a splash VFX and sound, then the drop dialog: "replay" or "drop near entry, no closer to hole". |
| **Lost balls** | A "lost ball" in the reference is a collectible bounty, not a rule. [S, M] | Ball lost (no rest found in 30 s, or deep heavy rough / out of sight) = stroke and distance. Ball-finder ping assist. Hidden collectible "lost balls" scattered around as original collectibles (ASSUMPTION). |
| **Save** | Softlocks on crash while buying were fixed in patch #2 ([Steam hub](https://steamcommunity.com/app/3510740)). [S, H] | Autosave per shot in localStorage (try/catch). Atomic unlocks. Resume mid-round. |

---

## 7. Camera, HUD, swing panel, shot tracer, sound and game feel

### 7.1 Reference
- **Cameras.** First-person walking cam. Tab opens a third-person full-body golf view ([PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/)). A ball-follow camera exists; Patch #4 fixed its position on one bounty and improved its angle "to make judging your misses easier". [S, H]
- **No replay.** Players asked for a replay of the last shot, slow motion, fast-forward and a hide-trail option ([Steam thread](https://steamcommunity.com/app/3510740/discussions/0/561409060965013167/)). [S, M]
- **HUD.**
  - No swing meter, overhead map or directional guide ([Kotaku](https://kotaku.com/jetpack-joyride-designers-upcoming-golf-sim-makes-compelling-case-for-miserable-controls-2000700905)).
  - Panels: body/hands, a top-down club panel, and a shot-angle window in the lower right ([Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/)).
  - A rangefinder.
  - A map with checkmarks.
  - The shot trace persists after you Tab back to first person.
  - [S, H/M]
- **Speed feedback.** The swoosh trail colour shifts by speed zone. [S, M]
- **Sound.** Jaunty jazz. WayTooManyGames gave sound 6.0 ("basic… fine sound effects, fine music"). The stance-adjust sound was "too grating" and was patched. [S, M-H]
- **Feel.** "Deliberately infuriating" yet "the feeling is fantastic upon completing a hole". "Once it clicks it feels fantastic" ([Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/)). [S, H]

### 7.2 Our design
- **Cameras:**
  - **Walk:** first person, FOV 75, eye height 1.65 m, head-bob off by default.
  - **Address:** third person behind and right of the golfer, looking down the aim line. It eases on Z/C and gives a slight lean on W/S.
  - **Flight:** after impact, 0.6 s on the swing, then a ball-chase spring camera (critically damped). It hands off to a landing-zone camera when the apex passes and the predicted landing is more than 80 yd away.
  - **Green:** a low putting cam, with optional overhead.
  - Camera collision uses three-mesh-bvh raycasts against terrain.
- **Swing panel** (bottom left, 280×280 px, scales with UI):
  - a side-view mannequin silhouette (an original simple figure) with a circular hand zone, the hand cursor, the arc, the ball marker and the low-point marker;
  - a top-down club panel (bottom right) showing aim line, face (solid), path (arrow), ghost drift face, ball position ticks;
  - optional numeric degrees (assist).
- **HUD:**
  - hole / par / stroke / distance-to-pin;
  - wind arrow and mph;
  - club name and its "typical carry" (assist);
  - a lie badge (Fairway / Rough / Sand…).
  - Minimal by default, all toggleable.
- **Shot tracer:**
  - a ribbon (camera-facing strip) along the integrated positions, coloured by curve (draw blue / fade orange) or by speed;
  - it fades over 10 s and persists into walk mode (like the reference);
  - the previous 3 shots appear as ghost tracers;
  - "hide tracer" toggle for purists.
- **Post-shot card:** club speed, ball speed, smash, launch, spin, axis tilt, carry, total, face, path, FtP, AoA, strike dot. Expandable; auto-hides.
- **Replay and fast-forward:** shots are deterministic, so a replay re-simulates from stored impact parameters, with 0.25× / 1× / 4× options.
- **Sound (original, all synthesised or CC0):**
  - swing whoosh, pitch- and gain-mapped to club-head speed;
  - an impact "click" layered by strike quality (flush is crisp and bright; thin is a metallic sting; fat is a thud plus a turf tear);
  - ball flight whistle (Doppler);
  - landing by surface (soft green thump, sand "pff", path clack, splash);
  - cup rattle;
  - ambient birds and wind tied to wind speed;
  - soft UI ticks for adjustments, rate-limited with randomised pitch (avoids the "grating" complaint);
  - separate volume sliders for Music, SFX, Ambient and UI.
- **Game feel:**
  - 2–4 frames of hit-stop on flush contact;
  - subtle camera kick;
  - a divot decal plus turf particles on iron shots;
  - a sand burst;
  - a flag wave;
  - a "flush" ring flash in the swing panel;
  - controller rumble scaled by contact quality.

---

## 8. What players love and hate, and how we respond

| Loved | Quote and source | Our response |
|---|---|---|
| Analog skill swing, no meter | "does away with the usual power meters… for a more QWOP-like tee-off" ([Kotaku](https://kotaku.com/jetpack-joyride-designers-upcoming-golf-sim-makes-compelling-case-for-miserable-controls-2000700905)); "you swing in real-time by moving the mouse, adjust the angle of the club with the keyboard also in real-time" ([Remap Radio](https://remapradio.com/articles/the-most-normal-golf-game-ever-made/)) | Core of the game (section 3). |
| Shot shapes emerge from inputs | "hooks, slices, and thin or thick contacts… NGG does it incredibly well" ([Tally Ho](https://tallyhocorner.com/2026/10/normal-golf-game-review/)) | A real D-plane plus gear effect plus lie model (section 4). |
| Hard but rewarding | "once it clicks it feels fantastic to play" ([Xbox Tavern](https://www.xboxtavern.com/normal-golf-game-review-pc/)); "the frustrating controls are actually a feature" ([WayTooManyGames](https://waytoomany.games/2026/09/21/review-normal-golf-game/)); "imprecise, but it's manageable after some trial and error" ([PC Gamer](https://www.pcgamer.com/games/sim/this-weeks-most-compelling-steam-demo-is-a-torment-engine-disguised-as-golf/)) | Keep a high ceiling; show improvement (PBs, "improved by N" toasts, per-session stats). |
| Each club feels different, good putting | "each of the clubs has a different feel to the swing… Putting feels great too" (review snippet) | Per-club arc radius, head mass, max speed and sweet-spot size. A dedicated putting stroke (short arc, reduced drift). |
| Humour, charm | "irrepressible silly side" ([Tally Ho](https://tallyhocorner.com/2026/10/normal-golf-game-review/)) | A light, original caddie/announcer layer, always skippable. No meta-captor story. |
| Challenges teach mechanics | "teaches its mechanics well" ([WayTooManyGames](https://waytoomany.games/2026/09/21/review-normal-golf-game/)) | Drills that each teach one variable. |
| Cheap and runs well | Deck Verified; flawless on Linux ([ProtonDB](https://www.protondb.com/app/3510740)) | Browser-first performance budget and quality tiers. |
| Responsive developer | Patches #1–#4 within about 8 days ([Steam hub](https://steamcommunity.com/app/3510740)) | Fast iteration, plus an in-game feedback link. |

| Hated | Quote and source | Our response |
|---|---|---|
| Golf buried under gimmicks | "annoying having to do the same swing 20 times to try and hit a billboard"; "The Challenges are lame." ([Steam thread](https://steamcommunity.com/app/3510740/discussions/0/572667123972783002/)); "50% weird golf challenges, 40% golf puzzles, and 10% playing on an actual course" ([ResetEra](https://www.resetera.com/threads/normal-golf-game-ot-its-anything-but.1639372/)) | **Golf-first:** Play Round is the default from minute one. Challenges never gate courses. |
| Randomness feels unfair or like padding | "wonkiness of the controls are just there to pad out the game" (Steam); face "angle and position also shift randomly" ([Controller Nerds](https://www.controllernerds.co.uk/reviews/pc/normal-golf-game-review/)) | Drift is visible, smooth and seeded, scaled by difficulty, and absent on Steady. A post-shot analysis explains every miss. |
| Hard to reach max speed | "something is holding back the maximum velocity of the club" (Steam) | A visible speed curve plus trail colour bands. A documented soft cap. |
| Tiny margin for contact errors | "for topped, fat, and thin the margin for error is just too small" ([Steam thread](https://steamcommunity.com/app/3510740/discussions/0/658233614222366804/)) | A tunable contact tolerance per difficulty. A low-point marker in the swing panel. |
| Controller swing awkward | "using the stick to swing is too awkward" ([Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/)); "incredibly difficult… on my Legion go" ([Metacritic](https://www.metacritic.com/game/normal-golf-game/)) | Stick swing with tuned deadzones and response curves, plus an "assisted tempo" option. Touch drag treated as first class. |
| Grindy, oddly ruled bounties | "a meandering grind"; a birdie doesn't satisfy a par bounty ([Quest Daily](https://questdaily.com.au/review/normal-golf-game-review/)) | A difficulty ladder; better results satisfy lesser goals; quick retry. |
| Camera jitter, grating sounds | Patch #2 "Smooth Out First Person Camera… missing mouse delta"; "Tweaked stance adjusting sound… too grating" ([Steam hub](https://steamcommunity.com/app/3510740)) | Pointer lock with raw deltas and smoothing. Soft, varied UI sounds with their own slider. |
| No replay, flight too slow | Replay, slow-mo and fast-forward requests ([Steam thread](https://steamcommunity.com/app/3510740/discussions/0/561409060965013167/)) | Deterministic replay at 0.25×/1×/4×, plus fast-forward. |
| Softlocks | Crash during purchase caused a softlock (patch #2); "Softlock after 2 signs" (Steam) | Atomic saves per shot. |
| Only one course, no multiplayer | Tally Ho, [Controller Nerds](https://www.controllernerds.co.uk/reviews/pc/normal-golf-game-review/) (~10 h) | 18-hole growth path, a seeded daily course and async ghosts. |
| Slow on weak PCs (grass) | Developer advice: "1080p and low grass density makes a big difference" (Steam) | A grass density slider, a resolution scale, and LOD chunks (section 10). |
| 400-stroke holes end sessions | The "428 strokes" story ([BritBrief](https://britbrief.co.uk/entertainment/gaming/normal-golf-game-review-428-strokes-per-hole.html)) | A stroke cap in casual mode; "no cap" stays optional for the masochists. |

---

## 9. KEEP vs DO NOT COPY

### KEEP: generic mechanics, re-implemented from scratch with original code and assets
- A physical mouse-drag swing (grab the hands, arc gesture, speed = power, accuracy = contact), with no power meter.
- Separate, live-adjustable inputs for **face angle, path, aim and stance/ball position**, including mid-swing corrections.
- Club drift ("wobble") as a **difficulty knob**, with a zero-drift setting. We use our own name: "Steady".
- Swing-speed feedback through trail colour.
- A first-person walkable open course; hitting from wherever the ball lies; a Tab toggle between walking and addressing.
- A persistent shot tracer; a ball-follow camera; a rangefinder.
- Optional challenge board with rewards; physics props; collectibles.
- Variable wind that shifts more slowly while the ball is in flight.
- A built-in timer and stroke counter for speedruns; a separate plain-golf mode.
- Retake/mulligan; quick club keys; full rebinding; separate mouse and gamepad sensitivity.

(Game mechanics are generally not protected by copyright. Expression is. We re-implement the ideas only.)

### DO NOT COPY
- **Name and branding:** "Normal Golf Game", "Luke Muscat's Ultimate Golf Challenge"/LMUGC, the logo, the store art, the tagline "Hit anything. Shoot from anywhere."
- **Text:** any UI strings, bounty names or descriptions (e.g. "The Big Flush", "Tiny Island", "Have you seen this ball?", "Hidden Gong", "Math Is Hard"), achievement names ("It's Meant To Be Impossible", "RIP", "To The Moon", "Complete"), the "No Wobble" label, tutorial text.
- **FMV:** no green-screened real-footage golfers or characters, no photo-real video avatar, no FMV of any real person.
- **Characters:** no in-game version of the developer or any real person. No captor/warden figure.
- **Story:** the "developer traps you, $100K in debt" premise, Luke's office, the debt counter, the endings (including the "hit the developer" ending), the meta-narrator antagonist.
- **Assets:** no models, textures, audio, music, maps, course layouts (hole-by-hole yardages and features of their 9 holes), UI layout pixel-matching, or a specific prop set that mirrors theirs (the toilet target, watermelon toss, gongs).
- **Trade dress:** do not imitate the low-poly-plus-FMV "Links" callback look. Our own art direction: stylised-realistic (PBR terrain, instanced grass, procedural trees).

---

## 10. Three.js tech recommendations

Versions are from the npm registry on 2026-11-01. API facts were verified from the unpacked tarballs where noted.

| Area | Recommendation | Version | Licence | Notes |
|---|---|---|---|---|
| Core | `three` + `@types/three` | 0.187.0 / 0.187.0 | MIT | Pin both exactly. Add `"moduleResolution": "bundler"` to tsconfig. |
| Renderer | **`WebGLRenderer`** (not WebGPU) | r187 | MIT | WebGPU headless capture is often blank, and its fallback to WebGL2 is silent. The pmndrs postprocessing and n8ao packages are WebGL-only. If WebGPU is ever tried, use `forceWebGL: true` and `await renderer.init()`. For headless CI: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, `preserveDrawingBuffer: true` in test mode, `await renderer.compileAsync()`, and a `window.__frameReady` flag. |
| Post | `postprocessing` (pmndrs) | 6.39.6 | Zlib | Peer `three >=0.168 <0.188`: **pin exactly**. Set `antialias:false` on the renderer and use SMAA. `ToneMappingEffect` (AGX) after Bloom, with `renderer.toneMapping = NoToneMapping`. Keep to 2 EffectPasses. DoF only on the ball cam. |
| AO | `n8ao` (`N8AOPostPass`) | 2.0.1 | ISC | `halfRes = true`. Comes after the RenderPass. Not WebGPU-compatible. |
| Fallback post | three's `EffectComposer` + `OutputPass` (+ `N8AOPass`) | r187 | MIT | Use if pmndrs lags a three release. |
| Grass | Custom instanced blades (`InstancedBufferGeometry`, `MeshStandardMaterial.onBeforeCompile`) | — | ours | 5–7-row blades near, 1–3 segments mid, terrain-only far. Bezier bend; world-space noise wind weighted t²; rounded normals; fake translucency; root colour from terrain. 16×16 m chunks with CPU frustum culling, height-fade at LOD boundaries. Mask-driven density (rough long, fairway short, no blades on greens). Receive shadows, don't cast. Density slider. Cap at 100–200k blades. Prior art (re-implement, don't copy): [Al-Ro](https://al-ro.github.io/projects/grass), [Codrops](https://tympanus.net/codrops/?p=83092), Ghost of Tsushima. |
| Terrain | Heightmap `PlaneGeometry` + splat (fairway/rough/sand/green) via `onBeforeCompile` | — | ours | Triplanar only on steep slopes. UDN/whiteout detail normals. IQ/hex-tile anti-tiling (about 40 lines of GLSL). Mowing stripes using `dot(viewDir, mowDir)` grain, plus a checkerboard on greens. One heightmap shared by mesh, physics and grass. |
| Raycasts | `three-mesh-bvh` | 0.9.17 | MIT | Ball lie, camera collision, grass placement. |
| Sky | `Sky` (`three/addons/objects/Sky.js`) | r187 | MIT | r187 has built-in clouds (cloudCoverage/Density/Speed…). Environment from a sky-only scene via `PMREMGenerator.fromScene`, regenerated only on sun change. Avoid `@takram/three-atmosphere` (react/geospatial peers). |
| Water | Custom `MeshPhysicalMaterial`/`ShaderMaterial` | — | ours | PMREM env Fresnel reflection, dual scrolling normals, **analytic depth from the heightmap** (`waterLevel − terrainHeight`) for shore foam and tint, so no extra pass. Optional `Reflector` at half resolution behind a quality flag. `Water.js` needs `waternormals.jpg` (MIT, from the three repo). |
| Shadows | One follow `DirectionalLight` shadow (80–120 m ortho, texel-snapped), with baked distant tree AO into the splat | r187 | MIT | Cheapest per unit of quality. `CSM` (`three/addons/csm/CSM.js`) is still shipped: 3 cascades, 2048, `csm.setupMaterial` *after* your own `onBeforeCompile`. normalBias 0.02–0.05. Check the console for the PCFSoft deprecation. |
| Trees | `@dgreenheck/ez-tree` | 1.1.0 | MIT | Peer `three >=0.167`. Textures are inlined (works offline, ~4 MB ES build). Generate 3–6 seeded variants, then instance them. Swap Phong to Standard (and re-add the wind hook). Mind the `onBeforeCompile` conflict with CSM. Billboard/octahedral impostors beyond ~150 m. CC0 alternatives: Quaternius, Kenney GLBs. |
| Instancing/LOD | `@three.ez/instanced-mesh` | 0.3.16 | MIT | Optional per-instance culling and LOD for trees and rocks. |
| Physics | `@dimforge/rapier3d-compat` | 0.21.0 | Apache-2.0 | WASM is inlined (no Vite plugin). `await RAPIER.init()`. Heightfield (column-major; verify with a raycast). Ball collider r = 0.02135 with CCD, timestep 1/120–1/240. **Ball flight, bounce and roll are our own model** (section 4). Rapier handles props, breakables, flagsticks and trees. Cup = sensor/capture logic, since heightfields cannot have holes. |
| Avoid | `three-good-godrays` (three ≤0.182), `realism-effects` (unmaintained since 2023), mixing `three` and `three/webgpu` in one bundle | — | — | — |
| Prior art | [OpenGolfSim FUSE](https://identichosting.duckdns.org/OpenGolfSim/fuse) (three+Rapier; licence unverified), [three-game-engine](https://www.npmjs.com/package/three-game-engine) (MIT) | — | — | Reference only. |

**Quality tiers** (ASSUMPTION thresholds):

| Tier | Settings |
|---|---|
| Test (SwiftShader) | pixelRatio 1, ≤30k blades, shadow 1024, AO off |
| Low | 0.75 res scale, 60k blades, no AO |
| Medium | 1.0, 150k blades, AO half-res |
| High | Adds CSM and the Reflector |

---

## 11. Assumptions list

Items not supported by the sources, chosen for our original game:

1. **W/S = ball position** forward/back in Address mode. Not sourced in the reference.
2. **A = close / D = open; Q = in-to-out / E = out-to-in** (right-handed). Directions are from a fan tip only.
3. **Q/E is a path angle.** The reference's Q/E may instead be a clubhead translation or impact point. We implement it as a path angle and use strike location for translation.
4. **Pointer lock during the swing** with a virtual hand cursor. The reference is probably not pointer-locked.
5. **Drag direction:** back/up = backswing, fast forward/down = downswing. Not stated by any reliable source.
6. **1–5 club keys default ON**, with bag order Driver, Hybrid/Wood, Iron, Wedge, Putter. The mouse wheel also cycles clubs.
7. Keys for Space (retake), RMB (rangefinder), Left Ctrl (crouch), R (reset address), F (fast-forward), T (replay), M (map), Shift (jog), Esc (pause), plus the full gamepad map. Only the features are sourced; the keys are fan-sourced or invented.
8. **Ball-position mapping:** ±1 ball-width ≈ ±1.5° AoA and ∓1.5° dynamic loft.
9. **Drift parameters:** Normal ±2° face / ±1.5° path at 0.3–1.2 Hz; Hard ±4° plus position wobble. Seeded and visible.
10. **Power model:** smoothed angular velocity over 60 ms with per-club soft saturation. Default player ≈ the amateur row; a perfect swing ≈ the Tour row.
11. **Physics constants marked [E]** (kV/kH, k_club spin fit, e by club, surface presets, lie multipliers, gear-effect parameters) are starting points and must be calibrated against section 4.4.
12. **Default green speed is stimp 10.** Cup radius 54 mm.
13. **Penalty rules:** water +1 with a drop; OOB and lost ball are stroke and distance; casual stroke cap at net double bogey or 10. The reference's rules are unsourced.
14. **Wind:** in-flight change rate ≤25% of normal; presets of 0–40 mph; a log-law profile with z0 0.01–0.03 m.
15. **Weather:** overcast, light rain (wet lies, soft greens) and dew are original additions. The reference has no sourced weather.
16. **Course:** an original par-35, 9-hole layout of about 1.2 × 0.9 km, with a path to 18 holes. Plus a seeded daily course.
17. **Progression:** full bag from the start in Round mode; cosmetic and alternate-club unlocks only; assists are always free.
18. **Quality tiers** and grass blade counts per tier.
19. **Sound** is synthesised or CC0. Hit-stop is 2–4 frames.
20. **Gamepad and touch** are first-class inputs. The exact deadzones and curves are TBD by playtest.
21. **No pages could be fetched.** All reference quotes are search snippets (section 1.3), so every "confirmed" item above inherits that limitation.
