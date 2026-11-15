// NEONDOCK: boot and the one loop. A fixed 60 Hz simulation feeds a render at the
// display's rate. Rounds flow menu -> buy -> playing -> roundEnd. ?shot=start|play|
// plant|buy with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import {
  createState, resetRound, ROUND_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME,
  BUY_TIME, KILL_REWARD, WIN_REWARD, LOSS_REWARD, SMOKE_PRICE, SMOKE_MAX,
  GRENADE_PRICE, GRENADE_MAX,
} from './state.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 18, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const state = createState();
const audio = createAudio();
const map = createMap(scene);
const hud = createHud();
const player = createPlayer(map.colliders);
const weapons = createWeapons(camera, audio);
const grenades = createGrenades(scene, map.colliders, audio);
const bomb = createBomb(scene, audio);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = map.shootables;

let noise = null;
let planterBot = null;
let paused = false;
let frozen = false;
let elapsed = 0;
let buyTimer = BUY_TIME;
let prevFiring = false;
let dryTimer = 0;

const bots = createBots(scene, map, audio, {
  onBotKilled(bot) {
    state.money += KILL_REWARD;
    state.kills += 1;
    hud.killfeed(`You dropped Raider ${bot.id + 1}  +$${KILL_REWARD}`);
    hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
  },
  onPlayerDamaged(amount, died) {
    hud.damageFlash();
    hud.setHealth(player.state.health);
    audio.hurt();
    if (died) endRound(false, 'You are down — the Raiders take the dock.');
  },
  onBotPlant(bot) {
    if (bomb.state.state === 'idle') {
      planterBot = bot;
      bomb.plant(bot.site);
    }
  },
  onPlantAborted(bot) {
    if (planterBot === bot) planterBot = null;
    if (bomb.state.state === 'planting') bomb.reset();
  },
  bombIdle() {
    return bomb.state.state === 'idle';
  },
}, random, grenades);
shootables.push(...bots.hitMeshes);

const dir = new THREE.Vector3();
const eyePos = new THREE.Vector3();

