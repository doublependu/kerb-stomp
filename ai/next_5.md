# Next 5: what plan_5 delivered, what it found, what's next

All measurements were taken on this machine: NVIDIA RTX 3060, 12 cores, headless Chrome with `--use-angle=gl-egl`. "Before" is commit 8cb6c7a or next_4's numbers, as marked. Nothing is committed.

## Delivered

| Prompt item | Where |
|---|---|
| **1. Flicker in the fly-over** | Three causes found and fixed: ground layers flashing through each other, the camera's zoom snapping, and the shadows jumping at the hand-over (`js/Flyover.js`, `js/SunShadow.js`, `js/main.js`) |
| **2. A small take-off at the end of a ramp, 1–3 s of airtime with enough speed** | One ramp each on Suzuka and Bathurst (`js/TakeOff.js`, `js/Tracks.js`) |
| **2. No steering, braking or accelerating in the air** | `js/Vehicle.js`, on any airtime over 30 cm, on keys, pads and touch |

### 1. The flicker

**The cause wasn't the shadow map.** Plan_5 has the full diagnosis. In short:

| Cause | Fix |
|---|---|
| **Ground layers.** The fly-over kept the chase camera's 0.1 m near plane with a 2000 m far plane, so a depth step was 1–3 cm from up there. The ground's layers lie 5 mm to 5 cm apart, and the 4 km horizon quad flashed through them. It takes no shadows, so shadows blinked where it did. | The near plane follows the camera's height (40–85 m at the top of the orbit, back to 0.1 m by the landing). The horizon sits 0.5 m under the road. |
| **The zoom.** Fitting the track exactly snapped the camera from moving in to moving out in one frame, up to 154 m/s on a laptop and 246 m/s on a portrait phone. | The orbit's distance is sampled, its peaks kept and blurred. Tested offline, under 10 m/s. |
| **The hand-over.** The shadow box covered the whole track until the last frame, then snapped to the chase view. | It eases down over the landing. |

| Flash frames in a fly-over, high tier | Classic | Indianapolis | Monza | Monaco | Suzuka | Bathurst |
|---|---|---|---|---|---|---|
| Before | 0 | 1 | 2 | 3 | 9 | 15 |
| Now | 0 | 0 | 0 | 0 | 0 | 0 |

| Pixels the hand-over frame changes | Monaco high | Suzuka high | Suzuka low |
|---|---|---|---|
| Before | 1.4% | 3.9% | 7.6% |
| Now | 0.00% | 0.03% | 0.35% |

- **On low,** Monaco went from 5 flashes to 0 and Suzuka from 20 to 0. All six tracks are at 0 on low, and every hand-over is under 0.5%.
- **The cost:** at the moment the camera used to come closest, it's now up to 45% further away, so the track is briefly smaller on screen. The `flyover` test confirms every corner stays in view on the laptop and the portrait phone.
- **The new guard:** the `flicker` playtest plays the fly-over 6× slowed on all six tracks at low and high, on a fixed clock step. It fails on a flash frame or a hand-over over 1%. It takes 10 minutes.

### 2. Take-offs

**A ramp alone can't do it.** A second in the air takes a 50% slope at top speed, and 3 s would go 16 m high. So a ramp gives a small launch and the car its own low gravity for that flight, worked out to land on the road at the planned moment. Everything else is real physics: walls and cars still get in the way.

```
T = min( 3, 1 + 2 × ( speed − 9.5 ) / ( 12.5 − 9.5 ), ( road to the corner − 5 m ) / speed )
```

- **Under 9.5 m/s** the car rolls over the lip as it does on any crest.
- **The launch** is 3.2 m/s up, at least.
- **The flight keeps the car's speed:** no air drag, and the wheel spin is held to match. Without those, a car landed at 7.6–7.9 m/s from 12.6.
- **The lip straightens the car's travel** toward the road by up to 8°. Without that, most flights ended on a wall.
- **Walls are 6 m tall on the flight's cells only.** It's the collider, so you can't see it. Raising them everywhere pushed the lower road's walls through Suzuka's bridge.

