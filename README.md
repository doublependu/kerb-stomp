# Starter Kit Racing



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

## Testing

```bash
npm run perf:load  # cold-load time to interactive under throttled network/CPU
npm run playtest   # bots play through real keyboard/touch input and record video
npm run playtest -- --scenario desktop-keyboard,rotate-mid-race --laps 2 --no-record
```

Playtest recordings and reports go to `playtests/` (gitignored). Scenarios: `desktop-keyboard`, `laptop-keyboard`, `phone-portrait-touch`, `phone-landscape-touch`, `custom-tracks`, `rotate-mid-race`, `pause-resume`, `zoom-lock`, `offline-file`, `framerate`. The bots read the game's state through `window.__kerb` (present with `?playtest` or in dev) and never inject into it.

## Credits

- Game assets by [Kenney](https://kenney.nl/) (CC0)
- Physics engine: [crashcat](https://github.com/isaac-mason/crashcat)
- Ported to JavaScript with [Claude](https://claude.ai/)
- A JavaScript/Three.js port of [Kenney's Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing).
    - [Devlog](https://x.com/mrdoob/status/2048358619985690935)
