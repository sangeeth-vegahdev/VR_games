import {
  createSystem,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { BALL_RADIUS, makeBall, setGlowForDistance } from './ball.js';
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

    // A soft ring at the spot the ball is heading for, shown over the last stretch of its flight.
    this.aimRing = new Mesh(
      new RingGeometry(0.15, 0.19, 40),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: DoubleSide, depthWrite: false }),
    );
    this.aimRing.renderOrder = 5;
    this.aimRing.visible = false;
    this.world.createTransformEntity(this.aimRing);

    // Solid hands shipped with the game, instead of the SDK's outline hands from a CDN.
    this.skinHands = useSkinHands(this.input && this.input.xr);

    this.desktop = new DesktopHand(this.world);
    this.cleanupFuncs.push(() => this.desktop.dispose());

    // Each hand's palm: centre, the way it faces (when known), and where it was last frame (so the
    // catch test can follow a moving hand). Read from the drawn hand's joints when available.
    this.palm = { left: new Vector3(), right: new Vector3() };
    this.palmOk = { left: false, right: false };
    this.palmNormal = { left: new Vector3(0, 0, -1), right: new Vector3(0, 0, -1) };
    this.palmNormalOk = { left: false, right: false };
    this.palmFingers = { left: new Vector3(0, 1, 0), right: new Vector3(0, 1, 0) };
    this.palmThumb = { left: new Vector3(1, 0, 0), right: new Vector3(-1, 0, 0) }; // towards the thumb
    this.prevPalm = { left: new Vector3(), right: new Vector3() };
    this.prevPalmOk = { left: false, right: false };
    this.palmFromJoints = true; // the headless test turns this off to place hands by their grip pose
    this.rel0 = new Vector3();
    this.rel1 = new Vector3();
    this.contact = new Vector3();
    this.settleFrom = new Vector3();
    this.heldAt = new Vector3();
    this.restAt = new Vector3(); // where a caught ball rests in the hand
    this.j = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
    this.settle = 0;
    this.settleScale = 1;
    this.nearest = Infinity;
    this.deflected = false;
    this.twoHanded = false;
    this.lastResult = null;
    this.prev = new Vector3();
    this.vel = new Vector3();
    this.launchFrom = new Vector3(); // the flight is exact: from + launchVel t + accel t^2 / 2
    this.launchVel = new Vector3();
    this.accel = new Vector3();
    this.tmp = new Vector3();
    this.seg = new Vector3();
    this.aim = new Vector3();
    this.release = new Vector3();
    this.head = new Vector3();

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
      if (e.code === 'Space' || e.code === 'Enter') this.tryStart();
    };
    const onPointer = () => this.sound.unlock();
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
      get eyeTracker() { return this.sys.eyeTracker; },
      get eyeTrackerPos() { return this.sys.eyeTracker.group.position; },
      get eyeTrackerVisible() { return this.sys.eyeTracker.visible; },
      get lastFocus() { return this.sys.lastFocus; },
      get contactGap() { return this.sys.contactGap; },
      get nearest() { return this.sys.nearest; },
      get lastResult() { return this.sys.lastResult; },
      get twoHanded() { return this.sys.twoHanded; },
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
    this.hud.showCard('Cricket Catch', lines, inHeadset ? 'Touch the green ball to start' : 'Touch the green ball, or press Space');
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
      if (this.palmOk[side] && this.palm[side].distanceTo(this.spot) < 0.22) near = true;
    }
    t.hold = near ? t.hold + dt : Math.max(0, t.hold - dt);
    if (t.hold >= 0.5) {
      t.stage = 'ball';
      this.timer = 0.7;
      this.sound.start();
      this.message('Good. Here it comes', COLORS.good, 1.2);
      return;
    }
    const inHeadset = !!this.world.session;
    let text = inHeadset ? 'Raise a hand into the ring' : 'Move the mouse into the ring';
    if (inHeadset && t.t > 8) text = 'Palm open, facing the coach';
    this.message(text, COLORS.ink, 0.5);
  }

  beginThrow() {
    const tut = this.tut;
    if (!tut) this.ballNo++;
    const roll = Math.random();
    this.isHighCatch = !tut && this.ballNo > 3 && roll < 0.20;
    this.isLowCatch = !tut && this.ballNo > 2 && !this.isHighCatch && roll < 0.42;

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
    if (this.isLowCatch) {
      // Low dipping catch: relative to player's head (waist/thigh level) so it stays inside
      // Quest tracking cameras' FOV. Clamped to at least 0.72m for seated players.
      const lowBase = Math.max(0.72, this.head.y - 0.65);
      targetY = lowBase + (Math.random() * 2 - 1) * 0.06;
    } else {
      targetY = this.head.y - CFG.chestBelowHead + (tut ? 0 : (Math.random() * 2 - 1) * CFG.targetSpreadY);
    }

    this.aim.set(
      tut ? 0 : (Math.random() * 2 - 1) * CFG.targetSpreadX,
      targetY,
      CFG.arriveZ,
    );

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
    if (tut) this.message(TUT_THROW[Math.min(tut.done, 2)], COLORS.ink, 4);
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
    this.prevPalmOk.left = false;
    this.prevPalmOk.right = false;
    this.sound.crack();
    this.state = 'flying';
  }

  // The ball has touched `side`'s hand, at its current position. It settles into the palm from there.
  caught(side) {
    this.diagnostics?.recordEvent('caught', { side, high: this.isHighCatch, speedKmh: this.kmh });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = side;
    this.lastResult = 'caught';
    this.settle = 0;
    this.settleFrom.copy(this.ball.position);
    this.settleScale = this.ball.scale.x;
    const other = side === 'left' ? 'right' : 'left';
    this.twoHanded = this.palmOk[other] && this.palm[other].distanceTo(this.ball.position) <= CFG.twoHandGap;
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
    let catchMsg = 'CAUGHT!';
    if (this.isHighCatch) {
      catchMsg = 'HIGH CATCH!';
    } else if (this.isLowCatch) {
      catchMsg = 'LOW CATCH!';
    } else if (this.streak >= 3) {
      catchMsg = `CAUGHT!  ${this.streak} in a row`;
    } else if (this.twoHanded) {
      catchMsg = 'CAUGHT!  Safe hands';
    }
    if (this.tut) {
      catchMsg = TUT_CAUGHT[Math.min(this.tut.done, 2)];
      this.tut.done++;
      this.tut.fails = 0;
    }
    this.message(catchMsg, COLORS.good, CFG.feedbackDelay);
  }

  // why: 'missed' (it went past) or 'back' (it glanced off the back of a hand).
  missed(why = 'missed') {
    this.diagnostics?.recordEvent(why === 'back' ? 'deflection_back_of_hand' : 'missed', { why });
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.heldBy = null;
    this.lastResult = why;
    this.ball.visible = why === 'back'; // a deflected ball is seen flying off
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
    else if (this.lastFocus !== null && this.focus.lostAt !== null) msg = `Eyes left it at ${Math.max(1, Math.round(this.focus.lostAt))} m`;
    else if (this.nearest < CFG.nearMiss) msg = `Just missed: ${Math.max(1, Math.round(this.nearest * 100))} cm`;
    if (this.tut) {
      this.tut.fails++;
      msg = why === 'back' ? 'Show your palm to the ball' : this.tut.fails > 1 ? 'Palm open, reach for the ring' : 'Not quite. Reach for the ring';
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
      const how = this.focus.simulated ? 'emulated eyes' : this.focus.mode === 'eyes' ? 'eye tracking' : 'head direction';
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
  readPalms() {
    this.desktop.update(this.player);
    if (this.desktop.active) {
      // No headset: the mouse is the right hand, held up with its palm to the coach.
      this.palm.right.copy(this.desktop.position);
      this.palmOk.right = true;
      this.palmOk.left = false;
      this.palmNormal.right.set(0, 0, -1);
      this.palmNormalOk.right = true;
      this.palmFingers.right.set(0, 1, 0);
      this.palmThumb.right.set(-1, 0, 0);
      return;
    }
    for (const side of ['left', 'right']) {
      const space = this.player.gripSpaces[side];
      this.palmOk[side] = space.visible;
      this.palmNormalOk[side] = false;
      const hand = trackedHands[side];
      const j = hand && hand.joints;
      if (
        this.palmFromJoints && space.visible && j && hand.model.visible &&
        j.wrist && j['middle-finger-phalanx-proximal'] && j['index-finger-metacarpal'] && j['pinky-finger-metacarpal']
      ) {
        // The palm as it is drawn: between the wrist and the knuckles, on the skin of the palm.
        const wrist = j.wrist.getWorldPosition(this.j[0]);
        const knuckle = j['middle-finger-phalanx-proximal'].getWorldPosition(this.j[1]);
        const fingers = this.palmFingers[side].subVectors(knuckle, wrist).normalize();
        const across = j['index-finger-metacarpal'].getWorldPosition(this.j[2]).sub(j['pinky-finger-metacarpal'].getWorldPosition(this.j[3]));
        across.addScaledVector(fingers, -across.dot(fingers)).normalize();
        this.palmThumb[side].copy(across); // index side: the thumb is that way
        // For a right hand, across x fingers points out of the palm; a left hand is its mirror image.
        const normal = this.palmNormal[side].crossVectors(across, fingers).normalize();
        if (side === 'left') normal.negate();
        this.palm[side].copy(wrist).lerp(knuckle, 0.55).addScaledVector(normal, 0.012);
        this.palmNormalOk[side] = true;
      } else {
        space.getWorldPosition(this.palm[side]);
      }
    }
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 0.05);
    // Take the headset off (or open the system menu) and the game waits.
    this.paused = this.world.visibilityState.peek() === VisibilityState.VisibleBlurred;
    if (this.paused) return;
    this.readPalms();
    const inHeadset = !!this.world.session;
    this.focus.sample(this.player, this.world.camera, inHeadset);
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
          left: { tracked: this.palmOk.left, palm: this.palm.left, normal: this.palmNormal.left },
          right: { tracked: this.palmOk.right, palm: this.palm.right, normal: this.palmNormal.right },
        },
        gaze: {
          mode: this.focus.mode,
          focus: this.focus.focus,
          watching: this.focus.watching,
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

  updateRestart() {
    if (this.lockout > 0) return;
    for (const side of ['left', 'right']) {
        if (this.palmOk[side]) {
          if (this.palm[side].distanceTo(this.marker.position) < RESTART_RADIUS) {
            this.startRound();
            return;
          }
          if (this.palm[side].distanceTo(this.lobbyMarker.position) < RESTART_RADIUS) {
            window.location.href = `${window.location.protocol}//${window.location.hostname}:8080`;
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
      setGlowForDistance(this.ball, CFG.arriveZ - this.ball.position.z);
      this.focus.track(this.ball.position, dt, CFG.arriveZ - this.ball.position.z);
      this.life += dt;
      this.fx.trailPoint(this.ball.position, dt);

      // Contact: the ball touches a hand when its centre comes within (its radius + the hand's margin) of
      // the palm. The test is swept between frames, relative to the hand, so neither a fast ball nor a
      // fast hand can pass through the other between two frames.
      // Cupped hands boost: fielders naturally cup both palms together to receive swinging or dipping balls.
      const isCupped = this.palmOk.left && this.palmOk.right && this.palm.left.distanceTo(this.palm.right) <= CFG.twoHandGap;
      const reach = BALL_RADIUS * this.ball.scale.x + CFG.handMargin + (isCupped ? 0.045 : 0);
      let hit = null;
      let hitD = Infinity;
      let hitBack = false;
      for (const side of ['left', 'right']) {
        if (!this.palmOk[side]) continue;
        const p1 = this.palm[side];
        // Where the hand was last frame (unless tracking jumped, or this is the first frame).
        const p0 = this.prevPalmOk[side] && this.prevPalm[side].distanceTo(p1) < 0.5 ? this.prevPalm[side] : p1;
        const r0 = this.rel0.subVectors(this.prev, p0);
        const r1 = this.rel1.subVectors(this.ball.position, p1);
        const seg = this.seg.subVectors(r1, r0);
        const lenSq = seg.lengthSq();
        const t = lenSq > 0 ? Math.min(1, Math.max(0, -r0.dot(seg) / lenSq)) : 0;
        const closest = this.contact.copy(r0).addScaledVector(seg, t);
        const d = closest.length();
        this.nearest = Math.min(this.nearest, Math.max(0, d - reach));
        if (d <= reach && d < hitD) {
          hit = side;
          hitD = d;
          // Which side of the hand did it come from? Behind the palm means the back of the hand. (If the
          // hand was already on the ball last frame, the way the ball is travelling tells.)
          const from = r0.lengthSq() > 1e-6 ? this.tmp.copy(r0) : this.tmp.copy(this.vel).negate();
          hitBack = this.palmNormalOk[side] && this.palmNormal[side].dot(from.normalize()) < CFG.backOfHand;
          this.heldAt.copy(p1).add(closest); // the point of contact, in world space
        }
      }
      for (const side of ['left', 'right']) {
        this.prevPalm[side].copy(this.palm[side]);
        this.prevPalmOk[side] = this.palmOk[side];
      }
      if (hit) {
        this.ball.position.copy(this.heldAt);
        if (hitBack) this.deflect(hit);
        else this.caught(hit);
        return;
      }
      if (this.ball.position.z >= CFG.missZ || this.life > CFG.maxLife) this.missed();
    }

    // Off the back of the hand: the ball bounces away from it, losing most of its pace.
    deflect(side) {
      const n = this.palmNormal[side];
      const vn = this.vel.dot(n);
      this.vel.addScaledVector(n, -2 * vn).multiplyScalar(0.35);
      this.vel.addScaledVector(n, -0.8);
      this.deflected = true;
      this.missed('back');
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
        this.settle = Math.min(1, this.settle + dt / CFG.settleTime);
        const k = this.settle * this.settle * (3 - 2 * this.settle);
        this.ball.position.lerpVectors(this.settleFrom, target, k);
        this.ball.scale.setScalar(this.settleScale + (heldScale - this.settleScale) * k);
      } else if (this.deflected && this.ball.visible) {
        this.vel.y -= CFG.gravity * dt;
        this.ball.position.addScaledVector(this.vel, dt);
        if (this.ball.position.y < 0.05 || this.timer < 0.3) this.ball.visible = false;
      }
      this.timer -= dt;
      if (this.timer <= 0) this.afterFeedback();
    }
  }
