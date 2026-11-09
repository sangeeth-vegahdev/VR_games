// Gameplay tuning. Units: metres, seconds, m/s. The player stands at the origin facing -Z.
// Round length: 50 balls by default. `?balls=N` in the URL overrides it (handy for quick tests).
const ballsOverride = Number(new URLSearchParams(globalThis.location?.search ?? '').get('balls'));

// First-time practice: three slow, gentle balls before the real round. `?tutorial=0` skips it (tests).
const skipTutorial = new URLSearchParams(globalThis.location?.search ?? '').get('tutorial') === '0';

export const CFG = {
  skipTutorial,
  tutorialBalls: 3, // catches needed to finish the practice
  tutorialSpeed: 8, // m/s for the first practice ball (29 km/h); each next one is a little quicker
  balls: Number.isInteger(ballsOverride) && ballsOverride > 0 ? ballsOverride : 50,
  rampBalls: 25, // speed and swing climb over this many balls, then hold at their maximums
  startSpeed: 12, // m/s for ball 1 (43 km/h)
  maxSpeed: 22, // m/s once fully ramped (79 km/h)
  speedJitter: 1.5, // +/- m/s of variety once fully ramped, so late balls are not all identical
  swingBase: 1.4, // sideways acceleration (m/s^2) for ball 1
  swingMax: 7, // faster balls are airborne for less time, so swing must grow to keep bending
  gravity: 3, // stylised, so the ball arcs gently instead of dropping like a stone
  // A catch is the ball touching the hand: its centre within (ball radius + handMargin) of the palm.
  // The margin covers the palm's width and the fingers, so contact is where the hand is drawn.
  handMargin: 0.095,
  backOfHand: -0.70, // a ball arriving this far behind the palm (cosine) glances off the back of the hand
  settleTime: 0.09, // seconds for a caught ball to settle into the palm (no snapping)
  twoHandGap: 0.28, // both palms within this of the ball at contact: a two-handed catch
  nearMiss: 0.4, // a miss closer than this tells you by how much
  arriveZ: -0.65, // how far in front of the player the ball arrives: comfortable arm's reach
  targetSpreadX: 0.35, // random arrival offset left/right (kept inside the headset's field of view)
  targetSpreadY: 0.15, // random arrival offset up/down
  chestBelowHead: 0.4, // arrival height, measured below the headset
  readyDelay: 0.9,
  feedbackDelay: 1.0,
  restartLockout: 1.0,
  aimHint: true, // show a ring where the ball will arrive, over the last part of its flight
  aimHintFromZ: -9, // ...once the ball is closer than this
  maxLife: 5, // safety net for a ball that never resolves
  missZ: 0.2, // a ball past this z (behind the hands) is missed
  // Eyes on the ball: how close (degrees) the gaze must stay to the ball to count as watching it.
  focusConeEyes: 7, // with real eye tracking
  focusConeHead: 12, // with head direction only (no eye tracking)
};

export const COACH_Z = -17;
export const COACH_HEIGHT = 1.88; // metres, cap included: a tall, real-sized coach
// The ball now leaves from the bat's sweet spot at the moment of contact (see coach.js).

export const RESTART_POS = { x: 0, y: 1.25, z: -0.65 };
export const RESTART_RADIUS = 0.2;
