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

A life-size coach on a village-green cricket ground tosses a ball up and hits it to you with his bat. You
catch it with your real hands. Each round is 50 balls. The ball swings in the air, bending sideways on its way in,
and it gets faster and swings more over the first 25 balls. A soft ring shows where the ball will arrive,
the coach raises his bat when you catch it and shrugs when you miss, and the scoreboard tracks your score, misses and streak. When the round ends,
you touch a green ball to play again. No headset? Open the link on a PC and use the mouse as your hand.

## How we built it

- Meta Immersive Web SDK (IWSDK) on Three.js and WebXR, with WebXR hand tracking: a catch is a palm within
  range of the ball's path, tested along the path between frames so a fast ball cannot skip past a hand.
- The ball's path is solved so that gravity and swing curve it into a chosen arrival point near the
  player's chest, wherever their head is, so it visibly bends but stays catchable.
- Solid, skin-toned tracked hands (every finger follows your own) that ship with the game, so they appear
  even on a network that blocks the SDK's hand-model CDN.
- A cricket ball drawn in code: red leather, stitched seam held upright and leaning into the swing,
  spinning about the seam, with a glow that helps you pick it up off the bat and fades as it reaches you.
- A realistic coach: a CC0 human model (Quaternius Universal Base Characters) dressed in a training kit we
  painted onto his texture by script, with a CC0 idle clip. His swing, toss, bat-raise and shrug are key
  poses solved with two-bone IK every frame, so the bat sits in his fist and the tossed ball meets the bat's
  sweet spot at the moment of contact; the ball then leaves from there.
- A cricket ground drawn in code: mown grass with stripes, a clay pitch with creases to the Laws'
  measurements, a boundary rope, a sightscreen behind the coach (so the red ball stands out), and sun
  shadows; the ball's shadow on the pitch helps you judge where it will land. The bat is built in code too.
- Free CC0 scenery and sounds (Kenney, Quaternius) and an MIT hand model from the WebXR input profiles.
  The whole build is about 6.5 MB.
- Tested in the IWER emulator with scripted hands (14 automated checks): full 50-ball rounds, caught and
  missed, restart by touch, rising speed and swing, bat meeting the tossed ball every time, both hands
  drawn, and a full mouse-played round on desktop.

## Challenges

- Making swing feel fair: a ball that curves unpredictably is frustrating, so the path is solved to end
  inside the catching area, and the swing grows as the ball gets faster so it keeps bending.
- A real depth-buffer problem: thin ground layers flickered and vanished on a coarse depth buffer, so they
  are drawn in a fixed order instead.
- Most of the models shipped in a compressed format IWSDK's loader cannot read, so we converted them once.

## Accomplishments

Draft (edit to taste):
- Hands-only play: no controllers, no buttons, no menus to point at. Even starting a round is a touch.
- A coach who really plays the shot: the ball is tossed, struck by the bat and leaves from the bat face,
  every time, which the automated test checks on every ball.
- Anyone can try it from a link: on a PC the mouse becomes your hand.
- An end-to-end test that plays full rounds in an emulated headset in under a minute.

## What we learned

Draft (edit to taste):
- Hand tracking rewards generous, honest catch zones: testing along the ball's path between frames
  matters more than a big radius.
- A ball that curves has to curve into somewhere fair; solving the path backwards from the arrival point
  gave swing that looks wild but stays catchable.
- Small cues carry a lot in VR: the ball's shadow on the pitch and a white sightscreen behind the coach
  make a fast red ball much easier to read.

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

Coach: Quaternius Universal Base Characters and Universal Animation Library (quaternius.com), CC0. Scenery
and sound effects: Kenney (kenney.nl) and Quaternius, CC0. Hand model: `generic-hand` from WebXR Input
Profiles (MIT). See `ASSETS.md`.
