# Plan 3: a faster best NPC, scenery off the road, one theme per track, a slow aerial fly-over

Answers `ai/prompt_3.md`. Nothing here is implemented yet. It builds on next_2.md and its follow-up: the first race on a track has two aces (`Difficulty.ACES`), one at the best NPC lap and one 5% slower.

## Where things stand (measured today)

### The best NPC

I measured these with a scratch script on the headless sim (the game's own `Race.js`). The best NPC (skill 1, full pace) drove alone in the yellow truck, 4 laps × 5 seeds per track. "No kerb friction" and "line 30% wider" are the same runs with one thing changed.

| Track | Median flying lap | Its best lap | Mean speed (top 14.6 m/s) | Time on the kerbs | No kerb friction | Line 30% wider |
|---|---|---|---|---|---|---|
| Classic | 11.25 s | 10.90 s | 10.6 | 14% | −1% | −7% |
| Indianapolis | 13.80 s | 13.75 s | 12.4 | 7% | −2% | (drives the centreline) |
| Monza | 24.57 s | 24.07 s | 11.0 | 12% | −3% | −2% |
| Monaco | 25.13 s | 24.83 s | 11.0 | 10% | −2% | +5% |
| Suzuka | 29.73 s | 27.93 s | 9.9 | 11% | −1% | +2% |
| Bathurst | 27.42 s | 26.43 s | 9.1 | 11% | 0% | −5% |

What that says:

1. **It's flat out the whole lap.** It's on full throttle at least 98% of the time on every track. `RacingLine.DRIVE` (grip 200, yaw 99) was fitted to "no corner needs braking". So the lap time comes down to how much speed the corners scrub off: the mean speed is 9.1–12.4 m/s against a top of 14.6.
2. **It's inconsistent.** The same driver's laps differ by up to 15% (Suzuka 27.8–32.0 s, Classic 10.8–12.5 s), with no respawns and no wall hits. Its own best lap is up to 6% under its median. The cause is the steering:
   - Pure pursuit aims 2.2 + 0.25·speed m ahead (5.9 m at top speed) and steers on the car's nose, not on where the car is actually going.
   - So it cuts inside its line and slides onto the kerbs on the exits. It spends 7–15% of the lap on them, although the line is meant to keep the wheels off them.
3. **The line isn't the fastest one.** It's the tightest band within ±2.0 m of the centreline.
   - A wider band is 5–7% faster on Classic and Bathurst, but 2–5% slower on Monaco and Suzuka with today's steering.
   - The walls are frictionless (`Physics.js`), so leaning on the outside wall through a corner only costs the kerb friction.
   - A human can find and use all of this; a fixed geometric rule can't.
4. **Lap 1 in traffic.** On Classic its standing-start lap is 12.8–13.5 s alone. In the first race with 4 NPCs, the aces start behind the two slower cars and took 14.1–16.7 s. Traffic costs them 1–4 s on lap 1 alone.
5. **Car mass matters little.** A kart is 0–2.5% quicker than the yellow truck, because it regains speed faster after each corner. The heavy loader was no slower than the truck on the two tracks I tried.

On Classic, the best NPC's 5 laps take about 13 + 4 × 11.25 ≈ 58 s alone and ~60 s in traffic. Beating that by 4 s means flying laps around 10.5 s, under its own best lap. That's my estimate; I don't have your times.

### Scenery

From `planScenery`, checking each item's rotated footprint (its bounding box at its placed scale) against the road:

| Track | Items | Kits mixed | Partly on the road | Over a wall |
|---|---|---|---|---|
| Classic | 4 (landmarks only) | 3 | 0 | 0 |
| Indianapolis | 73 | 5 | 0 | 3 |
| Monza | 90 | 4 | 1 (billboard, 0.8 m in) | 0 |
| Monaco | 145 | 5 | 2 (fence 1.3 m, solar panels 0.7 m) | 2 |
| Suzuka | 164 | 5 | 8 (hillside rocks and trees, up to 0.5 m) | 6 |
| Bathurst | 206 | 6 | 9 (fence 1.3 m, hillside trees and rocks up to 0.4 m) | 10 |

Why they intrude:
- **Props:** they're scattered up to 0.35 of a cell from their cell's centre and can be up to 0.92 of a cell wide. So a prop next to the road can reach 2.3 m into the road's cell, past the wall, whose outer face is at the cell's edge.
- **Hillside props:** they only check their centre point against the road.

Each track also mixes 3–6 kits, because the lap is split into zones (paddock, suburb, industrial, village, forest) and landmarks borrow across zones.

### The fly-over

Today it's 5.4 s:
- 0.9 s overview;
- 3.6 s sweeping along the whole lap 13 m above the road (76 m/s on Suzuka);
- 0.9 s down onto the chase camera.

The overview's distance is a fixed multiple of the track's size. It isn't fitted to the screen's shape.

## Decisions I've made (override any of these before implementation)

- **D1. The target for the best NPC:**
  - its median flying lap at least 8% under today's on every track;
  - its laps within 3% of each other;
  - its lap 1 in a full first-race field within 1 s of its lap 1 alone.

  Then you race it. If you tell me the BEST lap the HUD shows on the tracks you've raced (and which track you won by 4 s), I'll aim under those instead.
- **D2. Every NPC gets the new steering and the new lines,** not only the aces. Skill still decides how much of the line and grip they use, and the calibration tables are re-measured, so the field still aims at the same lap times. A better driver for everyone means less weaving and fewer kerb strikes in the pack, and one code path.
- **D3. NPCs may use the kerbs and lean on the walls** wherever the optimizer finds that faster. That's what a quick human does.
- **D4. The aces' cars stay random.** Mass is worth 0–2.5%, and every line is checked on a light and a heavy car.
- **D5. The aces keep their grid slots** behind the slower cars: getting through traffic is part of being good. If you still win the first race comfortably after this, the next lever is putting them on the front row.
- **D6. One theme per track:**

  | Track | Theme |
  |---|---|
  | Classic | forest, landmarks and boards only as today |
  | Indianapolis | stadium (grandstands round the oval) |
  | Monza | village |
  | Monaco | suburb (a town) |
  | Suzuka | industrial |
  | Bathurst | forest (the mountain) |

- **D7. Two exceptions to the single theme:**
  - The start/finish keeps a small paddock (grandstand and pits, at most 6 items), since it marks the line.
  - Hillsides keep their trees and rocks, from the theme's own kit where it has them.
- **D8. About 40% fewer scenery items per track.** The corner landmarks and the chevron and 3-2-1 boards all stay, because they're the cues for the next turn.
- **D9. Clearance:** every footprint (tree canopies included) stays at least 0.3 m outside the wall's outer face, from every part of the track.
- **D10. Fly-over:** about 8 s. It starts overhead and orbits about 150° round the track. It ends on the chase camera's side and comes down onto your car.

## Phase 1: a yardstick for the AI (`npm run sim -- --ace`)

Everything after this is judged on it, and today's numbers go into next_3.md as the "before". It reports, per track:
- **The best NPC alone:** median, best and worst flying lap; lap 1; share of the lap on the kerbs; mean speed; wand carries.
- **The first-race field** (4 and 8 NPCs, the player's slot driven by a bot): the aces' lap 1 and race time.
- **Where the slow laps lose time:** time lost cell by cell, slowest lap against best lap.
- **A wall-rider probe:** a scripted bot that leans on the outside wall through every corner. It measures what the frictionless walls are worth, as a stand-in for a quick human.

## Phase 2: steering that follows the line (all NPCs)

Replace pure pursuit, in `AIDriver.drive`:
- **Feedforward:**
  - The turn rate the line's curvature needs at the current speed (speed × curvature), read a little ahead because `Vehicle` eases the turn rate in at 4/s (~0.25 s).
  - Converted to steering input through the car's 4 rad/s limit.
- **Feedback:**
  - on the distance off the line;
  - on the angle between the line and the car's direction of travel (the sphere's velocity), which is what actually follows the line, rather than the nose.
- **Skill:** skill 1 has no steering noise. Lower skills keep their noise, lag and share of the line, so the novice still drives like one.
- **Gains:** found by a small search in the sim on lap time plus spread.

The aim is fewer kerb strikes and consistent laps, which should recover most of the gap between today's median and best laps (up to 6%). Cost per step stays a handful of multiplies (it runs for up to 8 NPCs on phones).

## Phase 3: the fastest line per track, found by the physics (`npm run sim -- --optimize`)

- **The line:** lateral offsets at control points every 3 m, smoothed between them (Classic 37 points, Suzuka 91).
  - They're bounded by the wall faces less the car's half-width, so kerbs and wall-leaning are allowed (D3).
  - Each point also gets an optional speed cap, so the line can learn to lift before a crest or on the gravel (Bathurst's cliff top).
- **The objective:** the mean of 3 flying laps over 3 seeds, for the yellow truck and a kart. On top of that, penalties on the spread between laps and on any wand carry.
- **The search:**
  - a (1+λ) evolution strategy with shrinking steps, starting from today's elastic band;
  - candidates run in parallel on this machine's 8 cores;
  - a simulated lap costs ~0.06 s of CPU on Classic and ~0.2 s on Suzuka, so about 2,000 candidates take 10–20 minutes a track.
- **The checks:**
  - seeds and cars it wasn't searched with: the loader, the Formula;
  - 8-NPC traffic;
  - Bathurst's Hump and Suzuka's crest without launching more than today.
- **The output:** `js/RaceLines.js`, generated (offsets in cm and speed caps per track), a few KB loaded with `Tracks.js`. Tracks from the editor keep the elastic band.
- **Stale lines:** `npm run tracks` warns when a track's cells no longer match the hash its line was optimized for.

## Phase 4: racecraft for the aces

- **Seeing traffic:** they notice slower cars sooner (up to 25 m, depending on how fast they're closing). They pass on the side that becomes the inside of the next corner and commit to it.
- **No lifting:** aces drive with aggression 1, so they don't back off when blocked. They lean on a slower car rather than wait behind it.
- **The start:** full throttle from GO. I'll check there's no reaction delay, and they take the gap rather than the car ahead.
- **Measured:** their lap 1 in a 4- and an 8-NPC field against their lap 1 alone (D1: within 1 s).

## Phase 5: recalibrate and rebalance

- **Calibration:** with phases 2–3 every NPC is faster at the same skill.
  - `npm run sim -- --calibrate` gives new `ai` tables in `Tracks.js` and a new `CLASSIC_AI_LAPS`.
  - The aces pick up the new best lap from the table by themselves.
  - Re-measure `PACE_CURVE` too (it's from Monaco at skill 0).
- **Balance:** `npm run sim -- --balance` on all six tracks, race 1 and race 2.
  - Race 2 is still aimed at your best lap, so it gets harder only through the better racecraft.
  - The pars stay.
- **Soak:** `npm run sim -- --soak` for stability. Then the browser race matrix on all six tracks.

## Phase 6: nothing on the road

- **The rule (D9):** in `planScenery`, every item's footprint stays 0.3 m outside the wall's outer face (3.75 m from the centreline).
  - The footprint is its rotated box from `SceneryList` at its placed scale.
  - It's measured against every part of the track, so both roads count at Suzuka's crossing.
- **Props:** scattered only within the room their cell leaves them. Anything that still doesn't fit moves inward, shrinks to no less than 80%, or is dropped.
- **Hillside props and landmarks:** the same rule, on their full footprint.
- **The check:** `npm run tracks` fails on any footprint inside the margin, naming the item and cell. Today it would list 20 on the road and 21 over a wall.
- **A new `scenery` playtest:** top-down shots of each track's corners once the scenery has loaded, for review.

## Phase 7: one theme per track, fewer things

- **Themes replace zones:** `track.scenery` (zones along the lap) becomes `track.theme` (D6). Each theme defines:
  - its buildings, props and low props (for the camera side);
  - its landmarks;
  - its ground colour;
  - its hillside props.
- **Landmarks without borrowing:** each turn needs its own landmark from the track's theme. That's 9 on Monaco, 7 on Suzuka, 5 on Monza and Bathurst, 4 on Classic and 3 on Indianapolis. Today's zones have 3–5 each and borrow from each other. The missing ones come from the kits already in `ref/`, via `npm run kits` and prefabs in `scripts/models.mjs` the way the fantasy houses are built:

  | Theme | Models in its kit | Landmarks |
  |---|---|---|
  | Forest | 22 | prefabs: a tree house (platform, ladder, roof), a camp (tents, flag), an archery range, rock stacks, a log bridge |
  | Suburb | 40 | the most distinct houses, each in its own colour variation, plus prefabs |
  | Village | 167 | windmill, watermill, tower, fountain, and more from the kit |
  | Industrial | 37 | chimneys, the large tank, the water tower, the windmill, the tallest buildings |
  | Stadium | 112 (racing kit) | covered grandstands, overhead lights, banner towers, billboards |

- **About 40% fewer items (D8):**

  | Setting | Today | Planned |
  |---|---|---|
  | Ring-1 density | 0.7–0.8 | ~0.45 |
  | Ring-2 density | 0.5–0.6 | ~0.3 |
  | Props per prop cell | 2–4 | 1–3 |
  | Props per hillside cell | 2–4 | 1–3 |

  Targets: Monaco 145 → ~85 items, Suzuka 164 → ~100, Bathurst 206 → ~120.
- **Load:** a track fetches only its theme's kit, plus the racing kit for the paddock, so there are fewer models and colormaps to download. Scenery already loads after you can interact, so time to interaction shouldn't move. I'll check it with `npm run perf:load` and compare scenery bytes per track before and after.
- **Frame cost:** fewer items and kits mean fewer draws. `npm run bench` low and medium, before and after.

## Phase 8: a slow aerial fly-over (`js/Flyover.js`)

- **No more sweep:** the sweep along the lap goes. The camera aims at the track's centre from a distance fitted to the track's bounds and the screen's shape, including portrait phones, so the whole track stays in view throughout.
- **The path:**
  - it starts high and nearly overhead (a map view, ~70° down);
  - it sweeps about 150° round the track while lowering to ~40°;
  - it ends on the chase camera's side (+x +z) and comes down onto your car.
- **The times:**
  - 1.2 s overhead, under the track's name card;
  - 5.3 s orbit;
  - 1.5 s landing.

  That's about 8 s in all, against 5.4 s today. It's eased throughout, with no cuts.
- **Unchanged:** any key or tap still skips it, and reduced motion and Race again still leave it out.
- **To check:**
  - the sun shadow still covers what's on screen (or fades out cleanly) with the whole track in view;
  - the low tier doesn't step down (the existing check).
- **Playtest `flyover`:**
  - the track's bounding corners are on screen at three moments, on a laptop and on a portrait phone;
  - the landing check as today;
  - the duration is about 8 s.

## Files

- `js/AIDriver.js`: steering (phase 2) and racecraft (phase 4).
- `js/RacingLine.js`: the optimized line and speed caps when a track has them, the elastic band otherwise.
- `js/RaceLines.js` (new, generated by `--optimize`): offsets and speed caps per track.
- `scripts/sim/race.mjs` and a new `scripts/sim/optimize-worker.mjs`: `--ace`, `--optimize`, the wall-rider probe.
- `js/Tracks.js`: new `ai` tables, `theme` instead of `scenery` zones.
- `js/Difficulty.js`: `CLASSIC_AI_LAPS`, `PACE_CURVE`.
- `js/Scenery.js`: themes, densities, clearance.
- The models:
  - `scripts/import-kits.mjs`, `scripts/models.mjs`: more landmark models and prefabs;
  - `js/SceneryList.js`: regenerated;
  - `models/<kit>/`: the new models.
- `scripts/check-tracks.mjs`: the scenery clearance check and the stale-line warning.
- `js/Flyover.js`, and `js/main.js` if the orbit needs the screen's aspect passed in.
- `scripts/playtest/scenarios.mjs`: the fly-over checks and the scenery shots.
- `README.md`, `ai/next_3.md`.

## Order and review checkpoints

1. **Phases 1–3:** the yardstick, the steering, the optimized lines. Checkpoint: the per-track numbers against D1. If the optimizer can't reach 8% somewhere, I'll say where and why.
2. **Phases 4–5:** racecraft, recalibration, balance, soak.
3. **Phase 6:** clearance. It's quick and independent, and it lands before the themes so they're built on the check.
4. **Phase 7:** themes and density, with screenshots of each track.
5. **Phase 8:** the fly-over.
6. **Wrap-up:** full playtest suite, load and bench, then next_3.md.

## What I can't verify here

- **Your driving:** I can only estimate what you lap at (see above). The real test is you racing the first race again.
- **Real phones:** the fly-over's framing on a real portrait screen, and the frame rate with the whole track in view.
- **Taste:** whether the theme picks in D6 look right to you.

## Out of scope

- Car handling: braking still never pays (next_2 finding 1). The NPCs get faster within today's physics.
- Themes in the track editor (editor tracks get the forest).
- The ferris wheel.
