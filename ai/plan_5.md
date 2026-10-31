# Plan 5: a steady fly-over, and take-offs off the ramps

Answers `ai/prompt_5.md`. Nothing here is implemented yet. It builds on next_4.md.

All measurements are from this computer (RTX 3060, headless Chrome with `--use-angle=gl-egl`), on the build in `dist/`. The probes and prototypes ran from a scratch folder or a scratch copy of the code, so the repo is unchanged.

## Where things stand (measured today)

### 1. The flicker in the fly-over

I reproduced it. I slowed the fly-over's clock 6× so the scene barely moves between frames, read back every frame, and counted pixels that change and then change back. A frame where that share jumps is a flash. Then I switched parts of the scene off to see which one causes it.

Flash frames in one whole fly-over, one run per case:

| Track | Tier | Today | Horizon off | Near plane raised | D1 + D2 together |
|---|---|---|---|---|---|
| Classic | high | 0 | – | – | 0 |
| Indianapolis | high | 1 | – | – | 0 |
| Monza | high | 2 | 0 | 0 | 0 |
| Monaco | high | 3 | 1 | 1 | 3 (all the camera snap, see b) |
| Suzuka | high | 9 | 3 | 0 | 0 |
| Bathurst | high | 15 | 0 | 2 | 0 |
| Monaco | low | 5 | – | – | 0 |
| Suzuka | low | 20 | – | – | 0 |

The worst flash touched 4% of the screen on high and 7.5% on low. The hill tracks flash most often, as you'd expect from how close their layers are.

**It's three separate things:**

**a. Ground layers flash through each other for a frame.** In the flash frames the road breaks into streaks, the pale ground pads change colour, and dark wedges smear across them. The shadow map's matrix, box and light did not change on any frame.

- **Why depth runs out:** the fly-over keeps the chase camera's near plane of 0.1 m and sets the far plane to 2000 m. From 120–210 m away, one step of the depth buffer is then 0.9–2.6 cm.
- **The layers are closer together than that:**

  | Layer | Height from the road's surface |
  |---|---|
  | Scenery pads | +5 mm |
  | Hillside | −2 cm |
  | Flat grass under the hills (hill tracks) | −4 cm |
  | Horizon plane (fly-over only) | −5 cm |

- **The horizon is the trigger.** It's a single 4 km quad, two huge triangles. It sits 1 cm under the hill tracks' flat grass, and it doesn't receive shadows, so where it pokes through, the shadows there blink. That fits what you described.
- **What I don't know:** why it's those particular frames. My guess is rounding across those two huge triangles. Both fixes below work without needing that answer.

**b. The camera's zoom snaps.** `Flyover.distance` takes the largest of the track's corners, and when the limiting corner changes the camera goes from moving in to moving out in one frame:

| Track | Camera distance | Biggest change of speed in one frame | When |
|---|---|---|---|
| Indianapolis | 79–143 m | 84 m/s | 4.58 s |
| Monza | 106–190 m | 145 m/s | 2.24 s |
| Monaco | 130–187 m | 154 m/s | 4.58 s |
| Suzuka | 122–210 m | 104 m/s | 4.32 s |
| Bathurst | 107–192 m | 145 m/s | 2.24 s |

The whole picture jolts. It shows in the probe as a one-frame shift of every edge at exactly those times, on every run.

**c. The shadows jump when the fly-over ends.** The sun's shadow box covers the whole track until the last frame, then snaps to the chase view, so every shadow sharpens at once:

| Pixels changed in one frame, clock slowed 12× | Frames just before | Hand-over frame | Frames just after |
|---|---|---|---|
| Monaco, high | 0.04–0.23% | 1.4% | 0% |
| Suzuka, high | 0.07–0.33% | 3.9% | 0% |
| Suzuka, low | 0.03–0.38% | 7.6% | 0% |

**What's left is small, and I'm not chasing it:** thin geometry shimmering at a distance, mostly Suzuka's solar panels (about 0.2% of pixels with the clock slowed 20×). Shadows add little to that: 0.21% against 0.18% with them off.

