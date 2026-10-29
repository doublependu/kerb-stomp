# Next 1: what plan_1 delivered, what it found, what's next

All measurements were taken on this machine: Intel HD 630 (Kaby Lake iGPU) through headless Chrome with `--use-angle=gl-egl`. "Bots" are the playtest drivers in `scripts/playtest/`; "stand-ins" are AI drivers racing in the headless Node sim.

## Delivered

| Prompt item | Where |
|---|---|
| Touch: fixed joystick; drag sets direction, drag further to go faster | `js/Controls.js`. Centred low on the screen, always drawn, 60 px range with a 15% dead zone. Lifting your thumb coasts. |
| Touch: two pads (left steers, right accelerates and brakes) | `js/Controls.js`. Bottom corners, 50 px range. Each pad tracks its own finger, and sliding the right pad down brakes, then reverses. The scheme is picked on the setup screen and in the pause menu (touch devices only). |
| NPCs with every Car Kit car | 4 Starter Kit trucks + 25 Car Kit vehicles = 29 cars (`models/cars/`, `js/CarList.js`). Opponents get random cars: no duplicates, never yours. |
| You pick your car first | The car grid opens on a first visit. Thumbnails come from `sprites/cars.webp` (41 KB). |
| Cars drive the same and differ only in size | Every car has the same drive sphere. Car-to-car contact uses each model's footprint, with mass ∝ area (`js/CarCollisions.js`). |
| Car-to-car collisions | Impulse, friction and a yaw kick (off-centre hits spin cars), plus sounds, camera shake, smoke and flying debris. |
| Opponent count 0–8, default 4 | Stepper on the setup screen and in the pause menu. 0 = the old time trial. |
| Some NPCs better than you, some worse, beatable | `js/Difficulty.js` + `Race.aimField`; see Difficulty below. |
| 3 more tracks, named after real circuits | Indianapolis, Monza, Monaco (`js/Tracks.js`), plus Classic. Corner order checked against track guides; see Tracks. |
| next_0: cut iGPU cost of trees and shadows | Decorations instanced in 4×4-cell chunks, shadow box fitted to the view, Lambert shading on low. |
| next_0: compress the 940 KB of models | meshopt + quantization: the Starter Kit models went 940 KB → 153 KB; Car Kit cars are 15–33 KB each. |

Also new:
- **Race mode:** a grid, a 3-2-1 countdown, positions, a results table, and "Race again" / "Change setup".
- **Pause menu:** restart, reset car (also the R key), car and track, opponents, controls.
- **`npm run sim`:** whole races headless in Node, for calibration, soak tests and balance.

Plan decisions D1–D14 were applied as written.

## This session (after `ai/handover.md`)

1. **The `race` playtest crash was a scenario bug.**
   - The scenario read the race's lap count before the race had lined up, so it got the time-trial default of 3 instead of Classic's 5. The bot stopped after 3 laps, the car sat at lap 4, and the next "Race again" Enter landed on a game still in progress.
   - Fixed: each race now starts with Enter, waits for the countdown, then reads the lap count. A failed race is recorded as a check and the matrix carries on; before, one failure lost the whole report.
   - The results screen now comes up from the game loop 1.2 s of race time after you finish, instead of from a one-shot timer that gave up if the game was paused at that moment.
2. **The field is re-aimed before every race.** "Race again" used to keep the targets planned for the first race, so the field never followed your new best lap. That was against D2, and it isn't how the Node balance sim was set up.
   - `planField` now returns pace factors (target ÷ reference). `Race.aimField( reference )` turns them into targets and restarts each NPC's skill and pace from the track's calibration.
   - It runs on every line-up, aimed at your best lap, or at par before you have one.
3. **Your first race on a track adapts to you (handover issue 2).** While the field is aimed at par, your first lap re-aims it in either direction, and each better lap after that re-aims it again. Later races stay aimed at the best lap they started from. Re-aiming mid-race in every race would make each lucky lap ratchet the field faster; in the sim the difference was small, so I kept the simpler rule.
   - Before: an expert bot won its first Classic race by a lap.
   - Now: nobody laps the field in a first race except an expert stand-in on Classic, in 2 of 6 sim races.
4. **`npm run sim -- --balance`** now plays the game's flow: race 1 from par, then race 2 from the best lap of race 1, with the same cars. It reports wins, gaps, being lapped and lapping others.
5. **Bot fixes.**
   - Bots no longer count the countdown as "stuck". Holding W against the start lights tripped the stuck detector once per race.
   - Wall-hit counts reset for each race.
   - A failed video save no longer crashes the runner before the report is written.
