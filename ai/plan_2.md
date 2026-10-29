# Plan 2: hills, jumps and an unsealed cliff road; the magic wand; a figure-8; scenery that marks the corners; faster NPCs; handling by mass

Answers `ai/prompt_2.md`. Nothing here is implemented yet.

## Where the project stands

- **Everything is flat.**
  - The ground is one box collider at y ≈ −0.12 (`js/Race.js:104-111`).
  - Walls are axis-aligned boxes per cell (`js/Physics.js`).
  - Track pieces are the four Starter Kit pieces placed at y = 0.
  - `Vehicle` keeps the car level with world up (`js/Vehicle.js:192-196`).
  - Drift marks sit at a fixed ground height.
  - The camera footprint and the shadow box assume flat ground.
- **Respawning is instant.** A fall below y = −10, or an NPC that is stuck or facing the wrong way, gets teleported to the centerline (`Race.respawn`) and ghosted for 1.5 s.
- **Tracks are grid loops.**
  - `checkLayout` rejects a cell used twice.
  - `centerline()` walks the cells by grid key, so a track that crosses itself can't be described yet.
  - The playtest bots and NPCs project onto the centerline with a segment-index hint, so they already keep to their own pass where a road would cross.
- **Speeds.**
  - Top speed is ~15 m/s (`LINEAR_SPEED_PER_MS` = 0.1 at `MAX_SPEED` 1.5).
  - Gravity is ×1.5, so g ≈ 14.7 m/s².
  - A car leaves the road over a crest when v²/R > g. At top speed that means a crest radius under ~15 m; at 10 m/s, under ~7 m. Crests of 10–14 m radius therefore give airtime only to fast cars, which is what the prompt asks for.
- **crashcat 0.0.3 already has what hills need:**
  - triangle-mesh shapes with active-edge detection
  - an `enhancedInternalEdgeRemoval` body flag, which stops a rolling sphere bumping on triangle seams
  - `castRay`
  - `setMotionType` / `setObjectLayer`, to take a car out of the simulation while the wand carries it
- **Why NPCs feel slow.** These come from the code and next_1's numbers.
  - The field is aimed at 1.0–1.18 × your best lap, so by design most of it is slower than you.
  - Skill 1 laps 8.5–10.6% slower than the keyboard expert bot on every track. The NPCs brake for corners, but walls are frictionless, so flat out along the wall is faster. The expert bot does exactly that (`cornerSpeed: 99`).
  - `pace` caps NPC throttle, so a slow NPC is visibly slow on every straight. That is where a player judges speed.
  - NPCs blocked behind another car lift to 60% throttle.
  - In a first race, the field re-aims at your first lap, and that lap includes the standing start.
- **Cars all drive the same.** Mass (∝ footprint area) only affects car-to-car contact. By model volume, the cars range from 0.28 (karts) to 1.36 (garbage truck), with the yellow truck at 1.
- **The new Kenney kits** (in `ref/`, CC0, all except the Racing Kit sample a 512² colormap like the Starter Kit):

  | Kit | Models | Useful for | Raw size |
  |---|---|---|---|
  | City Kit Industrial 2.0 | 37: factories, chimneys, tanks, water tower, wind turbines, containers, solar panels | industrial zones, tall landmarks | 60–210 KB, 700–2,400 tris per building |
  | City Kit Suburban 2.0 | 40: 21 houses, fences, paths, driveways, 2 trees | suburbs | 65–165 KB per house |
  | Fantasy Town 2.0 | 167, mostly modular walls and roofs, plus windmill, watermill, stalls, fountain, carts, trees, rocks | village prefabs, market stalls | 3–85 KB per part |
  | Mini Forest 1.0 | 22: trees, rocks, tents, platforms, bridge, fence | hillsides, forest edges | 10–60 KB |
  | City Kit Roads | 95: road tiles, slopes, bridge pillars, lights, signs, cones, barriers, poles | bridge pillars, roadside detail | 3–55 KB |
  | Racing Kit (2018) | grandstands, pit garages, banner towers, gantries, flags, billboards | the paddock | 4–33 KB, flat per-material colours, older style |

  - Each kit ships 1–3 colour variations (`variation-a/b/c.png`), which gives the same buildings a different palette per track for free.
  - meshopt compression took the Car Kit from 170–270 KB to 15–33 KB per model, so expect ~15–40 KB per building.

