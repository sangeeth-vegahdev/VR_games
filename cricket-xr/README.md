# Cricket Catch (Meta Immersive Web SDK, WebXR, hand tracking)

A coach tosses a ball up and hits it to you with his bat; the ball swings in the air and gets faster every
ball, and you catch it with your bare hands. 50 balls per round, score and misses, then touch the green ball
to play again. Built on the Meta Immersive Web SDK (IWSDK, Three.js based). A village-green cricket ground
with a realistic, life-size coach (a CC0 human model), free CC0 scenery and sounds (see `ASSETS.md`); the
pitch, bat, ball, cap, HUD and effects are generated in code.

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

## Play without a headset

Open the page in a desktop browser: no headset is needed. Move the mouse to move your hand (a hand model
inside a cyan ring that shows its catch reach) and touch the green ball to start. With a headset, press **Enter XR** and use your real hands.

## How it plays

- The coach holds the ball in his left hand, tosses it up and strikes it with the bat. The toss is aimed so
  the ball meets the bat's sweet spot at the moment of contact, and it leaves from there, aimed at chest
  height wherever your head is. He raises his bat when you catch it and shrugs when you miss.
- **Speed** and **swing** both climb over the first 25 balls (43 km/h up to 79 km/h; a sideways force
  curves the ball in the air, solved so it bends INTO the catching area). After that they hold at the
  maximum, with a little speed variety so later balls are not identical.
- A round is 50 balls (about 3 minutes). Change `balls` in `src/config.js` for 100, or add `?balls=N` to
  the URL for a one-off length.
- **Catching is contact with the hand as it is drawn.** The palm, its facing and its fingers are read
  from the tracked hand's joints (not the grip pose, which sits a couple of centimetres away). A catch
  is the ball's centre coming within its own radius plus `handMargin` (6.5 cm: the palm's width and the
  fingers) of the palm. The test is swept between frames *relative to the hand*, so neither a fast ball
  nor a fast hand can pass through the other. The flight itself is exact (not stepped frame by frame),
  so the ball arrives precisely at the ring, whatever the frame rate.
- A ball arriving behind the palm glances off the back of the hand. Both palms near the ball make a
  two-handed catch, cradled between them. A caught ball eases into the cup of the hand from the point of
  contact (no snapping), resting towards the thumb so it shows past the edge of the hand, with a faint
  outline through the hand. A near miss tells you by how much ("Just missed: 7 cm").
- A soft ring marks where the ball will arrive, over the last 9 m of its flight (`aimHint` in `config.js`).
- The ball is a cricket ball drawn in code: red leather and a stitched seam, held upright and leaning
  towards the way it swings, spinning about the seam. A soft glow helps you pick it up off the bat and fades
  as it reaches you so the leather shows.
- Your hands are solid, skin-toned hand models driven by hand tracking (every finger moves). They ship with
  the game (`public/models/hand-*.glb`) instead of the SDK's outline hands from a CDN, so they always appear.
- The scoreboard shows streaks, the end card shows your best streak, and your best score is remembered
  in the browser. Taking the headset off pauses the game.

## Files

| File | Job |
|---|---|
| `src/config.js` | All tuning: balls per round, difficulty ramp, speeds, swing, catch radius, delays |
| `src/game.js` | `GameSystem`: round state machine, ball flight, catch detection, scoring, restart |
| `src/stadium.js` | Sun and shadows; grass and pitch textures drawn in code (mowing stripes, creases to the Laws' measurements, wear); stumps, boundary rope, sightscreen, and the scenery (fence, trees, bushes, tent, rocks) |
| `src/coach.js` | The coach: idle clip plus key-posed swing, toss, bat-raise and shrug, solved with two-bone IK so the bat sits in his fist and meets the ball |
| `src/bat.js` | The cricket bat, built in code: willow blade with a rounded spine, sloped shoulders, label, ridged grip |
| `tools/coach/` | Scripts that rebuild `public/models/coach.glb` from the CC0 source packs (see its README) |
| `src/desktop-hand.js` | Mouse-controlled hand for visitors without a headset |
| `src/hands.js` | Solid hand models for hand tracking, loaded from the game's own files |
| `src/ball.js` | The cricket ball: leather and seam texture drawn in code, glow that fades as it nears |
| `src/assets.js` | Asset list for IWSDK's loader |
| `ASSETS.md` | Where every model and sound came from, and its licence |
| `src/hud.js` | World-space scoreboard and title / round-over card (canvas textures) |
| `src/fx.js` | Sound (CC0 files, with generated fallbacks), catch particles, ball trail |
| `iwsdk.config.json`, `public/scenes/` | IWSDK project config (hand tracking on) and the sky |
| `tests/headless-game.cjs` | End-to-end test with emulated hands |

## Tuning

`src/config.js`: `balls`, `rampBalls`, `startSpeed`, `maxSpeed`, `swingBase`, `swingMax`, `handMargin`,
`backOfHand`, `settleTime`. `src/game.js` reads the palm from the tracked hand's joints (falling back to
the grip pose); if catches feel too strict or too generous on a real headset, adjust `handMargin` first.

## Test

With `npm run dev:runtime` running:

```bash
node tests/headless-game.cjs               # 8-ball rounds, about 35 seconds
BALLS=50 node tests/headless-game.cjs      # full 50-ball rounds, under a minute
# if Playwright's own Chromium is not installed:
CHROME_PATH=/path/to/chrome node tests/headless-game.cjs
```

It starts an emulated XR session, then plays one round with every ball caught, restarts by touching the
green ball, and plays a round with every ball missed. It then checks the catch itself: the palm read
from the drawn hand faces the way the hand does; a ball 23 cm from the hand is missed (and the miss
says by how much); a ball touching the fingers is caught; a hand flicking across the ball's path catches
it; a ball meeting the back of the hand glances off; two hands make a cradled two-handed catch; a caught
ball eases into the cup of the hand; and every ball arrives at the ring within 1 cm. It checks that speed ramps up and stays under the cap,
that the ball swings, that the swing grows, that both tracked hands are drawn with the game's own hand models,
that the coach's toss meets the bat (under 5 cm at contact) on every ball, that a mouse player can finish a
round, and that the page logs no errors (25 checks).

The rounds are stepped at a fixed 60 Hz inside the page, and the palm is placed on the ball's grip space
directly. The software renderer in a container runs at a few frames per second, so real-time play would take
many minutes. The emulator's hand-tracking path was checked separately with a single 8-ball run.

## Preview footage

`tests/record-preview.cjs` records a short player's-eye clip of a 3-ball round (catch, miss, catch) from the
emulator as PNG frames; the header of the file has the ffmpeg line to turn them into a video. It is a quick
preview, not a substitute for footage from a real headset.

## Deploy

`npm run build` writes a static site to `dist/` (relative paths, so it works under any sub-path). Host it on
any HTTPS static host; WebXR needs HTTPS. Two ways:

- **GitHub Pages:** `.github/workflows/pages.yml` builds and publishes it. Merge to `main`, then in the repo
  go to Settings > Pages and set Source to "GitHub Actions". The link will be
  `https://<user>.github.io/<repo>/`. The workflow has not been run yet.
- **Vercel / Netlify:** import the repo, set the root directory to `cricket-xr`, build command
  `npm run build`, output directory `dist`.

Then open the link in the Quest browser and press Enter XR.

## Not yet verified

Only tested in the IWER emulator with emulated hands. Not tested on a real Quest: real hand-tracking
feel, comfort, audio start on device, and frame rate.
