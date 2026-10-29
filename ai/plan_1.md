# Plan 1: touch control schemes, NPC racers and the car roster, three new tracks, iGPU cost, model compression

Answers `ai/prompt_1.md`, including the two items it carries over from `next_0.md`. Nothing here is implemented yet. The prompt's "Issues" section is empty.

## Where the project stands

- **One car, time trial only.**
  - A crashcat sphere (radius 0.5, mass 1000) drives the truck. `Vehicle.update( dt, { x, z, touchActive } )` turns input into sphere spin.
  - The simulation steps at a fixed 60 Hz, but only the player's transform is interpolated between steps (`js/main.js:533-595`).
  - Moving↔moving collisions are already enabled (`js/main.js:336`), but there is only one moving body.
- **Touch input today** (`js/Controls.js:33-125`, `js/Vehicle.js:110-121`):
  - A floating joystick appears wherever the thumb lands.
  - Its direction becomes a world heading through the 45° camera.
  - Speed is always auto-throttled to `MAX_SPEED`. That is the "strong assist" in next_0's balance findings.
- **Tracks** are grid loops built from four pieces:
  - straight
  - 90° corner, with a centerline radius of 3.75 m. There is only one corner size.
  - bump, which has no colliders (`js/Physics.js:74`)
  - finish

  A cell is 7.49 m. There are no crossings and no other corner radii, so a real circuit can only be approximated as a rectilinear loop. The default track has 16 cells and a 110 m centerline.
- **The playtest bot already has the geometry NPCs need.**
  - `scripts/playtest/track.mjs` builds a driving-order centerline from any cell list, with projection and turn look-ahead.
  - `scripts/playtest/driver.mjs` steers by pure pursuit with skill presets.
  - The driver runs through Playwright, so only the geometry can be reused in-game.
- **Models:**
  - 4 Starter Kit trucks: 6 meshes and ~1k triangles each, 78–104 KB each.
  - The green, purple and red trucks are only parked props on the default track (`js/Track.js:112-116`, `:280-304`), yet they load on the critical path.
  - `vite.config.js:63` preloads every `.glb` from the HTML.
- **Decorations:**
  - A forest tile is 2.0k triangles, tents 1.9k, empty 0.6k.
  - Each tile type is one `InstancedMesh` spanning the whole map (`js/Track.js:226-257`), so frustum culling can never skip any of it.
  - The shadow camera covers the whole track (`js/main.js:286-291`).
- **Car Kit 3.1** (kenney.nl/assets/car-kit, CC0):
  - 25 vehicles, according to notes from an earlier session. The asset page lists 45 files.
  - The node names (`body`, `wheel-front-left`, …) already match `Vehicle.js`.
  - Its `Textures/colormap.png` differs from ours. `js/Loader.js:24` would swap in the wrong one.
  - Each car is ~170–270 KB raw, about 5 MB for the set.
- **I couldn't download the Car Kit.** kenney.nl's download endpoint returned `forbidden` to a command-line request. Retrying with a browser-like session was blocked as bot-check circumvention. You'll need to fetch the zip yourself (Phase 0).

