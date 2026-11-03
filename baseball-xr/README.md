# Glove Up: a baseball catching drill (Meta Immersive Web SDK, WebXR, hand tracking, eye tracking)

You are the catcher. A young right-hander in an "Aces" uniform takes the mound under the lights, comes set,
kicks, strides and fires; you catch the pitch in your mitt, one-handed. Fastballs first, then changeups,
curveballs and sliders, getting quicker and moving more as the round goes on. Keep your eyes on the ball all
the way into the mitt: the game watches where you look and scores it. 25 pitches per round. Built on the
Meta Immersive Web SDK (IWSDK, Three.js based), separate from Cricket Catch (`../cricket-xr`) and sharing no
code with it at run time.

Hands-first and seated-friendly: a catcher crouches, so playing seated feels natural, and the pitches are
aimed at your chest wherever your head is.

## Run it

```bash
npm ci
npm run dev:runtime      # Vite dev server on https://localhost:8082 (accept the local certificate warning)
```

Open `https://localhost:8082` in Chrome or Edge. In dev mode the IWSDK emulator (IWER) is injected, so no
headset is needed: press **Enter XR**, switch the emulator input to **hands**, then put a hand on the green
ball (or press Space) to start. Cricket Catch runs on port 8081, so both can run at once.

On a Quest: open `https://<your computer's LAN IP>:8082` in the headset's browser (same Wi-Fi, accept the
certificate warning), or deploy (see below).

## Play without a headset

Open the page in a desktop browser. The mouse moves your mitt; press Space (or touch the green ball) to start,
and G to swap the mitt to the other hand. Eye focus is not measured on a PC.

## How it plays

- **The pitcher** is a realistic, life-size CC0 human (see `ASSETS.md`), painted into a baseball uniform:
  scarlet "Aces" jersey with 17 on the back, navy undershirt and cap, road-grey pants, scarlet socks, black
  cleats, and a black fielder's glove on his left hand. His whole delivery is key-posed in `src/pitcher.js`
  with two-bone IK on both arms and both legs: the stretch, the leg kick, the stride, hips opening before the
  shoulders, the arm cocked behind the head, release out in front, follow-through across the body, and a
  fielding stance. The ball is in his fingers until the release frame and leaves from there. He keeps
  looking in at you, fist-pumps when you catch it, shakes his head when you miss, and walks back up onto the
  rubber between pitches.
- **The pitches** (`PITCHES` in `src/config.js`): fastball (with backspin lift), changeup (same arm speed,
  slower, fading), curveball (from pitch 9: the big 12-to-6 drop) and slider (from pitch 14: sharp sideways
  break). Speed climbs from 34 mph to about 63 mph over the first 18 pitches, and the movement grows with it.
  Each path is solved so gravity and the break curve the ball INTO a target at your chest, so it really
  breaks but stays catchable.
- **The mitt**: a catcher's mitt built in code (padded pocket, laced rolled rim, hinged thumb, web, wrist
  strap with a club patch). It sits on your glove hand (left by default; touch the gold ball on the menu to
  swap, or `?glove=right`) from the hand-tracking joints, and closes as you close your fingers. Only the mitt
  catches: a pitch that hits your bare hand is a miss ("Use the mitt!"). A catch is the pocket within
  `catchRadius` of the ball's path, swept between frames so a fast pitch cannot skip through.
- **Eyes on the ball** (`src/gaze.js`): the game asks the headset for eye gaze (`gazeTracking` in
  `iwsdk.config.json`). With eye tracking (Quest Pro, or any headset that exposes it) it uses your eyes;
  without it (Quest 3 and 3S have no eye-tracking cameras) it uses the direction of your head, with a wider
  cone. The ball's glow turns green while you are watching it. After each pitch the scoreboard shows the
  share of the flight you watched, a miss tells you how far out you looked away, and the round card shows your
  average and whether it came from your eyes or your head.
- **Early help**: for the first 8 pitches a strike-zone frame marks where the pitch will cross.
- **The ballpark** is a night game under the lights, all drawn in code: striped outfield, a painted infield
  (dirt arc, base paths, mound and home circles, chalked foul lines, batter's and catcher's boxes), a raised
  mound with the rubber, home plate and bases, a padded wall with foul poles and ad boards, a dark batter's eye
  straight behind the pitcher so the white ball stands out, stands with about 3,600 fans, light towers and
  stars. Distances are real: 60 ft 6 in from the rubber to the plate, 90 ft bases.
