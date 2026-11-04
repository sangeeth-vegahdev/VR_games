// The pitcher's arsenal and the battery: what the catcher calls, where, how hard it comes, how it
// moves and spins, and what the umpire calls. Pure functions and data, no scene, so it is unit tested.
//
// Frame: the catcher is at the origin facing -Z; +X is the catcher's right, +Y up; a pitch travels
// towards +Z. The pitcher is a right-hander, so his ARM side is the catcher's LEFT (-X) and his
// GLOVE side the catcher's right (+X). With a right-handed hitter in mind (he stands on the
// catcher's left), "in" is -X and "away" is +X.
//
// Speeds, movement and spin follow MLB Statcast averages for a right-hander (rounded; see
// README "Pitches"). `ivb` is induced vertical break and `hb` horizontal break, in inches: the
// movement the spin adds on top of gravity over the flight. ivb + is rise (less drop), hb + is arm
// side. `gyro` is the share of the spin that is bullet spin (spin about the line of flight, which
// moves the ball not at all), so a cutter or slider spins hard but breaks little.

export const INCH = 0.0254;
export const MPH = 2.23694; // mph per m/s

export const PITCHES = [
  { name: 'Four-seam fastball', short: 'Four-seamer', sign: '1', mph: 95, ivb: 16, hb: 8, rpm: 2350, gyro: 0.1, from: 1, use: 30, command: 0.09, calls: ['up', 'up-in', 'up-away', 'away', 'in', 'middle'] },
  { name: 'Sinker', short: 'Sinker', sign: '1 wiggle', mph: 94, ivb: 8, hb: 15, rpm: 2150, gyro: 0.15, from: 3, use: 13, command: 0.1, calls: ['down-in', 'down', 'in'] },
  { name: 'Changeup', short: 'Changeup', sign: '4', mph: 86, ivb: 6, hb: 14, rpm: 1750, gyro: 0.2, from: 5, use: 10, command: 0.11, calls: ['down-away', 'down', 'down-in'] },
  { name: 'Cutter', short: 'Cutter', sign: '5', mph: 89.5, ivb: 8, hb: -3, rpm: 2400, gyro: 0.55, from: 7, use: 8, command: 0.1, calls: ['in', 'up-in', 'away', 'down-away'] },
  { name: 'Curveball', short: 'Curveball', sign: '2', mph: 80, ivb: -10, hb: -9, rpm: 2550, gyro: 0.15, from: 9, use: 9, command: 0.12, calls: ['down', 'down-away', 'middle'] },
  { name: 'Slider', short: 'Slider', sign: '3', mph: 86, ivb: 1, hb: -5, rpm: 2450, gyro: 0.65, from: 11, use: 11, command: 0.11, calls: ['down-away', 'away', 'down'] },
  { name: 'Splitter', short: 'Splitter', sign: '6', mph: 87, ivb: 3, hb: 9, rpm: 1350, gyro: 0.3, from: 13, use: 5, command: 0.12, calls: ['down', 'down-away', 'down-in'] },
  { name: 'Sweeper', short: 'Sweeper', sign: '3 wiggle', mph: 82, ivb: 1, hb: -15, rpm: 2600, gyro: 0.25, from: 15, use: 7, command: 0.12, calls: ['away', 'down-away', 'middle'] },
  { name: 'Knuckle curve', short: 'Knuckle curve', sign: '2 wiggle', mph: 82, ivb: -11, hb: -6, rpm: 2400, gyro: 0.2, from: 17, use: 4, command: 0.12, calls: ['down', 'down-away'] },
  { name: 'Screwball', short: 'Screwball', sign: 'fist', mph: 77, ivb: -4, hb: 16, rpm: 2250, gyro: 0.2, from: 19, use: 1.5, command: 0.13, calls: ['down-in', 'in', 'down'] },
  // Almost no spin: the seams catch the air unevenly and it flutters, late, unpredictably.
  { name: 'Knuckleball', short: 'Knuckler', sign: 'wiggle', mph: 76, ivb: 2, hb: 0, rpm: 120, gyro: 0, from: 21, use: 1.5, command: 0.12, calls: ['middle', 'down'], flutter: 0.13 },
  // The slow, high-arcing surprise.
  { name: 'Eephus', short: 'Eephus', sign: 'thumb', mph: 52, ivb: 6, hb: 4, rpm: 1300, gyro: 0.1, from: 23, use: 1, command: 0.1, calls: ['middle', 'down'] },
];