6. **New tools.**
   - `npm run bench -- --step --cpu 1,4`: the step and frame time while racing, under CPU throttle.
   - `?tune`: a lil-gui panel for the contact knobs (restitution, friction, yaw kick, mass exponent, speed loss) and NPC aggression. It loads only when asked for and isn't in the offline file.
7. **Tracks:** I checked Monza's and Monaco's corner order against track guides and corrected the claim in `js/Tracks.js` (see Tracks below).

## Measurements

### Load time (cold cache, `wrangler dev`, `npm run perf:load`)

| Profile | Interactive | Transferred | next_0 |
|---|---|---|---|
| 25 Mbps / 40 ms | **0.44 s** | 0.60 MB | 0.57 s, 1.26 MB |
| 25 Mbps + 4× CPU | 0.74 s | 0.51 MB | 0.89 s |
| 10 Mbps / 100 ms | 0.76 s | 0.56 MB | 1.28 s |
| 10 Mbps + 4× CPU | 1.07 s | 0.59 MB | 1.46 s |

Faster than plan_0 on every profile, even though the game now has 29 cars. Only the track, decorations and your own car are on the critical path. Opponents load behind the setup screen, and the Race button reads "Getting ready…" until they arrive. The offline file is 2.34 MB.

### GPU frame cost (`npm run bench`, setup screen, behind the grid)

An empty scene measures ~7 ms at 1080p in this headless setup, so read these relative to that.

| Track, NPCs | low 1366×768 | low 1080p | medium 1366×768 | medium 1080p |
|---|---|---|---|---|
| Classic, 0 | 10.0 | 9.0 | 14.6 | 23.6 |
| Classic, 8 | 10.3 | 10.8 | 17.1 | 25.1 |
| Monaco, 0 | 8.4 | 11.3 | 14.8 | 23.0 |
| Monaco, 8 | 11.2 | 12.1 | 15.7 | 24.5 |

What each part costs on low, Monaco, 8 NPCs, 1080p (11.2 ms in that run):

| Part removed | Saves |
|---|---|
| decorations | 2.4 ms |
| shadows | 2.6 ms |
| cars (all 9) | 1.9 ms |
| track | 0.6 ms |

- The plan's targets for the HD 630 at 1080p (low ≤ 8 ms, medium ≤ 14 ms) **were not met**. Low has plenty of headroom for 60 fps; medium is dominated by the light probes (~12 ms at 1080p, measured before this session).
- So Intel HD/UHD **stays on low**. The chunking, fitted shadow box and Lambert work cut low from 17.1 to 14.4 ms before the opponents were added.
- Run-to-run noise is about ±1 ms; the iGPU's clock moves between runs.

### Simulation step while racing (`npm run bench -- --step`, low tier, 1366×768)

| Track, NPCs | step p50 / p95, 1× CPU | step p50 / p95, 4× CPU | frame p50, 4× CPU |
|---|---|---|---|
| Classic, 0 | 0.3 / 0.4 ms | 0.6 / 1.0 ms | 16.7 ms |
| Classic, 8 | 0.8 / 1.4 ms | 1.8 / 2.7 ms | 16.7 ms |
| Monaco, 8 | 0.9 / 1.6 ms | 2.0 / 3.1 ms | 16.7 ms |

- The plan budget was ≤ 2 ms per step at 4× throttle with 8 NPCs. The median meets it; the 95th percentile doesn't, at 2.7–3.1 ms.
- Frames still hold 60 fps under 4× throttle. Each NPC costs ~0.17 ms per step at 4×.
- In Node, 9 cars cost 0.26–0.33 ms per step (soak run).
- Timer resolution in the page is 0.1 ms.

### NPC calibration (`npm run sim -- --calibrate`): one NPC alone at full pace

| Track | Lap at skill 0 / 0.25 / 0.5 / 0.75 / 1 (s) |
|---|---|
| Classic | 16.5 / 15.55 / 14.33 / 12.67 / 11.58 |
| Indianapolis | 19.33 / 16.98 / 16.28 / 15.25 / 14.05 |
| Monza | 38.63 / 34.05 / 30.02 / 28.32 / 26.05 |
| Monaco | 47.7 / 39.85 / 34.93 / 31.53 / 28.42 |