### 2. Take-offs

**Today nothing takes off.** Crests lift a car by up to 25 cm, under the 30 cm that counts as flying. The best NPC never leaves the ground in 3 laps.

**The slope alone can't do it.** Cars fall at 14.7 m/s² (`gravityFactor` 1.5). At top speed (14.7 m/s):

| Airtime on level ground | Launch needed | Height |
|---|---|---|
| 1 s | 7.4 m/s up, a 50% ramp | 1.8 m |
| 3 s | 22 m/s up, a 150% ramp | 16.5 m |
| What a 19% ramp gives | 2.8 m/s up | 0.4 s, 0.27 m |

So 1–3 s from a small take-off needs lower gravity in the air. I tested that: `gravityFactor` can be changed mid-flight, and airtime matched the target within 0.1 s on clean flights.

**The real limit is the road ahead.** With no steering, a car flies straight, 15–44 m at top speed. That's 2–6 cells, and the crests aren't placed for it:

| Crest today | Road before the next corner | Best NPC's speed there |
|---|---|---|
| Suzuka cell 32 | 11 m, then the left at cell 34 | 14 m/s |
| Bathurst cell 23 | 34 m, then the right at cell 28 | 13 m/s |

**What I found in a prototype, driven through the game's real physics:**

- **Cars land slowly unless flight holds their speed:**

  | During flight | Speed at the take-off | Lowest in the second after landing |
  |---|---|---|
  | Wheel spin and air drag held | 12.6 m/s | 11.4–12.4 m/s |
  | Spin not held | 12.6 m/s | 9.7–10 m/s |
  | Drag not held | 12.6 m/s | 9.5–9.6 m/s |
  | Neither held | 12.6 m/s | 7.6–7.9 m/s |

  The sphere's spin decays at 4/s in the air, so it lands on a stopped wheel. Drag takes 10% of the speed per second.
- **Cars don't take off straight.** Travel is 3–5° off the road's direction for the best NPCs and up to 25° for the slowest. Over 35 m, 5° is 3 m sideways, and the road's half-width is under 3 m.
- **Cars can clear the walls.** The wall colliders are 2.25 m tall and follow the road down, so a car flying 3 m above the road goes over them. In the first test that meant 4 wand trips in 4 laps for a slow NPC.
- **Raising walls everywhere breaks Suzuka.** The lower road's walls come up through the bridge deck and stop every car on it. Only the flight's own cells can be raised.
- **A ramp needs the road to drop after it.** Launching where the road still rises flies the car into the rise, up to 10 m in the air.

## Decisions I've made (override any of these before implementation)

- **D1. During the fly-over the near plane follows the camera's height:** `near = max( 0.1, 0.5 × ( camera.y − top ) )`, where `top` is the track's highest point plus 12 m for the tallest scenery. That's 40–85 m at the top of the orbit, so depth steps get hundreds of times finer, and it falls back to 0.1 as the camera lands. Nothing can be clipped, because everything stands under `top`.
- **D2. The horizon drops to 0.5 m under the road,** clear of every other layer, whatever the depth precision.
- **D3. The camera's distance gets a smooth curve.** At the start (and on resize) the orbit's distance is sampled, the peaks are kept and blurred, and the camera follows that.
  - **Tested offline on all six tracks, laptop and portrait:** the snap falls from 84–246 m/s to 2.5–9.3 m/s, and every corner stays on screen (at most 0.94 of the half-screen).
  - **The cost:** at its tightest moment the camera is up to 45% further away than today, so the track is briefly smaller. Phase 1 tightens the curve if that shows.
