# Devpost submission draft: Glove Up! (Baseball)

Draft text for the Devpost form. Items in [square brackets] are facts only the team can fill in.
Check the official rules at https://start-developer-competition-26.devpost.com/rules for required fields and limits before submitting.

Deadline: November 18, 2026, 12:00 PM PT.

## Tagline (under 140 characters)

Crouch behind home plate, catch big-league heat with your bare hands, and frame pitches right on the black.

## Track and division

Gaming. New Experience.

## Inspiration

Being a catcher is one of the most intense, hands-on positions in all of sports. You control the rhythm, call the game, and receive pitches moving at nearly 100 miles per hour. We wanted a WebXR drill where your hands and eyes are the whole interface: squeeze your fingers to close the mitt, hold a steady target to frame the edges, and keep your gaze locked on the ball as it breaks.

## What it does

A right-handed pitcher on a stadium mound comes set, strides, and fires all twelve pitches in the book across 25 deliveries per round. You receive every pitch in your mitt.

- **Dynamic Finger Squeeze:** Squeeze your thumb to middle finger to close the mitt web around the ball.
- **Realistic Pitch Arsenal:** Four-seam fastball (95+ mph), sinker, changeup, cutter, 12-6 curveball, slider, splitter, sweeper, knuckle curve, screwball, knuckleball with flutter, and an eephus.
- **Umpire Calls and Framing:** Borderline pitches are framed into strikes if you receive the ball with quiet hands (glove speed under 1.2 m/s). Stabbing at the ball turns strikes into balls.
- **Eye Gaze Tracking:** Measures focus along the flight path. On Quest 3 and 3S, it tracks head-directed gaze; on Quest Pro, pupil tracking locks the gaze ring directly to the ball in depth.
- **Hand Swapping & Bare-Hand Rule:** Touch the swap orb or press G to switch catching hands. Catching a fastball with your bare hand knocks the ball away and draws a warning from the umpire.
- **Desktop Fallback:** No headset needed to test or play. On desktop, the mouse moves your mitt, Space begins, and G swaps hands.

## How we built it

- Meta Immersive Web SDK (IWSDK v1.1.0-rc.2) on Three.js (r185) and WebXR.
- Hand tracking binding 25 joint spaces. Dynamic thumb-to-middle fingertip distance calculates real-time web closure.
- Relative swept-sphere continuous collision detection (CCD) prevents fastballs from tunneling through the glove between frames.
- Procedural IK animation on a CC0 pitcher model for delivery, release, fist pump, and walk-back.
- Procedural Web Audio API sound synthesis for leather pops, crowd ambience, and umpire callouts.
- 24 automated headless unit tests verifying pitch trajectories, break curves, strike zones, framing math, and gaze cones.

## Challenges

- High-speed anti-tunneling: 95 mph pitches travel over 0.7m per frame at 60 FPS. Continuous swept-sphere tests ensure every catch is detected accurately.
- Strike zone edge perception: Framing required realistic tolerance buffers (4.8 cm zone boundary) and velocity damping.
- Vergence conflict elimination: Projecting the eye-gaze ring to the exact depth of the incoming ball prevents double vision.

## What we learned

- Squeezing real fingers to snap a virtual mitt creates immediate presence without requiring haptic controllers.
- Smooth IK transitions make pitcher windups readable, allowing players to time their catch naturally.

## What's next

- Pitch calling interface: Put down finger signs before the pitch to direct location and pitch type.
- Runner throwdowns: Pick off base stealers by throwing back to second base.

## Built with

Meta Immersive Web SDK, Three.js, WebXR (hand tracking, gaze), Web Audio, JavaScript, Vite, Playwright (tests).

## Try it

- Play: [public HTTPS link, for example https://sangeeth-vegahdev.github.io/VR_games/baseball/]
- Code: https://github.com/sangeeth-vegahdev/VR_games (folder `baseball-xr`)
- Demo video (under 3 minutes, public on YouTube or Vimeo): [link]

## Testing notes

Tested in Meta IWER emulator (Quest 3 profile) and desktop browsers. Tested on a Quest: [yes/no, which device, frame rate, what was learned].

## Credits

Pitcher: CC0 Quaternius Universal Base Characters. Mitt: custom low-poly mesh. Sounds: Web Audio API synthesis. Hand model: WebXR Input Profiles (MIT).