**Soak** (9 NPCs, 6 laps, every track): every car finished and nothing respawned. The handover's 20-lap soak, 2 seeds, was also clean.

## Difficulty

How the field is set (`js/Difficulty.js`):
- The opponents' target laps are spread over 1.0–1.18 × a reference lap: your best on the track, or the track's par before you have one.
- Each NPC starts from the skill whose lap matches its target, then corrects lap by lap.
- A ±4% rubber band adds a little more.

### Keyboard bots vs 4 NPCs in the browser (`npm run playtest -- --scenario race --race-tracks classic,indianapolis,monza,monaco`)

Each bot races twice on a fresh page. Race 1 starts from par and adapts to the bot's laps; race 2 is aimed at the bot's best lap from race 1.

| Track | Novice | Average | Expert |
|---|---|---|---|
| Classic | 4th, 5th | 1st, 1st | 1st, 1st |
| Indianapolis | 5th, 4th | 1st, 1st | 1st, 1st |
| Monza | 5th, 5th | 1st, 2nd | 1st, 1st |
| Monaco | 5th, 4th | 1st, 1st | 1st, 2nd |

- **Average:** close races. Where the first NPC to finish was recorded, the margins were +2.2, +0.5, +0.7 and +1.6 s, and the one loss was by 0.8 s.
- **Expert:** wins by more. Its one loss (Monaco race 2) was by 0.5 s.
- **Novice:** finishes 5–26 s behind the winner, usually just short of 3rd (Classic race 1: 2.3 s behind 3rd). Never lapped.
- Against the plan's targets: expert usually wins (7 of 8), average finishes 1st–3rd (8 of 8), novice finishes 3rd–5th (8 of 8) and is never lapped (0 of 8). All met.
- No page errors, and every race reached the results screen. NPCs never respawned.

### Node stand-ins (`npm run sim -- --balance --seeds 6`): mean position of 5