## Decisions I've made (override any of these before implementation)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| D1 | Race format | 0 opponents → today's time trial, unchanged. 1+ opponents → an N-lap race (laps set per track, aiming for 60–90 s) with a starting grid, countdown, positions and results | "Win" needs a finish line. Time trial stays for chasing a best lap |
| D2 | What "better / worse than the current human player" means | Adaptive. NPC paces spread around **your best lap on that track** (or a per-track par before you have one), plus a mild ±4% rubber band | A fixed difficulty can't be "some better, some worse" for both a novice and an expert. As you improve, the field speeds up |
| D3 | Where the joystick goes ("in the middle") | Horizontally centred, low on the screen, always drawn. A touch anywhere except a button reads as the vector from that fixed centre | Dead centre of the screen would put your thumb over the car. Tell me if you meant the screen centre |
| D4 | Two-button pads | Fixed pads in the bottom corners. Each pad's value is the thumb's offset from that pad's centre, not from where the thumb landed. On release, steering recentres and throttle goes to 0 (coast). Sliding the right pad down brakes, then reverses (like S) | Matches "button" and the keyboard feel. Analog, like a gamepad |
| D5 | Default touch scheme | Joystick | Closest to what players have now |
| D6 | Collision model | Every car keeps the same drive sphere, so all cars drive the same. Car-vs-car contact comes from a custom 2D capsule solver sized to each model, with mass ∝ footprint area. Sphere-vs-sphere physics contact is switched off | A 1 m ball under a 2–4 m car would let cars overlap visually and bounce off each other like marbles. A separate solver gives each size its own collision volume without touching the handling, and exposes knobs to tune the fun |
| D7 | Car roster | 4 Starter Kit trucks + all 25 Car Kit vehicles = 29. NPCs get random cars each race: no duplicates, never the player's car | "Everything Kenney has" in that pack. Toy Car Kit (8 cars) and the motorcycle are left out: different node names, 2 wheels |
| D8 | Grid order | Player starts last. NPCs line up slowest at the front, fastest at the back | Arcade staple. It puts the fast NPCs and the player in the same lap-1 traffic, which is where contact happens |
| D9 | Switching tracks | Reload the page with `?track=<id>`. Assets come from the browser cache | Rebuilding in place means tearing down colliders, probes, decorations and drift marks. A cached reload takes ~0.5 s, and `?map=` already works this way |
| D10 | Parked trucks on the default track | Removed | Real racers replace them, and it takes ~265 KB raw off the critical path |
| D11 | Where compressed models live | Originals move unchanged to `models/src/` (committed). `npm run models` writes meshopt-compressed copies to `models/` (also committed) | Deploys, including Cloudflare Workers Builds, need no extra build step, and the sources stay reproducible |
| D12 | Car picker images | A thumbnail sprite sheet made by a script and committed (~40–80 KB). It loads when the picker first opens | 29 live 3D previews would be too heavy on phones |
| D13 | New tracks and their names | Monza, Monaco and Indianapolis (drafts below). Place names only, with an "inspired by" credit. No event names such as "Grand Prix", "Indy 500" or "Brickyard" | Each fits 90° pieces well and plays differently: chicanes and straights, tight and twisty, flat-out oval |
| D14 | Custom `?map=` tracks | Race mode when the track's centerline closes into a loop. Otherwise time trial only, with opponents disabled | NPCs need a loop to follow |

## Phase 0: Car Kit download (you)

1. Download `kenney_car-kit.zip` from https://kenney.nl/assets/car-kit and tell me where it is. Or allow the command-line download, if you'd rather I fetch it.
2. I extract it into a new directory outside the repo. Only the GLB models and the kit's colormap get copied into `models/src/cars/`.
3. Before using the models, I check:
   - the vehicle count (25 expected)
   - node names, including how trucks with more than two axles name their wheels
   - scale against the yellow truck (Starter Kit trucks need `root_scale 0.5`)
   - extra moving parts and triangle counts
   - whether the kit includes debris parts (used only by an optional step in Phase 7)

Phases 2–5 don't need the Car Kit and can go first.

## Phase 1: Model pipeline, compression and Car Kit import (next_0 #3)

1. New devDependencies: `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer`.
2. `scripts/models.mjs` (`npm run models`):
   - runs dedup → prune → weld → quantize → `EXT_meshopt_compression`, keeping node names and hierarchy
   - writes `models/*.glb`, `models/cars/*.glb` and a generated `js/CarList.js`
3. **Pivot risk.** Quantization moves a dequantization transform into the node transforms. Wheels spin and the body tilts around their node origins, so a moved origin breaks them.
   - The script compares every named node's world origin and world bounds before and after, with a 1 mm tolerance.
   - If they move, quantize over a single scene-wide volume instead, or leave positions unquantized. Meshopt still compresses without it.
4. Loader changes:
   - `ColorMapGLTFLoader` takes the colormap to substitute, since the Starter Kit and the Car Kit use different ones.
   - It calls `setMeshoptDecoder( MeshoptDecoder )` from `three/addons/libs/meshopt_decoder.module.js`. The decoder's wasm is embedded in that module, so the single-file offline build keeps working.
   - `editor.html` uses the same loader.
5. Contents of the generated `js/CarList.js`:
   - one entry per car: `{ id, name, kit, length, width, height }`, with bounds measured after the 0.5 scale
   - names derived from file names ("sedan-sports" → "Sedan Sports")
   - each car's position in the thumbnail sprite sheet
6. Preloading:
   - `vite.config.js` preloads only the critical set: track pieces, decorations and the default car.
   - An inline `<head>` script reads `kerb.car` and adds a preload for that car, using a build-time map from car id to hashed URL.
   - Every other car loads after the game is interactive.
