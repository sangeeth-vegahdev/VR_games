import { createSystem, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { CFG, getGameUrl } from './config.js';
import { LobbyAudio } from './audio.js';
import { buildEnvironment } from './environment.js';
import { TileGrid } from './tiles.js';
import { useSkinHands } from './hands.js';
import { GazeRay } from './gaze.js';
import { HandPinch } from './gestures.js';
import { DesktopPointer } from './desktop-pointer.js';
import { LobbyGuide } from './guide.js';
import { VisorFrame } from './visor.js';

// The lobby: look at a sport, pinch to open it.
//
//   Look    the ring moves to the tile the eyes are on (the head, on a headset without eye tracking)
//   Pinch   either hand, wherever it is resting. A controller trigger counts as a pinch.
//
// Looking never opens anything, however long it lasts. On a PC the mouse is the eyes and a click is the pinch.
export class LobbySystem extends createSystem({}) {
  init() {
    this.audio = new LobbyAudio();
    this.audio.unlock();
    this.skinHands = useSkinHands(this.input && this.input.xr);
    this.env = buildEnvironment(this.world);

    this.grid = new TileGrid(this.world);
    this.guide = new LobbyGuide(this.grid.root);
    this.visor = new VisorFrame(this.world, this.grid);

    this.gaze = new GazeRay();
    this.pinch = new HandPinch();
    this.desktop = new DesktopPointer(this.world, () => {
      if (!this.world.session) this.press('pointer-click');
    });

    this.state = 'browse'; // 'browse' | 'launching'
    this.launchTimer = 0;
    this.selectedGame = null;
    this.selectedGesture = null;
    this.session = null;
    this.placed = false;
    this.headDir = new Vector3();
    this.headQuat = new Quaternion();
    this.headPos = new Vector3();

    // A controller trigger, or a hand on a runtime that reports its pinch as selectstart. The press happens as
    // the fingers close, not on release, so looking at a tile mid-pinch cannot open it.
    this.onSelectStart = () => this.press('select');

    window.addEventListener('lobby-select-game', (e) => {
      const game = CFG.games[e.detail && e.detail.index];
      if (game) this.launchGame(game, 'shortcut-key');
    });

    window.__lobby = this;
    window.__world = this.world;
  }

  // The system menu is open over the app: the player is pinching at that, not at us.
  get menuOpen() {
    return this.world.visibilityState.peek() === VisibilityState.VisibleBlurred;
  }

  // Press whatever the ring is on. With no tile in focus, a press does nothing.
  press(gesture) {
    if (this.state !== 'browse' || this.menuOpen) return;
    const tile = this.grid.tiles[this.grid.focused];
    if (tile) this.launchGame(tile.game, gesture);
  }

  launchGame(game, gestureType) {
    if (this.state === 'launching') return;
    this.state = 'launching';
    this.selectedGame = game;
    this.selectedGesture = gestureType;
    this.launchTimer = CFG.launchSeconds;
    this.grid.beginLaunch(CFG.games.indexOf(game));
    this.guide.complete();
    this.audio.playPinch();
    this.audio.playWarpLaunch();
    console.log(`[VR-LOBBY] Entering game: ${game.title} via ${gestureType}`);
    setTimeout(() => {
      window.location.href = getGameUrl(game);
    }, CFG.launchSeconds * 1000);
  }

  // Notice the headset going on or off: the PC frame, the select listener, and where the grid sits.
  syncSession() {
    const session = this.world.session || null;
    if (session === this.session) return;
    if (session) session.addEventListener('selectstart', this.onSelectStart);
    this.session = session;
    this.placed = false;
    this.visor.setInHeadset(!!session);
  }

  placeInHeadset() {
    const head = this.player.head;
    head.getWorldPosition(this.headPos);
    if (this.headPos.lengthSq() < 0.01) return; // no head pose yet
    this.headDir.set(0, 0, -1).applyQuaternion(head.getWorldQuaternion(this.headQuat));
    this.grid.placeFacing(this.headPos, this.headDir);
    this.placed = true;
  }

  updateFocus(inXR) {
    if (inXR) {
      this.gaze.sample(this.player);
      this.grid.setFocus(this.placed ? this.grid.pick(this.gaze.origin, this.gaze.dir) : -1);
    } else if (this.desktop.moved) {
      const ray = this.desktop.ray(this.world.camera);
      this.grid.setFocus(this.grid.pick(ray.origin, ray.direction));
      this.desktop.el.style.cursor = this.grid.focused >= 0 ? 'pointer' : '';
    } else {
      this.grid.setFocus(0);
    }
  }

  // IWSDK calls update(delta, time) on every system every frame.
  update(dt) {
    // Guard against a huge first or resumed frame (tab switch, headset off).
    this.tick(Math.min(dt, 0.1));
  }

  tick(dt) {
    this.syncSession();
    const inXR = !!this.session;
    if (inXR && !this.placed) this.placeInHeadset();

    if (this.state === 'browse') {
      const before = this.grid.focused;
      this.updateFocus(inXR);
      if (this.grid.focused !== before && this.grid.focused >= 0 && inXR) this.audio.playHover();
      if (inXR && this.pinch.update()) this.press('pinch');
    } else {
      this.launchTimer = Math.max(0, this.launchTimer - dt);
    }

    const progress = this.state === 'launching' ? 1 - this.launchTimer / CFG.launchSeconds : 0;
    this.grid.update(dt, progress);
    this.guide.update(inXR, this.grid.focused >= 0);
  }
}
