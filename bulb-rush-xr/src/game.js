import { createSystem, Group, Hovered, Pressed, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { Board } from './board.js';
import { Bulb, UiButton } from './bulb-components.js';
import { CFG, COLORS, RANKS } from './config.js';
import { Effects } from './fx.js';
import { glowHands, jointPos, updateHands, useSkinHands } from './hands.js';
import { Hud } from './hud.js';
import { Sound } from './sound.js';
import { Stage } from './stage.js';
import { DiagnosticsPanel } from './diagnostics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (n) => n.toLocaleString('en-US');

// ---- remembered between sessions (storage can be blocked, so it is always optional) ----
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : Number(v) || fallback;
  } catch (e) {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {
    /* not saved: fine */
  }
}

function rankFor(life) {
  let name = RANKS[0][1];
  for (const [min, n] of RANKS) if (life >= min) name = n;
  return name;
}

// Round flow:  title -> countdown -> play -> over -> (title | countdown ...)
//              play/countdown -> paused (headset off, system menu, hands out of view) -> countdown -> play
//
// The idea: the city is dark and you are the power. Every bulb you touch sends power into it, windows
// light up with your score, and a lost heart browns it out. Fill the surge meter and clap to light the
// whole wall at once.
export class GameSystem extends createSystem({
  pressedBulbs: { required: [Bulb, Pressed] },
  pressedButtons: { required: [UiButton, Pressed] },
  hoveredBulbs: { required: [Bulb, Hovered] },
  hoveredButtons: { required: [UiButton, Hovered] },
}) {
  init() {
    this.sound = new Sound();
    this.board = new Board(this.world);
    this.glowTex = this.board.glow;
    this.worldRoot = new Group(); // the sky and the city stay still; only the board re-centres on the player
    this.world.createTransformEntity(this.worldRoot);
    this.stage = new Stage(this.board.rig, this.glowTex, this.worldRoot);
    this.fx = new Effects(this.board.rig, this.glowTex);
    this.hud = new Hud(this.board.rig);
    this.skinHands = useSkinHands(this.input && this.input.xr);

    this.sound.unlock(); // builds the audio chain now; it starts sounding on the first gesture
    this.heartsPick = CFG.startHearts || load('bulbrush-hearts', 3);
    if (!CFG.heartOptions.includes(this.heartsPick)) this.heartsPick = 3;
    this.bestFor = (h) => load(`bulbrush-best-${h}`, 0);
    this.bestReaction = load('bulbrush-fastest', 0);
    this.career = load('bulbrush-life', 0); // everything you have ever scored: it keeps some of the city lit
    this.played = load('bulbrush-played', 0);

    // scratch (no allocation in the frame loop)
    this.dwell = new Float32Array(this.board.bulbs.length); // seconds the ray has rested on each bulb
    this.seen = new Uint8Array(this.board.bulbs.length);
    this.bDwell = { start: 0, hearts3: 0, hearts5: 0, exit: 0, surge: 0 };
    this.bSeen = { start: 0, hearts3: 0, hearts5: 0, exit: 0, surge: 0 };
    this.v = new Vector3();
    this.v2 = new Vector3();
    this.tipL = new Vector3(); // fingertip / bulb scratch for watchTouch
    this.tipR = new Vector3();
    this.bpos = new Vector3();
    this.handRays = []; // reused by getHandRays
    this.hovBulb = -1; // last bulb a pointer was on, and when (game clock)
    this.hovBulbT = -9;
    this.hovLive = -1; // last LIT target a pointer was on, and when
    this.hovLiveT = -9;
    this.hovBtn = '';
    this.hovBtnT = -9;
    this.pn = new Vector3(); // scratch for the ray tests (pointedAtStart / pointedAtFlankBulb)
    this.po = new Vector3();
    this.pd = new Vector3();
    this.pq = new Quaternion();
    this.pc = new Vector3();
    this.po_to_c = new Vector3();
    this.closest_pt = new Vector3();
    this.head = new Vector3();
    this.fwd = new Vector3();
    this.up = new Vector3();
    this.q = new Quaternion();
    this.idleList = [];
    this.active = []; // lit bulbs: { i, kind, pair, surge }
    this.beatV = 0;
    this.clapT = 0;
    this.handsLostT = 0;
    this.pauseWhy = '';
    this.inXR = false;

    this.state = 'title';
    this.stateT = 0;
    this.anchored = false;
    this.anchorTimer = 0;
    this.clock = 0; // seconds, own clock
    this.countNum = 0;
    this.afterCount = 'play';
    this.resetRound();

    this.board.setHearts(this.heartsPick);
    this.stage.setPower(this.keepPower());
    this.showTitle();
    this.diagnostics = new DiagnosticsPanel('Bulb Rush XR');

    // Presses. The SDK adds the Pressed tag for a pinch ray, a gaze pinch, a controller ray, a mouse
    // click or a fingertip poke alike, and these fire the same frame, so there is no polling delay.
    this.cleanupFuncs.push(
      this.queries.pressedBulbs.subscribe('qualify', (e) => this.onBulb(e.getValue(Bulb, 'index'))),
      this.queries.pressedButtons.subscribe('qualify', (e) => this.onButton(e.getValue(UiButton, 'action'))),
    );

    // A pinch from either hand (or a controller trigger) is a WebXR 'selectstart'. watchStartGesture attaches
    // this to the live session and turns the pinch into START unless it landed on a button.
    this.onSelect = () => { this.selectPending = true; };
    this.selSession = null;
    this.cleanupFuncs.push(() => { if (this.selSession) this.selSession.removeEventListener('selectstart', this.onSelect); });

    const unlock = () => this.sound.unlock();
    const onKey = (e) => {
      unlock();
      if (e.key === 'l' || e.key === 'L') {
        this.goLobby();
        return;
      }
      if (e.code === 'Space' || e.code === 'Enter') this.onButton(this.surgeReady && this.state === 'play' ? 'surge' : 'start');
    };
    const onHidden = () => {
      if (document.hidden) this.pause('blur');
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onHidden);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        unlock();
        if (v === VisibilityState.Visible) this.anchorTimer = 0.6; // settle, then centre on the player
      }),
    );

    // A small read-only view for the automated tests.
    window.__game = {
      sys: this,
      get state() { return this.sys.state; },
      get score() { return this.sys.score; },
      get hearts() { return this.sys.hearts; },
      get level() { return this.sys.level; },
      get streak() { return this.sys.streak; },
      get active() { return this.sys.active; },
      get stats() { return this.sys.stats(); },
      get surgeReady() { return this.sys.surgeReady; },
      get surging() { return this.sys.surgeT > 0; },
      get tutorial() { return this.sys.tutorial; },
      cfg: CFG,
      start: () => this.onButton('start'),
    };
  }

  // ---------------- round state ----------------
  resetRound() {
    this.hearts = this.heartsPick;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.hits = 0;
    this.wrong = 0;
    this.expired = 0;
    this.golds = 0;
    this.pairs = 0;
    this.surges = 0;
    this.level = 1;
    this.reactSum = 0;
    this.reactN = 0;
    this.fastest = 0;
    this.spawnIn = 0.7;
    this.lockUntil = 0;
    this.sub = '';
    this.subT = 0;
    this.recordBeaten = false;
    // The very first round teaches the game: three slow bulbs that cannot hurt.
    this.tutorial = !CFG.skipTutorial && !this.played;
    this.tutorialLeft = CFG.tutorialTargets;
    this.charge = 0;
    this.surgeReady = false;
    this.surgeT = 0;
    this.pairHit = null;
  }

  stats() {
    const shots = this.hits + this.wrong + this.expired;
    return {
      hits: this.hits,
      wrong: this.wrong,
      expired: this.expired,
      accuracy: shots ? this.hits / shots : 0,
      avg: this.reactN ? this.reactSum / this.reactN : 0,
      fastest: this.fastest,
      bestStreak: this.bestStreak,
      level: this.level,
      pairs: this.pairs,
      surges: this.surges,
    };
  }

  get mult() {
    return Math.min(1 + Math.floor(this.streak / CFG.streakStep), CFG.maxMultiplier);
  }

  // Difficulty curve: how long a target stays lit, and the pause between targets.
  get life() {
    return CFG.lifeFloor + (CFG.lifeStart - CFG.lifeFloor) * Math.pow(CFG.lifeDecay, this.level - 1);
  }
  get gap() {
    return CFG.gapFloor + (CFG.gapStart - CFG.gapFloor) * Math.pow(CFG.gapDecay, this.level - 1);
  }
  get energy() {
    return clamp((this.level - 1) / 12, 0, 1);
  }

  // How much of the city stays lit with no round running, and how much your score lights.
  keepPower() {
    return CFG.cityKeep * Math.min(1, this.career / CFG.cityKeepAt);
  }
  cityPower() {
    const keep = this.keepPower();
    return keep + (1 - keep) * (1 - Math.exp(-this.score / CFG.cityScale));
  }

  // ---------------- placement ----------------
  // Reads the player's head (headset in VR, the camera on a PC).
  readHead() {
    const inXR = !!this.world.session;
    const obj = inXR ? this.player.head : this.world.camera;
    obj.getWorldPosition(this.head);
    // Forward is -Z of the head. (Object3D.getWorldDirection points the other way for a plain group.)
    this.fwd.set(0, 0, -1).applyQuaternion(obj.getWorldQuaternion(this.q));
    return Math.atan2(-this.fwd.x, -this.fwd.z); // the yaw that makes the board's -Z point where the player looks
  }

  anchor(snap) {
    const yaw = this.readHead();
    const rig = this.board.rig;
    let x = this.head.x;
    let y = this.head.y - CFG.boardDrop;
    let z = this.head.z;
    if (!this.world.session) {
      // On a flat screen, place the board so it fills about 80% of the window's height (or 85% of its width in a
      // tall window). The 0.66 m tall board and 0.84 m wide board sit CFG.boardRadius in front of its centre.
      const cam = this.world.camera;
      const t = Math.tan((cam.fov * Math.PI) / 360);
      const need = Math.max(0.66 / (0.8 * 2 * t), 0.84 / (0.85 * 2 * t * cam.aspect));
      const dist = Math.max(0, need - CFG.boardRadius);
      x += this.fwd.x * dist;
      z += this.fwd.z * dist;
      y = this.head.y - 0.02; // the board's visible extent is centred 0.02 m above its origin
      this.fitAspect = cam.aspect;
    }
    if (snap) {
      this.board.place(x, y, z, yaw);
    } else {
      // Glide, taking the shortest way round.
      let d = yaw - rig.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.board.place(
        rig.position.x + (x - rig.position.x) * 0.2,
        rig.position.y + (y - rig.position.y) * 0.2,
        rig.position.z + (z - rig.position.z) * 0.2,
        rig.rotation.y + d * 0.2,
      );
    }
    this.anchored = true;
  }

  // In the menus the board follows the player gently, so it is never behind them or out of reach.
  followHead() {
    const rig = this.board.rig;
    const yaw = this.readHead();
    let d = yaw - rig.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const dx = this.head.x - rig.position.x;
    const dz = this.head.z - rig.position.z;
    const dy = this.head.y - CFG.boardDrop - rig.position.y;
    if (Math.abs(d) > 0.75 || dx * dx + dz * dz > 0.04 || Math.abs(dy) > 0.15) this.anchorTimer = 0.25; // out of place: re-centre
  }

  // ---------------- menus ----------------
  menuButtons(v) {
    this.board.setButtonsVisible(v, !!this.world.session);
  }

  showTitle() {
    this.state = 'title';
    this.menuButtons(true);
    this.board.setSurgeButton(false);
    this.board.setStartLabel('START');
    this.hud.showBar(false);
    this.sound.setMood('menu');
    const best = this.bestFor(this.heartsPick);
    // A first-timer sees one line, not the legend: the practice round teaches touching, and gold stars and red
    // X bulbs are each announced the moment they first appear.
    const first = !this.played;
    this.hud.drawCard({
      accent: COLORS.cyan,
      title: 'BULB RUSH',
      titleColor: COLORS.cyan,
      lines: first
        ? [{ text: this.world.session ? 'Click START with your hand to begin' : 'Touch the glowing bulbs', size: 36, color: COLORS.ink }]
        : [
            { text: 'Point and tap (or poke) a bulb', size: 30, color: COLORS.ink },
            { dot: '#35f2ff', text: 'Cyan: touch it, fast', size: 30, color: COLORS.ink },
            { dot: '#ff3b5c', text: 'Red X: never touch', size: 30, color: COLORS.ink },
            { dot: '#ffd23c', text: 'Gold star: triple points', size: 30, color: COLORS.ink },
          ],
      hint2: first ? '' : `Rank: ${rankFor(this.career)}`,
      hint: this.startHint(first, best),
    });
  }

  startHint(first, best) {
    const how = this.world.session ? 'click START with your hand' : 'click START or press Space';
    if (first) return how[0].toUpperCase() + how.slice(1);
    return best ? `Best with ${this.heartsPick} hearts: ${fmt(best)}   -   ${how}` : `Choose your hearts, then ${how}`;
  }

  showOver() {
    this.state = 'over';
    this.stateT = 0;
    this.surgeT = 0;
    this.surgeReady = false;
    this.board.setSurgeButton(false);
    this.fx.arc.hide();
    const s = this.stats();
    const key = `bulbrush-best-${this.heartsPick}`;
    const prev = this.bestFor(this.heartsPick);
    this.recordBeaten = this.score > prev && this.score > 0;
    if (this.recordBeaten) save(key, this.score);
    if (s.fastest && (!this.bestReaction || s.fastest < this.bestReaction)) {
      this.bestReaction = s.fastest;
      save('bulbrush-fastest', s.fastest);
    }
    const before = rankFor(this.career);
    this.career += this.score;
    save('bulbrush-life', this.career);
    this.played = 1;
    save('bulbrush-played', 1);
    const rank = rankFor(this.career);
    this.clearLit(false);
    this.menuButtons(true);
    this.board.setStartLabel('PLAY AGAIN');
    this.hud.showBar(false);
    this.sound.setMood('menu');
    const best = Math.max(prev, this.score);
    const rating =
      s.avg === 0 ? '' : s.avg < 330 ? 'Lightning reflexes' : s.avg < 430 ? 'Sharp' : s.avg < 560 ? 'Steady' : 'Warming up';
    this.hud.drawCard({
      accent: this.recordBeaten ? COLORS.goldCss : COLORS.bad,
      title: this.recordBeaten ? 'NEW BEST!' : 'GAME OVER',
      titleColor: this.recordBeaten ? COLORS.goldCss : COLORS.bad,
      titleSize: 64,
      big: fmt(this.score),
      bigSize: 96,
      bigGap: 56,
      bigColor: COLORS.ink,
      grid: [
        ['ACCURACY', `${Math.round(s.accuracy * 100)}%`, s.accuracy >= 0.8 ? COLORS.good : COLORS.ink],
        ['AVG REACTION', s.avg ? `${Math.round(s.avg)} ms` : '-', COLORS.cyan],
        ['BEST STREAK', `${s.bestStreak}`, COLORS.goldCss],
        ['FASTEST', s.fastest ? `${Math.round(s.fastest)} ms` : '-', COLORS.cyan],
      ],
      hint2: rank !== before ? `New rank: ${rank}!` : `Rank: ${rank}`,
      hint: `Level ${s.level}  -  Best ${fmt(best)}${rating ? '  -  ' + rating : ''}`,
    });
    this.sound.over();
    if (this.recordBeaten) {
      this.sound.record();
      this.stage.celebrate(6);
      this.stage.setPower(Math.max(this.cityPower(), 0.7));
    } else {
      this.sound.powerDown();
      this.stage.setPower(this.keepPower());
    }
    this.stage.pulse(this.recordBeaten ? 0xffd23c : 0xff3b5c, 0.8);
    this.board.flashAll(this.recordBeaten ? 'gold' : 'wrong', performance.now());
  }

  startCountdown(seconds, then) {
    this.state = 'countdown';
    this.afterCount = then;
    this.count = seconds;
    this.countNum = 0;
    this.menuButtons(false);
    this.hud.showBar(true);
    this.pushHud();
  }

  pause(why) {
    if (this.state !== 'play' && this.state !== 'countdown') return;
    this.clearLit(false);
    this.fx.arc.hide();
    this.surgeT = 0; // a surge does not wait for you: it ends when the game pauses
    this.state = 'paused';
    this.pauseWhy = why;
    this.sound.setMood('off');
    this.hud.drawCard({
      accent: COLORS.cyan,
      title: 'PAUSED',
      titleColor: COLORS.cyan,
      lines: [{ text: why === 'hands' ? 'Show your hands to continue' : 'Put the headset back on to continue', size: 30 }],
    });
  }

  // Only leave the game if the lobby is actually running; otherwise the window turns into
  // "localhost refused to connect" and the player is stranded.
  goLobby() {
    const url = `${window.location.protocol}//${window.location.hostname}:8080/`;
    fetch(url, { mode: 'no-cors', cache: 'no-store' })
      .then(() => { window.location.href = url; })
      .catch(() => this.say && this.say('Lobby is not running', COLORS.bad, 2));
  }

  // ---------------- input ----------------
  onButton(action) {
    this.sound.unlock();
    const b = this.board.buttons[action];
    if (action === 'surge') {
      if (this.state === 'play' && this.surgeReady && this.surgeT <= 0) this.startSurge();
      return;
    }
    if (this.state === 'title' || this.state === 'over') {
      if (b) b.press = 1;
        if (action !== 'start') this.uiT = this.clock; // tells the pinch-to-start that a button took this press
        if (action === 'exit' || action === 'lobby') {
          this.sound.ui();
          this.goLobby();
          return;
        } else if (action === 'hearts3' || action === 'hearts5') {
          const n = action === 'hearts3' ? 3 : 5;
          this.sound.ui(); // every press answers at once, even choosing what is already chosen
          if (n !== this.heartsPick) {
            this.heartsPick = n;
            save('bulbrush-hearts', n);
            this.board.setHearts(n);
            if (this.state === 'title') this.showTitle();
          }
        } else if (action === 'start' && this.stateT >= 0.3) {
          this.sound.ui();
          this.beginRound();
        }
      }
    }

    beginRound() {
      this.anchor(true); // centre on where the player is sitting right now
      this.resetRound();
      this.clearLit(false);
      this.fx.arc.hide();
      this.stage.setPower(this.keepPower());
      this.board.setSurgeButton(false);
      this.hud.set({ hearts: this.hearts, maxHearts: this.heartsPick, score: 0, best: this.bestFor(this.heartsPick), streak: 0, mult: 1, level: 1, sub: '', subColor: COLORS.dim, charge: 0, surge: false });
      this.startCountdown(CFG.countdown, 'play');
      this.countAcc = 0;
    }

    onBulb(i) {
      this.sound.unlock();
      if (this.state === 'title' || this.state === 'over') {
        if (this.stateT >= 0.3) {
          this.sound.ui();
          this.beginRound();
        }
        return;
      }
      if (this.state !== 'play') return;
      const b = this.board.bulbs[i];
      const nowMs = performance.now();
      const pos = this.board.bulbWorldPos(i, this.v);
      // A touch right after this bulb resolved is the same gesture arriving twice (a pinch that also poked, or a
      // fingertip skimming through it on two frames). Without this a second arrival is read as a stray touch.
      if (nowMs - b.resolvedAt < CFG.touchDebounce * 1000) return;

      if (b.mode === 'target' || b.mode === 'gold') {
        b.resolvedAt = nowMs;
        const gold = b.mode === 'gold';
        this.diagnostics?.recordEvent(gold ? 'gold_bulb_hit' : 'target_bulb_hit', { index: i, mode: b.mode });
        const ent = this.entry(i);
        const surging = this.surgeT > 0;
        const react = nowMs - b.t0;
        const frac = clamp(1 - react / 1000 / b.life, 0, 1);
        this.hits++;
        this.streak++;
        this.bestStreak = Math.max(this.bestStreak, this.streak);

        // Lightning pair: touch the second bulb soon after the first for double.
        let linked = false;
        if (ent && ent.pair >= 0) {
          if (this.entry(ent.pair)) {
            this.pairHit = { i: ent.pair, t: nowMs };
            this.fx.arc.hide();
          } else if (this.pairHit && this.pairHit.i === i && nowMs - this.pairHit.t <= CFG.arcWindow * 1000) {
            linked = true;
            this.pairHit = null;
            this.pairs++;
          }
        }
        let pts = Math.round((CFG.basePoints + CFG.speedBonus * frac) * this.mult * (gold ? CFG.goldMultiplier : 1));
        if (linked) pts *= CFG.arcBonus;
        if (surging) pts *= CFG.surgePoints;
        this.score += pts;
        if (gold) this.golds++;
        this.reactSum += react;
        this.reactN++;
        if (!this.fastest || react < this.fastest) this.fastest = react;

        const color = gold ? COLORS.gold : surging ? COLORS.surge : COLORS.target;
        if (gold) this.sound.gold(pos);
        else this.sound.hit(pos, this.streak - 1);
        if (linked) this.sound.zap(pos);
        this.board.off(i);
        this.board.flash(i, gold ? 'gold' : 'hit', nowMs);
        const p = b.node.position;
        this.fx.burst(p.x, p.y, p.z, color, gold ? 34 : 22);
        this.fx.ring(p.x, p.y, p.z, b.node.rotation.y, color, gold ? 0.26 : 0.18);
        this.fx.popup(p.x, p.y, p.z, b.node.rotation.y, `+${fmt(pts)}`, linked ? 'LINKED x2' : `${Math.round(react)} ms`, gold ? COLORS.goldCss : surging ? COLORS.surgeCss : COLORS.cyan);
        this.stage.pulse(color, 0.45);
        this.stage.wave(color);
        glowHands(color);
        this.removeActive(i);

        // The first round: three slow bulbs, then the real thing.
        if (this.tutorial) {
          this.tutorialLeft--;
          if (this.tutorialLeft <= 0) {
            this.tutorial = false;
            this.played = 1;
            save('bulbrush-played', 1);
            this.say('NOW IT COUNTS!', COLORS.goldCss, 1.8);
          } else {
            this.say(this.tutorialLeft === 1 ? 'One more' : 'Nice! Again', COLORS.good, 2);
          }
        } else if (!surging) {
          // The surge meter fills with hits and is spent in a clap.
          if (!this.surgeReady) {
            this.charge++;
            if (this.charge >= CFG.surgeHits) {
              this.surgeReady = true;
              this.sound.surgeReady();
              this.board.setSurgeButton(true);
              this.say('CLAP FOR SURGE!', COLORS.surgeCss, 4);
            }
          }
        }

        // Streak reward: a heart back.
        if (this.streak > 0 && this.streak % CFG.heartEvery === 0 && this.hearts < this.heartsPick) {
          this.hearts++;
          this.sound.heartGained();
          this.say('+1 HEART!', COLORS.good, 1.4);
        }
        // Level up
        const lvl = 1 + Math.floor(this.hits / CFG.hitsPerLevel);
        if (lvl > this.level) {
          this.level = lvl;
          this.sound.level();
          if (!surging) this.sound.setMood('play', lvl);
          this.stage.pulse(0xb04dff, 0.7);
          if (!this.tutorial) this.say(this.levelNote(lvl), COLORS.goldCss, 1.8);
        }
        this.pushHud();
        // The next target comes after a short, shrinking pause once the real ones are done.
        if (!this.hasReal()) this.spawnIn = this.randGap();
      } else if (b.mode === 'decoy') {
        if (this.surgeT > 0) return; // a surge forgives everything
        b.resolvedAt = nowMs;
        // A struck decoy is spent: it goes dark, so one jab can never cost more than one heart.
        this.board.off(i);
        this.removeActive(i);
        this.penalty(i, 'DECOY!', pos);
      } else if (this.hasReal() && this.surgeT <= 0) {
        // A dark bulb while a target is lit: on the way to the target a finger can easily brush one, so it
        // costs your streak, not a heart. Only a red X or a target running out takes a heart.
        // The pointer was on a lit target a moment ago and has just slipped onto this dark neighbour (closing the
        // fingers into a pinch does that): the tap is going to the target, so this is not a wrong touch.
        if (this.hovLive !== i && this.clock - this.hovLiveT < 0.4 && this.isLiveTarget(this.hovLive)) return;
        if (nowMs / 1000 > this.lockUntil) {
          this.lockUntil = nowMs / 1000 + CFG.wrongLockout;
          if (!this.tutorial) {
            this.wrong++;
            this.streak = 0;
            this.pushHud();
          }
          b.press = 1;
          this.sound.expire(pos);
        }
      } else {
        // Nothing is lit (or a surge is on, which forgives everything): a stray touch is harmless.
        b.press = 1;
        this.sound.ui();
      }
    }

    levelNote(lvl) {
      if (lvl === CFG.goldFromLevel) return 'GOLD STARS: x3';
      if (lvl === CFG.decoyFromLevel) return "RED X: DON'T TOUCH";
      if (lvl === CFG.doubleFromLevel) return 'LIGHTNING PAIRS: x2';
      return `LEVEL ${lvl}`;
    }

    // A wrong touch or a target that ran out: one heart gone (none in the tutorial).
    penalty(i, label, pos) {
      const b = this.board.bulbs[i];
      const nowMs = performance.now();
      this.sound.wrong(pos);
      this.board.flash(i, 'wrong', nowMs);
      const p = b.node.position;
      this.fx.burst(p.x, p.y, p.z, COLORS.decoy, 16, 0.4);
      this.fx.popup(p.x, p.y, p.z, b.node.rotation.y, label, '', COLORS.bad);
      this.lockUntil = nowMs / 1000 + CFG.wrongLockout;
      if (this.tutorial) {
        this.say('Only the glowing bulb', COLORS.dim, 2);
        return;
      }
      this.wrong++;
      this.loseHeart();
    }

    loseHeart() {
      if (this.state !== 'play') return; // the round is already over (or paused): nothing more to lose
      this.streak = 0;
      this.hearts--;
      this.hud.heartLost();
      this.sound.heartLost();
      this.stage.pulse(0xff3b5c, 0.75);
      this.stage.brownout();
      this.pushHud();
      if (this.hearts <= 0) {
        this.pushHud();
        this.showOver();
      }
    }

    // ---------------- surge ----------------
    startSurge() {
      this.surgeReady = false;
      this.charge = 0;
      this.surgeT = CFG.surgeTime;
      this.surges++;
      this.board.setSurgeButton(false);
      this.clearLit(false);
      this.fx.arc.hide();
      this.spawnIn = 0.1;
      this.sound.surge();
      this.sound.setMood('surge', this.level);
      this.stage.pulse(COLORS.surge, 1);
      this.stage.wave(COLORS.surge);
      glowHands(COLORS.surge);
      this.board.flashAll('surge', performance.now());
      this.say('SURGE!', COLORS.surgeCss, 1.6);
      this.pushHud();
    }

    endSurge() {
      this.surgeT = 0;
      this.clearLit(false);
      this.spawnIn = 0.6;
      this.sound.setMood('play', this.level);
      this.say('SURGE OVER', COLORS.dim, 1.2);
      this.pushHud();
    }

    // ---------------- spawning ----------------
    entry(i) {
      for (const a of this.active) if (a.i === i) return a;
      return null;
    }

    hasReal() {
      for (const a of this.active) if (a.kind !== 'decoy') return true;
      return false;
    }

    removeActive(i) {
      for (let k = this.active.length - 1; k >= 0; k--) if (this.active[k].i === i) this.active.splice(k, 1);
    }

    randGap() {
      return this.gap * (0.45 + Math.random() * 0.55) + CFG.gapFloor * 0.5;
    }

    clearLit(flash) {
      for (const a of this.active) this.board.off(a.i);
      this.active.length = 0;
      if (flash) this.board.flashAll('wrong', performance.now());
    }

    pickIdle() {
      const list = this.board.idleBulbs(this.idleList);
      if (!list.length) return -1;
      return list[(Math.random() * list.length) | 0];
    }

    light(i, kind, life, nowMs, pair = -1, surge = false) {
      this.board.light(i, kind, life, nowMs, surge);
      this.active.push({ i, kind, pair, surge, inL: false, inR: false, seen: false });
      this.sound.ping(this.board.bulbWorldPos(i, this.v));
    }

    spawnWave(nowMs) {
      if (this.tutorial) {
        // The very first bulb is dead centre, right where the player is looking; the rest are anywhere.
        let i = -1;
        if (this.tutorialLeft === CFG.tutorialTargets) {
          const mid = this.board.bulbs.find((b) => b.row === 1 && b.col === Math.floor(b.cols / 2) && b.mode === 'idle');
          if (mid) i = mid.index;
        }
        if (i < 0) i = this.pickIdle();
        if (i >= 0) this.light(i, 'target', CFG.tutorialLife, nowMs);
        return;
      }
      const L = this.level;
      const life = this.life;
      const pair = L >= CFG.doubleFromLevel && Math.random() < Math.min(0.15 + 0.05 * (L - CFG.doubleFromLevel), 0.45);
      if (pair) {
        const a = this.pickIdle();
        if (a >= 0) this.board.bulbs[a].mode = 'target'; // hold it while the partner is picked
        const b = this.pickIdle();
        if (a >= 0) this.board.bulbs[a].mode = 'idle';
        if (a >= 0 && b >= 0) {
          this.light(a, 'target', life, nowMs, b);
          this.light(b, 'target', life, nowMs, a);
          this.fx.arc.show(this.board.bulbs[a].node.position, this.board.bulbs[b].node.position);
          this.pairHit = null;
        } else if (a >= 0) {
          this.light(a, 'target', life, nowMs);
        }
      } else {
        const gold = L >= CFG.goldFromLevel && Math.random() < 0.1;
        const i = this.pickIdle();
        if (i >= 0) this.light(i, gold ? 'gold' : 'target', gold ? life * 0.8 : life, nowMs);
      }
      if (L >= CFG.decoyFromLevel) {
        // Red X bulbs: nearly every wave has some, and the number climbs with the level (up to decoyMax).
        let decoys = 0;
        if (Math.random() < Math.min(0.6 + 0.05 * (L - CFG.decoyFromLevel), 0.95)) {
          decoys = 1 + Math.floor((L - CFG.decoyFromLevel) / 2) + (Math.random() < 0.5 ? 1 : 0);
          decoys = Math.min(decoys, CFG.decoyMax);
        }
        for (let n = 0; n < decoys; n++) {
          const i = this.pickIdle();
          if (i < 0) break;
          this.board.light(i, 'decoy', life * 1.05, nowMs);
          this.active.push({ i, kind: 'decoy', pair: -1, surge: false, inL: false, inR: false, seen: false });
        }
      }
    }

    // ---------------- messages / hud ----------------
    say(text, color, seconds) {
      this.sub = text;
      this.subT = seconds;
      this.hud.set({ sub: text, subColor: color });
    }

    pushHud() {
      this.hud.set({
        hearts: Math.max(0, this.hearts),
        maxHearts: this.heartsPick,
        score: this.score,
        streak: this.streak,
        mult: this.mult,
        level: this.level,
        best: Math.max(this.bestFor(this.heartsPick), 0),
        charge: this.surgeT > 0 ? this.surgeT / CFG.surgeTime : this.surgeReady ? 1 : this.charge / CFG.surgeHits,
        surge: this.surgeT > 0,
      });
      this.stage.setPower(this.cityPower());
    }

    // ---------------- frame ----------------
    // In a headset with no hands or controllers in view, the round waits instead of punishing you.
    watchHands(dt) {
      const session = this.world.session;
      if (!session) {
        this.handsLostT = 0;
        return;
      }
      const n = session.inputSources ? session.inputSources.length : 1;
      if (n > 0) {
        this.handsLostT = 0;
        if (this.state === 'paused' && this.pauseWhy === 'hands') {
          this.startCountdown(CFG.resumeCountdown, 'play');
          this.countAcc = 0;
        }
      } else if (this.state === 'play' || this.state === 'countdown') {
        this.handsLostT += dt;
        if (this.handsLostT >= CFG.handsLostPause) this.pause('hands');
      }
    }

    // A lit cyan or gold bulb: the only kind a tap should prefer.
    isLiveTarget(i) {
      if (i < 0) return false;
      const b = this.board.bulbs[i];
      return !!b && (b.mode === 'target' || b.mode === 'gold');
    }

    // Headset start/surge without a keyboard: a controller face button (A/X/B/Y) or grip, or a single pinch
    // from either hand (menus only). Each is one edge-triggered press, same action as Space on desktop.
    watchStartGesture(dt) {
      const session = this.world.session;
      if (session !== this.selSession) {
        if (this.selSession) this.selSession.removeEventListener('selectstart', this.onSelect);
        this.selSession = session || null;
        if (session) session.addEventListener('selectstart', this.onSelect);
      }
      if (!session) return;
      let pressed = false;
      const srcs = session.inputSources;
      if (srcs) {
        for (let s = 0; s < srcs.length; s++) {
          const gp = srcs[s].gamepad;
          if (!gp) continue;
          const bs = gp.buttons;
          const down = (bs[1] && bs[1].pressed) || (bs[4] && bs[4].pressed) || (bs[5] && bs[5].pressed);
          const prev = srcs[s].handedness === 'left' ? 'padL' : 'padR';
          if (down && !this[prev]) pressed = true;
          this[prev] = !!down;
        }
      }
      // One pinch (thumb tip to index tip) with either hand starts a round from the menus. A pinch that
      // lands on the hearts / lobby buttons is theirs (uiT), so the start waits a few frames and yields.
      const menu = this.state === 'title' || this.state === 'over';
      // Remember what the ray is on, frame by frame. Closing the fingers into a pinch nudges the ray, so by the
      // time the tap lands the ray may have just slipped off: the tap uses what was pointed at a moment ago.
      let hovBtn = '';
      for (const e of this.queries.hoveredButtons.entities) {
        const a = e.getValue(UiButton, 'action');
        const ok = menu ? a !== 'surge' : a === 'surge' && this.state === 'play' && this.surgeReady;
        if (ok) { hovBtn = a; break; }
      }
      if (hovBtn) { this.hovBtn = hovBtn; this.hovBtnT = this.clock; }
      // With two hands (or a hand and the gaze) pointing, a lit target under ANY pointer wins over a dark bulb.
      let hovBulb = -1;
      for (const e of this.queries.hoveredBulbs.entities) {
        const i = e.getValue(Bulb, 'index');
        if (hovBulb < 0) hovBulb = i;
        if (this.isLiveTarget(i)) { hovBulb = i; break; }
      }
      if (hovBulb < 0 && menu) hovBulb = this.pointedAtFlankBulb();
      if (hovBulb >= 0) {
        this.hovBulb = hovBulb;
        this.hovBulbT = this.clock;
        if (this.isLiveTarget(hovBulb)) { this.hovLive = hovBulb; this.hovLiveT = this.clock; }
      }

      // A tap (pinch, trigger or click = WebXR selectstart) fires what the player is pointing at.
      // Pinching at nothing does nothing: the ray must be on a button or bulb.
      const tapped = this.selectPending;
      this.selectPending = false;
      if (pressed && this.state === 'play' && this.surgeReady) this.onButton('surge'); // controller face button
      if (!tapped) return;
      const grace = 0.4;
      if (menu || this.state === 'play') {
        let btn = hovBtn || (this.clock - (this.hovBtnT || -9) < grace ? this.hovBtn : '');
        if (!btn && menu && (this.pointedAtStart() || this.pointedAtFlankBulb() >= 0 || hovBulb >= 0)) btn = 'start'; // tap while pointing at START or flank bulb
        if (btn) { this.hovBtnT = -9; this.hovBulbT = -9; this.onButton(btn); return; } // after the loop: a press can change components
      }
      if (this.state === 'play') {
        // Closing the fingers into a pinch nudges the pointer, so it often slips onto a neighbour just as the tap
        // lands. The lit target it was on a moment ago wins over whatever dark bulb it is on now.
        let bi = -1;
        if (this.isLiveTarget(hovBulb)) bi = hovBulb;
        else if (this.clock - this.hovLiveT < grace && this.isLiveTarget(this.hovLive)) bi = this.hovLive;
        else if (hovBulb >= 0) bi = hovBulb;
        else if (this.clock - this.hovBulbT < grace) bi = this.hovBulb;
        if (bi >= 0) { this.hovBulbT = -9; this.hovLiveT = -9; this.onBulb(bi); }
      }
    }

    // Active hand/controller rays only. Head gaze is never included, preventing unintended auto-start.
    getHandRays() {
      if (!this.world.session || !this.player || !this.player.raySpaces) return [];
      const out = this.handRays;
      out.length = 0;
      for (let n = 0; n < 2; n++) {
        const side = n === 0 ? 'left' : 'right';
        const ray = this.player.raySpaces[side];
        if (!ray) continue;
        const srcs = this.world.session.inputSources;
        let active = false;
        if (srcs) {
          for (let s = 0; s < srcs.length; s++) {
            if (srcs[s].handedness === side) {
              active = true;
              break;
            }
          }
        }
        if (!active) continue;
        // When tracked hands are used, verify the hand is raised above resting lap level
        if (jointPos(side, 'wrist', this.v) && this.v.y < this.head.y - 0.45) {
          continue;
        }
        out.push(ray);
      }
      return out;
    }

    // Pointing with a hand highlights the button or bulb. Never auto-starts.
    // The player must click (pinch, poke, or trigger) with their hand to start.
    watchPoint(dt) {
      const menu = this.state === 'title' || this.state === 'over';
      if (!menu) return;
      const handRays = this.getHandRays();
      const flankBulb = this.pointedAtFlankBulb(handRays);
      if (flankBulb >= 0 && this.board && this.board.bulbs && this.board.bulbs[flankBulb]) {
        this.board.bulbs[flankBulb].hover = Math.min(1, this.board.bulbs[flankBulb].hover + dt * 6);
      }
    }

    // Is an active hand ray landing on a left/right white flank bulb?
    pointedAtFlankBulb(handRays) {
      if (!this.board || !this.board.bulbs) return -1;
      const rays = handRays || this.getHandRays();
      if (!rays.length) return -1;
      for (const b of this.board.bulbs) {
        if (b.col > 1 && b.col < b.cols - 2) continue;
        b.node.getWorldPosition(this.pc);
        const hitRadius = Math.max(CFG.hitRadius * 1.25, b.radius * 2.0);
        const hitRadiusSq = hitRadius * hitRadius;
        for (const r of rays) {
          r.getWorldPosition(this.po);
          this.pd.set(0, 0, -1).applyQuaternion(r.getWorldQuaternion(this.pq));
          this.po_to_c.subVectors(this.pc, this.po);
          const t = this.po_to_c.dot(this.pd);
          if (t <= 0.05 || t > 3.0) continue;
          this.closest_pt.copy(this.po).addScaledVector(this.pd, t);
          if (this.closest_pt.distanceToSquared(this.pc) <= hitRadiusSq) {
            return b.index;
          }
        }
      }
      return -1;
    }

    // Is an active hand ray landing on the START / PLAY AGAIN button?
    pointedAtStart(handRays) {
      if (!this.world.session || !this.board.buttons.start.node.visible) return false;
      const rays = handRays || this.getHandRays();
      if (!rays.length) return false;
      const node = this.board.buttons.start.node;
      node.getWorldPosition(this.pc);
      node.getWorldQuaternion(this.pq);
      this.pn.set(0, 0, 1).applyQuaternion(this.pq);
      for (const r of rays) {
        r.getWorldPosition(this.po);
        this.pd.set(0, 0, -1).applyQuaternion(r.getWorldQuaternion(this.pq));
        const denom = this.pd.dot(this.pn);
        if (Math.abs(denom) < 1e-4) continue;
        node.getWorldQuaternion(this.pq);
        const t = this.pn.dot(this.po_to_c.subVectors(this.pc, this.po)) / denom;
        if (t <= 0.05 || t > 3.0) continue;
        const hit = this.closest_pt.copy(this.po).addScaledVector(this.pd, t);
        const l = node.worldToLocal(hit);
        if (Math.abs(l.x) < 0.13 + 0.02 && Math.abs(l.y) < 0.0425 + 0.02) return true;
      }
      return false;
    }

    // Two hands coming together after being apart: a clap.
    watchClap(dt) {
      if (!this.surgeReady || this.state !== 'play' || !this.world.session) return;
      if (!jointPos('left', 'index-finger-tip', this.v) || !jointPos('right', 'index-finger-tip', this.v2)) return;
      const d = this.v.distanceTo(this.v2);
      if (d > 0.22) this.clapT = 0.6;
      else this.clapT = Math.max(0, this.clapT - dt);
      if (d < 0.08 && this.clapT > 0) this.startSurge();
    }

    update(dt) {
      dt = Math.min(dt, 0.05);
      const vis = this.world.visibilityState.peek();
      // Headset off or system menu open: the round waits, and resumes with a short countdown.
      if (vis === VisibilityState.VisibleBlurred) {
        if (this.state === 'play' || this.state === 'countdown') this.pause('blur');
        return;
      }
      if (this.state === 'paused' && this.pauseWhy === 'blur' && !document.hidden) {
        this.startCountdown(CFG.resumeCountdown, 'play');
        this.countAcc = 0;
      }
      this.watchHands(dt);
      this.watchStartGesture(dt);
      this.watchPoint(dt);

      this.clock += dt;
      this.stateT += dt;
      const nowMs = performance.now();

      // The Exit button only exists inside a headset.
      const inXR = !!this.world.session;
      if (inXR !== this.inXR) {
        this.inXR = inXR;
        if (this.state === 'title') this.showTitle(); // redraws the hint for the new input mode
        else if (this.state === 'over') this.menuButtons(true);
      }

      // First placement, and the menus' gentle follow.
      if (!this.anchored) this.anchor(true);
      else if (!inXR && this.world.camera.aspect !== this.fitAspect) this.anchor(true); // the window changed shape
      if (this.anchorTimer > 0) {
        this.anchorTimer -= dt;
        this.anchor(false);
        if (this.anchorTimer <= 0) this.anchor(true);
      } else if (inXR && (this.state === 'title' || this.state === 'over')) {
        this.followHead();
      }

      // 3D audio follows the head.
      if (this.sound.ctx) {
        this.readHead();
        this.sound.listener(this.head.x, this.head.y, this.head.z, this.fwd.x, this.fwd.y, this.fwd.z, 0, 1, 0);
      }
      this.sound.update(dt);
      this.beatV = this.sound.beat ? 1 : Math.max(0, this.beatV - dt * 4);

      if (this.state === 'countdown') this.updateCountdown(dt);
      else if (this.state === 'play') {
        this.updatePlay(dt, nowMs);
        this.watchClap(dt);
      }

      if (this.subT > 0) {
        this.subT -= dt;
        if (this.subT <= 0) this.hud.set({ sub: '' });
      }
      if (this.surgeT > 0) this.hud.set({ charge: this.surgeT / CFG.surgeTime });

      const attract = this.state === 'title' || this.state === 'over' || this.state === 'paused';
      this.board.update(dt, this.clock, nowMs, attract, this.energy, this.beatV, this.surgeT > 0);
      this.stage.update(dt, this.clock, this.energy, this.beatV, this.surgeT > 0);
      this.fx.update(dt);
      this.hud.update(dt);
      updateHands(dt);

      if (this.diagnostics) {
        const leftTip = jointPos('left', 'index-finger-tip', this.v);
        const rightTip = jointPos('right', 'index-finger-tip', this.v2);
        this.diagnostics.update({
          gameState: this.state,
          score: this.score,
          hearts: this.hearts,
          streak: this.streak,
          level: this.level,
          hands: {
            left: { tracked: !!leftTip, indexTip: leftTip },
            right: { tracked: !!rightTip, indexTip: rightTip },
          },
        });
      }
    }

    updateCountdown(dt) {
      this.countAcc = (this.countAcc || 0) + dt;
      const n = Math.ceil(this.count - this.countAcc);
      if (n !== this.countNum) {
        this.countNum = n;
        if (n > 0) {
          this.hud.drawCard({
            accent: COLORS.cyan,
            big: n,
            bigSize: 150,
            bigColor: COLORS.cyan,
            hint: this.afterCount === 'play' && this.score > 0 ? 'Get ready' : this.tutorial ? 'Your first round: nothing can hurt you' : 'Hit the glowing bulb before it goes dark',
          });
          this.sound.tick();
        }
      }
      if (this.countAcc >= this.count) {
        this.hud.showCard(false);
        this.sound.go();
        this.sound.setMood('play', this.level);
        this.state = 'play';
        this.stateT = 0;
        this.spawnIn = 0.5;
        if (this.tutorial) this.say(this.world.session ? 'Point at the glowing bulb and tap' : 'Poke the glowing bulb', COLORS.cyan, 6);
        else this.say('GO!', COLORS.good, 0.9);
      }
    }

    // Fingertip contact, polled every frame. The SDK's touch pointer only reports a press on the frame a finger
    // goes from "away" to "within 3 cm of the nearest bulb", and then stays "down" for as long as the finger stays
    // near the board. So a hand resting on the board, or sliding from one bulb to the next, never produced a new
    // press: the bulb under the finger lit, nothing registered, and it timed out as TOO SLOW. Reading the fingertip
    // position directly has no such blind spot:
    //  - a lit target or gold bulb counts the moment a fingertip is on it, however the finger got there;
    //  - a red X only counts when a fingertip moves ONTO it, so a hand that is already resting there is not punished.
    watchTouch() {
      if (!this.world.session || !this.active.length) return;
      const hasL = jointPos('left', 'index-finger-tip', this.tipL);
      const hasR = jointPos('right', 'index-finger-tip', this.tipR);
      if (!hasL && !hasR) {
        for (const a of this.active) a.inL = a.inR = false;
        return;
      }
      for (let k = this.active.length - 1; k >= 0; k--) {
        const a = this.active[k];
        if (!a) continue; // the list shrank while we were inside onBulb
        const b = this.board.bulbs[a.i];
        b.node.getWorldPosition(this.bpos);
        const reach = CFG.hitRadius * b.scale * b.node.scale.x + CFG.fingertipPad;
        const reach2 = reach * reach;
        const inL = hasL && this.tipL.distanceToSquared(this.bpos) <= reach2;
        const inR = hasR && this.tipR.distanceToSquared(this.bpos) <= reach2;
        const enteredL = a.seen && inL && !a.inL;
        const enteredR = a.seen && inR && !a.inR;
        a.seen = true; // the first frame only records where the fingers already are
        a.inL = inL;
        a.inR = inR;
        if (a.kind === 'decoy') {
          if (enteredL || enteredR) this.onBulb(a.i);
        } else if (inL || inR) {
          this.onBulb(a.i);
        }
        if (this.state !== 'play') return;
      }
    }

    updatePlay(dt, nowMs) {
      this.watchTouch();
      if (this.state !== 'play') return;
      // Targets that ran out of time. A lit bulb stays hittable for a moment past its ring (hitGrace).
      for (let k = this.active.length - 1; k >= 0; k--) {
        const a = this.active[k];
        const b = this.board.bulbs[a.i];
        const grace = a.kind === 'decoy' ? 0 : CFG.hitGrace;
        if ((nowMs - b.t0) / 1000 < b.life + grace) continue;
        this.active.splice(k, 1);
        this.board.off(a.i);
        b.resolvedAt = nowMs;
        if (a.pair >= 0) this.fx.arc.hide();
        if (a.surge) continue; // a missed surge bulb costs nothing
        if (a.kind === 'target') {
          const pos = this.board.bulbWorldPos(a.i, this.v);
          const p = b.node.position;
          this.sound.expire(pos);
          this.board.flash(a.i, 'miss', nowMs);
          if (this.tutorial) {
            // The tutorial waits for you.
            this.fx.popup(p.x, p.y, p.z, b.node.rotation.y, 'Poke it!', '', COLORS.dim);
            this.spawnIn = 0.6;
            continue;
          }
          // Too slow: it costs a heart.
          this.expired++;
          this.fx.popup(p.x, p.y, p.z, b.node.rotation.y, 'TOO SLOW', '', COLORS.bad);
          this.loseHeart();
          if (this.state !== 'play') return;
          if (!this.hasReal()) this.spawnIn = this.randGap() + 0.25;
        } else if (a.kind === 'gold') {
          this.fx.popup(b.node.position.x, b.node.position.y, b.node.position.z, b.node.rotation.y, 'gone', '', COLORS.dim);
          if (!this.hasReal()) this.spawnIn = this.randGap();
        }
      }

      if (this.surgeT > 0) {
        // Surge: up to three bulbs at a time, a short life each, nothing to lose.
        this.surgeT -= dt;
        if (this.surgeT <= 0) {
          this.endSurge();
          return;
        }
        this.spawnIn -= dt;
        let real = 0;
        for (const a of this.active) if (a.kind !== 'decoy') real++;
        if (real < 3 && this.spawnIn <= 0) {
          const i = this.pickIdle();
          if (i >= 0) this.light(i, 'target', CFG.surgeLife, nowMs, -1, true);
          this.spawnIn = 0.26;
        }
        return;
      }

      if (!this.hasReal()) {
        this.spawnIn -= dt;
        if (this.spawnIn <= 0) this.spawnWave(nowMs);
      }
    }
  }
