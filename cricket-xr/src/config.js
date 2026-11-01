// Gameplay tuning. Units: metres, seconds, m/s. The player stands at the origin facing -Z.
// Round length: 50 balls by default. `?balls=N` in the URL overrides it (handy for quick tests).
const ballsOverride = Number(new URLSearchParams(globalThis.location?.search ?? '').get('balls'));

export const CFG = {
  balls: Number.isInteger(ballsOverride) && ballsOverride > 0 ? ballsOverride : 50,
  rampBalls: 25, // speed and swing climb over this many balls, then hold at their maximums
  startSpeed: 12, // m/s for ball 1 (43 km/h)
  maxSpeed: 22, // m/s once fully ramped (79 km/h)
  speedJitter: 1.5, // +/- m/s of variety once fully ramped, so late balls are not all identical
  swingBase: 1.4, // sideways acceleration (m/s^2) for ball 1
  swingMax: 7, // faster balls are airborne for less time, so swing must grow to keep bending
  gravity: 3, // stylised, so the ball arcs gently instead of dropping like a stone
  catchRadius: 0.25, // palm-to-ball distance that counts as a catch
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
};

export const COACH_Z = -18;
export const COACH_HEIGHT = 2.6; // metres: oversized on purpose, so the swing reads from 18 m away
export const RELEASE = { x: 0, y: 1.5, z: -16.2 };
// The ball leaves the bat this many seconds into the swing clip (attack-melee-right is 0.42 s long).
export const CONTACT_T = 0.2;
// Where the bat sits in the right-arm bone's space (bone units; tuned by eye).
export const BAT_MOUNT = { position: [-0.17, 0, 0], rotation: [0.45, 0, -0.29], length: 1.5 };

export const RESTART_POS = { x: 0, y: 1.25, z: -0.65 };
export const RESTART_RADIUS = 0.2;
