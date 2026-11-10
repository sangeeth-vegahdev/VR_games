import {
  CanvasTexture,
  createSystem,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { BALL_RADIUS, makeBall, setFocusGlow, setGlowForDistance } from './ball.js';
import { catchSpot } from './glove.js';
import { buildBallpark } from './ballpark.js';
import { CATCHER_EYE_Y, CFG, DEFAULT_GLOVE, LEVEL_POS, START_POS, START_RADIUS, SWAP_POS, SWAP_RADIUS, ZONE_FLOOR } from './config.js';
import {
  breakAccel, callOffset, callWords, chooseCall, choosePitch, clampToReach, commandMiss, drawnRps, flutterAt,
  flutterParams, LEVELS, levelById, MPH, PITCHES, pitchSpeed, spinAxis, STRIKE_ZONE, umpire,
} from './pitches.js';
import { DesktopPointer } from './desktop-pointer.js';
import { Effects, Sound } from './fx.js';
import { FocusTracker } from './gaze.js';
import { EyeRingTracker } from './eye-tracker.js';
import { useSkinHands } from './hands.js';
import { COLORS, Hud } from './hud.js';
import { Pitcher } from './pitcher.js';
import { bareHand, PlayerGlove } from './player-glove.js';
import { DiagnosticsPanel } from './diagnostics.js';

// Best score is remembered per round length and level. Storage can be blocked, so it is optional.
const bestKey = (level) => `glove-up-best-${CFG.pitches}-${level}`;
function loadBest(level) {
  try {
    return Number(localStorage.getItem(bestKey(level))) || 0;
  } catch (e) {
    return 0;
  }
}
function saveBest(level, value) {
  try {
    localStorage.setItem(bestKey(level), String(value));
  } catch (e) {
    /* not saved: fine */
  }
}

function label(text, width, height) {
  const c = document.createElement('canvas');
  c.width = Math.round(width * 400);
  c.height = Math.round(height * 400);
  const ctx = c.getContext('2d');
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: DoubleSide }));
  mesh.userData.draw = (value) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(14,22,38,0.75)';
    ctx.beginPath();
    ctx.roundRect(2, 2, c.width - 4, c.height - 4, 20);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(c.height * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, c.width / 2, c.height / 2, c.width * 0.92);
    t.needsUpdate = true;
  };
  mesh.userData.draw(text);
  return mesh;
}

const lerp = (a, b, t) => a + (b - a) * t;

export function inTargetSquare(pocket, targetPos, zoneHalfW = STRIKE_ZONE.halfWidth, zoneHalfH = STRIKE_ZONE.halfHeight) {
  if (!pocket || !targetPos) return false;
  const dx = Math.abs(pocket.x - targetPos.x);
  const dy = Math.abs(pocket.y - targetPos.y);
  const dz = Math.abs(pocket.z - targetPos.z);
  // Generous planar square bounds (+-10cm margin) with deep forward/back reach (+-50cm)
  const inPlanarSquare = dx <= zoneHalfW + 0.10 && dy <= zoneHalfH + 0.10 && dz <= 0.50;
  // Or 3D reach sphere up to 40cm
  const inSphere = pocket.distanceTo(targetPos) <= 0.40;
  return inPlanarSquare || inSphere;
}

