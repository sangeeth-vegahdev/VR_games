import {
  createSystem,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { BALL_RADIUS, makeBall, setGlowForDistance } from './ball.js';
import {
  commitHand,
  createContact,
  createDecision,
  createHand,
  deflectVelocity,
  evaluateCatch,
  evaluateHand,
  invalidateHand,
  setHandFromJoints,
  setHandFromPoint,
  setHandFromPose,
  updateHandMotion,
} from './catching.js';
import { CFG, RESTART_POS, RESTART_RADIUS } from './config.js';
import { Coach } from './coach.js';
import { DesktopHand } from './desktop-hand.js';
import { Effects, Sound } from './fx.js';
import { trackedHands, useSkinHands } from './hands.js';
import { COLORS, Hud } from './hud.js';
import { buildStadium } from './stadium.js';
import { FocusTracker } from './gaze.js';
import { EyeRingTracker } from './eye-tracker.js';
import { DiagnosticsPanel } from './diagnostics.js';

const lerp = (a, b, t) => a + (b - a) * t;

// Best score is remembered per round length. Storage can be blocked, so it is always optional.
const bestKey = () => `cricket-catch-best-${CFG.balls}`;
function loadBest() {
  try {
    return Number(localStorage.getItem(bestKey())) || 0;
  } catch (e) {
    return 0;
  }
}
function saveBest(value) {
  try {
    localStorage.setItem(bestKey(), String(value));
  } catch (e) {
    /* not saved: fine */
  }
}

// First-time practice is remembered once finished. Storage can be blocked, so it is optional.
const TUT_KEY = 'cricket-catch-tutorial-done';
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
const TUT_THROW = ['Watch the ring: that is where it lands', 'It swings now. Follow the ring', 'Eyes on the ball'];
const TUT_CAUGHT = ['That is it! Again', 'Nice. One more', 'Safe hands!'];

// Round flow: idle -> ready -> swinging -> flying -> feedback -> (ready ... | over) -> ready ...
export class GameSystem extends createSystem({}) {
  init() {
    this.sound = new Sound();
    this.fx = new Effects(this.world);
    buildStadium(this.world);
    this.coach = new Coach(this.world);
    this.hud = new Hud(this.world, CFG.balls);
    this.focus = new FocusTracker();
    this.eyeTracker = new EyeRingTracker(this.world);
    this.diagnostics = new DiagnosticsPanel('Cricket Catch');
    this.diagnostics.attachWorld(this.world);

    this.ball = makeBall();
    this.ball.visible = false;
    // While the ball is held, a faint outline of it shows through the hand, so the player always
    // sees that it is in their hand (a real hand would feel it).
    this.heldOutline = new Mesh(
      new SphereGeometry(BALL_RADIUS * 1.02, 24, 16),
      new MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.32, depthTest: false, depthWrite: false }),
    );
    this.heldOutline.renderOrder = 20;
    this.heldOutline.visible = false;
    this.ball.add(this.heldOutline);
    this.world.createTransformEntity(this.ball);

    this.marker = new Mesh(
      new SphereGeometry(RESTART_RADIUS * 0.6, 24, 16),
      new MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1d8f4e, emissiveIntensity: 1.2 }),
    );
    this.marker.position.set(RESTART_POS.x, RESTART_POS.y, RESTART_POS.z);
    this.world.createTransformEntity(this.marker);

    this.lobbyMarker = new Mesh(
      new SphereGeometry(RESTART_RADIUS * 0.45, 24, 16),
      new MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x0088cc, emissiveIntensity: 1.2 }),
    );
    this.lobbyMarker.position.set(RESTART_POS.x - 0.42, RESTART_POS.y, RESTART_POS.z);
    this.world.createTransformEntity(this.lobbyMarker);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'l' || e.key === 'L') {
        window.location.href = `${window.location.protocol}//${window.location.hostname}:8080`;
      }
    });

    // A distinct amber ring at the spot the ball is heading for, shown over the last stretch of its flight.
    this.aimRing = new Mesh(
      new RingGeometry(0.14, 0.18, 40),
      new MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.75, side: DoubleSide, depthWrite: false }),
    );
    this.aimRing.renderOrder = 5;
    this.aimRing.visible = false;
    this.world.createTransformEntity(this.aimRing);

    // Solid hands shipped with the game, instead of the SDK's outline hands from a CDN.
    this.skinHands = useSkinHands(this.input && this.input.xr);

    this.desktop = new DesktopHand(this.world);
    this.cleanupFuncs.push(() => this.desktop.dispose());

    // Each hand as the catching rules see it (src/catching.js). The palm/normal arrays below alias its
    // vectors; they are what the tests and the HUD read.
    this.hands = { left: createHand('left'), right: createHand('right') };
    this.decision = createDecision();
    this.clickContact = createContact();
    this.catchInfo = null; // what the last catch was: technique, tags, quality
    this.palm = { left: this.hands.left.palm, right: this.hands.right.palm };
    this.palmOk = { left: false, right: false };
    this.palmNormal = { left: this.hands.left.normal, right: this.hands.right.normal };
    this.palmNormalOk = { left: false, right: false };
    this.palmFingers = { left: this.hands.left.fingers, right: this.hands.right.fingers };
    this.palmThumb = { left: this.hands.left.across, right: this.hands.right.across }; // towards the thumb
    this.palmFromJoints = true; // the headless test turns this off to place hands by their grip pose
    this.J = {
      wrist: new Vector3(), middleProx: new Vector3(), indexMeta: new Vector3(), pinkyMeta: new Vector3(),
      indexProx: new Vector3(), pinkyProx: new Vector3(), thumbProx: new Vector3(),
      middleTip: new Vector3(), indexTip: new Vector3(), pinkyTip: new Vector3(), thumbTip: new Vector3(),
    };
    this.shoulders = { left: new Vector3(), right: new Vector3(), axis: new Vector3(1, 0, 0) };
    this.headQ = new Quaternion();
    this.handCtx = { head: null, ballPos: null, ballVel: null, ballActive: false, holding: false, palm: null, side: 'right', pair: false };
    this.heldAt = new Vector3();
    this.settleFrom = new Vector3();
    this.restAt = new Vector3(); // where a caught ball rests in the hand
    this.settle = 0;
    this.settleScale = 1;
    this.nearest = Infinity;
    this.deflected = false;
    this.freeFlight = false;
    this.isWide = false;
    this.forceType = null; // test hook, see beginThrow
    this.forceWideSide = 0;
    this.twoHanded = false;
    this.lastResult = null;
    this.prev = new Vector3();
    this.vel = new Vector3();
    this.launchFrom = new Vector3(); // the flight is exact: from + launchVel t + accel t^2 / 2
    this.launchVel = new Vector3();
    this.accel = new Vector3();
    this.tmp = new Vector3();
    this.aim = new Vector3();
    this.release = new Vector3();
    this.head = new Vector3();
    this.crouchBaseY = 0;
    this.crouchOffset = 0;
    this.targetCrouch = 0;
    this.gazeDirTmp = new Vector3();
    this.trajectoryCache = Array.from({ length: 31 }, () => new Vector3());

    this.state = 'idle';
    this.timer = 0;
    this.lockout = 0;
    this.messageTimer = 0;
    this.ballNo = 0;
    this.score = 0;
    this.misses = 0;
    this.kmh = 0;
    this.side = 1;
    this.swingA = 0;
    this.life = 0;
    this.heldBy = null;
    this.contactGap = 0;
    this.throwSpeed = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.focusSum = 0;
    this.focusCount = 0;
    this.lastFocus = null;
    this.best = loadBest();
    this.paused = false;
    // First-time practice: null when not running. { stage: 'raise' | 'ball', done, fails, hold, t }
    this.tutorialDone = CFG.skipTutorial || loadTutorialDone();
    this.tut = null;
    this.spot = new Vector3(); // where the practice ring waits for the player's hand

    this.showTitle();

    const onKey = (e) => {
      this.sound.unlock();
      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.tut && this.tut.stage === 'raise') {
          this.tut.stage = 'ball';
          this.timer = 0.7;
          this.sound.start();
          this.message('Good! Here it comes', COLORS.good, 1.2);
          return;
        }
        this.tryStart();
      }
    };
    const onPointer = () => {
      this.sound.unlock();
      if (this.tut && this.tut.stage === 'raise') {
        this.tut.stage = 'ball';
        this.timer = 0.7;
        this.sound.start();
        this.message('Good! Here it comes', COLORS.good, 1.2);
      }
      if (this.state === 'flying') {
        this.tryClickCatch();
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
        if (this.state === 'idle') this.showTitle(); // the hint differs in and out of a headset
      }),
    );

    // Read-only view for the headless test.
    window.__game = {
      get state() { return this.sys.state; },
      get ballNo() { return this.sys.ballNo; },
      get score() { return this.sys.score; },
      get misses() { return this.sys.misses; },
      get kmh() { return this.sys.kmh; },
      get aim() { return this.sys.aim; },
      get ballPos() { return this.sys.ball.position; },
      get ballVisible() { return this.sys.ball.visible; },
      get aimRingVisible() { return this.sys.aimRing.visible; },
      get streak() { return this.sys.streak; },
      get best() { return this.sys.best; },
      get skinHands() { return this.sys.skinHands; },
      get focusMode() { return this.sys.focus.mode; },
      get focusSource() { return this.sys.focus.source; },
      get catchInfo() { return this.sys.catchInfo; },
      get trackedHands() { return trackedHands; },
      get catching() { return { setHandFromPose, createHand }; },
      get focusStats() {
        const f = this.sys.focus;
        return { mode: f.mode, source: f.source, realEyes: f.realEyes, simulated: f.simulated, valid: f.valid, movement: f.movement, watching: f.watching, lookedAway: f.lookedAway, eyeTravel: f.eyeTravel, headTravel: f.headTravel, focus: f.focus };
      },
      get isWide() { return this.sys.isWide; },
      get eyeTracker() { return this.sys.eyeTracker; },
      get eyeTrackerPos() { return this.sys.eyeTracker.group.position; },
      get eyeTrackerVisible() { return this.sys.eyeTracker.visible; },
      get lastFocus() { return this.sys.lastFocus; },
      get contactGap() { return this.sys.contactGap; },
      get nearest() { return this.sys.nearest; },
      get lastResult() { return this.sys.lastResult; },
      get twoHanded() { return this.sys.twoHanded; },
      get cupType() { return this.sys.cupType; },
      get tutorial() { return !!this.sys.tut; },
      get tutorialStage() { return this.sys.tut ? this.sys.tut.stage : null; },
      get tutorialDone() { return this.sys.tutorialDone; },
      get tutorialCaught() { return this.sys.tut ? this.sys.tut.done : null; },
      sys: this,
      start: () => this.tryStart(),
    };
  }

  // ---------- flow ----------
  showTitle() {
    const inHeadset = !!this.world.session;
    // A first-timer sees one line, not the rules: the practice balls teach the rest.
    const lines = this.tutorialDone
      ? [
        { text: `Catch ${CFG.balls} balls with your hands` },
        this.best
          ? { text: `Your best: ${this.best} / ${CFG.balls}` }
          : { text: inHeadset ? 'Watch the ball swing, then reach for it' : 'On a PC, move the mouse to catch' },
      ]
      : [{ text: inHeadset ? 'Your bare hands are the catchers' : 'The mouse is your hand' }];
    this.hud.showCard('Cricket Catch', lines, inHeadset ? 'Touch the green ball, or pinch, to start' : 'Touch the green ball, or press Space');
  }

  tryStart() {
    if ((this.state === 'idle' || this.state === 'over') && this.lockout <= 0) this.startRound();
  }

  startRound() {
    this.ballNo = 0;
    this.score = 0;
    this.misses = 0;
    this.kmh = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.focusSum = 0;
    this.focusCount = 0;
    this.lastFocus = null;
    this.heldBy = null;
    this.heldOutline.visible = false;
    this.ball.visible = false;
    this.aimRing.visible = false;
    this.eyeTracker.hide();
    this.marker.visible = false;
    this.lobbyMarker.visible = false;
    this.fx.clearTrail();
    this.hud.hideCard();
    this.hud.set({ score: 0, misses: 0, ballNo: 0, kmh: 0, focus: null });
    this.sound.start();
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.tut = this.tutorialDone ? null : { stage: 'raise', done: 0, fails: 0, hold: 0, t: 0 };
    if (this.tut) this.updateRaise(0);
    else this.message('Get ready', COLORS.ink, CFG.readyDelay);
  }

  // Practice, step one: a ring waits where the ball will arrive. Put a hand in it and the first ball comes.
  updateRaise(dt) {
    const t = this.tut;
    t.t += dt;
    (this.world.session ? this.player.head : this.world.camera).getWorldPosition(this.head);
    this.spot.set(0, this.head.y - CFG.chestBelowHead, CFG.arriveZ);
    let near = false;
    for (const side of ['left', 'right']) {
      if (this.palmOk[side]) {
        const p = this.palm[side];
        const dist = p.distanceTo(this.spot);
        const inFront = p.z < -0.30 && p.y > this.head.y - 0.75 && Math.abs(p.x) < 0.45;
        if (dist < 0.38 || inFront) near = true;
      }
    }
    if (this.aimRing && this.aimRing.material) {
      this.aimRing.material.color.setHex(near ? 0x4ade80 : 0xffffff);
      this.aimRing.material.opacity = near ? 0.95 : 0.65;
    }
    t.hold = near ? t.hold + dt : Math.max(0, t.hold - dt);
    if (t.hold >= 0.4 || t.t >= 8) {
      t.stage = 'ball';
      this.timer = 0.7;
      this.sound.start();
      if (this.aimRing && this.aimRing.material) {
        this.aimRing.material.color.setHex(0xffffff);
        this.aimRing.material.opacity = 0.4;
      }
      this.message('Good! Here it comes', COLORS.good, 1.2);
      return;
    }
    const inHeadset = !!this.world.session;
    let text = near
      ? 'Hold hand steady...'
      : (inHeadset ? 'Raise a hand forward into the glowing ring' : 'Move the mouse into the ring');
    if (!near && t.t > 4) text = 'Reach forward into the ring to start';
    this.message(text, COLORS.ink, 0.5);
  }

  beginThrow() {
    this.crouchOffset = 0;
    this.targetCrouch = 0;
    const rig = this.player || this.world?.player;
    if (rig && rig.position) {
      rig.position.y = this.crouchBaseY;
    }
    const tut = this.tut;
    if (!tut) this.ballNo++;
    const roll = Math.random();
    // `forceType` is a test hook (set through window.__game): 'high' | 'low' | 'wide' | 'normal'.
    const force = tut ? null : this.forceType;
    this.isHighCatch = force ? force === 'high' : !tut && this.ballNo > 3 && roll < 0.20;
    // Low balls are disabled (CFG.lowBallChance = 0): never generated, not even by the test hook.
    // The low-catch code below and in catching.js stays so they can be re-enabled by raising the chance.
    const lowAllowed = CFG.lowBallChance > 0;
    this.isLowCatch = lowAllowed && (force ? force === 'low' : !tut && this.ballNo > 2 && !this.isHighCatch && roll >= 0.20 && roll < 0.20 + CFG.lowBallChance);

    const ramp = Math.min(1, (this.ballNo - 1) / CFG.rampBalls);
    let speed = lerp(CFG.startSpeed, CFG.maxSpeed, ramp);
    if (ramp >= 1) speed += (Math.random() * 2 - 1) * CFG.speedJitter;
    if (tut) speed = CFG.tutorialSpeed + tut.done * 1.5;
    this.throwSpeed = speed;
    this.kmh = Math.round(speed * 3.6);
    const isStraight = this.isHighCatch ? (Math.random() < 0.6) : (Math.random() < 0.35);
    if (isStraight) {
      this.side = 0;
      this.swingA = 0;
    } else {
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.swingA = lerp(CFG.swingBase, CFG.swingMax, ramp);
    }
    // Practice: the first ball comes straight, the next ones swing a little more each time.
    if (tut) {
      if (tut.done === 0) {
        this.side = 0;
        this.swingA = 0;
      } else {
        this.side = Math.random() < 0.5 ? -1 : 1;
        this.swingA = CFG.swingBase * (0.8 + 0.4 * tut.done);
      }
    }

    // Arrival point: high skier, dipping low catch, or chest/waist
    (this.world.session ? this.player.head : this.world.camera).getWorldPosition(this.head);
    let targetY;
    if (this.isHighCatch) {
      // High catch (skier): arrives above head height, requiring hands raised high.
      const highOffset = CFG.highCatchOffset + (Math.random() * 2 - 1) * 0.06;
      targetY = this.head.y + highOffset;
    } else if (this.isLowCatch) {
      // Low catch: genuine knee and shin height.
      // Standing (head > 1.35m): arrives at 0.35m to 0.58m.
      // Seated (head <= 1.35m): adapts to 0.35m to 0.50m so reachable without collision with chair.
      const isStanding = this.head.y > 1.35;
      if (isStanding) {
        targetY = 0.35 + Math.random() * 0.23;
      } else {
        targetY = Math.max(0.30, this.head.y - 0.75) + Math.random() * 0.15;
      }
    } else {
      targetY = this.head.y - CFG.chestBelowHead + (tut ? 0 : (Math.random() * 2 - 1) * CFG.targetSpreadY);
    }

    // Now and then a ball arrives wide, past the reach of a two-handed catch: one hand, at full stretch.
    this.isWide = force
      ? force === 'wide'
      : !tut && !this.isHighCatch && !this.isLowCatch && this.ballNo >= CFG.wideFromBall && Math.random() < CFG.wideChance;
    let aimX = tut ? 0 : (Math.random() * 2 - 1) * CFG.targetSpreadX;
    if (this.isWide) aimX = (this.forceWideSide || (Math.random() < 0.5 ? -1 : 1)) * CFG.wideSpreadX * (0.9 + 0.1 * Math.random());
    this.aim.set(aimX, targetY, CFG.arriveZ);

    this.coach.swing();
    this.focus.resetPitch();
    this.eyeTracker.show();
    // The coach holds the ball, tosses it up and strikes it: the ball is shown from the start.
    this.ball.scale.setScalar(this.coach.ballScale);
    this.ball.position.copy(this.coach.ballPos);
    setGlowForDistance(this.ball, CFG.arriveZ - this.ball.position.z);
    this.ball.visible = true;
    this.fx.clearTrail();
    this.state = 'swinging';
    this.hud.set({ ballNo: this.ballNo, kmh: this.kmh, message: '' });
    if (tut) {
      this.message(TUT_THROW[Math.min(tut.done, 2)], COLORS.ink, 4);
    } else if (this.isHighCatch) {
      this.message('High ball! Reach up with both hands', COLORS.ink, 3.5);
    } else if (this.isLowCatch) {
      this.message('Low dipper! Down to the knees', COLORS.ink, 3.5);
    } else if (this.isWide) {
      this.message('Wide! Stretch out one hand', COLORS.ink, 3.5);
    }
  }

  // Contact: the ball leaves the bat. The path is solved so that swing and gravity
  // curve it INTO the arrival point, so it visibly bends but stays catchable.
  launchBall() {
    const from = this.release.copy(this.coach.sweetSpot);
    this.contactGap = this.coach.ballPos.distanceTo(from); // how far the tossed ball was from the bat
    this.coach.releaseBall();
    const dz = this.aim.z - from.z;
    const len = Math.hypot(this.aim.x - from.x, this.aim.y - from.y, dz);
    const flight = this.isHighCatch ? 2.1 : (len / this.throwSpeed);
    this.flightDuration = flight;
    this.vel.set(
      (this.aim.x - from.x) / flight - 0.5 * this.side * this.swingA * flight,
      (this.aim.y - from.y) / flight + 0.5 * CFG.gravity * flight,
      dz / flight,
    );
    this.aimRing.position.copy(this.aim);
    this.accel.set(this.side * this.swingA, -CFG.gravity, 0); // the swing, and gravity
    this.launchFrom.copy(from);
    this.launchVel.copy(this.vel);
    this.ball.position.copy(from);
    // Seam upright, leaning a little towards the way the ball will swing, like a real swing ball.
    this.ball.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2 - this.side * 0.3);
    setGlowForDistance(this.ball, CFG.arriveZ - from.z);
    this.life = 0;
    this.nearest = Infinity;
    this.deflected = false;
    this.twoHanded = false;
    this.cupType = null;
    this.freeFlight = false;
    this.catchInfo = null;
    this.hands.left.prevOk = false;
    this.hands.right.prevOk = false;
    this.sound.crack();
    this.state = 'flying';
  }

  // The ball has touched `side`'s hand, at its current position. It settles into the palm from there.
  // d: the catch decision (technique, tags, quality), see catching.js.
  caught(side, d) {
    this.diagnostics?.recordEvent('caught', { side, high: this.isHighCatch, speedKmh: this.kmh });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = side;
    this.lastResult = 'caught';
    this.settle = 0;
    this.settleFrom.copy(this.ball.position);
    this.settleScale = this.ball.scale.x;
    const twoHand = !!(d && d.twoHand);
    this.twoHanded = twoHand;
    this.cupType = twoHand ? d.technique : null;
    this.catchInfo = d
      ? { technique: d.technique, tags: d.tags.slice(), quality: d.quality, twoHand, side, relSpeed: d.relSpeed }
      : { technique: 'one-hand', tags: [], quality: 0.5, twoHand: false, side, relSpeed: 0 };
    if (!this.tut) {
      this.score++;
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }
    const f = this.focus.focus;
    this.lastFocus = f;
    if (f !== null && !this.tut) {
      this.focusSum += f;
      this.focusCount++;
    }
    this.aimRing.visible = false;
    this.eyeTracker.hide();
    const session = this.world.session;
    if (session && session.inputSources) {
      for (const source of session.inputSources) {
        if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
          source.gamepad.hapticActuators[0].pulse(0.8, 45);
        }
      }
    }
    this.fx.burst(this.ball.position); // at the point of contact
    this.sound.caught();
    this.coach.cheer();
    this.hud.set({ score: this.score, focus: f });
    this.message(this.tut ? this.tutorialCaughtLine() : this.catchMessage(), COLORS.good, CFG.feedbackDelay);
  }

  tutorialCaughtLine() {
    const line = TUT_CAUGHT[Math.min(this.tut.done, 2)];
    this.tut.done++;
    this.tut.fails = 0;
    return line;
  }

  // One line that names the catch the way a commentator would.
  catchMessage() {
    const info = this.catchInfo;
    const tags = info.tags;
    const two = info.twoHand;
    const cup = info.technique;
    if (tags.includes('stretch')) return 'STRETCH CATCH! One hand, at full reach';
    if (this.isHighCatch || (tags.includes('high') && two)) {
      if (cup === 'reverse-cup') return 'HIGH CATCH! Reverse cup locked';
      return two ? 'HIGH CATCH! Two-handed snag' : 'HIGH CATCH! Reached high';
    }
    if (this.isLowCatch || (tags.includes('low') && two)) {
      if (cup === 'orthodox-cup') return 'LOW CATCH! Beautiful orthodox cup';
      return two ? 'LOW CATCH! Two-handed pickup' : 'LOW CATCH! Picked off the turf';
    }
    if (tags.includes('fast')) return `FAST HANDS! ${this.kmh} km/h${two ? ' (2-Handed)' : ''}`;
    if (two) return 'CAUGHT!  Safe hands (2-Handed)';
    if (tags.includes('soft')) return 'CAUGHT!  Soft hands';
    if (this.streak >= 3) return `CAUGHT!  ${this.streak} in a row`;
    return 'CAUGHT!';
  }

  // why: 'missed' (it went past), or a deflection: 'back' (back of the hand), 'wrist' (wrist or forearm),
  // 'edge' (edge-on to the palm, or a finger jam), 'fist' (a clenched hand).
  missed(why = 'missed') {
    const deflection = why !== 'missed';
    this.diagnostics?.recordEvent(why === 'back' ? 'deflection_back_of_hand' : deflection ? `deflection_${why}` : 'missed', { why });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = null;
    this.lastResult = why;
    this.deflected = deflection;
    this.freeFlight = !deflection; // a ball that was simply missed flies on past the player
    this.ball.visible = true; // seen flying off or on, until it lands or the next ball
    if (!this.tut) this.misses++;
    this.streak = 0;
    const f = this.focus.focus;
    this.lastFocus = f;
    if (f !== null && !this.tut) {
      this.focusSum += f;
      this.focusCount++;
    }
    this.aimRing.visible = false;
    this.eyeTracker.hide();
    this.sound.missed();
    this.coach.shrug();
    this.hud.set({ misses: this.misses, focus: f });
    let msg = 'MISSED';
    if (why === 'back') msg = 'Off the back of the hand';
    else if (why === 'wrist') msg = 'Hit the wrist: catch with the palm';
    else if (why === 'edge') msg = 'Edge of the hand: face your palm to the ball';
    else if (why === 'fist') msg = 'Open your hand to catch';
    else if (this.lastFocus !== null && this.focus.lostAt !== null) msg = `Eyes left it at ${Math.max(1, Math.round(this.focus.lostAt))} m`;
    else if (this.nearest < CFG.nearMiss) msg = `Just missed: ${Math.max(1, Math.round(this.nearest * 100))} cm`;
    if (this.tut) {
      this.tut.fails++;
      msg = deflection ? 'Show your palm to the ball' : this.tut.fails > 1 ? 'Palm open, reach for the ring' : 'Not quite. Reach for the ring';
    }
    this.message(msg, COLORS.bad, CFG.feedbackDelay);
  }

  // Practice ball over: another one, or (three caught, or five misses in a row) the real round.
  afterTutorialBall() {
    const t = this.tut;
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    if (t.done < CFG.tutorialBalls && t.fails < 5) return;
    const earned = t.done >= CFG.tutorialBalls;
    this.tut = null;
    this.tutorialDone = true;
    saveTutorialDone();
    this.hud.set({ focus: null });
    this.timer = CFG.readyDelay * 2;
    this.sound.start();
    this.message(earned ? `That is the drill. ${CFG.balls} balls. Go!` : 'No worries. Here we go', COLORS.ink, this.timer);
  }

  afterFeedback() {
    this.heldBy = null;
    this.heldOutline.visible = false;
    this.ball.visible = false;
    if (this.tut) {
      this.afterTutorialBall();
      return;
    }
    if (this.ballNo >= CFG.balls) {
      this.finishRound();
      return;
    }
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.message('Get ready', COLORS.ink, CFG.readyDelay);
  }

  finishRound() {
    this.state = 'over';
    this.lockout = CFG.restartLockout;
    this.marker.visible = true;
    this.lobbyMarker.visible = true;
    const ratio = this.score / CFG.balls;
    const rating =
      ratio >= 0.95 ? 'Legendary hands!' : ratio >= 0.8 ? 'Safe hands!' : ratio >= 0.5 ? 'Good catching' : 'Keep practising';
    const record = this.score > this.best;
    if (record) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.hud.set({ message: '' });
    const lines = [
      { text: `Final score  ${this.score} / ${CFG.balls}`, color: COLORS.good },
      { text: record ? `${rating}  New best!` : rating, color: COLORS.ink },
    ];
    if (this.focusCount) {
      const pct = Math.round((this.focusSum / this.focusCount) * 100);
      const how = this.focus.simulated ? 'emulated eyes' : this.focus.realEyes ? 'eye tracking' : 'head direction (no eye tracking)';
      lines.push({ text: `Eyes on the ball  ${pct}%  (${how})` });
    }
    lines.push({ text: `Best streak ${this.bestStreak}   |   Best ${this.best}` });
    this.hud.showCard(
      'Round over',
      lines,
      'Touch the green ball to play again',
    );
    this.sound.over();
  }

  message(text, color, duration) {
    this.messageTimer = duration;
    this.hud.set({ message: text, color });
  }

  // ---------- helpers ----------
  // Reads both hands for this frame: from the mouse hand on a PC, otherwise from the tracked hands'
  // joints (real data), falling back to a bare grip position for controllers or lost joints.
  readPalms(dt = 1 / 72) {
    const inSession = !!this.world.session;
    (inSession ? this.player.head : this.world.camera).getWorldPosition(this.head);
    (inSession ? this.player.head : this.world.camera).getWorldQuaternion(this.headQ);

    this.desktop.update(this.player);
    if (this.desktop.active) {
      const mode = this.desktop.handMode;
      const both = mode === 'both';
      for (const side of ['left', 'right']) {
        const h = this.hands[side];
        const used = both || mode === side || (mode !== 'left' && side === 'right');
        if (!used) {
          invalidateHand(h);
          continue;
        }
        this.tmp.copy(this.desktop.position);
        if (both) this.tmp.x += side === 'left' ? -0.06 : 0.06;
        setHandFromPoint(h, this.tmp);
      }
    } else {
      const J = this.J;
      for (const side of ['left', 'right']) {
        const h = this.hands[side];
        const space = this.player.gripSpaces[side];
        h.valid = false;
        if (!space.visible) {
          invalidateHand(h);
          continue;
        }
        const hand = trackedHands[side];
        const j = hand && hand.joints;
        let ok = false;
        if (this.palmFromJoints && j && j.wrist && j['middle-finger-phalanx-proximal'] && j['index-finger-metacarpal'] && j['pinky-finger-metacarpal']) {
          const opt = (name, out) => {
            if (!j[name]) return null;
            j[name].getWorldPosition(out);
            return out;
          };
          const full = {
            wrist: opt('wrist', J.wrist),
            middleProx: opt('middle-finger-phalanx-proximal', J.middleProx),
            indexMeta: opt('index-finger-metacarpal', J.indexMeta),
            pinkyMeta: opt('pinky-finger-metacarpal', J.pinkyMeta),
            indexProx: opt('index-finger-phalanx-proximal', J.indexProx),
            pinkyProx: opt('pinky-finger-phalanx-proximal', J.pinkyProx),
            thumbProx: opt('thumb-phalanx-proximal', J.thumbProx),
            middleTip: opt('middle-finger-tip', J.middleTip),
            indexTip: opt('index-finger-tip', J.indexTip),
            pinkyTip: opt('pinky-finger-tip', J.pinkyTip),
            thumbTip: opt('thumb-tip', J.thumbTip),
          };
          ok = setHandFromJoints(h, full);
        }
        if (!ok) {
          space.getWorldPosition(this.tmp);
          setHandFromPoint(h, this.tmp);
        }
      }
    }
    // Shoulders (for judging a stretching catch): below and to each side of the head.
    this.tmp.set(1, 0, 0).applyQuaternion(this.headQ);
    this.tmp.y = 0;
    if (this.tmp.lengthSq() < 1e-6) this.tmp.set(1, 0, 0);
    this.tmp.normalize();
    this.shoulders.axis.copy(this.tmp);
    this.shoulders.right.copy(this.head).addScaledVector(this.tmp, 0.18);
    this.shoulders.left.copy(this.head).addScaledVector(this.tmp, -0.18);
    this.shoulders.right.y -= 0.22;
    this.shoulders.left.y -= 0.22;

    for (const side of ['left', 'right']) {
      const h = this.hands[side];
      this.palmOk[side] = h.valid;
      this.palmNormalOk[side] = h.valid && h.hasNormal;
      updateHandMotion(h, dt);
    }
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 0.15);
    // Take the headset off (or open the system menu) and the game waits.
    this.paused = this.world.visibilityState.peek() === VisibilityState.VisibleBlurred;
    if (this.paused) return;
    this.updateCrouch(dt);
    this.readPalms(dt);
    const inHeadset = !!this.world.session;
    this.focus.sample(this.player, this.world.camera, inHeadset, dt);
    if (this.state === 'swinging' || this.state === 'flying') {
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
    this.fx.update(dt);
    if (this.lockout > 0) this.lockout -= dt;

    this.coach.update(dt);

    switch (this.state) {
      case 'idle':
      case 'over':
        this.updateRestart(dt);
        break;
      case 'ready':
        if (this.tut && this.tut.stage === 'raise') {
          this.updateRaise(dt);
          break;
        }
        this.timer -= dt;
        if (this.timer <= 0) this.beginThrow();
        break;
      case 'swinging':
        this.ball.position.copy(this.coach.ballPos);
        if (this.coach.hasStruck) this.launchBall();
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

    this.updateAimRing();

    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && this.state !== 'over') this.hud.set({ message: '' });
    }
    this.marker.rotation.y += dt;

    if (this.diagnostics) {
      this.diagnostics.update({
        gameState: this.state,
        hands: {
          left: {
            tracked: this.palmOk.left,
            palm: this.palm.left,
            fingers: this.hands.left.tips.middle,
            normal: this.palmNormal.left,
          },
          right: {
            tracked: this.palmOk.right,
            palm: this.palm.right,
            fingers: this.hands.right.tips.middle,
            normal: this.palmNormal.right,
          },
        },
        gaze: {
          mode: this.focus.mode,
          source: this.focus.source,
          movement: this.focus.movement,
          valid: this.focus.valid,
          focus: this.focus.focusFraction,
          watching: this.focus.inCone,
          origin: this.world.camera.position,
          dir: this.focus.gazeDir || this.world.camera.getWorldDirection(this.gazeDirTmp),
        },
        ball: {
          trajectory: (this.diagnostics && this.diagnostics.enabled) ? this.sampleTrajectory() : null,
        },
      });
    }
  }

  // Over the last stretch of the flight, a pulsing ring marks where the ball will arrive.
  updateAimRing() {
    this.aimRing.material.opacity = this.tut ? 0.85 : 0.4;
    // Practice, waiting for a hand: the ring marks the spot to raise it to.
    if (this.tut && this.state === 'ready' && this.tut.stage === 'raise') {
      this.aimRing.position.copy(this.spot);
      this.aimRing.visible = true;
      this.aimRing.scale.setScalar(1 + 0.1 * Math.sin(this.tut.t * 5));
      return;
    }
    // Practice balls show the ring for the whole flight; the real round only near the end.
    const show = !!(this.tut || CFG.aimHint) && this.state === 'flying' && (!!this.tut || this.ball.position.z > CFG.aimHintFromZ);
    this.aimRing.visible = show;
    if (show) this.aimRing.scale.setScalar(1 + 0.12 * Math.sin(this.life * 14));
  }

  // A pinch (or a click in the emulator) anywhere also starts the round, so the green ball does not
  // have to be reached by hand.
  watchPinch() {
    const session = this.world.session;
    if (!session || session === this._pinchSession) return;
    this._pinchSession = session;
    session.addEventListener('selectstart', () => {
      if ((this.state === 'idle' || this.state === 'over') && this.lockout <= 0) this.startRound();
    });
  }

  updateRestart() {
    this.watchPinch();
    if (this.lockout > 0) return;
    for (const side of ['left', 'right']) {
      if (this.palmOk[side]) {
        if (this.palm[side].distanceTo(this.marker.position) < RESTART_RADIUS) {
          this.startRound();
          return;
        }
        if (this.palm[side].distanceTo(this.lobbyMarker.position) < RESTART_RADIUS) {
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
    }
  }

  updateFlight(dt) {
    // Exact flight (not stepped): the swing and gravity bend it, and it arrives precisely where it
    // was aimed (where the ring is), whatever the frame rate.
    this.prev.copy(this.ball.position);
    const t = this.life + dt;
    this.ball.position.copy(this.launchFrom).addScaledVector(this.launchVel, t).addScaledVector(this.accel, 0.5 * t * t);
    this.vel.copy(this.launchVel).addScaledVector(this.accel, t);
    this.ball.rotation.y += 18 * dt; // spin about the seam
    // Real size in the coach's hand, growing to the game's catchable size as it leaves the bat.
    this.ball.scale.setScalar(Math.min(1, this.coach.ballScale + this.life * 2.5));
    const ballR = BALL_RADIUS * this.ball.scale.x;
    setGlowForDistance(this.ball, CFG.arriveZ - this.ball.position.z);
    this.focus.track(this.ball.position, dt, CFG.arriveZ - this.ball.position.z, ballR);
    this.life += dt;
    this.fx.trailPoint(this.ball.position, dt);

    // Contact: the ball is swept through each hand's palm, fingers, thumb and forearm (catching.js),
    // so a fast ball cannot pass through at any frame rate, and what it touches first decides the
    // outcome: a catch, or a deflection off the back of the hand, the wrist, the edge or a fist.
    const d = evaluateCatch(this.hands.left, this.hands.right, this.prev, this.ball.position, this.vel, ballR, this.shoulders, this.decision);
    this.nearest = Math.min(this.nearest, Math.max(0, d.gap));
    commitHand(this.hands.left);
    commitHand(this.hands.right);
    if (d.outcome === 'catch') {
      this.ball.position.copy(d.point);
      this.heldAt.copy(d.point);
      this.caught(d.side, d);
      return;
    }
    if (d.outcome === 'deflect') {
      this.ball.position.copy(d.point);
      this.deflect(d);
      return;
    }
    if (this.ball.position.z >= CFG.missZ || this.life > CFG.maxLife) this.missed();
  }

  // Off a part of the hand that cannot catch: the ball bounces away and loses most of its pace.
  deflect(d) {
    deflectVelocity(this.vel, d.handVel, d.normal, this.vel);
    this.missed(d.reason);
  }

  updateFeedback(dt) {
    if (this.heldBy) {
      // Where the ball rests: in the palm (on its skin, a little towards the fingers), or cradled
      // between both palms for a two-handed catch. It eases there from the point of contact.
      const side = this.heldBy;
      const heldScale = 0.55;
      const target = this.restAt;
      if (this.twoHanded && this.palmOk.left && this.palmOk.right) {
        target.copy(this.palm.left).add(this.palm.right).multiplyScalar(0.5);
      } else if (this.palmNormalOk[side]) {
        // In the cup of the hand: on the palm, towards the fingers and the thumb, so it shows past
        // the edge of the hand from the player's eyes.
        target.copy(this.palm[side])
          .addScaledVector(this.palmNormal[side], BALL_RADIUS * heldScale + 0.004)
          .addScaledVector(this.palmFingers[side], 0.022)
          .addScaledVector(this.palmThumb[side], 0.03);
      } else {
        target.copy(this.palm[side]);
        target.z -= 0.035;
        target.y += 0.02;
        target.x += side === 'left' ? 0.02 : -0.02;
      }
      this.heldOutline.visible = true;
      // A fast ball takes a moment longer to be absorbed than a gentle one.
      const info = this.catchInfo;
      const pace = info ? Math.min(1, info.relSpeed / 22) : 0;
      // ...and a ball that first touched a fingertip has further to travel into the palm, so it takes longer: never a snap.
      const dur = Math.max(CFG.settleTime * (0.8 + 0.6 * pace), this.settleFrom.distanceTo(target) / 1.4);
      this.settle = Math.min(1, this.settle + dt / dur);
      const k = this.settle * this.settle * (3 - 2 * this.settle);
      this.ball.position.lerpVectors(this.settleFrom, target, k);
      this.ball.scale.setScalar(this.settleScale + (heldScale - this.settleScale) * k);
    } else if (this.deflected && this.ball.visible) {
      this.stepLooseBall(dt);
      if (this.timer < 0.3) this.ball.visible = false;
    } else if (this.freeFlight && this.ball.visible) {
      // Missed: the ball carries on past the player along its own path until it lands.
      this.life += dt;
      const t = this.life;
      this.ball.position.copy(this.launchFrom).addScaledVector(this.launchVel, t).addScaledVector(this.accel, 0.5 * t * t);
      this.ball.rotation.y += 18 * dt;
      if (this.ball.position.y < 0.05 || this.ball.position.z > 8 || this.timer < 0.25) this.ball.visible = false;
    }
    this.timer -= dt;
    if (this.timer <= 0) this.afterFeedback();
  }

  // A deflected ball: gravity, and a couple of bounces on the ground.
  stepLooseBall(dt) {
    const r = BALL_RADIUS * this.ball.scale.x;
    this.vel.y -= CFG.gravity * dt;
    this.ball.position.addScaledVector(this.vel, dt);
    if (this.ball.position.y < r && this.vel.y < 0) {
      this.ball.position.y = r;
      this.vel.y *= -0.45;
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
    }
    this.ball.rotation.y += 10 * dt;
  }

  // A mouse click (PC only) gives a ball that is almost in the hand the benefit of the doubt. Never in
  // a headset: a pinch there must not count as a catch. The ball still has to be on the palm side
  // of a hand with its palm open to it, not the back of the hand, the wrist or a fist.
  tryClickCatch() {
    if (this.state !== 'flying' || this.world.session) return false;
    const ballR = BALL_RADIUS * this.ball.scale.x;
    let bestSide = null;
    let bestS = Infinity;
    for (const side of ['left', 'right']) {
      const h = this.hands[side];
      if (!h.valid) continue;
      const c = evaluateHand(h, this.ball.position, this.ball.position, this.vel, ballR, CFG.handMargin * 0.6, this.clickContact);
      if (c.hit && c.result === 'catch' && c.dist < bestS) {
        bestS = c.dist;
        bestSide = side;
      }
    }
    if (!bestSide) return false;
    this.heldAt.copy(this.ball.position);
    this.caught(bestSide, null);
    return true;
  }

  updateCrouch(dt) {
    const rig = this.player || this.world?.player;
    if (rig && this.crouchBaseY === 0 && rig.position) {
      this.crouchBaseY = rig.position.y || 0;
    }

    if (this.state === 'swinging' || this.state === 'flying') {
      let lookPitchCrouch = 0;
      // Bend when the HEAD tips down towards the turf. The eyes alone never move the body, so
      // flicks of the eyes (or tracker noise) cannot shake the whole view.
      const pitchDir = this.focus.mode === 'none' ? this.focus.dir : this.focus.headDir;
      if (pitchDir.y < -0.10) {
        lookPitchCrouch = Math.min(0, Math.max(-0.38, (pitchDir.y + 0.10) * 0.95));
      }

      if (this.isLowCatch) {
        // Low dipper target: knee or shin height. Fielder crouches smoothly to reach turf level
        const deliveryCrouch = Math.min(0, Math.max(-0.38, (this.aim.y - 0.75) * 1.0));
        this.targetCrouch = Math.min(deliveryCrouch, lookPitchCrouch);
      } else if (this.isHighCatch) {
        // High skier: reach high upright
        this.targetCrouch = 0;
      } else {
        // Chest or waist catch: allow natural slight bend if looking down
        this.targetCrouch = lookPitchCrouch;
      }
    } else {
      // Feedback, ready, idle, over: smoothly return player to neutral stance
      this.targetCrouch = 0;
    }

    const crouchSpeed = (this.state === 'flying' || this.state === 'swinging') ? 5.0 : 4.0;
    this.crouchOffset = lerp(this.crouchOffset, this.targetCrouch, Math.min(1, dt * crouchSpeed));
    if (Math.abs(this.crouchOffset - this.targetCrouch) < 0.005) {
      this.crouchOffset = this.targetCrouch;
    }

    if (rig && rig.position) {
      rig.position.y = this.crouchBaseY + this.crouchOffset;
    }
  }

  sampleTrajectory() {
    if (this.state !== 'flying') return null;
    const steps = 30;
    const tMax = Math.max(0.1, this.flightDuration || 1.2);
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * tMax;
      this.trajectoryCache[i]
        .copy(this.launchFrom)
        .addScaledVector(this.launchVel, t)
        .addScaledVector(this.accel, 0.5 * t * t);
    }
    return this.trajectoryCache;
  }
}