- **D4. The sun's shadow box shrinks over the landing.** It eases from the whole track to the chase view while the camera comes down, so nothing is left to snap. Emulated in the running game, the hand-over frame went from 1.4–7.6% of pixels to 0, with the frames before it no worse.
- **D5. A ramp is a place on the track, not something that emerges.** `track.ramps` lists the lip's cell in `js/Tracks.js`. A car crossing the lip on the road, going forward at `minSpeed` or more, takes off. Below that it rolls over as it does today.
- **D6. Airtime grows with speed, and is capped by the road ahead:**

  ```
  T = min( 3, 1 + 2 × ( speed − minSpeed ) / ( fullSpeed − minSpeed ), ( roadAhead − 5 m ) / speed )
  ```

  - `minSpeed` 9.5 m/s, `fullSpeed` about 12.5 m/s, tuned in phase 4.
  - `roadAhead` is worked out from the track: the lip to the next corner.
  - The launch is at least 3.2 m/s upward. Gravity for that flight is solved from T and the road's height at the landing spot, so the car comes down where planned.
  - The height stays small: 0.6–1.7 m above the lip in the prototype, though the road falls away below.
- **D7. The ramp sets the car straight, a little.** At the lip the car's travel turns toward the road's direction by up to 8°. Without it most flights end on a wall. It's the one thing here you didn't ask for, and it only acts at the lip, so there's still no control in the air.
- **D8. No control in any airtime, not just off a ramp.** When a car is airborne (`Vehicle`):
  - steering, brake and throttle do nothing, for keyboard, pad and touch. The touch joystick's turn is stopped too.
  - its nose stops turning and `linearSpeed` holds.
  - the sphere's spin matches its speed, so the landing doesn't scrub speed.

  This replaces today's 30% steering in the air. A flight off a ramp is locked from the lip until the car touches down. Other airtime uses the existing rule (30 cm off the ground), so small hops keep control. Drag goes to zero for a ramp's flight only.
- **D9. Two ramps, one per hill track.** Flat tracks have no ramps, and this doesn't add any.

  ```
  Cell                 28   29   30   31   32   33   34
  Suzuka today        1.1  1.9  2.8  3.5  4.0  2.6  1.6
  Suzuka new          1.3  2.6  3.9  3.5  3.0  2.1  1.4     lip: cell 30

  Cell                 20   21   22   23   24   25   26
  Bathurst today      2.8  2.2  1.0  2.2  0.8  0.3  0.1
  Bathurst new        2.2  3.4  2.4  1.6  1.0  0.5  0.2     lip: cell 21
  ```

  - **Suzuka** jumps its own crossing: the lip is on the approach to the bridge and the car lands on the far side. The bridge keeps its 3.5 m clearance.
  - **Bathurst** gets a kicker near the top of Conrod Straight, with 49 m of straight ahead.
  - Both pass `npm run tracks` as they stand in the scratch copy: steepest 17%, under the 20% limit.
- **D10. Walls are raised to 6 m only on the cells a flight crosses,** on that pass of the road. Only the collider changes, so you won't see them. A car that takes off crooked slides along it and stays on the track.
- **D11. NPCs follow the same rules.** The new `heights` change `lineHash`, so the saved racing lines for those two tracks stop applying. I re-run `--optimize` and `--calibrate` for both, and scale `par` and `ace` as in next_4.
- **D12. A landing sounds like one.** `onWallHit` passes the car's forward speed, so today every touchdown would play a 13 m/s crash. For ground contact it passes the vertical speed. The body's squash on landing already exists.
- **D13. `?tune` gets a Take-off folder:** minimum speed, full speed, launch, longest airtime, straightening. It's the quickest way to settle the feel.

## What the prototype gives with D6–D10

Five laps per skill, walls raised on the flight's cells, 8° of straightening, with spin and drag held. `fullSpeed` was 13 here. There were no wand trips at any skill on either track.

