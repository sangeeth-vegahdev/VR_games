// Gameplay tuning. Times are in seconds, distances in metres.
// `?hearts=N` in the URL overrides the starting hearts (handy for tests).

const q = new URLSearchParams(globalThis.location?.search ?? '');
const heartsOverride = Number(q.get('hearts'));
const skipTutorial = q.get('tutorial') === '0';

export const CFG = {
  heartOptions: [3, 5],
  startHearts: Number.isInteger(heartsOverride) && heartsOverride > 0 ? heartsOverride : null,
  maxHearts: 5,

  // Board: four rows (9, 11, 9, 9 bulbs) on a curve around the player, inside arm's reach. The sizes keep every
  // bulb inside the narrow view of Meta VR Glasses (37 degrees to each side, 25 up, 43 down) with no head turn.
  rows: [9, 11, 9, 9],
  rowPitch: 0.095, // vertical distance between rows
  bulbPitch: 0.08, // distance between bulbs along a row (arc length)
  boardRadius: 0.58, // distance from the head to the board: a comfortable seated reach
  boardDrop: 0.145, // the board's centre sits this far below the eyes (the view reaches further down than up)
  bulbRadius: 0.03,
  hitRadius: 0.04, // invisible touch sphere, bigger than the glass but smaller than half the bulb spacing, so neighbours never overlap

  // The board's edges, top and bottom: just outside the top row's sockets and the bottom row's glass.
  boardTop: 0.206,
  boardBase: -0.184,

  // The menu card: wide enough to hide the middle columns, leaving the outer bulbs clear at its sides.
  cardWidth: 0.532,
  cardTop: 0.215,
  cardBottom: -0.19,

  // Difficulty. "level" climbs every `hitsPerLevel` good hits.
  hitsPerLevel: 5,
  // Tuned for an average adult: simple visual reaction is about 200-300 ms and a choice is about 250-350 ms
  // (web research, 2026). Targets give the average player roughly 1.3 s at level 1 and never
  // less than 0.4 s, which is about a hand's reach beyond the reaction time, so it stays tense.
  lifeStart: 1.3, // how long a target stays lit at level 1
  lifeFloor: 0.4, // ...and the shortest it ever gets
  lifeDecay: 0.88, // per level: life = floor + (start - floor) * decay^(level - 1)
  gapStart: 0.6, // longest pause between targets at level 1
  gapFloor: 0.1,
  gapDecay: 0.88,
  decoyFromLevel: 3, // red "do not touch" bulbs start here
  decoyMax: 4, // most red bulbs on the board at once (it climbs with the level)
  decoyPointDwell: 0.2, // pointing at a red X this long counts as touching it (costs a heart)
  doubleFromLevel: 5, // two targets at once start here
  goldFromLevel: 2, // bonus golden bulbs start here

  // Scoring
  basePoints: 100,
  speedBonus: 100, // extra for an instant hit, fading to 0 at the end of the target's life
  goldMultiplier: 3,
  streakStep: 5, // multiplier goes up by 1 every this many hits in a row
  maxMultiplier: 5,
  heartEvery: 12, // a streak of this many wins a heart back

  arcWindow: 0.6, // touch both bulbs of a lightning pair this close together for double points
  arcBonus: 2,

  // SURGE: this many hits fill the meter, then a clap (or touching the SURGE button) sets it off.
  surgeHits: 15,
  surgeTime: 8,
  surgeLife: 1.3, // surge bulbs stay lit this long; missing one costs nothing
  surgePoints: 2,

  // First round ever: a few slow bulbs that cannot hurt, so the first minute teaches the game.
  skipTutorial,
  tutorialTargets: 3,
  tutorialLife: 12,

  // Point-to-hit (headset only): holding the hand ray (or gaze) on a lit bulb for this long hits it, no pinch needed.
  // Dark bulbs and red X bulbs never fire from pointing, so sweeping across the board is safe.
  pointDwell: 0.12,
  pointButtonDwell: 0.5, // PLAY AGAIN only: pointing at it for this long starts a new round (other buttons need a tap)
  pointStartDwell: 0.35, // White flank bulbs or START button: holding hand point starts the game
  handsLostPause: 2, // in a headset, no hands or controllers for this long pauses the round

  // The city: score lights its windows (1 - e^(-score/cityScale)), lifetime score keeps some on for good.
  cityScale: 16000,
  cityKeep: 0.25,
  cityKeepAt: 2000000,

  // Touch fairness. A lit bulb stays hittable this long after its ring has run out, so a touch that was made in
  // time but reached the game a frame or two late (frame hitch, input latency) still counts instead of "TOO SLOW".
  hitGrace: 0.12,
  // The same bulb ignores a second touch this soon after it was resolved: one gesture often arrives twice (a pinch
  // that also pokes, or a fingertip that skims through the same bulb on two frames).
  touchDebounce: 0.4,
  // A fingertip counts as touching a lit bulb when it is this close to the bulb's centre (the invisible hit sphere
  // plus the thickness of a fingertip).
  fingertipPad: 0.006,

  wrongLockout: 0.28, // after a wrong touch, further wrong touches are forgiven for this long
  countdown: 3,
  resumeCountdown: 2,
};

export const COLORS = {
  idle: 0xffb454, // warm tungsten
  target: 0x12e8ff, // electric cyan
  gold: 0xffd23c,
  decoy: 0xff3b5c,
  surge: 0xff4dff,
  surgeCss: '#ff7dff',
  good: '#5cf2a8',
  bad: '#ff5c7c',
  dim: '#8f9cc4',
  ink: '#f4f7ff',
  cyan: '#35f2ff',
  goldCss: '#ffd23c',
};

// Lifetime score earns a title that shows up on the results screen.
export const RANKS = [
  [0, 'Apprentice'],
  [25000, 'Electrician'],
  [100000, 'Line Chief'],
  [300000, 'Grid Master'],
  [1000000, 'City Hero'],
];
