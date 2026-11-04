import {
  CanvasTexture,
  createSystem,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { BALL_RADIUS, makeBall, setFocusGlow, setGlowForDistance } from './ball.js';
import { buildBallpark } from './ballpark.js';
import { CFG, DEFAULT_GLOVE, PITCHES, START_POS, START_RADIUS, SWAP_POS, SWAP_RADIUS } from './config.js';
import { DesktopPointer } from './desktop-pointer.js';
import { Effects, Sound } from './fx.js';
import { FocusTracker } from './gaze.js';
import { useSkinHands } from './hands.js';
import { COLORS, Hud } from './hud.js';
import { Pitcher } from './pitcher.js';
import { bareHand, PlayerGlove } from './player-glove.js';

const lerp = (a, b, t) => a + (b - a) * t;
const MPH = 2.23694;

// Best score is remembered per round length. Storage can be blocked, so it is always optional.
const bestKey = () => `glove-up-best-${CFG.pitches}`;
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

// Round flow: idle -> ready -> windup -> flying -> feedback -> (ready ... | over) -> ready ...
export class GameSystem extends createSystem({}) {
  init() {
    this.sound = new Sound();
    this.fx = new Effects(this.world);
    this.park = buildBallpark(this.world);
    this.pitcher = new Pitcher(this.world);
    this.hud = new Hud(this.world, CFG.pitches);
    this.focus = new FocusTracker();

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
    this.swapOrb = new Group();
    const orb = new Mesh(new SphereGeometry(SWAP_RADIUS * 0.5, 20, 14), new MeshStandardMaterial({ color: 0xf2c230, emissive: 0x7a5a00, emissiveIntensity: 1 }));
    this.swapLabel = label('', 0.36, 0.07);
    this.swapLabel.position.set(0, -0.11, 0);
    this.swapOrb.add(orb, this.swapLabel);
    this.swapOrb.position.set(SWAP_POS.x, SWAP_POS.y, SWAP_POS.z);
    this.world.createTransformEntity(this.swapOrb);

    // Strike-zone frame where the pitch will cross, for the first pitches of a round.
    this.zone = new Group();
    const zoneMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide });
    const ZW = 0.36;
    const ZH = 0.32;
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
    this.rel0 = new Vector3();
    this.rel1 = new Vector3();
    this.closest = new Vector3();
    this.settleFrom = new Vector3();
    this.restAt = new Vector3();
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
    this.best = loadBest();
    this.paused = false;

    this.showTitle();

    const onKey = (e) => {
      this.sound.unlock();
      if (e.code === 'Space' || e.code === 'Enter') this.tryStart();
      if (e.code === 'KeyG') this.trySwap(true);
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
        if (this.state === 'idle') this.showTitle();
      }),
    );

    // Read-only view for the headless test.
    window.__game = {
      get state() { return this.sys.state; },
      get pitchNo() { return this.sys.pitchNo; },
      get catches() { return this.sys.catches; },
      get misses() { return this.sys.misses; },
      get mph() { return this.sys.mph; },
      get pitchName() { return this.sys.pitchType.name; },
      get aim() { return this.sys.aim; },
      get ballPos() { return this.sys.ball.position; },
      get gloveSide() { return this.sys.glove.side; },
      get pocket() { return this.sys.glove.pocket; },
      get nearest() { return this.sys.nearest; },
      get focusMode() { return this.sys.focus.mode; },
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

  showTitle() {
    const inHeadset = this.inHeadset();
    const lines = [{ text: `Catch ${CFG.pitches} pitches with your mitt`, color: COLORS.ink }];
    lines.push({ text: 'Keep your eyes on the ball, all the way in' });
    if (this.best) lines.push({ text: `Your best: ${this.best} / ${CFG.pitches}`, color: COLORS.good });
    lines.push({ text: inHeadset ? `Mitt on your ${this.glove.side} hand: touch the gold ball to swap` : 'On a PC, move the mouse to catch. G swaps hands' });
    this.hud.showCard('Glove Up', lines, inHeadset ? 'Touch the green ball to start' : 'Touch the green ball, or press Space');
    this.swapLabel.userData.draw(`Mitt: ${this.glove.side} hand`);
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
    this.swapOrb.visible = false;
    this.fx.clearTrail();
    this.hud.hideCard();
    this.hud.set({ catches: 0, misses: 0, pitchNo: 0, mph: 0, pitchName: '', focus: null });
    this.sound.start();
    if (!this.pitcher.isSet && !this.pitcher.move) this.pitcher.recover();
    this.state = 'ready';
    this.timer = CFG.readyDelay;
    this.message('Play ball!', COLORS.ink, CFG.readyDelay);
  }

  beginPitch() {
    this.pitchNo++;
    const ramp = Math.min(1, (this.pitchNo - 1) / CFG.rampPitches);
    // Which pitch: fastballs most often, the others as they unlock.
    const open = PITCHES.filter((p) => p.from <= this.pitchNo);
    this.pitchType = open.length > 1 && Math.random() > 0.4 ? open[1 + Math.floor(Math.random() * (open.length - 1))] : open[0];
    let speed = lerp(CFG.startSpeed, CFG.maxSpeed, ramp);
    if (ramp >= 1) speed += (Math.random() * 2 - 1) * CFG.speedJitter;
    this.speed = speed * this.pitchType.speed;
    this.mph = Math.round(this.speed * MPH);
    // Movement grows over the round: gentle early on, full later.
    const k = 0.45 + 0.55 * ramp;
    this.accel.set(this.pitchType.break[0] * k, this.pitchType.break[1] * k - CFG.gravity, 0);

    // Where it will cross: around the catcher's chest, measured from the headset (so it suits a
    // seated player as well as a standing one).
    (this.inHeadset() ? this.player.head : this.world.camera).getWorldPosition(this.head);
    this.aim.set(
      (Math.random() * 2 - 1) * CFG.zoneHalfWidth,
      Math.max(0.45, this.head.y - CFG.targetBelowHead + (Math.random() * 2 - 1) * CFG.zoneHalfHeight),
      CFG.arriveZ,
    );

    this.pitcher.pitch();
    this.ball.scale.setScalar(this.pitcher.ballScale);
    this.ball.position.copy(this.pitcher.ballPos);
    setGlowForDistance(this.ball, 0);
    setFocusGlow(this.ball, false);
    this.ball.visible = true;
    this.fx.clearTrail();
    this.focus.resetPitch();
    this.state = 'windup';
    this.hud.set({ pitchNo: this.pitchNo, pitchName: '', message: '' });
  }

  // Release: the ball leaves his fingers. The path is solved so that gravity and the pitch's
  // movement curve it INTO the target, so it visibly breaks but stays catchable.
  launch() {
    const from = this.prev.copy(this.pitcher.ballPos);
    this.pitcher.releaseBall();
    const T = from.distanceTo(this.aim) / this.speed;
    this.vel.subVectors(this.aim, from).divideScalar(T).addScaledVector(this.accel, -0.5 * T);
    this.launchFrom.copy(from);
    this.launchVel.copy(this.vel);
    this.ball.position.copy(from);
    this.ball.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.life = 0;
    this.zone.position.copy(this.aim);
    this.nearest = Infinity;
    this.prevBareOk = false;
    this.sound.whoosh();
    this.state = 'flying';
    this.hud.set({ pitchName: this.pitchType.name, mph: this.mph });
  }

  // The ball has met the pocket, at its current position: it settles in from there, and the
  // mitt is knocked back and snaps shut round it.
  caught() {
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.held = true;
    this.settle = 0;
    this.settleFrom.copy(this.ball.position);
    const speed = this.vel.length();
    if (speed > 0) this.glove.impact(this.tmp.copy(this.vel).divideScalar(speed), speed);
    this.catches++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.zone.visible = false;
    this.fx.burst(this.ball.position); // at the point of contact
    this.sound.caught(this.streak);
    this.reaction = 'cheer';
    this.lastResult = 'caught';
    this.endFocus();
    this.hud.set({ catches: this.catches });
    let msg = 'CAUGHT!';
    if (this.streak >= 3) msg = `CAUGHT!  ${this.streak} in a row`;
    else if (this.pitchType.name !== 'Fastball') msg = `${this.pitchType.name} caught!`;
    this.message(msg, COLORS.good, CFG.feedbackDelay);
  }

  missed(why) {
    this.state = 'feedback';
    this.timer = CFG.feedbackDelay;
    this.held = false;
    this.misses++;
    this.streak = 0;
    this.zone.visible = false;
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
    this.message(msg, COLORS.bad, CFG.feedbackDelay);
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
    if (f !== null) {
      this.focusSum += f;
      this.focusCount++;
    }
    this.hud.set({ focus: f });
    setFocusGlow(this.ball, false);
  }

  afterFeedback() {
    this.held = false;
    this.heldOutline.visible = false;
    this.ball.visible = false;
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
    this.swapOrb.visible = this.inHeadset();
    const ratio = this.catches / CFG.pitches;
    const rating =
      ratio >= 0.95 ? 'Gold Glove!' : ratio >= 0.8 ? 'All-Star hands!' : ratio >= 0.5 ? 'Solid catching' : 'Keep working the mitt';
    const record = this.catches > this.best;
    if (record) {
      this.best = this.catches;
      saveBest(this.best);
    }
    this.hud.set({ message: '' });
    const lines = [
      { text: `Caught  ${this.catches} / ${CFG.pitches}`, color: COLORS.good },
      { text: record ? `${rating}  New best!` : rating, color: COLORS.ink },
    ];
    if (this.focusCount) {
      const pct = Math.round((this.focusSum / this.focusCount) * 100);
      const how = this.focus.mode === 'eyes' ? 'eye tracking' : 'head direction';
      lines.push({ text: `Eyes on the ball  ${pct}%  (${how})` });
    }
    lines.push({ text: `Best streak ${this.bestStreak}   |   Best ${this.best}` });
    this.hud.showCard('Round over', lines, 'Touch the green ball to play again');
    this.sound.over();
  }

  message(text, color, duration) {
    this.messageTimer = duration;
    this.hud.set({ message: text, color });
  }

  // ---------- frame ----------
  update(dt) {
    dt = Math.min(dt, 0.05);
    // Take the headset off (or open the system menu) and the game waits.
    this.paused = this.world.visibilityState.peek() === VisibilityState.VisibleBlurred;
    if (this.paused) return;
    const inHeadset = this.inHeadset();
    this.desktop.update();
    this.glove.hold = this.held ? 1 : 0;
    this.glove.update(this.player, this.desktop, inHeadset, dt);
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

    switch (this.state) {
      case 'idle':
      case 'over':
        this.updateMenu();
        break;
      case 'ready':
        this.timer -= dt;
        if (this.timer <= 0 && this.pitcher.isSet && !this.reaction) this.beginPitch();
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
  }

  // Touch the green ball (with either hand or the mitt) to start; the gold orb swaps hands.
  updateMenu() {
    this.swapOrb.visible = this.inHeadset();
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
    }
    if (this.swapOrb.visible) {
      for (const p of points) {
        if (p.distanceTo(this.swapOrb.position) < SWAP_RADIUS) {
          this.trySwap();
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
    this.vel.copy(this.launchVel).addScaledVector(this.accel, t);
    this.ball.rotation.x += 30 * dt; // spinning seams
    // Real size in his hand, growing to the game's catchable size as it leaves.
    this.ball.scale.setScalar(Math.min(1, this.pitcher.ballScale + this.life * 1.5));
    const dist = this.ball.position.distanceTo(this.head.set(0, this.aim.y, 0));
    setGlowForDistance(this.ball, dist);
    this.life += dt;
    this.fx.trailPoint(this.ball.position, dt);
    this.focus.track(this.ball.position, dt, dist);
    setFocusGlow(this.ball, this.focus.watching);
    this.zone.visible = CFG.zoneHint && this.pitchNo <= CFG.zoneHintPitches;

    // Contact with the mitt: swept between frames, relative to the mitt, so neither a fast pitch nor
    // a fast mitt can pass through the other between two frames.
    const g = this.glove;
    if (g.ok) {
      const d = this.sweep(g.prevOk ? g.prevPocket : g.pocket, g.pocket);
      this.nearest = Math.min(this.nearest, Math.max(0, d - CFG.catchRadius));
      if (d <= CFG.catchRadius) {
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
        if (d <= CFG.bareHandRadius) {
          this.ball.position.copy(hand).add(this.closest);
          this.missed('bare');
          return;
        }
      } else {
        this.prevBareOk = false;
      }
    }
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
      this.restAt.copy(this.glove.object.position).addScaledVector(this.glove.normal, -0.012);
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
