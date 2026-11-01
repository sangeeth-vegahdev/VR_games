import {
  AnimationMixer,
  AssetManager,
  Box3,
  BoxGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from '@iwsdk/core';
import { COACH_HEIGHT, COACH_Z, BAT_MOUNT } from './config.js';

// The coach: a CC0 low-poly character with a procedural cricket bat in the right hand.
// It idles, swings (attack-melee-right clip), cheers on a catch and shrugs on a miss.
export class Coach {
  constructor(world) {
    const gltf = AssetManager.getGLTF('coach');
    this.model = gltf.scene;

    // Scale the character to COACH_HEIGHT and stand it on the ground, facing the player (+Z).
    const box = new Box3().setFromObject(this.model);
    const size = box.getSize(new Vector3());
    this.scale = COACH_HEIGHT / size.y;
    this.model.position.set(0, -box.min.y, 0);

    this.root = new Group();
    this.root.add(this.model);
    this.root.scale.setScalar(this.scale);
    this.root.position.set(0, 0, COACH_Z);
    world.createTransformEntity(this.root);

    this.mixer = new AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.mixer.addEventListener('finished', () => this.play('idle'));
    this.play('idle');

    this.attachBat();
  }

  attachBat() {
    const hand = this.model.getObjectByName('arm-right');
    const bat = new Group();
    const grip = new Mesh(new CylinderGeometry(0.03, 0.03, 0.3, 10), new MeshStandardMaterial({ color: 0xc0392b, roughness: 0.7 }));
    grip.position.y = 0.15;
    const blade = new Mesh(new BoxGeometry(0.16, 0.62, 0.06), new MeshStandardMaterial({ color: 0xf3dba0, roughness: 0.5 }));
    blade.position.y = 0.61;
    bat.add(grip, blade);

    // The bat is sized in metres; the bone lives in model units, so undo the model scale.
    bat.scale.setScalar(BAT_MOUNT.length / 0.92 / this.scale);
    bat.position.set(...BAT_MOUNT.position);
    bat.rotation.set(...BAT_MOUNT.rotation);
    hand.add(bat);
    this.bat = bat;
  }

  play(name) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.setLoop(name === 'idle' ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = false;
    if (this.current) next.crossFadeFrom(this.current, 0.08, false);
    next.play();
    this.current = next;
  }

  swing() {
    this.actions['attack-melee-right']?.reset();
    this.current = null; // force a fresh start even if the swing is replayed
    this.play('attack-melee-right');
  }

  cheer() {
    this.current = null;
    this.play('emote-yes');
  }

  shrug() {
    this.current = null;
    this.play('emote-no');
  }

  update(dt) {
    this.mixer.update(dt);
  }

  // Jump to a point in a clip: used by tests and for tuning the bat mount.
  pose(name, time) {
    this.mixer.stopAllAction();
    const action = this.actions[name];
    action.reset().play();
    action.time = time;
    action.paused = true;
    this.mixer.update(0);
  }
}
