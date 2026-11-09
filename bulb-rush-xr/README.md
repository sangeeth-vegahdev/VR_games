# Bulb Rush

A seated, hands-first reaction game for Meta Quest and Meta VR Glasses, built with the Immersive Web SDK (WebXR).

You sit on a rooftop at night, above a sleeping city, with a curved wall of 38 hanging bulbs inside arm's reach. One bulb
glows. Touch it before the ring closes. Your score powers the city: its windows come on as you play, it browns out when
you lose a heart, and it goes dark when you lose.

## How to play

| Bulb | What to do |
| --- | --- |
| **Cyan**, with a ring that shrinks onto it | Point at it (or touch it) before the ring closes |
| **Red with an X** | Never touch it. Touching one costs a heart; leaving it alone is free |
| **Gold with a star** | Triple points. If it fades, nothing is lost |
| **Two bulbs joined by lightning** | Touch both within 0.6 seconds for double points on the second |
| Any dark bulb | Touching one while a target is lit costs your streak, not a heart |

- Pick **3 hearts** or **5 hearts**, then touch **START**. Your very first round starts with three slow bulbs that cannot hurt you.
- Faster touches score more. Hits in a row build a multiplier (up to x5). A streak of 12 wins a heart back.
- Every 5 hits the level goes up: targets stay lit for less time and the pause between them shrinks.
  Gold bulbs arrive at level 2, red decoys at level 3, and lightning pairs at level 5.
- **SURGE**: 15 hits fill the meter. **Clap your hands** (or touch the SURGE button) for 8 seconds of up to three bulbs at
  once, at double points, with no penalties.
- The results screen shows score, accuracy, average and fastest reaction, best streak and level. Best scores, your fastest
  reaction and your lifetime score are saved on the device. Lifetime score earns a rank and keeps part of the city lit.

## Controls (all of these work, none is required)

- **Hands (easiest)**: just **point** your hand at a glowing bulb and hold it there for a moment (0.2 s) and it lights up and scores. Point at a menu button for under a second to press it. Dark and red X bulbs never fire from pointing, so sweeping across the board is safe. Pinching or poking also works. A single pinch anywhere, with either hand, starts a round from the menus. Poke a bulb with your index finger, or aim the pinch ray and pinch. Playable end to end without pairing a
  controller, menus and Exit included.
- **Meta VR Glasses**: look at a bulb and pinch. No extra code path: gaze uses the same interactables as the rays.
- **Controllers**: point and press the trigger. A/X/B/Y or grip starts a round (and fires SURGE).
- **Desktop / phone**: click or tap. Space or Enter starts a round and sets off a surge.

## Built for a short, seated session

- The board is centred on where you sit when the session starts and follows you gently in the menus. The city and sky
  stay still, and nothing moves the player. Nothing needs room-scale movement.
- Everything you must see or touch fits the Meta VR Glasses view (37 degrees sideways, 25 up, 43 down). `tests/features.cjs` measures it.
- Rounds are short and end when the hearts run out. The game draws its whole world from code, and generates its music and
  sound, so the only models it downloads are the two hand meshes.
- Taking the headset off, opening the system menu, or having no hands or controllers in view for 2 seconds pauses the
  game. It resumes with a 2-second countdown.
- Nothing flashes faster than 3 times a second, and the music's beat stays under that too (144 BPM at most).

## Low latency by design

- Hits are handled the moment the SDK reports a press, in the same frame, with no extra polling.
- Sounds are generated with Web Audio (no files to decode) and start instantly. A target lighting up plays a soft
  ping from its direction (HRTF 3D audio), and each hit climbs a pentatonic scale along your streak.
- Text panels are redrawn only when their content changes. A glow that is not visible costs no draw call. The 38 bulbs are
  five instanced meshes, so five draw calls.

## Run it

```bash
npm install
npm run dev:runtime        # https://localhost:8081 (or: npx vite --port 8083)
```

Open the network URL on a Quest on the same Wi-Fi network (accept the local certificate warning), or use the IWSDK
emulator in the desktop browser. `npm run build` makes a static `dist/` for any web host. The repo's GitHub Pages
workflow publishes it at `/bulb/`.

URL options: `?hearts=5` sets the starting hearts, `?tutorial=0` skips the first-round tutorial.

## Tests

With the dev server running on port 8083:

```bash
npm test
```

- `tests/play.cjs`: desktop mouse play-through, scoring, hearts, game over, saved best, a long simulated session.
- `tests/xr.cjs`: an emulated Quest with emulated hands (fingertip poke and aim-and-pinch).
- `tests/features.cjs`: tutorial, SURGE, lightning pairs, the city, ranks and the fit inside the Glasses view.

They run on a CPU renderer, so they check behaviour, not frame rate. Check frame rate on a real headset.

## Layout

- `src/game.js` game flow, difficulty, scoring, surge, pause/resume
- `src/board.js` the bulbs, frame and buttons (each bulb is one entity, ray- and poke-interactable)
- `src/stage.js` the rooftop, sky, moon, city and fireworks
- `src/hud.js`, `src/fx.js` panels, sparks, lightning and popups
- `src/sound.js` generated music and spatial sound
- `src/hands.js` solid hand visuals (generic hand model, MIT, see `public/LICENSE-webxr-input-profiles.txt`)