// How hard he throws: a share of the Statcast speeds. `?level=rookie|pro|majors` (and the blue
// orb on the menu) picks it.
export const LEVELS = [
  { id: 'rookie', name: 'Rookie', velo: 0.62 }, // four-seamer about 59 mph
  { id: 'pro', name: 'Pro', velo: 0.82 }, // about 78 mph
  { id: 'majors', name: 'Majors', velo: 1.0 }, // the real thing: 95, up to 98 when he reaches back
];
export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[1];

export const SPEED = {
  startFrac: 0.6, // pitch 1 comes in at this share of full speed, to learn the mitt
  jitterMph: 1.2, // pitch-to-pitch variation once fully ramped
  reachBackMph: 2.5, // now and then the fastball gets a little extra
  reachBackChance: 0.15,
  capMph: 100,
};

// The called location: the catcher sets up in one of nine spots, the pitcher aims for it and
// misses by his command (a normal spread, in metres).
export const CELL = { x: 0.16, y: 0.13 };
export const STRIKE_ZONE = {
  halfWidth: 0.216 + 0.037, // half the plate (17 in) plus a ball's radius: any part of the ball
  halfHeight: 0.21 + 0.037,
};
export const REACH = { halfWidth: 0.34, halfHeight: 0.29 }; // never further than this from the zone's centre

const CALLS = {
  up: [0, 1], 'up-in': [-1, 1], 'up-away': [1, 1], in: [-1, 0], away: [1, 0], middle: [0, 0],
  down: [0, -1], 'down-in': [-1, -1], 'down-away': [1, -1],
};
const CALL_WORDS = {
  up: 'up', 'up-in': 'up and in', 'up-away': 'up and away', in: 'in', away: 'away', middle: 'down the middle',
  down: 'down', 'down-in': 'down and in', 'down-away': 'down and away',
};
export const callWords = (call) => CALL_WORDS[call] || call;

// Which pitch to call. A new pitch is shown the first time it unlocks, so a full round sees the
// whole arsenal; otherwise it is weighted by how often a big-league pitcher throws it.
export function choosePitch(pitchNo, rand, avoid = null) {
  const fresh = PITCHES.find((p) => p.from === pitchNo);
  if (fresh && fresh !== avoid) return fresh;
  const open = PITCHES.filter((p) => p.from <= pitchNo && p !== avoid);
  if (!open.length) return PITCHES[0];
  let total = 0;
  for (const p of open) total += p.use;
  let r = rand() * total;
  for (const p of open) {
    r -= p.use;
    if (r <= 0) return p;
  }
  return open[open.length - 1];
}

export function chooseCall(pitch, rand) {
  return pitch.calls[Math.floor(rand() * pitch.calls.length) % pitch.calls.length];
}

// The called spot, relative to the zone's centre.
export function callOffset(call, out) {
  const c = CALLS[call] || CALLS.middle;
  out.x = c[0] * CELL.x;
  out.y = c[1] * CELL.y;
  return out;
}