| Lip | NPC skill | Speed at the lip | Airtime | Flew | Height over the lip | Road left at landing |
|---|---|---|---|---|---|---|
| Bathurst, cell 21 | 1 | 12.5–12.7 m/s | 2.7–2.8 s | 34–36 m | 1.6–1.7 m | 13–14 m |
| | 0.75 | 12.6 m/s | 2.7–2.8 s | 34–35 m | 1.6 m | 14 m |
| | 0.5 | 10.4–12.7 m/s | 1.5–2.8 s | 15–35 m | 0.9–1.7 m | 13–33 m |
| | 0.25 | 10.1–10.4 m/s | 1.3–1.5 s | 14–16 m | 0.8–0.9 m | 33–35 m |
| | 0.1 | 9.6–10.4 m/s | 1.1–1.5 s | 10–15 m | 0.6–0.9 m | 33–39 m |
| Suzuka, cell 30 | 1 | 12.9 m/s | 1.6 s | 21 m | 1.0 m | 5 m |
| | 0.75 | 12.4–12.5 m/s | 1.7 s | 21 m | 1.0 m | 5 m |
| | 0.5 | 11.6–12.8 m/s | 1.6–1.8 s | 21 m | 1.0–1.1 m | 5 m |
| | 0.25 | 10.8–12.5 m/s | 1.7 s | 17–21 m | 1.0–1.1 m | 5–9 m |
| | 0.1 | 9.7–11.5 m/s | 1.1–1.8 s | 11–21 m | 0.8–1.1 m | 5–15 m |

- **Bathurst covers your whole 1–3 s range.**
- **Suzuka tops out near 1.8 s,** because its straight is short. See "Your calls".
- **The tight spot is Suzuka's landing:** 5 m before the left at cell 34. NPCs at skill 0.5 dropped to 5–7 m/s there, with no wand trips. If that feels cramped, a longer margin shortens the flight.
- **Lap times aren't in the table:** without the re-optimized lines they mean nothing yet.

## Phase 1: the fly-over

- **`js/main.js`, `js/Flyover.js`:** near plane (D1), set each frame with the pose and restored to 0.1 in `endFlyover`. The horizon's height (D2). The distance curve (D3).
- **`js/SunShadow.js`, `js/main.js`:** the shadow box's blend over the landing (D4).
- **New playtest `flicker`:** it plays the fly-over on all six tracks at low and high with the clock slowed, using the method above, and fails on any flash frame (over 0.4% of pixels and 3× the frames around it), or a hand-over frame changing over 1% of pixels. The slow clock wraps `requestAnimationFrame` from the test, so the game doesn't need a new switch.
- **The `flyover` playtest** keeps passing: every corner on screen, on the laptop and the portrait phone.

## Phase 2: no control in the air

- **`js/Vehicle.js`:** D8, including the touch joystick's branch, which turns the car and changes its speed in a separate path.
- **`js/AIDriver.js`:** drop the 0.3 in `reach`, since steering in the air no longer does anything.
- **`scripts/sim`:** `--ride` first, to confirm the ride on the hills hasn't moved. Today's numbers are in next_4.

## Phase 3: take-offs

- **`js/TakeOff.js` (new):** `TAKEOFF` (the knobs), `airtime()`, `launch()` and `land()`. It has no DOM, so the sim runs it.
- **`js/TrackShape.js`:** `ramps` from `track.ramps`: each lip's s, the road ahead, and the cells a flight can cross.
- **`js/Race.js`:**
  - check for a lip after `track()`, where the step's s is known.
  - land when the sphere is within 6 cm of the road and falling.
  - a guard ends any flight at T + 1.5 s.
  - a wand, a reset or `place()` ends the flight and restores gravity and drag.
  - D12.
- **`js/Physics.js`:** walls raised on the ramps' cells (D10).
- **`js/Tune.js`:** D13.
- **`js/main.js`:** `flying` and `airtime` in `__kerb.state()`.

## Phase 4: the ramps

- **`js/Tracks.js`:** the new `heights` and `ramps` (D9).
- **`npm run sim -- --air` (new):** per ramp, per skill and seed: speed in, airtime, distance, height, where it lands, sideways drift, speed after landing, wand trips.
- **Targets:**
  - airtime 1–3 s, and within 0.15 s of the plan;
  - every landing on the road, and before the corner;
  - speed one second after landing at least 90% of take-off speed, unless the car is braking for the corner;
  - no wand trips.
- **`scripts/check-tracks.mjs`:** prints each ramp's road ahead, and fails if a ramp has under 15 m or the road ahead isn't straight.