## Decisions I've made (override any of these before implementation)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| D1 | Which tracks get hills | Two new tracks: **Bathurst** (mountain climb, unsealed cliff-top section, crests to jump) and **Suzuka** (the figure-8, whose bridge ramps and crest give hills too). Classic, Indianapolis, Monza and Monaco stay flat and drive exactly as today | Changing an existing track invalidates its NPC calibration and everyone's saved best laps. Both real circuits are known for elevation, and Suzuka is the famous circuit that crosses itself |
| D2 | How the figure-8 crosses | A **bridge**: the back straight passes over the Degner–Hairpin section, as at the real Suzuka | No cross traffic, so NPCs and lap logic need nothing special. The alternative is a flat X crossing (figure-8 oval style, with T-bones). It's more chaotic and needs NPCs that look both ways. Say if you want that instead, or as well |
| D3 | Height range | Road 0–6 m. The world ground stays flat at y = 0, and hills are terrain raised around the road. No road dips below ground | Valleys are the low sections between hills. Below-ground cuttings would mean carving the flat ground and its collider. 6 m is ~4 car lengths: big on screen, and the camera never ends up in a trench |
| D4 | "Unsealed" | A gravel version of the track pieces: no wall on the outside (the cliff side), a low fence on the inside, less grip, dust instead of smoke. Only on Bathurst's mountain top | With an inside wall, the only way off is over the cliff, so leaving the track always means the wand, never an awkward drive back across grass |
| D5 | When the wand comes | A car is out once it's more than 1.5 m beyond the road edge, or more than 2 m below the road surface, for 0.5 s. A fall from a cliff gets ~1 s, so you see yourself go over. It also replaces every other respawn: falls, stuck or wrong-way NPCs, a car tipped on its roof, and the R key | One recovery that everyone recognises. The race clock keeps running and the other cars keep driving, which is the penalty the prompt describes |
| D6 | Editor | No hills or crossings in the editor. "Edit this track" is hidden on Bathurst and Suzuka | The `?map=` codec has spare bits for more piece types, but heights would need a format change. The prompt doesn't ask for it |
| D7 | Building scale and placement | One city-kit tile ≈ 0.7 of a track cell, so a house fills about one grid cell next to the road, at about twice the height of the Starter Kit trees. Buildings face the nearest road | It keeps the scenery on the same grid as the forest tiles, so placement, chunked instancing and culling work as they do now |
| D8 | When scenery loads | After the game is interactive, behind the setup screen. The critical path keeps only what it loads today. On medium and high, the light-probe bake waits for the scenery (the hemisphere light covers until then) | The spec's load time. The bake also leaves the critical path, so medium and high tiers load faster than now |
| D9 | Racing Kit props | Converted at build time to a generated palette texture, so they shade and batch like the other kits. They're used only in the paddock (grandstands, pit garages, banner towers, gantries). Dropped if screenshots show they clash | It's the only kit with racetrack buildings, but its 2018 flat-colour style is older |
| D10 | Car mass | From model volume (length × width × height), yellow truck = 1. Hand overrides: the tractors and the loader are heavier, the Formula lighter. Range ~0.3–1.4. It also replaces footprint area in car-to-car contact | Volume already orders the cars as a player expects: karts, then the racers, sports cars, the trucks and vans, and the big municipal trucks heaviest. At mass 1 (the default car), handling stays exactly as today |
| D11 | Top speed (your question) | **Keep it the same for every car** | Top speed is the one stat a player reads at a glance, on the first straight beside another car. Different top speeds would make "the best car" obvious. Acceleration and momentum are felt, but they're hard to rank, and how much each matters changes with the track and the traffic |
| D12 | "Knocked over" | Literally tipped: a hard side hit, scaled by the mass ratio, rolls the car onto its side or roof. This is a visual roll; the physics sphere is unchanged. The car either lands back on its wheels or the wand rights it. Heavy cars almost never tip, and light ones do from a heavy car's hit | It's the most fun reading of the prompt, and it reuses the wand. If you meant "knocked aside or spun", say so and I'll scale the existing shove and yaw kick by mass instead |
| D13 | How NPC skill shows | Every NPC goes flat out on straights. Skill shows in corners: braking point, line, corner speed, mistakes. `pace` stops capping top speed | A slow NPC should lose time where a slow human does, not by crawling down the straight |
| D14 | Field spread | From 1.0–1.18 × your best lap to about 0.95–1.12 ×. It's also skill-aware: +3% for a novice-level best lap, −3% for an expert one (next_1 balance finding 1) | You found the field too slow. Without the skill-aware part, a faster field would be harder still on novices, who already finish 4th–5th |
| D15 | Walls | Stay frictionless (next_0 balance finding 2 unchanged). The NPCs learn to use them the way players do | Changing wall friction changes the handling you've been driving. Say if you want the wall-scrape penalty instead; NPC pace re-aims itself either way |

