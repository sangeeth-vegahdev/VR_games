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
  // A catch is the ball touching the hand. Each hand is capsules (palm, fingers, thumb, forearm);
  // see catching.js. Radii are the hand's thickness plus a little tolerance.
  handMargin: 0.095, // round contact volume for a bare position with no hand shape (a controller)
  palmRadius: 0.07,
  fingerRadius: 0.048,
  thumbRadius: 0.05,
  forearmRadius: 0.04,
  cuppedBonus: 0.045, // extra reach when two close hands make a cup
  pocketSlack: 0.045, // two hands: the ball only has to be this close (plus its radius) to the line between the palms
  pocketFront: 0.02, // ...and this far in front of both palms (not level with them or behind)
  wristCutoff: 0, // a ball centre this close to the wrist (along the hand), or behind it, hit the wrist/forearm
  backSide: 0.07, // ball centre more than this behind the palm plane = back of the hand
  facingPalm: 0.2, // palm contact: ball must be moving into the palm (cosine of angle to the palm normal)
  facingFinger: -0.1, // finger/thumb contact must be more square on than that
  fistOpenness: 0.08, // below this (fingertips within ~5 cm of the palm) the hand is a clenched fist: knuckles cannot catch
  deflectRestitution: 0.35, // bounce off the back of a hand
  stretchReach: 0.45, // a palm this far out sideways from its own shoulder (or across the body) is a stretching catch
  highPalm: 0.35, // palm this far above the shoulders (about head height or more): a high catch
  lowPalm: 0.5, // palm this far below the shoulders (below the waist; the player also crouches): a low catch
  fastBall: 17, // m/s relative to the hand: a fast catch
  giveSpeed: 0.6, // m/s the hand travels with the ball: soft hands
  movingHands: 0.9, // m/s hand speed: caught on the move
  settleTime: 0.14, // seconds for a caught ball to settle into the palm (cushioned, no snapping)
  twoHandGap: 0.28, // palms closer than this together can make a two-handed cup
  nearMiss: 0.4, // a miss closer than this tells you by how much
  arriveZ: -0.65, // how far in front of the player the ball arrives: comfortable arm's reach
  targetSpreadX: 0.35, // random arrival offset left/right (kept inside the headset's field of view)
  wideChance: 0.14, // share of balls (after wideFromBall) that arrive wide: a one-handed stretch
  wideFromBall: 6,
  wideSpreadX: 0.78, // how far out a wide ball arrives (the lateral reach beyond a two-hand catch)
  targetSpreadY: 0.15, // random arrival offset up/down for chest deliveries
  lowBallChance: 0, // share of deliveries that are low (knee/shin) balls; 0 = removed from the game
  chestBelowHead: 0.4, // chest arrival height, measured below the headset
  highCatchOffset: 0.35, // height above head for high skiers
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