function syncCamera() {
  const p = player.state;
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function aimAt(x, y, z) {
  const p = player.state;
  const dx = x - p.position.x;
  const dy = y - (p.position.y + p.eye);
  const dz = z - p.position.z;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function refreshHud() {
  hud.setHealth(player.state.health);
  const a = weapons.ammo[weapons.state.current];
  hud.setAmmo(a.mag, a.reserve, weapons.def().label);
  hud.setScore(state.scoreUs, state.scoreThem, state.round);
  hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
  hud.setTimer(state.timer, false);
}

function startRound() {
  resetRound(state);
  player.reset(map.playerSpawn.x, map.playerSpawn.z, map.playerSpawn.yaw);
  bots.reset();
  weapons.refillRound();
  grenades.clear();
  bomb.reset();
  noise = null;
  planterBot = null;
  paused = false;
  buyTimer = BUY_TIME;
  state.mode = 'buy';
  state.buyOpen = true;
  syncCamera();
  refreshHud();
  hud.setBomb('', null);
  hud.setProgress(null, 0);
  hud.hideOverlay();
  hud.showBuy(state, onBuy, deploy);
  hud.setBuyTimer(buyTimer);
  input.exitLock();
}

function deploy() {
  if (state.mode !== 'buy') return;
  state.mode = 'playing';
  state.buyOpen = false;
  hud.hideBuy();
  hud.announce(`ROUND ${state.round}`, 'Defend Crane and Pier — hold E to defuse');
  if (!shot) input.requestLock();
}

function endRound(win, reason) {
  if (state.mode === 'roundEnd') return;
  const earned = win ? WIN_REWARD : LOSS_REWARD;
  state.money += earned;
  if (win) state.scoreUs += 1; else state.scoreThem += 1;
  state.roundResult = { win, reason };
  state.mode = 'roundEnd';
  if (win) audio.roundWin(); else audio.roundLose();
  hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
  hud.setScore(state.scoreUs, state.scoreThem, state.round);
  hud.showOverlay('roundEnd', { win, reason, earned, money: state.money, kills: state.kills });
  input.exitLock();
}

function onBuy(name) {
  if (state.mode !== 'buy') return;
  if (name === 'grenade') {
    if (state.money >= GRENADE_PRICE && state.owned.grenades < GRENADE_MAX) {
      state.money -= GRENADE_PRICE;
      state.owned.grenades += 1;
      audio.click();
    }
  } else if (name === 'smoke') {
    if (state.money >= SMOKE_PRICE && state.owned.smokes < SMOKE_MAX) {
      state.money -= SMOKE_PRICE;
      state.owned.smokes += 1;
      audio.click();
    }
  } else {
    const price = weapons.buy(name, state.money);
    if (price != null) {
      state.money -= price;
      audio.click();
    }
  }
  hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
  hud.showBuy(state, onBuy, deploy);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    paused = false;
    hud.hideOverlay();
  } else if (state.mode === 'playing' && !state.roundResult) {
    paused = true;
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (state.mode === 'menu') {
    startRound();
  } else if (state.mode === 'roundEnd') {
    state.round += 1;
    startRound();
  } else if (paused) {
    input.requestLock();
  }
});

function fireShot() {
  const s = weapons.fire();
  if (!s) {
    // Dry fire click when the magazine is empty.
    if (weapons.ammo[weapons.state.current].mag === 0 && dryTimer <= 0) {
      audio.dry();
      dryTimer = 0.25;
    }
    return;
  }
  camera.getWorldDirection(dir);
  const spread = weapons.spread(player.groundSpeed(), player.state.crouching);
  dir.x += (random() - 0.5) * 2 * spread;
  dir.y += (random() - 0.5) * 2 * spread;
  dir.z += (random() - 0.5) * 2 * spread;
  dir.normalize();
  eyePos.copy(camera.position);
  raycaster.set(eyePos, dir);
  const hits = raycaster.intersectObjects(shootables, false);
  if (hits.length > 0) {
    const hitDist = hits[0].distance;
    // A smoke cloud between the muzzle and the target swallows the shot.
    if (grenades.rayBlocked(eyePos, dir, hitDist) < hitDist) {
      player.recoil(s.recoilPitch, (random() - 0.5) * 2 * s.recoilYaw);
      const p = player.state;
      noise = { x: p.position.x, z: p.position.z, at: elapsed };
      hud.setCrosshair(spread);
      return;
    }
    const obj = hits[0].object;
    const bot = obj.userData.bot;
    if (bot && bot.alive) {
      const isHead = obj.userData.part === 'head';
      const dmg = s.damage * (isHead ? s.headMult : 1);
      const killed = bots.damage(bot, dmg);
      if (killed) {
        audio.kill();
        hud.hitMarker(true, 140);
        hud.killfeed(`You dropped Raider ${bot.id + 1}${isHead ? ' — headshot' : ''}`);
      } else {
        audio.hit();
        hud.hitMarker(false);
      }
    }
  }
  player.recoil(s.recoilPitch, (random() - 0.5) * 2 * s.recoilYaw);
  const p = player.state;
  noise = { x: p.position.x, z: p.position.z, at: elapsed };
  hud.setCrosshair(spread);
}

function explosionDamage(pos, radius, maxDmg, minDmg) {
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.pos.x - pos.x, 1 - pos.y, bot.pos.z - pos.z);
    if (d >= radius) continue;
    const dmg = Math.round(minDmg + (maxDmg - minDmg) * (1 - d / radius));
    const killed = bots.damage(bot, dmg);
    if (killed) {
      audio.kill();
      hud.killfeed(`Spark blast dropped Raider ${bot.id + 1}`);
    }
  }
  const p = player.state;
  if (p.alive) {
    const d = Math.hypot(p.position.x - pos.x, (p.position.y + 1) - pos.y, p.position.z - pos.z);
    if (d < radius) {
      const dmg = Math.round(minDmg + (maxDmg - minDmg) * (1 - d / radius));
      const died = player.damage(dmg);
      hud.damageFlash();
      hud.setHealth(p.health);
      if (died) endRound(false, 'Caught by your own blast.');
    }
  }
}

