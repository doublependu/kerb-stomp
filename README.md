# Kerb Stomp

A tiny racer in the browser. Pick one of 29 Kenney cars and race up to eight computer drivers on six tracks, or drive alone against your best lap. Cars bump, shove, spin and sometimes send each other flying.

## Playing

- **Setup screen:** track, car, number of opponents (0 = time trial), and on touch devices the control scheme. Enter or W starts.
- **Keyboard:** WASD / arrow keys, R resets the car onto the track, Esc or P pauses. **Gamepad:** stick + triggers, Start pauses.
- **Touch, joystick:** a fixed joystick low in the middle. Drag from its centre toward where to go; drag further to go faster.
- **Touch, two thumbs:** slide the left pad to steer, the right pad up to accelerate and down to brake / reverse.
- **Races:** 2–5 laps depending on the track. An 8-second aerial view of the whole track first, circling down from overhead onto your car (any key or tap skips it), then a grid behind the line and a 3-2-1 countdown. Opponents' pace is spread around your best lap on that track, so about a third are quicker than you, leaning a little kinder to novices and harder on experts, and they speed up as you do. In your first race on a track they start from an average player's pace and adjust to your laps as you go, except the two fastest, the aces: they hold the track's ace lap and 5% slower however you do, and race harder (they see traffic sooner, pass on the inside and never lift).
- **Computer drivers:** they follow a racing line found by the physics for each track (`npm run sim -- --optimize`), over the kerbs and along the walls where that's faster, steering their direction of travel onto it rather than their nose. Skill decides how much of the line and the grip they use and how steady their hands are.
- **Results:** the winner turns on a podium. With 3 cars or fewer there's one badge, with more there are gold, silver and bronze; your best medal on each track shows in the track picker.
- **Tracks:** Classic (the Starter Kit layout) and five loosely modelled on real circuits: Indianapolis (the oval's four left turns), Monza (its chicanes, Curva Grande, the Lesmos and Parabolica), Monaco (Sainte Dévote, Casino, the hairpin, the tunnel, the pool and Rascasse), Suzuka (a figure-8: the back straight crosses the Degner–Hairpin link on a bridge) and Bathurst (Mount Panorama: a climb, an unsealed cliff top, the drop down the Esses and the Hump on Conrod). Pieces are 90° only, so they're squeezed approximations. Each track has one scenery theme (Indianapolis a stadium, Monza a village, Monaco a suburb, Suzuka an industrial estate, Bathurst and Classic a forest) with a small paddock at the start/finish, and every turn a landmark of its own, chevrons and braking boards, so you can tell where you are. Nothing stands within 0.3 m of the walls. Custom tracks come from the editor (`editor.html`, `?map=`); it has no hills or crossings.
- **Leaving the track:** off a cliff, over a wall, stuck, or upside down, a magic wand flies the car back to the road while the race goes on. R does it on purpose.
- **Kerbs and gravel:** wheels on the rumble strip or the red-and-white kerb slow you down (the kerb more); gravel is slippery and slower.
- **Cars:** all have the same top speed. Weight (light, medium, heavy) sets the rest: light cars pick up speed and stop quicker but get knocked about, heavy ones keep their momentum and knock others aside, spin them, or send them flying.


## Setup and run

```bash
npm install
npm run dev
```

## Initial setup

```bash
npm create vite@latest . -- --template vanilla
claude --dangerously-skip-permissions
```

The Vite setup mirrors the vanilla template by hand (`package.json` scripts, `vite.config.js`). Running `npm create vite` in this non-empty folder would offer to wipe it.

## Build

```bash
npm run build      # dist/ (hashed, cacheable assets) + dist/kerb-stomp.html
npm run preview:cf # build, then serve dist/ like Cloudflare does (wrangler dev)
```

`dist/kerb-stomp.html` is the whole game in one file for offline play (linked as "Download to play offline" on the loading and pause screens). It runs from `file://`.

The version label (bottom-left, `v.<first 4 of the commit>`) is stamped at build time from `WORKERS_CI_COMMIT_SHA`, `GITHUB_SHA` or `git rev-parse HEAD`.

## Deploy

```bash
npx wrangler login
npm run deploy
```

Deploys `dist/` as Cloudflare Workers static assets (`wrangler.jsonc`, preview URLs off). `deploy` warns if the working tree is dirty, since the version label names HEAD.

## Graphics

The game tests the device on load (GPU, memory, screen) and picks a quality tier, then steps down if it can't hold ~45fps once driving. Players can override it in the pause menu. For testing: `?quality=low|medium|high|auto`.

The sun's shadow box follows the camera's view rather than covering the whole track, decorations are instanced in chunks so off-screen ones are culled, and the low tier shades with Lambert. `npm run bench` measures frame cost per tier and what each part of the scene costs (`--npcs 0,4,8 --parts`); `npm run bench -- --step --cpu 1,4` measures the simulation step and frame time while racing, with the CPU throttled.

## Models

`models/src/` holds the original Kenney models: Starter Kit Racing (track, decorations, trucks), Car Kit 3.1 in `models/src/cars/` (25 vehicles and debris parts), and the scenery kits in `models/src/<kit>/` (City Kit Industrial, City Kit Suburban, Fantasy Town, Mini Forest, Racing Kit). `npm run kits` copies the scenery models and the prefabs' parts the game uses from the kits' zips unpacked in `ref/`. `npm run models` compresses everything (meshopt, quantized) into `models/`, `models/cars/` and `models/<kit>/`, builds the gravel track pieces, the Fantasy Town house prefabs and the landmarks put together from kit parts (a lookout, a rope bridge, a camp, a market, a wind farm, a terrace…), bakes the Racing Kit's colours into a palette, and regenerates `js/CarList.js` (bounds and mass) and `js/SceneryList.js`. `npm run thumbs` re-renders the car picker's thumbnail sheet (`sprites/cars.webp`). The outputs are committed, so a build doesn't need any of these.

## Simulation

The race simulation (`js/Race.js`: physics, NPC drivers, car-to-car collisions, laps and positions) has no DOM, so it also runs headless in Node:

```bash
npm run sim -- --calibrate   # NPC lap time by skill on each track
npm run sim -- --soak        # 9 NPCs × 20 laps × every track: nobody gets stuck (wand trips, launches)
npm run sim -- --balance     # an AI stand-in for the player races the field twice, as in the game
npm run sim -- --classes     # the same NPC in light, medium and heavy cars: lap times compared
npm run sim -- --fit         # grip and braking for the NPCs' speed profile (js/RacingLine.js)
npm run sim -- --ace         # the best NPC: alone, in a first race's field, where its slow laps lose time, and a wall-riding probe
npm run sim -- --steer       # steering gains for the NPCs (js/AIDriver.js STEER), over a grid, on every core
npm run sim -- --optimize --tracks monza   # the fastest racing line (js/RaceLines.js), ~10–20 min a track on 8 cores
npm run tracks               # check and draw the built-in tracks: gradients, crests and their take-off speeds, scenery clear of the road, racing lines up to date
```

`?tune` adds a panel of live knobs: car contact (spin and launch thresholds), handling by mass, kerb and gravel drag, NPC aggression.

## Testing

```bash
npm run perf:load  # cold-load time to interactive under throttled network/CPU
npm run playtest   # bots play through real keyboard/touch input and record video
npm run playtest -- --scenario desktop-keyboard,rotate-mid-race --laps 2 --no-record
```

Playtest recordings and reports go to `playtests/` (gitignored). Scenarios: `desktop-keyboard`, `laptop-keyboard`, `phone-portrait-touch`, `phone-landscape-touch` (joystick), `phone-portrait-pads`, `phone-landscape-pads`, `tracks`, `race`, `race-flow`, `scenery` (stills of every track and turn from above, for review), `flyover`, `cliff`, `podium`, `kerbs`, `custom-tracks`, `rotate-mid-race`, `pause-resume`, `zoom-lock`, `offline-file`, `framerate`. `?noflyover` skips the fly-over. The bots read the game's state through `window.__kerb` (present with `?playtest` or in dev) and never inject into it.

`race` has keyboard bots race the NPCs, twice per skill (the first race sets the best lap the second is paced from): `npm run playtest -- --scenario race --race-tracks classic,monza --race-skills average --npcs 4`.

## Credits

- Game assets by [Kenney](https://kenney.nl/) (CC0): [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing), [Car Kit](https://kenney.nl/assets/car-kit), [City Kit Industrial](https://kenney.nl/assets/city-kit-industrial), [City Kit Suburban](https://kenney.nl/assets/city-kit-suburban), [City Kit Roads](https://kenney.nl/assets/city-kit-roads), [Fantasy Town Kit](https://kenney.nl/assets/fantasy-town-kit), [Mini Forest](https://kenney.nl/assets/mini-forest) and [Racing Kit](https://kenney.nl/assets/racing-kit)
- Track layouts loosely inspired by the circuits at Indianapolis, Monza, Monaco, Suzuka and Mount Panorama, Bathurst
- Physics engine: [crashcat](https://github.com/isaac-mason/crashcat)
- Ported to JavaScript with [Claude](https://claude.ai/)
- A JavaScript/Three.js port of [Kenney's Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing).
    - [Devlog](https://x.com/mrdoob/status/2048358619985690935)
