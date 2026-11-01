# Cricket Catch (Meta Immersive Web SDK, WebXR, hand tracking)

A coach swings a bat, the ball flies at you (it swings in the air and gets faster every ball) and you
catch it with your bare hands. 50 balls per round, score and misses, then touch the green ball to
play again. Built on the Meta Immersive Web SDK (IWSDK, Three.js based). A village-green cricket ground
with a bat-swinging coach, using free CC0 models and sounds (see `ASSETS.md`); the pitch, bat, ball, HUD
and effects are generated in code.

## Run it

```bash
npm install
npm run dev:runtime      # Vite dev server on https://localhost:8081 (accept the local certificate warning)
```

Open `https://localhost:8081` in Chrome or Edge. In dev mode the IWSDK emulator (IWER) is injected, so
no headset is needed: the emulator panel lets you move the head and both hands and pick poses.
Press **Enter XR** if the page offers it, switch the emulator input to **hands**, then put a hand on the
green ball (or press Space) to start.

`npm run dev` is IWSDK's managed variant (it also opens its own browser); it needs a browser download.

On a Quest: open the same URL from the headset's browser (same Wi-Fi, accept the certificate warning)
or deploy `npm run build` output (`dist/`) to any HTTPS host.

## How it plays

- The ball leaves the bat at the moment of contact and is aimed at chest height wherever your head is.
- **Speed** and **swing** both climb over the first 25 balls (43 km/h up to 79 km/h; a sideways force
  curves the ball in the air, solved so it bends INTO the catching area). After that they hold at the
  maximum, with a little speed variety so later balls are not identical.
- A round is 50 balls (about 3 minutes). Change `balls` in `src/config.js` for 100, or add `?balls=N` to
  the URL for a one-off length.
- A catch is a palm within `catchRadius` of the ball's path. The test is swept between frames so a
  fast ball cannot skip past a hand.

## Files

| File | Job |
|---|---|
| `src/config.js` | All tuning: balls per round, difficulty ramp, speeds, swing, catch radius, delays |
| `src/game.js` | `GameSystem`: round state machine, ball flight, catch detection, scoring, restart |
| `src/stadium.js` | Ground, pitch, stumps, and the scenery (fence, trees, bushes, tent, rocks) |
| `src/coach.js` | The animated coach, with a procedural bat in hand |
| `src/assets.js` | Asset list for IWSDK's loader |
| `ASSETS.md` | Where every model and sound came from, and its licence |
| `src/hud.js` | World-space scoreboard and title / round-over card (canvas textures) |
| `src/fx.js` | Sound (CC0 files, with generated fallbacks), catch particles, ball trail |
| `iwsdk.config.json`, `public/scenes/` | IWSDK project config (hand tracking on) and the sky |
| `tests/headless-game.cjs` | End-to-end test with emulated hands |

## Tuning

`src/config.js`: `balls`, `rampBalls`, `startSpeed`, `maxSpeed`, `swingBase`, `swingMax`, `catchRadius`. `src/game.js`
reads the palm position from the player's grip space; if catches feel off on a real headset, adjust
`catchRadius` first.

## Test

With `npm run dev:runtime` running:

```bash
node tests/headless-game.cjs               # 8-ball rounds, about 10 seconds
BALLS=50 node tests/headless-game.cjs      # full 50-ball rounds, about 10 seconds
# if Playwright's own Chromium is not installed:
CHROME_PATH=/path/to/chrome node tests/headless-game.cjs
```

It starts an emulated XR session, then plays one round with every ball caught, restarts by touching the
green ball, and plays a round with every ball missed. It checks that speed ramps up and stays under the cap,
that the ball swings, that the swing grows, and that the page logs no errors.

The rounds are stepped at a fixed 60 Hz inside the page, and the palm is placed on the ball's grip space
directly. The software renderer in a container runs at a few frames per second, so real-time play would take
many minutes. The emulator's hand-tracking path was checked separately with a single 8-ball run.

## Not yet verified

Only tested in the IWER emulator with emulated hands. Not tested on a real Quest: real hand-tracking
feel, comfort, audio start on device, and frame rate. The hand model files the SDK loads from a CDN
need internet access.
