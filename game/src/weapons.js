// Three guns, one job each: a view model, a magazine, a reload, and the spread that
// punishes firing on the move. The module owns the numbers; main.js owns the ray and
// the damage. Grenades are thrown with G and live in grenades.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9', label: 'P9 sidearm', price: 0, auto: false,
    damage: 34, headMult: 2, gap: 0.16, mag: 12, reserve: 60, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, bloom: 0.002, bloomMax: 0.012,
    recoilPitch: 0.006, recoilYaw: 0.002,
  },
  rifle: {
    name: 'VK-47', label: 'VK-47 rifle', price: 2700, auto: true,
    damage: 36, headMult: 4, gap: 0.1, mag: 30, reserve: 90, reload: 1.9,
    spreadStill: 0.003, spreadMove: 0.03, bloom: 0.006, bloomMax: 0.03,
    recoilPitch: 0.011, recoilYaw: 0.004,
  },
  smg: {
    name: 'Raptor-9', label: 'Raptor-9 SMG', price: 1400, auto: true,
    damage: 26, headMult: 3, gap: 0.075, mag: 32, reserve: 96, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.035, bloom: 0.004, bloomMax: 0.026,
    recoilPitch: 0.007, recoilYaw: 0.003,
  },
};

export function createWeapons(camera, audio) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35, emissive: new THREE.Color(PALETTE.ink), emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  function buildModel(kind) {
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    if (kind === 'pistol') {
      add(0.07, 0.09, 0.26, 0, 0, -0.1, body);
      add(0.06, 0.1, 0.08, 0, -0.08, 0.06, grip);
    } else if (kind === 'rifle') {
      add(0.09, 0.1, 0.42, 0, 0, -0.05, body);
      add(0.045, 0.045, 0.4, 0, 0.025, -0.42, grip);
      add(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip);
      add(0.05, 0.16, 0.08, 0, -0.12, -0.02, dark);
      add(0.03, 0.03, 0.12, 0, 0.06, -0.2, dark);
    } else {
      add(0.08, 0.09, 0.34, 0, 0, -0.02, body);
      add(0.05, 0.05, 0.22, 0, 0.02, -0.28, dark);
      add(0.06, 0.12, 0.07, 0, -0.09, 0.05, grip);
      add(0.04, 0.04, 0.1, 0, -0.01, 0.22, grip);
    }
    g.position.set(0.3, -0.26, -0.55);
    g.scale.setScalar(1.0);
    g.visible = false;
    camera.add(g);
    return g;
  }

  const models = { pistol: buildModel('pistol'), rifle: buildModel('rifle'), smg: buildModel('smg') };
  models.pistol.visible = true;

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.16, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.14, -0.6);
  camera.add(flashLight);

  const owned = { pistol: true, rifle: false, smg: false };
  const ammo = {
    pistol: { mag: 12, reserve: 60 },
    rifle: { mag: 30, reserve: 90 },
    smg: { mag: 32, reserve: 96 },
  };
  const state = {
    current: 'pistol',
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0,
  };

  function def() { return WEAPONS[state.current]; }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.055);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    model.position.z = -0.55 + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const a = ammo[state.current];
        const d = def();
        const take = Math.min(d.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    owned,
    ammo,
    def,
    step,
    ready() {
      return ammo[state.current].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // Fire one round. Returns the shot (damage, head multiplier, recoil) or null.
    fire() {
      const d = def();
      const a = ammo[state.current];
      if (a.mag <= 0 || state.cooldown > 0 || state.reloadLeft > 0) return null;
      a.mag -= 1;
      state.cooldown = d.gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(d.bloomMax, state.bloom + d.bloom);
      audio.shot(state.current);
      return { damage: d.damage, headMult: d.headMult, recoilPitch: d.recoilPitch, recoilYaw: d.recoilYaw };
    },
    reload() {
      const d = def();
      const a = ammo[state.current];
      if (state.reloadLeft > 0 || a.mag === d.mag || a.reserve === 0) return;
      state.reloadLeft = d.reload;
      audio.reload();
    },
    spread(speed, crouching) {
      const d = def();
      const move = d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove + state.bloom;
      return crouching ? move * 0.7 : move;
    },
    switchTo(name) {
      if (!owned[name] || state.current === name) return false;
      if (state.reloadLeft > 0) state.reloadLeft = 0;
      models[state.current].visible = false;
      state.current = name;
      models[name].visible = true;
      state.cooldown = Math.max(state.cooldown, 0.25);
      return true;
    },
    primaryName() {
      if (owned.rifle) return 'rifle';
      if (owned.smg) return 'smg';
      return 'pistol';
    },
    buy(name, money) {
      const d = WEAPONS[name];
      if (!d || owned[name] || money < d.price) return null;
      owned[name] = true;
      ammo[name] = { mag: d.mag, reserve: d.reserve };
      return d.price;
    },
    refillRound() {
      for (const name of Object.keys(ammo)) {
        if (!owned[name]) continue;
        ammo[name].mag = WEAPONS[name].mag;
        ammo[name].reserve = WEAPONS[name].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
