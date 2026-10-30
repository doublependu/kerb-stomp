# Next 3: what plan_3 delivered, what it found, what's next

All measurements were taken on this machine: Intel HD 630 (Kaby Lake iGPU), headless Chrome with `--use-angle=gl-egl`, 8 cores. "Bots" are the playtest drivers in `scripts/playtest/`; "NPCs" are the game's AI drivers, run headless in Node (`npm run sim`). "Before" is the committed code (commit 5f5749a), measured the same way in a scratch worktree. Nothing is committed.

## Delivered

| Prompt item | Where |
|---|---|
| **1. A better best AI driver** | New steering for every NPC (`js/AIDriver.js`): it steers the car's direction of travel onto the line, with the slip the sphere needs through a turn. Each built-in track has a racing line found by the physics (`npm run sim -- --optimize`, saved in `js/RaceLines.js`). The best NPC is 17–28% faster and repeats its laps to within 0.1% on most tracks. The aces hold a per-track lap 10% under plan_2's best NPC, and race harder in traffic |
| **2. Assets on the track** | Every scenery footprint stays 0.3 m outside the walls' outer face, measured against both roads at Suzuka's crossing (`js/Scenery.js`). `npm run tracks` fails on any that doesn't. Before: 20 items reached onto the road and 21 hung over a wall |
| **3. Less scenery, one theme per track** | One theme per track: Indianapolis stadium, Monza village, Monaco suburb, Suzuka industrial, Bathurst and Classic forest. Each track also keeps a small Racing Kit paddock at the start/finish. 33–44% fewer items. Every turn has its own landmark from the theme, 21 of them new prefabs built from kit parts |
| **4. A slower aerial fly-over** | 8 s (`js/Flyover.js`): 1.2 s nearly overhead under the name card, a 150° orbit lowering from 70° to 40°, then 1.5 s down onto your car. The whole track stays on screen on a laptop and on a portrait phone |

### 1. The AI

**The yardstick** (`npm run sim -- --ace`). For each track it reports:
- the best NPC alone, with its kerb time, launches and wand carries;
- the same driver in the kart, the loader and the Formula;
- where slow laps lose time, cell by cell;
- the aces in a first race with 4 and 8 NPCs;
- a wall-riding probe.

**Steering** (phase 2). Pure pursuit is gone. The new controller works in three steps:
1. **How fast the direction of travel should turn.** That's the line's curvature × speed, read 0.45 s ahead, plus feedback that turns the travel direction back onto the line.
2. **Where the nose should point.** The sphere slides through a turn, so the nose has to lead the travel. It leads by the slip that turn rate takes at full throttle, which I measured on open ground: 0.3 rad at 0.4 rad/s up to 1.3 rad at 4 rad/s, and the same for every car mass.
3. **The steering input** that turns the nose there.

The gains come from a grid search over all six tracks with a truck, a kart and the loader (`npm run sim -- --steer`): `STEER = { gain: 2, track: 1, lead: 0.45, preview: 0.15, yaw: 7 }`. Skill 1 has no steering noise. Lower skills keep their lag, noise and share of the line.

**Lines** (phase 3). Each line has control points every 3 m (37 on Classic, 91 on Suzuka), joined by a Catmull-Rom spline and bounded 0.375 m inside the wall faces, plus optional speed caps. The search:
- a (1+16) evolution strategy over 2,000 candidates per track, on 8 worker threads (`scripts/sim/optimize-worker.mjs`, `pool.mjs`);
- each candidate drives 2 seeds × the yellow truck and a kart, with a little steering wobble so the line holds up off its exact path;
- the score is the mean flying lap, plus 0.5 × the lap spread and 3 s per wand carry.

Runs took 7–17 minutes a track. Suzuka and Bathurst were re-run with a step-size restart after the first run stalled.

| Track | Start line | Optimized (with wobble) | Speed caps kept | Furthest from centre |
|---|---|---|---|---|
| Classic | 8.84 s | 7.99 s (−9.6%) | – | 1.8 m |
| Indianapolis | 11.58 s | 11.35 s (−1.9%) | – | 1.9 m |
| Monza | 19.67 s | 17.64 s (−10.3%) | – | 2.7 m |
| Monaco | 21.55 s | 18.22 s (−15.5%) | – | 3.0 m (the wall) |
| Suzuka | 24.18 s | 24.04 s (−0.6%) | 7 (12–14.6 m/s) | 1.1 m |
| Bathurst | 22.35 s | 21.52 s (−3.7%) | – | 2.4 m |

