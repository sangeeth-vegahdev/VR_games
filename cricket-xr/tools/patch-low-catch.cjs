const fs = require('fs');
const path = require('path');

const gamePath = path.join(__dirname, '..', 'src', 'game.js');
let src = fs.readFileSync(gamePath, 'utf8').replace(/\r\n/g, '\n');

// 1. In beginThrow: roll for isHighCatch and isLowCatch, and targetY
const oldBeginThrow = `  beginThrow() {
    this.ballNo++;
    this.isHighCatch = this.ballNo > 3 && Math.random() < 0.25;
    const ramp = Math.min(1, (this.ballNo - 1) / CFG.rampBalls);
    let speed = lerp(CFG.startSpeed, CFG.maxSpeed, ramp);
    if (ramp >= 1) speed += (Math.random() * 2 - 1) * CFG.speedJitter;
    this.throwSpeed = speed;
    this.kmh = Math.round(speed * 3.6);
    const isStraight = this.isHighCatch ? (Math.random() < 0.6) : (Math.random() < 0.3);
    if (isStraight) {
      this.side = 0;
      this.swingA = 0;
    } else {
      this.side = Math.random() < 0.5 ? -1 : 1;
      this.swingA = lerp(CFG.swingBase, CFG.swingMax, ramp);
    }

    // Arrival point: around chest height, wherever the headset currently is.
    // In a headset use the real head; on a PC the camera stands in for it.
    (this.world.session ? this.player.head : this.world.camera).getWorldPosition(this.head);
    this.aim.set(
      (Math.random() * 2 - 1) * CFG.targetSpreadX,
      this.head.y - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY,
      CFG.arriveZ,
    );`;

const newBeginThrow = `  beginThrow() {
    this.ballNo++;
    const roll = Math.random();
    this.isHighCatch = this.ballNo > 3 && roll < 0.20;
    this.isLowCatch = this.ballNo > 2 && !this.isHighCatch && roll < 0.42;

    const ramp = Math.min(1, (this.ballNo - 1) / CFG.rampBalls);
    let speed = lerp(CFG.startSpeed, CFG.maxSpeed, ramp);
    if (ramp >= 1) speed += (Math.random() * 2 - 1) * CFG.speedJitter;
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

    // Arrival point: high skier, dipping low catch near knee/shin, or chest/waist
    (this.world.session ? this.player.head : this.world.camera).getWorldPosition(this.head);
    let targetY;
    if (this.isLowCatch) {
      targetY = 0.62 + (Math.random() * 2 - 1) * 0.08;
    } else {
      targetY = this.head.y - CFG.chestBelowHead + (Math.random() * 2 - 1) * CFG.targetSpreadY;
    }

    this.aim.set(
      (Math.random() * 2 - 1) * CFG.targetSpreadX,
      targetY,
      CFG.arriveZ,
    );`;

if (src.includes(oldBeginThrow)) {
  src = src.replace(oldBeginThrow, newBeginThrow);
} else {
  console.log('Warning: oldBeginThrow block not matched directly');
}

// 2. In caught(side): update message for low catches
const oldCaughtMsg = `    const catchMsg = this.isHighCatch ? 'HIGH CATCH!' : (this.streak >= 3 ? \`CAUGHT!  \${this.streak} in a row\` : 'CAUGHT!');`;
const newCaughtMsg = `    let catchMsg = 'CAUGHT!';
    if (this.isHighCatch) {
      catchMsg = 'HIGH CATCH!';
    } else if (this.isLowCatch) {
      catchMsg = 'LOW CATCH!';
    } else if (this.streak >= 3) {
      catchMsg = \`CAUGHT!  \${this.streak} in a row\`;
    }`;

if (src.includes(oldCaughtMsg)) {
  src = src.replace(oldCaughtMsg, newCaughtMsg);
}

fs.writeFileSync(gamePath, src, 'utf8');
console.log('Successfully updated game.js with low catches');

