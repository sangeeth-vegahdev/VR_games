# Glove Up: a baseball catching drill (Meta Immersive Web SDK, WebXR, hand tracking, eye tracking)

You are the catcher. A young right-hander in an "Aces" uniform takes the mound under the lights, comes set,
kicks, strides and fires; you catch the pitch in your mitt, one-handed. You are his battery mate: you put
the sign down, he nods (or shakes you off), you set your target, and he throws all twelve pitches in the
book at real big-league speeds and movement, while the umpire calls every one. Keep your eyes on the ball all
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
G to swap the mitt to the other hand, and L to change the speed level. Eye focus is not measured on a PC.

## How it plays

- **The pitcher** is a realistic, life-size CC0 human (see `ASSETS.md`), painted into a baseball uniform:
  scarlet "Aces" jersey with 17 on the back, navy undershirt and cap, road-grey pants, scarlet socks, black
  cleats, and a black fielder's glove on his left hand. His whole delivery is key-posed in `src/pitcher.js`
  with two-bone IK on both arms and both legs: the stretch, the leg kick, the stride, hips opening before the
  shoulders, the arm cocked behind the head, release out in front, follow-through across the body, and a
  fielding stance. The ball is in his fingers until the release frame and leaves from there. He keeps
  looking in at you, fist-pumps when you catch it, shakes his head when you miss, and walks back up onto the
  rubber between pitches.
