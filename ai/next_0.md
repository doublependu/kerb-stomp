# Next 0: what plan_0 delivered, what it found, what's next

All measurements below were taken on this machine: Intel HD 630 (Kaby Lake iGPU) through headless Chrome with `--use-angle=gl-egl`. A GTX 1050 is present but unused.

## Delivered

| Prompt item | Where |
|---|---|
| npm packaging (Vite, vanilla-template equivalent) | `package.json`, `vite.config.js`; import maps removed; all assets go through `js/Assets.js` imports (hashed, cacheable) |
| Static deploy on Cloudflare via wrangler, preview URLs off | `wrangler.jsonc` (Workers static assets), `public/_headers` (immutable `/assets/*`, forced download for the offline file), `npm run deploy` (warns on a dirty tree) |
| Loading + pause screens with "Fork me on GitHub" and "More games on Maize.Live" | `index.html` (inline markup/CSS, so it paints before JS) + `js/Shell.js` |
| Version `v.xxxx` in an unused corner | bottom-left, stamped from `WORKERS_CI_COMMIT_SHA` / `GITHUB_SHA` / `git rev-parse HEAD` |
| Responsive full screen, rotation mid-game, no stuck zoom | one resize path polled per frame; aspect-aware camera (`js/Camera.js`); safe-area insets; pinch / double-tap / ctrl-wheel guards (`lockViewport`) |
| Human-like playtest scripts, recordings, balance/bug pass | `scripts/playtest/` (`npm run playtest`); recordings in `playtests/` (gitignored) |
| Single-file offline download | `dist/kerb-stomp.html` (2.3 MB), works over `file://` |
| CLAUDE.md spec: device test + quality tiers | `js/Quality.js`, pause-menu picker, adaptive step-down |
| CLAUDE.md spec: load time | `npm run perf:load` |

Decisions D1–D10 from plan_0 were applied as written. The GitHub icon moved from the top-right corner into the loading/pause screens, and a pause button took its place.

## Load time (cold cache, via `wrangler dev`, `npm run perf:load`)

| Profile | Interactive | Notes |
|---|---|---|
| 25 Mbps / 40 ms | **0.57 s** | 1.26 MB transferred |
| 25 Mbps + 4× CPU | 0.89 s | |
| 10 Mbps / 100 ms | 1.28 s | |
| 10 Mbps + 4× CPU | 1.46 s | |

These numbers are for the low tier, which this GPU now gets. On medium (probe bake) the same GPU measured ~1.3 s on the average profile and ~1.9 s on slow.

What got it there:
- preloading the GLBs and colormap from the HTML (−0.5 s)
- initialising audio just after the start screen, since its synth buffers took 170 ms and nothing can play before a gesture anyway
- 16 px probe cubemaps on medium

**Still uncompressed:** ~940 KB of GLBs. Cloudflare doesn't compress `model/gltf-binary`.

## Graphics tiers

Measured per frame on the HD 630 with forced completion (`__kerb.benchmark`):

| | 1366×768 | 1920×1080 |
|---|---|---|
| low | 12.4 ms | 14.7 ms |
| + probe grid | +4.8 ms | +10 ms |
| + HalfFloat output (needed for bloom) | +8 ms | +13.6 ms |
| antialias | +0.6 ms | +1.7 ms |
| shadow map 1024 → 4096 | ~0 | ~0 |

Changes this led to:
- Bloom at strength 0.02 is nearly invisible, so medium no longer uses HalfFloat/bloom; only high does.
- Intel HD/UHD now starts on low (60 fps at 1080p).
- The probe grid can be dropped live, so the auto step-down can actually shed its biggest cost.

## Bugs found and fixed

1. **Frame-rate dependent driving.** Drive torque fights per-step physics damping, so acceleration varied ~10% between 30 fps and 240 Hz, and anything under 30 fps ran in slow motion.
   - Fix: a fixed 60 Hz simulation step with interpolated rendering, catching up to 4 steps per frame.
   - At 60 fps the motion is identical to before.
   - The `framerate` scenario checks 30/60/120 Hz match: 0.0% / 0.0% / 0.9%.
