# Controls

The defaults follow the controls of the game that inspired this one; RESEARCH.md §2 lists the evidence for each binding. All keys and gamepad buttons can be rebound under **Settings → Controls**, and bindings are saved in `localStorage`.

## Walking (first person)

| Input | Action |
|---|---|
| **W A S D** / arrows | Walk |
| **Shift** (hold) | Run |
| **Mouse** | Look. Click the game to capture the mouse. |
| **Ctrl** (hold) | Crouch, to read the green |
| **RMB** (hold) | Rangefinder: zooms in and shows distance and elevation to the point under the crosshair |
| **Tab** | Address the ball (golf stance). You must be within 3 m of your ball. |
| **F** | Go straight to your ball and address it *(improvement)* |
| **V** | Survey camera: fly with WASD, Shift to go faster, V to exit |
| **`** (backquote) | Scorecard |
| **Esc** / **P** | Pause |

## Golf stance (address)

| Input | Action |
|---|---|
| **Hold LMB + drag** | Grab the golfer's **hands** and swing. The mouse is pointer-locked while you hold the button, so the screen edge never stops your swing. |
| | Drag **up/right** for the backswing, then swiftly **down/left** through the ball. The club has weight: it lags, cocks and whips through on its own. |
| | **Speed** and **smoothness** set clubhead speed. Jerky, erratic movement causes toe/heel strikes. Hands that move too fast make the face flail. |
| | **How far out you swing** sets contact. Stay on the ring drawn in the swing panel. Reaching past it digs the club into the turf (fat). Staying inside it hits thin or topped, or misses completely. |
| **A / D** | Close / open the **clubface**. This mainly sets where the ball **starts**. Works *during* the swing. |
| **Q / E** | Swing **path**: Q = in-to-out (draw), E = out-to-in (fade). Face minus path sets the **curve**. Works *during* the swing. |
| **Z / C** | Rotate your **aim** left / right without walking |
| **W / S** | **Stance / ball position.** W = forward, for a lower, flatter punch or stinger. S = back, for a higher, scooped shot. *(Assumption: no source names the key used by the game that inspired this one.)* |
| **1–5** | Driver, Hybrid, Iron, Wedge, Putter |
| **Mouse wheel** | Cycle clubs *(improvement)* |
| **Tab** | Back to walking |
| **Space** | Retake the last shot under stroke-and-distance (+1) |
| **F** (hold, in flight) | Fast-forward the ball *(improvement)* |
| **RMB** (hold) | Rangefinder |
| **Esc** | Pause |

**Drift.** During the swing, face and path drift slightly, as in the original, so you have to keep correcting them with A/D and Q/E. The drift is smooth and drawn live in the club panel as a "ghost" face. It grows when your hands move fast.

### Shot shaping cheat sheet (right-handed)

| Want | Face (A/D) | Path (Q/E) |
|---|---|---|
| Straight | square | square |
| Draw (starts right, curves left) | slightly open of target, closed to path | Q (in-to-out) |
| Fade (starts left, curves right) | slightly closed of target, open to path | E (out-to-in) |
| Push / pull (straight right / left) | D / A | match the face |
| Low punch under trees | — | W (stance forward) |
| High soft shot | — | S (stance back) |

## Improvements

Every improvement can be switched off in **Settings**.

| Improvement | Default | Notes |
|---|---|---|
| **Shift** + A/D, Q/E, Z/C, W/S = fine adjustment | On | 20% rate. A tap moves face/path 0.5°, or 0.1° with Shift. |
| **R** = square face & path | On | |
| Mouse **sensitivity** and **smoothing** sliders, **invert X/Y** | 1.0 / 0.15 / off | Smoothing keeps the total distance moved, so it never changes power. |
| **Shot data** readout | On | Club speed, face, path, face-to-path, attack angle, dynamic loft, ball speed, smash, launch, spin, spin axis, carry, total, offline, apex |
| **Ghost swing** | On | Your previous hand path is drawn in the swing panel |
| **Practice swing** (**X**) | On | Swing without the ball to feel the tempo. Toggle it back to swing for real. |
| **Gamepad** + vibration | On | See below |
| **Remappable** keys & buttons | — | Saved in `localStorage` |
| **Assist levels** | **Off** | Off = original difficulty. Light = half drift and a wider contact ring. Full = no drift and the widest contact ring. |
| **Start-line hint** | Off | Shows the predicted start direction in the club panel |
| Minimap, timer, units (yards/metres) | On / On / Yards | |

## Gamepad (Standard mapping)

| Input | Walking | Stance |
|---|---|---|
| **Left stick** | Walk | — |
| **Right stick** | Look | **Hands / swing**: pull down for the backswing, push up through the ball. Pushing to the very edge of the stick digs in (fat). |
| **LB / RB** | — | Close / open face |
| **LT / RT** | — | Path in-to-out / out-to-in |
| **D-pad ←/→** | — | Aim |
| **D-pad ↑/↓** | — | Stance forward / back |
| **Y** | Address / walk | Walk |
| **A** (hold) | Rangefinder | Rangefinder |
| **B** | — | Next club |
| **X** | — | Retake |
| **LS click** | Run | Practice swing |
| **RS click** | — | Square face & path |
| **View / Back** | Scorecard | Scorecard |
| **Menu / Start** | Pause | Pause |

Impact rumble scales with strike quality where the browser supports `vibrationActuator`.