**The ramps moved**, because the old crests weren't usable. Suzuka's had 11 m of road before a corner, and Bathurst's a dip right before it.

```
Cell                 28   29   30   31   32   33   34
Suzuka before       1.1  1.9  2.8  3.5  4.0  2.6  1.6
Suzuka now          1.3  2.6  3.9  3.5  3.0  2.1  1.4     lip: cell 30, 26 m to the corner

Cell                 20   21   22   23   24   25   26
Bathurst before     2.8  2.2  1.0  2.2  0.8  0.3  0.1
Bathurst now        2.2  3.4  2.4  1.6  1.0  0.5  0.2     lip: cell 21, 49 m to the corner
```

Suzuka now jumps its own crossing. The bridge keeps its 3.5 m clearance.

**Flights** (`npm run sim -- --air`: yellow truck, 3 seeds × 4 laps):

| Ramp | NPC skill | Speed at the lip | Airtime | Flew | Over the lip | Road left | Drift |
|---|---|---|---|---|---|---|---|
| Bathurst | 1 | 12.5–12.8 m/s | 2.95–2.98 s | 37–38 m | 1.8 m | 10–12 m | 0–1.0 m |
| | 0.75 | 12.3–13.0 m/s | 2.88–3.00 s | 36–38 m | 1.7–1.8 m | 10–13 m | 0–2.6 m |
| | 0.5 | 12.0–12.9 m/s | 2.68–3.03 s | 31–38 m | 1.6–1.9 m | 10–18 m | 0.5–3.2 m |
| | 0.25 | 9.6–12.5 m/s | 1.05–2.97 s | 10–37 m | 0.6–1.8 m | 11–38 m | 0–2.2 m |
| | 0.1 | 9.6–10.5 m/s | 1.07–1.68 s | 10–18 m | 0.6–1.0 m | 31–38 m | 0 m |
| Suzuka | 1 | 12.5–12.6 m/s | 1.67 s | 21 m | 1.0 m | 5 m | 0 m |
| | 0.75 | 12.8–13.1 m/s | 1.60–1.75 s | 21–23 m | 1.0 m | 3–5 m | 0 m |
| | 0.5 | 11.7–13.1 m/s | 1.62–1.80 s | 21–23 m | 1.0–1.1 m | 3–5 m | 0 m |
| | 0.25 | 11.2–11.3 m/s | 1.85–1.87 s | 21 m | 1.2 m | 5 m | 1.9–2.5 m |
| | 0.1 | 9.9–10.9 m/s | 1.23–1.92 s | 12–21 m | 0.8–1.2 m | 5–14 m | 0–2.5 m |

- **Airtime stayed within 0.14 s of plan** on every flight.
- **Speed a quarter of a second after landing** was 88–114% of take-off speed: 88% was the lowest, and most were over 100% as the car picks up again.
- **At skill 0.1 on Bathurst,** 6 of 11 cars crossed under 9.5 m/s and rolled over, as they should.
- **Suzuka tops out near 2 s,** and it's the slower cars that get the longest flights, because the straight is what limits it. A faster car would run out of road.

**In the real game** (`takeoff`, real keyboard and touch input):

| | Keys | Touch joystick |
|---|---|---|
| Airtime | 2.98 s from 12.7 m/s | 2.98 s from 12.6 m/s |
| Nose turned in the air, input held | 0.000 rad | 0.000 rad |
| Speed lost in the air, brake held | 0.00 m/s | 0.00 m/s |
| Control back on landing | turned 0.45 rad, 12.7 → 9.1 m/s | turned 1.17 rad |

A car at 7 m/s rolls over the lip. Pads go through the same `Vehicle` path as keys.

