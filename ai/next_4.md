# Next 4: what plan_4 delivered, what it found, what's next

All measurements were taken on this machine: NVIDIA RTX 3060, 12 cores, headless Chrome with `--use-angle=gl-egl`. next_3's numbers came from an Intel HD 630, so compare frame times only within this file. "Before" is commit bdd1889, run from a scratch copy. Nothing is committed.

## Delivered

| Prompt item | Where |
|---|---|
| **1. Suzuka and Bathurst not drawing** | The bent road no longer makes zero-area triangles (`js/Bend.js`). All 6 tracks draw at low, medium and high, with no zero normals |
| **1. The car bouncing and wiggling on hills** | The road is no longer a triangle mesh: each car rolls on its own flat tile laid under it every step (`RoadTile`, `js/Physics.js`) |
| **2. Tall trees at Suzuka** | One scale across the kits (`js/SceneryCatalog.js`), and a view rule: nothing may hide the road from the chase camera, checked exactly when the scenery is planned |
| **3. Indianapolis's stands** | One continuous run of grandstands, joined edge to edge and facing the road, down the back straight, round the turn and along the top chute |
| **4. Random placement** | The contact sheets (`npm run catalog`) and the catalog say what each model is. The planner now lays things out in sites per theme (`js/Scenery.js`) |
| **Feature: edit the scenery** | The editor's Scenery tool (key 4): select, drag, rotate, delete, place from a palette, undo and redo, on every built-in track. Your edits are saved in the browser and the link, and can be exported to the repo |

### 1. Rendering

**The cause** was what plan_4 found: `split()` left zero-area triangles when a vertex lay on a cutting plane, those got zero-length normals, the lit materials turned them into NaN pixels, and the high tier's bloom spread those over the frame.

**The fix:**
- `split()` treats a vertex within 0.1 mm of the plane as on it, and cuts through it cleanly.
- `sliver()` drops anything thinner than that, in the pieces and again in `Builder.geometry()`, judged on the positions as stored (Float32), because rounding can flatten a thin triangle.

**The new guard:** the `tiers` playtest draws every track at each tier, at the setup view and in a race. It fails on a blank frame, a zero or NaN normal, or a page error. `--tier` forces a tier for any scenario. `npm run bench` already ran high by default, so it needed no change.

### 1. The ride: the plan's diagnosis was incomplete

The plan listed three fixes to try in order. The trace showed the real cause was none of them, so the road collider was replaced outright.

**What was happening.** The sphere gets upward kicks of 2–5 m/s, even on level road up on the hill. The contact normal at each kick is tilted up to 19° backward on a road whose real normal is 5° off vertical. That's a ghost collision: the sphere catches the edge of the next strip of the ribbon. The library's internal edge removal was on, and didn't filter them out.

