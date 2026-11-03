// Gameplay tuning. Units: metres, seconds, m/s. The player is the catcher, at the origin facing -Z
// down the line to the pitcher's mound.
const params = new URLSearchParams(globalThis.location?.search ?? '');
const pitchesOverride = Number(params.get('pitches'));

export const CFG = {
  // A round is 25 pitches. `?pitches=N` in the URL overrides it (handy for quick tests).
  pitches: Number.isInteger(pitchesOverride) && pitchesOverride > 0 ? pitchesOverride : 25,
  rampPitches: 18, // speed and movement climb over this many pitches, then hold
  startSpeed: 15, // m/s for pitch 1 (34 mph): an easy lob to learn the glove
  maxSpeed: 28, // m/s once fully ramped (63 mph): quick in VR, but readable
  speedJitter: 1.2,
  gravity: 9.81, // real gravity: a baseball drops visibly over 18 m
  catchRadius: 0.17, // ball centre to the glove's pocket: the mitt is big
  bareHandRadius: 0.09, // a ball this close to the bare hand is a "use the glove" miss
  arriveZ: -0.55, // where pitches cross the catcher's reach, in front of the body
  zoneHalfWidth: 0.3, // pitches arrive within this much left/right of centre...
  zoneHalfHeight: 0.22, // ...and up/down around the target height
  targetBelowHead: 0.35, // target height is measured from the headset, so it suits seated players
  readyDelay: 1.0,
  feedbackDelay: 1.1,
  restartLockout: 1.0,
  zoneHint: true, // a strike-zone frame marks where the pitch will cross, early in the round
  zoneHintPitches: 8, // ...for this many pitches, then the player is on their own
  maxLife: 4, // safety net for a ball that never resolves
  missZ: 0.25, // a ball past this z (behind the glove) is missed
  // Eyes on the ball: how close (degrees) the gaze must stay to the ball to count as watching it.
  focusConeEyes: 7, // with real eye tracking
  focusConeHead: 12, // with head direction only (no eye tracking): looser, the eyes can lead the head
};

// Glove hand: left by default (a right-handed catcher). `?glove=right` swaps it.
export const DEFAULT_GLOVE = params.get('glove') === 'right' ? 'right' : 'left';

// Home plate is just in front of the catcher; the rubber is 60 ft 6 in (18.44 m) beyond its point.
export const PLATE_Z = -0.8;
export const MOUND_Z = PLATE_Z - 18.44;
export const MOUND_HEIGHT = 0.254; // the rubber is 10 in above home plate
export const PITCHER_HEIGHT = 1.85; // a tall young right-hander

export const START_POS = { x: 0, y: 0.92, z: -0.5 }; // within reach seated or standing, below the card
export const START_RADIUS = 0.2;
export const SWAP_POS = { x: 0.4, y: 0.86, z: -0.45 }; // a small orb that swaps the glove hand
export const SWAP_RADIUS = 0.12;

// The pitches, unlocked as the round goes on. `break` is an extra steady acceleration (m/s^2):
// x is to the catcher's right (+), y is up. A right-hander's curveball dives down and away from a
// right-handed batter (to the catcher's left), the slider slides the same way flatter and later.
export const PITCHES = [
  { name: 'Fastball', from: 1, speed: 1.0, break: [0, 3.2] }, // backspin lift fights some of gravity
  { name: 'Changeup', from: 5, speed: 0.8, break: [0.9, -0.6] }, // slower, fading arm side
  { name: 'Curveball', from: 9, speed: 0.74, break: [-2.4, -7.5] }, // the 12-to-6 dive
  { name: 'Slider', from: 14, speed: 0.86, break: [-6.5, -2.2] }, // sharp sideways break
];