- **The pitches** (`src/pitches.js`): the whole arsenal, with MLB Statcast averages for a right-hander
  (speed, induced vertical break, horizontal break, spin rate, share of bullet spin):

  | Pitch | mph (Majors) | Rise / drop (in) | Run (in) | rpm | From pitch |
  |---|---|---|---|---|---|
  | Four-seam fastball | 95 (up to 98) | +16 ride | 8 arm side | 2350 | 1 |
  | Sinker (two-seam) | 94 | +8 | 15 arm side | 2150 | 3 |
  | Changeup | 86 | +6 | 14 arm side | 1750 | 5 |
  | Cutter | 89.5 | +8 | 3 glove side | 2400 | 7 |
  | Curveball | 80 | -10 drop | 9 glove side | 2550 | 9 |
  | Slider (gyro) | 86 | +1 | 5 glove side | 2450 | 11 |
  | Splitter | 87 | +3 | 9 arm side | 1350 | 13 |
  | Sweeper | 82 | +1 | 15 glove side | 2600 | 15 |
  | Knuckle curve | 82 | -11 drop | 6 glove side | 2400 | 17 |
  | Screwball | 77 | -4 | 16 arm side | 2250 | 19 |
  | Knuckleball | 76 | flutters | flutters | ~120 | 21 |
  | Eephus | 52 | high arc | 4 arm side | 1300 | 23 |

  Arm side is the catcher's left (he throws right-handed), glove side the catcher's right. The movement is
  the real number of inches whatever the speed (the spin's acceleration is set from the flight time), and
  gentler on the first pitches of a round. Each new pitch is thrown the first time it unlocks ("New pitch!"),
  so a round sees the whole arsenal; after that he mixes them like a big-league pitcher (four-seamers most,
  the eephus once in a blue moon). The knuckleball has almost no spin and dances late, a different way
  every time. Each path is solved so gravity, the spin and any flutter bring the ball exactly to where it
  crosses.
- **Speed levels** (the blue ball on the menu, L on a PC, or `?level=rookie|pro|majors`): Majors is the real
  thing, a 95 mph four-seamer (0.41 s from his hand to your mitt) that touches 98 when he reaches back; Pro
  (the default) is 82% of that, about 78 mph; Rookie 62%, about 59 mph. Each round starts at 60% and ramps
  up to full speed over the first 18 pitches. Your best score is kept per level.
- **The battery**: before each pitch the sign goes down on the scoreboard ("Sign 2: Curveball, down and
  away"), he looks in and nods, or now and then shakes it off and nods at the next one. A gold ring marks
  the spot you called: set your mitt on it before he comes set and you are giving him a good target, which
  tightens his command. He aims for the ring and misses by a real pitcher's command (about 9 to 13 cm, more
  for the slow breaking balls), so you still have to move to the ball. "Away" assumes a right-handed hitter.
- **The umpire** calls every pitch against a faint strike-zone frame (the 17 in plate plus a ball either
  side): "STRIKE" or "Ball". Catch a pitch just off the edge with quiet hands and you frame it into a
  strike ("Framed: STRIKE"); stab at a pitch on the corner and you lose it ("Stabbed it: Ball"). The round
  card counts strikes called and framed.
- **The mitt**: a real-size catcher's mitt (about 30 x 33 x 15 cm) built in code. A padded body with a
  deep, broken-in pocket and a bulged back; a rolled binding laced all the way round (each lace wraps
  over the roll); a raised thumb pad and heel roll; a laced H-web; finger-stall ridges, a padded hand
  opening and a strap with the club patch on the back (which is what the catcher sees). Pebble-grain
  leather with a bump map, darker where it is broken in. It closes by folding along its hinge, thumb
  side over the pocket, like a real mitt. It sits on your glove hand (left by default; touch the gold ball on the menu to
  swap, or `?glove=right`) from the hand-tracking joints, and closes as you close your fingers. Only the mitt
  catches: a pitch that hits your bare hand is a miss ("Use the mitt!").
- **The catch is contact with the mitt.** A catch is the ball's centre arriving within `catchRadius`
  (15 cm, inside the mitt's 29 cm face) of the pocket, from the front: a pitch that meets the back of the
  mitt glances off. The test is swept between frames relative to the moving mitt, so neither a fast pitch
  nor a fast mitt passes through the other, and the flight is exact (not stepped), so every pitch crosses
  precisely where it was aimed. On a catch the mitt is knocked back and tipped by the ball and springs
  back, folds shut, and puffs out a little dust; the ball stays where it hit (in the pocket, the web,
  the heel or the edge) and the call says which: "POP! Right in the pocket" is the full, deep pop, the
  web a lighter one. A faint outline shows the ball through the leather. A near miss tells you by how
  much ("Just missed: 9 cm").
- **Spin**: each pitch's seams spin about its real axis, the one whose Magnus force gives it its
  movement: backspin on the fastball, topspin on the curveball, side spin on the slider, a tilted spin
  on the fading changeup.
- **Eyes on the ball** (`src/gaze.js`): the game asks the headset for eye gaze (`gazeTracking` in
  `iwsdk.config.json`). With eye tracking (Quest Pro, or any headset that exposes it) it uses your eyes;
  without it (Quest 3 and 3S have no eye-tracking cameras) it uses the direction of your head, with a wider
  cone. The ball's glow turns green while you are watching it. After each pitch the scoreboard shows the
  share of the flight you watched, a miss tells you how far out you looked away, and the round card shows your
  average and whether it came from your eyes or your head.
- **The ballpark** is a night game under the lights, all drawn in code: striped outfield, a painted infield
  (dirt arc, base paths, mound and home circles, chalked foul lines, batter's and catcher's boxes), a raised
  mound with the rubber, home plate and bases, a padded wall with foul poles and ad boards, a dark batter's eye
  straight behind the pitcher so the white ball stands out, stands with about 3,600 fans, light towers and
  stars. Distances are real: 60 ft 6 in from the rubber to the plate, 90 ft bases.
- Sound: a leather pop in the mitt (louder the harder it was thrown), a whoosh off the hand, a crowd murmur that swells on a catch and groans
  on a miss (generated), plus a few CC0 effects. Your best score is remembered; taking the headset off pauses.

## Files

| File | Job |
|---|---|
| `src/config.js` | Tuning: pitches per round, ramp, level, sign timing, catch radius, focus cones |
| `src/pitches.js` | The arsenal (Statcast speeds, movement, spin), levels, pitch calling, command, flutter, the umpire |
| `src/game.js` | `GameSystem`: the round's flow, the sign, the pitch's flight, catches, misses and calls, focus, menu |
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
| `tests/headless-game.cjs` | End-to-end test with the emulated headset and hands (42 checks) |
| `tests/record-gameplay.cjs` | Records a catcher's-eye clip as PNG frames |
| `ASSETS.md` | Where every model and sound came from, and its licence |

## Test

Quick checks that need no browser, no headset and no dev server (a few seconds):

```bash
npm run test:unit        # node --test (19 tests): the arsenal, speeds, movement, spin, calls, umpire, flight maths, gaze
```

With `npm run dev:runtime` running:

```bash
node tests/headless-game.cjs                # four 25-pitch rounds, a Majors round and a mouse round, a few minutes
# if Playwright's own Chromium is not installed:
CHROME_PATH=/path/to/chrome node tests/headless-game.cjs
```

It starts an emulated XR session with hands and plays: a round with every pitch caught in the mitt while
watching the ball; a round with the hands away while looking at the sky; a round where the bare hand goes to
every pitch; after swapping the mitt with the gold ball, a round caught with the other hand; and a round at
Majors speed from pitch 19 on, with the mitt set on the target before each pitch. Then a
desktop round with the mouse, and the catch itself: a pitch 27 cm from the pocket is missed (and says
by how much), one into the edge of the pocket is caught, a mitt flicking across the pitch's line catches
it, a pitch into the back of the mitt glances off, the ball settles into the pocket without snapping,
the mitt recoils and springs back, it snaps shut, a dead-centre catch is called in the pocket and one
into the upper thumb side in the web (each resting where it hit), every pitch spins about its own axis,
and the mitt is real size and folds the thumb side over the pocket when it closes. The 42 checks also cover catches and misses, bare-hand misses, all twelve pitch types
appearing, the movement measured against a spinless ball (the four-seamer rides, the curveball drops, the
sweeper sweeps glove side, the sinker and changeup run arm side), every pitch signed with a nod and the
ring on the called spot, a shake-off, each pitch crossing near the called spot, the umpire calling strikes
and balls, a good target being noticed, a 92+ mph four-seamer caught at Majors level, the speed ramp and cap, the
ball staying in the pitcher's fingers until release, the release point, high focus when watching and low
focus when looking away, the streak and the saved best, swapping hands, the hands and mitt drawn on the right
hands with the mitt on the tracked hand, every pitch crossing within 1 cm of its aim point, the mouse
round, and no page errors.

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
device, and frame rate (about 130k triangles and 175 draw calls per frame on desktop). Whether a 95 mph
pitch at Majors level is catchable on real hand tracking (tracking latency, the headset's frame rate) is
not known yet: that is what the Pro default is for. The Statcast figures are rounded league averages from
public sources, not one pitcher's data.
