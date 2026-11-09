// Gameplay tuning. Units: metres, seconds, m/s. The player is the catcher, at the origin facing -Z
// down the line to the pitcher's mound.
const params = new URLSearchParams(globalThis.location?.search ?? '');
const pitchesOverride = Number(params.get('pitches'));

// First-time practice: three slow, easy pitches before the real round. `?tutorial=0` skips it (tests).
const skipTutorial = params.get('tutorial') === '0';

export const CFG = {
  skipTutorial,
  tutorialPitches: 3, // catches needed to finish the practice
  tutorialSpeed: 11, // m/s for the first practice pitch (25 mph); each next one is a little quicker
  // A round is 25 pitches. `?pitches=N` in the URL overrides it (handy for quick tests).
  pitches: Number.isInteger(pitchesOverride) && pitchesOverride > 0 ? pitchesOverride : 25,
  rampPitches: 18, // speed and movement climb over this many pitches, then hold (see src/pitches.js)
  // How hard he throws: rookie, pro or majors (real big-league speed). `?level=` overrides it.
  level: ['rookie', 'pro', 'majors'].includes(params.get('level')) ? params.get('level') : 'pro',
  gravity: 9.81, // real gravity: a baseball drops visibly over 18 m
  // A catch is the ball's centre arriving within catchRadius of the pocket's centre: inside the mitt's
  // face (about 28 cm across its binding), coming in from the front. Swept between frames, with the mitt.
  catchRadius: 0.14,
  backOfMitt: -0.3, // arriving this far behind the pocket (cosine) it glances off the back of the mitt
  settleTime: 0.06, // seconds for a caught ball to settle into the pocket (no snapping)
  nearMiss: 0.4, // a miss closer than this tells you by how much
  bareHandRadius: 0.1, // ball centre to the bare palm (ball radius plus the hand): "use the mitt"
  arriveZ: -0.55, // where pitches cross the catcher's reach, in front of the body
  targetBelowHead: 0.35, // the zone's centre is measured from the headset, so it suits seated players
  readyDelay: 0.6,
  signTime: 1.1, // the sign goes in, he nods, comes set
  shakeTime: 0.9, // ...or shakes one off first
  shakeChance: 0.15,
  goodTarget: 0.12, // the mitt within this of the called spot as he comes set: a good target
  feedbackDelay: 1.1,
  restartLockout: 1.0,
  zoneHint: true, // a faint strike-zone frame, and a ring on the called spot
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

// The pitches (speeds, movement, spin, the calls) live in src/pitches.js.
export { PITCHES } from './pitches.js';
export const LEVEL_POS = { x: -0.4, y: 0.86, z: -0.45 }; // and one that changes how hard he throws