2. **Fall-off reset ignored custom tracks.** It always went to the default track's spawn. It now resets to the current track's start line (`custom-dead-end` check: 0.00 m from spawn).
3. **Keys stuck after alt-tab.** The keyup is lost while unfocused, so the truck drove itself. Held keys now clear on blur, and blur pauses the game.
4. **Rotation scaling and narrow portrait view.** The two resize listeners read `window.inner*`, and portrait saw a sliver of track. Fixed with the single per-frame resize path and FOV/dolly framing on the short screen axis with an elliptical deadzone. Portrait road visibility: see Balance findings.
5. **Smaller fixes:** per-frame upright slerp, wheel spin and skid pitch are now dt-based. The engine worklet loads on `file://` via a `data:` URL fallback. The quality classifier had a regex that put every "UHD Graphics" laptop on low; fixed.

## Playtest results (latest full run)

All 38 checks pass. That covers:
- every bot finishing its laps, never stuck, no page errors
- pause via Esc, the button, tab hide and blur
- mid-race rotation
- zoom lock
- the offline file with zero network requests
- frame-rate independence

| Run (default track) | Best lap | Wall contacts / lap |
|---|---|---|
| keyboard novice / average / expert | 17.6 / 14.5 / 10.7 s | 21 / 11 / 18 |
| touch (portrait) novice / average / expert | 11.7 / 11.1 / 11.0 s | 28 / 23 / 20 |
| custom oval / stepped loop (average) | 8.9 / 12.3 s | 6 / 8.5 |

"Wall contacts" counts new contacts per wall collider segment, so sliding along a wall counts several.

## Balance findings that need your call (not changed)

1. **Touch is a strong assist.** It auto-throttles to max speed and steers toward the thumb, so a touch novice laps ~35% faster than a keyboard novice and nearly matches a keyboard expert. The bot's thumb is more precise than a real one, but the gap is large. Options:
   - keep it as the mobile assist
   - add steering assist on keyboard
   - let touch players brake (e.g. lift-to-brake)
2. **Walls are a free racing line.** Walls have zero friction and 0.1 restitution. An expert bot that never brakes is ~20% faster than one braking for corners (10.7 s vs 12.8–14.3 s). Option: a speed penalty scaled by the *normal* impact speed on wall hits.
3. **Portrait look-ahead.** Road 1.2 s ahead is on screen 41–46% of the time in portrait vs 57–81% on desktop; at 0.6 s it's 82–99% vs ~100%. `MIN_GROUND_HALF_WIDTH` in `js/Camera.js` trades this against truck size.

## Next

1. **Deploy and check on real devices.** `npx wrangler login`, then `npm run deploy`, then `npm run perf:load -- --url <live url>`. On a real iPhone (Safari): pinch lock, safe areas, rotation. On an entry-level Android: tier pick and fps. Emulation can't prove these.
2. **Geometry cost on iGPUs.** Low still costs ~11 ms on the HD 630 and barely changes with resolution, so it's geometry or draw calls, not pixels. Likely cause (unverified): instanced forest/tent decorations are one `InstancedMesh` per tree part over the whole map, so frustum culling can't skip them, and the shadow frustum covers the whole track. Chunk the instances spatially and tighten the shadow box around the car (it already follows the car). That would probably let iGPUs run medium.
3. **GLB compression.** meshopt (gltf-transform + MeshoptDecoder) would cut ~940 KB to roughly a quarter, which matters most on the slow profile.
4. **Gameplay calls** on the balance findings above, then re-run `npm run playtest` and compare against `playtests/reports/latest.json`. The runner prints Δbest per run.
5. **Offline editor.** The offline file hides the editor; a single-file editor build is possible if wanted.
6. **npm warning.** npm 11's allow-scripts skipped the esbuild/workerd postinstall scripts. Everything works without them, since the platform binaries arrive as optional deps, but `npm install` warns. `npm approve-scripts esbuild workerd` silences it if you're happy to allow them.
