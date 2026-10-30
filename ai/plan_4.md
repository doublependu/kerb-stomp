# Plan 4: hill tracks that draw on every GPU and ride smoothly, scenery that leaves the road in view, assets placed with sense, scenery in the editor

Answers `ai/prompt_4.md`. Nothing here is implemented yet. It builds on next_3.md.

This computer has an NVIDIA RTX 3060 and 12 cores. All of next_3's numbers came from an Intel HD 630, so they're not directly comparable with anything measured here.

## Where things stand (measured today)

### 1. Suzuka and Bathurst don't draw on this computer

I reproduced it in headless Chrome on the RTX 3060 (`?quality=` forces a tier):

| Tier | Picked automatically for | Monza | Suzuka | Bathurst |
|---|---|---|---|---|
| low | Intel HD/UHD, older phones | draws | draws | draws |
| medium | Iris, AMD integrated, newer phones | – | draws | – |
| high | NVIDIA, Radeon RX, Apple M | draws | **blank: only the background colour** | **blank** |

**The cause** is the bent road (`js/Bend.js`, used only on the hill tracks). Slicing the kit pieces so they can bend leaves zero-area slivers, and `computeVertexNormals` gives those zero-length normals:

| Track | Vertices with a zero normal |
|---|---|
| Suzuka | 4,671 in the road chunks, 1,080 in the bridge (about 4% of the road's vertices) |
| Bathurst | 5,550 in the road chunks (4%) |
| Monza (flat tiles) | 0 |

Here's how that blanks the frame:
- On the medium and high tiers, the shader normalises a zero vector, which gives NaN pixels.
- Only high has bloom, which renders into a HalfFloat buffer. Its blur spreads the NaNs over the whole screen.
- With bloom off, Suzuka draws on high. With the light probes off, it stays blank, so the probes aren't the cause.

On low (Lambert, no bloom) the bad pixels don't show, which fits the computer where it draws. On the HD 630, the playtests ran at its automatic tier (low) and the benchmark at low and medium. Medium has the NaN pixels but no bloom to spread them, so nothing has ever drawn a hill track on high.

### 2. The car bounces on slopes

I drove the best NPC (yellow truck, laps 2–3) in the headless sim. Launches and the second after each landing are left out. "Off the road's" is the sphere's vertical speed minus what the road's slope gives at its speed along the road.

| | Monza (flat) | Suzuka | Bathurst |
|---|---|---|---|
| Vertical speed on flat road, rms | 0.000 m/s | 0.012 m/s | 0.000 m/s |
| On slopes: median off the road's | – | 0.22 m/s | 0.34 m/s |
| On slopes: 90th percentile | – | 1.65 m/s | 1.72 m/s |
| Upward kicks over 0.15 m/s, per second | – | 3.0 | 3.2 |
| Share off by > 0.3 m/s at gradient < 2% / 2–8% / > 8% | – | 17 / 78 / 77% | 13 / 79 / 74% |

- **It goes with the slope, not where the car is.** Straights (42–49%) bounce about as much as corners (55–56%). The centre of the road bounces as much as near the kerbs, and it isn't the walls.
- **Two quick experiments on a scratch copy:**
  - The road collider in 2 m strips instead of 0.5 m: the median falls to 0.00 / 0.13 m/s, but the 90th percentile stays at 1.7–1.8 m/s and the kicks at 2.4–2.8 a second. So the triangle mesh is part of it, not all of it.
  - Discrete collision instead of swept: no better (2.7 / 3.4 kicks a second).
- **The flat parts of the hill tracks are fine.** There the road ribbon lies exactly on the flat ground box, which carries the car.

**The wiggle** I haven't caught in a number yet. The NPC's heading is no noisier on the hills than on Monza (yaw acceleration 6–7 against 8.5 rad/s²). On slopes, its body sits about 1° (rms) off the slope's tilt; on flat road it's 0°. My guess is that the wiggle comes from the bounce:
- each hop changes the grip under the sphere;
- a hop over 0.3 m cuts steering to 30% and stops the drive;
- the body's tilt target switches between the slope and the flight path.

Phase 2 measures it with keyboard-style steering, which is how you drive.

### 3. The tall trees at Suzuka

- **Most of Suzuka's scenery is these trees.** The industrial kit has no trees, so its hillsides use the Racing Kit's. That's 64 of Suzuka's 106 items: 44 `treeLarge` and 20 `treeSmall`.
- **They're scaled for grandstands.** They get the Racing Kit's scale, 5.5 m per kit unit, which suits a grandstand. That makes `treeLarge` 6.6–10.8 m tall (`treeSmall` 4.7–7.6 m), against 4.4–5.9 m for the forest kit's trees. The big ones are taller than most of the factories.
- **They aren't kept off the camera's side.** Rings 1–2 round the road only get low props on the chase camera's side (+x +z), but hillsides have no such rule. The trees also stand on the hill, up to 4 m above the road.
- **What it takes to hide the car.** The camera looks down at 35° from 13 m away, so the sight line rises 0.7 m for every metre toward the camera. Anything on that side taller than about 0.8 + 0.7 × its distance hides the car. On Suzuka's start line, one of these trees fills the right third of the screen.
- **Smaller cases elsewhere:** a tall post in front of the start on Monza and on Bathurst.

### 4. Indianapolis, and placement in general

**How the planner places things today:**
- Each cell round the track is kept or not by a hash at the theme's density.
- It gets a random pick from the theme's list: one building, or 1–3 props scattered in it.
- The front faces the nearest track cell's centre, snapped to 90°.

Nothing knows what an asset is, which side is its front, what it belongs with, or how big it should be beside the other kits.

**Indianapolis** (49 items) has 13 grandstands, of 4 kinds:
- They sit in ones and twos all round the oval, 7.5–18 m from the centreline, one of them in the infield.
- 5 are on the camera's side.
- Their fronts are off the road by up to 45°: on the diagonal cells, "nearest cell" points along the track, not at it.
- Around them are 12 barrier walls, 6 chequered flags and 6 low billboards, each placed on its own.
- The Starter Kit's filler tiles add random tent tiles beside the road and in the infield, with a pine forest all round.

### 5. The editor

`editor.html` has three tools: road, erase and view. Play opens `index.html?map=` with the cells only.
- "Edit this track" is offered on the flat built-in tracks. It opens a copy as a custom track, which loses the laps, par, NPC tables, racing line and theme.
- The hill tracks can't be opened at all.
- There's no scenery in the editor.

## Decisions I've made (override any of these before implementation)

- **D1. Fix the bent road at its source,** not by turning bloom off:
  - no sliver triangles out of `split()` or the builders;
  - no zero normals anywhere in the scene.

  Two new guards:
  - a playtest that draws every track at low, medium and high, and fails on a blank frame or any zero normal;
  - the playtest runner takes a forced tier, and the benchmark's runs include high, so high gets tested even on the HD 630.
- **D2. The ride target on slopes: like flat road.**
  - Median vertical speed off the road's ≤ 0.05 m/s, 90th percentile ≤ 0.2 m/s.
  - No hops anywhere but the crests that launch cars today, and no more launches there than now.
  - The best NPC's laps on Suzuka and Bathurst within 2% of today's. If they move more, I re-run the optimizer and the calibration for those two tracks.
- **D3. Nothing hides the road from the chase camera.** The camera always looks along the same direction (45° round, 35° down; portrait phones only move it further back along that line), so this can be checked exactly when the scenery is planned:
  - From every point of the road (every metre along it, across its width, at car-roof height), the line toward the camera must miss every item's box, out to the farthest phone distance.
  - An item that blocks it is shrunk until it doesn't (trees down to 60%), swapped for a low prop, or dropped.
  - This covers hillsides, rings, the paddock and landmarks alike.
  - The fly-over is exempt.
- **D4. One scale across the kits.** Each model gets a target height by what it is, with today's houses and grandstands as the reference. For example:
  - trees 4–6 m, never taller than a two-storey house;
  - a grandstand section exactly one cell (7.5 m) wide, so a row joins up;
  - containers and tanks the size of the industrial buildings' details;
  - light posts and flags under the grandstand roofs.

  The Racing Kit trees come down from up to 11 m to the forest kit's size. This replaces the per-kit `KIT_SCALE`.
- **D5. Place things in compositions, not cell by cell.** Each theme defines "sites", groups of its own assets laid out by a rule along the road or in a block. Each site:
  - faces the road at its exact angle, not snapped to the nearest cell;
  - joins its pieces edge to edge;
  - spaces repeated pieces evenly.

  Per theme:

  | Theme | Sites |
  |---|---|
  | Stadium | a grandstand run, a pit row, the control tower at the line, light posts every second cell along straights, a billboard row, banner towers at a stand's ends, a fan zone of tents, a tree belt |
  | Industrial | yards (a building with container stacks in rows and a tank beside it), a solar farm in a grid, the tank farm, chimneys beside the works |
  | Village | houses in a terrace facing the track, market stalls and carts round the square, hedges lining the gardens, lanterns along a lane, an orchard in rows |
  | Suburb | houses in a row with their fronts to the road, a fence along the plots' backs, planters at the fronts, trees in the back gardens |
  | Forest | clumps of 3–7 trees with rocks and plants under them, a fence along a path, clearings for the camp and the archery range |

  Other rules:
  - Landmarks stay one per turn.
  - The chevron and 3-2-1 boards stay as they are.
  - Item counts stay within about 15% of next_3's.
  - The random Starter Kit tent tiles go from the themed tracks. Classic keeps its look.
- **D6. Indianapolis:**
  - **The grandstands** (the covered ones with the peaked roofs in the middle, open ones at the ends) form one continuous run along the outside of the back straight, joined edge to edge and facing the track. That's the far side from the chase camera, so they never hide your car and you see their seats.
  - **The run continues** round the outside of the turns at each end of the back straight, each section turned to face the corner, as far round as the view rule allows.
  - **The front straight** is on the camera's side. It gets the pit row on its inside (the infield, away from the camera) and the control tower at the line. Its outside only gets low barriers and low billboards.
  - **The infield** gets grass, tree clumps and the fan zone. No stands.

  If you'd rather have the main stands on the front straight, they'd have to stay low there (D3).
- **D7. Scenery editing lives in the editor,** as a fourth tool, "Scenery" (key 4):
  - **Your scenery to edit.** It shows the track's scenery exactly as the game places it, from the same planner and models.
  - **Select and move:** click an item to select it, drag it to move it.
  - **Rotate:** Q / E turn it 15°; with Shift, 90°. On touch there are ⟲ ⟳ buttons.
  - **Remove:** Delete, or the bin button.
  - **Add:** pick from a palette, with the track's theme first and then every other kit by category, and place it with a ghost preview.
    - The ghost is red where the item would be on the road or over a wall, and it can't go there.
    - It's orange where the item would hide the road from the camera. You're warned but can still place it.
  - **Undo / redo:** Ctrl+Z / Ctrl+Shift+Z.
  - **Generated:**
    - The chevron and countdown boards stay generated and can't be edited: they're the driving cues.
    - "Reset" goes back to the generated layout.
- **D8. Built-in tracks stay built-in when you only edit their scenery:**
  - "Edit this track" is offered on every built-in track. Suzuka and Bathurst open with the road locked (the editor can't make hills or crossings), so only their scenery can be edited.
  - A scenery-only edit plays as the same track (`?track=indianapolis&scenery=…`), keeping its laps, par, NPC lines and records. Editing the road still makes a custom track, as today.
  - Custom tracks get a theme picker (default forest), carried in the link.
- **D9. An edited layout is a full list, not a diff against the generator,** so later changes to the planner can't shuffle what you placed.
  - **Where it's saved:** in your browser and in the link.
  - **The encoding:** about 7 bytes an item (model, position to 10 cm, angle to 5°, size to 5%), so ~1.2 KB of link for 120 items. The model numbers come from a fixed, append-only list.
  - **Export:** "Copy layout" gives a JSON file for `js/layouts/<track>.json`. If it's in the repo, that becomes the track's scenery for everyone. I won't commit it; that's yours to do.
  - **On load,** the game re-checks clearance and drops (and logs) anything on the road.

## Phase 1: hill tracks draw on every tier

- **`js/Bend.js`:**
  - `split()` drops pieces under a tiny area (a vertex lying on the cut plane makes one);
  - `Builder.triangle` and the baked kit pieces skip degenerate triangles too;
  - the same check covers the bridge, the arch and the terrain.
- **Check:** zero-normal vertices = 0 on every track.
- **Screenshots on this RTX 3060:** Suzuka and Bathurst at low, medium and high, the setup view and one race frame each.
- **New playtest `tiers`:** every track × low / medium / high. It fails on a blank or single-colour frame, on any zero normal (scanned through `__kerb`), or on page errors.
- **`--tier` for the playtest runner,** so the existing scenarios (fly-over, scenery, race) also run on high. `npm run bench` already takes `--tiers`; its runs add high.

## Phase 2: a ride probe (`npm run sim -- --ride`)

Today's numbers become next_4's "before". Per track, it reports:
- **Bounce:** the table above (vertical speed off the road's, kicks per second, height above the road), on flat and sloped road, with launches counted separately.
- **Wiggle:**
  - a scripted keyboard driver: a steady steer through set corners, and small corrections on the sloped straights;
  - it records the heading's noise, the body's pitch and roll against the slope, and how often the car flips between grounded and flying.
  - Monza is the reference.
- **Isolated ramps:** a constant 5% ramp built three ways (one big triangle pair, 0.5 m strips, a tilted box), with a driven sphere on each. This tells whether the kicks come from the triangle mesh, from contact on a slope at all, or from the drive spin.

## Phase 3: a smooth ride on hills

These are in order, and I stop when D2 is met:

1. **The road collider** (`js/Physics.js`, `buildHillColliders`):
   - no ribbon over flat stretches, where the ground box carries the car as on the flat tracks;
   - one long flat panel per constant gradient, with slices only through the rounded crests and dips;
   - corners triangulated so each slice stays level across the road (today the corner quads are twisted).
2. **The drive on a slope,** if the ramps in phase 2 point to it: the spin axis set along the slope's surface instead of flattened, or the sphere's restitution to 0.
3. **Following the road:** after each physics step, a car on the road that's a few cm above it and moving away from it gets its vertical speed set back to the road's. `TrackShape.surface` already gives the exact height and slope. Where the profile turns down (the crests), it's left to physics, so launches stay.

**Then the wiggle,** re-measured:
- If it's still there, `Vehicle` keeps its heading as an angle and builds the orientation as "tilt to the ground, then heading" each step. Today it yaws about the tilted body, then pulls back toward the slope by 20% a step.
- Hops under 0.3 m won't switch the body to its in-the-air pose.

**Then the checks:**
- `--ace` on Suzuka and Bathurst. If laps moved over 2%, `--optimize` and `--calibrate` for those two.
- `--soak` on all six tracks.

## Phase 4: what the assets are (the analysis)

- **A contact sheet** (`npm run catalog`): every model the themes use, plus the unused ones in `models/`. Each is drawn from the chase camera's angle and from the front, with its name, an arrow on its +z side and a car beside it for scale. I'll use it to read each model's front and size, and you can review it (`playtests/catalog/`).
- **`js/SceneryCatalog.js`** (hand-written, next to the generated `SceneryList.js`). Per model:
  - its role: stand, pit, building, tower, tree, rock, prop, fence or barrier, sign, light;
  - which side is its front;
  - its target height (D4);
  - how it's placed: in a row (and its spacing), in a cluster, or alone;
  - which sites use it.
- **The stable model list** for D9's encoding.

## Phase 5: placement by composition (`js/Scenery.js`)

**The planner's order:**
1. Landmarks, as today.
2. The theme's sites along the track (D5, D6): rows along straights and the outsides of turns, blocks in the open ground, clusters to fill.
3. A little greenery between.

**The rules** for every item:
- clearance;
- the view rule (D3);
- fronts to the road (or the site's street) at their exact angle;
- row pieces joined edge to edge;
- the catalog's scale.

**The filler tiles:** no random tent tiles beside themed tracks. The pine forest stays as the distant backdrop.

**The checks:**
- `npm run tracks` fails on:
  - an item inside the clearance;
  - an item that hides the road;
  - a building or stand whose front is over 15° off the road or its site's street.
- **The `scenery` playtest:** stills of every track from above, plus the chase camera's view at each turn and along each straight.

**Order:** Indianapolis first, then Suzuka (where the trees come down to size and off the view), then the rest.

## Phase 6: scenery in the editor

**The editor:**
- the Scenery tool, the palette, selection, move, rotate, delete and undo (D7);
- the theme picker for custom tracks;
- for Suzuka and Bathurst, the bent road and hillside drawn with the game's own `Bend.js` and `TrackShape`, so items sit on the hills;
- one mesh per item while editing, so items can be picked.

**The game:**
- `resolveTrack` reads `scenery=` (and `theme=` for custom tracks);
- `Scenery.js` takes a layout instead of planning, merged per chunk as today;
- "Edit this track" goes on every built-in track (D8).

**The models** load only when the Scenery tool opens. The game's load time doesn't change: decoding a layout takes well under a millisecond.

**New playtest `editor-scenery`:**
1. Open Indianapolis in the editor.
2. Delete a stand, place a tree and rotate it 90°.
3. Play.
4. Check in the game, through `__kerb`, that the stand is gone and the tree stands where it was placed at that angle.

Also check that reloading the editor link restores the edit.

## Files

- `js/Bend.js`: no slivers (phase 1).
- `js/Physics.js`, `js/Race.js`, `js/Vehicle.js`, `js/TrackShape.js`: the ride (phase 3).
- `js/SceneryCatalog.js` (new, hand-written): roles, fronts, sizes, site rules.
- `js/Scenery.js`: sites, the view rule, the catalog's scale, layouts from the editor.
- `js/Track.js`: no tent tiles beside themed tracks.
- `js/Tracks.js`: `scenery=` and `theme=` in `resolveTrack`; `ai` tables if phase 3 moves laps.
- `js/RaceLines.js`: re-optimized Suzuka and Bathurst lines, if needed.
- `js/Shell.js`, `js/main.js`: "Edit this track" everywhere; scenery-only edits keep the built-in track.
- `editor.html`: the Scenery tool, the palette, the theme picker, the hill tracks' road and hillside.
- `scripts/sim/race.mjs`: `--ride`.
- `scripts/check-tracks.mjs`: the view rule and the fronts.
- `scripts/catalog.mjs` (new): the contact sheet.
- `scripts/playtest/scenarios.mjs`, `run.mjs`, `scripts/bench.mjs`: `tiers`, `editor-scenery`, `--tier`.
- `README.md`, `ai/next_4.md`.

## Order and review checkpoints

1. **Phase 1:** quick and independent. Checkpoint: screenshots of Suzuka and Bathurst on high on this computer.
2. **Phases 2–3:** the ride. Checkpoint: the probe's numbers against D2, and a recording of a lap on Bathurst.
3. **Phase 4:** the catalog. Checkpoint: the contact sheet and the role, front and size table. Veto anything before I build the sites on it.
4. **Phase 5:** the sites. Checkpoint: stills of Indianapolis first, then every track.
5. **Phase 6:** the editor.
6. **Wrap-up:**
   - the full playtest suite at the automatic tier and forced to low and high;
   - `npm run perf:load` on Indianapolis, Suzuka and Bathurst (the spec's 2–3 s);
   - `npm run bench` low and high, before and after;
   - `npm run sim -- --soak`;
   - then next_4.md.

## What I can't verify here

- **What you saw on this computer.** I reproduced a blank screen on the high tier. If what you saw was something else (flicker, black patches, holes), tell me, because that would be a second bug.
- **The other computer, and phones:** I can only force each tier here. The HD 630 machine and real phones are untested.
- **How the ride feels:** the probe measures bounce and wiggle, but the test is you driving Bathurst's mountain.
- **Taste:** the compositions and D6's layout for Indianapolis.

## Out of scope

- Road editing on hills and crossings in the editor.
- Resizing items in the editor (not asked; easy to add later).
- New models from the Kenney kits.
  - Their sources (`ref/`) aren't on this computer, so I'll work with the models already in `models/`.
  - If a site needs a piece that isn't there (a corner grandstand, say), I'll compose it from existing ones as before, or ask you to copy `ref/` over.
- Parked cars in car parks: the car models are there, but it's more download for the scenery. Say if you want them.