The search was allowed onto the kerbs and up to the walls (D3), but it only leans on the wall in one place, on Monaco. Most of the gain came from the steering: following a line exactly instead of cutting across it.

**The best NPC alone** (skill 1, yellow truck, 5 seeds × 5 laps), against D1:

| Track | Before: median (best–worst) | Now: median (best–worst) | Change | Spread now (before) | Kart / loader / Formula |
|---|---|---|---|---|---|
| Classic | 11.25 (10.87–12.48) | 8.07 (8.07–8.07) | −28% | 0.0% (14%) | 7.92 / 8.08 / 8.00 |
| Indianapolis | 13.80 (13.75–13.85) | 11.42 (11.42–11.43) | −17% | 0.1% (0.7%) | 11.32 / 11.47 / 11.35 |
| Monza | 24.60 (24.07–26.98) | 17.80 (17.78–17.80) | −28% | 0.1% (12%) | 18.33 / 17.88 / 18.73 |
| Monaco | 25.17 (24.83–26.78) | 19.42 (18.35–19.48) | −23% | 5.8% (7.7%) | 18.10 / 19.07 / 18.22 |
| Suzuka | 29.63 (27.15–31.90) | 24.33 (23.45–24.77) | −18% | 5.4% (16%) | 24.35 / 24.88 / 24.88 |
| Bathurst | 27.27 (26.22–30.42) | 22.02 (21.68–22.13) | −19% | 2.0% (15%) | 22.33 / 22.48 / 22.58 |

- **D1, ≥ 8% faster:** met everywhere, by 17–28%.
- **D1, laps within 3%:** met on four tracks.
  - Monaco's spread comes from one fast outlier lap (18.35 s); the other laps sit at 19.4–19.5 s.
  - Suzuka's comes from its crest launches: 1.44 a lap, down from 1.93.
- **Kerbs:** a wheel is on them 6–20% of the time, down from 30–38% by the same measure. The plan's 7–15% counted only some of that.
- **Bathurst launches more than before:** 2.4 a lap against 1.6 (2.0–2.6 across the four cars). It never leaves the road over them, and nothing needed the wand on any track or car.

**The aces' racecraft** (phase 4):
- **Traffic:** they look for slower cars up to 25 m ahead (depending on the closing speed), pick the nearest one in their line's path, pass on the inside of the turn after it, and keep that side until they're past.
- **Room:** they leave 1.4 m centre to centre when passing.
- **No lifting:** they never lift when blocked. But closing at over 2 m/s right behind a car, they coast instead of hitting it, because those hits spin both cars.
- **The start:** they keep their grid lane for 2 s after GO, and they don't turn into a car alongside.

All NPCs now pass the nearest car ahead. Before, they took the first match in list order, so their pass target kept switching.

**The aces' lap 1 in a first race** (median over 5 seeds, against the same driver's lap 1 alone):

| Track | 4 NPCs: ace / second ace | 8 NPCs: ace / second ace | Before, 4 NPCs | Before, 8 NPCs |
|---|---|---|---|---|
| Classic | +2.2 / +0.9 s | +3.9 / +1.1 s | +1.8 / +1.3 | +4.3 / +2.1 |
| Indianapolis | +0.4 / +1.0 | +4.1 / +1.4 | +1.1 / +1.3 | +4.4 / +1.9 |
| Monza | −0.8 / +0.1 | +2.1 / +1.5 | +4.5 / +3.1 | +5.4 / +3.8 |
| Monaco | +0.5 / +0.1 | +3.1 / −0.3 | +2.3 / +1.6 | +4.3 / +2.3 |
| Suzuka | +0.7 / −0.1 | +2.4 / +1.7 | +1.3 / +1.6 | +1.5 / +2.1 |
| Bathurst | +0.3 / +1.8 | +0.6 / +3.9 | +0.3 / +0.3 | +4.7 / +1.8 |

- **D1's "within 1 s":** met in 9 of 12 cases with 4 NPCs. With 8 NPCs, only 2 of 12 (+0.6 to +3.9 s).
- **The cost:** the first ace starts last but one, behind up to six cars lapping 40–70% slower. Contact in that pack still spins it now and then.
- **Race time:** the first ace's race (4 NPCs) is 5–11 s shorter than before (Classic 61.2 → 56.4 s, Monaco 54.6 → 46.3 s, Indianapolis 74.3 → 63.3 s).

### 2–3. Scenery

