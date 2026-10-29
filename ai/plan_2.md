# Plan 2: hills, jumps and an unsealed cliff road; the magic wand; a figure-8; scenery that marks the corners; faster NPCs; handling by mass; a start fly-over; podium badges; kerbs that slow you

Answers `ai/prompt_2.md`, all eight features. Nothing here is implemented yet.

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
  - Contact today is a 2D impulse with a yaw kick (`js/CarCollisions.js`), so cars get shoved and spun but never leave the ground.
  - `Vehicle` only pulls the body back upright while it's tilted less than 60° (`js/Vehicle.js:192`), so a car that ends up on its side or roof would stay there.
- **Kerbs have no effect.** Measured from the Starter Kit pieces, in metres from the lane centre:
  - asphalt to 2.63 m
  - a raised yellow rumble strip from 2.63 to 3.0 m
  - the red-and-white kerb from 3.0 to 3.38 m
  - the wall face at 3.38 m

  The bands are the same on straights, the finish piece, and both sides of corners. Physically the kerbs are just part of the flat ground box.
  - The sphere touches the wall when the car's centre is 2.88 m out, so a car riding the wall always has its outer wheels on the kerb.
- **Race start and finish.**
  - Pressing Race goes straight to the 3-2-1 countdown (`js/main.js:572-590`).
  - The results are an HTML list over the race view (`Shell.showResults`). It refreshes while the rest of the field finishes, and your row is highlighted. There are no badges.
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
| D1 | Which tracks get hills | Two new tracks: **Bathurst** (mountain climb, unsealed cliff-top section, crests to jump) and **Suzuka** (the figure-8, whose bridge ramps and crest give hills too). Classic, Indianapolis, Monza and Monaco stay flat and drive exactly as today | Hills on an existing track would change its character, and it would need a whole new calibration. Both real circuits are known for elevation, and Suzuka is the famous circuit that crosses itself |
| D2 | How the figure-8 crosses | A **bridge**: the back straight passes over the Degner–Hairpin section, as at the real Suzuka | No cross traffic, so NPCs and lap logic need nothing special. The alternative is a flat X crossing (figure-8 oval style, with T-bones). It's more chaotic and needs NPCs that look both ways. Say if you want that instead, or as well |
| D3 | Height range | Road 0–6 m. The world ground stays flat at y = 0, and hills are terrain raised around the road. No road dips below ground | Valleys are the low sections between hills. Below-ground cuttings would mean carving the flat ground and its collider. 6 m is ~4 car lengths: big on screen, and the camera never ends up in a trench |
| D4 | "Unsealed" | A gravel version of the track pieces: no wall on the outside (the cliff side), a low fence on the inside, less grip, dust instead of smoke. Only on Bathurst's mountain top | With an inside wall, the only way off is over the cliff, so leaving the track always means the wand, never an awkward drive back across grass |
| D5 | When the wand comes | A car is out once it's more than 1.5 m beyond the road edge, or more than 2 m below the road surface, for 0.5 s. A fall from a cliff gets ~1 s, so you see yourself go over. It also replaces every other respawn: falls, stuck or wrong-way NPCs, a car left on its side or roof after a hit, and the R key | One recovery that everyone recognises. The race clock keeps running and the other cars keep driving, which is the penalty the prompt describes |
| D6 | Editor | No hills or crossings in the editor. "Edit this track" is hidden on Bathurst and Suzuka | The `?map=` codec has spare bits for more piece types, but heights would need a format change. The prompt doesn't ask for it |
| D7 | Building scale and placement | One city-kit tile ≈ 0.7 of a track cell, so a house fills about one grid cell next to the road, at about twice the height of the Starter Kit trees. Buildings face the nearest road | It keeps the scenery on the same grid as the forest tiles, so placement, chunked instancing and culling work as they do now |
| D8 | When scenery loads | After the game is interactive, behind the setup screen. The critical path keeps only what it loads today. The Race button waits for it, as it already waits for the opponents' cars ("Getting ready…"), so the fly-over never shows a bare track. On medium and high, the light-probe bake waits for the scenery (the hemisphere light covers until then) | The spec's load time. The bake also leaves the critical path, so medium and high tiers load faster than now |
| D9 | Racing Kit props | Converted at build time to a generated palette texture, so they shade and batch like the other kits. They're used only in the paddock (grandstands, pit garages, banner towers, gantries). Dropped if screenshots show they clash | It's the only kit with racetrack buildings, but its 2018 flat-colour style is older |
| D10 | Car mass | From model volume (length × width × height), yellow truck = 1. Hand overrides: the tractors and the loader are heavier, the Formula lighter. Range ~0.3–1.4. It also replaces footprint area in car-to-car contact | Volume already orders the cars as a player expects: karts, then the racers, sports cars, the trucks and vans, and the big municipal trucks heaviest. At mass 1 (the default car), handling stays exactly as today |
| D11 | Top speed (your question) | **Keep it the same for every car** | Top speed is the one stat a player reads at a glance, on the first straight beside another car. Different top speeds would make "the best car" obvious. Acceleration and momentum are felt, but they're hard to rank, and how much each matters changes with the track and the traffic |
| D12 | "Knocked over" | A hit knocks a car aside, spins it, or sends it flying. A car sent flying may land on its wheels, its side or its roof. Which of these happens comes from the hit itself: the relative speed of the two cars, their relative mass, and where the hit lands, not from a dice roll. Phase 6.3 has the details | As you described. The same crash always plays out the same way, so players can learn it: a heavy car T-boning a kart at speed launches it, while two cars of equal weight rubbing doors just shove |
| D13 | How NPC skill shows | Every NPC goes flat out on straights. Skill shows in corners: braking point, line, corner speed, mistakes. `pace` stops capping top speed | A slow NPC should lose time where a slow human does, not by crawling down the straight |
| D14 | Field spread | From 1.0–1.18 × your best lap to about 0.95–1.12 ×. It's also skill-aware: +3% for a novice-level best lap, −3% for an expert one (next_1 balance finding 1) | You found the field too slow. Without the skill-aware part, a faster field would be harder still on novices, who already finish 4th–5th |
| D15 | Walls | Stay frictionless. Kerb drag (feature 8) is what stops riding the wall from being the free racing line, because you can't touch a wall without wheels on the kerb. That settles next_0 balance finding 2 | Keeps one cause for one effect: the kerb slows you, and the wall only keeps you in |
| D16 | Fly-over | About 5 s, before every race started from the setup screen. Any key, tap or gamepad button skips it. "Race again" skips it, since you've just seen the track. It's skipped automatically with `prefers-reduced-motion`. Not in time trial | "Short". Restarts stay quick |
| D17 | Badges | 3 or fewer cars in the race: only the winner gets one. 4 or more: gold, silver and bronze for 1st–3rd. Your best medal per track is remembered and shown in the track picker | Your rule. A remembered medal gives the badge a reason to exist after the results close; it's the "or something" |
| D18 | Podium display | A small separate 3D scene replaces the race view behind the results panel. The winner turns slowly on a round table under a spotlight, with confetti. With three winners, 2nd and 3rd stand on lower round steps either side | It works the same on every track, including custom ones, and needs no room in the scenery. It's cheap to draw |
| D19 | Kerb drag | Per wheel on the kerb: the rumble strip drags lightly, the red-and-white kerb about twice as much. Heavy cars ride over kerbs a little better. It applies on every track, the four flat ones included | "Driving into and along the kerb slows you down". Counting wheels makes clipping an apex cost less than riding along the kerb |
| D20 | Saved best laps | Restart with this version (a new storage key; the old records stay in storage, unused) | Records set by riding the wall for free can't be matched once kerbs drag. The field is aimed at your best lap, so an unreachable record would make every race on that track unwinnable |

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
4. **Everything uses it:** falls, off-track cars, stuck or wrong-way NPCs (`driver.wantsRespawn`), cars left on their side or roof after a hit (Phase 6) and the R key / "Reset car".
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
   - Speed lost to wall hits, gravel drag, kerbs (Phase 7) and car contacts scales with 1/m.
   - Body pitch and roll animation scales with m^−0.5, so light cars visibly bob and heavy ones look planted.
   - **Top speed:** `MAX_SPEED` for every car (D11).
