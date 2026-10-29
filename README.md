# Kerb Stomp

A tiny racer in the browser. Pick one of 29 Kenney cars and race up to eight computer drivers on four tracks, or drive alone against your best lap. Cars bump, shove and spin each other.

## Playing

- **Setup screen:** track, car, number of opponents (0 = time trial), and on touch devices the control scheme. Enter or W starts.
- **Keyboard:** WASD / arrow keys, R resets the car onto the track, Esc or P pauses. **Gamepad:** stick + triggers, Start pauses.
- **Touch, joystick:** a fixed joystick low in the middle. Drag from its centre toward where to go; drag further to go faster.
- **Touch, two thumbs:** slide the left pad to steer, the right pad up to accelerate and down to brake / reverse.
- **Races:** 2–5 laps depending on the track, from a grid behind the line, after a 3-2-1 countdown. Opponents' pace is spread around your best lap on that track, so a few are quicker than you and most are slower, and they speed up as you do. In your first race on a track they start from an average player's pace and adjust to your laps as you go.
- **Tracks:** Classic (the Starter Kit layout) and three loosely modelled on real circuits: Indianapolis (the oval's four left turns), Monza (its chicanes, Curva Grande, the Lesmos and Parabolica) and Monaco (Sainte Dévote, Casino, the hairpin, the tunnel, the pool and Rascasse). Pieces are 90° only, so they're squeezed approximations. Custom tracks come from the editor (`editor.html`, `?map=`).
- **Cars:** all drive the same. Size is collision volume and mass: karts get pushed around, fire and garbage trucks do the pushing.


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

`models/src/` holds the original Kenney models: Starter Kit Racing (track, decorations, trucks) and Car Kit 3.1 in `models/src/cars/` (25 vehicles and debris parts). `npm run models` compresses them (meshopt, quantized) into `models/` and `models/cars/` and regenerates `js/CarList.js` from the cars' bounds; `npm run thumbs` re-renders the car picker's thumbnail sheet (`sprites/cars.webp`). The outputs are committed, so a build doesn't need either step.

## Simulation

The race simulation (`js/Race.js`: physics, NPC drivers, car-to-car collisions, laps and positions) has no DOM, so it also runs headless in Node:

```bash
npm run sim -- --calibrate   # NPC lap time by skill on each track
npm run sim -- --soak        # 9 NPCs × 20 laps × every track: nobody gets stuck
npm run sim -- --balance     # an AI stand-in for the player races the field twice, as in the game
npm run tracks               # check and draw the built-in track layouts
```

## Testing

```bash
npm run perf:load  # cold-load time to interactive under throttled network/CPU
npm run playtest   # bots play through real keyboard/touch input and record video
npm run playtest -- --scenario desktop-keyboard,rotate-mid-race --laps 2 --no-record
```

Playtest recordings and reports go to `playtests/` (gitignored). Scenarios: `desktop-keyboard`, `laptop-keyboard`, `phone-portrait-touch`, `phone-landscape-touch` (joystick), `phone-portrait-pads`, `phone-landscape-pads`, `tracks`, `race`, `race-flow`, `custom-tracks`, `rotate-mid-race`, `pause-resume`, `zoom-lock`, `offline-file`, `framerate`. The bots read the game's state through `window.__kerb` (present with `?playtest` or in dev) and never inject into it.

`race` has keyboard bots race the NPCs, twice per skill (the first race sets the best lap the second is paced from): `npm run playtest -- --scenario race --race-tracks classic,monza --race-skills average --npcs 4`.

## Credits

- Game assets by [Kenney](https://kenney.nl/) (CC0): [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing) and [Car Kit](https://kenney.nl/assets/car-kit)
- Track layouts loosely inspired by the circuits at Indianapolis, Monza and Monaco
- Physics engine: [crashcat](https://github.com/isaac-mason/crashcat)
- Ported to JavaScript with [Claude](https://claude.ai/)
- A JavaScript/Three.js port of [Kenney's Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing).
    - [Devlog](https://x.com/mrdoob/status/2048358619985690935)