## Phase 5: the field

For Suzuka and Bathurst:

- `--optimize`, `--calibrate`, then `par` and `ace` scaled by the laps' ratio.
- `--ace`, `--balance`.
- `--soak` on all six tracks: no NaNs, no stuck cars.

`npm run sim -- --ride` again. The four flat tracks shouldn't move at all, and that gets checked.

## Phase 6: the checks

- **New playtest `takeoff`,** in the real build with real input:
  1. On Bathurst the car is placed before the ramp at speed, with W held.
  2. In the air it holds left and brake.
  3. It checks that the heading and speed didn't change, the airtime is 1–3 s, and control returns on landing.
  4. It repeats with the touch joystick, and with a slow car that must not take off.
- **Screen recordings** of both ramps, and a Bathurst lap with 8 cars, for traffic in the air.
- **Full suite:** at the automatic tier, and `flyover`, `flicker`, `tiers` and `scenery` forced to low and high.
- **`npm run perf:load` and `npm run bench`:** no new assets, and neither fix should cost anything. The spec's 2–3 s load and frame times get checked anyway.
- **`README.md`, then `ai/next_5.md`.**

## Files

- `js/Flyover.js`, `js/SunShadow.js`, `js/main.js`: phase 1, and `__kerb.state()`.
- `js/Vehicle.js`, `js/AIDriver.js`: no control in the air.
- `js/TakeOff.js` (new), `js/Race.js`, `js/TrackShape.js`, `js/Physics.js`, `js/Tune.js`: take-offs.
- `js/Tracks.js`, `js/RaceLines.js`: ramps, heights, `ai`, `par`, `ace`, the new lines.
- `scripts/sim/race.mjs`: `--air`.
- `scripts/check-tracks.mjs`: ramps.
- `scripts/playtest/scenarios.mjs`: `flicker`, `takeoff`.
- `README.md`, `ai/next_5.md`.

## Order and review checkpoints

1. **Phase 1.** Quick and independent. Checkpoint: the `flicker` numbers, then you watch a fly-over.
2. **Phases 2–3 on Bathurst's ramp.** Checkpoint: drive it, then settle the feel with `?tune`.
3. **Phase 4.** Checkpoint: the `--air` table. You can veto the new heights here, before the optimizer runs.
4. **Phases 5–6.**

## Your calls

1. **3 s on Suzuka isn't possible on this layout.** A 3 s flight needs about 44 m of straight, and the back straight has 26 m after the lip. Moving the lip back to the corner would take a 39% ramp. I've left it at about 1.8 s, with Bathurst covering the full range.
2. **"Floaty":** a 3 s flight on Bathurst falls at about 20% of the game's gravity, with a 1.8 m apex over the lip. A stronger launch looks less floaty and flies higher: 5 m/s up gives about 27% and 3.1 m. That's the launch knob in `?tune`.
3. **The straightening (D7):** set it to 0 in `?tune` if you'd rather a crooked take-off stayed crooked.
4. **The ramps have no sign.** Nothing warns you a jump is coming. A board before each is easy to add if you find you need one.

## What I can't verify here

- **That this is the flicker you saw.** I reproduced flashes that fit your description, on this computer, in headless Chrome. On another GPU the frames will differ. If some flicker remains after phase 1, tell me where on screen and on which track.
- **How often you'd see a flash at full speed.** The counts are with the clock slowed, from one run per case. They show which parts matter, not how many flashes a viewer gets.
- **D3 in the browser:** I tested its curve offline, so the Monaco row above still has its camera flashes until phase 1 is in.
- **The HD 630 and real phones:** I can only force each tier here.
- **How flight feels.** Airtime, height and landings are measured; whether it's fun is yours to judge.

## Out of scope

- Ramps on flat tracks or in the editor. The editor can't make hills.
- New ramp models. The ramp is the road itself, bent by the profile.
- Engine sound in the air: with no throttle it falls to its coasting note.
- The shimmer on thin distant geometry.
