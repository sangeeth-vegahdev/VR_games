// Gameplay tuning. Units: metres, seconds, m/s. The player stands at the origin facing -Z.
export const CFG = {
  balls: 6,
  startSpeed: 12, // m/s for ball 1 (43 km/h)
  speedStep: 1.5, // m/s added per ball
  maxSpeed: 22, // m/s cap (79 km/h)
  swingBase: 1.4, // sideways acceleration (m/s^2) for ball 1
  swingStep: 1.0, // added per ball: faster balls are airborne for less time, so swing must grow to keep bending
  gravity: 3, // stylised, so the ball arcs gently instead of dropping like a stone
  catchRadius: 0.25, // palm-to-ball distance that counts as a catch
  targetSpreadX: 0.5, // random arrival offset left/right of the body line
  targetSpreadY: 0.2, // random arrival offset up/down
  chestBelowHead: 0.45, // arrival height, measured below the headset
  readyDelay: 1.2,
  feedbackDelay: 1.3,
  restartLockout: 1.0,
  maxLife: 5, // safety net for a ball that never resolves
  missZ: 0.2, // a ball past this z (behind the hands) is missed
};

export const COACH_Z = -18;
export const RELEASE = { x: 0, y: 1.2, z: -16.5 };
export const SWING_T = 0.35; // bat swing, seconds
export const RETURN_T = 0.5; // bat return, seconds
export const READY_ANGLE = (-70 * Math.PI) / 180; // bat raised behind the coach
export const FOLLOW_ANGLE = (120 * Math.PI) / 180; // follow-through in front

export const RESTART_POS = { x: 0, y: 1.25, z: -0.65 };
export const RESTART_RADIUS = 0.2;