- Sound: a leather pop in the mitt, a whoosh off the hand, a crowd murmur that swells on a catch and groans
  on a miss (generated), plus a few CC0 effects. Your best score is remembered; taking the headset off pauses.

## Files

| File | Job |
|---|---|
| `src/config.js` | All tuning: pitches per round, ramp, speeds, pitch types and their break, catch radius, focus cones |
| `src/game.js` | `GameSystem`: the round's flow, the pitch's flight, catches and misses, focus scoring, menu |
| `src/pitcher.js` | The pitcher: idle clip plus full-body key poses (delivery, reactions, walk back) solved with IK |
| `src/glove.js` | The mitt, built in code (also used, smaller and black, as the pitcher's glove) |
| `src/player-glove.js` | Puts the mitt on the tracked hand (from its joints), closes it, hides the hand inside |
| `src/gaze.js` | Eyes-on-the-ball tracking: eye gaze when available, head direction otherwise |
| `src/ballpark.js` | Lights, ground textures, mound, plate, bases, wall, batter's eye, stands and crowd, towers, sky |
| `src/ball.js` | The baseball: leather with the real figure-of-eight seam and 108 red stitches, drawn in code |
| `src/hands.js` | Solid hand models for hand tracking, loaded from the game's own files |
| `src/desktop-pointer.js` | Mouse control of the mitt on a PC |
| `src/hud.js` | World-space scoreboard and title / round-over card (canvas textures) |
| `src/fx.js` | Sound (generated, plus CC0 files) and particles |
| `tools/pitcher/` | Scripts that rebuild `public/models/pitcher.glb` from the CC0 source packs (see its README) |
| `tests/headless-game.cjs` | End-to-end test with the emulated headset and hands (22 checks) |
| `tests/record-gameplay.cjs` | Records a catcher's-eye clip as PNG frames |
| `ASSETS.md` | Where every model and sound came from, and its licence |

## Test

With `npm run dev:runtime` running:

```bash
node tests/headless-game.cjs                # four 25-pitch rounds plus a mouse round, about 2 minutes
# if Playwright's own Chromium is not installed:
CHROME_PATH=/path/to/chrome node tests/headless-game.cjs
```

It starts an emulated XR session with hands and plays: a round with every pitch caught in the mitt while
watching the ball; a round with the hands away while looking at the sky; a round where the bare hand goes to
every pitch; and, after swapping the mitt with the gold ball, a round caught with the other hand. Then a
desktop round with the mouse. The 22 checks cover catches and misses, bare-hand misses, all four pitch types
appearing, the curveball dropping and the slider sliding more than the fastball, the speed ramp and cap, the
ball staying in the pitcher's fingers until release, the release point, high focus when watching and low
focus when looking away, the streak and the saved best, swapping hands, the hands and mitt drawn on the right
hands with the mitt on the tracked hand, the mouse round, and no page errors.

The rounds are stepped at a fixed 60 Hz inside the page with a fixed random seed, the mitt is driven from the
grip pose, and the head is pointed by setting its pose (the software renderer in a container runs at a few
frames per second). The mitt-on-the-joints path is checked on live frames before that.

## Gameplay clip

```bash
node tests/record-gameplay.cjs gameplay-frames 5
ffmpeg -framerate 15 -i gameplay-frames/f%04d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p glove-up-preview.mp4
```

A catcher's-eye clip from the emulator (no sound). It is a preview, not a substitute for footage from a real
headset.

## Deploy

`npm run build` writes a static site to `dist/` (relative paths, so it works under any sub-path). WebXR
needs HTTPS.

- **GitHub Pages:** `../.github/workflows/pages.yml` builds both games and publishes Cricket Catch at
  `https://<user>.github.io/<repo>/` and this game at `https://<user>.github.io/<repo>/baseball/`. Merge to
  `main`, then in the repo set Settings > Pages > Source to "GitHub Actions".
- **Vercel / Netlify:** root directory `baseball-xr`, build command `npm run build`, output directory `dist`.

## Not yet verified

Tested only in the IWER emulator with emulated hands and an emulated head. Not tested on a real headset: the
feel of the mitt on real hand tracking, catch radius, real eye tracking (no eye-tracking headset was
available; the emulator reports no eye gaze, so the head path is what was tested), comfort, audio start on
device, and frame rate (about 130k triangles and 175 draw calls per frame on desktop).