function step(dt) {
  elapsed += dt;
  dryTimer = Math.max(0, dryTimer - dt);
  if (state.mode === 'buy') {
    buyTimer -= dt;
    hud.setBuyTimer(buyTimer);
    if (buyTimer <= 0) deploy();
    return;
  }
  if (state.mode !== 'playing' || paused) return;

  // Input.
  const look = input.takeLook();
  player.look(look.x, look.y);
  const pressed = input.takePressed();
  if (pressed) {
    for (const code of pressed) {
      if (code === 'KeyR') weapons.reload();
      else if (code === 'Digit1') weapons.switchTo(weapons.primaryName());
      else if (code === 'Digit2') weapons.switchTo('pistol');
      else if (code === 'KeyG') {
        if (state.owned.grenades > 0) {
          state.owned.grenades -= 1;
          camera.getWorldDirection(dir);
          eyePos.copy(camera.position);
          grenades.throwFrom(eyePos, dir, 13, 'he');
          hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
        }
      } else if (code === 'KeyH') {
        if (state.owned.smokes > 0) {
          state.owned.smokes -= 1;
          camera.getWorldDirection(dir);
          eyePos.copy(camera.position);
          grenades.throwFrom(eyePos, dir, 13, 'smoke');
          hud.setMoney(state.money, state.owned.grenades, state.owned.smokes);
        }
      }
    }
  }

  player.step(dt, input.state.keys);
  weapons.step(dt);
  grenades.step(dt, elapsed, explosionDamage);

  // Fire.
  const firing = input.state.firing;
  const semi = !weapons.def().auto;
  if (firing && (!semi || (firing && !prevFiring))) fireShot();
  prevFiring = firing;
  if (weapons.state.reloadLeft === 0) {
    const a = weapons.ammo[weapons.state.current];
    hud.setAmmo(a.mag, a.reserve, weapons.def().label);
  }

  // Bots.
  bots.step(dt, elapsed, player, noise);
  if (state.mode !== 'playing') { syncCamera(); return; }

  // Bomb: plant channel.
  const b = bomb.state;
  if (b.state === 'idle') {
    const planter = bots.planter();
    if (planter) {
      planterBot = planter;
      bomb.plant(planter.site);
    }
  } else if (b.state === 'planting') {
    const planter = bots.planter();
    const active = !!planter && planter.alive && map.siteAt(planter.pos.x, planter.pos.z) === b.site;
    if (bomb.plantStep(dt, active)) {
      bots.setDefend(b.site);
      planterBot = null;
      hud.announce('DEVICE PLANTED', `Site ${b.site} — hold E inside the site to defuse`, 3200);
    } else if (b.progress <= 0 && !active) {
      bomb.reset();
      planterBot = null;
    }
  } else if (b.state === 'planted') {
    const inSite = map.siteAt(player.state.position.x, player.state.position.z) === b.site;
    const defusing = player.state.alive && inSite && input.state.keys.has('KeyE');
    if (bomb.defuseStep(dt, defusing)) {
      endRound(true, 'Device defused — site held.');
    }
    hud.setProgress(defusing || b.progress > 0 ? 'DEFUSING — hold E' : null, b.progress);
    const event = bomb.step(dt);
    if (event === 'detonated') {
      endRound(false, 'The device detonated.');
    }
  }

  // Round timer (the fuse replaces it once the device is planted).
  if (b.state !== 'planted') {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.timer = 0;
      endRound(true, 'Time — the Raiders never planted.');
    }
  }

  // Round end by elimination.
  if (state.mode === 'playing' && bots.aliveCount() === 0 && b.state !== 'planted') {
    endRound(true, 'All Raiders down — site held.');
  }
  if (state.mode === 'playing' && bots.aliveCount() === 0 && b.state === 'planted') {
    // All Raiders down but the device ticks: the player can still defuse.
  }

  // HUD.
  hud.setHealth(player.state.health);
  hud.setTimer(b.state === 'planted' ? b.fuse : state.timer, b.state === 'planted');
  if (b.state === 'planting') hud.setBomb(`PLANTING AT SITE ${b.site}`, 'warn');
  else if (b.state === 'planted') hud.setBomb(`DEVICE PLANTED — SITE ${b.site}`, 'danger');
  else hud.setBomb('', null);
  hud.setCrosshair(weapons.spread(player.groundSpeed(), player.state.crouching));
  syncCamera();
}

// ---- Boot ----
refreshHud();
hud.showOverlay('start');
syncCamera();

function render() {
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Deterministic captures ----
function setupShot() {
  const start = map.playerSpawn;
  if (shot === 'start') {
    player.reset(start.x, start.z, start.yaw);
    syncCamera();
    hud.showOverlay('start');
    return;
  }
  if (shot === 'buy') {
    state.round = 2;
    state.money = 3400;
    state.owned.rifle = true;
    state.owned.grenades = 1;
    state.owned.smokes = 1;
    startRound();
    buyTimer = 9;
    return;
  }
  if (shot === 'play' || shot === 'plant') {
    startRound();
    deploy();
    if (shot === 'plant') {
      // Force a plant at site A: put Raider 1 on the site, assign it that site,
      // and let the channel run.
      const bot = bots.bots[0];
      bot.pos.set(-16, 0, -12);
      bot.group.position.copy(bot.pos);
      bot.site = 'A';
      bot.state = 'plant';
      for (let i = 0; i < 220; i += 1) step(FIXED_STEP);
      player.reset(-9, -6, 0);
      aimAt(-16, 1, -12);
      syncCamera();
      hud.setBomb('DEVICE PLANTED — SITE A', 'danger');
      hud.setTimer(bomb.state.fuse, true);
      return;
    }
    // Run 5 seconds of simulation so the Raiders are mid-map, then aim at the
    // nearest one for the action frame. A smoke cloud hangs between the player
    // and the approach lane so the frame shows the new mechanic live.
    for (let i = 0; i < 300; i += 1) step(FIXED_STEP);
    grenades.spawnCloud(new THREE.Vector3(-2, 0, -2), elapsed);
    grenades.step(0.5, elapsed + 0.5, explosionDamage);
    // Aim at the nearest living Raider for the action frame.
    let best = null;
    let bestD = Infinity;
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      const d = bot.pos.distanceTo(player.state.position);
      if (d < bestD) { bestD = d; best = bot; }
    }
    if (best) aimAt(best.pos.x, best.pos.y + 1.3, best.pos.z);
    syncCamera();
  }
}

if (shot) {
  setupShot();
  render();
  render();
  frozen = true;
  window.__shotReady = true;
} else {
  let accumulator = 0;
  let lastTime = performance.now();
  function loop(now) {
    if (frozen) return;
    requestAnimationFrame(loop);
    const frameDt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    accumulator += frameDt;
    let guard = 0;
    while (accumulator >= FIXED_STEP && guard < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      guard += 1;
    }
    if (guard === 5) accumulator = 0;
    render();
  }
  requestAnimationFrame(loop);
}
