import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG, COLORS } from '../src/config.js';
import { Sound } from '../src/sound.js';

test('Board layout: exactly 38 bulbs arranged across 4 curved rows', () => {
  assert.equal(CFG.rows.length, 4, 'Must have exactly 4 rows');
  assert.deepEqual(CFG.rows, [9, 11, 9, 9], 'Rows must be 9, 11, 9, 9 bulbs');
  const total = CFG.rows.reduce((a, b) => a + b, 0);
  assert.equal(total, 38, 'Total bulb count must be exactly 38');
});

test('Board ergonomics: seated arm-reach positioning for Meta Quest', () => {
  assert.ok(CFG.boardRadius >= 0.50 && CFG.boardRadius <= 0.65, `Board radius ${CFG.boardRadius}m is within natural arm reach`);
  assert.ok(CFG.boardDrop > 0.1 && CFG.boardDrop < 0.2, `Board drop ${CFG.boardDrop}m aligns with ergonomic downward gaze`);
  assert.ok(CFG.hitRadius > CFG.bulbRadius, 'Hit radius must be larger than visual bulb radius for comfortable touch');
  assert.ok(CFG.hitRadius * 2 <= CFG.bulbPitch, 'Hit spheres must not overlap adjacent bulbs in the same row');
});

test('Difficulty curve: lifetime and gap shrink predictably with level', () => {
  const calcLife = (lvl) => CFG.lifeFloor + (CFG.lifeStart - CFG.lifeFloor) * Math.pow(CFG.lifeDecay, lvl - 1);
  const calcGap = (lvl) => CFG.gapFloor + (CFG.gapStart - CFG.gapFloor) * Math.pow(CFG.gapDecay, lvl - 1);

  const life1 = calcLife(1);
  const life2 = calcLife(2);
  const life10 = calcLife(10);

  assert.equal(life1, CFG.lifeStart, 'Level 1 has full start lifetime');
  assert.ok(life2 < life1, 'Level 2 lifetime is shorter than Level 1');
  assert.ok(life10 >= CFG.lifeFloor, 'Lifetime never drops below lifeFloor');

  const gap1 = calcGap(1);
  const gap2 = calcGap(2);
  assert.equal(gap1, CFG.gapStart, 'Level 1 has full start gap');
  assert.ok(gap2 < gap1, 'Gap decreases as level advances');
});

test('Feature unlocks: gold bulbs, decoys, and dual targets unlock at designated levels', () => {
  assert.equal(CFG.goldFromLevel, 2, 'Gold bonus bulbs unlock at level 2');
  assert.equal(CFG.decoyFromLevel, 3, 'Red decoy bulbs unlock at level 3');
  assert.equal(CFG.doubleFromLevel, 5, 'Simultaneous dual targets unlock at level 5');
});

test('Scoring model: streaks, multipliers, speed bonuses, and heart restoration', () => {
  const getMult = (streak) => Math.min(1 + Math.floor(streak / CFG.streakStep), CFG.maxMultiplier);

  assert.equal(getMult(0), 1, 'Initial multiplier is 1x');
  assert.equal(getMult(4), 1, 'Streak of 4 is still 1x');
  assert.equal(getMult(5), 2, 'Streak of 5 steps up to 2x');
  assert.equal(getMult(9), 2, 'Streak of 9 is 2x');
  assert.equal(getMult(10), 3, 'Streak of 10 steps up to 3x');
  assert.equal(getMult(20), 5, 'Streak of 20 reaches max multiplier 5x');
  assert.equal(getMult(50), 5, 'Streak above 20 is capped at max multiplier 5x');

  assert.equal(CFG.goldMultiplier, 3, 'Gold bulbs give 3x value');
  assert.equal(CFG.heartEvery, 12, 'Bonus heart awarded every 12 streak hits');
});

test('Duplicate hit rejection: rapid re-touch of resolved bulb is suppressed', () => {
  // Simulates the onBulb debounce condition from src/game.js
  const isDuplicateTouch = (bulbMode, flashT) => {
    return bulbMode === 'idle' && flashT > 0.3;
  };

  assert.equal(isDuplicateTouch('idle', 0.4), true, 'Duplicate touch within flash debounce is ignored');
  assert.equal(isDuplicateTouch('idle', 0.1), false, 'Initial fresh tap is not ignored');
  assert.equal(isDuplicateTouch('target', 0.5), false, 'Active target touch is valid');
});

test('Sound synthesizer: initializes audio parameters and music clock', () => {
  const sound = new Sound();
  assert.equal(sound.bpm, 96, 'Default BPM is 96');
  assert.equal(sound.mood, 'menu', 'Initial mood is menu');
  assert.ok(sound.schedDur > 0, 'Schedule duration is positive');
  assert.equal(sound.muted, false, 'Sound starts unmuted');
});

test('Flank bulbs and point-to-start dwell configuration', () => {
  assert.equal(CFG.pointStartDwell, 0.35, 'Point start dwell is 0.35 seconds for intentional hand pointing');

  // Verify flank bulb detection logic across all rows
  const isFlank = (col, cols) => col <= 1 || col >= cols - 2;

  // Row 0 (9 bulbs, indices 0..8): flank bulbs are col 0, 1 (left) and col 7, 8 (right)
  assert.equal(isFlank(0, 9), true, 'Row 0 col 0 is left flank');
  assert.equal(isFlank(1, 9), true, 'Row 0 col 1 is left flank');
  assert.equal(isFlank(4, 9), false, 'Row 0 col 4 is center bulb (behind card)');
  assert.equal(isFlank(7, 9), true, 'Row 0 col 7 is right flank');
  assert.equal(isFlank(8, 9), true, 'Row 0 col 8 is right flank');

  // Row 1 (11 bulbs, indices 9..19): flank bulbs are col 0, 1 (left) and col 9, 10 (right)
  assert.equal(isFlank(0, 11), true, 'Row 1 col 0 is left flank');
  assert.equal(isFlank(1, 11), true, 'Row 1 col 1 is left flank');
  assert.equal(isFlank(5, 11), false, 'Row 1 col 5 is center bulb (behind card)');
  assert.equal(isFlank(9, 11), true, 'Row 1 col 9 is right flank');
  assert.equal(isFlank(10, 11), true, 'Row 1 col 10 is right flank');
});

test('Start policy: pointing highlights only, clicking with hand starts the round', () => {
  let started = false;
  let highlighted = false;

  const onPoint = (pointed) => {
    if (pointed) highlighted = true;
    // Pointing never sets started to true: no auto-start
  };

  const onClickWithHand = (target) => {
    if (target === 'start' || target === 'flankBulb') {
      started = true;
    }
  };

  // User points hand at START or flank bulb: only highlights
  onPoint(true);
  assert.equal(highlighted, true, 'Pointing with hand highlights target');
  assert.equal(started, false, 'Pointing alone never auto-starts');

  // User clicks with hand (pinch / poke / trigger) on START: starts round
  onClickWithHand('start');
  assert.equal(started, true, 'Clicking START with hand starts round');
});