// First-time practice is remembered once finished. Storage can be blocked, so it is optional.
const TUT_KEY = 'glove-up-tutorial-done';
function loadTutorialDone() {
  try {
    return localStorage.getItem(TUT_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function saveTutorialDone() {
  try {
    localStorage.setItem(TUT_KEY, '1');
  } catch (e) {
    /* not saved: the practice just shows again next time */
  }
}
// One short line at a time, each said when it is useful (never a list of rules).
const TUT_CALLS = ['middle', 'away', 'up'];
const TUT_SIGN = ['Catch it in the gold target ring', 'The pitch target moves. Follow it', 'Watch the ball from the mound'];
const TUT_CAUGHT = ['That is it! Again', 'Nice. One more', 'Gold glove!'];

// Round flow: idle -> ready -> windup -> flying -> feedback -> (ready ... | over) -> ready ...
export class GameSystem extends createSystem({}) {
  init() {
    this.sound = new Sound();
    this.fx = new Effects(this.world);
    this.park = buildBallpark(this.world);
    this.pitcher = new Pitcher(this.world);
    this.hud = new Hud(this.world, CFG.pitches);
    this.focus = new FocusTracker();
    this.eyeTracker = new EyeRingTracker(this.world);
    this.diagnostics = new DiagnosticsPanel('Glove Up (Baseball)');
    this.diagnostics.attachWorld(this.world);

    this.ball = makeBall();
    this.ball.visible = false;
    this.world.createTransformEntity(this.ball);
    // While the ball is in the mitt, a faint outline of it shows through the leather: the catcher
    // sees the back of the mitt, and should still see the ball is in it.
    this.heldOutline = new Mesh(
      new SphereGeometry(BALL_RADIUS * 1.03, 24, 16),
      new MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.3, depthTest: false, depthWrite: false }),
    );
    this.heldOutline.renderOrder = 20;
    this.heldOutline.visible = false;
    this.ball.add(this.heldOutline);

    // Start ball, and a small orb that swaps the mitt to the other hand.
    this.marker = new Mesh(
      new SphereGeometry(START_RADIUS * 0.6, 24, 16),
      new MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1d8f4e, emissiveIntensity: 1.2 }),
    );
    this.marker.position.set(START_POS.x, START_POS.y, START_POS.z);
    this.world.createTransformEntity(this.marker);

    this.lobbyOrb = new Group();
    const lorbMesh = new Mesh(
      new SphereGeometry(SWAP_RADIUS * 0.45, 20, 14),
      new MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x0088cc, emissiveIntensity: 1.2 }),
    );
    const lorbLabel = label('LOBBY', 0.28, 0.07);
    lorbLabel.position.set(0, -0.11, 0);
    this.lobbyOrb.add(lorbMesh, lorbLabel);
    this.lobbyOrb.position.set(-0.65, 0.65, -0.45);
    this.world.createTransformEntity(this.lobbyOrb);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        window.location.href = `${window.location.protocol}//${window.location.hostname}:8080`;
      }
    });
    this.swapOrb = new Group();
    const orb = new Mesh(new SphereGeometry(SWAP_RADIUS * 0.5, 20, 14), new MeshStandardMaterial({ color: 0xf2c230, emissive: 0x7a5a00, emissiveIntensity: 1 }));
    this.swapLabel = label('', 0.36, 0.07);
    this.swapLabel.position.set(0, -0.11, 0);
    this.swapOrb.add(orb, this.swapLabel);
    this.swapOrb.position.set(SWAP_POS.x, SWAP_POS.y, SWAP_POS.z);
    this.world.createTransformEntity(this.swapOrb);

    // An orb that changes how hard he throws (rookie, pro, majors).
    this.levelOrb = new Group();
    const lorb = new Mesh(new SphereGeometry(SWAP_RADIUS * 0.5, 20, 14), new MeshStandardMaterial({ color: 0x3a8dde, emissive: 0x0d3a6b, emissiveIntensity: 1 }));
    this.levelLabel = label('', 0.36, 0.07);
    this.levelLabel.position.set(0, -0.11, 0);
    this.levelOrb.add(lorb, this.levelLabel);
    this.levelOrb.position.set(LEVEL_POS.x, LEVEL_POS.y, LEVEL_POS.z);
    this.world.createTransformEntity(this.levelOrb);

    // The catcher's target: a notched ring on the called spot, from the sign until the ball arrives.
    const targetMat = new MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.75, depthWrite: false });
    this.target = new Mesh(new TorusGeometry(0.075, 0.006, 8, 40), targetMat);
    const tickGeo = new PlaneGeometry(0.016, 0.005);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const tick = new Mesh(tickGeo, targetMat);
      tick.position.set(0.086 * Math.cos(angle), 0.086 * Math.sin(angle), 0);
      tick.rotation.z = angle;
      this.target.add(tick);
    }
    this.target.visible = false;
    this.target.renderOrder = 6;
    this.world.createTransformEntity(this.target);

    // A ring on the ground under the mitt. A catcher looks down at the plate, and at a level gaze the
    // ground under the mitt is out of view: the ring shows where the mitt is, so it can be found.
    this.groundRing = new Mesh(
      new RingGeometry(0.07, 0.085, 40),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.groundRing.rotation.x = -Math.PI / 2;
    this.groundRing.renderOrder = 4;
    this.groundRing.visible = false;
    this.world.createTransformEntity(this.groundRing);

    // A faint frame of the strike zone (the plate's width, the ball's radius either side).
    this.zone = new Group();
    const zoneMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide });
    this.zoneMat = zoneMat;
    const ZW = STRIKE_ZONE.halfWidth * 2;
    const ZH = STRIKE_ZONE.halfHeight * 2;
    for (const [w, h, x, y] of [
      [ZW, 0.012, 0, ZH / 2],
      [ZW, 0.012, 0, -ZH / 2],
      [0.012, ZH, ZW / 2, 0],
      [0.012, ZH, -ZW / 2, 0],
    ]) {
      const bar = new Mesh(new PlaneGeometry(w, h), zoneMat);
      bar.position.set(x, y, 0);
      this.zone.add(bar);
    }
    this.zone.visible = false;
    this.zone.renderOrder = 5;
    this.world.createTransformEntity(this.zone);

    // Solid hands shipped with the game, instead of the SDK's outline hands from a CDN.
    this.skinHands = useSkinHands(this.input && this.input.xr);
    this.desktop = new DesktopPointer(this.world);
    this.cleanupFuncs.push(() => this.desktop.dispose());
    this.glove = new PlayerGlove(this.world, DEFAULT_GLOVE);

    this.prev = new Vector3();
    this.vel = new Vector3();
    this.launchFrom = new Vector3(); // the flight is exact: from + launchVel t + accel t^2 / 2
    this.launchVel = new Vector3();
    this.accel = new Vector3();
    this.tmp = new Vector3();
    this.seg = new Vector3();
    this.aim = new Vector3();
    this.head = new Vector3();
    this.bare = new Vector3();
    this.prevBare = new Vector3();
    this.prevBareOk = false;
    this.menuPoints = [];
    this.gazeDirTmp = new Vector3();
    this.crouchBaseY = null;
    this.crouchOffset = 0;
    this.rel0 = new Vector3();
    this.rel1 = new Vector3();
    this.closest = new Vector3();
    this.settleFrom = new Vector3();
    this.restAt = new Vector3();
    this.restLocal = new Vector3(); // where the caught ball rests, in the mitt's own space
    this.spinAxis = new Vector3(1, 0, 0);
    this.spinRps = 0;
    this.ramp = 0;
    this.headQ = new Quaternion();
    this.zoneCenter = new Vector3(0, 0.9, CFG.arriveZ);
    this.calledAt = new Vector3(); // the spot the catcher called (world)
    this.lowOutOfReach = false; // the called spot is below what the mouse can reach (see callPitch)
    this.offset = { x: 0, y: 0 }; // where it really crosses, from the zone's centre
    this.miss = { x: 0, y: 0 };
    this.flutter = { ax: 0, ay: 0, wx: 0, wy: 0, px: 0, py: 0 };
    this.wobble = { x: 0, y: 0 };
    this.flightT = 1;
    this.mittSpeed = 0;
    this.call = 'middle';
    this.shakeOff = null; // the pitch he shakes off, before the one he throws
    this.goodTarget = false;
    this.call_ = null; // the umpire's call on the last pitch: { strike, framed, stabbed }
    this.strikes = 0;
    this.framed = 0;
    this.level = levelById(CFG.level);
    this.spinQ = new Quaternion();
    this.spot = null; // pocket | web | heel | edge
    this.settle = 0;
    this.nearest = Infinity; // closest the ball came to touching the mitt, beyond contact (m)

    this.state = 'idle';
    this.timer = 0;
    this.lockout = 0;
    this.swapLockout = 0;
    this.messageTimer = 0;
    this.pitchNo = 0;
    this.catches = 0;
    this.misses = 0;
    this.mph = 0;
    this.pitchType = PITCHES[0];
    this.speed = 0;
    this.life = 0;
    this.held = false;
    this.streak = 0;
    this.bestStreak = 0;
    this.focusSum = 0;
    this.focusCount = 0;
    this.lastFocus = null;
    this.lastResult = null;
    this.reaction = null;
    this.best = loadBest(this.level.id);
    this.paused = false;
    // First-time practice: null when not running. { stage: 'raise' | 'ball', done, fails, hold, t }
    this.tutorialDone = CFG.skipTutorial || loadTutorialDone();
    this.tut = null;

    this.showTitle();

    const onKey = (e) => {
      this.sound.unlock();
      if (e.code === 'Space' || e.code === 'Enter') this.tryStart();
      if (e.code === 'KeyG') this.trySwap(true);
      if (e.code === 'KeyL') this.tryLevel(true);
    };
    const onPointer = (e) => {
      this.sound.unlock();
      // A click counts as a catch on desktop whenever not clicking interactive UI buttons
      if (!e || !e.target) return;
      if (e.target.tagName === 'BUTTON' || e.target.closest?.('button') || e.target.closest?.('a')) return;
      if (this.inHeadset() && !this.desktop.active) return;
      if (this.state === 'flying' && this.glove.ok) {
        const d = this.glove.pocket.distanceTo(this.ball.position);
        const radius = this.desktop.active ? 0.28 : CFG.catchRadius;
        if (d <= radius * 1.6) {
          this.caught();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe(() => {
        this.sound.unlock();
        if (this.state === 'idle') this.showTitle();
      }),
    );

    // Read-only view for the headless test.
    window['__levels'] = LEVELS;
    window['__game'] = {
      get state() { return this.sys.state; },
      get pitchNo() { return this.sys.pitchNo; },
      get catches() { return this.sys.catches; },
      get misses() { return this.sys.misses; },
      get mph() { return this.sys.mph; },
      get pitchName() { return this.sys.pitchType.name; },
      get level() { return this.sys.level.id; },
      get call() { return this.sys.call; },
      get umpire() { return this.sys.call_; },
      get tutorial() { return !!this.sys.tut; },
      get tutorialStage() { return this.sys.tut ? this.sys.tut.stage : null; },
      get tutorialDone() { return this.sys.tutorialDone; },
      get tutorialCaught() { return this.sys.tut ? this.sys.tut.done : null; },
      get strikes() { return this.sys.strikes; },
      get aim() { return this.sys.aim; },
      get ballPos() { return this.sys.ball.position; },
      get gloveSide() { return this.sys.glove.side; },
      get pocket() { return this.sys.glove.pocket; },
      get nearest() { return this.sys.nearest; },
      get spot() { return this.sys.spot; },
      get focusMode() { return this.sys.focus.mode; },
      get eyeTracker() { return this.sys.eyeTracker; },
      get eyeTrackerPos() { return this.sys.eyeTracker.group.position; },
      get eyeTrackerVisible() { return this.sys.eyeTracker.visible; },
      get lastFocus() { return this.sys.lastFocus; },
      get lastResult() { return this.sys.lastResult; },
      get best() { return this.sys.best; },
      get skinHands() { return this.sys.skinHands; },
      get fans() { return this.sys.park.fans; },
      sys: this,
      start: () => this.tryStart(),
    };
  }

  // ---------- flow ----------
  inHeadset() {
    return !!this.world.session;
  }

  // The catcher crouches. In a headset the player's rig is lowered so the eyes sit at
  // CATCHER_EYE_Y (the desktop view's height) whatever the player's real height.
  // When looking down toward the plate or dirt, the catcher crouches deeper so the hands
  // and glove comfortably reach below the strike zone square.
  updateCrouch(dt = 1 / 60) {
    if (!this.inHeadset()) {
      this.crouched = true;
      if (this.world && this.world.camera) {
        const tiltDown = Math.max(0, -(this.desktop?.ndc?.y ?? 0));
        const extraCrouch = Math.min(0.45, tiltDown * 0.60);
        const targetCamY = 1.10 - extraCrouch;
        this.world.camera.position.y = lerp(this.world.camera.position.y || 1.10, targetCamY, Math.min(1, dt * 8.0));
        this.world.camera.position.x = 0;
        this.world.camera.position.z = 1.10;
      }
      return;
    }
    const rig = this.player || this.world?.player;
    if (!rig || !rig.position) return;
    if (this.player && this.player.head) {
      this.player.head.updateMatrixWorld(true);
      this.player.head.getWorldPosition(this.head);
      this.player.head.getWorldQuaternion(this.headQ);
    } else if (this.world?.camera) {
      this.head.copy(this.world.camera.position);
      this.headQ.copy(this.world.camera.quaternion);
    }
    const headWorld = this.head;
    if (headWorld.y < 0.3) return; // no valid headset pose yet

    // When the catcher looks down (via head tilt in VR or mouse tilt in desktop emulator),
    // crouch even deeper (up to 45 cm extra) so low balls below the strike zone box are reached effortlessly
    this.gazeDirTmp.set(0, 0, -1).applyQuaternion(this.headQ);
    const headTilt = Math.max(0, -this.gazeDirTmp.y);
    const mouseTilt = (this.desktop && this.desktop.seen && this.desktop.active) ? Math.max(0, -(this.desktop?.ndc?.y ?? 0)) : 0;
    const tiltDown = Math.max(headTilt, mouseTilt);
    const extraCrouch = Math.min(0.45, tiltDown * 0.65);

    const physicalHeadY = headWorld.y - (rig.position.y || 0);
    const standingHeadY = Math.max(1.35, physicalHeadY);
    const targetBaseY = CATCHER_EYE_Y - standingHeadY - extraCrouch;

    if (this.crouchBaseY === null || this.crouchBaseY === undefined) {
      this.crouchBaseY = targetBaseY;
      rig.position.y = this.crouchBaseY;
      this.crouched = true;
    } else {
      this.crouchBaseY = lerp(this.crouchBaseY, targetBaseY, Math.min(1, dt * 6.0));
      rig.position.y = this.crouchBaseY;
    }
    this.crouched = true;
  }

  showTitle() {
    const inHeadset = this.inHeadset();
    if (!this.tutorialDone) {
      // A first-timer sees two short lines, not the rules: the practice pitches teach the rest.
      const first = [
        { text: 'You are the catcher', color: COLORS.ink },
        { text: inHeadset ? `Mitt on your ${this.glove.side} hand (the gold ball swaps it)` : 'The mouse is your mitt', color: COLORS.dim },
      ];
      this.hud.showCard('Glove Up', first, inHeadset ? 'Touch the green ball to start' : 'Touch the green ball, or press Space');
      this.swapLabel.userData.draw(`Mitt: ${this.glove.side} hand`);
      this.levelLabel.userData.draw(`Speed: ${this.level.name}`);
      return;
    }
    const lines = [{ text: `Catch ${CFG.pitches} pitches with your mitt`, color: COLORS.ink }];
    lines.push({ text: 'Keep your eyes on the ball, all the way in', color: COLORS.dim });
    lines.push({ text: 'Set your mitt on the gold target ring: that is your pitch target', color: COLORS.dim });
    if (this.best) lines.push({ text: `Your best (${this.level.name}): ${this.best} / ${CFG.pitches}`, color: COLORS.good });
    lines.push({ text: inHeadset ? `${this.level.name} speed: touch the blue ball to change` : `${this.level.name} speed (L changes it)`, color: COLORS.dim });
    lines.push({ text: inHeadset ? `Mitt on your ${this.glove.side} hand: touch the gold ball to swap` : 'On a PC, move the mouse to catch. G swaps hands', color: COLORS.dim });
    this.hud.showCard('Glove Up', lines, inHeadset ? 'Touch the green ball to start' : 'Touch the green ball, or press Space');
    this.swapLabel.userData.draw(`Mitt: ${this.glove.side} hand`);
    this.levelLabel.userData.draw(`Speed: ${this.level.name}`);
  }

  tryLevel(force = false) {
    if (this.state !== 'idle' && this.state !== 'over') return;
    if (!force && this.swapLockout > 0) return;
    const i = LEVELS.indexOf(this.level);
    this.level = LEVELS[(i + 1) % LEVELS.length];
    this.best = loadBest(this.level.id);
    this.swapLockout = 1.2;
    this.sound.start();
    if (this.state === 'idle') this.showTitle();
    else this.levelLabel.userData.draw(`Speed: ${this.level.name}`);
  }

  tryStart() {
    if ((this.state === 'idle' || this.state === 'over') && this.lockout <= 0) this.startRound();
  }

  trySwap(force = false) {
    if (this.state !== 'idle' && this.state !== 'over') return;
    if (!force && this.swapLockout > 0) return;
    this.glove.setSide(this.glove.side === 'left' ? 'right' : 'left');
    this.swapLockout = 1.2;
    this.sound.start();
    if (this.state === 'idle') this.showTitle();
    else this.swapLabel.userData.draw(`Mitt: ${this.glove.side} hand`);
  }

  startRound() {
    this.pitchNo = 0;
    this.catches = 0;
    this.misses = 0;
    this.mph = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.focusSum = 0;
    this.focusCount = 0;
    this.lastFocus = null;
    this.lastResult = null;
    this.held = false;
    this.ball.visible = false;
    this.zone.visible = false;
    this.marker.visible = false;
    this.lobbyOrb.visible = false;
    this.swapOrb.visible = false;
    this.levelOrb.visible = false;
    this.target.visible = false;
    this.strikes = 0;
    this.framed = 0;
    this.call_ = null;
    this.fx.clearTrail();
    this.hud.hideCard();
    this.hud.set({ catches: 0, misses: 0, pitchNo: 0, mph: 0, pitchName: '', focus: null });
    this.sound.start();
    if (!this.pitcher.isSet && !this.pitcher.move) this.pitcher.recover();
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.tut = this.tutorialDone ? null : { stage: 'raise', done: 0, fails: 0, hold: 0, t: 0 };
    if (this.tut) this.updateRaise(0);
    else this.message('Play ball!', COLORS.ink, CFG.readyDelay);
  }

  // Practice, step one: a gold ring waits where the pitch will cross. Hold the mitt in it and the first
  // pitch comes. The strike zone frame shows too, so the ring reads as "the target".
  updateRaise(dt) {
    const t = this.tut;
    t.t += dt;
    const inHeadset = this.inHeadset();
    (inHeadset ? this.player.head : this.world.camera).getWorldPosition(this.head);
    this.zoneCenter.set(0, Math.max(ZONE_FLOOR, this.head.y - CFG.targetBelowHead), CFG.arriveZ);
    this.calledAt.copy(this.zoneCenter);
    this.target.position.copy(this.calledAt);
    this.target.visible = true;
    this.target.scale.setScalar(1 + 0.12 * Math.sin(t.t * 5));
    this.zone.position.copy(this.zoneCenter);
    this.zone.visible = true;
    const near = this.glove.ok && (inTargetSquare(this.glove.pocket, this.zoneCenter) || inTargetSquare(this.glove.pocket, this.calledAt));
    t.hold = near ? t.hold + dt : Math.max(0, t.hold - dt * 0.5);
    if (t.hold >= 0.35 || t.t >= 8) {
      t.stage = 'ball';
      this.timer = 0.4;
      this.sound.start();
      this.message('Good! Here it comes', COLORS.good, 1.2);
      return;
    }
    let text = inHeadset ? `Hold your ${this.glove.side} hand in the gold target ring` : 'Move the mouse: mitt into the gold target ring';
    if (inHeadset && t.t > 5) text = `Reach your ${this.glove.side} hand towards the gold target ring`;
    this.message(text, '#ffd166', 0.5);
  }

  // The catcher puts the sign down: the pitch and the spot. He nods (or shakes one off first, and
  // then nods), and the gold ring marks the spot for the catcher's mitt.
  callPitch() {
    const tut = this.tut;
    if (!tut) this.pitchNo++;
    const rand = Math.random;
    this.pitchType = tut ? PITCHES[0] : choosePitch(this.pitchNo, rand);
    this.call = tut ? TUT_CALLS[Math.min(tut.done, 2)] : chooseCall(this.pitchType, rand);
    this.shakeOff = null;
    if (this.pitchNo > 3 && this.pitchType.from !== this.pitchNo && rand() < CFG.shakeChance) {
      this.shakeOff = choosePitch(this.pitchNo, rand, this.pitchType);
      if (this.shakeOff === this.pitchType) this.shakeOff = null;
    }
    // The zone sits round the catcher's chest, measured from the headset (seated or standing).
    (this.inHeadset() ? this.player.head : this.world.camera).getWorldPosition(this.head);
    this.zoneCenter.set(0, Math.max(ZONE_FLOOR, this.head.y - CFG.targetBelowHead), CFG.arriveZ);
    callOffset(this.call, this.offset);
    this.calledAt.set(this.zoneCenter.x + this.offset.x, this.zoneCenter.y + this.offset.y, CFG.arriveZ);
    this.target.position.copy(this.calledAt);
    this.target.visible = CFG.zoneHint;
    this.zone.position.copy(this.zoneCenter);
    this.zone.visible = CFG.zoneHint;
    // With the mouse as the mitt in a headset, a called spot below the bottom of the view cannot be
    // reached without tilting the head down: say so on the sign.
    this.lowOutOfReach = this.inHeadset() && this.desktop.seen && this.calledAt.y < this.desktop.lowestReach() - 0.02;
    const first = this.shakeOff || this.pitchType;
    this.showSign(first);
    if (tut) this.message(TUT_SIGN[Math.min(tut.done, 2)], '#ffd166', CFG.signTime);
    this.pitcher.signal(this.shakeOff ? 'shake' : 'nod');
    this.state = 'sign';
    this.timer = CFG.signTime + (this.shakeOff ? CFG.shakeTime : 0);
    this.hud.set({ pitchNo: this.pitchNo, pitchName: '', mph: 0 });
  }

  showSign(p) {
    const isNew = p.from === this.pitchNo && this.pitchNo > 1;
    const low = this.lowOutOfReach ? '  |  tilt your head down' : '';
    const text = `${isNew ? 'New pitch!  ' : ''}Sign ${p.sign}:  ${p.short}, ${callWords(this.call)}${low}`;
    this.message(text, '#ffd166', CFG.signTime + CFG.shakeTime);
  }

  updateSign(dt) {
    this.timer -= dt;
    // Shaken off: the next sign goes down, and this time he nods.
    if (this.shakeOff && this.timer <= CFG.signTime) {
      this.message(`Shaken off. Sign ${this.pitchType.sign}:  ${this.pitchType.short}, ${callWords(this.call)}`, '#ffd166', CFG.signTime);
      this.pitcher.signal('nod');
      this.shakeOff = null;
    }
    if (this.timer <= 0) this.beginPitch();
  }

  // He comes set and delivers. Where it really goes: the called spot plus his miss (tighter when the
  // catcher gives him a good target), never out of the catcher's reach.
  beginPitch() {
    const tut = this.tut;
    const ramp = Math.max(0, Math.min(1, (this.pitchNo - 1) / CFG.rampPitches));
    const rand = Math.random;
    this.ramp = ramp;
    this.speed = tut ? CFG.tutorialSpeed + tut.done * 1.5 : pitchSpeed(this.pitchType, this.level, ramp, rand);
    this.mph = Math.round(this.speed * MPH);
    this.goodTarget = this.glove.ok && (inTargetSquare(this.glove.pocket, this.zoneCenter) || inTargetSquare(this.glove.pocket, this.calledAt));
    // Practice pitches go exactly where the ring is; the real pitcher misses his spot a little.
    if (tut) this.miss.x = this.miss.y = 0;
    else commandMiss(this.pitchType, rand, this.goodTarget, this.miss);
    this.offset.x += this.miss.x;
    this.offset.y += this.miss.y;
    clampToReach(this.offset);
    this.aim.set(this.zoneCenter.x + this.offset.x, this.zoneCenter.y + this.offset.y, CFG.arriveZ);
    if (this.pitchType.flutter) flutterParams(this.pitchType, rand, this.flutter);

    this.pitcher.pitch();
    this.ball.scale.setScalar(this.pitcher.ballScale);
    this.ball.position.copy(this.pitcher.ballPos);
    setGlowForDistance(this.ball, 0);
    setFocusGlow(this.ball, false);
    this.eyeTracker.hide();
    this.ball.visible = true;
    this.fx.clearTrail();
    this.focus.resetPitch();
    this.eyeTracker.show();
    this.state = 'windup';
    this.hud.set({ pitchNo: this.pitchNo, pitchName: '' });
  }

  // Release: the ball leaves his fingers. The path is solved so that gravity and the pitch's
  // movement curve it INTO the target, so it visibly breaks but stays catchable.
  launch() {
    const from = this.prev.copy(this.pitcher.ballPos);
    this.pitcher.releaseBall();
    const T = from.distanceTo(this.aim) / this.speed;
    this.flightT = T;
    // The movement grows over the round: gentle early on, its full real size later.
    breakAccel(this.pitchType, T, 0.45 + 0.55 * this.ramp, this.tmp);
    this.accel.set(this.tmp.x, this.tmp.y - CFG.gravity, 0);
    this.vel.subVectors(this.aim, from).divideScalar(T).addScaledVector(this.accel, -0.5 * T);
    this.launchFrom.copy(from);
    this.launchVel.copy(this.vel);
    this.ball.position.copy(from);
    this.heldOutline.visible = false;
    this.ball.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    spinAxis(this.pitchType, this.spinAxis);
    this.spinRps = drawnRps(this.pitchType);
    this.life = 0;
    this.nearest = Infinity;
    this.prevBareOk = false;
    this.sound.whoosh();
    this.state = 'flying';
    this.hud.set({ pitchName: this.pitchType.short, mph: this.mph });
  }

  // The umpire's call, once the pitch is caught or past.
  callIt(caught) {
    this.call_ = umpire(this.offset, caught, this.mittSpeed);
    if (this.call_.strike) this.strikes++;
    if (this.call_.framed) this.framed++;
    this.target.visible = false;
    const c = this.call_;
    return c.framed ? 'Framed: STRIKE' : c.stabbed ? 'Stabbed it: Ball' : c.strike ? 'STRIKE' : 'Ball';
  }

  // The ball has met the pocket, at its current position: it settles in from there, and the
  // mitt is knocked back and snaps shut round it.
  caught() {
    this.diagnostics?.recordEvent('caught', { spot: this.spot, pitch: this.pitchType?.name, speedMph: this.mph });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.held = true;
    this.settle = 0;
    this.settleFrom.copy(this.ball.position);
    // Where in the mitt did it land? The ball rests there (in the web, in the pocket...).
    const m = this.glove.object;
    m.updateMatrixWorld(true);
    const local = m.worldToLocal(this.tmp.copy(this.ball.position));
    this.spot = catchSpot(local.x, local.y);
    this.glove.mitt.restPoint(local.x, local.y, BALL_RADIUS, this.restLocal);
    const speed = this.vel.length();
    if (speed > 0) this.glove.impact(this.tmp.copy(this.vel).divideScalar(speed), speed);
    this.fx.dust(this.ball.position, this.glove.normal, this.spot === 'pocket' ? 1 : 0.6);
    const session = this.world.session;
    if (session && session.inputSources) {
      for (const source of session.inputSources) {
        if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
          const intensity = Math.min(1.0, 0.6 + speed / 60);
          source.gamepad.hapticActuators[0].pulse(intensity, 45);
        }
      }
    }
    if (!this.tut) {
      this.catches++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }
    this.zone.visible = false;
    let ump = '';
    if (this.tut) this.target.visible = false;
    else ump = this.callIt(true);
    this.fx.burst(this.ball.position); // at the point of contact
    // The pop: deeper in the pocket, and louder the harder it was thrown (a 95 mph four-seamer cracks).
    this.sound.caught(this.streak, (this.spot === 'pocket' ? 1 : this.spot === 'web' ? 0.55 : 0.7) * Math.min(1.25, 0.6 + this.speed / 70));
    this.reaction = 'cheer';
    this.lastResult = 'caught';
    this.endFocus();
    this.hud.set({ catches: this.catches });
    const where = { pocket: 'Right in the pocket', web: 'In the web', heel: 'Off the heel', edge: 'On the edge' }[this.spot];
    let msg = this.spot === 'pocket' ? 'POP!  Right in the pocket' : `CAUGHT!  ${where}`;
    if (this.streak >= 3) msg = `${this.spot === 'pocket' ? 'POP!' : 'CAUGHT!'}  ${this.streak} in a row`;
    if (this.tut) {
      this.message(TUT_CAUGHT[Math.min(this.tut.done, 2)], COLORS.good, CFG.feedbackDelay);
      this.tut.done++;
      this.tut.fails = 0;
      return;
    }
    this.message(`${msg}  |  ${ump}`, COLORS.good, CFG.feedbackDelay);
  }

  missed(why) {
    this.diagnostics?.recordEvent(why, { why, pitch: this.pitchType?.name });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.held = false;
    if (!this.tut) this.misses++;
    this.streak = 0;
    this.zone.visible = false;
    let ump = '';
    if (this.tut) this.target.visible = false;
    else ump = this.callIt(false);
    this.sound.missed();
    this.reaction = 'shrug';
    this.lastResult = why;
    this.endFocus();
    this.hud.set({ misses: this.misses });
    let msg = 'MISSED';
    if (why === 'bare') msg = 'Use the mitt!';
    else if (why === 'back') msg = 'Off the back of the mitt';
    else if (this.nearest < CFG.nearMiss) msg = `Just missed: ${Math.max(1, Math.round(this.nearest * 100))} cm`;
    else if (this.lastFocus !== null && this.focus.lostAt !== null) msg = `Eyes left it at ${Math.max(1, Math.round(this.focus.lostAt))} m`;
    if (why === 'missed' && this.pitchType.flutter) msg += '  (it danced)';
    if (this.tut) {
      this.tut.fails++;
      if (why === 'bare') msg = 'Use the mitt, not your bare hand';
      else if (why === 'back') msg = 'Face the mitt to the pitcher';
      else msg = this.tut.fails > 1 ? 'Mitt in the gold target ring, then wait' : 'Not quite. Mitt to target ring';
    }
    this.message(why === 'missed' && !this.tut ? `${msg}  |  ${ump}` : msg, COLORS.bad, CFG.feedbackDelay);
    if (why === 'bare') {
      // Knocked away off the bare hand.
      this.vel.set(this.vel.x * 0.3 + (Math.random() - 0.5) * 3, 2.5, -Math.abs(this.vel.z) * 0.25);
    } else if (why === 'back') {
      // Glances off the back of the mitt, losing most of its pace.
      const n = this.glove.normal;
      this.vel.addScaledVector(n, -2 * this.vel.dot(n)).multiplyScalar(0.3).addScaledVector(n, -0.8);
      this.glove.impact(this.tmp.copy(n).negate(), 6);
    }
  }

  endFocus() {
    const f = this.focus.focus;
    this.lastFocus = f;
    if (f !== null && !this.tut) {
      this.focusSum += f;
      this.focusCount++;
    }
    this.hud.set({ focus: f });
    setFocusGlow(this.ball, false);
  }

  // Practice pitch over: another one, or (three caught, or five misses in a row) the real round.
  afterTutorialPitch() {
    const t = this.tut;
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    if (t.done < CFG.tutorialPitches && t.fails < 5) return;
    const earned = t.done >= CFG.tutorialPitches;
    this.tut = null;
    this.tutorialDone = true;
    saveTutorialDone();
    this.hud.set({ focus: null });
    this.timer = CFG.readyDelay * 2;
    this.sound.start();
    this.message(earned ? `That is the drill. ${CFG.pitches} pitches. Play ball!` : 'No worries. Play ball!', COLORS.ink, this.timer);
  }

  afterFeedback() {
    this.held = false;
    this.heldOutline.visible = false;
    this.ball.visible = false;
    if (this.tut) {
      this.afterTutorialPitch();
      return;
    }
    if (this.pitchNo >= CFG.pitches) {
      this.finishRound();
      return;
    }
    this.state = 'ready';
    this.timer = CFG.readyDelay;
  }

  finishRound() {
    this.state = 'over';
    this.lockout = CFG.restartLockout;
    this.marker.visible = true;
    this.lobbyOrb.visible = this.inHeadset();
    this.swapOrb.visible = this.inHeadset();
    this.levelOrb.visible = this.inHeadset();
    this.target.visible = false;
    const ratio = this.catches / CFG.pitches;
    const rating =
      ratio >= 0.95 ? 'Gold Glove!' : ratio >= 0.8 ? 'All-Star hands!' : ratio >= 0.5 ? 'Solid catching' : 'Keep working the mitt';
    const record = this.catches > this.best;
    if (record) {
      this.best = this.catches;
      saveBest(this.level.id, this.best);
    }
    this.hud.set({ message: '' });
    const lines = [
      { text: `Caught  ${this.catches} / ${CFG.pitches}`, color: COLORS.good },
      { text: record ? `${rating}  New best!` : rating, color: COLORS.ink },
    ];
    if (this.focusCount) {
      const pct = Math.round((this.focusSum / this.focusCount) * 100);
      const how = this.focus.simulated ? 'emulated eyes' : this.focus.mode === 'eyes' ? 'eye tracking' : 'head direction';
      lines.push({ text: `Eyes on the ball  ${pct}%  (${how})`, color: COLORS.dim });
    }
    lines.push({ text: `Strikes called ${this.strikes}${this.framed ? `  (${this.framed} framed)` : ''}   |   ${this.level.name}`, color: COLORS.dim });
    lines.push({ text: `Best streak ${this.bestStreak}   |   Best ${this.best}`, color: COLORS.dim });
    this.hud.showCard('Round over', lines, 'Touch the green ball to play again');
    this.sound.over();
  }

  message(text, color, duration) {
    this.messageTimer = duration;
    this.hud.set({ message: text, color });
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 0.15);
    // Take the headset off (or open the system menu) and the game waits.
    this.paused = this.world.visibilityState.peek() === VisibilityState.VisibleBlurred;
    if (this.paused) return;
    const inHeadset = this.inHeadset();
    this.updateCrouch(dt);
    this.desktop.update(this.player, dt);
    this.glove.hold = this.held ? 1 : 0;
    this.glove.update(this.player, this.desktop, inHeadset, dt);
    this.groundRing.visible = false;

    if (this.zone && this.zone.visible && this.zoneMat) {
      const inSquare = this.glove.ok && (inTargetSquare(this.glove.pocket, this.zoneCenter) || inTargetSquare(this.glove.pocket, this.calledAt));
      if (inSquare) {
        this.zoneMat.color.setHex(0xffd166);
        this.zoneMat.opacity = 0.60;
        if (this.target && this.target.material) this.target.material.opacity = 0.95;
      } else {
        this.zoneMat.color.setHex(0xffffff);
        this.zoneMat.opacity = 0.22;
        if (this.target && this.target.material) this.target.material.opacity = 0.75;
      }
    }
    this.focus.sample(this.player, this.world.camera, inHeadset);
    this.fx.update(dt);
    if (this.lockout > 0) this.lockout -= dt;
    if (this.swapLockout > 0) this.swapLockout -= dt;

    // The pitcher keeps his eyes on the catcher.
    (inHeadset ? this.player.head : this.world.camera).getWorldPosition(this.pitcher.lookAt);
    // After a pitch he reacts (cheer or shrug) once his follow-through is done, then walks back.
    if (this.reaction && !this.pitcher.move) {
      if (this.reaction === 'recover') {
        this.pitcher.recover();
        this.reaction = null;
      } else {
        if (this.reaction === 'cheer') this.pitcher.cheer();
        else this.pitcher.shrug();
        this.reaction = 'recover';
      }
    }
    this.pitcher.update(dt);

    if (this.state === 'windup') {
      this.ball.position.copy(this.pitcher.ballPos);
      const dist = this.ball.position.distanceTo(this.head);
      this.focus.track(this.ball.position, dt, dist);
    }

    if (this.state === 'windup' || this.state === 'flying') {
      if (this.world?.renderer?.shadowMap) this.world.renderer.shadowMap.needsUpdate = true;
      this.eyeTracker.update(
        this.focus,
        this.ball.position,
        this.focus.watching,
        inHeadset,
        this.world.camera,
        this.desktop,
        dt,
      );
    } else {
      this.eyeTracker.hide();
    }

    switch (this.state) {
      case 'idle':
      case 'over':
        this.updateMenu();
        break;
      case 'ready':
        if (this.tut && this.tut.stage === 'raise') {
          this.updateRaise(dt);
          break;
        }
        this.timer -= dt;
        if (this.timer <= 0 && this.pitcher.isSet && !this.reaction) this.callPitch();
        break;
      case 'sign':
        this.updateSign(dt);
        break;
      case 'windup':
        this.ball.position.copy(this.pitcher.ballPos);
        if (this.pitcher.hasReleased) this.launch();
        break;
      case 'flying':
        this.updateFlight(dt);
        break;
      case 'feedback':
        this.updateFeedback(dt);
        break;
      default:
        break;
    }

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && this.state !== 'over') this.hud.set({ message: '' });
    }
    this.marker.rotation.y += dt;

    // Pinch or trigger catches in a headset. Attached once per XR session (a re-entered session is a
    // new object, so the listener follows it).
    const session = this.world.session;
    if (session && this._hookedSession !== session) {
      this._hookedSession = session;
      this.crouchBaseY = null;
      this.crouchOffset = 0;
      session.addEventListener('selectstart', () => {
        if (this.state === 'flying' && this.glove.ok) {
          const d = this.glove.pocket.distanceTo(this.ball.position);
          if (d <= CFG.catchRadius * 1.6) {
            this.caught();
          }
        }
      });
    }

    if (this.diagnostics && this.diagnostics.enabled) {
      const leftGrip = this.player?.gripSpaces?.left;
      const rightGrip = this.player?.gripSpaces?.right;
      this.diagnostics.update({
        gameState: this.state,
        glove: {
          side: this.glove.side,
          ok: this.glove.ok,
          squeeze: this.glove.squeeze,
          pocket: this.glove.pocket,
        },
        hands: {
          left: { tracked: !!leftGrip?.visible, palm: leftGrip?.position },
          right: { tracked: !!rightGrip?.visible, palm: rightGrip?.position },
        },
        gaze: {
          mode: this.focus.mode,
          focus: this.focus.focus,
          watching: this.focus.watching,
          origin: this.world.camera.position,
          dir: this.world.camera.getWorldDirection(this.gazeDirTmp),
        },
      });
    }
  }

  // Touch the green ball (with either hand or the mitt) to start; the gold orb swaps hands.
  updateMenu() {
    this.swapOrb.visible = this.inHeadset();
    this.levelOrb.visible = this.inHeadset();
    const points = this.menuPoints;
    points.length = 0;
    if (this.glove.ok) points.push(this.glove.pocket);
    if (this.inHeadset()) {
      for (const side of ['left', 'right']) {
        const g = this.player.gripSpaces[side];
        if (g.visible) points.push(g.getWorldPosition(side === 'left' ? this.tmp : this.bare));
      }
    }
    for (const p of points) {
      if (this.lockout <= 0 && p.distanceTo(this.marker.position) < START_RADIUS) {
        this.startRound();
        return;
      }
      if (this.lockout <= 0 && p.distanceTo(this.lobbyOrb.position) < START_RADIUS) {
        const loc = window.location;
        if (loc.port === '8081' || loc.port === '8082' || loc.port === '8083') {
          window.location.href = `${loc.protocol}//${loc.hostname}:8080/`;
        } else {
          const parts = loc.pathname.split('/').filter(Boolean);
          if (parts.length > 0) parts.pop();
          const base = parts.length > 0 ? `/${parts.join('/')}/` : '/';
          window.location.href = `${loc.origin}${base}`;
        }
        return;
      }
    }
    if (this.swapOrb.visible) {
      for (const p of points) {
        if (p.distanceTo(this.swapOrb.position) < SWAP_RADIUS) {
          this.trySwap();
          return;
        }
        if (p.distanceTo(this.levelOrb.position) < SWAP_RADIUS) {
          this.tryLevel();
          return;
        }
      }
    }
  }

  updateFlight(dt) {
    // Exact flight (not stepped), so the pitch crosses precisely where it was aimed, whatever the
    // frame rate.
    this.prev.copy(this.ball.position);
    const t = this.life + dt;
    this.ball.position.copy(this.launchFrom).addScaledVector(this.launchVel, t).addScaledVector(this.accel, 0.5 * t * t);
    if (this.pitchType.flutter) {
      // A knuckleball dances late, and is back on line where it crosses.
      flutterAt(this.flutter, Math.min(t, this.flightT), this.flightT, this.wobble);
      this.ball.position.x += this.wobble.x;
      this.ball.position.y += this.wobble.y;
    }
    this.vel.copy(this.launchVel).addScaledVector(this.accel, t);
    // The seams spin about the pitch's own axis (backspin, topspin, side spin, bullet spin).
    this.ball.quaternion.premultiply(this.spinQ.setFromAxisAngle(this.spinAxis, this.spinRps * Math.PI * 2 * dt));
    // Real size in his hand, growing to the game's catchable size as it leaves.
    this.ball.scale.setScalar(Math.min(1, this.pitcher.ballScale + this.life * 1.5));
    const dist = this.ball.position.distanceTo(this.head.set(0, this.aim.y, 0));
    setGlowForDistance(this.ball, dist);
    this.life += dt;
    this.fx.trailPoint(this.ball.position, dt);
    this.focus.track(this.ball.position, dt, dist);
    setFocusGlow(this.ball, this.focus.watching);

    // Contact with the mitt: swept between frames, relative to the mitt, so neither a fast pitch nor
    // a fast mitt can pass through the other between two frames.
    const g = this.glove;
    // How fast the mitt is moving as the ball arrives: quiet hands frame a pitch, a stab loses it.
    if (g.ok && g.prevOk && dt > 0) {
      const v = g.pocket.distanceTo(g.prevPocket) / dt;
      this.mittSpeed = v < 30 ? v : this.mittSpeed;
    } else this.mittSpeed = 0;
    if (g.ok) {
      const isLow = this.ball.position.y < (this.zoneCenter.y - 0.05);
      const radius = (this.desktop.active || isLow) ? Math.max(CFG.catchRadius, 0.28) : CFG.catchRadius;
      const d = this.sweep(g.prevOk ? g.prevPocket : g.pocket, g.pocket);
      this.nearest = Math.min(this.nearest, Math.max(0, d - radius));
      if (d <= radius) {
        this.ball.position.copy(g.pocket).add(this.closest);
        // From the front (into the pocket), or the back of the mitt?
        const from = this.rel0.lengthSq() > 1e-6 ? this.tmp.copy(this.rel0) : this.tmp.copy(this.vel).negate();
        if (g.normal.dot(from.normalize()) < CFG.backOfMitt) this.missed('back');
        else this.caught();
        return;
      }
    }
    if (this.inHeadset()) {
      const hand = bareHand(this.player, this.glove.side, this.bare, g.useJoints);
      if (hand) {
        const d = this.sweep(this.prevBareOk ? this.prevBare : hand, hand);
        this.prevBare.copy(hand);
        this.prevBareOk = true;
        // Natural catcher technique: throwing hand is kept near/behind the mitt to trap the ball.
        // Only penalize if the bare hand is away from the mitt pocket (>0.32m), i.e. swatted bare-handed.
        const nearMitt = g.ok && hand.distanceTo(g.pocket) < 0.32;
        if (!nearMitt && d <= CFG.bareHandRadius) {
          this.ball.position.copy(hand).add(this.closest);
          this.missed('bare');
          return;
        }
      } else {
        this.prevBareOk = false;
      }
    }
    // The ball is drawn through the leather once it is close to the mitt, so it stays visible in the
    // last moments of its flight (the mitt faces the pitcher, so the ball would otherwise hide behind it).
    this.heldOutline.visible = g.ok && this.ball.position.distanceTo(g.pocket) < CFG.outlineNear;
    if (this.ball.position.z >= CFG.missZ || this.life > CFG.maxLife) this.missed('missed');
  }

  // Closest approach between the ball (from this.prev to its position now) and a point moving from
  // p0 to p1 over the same frame. Leaves rel0 (ball relative to the point at the frame's start) and
  // closest (the ball relative to the point at that moment) for the caller.
  sweep(p0, p1) {
    if (p0.distanceTo(p1) > 0.5) p0 = p1; // a tracking jump, not a real movement
    const r0 = this.rel0.subVectors(this.prev, p0);
    const r1 = this.rel1.subVectors(this.ball.position, p1);
    const seg = this.seg.subVectors(r1, r0);
    const lenSq = seg.lengthSq();
    const t = lenSq > 0 ? Math.min(1, Math.max(0, -r0.dot(seg) / lenSq)) : 0;
    return this.closest.copy(r0).addScaledVector(seg, t).length();
  }

  updateFeedback(dt) {
    if (this.held) {
      // In the pocket, a little sunk into the leather, moving with the mitt (and its recoil). It
      // eases there from the point of contact.
      this.glove.object.updateMatrixWorld(true);
      this.restAt.copy(this.restLocal).applyMatrix4(this.glove.object.matrixWorld);
      this.settle = Math.min(1, this.settle + dt / CFG.settleTime);
      const k = this.settle * this.settle * (3 - 2 * this.settle);
      this.ball.scale.setScalar(1);
      this.ball.position.lerpVectors(this.settleFrom, this.restAt, k);
      this.heldOutline.visible = true;
    } else if (this.ball.visible) {
      // A missed ball carries on past the catcher, then is gone.
      this.vel.y -= CFG.gravity * dt;
      this.ball.position.addScaledVector(this.vel, dt);
      if (this.ball.position.y < 0.05) {
        this.ball.position.y = 0.05;
        this.vel.y = Math.abs(this.vel.y) * 0.4;
        this.vel.x *= 0.7;
        this.vel.z *= 0.7;
      }
      if (this.ball.position.z > 4 || this.timer < 0.3) this.ball.visible = false;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.afterFeedback();
  }
}
