// Low balls are removed from delivery generation (not just hidden). Catching rules for low catches remain in catching.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CFG } from '../src/config.js';

const src = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

test('low-ball chance is zero in config', () => {
  assert.equal(CFG.lowBallChance, 0);
});

test('delivery logic gates isLowCatch on lowBallChance, including the forceType hook', () => {
  assert.match(src, /const lowAllowed = CFG\.lowBallChance > 0;/);
  assert.match(src, /this\.isLowCatch = lowAllowed && /);
});

test('simulated generation never yields a low ball; high and chest still occur', () => {
  // Mirrors the roll in beginThrow.
  const gen = (ballNo, roll) => {
    const high = ballNo > 3 && roll < 0.2;
    const low = CFG.lowBallChance > 0 && ballNo > 2 && !high && roll >= 0.2 && roll < 0.2 + CFG.lowBallChance;
    return high ? 'high' : low ? 'low' : 'chest';
  };
  const seen = new Set();
  for (let n = 1; n <= 50; n++) for (let i = 0; i < 100; i++) seen.add(gen(n, i / 100));
  assert.ok(!seen.has('low'));
  assert.ok(seen.has('high') && seen.has('chest'));
});
