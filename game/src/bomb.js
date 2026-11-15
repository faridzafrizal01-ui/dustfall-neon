// The device: a bot plants it at a site (3 s channel), it ticks for 35 s, and the
// player defuses it by holding E inside the site (5 s channel). The module owns the
// phase, the progress and the blinking device mesh; main.js decides when a channel is
// active and what a detonation or a defuse means for the round.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { BOMB_FUSE, PLANT_TIME, DEFUSE_TIME } from './state.js';

export function createBomb(scene, audio) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.36),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.5, metalness: 0.4 }),
  );
  body.position.y = 0.14;
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.bad) });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), lampMat);
  lamp.position.set(0, 0.34, 0);
  group.add(body, lamp);
  group.visible = false;
  scene.add(group);

  const bomb = {
    state: 'idle', // 'idle' | 'planting' | 'planted' | 'defused' | 'detonated'
    site: null,
    progress: 0,
    fuse: 0,
    beepTimer: 0,
    blink: 0,
  };

  function placeAt(site, map) {
    const s = map.sites[site];
    group.position.set(s.x, 0, s.z);
    group.visible = true;
  }

  return {
    state: bomb,
    plant(site) {
      bomb.state = 'planting';
      bomb.site = site;
      bomb.progress = 0;
    },
    // Advance the plant channel. Returns true the moment the plant completes.
    plantStep(dt, active) {
      if (bomb.state !== 'planting') return false;
      bomb.progress = active
        ? Math.min(1, bomb.progress + dt / PLANT_TIME)
        : Math.max(0, bomb.progress - dt / PLANT_TIME);
      if (bomb.progress >= 1) {
        bomb.state = 'planted';
        bomb.fuse = BOMB_FUSE;
        bomb.progress = 0; // the defuse channel starts from zero
        bomb.beepTimer = 0;
        audio.plantDone();
        return true;
      }
      return false;
    },
    // Advance the defuse channel. Returns true the moment the defuse completes.
    defuseStep(dt, active) {
      if (bomb.state !== 'planted') return false;
      bomb.progress = active
        ? Math.min(1, bomb.progress + dt / DEFUSE_TIME)
        : Math.max(0, bomb.progress - dt / DEFUSE_TIME);
      if (bomb.progress >= 1) {
        bomb.state = 'defused';
        group.visible = false;
        return true;
      }
      return false;
    },
    step(dt) {
      if (bomb.state !== 'planted') return null;
      bomb.fuse -= dt;
      bomb.blink += dt;
      lampMat.color.setHex(Math.sin(bomb.blink * 10) > 0 ? 0xe5484d : 0x551111);
      const interval = bomb.fuse > 10 ? 1 : bomb.fuse > 5 ? 0.5 : 0.25;
      bomb.beepTimer -= dt;
      if (bomb.beepTimer <= 0) {
        bomb.beepTimer = interval;
        audio.beep(bomb.fuse <= 5);
      }
      if (bomb.fuse <= 0) {
        bomb.state = 'detonated';
        group.visible = false;
        return 'detonated';
      }
      return null;
    },
    showAt(site, map) {
      placeAt(site, map);
    },
    reset() {
      bomb.state = 'idle';
      bomb.site = null;
      bomb.progress = 0;
      bomb.fuse = 0;
      group.visible = false;
    },
  };
}
