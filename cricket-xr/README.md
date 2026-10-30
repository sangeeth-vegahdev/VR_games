# Cricket Catch (Meta Immersive Web SDK, WebXR, hand tracking)

A coach swings a bat, the ball flies at you (it swings in the air and gets faster every ball) and you
catch it with your bare hands. 50 balls per round, score and misses, then touch the green ball to
play again. Built on the Meta Immersive Web SDK (IWSDK, Three.js based). No models, textures or audio
files: the stadium, coach, sounds and effects are all generated in code.

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
| `src/stadium.js` | Pitch, stands, crowd, floodlights, coach and bat |
| `src/hud.js` | World-space scoreboard and title / round-over card (canvas textures) |
| `src/fx.js` | Generated sounds, catch particles, ball trail |
| `iwsdk.config.json`, `public/scenes/` | IWSDK project config (hand tracking on) and the sky |
| `tests/headless-game.cjs` | End-to-end test with emulated hands |

## Tuning

`src/config.js`: `balls`, `rampBalls`, `startSpeed`, `maxSpeed`, `swingBase`, `swingMax`, `catchRadius`. `src/game.js`
reads the palm position from the player's grip space; if catches feel off on a real headset, adjust
`catchRadius` first.

## Test

With `npm run dev:runtime` running:

```bash
node tests/headless-game.cjs               # quick: 8-ball rounds
BALLS=50 node tests/headless-game.cjs      # full-length rounds (several minutes in a software-rendered browser)
# if Playwright's own Chromium is not installed:
CHROME_PATH=/path/to/chrome node tests/headless-game.cjs
```

It plays one round with a hand always meeting the ball (expects every ball caught), restarts by touching
the green ball, then plays a round with hands out of the way (expects every ball missed), and checks that
speed ramps up and stays under the cap, the ball swings, the swing grows, and the page logs no errors.

## Not yet verified

Only tested in the IWER emulator with emulated hands. Not tested on a real Quest: real hand-tracking
feel, comfort, audio start on device, and frame rate. The hand model files the SDK loads from a CDN
need internet access.
