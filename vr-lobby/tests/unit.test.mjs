import test from 'node:test';
import assert from 'node:assert/strict';
import { bestText, CFG, gridSize, tileRects } from '../src/config.js';
import { PinchDetector } from '../src/gestures.js';
import { pickTile } from '../src/gaze.js';
import { guideStep } from '../src/guide.js';

const { gap, stickiness, distance } = CFG.grid;
const rects = tileRects();
const at = (id) => rects[CFG.games.findIndex((g) => g.id === id)];
const pick = (x, y, current = -1) => pickTile(x, y, rects, current, gap, stickiness);

test('Config: the three real games, on distinct ports that are not the lobby', () => {
  assert.deepEqual(CFG.games.map((g) => g.id), ['baseball', 'cricket', 'bulbrush']);
  const ports = CFG.games.map((g) => g.port);
  assert.equal(new Set(ports).size, 3);
  assert.ok(!ports.includes(8080));
});

test('Layout: baseball top-left, cricket top-right, Bulb Rush fills the row below', () => {
  assert.ok(at('baseball').x < 0 && at('baseball').y > 0);
  assert.ok(at('cricket').x > 0 && at('cricket').y > 0);
  assert.equal(at('bulbrush').x, 0);
  assert.ok(at('bulbrush').y < 0);
  assert.equal(at('bulbrush').w, gridSize().w);
});

test('Layout: the whole grid fits the view of Meta VR Glasses without a head turn', () => {
  const { w, h } = gridSize();
  const deg = (metres) => (Math.atan(metres / distance) * 180) / Math.PI;
  assert.ok(deg(w / 2) < 37, `${deg(w / 2).toFixed(1)} degrees to each side`);
  assert.ok(deg(h / 2) < 25, `${deg(h / 2).toFixed(1)} degrees up and down`);
});

test('Gaze: each tile is picked from its own centre, and off the grid is nothing', () => {
  CFG.games.forEach((g, i) => assert.equal(pick(rects[i].x, rects[i].y), i, g.id));
  assert.equal(pick(5, 0), -1);
  assert.equal(pick(0, 5), -1);
});

test('Gaze: there is no dead strip in the gap between two tiles', () => {
  assert.notEqual(pick(0, at('cricket').y), -1, 'between baseball and cricket');
  assert.notEqual(pick(at('baseball').x, 0), -1, 'between baseball and Bulb Rush');
});

test('Gaze: the ring stays put until the eyes have clearly left the tile', () => {
  const baseball = CFG.games.findIndex((g) => g.id === 'baseball');
  const cricket = CFG.games.findIndex((g) => g.id === 'cricket');
  const justOverTheLine = at('cricket').x - at('cricket').w / 2 + 0.005;
  assert.equal(pick(justOverTheLine, at('cricket').y, baseball), baseball, 'a small wobble does not move it');
  assert.equal(pick(at('cricket').x, at('cricket').y, baseball), cricket, 'a real look does');
});

test('Pinch: one close is one press, however long it is held', () => {
  const p = new PinchDetector();
  assert.equal(p.update(0.1), false, 'open');
  assert.equal(p.update(0.01), true, 'closes');
  for (let i = 0; i < 30; i++) assert.equal(p.update(0.01), false, 'held');
  assert.equal(p.update(0.1), false, 'opens');
  assert.equal(p.update(0.01), true, 'closes again');
});

test('Pinch: fingers trembling around the threshold do not press twice', () => {
  const p = new PinchDetector();
  p.update(0.1);
  assert.equal(p.update(0.02), true);
  for (const d of [0.035, 0.02, 0.05, 0.02, 0.04]) assert.equal(p.update(d), false, `at ${d}`);
});

test('Pinch: a hand that is first seen already pinched must open before it can press', () => {
  const p = new PinchDetector();
  assert.equal(p.update(0.01), false);
  assert.equal(p.update(0.01), false);
  p.update(0.1);
  assert.equal(p.update(0.01), true);
});

test('Pinch: losing tracking forgets the hand, so its return cannot press', () => {
  const p = new PinchDetector();
  p.update(0.1);
  assert.equal(p.update(null), false);
  assert.equal(p.update(0.01), false, 'reappears closed');
});

test('Guide: asks for a look, then a pinch; on a PC, a click', () => {
  assert.equal(guideStep(false, false), 'desktop');
  assert.equal(guideStep(false, true), 'desktop');
  assert.equal(guideStep(true, false), 'look');
  assert.equal(guideStep(true, true), 'pinch');
});

test('Best score: shown when saved, absent when not, and safe when storage is blocked', () => {
  const game = CFG.games.find((g) => g.id === 'cricket');
  assert.equal(bestText(game, { getItem: () => '31' }), 'Best 31 / 50');
  assert.equal(bestText(game, { getItem: () => null }), null);
  const blocked = { getItem: () => { throw new Error('blocked'); } };
  assert.equal(bestText(game, blocked), null);
});