| Track | Items before → now | Kits before → now | Download before → now | Too close to the road before → now |
|---|---|---|---|---|
| Classic | 4 → 4 | 3 → 1 | 85 → 102 KB | 1 within 0.3 m → 0 |
| Indianapolis | 73 → 49 | 5 → 1 | 338 → 80 KB | 3 over a wall, 1 near → 0 |
| Monza | 90 → 59 | 4 → 2 | 372 → 245 KB | 1 on the road, 2 near → 0 |
| Monaco | 145 → 81 | 5 → 2 | 631 → 368 KB | 2 on the road, 2 over a wall, 2 near → 0 |
| Suzuka | 164 → 106 | 5 → 2 | 364 → 303 KB | 8 / 6 / 4 → 0 |
| Bathurst | 206 → 120 | 6 → 2 | 396 → 155 KB | 9 / 10 / 5 → 0 |

(Download: the models the plan uses plus their colormaps; it loads after the game is interactive. The second kit everywhere but Classic is the Racing Kit for the paddock.)

- **Clearance** (`js/Scenery.js`):
  - Each item's footprint is its rotated box at its placed scale, measured against every segment of the centerline.
  - An item that doesn't fit moves toward its cell's centre, then shrinks to 80%, else it's dropped.
  - A landmark tries its other candidate cells first, then shrinks as far as it must.
  - The planner takes 1–6 ms a track.
