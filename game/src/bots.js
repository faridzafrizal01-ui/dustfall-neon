// Raiders: four bots that pick a site, BFS a route through the waypoint graph, plant
// the device, then hold the site. They see (line of sight + field of view, and never
// through a smoke cloud), hear gunfire, shoot back in bursts, and react when hit.
// One reusable tracer beam each.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { moveActor, hasLineOfSight, rayBox } from './collide.js';
import { PLANT_TIME } from './state.js';

const BOT_COUNT = 4;
const HEALTH = 100;
const SPEED = 3.4;
const SIGHT_RANGE = 38;
const FOV_COS = Math.cos(1.05); // ~120 deg total
const REACTION = 0.35;
const BURST = 3;
const BURST_GAP = 0.11;
const DAMAGE = 11;

export function createBots(scene, map, audio, hooks, random, grenades) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.them), roughness: 0.6, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.7, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.3, metalness: 0.4, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
  const headGeo = new THREE.BoxGeometry(0.3, 0.28, 0.3);
  const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);
  const beamGeo = new THREE.BoxGeometry(0.02, 0.02, 1);

  const bots = [];
  const hitMeshes = [];
  const eye = new THREE.Vector3();
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function buildBot(id) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.05;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.y = 1.58;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.02), visorMat);
    visor.position.set(0, 1.6, 0.16);
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.14, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.14, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.2, 1.15, -0.25);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.7 }));
    beam.visible = false;
    group.add(torso, head, visor, legL, legR, gun);
    scene.add(group, beam);
    const bot = {
      id, group, torso, head, gun, beam,
      health: HEALTH, alive: true, state: 'advance',
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      yaw: Math.PI, path: [], pathIndex: 0, site: 'A',
      plantProgress: 0, shootCooldown: 1 + random() * 0.5, burstLeft: 0, burstTimer: 0,
      reaction: 0, lastSeen: null, lastSeenAt: -99, hearPos: null, hearAt: -99,
      senseTimer: random() * 0.15, fall: 0, walkPhase: random() * 6,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }
  for (let i = 0; i < BOT_COUNT; i += 1) buildBot(i);

  function reset() {
    // Two bots to A, two to B, shuffled.
    const sites = ['A', 'A', 'B', 'B'];
    for (let i = sites.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const t = sites[i]; sites[i] = sites[j]; sites[j] = t;
    }
    for (let i = 0; i < BOT_COUNT; i += 1) {
      const bot = bots[i];
      const spawn = map.botSpawns[i];
      bot.pos.set(spawn.x, 0, spawn.z);
      bot.vel.set(0, 0, 0);
      bot.yaw = spawn.yaw;
      bot.group.position.copy(bot.pos);
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.visible = true;
      bot.health = HEALTH;
      bot.alive = true;
      bot.state = 'advance';
      bot.site = sites[i];
      bot.path = map.findPath(bot.pos.x, bot.pos.z, map.siteNode[bot.site]);
      bot.pathIndex = 0;
      bot.plantProgress = 0;
      bot.shootCooldown = 1 + random() * 0.8;
      bot.burstLeft = 0;
      bot.burstTimer = 0;
      bot.reaction = 0;
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.hearPos = null;
      bot.hearAt = -99;
      bot.fall = 0;
      bot.beam.visible = false;
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.plantProgress = 0; // a hit interrupts planting
    if (bot.health > 0) {
      // Flinch: turn toward the threat and pause briefly.
      bot.shootCooldown = Math.min(bot.shootCooldown, 0.25);
      return false;
    }
    bot.alive = false;
    bot.fall = 0;
    bot.beam.visible = false;
    hooks.onBotKilled(bot);
    return true;
  }

  function canSee(bot, playerPos, now) {
    eye.set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z);
    target.set(playerPos.x, playerPos.y + 1.4, playerPos.z);
    dir.subVectors(target, eye);
    const dist = dir.length();
    if (dist > SIGHT_RANGE) return false;
    dir.multiplyScalar(1 / dist);
    // Field of view: compare with the bot's facing.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if (dir.x * fx + dir.z * fz < FOV_COS && dist > 2) return false;
    if (!hasLineOfSight(eye, target, map.colliders)) return false;
    // Smoke: no bot sees through a cloud, from either side of it.
    if (grenades && grenades.blocksSight(eye, target)) return false;
    return true;
  }

  function fireAt(bot, player, now, dt) {
    if (bot.burstLeft <= 0) return;
    bot.burstTimer -= dt;
    if (bot.burstTimer > 0) return;
    bot.burstTimer = BURST_GAP;
    bot.burstLeft -= 1;
    const p = player.state;
    const dx = p.position.x - bot.pos.x;
    const dy = (p.position.y + 1.4) - (bot.pos.y + 1.4);
    const dz = p.position.z - bot.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    let hitP = 0.62 - dist * 0.012 - (speed > 3 ? 0.12 : 0) - (p.crouching ? 0.08 : 0);
    hitP = Math.max(0.08, Math.min(0.7, hitP));
    const hit = random() < hitP;
    // Tracer from the gun to the player (or a near miss).
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
    const to = new THREE.Vector3(p.position.x, p.position.y + 1.3, p.position.z);
    if (!hit) {
      to.x += (random() - 0.5) * 1.6;
      to.y += (random() - 0.5) * 1.2;
      to.z += (random() - 0.5) * 1.6;
    }
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    bot.beam.position.copy(mid);
    bot.beam.lookAt(to);
    bot.beam.scale.set(1, 1, from.distanceTo(to));
    bot.beam.visible = true;
    bot.beam.userData.until = now + 0.07;
    audio.enemyShot();
    if (hit && p.alive) {
      const died = player.damage(DAMAGE);
      hooks.onPlayerDamaged(DAMAGE, died);
    }
  }

  function step(dt, now, player, noise) {
    const p = player.state;
    for (const bot of bots) {
      if (bot.beam.visible && now >= (bot.beam.userData.until || 0)) bot.beam.visible = false;
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.45;
          bot.group.position.y = -bot.fall * 0.08;
        }
        continue;
      }
      bot.senseTimer -= dt;
      // Hearing: a recent gunshot nearby pulls the bot toward the noise.
      if (noise && now - noise.at < 1.2) {
        const dx = noise.x - bot.pos.x;
        const dz = noise.z - bot.pos.z;
        if (dx * dx + dz * dz < 25 * 25) {
          bot.hearPos = { x: noise.x, z: noise.z };
          bot.hearAt = now;
        }
      }
      const sees = p.alive && bot.senseTimer <= 0 && canSee(bot, p.position, now);
      if (bot.senseTimer <= 0) bot.senseTimer = 0.15;
      if (sees) {
        bot.lastSeen = { x: p.position.x, z: p.position.z };
        bot.lastSeenAt = now;
        bot.reaction += dt;
      } else {
        bot.reaction = 0;
      }
      const engaging = p.alive && bot.lastSeen && now - bot.lastSeenAt < 2 && bot.reaction >= REACTION;

      if (engaging) {
        // A planting bot that spots the player abandons the plant to fight.
        if (bot.state === 'plant') {
          bot.state = 'advance';
          hooks.onPlantAborted(bot);
        }
        // Face the player and shoot in bursts.
        const dx = p.position.x - bot.pos.x;
        const dz = p.position.z - bot.pos.z;
        const wantYaw = Math.atan2(-dx, -dz);
        let dy = wantYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += dy * Math.min(1, dt * 8);
        bot.vel.set(0, 0, 0);
        bot.shootCooldown -= dt;
        if (bot.shootCooldown <= 0 && bot.burstLeft <= 0) {
          bot.burstLeft = BURST;
          bot.burstTimer = 0;
          bot.shootCooldown = 0.9 + random() * 0.5;
        }
        fireAt(bot, player, now, dt);
        bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }

      // Not engaging: follow the plan.
      bot.shootCooldown = Math.max(0, bot.shootCooldown - dt);
      if (bot.state === 'plant') {
        // Planting is driven by main.js through plantStep; the bot just stands.
        bot.vel.set(0, 0, 0);
        bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }
      if (bot.state === 'defend') {
        // Hold near the site; drift to the assigned hold node.
        const hold = bot.holdTarget;
        if (hold) {
          const dx = hold.x - bot.pos.x;
          const dz = hold.z - bot.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.6) {
            bot.vel.set((dx / d) * SPEED * 0.6, 0, (dz / d) * SPEED * 0.6);
            bot.yaw = Math.atan2(-dx, -dz);
          } else {
            bot.vel.set(0, 0, 0);
            // Scan: slowly turn toward the most likely approach.
            bot.yaw += dt * 0.4 * bot.scanDir;
            if (random() < dt * 0.2) bot.scanDir *= -1;
          }
        }
        moveActor(bot.pos, bot.vel, dt, map.colliders, 0.34, 1.72);
        bot.group.position.copy(bot.pos);
        bot.group.rotation.set(0, bot.yaw, 0);
        continue;
      }
      // Advance: follow the waypoint path; investigate a heard noise first.
      let targetPt = null;
      if (bot.hearPos && now - bot.hearAt >= 4) bot.hearPos = null;
      if (bot.hearPos && bot.state === 'advance') {
        targetPt = bot.hearPos;
      } else if (bot.pathIndex < bot.path.length) {
        targetPt = bot.path[bot.pathIndex];
      }
      if (targetPt) {
        const dx = targetPt.x - bot.pos.x;
        const dz = targetPt.z - bot.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          if (bot.hearPos && now - bot.hearAt < 4) {
            bot.hearPos = null;
          } else {
            bot.pathIndex += 1;
          }
        } else {
          bot.vel.set((dx / d) * SPEED, 0, (dz / d) * SPEED);
          bot.yaw = Math.atan2(-dx, -dz);
        }
      } else {
        bot.vel.set(0, 0, 0);
        // Reached the site: begin planting (main.js confirms the site and drives it).
        if (map.siteAt(bot.pos.x, bot.pos.z) === bot.site && hooks.bombIdle()) {
          bot.state = 'plant';
          hooks.onBotPlant(bot);
        }
      }
      moveActor(bot.pos, bot.vel, dt, map.colliders, 0.34, 1.72);
      bot.group.position.copy(bot.pos);
      bot.group.rotation.set(0, bot.yaw, 0);
      // Walk cycle: bob the legs.
      bot.walkPhase += dt * 9 * (Math.hypot(bot.vel.x, bot.vel.z) / SPEED);
      const swing = Math.sin(bot.walkPhase) * 0.35 * Math.min(1, Math.hypot(bot.vel.x, bot.vel.z) / SPEED);
      bot.group.children[3].rotation.x = swing;
      bot.group.children[4].rotation.x = -swing;
    }
  }

  return {
    bots,
    hitMeshes,
    reset,
    damage,
    step,
    aliveCount() {
      return bots.filter((b) => b.alive).length;
    },
    planter() {
      return bots.find((b) => b.alive && b.state === 'plant') || null;
    },
    setDefend(site) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.state = 'defend';
        const holds = map.holdNodes[site];
        const node = holds[bot.id % holds.length];
        bot.holdTarget = map.nodePos(node);
        bot.scanDir = bot.id % 2 === 0 ? 1 : -1;
      }
    },
  };
}
