# Next 2: what plan_2 delivered, what it found, what's next

All measurements were taken on this machine: Intel HD 630 (Kaby Lake iGPU), headless Chrome with `--use-angle=gl-egl`. "Bots" are the playtest drivers in `scripts/playtest/`; "NPCs" are the game's AI drivers, also run headless in Node (`npm run sim`). Nothing is committed.

## Delivered

| Prompt item | Where |
|---|---|
| **1. Hills and valleys, airtime for fast cars** | Two new tracks. **Bathurst**: the Mountain Straight climb to 6 m, across the top, down the Esses, and the Hump on Conrod, which launches cars above 12.1 m/s (top speed ~14.6). **Suzuka**: the bridge ramps and a crest just past the bridge (above 14.1 m/s). Heights are straight ramps between cell centres with short rounded joins (`js/TrackPath.js` `Profile`). The pieces are bent to the profile (`js/Bend.js`), with hillside terrain around raised road (`js/TrackShape.js`) and triangle-mesh road and terrain colliders plus walls tilted to the slope (`js/Physics.js`). Cars sit on the slope; in the air they hold the nose along the flight path, steer at 30% and stop driving the sphere; landings squash the body |
| ↳ Unsealed road, drive off a cliff | Bathurst cells 12–14 (McPhillamy → Skyline) are gravel pieces (generated from the Starter Kit's: no walls, tan surface). There's no wall on the outside of the loop, a rock cliff below it, and a wall on the inside. Gravel is slippery (lower-friction collider) and slower (drag), with dust and a crunch |
| ↳ The magic wand | A car more than 1.5 m past the road's edge for 0.5 s, or 2 m below the road for 1 s, leaves the physics. A star wand with a beam and sparkles lifts it, flies it back to its last spot on the road (3 m back) and sets it down ghosted, with a chime. The race clock and everyone else keep going. The same wand handles stuck or wrong-way NPCs, cars on their roof, and the R key (`js/Race.js`, `js/Wand.js`) |
| **2. A track that crosses itself** | **Suzuka**, a figure-8: the back straight passes over the Degner–Hairpin link on a 3.5–4 m bridge with a deck and pillars. Layouts allow one crossing of two perpendicular straights (`checkLayout`), and centerlines are walked in driving order. The bridge and the finish arch fade to see-through when they'd hide your car (`js/Occluders.js`). Car contact ignores cars more than 1.2 m apart in height |
| **3. Buildings that make each place recognisable** | Six Kenney kits imported (`npm run kits`, `npm run models`; ~700 KB compressed, 2–30 KB a model). Generated: 7 Fantasy Town house prefabs (including a windmill and a watermill), the Racing Kit's colours baked to a palette, and gravel pieces. Each track lists zones along the lap (paddock, suburb, industrial, village, forest). Every turn gets a landmark nobody else on the track has, on its outside but never between the camera and the road, plus red-and-white chevron boards and 3-2-1 braking boards. Buildings face the road, merged per 4×4-cell chunk and kit. They load after the game is interactive; Race waits for them (`js/Scenery.js`) |
| **4. NPCs too slow** | New driver (`js/AIDriver.js`, `js/RacingLine.js`): a racing line (the centerline pulled tight within the road, wheels kept off the kerbs; inside on gravel), a speed profile, flat out on every straight. Skill shows in grip used, line taken, braking and mistakes. Skill-1 laps are 2–11% faster than plan_1's (Monaco 28.4 → 25.2 s, Monza 26.1 → 24.6 s). The field is aimed faster (0.95–1.12 × your best lap, was 1.0–1.18) |
| **5. Handling by mass, knock-overs** | Mass from model volume (karts 0.28, Formula 0.32, yellow truck 1, garbage truck 1.36, loader 1.43). Acceleration, coasting, braking and body wobble scale with it (`Vehicle.HANDLING`); top speed is the same for all. Hits: knocked aside, spun (> 4 m/s sideways Δv: 0.35 s without steering), or sent flying (> 9.5 m/s), tumbling to land on its wheels, side or roof depending on how far it turned over (the wand rights it). Δv comes from closing speed and the two masses only. The picker shows Light / Medium / Heavy |
| **6. Fly-over at the start** | ~5.4 s before a race from the setup screen: a high overview, a sweep along the lap, a descent onto the chase camera, and a title card. Any fresh key, tap or button skips it. Not on Race again or with reduced motion; no quality step-down from its wide views (`js/Flyover.js`) |
| **7. Badges and the round table** | ≤ 3 cars: one badge, else gold, silver and bronze, with medals in the results. The podium scene (`js/Podium.js`): the winner turning on a round table under a spotlight, 2nd and 3rd on steps, medals over them, confetti. It's framed beside the results panel on wide screens and above it on tall ones, and its steps fill as cars finish. Your best medal per track shows in the track picker (`kerb.medals`) |
| **8. Kerb friction** | Drag per wheel on the rumble strip or the red-and-white kerb (kerb ×2, ÷ √mass), with a rumble sound, body judder, gamepad rumble and Android vibration. Best laps restart (`racing.bestLap.v2.`): records set riding the wall for free can't be matched now |

Plan decisions D1–D20 were applied as written, except as noted under "Changes from the plan".

## Changes from the plan

1. **Hit thresholds:** spin at 4 m/s and launch at 9.5 m/s, not 2 and 5. With 2 and 5, the sim's 8-NPC races had ~19 launches and ~60 spins each. Now it's ~3 launches per race (about half ending on the roof). So the plan's example of a garbage truck at 8 m/s launching a kart now spins it instead; it takes ~10 m/s.
2. **The NPCs' speed profile has no braking to speak of.** `npm run sim -- --fit` found flat out fastest at every setting tried, even with a yaw-rate cap and 1.5× kerb drag. The sphere's grip lets cars corner faster than they need to brake. So skill shows as grip used (a novice dares ~16% of an expert's, so it does brake), line and steering.
3. **Indianapolis NPCs drive the centerline** (`aiLine: 0`): the tight inside line at full speed cost them 8%.
4. **Height profile:** straight ramps with rounded joins instead of a monotone cubic. The cubic rounded crests so much that nothing could leave the ground below top speed.
5. **Difficulty additions after the race playtests:**
   - a novice lean of +6% (−3% for experts)
   - pace from a measured curve: cutting a skill-0 NPC's top speed adds far less lap time than proportional
   - pace down to 0.45
   - a first race on a track aimed at par × 1.06, since it only re-aims after your first lap
6. **Not built:** the ferris wheel (optional); a per-class NPC start factor (the classes are within ~2%, so it wasn't needed); separate `airtime`, `hits` and `occluder` playtests. Those are covered by sim scripts and screenshots instead. "Edit this track" is replaced by "Create new track" on Suzuka and Bathurst, rather than hidden.

## Measurements

### Load time (cold, `wrangler dev`, `npm run perf:load`, `--query '?track=…'`)

| Profile | Classic | Bathurst | Suzuka | next_1 (Classic) |
|---|---|---|---|---|
| 25 Mbps / 40 ms | **0.46 s** | 0.71 s | 0.70 s | 0.44 s |
| + 4× CPU | 0.88 s | 1.69 s | 1.75 s | 0.74 s |
| 10 Mbps / 100 ms | 0.91 s | 1.14 s | 1.13 s | 0.76 s |
| + 4× CPU | 1.22 s | 2.08 s | 2.09 s | 1.07 s |

- Within the spec everywhere (≤ 3 s); about 0.7 MB on the critical path.
- The hilly tracks build terrain, bent pieces and mesh colliders at load: ~80 ms for the bend and ~70 ms for shape and colliders on this machine. Their longest task is ~1 s at 4× CPU.
- Done here to cut that:
  - the terrain build dropped from 56 to ~18 ms
  - only cells whose gradient changes are sliced, which took the bend from 145 to 80 ms
- Scenery (up to 57 models, ~450 KB on Monaco) and the probe bake come after interactive.
- The offline file is 3.88 MB (was 2.34).

### GPU frame cost (`npm run bench -- --tiers low,medium --npcs 8 --parts`, setup screen)

| Track | low 1366×768 | low 1080p | medium 1366×768 | medium 1080p |
|---|---|---|---|---|
| Classic | 10.9 | 11.3 | 17.9 | 26.5 |
| Monaco | 10.5 | 11.4 | 16.7 | 25.3 |
| Suzuka | 10.7 | 12.2 | 20.6 | 32.1 |
| Bathurst | 11.1 | 12.4 | 20.0 | 31.3 |

- **Low tier:** the HD 630's default, as in next_1 (10.3–12.1 ms). Scenery costs ≤ ~1 ms there.
- **Medium:** hiding the scenery saves 1–6 ms; the hilly tracks cost 3–6 ms more than Classic. The bent road is now chunked so off-screen parts are culled (that took Suzuka 1080p from 36.8 to 32.1 ms).
- Run-to-run noise is about ±1 ms.

### Simulation

- **Soak** (9 NPCs × 8 laps × 6 tracks × 2 seeds): every car finishes. 0.15–0.19 ms per step on the flat tracks, 0.26–0.29 on the hilly ones (mesh colliders).
- **Calibration** (`--calibrate`, median over 5 seeds), NPC lap at skill 0 / 0.5 / 1 (s):

  | Track | Skill 0 | Skill 0.5 | Skill 1 |
  |---|---|---|---|
  | Classic | 18.1 | 13.5 | 11.4 |
  | Indianapolis | 16.9 | 14.6 | 13.8 |
  | Monza | 35.8 | 29.4 | 24.6 |
  | Monaco | 41.9 | 33.4 | 25.2 |
  | Suzuka | 44.0 | 33.5 | 29.7 |
  | Bathurst | 41.0 | 34.5 | 27.3 |

- **Weight classes** (`--classes`, skill 1, 5 seeds): a spread of 0.3–1.7% on most tracks, wider on Classic and Suzuka (a different car is slowest on each, which looks like noise). The fastest class differs by track: kart on Classic, ambulance on Suzuka.

### Playtests

- **Full suite** (19 scenarios): everything passed except `custom-tracks`. On a custom track that isn't a closed loop the scenery planner crashed; that's fixed, and the scenario passes since.
- **Quick scenarios rerun after the final changes** (race-flow, flyover, cliff, podium, custom-tracks, offline-file, framerate): all pass.
- **Pars** (average keyboard bot's best lap): Classic 14.8, Indianapolis 16.4, Monza 32.5, Monaco 37.2, Suzuka 40.2, Bathurst 33.6 s.
- **Kerbs:** the expert bot (never brakes, slides wide) loses 4.4–8.4% a lap to them, depending on the run.
- **Races** against 4 NPCs, finishing positions (race 1, race 2). The last run, with the final difficulty settings, covered Classic, Monaco and Bathurst; the other three come from the run before the novice changes.

| Track | Novice | Average | Expert |
|---|---|---|---|
| Classic | 5th, 2nd | 1st, 2nd | 1st, 1st |
| Monaco | 4th, 3rd | 2nd, 2nd | 1st, 3rd |
| Bathurst | 5th, 5th | 3rd, 3rd | 1st, 5th |
| Indianapolis (before) | 5th, 5th | 1st, 2nd | 1st, 2nd |
| Monza (before) | 5th, 5th | 2nd, 3rd | 1st, 2nd |
| Suzuka (before) | 5th, 5th | 3rd, 4th | 1st, 1st |

Against plan_2's targets:
- **Expert:** wins about half ✓.
- **Average:** usually 2nd–3rd ✓.
- **Novice:** 3rd–5th, never lapped ✓, but often 5th. The novice changes brought the gaps from 9–39 s down to about 6–21 s.

## Balance findings that need your call

1. **Braking doesn't pay.** Flat out with steering is the fastest way round every track, for NPCs and bots alike; the kerbs only punish sliding wide. If braking should matter, the fix is in the handling (less sphere grip, or a speed loss on hard steering), not in the AI.
2. **Kerb strength:** 4–8% a lap for a wall-sliding expert at `SURFACE.kerb = 0.8`. `?tune` has the knob.
3. **The novice end:** much closer than before, but a novice still often finishes last, and Bathurst's cliff costs the novice bot as much as the field. Options:
   - a stronger novice lean (+9%)
   - fewer NPCs by default (4 → 3)
4. **Hit frequency:** ~3 launches per race with 8 NPCs at launch 9.5 m/s. Try it in `?tune` (launch at, tumble) and see if it's too much or too little.
5. **Mobile and medium:** the hilly tracks cost 3–6 ms more on medium. If phones that start on medium struggle, the first lever is thinning the scenery's second ring on medium.

## Not done / known issues

1. **Real devices:** nothing here checks phone fps with scenery and 8 NPCs, vibration, or the podium and fly-over on real portrait screens.
2. **The race matrix** with the final difficulty settings covered only Classic, Monaco and Bathurst. Run `npm run playtest -- --scenario race --race-tracks indianapolis,monza,suzuka` to confirm the rest.
3. **Medium-tier light probes** now bake after the scenery loads, behind the setup screen. Until then medium looks like low (hemisphere light only). A very quick Race click on medium waits for it.
4. **The editor** has no hills, gravel or crossings.

## Next

1. **Deploy and try it on real phones** (`npm run deploy`, then `npm run perf:load -- --url <live url>`), on Suzuka and Bathurst especially.
2. **Your calls** on balance findings 1–4.
3. If phones struggle, a low-tier scenery setting (skip ring-2 buildings, no building shadows).
4. **Editor support for heights and crossings**, if you want user-made hill tracks: the `?map=` codec needs a version byte and a height per cell.