- **Themes** replace the zones (`THEMES`, `track.theme`). Each has its buildings, props, low props (the camera's side), landmarks, ground colour, hillside props and ring density. Densities: village and forest 0.25 / 0.15, suburb 0.6 / 0.4, stadium and industrial 0.45 / 0.3. Each cell gets 1–3 props.
- **The paddock** at the start/finish has at most 6 Racing Kit items: grandstands and pits, with barriers on the camera's side.
- **Landmarks:** one per turn, no repeats, all from the track's own theme (Classic 4, Indianapolis 3, Monza 5, Monaco 9, Suzuka 7, Bathurst 5):
  - **Forest:** a lookout on a rock, a roofed tree house with ladders, two platforms and a rope bridge, a camp, an archery range, a rock pile.
  - **Village:** the windmill, the watermill, the tower, a market, a fountain square.
  - **Suburb:** five big houses, each in its own colour variation, plus a terrace of three, a house in its garden and a little park.
  - **Industrial:** the large chimney, the water tower, a wind farm, a tank farm, a works with chimneys, and the three tallest buildings.
  - **Stadium:** a round covered grandstand, a race control tower, a start gantry.
- **Models** (`scripts/models.mjs`): the kits now list `parts`, which are only built into prefabs and not shipped. The prefabs are composed from parts placed by footprint centre (`COMPOSITES`). The City Kit Roads kit is no longer used. The industrial hills use the Racing Kit's trees, since that kit has none.
- **Review stills:** the new `scenery` playtest saves each track from above and every turn from straight above, once the scenery has loaded (`window.__kerb.view`).

### 4. The fly-over

- **Framing:** the camera aims at the track's centre from the distance that keeps all eight corners of the track's box inside 92% of the view, recomputed each frame from the camera's fov and aspect.
- **Ground:** while it flies, a grass plane runs to the horizon and a haze starts just beyond the scenery. Before, the ground tiles ended a few cells out and the grey background showed at the lower angles.
- **Shadows:** the sun's shadow box covers the whole track while it flies.
- **Rotation:** a phone rotation mid-flight keeps its view.
- **Unchanged:** any key or tap skips it, and reduced motion and Race again leave it out.
- **Playtest `flyover`, laptop and portrait phone:** the track's box is on screen at 0.6, 3.6 and 6.2 s (furthest corner at 0.92–0.93 of the half-screen), it lasts 8.0 s, it lands behind the player, with no quality step-down and no errors.

## Changes from the plan

1. **The aces hold a per-track lap** (`ace` in `js/Tracks.js`) instead of the new best NPC lap. The best NPC now laps 17–28% under plan_2's, so aces at full strength would make the first race unwinnable for anyone. `ace` is 10% under plan_2's best NPC (Classic 10.2 s, Monaco 22.7 s), which clears D1's 8%. The second ace is 5% slower. Lowering `ace` toward `ai[ 4 ]` makes them harder. Aces now also get lap correction toward that fixed target.
2. **Editor tracks get the least-curved line, not the elastic band.** The band hugs the inside kerb round 90° corners (a 1.75 m radius). Pure pursuit cut across it; an exact follower can't. With the new steering it lapped Classic in 16.75 s against 8.80 s for the smooth line. It's 800 sweeps at load, a few ms.
3. **`aiLine` is gone.** Indianapolis no longer needs the centerline: the smooth line was 6% faster there before optimizing.
4. **The novice end of skill.** With the new steering, a skill-0 NPC lapped Classic in 12.5 s (it was 18.1 s), so every NPC aimed at an average player would have sat at skill 0 with its top speed cut.
   - The novice's grip is now 0.2 (was 0.4), and grip is blended by its inverse, so lap times spread evenly over skill. Classic now runs 16.2 / 12.9 / 10.7 / 8.7 / 8.1 s across skill 0–1.
   - `lean()` now goes by par (full novice lean at par, full expert lean at 0.78 × par) instead of the NPC skill scale. Behind the new NPCs, that scale would call every human a novice.
5. **The wall-rider probe.** The first "before" run (Classic 9.37 s, faster than plan_2's best NPC) actually hugged the inside wall with pure pursuit, through a sign slip. The plan's version (the outside wall, new steering) laps 12.3–32.4 s, slower than the optimized NPC everywhere. Neither is a good stand-in for you.
6. **The steering search and the lines took longer than estimated.** The first optimizer run stalled at its smallest step on Suzuka. It now restarts wide when stuck.
7. **Balance stand-ins.** `--balance` now drives stand-in players at a share of par: 1.1 for a novice, 0.91 average, 0.8 expert (what plan_2's skills 0.2 / 0.5 / 0.9 lapped at), and 0.75 for a player who beat plan_2's aces by 4 s. NPC skill no longer means human skill.
8. **The fly-over's horizon plane and haze** weren't in the plan.

## Measurements

### Calibration (`--calibrate`, 5 seeds), NPC lap at skill 0 / 0.25 / 0.5 / 0.75 / 1 (s)

| Track | Now | Before |
|---|---|---|
| Classic | 16.17 / 12.87 / 10.72 / 8.70 / 8.07 | 18.08 / 15.77 / 13.53 / 12.53 / 11.35 |
| Indianapolis | 20.07 / 17.07 / 14.10 / 11.70 / 11.42 | 16.9 / 15.33 / 14.58 / 14.07 / 13.8 |
| Monza | 37.57 / 33.27 / 26.27 / 20.18 / 17.78 | 35.75 / 31.87 / 29.43 / 27.9 / 24.6 |
| Monaco | 40.48 / 33.15 / 26.87 / 22.88 / 19.33 | 41.93 / 38.0 / 33.37 / 27.32 / 25.18 |
| Suzuka | 41.45 / 34.45 / 27.80 / 25.20 / 24.15 | 43.97 / 39.03 / 33.47 / 32.15 / 29.67 |
| Bathurst | 41.62 / 30.88 / 24.58 / 22.75 / 22.65 | 40.97 / 36.5 / 34.45 / 31.08 / 27.27 |

`PACE_CURVE`, re-measured on all six tracks at skill 0 (median): pace 0.85 → 1.045× the lap, 0.7 → 1.21×, 0.55 → 1.39×, 0.45 → 1.60×. It was 1.04 / 1.1 / 1.26 / 1.5, measured on Monaco only.

### Balance (`--balance --seeds 4`, 4 NPCs): finishing positions, mean over 4 races

| Track | Race 1: novice / average / expert / 0.75 × par | Race 2: novice / average / expert / 0.75 × par | Before, race 1: nov / avg / exp | Before, race 2 |
|---|---|---|---|---|
| Classic | 3.3 / 3.0 / 3.0 / 2.8 | 2.8 / 3.5 / 4.3 / 3.8 | 3.3 / 3.0 / 2.3 | 3.8 / 2.5 / 3.8 |
| Indianapolis | 3.0 / 3.0 / 2.3 / 1.3 | 2.8 / 2.3 / 3.5 / 3.0 | 3.0 / 2.3 / 1.5 | 1.8 / 2.3 / 2.0 |
| Monza | 3.0 / 3.0 / 3.0 / 3.0 | 2.3 / 3.0 / 3.5 / 3.0 | 3.0 / 3.0 / 3.0 | 1.0 / 2.3 / 1.8 |
| Monaco | 3.0 / 3.0 / 3.0 / 3.0 | 2.0 / 3.3 / 2.8 / 2.5 | 3.0 / 3.0 / 2.3 | 1.3 / 2.3 / 2.3 |
| Suzuka | 3.0 / 3.0 / 3.0 / 3.0 | 2.0 / 2.3 / 2.5 / 2.8 | 3.0 / 2.8 / 2.0 | 1.5 / 3.0 / 3.5 |
| Bathurst | 3.5 / 3.0 / 2.8 / 2.5 | 3.0 / 2.3 / 2.3 / 2.5 | 3.5 / 3.3 / 2.3 | 1.0 / 2.0 / 4.3 |

- **Race 1:** the two aces take 1st and 2nd almost every time.
  - First-race wins: the expert won 5 of 24 before and wins none now. The 0.75 × par stand-in wins 4 of 24: 3 on Indianapolis and 1 on Bathurst.
  - It finishes 4–14 s behind elsewhere (Classic 4.8 s, Monaco 13.9 s).
- **Race 2** (no aces, aimed at your best lap) is about where it was. Faster stand-ins do no better than slower ones, as before. The novice no longer wins every race 2 on Monza and Bathurst (plan_2's code: 4 of 4 there).

### Soak (`--soak --laps 8 --seeds 2`: 9 NPCs × 8 laps × 6 tracks × 2 seeds)

All 108 cars finished. 20 wand carries and 17 launches in 12 races. 0.16–0.30 ms per step (before: 0.15–0.29).

### Load time (cold, `wrangler dev`, `npm run perf:load`)

| Profile | Classic now | Bathurst now | Bathurst before |
|---|---|---|---|
| 25 Mbps / 40 ms | 0.47 s | 0.67 s | 0.62 s |
| + 4× CPU | 0.89 s | 1.46 s | 1.47 s |
| 10 Mbps / 100 ms | 0.86 s | 1.03 s | 1.02 s |
| + 4× CPU | 1.25 s | 1.78 s | 1.77 s |

No change, and within the spec. `js/RaceLines.js` is 4 KB (1.3 KB gzipped). The offline file is 4.22 MB (was 3.88): it inlines every theme's models.

### GPU frame cost (`npm run bench -- --tiers low,medium --npcs 8`)

- **No measurable change.** On the setup screen both builds draw the same number of calls and triangles (Classic 171 vs 173 calls, 0.59 M triangles; Monaco 155 vs 151 calls, 0.19 vs 0.18 M triangles). An in-page timing of the same frame matched to 0.2 ms.
- **The benchmark itself drifted** by 2–4 ms between runs this session: the CPU was busy with the sims and the iGPU heats up. Run after the old build, the new one looked 3 ms slower. Run first, it looked 0.5 ms faster on Classic (10.3 vs 10.8 ms low, 17.4 vs 17.9 medium) and 1.4–2 ms slower on Monaco (10.8 vs 9.4, 17.7 vs 15.7).

### Playtests

PLAYTEST_RESULTS

## Your calls

1. **How hard should the first race be?** By my estimate, a player who beat plan_2's aces by 4 s now loses by about 5 s on Classic. Race the first race again on the track you won by 4 s.
   - Too hard: raise its `ace` in `js/Tracks.js` (a slower lap).
   - Still easy: lower it toward `ai[ 4 ]`, the best NPC, or try D5's front row for the aces.
2. **Aces in a big field:** with 8 NPCs they still lose 1–4 s on lap 1 starting from the back. Options: the front row (D5's next lever), or slower NPCs moving off the line when an ace closes in.
3. **Themes:** see the `scenery` stills (`npm run playtest -- --scenario scenery`). The picks are D6's, and the landmark prefabs were composed blind from the kits' parts, so a few may want nudging.
4. **Bathurst launches:** NPCs leave the ground 2.4 times a lap (was 1.6). A launch penalty in the optimizer would bring that down, at a cost in lap time.

## Not done / known issues

1. **Real phones:** the fly-over framing on a real portrait screen and the frame rate with the whole track in view are untested.
2. **Monaco and Suzuka lap spread** is 5–6% (D1 asks for 3%): one outlier lap on Monaco, crest launches on Suzuka.
3. **The race 2 inversion** (faster stand-ins placing no better) was there before; its cause isn't diagnosed.
4. **The optimizer** searched with the truck and a kart. The Formula is 5% slower than the truck on Monza's line.
5. **The editor** has no themes (its tracks get the forest's landmarks), no hills and no crossings.

## Next

1. **Race the first race** on your 4-second track and tell me the HUD's best lap. I'll set each track's `ace` from it.
2. **Deploy and try it on a phone:** the fly-over, and Suzuka and Bathurst's frame rate.
3. **Lap 1 for the aces in big fields**, if you see them stuck behind the pack.
4. **A second optimizer pass** on Monaco and Suzuka with a heavier spread penalty, and on Bathurst with a launch penalty.