## Phase 0: import the new kits (`npm run models`)

1. **Copy only the models we use** from `ref/` into `models/src/<kit>/`, with each kit's colormap and variations. Licence files go along.
   - The zips stay outside the repo, as with the Car Kit.
   - Expect ~60 models across the kits, not all 360.
2. **Compress** them with the existing pipeline: dedup → prune → weld → quantize → meshopt, with a placeholder colormap named per kit. Output goes to `models/<kit>/*.glb`.
   - `js/Loader.js` already shares one texture per kit name.
   - `COLORMAP_URLS` gains `industrial`, `suburban`, `fantasy`, `forest`, `roads`, `racing`, plus the variation textures.
3. **Generated in the same style** (build time):
   - **Gravel track pieces** (`track-straight-gravel`, `track-corner-gravel`). They're made from the Starter Kit pieces:
     - drop the wall triangles (above kerb height)
     - remap the asphalt and kerb UVs to the brown and tan swatches already in the Starter Kit colormap
     - keep a low inside kerb, where the fence goes
   - **Village houses**: about six prefabs assembled from Fantasy Town walls, roofs, doors and windows (stone base, timber upper floor, gabled roof), written out as single GLBs.
   - **Racing Kit props** (D9): each named material becomes a swatch in a generated 64² `racing` colormap, and its faces get that swatch's UVs.
4. **Generated at runtime**, from swatches of the kits' colormaps: hill terrain, cliff faces, bridge pillars and deck edges, chevron and braking boards, and the wand. These are detailed in Phases 1–5.
5. **Model metadata**: `js/SceneryList.js` (generated) records each model's footprint in cells, its height, which side is the front, and its kit. It drives placement and the preload map.
6. **Size target:**
   - per track, ≤ 600 KB of scenery models, none of it on the critical path
   - offline single file ~4 MB (2.34 MB now)
   - repository growth ≲ 3 MB, sources included

## Phase 1: heights and surfaces (Feature 1 core)

1. **Track data.** Built-in tracks gain two optional fields next to `layout` (`js/Tracks.js`):
   - `heights`: one number per layout cell, the road height (m) at the cell's centre.
   - `unsealed`: index ranges of gravel cells.

   Between centres, height is a monotone cubic over the cell index, so it never overshoots below ground. A crest comes from a local maximum in the numbers.
2. **`js/TrackPath.js`**: `heightAt( u )` and `slopeAt( u )` by cell parameter u, plus `heightAtS( s )` for the centerline. The centerline also carries u, so a car's projection gives its road height.
3. **Drawing.** On height tracks, each piece instance is bent to the profile at load:
   - Every vertex gets its parameter t along the cell: along the axis for straights, the angle around the pivot for corners. It is then raised by `heightAt( i + t )`.
   - Straights and the finish piece are first sliced into 8 lengthwise slices, by a generic split-triangles-by-planes helper run once per piece type. Corners are already finely tessellated around the arc.
   - Walls and kerbs bend with the road, because they're part of the same mesh.
   - Flat tracks skip all of this.
4. **Terrain** (height tracks only). The terrain is a heightfield over the cells around raised road, at 4 quads per cell edge (~1.9 m):
   - **Inside the loop:** the road heights blend into a hill. Within 1 cell of the road, the terrain is clamped to at most road height + 0.5 m, so it can't hide the car from the camera.
   - **Outside the loop:** a 30° grassy fall-off to 0. Beside unsealed cells it's a ~70° rock cliff instead.
   - Faces take grass, dirt or rock swatches by slope.
   - Mini Forest and Suburban trees and rocks are scattered on it, since flat 10×10 forest tiles can't sit on a slope.