3. **Hits: knocked aside, spun, or sent flying** (D12), in `js/CarCollisions.js`.
   - **What a car feels.** The contact impulse already comes from the closing speed and both masses. Each car's velocity change is `Δv = (1 + e) · v_closing · m_other / (m_self + m_other)`, so it depends only on the relative speed and the relative mass. Each car's Δv is split into the part along its own heading and the part across it.
   - **Along its heading** (a nose or tail hit): Δv comes off its drive speed, as today. These hits never launch a car.
   - **Across its heading**, three outcomes by size. The starting thresholds are tunable in `?tune`.
     - **Under ~2 m/s: knocked aside.** Today's shove, plus a body wobble.
     - **2–5 m/s: spun.** The yaw kick grows with Δv and with how far off-centre the hit is. Steering fades out for ~0.3 s, so the driver has to catch it.
     - **Over ~5 m/s: sent flying.** The physics sphere gets real upward velocity, a capped fraction of the sideways Δv. It really leaves the ground: it can clear a wall and land on the road, on terrain, or off the track, which brings the wand. The model tumbles with spin from the hit: roll from the sideways part, plus pitch if the hit was near the nose or tail.
   - **Landing** depends on how the car is turned when it touches down. That follows from the tumble rate and the airtime, both set by the hit.
     - **Within ~50° of upright:** it lands on its wheels, bounces and carries on. The existing upright pull takes over.
     - **Beyond that:** it lands on its side or roof and slides to a stop, and the wand rights it on the spot (~1.5 s).
     - No input while flying or on its side.
   - **Examples** (restitution 0.35, today's value):

     | Hit | Struck car's sideways Δv | Outcome | The other car |
     |---|---|---|---|
     | Garbage truck (1.36) T-bones a kart (0.28) at 8 m/s | ~9 m/s | flying, likely onto its roof | ~1.8 m/s along its heading: a small slowdown |
     | Kart T-bones a garbage truck at 8 m/s | ~1.8 m/s | knocked aside | the kart bounces off, nose first |
     | Two yellow trucks, side hit at 8 m/s | ~5.4 m/s | a short hop, usually back on its wheels | slows |
     | Two cars of similar weight rubbing doors at 2 m/s | ~1.4 m/s | a shove | a shove |
     | A garbage truck leaning on a kart at 2 m/s | ~2.2 m/s | the kart spins | barely moves |

   - **On flat tracks**, a car is airborne when the sphere is above the ground plane, so no ray is needed there.
   - **Tuning target** in the sim, races with 8 NPCs:
     - about 1–3 launches per race, mostly light cars
     - a light car lands on its roof or side in about half its launches, a heavy one rarely
     - no car stuck in a wall or another car afterwards
4. **Not obvious which car wins.** These are measured with the sim, with the same AI driver in every car:
   - In time trial, the spread across weight classes stays within 1.5% of lap time on every track, and the fastest class isn't the same on every track.
   - Light cars win on twisty tracks (Monaco, Classic). Heavy cars hold up better in traffic, on gravel, through contact and on long flat-out tracks.
   - In races where all NPCs share one skill, no class wins more than ~1.3× its fair share.
   - If clean laps can't be balanced with equal top speed, I'll stop and bring you the numbers. The fallback is a ≤ 2% top-speed nudge for heavy cars, which is your call.
5. **Car picker:**
   - "Size S/M/L" becomes a weight label, Light, Medium or Heavy, with three pips.
   - No speed or acceleration stats are shown, so the picker doesn't rank the cars.
6. **NPC calibration:** the difficulty controller already corrects lap by lap. Its starting skill also gets a per-class lap factor from the sim, so a kart NPC doesn't start a race badly mis-aimed.

## Phase 7: kerbs slow you down (Feature 8)

1. **The bands**, from the measured pieces:
   - the yellow rumble strip, 2.63–3.0 m from the lane centre
   - the red-and-white kerb, 3.0–3.38 m

   They're the same on every track, on both sides of straights, the finish piece and corners. On height tracks, the bent pieces keep them where they are.
2. **Per step, per car:**
   - The four wheel positions come from the car's footprint and its centerline projection. That's a few multiplies per car; no new physics shapes.
   - Each wheel on the strip or the kerb adds drag to `linearSpeed` (D19). The kerb drags about twice as hard as the strip, scaled by m^−0.5.
   - One wheel clipping an apex costs little. Two wheels along the kerb cost a lot.
3. **Riding the wall** now always means two wheels on the kerb, so it costs time. Walls stay frictionless (D15).
4. **Feedback:**
   - a synthesized rumble whose rate follows speed
   - a small body judder
   - gamepad rumble where the browser supports it
   - short `navigator.vibrate` pulses on Android phones (iOS has no vibration API)
5. **Gravel cells** have no kerb drag (gravel has its own), except along the low inside kerb.
6. **Recalibration** for every track:
   - Par and the NPC `ai` tables are redone.
   - The playtest expert bot never brakes (`cornerSpeed: 99`), so it gets a braking preset and stays a fair stand-in for a fast human.
   - Saved best laps restart (D20).
7. **Targets** (bots, every track):
   - riding the wall flat out is ≥ 5% slower than a clean line with braking
   - the average bot's best lap moves by ≤ 3%
   - Drag strength is one constant.

## Phase 8: NPC driving (Feature 4)

Physics changes (Phases 1, 6 and 7) come first, because NPC speed is calibrated against them.

1. **Racing line.** Each track's centerline offsets are smoothed within ±(road half-width − margin), clipping apexes and using the full width (iterative minimum-curvature smoothing). It's computed once when the track is built, in the browser and in Node. Better drivers follow more of it. Traffic avoidance still offsets from it.
2. **Speed profile along that line:**
   - Corner speed is `sqrt( a_lat · R )`. A single `a_lat` factor is fitted by the sim.
   - The line keeps all four wheels off the kerbs, except where the fit finds that clipping an apex with one wheel is faster. Low-skill drivers wander onto kerbs more.
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
   - aggressive drivers lean on you, which is where spins and launches come from. Heavy aggressive NPCs lean hardest
   - no slowing when merely near another car
5. **In the air:** no steering correction until they land. After a wand trip they rejoin at full throttle.
6. **`npm run sim -- --fit`**: fits `a_lat` per track for the lowest skill-1 lap. Then `--calibrate` refreshes the `ai` tables in `js/Tracks.js`.
7. **Targets:**
   - Skill 1 laps at least 2% faster than the keyboard expert bot's best, on every track.
   - NPCs reach ≥ 97% of top speed on every straight of 3+ cells.
   - Soak test: 9 cars × 20 laps × 6 tracks: no permanently stuck car, no NaN. Wand trips are reported per track; only Bathurst's cliff should cause them.

## Phase 9: difficulty and balance

1. The new spread and skill-aware offset (D14). Rubber band: NPCs behind you push up to +6%, ones ahead ease off up to −3%. It was ±4%.
2. **First race on a track:** the re-aim discounts the standing start, so the first lap ×0.92 is treated as a flying lap.
3. **Targets** with keyboard bots against 4 NPCs, 2 races per track, on all 6 tracks:
   - **Expert:** wins about half its races, and loses the rest narrowly.
   - **Average:** usually 2nd–3rd (it won 8 of 8 before).
   - **Novice:** 3rd–5th, never lapped.
   - The touch schemes are run too.
4. Your own feel decides whether it's right. I'll hand over the numbers and recordings, and the spread constants are one line each in `js/Difficulty.js`.

## Phase 10: a fly-over before the race (Feature 6)

1. **When** (D16): after Race on the setup screen, before 3-2-1.
   - You and the NPCs sit on the grid. The simulation stays in its `grid` phase, so nothing in `Race.js` or the Node sim changes.
   - It's a new camera mode in `js/Camera.js`, driven from `main.js`.
2. **The path** (~5 s):
   - A high overview of the whole track (0.8 s).
   - A sweep along one lap on a smoothed spline through the centerline, heights included. The camera rides ~12–15 m up, behind a look point running ahead along the road.
     - Speed is constant, about track length ÷ 3.5 s: ~31 m/s on Classic, ~78 m/s on Suzuka.
     - The look direction is low-pass filtered, so corners don't whip the view.
     - On Bathurst it passes over the cliff top; on Suzuka, over the bridge.
   - A descent onto the chase camera behind your car (0.8 s), then the countdown.
3. **On screen:** the track name, its "inspired by" line and the lap count, plus "Tap or press any key to skip".
4. **Things to handle:**
   - The overview shows the whole track at once, so:
     - fog and the far plane are pushed out (`Camera.extraDistance`), and the shadow box fits the view as now
     - it costs more per frame than racing, so the automatic quality step-down ignores fly-over frames and its monitor resets at GO
   - The scenery is already in place, because Race waits for it (D8).
   - Rotating the device mid-fly-over goes through the usual resize path.
   - Skipping cuts straight to the chase camera.
5. **Playtests:** the race-flow bots skip it with a key. One run lets it play out, and checks that:
   - it ends exactly on the chase camera
   - no quality step-down happened
   - no page errors

## Phase 11: badges and the podium (Feature 7)

1. **Who gets a badge** (D17):
   - 3 or fewer cars in the race: only 1st, a gold badge.
   - 4 or more: gold, silver and bronze for 1st–3rd.
   - Time trial has none.
   - Badges are small generated medals: a coin with a ribbon and the place number, as inline SVG for the panel and a sprite in 3D.
2. **Results panel:** a medal before each badge-winning row; the winner's row is highlighted. Your row stays highlighted as now.
3. **The podium** (D18), in a new `js/Podium.js`:
   - **The scene:** a small separate one, rendered instead of the race while the results are up.
     - A round table (generated: a grey plinth with a gold rim, in the Starter Kit colormap) turns slowly with the winning car on it, under a spotlight, with a burst of confetti.
     - With three badges, 2nd and 3rd stand on lower round steps either side.
     - Each car on the podium has its badge floating above it.
   - **Cars still racing:** the race keeps simulating behind, as now. A step fills when its car crosses the line, so if you finish 1st, the 2nd and 3rd steps fill in as they arrive.
   - **Framing:** the podium sits in the part of the screen the panel leaves free: beside it on wide screens, above it on tall ones (the same split the setup screen uses).
   - **Low tier:** a blob shadow and less confetti.
   - "Race again" and "Change setup" go back to the race scene.
4. **Remembered medals:** your best finish per track (`kerb.medals`) shows as a small medal beside that track in the picker. Only places that earned a badge count: 2nd in a 3-car race earns nothing.
5. **Playtests:** races with 1, 2, 3, 4 and 8 opponents give the right badges. The podium renders in portrait and landscape, and fills in when the player finishes 1st ahead of the field.

## Phase 12: performance, load time, docs

- `npm run perf:load` on all four profiles: interactive ≤ 1 s on the average profile (0.44 s today), and critical-path bytes ≤ 0.7 MB.
- Frame benchmark for each tier × 0 / 8 NPCs × all 6 tracks. Low tier on the HD 630 at 1080p must stay ≤ 13 ms (11–12 ms today).
- Simulation step with mesh colliders, 8 NPCs, 4× CPU: p50 ≤ 2 ms, p95 ≤ 3.5 ms. Mesh contacts cost more than boxes; the slicing resolution is the knob.
- Playtests, all passing:
  - **New:** `cliff`, `crossing` (both passes counted, no snapping), `airtime` (time in the air per crest by bot skill), `occluder` (car visible under the bridge), `hits` (scripted hits at several speeds and mass pairs: shove, spin, launch, land on wheels or roof), `kerbs` (lap cost of riding the wall), `flyover`, `podium`, and per-class lap times.
  - **Existing:** the 121 current checks still pass.
- README: the two new tracks and what inspired them, the wand, weight classes, kerbs, the fly-over and badges, the kit credits (CC0, Kenney), and the new npm scripts.
- `ai/next_2.md`.

## Files

- **New:**
  - `js/Wand.js`, `js/Terrain.js`, `js/Scenery.js` (zones, landmarks, signage), `js/Occluders.js`, `js/Bend.js` (slice and bend pieces), `js/Podium.js`, `js/Kerbs.js` (wheel-on-kerb test and drag)
  - `js/SceneryList.js` (generated)
  - `models/<kit>/` (compressed) and `models/src/<kit>/` (originals plus licences)
- **Changed:**
  - `js/TrackPath.js`: heights, crossings, ordered centerline, racing line
  - `js/Tracks.js`: Bathurst, Suzuka, `heights` / `unsealed` / `scenery`, recalibrated `ai` tables
  - `js/Track.js`: bent pieces, bridges, generalised chunked instancing
  - `js/Physics.js`: mesh road and terrain colliders, sloped walls
  - `js/Race.js`: off-track states, the wand, last good spot, kerb drag per step
  - `js/Vehicle.js`: per-car handling, ground normal, air state and tumble
  - `js/CarCollisions.js`: mass from volume; shove / spin / launch by Δv
  - `js/AIDriver.js`, `js/Difficulty.js`: profile driving, kerb-aware line, new spread
  - `js/Camera.js`: height smoothing, fly-over mode
  - `js/SunShadow.js`, `js/DriftMarks.js`, `js/Particles.js`: heights, dust
  - `js/Audio.js`: chime, gravel, landing, kerb rumble
  - `js/Controls.js`: gamepad rumble and phone vibration on kerbs
  - `js/LapTimer.js`: new best-lap key (D20)
  - `js/Loader.js`, `js/Assets.js`: more kits
  - `js/Shell.js`, `index.html`: weight label, editor link hidden on new tracks, fly-over title card and skip, medals in the results and the track picker
  - `js/main.js`: scenery after interactive, probes after scenery, wand, occluders, fly-over, podium
  - `js/Tune.js`: hit thresholds, handling exponents, kerb drag
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
6. Phase 6: mass handling and hits (sim balance table, hit recordings).
7. Phase 7: kerbs (wall-riding cost per track).
8. Phase 8: NPC driving (calibration tables).
9. Phase 9: difficulty, on its own so it can be reviewed and reverted separately.
10. Phases 10–11: fly-over, badges and podium. Both are presentation only, so they can move earlier if you'd like to see them first.
11. Phase 12.

## What I can't verify here

- Whether the jumps, the cliff, the hits and the kerbs are fun, and whether each corner now looks recognisable. I'll hand over recordings and corner screenshots.
- How kerb vibration feels: gamepad rumble and phone vibration only work on real hardware.
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