7. `scripts/car-thumbs.mjs` (`npm run thumbs`): Playwright renders each car with the game's light and camera angle into `sprites/cars.webp`.
8. Expected sizes (estimates; I'll measure):

   | | Now | After |
   |---|---|---|
   | Existing models | 940 KB | ~250 KB |
   | Each Car Kit car | ~170–270 KB raw | ~40–70 KB |
   | Offline single file | 2.3 MB | ~3.5 MB (every car inlined) |

   A race fetches only the 1–9 cars in it.
9. Done when:
   - before/after screenshots of the game and the editor match at the playtest camera poses
   - every car's wheels spin and steer, and its body tilts, around the right pivots
   - `perf:load` interactive time is no worse

## Phase 2: Cut the iGPU cost of trees and shadows (next_0 #2)

1. **Measure first.** `__kerb.benchmark` gets toggles: hide decorations, hide track, hide cars, shadows off. That gives a cost table per tier at 1366×768 and 1080p on the HD 630.
2. **Chunk the decorations.** Split each instanced tile type into spatial chunks of about 4×4 cells. Each chunk is its own `InstancedMesh` with its own bounds, so both the main pass and the shadow pass skip chunks that are off screen.
3. **Fit the shadow camera to the view.**
   - Size it from the view's footprint on the ground (including the portrait `zoomOut` dolly), centred on the look point.
   - Snap it to shadow texels so shadow edges don't shimmer.
   - Shadow cost then stops growing with track size, which matters for Monza and Monaco, and every tier's shadows get sharper.
4. Only if that isn't enough, per-tier knobs:
   - forest `castShadow` / `receiveShadow` off on low
   - NPC cars stop casting shadows beyond ~25 m on low
5. **Target:** the HD 630 at 1080p, on the largest new track with 8 NPCs.
   - low ≤ 8 ms per frame
   - medium ≤ 14 ms per frame
   - If medium fits, `classifyGPU` moves Intel HD/UHD back to medium.
6. Retake the per-tier screenshots to confirm nothing visibly got worse.

## Phase 3: Multi-car core (a refactor with no behaviour change)

1. New `js/Race.js`, with no DOM access:
   - owns the physics world, walls, ground, `cars[]`, `step( dt, playerInput )`, contacts and race progress
   - `main.js` keeps rendering, camera, audio and UI
   - with no DOM, Node can run whole races headless (Phase 6)
2. Each car holds its vehicle, sphere body, driver (human or AI), car definition, lap counter, and previous and current transforms. Every car is interpolated between steps, not just the player's.
3. `js/LapTimer.js` splits in two: per-car lap logic, and the player's HUD.
4. Smoke and drift marks emit per car and age once per step. Only the player's drift marks are saved, as now.
5. Input becomes `{ x, z, mode: 'car' | 'world' }` instead of `touchActive`.
6. `centerline`, `Polyline` and `encodeLoop` move from `scripts/playtest/track.mjs` to `js/TrackPath.js`. `track.mjs` re-exports them.
7. Done when `npm run playtest` passes all 38 checks and lap times match `playtests/reports/latest.json` within noise.

## Phase 4: Two touch control schemes (Feature 1)

A **Controls** choice, "Joystick" or "Two thumbs", appears on the setup screen and in the pause menu on touch devices only. It's saved as `kerb.touch`.

**Joystick (fixed position)**
- The base is always drawn while playing, horizontally centred and inside the safe area. Its centre sits at ~78% of the screen height in portrait and ~72% in landscape.
- A touch anywhere except a button counts. The input is the vector from the fixed centre to the finger.
- Direction sets the world heading through the 45° camera, as now.
- Distance sets speed:
  - 15% dead zone
  - full speed at the edge of the base (~60 px)
  - linear in between
  - lifting the thumb coasts down
- In world mode, `Vehicle` aims for `MAX_SPEED × throttle` instead of always `MAX_SPEED`.

**Two thumbs**
- Left pad (bottom-left): slide left/right to steer, `x ∈ [-1, 1]`.
- Right pad (bottom-right): slide up/down, `z ∈ [-1, 1]`. Up accelerates; down brakes, then reverses.
- Each pad tracks its own pointer, so both thumbs work at once.
- A pad's value is the thumb's offset from the pad centre divided by ~50 px, clamped. The knob springs back on release.
- Input goes through the car-relative path, like a gamepad.

**Both schemes**
- While playing on a touch device, the "Create new track" corner link hides, because the right pad sits in that corner. The link stays in the pause menu.
- The version label stays bottom-left. I'll check the left pad doesn't cover it.
- Rotating the device cancels all touches, as now.
- Playtest changes:
  - `TouchDriver` gets `scheme: 'joystick' | 'pads'`. The pads scheme sends two CDP touch points.
  - Runs: phone portrait and landscape × both schemes × 3 skill levels, compared against keyboard.
  - This also re-measures next_0 balance finding 1, since the joystick no longer drives flat-out by default.
- Needs a real-device check: two thumbs at once on iOS Safari and Android Chrome. The pinch guard in `lockViewport` must not swallow the second thumb.

## Phase 5: Three new tracks (Feature 3)

1. `js/Tracks.js` holds `{ id, name, inspiredBy, laps, par, heading, layout }` per track.
   - `layout` is one letter per cell, starting at the finish cell: `S` for a straight, `L` / `R` for a corner turning left / right.
   - `js/TrackPath.js` turns it into cells, reusing the `encodeLoop` logic.
2. `scripts/check-tracks.mjs` validates every layout and prints it as ASCII:
   - the loop closes
   - no cell is used twice
   - no two cells touch unless they are consecutive. Otherwise "Edit this track" auto-tiling goes wrong and walls double up
   - at least 2 straight cells sit behind the finish, for the starting grid
3. Before building them, I'll look up each real circuit's map and adjust the draft so its corner order follows the real one. (The prompt asks for this research.)

Drafts below, already checked against the repo's own track code. Top-down view: `F` is the finish, `+` a corner, `|` / `-` straights.

```
Indianapolis               Monza                      Monaco
+ - - +                    . . . . + - - +            + - - + . . .
| . . |                    . + - - + . . |            | . . | . . .
| . . |                    . | . . . . . |            F . . | . . .
| . . F                    + + . . . . + +            | . . + + . .
| . . |                    | . . . . . | .            | . . . | . .
| . . |                    | . . . . . | .            + + . + + . .
| . . |                    | . . . . . | .            . | . | . . .
| . . |                    F . . . . . | .            + + . + - - +
+ - - +                    | . . . . . + +            | . . . . . |
                           | . . . . . . |            | . + - - - +
                           | . . . . . . |            + - + . . . .
                           + - - - - - - +
```

| | Indianapolis | Monza | Monaco |
|---|---|---|---|
| Cells / corners | 22 / 4 | 38 / 12 | 36 / 16 |
| Footprint (cells) | 4×9 | 8×12 | 7×11 |
| Centerline | 158 m | 265 m | 244 m |
| Direction | anticlockwise, like the real one | clockwise, like the real one | clockwise, like the real one |
| Character | Flat out with four braking zones; pack racing | Long straights. The Rettifilo, Roggia and Ascari chicanes become one-cell jogs. Lesmo, Parabolica | Short pit straight, Ste Dévote, Casino S-bend, Grand Hotel hairpin, tunnel straight, chicane, pool section |

For comparison, the default track is 16 cells and 110 m, with laps of 11–18 s today. If Monza or Monaco laps run over ~30 s for an average player, I'll shorten their straights.

4. Decorations use the procedural ring, as custom tracks do. The default track keeps its hand-placed layout and is labelled "Classic".
5. Track picker on the setup screen:
   - lists Classic, the three new tracks, and "Custom" when `?map=` is present
   - picking a track reloads with `?track=<id>` (D9)
   - with no URL parameter, the last-played track loads
6. Best laps are keyed by track id. Classic keeps the existing `default` key, so saved best laps survive. "Edit this track" opens the editor with the track's encoded cells.
7. Starting lap counts, to tune: Classic 5, Indianapolis 5, Monza 3, Monaco 2.

## Phase 6: NPC drivers (Feature 2)

`js/AIDriver.js` reads car state directly and outputs analog `x` / `z`. These feed the same `Vehicle.update` path as keyboard and gamepad, so NPCs have exactly the player's physics.

- **Steering:** pure pursuit along the centerline, plus a lateral offset. Better drivers take more of a racing line toward the inside of corners; the same offset is used to avoid other cars.
- **Speed:** corner entry speed comes from the turn ahead, and the braking point from current speed. Skill sets the entry speed and how precisely the driver brakes.
- **Imperfection:** a reaction delay (a short state buffer), steering noise, and a per-corner chance of braking late or running wide.
- **Traffic:**
  - When a car is ahead within ~6 m in its path, the NPC moves to the side with more room, or lifts off.
  - Each driver has an aggression value that scales how readily it accepts contact.
- **Recovery:**
  - If stuck (speed under 0.4 on throttle for 1.2 s), it reverses and counter-steers, like the playtest bot.
  - After 3 failed tries, or 4 s off track or going the wrong way, it respawns on the centerline at its current progress.
  - A respawned car is ghosted for 1.5 s: no collisions, drawn translucent.
- **Pace:** a speed cap between 0.75× and 1× `MAX_SPEED`, set by Phase 9.
- **Skill** is a single 0–1 value that blends novice → expert parameters, plus a random seed.

`scripts/sim/race.mjs` (`npm run sim`) runs `Race.js` in Node with no rendering, faster than real time. It's used for:
- **Calibration:** skill → lap time, per track.
- **Soak test:** 9 AI cars × 20 laps × 4 tracks × several seeds. It must show 0 permanently stuck cars, 0 falls and no NaN values.

## Phase 7: Car-to-car collisions (Feature 2)

1. Remove `enableCollision( OL_MOVING, OL_MOVING )`. The spheres still collide with walls and ground as now.
2. `js/CarCollisions.js` runs after each `updateWorld`:
   - Each car's footprint is a 2D capsule along its heading, with length and radius from the `CarList` bounds.
   - Every pair of cars is tested (at most 36 pairs).
   - A contact is resolved with:
     - a position correction split by inverse mass
     - an impulse along the contact normal, with restitution
     - sideways friction
     - a yaw impulse from the lever arm, so off-centre hits spin cars
3. Mass is proportional to footprint area, with the yellow truck = 1. Big vehicles shove small ones; driving itself is unaffected.
4. Feedback on contact:
   - an impact sound for every contact. Hits involving the player use the existing positional players; NPC-only hits use a small pool of players placed in the world
   - a body wobble, by kicking the existing roll and pitch
   - a smoke puff at the contact point
   - a slight camera shake on hard hits to the player
5. **Exploring what's fun:**
   - A dev-only tuning panel (`?tune`, using lil-gui from three's addons) exposes restitution, friction, yaw factor, mass exponent and AI aggression.
   - I'll record pack-racing videos with the playtest runner for you to judge.
6. Optional: if the kit has debris parts, one pops off on a hard hit. Cosmetic only, medium/high tiers only.
7. Checks in the sim and playtests:
   - no two cars end up locked nose-to-nose against a wall
   - cars don't pass through each other at the maximum closing speed (head-on, about 2× top speed per 1/60 s step)

## Phase 8: Setup screen, car picker, race mode (Feature 2)

**Setup screen.** It replaces "Press any key to drive" (`index.html:196-197`).
- Contents:
  - Track
  - Car: thumbnail, name, size S/M/L, and a "Change" button
  - Opponents stepper (− 4 +, 0–8)
  - Controls (touch devices only)
  - a **Race** button, labelled **Drive** in time trial
- Enter, W, or gamepad A / Start starts with what's shown, so a quick start is still one key.
- Tapping empty overlay no longer starts the game (`js/Shell.js:55-61`). It would trigger while you're using the setup controls.
- On a first visit (no saved car), the car grid opens first, so you pick your car before anything else.

**Car picker**
- A grid of 29 thumbnails, usable with keyboard and gamepad.
- The picked car swaps in live on the starting grid behind the overlay.

**Loading**
- Only your car is on the critical path.
- NPC cars (~50 KB each) load after the game is interactive. If they haven't arrived when you press Race, the button shows a spinner until they do.

**The race**
- Grid: two staggered columns behind the finish line, following the centerline. Spacing fits the longest car, and the order follows D8.
- Countdown: 3-2-1-GO with synthesized beeps. Input is ignored until GO, and the race clock starts at GO.
- HUD: position (2/5), lap (2/3), race time, best lap.
- Finish: a results panel with each racer's position, car, total time and best lap.
  - "Race again" restarts in place.
  - "Change setup" goes back to the setup screen.
  - NPCs still racing 15 s after you finish are placed by how far they got.

**Pause menu**
- Changes to opponents or car apply through "Restart race". That restarts in place: NPCs spawn or despawn and everyone returns to the grid.
- "Reset car" (or the R key) puts you back on the centerline at your current progress.

Saved settings: `kerb.car`, `kerb.npcs`, `kerb.touch`, `kerb.track`.

## Phase 9: Difficulty (Feature 2)

1. The reference pace `R` is your best lap on the track. Before you have one, it's the track's `par`: the average keyboard bot's lap time, stored in `Tracks.js`. Custom tracks scale Classic's par by centerline length.
2. NPC target lap times are spread evenly from 0.97·R to 1.15·R, with ±2% jitter. About a third of the field is faster than your best lap. Race laps include a standing start and traffic, so a player near their best usually fights for 1st or 2nd.
3. Each NPC slowly adjusts its speed cap so its average lap matches its target, within what its skill allows.
4. A mild rubber band adjusts that speed cap by up to ±4% depending on the gap to you.
5. As your best lap improves, `R` drops and the whole field speeds up.
6. Measure with the playtest bots:
   - keyboard novice, average and expert, plus both touch schemes
   - against 4 NPCs on each track, 2 races each (the first race sets the best lap)
   - targets: expert usually wins; average finishes 1st–3rd; novice finishes 3rd–5th and is never lapped
7. Tuning results go into `ai/next_1.md`. Whether it's fun is your call; I'll hand over recordings and numbers.

## Phase 10: Performance, load time, docs

- `npm run perf:load` on all four profiles. Interactive must stay at or under 1 s on the average profile (0.57 s today).
- Frame benchmark for each tier × 0 / 4 / 8 NPCs × each track.
- With 8 NPCs, one simulation step must take ≤ 2 ms under 4× CPU throttle. That covers 8 more spheres, the AI and the collision pairs.
- The automatic quality step-down also cuts NPC detail (shadows, smoke). If low-tier phones still can't hold 30 fps with 8 NPCs, the stepper's maximum drops on those devices.
- README: controls, the tracks and what inspired them, Car Kit credit (CC0, Kenney), and the new npm scripts.
- `ai/next_1.md`.

## Files

- **New:**
  - `js/Race.js`, `js/AIDriver.js`, `js/CarCollisions.js`, `js/TrackPath.js`, `js/Tracks.js`, `js/CarList.js` (generated)
  - `scripts/models.mjs`, `scripts/car-thumbs.mjs`, `scripts/check-tracks.mjs`, `scripts/sim/race.mjs`
  - `models/src/` (originals), `models/cars/` (compressed), `sprites/cars.webp`
- **Changed:**
  - `js/main.js`: renders and interpolates every car; setup and race flow; NPC data in the playtest hook
  - `js/Vehicle.js`: input mode; world mode respects throttle
  - `js/Controls.js`: fixed joystick, pads, multiple pointers
  - `js/Shell.js`, `index.html`: setup screen, car picker, results, pause-menu additions
  - `js/LapTimer.js`: logic/HUD split; race HUD
  - `js/Track.js`: chunked decorations, parked trucks removed, track ids
  - `js/Loader.js`: meshopt decoding; colormap chosen per kit
  - `js/Particles.js`, `js/DriftMarks.js`: emit per car
  - `js/Audio.js`: impacts placed in the world; countdown beeps
  - `js/Quality.js`: NPC detail knobs; Intel tier change if Phase 2 allows it
  - `js/Assets.js`, `vite.config.js`: car URLs, smaller preload set
  - `editor.html`: shared loader
  - `scripts/playtest/*`: touch schemes, race scenarios
  - `package.json`, `README.md`
- **Style:** unchanged: mrdoob style, sparse comments.

## Order and review checkpoints

Suggested commit boundaries:
1. Phase 2 (iGPU), plus compressing the existing models from Phase 1. Both are standalone wins and nothing else depends on them.
2. Phase 3 refactor, with the playtest baseline showing no change.
3. Phase 4 touch controls.
4. Phase 5 tracks (time trial only at this stage).
5. Phase 0 and the rest of Phase 1 (Car Kit), then Phases 6–7 (AI, collisions), checked with the sim.
6. Phase 8 race flow and UI.
7. Phase 9 tuning on its own, so it can be reviewed and reverted separately.
8. Phase 10.

## What I can't verify here

- How two-thumb multi-touch and the fixed joystick feel, and fps with 8 NPCs, on a real entry-level phone.
- Whether racing is fun. The bots can measure balance, not fun.
- Car Kit specifics (count, scale, extra parts) until the zip is here.

## Out of scope

- Toy Car Kit and the motorcycle
- per-car handling differences
- slipstream / drafting
- online multiplayer
- NPCs on custom tracks that aren't loops
- new track pieces (crossings, wider corners)
- wall-friction changes (next_0 balance finding 2). If you change wall friction later, NPC pace adapts automatically, because it's calibrated against your lap times