**Also:**
- A ground contact now sounds by how hard the car came down, not its forward speed. A landing would otherwise have played a 13 m/s crash.
- `?tune` has a Take-off folder: least speed, full-flight speed, launch, longest flight, straightening.
- `npm run tracks` prints each ramp's road ahead, and fails on under 15 m or a lip the road rises past.

## Changes from the plan

1. **The `flicker` test runs on a fixed clock step,** not real time. On real time a busy computer showed flashes that weren't there.
2. **The optimizer ran 800 candidates a track,** not the default 2000. The layout is unchanged, so `--optimize` now starts from a saved line for the same layout, even if the heights changed. Both tracks had flattened out by then.
3. **Suzuka reaches about 2 s,** not the plan's 1.8, for the reason above.
4. **`--air` reports speed ¼ s after landing,** not 1 s. A second later the car is already braking for the corner.
5. **Not recorded:** the plan's videos of Suzuka's ramp and an 8-car Bathurst lap. `takeoff-keys.webm` and `takeoff-touch.webm` show Bathurst's ramp. Traffic in the air was covered by the sims and by real races with 4 NPCs.

## Measurements

### Calibration (`--calibrate`), NPC lap at skill 0 / 0.25 / 0.5 / 0.75 / 1 (s)

| Track | Now | Before |
|---|---|---|
| Suzuka | 37.97 / 32.83 / 25.37 / 21.18 / 20.08 | 41.58 / 34.13 / 28.88 / 22.15 / 19.93 |
| Bathurst | 34.33 / 25.90 / 21.48 / 19.02 / 17.60 | 40.45 / 32.63 / 25.47 / 20.15 / 18.03 |

Mid-field NPCs got a lot faster, most of all on Bathurst (skill 0.25 by 21%), with the sharp dip and hump gone from Conrod Straight and the lines re-optimized. I didn't separate how much is each.

| | Suzuka | Bathurst |
|---|---|---|
| `par` | 36.2 → 36.5 | 30.2 → 29.5 |
| `ace` | 24 → 24.2 | 22 → 21.5 |

These were scaled by the best lap's ratio, not measured from a person. An average keyboard bot lapped 39.1–39.9 s on Suzuka and 30.7–31.1 s on Bathurst.

The four flat tracks don't move: Monza and Indianapolis calibrate identically to commit 8cb6c7a. Monza's `ai` table already differed from a fresh calibration by 0.05–0.1 s at two skills, and I left it.

### Balance (`--balance`, 4 NPCs, 6 seeds × 2 races): mean finishing position, race 1 / race 2

| Stand-in | Suzuka | Bathurst |
|---|---|---|
| 1.10 × par | 3.0 / 1.0 | 3.2 / 1.3 |
| 0.91 × par | 3.0 / 2.2 | 3.0 / 1.7 |
| 0.80 × par | 3.0 / 3.2 | 2.7 / 2.0 |
| 0.75 × par | 3.0 / 3.8 | 2.0 / 3.2 |

### The aces (`--ace`), first race, lap 1 against the same driver alone

| Track | 4 NPCs: ace / second ace | 8 NPCs: ace / second ace |
|---|---|---|
| Suzuka | +1.0 / +0.4 s | +2.7 / +1.2 s |
| Bathurst | +0.6 / −0.6 s | +2.0 / +0.4 s |

### Soak and traffic

- **Soak** (`--soak --laps 8 --seeds 2`: 9 NPCs × 8 laps × 6 tracks × 2 seeds): no NaNs, all 108 cars finished. 30 wand carries, down from 40 at 8cb6c7a.
- **A full field** (9 NPCs × 8 laps × 4 seeds): 747 flights, with no wand trip from a ramp's own cells.

| Wand trips by where the car last was on the road | Now | Before |
|---|---|---|
| Bathurst, gravel | 36 | 58 |
| Bathurst, elsewhere | 4 | 3 |
| Suzuka | 4 (cells 3, 25, 25, 29) | 0 |

