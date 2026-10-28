# Plan 0 — npm packaging, shell UI, Cloudflare deploy, responsive, offline build, playtest bot

Answers `ai/prompt_0.md`. Nothing here is implemented yet.

## Where the project stands

- Plain static site with no build step. `index.html` and `editor.html` load three@0.185.1 from jsDelivr and crashcat@0.0.3 from esm.sh through import maps. `js/*.js` are native ES modules.
- Assets are fetched by runtime string paths (`models/${name}.glb`, `models/Textures/colormap.png`, `sprites/smoke.png`, `audio/skid.ogg`). The engine worklet loads with `new URL( './EngineWorklet.js', import.meta.url )`.
- There is no loading screen (a black screen until `init()` finishes) and no pause.
- In-game corners: lap timer top-left, GitHub icon top-right (points at upstream `mrdoob/Starter-Kit-Racing`), "Create new track" bottom-right. **Bottom-left is unused.**
- Resize is handled in two separate `window.resize` listeners (`js/main.js:52`, `js/Camera.js:49`) that read `window.innerWidth/innerHeight`. The vertical FOV is fixed at 40°, so portrait phones see a very narrow slice of the track.
- Rendering cost does not depend on the device: full `devicePixelRatio` (`js/main.js:20`), a 4096² shadow map (`js/main.js:41`), a HalfFloat output buffer, bloom, and a light-probe bake at startup. The default track uses fallback bounds of 30×30 (`js/Track.js:406`), so the bake is 8×2×8 = 128 probes × 6 cube faces ≈ **768 scene renders before the first frame** (`js/main.js:162-169`).
- Origin is `github.com/doublependu/kerb-stomp` (a fork of mrdoob's port).

## Decisions I've made (override any of these before implementation)

| # | Decision | Default chosen | Why |
|---|---|---|---|
| D1 | How to "package with npm as in README" | Write the files the Vite **vanilla** template would create (`package.json` scripts, `vite` devDep) by hand. **Do not run `npm create vite .`** | create-vite in a non-empty directory offers to wipe it. Its demo files (`src/`, `counter.js`, `vite.svg`) aren't needed |
| D2 | Source layout | Keep `js/`, `models/`, `audio/`, `sprites/` where they are. Vite root = repo root. Multi-page build: `index.html` + `editor.html` | Least churn. `editor.html` already imports `./js/Track.js` |
| D3 | Dependency versions | Pin exactly `three@0.185.1` and `crashcat@0.0.3` (what runs today) | crashcat 0.0.5 exists, but upgrading it is a separate, behaviour-affecting change |
| D4 | GitHub link target | Single `REPO_URL = https://github.com/doublependu/kerb-stomp` used by the fork link, the in-game icon and the editor icon | "Fork me" should point at this repo. Upstream credit stays in README |
| D5 | Corner layout | top-left: lap timer · top-right: **pause button** (the GitHub icon moves into the loading/pause screens) · bottom-right: "Create new track" · bottom-left: **version `v.xxxx`** | Uses the one free corner for the version. The pause button needs a reachable spot on touch |
| D6 | Loading screen end state | When loading finishes, show "Press any key / tap to drive". The first input dismisses it **and** counts as input (W/↑ starts driving immediately) | Keeps the fork/maize/download links visible for more than a flash, and the same gesture unlocks WebAudio |
| D7 | Cloudflare product | Workers **static assets** (assets-only, no Worker script) via `wrangler.jsonc`, `preview_urls: false`, `workers_dev: true` | This is Cloudflare's current static-site path, and the prompt says "static website for now" |
| D8 | Offline file scope | Game only. The editor link is hidden in the offline build. Custom tracks still work via `?map=` | The editor would need its own single-file bundle. Can add later |
| D9 | Game title on screens | "Kerb Stomp" (also the `<title>`) | Repo name. Currently "Racing" |
| D10 | Device tiering | Included (Phase 6) even though prompt_0 doesn't list it | Required by the CLAUDE.md Spec. The new pause screen is where the graphics option lives. Can be split out if you want prompt_0 kept narrow |

## Phase 1 — npm + Vite packaging

1. `package.json` (`"name": "kerb-stomp"`, `"private": true`, `"type": "module"`):
   - deps: `three@0.185.1`, `crashcat@0.0.3`
   - devDeps: `vite@^8`, `vite-plugin-singlefile@^2.3` (peer range includes Vite 8), `wrangler@^4`, `playwright` (match the installed `~/.cache/ms-playwright/chromium-1248` or run `npx playwright install chromium`)
   - scripts:
     - `dev`: `vite`
     - `build`: `vite build && vite build --mode offline && node scripts/copy-offline.mjs`
     - `preview`: `vite preview`
     - `preview:cf`: `npm run build && wrangler dev` (serves `dist/` the way Cloudflare does, `_headers` included)
     - `deploy`: `npm run build && wrangler deploy`
     - `playtest`: `node scripts/playtest/run.mjs`
     - `perf:load`: `node scripts/measure-load.mjs`
2. Remove both `<script type="importmap">` blocks. Bare `three`, `three/addons/*` (a valid export in three's package.json) and `crashcat` imports then resolve from `node_modules`.
3. `vite.config.js`:
   - `build.rollupOptions.input = { main: 'index.html', editor: 'editor.html' }`
   - `define` for `__APP_VERSION__`, `__REPO_URL__` and `__OFFLINE__`
   - `mode === 'offline'` branch: input `index.html` only, `viteSingleFile()`, outDir `dist-offline/`
4. `.gitignore` += `node_modules/`, `dist/`, `dist-offline/`, `.wrangler/`, `playtests/recordings/`, `playtests/reports/`. The stale `_benchmark/` and `_godot/` entries stay.
5. Done when: `npm install && npm run dev` serves the game and the editor with no CDN requests, and `npm run build` produces `dist/` with hashed assets.

## Phase 2 — Route every asset through imports

Needed both for hashed, immutable caching and for inlining into the single HTML file.

1. New `js/Assets.js`: `import.meta.glob( '../models/*.glb', { query: '?url', import: 'default', eager: true } )` gives a `MODEL_URLS[name]` map, plus `?url` imports for the colormap, `smoke.png` and `skid.ogg`.
2. Use it in `js/main.js` (model loading), `js/Loader.js` (shared colormap; the plugin already intercepts `Textures/colormap.png`, so no relative fetch happens), `js/Particles.js`, `js/Audio.js`, and in the `loadModels` code inside `editor.html`.
3. Engine worklet: `import workletSource from './EngineWorklet.js?raw'` → Blob URL → `audioWorklet.addModule( blobUrl )`. This works the same in dev, the hashed build and `file://`. A `data:` URL worklet is not reliable across browsers. `Audio.js` keeps its normal import of `RPM_IDLE/RPM_MAX`.
4. Done when: `grep -r "models/\|sprites/\|audio/" dist/assets/*.js` finds only hashed names, and the offline HTML contains no relative asset URLs.

## Phase 3 — Version stamp

1. In `vite.config.js`, resolve the commit in this order: `WORKERS_CI_COMMIT_SHA` (Cloudflare Workers Builds) → `GITHUB_SHA` → `git rev-parse HEAD` → `'dev'`. Then `__APP_VERSION__ = 'v.' + sha.slice( 0, 4 )`.
2. The label sits bottom-left with `pointer-events: none`, small, low contrast, inside the safe-area inset, and outside the touch steer zone's hit testing.
3. `deploy` prints a warning when `git status --porcelain` isn't empty, because the stamp would name a commit that doesn't match what ships. It warns only; committing stays yours.

## Phase 4 — Cloudflare (wrangler) static deploy

1. `wrangler.jsonc`:
   ```jsonc
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "kerb-stomp",
     "compatibility_date": "<today>",
     "assets": { "directory": "./dist" },
     "workers_dev": true,
     "preview_urls": false
   }
   ```
2. `public/_headers` (copied into `dist/`):
   - `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`
   - `/kerb-stomp.html` → `Content-Disposition: attachment; filename="kerb-stomp.html"`
   - HTML keeps the default revalidation, so a new deploy shows up right away.
3. Use `wrangler dev` to check that `/`, `/editor.html?map=…` (the default `html_handling` redirects `.html` → extensionless, so confirm the query string survives) and `/kerb-stomp.html` all work. Switch `html_handling` if any of them break.
4. I won't run `wrangler login` or `wrangler deploy`. Both are yours: `npx wrangler login` once, then `npm run deploy`. README's Deploy section already matches.

## Phase 5 — Shell UI: loading screen, pause screen, links

One overlay component (`js/Shell.js` + static markup in `index.html`) with two states that share a footer.

**Shared footer links:** "Fork me on GitHub" (`REPO_URL`), "More games on [Maize.Live](https://maize.live)", "Download to play offline (≈N MB)" (`<a href="kerb-stomp.html" download="kerb-stomp-v.xxxx.html">`, hidden when `__OFFLINE__`). External links get `target="_blank" rel="noopener"` so the game isn't lost.

**Loading state**
- Markup and CSS are inline in `index.html`, so the screen paints before any JS arrives. It has the title, a progress bar and the footer. A "Fork me" corner ribbon goes on this screen.
- A shared `THREE.LoadingManager` drives the progress bar (GLTF, texture and audio loaders). After assets it shows "Preparing track…" for the probe bake and `renderer.compileAsync( scene, camera )`, which avoids first-frame shader jank.
- When ready: `performance.mark( 'kerb:interactive' )`, show "Press any key / tap to drive" (D6), and dismiss on the first keydown, pointerdown or gamepad button.
- Error state: if there is no WebGL or an asset fails to load, show a readable message instead of a black screen.

**Pause state**
- Opens with: Esc or P, gamepad Start (button 9, edge-triggered), the top-right pause button, `visibilitychange` → hidden, and window `blur`.
- While paused: skip the physics/vehicle/lap-timer/particle updates, `audioContext.suspend()`, and stop rendering except a single re-render on resize. On resume, reset the `THREE.Timer` delta so there is no physics jump and paused time never reaches the lap timer.
- Contents: Resume · Graphics (Auto/Low/Medium/High, Phase 6) · Fullscreen toggle (only where the Fullscreen API exists, so not iPhone Safari) · controls hint (keyboard/gamepad/touch) · "Edit this track" · footer links. A "Reset car to start" button is added only if playtests show players getting stuck.
- The pause button and overlay sit above the touch steer zone (z-index ≥ 20, like the corner links). Touches on them must not start a joystick.

## Phase 6 — Device test and graphics tiers (CLAUDE.md Spec §2.3)

1. `js/Quality.js` runs **before** the renderer is created, because antialias is fixed when the context is created:
   - Throwaway WebGL2 context → `WEBGL_debug_renderer_info` GPU string. SwiftShader/llvmpipe and older Mali/Adreno → low. Intel UHD/Iris and mid Adreno → medium. Apple M-series or A15+, plus discrete GPUs → high.
   - Also uses `hardwareConcurrency`, `deviceMemory` (where present), `MAX_TEXTURE_SIZE`, coarse pointer combined with screen size, and screen pixels × DPR.
2. Presets:

   | | low | medium | high (today's look) |
   |---|---|---|---|
   | pixel ratio cap | 1 | 1.5 | 2 |
   | antialias | off | on | on |
   | shadow map | 1024 | 2048 | 4096 |
   | bloom / HalfFloat output | off | on | on |
   | light-probe bake | skipped (hemi light only) or 4×1×4 | reduced grid | current grid |
   | smoke pool | halved | full | full |

3. Adaptive Auto mode: sample frame times for about 3 s after the player starts driving. If the median is above ~20 ms, step down one tier, using only live-changeable knobs (DPR, shadow size, bloom). Persist the result in `localStorage['kerb.quality']`, wrapped in try/catch like the existing storage code. A manual pick in the pause menu overrides Auto. An antialias change applies on the next load (the UI says so).
4. Why this matters for gameplay: `dt` is clamped to 1/30 (`js/main.js:261`). Below 30 fps the simulation runs in **slow motion**, so slow devices play worse, not just uglier.

## Phase 7 — Responsive full screen, rotation, zoom lock

1. CSS: `html, body { height: 100%; overflow: hidden; overscroll-behavior: none; touch-action: none; user-select: none; -webkit-touch-callout: none; }`. The canvas is `position: fixed; inset: 0; width: 100%; height: 100%` (with a `100dvh` fallback). The viewport meta gets `viewport-fit=cover`. Corner UI is padded with `env(safe-area-inset-*)`.
2. One `resize()` in `main.js` replaces both listeners. It reads the canvas `clientWidth/clientHeight`, then:
   - sets the renderer size with `updateStyle: false` and the tier's pixel ratio
   - updates camera aspect and framing
   - updates the bloom size, if `setEffects` doesn't already do it
   - triggers a re-render when paused
   It runs from a `ResizeObserver` on the canvas, from `visualViewport` resize, from `orientationchange` (re-checked on the next two frames, because iOS reports stale sizes during rotation), and from a cheap per-frame "client size changed?" check as a backstop.
3. Aspect-aware camera framing (`js/Camera.js`): keep at least the landscape reference amount of track visible on the **short** screen axis. When aspect drops below the reference, derive vertical FOV from a fixed horizontal FOV, clamped to ~60°. Past that, dolly the camera back along `offset` and scale `far` and the fog with it. Retune `deadzoneRadius`, `leadFactor` and `screenShiftUp` per orientation using playtest screenshots at 16:9, 4:3, 21:9, 9:19.5 and after mid-game rotation.
4. Touch joystick: end the active steer on rotation (`pointercancel` usually fires; force it anyway on `orientationchange`).
5. Stop touch zooms the user can't undo:
   - viewport `maximum-scale=1, user-scalable=no` (already there; iOS ignores it, hence the rest)
   - `gesturestart`/`gesturechange` → `preventDefault` (iOS Safari pinch)
   - `touchmove` with more than one touch → `preventDefault` (`passive: false`)
   - `dblclick` → `preventDefault`, plus `touch-action: manipulation` on overlay buttons (double-tap zoom)
   - ctrl+wheel → `preventDefault` (trackpad pinch)
   - Desktop keyboard zoom (Ctrl ±) is left alone because the user can undo it.
   - If the pause panel overflows on a tiny landscape phone, only the panel gets `touch-action: pan-y`.

## Phase 8 — Single-file offline download

1. `vite build --mode offline` with `vite-plugin-singlefile` inlines all JS and CSS. The `?url` assets from Phase 2 become base64 `data:` URIs (GLTFLoader and AudioLoader both fetch `data:` fine), and the worklet is already a Blob.
2. `scripts/copy-offline.mjs` copies `dist-offline/index.html` → `dist/kerb-stomp.html` and prints its size. The expected size is about 2.5–3 MB (≈1.1 MB of GLBs → ~1.5 MB base64, plus minified three and crashcat).
3. The offline build sets `__OFFLINE__`, which hides the download link and the editor link. The fork and Maize.Live links stay and open online. It carries the same version stamp as the deployed build.
4. The file lives off the critical path: nothing on the main page loads it until someone clicks Download.
5. Done when: a Playwright context with `offline: true` opens `file:///…/dist/kerb-stomp.html`, the game loads and drives, the engine worklet runs, there are zero network requests, and lap bests persist in localStorage.

## Phase 9 — Load-time budget (CLAUDE.md Spec §1)

1. `scripts/measure-load.mjs` (Playwright + CDP, cold cache) measures from navigation to `kerb:interactive` under these profiles:
   - "average": ~25 Mbps / 40 ms RTT
   - "slow": ~10 Mbps / 100 ms
   - each with no CPU throttle and with 4× CPU throttle, to approximate an entry phone
   It also reports per-asset raw, gzip and brotli sizes, and long tasks (the probe bake shows up here). It runs locally against `wrangler dev`, then again against the deployed URL after you deploy, since edge compression only exists there.
2. Targets: ≤ 1 s great, ≤ 3 s required, 4 s hard cap.
3. If over budget, fix in this order, re-measuring after each:
   1. preload the GLBs and colormap (`<link rel="preload" as="fetch" crossorigin>`) so they download in parallel with JS (Vite already emits `modulepreload`)
   2. tier-aware probe bake (Phase 6)
   3. load the player truck and track pieces first; defer the forest, tents and NPC trucks to after interactive (progressive loading is allowed by the spec)
   4. `gltf-transform` quantize + meshopt for the GLBs (adds MeshoptDecoder), only if size is still the bottleneck

## Phase 10 — Playtest bot ("play as a human"), recordings, balance and bug fixing

**Hook (read-only).** When the URL has `?playtest` (or in dev), the game exposes `window.__kerb.state()`: time, position, heading, speed, lap/current/last/best, paused, fps, impact count and max impact speed, resets, quality tier, and the track cells. All **input goes through real event paths**, never the hook.

**Driver** (`scripts/playtest/`, Node + Playwright):
- Centerline waypoints come from the track cells (straights along the cell axis, corners along the arc midline), ordered from the finish cell, so `?map=` tracks work too.
- Human model, seeded RNG:
  - reaction delay of 120–250 ms (acts on delayed state)
  - control loop at ~20–30 Hz
  - keyboard is digital, so steering is tap/hold with hysteresis rather than analog
  - brakes before corners from speed and distance to the turn
  - three skill levels: novice (late turn-in, overcorrection, occasional wrong tap), average, expert
- Keyboard runs use `page.keyboard`. Touch runs use CDP `Input.dispatchTouchEvent` drags on the steer zone, mapped through the 45° camera like a thumb, with jitter.
- Recording: Playwright `recordVideo` → `playtests/recordings/<date>-<scenario>-<skill>.webm`, plus `playtests/reports/*.json` and before/after screenshots. Both folders are gitignored and never committed.
- GPU: run headed Chrome with the real GPU (`--ignore-gpu-blocklist`). Headless falls back to SwiftShader, which runs below 30 fps and slows the simulation (Phase 6 note). Runs under ~45 fps are marked *perf-invalid* for gameplay metrics.

**Scenario suite** (`npm run playtest`):
1. Desktop keyboard, 1920×1080 and 1366×768: 3 laps × 3 skills, default track.
2. Phone portrait touch (390×844, DPR 3, `isMobile`, `hasTouch`) and phone landscape.
3. Rotation mid-race (portrait → landscape → portrait while driving). Assert canvas backing size = client size × pixel ratio, and `camera.aspect` equals client aspect within 1%.
4. Pause/resume mid-lap via Esc, the pause button and tab hide. Assert the lap clock is frozen while paused and position doesn't jump on resume.
5. Blur while holding W. Assert the car stops and the game pauses.
6. Two or three encoded custom tracks via `?map=`, including deliberately driving off the edge.
7. Offline single file over `file://` (Phase 8).
8. Pinch and double-tap attempts in mobile emulation. Assert `visualViewport.scale === 1`.

**Metrics:** lap times, lap completion rate, wall impacts (count and speed), stuck time (speed < 0.1 for > 1.5 s while on throttle), fall resets, invalidated crossings, fps p50/p95, long tasks, console errors and page exceptions. Each run compares against the previous baseline report and prints the diff.

**Bug candidates from reading the code** (confirm with the bot before fixing):
1. The fall-off reset hard-codes `[3.5, 0.5, 5]` and heading 0 (`js/Vehicle.js:196-209`), which is wrong for custom tracks. It should reset to that track's computed spawn.
2. `Controls.keys` is never cleared on window blur (`js/Controls.js:17-18`), so the car keeps driving after alt-tab.
3. Resize reads `window.inner*` from two listeners, which can leave the canvas mis-scaled after rotation on iOS (fixed by Phase 7.2). Also check that the bloom pass resizes with `setEffects`.
4. Full-DPR rendering + 4096 shadows + bloom on phones → under 30 fps → slow-motion driving (Phase 6).
5. Frame-rate dependent steps: the upright slerp uses a per-frame `0.2` (`js/Vehicle.js:153`, affects handling), and wheel spin (`:268`) and skid pitch (`js/Audio.js:380`) are per-frame too. 60 Hz and 120 Hz screens therefore drive differently. Fix: use dt-based exponential factors. If the bot still shows divergence (the hook can throttle rAF to simulate 30/60/120 Hz), move to a fixed 60 Hz step.
6. The startup probe bake (~768 renders) blocks the main thread, which hurts TTI on low-end devices (Phases 6 and 9).

**Balance and fun pass:**
- Proxies the bot can measure: novice completes laps without getting stuck, a reasonable novice→expert lap-time spread, wall hits per lap, **touch vs keyboard parity** (touch has auto-gas and world-direction steering, so either could dominate), and portrait look-ahead (how many seconds of road are visible ahead at max speed).
- Knobs: `MAX_SPEED`, steering rate and grip clamp (`Vehicle.js`), touch turn rate (`slerp` factor 3) and auto-gas, camera lead/deadzone per orientation, wall restitution.
- One knob per iteration. Findings go into `ai/next_0.md`.
- "Fun" is ultimately your call. I'll hand over the recordings and the numbers rather than claim the bot proves it.

## Phase 11 — Docs

- README: dev/build/preview/deploy/playtest/perf commands, the offline download, and a note that `npm create vite` was emulated, not run.
- `ai/next_0.md` once implementation finishes: summary, measured load times, playtest findings and recommended next steps.
- CLAUDE.md is not touched. If the structure list in `ai/CLAUDE_original.md` should be refreshed to cover the new files, I'll ask first.

## Files

- **New:**
  - `package.json`, `package-lock.json`
  - `vite.config.js`, `wrangler.jsonc`, `public/_headers`
  - `js/Assets.js`, `js/Shell.js`, `js/Quality.js`
  - `scripts/copy-offline.mjs`, `scripts/measure-load.mjs`
  - `scripts/playtest/{run,driver,scenarios,track}.mjs`
- **Changed:**
  - `index.html` (remove import map; add loading/pause markup, viewport-fit, version label, pause button)
  - `editor.html` (remove import map; asset URLs; `REPO_URL`)
  - `js/main.js` (quality-driven renderer; single resize path; pause-aware loop; loading progress; playtest hook)
  - `js/Camera.js` (aspect-aware framing; drop own resize listener)
  - `js/Controls.js` (clear keys on blur; gamepad Start edge; zoom guards; cancel steer on rotate)
  - `js/Loader.js`, `js/Particles.js`, `js/Audio.js` (imported URLs; Blob worklet)
  - `js/Vehicle.js` (spawn-aware reset; dt-correct upright)
  - `js/LapTimer.js` (pause-safe)
  - `.gitignore`, `README.md`
- **Style:** match the existing mrdoob style (tabs, spaces inside parentheses, a blank line after block openers, sparse comments).

## Order and review checkpoints

Suggested commit boundaries for you:
1. Phases 1–3 (build runs, the game is unchanged apart from the version label)
2. Phase 4 (`wrangler dev` works; you can deploy)
3. Phase 5
4. Phases 6–7
5. Phase 8
6. Phase 9 measurements and any fixes
7. Phase 10 bot, then separate gameplay/bug-fix changes, so tuning can be reviewed and reverted on its own

## What I can't verify here

- Real iOS Safari and entry-level Android behaviour (pinch lock, rotation, safe areas, true fps). Playwright's mobile emulation and WebKit only approximate them. I'll leave a short manual checklist for an actual phone.
- Edge compression and real-world load time until you deploy. `measure-load` takes a `--url` for that re-run.

## Out of scope

Opponents/AI racers, new tracks or assets, PWA/service worker, an analytics or leaderboard backend, a single-file editor, and upgrading crashcat or three.