**What didn't work:**
- Coarser strips, and discrete collision (the plan's two experiments).
- Forcing the true normal onto those contacts made it *worse*. The sphere spins at 20 rad/s, so a contact point off its bottom sees 3–4 m/s of apparent approach even when the car isn't moving into the road.
- Discarding contacts tilted more than a threshold: median 0.8 → 0.3 m/s, 90th percentile still 1.3 m/s; at 3° it also discarded good contacts and cost 15% on the laps.

**What works.** The road's height is known exactly, so no mesh is needed. Each car gets a flat 4 × 4 m box laid under it every step, at the road's height and slope. Each car only touches its own (collision groups). That's the same clean plane the flat tracks' ground box gives. The tile's top sits 4 cm above `GROUND_Y`, where the ground box's real face is (it's as thick as its convex radius), so the flat parts of a hill track meet it with no step.

**Round a turn, the road is a helix.** Height goes by distance along the lap, and that passes faster on the inside of a turn, so at the car's offset the road climbs up to 3× the centerline's gradient. `TrackShape.roadNormal` gives the exact slope: dq/ds = t · (1 + lateral · dθ/ds). The body's tilt still follows the centerline's slope, which is smoother for a car 1.4 m long.

**Off the road's edge** there's no tile, and the terrain carries the car, as before.

| Best NPC, laps 2–3, on slopes | Suzuka before → now | Bathurst before → now |
|---|---|---|
| Height above the road, 90th percentile | 0.234 → 0.043 m | 0.250 → 0.045 m |
| Height, 99th percentile | 0.410 → 0.115 m | 0.551 → 0.144 m |
| Vertical speed off the road's, median | 0.84 → 0.01 m/s | 0.76 → 0.01 m/s |
| Vertical speed off the road's, 90th percentile | 2.13 → 0.51 m/s | 2.14 → 0.51 m/s |
| Kicks over 0.5 m/s in a step, per second | 5.6 → 0.7 | 5.9 → 0.7 |
| Sideways jolts over 0.3 m/s in a step, per second | 5.1 → 1.2 | 5.5 → 3.8 |
| Hops over 10 cm, two laps | 64 → 8 | 62 → 6 |
| Highest hop | 0.44 → 0.14 m | 0.60 → 0.16 m |

- **D2:** the median target (≤ 0.05 m/s) is met by a long way. The 90th percentile target (≤ 0.2 m/s) is missed: 0.31–0.51 m/s. That number comes from the crests and dips, where the car really does go light. On the height measure the car stays within 5 cm of the road 90% of the time.
- **The remaining hops** sit at the same crests every lap, and are real ones.
- **The wiggle.** Heading noise was never raised on the hills, before or after, so that measure doesn't catch what you felt. Sideways jolts do: when a spinning sphere lands, friction jerks it in the direction it's spinning. Those fell by 30–75% on analog steering. On keyboard steering they're at 3.2–3.7 a second against Monza's 3.5. I didn't change `Vehicle`'s orientation, because there's nothing left to attribute to it. **This is the number to test by driving**: if you still feel a wiggle, it's something the probe doesn't see.
- **Launches are gone** at normal speed: 0 a lap on both tracks, against 1.44 and 2.4 in next_3. Most were kicks, not crests. A car flat out at a sharp crest still goes light, by up to 25 cm.

**Lap times moved far more than D2's 2%**, because cars stopped losing speed to the hops:

| | Suzuka | Bathurst |
|---|---|---|
| Best NPC, on the old line | 24.15 → 21.7 s | 22.65 → 19.7 s |
| Re-optimized line (`--optimize`) | 19.93 s | 18.03 s |
| Lap spread, best NPC | 5.4% → 1.6% | 2.0% → 0.3% |
| `par` | 40.2 → 36.2 | 33.6 → 30.2 |
| `ace` | 26.7 → 24.0 | 24.5 → 22.0 |

`par` and `ace` were scaled by the laps' ratio (about 0.9), not measured from a person. `ai` is from `--calibrate`.

### 2–4. Scenery

**The catalog** (`js/SceneryCatalog.js`) gives all 96 models a role, a height in metres and a front. From the contact sheets:
- every model with a front has it on +z (seats, doors, shop fronts), so the wrong-way stands were the planner's fault;
- the Racing Kit's trees come down from up to 11 m to 4–5.5 m, the fantasy trees to 5–6 m, and the suburban ones up to 3.4–4.5 m.

**The view rule** (`hidesRoad`): the chase camera always looks along one line, so from every metre of road, at three points across it, the sight line must miss every item's box, at the height of a car's roof, out to the farthest phone camera. An item that fails doesn't get placed. Trees shrink to 60% first.

**The planner** builds from four things: `row` (pieces along the road, fronts to it, edge to edge even round a corner), `group` (a prefab layout), `clump`, and exact facing. Planning takes 6–15 ms a track.

| Theme | Sites |
|---|---|
| Stadium | the grand run, the pit row, the control tower at the line, barriers and low boards on the camera's side, banner towers at the run's ends, light posts, the fan zone, infield trees |
| Industrial | yards (a shed with stacked containers and a tank), containers end to end on the camera's side, solar farms in a grid |
| Village | terraces facing the road, hedges and lanterns on the camera's side, a market round a square, an orchard in rows |
| Suburb | a row of houses with planters at the front, a fence along the back and trees in the gardens |
| Forest | clumps of 3–7 trees with rocks and plants under them, a fence along the road |

**Item counts:**

| Track | next_3 | Now |
|---|---|---|
| Classic | 4 | 4 |
| Indianapolis | 49 | 57 (+16%) |
| Monza | 59 | 68 (+15%) |
| Monaco | 81 | 81 |
| Suzuka | 106 | 121 (+14%) |
| Bathurst | 120 | 116 |

`npm run tracks` now also fails on anything that hides the road, and on a stand or pit more than 15° off facing the road.

### Editor

- **The Scenery tool** shows the track's scenery from the game's own planner and models, one model per item. They load when the tool first opens.
- **Controls:** click to select, drag to move, Q / E 15°, with Shift 90°, ⟲ ⟳ on touch, Delete or Remove, Ctrl+Z / Ctrl+Shift+Z, Esc. Pick from the palette to place, with your theme's kit first.
- **The marker:** orange where an item would hide the road (it still goes down), red on the road (refused, and a dragged item goes back).
- **Every built-in track** gets "Edit this track". Suzuka and Bathurst open with the road locked and their bent road drawn by the game's `Bend.js`.
- **A scenery-only edit stays the same track:** `?track=indianapolis&scenery=…` keeps its laps, NPCs and records. Editing the road makes a custom track, as before.
- **Layouts:** 8 bytes an item, about 1.3 KB of link at 120 items. The game re-checks clearance on load and drops anything on the road.
- **Export:** "Copy layout" gives `{ "scenery": "…" }`. Saved as `js/layouts/<track>.json`, it becomes that track's scenery for everyone.
- **Custom tracks** get a theme picker, carried in the link as `&theme=`.

## Changes from the plan

1. **The ride fix is a different one.** The plan's three steps (a coarser collider, the drive axis, road-following) were aimed at the wrong cause. See above. `Vehicle`'s orientation wasn't touched either.
2. **The optimizer and calibration ran,** as D2 allowed: laps moved 10%.
3. **Grandstands stay 5.5 m wide,** not one cell (7.5 m) as D4 said. A row joins up at any width, and 7.5 m would have made them 30% bigger.
4. **Layouts are 8 bytes an item,** not 7: a stacked container needs its height off the ground. The angle is to 1.5°, so that 15° and 90° are exact.
5. **The control tower** is 11 m, not 17, and stands at the road's edge in the pit row. Further back in the infield, the view rule rejects it because it would hide the far straight.
6. **No light posts every second cell along the straights:** on the oval every such spot hides road. They stand behind the pits.
7. **The hill tracks' hillsides stay scattered** (1–3 items a cell) rather than in composed sites. Sites need flat ground.
8. **The palette is text,** without thumbnails.

## Measurements

### Calibration (`--calibrate`), NPC lap at skill 0 / 0.25 / 0.5 / 0.75 / 1 (s)

| Track | Now | Before |
|---|---|---|
| Suzuka | 41.58 / 34.13 / 28.88 / 22.15 / 19.93 | 41.45 / 34.45 / 27.8 / 25.2 / 24.15 |
| Bathurst | 40.45 / 32.63 / 25.47 / 20.15 / 18.03 | 41.62 / 30.88 / 24.58 / 22.75 / 22.65 |

### Balance (`--balance`, 4 NPCs, 6 seeds × 2 races): mean finishing position, race 1 / race 2

| Stand-in | Suzuka | Bathurst |
|---|---|---|
| 1.10 × par | 3.0 / 1.7 | 3.2 / 2.2 |
| 0.91 × par | 3.0 / 2.3 | 3.0 / 3.3 |
| 0.80 × par | 3.0 / 3.7 | 2.7 / 3.8 |
| 0.75 × par | 2.5 / 3.8 | 2.2 / 3.5 |

Race 2's inversion (faster stand-ins placing no better) is the one next_3 listed.

### The aces (`--ace`), first race, lap 1 against the same driver alone

| Track | 4 NPCs: ace / second ace | 8 NPCs: ace / second ace |
|---|---|---|
| Suzuka | −0.7 / +0.3 s | +0.6 / −0.3 s |
| Bathurst | −1.1 / +0.4 s | +1.0 / +2.3 s |

### Soak (`--soak --laps 8 --seeds 2`: 9 NPCs × 8 laps × 6 tracks × 2 seeds)

No NaNs or crashes, and all 108 cars finished. 40 wand carries.

### Load time and GPU cost

**Load** (`npm run perf:load`, cold, 3 runs), time to interactive:

| Track | Average | Average + 4× CPU | Slow | Slow + 4× CPU |
|---|---|---|---|---|
| Indianapolis | 0.58 s | 1.03 s | 0.86 s | 1.42 s |
| Suzuka | 0.86 s | 2.01 s | 1.10 s | 2.18 s |
| Bathurst | 0.82 s | 1.92 s | 1.08 s | 2.25 s |

All within the spec's 2–3 s. The longest task on Suzuka and Bathurst at 4× CPU is 1.1–1.2 s: that's the bent road and the terrain, as before.

**GPU** (`npm run bench -- --tiers low,high --npcs 8`), ms a frame, before → now, at 1920×1080:

| Track | low | high |
|---|---|---|
| Suzuka | 2.1 → 1.6 | 5.0 → 4.6 |
| Bathurst | 3.0 → 3.2 | 5.0 → 4.9 |

No change beyond noise. (Before, "high" on these two drew a blank frame.)

### Playtests

On the final build:

- **Pass:** `tiers`, `scenery`, `editor-scenery` (13 checks), `flyover`, `custom-tracks`, `cliff`, `kerbs`, `tracks` (5 tracks), `race` (Suzuka and Bathurst), `laptop-keyboard`, `phone-portrait-touch`, `phone-landscape-pads`, `race-flow`, `podium`, `rotate-mid-race`, `pause-resume`, `zoom-lock`, `offline-file`.
- **Forced to low and to high:** `flyover`, `scenery` and `editor-scenery` pass.
- **`framerate` is flaky, and was before this work.** It failed on one run of the suite: 30 fps differed from 60 by 10%. It runs on Classic, which this work doesn't touch. On the same server, five runs each: the old build failed 4 of 5 at 30 fps and 1 of 5 at 120 Hz; the final build failed none. The speeds it samples shift a little from run to run, and the 3% limit sits inside that.
- **Not run:** `desktop-keyboard`, `phone-portrait-pads`, `phone-landscape-touch`. They use the same inputs as the ones above, on Classic.

## Your calls

1. **Drive Bathurst's mountain.** The ride numbers are good, but the test is your hands. If it still wiggles, tell me where, and whether it's steering or the body.
2. **Crests:** the launches went with the bug. If you miss them, I can make some crests sharper. Suzuka's and Bathurst's profiles are in `js/Tracks.js`.
3. **Indianapolis:** D6's layout puts the main stands on the back straight. The front straight stays low because it's on the camera's side.
4. **First races on the hill tracks:** `par` and `ace` were scaled, not measured. Races are also 10% shorter now: about 50 s on Suzuka and 45 s on Bathurst. If that's too short, each could go up to 3 laps.

## Not done / known issues

1. **The HD 630 and real phones:** I could only force each tier here, on the RTX 3060.
2. **What you saw on this computer** was reproduced as a blank screen. If it was something else, that's a second bug.
3. **Editor:** no thumbnails in the palette, no resizing, and no ground pads drawn under items. An item placed by hand gets the ground pad its role suggests, when the game draws it.
4. **Old custom layouts:** if you edit a track's road after editing its scenery, items now on the road are flagged red in the editor and dropped by the game.
5. **Terrain still uses a triangle mesh.** Off the road's edge a car can still get ghost kicks there, but it's off the track by then.
6. **`Tile` bits:** collision groups give a road tile to at most 30 cars. The field is 9.

## Next

1. **Drive the hill tracks,** on this computer and the other one.
2. **Review the stills:** `npm run playtest -- --scenario scenery`, then Indianapolis first.
3. **Thumbnails in the palette,** if you use it a lot.
4. **Ghost kicks on the terrain,** if a car on Bathurst's gravel run-off feels rough.