// A normally distributed number (Box-Muller) from a uniform source.
export function gauss(rand) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Where it really crosses: the called spot plus his miss. A good target (the mitt set on the spot
// as he comes set) tightens his command, as it does for a real pitcher.
export function commandMiss(pitch, rand, goodTarget, out) {
  const sd = pitch.command * (goodTarget ? 0.7 : 1);
  out.x = gauss(rand) * sd;
  out.y = gauss(rand) * sd * 0.85;
  return out;
}

export function clampToReach(off) {
  off.x = Math.max(-REACH.halfWidth, Math.min(REACH.halfWidth, off.x));
  off.y = Math.max(-REACH.halfHeight, Math.min(REACH.halfHeight, off.y));
  return off;
}

// Speed, m/s. `ramp` 0..1 climbs over the early pitches of a round.
export function pitchSpeed(pitch, level, ramp, rand) {
  let mph = pitch.mph * level.velo * (SPEED.startFrac + (1 - SPEED.startFrac) * ramp);
  if (ramp >= 1) {
    mph += (rand() * 2 - 1) * SPEED.jitterMph * level.velo;
    if (pitch === PITCHES[0] && rand() < SPEED.reachBackChance) mph += SPEED.reachBackMph * level.velo;
  }
  return Math.min(SPEED.capMph, mph) / MPH;
}

// The steady acceleration the spin adds (on top of gravity) for a flight of T seconds, so the
// pitch moves its real number of inches whatever the speed. `k` scales the movement (gentler on
// the first pitches of a round). x to the catcher's right, y up.
export function breakAccel(pitch, T, k, out) {
  const a = (2 * k) / (T * T);
  out.x = -pitch.hb * INCH * a; // arm side is the catcher's left
  out.y = pitch.ivb * INCH * a;
  return out;
}

// The spin axis that gives that movement (Magnus: the force is along spin x velocity, with the
// ball flying along +Z), with the pitch's share of bullet spin along the line of flight.
export function spinAxis(pitch, out) {
  const bx = -pitch.hb;
  const by = pitch.ivb;
  const len = Math.hypot(bx, by);
  const g = Math.min(0.95, pitch.gyro);
  if (len < 1e-6) {
    out.x = 0.3; out.y = 0.2; out.z = 0.93; // a knuckleball: a lazy tumble, hardly any spin at all
  } else {
    const t = Math.sqrt(1 - g * g) / len;
    out.x = -by * t;
    out.y = bx * t;
    out.z = g;
  }
  const n = Math.hypot(out.x, out.y, out.z);
  out.x /= n; out.y /= n; out.z /= n;
  return out;
}

// Turns a second to draw. Real spin (20 to 45 turns a second) would only strobe in a headset, so a
// spinning pitch is drawn slower but in proportion; a knuckleball's one or two turns are real.
export const drawnRps = (pitch) => (pitch.rpm < 600 ? pitch.rpm / 60 : pitch.rpm / 165);

// A knuckleball's flutter: a sideways and up-down wobble that grows late and is back to zero at
// T (so the pitch still crosses where it was aimed). `f` holds random amplitudes, rates, phases.
export function flutterParams(pitch, rand, f) {
  const A = pitch.flutter || 0;
  f.ax = A * (0.6 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1);
  f.ay = A * 0.7 * (0.6 + 0.4 * rand()) * (rand() < 0.5 ? -1 : 1);
  f.wx = 2 * Math.PI * (1.1 + rand());
  f.wy = 2 * Math.PI * (1.3 + rand());
  f.px = rand() * 6.283;
  f.py = rand() * 6.283;
  return f;
}
export function flutterAt(f, t, T, out) {
  const g = (t / T) * (t / T);
  out.x = f.ax * g * (Math.sin(f.wx * t + f.px) - Math.sin(f.wx * T + f.px));
  out.y = f.ay * g * (Math.sin(f.wy * t + f.py) - Math.sin(f.wy * T + f.py));
  return out;
}

// The umpire. `off` is where the pitch crossed relative to the zone's centre. A borderline ball
// caught quietly is framed into a strike; a borderline strike stabbed at is called a ball.
export const FRAME = { margin: 0.07, quiet: 1.2, stab: 2.6 };
export function umpire(off, caught, mittSpeed) {
  const ox = Math.abs(off.x) - STRIKE_ZONE.halfWidth;
  const oy = Math.abs(off.y) - STRIKE_ZONE.halfHeight;
  const outside = Math.max(ox, oy); // > 0: outside the zone by that much
  if (!caught) return { strike: outside <= 0, framed: false, stabbed: false };
  if (outside > 0 && outside < FRAME.margin && mittSpeed < FRAME.quiet) return { strike: true, framed: true, stabbed: false };
  if (outside <= 0 && outside > -0.05 && mittSpeed > FRAME.stab) return { strike: false, framed: false, stabbed: true };
  return { strike: outside <= 0, framed: false, stabbed: false };
}