Suzuka's four are new, and small. Cell 29 is the climb to the ramp, so that's the one to watch.

### The ride (`--ride`)

Flat stretches are unchanged: 4 cm over the road with vertical speed under 0.02 m/s. Median height on slopes is 3 cm and median speed off the road's 0.02–0.09 m/s. The 90th percentiles on slopes are no longer comparable with next_4: they're now the flights.

### Load time and GPU cost

**Load** (`npm run perf:load`, cold, 3 runs), time to interactive, all within the spec:

| Track | Average | Average + 4× CPU | Slow | Slow + 4× CPU |
|---|---|---|---|---|
| Monza | 0.52 s | 0.74 s | 0.83 s | 1.08 s |
| Suzuka | 0.61 s | 1.17 s | 0.93 s | 1.56 s |
| Bathurst | 0.74 s | 1.33 s | 0.92 s | 1.53 s |

**GPU** (`npm run bench -- --tiers low,high --npcs 8`), ms a frame at 1920×1080, next_4 → now:

| Track | low | high |
|---|---|---|
| Suzuka | 1.6 → 1.0 | 4.6 → 4.5 |
| Bathurst | 3.2 → 1.6 | 4.9 → 4.0 |

No new cost. I'd treat the falls as noise: nothing here should make a frame cheaper.

### Playtests

On the final build:

- **The whole suite passes,** all 24 scenarios, at the automatic tier. `framerate` passed this time, and it's still the flaky one from next_4.
- **Forced to low and to high:** `flyover` and `scenery` pass. `tiers` and `flicker` do both themselves.
- **`race` on Suzuka and Bathurst,** 2 races each with 4 NPCs and a keyboard bot: finished, never stuck.

## Your calls

1. **Drive both ramps.** The numbers are good, but the test is your hands: `?tune` is there for the feel.
2. **"Floaty":** Bathurst's 3 s flight falls at about 20% of the game's gravity. More launch looks less floaty and flies higher.
3. **Suzuka's landing is tight:** 3–5 m before the left at cell 34. Nothing went off, but NPCs slow hard there. A bigger `margin` in `TAKEOFF` shortens the flight.
4. **Suzuka can't reach 3 s:** a 3 s flight needs about 44 m of straight, and it has 26 m.
5. **The straightening:** set it to 0 in `?tune` if you'd rather a crooked take-off stayed crooked.
6. **The camera** stands further back at times. If the track looks too small mid-orbit, `CURVE_SPAN` in `js/Flyover.js` trades that against the zoom's smoothness.
7. **`par` and `ace`** are scaled, not measured. Mid-field NPCs are also quicker now, so tell me if the field feels harder on those two tracks.

## Not done / known issues

1. **One unexplained frame.** A `flicker` run on Bathurst at high reported 100% of pixels changing at 1.28 s. It was on the test's old clock with other work running, and I never saw the frame. It didn't come back in 4 later runs on the fixed clock, so I suspect the test, but that's not proven. If you see a full-screen blink at the start of the orbit, tell me.
2. **Your flicker:** I fixed what I could reproduce here. If some remains, tell me where on screen and on which track.
3. **The HD 630 and real phones:** I could only force each tier here, on the RTX 3060.
4. **Engine note:** with no throttle in the air, it falls to its coast note.
5. **No sign before a ramp.** Nothing warns you a jump is coming.
6. **Shimmer on thin distant geometry,** mostly Suzuka's solar panels, stays: about 0.2% of pixels with the clock slowed 20×.
7. **The test's "average bot"** isn't you: `par` on those two tracks is the first thing I'd re-measure from your own laps.

## Next

1. **Drive the ramps and watch a fly-over,** on this computer and the other one.
2. **Settle the feel,** then I'll put your `?tune` values into `TAKEOFF`.
3. **Set `par` and `ace` from your laps** on Suzuka and Bathurst.
4. **A board before each ramp,** and an engine note for the air, if you want them.
