# Devpost submission draft: Cricket Catch

Draft text for the Devpost form. Items in [square brackets] are facts only the team can fill in.
Check the official rules for required fields, length limits and the video format before submitting.

## Tagline

Catch a swinging cricket ball with your bare hands.

## Track

Gaming

## Inspiration

Catching is the most natural thing you can do with your hands, and hand tracking is the one thing a
controller cannot fake. We wanted a game where your hands are the whole interface: no buttons, no menus
to point at, just reach out and catch.

## What it does

A friendly coach on a village-green cricket ground swings a bat and sends a ball at you. You catch it
with your real hands. Each round is 50 balls. The ball swings in the air, bending sideways on its way in,
and it gets faster and swings more over the first 25 balls. A soft ring shows where the ball will arrive,
the coach cheers or shrugs, and the scoreboard tracks your score, misses and streak. When the round ends,
you touch a green ball to play again. No headset? Open the link on a PC and use the mouse as your hand.

## How we built it

- Meta Immersive Web SDK (IWSDK) on Three.js and WebXR, with WebXR hand tracking: a catch is a palm within
  range of the ball's path, tested along the path between frames so a fast ball cannot skip past a hand.
- The ball's path is solved so that gravity and swing curve it into a chosen arrival point near the
  player's chest, wherever their head is, so it visibly bends but stays catchable.
- Free CC0 art (Kenney, Quaternius) for the coach, scenery and sounds. The pitch, bat, ball, scoreboard
  and effects are generated in code. The whole build is about 5 MB and about 130 draw calls.
- Tested in the IWER emulator with scripted hands: full 50-ball rounds, caught and missed, restart by
  touch, rising speed and swing, and a full mouse-played round on desktop.

## Challenges

- Making swing feel fair: a ball that curves unpredictably is frustrating, so the path is solved to end
  inside the catching area, and the swing grows as the ball gets faster so it keeps bending.
- A real depth-buffer problem: thin ground layers flickered and vanished on a coarse depth buffer, so they
  are drawn in a fixed order instead.
- Most of the models shipped in a compressed format IWSDK's loader cannot read, so we converted them once.

## Accomplishments

[Fill in: what you are most proud of. Suggested: hands-only play that works with no controllers; a full
desktop fallback so anyone can try it from a link; a fast scripted test suite.]

## What we learned

[Fill in.]

## What's next

- Tune the catch feel on more headsets and hand sizes.
- Two-handed "cup" catches, different ball types, and a bowling-machine mode with adjustable swing.
- Spatial audio and a leaderboard.

## Built with

Meta Immersive Web SDK, Three.js, WebXR (hand tracking), JavaScript, Vite, Playwright (tests),
Kenney and Quaternius CC0 assets.

## Try it

- Play: [public HTTPS link]. Headset: open it in the Quest browser and press Enter XR. PC: open it and
  use the mouse.
- Code: https://github.com/sangeeth-vegahdev/VR_games (folder `cricket-xr`)
- Demo video: [link]

## Testing notes

Tested in the IWER emulator (scripted hands) and in desktop browsers. Tested on a Quest: [yes/no, which
device, what was learned].

## Credits

3D models and sound effects: Kenney (kenney.nl) and Quaternius (quaternius.com), CC0. See `ASSETS.md`.