| Stand-in skill | Race 1 (from par) | Race 2 (from race 1's best) |
|---|---|---|
| 0.2 | 2.0–2.5 | 1.3–2.7 |
| 0.5 | 1.0–1.7 | 1.5–2.5 |
| 0.9 | 1.0 (24 of 24 wins) | 1.7–2.2 (4 of 24 wins) |

The stand-ins disagree with the bots: the 0.9 stand-in rarely wins race 2. A stand-in is just another NPC with the same ceiling, so it races the top NPC as an equal from the back of the grid. The keyboard bots are the better proxy for people, so I tuned nothing on the stand-in numbers.

## Tracks

| Track | Cells / corners | Centerline | Laps | Race time (bots, average → expert) |
|---|---|---|---|---|
| Classic | 16 / 6 | 110 m | 5 | 76–77 s → 56 s |
| Indianapolis | 22 / 4 | 158 m | 5 | 81 s → 67 s |
| Monza | 36 / 12 | 250 m | 3 | 97–99 s → 74 s |
| Monaco | 38 / 16 | 259 m | 2 | 77–80 s → 55–58 s |

- **Corner order versus the real circuits** (Monza from track guides; Monaco's directions mostly from memory, since the guides I found don't give them all):
  - **Monza:** clockwise, R-L, R, L-R, R, R, L-R-L, R. Ours matches up to the Lesmos. Then the 90° grid forces a left kink before Ascari, drops Ascari's last left, and splits the Parabolica around the back straight.
  - **Monaco:** clockwise. Ours matches from Sainte Dévote through Casino, Mirabeau, the hairpin, Portier, the tunnel and the chicane. After that, Tabac turns right where the real one turns left, and the pool section is simplified.
  - **Indianapolis:** four lefts, anticlockwise. Correct.
- Monza's average race is ~98 s, over the 60–90 s aim. Dropping it to 2 laps would make it ~65 s.

## Full playtest (`npm run playtest`, all 15 scenarios)

**All 121 checks pass** (report `playtests/reports/2026-10-29T06-21-57.json`, recordings next to it). That covers:
- every bot finishing its laps, never stuck, no page errors
- the race flow: countdown, pause, results, race again, setup, opponent and car changes, switching track
- pause, rotation mid-race, zoom lock, the offline file with zero network requests
- frame-rate independence

| Run (time trial unless noted) | Best lap, novice / average / expert |
|---|---|
| keyboard, Classic | 20.6 / 14.9 / 10.8 s |
| joystick, phone portrait | 12.2 / 11.8 / 11.0 s |
| pads, phone portrait | 22.5 / 15.9 / 11.9 s |
| average keyboard bot on Indianapolis / Monza / Monaco | 15.6 / 30.9 / 34.5 s (pars: 16.3 / 30 / 35) |
| race vs 4 NPCs on Classic: finishing positions | 3rd, 5th / 2nd (by 0.1 s), 1st / 1st, 1st |

- The keyboard novice is noisy: its best lap has ranged from 16.6 to 20.6 s across runs.
- The average and expert bots match earlier runs (14.3–14.9 and 10.7–11.1 s), so the physics is unchanged since plan_0.

## Balance findings that need your call (not changed)

1. **The novice end is tough.** The novice bot finishes 4th–5th, 5–26 s behind.
   - Why: the field is aimed at your *best* lap. A novice's race laps scatter ~11% above their best; the expert's scatter ~5%. So for a novice, more of the field is effectively faster.
   - Option: aim the field a few % slower for slow players, judged by where their best lap sits on the track's calibration, e.g. +3% for a novice, 0 for average, −3% for an expert. That's a ~5-line change in `Race.aimField`.
2. **The NPCs' ceiling is below a wall-riding expert.**
   - Skill 1 laps 11.6 / 14.1 / 26.1 / 28.4 s on Classic / Indianapolis / Monza / Monaco. The expert bot laps 10.6 / 12.7 / 23.7 / 26.2 s.
   - So an expert always has a faster car's worth of margin. The expert bot rides the walls; next_0 found walls are a free racing line.
   - Options:
     - raise the NPCs' EXPERT parameters (later braking, wall-riding lines), then recalibrate
     - add the wall-hit speed penalty from next_0
     - accept it
3. **Contact feel.** I can't judge whether it's fun. Try `?tune` in a race; the defaults are restitution 0.35, friction 0.15, yaw kick 0.7, mass exponent 1, speed loss 0.6. On Classic, racing didn't add many wall hits: the keyboard bots hit walls 20 / 11 / 16 times a lap in a race vs 21 / 11 / 18 in time trial (novice / average / expert).
4. **next_0's touch assist finding is resolved by the new schemes.** The joystick now scales speed with drag distance, and pads have no assist at all.
   - Bot best laps on Classic (novice / average / expert): joystick 12.2 / 11.8 / 11.0 s, pads 22.5 / 15.9 / 11.9 s, keyboard 16.6–20.6 / 14.3–14.9 / 10.8–11.1 s.
   - The joystick is still the easiest, since it steers toward your thumb. Is that the intended mobile assist?

## Not done / known issues

1. **Real devices.** Not checked:
   - two thumbs at once on iOS Safari and Android Chrome
   - the fixed joystick's feel
   - fps with 8 NPCs on an entry-level phone

   The plan's fallback (cap the opponent stepper on weak phones) isn't built, because nothing here can show it's needed. On the HD 630 the cars cost 1.9 ms of the low tier's 11.2 ms.
2. **NPC detail knobs on low** (no NPC shadows or smoke): not built, for the same reason. They're the first thing to add if a phone struggles.
3. **Classic's finish arch hides the race start.** The camera sits behind it for ~2 s.
   - The arch is part of the finish piece's single mesh, so fading it needs the geometry split by height at load time.
   - It also needs the low tier's Lambert swap to keep the transparency.
4. **Portrait phones:** the setup panel covers your car on the grid, so the live car swap isn't visible there. The picker thumbnails are fine.
5. **Not built from the plan:** an engine sound for the nearest opponent (it was optional).

## Next

1. **Deploy and try it on real phones:** `npm run deploy`, then `npm run perf:load -- --url <live url>`. Check the two touch schemes, multi-touch and fps with 8 opponents. Emulation can't prove these.
2. **Your calls on balance findings 1–3.** If you want finding 1, it's small. Finding 2 means new EXPERT parameters plus `npm run sim -- --calibrate`, and the `ai` tables in `js/Tracks.js` updated from it.
3. **Medium on Intel iGPUs** needs a cheaper indirect light than the probe grid, e.g. a baked lightmap or vertex AO for the track pieces. Probes cost ~12 ms at 1080p.
4. **Step cost on slow phones:** if p95 matters on a real device, the cheap wins are probably AI look-ahead projections (`line.project` per car per step) and the 36 collision pairs before the narrow phase. Profile first.
5. **Shorter Monza** (2 laps), if its ~98 s races feel long.