5. **Colliders** (height tracks only; flat tracks keep today's boxes exactly):
   - **Road:** a triangle-mesh ribbon along the bent centerline, wall to wall (wider on gravel), with `enhancedInternalEdgeRemoval`. Friction is 5 on asphalt and a lower value on gravel, to tune.
   - **Walls:** tilted boxes, one per quarter of a straight and one per arc segment of a corner, following the slope. Friction 0 and restitution 0.1, as now.
   - **Terrain:** a coarser triangle mesh, so a car that leaves the road lands on the hillside instead of falling through it.
   - The ground box stays underneath everything.
6. **Vehicle on slopes:**
   - On height tracks, one downward ray per car per step finds the ground normal. Within 0.7 m the car is grounded, and the body slerps to the surface normal instead of world up.
   - **Airborne:** the nose follows the velocity (clamped ±25°), steering yaw drops to 30%, and the drive stops spinning up the sphere. That avoids a lurch on landing; I'll tune it in playtests.
   - **Landing:** a thump through the existing impact sound (ground contacts already report their speed), a body bounce and a dust puff.
   - Flat tracks skip the ray, so their behaviour stays bit-identical (the `framerate` and lap-time checks prove it).
7. **Things that assumed flat ground:**
   - Drift marks go at the car's ground height, and only while grounded.
   - Smoke and gravel dust come from the car's height.
   - The camera smooths its height more slowly than x/z, so jumps don't bob the view.
   - The shadow box spans the track's height range plus building height.
   - The probe grid's height becomes max road height + 6 m.
8. **Gravel:**
   - lower grip (more slide)
   - a little drag, scaled by 1/mass (Phase 6)
   - brown dust particles and a synthesized crunch layered on the skid sound
9. **`npm run tracks`** also checks:
   - the heights array matches the layout length, and every height is 0–6 m
   - the maximum gradient (≤ 20%)
   - per crest, its radius and the speed at which a car leaves the ground
   - gravel cells sit on the loop's outer edge

   It also prints heights in the ASCII view.
10. **Done when:**
    - a test layout with a crest, a dip and a gravel cliff drives cleanly at every tier
    - no bumps from triangle seams (the sphere's vertical speed stays smooth on straights)
    - the four flat tracks' playtest lap times match `playtests/reports/latest.json` within noise

## Phase 2: off-track detection and the magic wand (Feature 1)

1. **Detection** in `Race.track()`, from the car's projection: its lateral offset beyond the road edge and its height against `heightAtS`. The thresholds are in D5. Each car also keeps its last good spot: s, a clamped lateral offset and the height, sampled while grounded on the road.
2. **States:** `driving → out → carried → ghost → driving`.
   - **out** (0.5–1 s): physics carries on, so you see the tumble.
   - **carried** (~1.3 s):
     - The sphere leaves the simulation (switched to kinematic, on a layer that collides with nothing).
     - The car rises in a sparkle column, turns upright and facing forward, and flies along an arc to its return point: the last good spot, moved back ~3 m and centred on the road.
     - Then it's set down.
     - Its race distance follows the return point, so positions update naturally.
   - **ghost** (1.5 s): no car-to-car contact, drawn translucent, as now.
   - Throughout, the race clock runs and the other cars keep driving. For the player, the camera follows the carried car, so the view sweeps back to the track.
3. **The wand** is generated geometry: a stick with a five-point star, in the colormap's purple and yellow. A trail of star sparkles uses the smoke sprite tinted gold, and there's a short synthesized chime (`js/Audio.js`). New module: `js/Wand.js`, rendering only. The state lives in `Race.js`, so the Node sim runs it too.
4. **Everything uses it:** falls, off-track cars, stuck or wrong-way NPCs (`driver.wantsRespawn`), tipped cars (Phase 6) and the R key / "Reset car".
5. **Checks:**
   - A new `cliff` playtest scenario drives off Bathurst's cliff on purpose. The wand must fire within 1.5 s and the car must be back on the road facing forward. NPCs keep lapping meanwhile, the lap counter isn't fooled, and there are no NaNs.
   - The soak test counts wand trips per car.

## Phase 3: a track that crosses itself (Feature 2): Suzuka

1. **Crossings in layouts.**
   - `checkLayout` allows a cell to be used twice when both passes are straights, they're perpendicular, and their heights differ by ≥ 3.5 m.
   - The touch rule is relaxed only around that cell.
   - `layoutCells` keeps cells in driving order, with the crossing cell listed once per pass.
   - `centerline()` walks a layout track in array order instead of by grid key, which can only find one piece per cell. Editor maps keep the old walk.
2. **Drawing the bridge.**
   - The crossing cell and the over-pass cells next to it are a deck on pillars, with no terrain under them.
   - Pillars are City Kit Roads `bridge-pillar-wide`, scaled, or generated boxes in the wall colour.
   - The deck edges reuse the bent wall geometry.
   - The lower pass is an ordinary flat piece in the same cell.
3. **Clearance.** Deck surface 3.5 m, underside ~3.1 m. The lower pass's wall colliders top out at 2.1 m, and the tallest car is 0.9 m.
4. **Fading occluders.** The camera sits high behind the car, so the deck would hide a car driving under it.
   - Each frame, a ray from the camera to the player is tested against a short list of occluder boxes: the bridge deck, and later anything else tagged.
   - A hit fades that group to ~25% opacity over 0.15 s, using cloned transparent materials that also survive the low tier's Lambert swap.
   - The same mechanism could fix next_1 known issue 3 (Classic's finish arch hiding the race start), if the arch is split off the finish piece at load. I'll do that if it's cheap.
5. **Lap logic** needs no change. `LapCounter` collects visited cells in a set, and the finish isn't at the crossing. Projections use the segment hint, so cars keep to their own pass. A playtest checks both passes count and the bot never snaps to the other road.
6. **Layout draft**: found by a search over straight lengths that keeps the real corner order. 40 cells, 16 corners, ~274 m, a 14×6 footprint, starting on the finish heading east:

   ```
   SSRSRLRSSSLRSSSRSSSSLSLRSLSLSSSSSSLRLRSS        (heading E)

      . . + - + . . . . . . . . .
      + - + . | . . . + - - F - +
      | . . . | . . + + . . . . |
      + - - - X - - + . . . . + +       X: the back straight (cell 31, 3.5 m)
      . . . . | . . . + - - - + .          over the Degner–Hairpin link (cell 17, 0 m)
      . . . . + - - - + . . . . .
   ```

   - **Order:** main straight → T1–T2 (R, R) → S-curves (L, R) → Dunlop (L) → Degner 1–2 (R, R) → under the bridge → Hairpin (L–L) → 200R (R) → Spoon (L–L) → back straight over the bridge → 130R (L) → Casio chicane (R–L) → last curve (R).
   - **Heights:** a gentle climb through the S-curves (~1.5 m) and down to Degner. The back straight ramps up over 3 cells to the deck, then drops faster after it. That makes a crest just past the bridge, where fast cars jump its end.
   - I'll check the corner directions against track guides before building it, as for Monza and Monaco.
7. **Laps and par:** about 2 laps (60–90 s races). Par and the NPC `ai` table come from the bots and `npm run sim -- --calibrate`.

## Phase 4: the hill track (Feature 1): Bathurst

1. **Layout draft** (anticlockwise, like Mount Panorama). 34 cells, 14 corners, ~232 m, 7×12:

   ```
   SSLSSSSRLSLRLRSLRLSLSSSSSSSSRLSLSS        (heading E)

      . + - + . . .        cells 9–14: the mountain top, 5–6 m.
      . | . + + . .        12–14 (McPhillamy → Skyline) unsealed,
      . | . . | . .        cliff on the outside, fence inside
      . | . . + + .
      . | . . . + +        15–19: Esses, Dipper, Forrest's Elbow, descending
      . | . . . . |
      . | . . . + +        right column (3–6): Mountain Straight, climbing
      . | . . . | .
      . | . . . | .        left column (20–27): Conrod Straight, downhill,
      + + . . . | .        with the Hump (cell 23)
      | . . . . | .
      + - - F - + .        bottom: The Chase (R–L), Murray's (L), pit straight
   ```

2. **Draft heights (m) by cell:**
   - 0–2: 0 (the finish, Hell Corner)
   - 3–6: 0.5, 1, 1.8, 2.5 (Mountain Straight)
   - 7–9: 3, 4, 4.8 (Griffins, The Cutting)
   - 10–14: 5.3, 5.7, 6, 6, 6 (the top; the Skyline crest at 14)
   - 15–19: 5.2, 4.2, 3.4, 3, 3 (Esses, Dipper, Forrest's Elbow)
   - 20–27: 2.8, 2.2, 1.5, **1.9**, 1.0, 0.5, 0.2, 0 (Conrod, with the Hump at 23)
   - 28–33: 0

   I'll tune them in the sim until fast cars get ~0.3–0.6 s of air at Skyline, the Esses and the Hump, and average-speed cars get little or none.
3. **Scenery:** a town at the bottom, forest up the mountain, a rocky top with a view off the cliff, and farmland and industry along Conrod (Phase 5).
4. **NPCs on the cliff section:** they keep to the inside on gravel, and skill sets how much margin they leave. Low-skill NPCs occasionally go over and get the wand, which is part of the show.
5. **Laps:** 2–3, set by the measured race length.

## Phase 5: scenery that marks each part of the lap (Feature 3)

1. **Zones along the lap.** Each track lists zone styles by layout-cell index, e.g. `scenery: [ [ 0, 'paddock' ], [ 4, 'suburb' ], [ 14, 'forest' ], [ 24, 'industrial' ] ]`.
   - Every free cell takes the zone of its nearest road cell, so each stretch of the lap has its own look.
   - **Paddock:** grandstands along the main straight, pit garages, banner towers, a gantry over the start (Racing Kit, D9), and light posts and signs (City Kit Roads).
   - **Suburb:** houses facing the road, fences, driveways, garden trees (Suburban).
   - **Industrial:** factories, chimneys, tanks, containers, solar fields, wind turbines (Industrial).
   - **Village:** the Fantasy Town prefabs, windmill, watermill, market stalls, fountain, carts and lanterns.
   - **Forest:** today's forest tiles, with Mini Forest tents, rocks and platforms at the edge.
2. **A landmark at every corner.** Each corner gets one tall, distinct landmark on its outside, visible on the approach under the camera's look-ahead: water tower, wind turbine, chimney stack, large tank, windmill, watermill, grandstand, banner tower, and so on.
   - No landmark repeats on a track.
   - Tracks can pin a landmark to a corner; otherwise a deterministic hash picks one, so the scenery is the same on every visit.
3. **Corner signage**, generated:
   - red-and-white chevron boards on the outside of every sharp corner, pointing the way it turns
   - 3-2-1 braking boards before the big stops
   - Both are just a few dozen triangles, in Starter Kit swatches.
4. **Per track:**

   | Track | Zones in driving order | Notes |
   |---|---|---|
   | Classic | keeps its hand-placed Starter Kit forest and tents | adds corner landmarks and chevrons only, so it keeps its look |
   | Indianapolis | paddock and grandstands → suburb outside turns 1–2 → industrial along the back straight → parkland infield | |
   | Monza | paddock → forest park (Curva Grande, Lesmos) → village → industrial (Ascari) → forest (Parabolica) | |
   | Monaco | harbour (containers, tanks) → dense town of suburban houses and village prefabs packed close (it's a street circuit) → paddock | a colormap variation per kit, so it doesn't look like Indianapolis |
   | Suzuka | paddock → village fair (stalls, banners, a generated ferris wheel by the S-curves) → forest hills → industrial | the ferris wheel is the one new landmark model, and optional |
   | Bathurst | suburb town (pit straight, Murray's) → forest climb → rocky top → forest descent → farmland and wind turbines (Conrod) | |

5. **How it's built:**
   - The existing chunked instancing (4×4 cells) is generalised to any list of models: one `InstancedMesh` per model mesh per chunk, so culling works for both the main and shadow passes.
   - Cells with buildings get a flat lawn, yard or cobble ground tile, generated from the kit's own swatches.
   - Beyond ring 2, it thins to forest tiles, as now, and fog hides the edge.
   - The zone models load after interactive (D8) and are added to the scene when they arrive.
6. **Budget** (`npm run bench`, HD 630, low tier, 1080p, 8 NPCs):
   - scenery may cost at most 1 ms more than today's decorations on each track (2.4 ms on Monaco)
   - draw calls at most 1.5× today's
   - On low, the ring-2 buildings are skipped if that's needed to fit.
7. **Screenshots** at every corner approach, for you to judge whether each corner is recognisable. That part is a judgment call, not a number.

## Phase 6: handling by mass (Feature 5)

1. **Mass** from volume (D10), stored in the generated `js/CarList.js`.
2. **Handling knobs.** `Vehicle` takes its rates from the car instead of constants. At m = 1 they equal today's values, so the default truck and its calibration don't change.
   - **Acceleration:** the throttle rate 1.5 becomes 1.5·m^−0.4. A kart gets ~1.7×, the garbage truck ~0.9×.
   - **Momentum when coasting:** the lift-off rate becomes 1.5·m^−0.6, so heavy cars roll on further.
   - **Braking:** 8·m^−0.3.
   - Speed lost to wall hits, gravel drag and car contacts scales with 1/m.
   - Body pitch and roll animation scales with m^−0.5, so light cars visibly bob and heavy ones look planted.
   - **Top speed:** `MAX_SPEED` for every car (D11).
3. **Knock-overs** (D12), in `js/CarCollisions.js`:
   - A contact's sideways velocity change, `j / m` relative to the car's heading, above a threshold tips the car. The default threshold is ~3.5 m/s and it's exposed in `?tune`.
   - Δv is the impulse over the car's own mass, so a heavy car tips a light one easily, and a light car barely moves a heavy one.
   - **Tipped:** no input. The model rolls about its long axis while the sphere slides with the hit. A small tip lands back on its wheels after a roll (~0.6 s lost). A big one leaves it on its side or roof, and the wand rights it on the spot (~1.5 s).
   - Rolls are purely visual, so the physics can't jam.
4. **Not obvious which car wins.** These are measured with the sim, with the same AI driver in every car:
   - In time trial, the spread across weight classes stays within 1.5% of lap time on every track, and the fastest class isn't the same on every track.
   - Light cars win on twisty tracks (Monaco, Classic). Heavy cars hold up better in traffic, on gravel, through contact and on long flat-out tracks.
   - In races where all NPCs share one skill, no class wins more than ~1.3× its fair share.
   - If clean laps can't be balanced with equal top speed, I'll stop and bring you the numbers. The fallback is a ≤ 2% top-speed nudge for heavy cars, which is your call.
5. **Car picker:**
   - "Size S/M/L" becomes a weight label, Light, Medium or Heavy, with three pips.
   - No speed or acceleration stats are shown, so the picker doesn't rank the cars.
6. **NPC calibration:** the difficulty controller already corrects lap by lap. Its starting skill also gets a per-class lap factor from the sim, so a kart NPC doesn't start a race badly mis-aimed.

## Phase 7: NPC driving (Feature 4)

Physics changes (Phases 1, 6) come first, because NPC speed is calibrated against them.

1. **Racing line.** Each track's centerline offsets are smoothed within ±(road half-width − margin), clipping apexes and using the full width (iterative minimum-curvature smoothing). It's computed once when the track is built, in the browser and in Node. Better drivers follow more of it. Traffic avoidance still offsets from it.
2. **Speed profile along that line:**
   - Corner speed is `sqrt( a_lat · R )`. A single `a_lat` factor is fitted by the sim, and it's allowed to lean on walls wherever that's faster, as players do.
   - A backward pass with the car's own braking rate gives the braking points.
   - A forward pass with its acceleration gives the expected speed.
   - Because they come from each car's own rates, light and heavy cars brake and accelerate where their own handling needs.
   - Gravel lowers `a_lat`. Cliff-side crests are capped below the take-off speed, with a skill-dependent margin. Elsewhere, crests are taken flat out.
3. **Skill** (0–1) now blends:
   - the share of the profile followed (novice ~0.8 → expert 1.0)
   - braking error (early or late, in metres)
   - line quality, steering lag, noise and mistakes, as now

   `cornerSpeed`, `brakeLead` and the `pace` cap go. Every NPC runs flat out on straights (D13). Pace only drops for targets slower than skill 0 can drive, and then as earlier braking, not a lower top speed.
4. **Traffic:**
   - pick a passing side earlier
   - lift only when closing fast on a car directly ahead
   - aggressive drivers lean on you, which is where knock-overs come from
   - no slowing when merely near another car
5. **In the air:** no steering correction until they land. After a wand trip they rejoin at full throttle.
6. **`npm run sim -- --fit`**: fits `a_lat` per track for the lowest skill-1 lap. Then `--calibrate` refreshes the `ai` tables in `js/Tracks.js`.
7. **Targets:**
   - Skill 1 laps at least 2% faster than the keyboard expert bot's best, on every track.
   - NPCs reach ≥ 97% of top speed on every straight of 3+ cells.
   - Soak test: 9 cars × 20 laps × 6 tracks: no permanently stuck car, no NaN. Wand trips are reported per track; only Bathurst's cliff should cause them.

## Phase 8: difficulty and balance

1. The new spread and skill-aware offset (D14). Rubber band: NPCs behind you push up to +6%, ones ahead ease off up to −3%. It was ±4%.
2. **First race on a track:** the re-aim discounts the standing start, so the first lap ×0.92 is treated as a flying lap.
3. **Targets** with keyboard bots against 4 NPCs, 2 races per track, on all 6 tracks:
   - **Expert:** wins about half its races, and loses the rest narrowly.
   - **Average:** usually 2nd–3rd (it won 8 of 8 before).
   - **Novice:** 3rd–5th, never lapped.
   - The touch schemes are run too.
4. Your own feel decides whether it's right. I'll hand over the numbers and recordings, and the spread constants are one line each in `js/Difficulty.js`.

## Phase 9: performance, load time, docs

- `npm run perf:load` on all four profiles: interactive ≤ 1 s on the average profile (0.44 s today), and critical-path bytes ≤ 0.7 MB.
- Frame benchmark for each tier × 0 / 8 NPCs × all 6 tracks. Low tier on the HD 630 at 1080p must stay ≤ 13 ms (11–12 ms today).
- Simulation step with mesh colliders, 8 NPCs, 4× CPU: p50 ≤ 2 ms, p95 ≤ 3.5 ms. Mesh contacts cost more than boxes; the slicing resolution is the knob.
- Playtests, all passing:
  - **New:** `cliff`, `crossing` (both passes counted, no snapping), `airtime` (time in the air per crest by bot skill), `occluder` (car visible under the bridge), `tip-over` (a scripted heavy-vs-light hit), and per-class lap times.
  - **Existing:** the 121 current checks still pass.
- README: the two new tracks and what inspired them, the wand, weight classes, the kit credits (CC0, Kenney), and the new npm scripts.
- `ai/next_2.md`.

## Files

- **New:**
  - `js/Wand.js`, `js/Terrain.js`, `js/Scenery.js` (zones, landmarks, signage), `js/Occluders.js`, `js/Bend.js` (slice and bend pieces)
  - `js/SceneryList.js` (generated)
  - `models/<kit>/` (compressed) and `models/src/<kit>/` (originals plus licences)
- **Changed:**
  - `js/TrackPath.js`: heights, crossings, ordered centerline, racing line
  - `js/Tracks.js`: Bathurst, Suzuka, `heights` / `unsealed` / `scenery`, recalibrated `ai` tables
  - `js/Track.js`: bent pieces, bridges, generalised chunked instancing
  - `js/Physics.js`: mesh road and terrain colliders, sloped walls
  - `js/Race.js`: off-track states, the wand, last good spot
  - `js/Vehicle.js`: per-car handling, ground normal, air state, tip roll
  - `js/CarCollisions.js`: mass from volume, knock-overs
  - `js/AIDriver.js`, `js/Difficulty.js`: profile driving, new spread
  - `js/Camera.js`: height smoothing
  - `js/SunShadow.js`, `js/DriftMarks.js`, `js/Particles.js`: heights, dust
  - `js/Audio.js`: chime, gravel, landing
  - `js/Loader.js`, `js/Assets.js`: more kits
  - `js/Shell.js`, `index.html`: weight label, editor link hidden on new tracks
  - `js/main.js`: scenery after interactive, probes after scenery, wand and occluders
  - `js/Tune.js`: tip threshold, handling exponents
  - `scripts/models.mjs`: kits, gravel pieces, prefabs, palette conversion
  - `scripts/check-tracks.mjs`, `scripts/sim/race.mjs` (`--fit`, per class), `scripts/playtest/*`
  - `vite.config.js`: preload map
  - `package.json`, `README.md`
- **Style:** unchanged: mrdoob style, sparse comments.

## Order and review checkpoints

1. Phase 0 (kit import, compression, generated pieces). Nothing in the game changes yet.
2. Phases 1–2 on a test layout: heights, colliders, slopes, the wand on every track. The flat tracks' playtest baseline must not move.
3. Phase 3: Suzuka, the bridge and occluder fade.
4. Phase 4: Bathurst.
5. Phase 5: scenery for all six tracks (screenshots for you).
6. Phase 6: mass handling and knock-overs (sim balance table).
7. Phase 7: NPC driving (calibration tables).
8. Phase 8: difficulty, on its own so it can be reviewed and reverted separately.
9. Phase 9.

## What I can't verify here

- Whether the jumps, the cliff and getting knocked over are fun, and whether each corner now looks recognisable. I'll hand over recordings and corner screenshots.
- How the hills, extra scenery and mesh colliders run on a real entry-level phone. As before, everything here is the HD 630 in headless Chrome. The low tier's scenery thinning is the lever if a phone struggles.
- Whether the faster field feels right to you. Your test drive is the reference I don't have, so the spread is the knob to adjust.

## Out of scope

- hills or crossings in the editor (D6)
- a flat X crossing (D2), unless you want it
- roads below ground level, tunnels, banked corners
- hills on the four existing tracks
- per-car top speeds (D11), except the fallback in Phase 6.4 if you approve it
- wall friction changes (D15)
- slipstream, damage models, online play
